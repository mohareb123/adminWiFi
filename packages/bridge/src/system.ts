/**
 * Host-side network facts — available only to the Local Bridge.
 *
 * Everything here is *passive*: it reads the OS routing/ARP tables, opens a TCP
 * connection to the gateway to measure latency, and listens for SSDP
 * advertisements. No packet flooding, no scanning of foreign networks, no
 * credential guessing (spec §2/§22).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { execFile } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import dgram from 'node:dgram';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createLogger, parseDeviceDescription } from '@urlm/core';
import type { DetectedService, UpnpInfo } from '@urlm/core';

const execFileAsync = promisify(execFile);
const log = createLogger('bridge.system');

export interface GatewayInfo {
  gateways: string[];
  /** Gateway MAC (from the ARP table), used for OUI evidence. */
  mac?: string;
  interfaceName?: string;
  localAddresses: string[];
}

/** Default gateway + gateway MAC, best effort across platforms. */
export async function detectGateway(): Promise<GatewayInfo> {
  const localAddresses = collectLocalAddresses();
  const gateways: string[] = [];
  let interfaceName: string | undefined;

  // Linux: /proc/net/route is exact and instant.
  try {
    const route = await readFile('/proc/net/route', 'utf8');
    for (const line of route.split('\n').slice(1)) {
      const [iface, destination, gateway, _flags, _ref, _use, metric] = line.split(/\s+/);
      if (!iface || destination !== '00000000' || !gateway || gateway === '00000000') continue;
      const ip = hexToIp(gateway);
      if (!ip) continue;
      if (!gateways.includes(ip)) gateways.push(ip);
      interfaceName ??= iface;
      if (Number(metric) === 0) gateways.unshift(ip);
    }
  } catch {
    /* not Linux, or unreadable */
  }

  if (gateways.length === 0) {
    for (const command of gatewayCommands()) {
      try {
        const { stdout } = await execFileAsync(command.cmd, command.args, { timeout: 4000 });
        for (const ip of command.parse(stdout)) if (!gateways.includes(ip)) gateways.push(ip);
        if (gateways.length > 0) break;
      } catch {
        /* try the next strategy */
      }
    }
  }

  const mac = gateways.length > 0 ? await lookupMac(gateways[0] as string) : undefined;
  return { gateways: [...new Set(gateways)], mac, interfaceName, localAddresses };
}

function gatewayCommands(): Array<{ cmd: string; args: string[]; parse: (stdout: string) => string[] }> {
  const ipv4 = /(\d{1,3}(?:\.\d{1,3}){3})/;
  return [
    {
      cmd: 'netstat',
      args: ['-rn'],
      parse: (stdout) =>
        stdout
          .split('\n')
          .filter((line) => /^default|^0\.0\.0\.0/.test(line.trim()))
          .map((line) => ipv4.exec(line)?.[1] ?? '')
          .filter(Boolean),
    },
    {
      cmd: 'route',
      args: ['-n', 'get', 'default'],
      parse: (stdout) => {
        const match = /gateway:\s*(\S+)/.exec(stdout);
        return match ? [match[1] as string] : [];
      },
    },
    {
      cmd: 'ip',
      args: ['route', 'show', 'default'],
      parse: (stdout) => {
        const match = /default via (\S+)/.exec(stdout);
        return match ? [match[1] as string] : [];
      },
    },
  ];
}

function collectLocalAddresses(): string[] {
  const out: string[] = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) out.push(address.address);
    }
  }
  return out;
}

function hexToIp(hex: string): string | undefined {
  if (hex.length !== 8) return undefined;
  const bytes = [3, 2, 1, 0].map((offset) => Number.parseInt(hex.slice(offset * 2, offset * 2 + 2), 16));
  if (bytes.some((value) => Number.isNaN(value))) return undefined;
  return bytes.join('.');
}

/** Read the ARP table to map an IP to its MAC (no active probing involved). */
export { parseDeviceDescription };

