/**
 * DeviceHttpTransport — the only place in the Android build that talks to real
 * router hardware.
 *
 * Why the native bridge instead of `fetch`:
 *  - a router management page is a *different origin* and sends no CORS headers,
 *    so a WebView `fetch` would be blocked (the UI's own `/api/*` calls are
 *    in-process, so they stay same-origin and unaffected);
 *  - it keeps cookies, timeouts and byte counters under our control, so the app
 *    can stay polite to the router (never a flood of requests).
 *
 * Self-signed HTTPS on a router is *not* silently trusted: the platform reports
 * `canTrustLanCertificates: false`, and detection prefers the router's HTTP
 * interface. See docs/ANDROID.md → Known limits.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

import { CapacitorHttp } from '@capacitor/core';
import { CookieJar, RouterError } from '@urlm/core';
import type { HttpRequestInit, HttpResponse, HttpTransport } from '@urlm/core';

const DEFAULT_UA = 'UniversalRouterManager/1.0 (Universal Router Adaptation System, Android)';

export class DeviceHttpTransport implements HttpTransport {
  readonly cookieJar = new CookieJar();
  readonly stats = { requests: 0, failures: 0, bytesIn: 0 };
  readonly capabilities = {
    kind: 'native' as const,
    canReadRoutingTable: true,
    canReachLan: true,
    canReadArp: false,
    canProbeLatency: true,
    canMeasureInternetSpeed: true,
    canSnmp: false,
    label: 'Android native HTTP',
  };

  get cookies(): CookieJar {
    return this.cookieJar;
  }

  private readonly defaultTimeoutMs: number;

  constructor(options: { defaultTimeoutMs?: number } = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 8000;
  }

  async request(init: HttpRequestInit): Promise<HttpResponse> {
    const method = (init.method ?? 'GET').toUpperCase();
    const timeoutMs = init.timeoutMs ?? this.defaultTimeoutMs;
    const useJar = init.useCookieJar ?? true;
    const started = dateNow();

    const headers: Record<string, string> = {
      'user-agent': DEFAULT_UA,
      accept: '*/*',
      ...(init.headers ?? {}),
    };
    if (useJar) {
      const cookieHeader = this.cookieJar.header(init.url);
      if (cookieHeader && !hasHeader(headers, 'cookie')) headers.cookie = cookieHeader;
    }
    const data = serializeBody(init.body, headers);

    this.stats.requests += 1;
    try {
      const raw = await withTimeout(
        CapacitorHttp.request({
          url: init.url,
          method,
          headers,
          data,
          responseType: 'text',
          connectTimeout: timeoutMs,
          readTimeout: timeoutMs,
          // Router UIs are frequently served from a bare IP with a self-signed
          // certificate; we never weaken TLS globally, we only allow the
          // platform's own policy for private hosts.
          shouldEncodeUrlParams: false,
        }),
        timeoutMs + 500,
      );

      const responseHeaders = normalizeHeaders(raw.headers);
      const body = typeof raw.data === 'string' ? raw.data : raw.data == null ? '' : JSON.stringify(raw.data);
      if (useJar) this.cookieJar.setFromResponse(init.url, setCookieOf(responseHeaders));
      this.stats.bytesIn += body.length;

      const durationMs = dateNow() - started;
      return {
        url: raw.url ?? init.url,
        status: raw.status ?? 0,
        statusText: String(raw.status ?? ''),
        headers: responseHeaders,
        body,
        durationMs,
        redirected: Boolean(raw.url && raw.url !== init.url),
        bytes: body.length,
      };
    } catch (error) {
      this.stats.failures += 1;
      const failure = error as Error & { code?: string };
      const code = failure.code === 'timeout' ? 'timeout' : 'network-unreachable';
      throw new RouterError(code, { url: init.url, detail: failure.message, cause: error });
    }
  }
}

let transport: DeviceHttpTransport | undefined;

/** Shared transport so every request reuses one cookie jar and one counter. */
export function deviceTransport(): DeviceHttpTransport {
  transport ??= new DeviceHttpTransport();
  return transport;
}

/* ------------------------------------------------------------------ */

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const wanted = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === wanted);
}

function serializeBody(
  body: HttpRequestInit['body'],
  headers: Record<string, string>,
): string | undefined {
  if (body === undefined) return undefined;
  if (typeof body === 'string') {
    if (!hasHeader(headers, 'content-type')) {
      headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }
    return body;
  }
  if (body instanceof URLSearchParams) {
    if (!hasHeader(headers, 'content-type')) {
      headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }
    return body.toString();
  }
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));
  return String(body);
}

function normalizeHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  }
  return normalized;
}

/** Capacitor joins repeated `set-cookie` headers; split them back apart safely. */
function setCookieOf(headers: Record<string, string>): string[] {
  const raw = headers['set-cookie'];
  if (!raw) return [];
  return raw
    .split(/,(?=\s*[^;,=\s]+=)/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^set-cookie:\s*/i, ''));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('request-timeout') as Error & { code?: string };
      error.code = 'timeout';
      reject(error);
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function dateNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}
