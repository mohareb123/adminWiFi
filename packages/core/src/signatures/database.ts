/**
 * RouterSignatures — the updateable signature database (spec §4).
 *
 * Responsibilities:
 *  - hold built-in entries,
 *  - validate + merge runtime update packs (new routers, no rebuild needed),
 *  - store self-learned profiles (spec §45),
 *  - expose lookup helpers used by the fingerprint engine and the adapters.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { createLogger } from '../core/logger';
import { BUILTIN_META, BUILTIN_SIGNATURES } from './builtin';
import { lookupOui } from './oui';
import type { LearnedProfile, RouterSignature, SignatureDatabaseMeta } from './types';

const log = createLogger('signatures');

export interface SignatureValidationIssue {
  index: number;
  id?: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface SignaturePack {
  meta: { version: string; updatedAt?: string; author?: string };
  signatures: RouterSignature[];
}

const REQUIRED_FIELDS: Array<keyof RouterSignature> = ['id', 'vendor', 'model', 'loginType', 'authMethod', 'adapter', 'match'];

export class RouterSignatures {
  private entries = new Map<string, RouterSignature>();
  private packMeta: SignatureDatabaseMeta = { ...BUILTIN_META };

  constructor(entries: RouterSignature[] = BUILTIN_SIGNATURES) {
    for (const entry of entries) this.entries.set(entry.id, entry);
  }

  get meta(): SignatureDatabaseMeta {
    return {
      ...this.packMeta,
      count: this.entries.size,
      vendors: [...new Set([...this.entries.values()].map((entry) => entry.vendor))].sort(),
    };
  }

  all(): RouterSignature[] {
    return [...this.entries.values()];
  }

  get(id: string): RouterSignature | undefined {
    return this.entries.get(id);
  }

  byVendor(vendor: string): RouterSignature[] {
    const needle = vendor.toLowerCase();
    return this.all().filter((entry) => entry.vendor.toLowerCase() === needle);
  }

  byAdapter(adapter: string): RouterSignature[] {
    return this.all().filter((entry) => entry.adapter === adapter);
  }

  /** The always-safe fallback used when nothing matches confidently. */
  get generic(): RouterSignature {
    return this.entries.get('generic.unknown') ?? BUILTIN_SIGNATURES[BUILTIN_SIGNATURES.length - 1]!;
  }

  /**
   * Validate a pack before merging it. Malformed entries are rejected rather
   * than silently trusted — an update pack must never break identification.
   */
  static validate(pack: unknown): { valid: RouterSignature[]; issues: SignatureValidationIssue[] } {
    const issues: SignatureValidationIssue[] = [];
    const valid: RouterSignature[] = [];
    const signatures = (pack as SignaturePack | undefined)?.signatures;
    if (!Array.isArray(signatures)) {
      return { valid, issues: [{ index: -1, message: 'pack.signatures must be an array', severity: 'error' }] };
    }
    signatures.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        issues.push({ index, message: 'entry is not an object', severity: 'error' });
        return;
      }
      const candidate = entry as RouterSignature;
      const missing = REQUIRED_FIELDS.filter((field) => candidate[field] === undefined || candidate[field] === '');
      if (missing.length > 0) {
        issues.push({ index, id: candidate.id, message: `missing required fields: ${missing.join(', ')}`, severity: 'error' });
        return;
      }
      if (!/^[a-z0-9._-]+$/i.test(candidate.id)) {
        issues.push({ index, id: candidate.id, message: 'id must match /^[a-z0-9._-]+$/i', severity: 'error' });
        return;
      }
      if (typeof candidate.match !== 'object') {
        issues.push({ index, id: candidate.id, message: 'match must be an object', severity: 'error' });
        return;
      }
      // Compile every pattern now — bad regexes must not explode mid-scan.
      const regexIssues = checkRegexes(candidate);
      if (regexIssues.length > 0) {
        issues.push({ index, id: candidate.id, message: regexIssues.join('; '), severity: 'error' });
        return;
      }
      if (!candidate.operations?.length) {
        issues.push({ index, id: candidate.id, message: 'no operations declared (read-only signature)', severity: 'warning' });
      }
      valid.push(candidate);
    });
    return { valid, issues };
  }

  /** Merge a validated pack. Returns the number of added/updated entries. */
  loadPack(pack: SignaturePack): { added: number; updated: number; issues: SignatureValidationIssue[] } {
    const { valid, issues } = RouterSignatures.validate(pack);
    let added = 0;
    let updated = 0;
    for (const entry of valid) {
      const merged: RouterSignature = { ...entry, source: entry.source ?? 'update-pack' };
      if (this.entries.has(merged.id)) updated += 1;
      else added += 1;
      this.entries.set(merged.id, merged);
    }
    this.packMeta = {
      ...this.packMeta,
      version: pack.meta?.version ?? this.packMeta.version,
      updatedAt: pack.meta?.updatedAt ?? new Date().toISOString(),
    };
    log.info('signature pack loaded', { version: pack.meta?.version, added, updated, issues: issues.length });
    return { added, updated, issues };
  }

  /** Export as a JSON-ready pack (used by Advanced Mode → Signatures). */
  exportPack(): SignaturePack {
    return {
      meta: { version: this.meta.version, updatedAt: this.meta.updatedAt, author: 'Universal Router Manager' },
      signatures: this.all().filter((entry) => entry.source !== 'learned'),
    };
  }

  /** Register/refresh a learned profile as a low-confidence signature. */
  recordLearned(profile: LearnedProfile): RouterSignature {
    const signature: RouterSignature = {
      id: `learned.${profile.id}`,
      vendor: profile.vendor || 'Unknown',
      model: profile.model || 'Learned device',
      managementUrls: ['/'],
      loginType: 'form-session',
      authMethod: 'learned',
      adapter: profile.adapterUsed,
      maxConfidence: Math.min(profile.confidence, 0.8),
      match: {
        titles: profile.signalDigest.title ? [{ pattern: escapeRegex(profile.signalDigest.title), weight: 0.12, label: 'learned title' }] : [],
        serverBanner: profile.signalDigest.serverBanner
          ? [{ pattern: escapeRegex(profile.signalDigest.serverBanner), weight: 0.1, label: 'learned server banner' }]
          : [],
        cookies: profile.signalDigest.cookieNames.slice(0, 4).map((name) => ({
          pattern: `^${escapeRegex(name)}$`,
          weight: 0.08,
          label: `learned cookie ${name}`,
        })),
        apiPaths: profile.signalDigest.apiPaths.slice(0, 6).map((path) => ({
          pattern: escapeRegex(path),
          weight: 0.06,
          label: `learned api ${path}`,
        })),
        oui: profile.signalDigest.oui ? [profile.signalDigest.oui.slice(0, 6)] : [],
      },
      source: 'learned',
      notes: 'Created by the self-learning compatibility layer. Never applies risky changes automatically.',
    };
    this.entries.set(signature.id, signature);
    return signature;
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  /** Convenience: vendor lookup from a gateway MAC. */
  vendorFromMac(mac: string | undefined): string | undefined {
    return lookupOui(mac);
  }
}

function checkRegexes(signature: RouterSignature): string[] {
  const problems: string[] = [];
  const tryPattern = (pattern: string, where: string) => {
    try {
      new RegExp(pattern, 'i');
    } catch (error) {
      problems.push(`invalid regex in ${where}: ${(error as Error).message}`);
    }
  };
  const spec = signature.match ?? {};
  const groups: Array<[string, { pattern: string }[] | undefined]> = [
    ['titles', spec.titles],
    ['body', spec.body],
    ['assets', spec.assets],
    ['formFields', spec.formFields],
    ['cookies', spec.cookies],
    ['serverBanner', spec.serverBanner],
    ['authRealm', spec.authRealm],
    ['apiPaths', spec.apiPaths],
    ['metaGenerator', spec.metaGenerator],
    ['negative', spec.negative],
  ];
  for (const [where, list] of groups) {
    for (const item of list ?? []) tryPattern(item.pattern, where);
  }
  for (const [header, list] of Object.entries(spec.headers ?? {})) {
    for (const item of list ?? []) tryPattern(item.pattern, `headers.${header}`);
  }
  for (const item of signature.firmwarePatterns ?? []) tryPattern(item.pattern, 'firmwarePatterns');
  return problems;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
