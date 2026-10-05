/**
 * RouterFingerprintEngine (spec §3/§5).
 *
 * Collects multiple independent signals — never one signature — then ranks the
 * signature database by weighted evidence and reports a *calibrated*
 * confidence. Low confidence is reported honestly ("limited confidence"), and
 * the engine falls back to the GenericRouterAdapter instead of guessing.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { createLogger } from '../core/logger';
import { HttpSession, type HttpResponse } from '../core/http';
import type {
  ApiHit,
  FingerprintCandidate,
  FingerprintQuality,
  FingerprintReport,
  FingerprintSignals,
  RouterIdentity,
  UpnpInfo,
} from '../core/types';
import {
  extractAssets,
  extractFormActions,
  extractInputs,
  extractMeta,
  extractTag,
  stripTags,
  uniq,
} from '../core/util';
import { rankSignatures } from './matcher';
import type { RouterSignatures } from '../signatures/database';
import { lookupOui } from '../signatures/oui';

const log = createLogger('fingerprint');

/** A hard ceiling on unauthenticated probes — the scan must stay polite. */
export interface ProbeBudget {
  maxRequests: number;
  maxConcurrent: number;
  perRequestTimeoutMs: number;
  used: number;
}

export const DEFAULT_BUDGET: ProbeBudget = {
  maxRequests: 14,
  maxConcurrent: 3,
  perRequestTimeoutMs: 3000,
  used: 0,
};

/** Paths that must never be probed unauthenticated (login/lockout risk). */
const FORBIDDEN_PATH = /(login|logon|logout|auth|signin|set|apply|reboot|restart|reset|delete|remove|admin\/\w+\/save)/i;

/** Read-only endpoints that are safe and informative to try. */
const CANDIDATE_API_PATHS = [
  '/api/system/deviceinfo',
  '/api/device/information',
  '/api/webserver/SesTokInfo',
  '/api/misystem/sys_info',
  '/api/lan/HostInfo',
  '/cgi-bin/luci/api/xqsystem/router_name',
  '/status.cgi',
  '/cgi-bin/deviceinfo.cgi',
  '/jsproxy/rest/system/resource',
  '/custom_page/version.gch',
  '/common_page/status_t.gch',
  '/goform/getSysInfo',
  '/DeviceInfo.xml',
  '/rootDesc.xml',
  '/setup.cgi?todo=info',
];

export interface FingerprintEngineOptions {
  session: HttpSession;
  signatures: RouterSignatures;
  gatewayIp: string;
  gatewayMac?: string;
  budget?: ProbeBudget;
  /** UPnP information injected by the transport layer (bridge SSDP). */
  upnpProvider?: () => Promise<UpnpInfo | undefined>;
  /** Raw peer cert fingerprint, when the transport can read it. */
  tlsInfo?: { issuer?: string; subject?: string; selfSigned?: boolean };
  signal?: AbortSignal;
}

export class RouterFingerprintEngine {
  private budget: ProbeBudget;
  private readonly session: HttpSession;
  private readonly signatures: RouterSignatures;
  private readonly gatewayIp: string;
  private readonly gatewayMac?: string;
  private readonly signal?: AbortSignal;

  constructor(private readonly options: FingerprintEngineOptions) {
    this.session = options.session;
    this.signatures = options.signatures;
    this.gatewayIp = options.gatewayIp;
    this.gatewayMac = options.gatewayMac;
    this.signal = options.signal;
    this.budget = { ...DEFAULT_BUDGET, ...(options.budget ?? {}) };
  }

  /** Collect signals only — useful for diagnostics and re-analysis offline. */
  async collect(): Promise<FingerprintSignals> {
    const root = await this.fetchRoot();
    const signals = this.signalsFromRoot(root);

    const [apiHits, upnp] = await Promise.all([this.probeApiPaths(), this.loadUpnp()]);
    signals.apiHits = apiHits;
    if (upnp) {
      signals.upnp = upnp;
      signals.serverBanner = signals.serverBanner ?? upnp.modelName;
    }
    if (this.options.tlsInfo) (signals as Record<string, unknown>).tls = this.options.tlsInfo;

    log.debug('signals collected', {
      title: signals.title,
      cookies: signals.cookieNames,
      assets: signals.assetPaths.length,
      apiHits: apiHits.length,
      budgetUsed: this.budget.used,
    });
    return signals;
  }

  /** Full pipeline: collect → rank → calibrate → advise. */
  async run(): Promise<FingerprintReport> {
    const signals = await this.collect();
    return this.analyze(signals);
  }

