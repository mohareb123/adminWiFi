/**
 * Adapter contracts (spec §6).
 *
 * Pipeline:  UniversalRouterEngine → FingerprintEngine → CapabilityDetector →
 *            RouterAdapter → Operation → VerificationEngine
 *
 * The engine never assumes a driver exists: a vendor adapter is an *optimiser*,
 * while GenericRouterAdapter keeps the device usable when no driver matches.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import type { HttpSession } from '../core/http';
import type { Logger } from '../core/logger';
import type {
  AdapterInfo,
  BandwidthSample,
  CapabilityReport,
  DeviceRecord,
  FingerprintReport,
  LanState,
  LoginRecipe,
  OperationRequest,
  OperationResult,
  RouterCredentials,
  RouterIdentity,
  WanState,
  WifiNeighbor,
  WifiState,
} from '../core/types';
import type { RouterSignature } from '../signatures/types';

export interface AdapterContext {
  session: HttpSession;
  identity: RouterIdentity;
  fingerprint: FingerprintReport;
  signature: RouterSignature;
  capabilities: CapabilityReport;
  credentials?: RouterCredentials;
  logger: Logger;
  /** Shared mutable adapter state (session, tokens, discovered paths). */
  state: AdapterState;
  signal?: AbortSignal;
  /** Self-learning hook (spec §45) — records real operation outcomes. */
  learn?: (outcome: { operationId: string; ok: boolean; verified: boolean; reason?: string }) => void;
}

export interface AdapterState {
  authenticated: boolean;
  loginRecipe?: LoginRecipe;
  /** Session token discovered at login (stok, sessionId, ...). */
  token?: string;
  /** Paths the adapter has confirmed work on this device. */
  workingPaths: Record<string, string>;
  /** Extra capability observations made while operating. */
  observed: Partial<Record<string, boolean>>;
  /** Set when the device locks out further login attempts. */
  lockedOut?: boolean;
  /** Last byte counters, used to derive rates on totals-only devices. */
  counters?: { at: number; downKb?: number; upKb?: number };
  missingCapabilities?: string[];
}

export interface LoginResult {
  ok: boolean;
  recipe?: LoginRecipe;
  detail?: string;
  reason?: 'auth-failed' | 'captcha' | 'unsupported' | 'network' | 'timeout';
  attempts: number;
  durationMs: number;
}

export interface SnapshotOptions {
  includeDevices?: boolean;
  includeWifi?: boolean;
  includeWan?: boolean;
  includeLan?: boolean;
  includeRates?: boolean;
  signal?: AbortSignal;
}

export interface RouterAdapter {
  readonly info: AdapterInfo;
  /** Discover how this device authenticates (pure analysis where possible). */
  discoverLoginRecipe(context: AdapterContext): Promise<LoginRecipe>;
  authenticate(context: AdapterContext, credentials: RouterCredentials): Promise<LoginResult>;
  logout?(context: AdapterContext): Promise<void>;
  getDevices?(context: AdapterContext): Promise<DeviceRecord[]>;
  getWifiState?(context: AdapterContext): Promise<WifiState>;
  setWifiState?(context: AdapterContext, patch: Partial<WifiState>): Promise<OperationResult>;
  scanWifiNeighbors?(context: AdapterContext): Promise<WifiNeighbor[]>;
  getWanState?(context: AdapterContext): Promise<WanState>;
  getLanState?(context: AdapterContext): Promise<LanState>;
  getBandwidthSample?(context: AdapterContext): Promise<BandwidthSample>;
  execute(context: AdapterContext, request: OperationRequest): Promise<OperationResult>;
  /** Raw, unmapped data for Advanced Mode (Diagnostics → Adapter). */
  getAdvancedData?(context: AdapterContext, kind: string): Promise<unknown>;
}

export const emptyAdapterState = (): AdapterState => ({
  authenticated: false,
  workingPaths: {},
  observed: {},
});

/** Human-facing Arabic label for a capability, used across Simple/Advanced. */
export const CAPABILITY_LABELS_AR: Record<string, string> = {
  connected_devices: 'الأجهزة المتصلة',
  device_block: 'حجب الأجهزة',
  device_rename: 'تغيير اسم الجهاز',
  device_details: 'تفاصيل الجهاز',
  bandwidth_control: 'تحديد السرعة',
  per_device_stats: 'إحصاءات لكل جهاز',
  wifi: 'الواي فاي',
  wifi_ssid: 'اسم الشبكة',
  wifi_password: 'كلمة مرور الواي فاي',
  wifi_5ghz: 'شبكة 5 جيجا',
  wifi_channels: 'القنوات',
  wifi_security_mode: 'نوع التشفير',
  wifi_scan: 'فحص الشبكات المجاورة',
  guest_network: 'شبكة الزوار',
  dhcp: 'DHCP',
  dns: 'DNS',
  qos: 'جودة الخدمة QoS',
  firewall: 'الجدار الناري',
  port_forwarding: 'تحويل المنافذ',
  reboot: 'إعادة التشغيل',
  wan_info: 'معلومات الإنترنت',
  lan_info: 'معلومات الشبكة المحلية',
  firmware_info: 'إصدار النظام',
  traffic_stats: 'إحصاءات الاستهلاك',
  backup: 'نسخة احتياطية',
  restore: 'استعادة نسخة',
  upnp: 'UPnP',
  ddns: 'DDNS',
  vpn: 'VPN',
  snmp: 'SNMP',
  logs: 'السجلات',
};

export function capabilityLabel(id: string): string {
  return CAPABILITY_LABELS_AR[id] ?? id;
}
