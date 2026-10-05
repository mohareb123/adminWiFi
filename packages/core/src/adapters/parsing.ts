/**
 * Universal parsing helpers.
 *
 * These are the workhorses behind "adapt to as many routers as possible":
 * instead of hard-coding one vendor's response shape, they *hunt* for the
 * information in whatever the device returned — JSON of any nesting depth,
 * flat TR-069 path/value dumps, HTML tables, or embedded JS objects.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import type { DeviceConnection, DeviceRecord, LanState, WanState, WifiBandInfo, WifiNeighbor, WifiState } from '../core/types';
import { clamp, normalizeMac, stripTags, toNumber, uniq } from '../core/util';
import { lookupOui, guessDeviceKind } from '../signatures/oui';

const MAC_RE = /\b([0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

/* ------------------------------------------------------------------ *
 * Generic traversal
 * ------------------------------------------------------------------ */

/** Depth-first walk over any JSON-ish value. */
export function walkJson(root: unknown, visit: (node: unknown, path: string) => void, path = '', depth = 0): void {
  if (depth > 8 || root === null || root === undefined) return;
  visit(root, path);
  if (Array.isArray(root)) {
    root.forEach((item, index) => walkJson(item, visit, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof root === 'object') {
    for (const [key, value] of Object.entries(root as Record<string, unknown>)) {
      walkJson(value, visit, path ? `${path}.${key}` : key, depth + 1);
    }
  }
}

/** Collect every object that satisfies a predicate (bounded). */
export function collectObjects(root: unknown, predicate: (object: Record<string, unknown>) => boolean, limit = 400): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  walkJson(root, (node) => {
    if (out.length >= limit) return;
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      const object = node as Record<string, unknown>;
      if (predicate(object)) out.push(object);
    }
  });
  return out;
}

