/**
 * Node platform for the portable EngineHost.
 *
 * The host logic itself lives in `@urlm/core` (packages/core/src/host) so the
 * Android shell can run the very same code with native services instead. This
 * file only supplies what Node/the desktop brings to the table:
 *   - an encrypted file vault,
 *   - a raw-socket HTTP transport that can honour self-signed LAN certificates,
 *   - OS routing-table / ARP / SSDP / TCP-latency services,
 *   - the bridge-hosted speed-test backend.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

import { EngineHost as PortableEngineHost } from '@urlm/core';
import type { HostPlatform, HttpTransport, SpeedTestBackend } from '@urlm/core';
import { NodeHttpTransport } from './node-transport.ts';
import { createTcpLatencyProbe, detectGateway, detectServices, discoverUpnp } from './system.ts';
import { createBridgeSpeedTest } from './speedtest.ts';
import { createVault } from './vault.ts';

export type { BridgeMode, ConnectRequest, HostEventMap, HostStateSnapshot } from '@urlm/core';
export { createFetchLatencyProbe, formatKbps } from '@urlm/core';

/** Speed-test mode for real connections: LAN only, or LAN with internet fallback. */
const SPEEDTEST_MODE: 'lan' | 'auto' = process.env.URLM_SPEEDTEST === 'lan' ? 'lan' : 'auto';

export function createNodePlatform(): HostPlatform {
  return {
    kind: 'bridge',
    label: 'Local Bridge (Node.js)',
    createStorage: (options) => {
      const bundle = createVault({ persist: options.persist });
      return {
        vault: bundle.vault,
        store: bundle.store,
        routers: bundle.routers,
        root: bundle.paths.root,
      };
    },
    realTransport: (): HttpTransport => new NodeHttpTransport(),
    gateway: async () => {
      const info = await detectGateway();
      return { gateways: info.gateways, mac: info.mac };
    },
    services: (host, signal) => detectServices(host, signal),
    upnp: (host) => discoverUpnp(host),
    latencyProbe: (host) => createTcpLatencyProbe(host, 80, 2000),
    speedTest: ({ selfUrl }): SpeedTestBackend =>
      createBridgeSpeedTest({
        lanDownloadUrl: `${selfUrl}/api/speedtest/payload`,
        lanUploadUrl: `${selfUrl}/api/speedtest/upload`,
        internetDownloadUrl: 'https://speed.cloudflare.com/__down',
        internetUploadUrl: 'https://speed.cloudflare.com/__up',
        mode: SPEEDTEST_MODE,
      }),
    selfUrl: () => `http://127.0.0.1:${process.env.PORT ?? 8787}`,
  };
}

/**
 * The desktop bridge's host. It is a thin subclass so every existing call-site
 * (`new EngineHost({ persist })`, `host.setSelfUrl(...)`, …) keeps working.
 */
export class EngineHost extends PortableEngineHost {
  constructor(options: { persist?: boolean } = {}) {
    super({ platform: createNodePlatform(), persist: options.persist });
  }
}
