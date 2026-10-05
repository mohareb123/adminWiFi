/**
 * BaseRouterAdapter — the shared execution machinery every adapter inherits.
 *
 * It intentionally contains the *universal* behaviour:
 *  - login recipe discovery + multi-strategy authentication,
 *  - signature-driven operation execution,
 *  - verification of every write (VerificationEngine),
 *  - parsing of device/Wi-Fi/WAN/LAN data from JSON, HTML or TR-069 dumps,
 *  - honest failure reporting (never a fake success).
 *
 * Vendor adapters override only what is genuinely vendor specific.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { RouterError, toRouterError } from '../core/errors';
import { createLogger, type Logger } from '../core/logger';
import type {
  AdapterInfo,
  OperationId,
  BandwidthSample,
  DeviceRecord,
  LanState,
  LoginRecipe,
  OperationRequest,
  OperationResult,
  RouterCredentials,
  WanState,
  WifiNeighbor,
  WifiState,
} from '../core/types';
import { uniq } from '../core/util';
import {
  DEFAULT_TRANSFORM_ORDER,
  FormSessionStrategy,
  HttpAuthStrategy,
  TokenLoginStrategy,
  detectCaptcha,
  discoverLoginFields,
  type LoginStrategy,
  type PasswordTransform,
} from '../authentication/strategies';
import { VerificationEngine } from '../verification/engine';
import { capabilityForOperation } from '../capabilities/detector';
import {
  decorateDevice,
  extractByteCounters,
  extractDevicesFromHtml,
  extractLanFromFields,
  extractDevicesFromJson,
  extractDevicesFromTr069,
  extractLanFromJson,
  extractNeighborsFromJson,
  extractWanFromHtml,
  extractWanFromJson,
  extractWifiFromHtml,
  extractWifiFromJson,
} from './parsing';
import type { AdapterContext, LoginResult, RouterAdapter } from './types';

export interface BaseAdapterConfig {
  info: AdapterInfo;
  /** Password transforms to try, in order (first success wins). */
  transformOrder?: PasswordTransform[];
  /** Extra login strategies prepended to the universal chain. */
  strategies?: LoginStrategy[];
  /** Parser hooks. */
  parsers?: {
    devicesFromJson?: (json: unknown) => DeviceRecord[];
    devicesFromText?: (text: string) => DeviceRecord[];
    devicesFromHtml?: (html: string) => DeviceRecord[];
  };
}

export abstract class BaseRouterAdapter implements RouterAdapter {
  readonly info: AdapterInfo;
  protected readonly logger: Logger;
  protected readonly transformOrder: PasswordTransform[];
  protected readonly strategies: LoginStrategy[];
  protected readonly parsers: NonNullable<BaseAdapterConfig['parsers']>;

  constructor(config: BaseAdapterConfig) {
    this.info = config.info;
    this.logger = createLogger(`adapter.${config.info.id}`);
    this.transformOrder = config.transformOrder ?? DEFAULT_TRANSFORM_ORDER;
    this.strategies = [
      ...(config.strategies ?? []),
      new HttpAuthStrategy(),
      new TokenLoginStrategy(),
      new FormSessionStrategy(),
    ];
    this.parsers = config.parsers ?? {};
  }

  /* ------------------------------------------------------------------ *
   * Login
   * ------------------------------------------------------------------ */

