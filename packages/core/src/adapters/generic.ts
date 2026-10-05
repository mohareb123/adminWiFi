/**
 * GenericRouterAdapter (spec §6).
 *
 * The safety net of the Universal Router Adaptation System: when no vendor
 * driver matches (or confidence is low) the device stays usable through
 * heuristics, and anything that cannot be executed reliably is reported as
 * unsupported instead of faked.
 *
 * It performs no risky writes without a declared, verifiable endpoint.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import type { DeviceRecord, OperationRequest, OperationResult, WanState, WifiNeighbor, WifiState } from '../core/types';
import { extractNeighborsFromJson, extractWifiFromHtml } from './parsing';
import { BaseRouterAdapter } from './base';
import type { AdapterContext } from './types';

export class GenericRouterAdapter extends BaseRouterAdapter {
  constructor(source = 'generic') {
    super({
      info: {
        id: 'GenericRouterAdapter',
        vendor: 'Generic',
        displayName: 'Generic Router Adapter',
        generic: true,
        notes: [
          'Used when the fingerprint has limited confidence.',
          'Only operations declared with a verifiable endpoint are attempted.',
        ],
      },
      transformOrder: ['plain', 'md5', 'base64', 'md5-base64'],
      parsers: {
        devicesFromJson: (json) => extractDevicesRecursive(json),
      },
    });
    this.source = source;
  }

  private readonly source: string;

  override async getDevices(context: AdapterContext): Promise<DeviceRecord[]> {
    try {
      return await super.getDevices(context);
    } catch (error) {
      // Fall back to the DHCP-client table when the vendor list is unavailable.
      const fallbackPaths = ['/cgi-bin/luci/admin/network/dhcp', '/DEV_device.htm', '/userRpm/AssignedIpAddrListRpm.htm'];
      for (const path of fallbackPaths) {
        try {
          const response = await context.session.request({ url: path, method: 'GET', timeoutMs: 5000, signal: context.signal });
          const devices = this.parseDevices(response.body, response.headers['content-type'] ?? '');
          if (devices.length > 0) return devices;
        } catch {
          /* keep trying */
        }
      }
      throw error;
    }
  }

  override async getWifiState(context: AdapterContext): Promise<WifiState> {
    try {
      return await super.getWifiState(context);
    } catch (error) {
      const fallbackPaths = ['/userRpm/WlanNetworkRpm.htm', '/wireless.htm', '/wlan_basic_t.gch', '/wireless_basic.asp'];
      for (const path of fallbackPaths) {
        try {
          const response = await context.session.request({ url: path, method: 'GET', timeoutMs: 5000, signal: context.signal });
          const state = extractWifiFromHtml(response.body);
          if (state.bands.length > 0) return state;
        } catch {
          /* keep trying */
        }
      }
      throw error;
    }
  }

  override async scanWifiNeighbors(context: AdapterContext): Promise<WifiNeighbor[]> {
    const extra = [
      '/cgi-bin/luci/;stok={stok}/admin/wireless?form=wireless_survey',
      '/api/wlan/neighbor',
      '/wlan_survey.gch',
    ];
    for (const template of extra) {
      const path = this.fillTemplate(template, context, {});
      if (path.includes('{')) continue;
      try {
        const response = await context.session.request({ url: path, method: 'GET', timeoutMs: 7000, signal: context.signal });
        const neighbors = extractNeighborsFromJson(parseLooseJson(response.body));
        if (neighbors.length > 0) return neighbors;
      } catch {
        /* keep trying */
      }
    }
    return super.scanWifiNeighbors(context);
  }

  override async execute(context: AdapterContext, request: OperationRequest): Promise<OperationResult> {
    const result = await super.execute(context, request);
    if (!result.ok && result.reason === 'unsupported') {
      return {
        ...result,
        message: 'غير مدعوم على هذا الراوتر.',
        messageEn: `Unsupported on this router (${this.source}).`,
      };
    }
    return result;
  }

  /** Extra WAN candidates common to ISP-issued devices. */
  override async getWanState(context: AdapterContext): Promise<WanState> {
    try {
      return await super.getWanState(context);
    } catch {
      for (const path of ['/status.cgi', '/RST_status.htm', '/common_page/status_t.gch', '/wan_status.gch']) {
        try {
          const response = await context.session.request({ url: path, method: 'GET', timeoutMs: 5000, signal: context.signal });
          const state = extractWanFromHtmlLoose(response.body);
          if (state && (state.ip || state.dns.length > 0)) return state;
        } catch {
          /* keep trying */
        }
      }
      throw new Error('WAN information is not exposed by this device');
    }
  }
}

/* ------------------------------------------------------------------ *
 * Heuristic helpers
 * ------------------------------------------------------------------ */

/** Recursive device extraction for APIs with unpredictable key names. */
function extractDevicesRecursive(json: unknown): DeviceRecord[] {
  const MAC = /\b([0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i;
  const found = new Map<string, DeviceRecord>();

  const visit = (node: unknown, depth: number): void => {
    if (depth > 6 || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;
    const object = node as Record<string, unknown>;
    const values = Object.entries(object);
    const macEntry = values.find(([, value]) => typeof value === 'string' && MAC.test(value));
    if (macEntry) {
      const mac = (macEntry[1] as string).toLowerCase().replace(/-/g, ':');
      const ipEntry = values.find(([key, value]) => /ip/i.test(key) && typeof value === 'string' && /\d+\.\d+\.\d+\.\d+/.test(value));
      const nameEntry = values.find(
        ([key, value]) => /(host|name|device|client|alias|desc)/i.test(key) && typeof value === 'string' && value.length > 1,
      );
      const entry = found.get(mac) ?? {
        id: `mac:${mac}`,
        name: (nameEntry?.[1] as string) ?? mac,
        ip: (ipEntry?.[1] as string) ?? '',
        mac,
        connection: /5g|5ghz/i.test(JSON.stringify(object)) ? 'wifi-5' : /wifi|wlan|wireless/i.test(JSON.stringify(object)) ? 'wifi-2.4' : 'unknown',
        blocked: /true/i.test(String(object.blocked ?? object.block ?? object.deny ?? 'false')),
        isUnknown: !nameEntry,
        raw: object,
      } as DeviceRecord;
      found.set(mac, entry);
    }
    values.forEach(([, value]) => visit(value, depth + 1));
  };

  visit(json, 0);
  return [...found.values()];
}

function parseLooseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^[^[{]*/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function extractWanFromHtmlLoose(html: string): WanState | undefined {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const ip = /(?:ip address|wan ip|public ip)[^0-9]{0,20}((?:\d{1,3}\.){3}\d{1,3})/i.exec(text)?.[1];
  const dns = [...text.matchAll(/dns[^0-9]{0,24}((?:\d{1,3}\.){3}\d{1,3})/gi)].map((match) => match[1] as string);
  if (!ip && dns.length === 0) return undefined;
  return {
    ip,
    dns: [...new Set(dns)],
    status: /connected|up|online/i.test(text) ? 'connected' : undefined,
  };
}
