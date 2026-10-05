/**
 * Router discovery (spec §2).
 *
 * Safe, non-aggressive and non-invasive:
 *  - the OS/transport reports the default gateway; we never guess-and-spray;
 *  - a *bounded* list of well-known private gateway addresses is probed only
 *    when the transport can actually reach the LAN;
 *  - HTTP/HTTPS management surfaces are identified from status + headers +
 *    title; nothing is submitted, no credentials are attempted;
 *  - no brute force, no authentication bypass, no port exploitation.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { createLogger } from '../core/logger';
import { HttpSession } from '../core/http';
import type { HttpTransport } from '../core/http';
import type { DetectedService, DiscoveryReport, ManagementInterface } from '../core/types';
import { clamp, isValidIpv4, mapLimited } from '../core/util';

const log = createLogger('discovery');

/** Well-known private gateway addresses, ordered by real-world frequency. */
export const COMMON_GATEWAYS: string[] = [
  '192.168.1.1',
  '192.168.0.1',
  '192.168.100.1',
  '192.168.8.1',
  '192.168.1.254',
  '192.168.2.1',
  '10.0.0.1',
  '10.0.0.138',
  '10.1.1.1',
  '172.16.0.1',
];

/** Administrative surfaces worth probing once a host answers. */
const ADMIN_PORTS: Array<{ port: number; scheme: 'http' | 'https' }> = [
  { port: 80, scheme: 'http' },
  { port: 443, scheme: 'https' },
  { port: 8080, scheme: 'http' },
  { port: 8000, scheme: 'http' },
  { port: 8443, scheme: 'https' },
];

export type DiscoveryPhase = 'gateway' | 'hosts' | 'ports' | 'services' | 'done';

export interface DiscoveryProgress {
  phase: DiscoveryPhase;
  /** i18n key — the UI renders Arabic copy for these. */
  messageKey: string;
  done: number;
  total: number;
  found?: string;
}

export interface DiscoveryOptions {
  transport: HttpTransport;
  /** Gateways reported by the transport (routing table / bridge). */
  gatewayCandidates?: string[];
  /** Extra hosts to try (user supplied, multi-router). */
  extraHosts?: string[];
  /** Include the common private gateway list (default: when LAN reachable). */
  scanCommonGateways?: boolean;
  /** Probe non-standard admin ports (default: when LAN reachable). */
  scanAdminPorts?: boolean;
  /** Injectable service detector (bridge implements TCP/SSDP probes). */
  serviceDetector?: (host: string, signal?: AbortSignal) => Promise<DetectedService[]>;
  maxHosts?: number;
  perRequestTimeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: DiscoveryProgress) => void;
}

export class RouterDiscovery {
  constructor(private readonly options: DiscoveryOptions) {}

  async discover(): Promise<DiscoveryReport> {
    const started = Date.now();
    const notes: string[] = [];
    const transport = this.options.transport;
    const canReachLan = transport.capabilities.canReachLan;

    this.report({ phase: 'gateway', messageKey: 'discovery.gateway', done: 0, total: 1 });

    const gatewayCandidates = this.collectGateways(notes, canReachLan);
    const hosts = this.collectHosts(gatewayCandidates, canReachLan, notes);

    this.report({ phase: 'hosts', messageKey: 'discovery.hosts', done: 0, total: hosts.length });

    const scanPorts = this.options.scanAdminPorts ?? canReachLan;
    let completed = 0;
    const interfaces: ManagementInterface[] = [];

    await mapLimited(hosts, 3, async (host) => {
      const hostResults = await this.probeHost(host, scanPorts);
      interfaces.push(...hostResults);
      completed += 1;
      if (hostResults.some((entry) => entry.reachable)) {
        this.report({
          phase: 'ports',
          messageKey: 'discovery.ports',
          done: completed,
          total: hosts.length,
          found: hostResults[0]?.baseUrl,
        });
      }
    });

    const reachable = interfaces.filter((entry) => entry.reachable);
    let best = this.pickBest(reachable, gatewayCandidates);

    if (best && this.options.serviceDetector) {
      this.report({ phase: 'services', messageKey: 'discovery.services', done: 0, total: 1 });
      try {
        best.services = await this.options.serviceDetector(best.host, this.options.signal);
      } catch (error) {
        notes.push(`Service detection failed: ${(error as Error).message}`);
      }
    }

    if (!best) {
      notes.push(
        canReachLan
          ? 'No management interface answered on the probed addresses.'
          : 'This environment cannot reach local network addresses (browser security model). Run the Local Bridge on a device inside the network.',
      );
    }

    this.report({ phase: 'done', messageKey: 'discovery.done', done: hosts.length, total: hosts.length });

    const report: DiscoveryReport = {
      transport: transport.capabilities,
      gatewayCandidates,
      hostCandidates: hosts,
      interfaces,
      best,
      scannedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      notes,
      empty: !best,
    };
    log.info('discovery complete', {
      hosts: hosts.length,
      reachable: reachable.length,
      best: best?.baseUrl,
      durationMs: report.durationMs,
    });
    return report;
  }

