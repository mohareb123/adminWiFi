/**
 * Demo / test entry point: builds a fully wired UniversalRouterEngine against a
 * simulated router, or a stand-in bridge-like transport.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { createSimulatedSpeedTestBackend } from '../diagnostics/speedtest';
import { UniversalRouterEngine, type EngineOptions } from '../router_engine/engine';
import { RouterSignatures } from '../signatures';
import { createProfile, DEMO_PROFILE_IDS, SIMULATED_PROFILES } from './profiles';
import { SimulatedTransport, type SimulatedTransportOptions } from './transport';

export { SIMULATED_PROFILES, DEMO_PROFILE_IDS, createProfile } from './profiles';
export { SimulatedTransport } from './transport';
export { baseState, DEMO_DEVICES, DEMO_NEIGHBORS, findDevice, tickTraffic } from './state';
export type { VirtualRouterProfile, VirtualRouterState, VirtualDevice } from './state';

export const DEFAULT_DEMO_PROFILE = 'huawei-hg8145';

export interface DemoEngineOptions extends Omit<SimulatedTransportOptions, 'profile'> {
  profileId?: string;
  /** Extra engine options (learner, signatures, ...). */
  engine?: Partial<EngineOptions>;
}

/** Build a transport + engine pair wired to a simulated device. */
export function createDemoEngine(options: DemoEngineOptions = {}): {
  engine: UniversalRouterEngine;
  transport: SimulatedTransport;
  profileId: string;
} {
  const profileId = options.profileId ?? DEFAULT_DEMO_PROFILE;
  const profile = createProfile(profileId);
  const transport = new SimulatedTransport({ ...options, profile });
  const engine = new UniversalRouterEngine({
    transport,
    signatures: new RouterSignatures(),
    gatewayProvider: async () => ({ gateways: [profile.state().lan.ip], mac: profile.state().wan.mac }),
    serviceDetector: async () => [
      { port: 80, protocol: 'http', open: true, detail: 'simulated management UI' },
      { port: 1900, protocol: 'upnp', open: true, detail: 'SSDP advertised' },
      { port: 7547, protocol: 'tr069', open: false, detail: 'not exposed' },
    ],
    speedTestBackend: createSimulatedSpeedTestBackend({
      downloadMbps: profileId === 'dlink-dir825' ? 24 : profileId === 'openwrt-generic' ? 18 : 42.8,
      uploadMbps: profileId === 'dlink-dir825' ? 4.2 : 8.2,
      pingMs: profileId === 'openwrt-generic' ? 68 : 24,
    }),
    ...options.engine,
  });
  return { engine, transport, profileId };
}

/** Credentials for a simulated profile (demo convenience). */
export function demoCredentials(profileId: string): { username: string; password: string } {
  const profile = SIMULATED_PROFILES[profileId] ?? SIMULATED_PROFILES[DEFAULT_DEMO_PROFILE];
  return { ...profile.credentials };
}
