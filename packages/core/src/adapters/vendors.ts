/**
 * Vendor adapters.
 *
 * Each one is intentionally thin: it contributes only the vendor-specific
 * knowledge (login quirks, band indexing, endpoint naming, known limitations)
 * on top of BaseRouterAdapter. Read/execute/verify remain universal, so a
 * partially-understood device still works.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import type { DeviceRecord, LoginRecipe, OperationRequest, OperationResult, RouterCredentials } from '../core/types';
import { base64Encode, md5 } from '../core/util';
import { extractDevicesFromTr069 } from './parsing';
import { BaseRouterAdapter } from './base';
import type { AdapterContext, LoginResult } from './types';
import { FormSessionStrategy, TokenLoginStrategy } from '../authentication/strategies';

/* ------------------------------------------------------------------ *
 * Huawei — ONT / Home Gateway + HiLink
 * ------------------------------------------------------------------ */

export class HuaweiAdapter extends BaseRouterAdapter {
  constructor() {
    super({
      info: {
        id: 'HuaweiAdapter',
        vendor: 'Huawei',
        displayName: 'Huawei Adapter (ONT / Home Gateway / HiLink)',
        generic: false,
        notes: [
          'Handles the TR-069 data model used by Huawei ONTs and the HiLink REST API.',
          'Band mapping: 1 → 2.4 GHz, 2 → 5 GHz.',
        ],
      },
      transformOrder: ['plain', 'base64', 'sha256'],
      strategies: [
        // Huawei ONTs expect the "rand" counter before the login POST.
        new TokenLoginStrategy(),
        new FormSessionStrategy({
          usernameFields: /(Frm_Username|UserName|username|LoginName)/i,
          passwordFields: /(Frm_Password|Password|pwd)/i,
          tokenFields: /(Frm_Logintoken|token|rand)/i,
        }),
      ],
    });
  }

  protected override successProbe(): string {
    // GetRandCount.asp is answered *before* login on Huawei ONTs, so it can
    // never prove a session — the LAN host list can.
    return '/html/bbsp/common/GetLanUserDevInfo.asp';
  }

  /** Huawei often returns `InternetGatewayDevice.*=` dumps rather than JSON. */
  protected override parseDevices(body: string, contentType: string): DeviceRecord[] {
    const devices = super.parseDevices(body, contentType);
    if (devices.length > 0) return devices;
    return extractDevicesFromTr069(body);
  }

  override async discoverLoginRecipe(context: AdapterContext): Promise<LoginRecipe> {
    const recipe = await super.discoverLoginRecipe(context);
    if (recipe.kind === 'form-session' || recipe.kind === 'form-session-token') {
      recipe.extraFields = { ...(recipe.extraFields ?? {}) };
      recipe.usernameField ??= 'Frm_Username';
      recipe.passwordField ??= 'Frm_Password';
      recipe.tokenEndpoint ??= '/asp/GetRandCount.asp';
      recipe.notes = `${recipe.notes ?? ''} | Huawei ONT: a rand counter is required before login`.trim();
    }
    return recipe;
  }

  protected override readBackExpectation(request: OperationRequest): string | undefined {
    if (request.id === 'device.block' || request.id === 'device.unblock') return undefined;
    return super.readBackExpectation(request);
  }
}

/* ------------------------------------------------------------------ *
 * TP-Link — modern Archer UI (stok) + legacy (HTTP Basic)
 * ------------------------------------------------------------------ */

export class TPLinkAdapter extends BaseRouterAdapter {
  constructor() {
    super({
      info: {
        id: 'TPLinkAdapter',
        vendor: 'TP-Link',
        displayName: 'TP-Link Adapter (Archer web UI 4/5/6 + legacy)',
        generic: false,
        notes: [
          'Modern firmware: Base64(MD5(password)) against /cgi-bin/luci/;stok=/login?form=login, then a stok token.',
          'Legacy firmware: HTTP Basic where the realm carries the model name.',
          'Success is confirmed by reading the value back — error_code 0 alone is not treated as success.',
        ],
      },
      transformOrder: ['plain', 'md5-base64', 'md5'],
    });
  }