  async discoverLoginRecipe(context: AdapterContext): Promise<LoginRecipe> {
    const signature = context.signature;
    const loginPath = signature.loginPath ?? '/';
    const recipe: LoginRecipe = {
      kind: signature.loginType === 'http-basic' || signature.loginType === 'http-digest' ? signature.loginType : signature.loginType === 'token-bearer' ? 'token-bearer' : 'form-session',
      loginUrl: loginPath,
      successProbe: this.successProbe(context),
      notes: signature.authMethod,
    };

    // A cheap static page read lets us name the fields before the user types
    // anything, so the login screen can adapt (username optional, etc.).
    try {
      const page = await context.session.request({
        url: loginPath,
        method: 'GET',
        timeoutMs: 4000,
        signal: context.signal,
      });
      const body = page.body ?? '';
      if (detectCaptcha(body)) recipe.notes = `${recipe.notes ?? ''} | captcha-detected`.trim();
      if (recipe.kind === 'form-session' || recipe.kind === 'form-session-token') {
        const fields = discoverLoginFields(body, /(user|username|usr|login|account|admin|name)/i, /(pass|pwd|password|key|pin)/i, /(token|csrf|nonce|rand|auth|seq|key|session)/i);
        recipe.usernameField = fields.usernameField;
        recipe.passwordField = fields.passwordField;
        recipe.extraFields = fields.extraFields;
        if (fields.formAction) recipe.loginUrl = fields.formAction;
      }
      const challenge = page.headers['www-authenticate'];
      if (challenge) {
        recipe.kind = /digest/i.test(challenge) ? 'http-digest' : 'http-basic';
        recipe.notes = `${recipe.notes ?? ''} | ${challenge}`.trim();
      }
    } catch (error) {
      this.logger.debug('login page inspection failed', { message: (error as Error).message });
    }
    return recipe;
  }

  /** Which page proves an authenticated session. */
  protected successProbe(context: AdapterContext): string | undefined {
    const api = context.signature.api ?? {};
    const candidates: string[] = [];
    for (const candidate of [api.deviceInfo, api.wanInfo, api.lanInfo]) {
      if (candidate && !candidate.includes('{')) candidates.push(candidate);
    }
    return candidates[0];
  }

  async authenticate(context: AdapterContext, credentials: RouterCredentials): Promise<LoginResult> {
    const started = Date.now();
    let attempts = 0;
    const recipe = context.state.loginRecipe ?? (await this.discoverLoginRecipe(context));
    context.state.loginRecipe = recipe;

    if (recipe.notes?.includes('captcha-detected')) {
      return {
        ok: false,
        recipe,
        reason: 'captcha',
        detail: 'The router login page includes a CAPTCHA',
        attempts: 0,
        durationMs: Date.now() - started,
      };
    }

    const strategies = [...this.strategies];
    for (const strategy of strategies) {
      if (!strategy.canHandle(recipe)) continue;
      let transforms = this.transformOrder;
      // Only the first strategy needs the full transform sweep; later ones reuse
      // the most likely transform to avoid locking the account out.
      if (strategy !== strategies[0]) transforms = this.transformOrder.slice(0, 1);
      for (const transform of transforms) {
        if (context.signal?.aborted) break;
        attempts += 1;
        const outcome = await strategy.login(
          { session: context.session, credentials, recipe, successProbe: this.successProbe(context), signal: context.signal },
          transform,
          this.recipeFor(strategy, recipe),
        );
        if (outcome.ok) {
          context.state.authenticated = true;
          context.state.loginRecipe = outcome.recipe;
          context.state.token = outcome.token ?? context.session.transport.cookies?.get('stok');
          this.logger.info('authenticated', { strategy: strategy.id, transform, attempts });
          return {
            ok: true,
            recipe: outcome.recipe,
            detail: outcome.detail,
            attempts,
            durationMs: Date.now() - started,
          };
        }
        if (outcome.reason === 'captcha') {
          return { ok: false, recipe: outcome.recipe, reason: 'captcha', detail: outcome.detail, attempts, durationMs: Date.now() - started };
        }
        this.logger.debug('strategy failed', { strategy: strategy.id, transform, detail: outcome.detail });
      }
    }

    context.state.authenticated = false;
    return {
      ok: false,
      recipe,
      reason: 'auth-failed',
      detail: 'All authentication strategies were rejected by the device',
      attempts,
      durationMs: Date.now() - started,
    };
  }

  /** Allows a vendor adapter to hand a strategy a device-specific recipe. */
  protected recipeFor(_strategy: LoginStrategy, recipe: LoginRecipe): LoginRecipe {
    return recipe;
  }

  async logout(context: AdapterContext): Promise<void> {
    context.state.authenticated = false;
    context.session.transport.cookies?.clear();
  }

