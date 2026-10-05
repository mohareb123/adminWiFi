/**
 * Host/router tests — the on-device path.
 *
 * These run the *portable* engine host with a test platform (no Node services,
 * no sockets) and drive it through the exact `/api/*` contract the UI uses.
 * That is what makes the Android APK credible: the same routes, the same
 * verification rules, the same honest failures — with the bridge absent.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

import { describe, expect, it } from 'vitest';
import {
  EngineHost,
  MemoryStore,
  SessionCredentialVault,
  routeBridgeRequest,
} from '../src/index';
import type {
  HostPlatform,
  HttpTransport,
  SavedRouter,
  SavedRouterRepository,
  SpeedTestResult,
} from '../src/index';

class MemoryRouters implements SavedRouterRepository {
  private routers: SavedRouter[] = [];

  async all(): Promise<SavedRouter[]> {
    return [...this.routers];
  }

  async upsert(router: SavedRouter): Promise<SavedRouter[]> {
    const index = this.routers.findIndex((entry) => entry.target.id === router.target.id);
    if (index >= 0) this.routers[index] = { ...this.routers[index], ...router };
    else this.routers.push(router);
    return this.all();
  }

  async remove(id: string): Promise<SavedRouter[]> {
    this.routers = this.routers.filter((entry) => entry.target.id !== id);
    return this.all();
  }

  async setLabel(id: string, label: string): Promise<SavedRouter[]> {
    this.routers = this.routers.map((entry) => (entry.target.id === id ? { ...entry, label } : entry));
    return this.all();
  }
}

function testPlatform(): HostPlatform {
  return {
    kind: 'test',
    label: 'Test platform (no sockets)',
    createStorage: () => ({
      vault: new SessionCredentialVault(),
      store: new MemoryStore(),
      routers: new MemoryRouters(),
      root: 'memory',
    }),
    realTransport: (): HttpTransport => {
      throw new Error('the test platform has no real transport');
    },
    gateway: async () => ({ gateways: [] }),
    services: async () => [],
    upnp: async () => undefined,
    latencyProbe: () => async () => ({ latencyMs: 11, reachable: true }),
    speedTest: () => async (): Promise<SpeedTestResult> => {
      throw new Error('simulated mode must not reach the platform speed test');
    },
    selfUrl: () => 'http://device.test',
  };
}

async function host(): Promise<EngineHost> {
  const instance = new EngineHost({ platform: testPlatform(), persist: false, mode: 'simulated' });
  await instance.setMode('simulated', 'huawei-hg8145');
  return instance;
}

describe('portable host (device path)', () => {
  it('reports attribution and its platform over /api/health', async () => {
    const instance = await host();
    const result = await routeBridgeRequest(instance, { method: 'GET', pathname: '/api/health' });
    expect(result.type).toBe('json');
    if (result.type !== 'json') return;
    expect(result.status).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.copyright).toContain('Mohamed Ibrahim Abu El-Ezz');
    expect(body.component).toBe('engine-host');
    expect((body.platform as { kind: string }).kind).toBe('test');
    await instance.shutdown();
  });

  it('serves the initial state with no session and the demo profiles', async () => {
    const instance = await host();
    const result = await routeBridgeRequest(instance, { method: 'GET', pathname: '/api/state' });
    if (result.type !== 'json') throw new Error('expected json');
    const body = result.body as { session: unknown; state: { mode: string }; describe: Record<string, unknown> };
    expect(body.session).toBeNull();
    expect(body.state.mode).toBe('simulated');
    expect(Array.isArray(body.describe.profiles)).toBe(true);
    await instance.shutdown();
  });

  it('connects to the simulated router, fingerprints it and loads devices', { timeout: 60_000 }, async () => {
    const instance = await host();
    const result = await routeBridgeRequest(instance, {
      method: 'POST',
      pathname: '/api/connect',
      body: { username: 'admin', password: 'Admin@123', fast: true },
    });
    if (result.type !== 'json') throw new Error('expected json');
    expect(result.status).toBe(200);
    const body = result.body as {
      authenticated: boolean;
      session: { identity: { vendor?: string; model?: string }; adapter: { id: string }; fingerprint: { confidence: number } };
      snapshot: { devices: unknown[]; counts: { devices: number } } | null;
    };
    expect(body.authenticated).toBe(true);
    expect(body.session.identity.vendor).toBeTruthy();
    expect(body.session.fingerprint.confidence).toBeGreaterThan(0.5);
    expect(body.session.adapter.id).toBeTruthy();
    expect(body.snapshot?.devices.length ?? 0).toBeGreaterThan(0);

    // The connection is remembered as router metadata (never the password).
    const routers = await routeBridgeRequest(instance, { method: 'GET', pathname: '/api/routers' });
    if (routers.type !== 'json') throw new Error('expected json');
    const saved = (routers.body as { routers: Array<{ remember: boolean }> }).routers;
    expect(saved.length).toBe(1);
    expect(saved[0]!.remember).toBe(false);
    await instance.shutdown();
  });

  it('executes an operation and returns a real verification outcome', { timeout: 60_000 }, async () => {
    const instance = await host();
    await routeBridgeRequest(instance, {
      method: 'POST',
      pathname: '/api/connect',
      body: { username: 'admin', password: 'Admin@123', fast: true },
    });
    const devicesResult = await routeBridgeRequest(instance, { method: 'GET', pathname: '/api/snapshot' });
    if (devicesResult.type !== 'json') throw new Error('expected json');
    const snapshot = (devicesResult.body as { snapshot: { devices: Array<{ mac: string }> } | null }).snapshot;
    const mac = snapshot?.devices[0]?.mac;
    expect(mac).toBeTruthy();

    const result = await routeBridgeRequest(instance, {
      method: 'POST',
      pathname: '/api/operations',
      body: { id: 'device.block', params: { mac }, confirmed: true },
    });
    if (result.type !== 'json') throw new Error('expected json');
    const body = result.body as { result: { ok: boolean; verification: { outcome: string } } };
    expect(['verified', 'accepted-unverified']).toContain(body.result.verification.outcome);
    await instance.shutdown();
  });

  it('answers the Arabic assistant with a concrete intent', { timeout: 60_000 }, async () => {
    const instance = await host();
    await routeBridgeRequest(instance, {
      method: 'POST',
      pathname: '/api/connect',
      body: { username: 'admin', password: 'Admin@123', fast: true },
    });
    const result = await routeBridgeRequest(instance, {
      method: 'POST',
      pathname: '/api/assistant',
      body: { text: 'مين أكتر جهاز بيستهلك النت؟' },
    });
    if (result.type !== 'json') throw new Error('expected json');
    const reply = (result.body as { reply: { intent: string; messageAr: string } }).reply;
    expect(reply.intent).toBe('top-consumer');
    expect(reply.messageAr.length).toBeGreaterThan(0);
    await instance.shutdown();
  });

  it('streams a speed test with real phase events and a simulated result', { timeout: 60_000 }, async () => {
    const instance = await host();
    const route = await routeBridgeRequest(instance, { method: 'GET', pathname: '/api/speedtest/stream' });
    if (route.type !== 'stream') throw new Error('expected a stream');
    const events: Array<{ event: string; payload: unknown }> = [];
    await route.run({ send: (event, payload) => events.push({ event, payload }) });

    const phases = events.filter((entry) => entry.event === 'phase').map((entry) => (entry.payload as { phase: string }).phase);
    expect(phases).toEqual(expect.arrayContaining(['ping', 'down', 'up', 'done']));
    expect(events.some((entry) => entry.event === 'sample')).toBe(true);
    const result = events.find((entry) => entry.event === 'result')?.payload as SpeedTestResult;
    expect(result.method).toBe('simulated');
    expect(result.downloadMbps).toBeGreaterThan(0);
    await instance.shutdown();
  });

  it('renames a saved router and refuses unknown endpoints honestly', { timeout: 60_000 }, async () => {
    const instance = await host();
    const connect = await routeBridgeRequest(instance, {
      method: 'POST',
      pathname: '/api/connect',
      body: { username: 'admin', password: 'Admin@123', fast: true },
    });
    if (connect.type !== 'json') throw new Error('expected json');
    const id = (connect.body as { session: { target: { id: string } } }).session.target.id;

    const rename = await routeBridgeRequest(instance, {
      method: 'POST',
      pathname: '/api/routers/label',
      body: { id, label: 'راوتر البيت' },
    });
    if (rename.type !== 'json') throw new Error('expected json');
    const routers = (rename.body as { routers: SavedRouter[] }).routers;
    expect(routers[0]!.label).toBe('راوتر البيت');

    const missing = await routeBridgeRequest(instance, { method: 'GET', pathname: '/api/nope' });
    if (missing.type !== 'json') throw new Error('expected json');
    expect(missing.status).toBe(404);
    expect(((missing.body as { error: { code: string } }).error ?? {}).code).toBe('unsupported-operation');
    await instance.shutdown();
  });

  it('never reports success for a wrong password', { timeout: 60_000 }, async () => {
    const instance = await host();
    const result = await routeBridgeRequest(instance, {
      method: 'POST',
      pathname: '/api/connect',
      body: { username: 'admin', password: 'not-the-password', fast: true },
    });
    if (result.type !== 'json') throw new Error('expected json');
    const body = result.body as {
      ok: boolean;
      authenticated?: boolean;
      error?: { code: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.authenticated ?? false).toBe(false);
    expect(body.error?.code).toBe('auth-failed');
    // The Arabic message explains it; no session may be left behind.
    expect(body.error?.message.length ?? 0).toBeGreaterThan(0);
    const state = await routeBridgeRequest(instance, { method: 'GET', pathname: '/api/state' });
    if (state.type !== 'json') throw new Error('expected json');
    expect((state.body as { session: unknown }).session).toBeNull();
    await instance.shutdown();
  });
});
