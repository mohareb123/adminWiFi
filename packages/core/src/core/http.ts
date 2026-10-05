/**
 * HTTP layer: request/response contracts, a real cookie jar (router session
 * management is cookie based on the vast majority of devices) and an
 * isomorphic fetch transport.
 *
 * Nothing here is vendor specific — adapters build on top of it.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { RouterError, errorCodeFromStatus, toRouterError } from './errors';
import type { TransportCapabilities } from './types';
import { redact } from './logger';

export interface HttpRequestInit {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams | Uint8Array | ArrayBuffer;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Send cookies from the jar and store Set-Cookie responses. */
  useCookieJar?: boolean;
  /** Router management pages routinely use self-signed certificates. */
  allowSelfSigned?: boolean;
  maxRedirects?: number;
}

export interface HttpResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  redirected: boolean;
  /** Bytes actually transferred, when known (used by diagnostics). */
  bytes?: number;
}

export interface HttpTransport {
  readonly capabilities: TransportCapabilities;
  request(init: HttpRequestInit): Promise<HttpResponse>;
  /** Counters for Advanced Mode → Diagnostics. */
  readonly stats?: { requests: number; failures: number; bytesIn: number };
  /** Session cookies, when the transport keeps a jar (used for fingerprinting). */
  readonly cookies?: CookieJar;
  close?(): void;
}

/* ------------------------------------------------------------------ *
 * Cookie jar
 * ------------------------------------------------------------------ */

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expiresAt?: number;
  secure?: boolean;
  httpOnly?: boolean;
}

export class CookieJar {
  private cookies: StoredCookie[] = [];

  setFromResponse(url: string, setCookieHeaders: string[]): void {
    let origin: URL;
    try {
      origin = new URL(url);
    } catch {
      return;
    }
    for (const raw of setCookieHeaders) {
      const cookie = this.parseSetCookie(raw, origin.hostname);
      if (!cookie) continue;
      if (cookie.expiresAt !== undefined && cookie.expiresAt <= Date.now()) {
        this.remove(cookie.name, cookie.domain, cookie.path);
        continue;
      }
      const index = this.cookies.findIndex(
        (existing) =>
          existing.name === cookie.name && existing.domain === cookie.domain && existing.path === cookie.path,
      );
      if (index >= 0) this.cookies[index] = cookie;
      else this.cookies.push(cookie);
      if (this.cookies.length > 120) this.cookies.splice(0, this.cookies.length - 120);
    }
  }

  header(url: string): string | undefined {
    let origin: URL;
    try {
      origin = new URL(url);
    } catch {
      return undefined;
    }
    const now = Date.now();
    const matches = this.cookies.filter((cookie) => {
      if (cookie.expiresAt !== undefined && cookie.expiresAt <= now) return false;
      if (cookie.secure && origin.protocol !== 'https:') return false;
      if (!domainMatches(origin.hostname, cookie.domain)) return false;
      return origin.pathname.startsWith(cookie.path || '/');
    });
    if (matches.length === 0) return undefined;
    return matches.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  }

  names(url: string): string[] {
    return (this.header(url) ?? '')
      .split(';')
      .map((part) => part.split('=')[0]?.trim() ?? '')
      .filter(Boolean);
  }

  get(name: string): string | undefined {
    return this.cookies.find((cookie) => cookie.name === name)?.value;
  }

  set(name: string, value: string, domain: string, path = '/'): void {
    this.cookies.push({ name, value, domain, path });
  }

  remove(name: string, domain?: string, path?: string): void {
    this.cookies = this.cookies.filter(
      (cookie) => !(cookie.name === name && (!domain || cookie.domain === domain) && (!path || cookie.path === path)),
    );
  }

  clear(): void {
    this.cookies = [];
  }

  /** Names only — never leaks values into diagnostics. */
  snapshot(): Array<{ name: string; domain: string; path: string }> {
    return this.cookies.map(({ name, domain, path }) => ({ name, domain, path }));
  }

  private parseSetCookie(raw: string, hostname: string): StoredCookie | undefined {
    const parts = raw.split(';');
    const [pair, ...attributes] = parts;
    if (!pair) return undefined;
    const eq = pair.indexOf('=');
    if (eq <= 0) return undefined;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) return undefined;

    const cookie: StoredCookie = { name, value, domain: hostname, path: '/' };
    for (const attribute of attributes) {
      const [rawKey, ...rest] = attribute.split('=');
      const key = (rawKey ?? '').trim().toLowerCase();
      const attrValue = rest.join('=').trim();
      if (key === 'domain' && attrValue) cookie.domain = attrValue.replace(/^\./, '').toLowerCase();
      else if (key === 'path' && attrValue) cookie.path = attrValue;
      else if (key === 'max-age' && attrValue) cookie.expiresAt = Date.now() + Number(attrValue) * 1000;
      else if (key === 'expires' && attrValue) {
        const time = Date.parse(attrValue);
        if (!Number.isNaN(time)) cookie.expiresAt = time;
      } else if (key === 'secure') cookie.secure = true;
      else if (key === 'httponly') cookie.httpOnly = true;
    }
    return cookie;
  }
}

