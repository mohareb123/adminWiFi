/**
 * Security Center (spec §22).
 *
 * Legitimate, owner-side assessment only: weak Wi-Fi security, open guest
 * networks, risky settings that the router itself reports, unknown devices and
 * firmware awareness. There is deliberately NO authentication bypass, brute
 * force, credential theft, unauthorized access or exploitation anywhere.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import type { CapabilityReport, DeviceRecord, FingerprintReport, NetworkSnapshot } from '../core/types';
import type { OperationId } from '../core/types';

export type SecurityStatus = 'secure' | 'attention' | 'critical';

export interface SecurityFinding {
  id: string;
  status: 'ok' | 'attention' | 'critical';
  titleAr: string;
  detailAr: string;
  /** Suggested remediation, executed through the Universal Router Engine. */
  fix?: { operationId: OperationId; params?: Record<string, unknown>; labelAr: string };
  evidence?: string;
  /** Points removed from the score. */
  weight: number;
}

export interface SecurityReport {
  status: SecurityStatus;
  /** 0..100 — only counts checks that could actually be evaluated. */
  score: number;
  findings: SecurityFinding[];
  checkedAt: string;
  /** How many of the checks could be evaluated on this device. */
  evaluated: number;
  skipped: string[];
}

export interface SecurityInput {
  snapshot?: NetworkSnapshot;
  fingerprint?: FingerprintReport;
  capabilities?: CapabilityReport;
  /** Devices the user has explicitly trusted (no "unknown device" warnings). */
  trustedMacs?: string[];
}

const WEAK_SECURITY = /(open|none|wep|disabled|no security|مفتوح)/i;
const OK_SECURITY = /(wpa2|wpa3|wpa2\/wpa3|psk2|sae)/i;

