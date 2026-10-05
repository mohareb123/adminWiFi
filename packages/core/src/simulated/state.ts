/**
 * Virtual router state used by the simulator.
 *
 * The simulator exists so the *entire* pipeline (discovery → fingerprint →
 * login → capabilities → operations → verification) can be exercised end to end
 * — in tests and in demo mode — without a physical device. It serves the same
 * HTML/JSON shapes real firmware serves, which is why the real fingerprint
 * engine recognises the simulated devices.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

export interface VirtualDevice {
  mac: string;
  ip: string;
  hostname: string;
  band: 'wifi-2.4' | 'wifi-5' | 'ethernet';
  signal: number;
  rateDownKbps: number;
  rateUpKbps: number;
  usageKb: number;
  blocked: boolean;
  limitDownKbps?: number;
  limitUpKbps?: number;
}

export interface VirtualWifiBand {
  band: '2.4GHz' | '5GHz';
  ssid: string;
  enabled: boolean;
  channel: number;
  security: string;
  password: string;
  guest: boolean;
  hidden: boolean;
}

export interface VirtualRouterState {
  vendor: string;
  model: string;
  firmware: string;
  hardware: string;
  serial: string;
  uptimeSeconds: number;
  wan: {
    ip: string;
    gateway: string;
    dns: string[];
    mtu: number;
    connected: boolean;
    status: string;
    mac: string;
  };
  lan: {
    ip: string;
    netmask: string;
    dhcpEnabled: boolean;
    poolStart: string;
    poolEnd: string;
    leaseHours: number;
  };
  bands: VirtualWifiBand[];
  devices: VirtualDevice[];
  neighbors: Array<{ ssid: string; bssid: string; channel: number; signalDbm: number; band: '2.4GHz' | '5GHz'; security: string }>;
  wpsEnabled: boolean;
  firewallLevel: 'low' | 'medium' | 'high';
  blockedMacs: string[];
  /** Monotonic WAN byte counters (KB) — routers publish totals, we derive rates. */
  traffic: { at: number; downKb: number; upKb: number };
  session: {
    authenticated: boolean;
    token: string;
    username: string;
    /** Login attempts since the last success (lockout simulation). */
    failedAttempts: number;
  };
  /** Behaviour knobs. */
  behaviour: {
    latencyMs: number;
    jitterMs: number;
    /** Wrong-password responses are slower, like real firmware. */
    authFailDelayMs: number;
    /** Paths the device silently ignores (simulating missing features). */
    unsupportedOperations: string[];
    /** When true, every write is accepted but never read back. */
    noReadBack?: boolean;
  };
  /** Request log — drives tests and the Advanced Mode request inspector. */
  requestLog: Array<{ at: number; method: string; path: string; status: number }>;
}

export interface VirtualRouterProfile {
  id: string;
  label: string;
  arLabel: string;
  credentials: { username: string; password: string };
  state: () => VirtualRouterState;
  /**
   * Line plan used by the demo speed test. The numbers stay realistic for the
   * ISP/technology the profile represents (fibre ONT, VDSL, ADSL2+).
   */
  speed?: { downloadMbps: number; uploadMbps: number; pingMs: number; jitterMs?: number; variance?: number };
}

export const DEMO_DEVICES: VirtualDevice[] = [
  { mac: '3c:5a:b4:11:22:33', ip: '192.168.1.10', hostname: 'Mohamed-PC', band: 'ethernet', signal: -30, rateDownKbps: 34_000, rateUpKbps: 4_200, usageKb: 2_400_000, blocked: false },
  { mac: 'f4:f5:d8:aa:bb:cc', ip: '192.168.1.11', hostname: 'Sara-iPhone', band: 'wifi-5', signal: -48, rateDownKbps: 6_500, rateUpKbps: 1_400, usageKb: 780_000, blocked: false },
  { mac: '28:6c:07:44:55:66', ip: '192.168.1.12', hostname: 'Xiaomi-TV', band: 'wifi-5', signal: -56, rateDownKbps: 18_900, rateUpKbps: 900, usageKb: 1_300_000, blocked: false },
  { mac: 'b8:27:eb:77:88:99', ip: '192.168.1.13', hostname: 'raspberrypi', band: 'wifi-2.4', signal: -67, rateDownKbps: 320, rateUpKbps: 180, usageKb: 42_000, blocked: false },
  { mac: '84:d8:1b:00:11:22', ip: '192.168.1.14', hostname: 'Mona-Phone', band: 'wifi-2.4', signal: -72, rateDownKbps: 1_100, rateUpKbps: 260, usageKb: 96_000, blocked: false },
  { mac: 'd8:af:3b:cc:dd:ee', ip: '192.168.1.15', hostname: '', band: 'wifi-2.4', signal: -80, rateDownKbps: 60, rateUpKbps: 20, usageKb: 3_400, blocked: false },
];