function domainMatches(hostname: string, cookieDomain: string): boolean {
  const host = hostname.toLowerCase();
  const domain = cookieDomain.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

/* ------------------------------------------------------------------ *
 * Fetch transport
 * ------------------------------------------------------------------ */

export interface FetchTransportOptions {
  cookieJar?: CookieJar;
  defaultTimeoutMs?: number;
  userAgent?: string;
  /** Set to true when running inside a browser page served over https. */
  browserMixedContentGuard?: boolean;
  allowSelfSigned?: boolean;
  capabilities?: Partial<TransportCapabilities>;
  extraHeaders?: Record<string, string>;
}

const DEFAULT_UA = 'UniversalRouterManager/1.0 (Universal Router Adaptation System)';

export class FetchHttpTransport implements HttpTransport {
  readonly cookieJar: CookieJar;
  readonly stats = { requests: 0, failures: 0, bytesIn: 0 };
  readonly capabilities: TransportCapabilities;

  /** Alias so the fingerprint engine can inspect cookie *names* only. */
  get cookies(): CookieJar {
    return this.cookieJar;
  }
  private readonly defaultTimeoutMs: number;
  private readonly userAgent: string;
  private readonly allowSelfSigned: boolean;
  private readonly extraHeaders: Record<string, string>;
  private readonly mixedContentGuard: boolean;

  constructor(options: FetchTransportOptions = {}) {
    this.cookieJar = options.cookieJar ?? new CookieJar();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 6000;
    this.userAgent = options.userAgent ?? DEFAULT_UA;
    this.allowSelfSigned = options.allowSelfSigned ?? true;
    this.extraHeaders = options.extraHeaders ?? {};
    const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
    this.mixedContentGuard = options.browserMixedContentGuard ?? isBrowser;
    this.capabilities = {
      kind: isBrowser ? 'browser' : 'native',
      canReadRoutingTable: false,
      canReachLan: !isBrowser || (typeof window !== 'undefined' && window.location.protocol === 'http:'),
      canReadArp: false,
      canProbeLatency: !isBrowser,
      canMeasureInternetSpeed: true,
      canSnmp: false,
      label: isBrowser ? 'Browser HTTP' : 'Native HTTP',
      ...options.capabilities,
    };
  }

  async request(init: HttpRequestInit): Promise<HttpResponse> {
    const method = (init.method ?? 'GET').toUpperCase();
    const timeoutMs = init.timeoutMs ?? this.defaultTimeoutMs;
    const useJar = init.useCookieJar ?? true;

    if (this.mixedContentGuard && typeof window !== 'undefined') {
      const page = window.location;
      const target = safeUrl(init.url);
      if (page.protocol === 'https:' && target?.protocol === 'http:') {
        throw new RouterError('network-unreachable', {
          url: init.url,
          detail: 'mixed-content-blocked',
        });
      }
    }

    const headers: Record<string, string> = {
      'user-agent': this.userAgent,
      accept: '*/*',
      ...this.extraHeaders,
      ...(init.headers ?? {}),
    };
    if (useJar) {
      const cookieHeader = this.cookieJar.header(init.url);
      if (cookieHeader && !hasHeader(headers, 'cookie')) headers.cookie = cookieHeader;
    }
    if (init.body && typeof init.body === 'string' && !hasHeader(headers, 'content-type')) {
      headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    init.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = nowMs();

    try {
      const response = await fetch(init.url, {
        method,
        headers,
        body: (init.body as BodyInit | undefined) ?? undefined,
        redirect: (init.maxRedirects ?? 3) > 0 ? 'follow' : 'manual',
        signal: controller.signal,
      });
      const text = await response.text();
      const responseHeaders: Record<string, string> = {};
      const setCookies: string[] = [];
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
        if (key.toLowerCase() === 'set-cookie') setCookies.push(value);
      });
      // Fetch merges set-cookie; recover the raw list when available.
      const rawSetCookie = getRawSetCookies(response);
      if (useJar) this.cookieJar.setFromResponse(response.url || init.url, rawSetCookie.length ? rawSetCookie : setCookies);

      this.stats.requests += 1;
      this.stats.bytesIn += text.length;
      return {
        url: response.url || init.url,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: text,
        durationMs: nowMs() - started,
        redirected: response.redirected,
        bytes: text.length,
      };
    } catch (error) {
      this.stats.failures += 1;
      const isAbort = (error as { name?: string })?.name === 'AbortError';
      if (isAbort) {
        throw new RouterError('timeout', { url: init.url, detail: `timed out after ${timeoutMs}ms`, cause: error });
      }
      throw toRouterError(error);
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', onAbort);
    }
  }
}

