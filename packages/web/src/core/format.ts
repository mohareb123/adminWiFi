/**
 * Display formatting helpers.
 *
 * Numbers are formatted once, in one place, so every panel agrees — and the
 * values are always the ones the engine measured (no rounding up, no "≈").
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import type { DeviceRecord } from '@urlm/core';

/** kbit/s → "42.8 Mbps" / "820 Kbps". */
export function formatKbps(kbps: number | undefined, options: { perSecond?: boolean } = {}): string {
  if (kbps === undefined || Number.isNaN(kbps)) return '—';
  const suffix = options.perSecond === false ? '' : '';
  if (kbps >= 1000) {
    const mbps = kbps / 1000;
    return `${mbps >= 100 ? mbps.toFixed(0) : mbps.toFixed(1)} Mbps${suffix}`;
  }
  return `${Math.round(kbps)} Kbps${suffix}`;
}

export function formatMbps(mbps: number | undefined): string {
  if (mbps === undefined || Number.isNaN(mbps)) return '—';
  return mbps >= 100 ? `${mbps.toFixed(0)} Mbps` : `${mbps.toFixed(1)} Mbps`;
}

export function formatKb(kb: number | undefined): string {
  if (kb === undefined || Number.isNaN(kb)) return '—';
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(2)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${Math.round(kb)} KB`;
}

export function formatMs(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) return '—';
  return `${Math.round(ms)} ms`;
}

/** Seconds → "3 يوم 4 ساعة" (Arabic, no jargon). */
export function formatUptime(seconds: number | undefined): string {
  if (seconds === undefined || Number.isNaN(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)} ثانية`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours} ساعة${remainingMinutes ? ` و${remainingMinutes} دقيقة` : ''}`;
  const days = Math.floor(hours / 24);
  return `${days} يوم${hours % 24 ? ` و${hours % 24} ساعة` : ''}`;
}

export function formatPercent(value: number | undefined, digits = 0): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

/** Relative Arabic time ("قبل 12 ثانية"). */
export function formatRelative(iso: string | number | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const at = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(at)) return '—';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return 'الآن';
  if (seconds < 60) return `قبل ${seconds} ثانية`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  return `قبل ${Math.round(hours / 24)} يوم`;
}

export function formatClock(iso: string | number | undefined): string {
  if (!iso) return '—';
  const at = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(at)) return '—';
  return new Date(at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(iso: string | number | undefined): string {
  if (!iso) return '—';
  const at = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(at)) return '—';
  return new Date(at).toLocaleString('ar-EG', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const CONNECTION_LABELS: Record<string, string> = {
  ethernet: 'كيبل',
  'wifi-2.4': 'واي فاي 2.4GHz',
  'wifi-5': 'واي فاي 5GHz',
  wifi: 'واي فاي',
  unknown: 'غير معروف',
};

export function connectionLabel(connection: string | undefined): string {
  if (!connection) return 'غير معروف';
  return CONNECTION_LABELS[connection] ?? connection;
}

export type SignalLevel = 'excellent' | 'good' | 'fair' | 'weak' | 'unknown';

export function signalLevel(signal: number | undefined): SignalLevel {
  if (signal === undefined || Number.isNaN(signal)) return 'unknown';
  // Wi-Fi RSSI in dBm (most vendors) or a 0-100 percentage (some ONTs).
  if (signal <= 0) {
    if (signal >= -55) return 'excellent';
    if (signal >= -65) return 'good';
    if (signal >= -75) return 'fair';
    return 'weak';
  }
  if (signal >= 75) return 'excellent';
  if (signal >= 55) return 'good';
  if (signal >= 35) return 'fair';
  return 'weak';
}

export const SIGNAL_LABEL: Record<SignalLevel, string> = {
  excellent: 'ممتازة',
  good: 'جيدة',
  fair: 'متوسطة',
  weak: 'ضعيفة',
  unknown: 'غير متاحة',
};

/** Percentage for signal bars (0..100). */
export function signalPercent(signal: number | undefined): number {
  if (signal === undefined || Number.isNaN(signal)) return 0;
  if (signal <= 0) {
    const clamped = Math.min(0, Math.max(-90, signal));
    return Math.round(((clamped + 90) / 90) * 100);
  }
  return Math.min(100, Math.round(signal));
}

export function shortMac(mac: string | undefined): string {
  if (!mac) return '—';
  return mac.length > 12 ? `${mac.slice(0, 8)}…${mac.slice(-4)}` : mac;
}

export function initials(name: string | undefined, mac: string | undefined): string {
  const source = (name || mac || '?').trim();
  const first = source[0] ?? '?';
  return first.toUpperCase();
}

/** Memory-safe sort for the device list. */
export function sortDevices(
  devices: readonly DeviceRecord[],
  key: 'name' | 'usage' | 'signal' | 'connection',
): DeviceRecord[] {
  const copy = [...devices];
  switch (key) {
    case 'usage':
      return copy.sort((a, b) => (b.usageKb ?? b.rateDownKbps ?? 0) - (a.usageKb ?? a.rateDownKbps ?? 0));
    case 'signal':
      return copy.sort((a, b) => signalPercent(b.signal) - signalPercent(a.signal));
    case 'connection':
      return copy.sort((a, b) => (a.connection ?? '').localeCompare(b.connection ?? ''));
    default:
      return copy.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ar'));
  }
}

export function topConsumer(devices: readonly DeviceRecord[]): DeviceRecord | undefined {
  const withRates = devices.filter((device) => (device.rateDownKbps ?? 0) > 0 || (device.rateUpKbps ?? 0) > 0);
  if (withRates.length > 0) {
    return withRates.reduce((best, device) =>
      (device.rateDownKbps ?? 0) + (device.rateUpKbps ?? 0) > (best.rateDownKbps ?? 0) + (best.rateUpKbps ?? 0)
        ? device
        : best,
    );
  }
  const withUsage = devices.filter((device) => (device.usageKb ?? 0) > 0);
  if (withUsage.length === 0) return undefined;
  return withUsage.reduce((best, device) => ((device.usageKb ?? 0) > (best.usageKb ?? 0) ? device : best));
}