  /* ------------------------------------------------------------------ *
   * Read paths
   * ------------------------------------------------------------------ */

  async getDevices(context: AdapterContext): Promise<DeviceRecord[]> {
    const paths = this.candidatePaths(context, 'deviceList');
    if (paths.length === 0) throw new RouterError('unsupported-operation', { detail: 'no device-list endpoint in signature' });
    const { body, contentType, url } = await this.firstSuccessfulGet(context, paths);
    const devices = this.parseDevices(body, contentType);
    if (devices.length > 0) context.state.workingPaths.deviceList = url;
    context.state.observed.connected_devices = devices.length > 0;
    return devices.map(decorateDevice);
  }

  async getWifiState(context: AdapterContext): Promise<WifiState> {
    const paths = this.candidatePaths(context, 'wifiInfo');
    if (paths.length === 0) throw new RouterError('unsupported-operation', { detail: 'no wifi endpoint in signature' });
    const { body, contentType } = await this.firstSuccessfulGet(context, paths);
    const wifi = this.parseWifi(body, contentType);
    if (wifi.bands.length === 0) throw new RouterError('unsupported-operation', { detail: 'wifi data not found in the response' });
    context.state.observed.wifi = true;
    context.state.observed.wifi_5ghz = wifi.bands.some((band) => band.band === '5GHz');
    return wifi;
  }

  async scanWifiNeighbors(context: AdapterContext): Promise<WifiNeighbor[]> {
    const paths = this.candidatePaths(context, 'wifiScan');
    if (paths.length === 0) throw new RouterError('unsupported-operation', { detail: 'no wifi-survey endpoint in signature' });
    const { body } = await this.firstSuccessfulGet(context, paths);
    const neighbors = extractNeighborsFromJson(safeJson(body));
    if (neighbors.length === 0) throw new RouterError('unsupported-operation', { detail: 'survey returned no usable data' });
    return neighbors;
  }

  async getWanState(context: AdapterContext): Promise<WanState> {
    const paths = this.candidatePaths(context, 'wanInfo');
    const { body, contentType } = await this.firstSuccessfulGet(context, paths);
    return safeJson(body) ? extractWanFromJson(safeJson(body)) : extractWanFromHtml(body) ?? { dns: [] };
  }

  async getLanState(context: AdapterContext): Promise<LanState> {
    const paths = this.candidatePaths(context, 'lanInfo', 'dhcpInfo');
    const { body } = await this.firstSuccessfulGet(context, paths);
    const fallbackIp = hostOf(context.session.baseUrl);
    const json = safeJson(body);
    if (json) return extractLanFromJson(json, fallbackIp);
    // TR-069 style text dumps: parse the fields instead of giving up.
    return extractLanFromFields(body, fallbackIp);
  }

  /**
   * Real-time throughput.
   *
   * 1. If the device reports live per-device or interface rates, use them.
   * 2. Otherwise difference the monotonic byte counters between two samples —
   *    a real measurement, and the only honest option on routers that publish
   *    totals only (very common on ISP ONTs).
   */
  async getBandwidthSample(context: AdapterContext): Promise<BandwidthSample> {
    const paths = this.candidatePaths(context, 'stats', 'wanInfo');
    const { body } = await this.firstSuccessfulGet(context, paths);
    const json = safeJson(body);
    const sample: BandwidthSample = { at: Date.now(), downKbps: 0, upKbps: 0, perDevice: {} };

    // 1. Live per-device rates.
    if (json) {
      for (const device of extractDevicesFromJson(json)) {
        if (device.rateDownKbps === undefined && device.rateUpKbps === undefined) continue;
        sample.perDevice![device.id] = { downKbps: device.rateDownKbps ?? 0, upKbps: device.rateUpKbps ?? 0 };
        sample.downKbps += device.rateDownKbps ?? 0;
        sample.upKbps += device.rateUpKbps ?? 0;
      }
    }
    if (sample.downKbps > 0 || sample.upKbps > 0) {
      context.state.observed.traffic_stats = true;
      return sample;
    }

    // 2. Counter differencing.
    const counters = extractByteCounters(body);
    if (counters.downKb !== undefined || counters.upKb !== undefined) {
      const previous = context.state.counters;
      if (previous && (counters.downKb !== undefined || counters.upKb !== undefined)) {
        const seconds = Math.max(0.5, (Date.now() - previous.at) / 1000);
        const downDeltaKb = Math.max(0, (counters.downKb ?? previous.downKb ?? 0) - (previous.downKb ?? 0));
        const upDeltaKb = Math.max(0, (counters.upKb ?? previous.upKb ?? 0) - (previous.upKb ?? 0));
        // KB per second → kbit per second (×8).
        sample.downKbps = Math.round((downDeltaKb / seconds) * 8);
        sample.upKbps = Math.round((upDeltaKb / seconds) * 8);
      }
      context.state.counters = { at: Date.now(), downKb: counters.downKb, upKb: counters.upKb };
      if (sample.downKbps > 0 || sample.upKbps > 0) {
        context.state.observed.traffic_stats = true;
        return sample;
      }
    }
    context.state.observed.traffic_stats = false;
    return sample;
  }

