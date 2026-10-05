/**
 * Simulated router profiles — one per vendor family.
 *
 * Each profile drives the shared simulator with realistic identification
 * signals (title, server header, cookies, assets, OUI) that the production
 * signature database recognises. This is how the compatibility pipeline is
 * verified without hardware.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { baseState, type VirtualRouterProfile } from './state';

export const SIMULATED_PROFILES: Record<string, VirtualRouterProfile> = {
  'huawei-hg8145': {
    speed: { downloadMbps: 94.6, uploadMbps: 28.4, pingMs: 17, jitterMs: 2.6 },
    id: 'huawei-hg8145',
    label: 'Huawei HG8145V5 (WE / Orange ONT)',
    arLabel: 'هواوي HG8145V5',
    credentials: { username: 'admin', password: 'Admin@123' },
    state: () => baseState({
      vendor: 'Huawei',
      model: 'HG8145V5',
      firmware: 'V5R020C10S120',
      hardware: 'V5',
      serial: '48575443A1B2C3D4',
      wan: {
        ip: '41.44.128.17',
        gateway: '41.44.128.1',
        dns: ['197.161.8.1', '197.161.8.2'],
        mtu: 1492,
        connected: true,
        status: 'connected',
        mac: '10:4d:77:aa:bb:cc',
      },
      behaviour: { latencyMs: 150, jitterMs: 60, authFailDelayMs: 1100, unsupportedOperations: [] },
    }),
  },

  'tplink-archer-c6': {
    speed: { downloadMbps: 48.9, uploadMbps: 9.4, pingMs: 24, jitterMs: 4.8 },
    id: 'tplink-archer-c6',
    label: 'TP-Link Archer C6 v3',
    arLabel: 'تي بي لينك Archer C6',
    credentials: { username: 'admin', password: 'admin1234' },
    state: () => baseState({
      vendor: 'TP-Link',
      model: 'Archer C6 v3',
      firmware: '3.16.0 Build 200718',
      hardware: 'v3.20',
      serial: 'TPL-C6-2201',
      lan: {
        ip: '192.168.0.1',
        netmask: '255.255.255.0',
        dhcpEnabled: true,
        poolStart: '192.168.0.100',
        poolEnd: '192.168.0.199',
        leaseHours: 12,
      },
      bands: [
        { band: '2.4GHz', ssid: 'TP-Link_2G', enabled: true, channel: 11, security: 'WPA2-PSK', password: 'admin1234', guest: false, hidden: false },
        { band: '5GHz', ssid: 'TP-Link_5G', enabled: true, channel: 149, security: 'WPA2-PSK', password: 'admin1234', guest: false, hidden: false },
      ],
      wpsEnabled: false,
      behaviour: { latencyMs: 110, jitterMs: 50, authFailDelayMs: 800, unsupportedOperations: [] },
    }),
  },

  'zte-zxhn-h288a': {
    speed: { downloadMbps: 87.2, uploadMbps: 21.7, pingMs: 21, jitterMs: 3.9 },
    id: 'zte-zxhn-h288a',
    label: 'ZTE ZXHN H288A (ISP ONT)',
    arLabel: 'زد تي إي ZXHN H288A',
    credentials: { username: 'admin', password: 'Zte@2024' },
    state: () => baseState({
      vendor: 'ZTE',
      model: 'ZXHN H288A',
      firmware: 'V2.0.0P3_EN',
      hardware: 'V2',
      serial: 'ZTEG-A1B2C3',
      lan: {
        ip: '192.168.1.1',
        netmask: '255.255.255.0',
        dhcpEnabled: true,
        poolStart: '192.168.1.2',
        poolEnd: '192.168.1.254',
        leaseHours: 24,
      },
      bands: [
        { band: '2.4GHz', ssid: 'ZTE-Home', enabled: true, channel: 1, security: 'WPA/WPA2-PSK', password: 'zte12345', guest: false, hidden: false },
        { band: '5GHz', ssid: 'ZTE-Home-5G', enabled: true, channel: 44, security: 'WPA2-PSK', password: 'zte12345', guest: false, hidden: false },
      ],
      // ISP firmware variant: WLAN pages are read-only.
      behaviour: { latencyMs: 190, jitterMs: 80, authFailDelayMs: 1200, unsupportedOperations: ['wifi.set_ssid'] },
    }),
  },

  'dlink-dir825': {
    speed: { downloadMbps: 15.3, uploadMbps: 1.1, pingMs: 41, jitterMs: 8.5 },
    id: 'dlink-dir825',
    label: 'D-Link DIR-825',
    arLabel: 'دي لينك DIR-825',
    credentials: { username: 'admin', password: '12345678' },
    state: () => baseState({
      vendor: 'D-Link',
      model: 'DIR-825',
      firmware: '3.10.0',
      hardware: 'C1',
      serial: 'DLNK-825-C1',
      bands: [
        { band: '2.4GHz', ssid: 'dlink-HOME', enabled: true, channel: 6, security: 'WPA2-PSK', password: '12345678', guest: false, hidden: false },
        { band: '5GHz', ssid: '', enabled: false, channel: 0, security: '', password: '', guest: false, hidden: false },
      ],
      behaviour: { latencyMs: 240, jitterMs: 90, authFailDelayMs: 1400, unsupportedOperations: [] },
    }),
  },

  'openwrt-generic': {
    speed: { downloadMbps: 62.5, uploadMbps: 18.2, pingMs: 53, jitterMs: 14.3 },
    id: 'openwrt-generic',
    label: 'Unknown OpenWrt device (limited confidence demo)',
    arLabel: 'جهاز OpenWrt غير معروف',
    credentials: { username: 'root', password: 'openwrt' },
    state: () => baseState({
      vendor: 'OpenWrt',
      model: 'Generic x86',
      firmware: '23.05.3',
      hardware: 'generic',
      serial: 'OWRT-SIM-01',
      bands: [
        { band: '2.4GHz', ssid: 'OpenWrt-Guest', enabled: true, channel: 3, security: 'open', password: '', guest: false, hidden: false },
      ],
      wpsEnabled: false,
      firewallLevel: 'low',
      behaviour: { latencyMs: 90, jitterMs: 30, authFailDelayMs: 700, unsupportedOperations: ['device.block'] },
    }),
  },
};

export const DEMO_PROFILE_IDS = Object.keys(SIMULATED_PROFILES);

export function getProfile(id: string): VirtualRouterProfile {
  const profile = SIMULATED_PROFILES[id];
  if (!profile) throw new Error(`unknown simulated profile: ${id}`);
  return profile;
}

/** A fresh copy of a profile so tests never share state. */
export function createProfile(id: string): VirtualRouterProfile {
  const source = getProfile(id);
  const snapshot = source.state();
  return { ...source, state: () => snapshot };
}

/** Resolve the current state object of a profile. */
export function profileState(profile: VirtualRouterProfile): ReturnType<VirtualRouterProfile['state']> {
  return profile.state();
}