function pickString(object: Record<string, unknown>, keys: RegExp): string | undefined {
  for (const [key, value] of Object.entries(object)) {
    if (!keys.test(key)) continue;
    if (typeof value === 'string' && value.trim() && value !== 'null') return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function pickNumber(object: Record<string, unknown>, keys: RegExp): number | undefined {
  for (const [key, value] of Object.entries(object)) {
    if (!keys.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value.replace(/[^\d.+-]/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Text / TR-069 helpers
 * ------------------------------------------------------------------ */

/** Parse `key=value` or `key: value` line dumps (very common on ONTs). */
export function parseKeyValueDump(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/[\r\n]+/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const match = /^([^=:]{2,200})\s*[=:]\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = (match[1] as string).trim();
    const value = (match[2] as string).replace(/^["']|["']$/g, '').trim();
    if (value) out[key] = value;
  }
  return out;
}

/**
 * Flatten a TR-069 style flat structure
 * (`InternetGatewayDevice.LANDevice.1.Hosts.Host.1.IPAddress=192.168.1.5`)
 * into device records. Handles Huawei / ZTE / Sagemcom ONTs generically.
 */
const DEVICE_SEGMENT = /^(hosts?|clients?|stations?|entries?|leases?|devices?|host|users?|nodes?)$/i;

/**
 * Find the instance index inside a TR-069 path such as
 * `InternetGatewayDevice.LANDevice.1.Hosts.Host.3.IPAddress` → "3".
 *
 * The *last* digit segment preceded by a device keyword wins, so `LANDevice.1`
 * can never be mistaken for a host index (a real bug class on ONTs where every
 * row collapses into one device).
 */
export function tr069InstanceIndex(key: string): string | undefined {
  const segments = key.split('.');
  for (let i = segments.length - 2; i > 0; i -= 1) {
    const segment = segments[i] as string;
    if (/^\d+$/.test(segment) && DEVICE_SEGMENT.test(segments[i - 1] as string)) return segment;
  }
  return undefined;
}

export function extractDevicesFromTr069(text: string): DeviceRecord[] {
  const map = parseKeyValueDump(text);
  const groups = new Map<string, Record<string, string>>();
  for (const [key, value] of Object.entries(map)) {
    const index = tr069InstanceIndex(key);
    if (!index) continue;
    const field = key.slice(key.lastIndexOf('.') + 1);
    const bucket = groups.get(index) ?? {};
    bucket[field] = value;
    groups.set(index, bucket);
  }
  const devices: DeviceRecord[] = [];
  for (const [, fields] of groups) {
    const mac = findValue(fields, /mac/i);
    if (!mac || !MAC_RE.test(mac)) continue;
    devices.push(deviceFromFields(fields, mac));
  }
  return devices;
}

/**
 * Interpret the block state of a device from a flat field dump.
 * A block/deny/filter field set to a truthy value means blocked; an
 * enable/active/status field means the *opposite* (a disabled host is blocked).
 */
export function isBlockedByFields(fields: Record<string, string>): boolean {
  const blockField = findValue(fields, /(block|deny|blacklist|filter_?enable)/i);
  if (blockField !== undefined) return /^(true|1|yes|on|blocked|enabled)$/i.test(blockField.trim());
  const enableField = findValue(fields, /^(enable|enabled|x_hw_enable|active|online)$/i);
  if (enableField !== undefined) return /^(false|0|no|off|disabled|offline|blocked)$/i.test(enableField.trim());
  const statusField = findValue(fields, /^status$/i);
  if (statusField !== undefined) return /(blocked|denied|offline|disabled)/i.test(statusField);
  return false;
}

function findValue(fields: Record<string, string>, keyPattern: RegExp): string | undefined {
  return findEntry(fields, keyPattern)?.[1];
}

function findEntry(fields: Record<string, string>, keyPattern: RegExp): [string, string] | undefined {
  for (const [key, value] of Object.entries(fields)) {
    if (keyPattern.test(key) && value) return [key, value];
  }
  return undefined;
}

/** Traffic fields come as bytes (X_HW_Traffic) or KB depending on the vendor. */
function usageToKb(entry: [string, string] | undefined): number | undefined {
  if (!entry) return undefined;
  const [key, raw] = entry;
  const value = Number(String(raw).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(value)) return undefined;
  if (/kb|kilo/i.test(key)) return Math.round(value);
  return value > 100_000 ? Math.round(value / 1024) : Math.round(value);
}

function deviceFromFields(fields: Record<string, string>, mac: string): DeviceRecord {
  const ip = findValue(fields, /(ipaddr|ip_address|ip$|^ip)/i) ?? '';
  const hostname = findValue(fields, /(hostname|host_name|name|devicename)/i);
  const signal = toNumber(findValue(fields, /(signal|rssi|strength)/i), Number.NaN);
  const band = findValue(fields, /(band|freq|wirelessmode)/i);
  const interfaceType = findValue(fields, /(layername|interface|iftype|port|connectiontype|access)/i) ?? '';
  const normalizedMac = normalizeMac(mac);
  const vendor = lookupOui(normalizedMac);
  return {
    id: `mac:${normalizedMac}`,
    name: hostname || vendor || normalizedMac,
    hostname,
    ip,
    mac: normalizedMac,
    connection: inferConnection(interfaceType, band),
    signal: Number.isFinite(signal) ? signal : undefined,
    vendor,
    kind: guessDeviceKind(vendor, hostname),
    blocked: isBlockedByFields(fields),
    rateDownKbps: toNumber(findValue(fields, /(?:rx|down|recv|download)[^.]*rate|rate[^.]*(?:rx|down)/i)),
    rateUpKbps: toNumber(findValue(fields, /(?:tx|up|send|upload)[^.]*rate|rate[^.]*(?:tx|up)/i)),
    usageKb: usageToKb(findEntry(fields, /(traffic|usage|octet|stat)/i)),
    raw: fields,
    isUnknown: !hostname,
  };
}

export function inferConnection(interfaceType: string, band?: string): DeviceConnection {
  const text = `${interfaceType} ${band ?? ''}`.toLowerCase();
  // Band keywords win: they are the most specific signal vendors publish.
  if (/5g|5ghz|5\.8|11a\b|ac\b|ax\b/.test(text)) return 'wifi-5';
  if (/2\.4|2g\b|11b|11g|11n/.test(text)) return 'wifi-2.4';
  // Generic "802.11"/"wifi" without band information: say Wi-Fi, do not guess a band.
  if (/wifi|wireless|wlan|ssid|802\.11/.test(text)) return 'wifi';
  if (/eth|lan\b|wired|ethernet|wiredclient/.test(text)) return 'ethernet';
  return 'unknown';
}

/* ------------------------------------------------------------------ *
 * JSON device extraction (works for unknown/unmapped APIs)
 * ------------------------------------------------------------------ */

export function extractDevicesFromJson(json: unknown): DeviceRecord[] {
  const objects = collectObjects(json, (object) =>
    Object.entries(object).some(
      ([key, value]) => /mac|hwaddr|physaddress/i.test(key) && typeof value === 'string' && MAC_RE.test(value),
    ),
  );
  const devices = new Map<string, DeviceRecord>();
  for (const object of objects) {
    const mac = pickString(object, /mac|hwaddr|physaddress/i);
    if (!mac || !MAC_RE.test(mac)) continue;
    const normalizedMac = normalizeMac(mac);
    const ip = pickString(object, /^(ip|ipaddr|ipaddress|ip_address|address)$/i) ?? '';
    const hostname = pickString(object, /(hostname|host_name|^name$|devicename|device_name|nickname)/i);
    const vendor = pickString(object, /(vendor|manufacturer|oui|company)/i) ?? lookupOui(normalizedMac);
    const signalRaw = pickNumber(object, /(signal|rssi|strength)/i);
    const connection = inferConnection(
      pickString(object, /(ifname|interface|port|connection|type|access|media)/i) ?? '',
      pickString(object, /(band|freq)/i),
    );
    const isActive = pickString(object, /^(active|online|enable|connected|status)$/i);
    const record: DeviceRecord = {
      id: `mac:${normalizedMac}`,
      name: hostname || guessDeviceKind(vendor, hostname) || vendor || normalizedMac,
      kind: guessDeviceKind(vendor, hostname),
      hostname,
      ip,
      mac: normalizedMac,
      connection,
      signal: signalRaw,
      vendor,
      blocked: /^(false|0|no|blocked)$/i.test(pickString(object, /(block|blocked|deny|disabled|filter)/i) ?? '') ? true : false,
      rateDownKbps: pickNumber(object, /(down|rx|recv).*(rate|speed|bandwidth)|(rate|speed).*down/i),
      rateUpKbps: pickNumber(object, /(up|tx|sent).*(rate|speed|bandwidth)|(rate|speed).*up/i),
      usageKb: pickNumber(object, /(usage|total|traffic|bytes)/i),
      isUnknown: !hostname,
      raw: object,
      lastSeen: isActive && /^(false|0|no)$/i.test(isActive) ? undefined : new Date().toISOString(),
    };
    const existing = devices.get(record.id);
    if (!existing) devices.set(record.id, record);
    else devices.set(record.id, mergeDevice(existing, record));
  }
  return [...devices.values()];
}

function mergeDevice(a: DeviceRecord, b: DeviceRecord): DeviceRecord {
  return {
    ...a,
    ...Object.fromEntries(Object.entries(b).filter(([, value]) => value !== undefined && value !== '' && value !== null)),
    raw: { ...(a.raw ?? {}), ...(b.raw ?? {}) },
  } as DeviceRecord;
}

/* ------------------------------------------------------------------ *
 * HTML device extraction (legacy tables)
 * ------------------------------------------------------------------ */

export function extractDevicesFromHtml(html: string): DeviceRecord[] {
  const devices = new Map<string, DeviceRecord>();
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const mac = MAC_RE.exec(stripTags(row));
    if (!mac) continue;
    const normalizedMac = normalizeMac(mac[0]);
    const cells = (row.match(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi) ?? []).map((cell) => stripTags(cell));
    const ipCell = cells.find((cell) => IPV4_RE.test(cell) && !MAC_RE.test(cell));
    const nameCell = cells.find(
      (cell) => cell.length > 1 && !IPV4_RE.test(cell) && !MAC_RE.test(cell) && !/^-+$/.test(cell),
    );
    const vendor = lookupOui(normalizedMac);
    devices.set(normalizedMac, {
      id: `mac:${normalizedMac}`,
      name: nameCell?.slice(0, 40) || vendor || normalizedMac,
      ip: ipCell?.match(IPV4_RE)?.[0] ?? '',
      mac: normalizedMac,
      connection: inferConnection(cells.join(' ')),
      vendor,
      blocked: /blocked|disabled|deny|ممنوع|محجوب/i.test(cells.join(' ')),
      isUnknown: !nameCell,
      raw: { cells },
    });
  }
  return [...devices.values()];
}

/* ------------------------------------------------------------------ *
 * Wi-Fi
 * ------------------------------------------------------------------ */

export function extractWifiFromJson(json: unknown): WifiState {
  const bands: WifiBandInfo[] = [];
  const objects = collectObjects(json, (object) =>
    Object.entries(object).some(
      ([key, value]) =>
        /ssid|essid|wifi_ssid|wl_ssid/i.test(key) && typeof value === 'string' && value.trim().length > 0,
    ),
  );
  for (const object of objects) {
    const ssid = pickString(object, /ssid|essid/i);
    if (!ssid) continue;
    const bandHint = `${pickString(object, /(band|freq|radio|index|ifname)/i) ?? ''}`;
    const is5 = /5g|5ghz|5\.8|11a|radio2|wlan2|wl1/i.test(bandHint) || object['band'] === '5GHz';
    const band: WifiBandInfo = {
      band: is5 ? '5GHz' : '2.4GHz',
      ssid,
      enabled: !/^(false|0|no|disabled)$/i.test(pickString(object, /^(enable|enabled|active|on|status)$/i) ?? 'true'),
      channel: pickNumber(object, /channel/i),
      width: pickString(object, /(width|bandwidth|ht_bw|channelwidth)/i),
      security: pickString(object, /(security|encrypt|auth|mode|securitymode)/i),
      hidden: /^(true|1|yes)$/i.test(pickString(object, /(hidden|hiden|broadcast)/i) ?? '') ? true : undefined,
      guest: /guest/i.test(pickString(object, /(ssid|name)/i) ?? '') ? true : undefined,
      clients: pickNumber(object, /(clients|assoc|stations|count)/i),
    };
    const existing = bands.findIndex((entry) => entry.band === band.band);
    if (existing >= 0) bands[existing] = band;
    else bands.push(band);
  }
  return {
    bands: bands.sort((a, b) => (a.band === '2.4GHz' ? -1 : 1) - (b.band === '2.4GHz' ? -1 : 1)),
  };
}

export function extractWifiFromHtml(html: string): WifiState {
  const inputs = new Map<string, string>();
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    const name = /name\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const value = /value\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (name) inputs.set(name, value ?? '');
  }
  // <select name="...Channel"> with a selected option is how most legacy UIs
  // expose the channel.
  for (const match of html.matchAll(/<select\b[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi)) {
    const name = match[1] as string;
    const options = match[2] as string;
    const selected =
      /<option[^>]*selected[^>]*value\s*=\s*["']([^"']+)["']/i.exec(options)?.[1] ??
      /<option[^>]*value\s*=\s*["']([^"']+)["'][^>]*selected/i.exec(options)?.[1];
    if (name && selected !== undefined) inputs.set(name, selected);
  }

  const bands: WifiBandInfo[] = [];
  for (const [name, value] of inputs) {
    if (!/ssid/i.test(name) || !value) continue;
    const band = bandFromFieldName(name);
    if (bands.some((entry) => entry.band === band)) continue;
    const channel = channelForBand(inputs, name);
    const security = securityForBand(inputs, name);
    bands.push({
      band,
      ssid: value,
      enabled: true,
      channel: channel !== undefined ? Number(channel) || undefined : undefined,
      security,
    });
  }
  bands.sort((a, b) => (a.band === '2.4GHz' ? -1 : 1) - (b.band === '2.4GHz' ? -1 : 1));
  return { bands };
}

/** Derive the band from the field name (ssid2, WLANConfiguration.2.SSID, …). */
export function bandFromFieldName(name: string): '2.4GHz' | '5GHz' {
  if (/5g|5ghz|11a|radio2|wlan2|wl1/i.test(name)) return '5GHz';
  const indexMatch = /(?:wlanconfiguration|wlan|wl|ssid|radio|band)[._-]?(\d)/i.exec(name);
  if (indexMatch) return Number(indexMatch[1]) >= 2 ? '5GHz' : '2.4GHz';
  return '2.4GHz';
}

function channelForBand(inputs: Map<string, string>, ssidField: string): string | undefined {
  const index = /(?:wlanconfiguration|wlan|wl|ssid|radio|band)[._-]?(\d)/i.exec(ssidField)?.[1];
  for (const [name, value] of inputs) {
    if (!/channel/i.test(name) || !value) continue;
    if (!index) return value;
    const sameIndex = new RegExp(`[._-]${index}\\b`).test(name);
    if (sameIndex || name.includes(index)) return value;
  }
  return undefined;
}

function securityForBand(inputs: Map<string, string>, ssidField: string): string | undefined {
  const index = /(?:wlanconfiguration|wlan|wl|ssid|radio|band)[._-]?(\d)/i.exec(ssidField)?.[1];
  for (const [name, value] of inputs) {
    if (!/(security|encrypt|authmode|wpa|authentication)/i.test(name) || !value) continue;
    if (index && !name.includes(index)) continue;
    return normaliseSecurity(value);
  }
  return undefined;
}

/** Map vendor security codes onto readable, comparable values. */
export function normaliseSecurity(value: string): string {
  const text = value.trim();
  if (/^(0|none|open|disabled|no\s*security)$/i.test(text)) return 'open';
  if (/wep/i.test(text) || text === '1') return 'WEP';
  if (/wpa3|sae/i.test(text)) return 'WPA3';
  if (/wpa2|psk2|rsn/i.test(text) || text === '3' || text === '4') return 'WPA2-PSK';
  if (/wpa/i.test(text) || text === '2') return 'WPA-PSK';
  return text;
}

/** Wi-Fi survey / neighbor scan. */
export function extractNeighborsFromJson(json: unknown): WifiNeighbor[] {
  const objects = collectObjects(json, (object) =>
    Object.entries(object).some(([key, value]) => /ssid|essid/i.test(key) && typeof value === 'string' && value.trim().length > 0),
  );
  const neighbors: WifiNeighbor[] = [];
  for (const object of objects) {
    const ssid = pickString(object, /ssid|essid/i);
    if (!ssid) continue;
    const rssi = pickNumber(object, /(signal|rssi|strength|dbm)/i);
    if (rssi === undefined) continue;
    const channel = pickNumber(object, /channel/i) ?? 0;
    const dbm = rssi > 0 ? rssi - 100 : rssi; // some vendors report 0..100
    neighbors.push({
      ssid,
      bssid: pickString(object, /(bssid|mac)/i),
      band: /5g|5ghz|5\.8/i.test(`${pickString(object, /(band|freq)/i) ?? ''}`) || channel > 14 ? '5GHz' : '2.4GHz',
      channel: Math.round(channel),
      signalDbm: clamp(Math.round(dbm), -100, -20),
      security: pickString(object, /(security|auth|encrypt)/i),
    });
  }
  return dedupeNeighbors(neighbors);
}

export function dedupeNeighbors(neighbors: WifiNeighbor[]): WifiNeighbor[] {
  const map = new Map<string, WifiNeighbor>();
  for (const neighbor of neighbors) {
    const key = `${neighbor.bssid ?? neighbor.ssid}|${neighbor.channel}`;
    const existing = map.get(key);
    if (!existing || existing.signalDbm < neighbor.signalDbm) map.set(key, neighbor);
  }
  return [...map.values()].sort((a, b) => b.signalDbm - a.signalDbm).slice(0, 60);
}

/* ------------------------------------------------------------------ *
 * WAN / LAN
 * ------------------------------------------------------------------ */

export function extractWanFromJson(json: unknown): WanState {
  const texts: Record<string, string> = {};
  walkJson(json, (node) => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      const object = node as Record<string, unknown>;
      const ip = pickString(object, /^(ip|ipaddr|ipaddress|wanip|externalip)$/i);
      const gw = pickString(object, /(gateway|gw)/i);
      const dns = Object.entries(object)
        .filter(([key, value]) => /dns/i.test(key) && typeof value === 'string' && IPV4_RE.test(value))
        .map(([, value]) => value as string);
      if (ip) texts.ip ??= ip;
      if (gw) texts.gateway ??= gw;
      if (dns.length) texts.dns ??= dns.join(',');
      const uptime = pickString(object, /(uptime|conn.*time|leaseduration)/i);
      if (uptime) texts.uptime ??= uptime;
      const mtu = pickString(object, /mtu/i);
      if (mtu) texts.mtu ??= mtu;
      const mac = pickString(object, /(wanmac|wan_mac|wan.*hwaddr)/i);
      if (mac && MAC_RE.test(mac)) texts.mac ??= mac;
      const status = pickString(object, /(wan.*status|linkstatus|connectionstatus|state)/i);
      if (status) texts.status ??= status;
    }
  });
  return {
    ip: texts.ip,
    gateway: texts.gateway,
    dns: texts.dns ? uniq(texts.dns.split(',').filter((value) => IPV4_RE.test(value))) : [],
    mtu: texts.mtu ? toNumber(texts.mtu) : undefined,
    uptimeSeconds: texts.uptime ? parseUptimeToSeconds(texts.uptime) : undefined,
    status: texts.status,
    mac: texts.mac,
  };
}

export function extractWanFromHtml(html: string): WanState {
  const text = stripTags(html);
  const findLabel = (labels: string[]): string | undefined => {
    for (const label of labels) {
      const match = new RegExp(`${label}[^0-9]{0,20}((?:\\d{1,3}\\.){3}\\d{1,3})`, 'i').exec(text);
      if (match) return match[1] as string;
    }
    return undefined;
  };
  const dns1 = findLabel(['dns server', 'primary dns', 'dns server 1', 'dns1', 'dns']);
  const dns2 = findLabel(['secondary dns', 'dns server 2', 'dns2']);
  return {
    ip: findLabel(['ip address', 'wan ip', 'public ip', 'ipv4 address', 'ipv4']),
    gateway: findLabel(['default gateway', 'gateway']),
    dns: uniq([dns1, dns2].filter((value): value is string => Boolean(value))),
    status: /connected|up|online|متصل/i.test(text) ? 'connected' : undefined,
    uptimeSeconds: parseUptimeToSeconds(text),
  };
}

/**
 * LAN state from a key=value dump (Huawei ONTs and other TR-069 firmware serve
 * `SubnetMask=`, `DHCPEnable=`… as plain text, not JSON).
 */
export function extractLanFromFields(text: string, fallbackIp = ''): LanState {
  const fields = parseKeyValueDump(text);
  const value = (pattern: RegExp): string | undefined => {
    for (const [key, entry] of Object.entries(fields)) {
      if (pattern.test(key) && entry) return entry;
    }
    return undefined;
  };
  const ipCandidate = value(/(lan.?ip|lanipaddress|ipaddress|routerip)/i);
  const mask = value(/(netmask|subnetmask|subnet_mask)/i);
  const start = value(/(dhcp.?start|pool.?start|startip|beginip)/i);
  const end = value(/(dhcp.?end|pool.?end|endip)/i);
  const lease = value(/(lease|leasetime)/i);
  const enabled = value(/(dhcp.?enable|dHCPServerEnable|dhcp.?server)/i);
  return {
    ip: ipCandidate && IPV4_RE.test(ipCandidate) ? ipCandidate : fallbackIp,
    netmask: mask && IPV4_RE.test(mask) ? mask : '',
    dhcpEnabled: enabled !== undefined ? !/^(0|false|off|disabled|no)$/i.test(enabled.trim()) : false,
    poolStart: start && IPV4_RE.test(start) ? start : undefined,
    poolEnd: end && IPV4_RE.test(end) ? end : undefined,
    leaseHours: lease !== undefined ? toNumber(lease, Number.NaN) : undefined,
  };
}

export function extractLanFromJson(json: unknown, fallbackIp = ''): LanState {
  let ip = fallbackIp;
  let netmask = '';
  let poolStart: string | undefined;
  let poolEnd: string | undefined;
  let leaseHours: number | undefined;
  let dhcpEnabled = false;
  let clientCount: number | undefined;

  walkJson(json, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const object = node as Record<string, unknown>;
    const lanIp = pickString(object, /(lan.?ip|lanipaddress|lan_ip|routerip|ipaddress)/i);
    if (lanIp && IPV4_RE.test(lanIp)) ip = lanIp;
    const mask = pickString(object, /(netmask|subnetmask|subnet_mask)/i);
    if (mask && IPV4_RE.test(mask)) netmask = mask;
    const start = pickString(object, /(dhcp.?start|pool.?start|startip|ipstart|beginip)/i);
    if (start && IPV4_RE.test(start)) poolStart = start;
    const end = pickString(object, /(dhcp.?end|pool.?end|endip|ipend)/i);
    if (end && IPV4_RE.test(end)) poolEnd = end;
    const lease = pickNumber(object, /(lease|leasetime)/i);
    if (lease !== undefined) leaseHours = lease > 1000 ? Math.round(lease / 3600) : lease;
    const enabled = pickString(object, /(dhcp.?enable|dhcpserver|enable.?dhcp)/i);
    if (enabled && /^(true|1|yes|on|enabled)$/i.test(enabled)) dhcpEnabled = true;
    const count = pickNumber(object, /(client.?count|num.?of.?clients|hostcount)/i);
    if (count !== undefined) clientCount = count;
  });

  return { ip, netmask, dhcpEnabled, poolStart, poolEnd, leaseHours, clientCount };
}

/**
 * Extract WAN byte/traffic counters from any payload shape.
 *
 * Routers that expose no live rate still publish monotonic counters — the
 * adapter turns them into rates by differencing successive samples, which is a
 * genuine measurement rather than a guess. Keys decide the unit: names that
 * mention bytes (or Huawei's X_HW_Traffic, which counts bytes) are converted to
 * KB, names that say KB are taken as-is.
 */
export function extractByteCounters(text: string): { downKb?: number; upKb?: number } {
  const result: { downKb?: number; upKb?: number } = {};
  const entries = text.split(/[\r\n&;]+/);
  for (const entry of entries) {
    const match = /([A-Za-z][A-Za-z0-9_.\[\]-]{2,60})\s*[:=]\s*"?([0-9]{4,})"?/.exec(entry);
    if (!match) continue;
    const key = match[1] as string;
    const value = Number(match[2]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const lower = key.toLowerCase();
    if (!/byte|octet|traffic|counter|total/.test(lower)) continue;
    if (/rate|speed|limit|max|min|ssid|ip|mac|channel|port|mtu|time|count=/.test(lower)) continue;
    const isDown = /(recv|receive|received|rx|down|inbound|\bin\b|wan_down)/.test(lower);
    const isUp = /(sent|send|tx|up|outbound|\bout\b|wan_up)/.test(lower);
    if (!isDown && !isUp) continue;
    const kb = /kb|kilo|_k_/.test(lower) ? value : Math.round(value / 1024);
    if (isDown && result.downKb === undefined) result.downKb = kb;
    if (isUp && result.upKb === undefined) result.upKb = kb;
  }
  return result;
}

export function parseUptimeToSeconds(text: string): number | undefined {
  const dayMatch = /(\d+)\s*(?:day|يوم)/i.exec(text);
  const hourMatch = /(\d+)\s*(?:hour|hr|ساعة|ساعه)/i.exec(text);
  const minMatch = /(\d+)\s*(?:min|دقيقة|دقيقه)/i.exec(text);
  if (!dayMatch && !hourMatch && !minMatch) {
    const hms = /(\d{1,2}):(\d{2}):(\d{2})/.exec(text);
    if (hms) return toNumber(hms[1]) * 3600 + toNumber(hms[2]) * 60 + toNumber(hms[3]);
    return undefined;
  }
  return (
    toNumber(dayMatch?.[1]) * 86400 + toNumber(hourMatch?.[1]) * 3600 + toNumber(minMatch?.[1]) * 60 || undefined
  );
}

/** Attach a friendly device-kind label (used by the Device Manager cards). */
export function decorateDevice(device: DeviceRecord): DeviceRecord {
  const kind = device.kind ?? guessDeviceKind(device.vendor, device.hostname ?? device.name);
  if (!kind) return device;
  return { ...device, kind, name: device.isUnknown ? kind : device.name };
}
