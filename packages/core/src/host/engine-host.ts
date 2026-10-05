/**
 * EngineHost — owns the single UniversalRouterEngine instance and keeps the
 * UI-visible state coherent (session, snapshot, notifications, monitor samples,
 * learning store, saved routers).
 *
 * This class is *portable*: the only machine-specific things it needs arrive
 * through `HostPlatform` (see ./types.ts). The desktop bridge injects Node
 * services; the Android app injects the WebView/native-shell services. Neither
 * the router logic nor the UI contract changes between the two.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

import { createLogger } from '../core/logger';
import { RouterError, toRouterError } from '../core/errors';
import { createNotification } from '../core/notifications';
import type { AppNotification } from '../core/notifications';
import type {
  AdapterInfo,
  CapabilityId,
  DeviceRecord,
  DiscoveryReport,
  NetworkSnapshot,
  OperationRequest,
  OperationResult,
  RouterCredentials,
  RouterIdentity,
  RouterSessionInfo,
  RouterTarget,
  SpeedTestResult,
  UpnpInfo,
  WifiNeighbor,
} from '../core/types';
import type { DetectedService } from '../core/types';
import type { HttpTransport } from '../core/http';
import type { EnginePhase } from '../router_engine/engine';
import type { SecurityReport } from '../security/center';
import type { SmartFixPlan } from '../smart_fix/engine';
import type { SpeedTestBackend } from '../diagnostics/speedtest';
import type { AssistantReply } from '../smart_fix/assistant';
import { SmartAssistant } from '../smart_fix/assistant';
import { SmartFixEngine } from '../smart_fix/engine';
import { SecurityCenter } from '../security/center';
import { InternetMonitor } from '../diagnostics/monitor';
import { LearningStore } from '../storage/learning';
import { RouterSignatures } from '../signatures/database';
import { SimulatedTransport } from '../simulated/transport';
import { SIMULATED_PROFILES, createProfile } from '../simulated/profiles';
import { createSimulatedSpeedTestBackend } from '../diagnostics/speedtest';
import { UniversalRouterEngine } from '../router_engine/engine';
import type { SavedRouter } from '../storage/types';
import type { HostPlatform, HostSpeedPlan, HostStorage, LatencyProbe } from './types';

const log = createLogger('host.engine');

export type BridgeMode = 'real' | 'simulated';

export interface HostEventMap {
  notification: AppNotification;
  phase: { phase: EnginePhase; messageKey: string; detail?: string };
  progress: { phase: string; messageKey: string; done: number; total: number };
  sample: { latencyMs?: number; downKbps?: number; upKbps?: number; online: boolean };
  state: HostStateSnapshot;
}

export interface HostStateSnapshot {
  mode: BridgeMode;
  profileId?: string;
  connected: boolean;
  phase: EnginePhase;
  host?: string;
  adapter?: string;
  vendor?: string;
  model?: string;
  confidence?: number;
  quality?: string;
  counts?: NetworkSnapshot['counts'];
  updatedAt: number;
}

export interface ConnectRequest {
  host?: string;
  username?: string;
  password?: string;
  remember?: boolean;
  label?: string;
  routerId?: string;
  fast?: boolean;
}

export interface EngineHostOptions {
  platform: HostPlatform;
  persist?: boolean;
  profileId?: string;
  mode?: BridgeMode;
}

export class EngineHost {
  private mode: BridgeMode = 'simulated';
  private profileId = 'huawei-hg8145';
  private engine: UniversalRouterEngine;
  private transport: SimulatedTransport | HttpTransport;
  private signatureDb = new RouterSignatures();
  private storage: HostStorage;
  private learner: LearningStore;
  private monitor?: InternetMonitor;
  private snapshot?: NetworkSnapshot;
  private discovery?: DiscoveryReport;
  private security?: SecurityReport;
  private notifications: AppNotification[] = [];
  private plans = new Map<string, SmartFixPlan>();
  private knownMacs = new Set<string>();
  private listeners = new Set<(event: keyof HostEventMap, payload: unknown) => void>();
  private online = true;
  private lastLatency?: number;
  private currentHost?: string;
  private password?: string;
  private snapshotTimer?: ReturnType<typeof setInterval>;
  private selfUrlBase?: string;

  constructor(private readonly options: EngineHostOptions) {
    if (options.profileId) this.profileId = options.profileId;
    if (options.mode) this.mode = options.mode;
    this.storage = options.platform.createStorage({ persist: options.persist !== false });
    this.learner = new LearningStore({ store: this.storage.store, signatures: this.signatureDb });
    this.transport =
      this.mode === 'simulated' ? this.createSimulatedTransport(this.profileId) : this.options.platform.realTransport();
    this.engine = this.buildEngine();
    void this.learner.load();
  }

  /** Signature database (Advanced Mode → packs, and POST /api/signatures/pack). */
  get signatures(): RouterSignatures {
    return this.signatureDb;
  }

  get platformKind(): string {
    return this.options.platform.kind;
  }

  get platformLabel(): string {
    return this.options.platform.label;
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */

  private createSimulatedTransport(profileId: string): SimulatedTransport {
    return new SimulatedTransport({ profile: createProfile(profileId), networkLatencyMs: 0 });
  }

  private simulated(): SimulatedTransport {
    return this.transport as SimulatedTransport;
  }

  private buildEngine(): UniversalRouterEngine {
    const engine = new UniversalRouterEngine({
      transport: this.transport,
      signatures: this.signatureDb,
      learner: this.learner,
      gatewayProvider: async () => {
        if (this.mode === 'simulated') {
          const state = this.simulated().profile.state();
          return { gateways: [state.lan.ip], mac: state.wan.mac };
        }
        return this.options.platform.gateway();
      },
      serviceDetector: async (host, signal) =>
        this.mode === 'simulated' ? simulatedServices() : this.options.platform.services(host, signal),
      upnpProvider: async () =>
        this.mode === 'simulated' ? undefined : this.options.platform.upnp(this.currentHost),
      // Built per run so mode switches (demo ⇄ real) never need an engine rebuild.
      speedTestBackend: (speedOptions) => this.speedTestBackend()(speedOptions),
    });
    engine.on('phase', (event) => this.emit('phase', event));
    engine.on('progress', (event) =>
      this.emit('progress', { phase: event.phase, messageKey: event.messageKey, done: event.done, total: event.total }),
    );
    engine.on('notification', (notification) => this.pushNotification(notification));
    return engine;
  }

  private selfUrl(): string {
    return this.selfUrlBase ?? this.options.platform.selfUrl() ?? 'http://127.0.0.1:8787';
  }

  /** Set once a socket is bound (the port may be ephemeral). */
  setSelfUrl(url: string): void {
    this.selfUrlBase = url;
  }

  /**
   * Demo mode uses the label-accurate simulated backend (the UI shows the demo
   * badge); real mode measures genuine transfers, with a reachability probe and
   * a hard timeout so the UI can never hang.
   */
  private speedTestBackend(): SpeedTestBackend {
    if (this.mode === 'simulated') {
      const plan = this.speedPlan();
      return createSimulatedSpeedTestBackend({
        downloadMbps: plan.downloadMbps,
        uploadMbps: plan.uploadMbps,
        pingMs: plan.pingMs,
        jitterMs: plan.jitterMs,
        variance: 0.07,
      });
    }
    const session = this.engine.currentSession;
    return this.options.platform.speedTest({
      selfUrl: this.selfUrl(),
      plan: this.speedPlan(),
      sessionBaseUrl: session ? `${session.target.scheme}://${session.target.host}:${session.target.port}` : undefined,
    });
  }

  /** The line plan behind demo mode — surfaced to the UI so it can label it. */
  speedPlan(): HostSpeedPlan {
    if (this.mode !== 'simulated') {
      return {
        simulated: false,
        downloadMbps: 0,
        uploadMbps: 0,
        pingMs: 0,
        bytesPerSecond: 0,
        label: 'Real internet connection',
      };
    }
    const profile = SIMULATED_PROFILES[this.profileId];
    const plan = profile?.speed ?? { downloadMbps: 50, uploadMbps: 10, pingMs: 25, jitterMs: 5 };
    return {
      simulated: true,
      ...plan,
      bytesPerSecond: Math.round(plan.downloadMbps * 125_000),
      label: `${profile?.arLabel ?? this.profileId} — ${plan.downloadMbps} Mbps line`,
    };
  }

  async setMode(mode: BridgeMode, profileId?: string): Promise<HostStateSnapshot> {
    if (mode === this.mode && (!profileId || profileId === this.profileId)) return this.stateSnapshot();
    this.stopMonitor();
    this.mode = mode;
    if (profileId) this.profileId = profileId;
    this.transport = mode === 'simulated' ? this.createSimulatedTransport(this.profileId) : this.options.platform.realTransport();
    this.engine = this.buildEngine();
    this.snapshot = undefined;
    this.discovery = undefined;
    this.security = undefined;
    this.currentHost = undefined;
    this.knownMacs.clear();
    log.info('host mode changed', { mode, profileId: this.profileId });
    const state = this.stateSnapshot();
    this.emit('state', state);
    return state;
  }

  /* ------------------------------------------------------------------ *
   * Discovery + connection
   * ------------------------------------------------------------------ */

  async discover(options: { extraHosts?: string[] } = {}): Promise<DiscoveryReport> {
    this.discovery = await this.engine.discover({
      extraHosts: options.extraHosts,
      scanCommonGateways: true,
      scanAdminPorts: true,
    });
    return this.discovery;
  }

  async connect(request: ConnectRequest): Promise<{
    session: RouterSessionInfo;
    authenticated: boolean;
    detail?: string;
    discovery: DiscoveryReport;
  }> {
    const credentials: RouterCredentials | undefined =
      request.username !== undefined || request.password !== undefined
        ? { username: request.username ?? '', password: request.password ?? '' }
        : undefined;

    const target = request.host
      ? { id: request.routerId ?? `router-${request.host}`, label: request.label ?? request.host, host: request.host }
      : undefined;

    const discovery = await this.discover({ extraHosts: request.host ? [request.host] : undefined });
    const result = await this.engine.connect({
      credentials,
      target,
      discovery,
      fast: request.fast ?? false,
    });

    this.currentHost = result.session.target.host;
    if (credentials) this.password = credentials.password;
    this.startMonitor();

    const identity = result.session.identity;
    await this.storage.routers.upsert({
      target: {
        ...result.session.target,
        credentialRef: request.remember ? result.session.target.id : undefined,
      },
      label: request.label ?? result.session.target.label,
      vendor: identity.vendor,
      model: identity.model,
      adapterId: result.session.adapter.id,
      remember: Boolean(request.remember),
      lastConnectedAt: new Date().toISOString(),
      capabilitiesSummary: Object.fromEntries(
        result.session.capabilities.states.map((state) => [state.id, state.supported]),
      ) as Partial<Record<CapabilityId, 'yes' | 'no' | 'unknown'>>,
      fingerprintSummary: {
        confidence: result.session.fingerprint.confidence,
        quality: result.session.fingerprint.quality,
      },
    });
    if (request.remember && credentials) {
      await this.storage.vault.put(result.session.target.id, credentials);
    }

    await this.refreshSnapshot();
    this.emit('state', this.stateSnapshot());
    return {
      session: result.session,
      authenticated: result.authenticated,
      detail: result.loginDetail,
      discovery: result.discovery,
    };
  }

  async connectSaved(routerId: string, fast = true): Promise<{ session: RouterSessionInfo; authenticated: boolean }> {
    const routers = await this.storage.routers.all();
    const saved = routers.find((entry) => entry.target.id === routerId);
    if (!saved) throw new RouterError('network-unreachable', { detail: 'saved router not found' });
    const credentials = saved.remember ? await this.storage.vault.get(saved.target.id) : undefined;
    const result = await this.connect({
      host: saved.target.host,
      username: credentials?.username,
      password: credentials?.password,
      remember: saved.remember,
      label: saved.label,
      routerId: saved.target.id,
      fast,
    });
    return { session: result.session, authenticated: result.authenticated };
  }

  async logout(): Promise<void> {
    this.stopMonitor();
    await this.engine.logout();
    this.snapshot = undefined;
    this.password = undefined;
    this.emit('state', this.stateSnapshot());
  }

  /* ------------------------------------------------------------------ *
   * Data
   * ------------------------------------------------------------------ */

  async refreshSnapshot(): Promise<NetworkSnapshot | undefined> {
    if (!this.engine.isReady) return undefined;
    try {
      const snapshot = await this.engine.getSnapshot();
      this.snapshot = snapshot;
      this.detectNewDevices(snapshot.devices);
      this.security = SecurityCenter.analyze({
        snapshot,
        fingerprint: this.engine.currentSession?.fingerprint,
        capabilities: this.engine.capabilityReport,
      });
      return snapshot;
    } catch (error) {
      log.warn('snapshot failed', { code: toRouterError(error).code });
      return this.snapshot;
    }
  }

  /**
   * Public (redacted) session view: no passwords, no cookies, no tokens.
   * Shipped to the UI so it can render identity, confidence and capabilities.
   */
  sessionSnapshot(): {
    sessionId: string;
    target: RouterTarget;
    identity: RouterIdentity;
    adapter: AdapterInfo;
    capabilities: { states: Array<{ id: CapabilityId; supported: string; reason: string }> };
    baseUrl: string;
    loginRecipe: { kind: string; loginUrl: string };
    authenticatedAt: string;
    fingerprint: { quality: string; confidence: number; advisories: string[] };
  } | null {
    const session = this.engine.currentSession;
    if (!session) return null;
    return {
      sessionId: session.sessionId,
      target: session.target,
      identity: session.identity,
      baseUrl: session.target.scheme + '://' + session.target.host + ':' + session.target.port,
      adapter: session.adapter,
      capabilities: {
        states: session.capabilities.states.map((state) => ({
          id: state.id,
          supported: state.supported,
          reason: state.reason,
        })),
      },
      loginRecipe: { kind: session.loginRecipe.kind, loginUrl: session.loginRecipe.loginUrl },
      authenticatedAt: session.authenticatedAt,
      fingerprint: {
        quality: session.fingerprint.quality,
        confidence: session.fingerprint.confidence,
        advisories: session.fingerprint.advisories,
      },
    };
  }

  async renameRouter(id: string, label: string): Promise<SavedRouter[]> {
    const routers = await this.storage.routers.setLabel(id, label);
    this.emit('state', this.stateSnapshot());
    return routers;
  }

  get currentSnapshot(): NetworkSnapshot | undefined {
    return this.snapshot;
  }

  get currentSecurity(): SecurityReport | undefined {
    return this.security;
  }

  private detectNewDevices(devices: DeviceRecord[]): void {
    for (const device of devices) {
      if (this.knownMacs.has(device.mac)) continue;
      this.knownMacs.add(device.mac);
      if (this.knownMacs.size <= 1) continue; // don't announce the initial inventory
      this.pushNotification(
        createNotification({
          severity: device.isUnknown ? 'warning' : 'info',
          code: 'new-device',
          title: '⚠️ جهاز جديد اتصل بالشبكة',
          body: `${device.name} · ${device.ip || device.mac}`,
          action: { label: 'عرض الأجهزة', route: '/devices' },
        }),
      );
    }
  }

  /* ------------------------------------------------------------------ *
   * Operations
   * ------------------------------------------------------------------ */

  async execute(request: OperationRequest): Promise<OperationResult> {
    const result = await this.engine.execute(request);
    if (result.ok) {
      await this.refreshSnapshot();
      this.emit('state', this.stateSnapshot());
    }
    return result;
  }

  async reboot(): Promise<OperationResult> {
    const result = await this.engine.reboot();
    await this.refreshSnapshot();
    return result;
  }

  async speedTest(
    options: {
      onProgress?: (phase: 'ping' | 'down' | 'up', value: number) => void;
      onPhase?: (phase: 'ping' | 'down' | 'up' | 'done') => void;
    } = {},
  ): Promise<SpeedTestResult> {
    return this.engine.speedTest({
      onSample: (phase, value) => options.onProgress?.(phase, value),
      onPhase: (phase) => options.onPhase?.(phase),
    });
  }

  async wifiNeighbors(): Promise<WifiNeighbor[]> {
    return this.engine.scanWifiNeighbors();
  }

  /* ------------------------------------------------------------------ *
   * Smart assistant / fix
   * ------------------------------------------------------------------ */

  async assistant(text: string): Promise<AssistantReply> {
    const devices = this.snapshot?.devices ?? this.engine.knownDevices;
    const reply = SmartAssistant.respond(text, {
      devices,
      support: (capability) => this.engine.supports(capability as CapabilityId),
      canLimitPerDevice: this.engine.supports('bandwidth_control'),
      totalDownKbps: this.snapshot?.internet.downKbps ?? sumRates(devices, 'down'),
      totalUpKbps: this.snapshot?.internet.upKbps ?? sumRates(devices, 'up'),
      latencyMs: this.lastLatency,
      currentChannel: this.snapshot?.wifi.bands[0]?.channel,
      band: '2.4GHz',
    });
    if (reply.plan) this.plans.set(reply.plan.id, reply.plan);
    return reply;
  }

  async applyPlan(plan: SmartFixPlan): Promise<Awaited<ReturnType<typeof SmartFixEngine.apply>>> {
    const result = await SmartFixEngine.apply(plan, this.engine);
    await this.refreshSnapshot();
    this.pushNotification(
      result.ok
        ? createNotification({
            severity: result.verified ? 'success' : 'info',
            code: 'smart-fix',
            title: result.verified ? '✓ تم تطبيق Smart Fix' : 'ℹ️ تم إرسال التغيير',
            body: result.messageAr,
          })
        : createNotification({
            severity: 'warning',
            code: 'smart-fix-failed',
            title: '⚠️ لم يتم تطبيق التغيير',
            body: result.messageAr,
          }),
    );
    this.emit('state', this.stateSnapshot());
    return result;
  }

  /* ------------------------------------------------------------------ *
   * Monitor + events
   * ------------------------------------------------------------------ */

  private startMonitor(): void {
    this.stopMonitor();
    const host = this.currentHost ?? '127.0.0.1';
    const platformProbe: LatencyProbe =
      this.mode === 'simulated' ? simulatedProbe(this.simulated()) : this.options.platform.latencyProbe(host);

    this.monitor = new InternetMonitor({
      probe: platformProbe,
      rates: async () => {
        const sample = await this.engine.getBandwidthSample();
        return sample;
      },
      intervalMs: 2000,
      hiddenIntervalMs: 8000,
      onStatusChange: (online) => {
        this.online = online;
        this.pushNotification(
          online
            ? createNotification({ severity: 'success', code: 'online', title: '🟢 تم استعادة الاتصال بالإنترنت' })
            : createNotification({ severity: 'critical', code: 'offline', title: '🔴 الاتصال بالإنترنت انقطع' }),
        );
      },
    });
    this.monitor.on('sample', (sample) => {
      this.lastLatency = sample.latencyMs;
      this.emit('sample', {
        latencyMs: sample.latencyMs,
        downKbps: sample.downKbps,
        upKbps: sample.upKbps,
        online: sample.online,
      });
    });
    this.monitor.start();

    // Periodic full snapshot keeps cards, graphs and the network map in sync
    // without the UI polling aggressively (spec §28).
    this.snapshotTimer = setInterval(() => {
      void this.refreshSnapshot().then(() => this.emit('state', this.stateSnapshot()));
    }, 6000);
  }

  private stopMonitor(): void {
    this.monitor?.stop();
    this.monitor = undefined;
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.snapshotTimer = undefined;
  }

  pushNotification(notification: AppNotification): void {
    this.notifications = [notification, ...this.notifications].slice(0, 50);
    this.emit('notification', notification);
  }

  get allNotifications(): AppNotification[] {
    return this.notifications;
  }

  markNotificationsRead(): void {
    this.notifications = this.notifications.map((notification) => ({ ...notification, read: true }));
  }

  on(listener: (event: keyof HostEventMap, payload: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: keyof HostEventMap, payload: unknown): void {
    for (const listener of this.listeners) {
      try {
        listener(event, payload);
      } catch {
        /* a broken listener must never break the host */
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Introspection
   * ------------------------------------------------------------------ */

  stateSnapshot(): HostStateSnapshot {
    const session = this.engine.currentSession;
    return {
      mode: this.mode,
      profileId: this.mode === 'simulated' ? this.profileId : undefined,
      connected: this.engine.isReady,
      phase: this.engine.currentPhase,
      host: session?.target.host,
      adapter: session?.adapter.id,
      vendor: session?.identity.vendor,
      model: session?.identity.model,
      confidence: session?.fingerprint.confidence,
      quality: session?.fingerprint.quality,
      counts: this.snapshot?.counts,
      updatedAt: Date.now(),
    };
  }

  describe(): Record<string, unknown> {
    const session = this.engine.currentSession;
    return {
      mode: this.mode,
      profileId: this.profileId,
      platform: { kind: this.options.platform.kind, label: this.options.platform.label },
      profiles: Object.entries(SIMULATED_PROFILES).map(([id, profile]) => ({
        id,
        label: profile.label,
        arLabel: profile.arLabel,
      })),
      transport: this.engine.transportCapabilities,
      engine: {
        phase: this.engine.currentPhase,
        ready: this.engine.isReady,
      },
      session: session
        ? {
            target: session.target,
            identity: session.identity,
            adapter: session.adapter,
            loginRecipe: session.loginRecipe,
            authenticatedAt: session.authenticatedAt,
          }
        : undefined,
      fingerprint: session
        ? {
            quality: session.fingerprint.quality,
            confidence: session.fingerprint.confidence,
            candidates: session.fingerprint.candidates.map((candidate) => ({
              signatureId: candidate.signatureId,
              vendor: candidate.vendor,
              model: candidate.model,
              confidence: candidate.confidence,
              adapter: candidate.adapter,
            })),
            evidence: session.fingerprint.evidence,
            advisories: session.fingerprint.advisories,
            signals: {
              title: session.fingerprint.signals.title,
              serverBanner: session.fingerprint.signals.serverBanner,
              cookieNames: session.fingerprint.signals.cookieNames,
              authRealm: session.fingerprint.signals.authRealm,
              assetPaths: session.fingerprint.signals.assetPaths.slice(0, 10),
              apiHits: session.fingerprint.signals.apiHits.map((hit) => hit.path),
              upnp: session.fingerprint.signals.upnp,
            },
          }
        : undefined,
      capabilities: this.engine.capabilitySummary(),
      discovery: this.discovery
        ? {
            durationMs: this.discovery.durationMs,
            gateways: this.discovery.gatewayCandidates,
            interfaces: this.discovery.interfaces.map((entry) => ({
              url: entry.baseUrl,
              status: entry.status,
              title: entry.title,
              server: entry.server,
              latencyMs: entry.latencyMs,
              services: entry.services,
            })),
            notes: this.discovery.notes,
          }
        : undefined,
      security: this.security,
      monitor: {
        latencyMs: this.lastLatency,
        online: this.online,
        history: this.monitor?.history(),
      },
      diagnostics: this.engine.diagnostics(),
      signatures: this.signatureDb.meta,
      learned: this.learner.all(),
      vault: { kind: this.storage.vault.kind, location: this.storage.root ?? 'in-memory' },
      copyright: '© 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.',
    };
  }

  async savedRouters(): Promise<SavedRouter[]> {
    return this.storage.routers.all();
  }

  async forgetRouter(id: string): Promise<SavedRouter[]> {
    await this.storage.vault.remove(id);
    return this.storage.routers.remove(id);
  }

  async shutdown(): Promise<void> {
    this.stopMonitor();
    await this.engine.logout().catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ *
 * Simulated mode helpers (shared by every platform)
 * ------------------------------------------------------------------ */

function simulatedServices(): DetectedService[] {
  return [
    { port: 80, protocol: 'http', open: true, detail: 'simulated management UI' },
    { port: 1900, protocol: 'upnp', open: true, detail: 'SSDP advertised' },
  ];
}

function simulatedProbe(transport: SimulatedTransport): LatencyProbe {
  return async () => {
    const state = transport.profile.state();
    const jitter = Math.random() * 18;
    const reachable = state.wan.connected;
    return { latencyMs: reachable ? 18 + jitter : 0, reachable };
  };
}

function sumRates(devices: DeviceRecord[], direction: 'down' | 'up'): number {
  return devices.reduce(
    (total, device) => total + (direction === 'down' ? (device.rateDownKbps ?? 0) : (device.rateUpKbps ?? 0)),
    0,
  );
}

export type { UpnpInfo };
