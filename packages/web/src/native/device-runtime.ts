/**
 * Device runtime — the whole Local Bridge, running inside the app.
 *
 * On Android there is no desktop bridge to talk to, so the app boots the
 * portable engine host itself and serves the *same* `/api/*` contract
 * in-process. The UI's HTTP calls and streams keep working unchanged; the only
 * difference is that they never leave the phone.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

import { EngineHost, routeBridgeRequest } from '@urlm/core';
import type { BridgeRouteResult } from '@urlm/core';
import type { BridgeRuntime, BridgeStream } from '../core/runtime';
import { createDevicePlatform } from './device-platform';
import { keystoreAvailable } from './native-bridge';

export async function createDeviceRuntime(): Promise<BridgeRuntime> {
  const sealed = await keystoreAvailable();
  const platform = createDevicePlatform({ sealed });
  const host = new EngineHost({ platform, persist: true, mode: 'simulated' });

  const listeners = new Set<(event: string, payload: unknown) => void>();
  host.on((event, payload) => {
    for (const listener of listeners) {
      try {
        listener(event as string, payload);
      } catch {
        /* a broken listener must never break the host */
      }
    }
  });

  function dispatchEvent(target: EventTarget, type: string, payload: unknown): void {
    try {
      target.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(payload) }));
    } catch {
      const event = new Event(type);
      Object.assign(event, { data: JSON.stringify(payload) });
      target.dispatchEvent(event);
    }
  }

  async function route(pathname: string, search: string, init: RequestInit): Promise<BridgeRouteResult> {
    const method = (init.method ?? 'GET').toUpperCase();
    let body: Record<string, unknown> | undefined;
    if (typeof init.body === 'string' && init.body.trim()) {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = undefined;
      }
    }
    return routeBridgeRequest(host, {
      method,
      pathname,
      query: new URLSearchParams(search),
      body,
    });
  }

  return {
    kind: 'device',
    label: 'Android device shell (on-phone engine)',

    async fetch(path: string, init: RequestInit = {}): Promise<Response> {
      const url = new URL(path, 'http://localhost');
      const result = await route(url.pathname, url.search, init);
      if (result.type === 'json') {
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: { 'content-type': 'application/json; charset=utf-8', ...(result.headers ?? {}) },
        });
      }
      // A stream endpoint has no single response body; the UI always opens those
      // through openStream(), so this is a defensive answer, not a normal path.
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'unsupported-operation', message: 'stream endpoint used as a request' } }),
        { status: 400, headers: { 'content-type': 'application/json; charset=utf-8' } },
      );
    },

    openStream(path: string): BridgeStream {
      const url = new URL(path, 'http://localhost');
      const target = new EventTarget();
      const abort = new AbortController();

      const start = async (): Promise<void> => {
        // Emulate the bridge's opening frames so the store's state machine is identical.
        queueMicrotask(() => target.dispatchEvent(new Event('open')));

        if (url.pathname === '/api/speedtest/stream') {
          const result = await route(url.pathname, url.search, { method: 'GET' });
          if (result.type === 'json') {
            dispatchEvent(target, 'error', result.body);
            return;
          }
          await result.run({
            send: (event, payload) => {
              if (abort.signal.aborted) return;
              dispatchEvent(target, event, payload);
            },
          });
          return;
        }

        if (url.pathname === '/api/stream') {
          dispatchEvent(target, 'state', { state: host.stateSnapshot(), describe: host.describe() });
          const listener = (event: string, payload: unknown): void => {
            if (abort.signal.aborted) return;
            dispatchEvent(target, event, payload);
          };
          listeners.add(listener);
          abort.signal.addEventListener('abort', () => listeners.delete(listener), { once: true });
          return;
        }

        dispatchEvent(target, 'error', { code: 'unsupported-operation', message: 'unknown stream endpoint' });
      };

      void start().catch((error) => {
        dispatchEvent(target, 'error', { code: 'unknown', message: (error as Error)?.message ?? 'stream failed' });
      });

      return {
        addEventListener: (type, listener) => target.addEventListener(type, listener as unknown as EventListener),
        close: () => abort.abort(),
      };
    },

    async ready() {
      try {
        const result = await routeBridgeRequest(host, { method: 'GET', pathname: '/api/health' });
        const ok = result.type === 'json' && result.status === 200;
        return { ok, platform: 'device-shell' };
      } catch (error) {
        return { ok: false, error: (error as Error)?.message ?? 'device-host-failed' };
      }
    },

    dispose() {
      listeners.clear();
      void host.shutdown();
    },
  };
}