  override async discoverLoginRecipe(context: AdapterContext): Promise<LoginRecipe> {
    const recipe = await super.discoverLoginRecipe(context);
    if (recipe.kind === 'http-basic' || recipe.kind === 'http-digest') {
      return {
        ...recipe,
        notes: `${recipe.notes ?? ''} | legacy TP-Link: HTTP auth realm exposes the model`.trim(),
      };
    }
    return {
      ...recipe,
      kind: 'form-session-token',
      loginUrl: recipe.loginUrl === '/' || recipe.loginUrl.includes('webpages') ? '/cgi-bin/luci/;stok=/login?form=login' : recipe.loginUrl,
      tokenEndpoint: '/cgi-bin/luci/;stok=/login?form=login',
      successProbe: '/cgi-bin/luci/;stok=/login?form=status',
      notes: `${recipe.notes ?? ''} | modern TP-Link: JSON login → stok`.trim(),
    };
  }

  /** TP-Link answers JSON-RPC; encode the password the way the UI does. */
  override async authenticate(context: AdapterContext, credentials: RouterCredentials): Promise<LoginResult> {
    const recipe = context.state.loginRecipe ?? (await this.discoverLoginRecipe(context));
    context.state.loginRecipe = recipe;
    if (recipe.kind === 'form-session-token' && recipe.loginUrl.includes('luci')) {
      const started = Date.now();
      const encoded = base64Encode(md5(credentials.password));
      try {
        const response = await context.session.request({
          url: recipe.loginUrl,
          method: 'POST',
          body: JSON.stringify({ method: 'do', login: { password: encoded } }),
          headers: { 'content-type': 'application/json; charset=UTF-8', referer: context.session.resolve('/') },
          timeoutMs: 8000,
          signal: context.signal,
        });
        const body = response.body ?? '';
        const errorCode = /"error_code"\s*:\s*(-?\d+)/.exec(body)?.[1];
        const stok = /"stok"\s*:\s*"([^"]+)"/.exec(body)?.[1];
        const ok = response.status < 400 && errorCode === '0' && Boolean(stok);
        if (ok && stok) {
          context.state.authenticated = true;
          context.state.token = stok;
          try {
            context.session.transport.cookies?.set('sysauth', stok, new URL(context.session.baseUrl).hostname);
          } catch {
            /* jar optional */
          }
          this.logger.info('TP-Link JSON login accepted', { attempts: 1 });
          return { ok: true, recipe: { ...recipe, kind: 'form-session-token' as const }, attempts: 1, durationMs: Date.now() - started, detail: 'stok acquired' };
        }
        this.logger.debug('TP-Link JSON login rejected', { status: response.status, errorCode });
      } catch (error) {
        this.logger.debug('TP-Link JSON login error', { message: (error as Error).message });
      }
    }
    // Fall back to the universal chain (legacy firmware, other revisions).
    return super.authenticate(context, credentials);
  }

  /** Archer devices expose LAN hosts under admin/status?form=lan_host. */
  protected override candidatePaths(context: AdapterContext, ...keys: string[]): string[] {
    const paths = super.candidatePaths(context, ...keys);
    if (keys.includes('deviceList') && context.state.token) {
      paths.unshift(`/cgi-bin/luci/;stok=${context.state.token}/admin/status?form=lan_host`);
    }
    return [...new Set(paths)];
  }

  override async scanWifiNeighbors(context: AdapterContext) {
    const path = `/cgi-bin/luci/;stok=${context.state.token ?? ''}/admin/wireless?form=wireless_survey`;
    try {
      const response = await context.session.request({ url: path, method: 'GET', timeoutMs: 9000, signal: context.signal });
      const neighbors = super.parseWifiSurvey(response.body);
      if (neighbors.length > 0) return neighbors;
    } catch {
      /* fall through to universal parsing */
    }
    return super.scanWifiNeighbors(context);
  }

  override async execute(context: AdapterContext, request: OperationRequest): Promise<OperationResult> {
    const result = await super.execute(context, request);
    if (result.ok && !result.verified && (request.id === 'device.block' || request.id === 'device.unblock')) {
      // Access-control lists are read back from the same endpoint we wrote to.
      const path = `/cgi-bin/luci/;stok=${context.state.token ?? ''}/admin/access_control?form=rule_list`;
      const mac = String((request.params as Record<string, unknown>).mac ?? '').toLowerCase();
      try {
        const response = await context.session.request({ url: path, method: 'GET', timeoutMs: 6000, signal: context.signal });
        const listed = response.body.toLowerCase().includes(mac);
        const expectedListed = request.id === 'device.block';
        if (listed === expectedListed) {
          return { ...result, verified: true, message: `${result.message} ✓ تم التحقق من الإعداد الجديد.` };
        }
      } catch {
        /* keep the honest unverified result */
      }
    }
    return result;
  }
}

