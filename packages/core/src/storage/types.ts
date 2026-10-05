/**
 * Storage contracts + credential references (spec §9/§40).
 *
 * The core never stores a plaintext password. A `CredentialVault` implementation
 * lives in the host platform:
 *   - bridge (Node): encrypted file vault with an OS-provided key
 *     (machine-derived secret, 0600 permissions, AES-256-GCM).
 *   - Android: Android Keystore + EncryptedSharedPreferences (documented in
 *     docs/ANDROID.md for the native layer).
 *   - browser: sessionStorage only, cleared on close, opt-in per router.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import type { CapabilityId, FingerprintReport, RouterCredentials, RouterTarget } from '../core/types';

/** Minimal async key/value interface (bridge: file/SQLite, web: IndexedDB). */
export interface KeyValueStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

/** In-memory store — used in tests and by the web demo shell. */
export class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.map.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }

  async clear(): Promise<void> {
    this.map.clear();
  }
}

export interface SavedRouter {
  target: RouterTarget;
  /** Human label shown in Simple Mode ("المنزل", "المكتب"). */
  label: string;
  vendor?: string;
  model?: string;
  adapterId?: string;
  /** Whether credentials are stored at all (never the credentials themselves). */
  remember: boolean;
  lastConnectedAt?: string;
  capabilitiesSummary?: Partial<Record<CapabilityId, 'yes' | 'no' | 'unknown'>>;
  fingerprintSummary?: Pick<FingerprintReport, 'confidence' | 'quality'>;
}

export interface CredentialVault {
  readonly kind: 'bridge-file' | 'android-keystore' | 'session-only' | 'memory';
  /** Store credentials under an opaque reference (returns the ref). */
  put(ref: string, credentials: RouterCredentials): Promise<void>;
  get(ref: string): Promise<RouterCredentials | undefined>;
  remove(ref: string): Promise<void>;
  list(): Promise<string[]>;
}

/** Reference vault that keeps nothing on disk (used when "remember" is off). */
export class SessionCredentialVault implements CredentialVault {
  readonly kind = 'session-only' as const;
  private map = new Map<string, RouterCredentials>();

  async put(ref: string, credentials: RouterCredentials): Promise<void> {
    this.map.set(ref, credentials);
  }

  async get(ref: string): Promise<RouterCredentials | undefined> {
    return this.map.get(ref);
  }

  async remove(ref: string): Promise<void> {
    this.map.delete(ref);
  }

  async list(): Promise<string[]> {
    return [...this.map.keys()];
  }
}
