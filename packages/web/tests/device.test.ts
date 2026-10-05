/**
 * Device-shell test — the APK's runtime path, without an Android device.
 *
 * `@capacitor/core` is mocked (native HTTP + the companion plugin), and the app
 * runs exactly as it does on the phone: the portable engine host answers the
 * `/api/*` contract in-process. This is what keeps the downloadable APK honest
 * in CI — if this test passes, the on-device path works end to end.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const base64 = {
  encode: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  decode: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
};

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({
    available: async () => ({ ok: true, keystore: true, version: '1' }),
    info: async () => ({ gateway: '192.168.1.1', ssid: 'HomeWiFi', frequencyMhz: 5180 }),
    ping: async () => ({ latencyMs: 9, reachable: true, method: 'icmp' }),
    encrypt: async ({ plaintext }: { plaintext: string }) => ({ payload: `v1:${base64.encode(plaintext)}` }),
    decrypt: async ({ payload }: { payload: string }) => ({ plaintext: base64.decode(payload.slice(3)) }),
  }),
  CapacitorHttp: {
    request: vi.fn(async ({ url }: { url: string }) => ({ status: 200, headers: {}, data: '', url })),
  },
}));

// The WebView/Node `Response` used by the in-process runtime is provided by the
// test environment (Node 22 global). Guard early so a missing global is obvious.
if (typeof globalThis.Response !== 'function') {
  throw new Error('this test needs a global Response implementation');
}

import { store } from '../src/core/store';
import { getRuntime, isNativeShell } from '../src/core/runtime';

describe('android device shell (mocked Capacitor)', () => {
  beforeAll(() => {
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
      platform: 'android',
      getPlatform: () => 'android',
    };
  });

  afterAll(() => {
    store.dispose();
    delete (globalThis as { Capacitor?: unknown }).Capacitor;
  });

  it('detects the native shell and exposes the on-device engine runtime', async () => {
    expect(isNativeShell()).toBe(true);
    const runtime = await getRuntime();
    expect(runtime.kind).toBe('device');
    const readiness = await runtime.ready();
    expect(readiness.ok).toBe(true);
    expect(readiness.platform).toBe('device-shell');
  });

  it('boots the state, the plan and a live stream with no bridge', async () => {
    await store.bootstrap();
    const state = store.getState();
    expect(state.bridge.status).toBe('ready');
    expect(state.runtime.kind).toBe('device');
    expect(state.host.mode).toBe('simulated');
    expect(state.speedPlan.downloadMbps).toBeGreaterThan(0);
  });

  it('connects to the simulated router, then runs a real speed-test stream', { timeout: 90_000 }, async () => {
    const authenticated = await store.connect({
      username: 'admin',
      password: 'Admin@123',
      remember: true,
      label: 'راوتر البيت',
      fast: true,
    });
    expect(authenticated).toBe(true);

    const connected = store.getState();
    expect(connected.session?.identity.vendor).toBeTruthy();
    expect(connected.snapshot?.devices.length ?? 0).toBeGreaterThan(0);
    // "Remember" stores metadata + a Keystore-sealed secret, never plaintext.
    expect(connected.routers.length).toBe(1);
    expect(connected.routers[0]!.remember).toBe(true);

    store.runSpeedTest();
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !store.getState().speedTest.result) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const final = store.getState().speedTest;
    expect(final.result?.method).toBe('simulated');
    expect(final.pingSamples.length).toBeGreaterThan(0);
    expect(final.downSamples.length).toBeGreaterThan(0);
    expect(final.errorAr).toBeUndefined();
  });

  it('applies an operation and reports a verification outcome', { timeout: 60_000 }, async () => {
    const mac = store.getState().snapshot?.devices[0]?.mac;
    expect(mac).toBeTruthy();
    const result = await store.execute('device.block', { mac }, true);
    expect(['verified', 'accepted-unverified']).toContain(result.verification.outcome);
  });

  it('answers the Arabic assistant on-device', { timeout: 60_000 }, async () => {
    const reply = await store.ask('مين أكتر جهاز بيستهلك النت؟');
    expect(reply?.intent).toBe('top-consumer');
  });
});
