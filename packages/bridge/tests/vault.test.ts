/**
 * Credential storage tests — spec §9 (secure storage, no plaintext) and §43
 * (local-first privacy).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EncryptedCredentialVault, SavedRouterStore, createVault, defaultPaths, type VaultPaths } from '../src/vault';

let root: string;

/** Vault paths inside the per-test temp directory. */
const paths = (): VaultPaths => {
  const base = defaultPaths();
  return {
    ...base,
    root,
    secret: path.join(root, 'vault.key'),
    credentials: path.join(root, 'credentials.enc'),
    routers: path.join(root, 'routers.json'),
    settings: path.join(root, 'settings.json'),
  };
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'urlm-vault-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('EncryptedCredentialVault', () => {
  it('round-trips credentials without ever writing the plaintext', async () => {
    const vault = new EncryptedCredentialVault(paths());

    await vault.put('router-192.168.1.1', { username: 'admin', password: 'SuperSecret123' });

    const stored = await readFile(path.join(root, 'credentials.enc'), 'utf8');
    expect(stored).not.toContain('SuperSecret123');
    expect(stored).not.toContain('admin');
    expect(stored.length).toBeGreaterThan(16);

    const restored = await vault.get('router-192.168.1.1');
    expect(restored).toEqual({ username: 'admin', password: 'SuperSecret123' });

    const listings = await vault.list();
    expect(listings).toContain('router-192.168.1.1');
  });

  it('creates the key file with owner-only permissions (0600)', async () => {
    const keyFile = path.join(root, 'vault.key');
    const vault = new EncryptedCredentialVault(paths());
    await vault.put('a', { username: 'u', password: 'p' });

    const info = await stat(keyFile);
    // 0o600 → owner read/write only (mask off the file-type bits).
    expect(info.mode & 0o777).toBe(0o600);
    const key = await readFile(keyFile, 'utf8');
    expect(key.trim().length).toBeGreaterThanOrEqual(32);
  });

  it('cannot decrypt a tampered vault (authenticated encryption)', async () => {
    const credentialsFile = path.join(root, 'credentials.enc');
    const vault = new EncryptedCredentialVault(paths());
    await vault.put('router', { username: 'admin', password: 'SuperSecret123' });

    // Format: { "<ref>": "<iv>.<tag>.<ciphertext>" } (all base64).
    const raw = JSON.parse(await readFile(credentialsFile, 'utf8')) as Record<string, string>;
    const [iv, tag, payload] = (raw.router as string).split('.') as [string, string, string];
    const bytes = Buffer.from(payload, 'base64');
    bytes[0] = (bytes[0] as number) ^ 0xff;
    raw.router = [iv, tag, bytes.toString('base64')].join('.');
    await writeFile(credentialsFile, JSON.stringify(raw));

    const reloaded = new EncryptedCredentialVault(paths());
    // Fails closed: a tampered vault yields no credentials at all.
    await expect(reloaded.get('router')).resolves.toBeUndefined();
    const summary = await reloaded.get('router');
    expect(summary).toBeUndefined();
  });

  it('forgets a router completely', async () => {
    const vault = new EncryptedCredentialVault(paths());
    await vault.put('router', { username: 'a', password: 'b' });
    await vault.remove('router');
    expect(await vault.get('router')).toBeUndefined();
  });
});

describe('SavedRouterStore', () => {
  it('keeps metadata only and supports rename + forget', async () => {
    const store = new SavedRouterStore(paths().routers);
    await store.upsert({
      target: { id: 'router-1', label: 'راوتر البيت', host: '192.168.1.1', scheme: 'http', port: 80, credentialRef: 'router-1' },
      label: 'راوتر البيت',
      vendor: 'Huawei',
      model: 'HG8145V5',
      adapterId: 'HuaweiAdapter',
      remember: true,
      lastConnectedAt: new Date().toISOString(),
      capabilitiesSummary: { device_block: 'yes' },
      fingerprintSummary: { confidence: 98, quality: 'exact' },
    });

    const all = await store.all();
    expect(all).toHaveLength(1);
    // The file must not contain a password field at all.
    const raw = await readFile(paths().routers, 'utf8');
    expect(raw).not.toMatch(/password/i);

    await store.setLabel('router-1', 'راوتر المكتب');
    expect((await store.all())[0]?.label).toBe('راوتر المكتب');

    await store.remove('router-1');
    expect(await store.all()).toHaveLength(0);
  });
});

describe('createVault', () => {
  it('uses an ephemeral, memory-only vault when persistence is disabled', async () => {
    const bundle = createVault({ persist: false });
    await bundle.vault.put('router', { username: 'admin', password: 'x' });
    expect(bundle.vault.kind).toBe("session-only");
    expect(await bundle.vault.get('router')).toEqual({ username: 'admin', password: 'x' });
  });

  it('defaults to a per-user directory outside the repository', () => {
    const paths = defaultPaths();
    expect(paths.root).toContain('.universal-router-manager');
    expect(paths.root.startsWith(process.cwd())).toBe(false);
  });
});
