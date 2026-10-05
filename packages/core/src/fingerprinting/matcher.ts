/**
 * Evidence-based signature matcher.
 *
 * Design rules (spec §3/§5):
 *  - never trust a single indicator;
 *  - each indicator category has a reliability multiplier;
 *  - negative evidence is subtracted, not ignored;
 *  - a signature can cap its own maximum contribution (anti-overreach);
 *  - the output is always explainable: every point of confidence has evidence.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import type { Evidence, FingerprintCandidate, FingerprintSignals } from '../core/types';
import { clamp, similarity } from '../core/util';
import { lookupOui } from '../signatures/oui';
import type { RouterSignature, WeightedPattern } from '../signatures/types';

interface CategorySpec {
  name: string;
  /** How much this category is trusted (multiplied into each pattern weight). */
  reliability: number;
}

const CATEGORY: Record<string, CategorySpec> = {
  title: { name: 'title', reliability: 1 },
  apiPath: { name: 'apiPath', reliability: 1 },
  authRealm: { name: 'authRealm', reliability: 0.95 },
  header: { name: 'header', reliability: 0.9 },
  serverBanner: { name: 'serverBanner', reliability: 0.9 },
  metaGenerator: { name: 'metaGenerator', reliability: 0.9 },
  formField: { name: 'formField', reliability: 0.85 },
  cookie: { name: 'cookie', reliability: 0.85 },
  body: { name: 'body', reliability: 0.8 },
  asset: { name: 'asset', reliability: 0.7 },
  oui: { name: 'oui', reliability: 0.7 },
  firmware: { name: 'firmware', reliability: 0.8 },
};

export interface MatchOutcome {
  candidate: FingerprintCandidate;
  /** Model/firmware values discovered while matching. */
  extracted: { model?: string; firmware?: string; hardware?: string; serial?: string; realm?: string };
  /** True when at least one *strong* (reliability ≥ 0.9) indicator matched. */
  hasStrongEvidence: boolean;
}

/** Score one signature against collected signals. */
export function scoreSignature(signature: RouterSignature, signals: FingerprintSignals): MatchOutcome {
  const evidence: Evidence[] = [];
  const extracted: MatchOutcome['extracted'] = {};
  let strongHits = 0;
  let raw = 0;
  let categoryHits = 0;

  const apply = (
    category: keyof typeof CATEGORY,
    pattern: WeightedPattern,
    value: string | undefined,
    signalLabel: string,
    isOui = false,
  ) => {
    if (!value) return false;
    let match: RegExpExecArray | null = null;
    try {
      match = new RegExp(pattern.pattern, 'i').exec(value);
    } catch {
      return false;
    }
    if (!match) return false;
    const spec = CATEGORY[category] as CategorySpec;
    const contribution = clamp(pattern.weight * spec.reliability, 0, 0.6);
    raw += contribution;
    if (spec.reliability >= 0.9) strongHits += 1;
    evidence.push({
      signal: signalLabel,
      observed: truncate(value),
      matched: pattern.label ?? pattern.pattern,
      weight: round(contribution),
      polarity: 'positive',
      detail: isOui ? `OUI vendor: ${value}` : undefined,
    });
    if (pattern.extractGroup && match[pattern.extractGroup]) {
      const captured = match[pattern.extractGroup] as string;
      if (pattern.extractAs) {
        const slot = pattern.extractAs;
        if (slot === 'model' || slot === 'firmware' || slot === 'hardware' || slot === 'serial' || slot === 'realm') {
          extracted[slot] = captured;
        }
      }
    }
    return true;
  };

  const safeTest = (source: string, value: string): boolean => {
    try {
      return new RegExp(source, 'i').test(value);
    } catch {
      return false;
    }
  };

  const spec = signature.match ?? {};

  for (const pattern of spec.titles ?? []) apply('title', pattern, signals.title, 'title');
  for (const [headerName, patterns] of Object.entries(spec.headers ?? {})) {
    const headerValue = signals.headers[headerName.toLowerCase()];
    for (const pattern of patterns) apply('header', pattern, headerValue, `header:${headerName}`);
  }
  for (const pattern of spec.body ?? []) apply('body', pattern, signals.pageText ?? '', 'page content');
  for (const pattern of spec.assets ?? []) apply('asset', pattern, signals.assetPaths.join(' '), 'assets');
  for (const pattern of spec.formFields ?? [])
    apply('formField', pattern, [...signals.formFields, signals.formAction ?? ''].join(' '), 'form fields');
  for (const pattern of spec.cookies ?? []) apply('cookie', pattern, signals.cookieNames.join(' '), 'cookies');
  for (const pattern of spec.serverBanner ?? []) apply('serverBanner', pattern, signals.serverBanner, 'server banner');
  for (const pattern of spec.authRealm ?? []) apply('authRealm', pattern, signals.authRealm, 'auth realm');
  for (const pattern of spec.apiPaths ?? []) {
    const matched = signals.apiHits.filter((hit) => safeTest(pattern.pattern, hit.path));
    if (matched.length === 0) continue;
    // Answers that were just the firmware's shell page count as weak evidence.
    const trusted = matched.filter((hit) => hit.dataLike !== false);
    apply(
      'apiPath',
      trusted.length > 0 ? pattern : { ...pattern, weight: pattern.weight * 0.2 },
      matched.map((hit) => hit.path).join(' '),
      'api paths',
    );
  }
  for (const pattern of spec.metaGenerator ?? []) apply('metaGenerator', pattern, signals.metaGenerator, 'meta generator');
  for (const pattern of signature.firmwarePatterns ?? [])
    apply('firmware', pattern, `${signals.pageText ?? ''} ${signals.serverBanner ?? ''}`, 'firmware string');

  // OUI evidence: the gateway MAC vendor must agree with the signature vendor.
  if (spec.oui?.length && signals.gatewayMac) {
    const ouiVendor = lookupOui(signals.gatewayMac);
    const prefix = signals.gatewayMac.toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 6);
    if (spec.oui.includes(prefix)) {
      apply(
        'oui',
        { pattern: prefix, weight: 0.18, label: `MAC OUI matches ${signature.vendor}` },
        prefix,
        'gateway MAC',
        true,
      );
    } else if (ouiVendor && !vendorsAgree(ouiVendor, signature.vendor)) {
      const penalty = 0.22;
      raw -= penalty;
      evidence.push({
        signal: 'gateway MAC',
        observed: `${prefix} (${ouiVendor})`,
        matched: `signature expects ${signature.vendor}`,
        weight: -round(penalty),
        polarity: 'negative',
        detail: 'MAC vendor disagrees with this signature',
      });
    }
  }

  // Negative patterns (competing brand tokens present on the page).
  for (const pattern of spec.negative ?? []) {
    const haystack = `${signals.pageText ?? ''} ${signals.title ?? ''}`;
    const found = safeTest(pattern.pattern, haystack);
    if (found) {
      const penalty = clamp(pattern.weight, 0, 0.4);
      raw -= penalty;
      evidence.push({
        signal: 'page content',
        observed: truncate(extractMatch(pattern.pattern, haystack) ?? haystack),
        matched: pattern.label ?? pattern.pattern,
        weight: -round(penalty),
        polarity: 'negative',
      });
    }
  }

  categoryHits = new Set(evidence.filter((item) => item.polarity === 'positive').map((item) => item.signal)).size;

  let score = clamp(raw, 0, 1);
  if (signature.maxConfidence !== undefined) score = Math.min(score, signature.maxConfidence);
  // Diversity guard: a single signal family cannot claim certainty.
  if (strongHits <= 1 && categoryHits <= 1) score = Math.min(score, 0.45);
  if (strongHits === 0 && categoryHits > 0) score = Math.min(score, 0.4);
  // Reward breadth of agreement.
  if (strongHits >= 3) score = clamp(score * 1.06, 0, 1);
  if (strongHits >= 4) score = clamp(score * 1.04, 0, 1);

  return {
    candidate: {
      signatureId: signature.id,
      vendor: signature.vendor,
      model: refineModel(signature, signals, extracted.model),
      adapter: signature.adapter,
      score: round(score),
      confidence: Math.round(score * 100),
      evidence: sortEvidence(evidence),
    },
    extracted,
    hasStrongEvidence: strongHits > 0,
  };
}

