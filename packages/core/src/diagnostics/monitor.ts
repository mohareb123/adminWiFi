/**
 * Internet / network monitor (spec §19) + bandwidth history (spec §16).
 *
 * Design for smoothness:
 *  - samples land in pre-allocated ring buffers (no arrays growing forever);
 *  - overlapping requests are impossible (a busy probe is skipped, never queued);
 *  - the cadence relaxes automatically when the page/tab is hidden;
 *  - listeners get a *single* batched event per tick so the UI re-renders once.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { RingBuffer, TypedEmitter, formatKbps } from '../core/util';
import type { BandwidthSample, NetworkSnapshot } from '../core/types';

export interface ProbeResult {
  latencyMs: number;
  /** Optional packet loss percentage (0..100) when the transport can measure it. */
  packetLossPct?: number;
  /** True when the probe reached the router. */
  reachable: boolean;
}

export interface MonitorSample {
  at: number;
  latencyMs?: number;
  jitterMs?: number;
  packetLossPct?: number;
  downKbps?: number;
  upKbps?: number;
  online: boolean;
}

export interface MonitorEvents {
  sample: MonitorSample;
  history: { latency: number[]; down: number[]; up: number[] };
  status: { online: boolean; latencyMs?: number; downKbps?: number; upKbps?: number };
}

export interface MonitorOptions {
  /** Latency probe (bridge: ICMP/TCP; browser: fetch timing). */
  probe: (signal?: AbortSignal) => Promise<ProbeResult>;
  /** Throughput source (router counters). Optional. */
  rates?: (signal?: AbortSignal) => Promise<BandwidthSample>;
  intervalMs?: number;
  hiddenIntervalMs?: number;
  historySize?: number;
  signal?: AbortSignal;
  /** Called when connectivity changes — drives notifications (spec §48). */
  onStatusChange?: (online: boolean) => void;
}

export class InternetMonitor extends TypedEmitter<MonitorEvents> {
  private timer?: ReturnType<typeof setTimeout>;
  private busy = false;
  private stopped = true;
  private historySize: number;
  private latency: RingBuffer<number>;
  private down: RingBuffer<number>;
  private up: RingBuffer<number>;
  private consecutiveFailures = 0;
  private lastLatency = 0;
  private online = true;

  constructor(private readonly options: MonitorOptions) {
    super();
    this.historySize = options.historySize ?? 90;
    this.latency = new RingBuffer<number>(this.historySize);
    this.down = new RingBuffer<number>(this.historySize);
    this.up = new RingBuffer<number>(this.historySize);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  get isRunning(): boolean {
    return !this.stopped;
  }

  get latest(): MonitorSample {
    return {
      at: Date.now(),
      latencyMs: this.lastLatency || undefined,
      downKbps: this.down.last(),
      upKbps: this.up.last(),
      online: this.online,
    };
  }

  history(): { latency: number[]; down: number[]; up: number[] } {
    return { latency: this.latency.toArray(), down: this.down.toArray(), up: this.up.toArray() };
  }

  /** Ingest a router snapshot's rates without an extra poll. */
  ingestSnapshot(snapshot: NetworkSnapshot): void {
    const down = snapshot.internet.downKbps ?? 0;
    const up = snapshot.internet.upKbps ?? 0;
    this.down.push(down);
    this.up.push(up);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private interval(): number {
    const hidden =
      typeof document !== 'undefined' && typeof document.visibilityState === 'string' && document.visibilityState === 'hidden';
    const base = this.options.intervalMs ?? 2000;
    return hidden ? (this.options.hiddenIntervalMs ?? 8000) : base;
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    if (this.busy) {
      this.schedule(this.interval());
      return;
    }
    this.busy = true;
    try {
      const [probe, rates] = await Promise.all([
        this.options.probe(this.options.signal).catch(() => ({ latencyMs: 0, reachable: false }) as ProbeResult),
        this.options.rates
          ? this.options.rates(this.options.signal).catch(() => undefined)
          : Promise.resolve(undefined),
      ]);

      const jitter = this.lastLatency > 0 && probe.latencyMs > 0 ? Math.abs(probe.latencyMs - this.lastLatency) : 0;
      if (probe.reachable && probe.latencyMs > 0) this.lastLatency = probe.latencyMs;

      this.latency.push(probe.reachable ? probe.latencyMs : 0);
      if (rates) {
        this.down.push(rates.downKbps);
        this.up.push(rates.upKbps);
      } else {
        this.down.push(this.down.last() ?? 0);
        this.up.push(this.up.last() ?? 0);
      }

      const sample: MonitorSample = {
        at: Date.now(),
        latencyMs: probe.reachable ? probe.latencyMs : undefined,
        jitterMs: jitter || undefined,
        packetLossPct: probe.packetLossPct,
        downKbps: this.down.last(),
        upKbps: this.up.last(),
        online: probe.reachable,
      };

      if (probe.reachable) this.consecutiveFailures = 0;
      else this.consecutiveFailures += 1;
      const online = this.consecutiveFailures < 3;
      if (online !== this.online) {
        this.online = online;
        this.options.onStatusChange?.(online);
      }

      this.emit('sample', sample);
      this.emit('status', {
        online,
        latencyMs: sample.latencyMs,
        downKbps: sample.downKbps,
        upKbps: sample.upKbps,
      });
      this.emit('history', this.history());
    } finally {
      this.busy = false;
      this.schedule(this.interval());
    }
  }

  /** One-shot latency average, used by Smart Fix analysis. */
  async measureAverage(samples = 3): Promise<{ latencyMs: number; lossPct: number }> {
    let total = 0;
    let ok = 0;
    for (let i = 0; i < samples; i += 1) {
      const result = await this.options.probe(this.options.signal).catch(() => ({ latencyMs: 0, reachable: false }));
      if (result.reachable) {
        total += result.latencyMs;
        ok += 1;
      }
    }
    return { latencyMs: ok ? total / ok : 0, lossPct: ((samples - ok) / samples) * 100 };
  }

  describe(): string {
    return `${this.lastLatency ? `${Math.round(this.lastLatency)} ms` : '—'} ↓ ${formatKbps(this.down.last() ?? 0)} ↑ ${formatKbps(this.up.last() ?? 0)}`;
  }
}

/** Browser-side latency probe: measures management-page round-trip time. */
export function createFetchLatencyProbe(options: {
  url: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): (signal?: AbortSignal) => Promise<ProbeResult> {
  const timeout = options.timeoutMs ?? 2500;
  const fetcher = options.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  return async (signal?: AbortSignal) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const start = now();
    try {
      const response = await fetcher(`${options.url}${options.url.includes('?') ? '&' : '?'}_=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        signal: signal ?? controller.signal,
      });
      const elapsed = now() - start;
      return { latencyMs: elapsed, reachable: response.status < 500 };
    } catch {
      return { latencyMs: 0, reachable: false, packetLossPct: 100 };
    } finally {
      clearTimeout(timer);
    }
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
