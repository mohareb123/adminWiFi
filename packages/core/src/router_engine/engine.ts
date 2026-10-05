/**
 * UniversalRouterEngine (spec §1/§51).
 *
 * The single orchestrator the UI talks to:
 *
 *   discover → fingerprint → detect capabilities → select adapter →
 *   authenticate → operate → verify → (self-learn)
 *
 * Everything long-running is awaited asynchronously and reported through typed
 * events, so the UI thread never blocks (spec §27/§28).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { createLogger, type LogEntry } from '../core/logger';
import type { HttpTransport } from '../core/http';
import { HttpSession } from '../core/http';
import { RouterError, toRouterError } from '../core/errors';
import { confirmationFor, createNotification, type AppNotification } from '../core/notifications';
import { TypedEmitter, randomId, uniq } from '../core/util';
import type {
  AdapterInfo,
  CapabilityId,
  CapabilityReport,
  DetectedService,
  DeviceRecord,
  DiscoveryReport,
  FingerprintReport,
  LanState,
  OperationRequest,
  OperationResult,
  RouterCredentials,
  RouterSessionInfo,
  RouterTarget,
  SpeedTestResult,
  WanState,
  WifiNeighbor,
  WifiState,
  NetworkSnapshot,
} from '../core/types';
import { RouterDiscovery, type DiscoveryProgress } from './discovery';
import { RouterFingerprintEngine } from '../fingerprinting/engine';
import { CapabilityDetector, isSupported } from '../capabilities/detector';
import { AdapterRegistry, createDefaultRegistry } from '../adapters/registry';
import { emptyAdapterState, type AdapterContext, type RouterAdapter } from '../adapters/types';
import { RouterSignatures } from '../signatures';
import type { LearningStore } from '../storage/learning';

export type EnginePhase =
  | 'idle'
  | 'discovering'
  | 'fingerprinting'
  | 'capabilities'
  | 'authenticating'
  | 'ready'
  | 'error'
  | 'offline';

export interface PhaseEvent {
  phase: EnginePhase;
  /** i18n key — the UI shows Arabic copy (spec §34). */
  messageKey: string;
  detail?: string;
}

export interface EngineEvents {
  phase: PhaseEvent;
  /** Bounded progress reporting for the loading experience (spec §34). */
  progress: { phase: string; messageKey: string; done: number; total: number; found?: string };
  notification: AppNotification;
  log: LogEntry;
  status: { online: boolean; latencyMs?: number };
  snapshot: NetworkSnapshot;
}

export interface EngineOptions {
  transport: HttpTransport;
  signatures?: RouterSignatures;
  registry?: AdapterRegistry;
  learner?: LearningStore;
  /** Gateways + gateway MAC from the host platform. */
  gatewayProvider?: () => Promise<{ gateways: string[]; mac?: string }>;
  /** Optional LAN service detector (bridge: TCP/SSDP probes). */
  serviceDetector?: (host: string, signal?: AbortSignal) => Promise<DetectedService[]>;
  /** UPnP description provider (bridge). */
  upnpProvider?: () => Promise<import('../core/types').UpnpInfo | undefined>;
  /** Speed-test backend (bridge does it server-side; web uses a simulation). */
  speedTestBackend?: (options: { signal?: AbortSignal; onSample?: (phase: 'ping' | 'down' | 'up', value: number) => void }) => Promise<SpeedTestResult>;
  gatewayMac?: string;
  logLevel?: import('../core/logger').LogLevel;
}

export interface DiscoverOptions {
  extraHosts?: string[];
  scanCommonGateways?: boolean;
  scanAdminPorts?: boolean;
  signal?: AbortSignal;
}

export interface ConnectOptions {
  credentials?: RouterCredentials;
  /** Known router (multi-router support); skips re-discovery when possible. */
  target?: Partial<RouterTarget> & { host: string };
  discovery?: DiscoveryReport;
  /** Reuse a previously persisted session token instead of logging in again. */
  sessionToken?: string;
  signal?: AbortSignal;
  /** Skip the capability probe pass (faster reconnect). */
  fast?: boolean;
}

