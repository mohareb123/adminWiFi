/**
 * SimulatedTransport — a full in-process router, speaking the same HTTP
 * language as real firmware: HTML login pages, session cookies, JSON APIs,
 * TR-069 dumps, status codes and realistic latency.
 *
 * Used by demo mode, by the Local Bridge's virtual-network mode and by the test
 * suite. It is deliberately *faithful* (including failure paths such as wrong
 * passwords, missing features and slow links) so tests prove real behaviour.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { CookieJar, type HttpRequestInit, type HttpResponse, type HttpTransport } from '../core/http';
import type { TransportCapabilities } from '../core/types';
import { sleep, stableId } from '../core/util';
import { MD5_SIM, SHAPES, type RouteContext, type SimulatedResponse } from './shapes';
import { findDevice, tickTraffic, type VirtualRouterProfile, type VirtualRouterState } from './state';

export interface SimulatedTransportOptions {
  profile: VirtualRouterProfile;
  /** Extra latency on top of the profile behaviour (network simulation). */
  networkLatencyMs?: number;
  /** Simulate a link that drops packets (0..1). */
  dropRate?: number;
  capabilities?: Partial<TransportCapabilities>;
}

export class SimulatedTransport implements HttpTransport {
  readonly cookieJar = new CookieJar();
  readonly stats = { requests: 0, failures: 0, bytesIn: 0 };
  readonly capabilities: TransportCapabilities;

  constructor(private readonly options: SimulatedTransportOptions) {
    this.capabilities = {
      kind: 'simulated',
      canReadRoutingTable: true,
      canReachLan: true,
      canReadArp: true,
      canProbeLatency: true,
      canMeasureInternetSpeed: true,
      canSnmp: false,
      label: `Simulated ${options.profile.label}`,
      ...options.capabilities,
    };
  }

  get cookies(): CookieJar {
    return this.cookieJar;
  }

  get profile(): VirtualRouterProfile {
    return this.options.profile;
  }

  async request(init: HttpRequestInit): Promise<HttpResponse> {
    const started = Date.now();
    const url = safeUrl(init.url);
    const path = url ? `${url.pathname}${url.search}` : init.url;
    const method = (init.method ?? 'GET').toUpperCase();
    const state = this.options.profile.state();
    const behaviour = state.behaviour;

    const delay = (behaviour.latencyMs ?? 80) + Math.random() * (behaviour.jitterMs ?? 20) + (this.options.networkLatencyMs ?? 0);
    await sleep(Math.max(1, Math.round(delay)), init.signal);

    if (this.options.dropRate && Math.random() < this.options.dropRate) {
      this.stats.failures += 1;
      throw new Error('simulated packet loss');
    }

    tickTraffic(state);

    const routeContext: RouteContext = {
      state,
      profile: this.options.profile,
      method,
      path,
      url,
      body: typeof init.body === 'string' ? init.body : '',
      headers: init.headers ?? {},
      cookies: this.cookieJar,
      md5: MD5_SIM,
    };

    const response = this.route(routeContext);
    const body = response.body ?? '';
    this.stats.requests += 1;
    this.stats.bytesIn += body.length;

    const setCookies = response.setCookies ?? [];
    for (const cookie of setCookies) {
      const [name, value] = cookie.split(';')[0]!.split('=') as [string, string];
      this.cookieJar.set(name, value ?? '', url?.hostname ?? '192.168.1.1');
    }

    state.requestLog.push({ at: Date.now(), method, path, status: response.status });
    if (state.requestLog.length > 300) state.requestLog.splice(0, state.requestLog.length - 300);

    const headers: Record<string, string> = {
      'content-type': response.contentType ?? 'text/html; charset=utf-8',
      server: response.server ?? this.serverHeader(),
      ...(response.headers ?? {}),
    };
    if (setCookies.length > 0) headers['set-cookie'] = setCookies.join(', ');

    return {
      url: init.url,
      status: response.status,
      statusText: response.statusText ?? (response.status === 200 ? 'OK' : ''),
      headers,
      body,
      durationMs: Date.now() - started,
      redirected: false,
      bytes: body.length,
    };
  }

  private serverHeader(): string {
    const vendor = this.options.profile.state().vendor;
    if (/huawei/i.test(vendor)) return 'Huawei-Web-Server';
    if (/tp-?link/i.test(vendor)) return 'TP-LINK Router Web Server';
    if (/zte/i.test(vendor)) return 'ZXHN HTTP Server';
    if (/d-?link/i.test(vendor)) return 'D-Link Web Server';
    return 'lighttpd/1.4.35';
  }

  private route(context: RouteContext): SimulatedResponse {
    const shape = SHAPES[this.options.profile.id];
    if (shape) return shape(context);
    throw new Error(`no simulated shape registered for profile ${this.options.profile.id}`);
  }

  /** Devices with per-device live rates (used by monitors and Smart Fix). */
  snapshotDevices(state: VirtualRouterState) {
    return state.devices.map((device) => ({ ...device, id: stableId(device.mac) }));
  }
}

function safeUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

export { findDevice };
