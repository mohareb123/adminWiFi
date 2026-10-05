/**
 * Smart Assistant + Smart Fix + Security Center tests (spec §12/§13/§22/§50).
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { describe, expect, it } from 'vitest';
import { SmartAssistant } from '../src/smart_fix/assistant';
import { SmartFixEngine } from '../src/smart_fix/engine';
import { SecurityCenter } from '../src/security/center';
import { requiresConfirmation, confirmationFor, riskOf } from '../src/core/notifications';
import { createHarness } from './fixtures';
import type { DeviceRecord, WifiState } from '../src/core/types';

const devices: DeviceRecord[] = [
  { id: 'a', name: 'Mohamed-PC', ip: '192.168.1.10', mac: '3c:5a:b4:11:22:33', connection: 'ethernet', blocked: false, rateDownKbps: 34_000, rateUpKbps: 4_000 },
  { id: 'b', name: 'Sara-iPhone', ip: '192.168.1.11', mac: 'f4:f5:d8:aa:bb:cc', connection: 'wifi-5', blocked: false, rateDownKbps: 2_000, rateUpKbps: 400 },
];

const context = {
  devices,
  support: () => true,
  canLimitPerDevice: true,
  totalDownKbps: 40_000,
  totalUpKbps: 5_000,
  latencyMs: 24,
  band: '2.4GHz' as const,
};

describe('SmartAssistant (Arabic intent parsing)', () => {
  it('understands "النت بطيء"', () => {
    const reply = SmartAssistant.respond('النت بطيء جدا', context);
    expect(reply.intent).toBe('slow-internet');
    expect(reply.plan || reply.messageAr).toBeTruthy();
  });

  it('understands "عايز اقفل النت عن الجهاز ده"', () => {
    const reply = SmartAssistant.respond('عايز أقفل النت عن الجهاز ده', context);
    expect(reply.intent).toBe('block-device');
    expect(reply.plan?.actions[0]?.operationId).toBe('device.block');
    // "الجهاز ده" resolves to the busiest device.
    expect(reply.plan?.actions[0]?.params.mac).toBe('3c:5a:b4:11:22:33');
  });

  it('understands "مين اكتر جهاز بيستهلك النت"', () => {
    const reply = SmartAssistant.respond('مين أكتر جهاز بيستهلك النت؟', context);
    expect(reply.intent).toBe('top-consumer');
    expect(reply.messageAr).toContain('Mohamed-PC');
  });

  it('understands "عايز اغير باسورد الواي فاي" and asks for the value', () => {
    const reply = SmartAssistant.respond('عايز أغير باسورد الواي فاي', context);
    expect(reply.intent).toBe('change-wifi-password');
    expect(reply.askFor?.key).toBe('newPassword');
    expect(reply.plan?.requiresInput?.type).toBe('password');
  });

  it('asks which device when the request is ambiguous', () => {
    const reply = SmartAssistant.respond('اقفل النت عن جهاز', { ...context, devices: devices.map((device) => ({ ...device, name: `dev-${device.id}` })) });
    expect(reply.intent).toBe('block-device');
    expect(reply.choices?.length).toBeGreaterThan(0);
  });

  it('never reaches for a device the router cannot block', () => {
    const reply = SmartAssistant.respond('اقفل النت عن Mohamed-PC', { ...context, support: () => false });
    expect(reply.plan?.actions).toHaveLength(0);
    expect(reply.plan?.recommendationAr).toContain('غير مدعوم');
  });

  it('falls back to a helpful message for unknown text', () => {
    const reply = SmartAssistant.respond('ازيك عامل ايه', context);
    expect(['unknown', 'help']).toContain(reply.intent);
    expect(reply.messageAr.length).toBeGreaterThan(10);
  });

  it('answers status questions with live numbers', () => {
    const reply = SmartAssistant.respond('ملخص حالة الشبكة', context);
    expect(reply.intent).toBe('status');
    expect(reply.messageAr).toContain('الأجهزة المتصلة');
  });
});

describe('SmartFixEngine (detect → analyze → recommend → apply → verify)', () => {
  it('recommends a bandwidth limit for the top consumer', () => {
    const plans = SmartFixEngine.analyze({
      intent: 'slow-internet',
      totalDownKbps: 40_000,
      deviceUsage: [{ mac: devices[0]!.mac, name: 'Mohamed-PC', downKbps: 34_000, upKbps: 4_000, sharePercent: 72 }],
      support: () => true,
      canLimitPerDevice: true,
    });
    const plan = SmartFixEngine.best(plans);
    expect(plan?.analysisAr).toContain('72');
    expect(plan?.actions[0]?.operationId).toBe('device.limit_bandwidth');
  });

  it('applies a real change through the engine and verifies it', async () => {
    const harness = createHarness('huawei-hg8145');
    const discovery = await harness.engine.discover({ scanCommonGateways: false, scanAdminPorts: false });
    await harness.engine.connect({ credentials: { username: 'admin', password: 'Admin@123' }, discovery, fast: true });

    const plan = SmartFixEngine.analyze({
      intent: 'block-device',
      targetMac: '28:6c:07:44:55:66',
      targetName: 'Xiaomi-TV',
      support: (capability) => harness.engine.supports(capability as never),
      canLimitPerDevice: true,
    })[0]!;

    const stages: string[] = [];
    const result = await SmartFixEngine.apply(plan, harness.engine, (steps) =>
      stages.push(steps.map((step) => `${step.stage}:${step.status}`).join(',')),
    );
    expect(result.ok).toBe(true);
    expect(result.messageAr).toContain('تم');

    const snapshot = await harness.engine.getSnapshot();
    expect(snapshot.devices.find((device) => device.mac === '28:6c:07:44:55:66')?.blocked).toBe(true);
    expect(stages.length).toBeGreaterThan(0);
  });

  it('reports failure (never fake success) when the router refuses the write', async () => {
    const harness = createHarness('zte-zxhn-h288a');
    const discovery = await harness.engine.discover({ scanCommonGateways: false, scanAdminPorts: false });
    await harness.engine.connect({ credentials: { username: 'admin', password: 'Zte@2024' }, discovery, fast: true });

    const plan = SmartFixEngine.analyze({
      intent: 'change-wifi-password',
      newPassword: 'BrandNewPass99',
      band: '2.4GHz',
      support: () => true,
      canLimitPerDevice: false,
    })[0]!;

    const result = await SmartFixEngine.apply(plan, harness.engine);
    // The device accepted the write but exposes no read-back — we must say so
    // instead of claiming a verified success.
    expect(result.verified).toBe(false);
    expect(result.messageAr).toMatch(/لا يسمح بقراءة|لا يوفّر قراءة|لم يتم/);

    // A write this firmware genuinely does not have is reported as unsupported.
    const unsupported = await harness.engine.execute({ id: 'wifi.set_ssid', params: { ssid: 'X', band: '2.4GHz' } });
    expect(unsupported.reason).toBe('unsupported');
    expect(unsupported.message).toContain('غير مدعوم');
  });

  it('only recommends a channel change that reduces real congestion', () => {
    const plans = SmartFixEngine.analyze({
      intent: 'channel-congestion',
      band: '2.4GHz',
      currentChannel: 6,
      neighbors: [
        { ssid: 'A', band: '2.4GHz', channel: 6, signalDbm: -45 },
        { ssid: 'B', band: '2.4GHz', channel: 6, signalDbm: -50 },
        { ssid: 'C', band: '2.4GHz', channel: 11, signalDbm: -80 },
      ],
      support: () => true,
      canLimitPerDevice: false,
    });
    const channel = plans[0]?.actions[0]?.params.channel;
    expect([1, 11]).toContain(channel);
    expect(channel).not.toBe(6);
  });
});

describe('Smart confirmation policy (spec §46/§47)', () => {
  it('does not nag for trivial reversible actions', () => {
    expect(requiresConfirmation('device.rename')).toBe(false);
    expect(requiresConfirmation('device.block')).toBe(false);
    expect(requiresConfirmation('wifi.set_channel')).toBe(false);
  });

  it('demands confirmation for disruptive operations', () => {
    expect(requiresConfirmation('router.reboot')).toBe(true);
    expect(riskOf('router.restore')).toBe('critical');
    expect(riskOf('port_forward.add')).toBe('high');
    const dialog = confirmationFor('router.reboot', 'إعادة تشغيل الراوتر ستقطع الاتصال مؤقتًا.');
    expect(dialog.cancelLabel).toBe('إلغاء');
    expect(dialog.confirmLabel).toBe('تنفيذ');
  });
});

describe('SecurityCenter (spec §22)', () => {
  const baseWifi = (security: string): WifiState => ({
    bands: [{ band: '2.4GHz', ssid: 'Home', enabled: true, channel: 6, security }],
  });

  it('flags an open network as critical', () => {
    const report = SecurityCenter.analyze({
      snapshot: {
        takenAt: new Date().toISOString(),
        internet: { connected: true },
        wifi: baseWifi('open'),
        wan: { dns: [] },
        lan: { ip: '192.168.1.1', netmask: '255.255.255.0', dhcpEnabled: true },
        devices: [],
        counts: { devices: 0, online: 0, blocked: 0, wifi: 0, ethernet: 0 },
      },
    });
    expect(report.status).toBe('critical');
    expect(report.findings.some((finding) => finding.id.startsWith('wifi-weak'))).toBe(true);
    expect(report.score).toBeLessThan(80);
  });

  it('reports a WPA2 network as secure', () => {
    const report = SecurityCenter.analyze({
      snapshot: {
        takenAt: new Date().toISOString(),
        internet: { connected: true },
        wifi: baseWifi('WPA2-PSK'),
        wan: { dns: [] },
        lan: { ip: '192.168.1.1', netmask: '255.255.255.0', dhcpEnabled: true },
        devices: devices.map((device) => ({ ...device, isUnknown: false })),
        counts: { devices: 2, online: 2, blocked: 0, wifi: 1, ethernet: 1 },
      },
      fingerprint: { identity: { vendor: 'Huawei', model: 'HG8145V5', firmware: 'V5R020' } } as never,
    });
    expect(report.status).toBe('secure');
    expect(SecurityCenter.statusLabel(report.status)).toContain('آمن');
  });

  it('never suggests bypassing anything — only owner-side fixes', () => {
    const report = SecurityCenter.analyze({});
    for (const finding of report.findings) {
      if (!finding.fix) continue;
      expect(finding.fix.operationId).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });
});