function getRawSetCookies(response: Response): string[] {
  const withGetSetCookie = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === 'function') return withGetSetCookie.getSetCookie();
  const combined = response.headers.get('set-cookie');
  if (!combined) return [];
  // Naive split — only used when getSetCookie is unavailable (older engines).
  return combined.split(/,(?=[^;=]+=)/g);
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

function safeUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/* ------------------------------------------------------------------ *
 * Session-scoped HTTP facade used by adapters
 * ------------------------------------------------------------------ */

export interface HttpSessionOptions {
  transport: HttpTransport;
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called before every request — lets strategies inject freshness tokens. */
  beforeRequest?: (init: HttpRequestInit) => HttpRequestInit | Promise<HttpRequestInit>;
}

/** Thin, ergonomic wrapper: relative URLs, JSON helpers, form posting, retries. */
export class HttpSession {
  constructor(private readonly options: HttpSessionOptions) {}

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  get transport(): HttpTransport {
    return this.options.transport;
  }

  resolve(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return new URL(pathOrUrl, this.options.baseUrl).toString();
  }

  async request(init: HttpRequestInit): Promise<HttpResponse> {
    const prepared: HttpRequestInit = {
      timeoutMs: this.options.timeoutMs ?? 6000,
      signal: this.options.signal,
      headers: { ...(this.options.defaultHeaders ?? {}), ...(init.headers ?? {}) },
      ...init,
      url: this.resolve(init.url),
    };
    const finalInit = this.options.beforeRequest ? await this.options.beforeRequest(prepared) : prepared;
    const response = await this.options.transport.request(finalInit);
    if (response.status >= 500 && response.status < 600) {
      throw new RouterError('network-unreachable', {
        status: response.status,
        url: response.url,
        detail: 'router returned a server error',
        technicalResponseSample: redact(response.body.slice(0, 200)) as string,
      });
    }
    return response;
  }

  async getText(path: string, init: Omit<HttpRequestInit, 'url' | 'method'> = {}): Promise<string> {
    const response = await this.request({ ...init, url: path, method: 'GET' });
    return response.body;
  }

  async getJson<T>(path: string, init: Omit<HttpRequestInit, 'url' | 'method'> = {}): Promise<T> {
    const body = await this.getText(path, init);
    return parseJsonLoose<T>(body, this.resolve(path));
  }

  async postForm(path: string, data: Record<string, string>, init: Omit<HttpRequestInit, 'url' | 'method'> = {}) {
    return this.request({
      ...init,
      url: path,
      method: 'POST',
      body: new URLSearchParams(data).toString(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        ...(init.headers ?? {}),
      },
    });
  }

  async postJson<T>(path: string, data: unknown, init: Omit<HttpRequestInit, 'url' | 'method'> = {}): Promise<T> {
    const response = await this.request({
      ...init,
      url: path,
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'content-type': 'application/json; charset=UTF-8', ...(init.headers ?? {}) },
    });
    return parseJsonLoose<T>(response.body, response.url);
  }

  setBaseUrl(baseUrl: string): void {
    this.options.baseUrl = baseUrl;
  }

  /** True when the body looks like the router's login page (session expired). */
  looksLikeLoginPage(body: string): boolean {
    const text = body.toLowerCase();
    return (
      (text.includes('password') || text.includes('passwd')) &&
      (text.includes('<form') || text.includes('login') || text.includes('signin'))
    );
  }
}

export function parseJsonLoose<T>(body: string, url = ''): T {
  const trimmed = body.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Some vendors prefix JSON with anti-hijacking tokens.
    const match = /^\s*[^[{]*([\s\S]*)$/.exec(trimmed);
    if (match) {
      const candidate = stripJsonPreamble(match[1] as string);
      try {
        return JSON.parse(candidate) as T;
      } catch {
        /* fall through */
      }
    }
    throw new RouterError('parse-error', {
      url,
      detail: `expected JSON, received ${trimmed.slice(0, 40).replace(/\s+/g, ' ')}...`,
    });
  }
}

function stripJsonPreamble(text: string): string {
  const firstBrace = text.search(/[[{]/);
  if (firstBrace > 0) return text.slice(firstBrace);
  return text.replace(/^[^{[]*/, '');
}

export function ensureOk(response: HttpResponse, expectJson = false): HttpResponse {
  if (response.status >= 200 && response.status < 400) return response;
  throw new RouterError(errorCodeFromStatus(response.status), {
    status: response.status,
    url: response.url,
    technicalResponseSample: redact(response.body.slice(0, 200)) as string,
    detail: expectJson ? 'unexpected status for JSON request' : undefined,
  });
}
