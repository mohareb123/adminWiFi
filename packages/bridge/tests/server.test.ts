/**
 * Local Bridge server tests.
 *
 * Two guarantees are checked here:
 *  1. the loopback boundary — a remote client is refused unless the operator
 *     explicitly opted in (URLM_ALLOW_REMOTE / URLM_TOKEN);
 *  2. the whole UI contract (health → state → connect → snapshot → operations →
 *     speed test → assistant) works end to end against the simulated router.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EngineHost } from '../src/engine-host';
import { BridgeServer } from '../src/server';

let host: EngineHost;
let server: BridgeServer;
let baseUrl = '';

beforeAll(async () => {
  host = new EngineHost({ persist: false });
  await host.setMode('simulated', 'huawei-hg8145');
  server = new BridgeServer({ host, port: 0, bind: '127.0.0.1' });
  const { port } = await server.listen();
  baseUrl = `http://127.0.0.1:${port}`;
  host.setSelfUrl(baseUrl);
});

afterAll(async () => {
  await server.close();
  await host.shutdown();
});

const get = async (path: string) => {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: (await response.json()) as Record<string, any> };
};

const post = async (path: string, payload: unknown = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
};

describe('BridgeServer', () => {
  it('reports its identity and the developer attribution', async () => {
    const { status, body } = await get('/api/health');
    expect(status).toBe(200);
    expect(body.app).toBe('Universal Router Manager');
    expect(body.component).toBe('local-bridge');
    expect(body.developer).toContain('محمد إبراهيم أبو العز');
    expect(body.copyright).toBe('© 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.');
  });

  it('exposes the simulator profiles and the demo line plan', async () => {
    const { body } = await get('/api/state');
    expect(body.state.mode).toBe('simulated');
    expect(body.describe.profiles.length).toBeGreaterThanOrEqual(5);

    const plan = await get('/api/speedtest/plan');
    expect(plan.body.plan.simulated).toBe(true);
    expect(plan.body.plan.downloadMbps).toBeGreaterThan(0);
  });

  it('connects, returns a redacted session and never leaks the password', async () => {
    const { body } = await post('/api/connect', { username: 'admin', password: 'Admin@123', fast: true });
    expect(body.authenticated).toBe(true);
    expect(body.session.identity.vendor).toBe('Huawei');
    expect(body.session.capabilities.states.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(body);
    // No credential values, and no password/token *values* — field names such as
    // `passwordField` are metadata and stay in Advanced Mode only.
    expect(serialised).not.toContain('Admin@123');
    expect(serialised).not.toMatch(/"password"\s*:/);
    expect(serialised).not.toMatch(/"token"\s*:/);
    expect(serialised).not.toMatch(/sessionToken|authToken/i);
  });

  it('serves the dashboard state with devices and Wi-Fi bands', async () => {
    const { body } = await get('/api/snapshot');
    expect(body.snapshot.devices.length).toBeGreaterThan(3);
    expect(body.snapshot.wifi.bands.length).toBeGreaterThan(0);
    expect(body.security.status).toBeTruthy();
  });

  it('executes an operation and reports the verification outcome', async () => {
    const target = (await get('/api/snapshot')).body.snapshot.devices[0];
    const { body } = await post('/api/operations', {
      id: 'device.block',
      params: { mac: target.mac, blocked: true },
      confirmed: true,
    });
    expect(body.result.ok).toBe(true);
    expect(body.result.verification.outcome).toMatch(/verified|accepted-unverified/);
    const after = body.snapshot.devices.find((device: { mac: string }) => device.mac === target.mac);
    expect(after.blocked).toBe(true);
  });

  it('answers the Arabic assistant with a real plan', async () => {
    const { body } = await post('/api/assistant', { text: 'مين أكتر جهاز بيستهلك النت؟' });
    expect(body.reply.intent).toBe('top-consumer');
    expect(body.reply.messageAr.length).toBeGreaterThan(10);
  });

  it('streams the speed test over SSE and ends with a result', async () => {
    const response = await fetch(`${baseUrl}/api/speedtest/stream`);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 20_000;
    let phases = 0;
    let samples = 0;
    let result: { downloadMbps: number; method: string } | null = null;

    while (Date.now() < deadline && !result) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      phases = (text.match(/event: phase/g) ?? []).length;
      samples = (text.match(/event: sample/g) ?? []).length;
      const match = /event: result\ndata: (\{.*\})/.exec(text);
      if (match) result = JSON.parse(match[1] as string) as { downloadMbps: number; method: string };
    }
    await reader.cancel();

    expect(phases).toBeGreaterThanOrEqual(3);
    expect(samples).toBeGreaterThan(5);
    expect(result).not.toBeNull();
    expect(result!.method).toBe('simulated');
    expect(result!.downloadMbps).toBeGreaterThan(0);
  }, 30_000);

  it('rejects unknown endpoints and invalid bodies without crashing', async () => {
    const missing = await get('/api/does-not-exist');
    expect(missing.status).toBe(404);
    expect(missing.body.ok).toBe(false);

    const invalid = await fetch(`${baseUrl}/api/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(invalid.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses non-loopback clients unless a token or explicit opt-in is present', async () => {
    const authorise = (
      server as unknown as {
        authorise: (request: IncomingMessage, response: ServerResponse) => boolean;
      }
    ).authorise.bind(server);

    const makeResponse = () => {
      const state = { code: 0, body: '' };
      const response = {
        writeHead(code: number) {
          state.code = code;
          return response;
        },
        end(chunk?: string) {
          state.body = chunk ?? '';
          return response;
        },
      } as unknown as ServerResponse;
      return { response, state };
    };

    // A remote address with no token → refused.
    const remote = makeResponse();
    const allowedRemote = authorise({ socket: { remoteAddress: '10.0.0.42' }, headers: {}, url: '/api/state' } as unknown as IncomingMessage, remote.response);
    expect(allowedRemote).toBe(false);
    expect(remote.state.code).toBe(403);
    expect(remote.state.body).toContain('الجسر المحلي');

    // Loopback traffic is always allowed.
    const local = makeResponse();
    expect(
      authorise({ socket: { remoteAddress: '127.0.0.1' }, headers: {}, url: '/api/state' } as unknown as IncomingMessage, local.response),
    ).toBe(true);

    // With a configured token, a remote client that presents it is allowed.
    const tokened = new BridgeServer({ host, port: 0, bind: '127.0.0.1', token: 'secret-token' });
    const tokenedAuthorise = (
      tokened as unknown as { authorise: (request: IncomingMessage, response: ServerResponse) => boolean }
    ).authorise.bind(tokened);
    const withToken = makeResponse();
    expect(
      tokenedAuthorise(
        { socket: { remoteAddress: '10.0.0.42' }, headers: { 'x-urlm-token': 'secret-token' }, url: '/api/state' } as unknown as IncomingMessage,
        withToken.response,
      ),
    ).toBe(true);
    const wrongToken = makeResponse();
    expect(
      tokenedAuthorise(
        { socket: { remoteAddress: '10.0.0.42' }, headers: { 'x-urlm-token': 'nope' }, url: '/api/state' } as unknown as IncomingMessage,
        wrongToken.response,
      ),
    ).toBe(false);
  });
});
