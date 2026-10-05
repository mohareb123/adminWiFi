/**
 * Application store — one external store, one SSE stream, zero polling loops.
 *
 * The Local Bridge pushes `state` / `sample` / `phase` / `progress` /
 * `notification` events; the UI simply subscribes. Components select the exact
 * slice they need (see `useAppState`), so a bandwidth sample never repaints the
 * whole dashboard (spec §39/§48).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { getActiveRuntime, getRuntime } from './runtime';
import type { BridgeRuntime } from './runtime';
import type {
  AppNotification,
  AssistantReply,
  BandwidthSample,
  DiscoveryReport,
  NetworkSnapshot,
  OperationId,
  OperationResult,
  RouterCredentials,
  SavedRouter,
  SecurityReport,
  SmartFixPlan,
  SpeedTestResult,
  WifiNeighbor,
} from '@urlm/core';

const API = '/api';

/* ------------------------------------------------------------------ *
 * Bridge payload types (mirrors packages/bridge/src/server.ts)
 * ------------------------------------------------------------------ */

export interface BridgeHealth {
  ok: boolean;
  app: string;
  component: string;
  version: string;
  developer: string;
  copyright: string;
  uptimeSeconds: number;
}

export interface PublicSession {
  sessionId: string;
  baseUrl: string;
  target: { id: string; label: string; host: string; scheme: 'http' | 'https'; port: number };
  identity: import('@urlm/core').RouterIdentity;
  adapter: { id: string; vendor: string; displayName: string; generic: boolean; notes?: string[] };
  capabilities: { states: Array<{ id: OperationId; supported: string; reason: string }> };
  loginRecipe: { kind: string; loginUrl: string };
  authenticatedAt: string;
  fingerprint: { quality: string; confidence: number; advisories: string[] };
}

export interface SpeedPlan {
  simulated: boolean;
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  jitterMs?: number;
  bytesPerSecond: number;
  label: string;
}

export interface HostState {
  mode: 'real' | 'simulated';
  profileId?: string;
  connected: boolean;
  phase: string;
  updatedAt: number;
}

interface DescribeInfo {
  mode: 'real' | 'simulated';
  profiles: Array<{ id: string; label: string; arLabel: string }>;
  capabilities: Array<{ id: OperationId; supported: string; source?: string; reason: string }>;
  fingerprint?: {
    quality: string;
    confidence: number;
    candidates: Array<{ signatureId: string; vendor: string; model: string; confidence: number; adapter: string }>;
    advisories: string[];
  };
  diagnostics: unknown;
  vault?: { kind: string; path: string };
  monitor?: { latencyMs: number; online: boolean; history: Array<{ at: number; latencyMs: number; online: boolean }> };
  learned?: unknown[];
  copyright: string;
}

export type BridgeStatus = 'booting' | 'connecting' | 'ready' | 'offline';

export interface MonitorSample {
  at: number;
  latencyMs: number;
  downKbps: number;
  upKbps: number;
  online: boolean;
}

export interface SpeedTestState {
  running: boolean;
  phase: 'ping' | 'down' | 'up' | 'done' | null;
  pingSamples: number[];
  downSamples: number[];
  upSamples: number[];
  result: SpeedTestResult | null;
  errorAr?: string;
  startedAt?: number;
}

export interface AppState {
  bridge: {
    status: BridgeStatus;
    health?: BridgeHealth;
    lastErrorAt?: number;
    lastErrorAr?: string;
    attempts: number;
  };
  /** Where the `/api/*` calls go: the desktop bridge, or the on-phone engine. */
  runtime: { kind: 'bridge' | 'device'; label: string };
  host: HostState;
  speedPlan: SpeedPlan;
  discovery: DiscoveryReport | null;
  session: PublicSession | null;
  snapshot: NetworkSnapshot | null;
  security: SecurityReport | null;
  describe: DescribeInfo | null;
  routers: SavedRouter[];
  notifications: AppNotification[];
  unreadNotifications: number;
  phase: { phase: string; messageKey: string; detail?: string; at: number } | null;
  progress: { done: number; total: number; messageKey: string } | null;
  assistant: AssistantReply[];
  assistantBusy: boolean;
  speedTest: SpeedTestState;
  samples: BandwidthSample[];
  monitor: MonitorSample[];
  neighbors: WifiNeighbor[] | null;
  neighborsLoading: boolean;
  lastRefreshAt: number;
}

