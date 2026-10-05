/**
 * Low-level primitives: typed events, ring buffers, async helpers, hashing and
 * lightweight HTML/text utilities. Zero dependencies — must run identically in
 * Node (bridge), the browser and (later) a native Kotlin shell.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

/* ------------------------------------------------------------------ *
 * Typed event bus
 * ------------------------------------------------------------------ */

export type Listener<T> = (payload: T) => void;

export class TypedEmitter<Events extends object> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    // Copy to keep iteration safe when handlers unsubscribe.
    for (const listener of [...set]) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch {
        /* a broken listener must never break the engine */
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  get listenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }
}

/* ------------------------------------------------------------------ *
 * Ring buffer (bounded memory, O(1) push)
 * ------------------------------------------------------------------ */

export class RingBuffer<T> {
  private items: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    if (capacity <= 0) throw new RangeError('RingBuffer capacity must be > 0');
    this.items = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
  }

  get size(): number {
    return this.count;
  }

  /** Oldest → newest. */
  toArray(): T[] {
    const out: T[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i += 1) {
      out.push(this.items[(start + i) % this.capacity] as T);
    }
    return out;
  }

  last(): T | undefined {
    if (this.count === 0) return undefined;
    return this.items[(this.head - 1 + this.capacity) % this.capacity];
  }

  clear(): void {
    this.items = new Array<T | undefined>(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}

/** Fixed-capacity numeric series backed by a Float64Array (low GC pressure). */
export class NumericSeries {
  private data: Float64Array;
  private head = 0;
  private filled = 0;

  constructor(readonly capacity: number) {
    this.data = new Float64Array(capacity);
  }

  push(value: number): void {
    this.data[this.head] = Number.isFinite(value) ? value : 0;
    this.head = (this.head + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled += 1;
  }

  get size(): number {
    return this.filled;
  }

  /** Copy oldest → newest into a plain array (safe for UI snapshots). */
  toArray(): number[] {
    const out = new Array<number>(this.filled);
    const start = this.filled < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.filled; i += 1) out[i] = this.data[(start + i) % this.capacity];
    return out;
  }

  /** Most recent value. */
  get current(): number {
    if (this.filled === 0) return 0;
    return this.data[(this.head - 1 + this.capacity) % this.capacity];
  }

  max(): number {
    let m = 0;
    const arr = this.toArray();
    for (const v of arr) if (v > m) m = v;
    return m;
  }

  clear(): void {
    this.data.fill(0);
    this.head = 0;
    this.filled = 0;
  }
}

/* ------------------------------------------------------------------ *
 * Async helpers
 * ------------------------------------------------------------------ */

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  signal?: AbortSignal;
}

/** Exponential backoff with jitter — used for flaky router HTTP endpoints. */
export async function withRetry<T>(work: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const base = options.baseDelayMs ?? 120;
  const max = options.maxDelayMs ?? 1500;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work(attempt);
    } catch (error) {
      lastError = error;
      const retryable = options.shouldRetry ? options.shouldRetry(error, attempt) : true;
      if (!retryable || attempt === attempts) break;
      const delay = Math.min(max, base * 2 ** (attempt - 1)) * (0.75 + Math.random() * 0.5);
      options.onRetry?.(error, attempt, delay);
      await sleep(delay, options.signal);
    }
  }
  throw lastError;
}

/** Run promises with bounded concurrency (avoids hammering a router). */
export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  });
  await Promise.all(runners);
  return results;
}

/* ------------------------------------------------------------------ *
 * Numbers / formatting
 * ------------------------------------------------------------------ */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential smoothing for animated counters. */
