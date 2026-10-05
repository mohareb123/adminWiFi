/**
 * Bridge route table — the `/api/*` contract of Universal Router Manager.
 *
 * It lives in `core` on purpose: the Node bridge (desktop) and the Android shell
 * (in-process) must expose *exactly* the same contract, so the UI never learns
 * where it is running. Transports differ, routes do not.
 *
 * The router never touches the network itself: it validates input, calls the
 * host, and returns a plain `{status, body}` (or a stream to run).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

import { RouterError, toRouterError } from '../core/errors';
import type { OperationId } from '../core/types';
import type { EngineHost } from './engine-host';

/** Where streamed events go (SSE writer on the bridge, emitter on device). */
export interface BridgeStreamSink {
  send(event: string, payload: unknown): void;
}

export interface BridgeRouteRequest {
  method: string;
  pathname: string;
  query?: URLSearchParams;
  body?: Record<string, unknown>;
}

export type BridgeRouteResult =
  | { type: 'json'; status: number; body: unknown; headers?: Record<string, string> }
  | { type: 'stream'; run: (sink: BridgeStreamSink) => Promise<void> };

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export function json(status: number, body: unknown, headers: Record<string, string> = {}): BridgeRouteResult {
  return { type: 'json', status, body, headers: { ...JSON_HEADERS, ...headers } };
}

/**
 * Route one request. Never throws: failures become the standard Arabic error
 * envelope with the technical detail attached (Advanced Mode only).
 */
