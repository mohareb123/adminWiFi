/**
 * Dynamic capability detection (spec §7).
 *
 * Rule: a button is only shown when the operation is supported *or* can be
 * executed reliably; otherwise the UI reports "غير مدعوم على هذا الراوتر"
 * (unsupported on this router) instead of rendering a decorative control.
 *
 * Inputs, in priority order:
 *  1. authenticated probes against endpoints declared by the signature;
 *  2. capabilities declared by the matched signature (medium trust);
 *  3. adapter/OS heuristics (low trust, never enough to enable a write);
 *  4. explicit "unsupported" declarations for a family (highest trust).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { createLogger } from '../core/logger';
import type { HttpSession } from '../core/http';
import type {
  CapabilityId,
  CapabilityReport,
  CapabilityState,
  CapabilitySupport,
} from '../core/types';
import type { RouterSignature } from '../signatures/types';

const log = createLogger('capabilities');

/** Capability → signature API field used to probe it. */
const PROBE_MAP: Array<{ id: CapabilityId; apiKeys: Array<keyof NonNullable<RouterSignature['api']>> }> = [
  { id: 'connected_devices', apiKeys: ['deviceList', 'deviceInfo'] },
  { id: 'wifi', apiKeys: ['wifiInfo'] },
  { id: 'wifi_ssid', apiKeys: ['wifiInfo'] },
  { id: 'wifi_password', apiKeys: ['wifiInfo', 'wifiSet'] },
  { id: 'wifi_scan', apiKeys: ['wifiScan'] },
  { id: 'guest_network', apiKeys: ['guestNetwork'] },
  { id: 'wan_info', apiKeys: ['wanInfo'] },
  { id: 'lan_info', apiKeys: ['lanInfo'] },
  { id: 'dhcp', apiKeys: ['dhcpInfo', 'lanInfo'] },
  { id: 'dns', apiKeys: ['dnsInfo', 'wanInfo'] },
  { id: 'qos', apiKeys: ['qos'] },
  { id: 'firewall', apiKeys: ['firewall'] },
  { id: 'port_forwarding', apiKeys: ['portForwarding'] },
  { id: 'traffic_stats', apiKeys: ['stats'] },
  { id: 'firmware_info', apiKeys: ['firmware', 'deviceInfo'] },
  { id: 'logs', apiKeys: ['logs'] },
  { id: 'backup', apiKeys: ['backup'] },
  { id: 'restore', apiKeys: ['restore'] },
];

/** Every capability the app models; anything not stated is 'unknown'. */
export const ALL_CAPABILITIES: CapabilityId[] = [
  'connected_devices',
  'device_block',
  'device_rename',
  'device_details',
  'bandwidth_control',
  'per_device_stats',
  'wifi',
  'wifi_ssid',
  'wifi_password',
  'wifi_5ghz',
  'wifi_channels',
  'wifi_security_mode',
  'wifi_scan',
  'guest_network',
  'dhcp',
  'dns',
  'qos',
  'firewall',
  'port_forwarding',
  'reboot',
  'wan_info',
  'lan_info',
  'firmware_info',
  'traffic_stats',
  'backup',
  'restore',
  'upnp',
  'ddns',
  'vpn',
  'snmp',
  'logs',
];