export interface ConnectResult {
  session: RouterSessionInfo;
  discovery: DiscoveryReport;
  /** True when credentials were accepted. */
  authenticated: boolean;
  loginDetail?: string;
  reason?: string;
}

export class UniversalRouterEngine extends TypedEmitter<EngineEvents> {
  readonly signatures: RouterSignatures;
  readonly registry: AdapterRegistry;
  readonly logger = createLogger('engine');

  private transport: HttpTransport;
  private learner?: LearningStore;
  private phase: EnginePhase = 'idle';
  private session?: RouterSessionInfo;
  private adapter?: RouterAdapter;
  private adapterContext?: AdapterContext;
  private httpSession?: HttpSession;
  private lastDiscovery?: DiscoveryReport;
  private devices: DeviceRecord[] = [];

  constructor(private readonly options: EngineOptions) {
    super();
    this.transport = options.transport;
    this.signatures = options.signatures ?? new RouterSignatures();
    this.registry = options.registry ?? createDefaultRegistry();
    this.learner = options.learner;
    if (options.logLevel) this.logger.setLevel(options.logLevel);
  }

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */

  get currentPhase(): EnginePhase {
    return this.phase;
  }

  get isReady(): boolean {
    return this.phase === 'ready' && Boolean(this.session);
  }

  get currentSession(): RouterSessionInfo | undefined {
    return this.session;
  }

  get currentAdapter(): AdapterInfo | undefined {
    return this.adapter?.info;
  }

  get capabilityReport(): CapabilityReport | undefined {
    return this.session?.capabilities;
  }

  get knownDevices(): DeviceRecord[] {
    return this.devices;
  }

  /** Swap the transport (e.g. bridge appears/disappears). */
  setTransport(transport: HttpTransport): void {
    this.transport = transport;
    this.transport.capabilities satisfies typeof transport.capabilities;
  }

  get transportCapabilities() {
    return this.transport.capabilities;
  }

  setLearner(learner: LearningStore | undefined): void {
    this.learner = learner;
  }

  /* ------------------------------------------------------------------ *
   * Discovery
   * ------------------------------------------------------------------ */

  async discover(options: DiscoverOptions = {}): Promise<DiscoveryReport> {
    this.setPhase('discovering', 'phase.discovering');
    const gateways = await this.loadGateways();
    const discovery = new RouterDiscovery({
      transport: this.transport,
      gatewayCandidates: gateways.gateways,
      extraHosts: options.extraHosts,
      scanCommonGateways: options.scanCommonGateways,
      scanAdminPorts: options.scanAdminPorts,
      serviceDetector: this.options.serviceDetector,
      signal: options.signal,
      onProgress: (progress: DiscoveryProgress) =>
        this.emit('progress', { ...progress, phase: progress.phase as string }),
    });
    const report = await discovery.discover();
    this.options.gatewayMac = report.interfaces.find((entry) => entry.host === report.best?.host)?.host ?? this.options.gatewayMac;
    this.lastDiscovery = report;
    if (report.empty) this.setPhase('idle', 'phase.noRouterFound', report.notes.join(' '));
    return report;
  }

  private async loadGateways(): Promise<{ gateways: string[]; mac?: string }> {
    if (!this.options.gatewayProvider) return { gateways: [], mac: this.options.gatewayMac };
    try {
      const result = await this.options.gatewayProvider();
      return { gateways: uniq(result.gateways), mac: result.mac ?? this.options.gatewayMac };
    } catch (error) {
      this.logger.warn('gateway provider failed', { message: (error as Error).message });
      return { gateways: [], mac: this.options.gatewayMac };
    }
  }

  /* ------------------------------------------------------------------ *
   * Fingerprint
   * ------------------------------------------------------------------ */