  async getAdvancedData(context: AdapterContext, kind: string): Promise<unknown> {
    const api = (context.signature.api ?? {}) as Record<string, string | undefined>;
    const path = api[kind];
    if (!path || path.includes('{')) return { note: 'no direct endpoint declared for this capability', kind };
    const response = await context.session.request({ url: path, method: 'GET', timeoutMs: 5000, signal: context.signal });
    return { url: response.url, status: response.status, headers: response.headers, body: response.body.slice(0, 8000) };
  }

  /* ------------------------------------------------------------------ *
   * Operations
   * ------------------------------------------------------------------ */

  async execute(context: AdapterContext, request: OperationRequest): Promise<OperationResult> {
    const started = Date.now();
    const operation = this.findOperation(context, request.id);
    if (!operation) {
      return this.unsupported(request, 'no operation mapping in the signature for this device family');
    }
    if (!context.state.authenticated) {
      return {
        operationId: request.id,
        ok: false,
        verified: false,
        appliedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        message: 'يجب تسجيل الدخول للراوتر أولًا.',
        messageEn: 'Not authenticated with the router.',
        reason: 'not-authenticated',
      };
    }

    try {
      const params = { ...request.params } as Record<string, string>;
      const path = this.fillTemplate(operation.path, context, params);
      const body: Record<string, string> = { ...(operation.staticBody ?? {}) };
      for (const [paramKey, field] of Object.entries(operation.fieldMap ?? {})) {
        const value = params[paramKey];
        if (value === undefined || typeof field !== 'string') continue;
        body[this.fillTemplate(field, context, params)] = value;
      }
      // Any parameter without an explicit mapping is passed through as-is —
      // this keeps unmapped vendor forms working.
      for (const [key, value] of Object.entries(params)) {
        if (!body[key] && !(operation.fieldMap && Object.keys(operation.fieldMap).includes(key))) body[key] = value;
      }

      const method = operation.method;
      const isQuery = operation.encoding === 'query';
      const url = method === 'GET' && isQuery ? `${path}?${new URLSearchParams(body).toString()}` : path;

      const response = await context.session.request({
        url,
        method,
        body:
          method === 'GET' || operation.encoding === 'none'
            ? undefined
            : operation.encoding === 'json'
              ? JSON.stringify(this.buildJsonBody(operation.staticBody, body))
              : new URLSearchParams(body).toString(),
        headers: operation.encoding === 'json' ? { 'content-type': 'application/json; charset=UTF-8' } : undefined,
        timeoutMs: 8000,
        signal: context.signal,
      });

      // A 404/405 on a *write* endpoint means this firmware build does not
      // expose the feature at all — report it as unsupported, never as failure
      // of the user's input (spec §7).
      if (response.status === 404 || response.status === 405 || response.status === 501) {
        const capability = capabilityForOperation(request.id);
        if (capability) context.state.observed[capability] = false;
        context.learn?.({ operationId: request.id, ok: false, verified: false, reason: 'unsupported' });
        return {
          operationId: request.id,
          ok: false,
          verified: false,
          appliedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
          message: 'غير مدعوم على هذا الراوتر.',
          messageEn: `This firmware build does not expose the endpoint (HTTP ${response.status}).`,
          reason: 'unsupported',
          technical: { status: response.status, url: response.url },
          params: request.params,
        };
      }

      const verification = await VerificationEngine.verify({
        session: context.session,
        response,
        assert: operation.expect,
        readBack:
          operation.readBack && this.readBackExpectation(request) !== undefined
            ? {
                path: this.fillTemplate(operation.readBack, context, params),
                pattern: operation.readBackPattern ?? '(.+)',
                expected: this.readBackExpectation(request),
              }
            : undefined,
        signal: context.signal,
      });

      const ok = verification.outcome === 'verified' || verification.outcome === 'accepted-unverified';
      context.learn?.({ operationId: request.id, ok, verified: verification.outcome === 'verified' });
      if (ok) context.state.workingPaths[operation.id] = path;

      return {
        operationId: request.id,
        ok,
        verified: verification.outcome === 'verified',
        appliedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        message: this.successMessage(request, verification.outcome),
        messageEn:
          verification.outcome === 'verified'
            ? 'The router confirmed the new setting.'
            : 'The router accepted the request, but this model cannot confirm the value.',
        reason: ok ? undefined : 'verification-failed',
        technical: {
          status: response.status,
          url: response.url,
          request: { method, path, body: sanitizeBody(body) },
          responseSample: response.body.slice(0, 400),
        },
        params: request.params,
        verification,
      };
    } catch (error) {
      const routerError = toRouterError(error);
      context.learn?.({ operationId: request.id, ok: false, verified: false, reason: routerError.code });
      return {
        operationId: request.id,
        ok: false,
        verified: false,
        appliedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        message:
          routerError.code === 'unsupported-operation'
            ? 'غير مدعوم على هذا الراوتر.'
            : `لم يتم تطبيق التغيير. (${routerError.userMessage})`,
        messageEn: routerError.technicalMessage,
        reason: routerError.code === 'unsupported-operation' ? 'unsupported' : 'network-error',
        technical: { url: routerError.url, status: routerError.status },
        params: request.params,
      };
    }
  }