export class SecurityCenter {
  static analyze(input: SecurityInput): SecurityReport {
    const findings: SecurityFinding[] = [];
    const skipped: string[] = [];

    /* Wi-Fi security ------------------------------------------------ */
    const bands = input.snapshot?.wifi.bands ?? [];
    if (bands.length === 0) {
      skipped.push('wifi-security');
    } else {
      for (const band of bands) {
        const security = band.security ?? '';
        if (!security) {
          findings.push({
            id: `wifi-security-unknown-${band.band}`,
            status: 'attention',
            weight: 8,
            titleAr: `تعذر قراءة نوع التشفير لشبكة ${band.band}`,
            detailAr: 'قد لا تعرض واجهة الراوتر نوع التشفير. تأكد من الإعدادات يدويًا.',
          });
          continue;
        }
        if (WEAK_SECURITY.test(security)) {
          findings.push({
            id: `wifi-weak-${band.band}`,
            status: 'critical',
            weight: 30,
            titleAr: `شبكة ${band.band} بحماية ضعيفة (${security})`,
            detailAr: 'أي شخص قريب من الشبكة يستطيع الدخول عليها. يُنصح بتفعيل WPA2/WPA3.',
            evidence: `SSID: ${band.ssid} · security: ${security}`,
            fix: { operationId: 'wifi.set_security', params: { security: 'WPA2-PSK', band: band.band }, labelAr: 'تحسين حماية الواي فاي' },
          });
        } else if (!OK_SECURITY.test(security)) {
          findings.push({
            id: `wifi-unknown-${band.band}`,
            status: 'attention',
            weight: 8,
            titleAr: `نوع تشفير غير معتاد على شبكة ${band.band}`,
            detailAr: `النوع المكتشف: ${security}. يُفضل استخدام WPA2/WPA3.`,
          });
        } else {
          findings.push({
            id: `wifi-ok-${band.band}`,
            status: 'ok',
            weight: 0,
            titleAr: `حماية شبكة ${band.band} جيدة`,
            detailAr: `${security} مطبق حاليًا.`,
          });
        }
      }
    }

    /* Guest network ------------------------------------------------- */
    const guestEnabled = input.snapshot?.wifi.guestEnabled ?? bands.some((band) => band.guest);
    const guestSecurity = bands.find((band) => band.guest)?.security ?? '';
    if (guestEnabled===false) {
      findings.push({
        id: 'guest-disabled',
        status: 'ok',
        weight: 0,
        titleAr: 'شبكة الزوار غير مفعلة',
        detailAr: 'لا توجد شبكة إضافية يمكن استغلالها.',
      });
    } else if (guestEnabled && WEAK_SECURITY.test(guestSecurity || 'open')) {
      findings.push({
        id: 'guest-open',
        status: 'attention',
        weight: 12,
        titleAr: 'شبكة الزوار مفتوحة بدون كلمة مرور',
        detailAr: 'الأفضل حماية شبكة الزوار بكلمة مرور حتى لا يستخدمها الغرباء.',
      });
    }

    /* WPS ----------------------------------------------------------- */
    if (input.snapshot?.wifi.wpsEnabled === true) {
      findings.push({
        id: 'wps-enabled',
        status: 'attention',
        weight: 10,
        titleAr: 'خاصية WPS مفعّلة',
        detailAr: 'WPS يسهّل الاتصال لكنه أضعف من كلمة المرور العادية. يُفضل إيقافه.',
      });
    }

    /* Unknown devices ----------------------------------------------- */
    const devices = input.snapshot?.devices ?? [];
    if (devices.length === 0) {
      skipped.push('unknown-devices');
    } else {
      const trusted = new Set((input.trustedMacs ?? []).map((mac) => mac.toLowerCase()));
      const unknown = devices.filter((device) => device.isUnknown && !trusted.has(device.mac));
      if (unknown.length > 0) {
        findings.push({
          id: 'unknown-devices',
          status: unknown.length > 2 ? 'attention' : 'ok',
          weight: Math.min(15, unknown.length * 4),
          titleAr: `${unknown.length} جهاز غير معروف على الشبكة`,
          detailAr: 'راجع الأجهزة المتصلة، ويمكنك إيقاف الإنترنت عن أي جهاز غير معروف.',
          evidence: unknown
            .slice(0, 4)
            .map((device) => `${device.mac} (${device.ip || 'بدون IP'})`)
            .join(', '),
        });
      } else {
        findings.push({
          id: 'devices-known',
          status: 'ok',
          weight: 0,
          titleAr: 'كل الأجهزة المتصلة معروفة',
          detailAr: `${devices.length} جهاز موثوق.`,
        });
      }

      const blocked = devices.filter((device) => device.blocked).length;
      if (blocked > 0) {
        findings.push({
          id: 'blocked-present',
          status: 'ok',
          weight: 0,
          titleAr: `${blocked} جهاز موقوف عن الإنترنت`,
          detailAr: 'قواعد الحجب مطبقة على الراوتر.',
        });
      }
    }

    /* Firmware awareness -------------------------------------------- */
    const firmware = input.fingerprint?.identity?.firmware;
    if (!firmware) {
      findings.push({
        id: 'firmware-unknown',
        status: 'attention',
        weight: 4,
        titleAr: 'إصدار نظام الراوتر غير معروف',
        detailAr: 'تأكد من تحديث الراوتر من صفحة الإدارة الرسمية للشركة المصنّعة.',
      });
    } else {
      findings.push({
        id: 'firmware-known',
        status: 'ok',
        weight: 0,
        titleAr: 'إصدار النظام معروف',
        detailAr: firmware,
      });
    }

    /* Risky settings the router reports ------------------------------ */
    if (input.snapshot?.lan.dhcpEnabled === false) {
      findings.push({
        id: 'dhcp-disabled',
        status: 'attention',
        weight: 6,
        titleAr: 'DHCP متوقف',
        detailAr: 'إذا كان DHCP متوقفًا فالأجهزة تحتاج إعداد IP يدويًا — تأكد أن ذلك مقصود.',
      });
    }

    if (input.fingerprint?.signals?.upnp) {
      findings.push({
        id: 'upnp-advertised',
        status: 'attention',
        weight: 5,
        titleAr: 'خدمة UPnP معلنة على الشبكة',
        detailAr: 'UPnP تسمح للتطبيقات بفتح منافذ تلقائيًا. أوقفها إن لم تكن تحتاجها.',
      });
    }

    /* Score ---------------------------------------------------------- */
    const deductions = findings.reduce((total, finding) => total + finding.weight, 0);
    const score = Math.max(0, Math.min(100, 100 - deductions));
    const hasCritical = findings.some((finding) => finding.status === 'critical');
    const hasAttention = findings.some((finding) => finding.status === 'attention');
    const status: SecurityStatus = hasCritical ? 'critical' : hasAttention ? 'attention' : 'secure';

    return {
      status,
      score,
      findings: findings.sort((a, b) => b.weight - a.weight),
      checkedAt: new Date().toISOString(),
      evaluated: findings.filter((finding) => finding.status !== 'ok').length,
      skipped,
    };
  }

  static statusLabel(status: SecurityStatus): string {
    switch (status) {
      case 'secure':
        return '🟢 آمن';
      case 'attention':
        return '🟡 يحتاج انتباه';
      default:
        return '🔴 خطر';
    }
  }
}

/** Devices the user marked as trusted (stored locally, never uploaded). */
export function unknownDevices(devices: DeviceRecord[], trustedMacs: string[] = []): DeviceRecord[] {
  const trusted = new Set(trustedMacs.map((mac) => mac.toLowerCase()));
  return devices.filter((device) => device.isUnknown && !trusted.has(device.mac));
}