  async fingerprint(interfaceUrl: string, options: { signal?: AbortSignal; gatewayMac?: string } = {}): Promise<FingerprintReport> {
    this.setPhase('fingerprinting', 'phase.fingerprinting');
    const session = new HttpSession({ transport: this.transport, baseUrl: interfaceUrl, timeoutMs: 5000, signal: options.signal });
    const engine = new RouterFingerprintEngine({
      session,
      signatures: this.signatures,
      gatewayIp: new URL(interfaceUrl).hostname,
      gatewayMac: options.gatewayMac ?? this.options.gatewayMac,
      upnpProvider: this.options.upnpProvider,
      signal: options.signal,
    });
    const report = await engine.run();
    this.logger.info('fingerprint', {
      vendor: report.identity.vendor,
      model: report.identity.model,
      confidence: report.confidence,
      quality: report.quality,
      adapter: report.recommendedAdapterId,
    });
    return report;
  }

  /* ------------------------------------------------------------------ *
   * Connect
   * ------------------------------------------------------------------ */

  async connect(options: ConnectOptions = {}): Promise<ConnectResult> {
    const target = options.target;
    const discovery =
      options.discovery ??
      (target
        ? await this.discover({ extraHosts: [target.host], scanCommonGateways: false, scanAdminPorts: true, signal: options.signal })
        : await this.discover({ signal: options.signal }));

    const bestInterface =
      discovery.interfaces.find((entry) => entry.reachable && target && entry.host === target.host) ??
      discovery.best;
    if (!bestInterface) {
      const error = new RouterError('network-unreachable', { detail: 'no management interface discovered' });
      this.setPhase('error', 'phase.noRouterFound');
      this.emit('notification', createNotification({ severity: 'critical', code: 'no-router', title: 'لم يتم العثور على الراوتر', body: error.userMessage }));
      throw error;
    }
    this.lastDiscovery = discovery;

    const baseUrl = bestInterface.baseUrl;
    const fingerprint = await this.fingerprint(baseUrl, {
      signal: options.signal,
      gatewayMac: this.options.gatewayMac,
    });

    const { adapter, fallbackUsed, reason } = this.registry.resolve(fingerprint);
    this.adapter = adapter;

    const httpSession = new HttpSession({ transport: this.transport, baseUrl, timeoutMs: 6000, signal: options.signal });
    this.httpSession = httpSession;

    const signature = fingerprint.useGenericAdapter ? this.signatures.generic : this.signatures.get(fingerprint.candidates[0]?.signatureId ?? '') ?? this.signatures.generic;

    // Capabilities are detected *before* login only from the signature; the
    // authenticated pass runs after a successful login (spec §7).
    this.setPhase('capabilities', 'phase.capabilities');
    const baseCapabilities = await new CapabilityDetector().detect({
      session: httpSession,
      signature,
      skipProbes: true,
      signal: options.signal,
    });

    const context: AdapterContext = {
      session: httpSession,
      identity: fingerprint.identity,
      fingerprint,
      signature,
      capabilities: baseCapabilities,
      credentials: options.credentials,
      logger: this.logger.child(adapter.info.id),
      state: emptyAdapterState(),
      signal: options.signal,
      learn: (outcome) => {
        void this.learner?.recordOutcome(fingerprint, outcome.operationId as never, outcome.ok, outcome.verified, outcome.reason);
      },
    };
    this.adapterContext = context;
    context.state.loginRecipe = await adapter.discoverLoginRecipe(context);

    let authenticated = false;
    let loginDetail: string | undefined;
    let reasonText: string | undefined;

    if (options.credentials?.username || options.credentials?.password) {
      this.setPhase('authenticating', 'phase.authenticating');
      const result = await adapter.authenticate(context, options.credentials);
      authenticated = result.ok;
      loginDetail = result.detail;
      reasonText = result.reason;
      if (!result.ok) {
        this.setPhase('error', 'phase.authFailed', result.detail);
        const code = result.reason === 'auth-failed' ? 'auth-failed' : result.reason === 'captcha' ? 'captcha-required' : 'network-unreachable';
        const error = new RouterError(code, { detail: result.detail });
        this.emit('notification', createNotification({ severity: 'warning', code: 'auth-failed', title: error.userMessage, body: error.userHint }));
        throw error;
      }
    } else if (options.sessionToken) {
      context.state.token = options.sessionToken;
      context.state.authenticated = true;
      authenticated = true;
      loginDetail = 'reused stored session token';
    }

    // Authenticated capability pass (bounded, polite probing).
    let capabilities = baseCapabilities;
    if (authenticated && !options.fast) {
      this.setPhase('capabilities', 'phase.capabilities', 'verifying which features this router exposes');
      capabilities = await new CapabilityDetector().detect({
        session: httpSession,
        signature,
        signal: options.signal,
        onProgress: (done, total) => this.emit('progress', { phase: 'capabilities', messageKey: 'phase.capabilities', done, total }),
      });
    }
    context.capabilities = capabilities;

    const sessionInfo: RouterSessionInfo = {
      sessionId: randomId('s'),
      target: {
        id: target?.id ?? randomId('r'),
        label: target?.label ?? bestInterface.title ?? `${fingerprint.identity.vendor} ${fingerprint.identity.model}`.trim(),
        host: bestInterface.host,
        scheme: bestInterface.scheme,
        port: bestInterface.port,
        credentialRef: target?.credentialRef,
      },
      identity: fingerprint.identity,
      fingerprint,
      adapter: { ...adapter.info, signatureId: signature.id, notes: [...(adapter.info.notes ?? []), fallbackUsed ? `fallback: ${reason}` : `selection: ${reason}`] },
      capabilities,
      loginRecipe: context.state.loginRecipe ?? { kind: 'form-session', loginUrl: '/' },
      authenticatedAt: new Date().toISOString(),
    };
    this.session = sessionInfo;

    if (this.learner) {
      try {
        await this.learner.observeFingerprint(fingerprint, adapter.info.id);
      } catch (error) {
        this.logger.debug('learning store unavailable', { message: (error as Error).message });
      }
    }

    this.setPhase('ready', 'phase.ready');
    return { session: sessionInfo, discovery, authenticated, loginDetail, reason: reasonText };
  }

