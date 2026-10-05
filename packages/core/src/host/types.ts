/**
 * Host platform contract — everything the engine host needs from the machine it
 * runs on.
 *
 * The same host code therefore runs in two very different places:
 *   - the desktop Local Bridge (Node: file vault, raw sockets, OS routing table);
 *   - the Android app itself (WebView + Capacitor: native HTTP, Keystore vault,
 *     Android network APIs).
 *
 * Nothing in this file is allowed to import a Node or DOM global.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

import type { CredentialVault, KeyValueStore, SavedRouter } from '../storage/types';
import type { DetectedService, UpnpInfo } from '../core/types';
import type { HttpTransport } from '../core/http';
import type { SpeedTestBackend } from '../diagnostics/speedtest';
import type { SpeedTestResult } from '../core/types';

/** Credential/metadata storage owned by the platform. */
export interface HostStorage {
  vault: CredentialVault;
  store: KeyValueStore;
  routers: SavedRouterRepository;
  /** Human-readable location (Advanced Mode → diagnostics). Never a secret. */
  root?: string;
}

export interface SavedRouterRepository {
  all(): Promise<SavedRouter[]>;
  upsert(router: SavedRouter): Promise<SavedRouter[]>;
  remove(id: string): Promise<SavedRouter[]>;
  setLabel(id: string, label: string): Promise<SavedRouter[]>;
}

/** Result of a one-shot reachability probe (never a flood: one probe, one answer). */
export interface LatencyProbeResult {
  latencyMs: number;
  reachable: boolean;
}

export type LatencyProbe = (signal?: AbortSignal) => Promise<LatencyProbeResult>;

export interface HostSpeedPlan {
  simulated: boolean;
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  jitterMs?: number;
  bytesPerSecond: number;
  label: string;
}

/**
 * Platform capabilities used in *real* mode only. Simulated mode is handled
 * entirely inside the host, so a platform never has to fake a network.
 */
export interface HostPlatform {
  /** 'bridge' (Node) or 'device' (Android shell) — surfaced in diagnostics. */
  readonly kind: 'bridge' | 'device' | 'test';
  readonly label: string;
  createStorage(options: { persist: boolean }): HostStorage;
  /** Transport that reaches real router hardware. */
  realTransport(): HttpTransport;
  gateway(): Promise<{ gateways: string[]; mac?: string }>;
  services(host: string, signal?: AbortSignal): Promise<DetectedService[]>;
  upnp(host?: string): Promise<UpnpInfo | undefined>;
  latencyProbe(host: string): LatencyProbe;
  /** Real internet/lan speed measurement — may require explicit user consent. */
  speedTest(options: { selfUrl: string; plan: HostSpeedPlan; sessionBaseUrl?: string }): SpeedTestBackend;
  /** Base URL the host can use for its own measurements (may be empty on device). */
  selfUrl(): string;
  /** Optional: measured public/private IP for diagnostics. */
  publicIp?(): Promise<string | undefined>;
}