export const DEMO_NEIGHBORS: VirtualRouterState['neighbors'] = [
  { ssid: 'Orbit-2.4G', bssid: 'a4:2b:b0:11:22:33', channel: 6, signalDbm: -52, band: '2.4GHz', security: 'WPA2' },
  { ssid: 'TE-Data_2G', bssid: 'a4:2b:b0:44:55:66', channel: 6, signalDbm: -61, band: '2.4GHz', security: 'WPA2' },
  { ssid: 'Home_WiFi', bssid: 'a4:2b:b0:77:88:99', channel: 11, signalDbm: -68, band: '2.4GHz', security: 'WPA/WPA2' },
  { ssid: 'Neighbor-5G', bssid: 'a4:2b:b0:aa:bb:cc', channel: 36, signalDbm: -58, band: '5GHz', security: 'WPA2' },
  { ssid: 'Vodafone-5G', bssid: 'a4:2b:b0:dd:ee:ff', channel: 44, signalDbm: -71, band: '5GHz', security: 'WPA2' },
  { ssid: 'Cafe-Guest', bssid: 'a4:2b:b0:12:34:56', channel: 1, signalDbm: -76, band: '2.4GHz', security: 'Open' },
];

export function baseState(overrides: Partial<VirtualRouterState> = {}): VirtualRouterState {
  return {
    vendor: 'Generic',
    model: 'Virtual Router',
    firmware: '1.0.0',
    hardware: 'v1',
    serial: 'SIM0000000000',
    uptimeSeconds: 384_512,
    wan: {
      ip: '41.44.128.17',
      gateway: '41.44.128.1',
      dns: ['197.161.8.1', '8.8.8.8'],
      mtu: 1492,
      connected: true,
      status: 'connected',
      mac: '10:4d:77:aa:bb:cc',
    },
    lan: {
      ip: '192.168.1.1',
      netmask: '255.255.255.0',
      dhcpEnabled: true,
      poolStart: '192.168.1.100',
      poolEnd: '192.168.1.200',
      leaseHours: 24,
    },
    bands: [
      { band: '2.4GHz', ssid: 'Home Wi-Fi', enabled: true, channel: 6, security: 'WPA2-PSK', password: '12345678', guest: false, hidden: false },
      { band: '5GHz', ssid: 'Home Wi-Fi 5G', enabled: true, channel: 36, security: 'WPA2-PSK', password: '12345678', guest: false, hidden: false },
    ],
    devices: DEMO_DEVICES.map((device) => ({ ...device })),
    neighbors: DEMO_NEIGHBORS.map((neighbor) => ({ ...neighbor })),
    wpsEnabled: true,
    firewallLevel: 'medium',
    blockedMacs: [],
    traffic: { at: Date.now(), downKb: 12_480_000, upKb: 1_940_000 },
    session: { authenticated: false, token: '', username: '', failedAttempts: 0 },
    behaviour: {
      latencyMs: 120,
      jitterMs: 40,
      authFailDelayMs: 900,
      unsupportedOperations: [],
    },
    requestLog: [],
    ...overrides,
  };
}

/** Move a little traffic on every request so the UI has live data to show. */
export function tickTraffic(state: VirtualRouterState): void {
  const elapsedSeconds = Math.max(0.001, (Date.now() - state.traffic.at) / 1000);
  state.traffic.at = Date.now();
  let aggregateDownKbps = 0;
  let aggregateUpKbps = 0;

  for (const device of state.devices) {
    if (device.blocked) {
      device.rateDownKbps = 0;
      device.rateUpKbps = 0;
      continue;
    }
    const drift = 0.75 + Math.random() * 0.5;
    const ceiling = device.limitDownKbps ?? Number.POSITIVE_INFINITY;
    device.rateDownKbps = Math.round(Math.min(ceiling, Math.max(8, device.rateDownKbps * drift)));
    const upCeiling = device.limitUpKbps ?? Number.POSITIVE_INFINITY;
    device.rateUpKbps = Math.round(Math.min(upCeiling, Math.max(4, device.rateUpKbps * (0.7 + Math.random() * 0.6))));
    device.usageKb += device.rateDownKbps / 8;
    aggregateDownKbps += device.blocked ? 0 : device.rateDownKbps;
    aggregateUpKbps += device.blocked ? 0 : device.rateUpKbps;
  }

  state.traffic.downKb += (aggregateDownKbps / 8) * elapsedSeconds;
  state.traffic.upKb += (aggregateUpKbps / 8) * elapsedSeconds;
  state.uptimeSeconds += 1;
}

export function findDevice(state: VirtualRouterState, mac: string): VirtualDevice | undefined {
  const needle = mac.toLowerCase().replace(/-/g, ':');
  return state.devices.find((device) => device.mac.toLowerCase().replace(/-/g, ':') === needle);
}
