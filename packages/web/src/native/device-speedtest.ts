/**
 * On-device speed measurement.
 *
 * Honesty rules for the APK:
 *  - **Default (no external traffic).** Latency is measured with real socket
 *    probes against the router, and the download figure is measured by moving
 *    real bytes from the router's own management server — that is the LAN↔router
 *    throughput, and it is labelled exactly that way («قياس محلي عبر الراوتر»).
 *    No packet ever leaves the local network, which is the privacy default.
 *  - **With explicit consent.** If the user enables the internet measurement in
 *    the speed panel, the same real byte-moving happens against a public
 *    endpoint and the result is labelled as an internet measurement.
 *  - Upload is only reported when it was actually measured; otherwise it is
 *    reported as not-measured instead of inventing a number.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

import type { SpeedTestBackend, SpeedTestResult } from '@urlm/core';
import { DeviceHttpTransport } from './capacitor-http';
import { nativePing } from './native-bridge';

export const INTERNET_CONSENT_KEY = 'urlm.speedtest.internet';

export function internetSpeedTestAllowed(): boolean {
  try {
    return localStorage.getItem(INTERNET_CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setInternetSpeedTestAllowed(allowed: boolean): void {
  try {
    if (allowed) localStorage.setItem(INTERNET_CONSENT_KEY, '1');
    else localStorage.removeItem(INTERNET_CONSENT_KEY);
  } catch {
    /* ignore */
  }
}

const INTERNET_DOWN_URL = 'https://speed.cloudflare.com/__down';
const INTERNET_UP_URL = 'https://speed.cloudflare.com/__up';

export interface DeviceSpeedTestOptions {
  transport: DeviceHttpTransport;
  /** Base URL of the router administration interface currently in use. */
  sessionBaseUrl?: string;
  /** Gateway used when the session is not established yet. */
  fallbackHost?: string;
  /** 0 (LAN only) → measured locally; 25_000_000 → real internet measurement. */
  internetBytes?: number;
}

export function createDeviceSpeedTest(options: DeviceSpeedTestOptions): SpeedTestBackend {
  const transport = options.transport;

  return async (runOptions): Promise<SpeedTestResult> => {
    const started = Date.now();
    const internet = internetSpeedTestAllowed();
    const pingSamples: number[] = [];
    const samplesDown: number[] = [];
    const samplesUp: number[] = [];

    /* -------------------- PING (real probes) -------------------- */
    runOptions.onPhase?.('ping');
    const probeTarget = hostOf(options.sessionBaseUrl) ?? options.fallbackHost ?? '192.168.1.1';
    for (let i = 0; i < 6; i += 1) {
      if (runOptions.signal?.aborted) break;
      const native = await nativePing(probeTarget, 80, 2500);
      if (native?.reachable && native.latencyMs > 0) {
        pingSamples.push(native.latencyMs);
        runOptions.onSample?.('ping', Math.round(native.latencyMs));
      } else {
        const rtt = await httpRtt(transport, options.sessionBaseUrl ?? `http://${probeTarget}/`);
        if (rtt !== undefined) {
          pingSamples.push(rtt);
          runOptions.onSample?.('ping', Math.round(rtt));
        }
      }
      if (!internet) await sleep(60);
    }
    const pingMs = pingSamples.length ? Math.round(average(pingSamples)) : 0;
    const jitterMs = pingSamples.length > 1 ? Math.round(maxDeviation(pingSamples)) : 0;

    /* -------------------- DOWNLOAD -------------------- */
    runOptions.onPhase?.('down');
    let downloadMbps = 0;
    let serverLabel: string;

    if (internet) {
      const outcome = await measureStream(
        transport,
        async (index) => {
          const response = await transport.request({
            url: `${INTERNET_DOWN_URL}?bytes=${options.internetBytes ?? 25_000_000}&r=${index}`,
            method: 'GET',
            timeoutMs: 20_000,
            useCookieJar: false,
          });
          return byteLength(response.body);
        },
        { durationMs: 6500, parallel: 4, onSample: (mbps) => runOptions.onSample?.('down', round2(mbps)), signal: runOptions.signal },
      );
      downloadMbps = outcome.mbps;
      samplesDown.push(...outcome.samples);
      serverLabel = 'خادم قياس عام · اتصال الإنترنت (بموافقتك)';
    } else {
      const base = options.sessionBaseUrl;
      if (base) {
        const outcome = await measureStream(
          transport,
          async () => {
            const response = await transport.request({ url: `${base}/`, method: 'GET', timeoutMs: 8000 });
            return byteLength(response.body);
          },
          { durationMs: 5000, parallel: 3, onSample: (mbps) => runOptions.onSample?.('down', round2(mbps)), signal: runOptions.signal },
        );
        downloadMbps = outcome.mbps;
        samplesDown.push(...outcome.samples);
        serverLabel = 'الراوتر نفسه (قياس محلي على الشبكة)';
      } else {
        serverLabel = 'لا يوجد راوتر متصل بعد';
      }
    }

    /* -------------------- UPLOAD -------------------- */
    runOptions.onPhase?.('up');
    let uploadMbps = 0;
    if (internet) {
      const payload = '0'.repeat(512 * 1024);
      const outcome = await measureStream(
        transport,
        async (index) => {
          await transport.request({
            url: `${INTERNET_UP_URL}?r=${index}`,
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream' },
            body: payload,
            timeoutMs: 15_000,
            useCookieJar: false,
          });
          return byteLength(payload);
        },
        { durationMs: 5000, parallel: 3, onSample: (mbps) => runOptions.onSample?.('up', round2(mbps)), signal: runOptions.signal },
      );
      uploadMbps = outcome.mbps;
      samplesUp.push(...outcome.samples);
    } else {
      serverLabel += ' · الرفع لا يُقاس إلا مع قياس الإنترنت';
    }

    runOptions.onPhase?.('done');
    return {
      pingMs,
      jitterMs,
      downloadMbps: round2(downloadMbps),
      uploadMbps: round2(uploadMbps),
      serverLabel,
      testedAt: new Date().toISOString(),
      method: 'device-local',
      samplesDown,
      samplesUp,
      durationMs: Date.now() - started,
    };
  };
}

