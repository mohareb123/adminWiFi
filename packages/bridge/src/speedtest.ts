/**
 * Server-side speed test backend.
 *
 * Two measurements, both real:
 *  - LAN throughput against the bridge itself (payload endpoint below);
 *  - internet throughput against a configurable public test target
 *    (Cloudflare's public speed endpoint by default).
 *
 * The result is labelled with the method actually used, so the UI never
 * presents an estimate as a measurement (spec §20/§26).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { Readable } from 'node:stream';
import { createHttpSpeedTestBackend, createLogger } from '@urlm/core';
import { sleep } from '@urlm/core';
import type { SpeedTestBackend, SpeedTestResult } from '@urlm/core';

const log = createLogger('bridge.speedtest');

export interface SpeedTestConfig {
  /** Self-hosted endpoints (LAN measurement). */
  lanDownloadUrl: string;
  lanUploadUrl: string;
  /** Public endpoints (internet measurement). */
  internetDownloadUrl?: string;
  internetUploadUrl?: string;
  /** Skip the internet part when the machine has no upstream access. */
  mode: 'lan' | 'internet' | 'auto';
  /** Upper bound for the internet phase before falling back to the LAN run. */
  overallTimeoutMs?: number;
}

/** Quick, cheap reachability check so a blocked upstream cannot stall the UI. */
export async function probeReachable(url: string, timeoutMs = 2500): Promise<boolean> {
  try {
    const response = await fetch(withQuery(url, { bytes: 1, _: Date.now() }), {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    await response.arrayBuffer().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

function withQuery(url: string, params: Record<string, string | number>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) parsed.searchParams.set(key, String(value));
  return parsed.toString();
}

function withDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });
}

export const DEFAULT_SPEEDTEST: Omit<SpeedTestConfig, 'lanDownloadUrl' | 'lanUploadUrl'> = {
  internetDownloadUrl: 'https://speed.cloudflare.com/__down',
  internetUploadUrl: 'https://speed.cloudflare.com/__up',
  mode: 'auto',
};

/**
 * Build the speed-test backend the engine will call.
 *
 * `auto` prefers the internet target (that is what users mean by "speed test");
 * if it fails, it falls back to the LAN measurement and says so.
 */
export function createBridgeSpeedTest(
  config: SpeedTestConfig,
): SpeedTestBackend {
  const internet =
    config.mode === 'lan' || !config.internetDownloadUrl || !config.internetUploadUrl
      ? undefined
      : createHttpSpeedTestBackend({
          downloadUrl: config.internetDownloadUrl,
          uploadUrl: config.internetUploadUrl,
          downloadBytes: 12_000_000,
          uploadBytes: 4_000_000,
          pingSamples: 5,
        });

  const lan = createHttpSpeedTestBackend({
    downloadUrl: config.lanDownloadUrl,
    uploadUrl: config.lanUploadUrl,
    downloadBytes: 4_000_000,
    uploadBytes: 1_500_000,
    pingSamples: 4,
  });

  return async (runOptions): Promise<SpeedTestResult> => {
    if (internet) {
      // Never leave the user staring at a spinner: check reachability first and
      // cap the internet run, then fall back (and say so) instead of hanging.
      const reachable = await probeReachable(config.internetDownloadUrl as string);
      if (!reachable) {
        log.warn('internet speed target unreachable, measuring the local segment instead');
      } else {
        try {
          const result = await withDeadline(
            internet(runOptions),
            config.overallTimeoutMs ?? 45_000,
            'internet speed test timed out',
          );
          if (result.downloadMbps > 0 || result.uploadMbps > 0) return result;
          log.warn('internet speed test produced no throughput, falling back to the local segment');
        } catch (error) {
          log.warn('internet speed test failed, falling back to the local segment', {
            message: (error as Error).message,
          });
        }
      }
    }
    const result = await lan(runOptions);
    return {
      ...result,
      serverLabel: `Local Bridge · LAN segment · ${result.serverLabel}`,
    };
  };
}

/** Streaming payload used by the LAN measurement (and by the browser). */
export function createPayloadStream(bytes: number, bytesPerSecond?: number): NodeJS.ReadableStream {
  let remaining = Math.max(1, Math.min(bytes, 64 * 1024 * 1024));
  const pace = Math.max(64 * 1024, bytesPerSecond ?? 0);
  const chunkIntervalMs = bytesPerSecond ? ((64 * 1024) / pace) * 1000 : 0;
  let nextAt = Date.now();

  return new Readable({
    read() {
      if (remaining <= 0) {
        this.push(null);
        return;
      }
      const chunkSize = Math.min(64 * 1024, remaining);
      remaining -= chunkSize;
      const chunk = Buffer.alloc(chunkSize, 0x61);
      // Cheap deterministic entropy so compression never skews the measurement.
      for (let i = 0; i < chunkSize; i += 512) chunk[i] = Math.floor(Math.random() * 256);

      if (!chunkIntervalMs) {
        this.push(chunk);
        return;
      }
      // Paced streaming: the demo line behaves like the plan it advertises, so
      // the measurement stays a real measurement of a shaped link.
      const now = Date.now();
      const wait = Math.max(0, nextAt - now);
      nextAt = Math.max(now, nextAt) + chunkIntervalMs;
      setTimeout(() => this.push(chunk), wait);
    },
  });
}

/** Consume a request body at a fixed rate (used to shape the upload phase). */
export async function drainThrottled(
  stream: NodeJS.ReadableStream,
  bytesPerSecond?: number,
): Promise<void> {
  if (!bytesPerSecond) {
    stream.resume();
    await new Promise<void>((resolve) => stream.on('end', () => resolve()));
    return;
  }
  let nextAt = Date.now();
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    const size = Buffer.isBuffer(chunk) ? chunk.byteLength : 0;
    nextAt += (size / bytesPerSecond) * 1000;
    const wait = nextAt - Date.now();
    if (wait > 0) await sleep(wait);
  }
}

/**
 * Optional upstream (ISP) identification — read-only, best effort.
 * Used by the diagnostics panel; never sent anywhere.
 */
export async function detectPublicIp(): Promise<string | undefined> {
  for (const url of ['https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com']) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (!response.ok) continue;
      const text = (await response.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return text;
    } catch {
      /* try the next provider */
    }
  }
  return undefined;
}