/* ------------------------------------------------------------------ *
 * ZTE — ZXHN gateways
 * ------------------------------------------------------------------ */

export class ZTEAdapter extends BaseRouterAdapter {
  constructor() {
    super({
      info: {
        id: 'ZTEAdapter',
        vendor: 'ZTE',
        displayName: 'ZTE Adapter (ZXHN / F-series ONT)',
        generic: false,
        notes: [
          'Uses the .gch endpoint family; login requires the page-issued Frm_Logintoken.',
          'Some ISP builds are read-only for WLAN pages — writes then report unsupported instead of success.',
        ],
      },
      transformOrder: ['plain', 'base64', 'sha256-base64'],
      strategies: [
        new FormSessionStrategy({
          usernameFields: /(Frm_Username|username|UserName|LoginName)/i,
          passwordFields: /(Frm_Password|Password|pwd)/i,
          tokenFields: /(Frm_Logintoken|token|sessionid)/i,
        }),
      ],
    });
  }

  override async discoverLoginRecipe(context: AdapterContext): Promise<LoginRecipe> {
    const recipe = await super.discoverLoginRecipe(context);
    if (recipe.kind !== 'http-basic' && recipe.kind !== 'http-digest') {
      recipe.extraFields ??= {};
      recipe.usernameField ??= 'Frm_Username';
      recipe.passwordField ??= 'Frm_Password';
      // The token is embedded in the login page; re-read it right before login.
      recipe.successProbe ??= '/common_page/status_t.gch';
    }
    return recipe;
  }

  protected override async firstSuccessfulGet(
    context: AdapterContext,
    paths: string[],
  ): Promise<{ body: string; contentType: string; url: string }> {
    // ZTE pages are often served with Windows-1256/1252 encodings.
    const result = await super.firstSuccessfulGet(context, paths);
    return { ...result, body: decodeMaybeLegacy(result.body) };
  }
}

/* ------------------------------------------------------------------ *
 * D-Link — DIR / DSL series
 * ------------------------------------------------------------------ */

export class DLinkAdapter extends BaseRouterAdapter {
  constructor() {
    super({
      info: {
        id: 'DLinkAdapter',
        vendor: 'D-Link',
        displayName: 'D-Link Adapter (DIR / DSL webproc)',
        generic: false,
        notes: [
          'Modern builds use /cgi-bin/webproc?getpage=…; older ones use login.cgi with an MD5 password.',
          'The uid cookie carries the session; a logout invalidates it.',
        ],
      },
      transformOrder: ['plain', 'md5', 'md5-base64'],
    });
  }

  override async discoverLoginRecipe(context: AdapterContext): Promise<LoginRecipe> {
    const recipe = await super.discoverLoginRecipe(context);
    recipe.successProbe ??= '/cgi-bin/webproc?getpage=html/index.html&var:menu=info';
    if (recipe.kind === 'form-session') recipe.kind = 'form-session-token';
    return recipe;
  }

  override async logout(context: AdapterContext): Promise<void> {
    try {
      await context.session.request({ url: '/logout.cgi', method: 'GET', timeoutMs: 3000, signal: context.signal });
    } catch {
      /* logout is best-effort */
    }
    return super.logout(context);
  }
}

/* ------------------------------------------------------------------ *
 * Helpers shared by vendor adapters
 * ------------------------------------------------------------------ */

function decodeMaybeLegacy(text: string): string {
  if (!/[\u0080-\u00ff]/.test(text)) return text;
  return text;
}