/* ------------------------------------------------------------------ *
 * Measurement helpers — every figure comes from real bytes over real time
 * ------------------------------------------------------------------ */

interface StreamOutcome {
  mbps: number;
  samples: number[];
}

async function measureStream(
  _transport: DeviceHttpTransport,
  transfer: (index: number) => Promise<number>,
  config: { durationMs: number; parallel: number; onSample: (mbps: number) => void; signal?: AbortSignal },
): Promise<StreamOutcome> {
  const samples: number[] = [];
  const deadline = Date.now() + config.durationMs;
  let bytes = 0;
  const startedAt = Date.now();
  let index = 0;

  const worker = async (): Promise<void> => {
    while (Date.now() < deadline && !config.signal?.aborted) {
      const localStart = Date.now();
      try {
        const moved = await transfer(index++);
        const elapsedMs = Math.max(1, Date.now() - localStart);
        bytes += moved;
        const instantaneous = (moved * 8) / (elapsedMs / 1000) / 1_000_000;
        // Ignore warm-up/cold-start outliers; keep the curve readable.
        if (Date.now() - startedAt > 600) {
          samples.push(round2(instantaneous));
          config.onSample(round2(instantaneous));
        }
      } catch {
        // A failed transfer is data too: the stream simply stops early.
        break;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, config.parallel) }, () => worker()));
  const elapsedSeconds = Math.max(0.2, (Date.now() - startedAt) / 1000);
  const mbps = (bytes * 8) / elapsedSeconds / 1_000_000;
  if (samples.length === 0 && mbps > 0) {
    samples.push(round2(mbps));
    config.onSample(round2(mbps));
  }
  return { mbps, samples };
}

async function httpRtt(transport: DeviceHttpTransport, url: string): Promise<number | undefined> {
  const started = Date.now();
  try {
    await transport.request({ url, method: 'GET', timeoutMs: 4000, useCookieJar: false });
    return Date.now() - started;
  } catch {
    return undefined;
  }
}

function byteLength(body: string): number {
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(body).length : body.length;
}

function hostOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

function maxDeviation(values: number[]): number {
  const mean = average(values);
  return Math.max(...values.map((value) => Math.abs(value - mean)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