  /**
   * Resolve the signature operation for a request.
   *
   * Many vendors reuse one endpoint for both directions of a change (block /
   * unblock, add / remove rule, set / clear limit). Rather than duplicating
   * mappings in every signature we resolve the sibling and let the parameters
   * carry the direction — this is what makes the adapter layer universal
   * without being sloppy about it.
   */
  protected findOperation(context: AdapterContext, id: OperationId) {
    const operations = context.signature.operations ?? [];
    const direct = operations.find((entry) => entry.id === id);
    if (direct) return direct;
    const sibling = OPERATION_SIBLINGS[id as string];
    if (!sibling) return undefined;
    const resolved = operations.find((entry) => entry.id === sibling);
    if (!resolved) return undefined;
    return { ...resolved, id, notes: `${resolved.notes ?? ''} (mapped from ${sibling})`.trim() };
  }

  /** Value a read-back must observe to consider an operation successful. */
  protected readBackExpectation(request: OperationRequest): string | undefined {
    const params = request.params as Record<string, unknown>;
    const candidate =
      params.ssid ?? params.password ?? params.channel ?? params.security ?? params.dns ?? params.poolStart ?? params.mtu;
    if (candidate === undefined) return undefined;
    return String(candidate);
  }

  protected buildJsonBody(staticBody: Record<string, string> | undefined, body: Record<string, string>): unknown {
    if (staticBody && Object.keys(staticBody).length === 1) {
      // Signatures declare JSON payloads as { method: 'do' } plus merged fields.
      return { ...Object.fromEntries(Object.entries(staticBody).map(([key, value]) => [key, coerceJson(value)])), ...Object.fromEntries(Object.entries(body).filter(([key]) => !(key in (staticBody ?? {}))).map(([key, value]) => [key, coerceJson(value)])) };
    }
    return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, coerceJson(value)]));
  }

  protected unsupported(request: OperationRequest, detail: string): OperationResult {
    return {
      operationId: request.id,
      ok: false,
      verified: false,
      appliedAt: new Date().toISOString(),
      durationMs: 0,
      message: 'غير مدعوم على هذا الراوتر.',
      messageEn: 'Unsupported on this router.',
      reason: 'unsupported',
      technical: { detail },
    };
  }

  protected successMessage(request: OperationRequest, outcome: string): string {
    const base = OUTCOME_MESSAGES_AR[request.id] ?? 'تم تطبيق التغيير.';
    if (outcome === 'verified') return `${base} ✓ تم التحقق من الإعداد الجديد.`;
    return `${base} (تم القبول، لكن هذا الطراز لا يوفّر قراءة الإعداد للتأكيد.)`;
  }

  /* ------------------------------------------------------------------ *
   * Shared helpers
   * ------------------------------------------------------------------ */

  protected candidatePaths(context: AdapterContext, ...keys: string[]): string[] {
    const api = context.signature.api ?? {};
    const working = context.state.workingPaths;
    const paths: string[] = [];
    for (const key of keys) {
      const declared = api[key as keyof typeof api] as string | undefined;
      if (declared) paths.push(this.fillTemplate(declared, context, {}));
      const discovered = working[key as keyof typeof working] as string | undefined;
      if (discovered) paths.push(discovered);
    }
    return uniq(paths).filter((path) => !path.includes('{'));
  }

  protected async firstSuccessfulGet(
    context: AdapterContext,
    paths: string[],
  ): Promise<{ body: string; contentType: string; url: string }> {
    if (paths.length === 0) throw new RouterError('unsupported-operation', { detail: 'no endpoint candidates' });
    let lastError: unknown;
    for (const path of paths) {
      try {
        const response = await context.session.request({
          url: path,
          method: 'GET',
          timeoutMs: 6000,
          signal: context.signal,
        });
        if (response.status >= 400) {
          lastError = new RouterError('unsupported-operation', { status: response.status, url: response.url });
          continue;
        }
        if (context.session.looksLikeLoginPage(response.body) && response.body.length < 4000) {
          lastError = new RouterError('session-expired', { url: response.url, detail: 'router returned the login page' });
          continue;
        }
        return { body: response.body, contentType: response.headers['content-type'] ?? '', url: response.url };
      } catch (error) {
        lastError = error;
      }
    }
    throw toRouterError(lastError);
  }

  protected parseDevices(body: string, contentType: string): DeviceRecord[] {
    const json = safeJson(body);
    const attempts: DeviceRecord[][] = [];
    if (json) {
      attempts.push(this.parsers.devicesFromJson?.(json) ?? extractDevicesFromJson(json));
      attempts.push(extractDevicesFromJson(json));
    }
    if (this.parsers.devicesFromText) attempts.push(this.parsers.devicesFromText(body));
    if (/xml|text\/html/i.test(contentType) || /<tr|<\?xml|<html/i.test(body.slice(0, 400))) {
      attempts.push(extractDevicesFromTr069(body));
      attempts.push(this.parsers.devicesFromHtml?.(body) ?? extractDevicesFromHtml(body));
    }
    attempts.push(extractDevicesFromTr069(body), extractDevicesFromHtml(body));

    const best = attempts.filter((list) => list.length > 0).sort((a, b) => b.length - a.length)[0] ?? [];
    return dedupeDevices(best);
  }

  /** Wi-Fi survey parsing shared by adapters that expose a neighbor scan. */
  protected parseWifiSurvey(body: string): WifiNeighbor[] {
    const json = safeJson(body);
    if (json) {
      const neighbors = extractNeighborsFromJson(json);
      if (neighbors.length > 0) return neighbors;
    }
    return extractNeighborsFromJson(parseLooseJsonText(body));
  }

  protected parseWifi(body: string, contentType: string): WifiState {
    const json = safeJson(body);
    if (json) {
      const fromJson = extractWifiFromJson(json);
      if (fromJson.bands.length > 0) return fromJson;
    }
    if (/html/i.test(contentType) || /<input|<select|<html/i.test(body.slice(0, 400))) {
      return extractWifiFromHtml(body);
    }
    const fromJson = json ? extractWifiFromJson(json) : { bands: [] };
    return fromHtmlFallback(fromJson, body);
  }

  protected fillTemplate(template: string, context: AdapterContext, params: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
      if (key === 'stok') return context.state.token ?? context.session.transport.cookies?.get('stok') ?? '';
      if (key === 'band') return String(params.band ?? '1');
      return params[key] ?? '';
    });
  }
}

