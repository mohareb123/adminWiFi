/**
 * Thin wrapper around the Android companion plugin (`UrlmNative`).
 *
 * The plugin is deliberately tiny: it exposes only things a WebView genuinely
 * cannot do — the OS default gateway, a real socket-level latency probe, and an
 * AES key that lives inside the Android Keystore (so a stored password is never
 * written in plaintext).
 *
 * Every call degrades gracefully: if the plugin is missing (browser preview,
 * older build) the app still runs, just with reduced detection and a
 * session-only vault.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

import { registerPlugin } from '@capacitor/core';

export interface NativeNetworkInfo {
  gateway?: string;
  ip?: string;
  dns?: string[];
  ssid?: string;
  bssid?: string;
  frequencyMhz?: number;
  linkSpeedMbps?: number;
  transport?: string;
}

export interface NativePingResult {
  latencyMs: number;
  reachable: boolean;
  method: 'icmp' | 'tcp' | 'http';
}

interface UrlmNativePlugin {
  available(): Promise<{ ok: boolean; keystore: boolean; version: string }>;
  info(): Promise<NativeNetworkInfo>;
  ping(options: { host: string; port?: number; timeoutMs?: number }): Promise<NativePingResult>;
  encrypt(options: { plaintext: string }): Promise<{ payload: string }>;
  decrypt(options: { payload: string }): Promise<{ plaintext: string }>;
}

const UrlmNative = registerPlugin<UrlmNativePlugin>('UrlmNative');

let availability: Promise<{ ok: boolean; keystore: boolean; version: string }> | undefined;

async function probe(): Promise<{ ok: boolean; keystore: boolean; version: string }> {
  try {
    const result = await UrlmNative.available();
    return { ok: result?.ok !== false, keystore: result?.keystore === true, version: result?.version ?? '1' };
  } catch {
    return { ok: false, keystore: false, version: 'unavailable' };
  }
}

/** Cached plugin availability (never throws). */
export function nativeAvailable(): Promise<{ ok: boolean; keystore: boolean; version: string }> {
  availability ??= probe();
  return availability;
}

export async function nativeNetworkInfo(): Promise<NativeNetworkInfo | undefined> {
  if (!(await nativeAvailable()).ok) return undefined;
  try {
    return await UrlmNative.info();
  } catch {
    return undefined;
  }
}

export async function nativePing(
  host: string,
  port?: number,
  timeoutMs = 2500,
): Promise<NativePingResult | undefined> {
  if (!(await nativeAvailable()).ok) return undefined;
  try {
    return await UrlmNative.ping({ host, port, timeoutMs });
  } catch {
    return undefined;
  }
}

export async function keystoreAvailable(): Promise<boolean> {
  const info = await nativeAvailable();
  return info.ok && info.keystore;
}

export async function keystoreEncrypt(plaintext: string): Promise<string | undefined> {
  if (!(await keystoreAvailable())) return undefined;
  try {
    return (await UrlmNative.encrypt({ plaintext })).payload;
  } catch {
    return undefined;
  }
}

export async function keystoreDecrypt(payload: string): Promise<string | undefined> {
  if (!(await keystoreAvailable())) return undefined;
  try {
    return (await UrlmNative.decrypt({ payload })).plaintext;
  } catch {
    return undefined;
  }
}

export { UrlmNative };
