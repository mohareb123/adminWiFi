/**
 * Device storage — settings, learned fingerprints and the credential vault.
 *
 * Rules (spec §9/§40):
 *  - a password is **never** written in plaintext: it is sealed by the Android
 *    Keystore (AES-256-GCM, key never leaves the Keystore) through the companion
 *    plugin, and only the sealed blob is kept;
 *  - if the Keystore is unavailable the vault silently degrades to
 *    session-only memory — it never falls back to plaintext storage;
 *  - router metadata (name, model, capabilities) is not secret and lives in
 *    app-private storage so Simple Mode can show saved routers offline.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

import { MemoryStore, SessionCredentialVault } from '@urlm/core';
import type {
  CredentialVault,
  HostStorage,
  KeyValueStore,
  RouterCredentials,
  SavedRouter,
  SavedRouterRepository,
} from '@urlm/core';
import { keystoreDecrypt, keystoreEncrypt } from './native-bridge';

const PREFIX = 'urlm.';
const ROUTERS_KEY = `${PREFIX}routers.v1`;
const VAULT_KEY = `${PREFIX}vault.v1`;

/* ------------------------------------------------------------------ *
 * Settings / learning store (not secret)
 * ------------------------------------------------------------------ */

class LocalKeyValueStore implements KeyValueStore {
  constructor(private readonly namespace = 'kv') {}

  private key(key: string): string {
    return `${PREFIX}${this.namespace}.${key}`;
  }

  async get(key: string): Promise<string | undefined> {
    try {
      return localStorage.getItem(this.key(key)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(this.key(key), value);
    } catch {
      /* storage full or blocked — learning is an optimisation, never a requirement */
    }
  }

  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(this.key(key));
    } catch {
      /* ignore */
    }
  }

  async keys(): Promise<string[]> {
    try {
      return Object.keys(localStorage)
        .filter((key) => key.startsWith(`${PREFIX}${this.namespace}.`))
        .map((key) => key.slice(`${PREFIX}${this.namespace}.`.length));
    } catch {
      return [];
    }
  }

  async clear(): Promise<void> {
    for (const key of await this.keys()) await this.remove(key);
  }
}

/* ------------------------------------------------------------------ *
 * Credential vault — sealed by the Android Keystore
 * ------------------------------------------------------------------ */

export class KeystoreCredentialVault implements CredentialVault {
  readonly kind = 'android-keystore' as const;
  private cache = new Map<string, RouterCredentials>();
  private loaded?: Promise<void>;

  private async hydrate(): Promise<void> {
    this.loaded ??= (async () => {
      const sealed = readRaw(VAULT_KEY);
      if (!sealed) return;
      const plaintext = await keystoreDecrypt(sealed);
      if (!plaintext) return;
      try {
        const entries = JSON.parse(plaintext) as Record<string, RouterCredentials>;
        for (const [ref, credentials] of Object.entries(entries)) this.cache.set(ref, credentials);
      } catch {
        /* a blob we cannot read is treated as absent, never as a crash */
      }
    })();
    await this.loaded;
  }

  private async persist(): Promise<void> {
    const payload = JSON.stringify(Object.fromEntries(this.cache.entries()));
    const sealed = await keystoreEncrypt(payload);
    if (sealed) writeRaw(VAULT_KEY, sealed);
  }

  async put(ref: string, credentials: RouterCredentials): Promise<void> {
    await this.hydrate();
    this.cache.set(ref, credentials);
    await this.persist();
  }

  async get(ref: string): Promise<RouterCredentials | undefined> {
    await this.hydrate();
    return this.cache.get(ref);
  }

  async remove(ref: string): Promise<void> {
    await this.hydrate();
    this.cache.delete(ref);
    await this.persist();
  }

  async list(): Promise<string[]> {
    await this.hydrate();
    return [...this.cache.keys()];
  }
}

function readRaw(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * Saved routers (metadata only)
 * ------------------------------------------------------------------ */

class LocalSavedRouters implements SavedRouterRepository {
  constructor(private readonly persist: boolean) {}

  async all(): Promise<SavedRouter[]> {
    if (!this.persist) return this.memory;
    try {
      const raw = localStorage.getItem(ROUTERS_KEY);
      const parsed = raw ? (JSON.parse(raw) as SavedRouter[]) : [];
      this.memory = parsed;
      return parsed;
    } catch {
      return this.memory;
    }
  }

  private memory: SavedRouter[] = [];

  async upsert(router: SavedRouter): Promise<SavedRouter[]> {
    const routers = await this.all();
    const index = routers.findIndex((entry) => entry.target.id === router.target.id);
    const next = [...routers];
    if (index >= 0) next[index] = { ...next[index], ...router };
    else next.push(router);
    return this.write(next);
  }

  async remove(id: string): Promise<SavedRouter[]> {
    const routers = await this.all();
    return this.write(routers.filter((entry) => entry.target.id !== id));
  }

  async setLabel(id: string, label: string): Promise<SavedRouter[]> {
    const routers = await this.all();
    const next = routers.map((entry) => (entry.target.id === id ? { ...entry, label } : entry));
    return this.write(next);
  }

  private async write(routers: SavedRouter[]): Promise<SavedRouter[]> {
    this.memory = routers;
    if (this.persist) {
      try {
        localStorage.setItem(ROUTERS_KEY, JSON.stringify(routers));
      } catch {
        /* ignore */
      }
    }
    return routers;
  }
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

/**
 * Build device storage. `persist` comes from the bridge contract
 * (`/api/mode`, CLI flags) and is normally true on a phone: a user who ticks
 * "remember this router" expects it to survive an app restart — and it does,
 * sealed by the Keystore rather than written as text.
 */
export function createDeviceStorage(options: { persist: boolean; sealed: boolean }): HostStorage {
  const persist = options.persist !== false;
  const sealed = persist && options.sealed === true;

  return {
    vault: sealed ? new KeystoreCredentialVault() : new SessionCredentialVault(),
    store: persist ? new LocalKeyValueStore('kv') : new MemoryStore(),
    routers: new LocalSavedRouters(persist),
    root: sealed ? 'Android Keystore + app-private storage' : persist ? 'app-private storage' : 'in-memory',
  };
}