  /* ------------------------------------------------------------------ */

  private collectGateways(notes: string[], canReachLan: boolean): string[] {
    const provided = (this.options.gatewayCandidates ?? []).filter(isValidIpv4);
    if (provided.length === 0) {
      notes.push(
        canReachLan
          ? 'The transport did not report a default gateway; falling back to common gateway addresses.'
          : 'Default gateway is not readable from this environment.',
      );
    }
    return [...new Set(provided)];
  }

  private collectHosts(gateways: string[], canReachLan: boolean, notes: string[]): string[] {
    const hosts = new Set<string>();
    for (const gateway of gateways) hosts.add(gateway);
    for (const extra of this.options.extraHosts ?? []) if (isValidIpv4(extra)) hosts.add(extra);

    const scanCommon = this.options.scanCommonGateways ?? canReachLan;
    if (scanCommon && hosts.size < (this.options.maxHosts ?? 6)) {
      for (const candidate of COMMON_GATEWAYS) {
        if (hosts.size >= (this.options.maxHosts ?? 6)) break;
        hosts.add(candidate);
      }
      if (gateways.length === 0) notes.push('Probing common private gateway addresses (bounded list).');
    }
    return [...hosts].slice(0, this.options.maxHosts ?? 6);
  }

  private async probeHost(host: string, scanPorts: boolean): Promise<ManagementInterface[]> {
    const targets = scanPorts ? ADMIN_PORTS : ADMIN_PORTS.slice(0, 2);
    const results: ManagementInterface[] = [];
    await mapLimited(targets, 2, async ({ port, scheme }) => {
      const entry = await this.probeInterface(host, scheme, port);
      if (entry.reachable || entry.status !== undefined || entry.error === 'auth-required') results.push(entry);
    });
    return results;
  }

  private async probeInterface(
    host: string,
    scheme: 'http' | 'https',
    port: number,
  ): Promise<ManagementInterface> {
    const baseUrl = `${scheme}://${host}${port === 80 || port === 443 ? '' : `:${port}`}`;
    const session = new HttpSession({
      transport: this.options.transport,
      baseUrl,
      timeoutMs: this.options.perRequestTimeoutMs ?? 2500,
      signal: this.options.signal,
    });
    const entry: ManagementInterface = { baseUrl, host, scheme, port, reachable: false };
    try {
      const response = await session.request({
        url: '/',
        method: 'GET',
        timeoutMs: this.options.perRequestTimeoutMs ?? 2500,
        signal: this.options.signal,
        headers: { accept: 'text/html,application/xhtml+xml,*/*' },
      });
      entry.status = response.status;
      entry.latencyMs = Math.round(response.durationMs);
      entry.server = response.headers.server;
      entry.wwwAuthenticate = response.headers['www-authenticate'];
      entry.contentType = response.headers['content-type'];
      entry.setCookieNames = parseCookieNames(response.headers['set-cookie']);
      entry.title = /<title[^>]*>([\s\S]{0,120}?)<\/title>/i.exec(response.body)?.[1]?.trim();

      // A management surface: HTML, an auth challenge, a session cookie or a
      // redirect to a login/setup page. Anything else is just an open port.
      const isManagement =
        response.status === 401 ||
        entry.setCookieNames.length > 0 ||
        /text\/html/i.test(entry.contentType ?? '') ||
        /<html|<title|login|password/i.test(response.body.slice(0, 3000));
      entry.reachable = isManagement && response.status < 500;
      if (!entry.reachable) entry.error = `unexpected-response-${response.status}`;
    } catch (error) {
      const message = (error as Error).message ?? 'unreachable';
      entry.error = /timeout|aborted/i.test(message) ? 'timeout' : 'unreachable';
    }
    return entry;
  }

  private pickBest(
    reachable: ManagementInterface[],
    gateways: string[],
  ): ManagementInterface | undefined {
    if (reachable.length === 0) return undefined;
    const score = (entry: ManagementInterface): number => {
      let value = 0;
      if (gateways.includes(entry.host)) value += 40; // the OS-reported gateway wins
      if (entry.title) value += 12;
      if (entry.status !== undefined && entry.status < 400) value += 8;
      if (entry.status === 401) value += 6; // definitely an admin surface
      if (entry.setCookieNames?.length) value += 6;
      if (entry.scheme === 'http') value += 4; // avoids mixed-content blocks in browsers
      if (entry.port === 80) value += 3;
      if (entry.server) value += 2;
      return value + clamp(20 - (entry.latencyMs ?? 400) / 100, 0, 5);
    };
    return [...reachable].sort((a, b) => score(b) - score(a))[0];
  }

  private report(progress: DiscoveryProgress): void {
    try {
      this.options.onProgress?.(progress);
    } catch {
      /* progress reporting must never break discovery */
    }
  }
}

function parseCookieNames(setCookie: string | undefined): string[] {
  if (!setCookie) return [];
  return setCookie
    .split(/,(?=[^;=]+=)/g)
    .map((part) => part.split('=')[0]?.trim() ?? '')
    .filter(Boolean);
}
