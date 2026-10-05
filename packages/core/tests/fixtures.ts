/**
 * Shared test helpers — wire the real engine to a simulated device.
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { MemoryStore } from '../src/storage/types';
import { LearningStore } from '../src/storage/learning';
import { RouterSignatures } from '../src/signatures';
import { UniversalRouterEngine } from '../src/router_engine/engine';
import { SimulatedTransport } from '../src/simulated/transport';
import { createProfile } from '../src/simulated/profiles';

export interface Harness {
  engine: UniversalRouterEngine;
  transport: SimulatedTransport;
  signatures: RouterSignatures;
  learner: LearningStore;
  profileId: string;
}

export function createHarness(profileId: string, options: { dropRate?: number; busy?: boolean } = {}): Harness {
  const profile = createProfile(profileId);
  const transport = new SimulatedTransport({
    profile,
    dropRate: options.dropRate,
    networkLatencyMs: 0,
  });
  const signatures = new RouterSignatures();
  const learner = new LearningStore({ store: new MemoryStore(), signatures });
  const engine = new UniversalRouterEngine({
    transport,
    signatures,
    learner,
    gatewayProvider: async () => ({ gateways: [profile.state().lan.ip], mac: profile.state().wan.mac }),
    serviceDetector: async () => [{ port: 80, protocol: 'http', open: true }],
  });
  return { engine, transport, signatures, learner, profileId };
}

export const credentialsFor = (profileId: string) => createProfile(profileId).credentials;