  /** Rank/prepare a report from already-collected signals (pure, offline-safe). */
  analyze(signals: FingerprintSignals): FingerprintReport {
    const candidates = rankSignatures(this.signatures.all(), signals);
    const best = candidates[0];
    const quality = qualityFromScore(best?.score ?? 0);
    const useGeneric = quality === 'low' || quality === 'unknown' || !best;
    const identity = this.buildIdentity(signals, best, useGeneric);
    const advisories: string[] = [];

    if (!best || quality === 'unknown' || quality === 'low') {
      // §7: never guess. Say it plainly and use the generic adapter.
      advisories.push('Router detected with limited confidence.');
      advisories.push('Some operations may be unavailable; the generic adapter will be used where safe.');
    } else if (quality === 'medium') {
      advisories.push('Router identified with medium confidence — capabilities are verified by probing before use.');
    }
    const ouiVendor = lookupOui(signals.gatewayMac);
    if (ouiVendor && best && best.vendor !== 'Unknown' && !identityMatchesVendor(ouiVendor, best.vendor)) {
      advisories.push(`The gateway MAC belongs to ${ouiVendor}, which differs from the detected UI vendor (${best.vendor}).`);
    }
    if (signals.upnp?.firmwareVersion && !identity.firmware) {
      identity.firmware = signals.upnp.firmwareVersion;
    }

    const evidence = candidates
      .slice(0, 3)
      .flatMap((candidate) => candidate.evidence)
      .filter((item, index, list) => list.findIndex((other) => other.matched === item.matched) === index)
      .slice(0, 18);

    return {
      identity,
      quality,
      confidence: best?.confidence ?? 0,
      candidates: candidates.slice(0, 6),
      evidence,
      signals,
      advisories,
      recommendedAdapterId: useGeneric ? 'GenericRouterAdapter' : (best?.adapter ?? 'GenericRouterAdapter'),
      useGenericAdapter: useGeneric,
      capturedAt: new Date().toISOString(),
    };
  }

  /* ------------------------------------------------------------------ */

  private async fetchRoot(): Promise<HttpResponse> {
    this.spend();
    const response = await this.session.request({
      url: '/',
      method: 'GET',
      timeoutMs: this.budget.perRequestTimeoutMs,
      signal: this.signal,
      headers: { accept: 'text/html,application/xhtml+xml,*/*' },
    });
    return response;
  }

  private signalsFromRoot(root: HttpResponse): FingerprintSignals {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(root.headers)) headers[key.toLowerCase()] = value;
    const html = root.body ?? '';
    const inputs = extractInputs(html);
    const pageText = stripTags(html);

