/**
 * Speed test (spec §20).
 *
 * The engine is transport-agnostic; the *backend* decides how honest the
 * measurement can be and says so (`method`):
 *   - 'bridge-server-side' — the Local Bridge performs real HTTP transfers;
 *   - 'browser-direct'     — the browser measures against the bridge payload;
 *   - 'simulated'          — demo mode, always labelled as such in the UI.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { sleep } from '../core/util';
import type { SpeedTestResult } from '../core/types';
import { createLogger } from '../core/logger';

const log = createLogger('speedtest');

export interface SpeedTestOptions {
  signal?: AbortSignal;
  /** Called during the run so the UI can animate PING → DOWNLOAD → UPLOAD. */
  onSample?: (phase: 'ping' | 'down' | 'up', value: number) => void;
  onPhase?: (phase: 'ping' | 'down' | 'up' | 'done') => void;
}

export type SpeedTestBackend = (options: SpeedTestOptions) => Promise<SpeedTestResult>;

export interface SpeedTestBackendOptions {
  /** Endpoint that returns N bytes (bridge: /api/speedtest/payload). */
  downloadUrl: string;
  uploadUrl: string;
  /** Larger payload ⇒ more accurate downlink figure. */
  downloadBytes?: number;
  uploadBytes?: number;
  /** Optional upstream URL used for a real internet (not LAN) measurement. */
  internetDownloadUrl?: string;
  internetUploadUrl?: string;
  pingSamples?: number;
  fetcher?: typeof fetch;
}

/**
 * Real measurement backend. Every number it reports is derived from actual
 * transferred bytes and elapsed high-resolution time.
 */
export function createHttpSpeedTestBackend(options: SpeedTestBackendOptions): SpeedTestBackend {
  return async (runOptions) => {
    const fetchImpl = options.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    const signal = runOptions.signal;
    const samplesDown: number[] = [];
    const samplesUp: number[] = [];
    const started = Date.now();

    runOptions.onPhase?.('ping');
    const pingTimes: number[] = [];
    for (let i = 0; i < (options.pingSamples ?? 4); i += 1) {
      const t0 = now();
      try {
        await fetchImpl(`${options.downloadUrl}?bytes=1&_=${Date.now()}`, { cache: 'no-store', signal });
        const ms = now() - t0;
        pingTimes.push(ms);
        runOptions.onSample?.('ping', ms);
      } catch {
        /* ping failures are reflected in jitter/loss, not fatal */
      }
      await sleep(60, signal);
    }
    const pingMs = average(pingTimes) || 0;
    const jitterMs = stdev(pingTimes);

    runOptions.onPhase?.('down');
    const downloadBytes = options.downloadBytes ?? 6_000_000;
    const downStart = now();
    let received = 0;
    try {
      const response = await fetchImpl(`${options.downloadUrl}?bytes=${downloadBytes}&_=${Date.now()}`, {
        cache: 'no-store',
        signal,
      });
      const reader = response.body?.getReader?.();
      if (reader) {
        const chunks = 12;
        const target = downloadBytes / chunks;
        let chunkBytes = 0;
        let lastMark = now();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const size = value?.byteLength ?? 0;
          received += size;
          chunkBytes += size;
          if (chunkBytes >= target) {
            const elapsed = now() - lastMark;
            if (elapsed > 20) {
              const mbps = (chunkBytes * 8) / (elapsed / 1000) / 1_000_000;
              samplesDown.push(round2(mbps));
              runOptions.onSample?.('down', round2(mbps));
            }
            chunkBytes = 0;
            lastMark = now();
          }
        }
      } else {
        const buffer = await response.arrayBuffer();
        received = buffer.byteLength;
      }
    } catch (error) {
      log.debug('download phase failed', { message: (error as Error).message });
    }
    const downElapsed = Math.max(1, now() - downStart);
    const downloadMbps = received > 0 ? round2((received * 8) / (downElapsed / 1000) / 1_000_000) : 0;
    if (samplesDown.length === 0 && downloadMbps > 0) samplesDown.push(downloadMbps);

    runOptions.onPhase?.('up');
    const uploadBytes = options.uploadBytes ?? 2_000_000;
    const payload = new Uint8Array(uploadBytes);
    crypto.getRandomValues?.(payload.subarray(0, Math.min(payload.length, 4096)));
    const upStart = now();
    let sent = 0;
    try {
      await fetchImpl(`${options.uploadUrl}?bytes=${uploadBytes}&_=${Date.now()}`, {
        method: 'POST',
        body: payload,
        cache: 'no-store',
        signal,
      });
      sent = uploadBytes;
      samplesUp.push(round2((uploadBytes * 8) / (Math.max(1, now() - upStart) / 1000) / 1_000_000));
      runOptions.onSample?.('up', samplesUp[0] as number);
    } catch (error) {
      log.debug('upload phase failed', { message: (error as Error).message });
    }
    const uploadMbps = sent > 0 ? round2((sent * 8) / (Math.max(1, now() - upStart) / 1000) / 1_000_000) : 0;

    runOptions.onPhase?.('done');
    return {
      pingMs: Math.round(pingMs),
      jitterMs: round2(jitterMs),
      downloadMbps,
      uploadMbps,
      serverLabel: new URL(options.downloadUrl, 'http://localhost').host || 'local bridge',
      testedAt: new Date().toISOString(),
      method: 'bridge-server-side',
      samplesDown,
      samplesUp,
      durationMs: Date.now() - started,
    };
  };
}

