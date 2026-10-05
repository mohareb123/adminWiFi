/**
 * Local vault + settings store.
 *
 * Security posture (spec §9/§40):
 *  - nothing ever leaves the machine;
 *  - credentials are encrypted with AES-256-GCM using a key derived from a
 *    random 32-byte secret file created with 0600 permissions;
 *  - the saved-router index stores only non-secret metadata;
 *  - "Remember this router" is opt-in per router, and `forget` wipes both the
 *    metadata and the encrypted credential entry.
 *
 * The Android build replaces this class with an Android Keystore backed
 * implementation (see docs/ANDROID.md) — the interface is intentionally
 * identical.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { MemoryStore, SessionCredentialVault, createLogger } from '@urlm/core';
import type { CredentialVault, KeyValueStore, RouterCredentials, SavedRouter } from '@urlm/core';

const log = createLogger('bridge.vault');

export interface VaultPaths {
  root: string;
  secret: string;
  credentials: string;
  routers: string;
  settings: string;
}

export function defaultPaths(): VaultPaths {
  const root = process.env.URLM_HOME ?? path.join(homedir(), '.universal-router-manager');
  return {
    root,
    secret: path.join(root, 'vault.key'),
    credentials: path.join(root, 'credentials.enc'),
    routers: path.join(root, 'routers.json'),
    settings: path.join(root, 'settings.json'),
  };
}

/** AES-256-GCM credential vault. */
export class EncryptedCredentialVault implements CredentialVault {
  readonly kind = 'bridge-file' as const;
  private key?: Buffer;

  constructor(private readonly paths: VaultPaths = defaultPaths()) {}

  private async loadKey(): Promise<Buffer> {
    if (this.key) return this.key;
    await mkdir(this.paths.root, { recursive: true, mode: 0o700 });
    try {
      const raw = (await readFile(this.paths.secret, 'utf8')).trim();
      this.key = scryptSync(raw, 'urlm-vault-v1', 32);
    } catch {
      const secret = randomBytes(48).toString('base64');
      await writeFile(this.paths.secret, secret, { mode: 0o600 });
      await chmod(this.paths.secret, 0o600).catch(() => undefined);
      this.key = scryptSync(secret, 'urlm-vault-v1', 32);
      log.info('created a new local vault key');
    }
    return this.key;
  }

  private async readAll(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.paths.credentials, 'utf8')) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private async writeAll(data: Record<string, string>): Promise<void> {
    await mkdir(this.paths.root, { recursive: true, mode: 0o700 });
    await writeFile(this.paths.credentials, JSON.stringify(data), { mode: 0o600 });
    await chmod(this.paths.credentials, 0o600).catch(() => undefined);
  }

  async put(ref: string, credentials: RouterCredentials): Promise<void> {
    const key = await this.loadKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const payload = JSON.stringify(credentials);
    const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const data = await this.readAll();
    data[ref] = [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
    await this.writeAll(data);
  }

  async get(ref: string): Promise<RouterCredentials | undefined> {
    const data = await this.readAll();
    const entry = data[ref];
    if (!entry) return undefined;
    try {
      const [ivB64, tagB64, payloadB64] = entry.split('.');
      const key = await this.loadKey();
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64 as string, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64 as string, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(payloadB64 as string, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      return JSON.parse(decrypted) as RouterCredentials;
    } catch (error) {
      log.warn('could not decrypt a stored credential (key changed?)', { message: (error as Error).message });
      return undefined;
    }
  }

  async remove(ref: string): Promise<void> {
    const data = await this.readAll();
    delete data[ref];
    await this.writeAll(data);
  }

  async list(): Promise<string[]> {
    return Object.keys(await this.readAll());
  }
}

/** File-backed key/value store used by LearningStore and app settings. */
export class FileStore implements KeyValueStore {
  private cache = new Map<string, string>();
  private loaded = false;

  constructor(private readonly file: string) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, string>;
      for (const [key, value] of Object.entries(raw)) this.cache.set(key, value);
    } catch {
      /* first run */
    }
  }

  private async persist(): Promise<void> {
    const root = path.dirname(this.file);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(this.file, JSON.stringify(Object.fromEntries(this.cache)), { mode: 0o600 });
  }

  async get(key: string): Promise<string | undefined> {
    await this.load();
    return this.cache.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.load();
    this.cache.set(key, value);
    await this.persist();
  }

  async remove(key: string): Promise<void> {
    await this.load();
    this.cache.delete(key);
    await this.persist();
  }

  async keys(): Promise<string[]> {
    await this.load();
    return [...this.cache.keys()];
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.loaded = true;
    await this.persist();
  }
}

/** Saved routers (multi-router support, spec §24) — metadata only. */
export class SavedRouterStore {
  constructor(private readonly file: string) {}

  async all(): Promise<SavedRouter[]> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as SavedRouter[];
    } catch {
      return [];
    }
  }

  async upsert(router: SavedRouter): Promise<SavedRouter[]> {
    const routers = await this.all();
    const index = routers.findIndex((entry) => entry.target.id === router.target.id);
    if (index >= 0) routers[index] = { ...routers[index], ...router };
    else routers.push(router);
    await this.persist(routers);
    return routers;
  }

  async remove(id: string): Promise<SavedRouter[]> {
    const routers = (await this.all()).filter((entry) => entry.target.id !== id);
    await this.persist(routers);
    return routers;
  }

  async setLabel(id: string, label: string): Promise<SavedRouter[]> {
    const routers = await this.all();
    const found = routers.find((entry) => entry.target.id === id);
    if (found) found.label = label;
    await this.persist(routers);
    return routers;
  }

  private async persist(routers: SavedRouter[]): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFile(this.file, JSON.stringify(routers, null, 2), { mode: 0o600 });
  }
}

export interface VaultBundle {
  vault: CredentialVault;
  store: FileStore;
  routers: SavedRouterStore;
  paths: VaultPaths;
}

/** Build the vault bundle, or an in-memory one when persistence is disabled. */
export function createVault(options: { persist?: boolean; paths?: VaultPaths } = {}): VaultBundle {
  const paths = options.paths ?? defaultPaths();
  if (options.persist === false) {
    const memory = new MemoryStore();
    return {
      vault: new SessionCredentialVault(),
      store: memory as unknown as FileStore,
      routers: new SavedRouterStore(path.join(paths.root, 'ephemeral-routers.json')),
      paths,
    };
  }
  return {
    vault: new EncryptedCredentialVault(paths),
    store: new FileStore(paths.settings),
    routers: new SavedRouterStore(paths.routers),
    paths,
  };
}