  /* ------------------------------------------------------------------ *
   * Data access
   * ------------------------------------------------------------------ */

  requireContext(): AdapterContext {
    if (!this.adapterContext || !this.adapter) throw new RouterError('not-authenticated');
    return this.adapterContext;
  }

  async getSnapshot(options: { includeDevices?: boolean; signal?: AbortSignal } = {}): Promise<NetworkSnapshot> {
    const context = this.requireContext();
    const [devices, wifi, wan, lan] = await Promise.all([
      options.includeDevices === false
        ? Promise.resolve(this.devices)
        : safe(() => this.adapter!.getDevices?.(context) ?? Promise.resolve([]), [] as DeviceRecord[]),
      safe(() => this.adapter!.getWifiState?.(context) ?? Promise.resolve({ bands: [] }), { bands: [] } as WifiState),
      safe(() => this.adapter!.getWanState?.(context) ?? Promise.resolve({ dns: [] }), { dns: [] } as WanState),
      safe(
        () => this.adapter!.getLanState?.(context) ?? Promise.resolve({ ip: '', netmask: '', dhcpEnabled: false }),
        { ip: '', netmask: '', dhcpEnabled: false } as LanState,
      ),
    ]);
    this.devices = devices;

    const snapshot: NetworkSnapshot = {
      takenAt: new Date().toISOString(),
      internet: {
        connected: Boolean(wan.ip || wan.status === 'connected' || devices.length > 0),
        latencyMs: wan.status ? undefined : undefined,
      },
      wifi,
      wan,
      lan,
      devices,
      counts: {
        devices: devices.length,
        online: devices.filter((device) => !device.blocked).length,
        blocked: devices.filter((device) => device.blocked).length,
        wifi: devices.filter((device) => device.connection.startsWith('wifi')).length,
        ethernet: devices.filter((device) => device.connection === 'ethernet').length,
      },
      diagnostics: {
        adapter: this.adapter?.info.id,
        signature: this.session?.adapter.signatureId,
        fingerprintConfidence: this.session?.fingerprint.confidence,
        transportRequests: this.transport.stats?.requests,
      },
    };
    this.emit('snapshot', snapshot);
    return snapshot;
  }