/** Rank all signatures. The generic fallback is never allowed to win over a real match. */
export function rankSignatures(signatures: RouterSignature[], signals: FingerprintSignals): FingerprintCandidate[] {
  const outcomes = signatures.map((signature) => ({
    signature,
    outcome: scoreSignature(signature, signals),
  }));

  const real = outcomes.filter(({ signature }) => signature.id !== 'generic.unknown');
  const generic = outcomes.find(({ signature }) => signature.id === 'generic.unknown');

  const ranked = real
    .map(({ outcome }) => outcome.candidate)
    .filter((candidate) => candidate.score > 0.08)
    .sort((a, b) => b.score - a.score || a.vendor.localeCompare(b.vendor));

  if (generic) {
    const best = ranked[0];
    const genericScore = best ? Math.min(generic.outcome.candidate.score, Math.max(0.05, 0.34 - (best.score - 0.34))) : 0.34;
    ranked.push({ ...generic.outcome.candidate, score: round(clamp(genericScore, 0.05, 0.35)), confidence: Math.round(genericScore * 100) });
    ranked.sort((a, b) => b.score - a.score);
  }

  return ranked;
}

function refineModel(signature: RouterSignature, signals: FingerprintSignals, extracted?: string): string {
  if (extracted) return extracted.trim();
  const haystack = [signals.title, signals.authRealm, signals.serverBanner, signals.metaGenerator, signals.pageText?.slice(0, 4000)]
    .filter(Boolean)
    .join(' ');
  for (const pattern of signature.modelPatterns ?? []) {
    const match = safeExec(pattern, haystack);
    if (match?.[1]) return match[1].trim();
    if (match?.[0]) return match[0].trim();
  }
  return signature.model;
}

function sortEvidence(evidence: Evidence[]): Evidence[] {
  return [...evidence].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 14);
}

function safeTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(value);
  } catch {
    return false;
  }
}

function safeExec(pattern: string, value: string): RegExpExecArray | null {
  try {
    return new RegExp(pattern, 'i').exec(value);
  } catch {
    return null;
  }
}

function extractMatch(pattern: string, value: string): string | undefined {
  const match = safeExec(pattern, value);
  if (!match) return undefined;
  const index = Math.max(0, match.index - 20);
  return value.slice(index, index + 60);
}

function vendorsAgree(a: string, b: string): boolean {
  const normalized = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const left = normalized(a);
  const right = normalized(b);
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  return similarity(left, right) > 0.72;
}

function truncate(value: string, max = 90): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
