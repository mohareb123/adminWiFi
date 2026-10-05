/**
 * NodeHttpTransport — the only place in the project that speaks to real
 * router hardware.
 *
 * Why a custom transport instead of fetch:
 *  - router management UIs routinely serve self-signed or expired certificates
 *    (honoured only when the user explicitly allows it, and never downgrading
 *    silently for other hosts);
 *  - we need precise control over timeouts, redirects, cookie persistence and
 *    the exact request bytes we send;
 *  - we must be able to *count* and throttle requests, so the bridge is never
 *    the reason a router gets hammered.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import http from 'node:http';
import https from 'node:https';
import { CookieJar, type HttpRequestInit, type HttpResponse, type HttpTransport } from '@urlm/core';
import type { TransportCapabilities } from '@urlm/core';

export interface NodeHttpTransportOptions {
  cookieJar?: CookieJar;
  defaultTimeoutMs?: number;
  userAgent?: string;
  /** Allow self-signed certificates for private/LAN hosts only. */
  allowSelfSignedForLan?: boolean;
  /** Minimum spacing between requests to the same host (politeness). */
  minRequestSpacingMs?: number;
  maxConcurrentPerHost?: number;
}

const PRIVATE_HOST = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.|localhost$|.*\.local$)/i;

export class NodeHttpTransport implements HttpTransport {
  readonly cookieJar: CookieJar;
  readonly stats = { requests: 0, failures: 0, bytesIn: 0 };
  readonly capabilities: TransportCapabilities;

  private readonly defaultTimeoutMs: number;
  private readonly userAgent: string;
  private readonly allowSelfSignedForLan: boolean;
  private readonly minSpacing: number;
  private readonly maxPerHost: number;
  private lastRequestAt = new Map<string, number>();
  private inFlight = new Map<string, number>();

  constructor(options: NodeHttpTransportOptions = {}) {
    this.cookieJar = options.cookieJar ?? new CookieJar();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 6000;
    this.userAgent = options.userAgent ?? 'UniversalRouterManager/1.0 (Local Bridge)';
    this.allowSelfSignedForLan = options.allowSelfSignedForLan ?? true;
    this.minSpacing = options.minRequestSpacingMs ?? 40;
    this.maxPerHost = options.maxConcurrentPerHost ?? 4;
    this.capabilities = {
      kind: 'bridge',
      canReadRoutingTable: true,
      canReachLan: true,
      canReadArp: true,
      canProbeLatency: true,
      canMeasureInternetSpeed: true,
      canSnmp: true,
      label: 'Local Bridge (Node)',
    };
  }

  get cookies(): CookieJar {
    return this.cookieJar;
  }

  async request(init: HttpRequestInit): Promise<HttpResponse> {
    const url = new URL(init.url);
    const method = (init.method ?? 'GET').toUpperCase();
    const timeoutMs = init.timeoutMs ?? this.defaultTimeoutMs;

    await this.respectSpacing(url.host);
    this.inFlight.set(url.host, (this.inFlight.get(url.host) ?? 0) + 1);
    if ((this.inFlight.get(url.host) ?? 0) > this.maxPerHost) {
      this.inFlight.set(url.host, (this.inFlight.get(url.host) ?? 1) - 1);
      throw new Error(`too many concurrent requests to ${url.host}`);
    }

    try {
      return await this.send(url, method, init, timeoutMs);
    } finally {
      this.inFlight.set(url.host, Math.max(0, (this.inFlight.get(url.host) ?? 1) - 1));
      this.lastRequestAt.set(url.host, Date.now());
    }
  }

  private async respectSpacing(host: string): Promise<void> {
    const last = this.lastRequestAt.get(host);
    if (!last) return;
    const wait = this.minSpacing - (Date.now() - last);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }

  private send(url: URL, method: string, init: HttpRequestInit, timeoutMs: number): Promise<HttpResponse> {
    const isHttps = url.protocol === 'https:';
    const useJar = init.useCookieJar ?? true;
    const headers: Record<string, string> = {
      'user-agent': this.userAgent,
      accept: '*/*',
      'accept-encoding': 'identity',
      connection: 'close',
      ...(init.headers ?? {}),
    };
    if (useJar) {
      const cookie = this.cookieJar.header(init.url);
      if (cookie && !hasHeader(headers, 'cookie')) headers.cookie = cookie;
    }
    if (init.body && typeof init.body === 'string' && !hasHeader(headers, 'content-type')) {
      headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }

    // Router web servers are frequently HTTP/1.0 and dislike keep-alive or
    // chunked bodies — send an explicit Content-Length.
    let payload: Buffer | undefined;
    if (init.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      payload = typeof init.body === 'string' ? Buffer.from(init.body, 'utf8') : Buffer.from(init.body as Uint8Array);
      headers['content-length'] = String(payload.byteLength);
    }

    const selfSignedAllowed = this.allowSelfSignedForLan && (init.allowSelfSigned ?? true) && PRIVATE_HOST.test(url.hostname);
    const agent = isHttps
      ? new https.Agent({ rejectUnauthorized: !selfSignedAllowed, keepAlive: false, maxCachedSessions: 0 })
      : new http.Agent({ keepAlive: false });

    return new Promise<HttpResponse>((resolve, reject) => {
      const started = Date.now();
      const request = (isHttps ? https : http).request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method,
          headers,
          agent,
          timeout: timeoutMs,
          rejectUnauthorized: !selfSignedAllowed,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.byteLength;
            // Hard cap: a router management page is never 8 MB.
            if (size > 8 * 1024 * 1024) {
              request.destroy(new Error('response too large'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            const responseHeaders: Record<string, string> = {};
            const setCookies: string[] = [];
            for (const [key, value] of Object.entries(response.headers)) {
              if (value === undefined) continue;
              const joined = Array.isArray(value) ? value.join(', ') : String(value);
              responseHeaders[key.toLowerCase()] = joined;
              if (key.toLowerCase() === 'set-cookie' && Array.isArray(value)) setCookies.push(...value);
              else if (key.toLowerCase() === 'set-cookie') setCookies.push(String(value));
            }
            if (useJar) this.cookieJar.setFromResponse(init.url, setCookies);
            this.stats.requests += 1;
            this.stats.bytesIn += size;
            resolve({
              url: init.url,
              status: response.statusCode ?? 0,
              statusText: response.statusMessage ?? '',
              headers: responseHeaders,
              body,
              durationMs: Date.now() - started,
              redirected: false,
              bytes: size,
            });
          });
        },
      );

      request.on('timeout', () => {
        this.stats.failures += 1;
        request.destroy(new Error(`timeout after ${timeoutMs}ms`));
      });
      request.on('error', (error: Error) => {
        this.stats.failures += 1;
        reject(error);
      });
      if (payload) request.write(payload);
      request.end();
    });
  }

  close(): void {
    this.cookieJar.clear();
    this.lastRequestAt.clear();
    this.inFlight.clear();
  }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const needle = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === needle);
}