  async scanWifiNeighbors(): Promise<WifiNeighbor[]> {
    const context = this.requireContext();
    if (!this.adapter?.scanWifiNeighbors) throw new RouterError('unsupported-operation');
    return this.adapter.scanWifiNeighbors(context);
  }

  async getBandwidthSample() {
    const context = this.requireContext();
    if (!this.adapter?.getBandwidthSample) throw new RouterError('unsupported-operation');
    return this.adapter.getBandwidthSample(context);
  }

  /** Advanced Mode → raw adapter/diagnostic payload. */
  async getAdvancedData(kind: string): Promise<unknown> {
    const context = this.requireContext();
    if (!this.adapter?.getAdvancedData) throw new RouterError('unsupported-operation');
    return this.adapter.getAdvancedData(context, kind);
  }

  /**
   * Capability check that also honours what actually happened at runtime:
   * a signature may declare a feature, but a 404 during use means this
   * firmware build does not really have it (spec §7/§45).
   */
  supports(id: CapabilityId): boolean {
    const observed = this.adapterContext?.state.observed[id as string];
    if (observed === false) return false;
    if (observed === true) return true;
    return isSupported(this.session?.capabilities, id);
  }

  /** Full capability picture including runtime observations (Advanced Mode). */
  capabilitySummary(): Array<{ id: CapabilityId; supported: string; source: string; reason: string }> {
    const states = this.session?.capabilities.states ?? [];
    return states.map((state) => {
      const observed = this.adapterContext?.state.observed[state.id as string];
      if (observed === false && state.supported !== 'no') {
        return { id: state.id, supported: 'no', source: 'observed', reason: 'device-returned-404-during-use' };
      }
      if (observed === true) return { id: state.id, supported: 'yes', source: 'observed', reason: 'confirmed-during-use' };
      return { id: state.id, supported: state.supported, source: state.source, reason: state.reason };
    });
  }

  /* ------------------------------------------------------------------ *
   * Operations
   * ------------------------------------------------------------------ */

  /** Sensitive-operation gate (spec §46/§47) — returns the dialog copy. */
  confirmationFor(operationId: string, body: string) {
    return confirmationFor(operationId, body);
  }

  async execute(request: OperationRequest): Promise<OperationResult> {
    const context = this.requireContext();
    if (!this.adapter) throw new RouterError('adapter-missing');
    if (!context.state.authenticated) {
      return {
        operationId: request.id,
        ok: false,
        verified: false,
        appliedAt: new Date().toISOString(),
        durationMs: 0,
        message: 'يجب تسجيل الدخول للراوتر أولًا.',
        messageEn: 'Login is required before applying changes.',
        reason: 'not-authenticated',
      };
    }

    const result = await this.adapter.execute(context, request);

    if (result.ok) {
      // Refresh the cached device list so the UI never shows stale state.
      void this.refreshDevicesAfterOperation(request);
    }
    return result;
  }

  private async refreshDevicesAfterOperation(request: OperationRequest): Promise<void> {
    const deviceOperations = new Set([
      'device.block',
      'device.unblock',
      'device.rename',
      'device.limit_bandwidth',
      'device.clear_limit',
    ]);
    if (!deviceOperations.has(request.id)) return;
    try {
      await this.getSnapshot({ includeDevices: true });
    } catch {
      /* the snapshot refresh is best-effort */
    }
  }