export function smoothTowards(current: number, target: number, dtSeconds: number, halfLifeSeconds = 0.35): number {
  if (halfLifeSeconds <= 0) return target;
  const factor = 1 - Math.pow(0.5, dtSeconds / halfLifeSeconds);
  return current + (target - current) * factor;
}

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.+-]/g, '');
    const parsed = Number.parseFloat(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function formatKbps(kbps: number | undefined): string {
  if (kbps === undefined || !Number.isFinite(kbps)) return '—';
  if (kbps >= 1_000_000) return `${(kbps / 1_000_000).toFixed(2)} Gbps`;
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} Kbps`;
}

export function formatMbps(kbps: number | undefined): string {
  if (kbps === undefined || !Number.isFinite(kbps)) return '—';
  return (kbps / 1000).toFixed(1);
}

export function formatBytes(kb: number | undefined): string {
  if (kb === undefined || !Number.isFinite(kb)) return '—';
  if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${Math.round(kb)} KB`;
}

export function formatUptime(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}ي ${h}س`;
  if (h > 0) return `${h}س ${m}د`;
  return `${m}د`;
}

/* ------------------------------------------------------------------ *
 * Hashing (needed by several router login schemes)
 * ------------------------------------------------------------------ */

export function base64Encode(input: string): string {
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(unescape(encodeURIComponent(input)));
  }
  // eslint-disable-next-line no-undef
  return Buffer.from(input, 'utf8').toString('base64');
}

export function base64Decode(input: string): string {
  if (typeof globalThis.atob === 'function') {
    return decodeURIComponent(escape(globalThis.atob(input)));
  }
  // eslint-disable-next-line no-undef
  return Buffer.from(input, 'base64').toString('utf8');
}

/**
 * Compact, dependency-free MD5 (RFC 1321) — required by vendors whose login
 * forms submit an MD5 of the password (TP-Link, ZTE, Tenda, ...).
 */
export function md5(input: string, raw = false): string {
  const bytes = raw ? utf8ToBytes(input) : utf8ToBytes(input);
  return md5Bytes(bytes);
}

function utf8ToBytes(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return new Uint8Array(out);
}

function md5Bytes(input: Uint8Array): string {
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
    21,
  ];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i += 1) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

  const originalLengthBits = input.length * 8;
  const withPadding = new Uint8Array((((input.length + 8) >> 6) + 1) * 64);
  withPadding.set(input);
  withPadding[input.length] = 0x80;
  const view = new DataView(withPadding.buffer);
  view.setUint32(withPadding.length - 8, originalLengthBits >>> 0, true);
  view.setUint32(withPadding.length - 4, Math.floor(originalLengthBits / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const M = new Uint32Array(16);

  for (let offset = 0; offset < withPadding.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) M[i] = view.getUint32(offset + i * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i += 1) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + (M[g] as number)) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << (s[i] as number)) | (F >>> (32 - (s[i] as number))))) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return [...out].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const bytes = utf8ToBytes(input);
    // Copy into a plain ArrayBuffer — avoids the SharedArrayBuffer variance issue.
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const digest = await subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('SHA-256 unavailable in this runtime');
}

/** Stable, short, deterministic id (FNV-1a, base36) — used for devices/rules. */
export function stableId(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function randomId(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36).slice(-4);
  return `${prefix}${time}${rand}`;
}

/* ------------------------------------------------------------------ *
 * Text / HTML utilities (no DOM dependency — works in Node)
 * ------------------------------------------------------------------ */

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
}

export function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractTag(html: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(html);
  return match ? stripTags(match[1] as string) : undefined;
}

export function extractMeta(html: string, name: string): string | undefined {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*name=["']${name}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return match[1] as string;
  }
  return undefined;
}

export interface FormFieldInfo {
  name: string;
  type: string;
  id?: string;
  value?: string;
  placeholder?: string;
}

export function extractInputs(html: string): FormFieldInfo[] {
  const fields: FormFieldInfo[] = [];
  const inputRegex = /<input\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = inputRegex.exec(html))) {
    const tag = match[0];
    const attr = (name: string) => new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
    const name = attr('name') ?? attr('id');
    if (!name) continue;
    fields.push({
      name,
      type: (attr('type') ?? 'text').toLowerCase(),
      id: attr('id'),
      value: attr('value'),
      placeholder: attr('placeholder'),
    });
  }
  return fields;
}

export function extractFormActions(html: string): string[] {
  const actions: string[] = [];
  const regex = /<form\b[^>]*action\s*=\s*["']([^"']*)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) actions.push(match[1] as string);
  return actions;
}

export function extractAssets(html: string, kinds: string[] = ['css', 'js']): string[] {
  const out = new Set<string>();
  if (kinds.includes('css')) {
    for (const m of html.matchAll(/href\s*=\s*["']([^"']+\.css[^"']*)["']/gi)) out.add(m[1] as string);
  }
  if (kinds.includes('js')) {
    for (const m of html.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)) out.add(m[1] as string);
  }
  return [...out];
}

/** Extract `<script src>` paths only (used by login-page fingerprints). */
export function extractScriptPaths(html: string): string[] {
  return extractAssets(html, ['js']);
}

export function absoluteUrl(base: string, path: string): string {
  try {
    return new URL(path, base).toString();
  } catch {
    return path;
  }
}

/* ------------------------------------------------------------------ *
 * Fuzzy matching for signature scoring
 * ------------------------------------------------------------------ */

/** Dice coefficient on character bigrams, in [0,1]. Cheaper than Jaro-Winkler. */
export function similarity(a: string, b: string): number {
  const s1 = a.toLowerCase().replace(/\s+/g, ' ').trim();
  const s2 = b.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < s1.length - 1; i += 1) {
    const gram = s1.slice(i, i + 2);
    bigrams.set(gram, (bigrams.get(gram) ?? 0) + 1);
  }
  let matches = 0;
  for (let i = 0; i < s2.length - 1; i += 1) {
    const gram = s2.slice(i, i + 2);
    const count = bigrams.get(gram) ?? 0;
    if (count > 0) {
      bigrams.set(gram, count - 1);
      matches += 1;
    }
  }
  return (2 * matches) / (s1.length - 1 + (s2.length - 1));
}

/** Arabic-aware normalisation for the Smart Assistant's intent matching. */
export function normalizeArabic(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '') // tashkeel + tatweel
    .replace(/[أإآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse values like "10", "10 Mbps", "512 kbps", "1.5" into kbps. */
export function parseRateToKbps(value: string | number): number | undefined {
  if (typeof value === 'number') return Math.round(value);
  const match = /([\d.]+)\s*(gbps|mbps|mb\/s|kbps|kb\/s)?/i.exec(value.trim());
  if (!match) return undefined;
  const amount = Number.parseFloat(match[1] as string);
  if (!Number.isFinite(amount)) return undefined;
  const unit = (match[2] ?? '').toLowerCase();
  if (!unit) return Math.round(amount); // already kbps by convention
  if (unit === 'gbps') return Math.round(amount * 1_000_000);
  if (unit === 'kbps' || unit === 'kb/s') return Math.round(amount);
  return Math.round(amount * 1000); // Mbps
}

export function isValidIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

export function isValidMac(value: string): boolean {
  return /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(value.trim());
}

export function normalizeMac(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, ':');
}

export function isValidHostname(value: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(value.trim());
}

export function isValidSsid(value: string): boolean {
  return value.length >= 1 && value.length <= 32;
}

export function isValidWifiPassword(value: string): boolean {
  // WPA2: 8..63 printable ASCII, or 64 hex chars (raw PSK).
  if (/^[0-9a-f]{64}$/i.test(value)) return true;
  return value.length >= 8 && value.length <= 63 && /^[\x20-\x7e]+$/.test(value);
}

export function isValidDns(value: string): boolean {
  return isValidIpv4(value) || isValidHostname(value);
}

export function uniq<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

export function groupBy<T, K extends string>(items: readonly T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const k = key(item);
    (out[k] ??= []).push(item);
  }
  return out;
}