export async function lookupMac(ip: string): Promise<string | undefined> {
  try {
    const arp = await readFile('/proc/net/arp', 'utf8');
    for (const line of arp.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === ip && parts[3] && parts[3] !== '00:00:00:00:00:00') return parts[3].toLowerCase();
    }
  } catch {
    /* fall through to the platform command */
  }
  try {
    const { stdout } = await execFileAsync('arp', ['-n', ip], { timeout: 3000 });
    const match = /([0-9a-f]{1,2}(?::[0-9a-f]{1,2}){5})/i.exec(stdout);
    if (match) return match[1]?.toLowerCase();
  } catch {
    /* unavailable */
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Latency probe
 * ------------------------------------------------------------------ */

export interface LatencyProbeResult {
  latencyMs: number;
  reachable: boolean;
  packetLossPct?: number;
}

/**
 * TCP-connect latency to the router. Chosen over ICMP because it needs no
 * privileges and measures exactly what the UI experiences.
 */
export function createTcpLatencyProbe(host: string, port = 80, timeoutMs = 2000) {
  return (signal?: AbortSignal): Promise<LatencyProbeResult> =>
    new Promise((resolve) => {
      const started = process.hrtime.bigint();
      const socket = new net.Socket();
      let settled = false;
      const finish = (result: LatencyProbeResult) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };
      const timer = setTimeout(() => finish({ latencyMs: timeoutMs, reachable: false, packetLossPct: 100 }), timeoutMs);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        finish({ latencyMs: 0, reachable: false, packetLossPct: 100 });
      });
      socket.once('connect', () => {
        clearTimeout(timer);
        const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
        finish({ latencyMs: Math.round(elapsed * 100) / 100, reachable: true });
      });
      socket.once('error', () => {
        clearTimeout(timer);
        finish({ latencyMs: timeoutMs, reachable: false, packetLossPct: 100 });
      });
      socket.connect({ host, port });
    });
}

/* ------------------------------------------------------------------ *
 * Service detection (non-invasive)
 * ------------------------------------------------------------------ */

const SERVICE_PORTS: Array<{ port: number; protocol: DetectedService['protocol'] }> = [
  { port: 80, protocol: 'http' },
  { port: 443, protocol: 'https' },
  { port: 7547, protocol: 'tr069' },
  { port: 161, protocol: 'snmp' },
  { port: 22, protocol: 'ssh' },
  { port: 1900, protocol: 'upnp' },
];

/** A TCP connect attempt is a "is this advertised?" check, not a login attempt. */
export async function detectServices(host: string, signal?: AbortSignal): Promise<DetectedService[]> {
  const results = await Promise.all(
    SERVICE_PORTS.map(async ({ port, protocol }) => {
      const open = await tcpConnect(host, port, 700, signal);
      return { port, protocol, open, detail: open ? 'port answered a TCP handshake' : undefined } as DetectedService;
    }),
  );
  return results;
}

function tcpConnect(host: string, port: number, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      done(false);
    });
    socket.once('connect', () => {
      clearTimeout(timer);
      done(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      done(false);
    });
    socket.connect({ host, port });
  });
}

/* ------------------------------------------------------------------ *
 * UPnP / SSDP (passive listen — one M-SEARCH datagram, standard discovery)
 * ------------------------------------------------------------------ */

export async function discoverUpnp(gatewayIp?: string, timeoutMs = 1200): Promise<UpnpInfo | undefined> {
  const locations = await ssdpSearch(timeoutMs, gatewayIp);
  for (const location of locations) {
    try {
      const response = await fetch(location, { signal: AbortSignal.timeout(2500) });
      const xml = await response.text();
      return parseDeviceDescription(xml);
    } catch {
      /* try the next advertised location */
    }
  }
  return undefined;
}

function ssdpSearch(timeoutMs: number, gatewayIp?: string): Promise<string[]> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const locations: string[] = [];
    const message = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
        'HOST: 239.255.255.250:1900\r\n' +
        'MAN: "ssdp:discover"\r\n' +
        'MX: 1\r\n' +
        'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n',
    );
    const finish = () => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve(locations);
    };
    socket.on('message', (data, rinfo) => {
      // Prefer the device we are actually talking to.
      if (gatewayIp && rinfo.address !== gatewayIp) return;
      const text = data.toString('utf8');
      const location = /LOCATION:\s*(\S+)/i.exec(text)?.[1];
      if (location && !locations.includes(location)) locations.push(location);
    });
    socket.on('error', () => finish());
    try {
      socket.send(message, 1900, '239.255.255.250', () => undefined);
      setTimeout(finish, timeoutMs);
    } catch {
      finish();
    }
  });
}