  /** Reboot with real verification (spec §26). */
  async reboot(options: { signal?: AbortSignal } = {}): Promise<OperationResult> {
    const context = this.requireContext();
    this.emit('notification', createNotification({ severity: 'info', code: 'reboot', title: '♻️ جاري إعادة تشغيل الراوتر', body: 'سيتم قطع الاتصال مؤقتًا.' }));
    const result = await this.execute({ id: 'router.reboot', params: {}, confirmed: true });
    if (result.ok && this.httpSession) {
      const { VerificationEngine } = await import('../verification/engine');
      const verification = await VerificationEngine.verifyReboot(this.httpSession, { signal: options.signal });
      return {
        ...result,
        verified: verification.outcome === 'verified',
        verification,
        message:
          verification.outcome === 'verified'
            ? 'تمت إعادة تشغيل الراوتر والتحقق من عودته للعمل ✓'
            : `${result.message} (لم نتمكن من تأكيد عودة الراوتر للعمل — راجع الاتصال.)`,
      };
    }
    return result;
  }

  async speedTest(options: {
    signal?: AbortSignal;
    onSample?: (phase: 'ping' | 'down' | 'up', value: number) => void;
    /** Phase transitions drive the UI animation (PING → DOWNLOAD → UPLOAD). */
    onPhase?: (phase: 'ping' | 'down' | 'up' | 'done') => void;
  } = {}): Promise<SpeedTestResult> {
    if (!this.options.speedTestBackend) throw new RouterError('unsupported-operation', { detail: 'no speed-test backend' });
    return this.options.speedTestBackend(options);
  }

  async logout(): Promise<void> {
    if (this.adapter && this.adapterContext) {
      try {
        await this.adapter.logout?.(this.adapterContext);
      } catch {
        /* best effort */
      }
    }
    this.transport.cookies?.clear();
    this.session = undefined;
    this.adapter = undefined;
    this.adapterContext = undefined;
    this.httpSession = undefined;
    this.devices = [];
    this.setPhase('idle', 'phase.idle');
  }

  /* ------------------------------------------------------------------ *
   * Diagnostics
   * ------------------------------------------------------------------ */

  diagnostics(): Record<string, unknown> {
    return {
      phase: this.phase,
      transport: this.transport.capabilities,
      transportStats: this.transport.stats,
      signatureDatabase: this.signatures.meta,
      discovery: this.lastDiscovery
        ? {
            best: this.lastDiscovery.best?.baseUrl,
            candidates: this.lastDiscovery.interfaces.map((entry) => ({
              url: entry.baseUrl,
              status: entry.status,
              title: entry.title,
              server: entry.server,
              latencyMs: entry.latencyMs,
            })),
            durationMs: this.lastDiscovery.durationMs,
            notes: this.lastDiscovery.notes,
          }
        : undefined,
      fingerprint: this.session
        ? {
            identity: this.session.identity,
            quality: this.session.fingerprint.quality,
            confidence: this.session.fingerprint.confidence,
            candidates: this.session.fingerprint.candidates.map((candidate) => ({
              id: candidate.signatureId,
              confidence: candidate.confidence,
              vendor: candidate.vendor,
            })),
            evidence: this.session.fingerprint.evidence,
            advisories: this.session.fingerprint.advisories,
          }
        : undefined,
      adapter: this.adapter
        ? { ...this.adapter.info, state: { ...this.adapterContext?.state, token: this.adapterContext?.state.token ? '«redacted»' : undefined } }
        : undefined,
      capabilities: this.session?.capabilities,
      cookies: this.transport.cookies?.snapshot(),
      logs: this.logger.snapshot('debug').slice(-120),
    };
  }

  /* ------------------------------------------------------------------ */

  private setPhase(phase: EnginePhase, messageKey: string, detail?: string): void {
    this.phase = phase;
    this.emit('phase', { phase, messageKey, detail });
  }
}

/* ------------------------------------------------------------------ */

async function safe<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

export { toRouterError };