/* ------------------------------------------------------------------ *
 * Bridge HTTP client
 * ------------------------------------------------------------------ */

class BridgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 20_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const runtime = await getRuntime();
    const response = await runtime.fetch(`${API}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(rest.headers ?? {}) },
    });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok || payload.ok === false) {
      const error = (payload.error ?? {}) as { message?: string; code?: string; hint?: string };
      throw new BridgeError(error.message ?? `HTTP ${response.status}`, error.code ?? 'http-error', error.hint);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    if ((error as Error)?.name === 'AbortError') {
      throw new BridgeError('انتهت مهلة الاتصال بالجسر المحلي.', 'timeout');
    }
    throw new BridgeError(
      'تعذّر الوصول إلى الجسر المحلي. تأكد من تشغيله على هذا الجهاز.',
      'bridge-unreachable',
    );
  } finally {
    clearTimeout(timer);
  }
}

const post = <T>(path: string, body: unknown = {}, timeoutMs?: number): Promise<T> =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body), timeoutMs });

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

const EMPTY_SPEED: SpeedTestState = {
  running: false,
  phase: null,
  pingSamples: [],
  downSamples: [],
  upSamples: [],
  result: null,
};

const initialState: AppState = {
  bridge: { status: 'booting', attempts: 0 },
  runtime: { kind: 'bridge', label: 'Local Bridge (HTTP)' },
  host: { mode: 'simulated', connected: false, phase: 'idle', updatedAt: Date.now() },
  speedPlan: {
    simulated: true,
    downloadMbps: 0,
    uploadMbps: 0,
    pingMs: 0,
    bytesPerSecond: 0,
    label: '—',
  },
  discovery: null,
  session: null,
  snapshot: null,
  security: null,
  describe: null,
  routers: [],
  notifications: [],
  unreadNotifications: 0,
  phase: null,
  progress: null,
  assistant: [],
  assistantBusy: false,
  speedTest: EMPTY_SPEED,
  samples: [],
  monitor: [],
  neighbors: null,
  neighborsLoading: false,
  lastRefreshAt: 0,
};

const MAX_SAMPLES = 120;
const MAX_MONITOR = 180;
const MAX_NOTIFICATIONS = 60;
const MAX_TRANSCRIPT = 40;

class AppStore {
  private state: AppState = initialState;
  private listeners = new Set<() => void>();
  private stream?: { close: () => void };
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectDelay = 1000;
  private disposed = false;

  /* ---------------- subscription ---------------- */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): AppState => this.state;

  private set(patch: Partial<AppState>): void {
    let changed = false;
    for (const key of Object.keys(patch) as Array<keyof AppState>) {
      if (!Object.is(this.state[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch, lastRefreshAt: Date.now() };
    for (const listener of this.listeners) listener();
  }

  /* ---------------- lifecycle ---------------- */

  async bootstrap(): Promise<void> {
    if (this.disposed) return;
    this.set({ bridge: { ...this.state.bridge, status: this.state.bridge.health ? 'ready' : 'connecting' } });
    try {
      const runtime = await getRuntime();
      await runtime.ready();
      this.set({ runtime: { kind: runtime.kind, label: runtime.label } });
      const [health, state, plan] = await Promise.all([
        request<{ ok: boolean } & BridgeHealth>('/health'),
        request<{
          state: HostState;
          session: PublicSession | null;
          describe: DescribeInfo;
          snapshot: NetworkSnapshot | null;
          security: SecurityReport | null;
          notifications: AppNotification[];
          routers: SavedRouter[];
        }>('/state'),
        request<{ plan: SpeedPlan }>('/speedtest/plan'),
      ]);
      this.set({
        bridge: { status: 'ready', health: health as BridgeHealth, attempts: 0 },
        runtime: { kind: (await getRuntime()).kind, label: (await getRuntime()).label },
        host: state.state,
        describe: state.describe,
        snapshot: state.snapshot ?? null,
        security: state.security ?? null,
        notifications: state.notifications ?? [],
        routers: state.routers ?? [],
        speedPlan: plan.plan,
        session: state.session ?? null,
      });
      this.attachStream();
    } catch (error) {
      const bridgeError = error as BridgeError;
      this.set({
        bridge: {
          ...this.state.bridge,
          status: 'offline',
          attempts: this.state.bridge.attempts + 1,
          lastErrorAr: bridgeError.message,
          lastErrorAt: Date.now(),
        },
      });
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 15_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.bootstrap();
    }, this.reconnectDelay);
  }

  private attachStream(): void {
    if (this.disposed || this.stream) return;
    void getRuntime().then((runtime) => {
      if (this.disposed || this.stream) return;
      this.attachStreamWith(runtime);
    });
  }

  private attachStreamWith(runtime: BridgeRuntime): void {
    try {
      const stream = runtime.openStream(`${API}/stream`);
      this.stream = stream;
      stream.addEventListener('open', () => {
        this.reconnectDelay = 1000;
        this.set({ bridge: { ...this.state.bridge, status: 'ready', lastErrorAr: undefined } });
      });
      stream.addEventListener('state', (event) => this.onStateEvent(event));
      stream.addEventListener('sample', (event) => this.onSampleEvent(event));
      stream.addEventListener('phase', (event) => {
        const payload = parse<{ phase: string; messageKey: string; detail?: string }>(event);
        if (payload) this.set({ phase: { ...payload, at: Date.now() }, progress: null });
      });
      stream.addEventListener('progress', (event) => {
        const payload = parse<{ done: number; total: number; messageKey: string }>(event);
        if (payload) this.set({ progress: payload });
      });
      stream.addEventListener('notification', (event) => {
        const payload = parse<AppNotification>(event);
        if (!payload) return;
        const notifications = [payload, ...this.state.notifications].slice(0, MAX_NOTIFICATIONS);
        this.set({ notifications, unreadNotifications: this.state.unreadNotifications + 1 });
      });
      stream.addEventListener('error', () => {
        if (this.disposed) return;
        stream.close();
        this.stream = undefined;
        if (this.state.bridge.status === 'ready') {
          this.set({ bridge: { ...this.state.bridge, status: 'offline', lastErrorAt: Date.now() } });
        }
        this.scheduleReconnect();
      });
    } catch {
      this.scheduleReconnect();
    }
  }

  private onStateEvent(event: MessageEvent): void {
    const payload = parse<{ state: HostState; describe?: DescribeInfo; snapshot?: NetworkSnapshot | null; security?: SecurityReport | null }>(event);
    if (!payload) return;
    this.set({
      host: payload.state ?? this.state.host,
      snapshot: payload.snapshot ?? this.state.snapshot,
      security: payload.security ?? this.state.security,
      describe: payload.describe ?? this.state.describe,
      bridge: { ...this.state.bridge, status: 'ready' },
    });
  }

  private onSampleEvent(event: MessageEvent): void {
    const payload = parse<{ latencyMs: number; downKbps: number; upKbps: number; online: boolean }>(event);
    if (!payload) return;
    const sample: BandwidthSample = {
      at: Date.now(),
      downKbps: payload.downKbps,
      upKbps: payload.upKbps,
    };
    const samples = [...this.state.samples, sample];
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
    const monitor = [
      ...this.state.monitor,
      { at: sample.at, latencyMs: payload.latencyMs, downKbps: payload.downKbps, upKbps: payload.upKbps, online: payload.online },
    ];
    if (monitor.length > MAX_MONITOR) monitor.splice(0, monitor.length - MAX_MONITOR);
    this.set({ samples, monitor });
  }

  dispose(): void {
    this.disposed = true;
    this.stream?.close();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
  }

  /* ---------------- actions ---------------- */

  async setMode(mode: 'real' | 'simulated', profileId?: string): Promise<void> {
    const payload = await post<{ state: HostState }>('/mode', { mode, profileId });
    this.set({ host: payload.state, snapshot: null, security: null, session: null, samples: [], monitor: [] });
    await this.refreshPlan();
    await this.bootstrap();
  }

  private async refreshPlan(): Promise<void> {
    try {
      const payload = await request<{ plan: SpeedPlan }>('/speedtest/plan');
      this.set({ speedPlan: payload.plan });
    } catch {
      /* the plan is cosmetic; ignore */
    }
  }

  async discover(): Promise<DiscoveryReport | null> {
    const payload = await post<{ discovery: DiscoveryReport }>('/discover', {}, 60_000);
    this.set({ discovery: payload.discovery });
    return payload.discovery;
  }

  async connect(
    credentials: RouterCredentials & { remember?: boolean; label?: string; host?: string },
  ): Promise<boolean> {
    const payload = await post<{
      authenticated: boolean;
      detail: string;
      session: PublicSession;
      snapshot: NetworkSnapshot | null;
      security: SecurityReport | null;
      describe: DescribeInfo;
    }>(
      '/connect',
      {
        host: credentials.host,
        username: credentials.username,
        password: credentials.password,
        remember: credentials.remember === true,
        label: credentials.label,
      },
      90_000,
    );
    this.set({
      session: payload.session,
      snapshot: payload.snapshot ?? null,
      security: payload.security ?? null,
      describe: payload.describe ?? this.state.describe,
      host: { ...this.state.host, connected: payload.authenticated, phase: 'ready' },
      routers: await this.safeRouters(),
    });
    return payload.authenticated;
  }

  private async safeRouters(): Promise<SavedRouter[]> {
    try {
      const payload = await request<{ routers: SavedRouter[] }>('/routers');
      return payload.routers;
    } catch {
      return this.state.routers;
    }
  }

  async connectSaved(routerId: string): Promise<boolean> {
    const payload = await post<{ authenticated: boolean; session: PublicSession; snapshot: NetworkSnapshot | null }>(
      '/connect-saved',
      { routerId },
      90_000,
    );
    this.set({
      session: payload.session,
      snapshot: payload.snapshot ?? null,
      host: { ...this.state.host, connected: payload.authenticated },
    });
    return payload.authenticated;
  }

  async logout(): Promise<void> {
    await post('/logout');
    this.set({
      session: null,
      snapshot: null,
      security: null,
      samples: [],
      monitor: [],
      host: { ...this.state.host, connected: false, phase: 'idle' },
    });
  }

  async refreshSnapshot(): Promise<void> {
    const payload = await request<{ snapshot: NetworkSnapshot | null; security: SecurityReport | null; describe: DescribeInfo }>(
      '/snapshot',
      { timeoutMs: 30_000 },
    );
    this.set({
      snapshot: payload.snapshot ?? this.state.snapshot,
      security: payload.security ?? this.state.security,
      describe: payload.describe ?? this.state.describe,
    });
  }

  async execute(id: OperationId, params: Record<string, unknown> = {}, confirmed = false): Promise<OperationResult> {
    const payload = await post<{ result: OperationResult; snapshot: NetworkSnapshot | null; describe: DescribeInfo }>(
      '/operations',
      { id, params, confirmed },
      60_000,
    );
    this.set({
      snapshot: payload.snapshot ?? this.state.snapshot,
      describe: payload.describe ?? this.state.describe,
    });
    return payload.result;
  }

  async reboot(): Promise<OperationResult> {
    const payload = await post<{ result: OperationResult }>('/reboot', {}, 60_000);
    return payload.result;
  }

  async loadNeighbors(force = false): Promise<WifiNeighbor[]> {
    if (!force && this.state.neighbors) return this.state.neighbors;
    this.set({ neighborsLoading: true });
    try {
      const payload = await request<{ neighbors: WifiNeighbor[] }>('/wifi/neighbors', { timeoutMs: 45_000 });
      this.set({ neighbors: payload.neighbors, neighborsLoading: false });
      return payload.neighbors;
    } finally {
      this.set({ neighborsLoading: false });
    }
  }

  async ask(text: string): Promise<AssistantReply | null> {
    this.set({ assistantBusy: true });
    try {
      const payload = await post<{ reply: AssistantReply }>('/assistant', { text }, 45_000);
      const assistant = [...this.state.assistant, payload.reply].slice(-MAX_TRANSCRIPT);
      this.set({ assistant, assistantBusy: false });
      return payload.reply;
    } catch (error) {
      this.set({ assistantBusy: false });
      throw error;
    }
  }

  async applyPlan(plan: SmartFixPlan): Promise<OperationResult> {
    const payload = await post<{ result: OperationResult; snapshot?: NetworkSnapshot | null }>(
      '/smartfix/apply',
      { plan },
      90_000,
    );
    if (payload.snapshot) this.set({ snapshot: payload.snapshot });
    return payload.result;
  }

  async renameRouter(id: string, label: string): Promise<void> {
    const payload = await post<{ routers: SavedRouter[] }>('/routers/label', { id, label });
    this.set({ routers: payload.routers });
  }

  async forgetRouter(id: string): Promise<void> {
    const payload = await post<{ routers: SavedRouter[] }>('/routers/forget', { id });
    this.set({ routers: payload.routers });
  }

  markNotificationsRead(): void {
    this.set({ unreadNotifications: 0 });
    void post('/notifications/read').catch(() => undefined);
  }

  dismissNotification(id: string): void {
    this.set({ notifications: this.state.notifications.filter((notification) => notification.id !== id) });
  }

  /* ---------------- speed test (SSE, live samples) ---------------- */

  runSpeedTest(): void {
    if (this.state.speedTest.running) return;
    this.set({
      speedTest: { running: true, phase: 'ping', pingSamples: [], downSamples: [], upSamples: [], result: null, startedAt: Date.now() },
    });
    const runtime = getActiveRuntime();
    if (runtime) this.streamSpeedTestWith(runtime);
    else void this.streamSpeedTest();
  }

  private async streamSpeedTest(): Promise<void> {
    const runtime = await getRuntime();
    if (this.disposed) return;
    this.streamSpeedTestWith(runtime);
  }

  private streamSpeedTestWith(runtime: BridgeRuntime): void {
    const stream = runtime.openStream(`${API}/speedtest/stream`);
    const close = () => {
      stream.close();
      this.set({ speedTest: { ...this.state.speedTest, running: false } });
    };
    stream.addEventListener('phase', (event) => {
      const payload = parse<{ phase: 'ping' | 'down' | 'up' }>(event);
      if (payload) this.set({ speedTest: { ...this.state.speedTest, phase: payload.phase, running: true } });
    });
    stream.addEventListener('sample', (event) => {
      const payload = parse<{ phase: 'ping' | 'down' | 'up'; value: number }>(event);
      if (!payload) return;
      const current = this.state.speedTest;
      const speedTest: SpeedTestState = {
        ...current,
        running: true,
        pingSamples: payload.phase === 'ping' ? [...current.pingSamples, payload.value].slice(-30) : current.pingSamples,
        downSamples: payload.phase === 'down' ? [...current.downSamples, payload.value].slice(-60) : current.downSamples,
        upSamples: payload.phase === 'up' ? [...current.upSamples, payload.value].slice(-60) : current.upSamples,
      };
      this.set({ speedTest });
    });
    stream.addEventListener('result', (event) => {
      const payload = parse<SpeedTestResult>(event);
      this.set({
        speedTest: { ...this.state.speedTest, running: false, phase: 'done', result: payload ?? null, errorAr: undefined },
      });
      close();
    });
    stream.addEventListener('error', (event) => {
      const payload = parse<{ message?: string }>(event as MessageEvent);
      if (payload?.message) {
        this.set({
          speedTest: { ...this.state.speedTest, running: false, errorAr: payload.message },
        });
        close();
        return;
      }
      if (this.state.speedTest.running && !this.state.speedTest.result) {
        this.set({
          speedTest: { ...this.state.speedTest, running: false, errorAr: 'تعذّر إكمال اختبار السرعة.' },
        });
      }
      close();
    });
  }
}

function parse<T>(event: MessageEvent): T | null {
  try {
    const data = JSON.parse(String(event.data)) as T & { message?: string };
    // The SSE helper wraps errors; unwrap when present.
    if (data && typeof data === 'object' && 'error' in (data as object)) {
      return (data as unknown as { error: T }).error;
    }
    return data;
  } catch {
    return null;
  }
}

export const store = new AppStore();

/**
 * Select a slice of the store. The selector result is cached by `equals` so a
 * component only re-renders when *its* data changed — this is what keeps the
 * dashboard at 60 FPS while samples stream in (spec §48).
 */
export function useAppState<T>(selector: (state: AppState) => T, equals: (a: T, b: T) => boolean = Object.is): T {
  const cached = useRef<{ value: T } | undefined>(undefined);
  const getSelection = useCallback(() => {
    const next = selector(store.getState());
    if (cached.current === undefined || !equals(cached.current.value, next)) {
      cached.current = { value: next };
    }
    return cached.current.value;
  }, [selector, equals]);
  return useSyncExternalStore(store.subscribe, getSelection, getSelection);
}

export const shallowArrayEquals = <T,>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((entry, index) => Object.is(entry, b[index]));

export { BridgeError };