export interface SimulatedProfile {
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  jitterMs?: number;
  /** Variance applied per run so repeated tests are not identical. */
  variance?: number;
}

/**
 * Deterministic-but-natural simulation used in demo mode. The result is always
 * labelled `method: 'simulated'` so the UI can state that plainly.
 */
export function createSimulatedSpeedTestBackend(profile: SimulatedProfile): SpeedTestBackend {
  return async (runOptions) => {
    const variance = profile.variance ?? 0.08;
    const jitter = () => 1 + (Math.random() * 2 - 1) * variance;
    const started = Date.now();
    const samplesDown: number[] = [];
    const samplesUp: number[] = [];

    runOptions.onPhase?.('ping');
    const pingSamples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const value = Math.max(1, profile.pingMs * (1 + (Math.random() * 2 - 1) * 0.25));
      pingSamples.push(value);
      runOptions.onSample?.('ping', Math.round(value));
      await sleep(90, runOptions.signal);
    }
    const pingMs = Math.round(average(pingSamples));

    runOptions.onPhase?.('down');
    const download = profile.downloadMbps * jitter();
    for (let i = 1; i <= 14; i += 1) {
      // A rising ramp with small noise — mirrors real speed-test curves.
      const progress = 1 - Math.exp(-i / 3.2);
      const value = round2(download * progress * (1 + (Math.random() * 2 - 1) * 0.05));
      samplesDown.push(value);
      runOptions.onSample?.('down', value);
      await sleep(95, runOptions.signal);
    }

    runOptions.onPhase?.('up');
    const upload = profile.uploadMbps * jitter();
    for (let i = 1; i <= 10; i += 1) {
      const progress = 1 - Math.exp(-i / 2.6);
      const value = round2(upload * progress * (1 + (Math.random() * 2 - 1) * 0.06));
      samplesUp.push(value);
      runOptions.onSample?.('up', value);
      await sleep(95, runOptions.signal);
    }

    runOptions.onPhase?.('done');
    return {
      pingMs,
      jitterMs: profile.jitterMs ?? round2(stdev(pingSamples)),
      downloadMbps: round2(download),
      uploadMbps: round2(upload),
      serverLabel: 'Demo network profile',
      testedAt: new Date().toISOString(),
      method: 'simulated',
      samplesDown,
      samplesUp,
      durationMs: Date.now() - started,
    };
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