export async function routeBridgeRequest(
  host: EngineHost,
  request: BridgeRouteRequest,
): Promise<BridgeRouteResult> {
  const method = (request.method ?? 'GET').toUpperCase();
  const pathname = request.pathname;
  const body = (request.body ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  try {
    switch (`${method} ${pathname}`) {
      case 'GET /api/health':
        return json(200, {
          ok: true,
          app: 'Universal Router Manager',
          component:
            host.platformKind === 'bridge'
              ? 'local-bridge'
              : host.platformKind === 'device'
                ? 'device-shell'
                : 'engine-host',
          version: '1.0.0',
          developer: 'محمد إبراهيم أبو العز · Mohamed Ibrahim Abu El-Ezz',
          copyright: '© 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.',
          platform: { kind: host.platformKind, label: host.platformLabel },
          uptimeSeconds: Math.round(typeof performance !== 'undefined' ? performance.now() / 1000 : 0),
        });

      case 'GET /api/state':
        return json(200, {
          ok: true,
          session: host.sessionSnapshot(),
          state: host.stateSnapshot(),
          describe: host.describe(),
          snapshot: host.currentSnapshot ?? null,
          security: host.currentSecurity ?? null,
          notifications: host.allNotifications,
          routers: await host.savedRouters(),
        });

      case 'POST /api/mode':
        return json(200, {
          ok: true,
          state: await host.setMode(body.mode === 'real' ? 'real' : 'simulated', body.profileId),
        });

      case 'POST /api/discover':
        return json(200, { ok: true, discovery: await host.discover({}) });

      case 'POST /api/connect': {
        const result = await host.connect({
          host: typeof body.host === 'string' ? body.host : undefined,
          username: typeof body.username === 'string' ? body.username : undefined,
          password: typeof body.password === 'string' ? body.password : '',
          remember: body.remember === true,
          label: typeof body.label === 'string' ? body.label : undefined,
          fast: body.fast !== false,
        });
        return json(200, {
          ok: true,
          authenticated: result.authenticated,
          detail: result.detail,
          session: host.sessionSnapshot(),
          snapshot: host.currentSnapshot ?? null,
          security: host.currentSecurity ?? null,
          describe: host.describe(),
        });
      }

      case 'POST /api/connect-saved': {
        const result = await host.connectSaved(String(body.routerId), body.fast !== false);
        return json(200, {
          ok: true,
          authenticated: result.authenticated,
          session: host.sessionSnapshot(),
          snapshot: host.currentSnapshot ?? null,
        });
      }

      case 'POST /api/logout':
        await host.logout();
        return json(200, { ok: true });

      case 'GET /api/snapshot':
        return json(200, {
          ok: true,
          snapshot: (await host.refreshSnapshot()) ?? null,
          security: host.currentSecurity ?? null,
          describe: host.describe(),
        });

      case 'GET /api/security':
        await host.refreshSnapshot();
        return json(200, { ok: true, security: host.currentSecurity ?? null });

      case 'GET /api/wifi/neighbors':
        return json(200, { ok: true, neighbors: await host.wifiNeighbors() });

      case 'POST /api/operations': {
        const id = String(body.id ?? '') as OperationId;
        if (!id) throw new RouterError('invalid-params', { detail: 'operation id is required' });
        const result = await host.execute({
          id,
          params: (body.params ?? {}) as Record<string, unknown>,
          confirmed: body.confirmed === true,
        });
        return json(200, {
          ok: result.ok,
          result,
          snapshot: host.currentSnapshot ?? null,
          describe: host.describe(),
        });
      }

      case 'POST /api/reboot':
        return json(200, { ok: true, result: await host.reboot() });

      case 'GET /api/speedtest/plan':
        return json(200, { ok: true, plan: host.speedPlan() });

      case 'GET /api/speedtest/stream': {
        return {
          type: 'stream',
          run: async (sink) => {
            try {
              const result = await host.speedTest({
                onProgress: (phase, value) => sink.send('sample', { phase, value }),
                onPhase: (phase) => sink.send('phase', { phase }),
              });
              sink.send('result', result);
            } catch (error) {
              const routerError = toRouterError(error);
              sink.send('error', { code: routerError.code, message: routerError.userMessage });
            }
          },
        };
      }

      case 'POST /api/assistant':
        return json(200, { ok: true, reply: await host.assistant(String(body.text ?? '')) });

      case 'POST /api/smartfix/apply':
        return json(200, { ok: true, result: await host.applyPlan(body.plan) });

      case 'GET /api/diagnostics':
        return json(200, { ok: true, describe: host.describe(), describe_redacted: true });

      case 'GET /api/logs':
        return json(200, { ok: true, logs: host.describe().diagnostics });

      case 'GET /api/signatures':
        return json(200, { ok: true, meta: host.describe().signatures });

      case 'POST /api/signatures/pack': {
        const pack = body.pack as { meta?: { version?: string }; signatures?: unknown[] } | undefined;
        if (!pack?.signatures) throw new RouterError('invalid-params', { detail: 'pack.signatures is required' });
        const result = host.signatures.loadPack({
          meta: { version: pack.meta?.version ?? 'custom' },
          signatures: pack.signatures as never,
        });
        return json(200, { ok: true, ...result });
      }

      case 'GET /api/routers':
        return json(200, { ok: true, routers: await host.savedRouters() });

      case 'POST /api/routers/label':
        return json(200, { ok: true, routers: await host.renameRouter(String(body.id), String(body.label ?? '')) });

      case 'POST /api/routers/forget':
        return json(200, { ok: true, routers: await host.forgetRouter(String(body.id)) });

      case 'POST /api/notifications/read':
        host.markNotificationsRead();
        return json(200, { ok: true });

      case 'GET /api/export':
        // Diagnostics export: already redacted (no passwords, no tokens, no cookies).
        return json(
          200,
          { exportedAt: new Date().toISOString(), describe: host.describe() },
          { 'content-disposition': 'attachment; filename="urm-diagnostics.json"' },
        );

      default:
        return json(404, { ok: false, error: { code: 'unsupported-operation', message: 'unknown endpoint' } });
    }
  } catch (error) {
    const routerError = toRouterError(error);
    return json(routerError.status && routerError.status >= 400 ? routerError.status : 500, {
      ok: false,
      error: {
        code: routerError.code,
        message: routerError.userMessage,
        hint: routerError.userHint,
        technical: routerError.technicalMessage,
      },
    });
  }
}