/* ------------------------------------------------------------------ */

/** Operations that share one endpoint with another operation. */
const OPERATION_SIBLINGS: Record<string, string> = {
  'device.unblock': 'device.block',
  'device.clear_limit': 'device.limit_bandwidth',
  'qos.remove_rule': 'qos.set_rule',
  'port_forward.remove': 'port_forward.add',
  'dhcp.set_lease': 'dhcp.set_pool',
  'wan.reconnect': 'router.reboot',
};

const OUTCOME_MESSAGES_AR: Partial<Record<string, string>> = {
  'wifi.set_ssid': 'تم تغيير اسم الشبكة.',
  'wifi.set_password': 'تم تغيير كلمة مرور الواي فاي.',
  'wifi.set_channel': 'تم تغيير القناة.',
  'wifi.set_security': 'تم تغيير نوع التشفير.',
  'wifi.set_band_enabled': 'تم تحديث حالة الشبكة.',
  'wifi.set_guest_network': 'تم تحديث شبكة الزوار.',
  'device.block': 'تم إيقاف الإنترنت عن الجهاز.',
  'device.unblock': 'تم استئناف الإنترنت للجهاز.',
  'device.rename': 'تم تغيير اسم الجهاز.',
  'device.limit_bandwidth': 'تم تحديد سرعة الجهاز.',
  'device.clear_limit': 'تم إلغاء تحديد السرعة.',
  'dns.set': 'تم تحديث إعدادات DNS.',
  'dhcp.set_pool': 'تم تحديث نطاق DHCP.',
  'dhcp.set_lease': 'تم تحديث مدة الإيجار.',
  'qos.set_rule': 'تم تطبيق قاعدة جودة الخدمة.',
  'qos.remove_rule': 'تم حذف قاعدة جودة الخدمة.',
  'firewall.set_level': 'تم تحديث مستوى الجدار الناري.',
  'port_forward.add': 'تمت إضافة قاعدة تحويل المنفذ.',
  'port_forward.remove': 'تم حذف قاعدة تحويل المنفذ.',
  'router.reboot': 'تم إرسال أمر إعادة التشغيل.',
  'router.backup': 'تم إنشاء نسخة احتياطية.',
  'router.restore': 'تم إرسال ملف الاستعادة.',
  'wan.set_mtu': 'تم تحديث قيمة MTU.',
  'wan.reconnect': 'تم طلب إعادة الاتصال بالإنترنت.',
};

function dedupeDevices(devices: DeviceRecord[]): DeviceRecord[] {
  const map = new Map<string, DeviceRecord>();
  for (const device of devices) {
    if (!device.mac) continue;
    const existing = map.get(device.mac);
    if (!existing) map.set(device.mac, device);
    else {
      map.set(device.mac, {
        ...existing,
        ...Object.fromEntries(Object.entries(device).filter(([, value]) => value !== undefined && value !== '' && value !== null)),
        raw: { ...(existing.raw ?? {}), ...(device.raw ?? {}) },
      } as DeviceRecord);
    }
  }
  return [...map.values()];
}

function fromHtmlFallback(state: WifiState, body: string): WifiState {
  if (state.bands.length > 0) return state;
  return extractWifiFromHtml(body);
}

function parseLooseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^[^[{]*/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function safeJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return '';
  }
}

function coerceJson(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/** Remove anything secret before a request body reaches diagnostics. */
function sanitizeBody(body: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    out[key] = /pass|pwd|psk|key|token|secret/i.test(key) ? '«redacted»' : value;
  }
  return out;
}
