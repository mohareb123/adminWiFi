/**
 * Self-learning compatibility layer (spec §45).
 *
 * When a new router is discovered we record its *non-secret* fingerprint and
 * the outcome of every operation. Nothing dangerous is applied automatically:
 * learning only refines future capability decisions and confidence.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { createLogger } from '../core/logger';
import type { FingerprintReport, OperationId } from '../core/types';
import { stableId } from '../core/util';
import type { LearnedProfile, RouterSignatures } from '../signatures';
import type { KeyValueStore } from './types';

const log = createLogger('learning');

const STORAGE_KEY = 'urlm.learned.profiles.v1';

export interface LearningStoreOptions {
  store: KeyValueStore;
  signatures: RouterSignatures;
  /** Disable entirely — the user can opt out in Settings → Privacy. */
  enabled?: boolean;
}

export class LearningStore {
  private profiles = new Map<string, LearnedProfile>();
  private loaded = false;
  private enabled: boolean;

  constructor(private readonly options: LearningStoreOptions) {
    this.enabled = options.enabled ?? true;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async load(): Promise<LearnedProfile[]> {
    if (this.loaded) return [...this.profiles.values()];
    try {
      const raw = await this.options.store.get(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as LearnedProfile[];
        for (const profile of parsed) {
          this.profiles.set(profile.id, profile);
          // Register as a low-confidence signature so the engine can match it.
          this.options.signatures.recordLearned(profile);
        }
      }
    } catch (error) {
      log.warn('could not load learned profiles', { message: (error as Error).message });
    }
    this.loaded = true;
    return [...this.profiles.values()];
  }

  all(): LearnedProfile[] {
    return [...this.profiles.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Record a newly fingerprinted device (idempotent). */
  async observeFingerprint(fingerprint: FingerprintReport, adapterUsed: string): Promise<LearnedProfile> {
    if (!this.enabled) return emptyProfile(fingerprint, adapterUsed);
    await this.load();
    const id = profileId(fingerprint);
    const existing = this.profiles.get(id);
    const now = new Date().toISOString();
    const profile: LearnedProfile = existing ?? {
      id,
      createdAt: now,
      updatedAt: now,
      vendor: fingerprint.identity.vendor,
      model: fingerprint.identity.model,
      firmware: fingerprint.identity.firmware,
      signalDigest: digestOf(fingerprint),
      adapterUsed,
      outcomes: [],
      confidence: fingerprint.confidence / 100,
      notes: [],
    };
    profile.updatedAt = now;
    profile.vendor = fingerprint.identity.vendor || profile.vendor;
    profile.model = fingerprint.identity.model || profile.model;
    profile.firmware = fingerprint.identity.firmware ?? profile.firmware;
    profile.adapterUsed = adapterUsed;
    profile.confidence = Math.max(profile.confidence, fingerprint.confidence / 100);
    this.profiles.set(id, profile);
    this.options.signatures.recordLearned(profile);
    await this.persist();
    return profile;
  }

  /** Record the real outcome of an operation — the core of the learning loop. */
  async recordOutcome(
    fingerprint: FingerprintReport,
    operationId: OperationId,
    ok: boolean,
    verified: boolean,
    reason?: string,
  ): Promise<void> {
    if (!this.enabled) return;
    const profile = this.profiles.get(profileId(fingerprint));
    if (!profile) return;
    const existing = profile.outcomes.find((entry) => entry.operationId === operationId);
    if (existing) {
      existing.count += 1;
      existing.ok = ok;
      existing.verified = verified;
      existing.reason = reason;
      existing.lastAt = new Date().toISOString();
    } else {
      profile.outcomes.push({
        operationId,
        ok,
        verified,
        reason,
        count: 1,
        lastAt: new Date().toISOString(),
      });
    }
    profile.updatedAt = new Date().toISOString();
    await this.persist();
  }

  /** How reliable is this operation on this device, historically? */
  reliability(fingerprint: FingerprintReport, operationId: OperationId): { attempts: number; successRate: number } | undefined {
    const profile = this.profiles.get(profileId(fingerprint));
    const entry = profile?.outcomes.find((outcome) => outcome.operationId === operationId);
    if (!entry || entry.count === 0) return undefined;
    return { attempts: entry.count, successRate: entry.ok && entry.verified ? 1 : entry.ok ? 0.5 : 0 };
  }

  async forget(id: string): Promise<void> {
    this.profiles.delete(id);
    this.options.signatures.remove(`learned.${id}`);
    await this.persist();
  }

  async clear(): Promise<void> {
    for (const id of this.profiles.keys()) this.options.signatures.remove(`learned.${id}`);
    this.profiles.clear();
    await this.options.store.remove(STORAGE_KEY);
  }

  private async persist(): Promise<void> {
    try {
      await this.options.store.set(STORAGE_KEY, JSON.stringify([...this.profiles.values()]));
    } catch (error) {
      log.warn('could not persist learned profiles', { message: (error as Error).message });
    }
  }
}

function profileId(fingerprint: FingerprintReport): string {
  return stableId(
    [
      fingerprint.identity.vendor,
      fingerprint.identity.model,
      fingerprint.signals.title ?? '',
      fingerprint.signals.serverBanner ?? '',
      fingerprint.signals.cookieNames.join(','),
    ].join('|'),
  );
}

function digestOf(fingerprint: FingerprintReport): LearnedProfile['signalDigest'] {
  const signals = fingerprint.signals;
  return {
    title: signals.title,
    serverBanner: signals.serverBanner,
    cookieNames: signals.cookieNames.slice(0, 8),
    assetHashes: signals.assetPaths.slice(0, 8).map((path) => stableId(path)),
    apiPaths: signals.apiHits.map((hit) => hit.path).slice(0, 10),
    oui: signals.gatewayMac?.toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 6),
  };
}

function emptyProfile(fingerprint: FingerprintReport, adapterUsed: string): LearnedProfile {
  const now = new Date().toISOString();
  return {
    id: profileId(fingerprint),
    createdAt: now,
    updatedAt: now,
    vendor: fingerprint.identity.vendor,
    model: fingerprint.identity.model,
    firmware: fingerprint.identity.firmware,
    signalDigest: digestOf(fingerprint),
    adapterUsed,
    outcomes: [],
    confidence: fingerprint.confidence / 100,
  };
}
