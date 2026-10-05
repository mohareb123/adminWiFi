/**
 * Redaction + logger.
 * Credentials, session tokens and router serial numbers must never reach a log
 * line, a diagnostics export or an error message (spec §40).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { RingBuffer } from './util';

const SECRET_KEYS = [
  'password',
  'passwd',
  'pwd',
  'pass',
  'token',
  'sessiontoken',
  'sessionid',
  'authorization',
  'auth',
  'cookie',
  'setcookie',
  'secret',
  'psk',
  'credential',
  'serial',
  'serialnumber',
];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEYS.includes(key.toLowerCase()) ? maskSecret(val) : redact(val, depth + 1);
  }
  return out;
}

function maskSecret(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '«redacted»';
  return `«redacted:${value.length}»`;
}

export function redactString(text: string): string {
  return (
    text
      .replace(/(basic|bearer)\s+[A-Za-z0-9+/=._-]{6,}/gi, '$1 «redacted»')
      .replace(/(password|passwd|pwd|pass|token|sessionid)=([^&\s"']+)/gi, '$1=«redacted»')
      .replace(/\b[a-f0-9]{32,}\b/gi, '«hash:redacted»')
  );
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };

export interface LogEntry {
  at: number;
  level: LogLevel;
  /** Module namespace, e.g. "adapters.huawei". */
  scope: string;
  message: string;
  data?: unknown;
}

export interface LoggerOptions {
  level?: LogLevel;
  capacity?: number;
  /** Optional sink (bridge writes to stdout, web keeps a ring buffer only). */
  sink?: (entry: LogEntry) => void;
}

/** Global defaults — module level, so there is no static-init ordering trap. */
const rootConfig: { level: LogLevel; sink?: (entry: LogEntry) => void } = { level: 'info' };

export class Logger {
  readonly entries: RingBuffer<LogEntry>;
  readonly capacity: number;
  private level: LogLevel;
  private sink?: (entry: LogEntry) => void;

  constructor(readonly scope: string, options: LoggerOptions = {}) {
    this.level = options.level ?? rootConfig.level;
    this.capacity = options.capacity ?? 500;
    this.entries = new RingBuffer<LogEntry>(this.capacity);
    this.sink = options.sink ?? rootConfig.sink;
  }

  static configure(options: { level?: LogLevel; sink?: (entry: LogEntry) => void }): void {
    if (options.level) rootConfig.level = options.level;
    if (options.sink) rootConfig.sink = options.sink;
  }

  /** Install a process-wide sink (the bridge prints to stdout). */
  static setDefaultSink(sink: ((entry: LogEntry) => void) | undefined): void {
    rootConfig.sink = sink;
  }

  static get rootLevel(): LogLevel {
    return rootConfig.level;
  }

  child(scope: string): Logger {
    return new Logger(`${this.scope}.${scope}`, { level: this.level, capacity: this.capacity, sink: this.sink });
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private write(level: LogLevel, message: string, data?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const entry: LogEntry = { at: Date.now(), level, scope: this.scope, message, data: redact(data) };
    this.entries.push(entry);
    this.sink?.(entry);
  }

  trace(message: string, data?: unknown): void {
    this.write('trace', message, data);
  }

  debug(message: string, data?: unknown): void {
    this.write('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.write('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.write('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.write('error', message, data);
  }

  /** Log ring buffer as plain objects — safe for the Advanced Mode log viewer. */
  snapshot(level: LogLevel = 'debug'): LogEntry[] {
    return this.entries.toArray().filter((entry) => LEVEL_ORDER[entry.level] >= LEVEL_ORDER[level]);
  }
}

export const createLogger = (scope: string, options?: LoggerOptions): Logger => new Logger(scope, options);