    return {
      gatewayIp: this.gatewayIp,
      scheme: new URL(root.url).protocol === 'https:' ? 'https' : 'http',
      headers,
      title: extractTag(html, 'title'),
      metaGenerator: extractMeta(html, 'generator') ?? extractMeta(html, 'application-name'),
      authRealm: parseRealm(headers['www-authenticate']),
      cookieNames: uniq([
        ...(this.session.transport.cookies?.snapshot().map((cookie) => cookie.name) ?? []),
        ...parseSetCookieNames(headers['set-cookie']),
      ]),
      assetPaths: extractAssets(html),
      formFields: uniq([
        ...inputs.map((input) => input.name),
        ...inputs.map((input) => input.id ?? '').filter(Boolean),
        ...inputs.map((input) => input.placeholder ?? '').filter(Boolean),
      ]),
      formAction: extractFormActions(html)[0],
      pageText: pageText.slice(0, 20000),
      pageSize: html.length,
      apiHits: [],
      gatewayMac: this.gatewayMac,
      serverBanner: headerBanner(headers),
    };
  }

  private async probeApiPaths(): Promise<ApiHit[]> {
    const declared = uniq([
      ...CANDIDATE_API_PATHS,
      ...this.signatures
        .all()
        .flatMap((signature) => Object.values(signature.api ?? {}))
        .map((path) => (path ?? '').split(' ')[0] ?? '')
        .filter((path) => path.startsWith('/')),
    ]).filter((path) => !FORBIDDEN_PATH.test(path) && !path.includes('{'));

    const hits: ApiHit[] = [];
    const queue = declared.slice(0, 18);

    const worker = async () => {
      for (;;) {
        if (this.signal?.aborted) return;
        if (this.budget.used >= this.budget.maxRequests) return;
        const path = queue.shift();
        if (!path) return;
        this.spend();
        try {
          const response = await this.session.request({
            url: path,
            method: 'GET',
            timeoutMs: this.budget.perRequestTimeoutMs,
            signal: this.signal,
          });
          if (response.status < 400) {
            const contentType = response.headers['content-type'] ?? '';
            const sample = response.body.slice(0, 400);
            hits.push({
              path,
              method: 'GET',
              status: response.status,
              contentType,
              sample,
              dataLike: looksLikeData(contentType, response.body),
            });
          }
        } catch {
          /* probing is best-effort by design */
        }
      }
    };

    await Promise.all(Array.from({ length: this.budget.maxConcurrent }, worker));
    return hits;
  }

  private async loadUpnp(): Promise<UpnpInfo | undefined> {
    if (!this.options.upnpProvider) return undefined;
    try {
      return await this.options.upnpProvider();
    } catch {
      return undefined;
    }
  }

  private spend(): void {
    this.budget.used += 1;
  }

  private buildIdentity(
    signals: FingerprintSignals,
    best: FingerprintCandidate | undefined,
    useGeneric: boolean,
  ): RouterIdentity {
    const upnp = signals.upnp;
    const vendor = upnp?.manufacturer ?? best?.vendor ?? 'Unknown';
    const model = upnp?.modelName ?? (useGeneric && !best ? 'Unknown router' : (best?.model ?? 'Unknown router'));
    return {
      vendor: vendor === 'Unknown' && upnp?.manufacturer ? upnp.manufacturer : vendor,
      vendorRaw: signals.title,
      model,
      modelRaw: upnp?.modelNumber ?? signals.title,
      firmware: detectFirmware(signals) ?? upnp?.firmwareVersion,
      hardwareVersion: upnp?.modelNumber,
      serialNumber: upnp?.serialNumber,
      deviceClass: upnp?.deviceType,
      ouiVendor: lookupOui(signals.gatewayMac),
    };
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Distinguish a real API payload from the "soft 404" shell page that many
 * firmwares return with HTTP 200 for any unknown path.
 */
export function looksLikeData(contentType: string, body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;
  const looksHtml = /^<!doctype html|^<html|^\s*<head/i.test(trimmed);
  if (looksHtml) return false;
  const type = contentType.toLowerCase();
  if (type.includes('json')) return /^[[{]/.test(trimmed);
  if (type.includes('xml')) return /^(<\?xml|<[a-z])/i.test(trimmed);
  if (/^[[{]/.test(trimmed)) return true;
  if (/^<\?xml/i.test(trimmed)) return true;
  // A bare XML fragment (e.g. Huawei's SesTokInfo response) also counts.
  if (/^<[a-z][a-z0-9_-]*>/i.test(trimmed) && !/<html/i.test(trimmed)) return true;
  return false;
}

export function qualityFromScore(score: number): FingerprintQuality {
  if (score >= 0.9) return 'exact';
  if (score >= 0.72) return 'high';
  if (score >= 0.5) return 'medium';
  if (score >= 0.22) return 'low';
  return 'unknown';
}

export function qualityLabel(quality: FingerprintQuality): string {
  switch (quality) {
    case 'exact':
      return 'High confidence';
    case 'high':
      return 'Confident';
    case 'medium':
      return 'Probable';
    case 'low':
      return 'Limited confidence';
    default:
      return 'Unknown';
  }
}

function parseRealm(wwwAuthenticate: string | undefined): string | undefined {
  if (!wwwAuthenticate) return undefined;
  const match = /realm\s*=\s*"?([^",]+)"?/i.exec(wwwAuthenticate);
  return match?.[1]?.trim();
}

function parseSetCookieNames(setCookie: string | undefined): string[] {
  if (!setCookie) return [];
  return setCookie
    .split(/,(?=[^;=]+=)/g)
    .map((part) => part.split('=')[0]?.trim() ?? '')
    .filter(Boolean);
}

function headerBanner(headers: Record<string, string>): string | undefined {
  const parts = [headers.server, headers['x-powered-by'], headers['www-authenticate']].filter(Boolean);
  return parts.length ? parts.join(' | ') : undefined;
}

function detectFirmware(signals: FingerprintSignals): string | undefined {
  const haystack = `${signals.title ?? ''} ${signals.pageText?.slice(0, 6000) ?? ''} ${signals.serverBanner ?? ''}`;
  const patterns = [
    /(?:firmware|software|firmware\s+version|version)[^0-9a-z]{0,14}([vV]?\d+\.\d+(?:\.\d+)?(?:[A-Za-z0-9.\-]*)?)/i,
    /(V\d+R\d{3}[A-Za-z0-9]*)/,
    /(\d+\.\d+\.\d+\s*Build\s*\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(haystack);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function identityMatchesVendor(ouiVendor: string, signatureVendor: string): boolean {
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const a = normalize(ouiVendor);
  const b = normalize(signatureVendor);
  return a === b || a.includes(b) || b.includes(a);
}
