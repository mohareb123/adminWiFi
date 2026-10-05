/**
 * HostPlatform for the Android shell — the native services behind the same
 * engine host that the desktop bridge runs.
 *
 * What Android can and cannot give us, honestly:
 *  - gateway / DNS / current Wi-Fi SSID come from the Android network APIs via
 *    the companion plugin (with a safe fallback: the engine's own gateway scan);
 *  - latency is a real socket probe (native ping, else HTTP round-trip);
 *  - UPnP/TR-064 uses the description XML over HTTP — no UDP multicast, so an
 *    IGD that only answers SSDP is simply reported as "no UPnP data" instead of
 *    pretending;
 *  - SNMP is not attempted (the WebView has no UDP), and the capability matrix
 *    says so.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 * محمد إبراهيم أبو العز
 */

import { UPNP_DESCRIPTION_PATHS, parseDeviceDescription } from '@urlm/core';
import type { DetectedService, HostPlatform, HostSpeedPlan, LatencyProbe, SpeedTestBackend, UpnpInfo } from '@urlm/core';
import { deviceTransport } from './capacitor-http';
import { nativeNetworkInfo, nativePing } from './native-bridge';
import { createDeviceSpeedTest } from './device-speedtest';
import { createDeviceStorage } from './device-storage';

const PROBE_PORTS: Array<{ port: number; protocol: DetectedService['protocol'] }> = [
  { port: 80, protocol: 'http' },
  { port: 443, protocol: 'https' },
  { port: 8080, protocol: 'http' },
  { port: 8443, protocol: 'https' },
];

export function createDevicePlatform(options: { sealed: boolean }): HostPlatform {
  const transport = deviceTransport();

  return {
    kind: 'device',
    label: 'Android device shell (on-phone engine)',

    createStorage: ({ persist }) => createDeviceStorage({ persist, sealed: options.sealed }),

    realTransport: () => transport,

    async gateway() {
      const info = await nativeNetworkInfo();
      const gateways: string[] = [];
      if (info?.gateway) gateways.push(info.gateway);
      // The engine also scans common gateway addresses; the OS answer is a hint.
      return { gateways, mac: info?.bssid };
    },

    async services(host) {
      const results: DetectedService[] = [];
      for (const probe of PROBE_PORTS) {
        const url = `${probe.protocol}://${host}/`;
        try {
          const response = await transport.request({ url, method: 'GET', timeoutMs: 2500, useCookieJar: false });
          results.push({
            port: probe.port,
            protocol: probe.protocol,
            open: response.status > 0 && response.status < 500,
            detail: `HTTP ${response.status}`,
          });
        } catch {
          results.push({ port: probe.port, protocol: probe.protocol, open: false });
        }
      }
      return results;
    },

    async upnp(host?: string): Promise<UpnpInfo | undefined> {
      if (!host) return undefined;
      for (const path of UPNP_DESCRIPTION_PATHS) {
        try {
          const response = await transport.request({
            url: `http://${host}${path}`,
            method: 'GET',
            timeoutMs: 2500,
            useCookieJar: false,
          });
          if (response.status === 200 && /<root|<specVersion|<device/i.test(response.body)) {
            return parseDeviceDescription(response.body);
          }
        } catch {
          /* try the next location */
        }
      }
      return undefined;
    },

    latencyProbe(host: string): LatencyProbe {
      return async () => {
        const native = await nativePing(host, 80, 2500);
        if (native?.reachable && native.latencyMs > 0) return { latencyMs: native.latencyMs, reachable: true };
        const started = Date.now();
        try {
          await transport.request({ url: `http://${host}/`, method: 'GET', timeoutMs: 2500, useCookieJar: false });
          return { latencyMs: Date.now() - started, reachable: true };
        } catch {
          return { latencyMs: 0, reachable: false };
        }
      };
    },

    speedTest({ sessionBaseUrl, plan }: { sessionBaseUrl?: string; plan: HostSpeedPlan }): SpeedTestBackend {
      return createDeviceSpeedTest({
        transport,
        sessionBaseUrl,
        fallbackHost: sessionBaseUrl ? undefined : undefined,
        internetBytes: plan.simulated ? 10_000_000 : 25_000_000,
      });
    },

    // The device shell has no local socket to point measurements at.
    selfUrl: () => 'http://127.0.0.1',
  };
}