export interface CapabilityDetectorOptions {
  session: HttpSession;
  signature: RouterSignature;
  /** Bypass network probes entirely (e.g. read-only / diagnostics mode). */
  skipProbes?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export class CapabilityDetector {
  async detect(options: CapabilityDetectorOptions): Promise<CapabilityReport> {
    const started = Date.now();
    const states = new Map<CapabilityId, CapabilityState>();

    // 1. Explicit "unsupported" declarations always win.
    for (const [id, support] of Object.entries(options.signature.capabilities ?? {}) as Array<[CapabilityId, CapabilitySupport]>) {
      if (support === 'no') {
        states.set(id, {
          id,
          supported: 'no',
          confidence: 0.9,
          source: 'unsupported-signature',
          reason: 'unsupported-family',
        });
      }
    }

    // 2. Signature declarations (medium trust).
    for (const [id, support] of Object.entries(options.signature.capabilities ?? {}) as Array<[CapabilityId, CapabilitySupport]>) {
      if (support === 'yes' && !states.has(id)) {
        states.set(id, {
          id,
          supported: 'yes',
          confidence: options.signature.source === 'builtin' ? 0.72 : 0.55,
          source: 'signature',
          reason: 'signature-declared',
          note: 'Declared by the matched signature; verified on first use.',
        });
      }
    }

    // 3. Operations declared with a verified read-back raise confidence for the
    //    matching capability (still not a probe result).
    for (const operation of options.signature.operations ?? []) {
      const id = capabilityForOperation(operation.id);
      if (!id) continue;
      const existing = states.get(id);
      if (existing && existing.supported === 'no') continue;
      states.set(id, {
        id,
        supported: 'yes',
        confidence: Math.max(existing?.confidence ?? 0, 0.8),
        source: 'signature',
        reason: operation.readBack ? 'signature-declared-with-readback' : 'signature-declared',
        note: operation.notes,
      });
    }

    // 4. Explicitly unreliable operations on this family → mark unsupported.
    for (const blocked of options.signature.known?.blockedOperations ?? []) {
      const id = capabilityForOperation(blocked);
      if (id) {
        states.set(id, {
          id,
          supported: 'no',
          confidence: 0.85,
          source: 'unsupported-signature',
          reason: 'known-unreliable-on-family',
        });
      }
    }

    // 5. Authenticated probes.
    let probesRun = 0;
    let probesFailed = 0;
    if (!options.skipProbes) {
      const probeable = PROBE_MAP.filter((entry) => {
        const state = states.get(entry.id);
        return state?.supported !== 'no';
      });
      let done = 0;
      for (const entry of probeable) {
        const paths: string[] = [];
        for (const key of entry.apiKeys) {
          const candidate = options.signature.api?.[key];
          if (candidate && !candidate.includes('{')) paths.push(candidate);
        }
        if (paths.length === 0) continue;
        probesRun += 1;
        try {
          const response = await options.session.request({
            url: paths[0]!,
            method: 'GET',
            timeoutMs: options.timeoutMs ?? 3500,
            signal: options.signal,
          });
          const supported = response.status < 400 && response.body.length > 0;
          if (supported) {
            states.set(entry.id, {
              id: entry.id,
              supported: 'yes',
              confidence: 0.9,
              source: 'probe',
              reason: 'probe-confirmed',
              verifiedAt: new Date().toISOString(),
            });
          } else {
            probesFailed += 1;
            const existing = states.get(entry.id);
            if (!existing || existing.source !== 'unsupported-signature') {
              states.set(entry.id, {
                id: entry.id,
                supported: 'unknown',
                confidence: 0.4,
                source: 'probe',
                reason: `probe-http-${response.status}`,
              });
            }
          }
        } catch {
          probesFailed += 1;
          // Network errors leave the declaration intact rather than lying.
        }
        done += 1;
        try {
          options.onProgress?.(done, probeable.length);
        } catch {
          /* ignore */
        }
      }
    }

    // 6. Anything never mentioned becomes 'unknown' with a truthful reason.
    const list: CapabilityState[] = ALL_CAPABILITIES.map(
      (id) =>
        states.get(id) ?? {
          id,
          supported: 'unknown' as CapabilitySupport,
          confidence: 0.2,
          source: 'heuristic' as const,
          reason: 'not-yet-detected',
        },
    );

    const report: CapabilityReport = {
      states: list,
      detectedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      probesRun,
      probesFailed,
    };
    log.info('capabilities detected', {
      yes: list.filter((state) => state.supported === 'yes').length,
      no: list.filter((state) => state.supported === 'no').length,
      unknown: list.filter((state) => state.supported === 'unknown').length,
      probesRun,
    });
    return report;
  }
}

/** Map an operation to the user-facing capability it belongs to. */
export function capabilityForOperation(operationId: string): CapabilityId | undefined {
  switch (operationId) {
    case 'wifi.set_ssid':
      return 'wifi_ssid';
    case 'wifi.set_password':
      return 'wifi_password';
    case 'wifi.set_channel':
      return 'wifi_channels';
    case 'wifi.set_security':
      return 'wifi_security_mode';
    case 'wifi.set_band_enabled':
      return 'wifi';
    case 'wifi.set_guest_network':
      return 'guest_network';
    case 'device.block':
    case 'device.unblock':
      return 'device_block';
    case 'device.rename':
      return 'device_rename';
    case 'device.limit_bandwidth':
    case 'device.clear_limit':
      return 'bandwidth_control';
    case 'dns.set':
      return 'dns';
    case 'dhcp.set_pool':
    case 'dhcp.set_lease':
      return 'dhcp';
    case 'qos.set_rule':
    case 'qos.remove_rule':
      return 'qos';
    case 'firewall.set_level':
      return 'firewall';
    case 'port_forward.add':
    case 'port_forward.remove':
      return 'port_forwarding';
    case 'router.reboot':
    case 'wan.reconnect':
      return 'reboot';
    case 'router.backup':
      return 'backup';
    case 'router.restore':
      return 'restore';
    case 'wan.set_mtu':
      return 'wan_info';
    default:
      return undefined;
  }
}

export function isSupported(report: CapabilityReport | undefined, id: CapabilityId): boolean {
  const state = report?.states.find((entry) => entry.id === id);
  return state?.supported === 'yes';
}

export function capabilityState(report: CapabilityReport | undefined, id: CapabilityId): CapabilityState | undefined {
  return report?.states.find((entry) => entry.id === id);
}
