/**
 * Runtime — where the UI's `/api/*` calls actually go.
 *
 * Two runtimes implement exactly the same contract:
 *   - **bridge** (browser/PWA): HTTP + Server-Sent Events against the local
 *     Node bridge on 127.0.0.1 (proxied by Vite in development).
 *   - **device** (Android APK): the portable engine host running *inside* the
 *     app, reached in-process — no PC, no server, no localhost socket.
 *
 * The rest of the UI (store, panels) never knows which one is active, which is
 * why the same screens, Arabic copy, verification rules and performance work
 * apply on desktop and on the phone.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

/** Subset of the DOM stream API the store relies on. */
export interface BridgeStream {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface BridgeRuntime {
  readonly kind: 'bridge' | 'device';
  /** Shown in Advanced Mode → diagnostics. */
  readonly label: string;
  fetch(path: string, init: RequestInit): Promise<Response>;
  openStream(path: string): BridgeStream;
  /** Wait until the runtime is able to answer (device shell boots its host). */
  ready(): Promise<{ ok: boolean; platform?: string; error?: string }>;
  dispose?(): void;
}

/* ------------------------------------------------------------------ *
 * Browser / PWA runtime (Local Bridge over HTTP)
 * ------------------------------------------------------------------ */

const httpRuntime: BridgeRuntime = {
  kind: 'bridge',
  label: 'Local Bridge (HTTP)',
  fetch: (path, init) => fetch(path, init),
  openStream: (path) => {
    const source = new EventSource(path);
    return {
      addEventListener: (type, listener) => source.addEventListener(type, listener as unknown as EventListener),
      close: () => source.close(),
    };
  },
  ready: async () => {
    try {
      const response = await fetch('/api/health');
      const payload = (await response.json()) as { ok?: boolean; component?: string };
      return { ok: payload.ok === true, platform: payload.component };
    } catch (error) {
      return { ok: false, error: (error as Error)?.message ?? 'bridge-unreachable' };
    }
  },
};

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

export function isNativeShell(): boolean {
  const capacitor = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; platform?: string } })
    .Capacitor;
  if (!capacitor) return false;
  if (typeof capacitor.isNativePlatform === 'function') return capacitor.isNativePlatform();
  return capacitor.platform === 'android' || capacitor.platform === 'ios';
}

let deviceRuntimePromise: Promise<BridgeRuntime> | undefined;
let activeRuntime: BridgeRuntime | undefined;

/** The runtime for this session (device shell on Android, bridge elsewhere). */
export async function getRuntime(): Promise<BridgeRuntime> {
  if (activeRuntime) return activeRuntime;

  if (isNativeShell()) {
    deviceRuntimePromise ??= import('../native/device-runtime').then((module) => module.createDeviceRuntime());
    activeRuntime = await deviceRuntimePromise;
    return activeRuntime;
  }

  activeRuntime = httpRuntime;
  return activeRuntime;
}

export function getActiveRuntime(): BridgeRuntime | undefined {
  return activeRuntime;
}
