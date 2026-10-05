/**
 * Notification model (spec §48) + Smart Confirmation policy (spec §46/§47).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { randomId } from './util';
import type { OperationId } from './types';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

export interface AppNotification {
  id: string;
  at: number;
  severity: NotificationSeverity;
  /** Arabic copy shown to the user. */
  title: string;
  body?: string;
  /** Machine code so the UI can group/deduplicate (e.g. 'new-device'). */
  code: string;
  /** Optional quick action. */
  action?: { label: string; operationId?: OperationId; route?: string };
  read?: boolean;
}

export function createNotification(
  notification: Omit<AppNotification, 'id' | 'at' | 'read'> & { id?: string },
): AppNotification {
  return { id: notification.id ?? randomId('n'), at: Date.now(), read: false, ...notification };
}

/** Notification copy used by the engine and the monitors. */
export const NOTIFICATION_COPY = {
  newDevice: (name: string): AppNotification =>
    createNotification({
      severity: 'warning',
      code: 'new-device',
      title: '⚠️ جهاز جديد اتصل بالشبكة',
      body: name,
    }),
  speedDrop: (mbps: number): AppNotification =>
    createNotification({
      severity: 'warning',
      code: 'speed-drop',
      title: '📶 سرعة الإنترنت انخفضت',
      body: `السرعة الحالية ${mbps.toFixed(1)} Mbps`,
    }),
  offline: (): AppNotification =>
    createNotification({ severity: 'critical', code: 'offline', title: '🔴 الاتصال بالإنترنت انقطع' }),
  online: (): AppNotification =>
    createNotification({ severity: 'success', code: 'online', title: '🟢 تم استعادة الاتصال بالإنترنت' }),
  smartFixApplied: (summary: string): AppNotification =>
    createNotification({ severity: 'success', code: 'smart-fix', title: '✓ تم تطبيق Smart Fix', body: summary }),
  smartFixFailed: (reason: string): AppNotification =>
    createNotification({ severity: 'warning', code: 'smart-fix-failed', title: '⚠️ لم يتم تطبيق التغيير', body: reason }),
  weakWifi: (ssid: string): AppNotification =>
    createNotification({
      severity: 'warning',
      code: 'weak-wifi-security',
      title: '🔓 شبكة واي فاي بحماية ضعيفة',
      body: ssid,
      action: { label: 'تحسين الحماية', route: '/wifi' },
    }),
  routerRebooting: (): AppNotification =>
    createNotification({
      severity: 'info',
      code: 'reboot',
      title: '♻️ جاري إعادة تشغيل الراوتر',
      body: 'سيتم قطع الاتصال مؤقتًا.',
    }),
} as const;

/* ------------------------------------------------------------------ *
 * Smart confirmation
 * ------------------------------------------------------------------ */

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

const OPERATION_RISK: Record<string, RiskLevel> = {
  'wifi.set_ssid': 'medium',
  'wifi.set_password': 'medium',
  'wifi.set_channel': 'low',
  'wifi.set_security': 'medium',
  'wifi.set_band_enabled': 'medium',
  'wifi.set_guest_network': 'low',
  'device.block': 'low',
  'device.unblock': 'low',
  'device.rename': 'safe',
  'device.limit_bandwidth': 'low',
  'device.clear_limit': 'low',
  'dns.set': 'medium',
  'dhcp.set_pool': 'high',
  'dhcp.set_lease': 'low',
  'qos.set_rule': 'low',
  'qos.remove_rule': 'low',
  'firewall.set_level': 'high',
  'port_forward.add': 'high',
  'port_forward.remove': 'high',
  'router.reboot': 'critical',
  'router.backup': 'safe',
  'router.restore': 'critical',
  'wan.set_mtu': 'high',
  'wan.reconnect': 'medium',
};

export function riskOf(operationId: OperationId | string): RiskLevel {
  return OPERATION_RISK[operationId] ?? 'medium';
}

export interface ConfirmationCopy {
  /** Arabic dialog copy. */
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  risk: RiskLevel;
}

const RISK_COPY: Record<RiskLevel, { title: string; confirmLabel: string }> = {
  safe: { title: 'تأكيد العملية', confirmLabel: 'تنفيذ' },
  low: { title: 'تأكيد العملية', confirmLabel: 'تنفيذ' },
  medium: { title: 'تأكيد التغيير', confirmLabel: 'تطبيق التغيير' },
  high: { title: 'تأكيد تغيير مهم', confirmLabel: 'تطبيق التغيير' },
  critical: { title: 'تحذير: عملية خطيرة', confirmLabel: 'تنفيذ' },
};

export function confirmationFor(operationId: OperationId | string, bodyAr: string): ConfirmationCopy {
  const risk = riskOf(operationId);
  const copy = RISK_COPY[risk];
  return {
    risk,
    title: copy.title,
    body: bodyAr,
    confirmLabel: copy.confirmLabel,
    cancelLabel: 'إلغاء',
  };
}

/**
 * Smart confirmation: simple, reversible actions do not nag the user; anything
 * that can disconnect the network, open a port, or drop DHCP refuses to run
 * without an explicit confirmation (spec §46/§47).
 */
export function requiresConfirmation(operationId: OperationId | string): boolean {
  const risk = riskOf(operationId);
  return risk === 'medium' || risk === 'high' || risk === 'critical';
}

export const CONFIRMATION_BODIES_AR: Partial<Record<string, string>> = {
  'router.reboot': 'إعادة تشغيل الراوتر ستقطع الاتصال مؤقتًا.',
  'router.restore': 'استعادة نسخة احتياطية ستستبدل الإعدادات الحالية بالكامل.',
  'wifi.set_password': 'سيتم فصل جميع الأجهزة المتصلة ويجب إعادة الاتصال بكلمة المرور الجديدة.',
  'wifi.set_security': 'تغيير نوع التشفير قد يمنع الأجهزة القديمة من الاتصال.',
  'dns.set': 'سيتم تطبيق إعدادات DNS على جميع الأجهزة المتصلة.',
  'dhcp.set_pool': 'تغيير نطاق DHCP قد يفصل الأجهزة الحالية حتى تجدد العنوان.',
  'firewall.set_level': 'تغيير مستوى الجدار الناري قد يمنع بعض الخدمات أو التطبيقات.',
  'port_forward.add': 'فتح منفذ يجعل خدمة داخلية متاحة من الإنترنت — تأكد أنك تعرف الخدمة.',
  'wan.set_mtu': 'قيمة MTU غير الصحيحة قد تعطل الاتصال بالإنترنت.',
};
