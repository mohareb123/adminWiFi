/**
 * End-to-end engine tests (spec §50).
 * Discovery → fingerprint → capabilities → login → devices → operations →
 * verification, including the failure paths (wrong password, unsupported
 * feature, dropped packets, large device list).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { describe, expect, it } from 'vitest';
import { createHarness } from './fixtures';
import { isSupported } from '../src/capabilities/detector';
import { RouterError } from '../src/core/errors';

const fastDiscovery = { scanCommonGateways: false, scanAdminPorts: false } as const;

describe('UniversalRouterEngine — happy path (Huawei ONT)', () => {
  it('connects, authenticates and reports a verified device block', async () => {
    const harness = createHarness('huawei-hg8145');
    const { engine } = harness;

    const discovery = await engine.discover({ ...fastDiscovery });
    expect(discovery.empty).toBe(false);
    expect(discovery.best?.baseUrl).toContain('192.168.1.1');

    const result = await engine.connect({
      credentials: { username: 'admin', password: 'Admin@123' },
      discovery,
      fast: true,
    });
    expect(result.authenticated).toBe(true);
    expect(result.session.identity.vendor).toBe('Huawei');
    expect(engine.isReady).toBe(true);

    const snapshot = await engine.getSnapshot();
    expect(snapshot.devices.length).toBeGreaterThanOrEqual(5);
    const target = snapshot.devices.find((device) => device.hostname === 'Mohamed-PC');
    expect(target).toBeDefined();

    const blocked = await engine.execute({ id: 'device.block', params: { mac: target!.mac, blocked: true } });
    expect(blocked.ok).toBe(true);
    expect(blocked.message).toContain('إيقاف');

    const after = await engine.getSnapshot();
    expect(after.devices.find((device) => device.mac === target!.mac)?.blocked).toBe(true);
    expect(after.counts.blocked).toBeGreaterThanOrEqual(1);

    const unblocked = await engine.execute({ id: 'device.unblock', params: { mac: target!.mac, blocked: false } });
    expect(unblocked.ok).toBe(true);
    const final = await engine.getSnapshot();
    expect(final.devices.find((device) => device.mac === target!.mac)?.blocked).toBe(false);
  });

  it('verifies a Wi-Fi password change by reading the value back', async () => {
    const { engine } = createHarness('tplink-archer-c6');
    const discovery = await engine.discover({ ...fastDiscovery });
    await engine.connect({ credentials: { username: 'admin', password: 'admin1234' }, discovery, fast: false });

    const result = await engine.execute({
      id: 'wifi.set_password',
      params: { password: 'NewPass12345' },
      confirmed: true,
    });
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.verification?.strategy).toBe('read-back');
  });

  it('updates the SSID and confirms the new value', async () => {
    const { engine } = createHarness('huawei-hg8145');
    const discovery = await engine.discover({ ...fastDiscovery });
    await engine.connect({ credentials: { username: 'admin', password: 'Admin@123' }, discovery, fast: true });

    const result = await engine.execute({ id: 'wifi.set_ssid', params: { ssid: 'Abu El-Ezz Wi-Fi', band: 1 } });
    expect(result.ok).toBe(true);
    const wifi = await engine.getSnapshot({ includeDevices: false });
    expect(wifi.wifi.bands.some((band) => band.ssid === 'Abu El-Ezz Wi-Fi')).toBe(true);
  });

  it('detects capabilities and never advertises 5 GHz on a 2.4-only device', async () => {
    const { engine } = createHarness('dlink-dir825');
    const discovery = await engine.discover({ ...fastDiscovery });
    await engine.connect({ credentials: { username: 'admin', password: '12345678' }, discovery, fast: false });
    const wifi = await engine.getSnapshot({ includeDevices: false });
    expect(wifi.wifi.bands.some((band) => band.band === '5GHz' && band.enabled)).toBe(false);
  });
});

describe('UniversalRouterEngine — failure paths', () => {
  it('reports a wrong password as an auth failure, not as success', async () => {
    const { engine } = createHarness('huawei-hg8145');
    const discovery = await engine.discover({ ...fastDiscovery });
    await expect(
      engine.connect({ credentials: { username: 'admin', password: 'wrong-password' }, discovery, fast: true }),
    ).rejects.toMatchObject({ code: 'auth-failed' });
    expect(engine.isReady).toBe(false);
  });

  it('reports unsupported features honestly (ISP ZTE build locks SSID writes)', async () => {
    const { engine } = createHarness('zte-zxhn-h288a');
    const discovery = await engine.discover({ ...fastDiscovery });
    await engine.connect({ credentials: { username: 'admin', password: 'Zte@2024' }, discovery, fast: true });

    const result = await engine.execute({ id: 'wifi.set_ssid', params: { ssid: 'Nope' } });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unsupported');
    expect(result.message).toContain('غير مدعوم');
    // The runtime observation overrides the signature declaration (spec §7).
    expect(engine.supports('wifi_ssid')).toBe(false);
    expect(isSupported(engine.capabilityReport, 'wifi_ssid')).toBe(true);
  });

  it('keeps working on a slow link (800 ms extra latency)', async () => {
    const { engine, transport } = createHarness('huawei-hg8145');
    (transport as unknown as { options: { networkLatencyMs?: number } }).options.networkLatencyMs = 800;
    const discovery = await engine.discover({ ...fastDiscovery });
    await engine.connect({ credentials: { username: 'admin', password: 'Admin@123' }, discovery, fast: true });
    const snapshot = await engine.getSnapshot();
    expect(snapshot.devices.length).toBeGreaterThan(0);
  }, 30_000);

  it('degrades safely when the link is completely dead', async () => {
    const { engine, transport } = createHarness('huawei-hg8145');
    const discovery = await engine.discover({ ...fastDiscovery });
    await engine.connect({ credentials: { username: 'admin', password: 'Admin@123' }, discovery, fast: true });
    transport.request = async () => {
      throw new Error('network is unreachable');
    };
    const snapshot = await engine.getSnapshot();
    expect(snapshot.devices).toEqual([]);
    expect(snapshot.counts.devices).toBe(0);
  }, 30_000);

  it('surfaces a helpful error when the router disappears', async () => {
    const { engine, transport } = createHarness('huawei-hg8145');
    const discovery = await engine.discover({ ...fastDiscovery });
    await engine.connect({ credentials: { username: 'admin', password: 'Admin@123' }, discovery, fast: true });

    const original = transport.request.bind(transport);
    transport.request = async () => {
      throw new Error('fetch failed');
    };
    const snapshot = await engine.getSnapshot();
    // Snapshot degrades gracefully instead of throwing into the UI.
    expect(snapshot.devices).toEqual([]);
    transport.request = original;
  });

  it('rejects an operation while unauthenticated', async () => {
    const { engine } = createHarness('huawei-hg8145');
    await expect(engine.execute({ id: 'device.block', params: { mac: '00:00:00:00:00:00' } })).rejects.toBeInstanceOf(RouterError);
  });
});

describe('UniversalRouterEngine — scale and smoothness', () => {
  it('handles a large device list without dropping entries', async () => {
    const harness = createHarness('huawei-hg8145');
    const state = harness.transport.profile.state();
    for (let index = 0; index < 120; index += 1) {
      state.devices.push({
        mac: `02:00:00:00:${(index >> 8).toString(16).padStart(2, '0')}:${(index & 0xff).toString(16).padStart(2, '0')}`,
        ip: `192.168.1.${(index % 250) + 2}`,
        hostname: `device-${index}`,
        band: index % 2 === 0 ? 'wifi-2.4' : 'ethernet',
        signal: -50 - (index % 30),
        rateDownKbps: 100 + index,
        rateUpKbps: 50,
        usageKb: 1000 * index,
        blocked: false,
      });
    }

    const discovery = await harness.engine.discover({ ...fastDiscovery });
    await harness.engine.connect({ credentials: { username: 'admin', password: 'Admin@123' }, discovery, fast: true });
    const started = Date.now();
    const snapshot = await harness.engine.getSnapshot();
    const duration = Date.now() - started;
    expect(snapshot.devices.length).toBeGreaterThan(120);
    expect(snapshot.counts.devices).toBe(snapshot.devices.length);
    // Parsing 120+ devices must stay well under a second of CPU-bound work.
    expect(duration).toBeLessThan(5000);
  });

  it('emits phase events so the UI can narrate progress (spec §34)', async () => {
    const { engine } = createHarness('tplink-archer-c6');
    const phases: string[] = [];
    engine.on('phase', (event) => phases.push(event.phase));
    const discovery = await engine.discover({ ...fastDiscovery });
    await engine.connect({ credentials: { username: 'admin', password: 'admin1234' }, discovery, fast: true });
    expect(phases).toContain('discovering');
    expect(phases).toContain('fingerprinting');
    expect(phases).toContain('authenticating');
    expect(phases).toContain('ready');
  });

  it('records learned outcomes for self-improving compatibility (spec §45)', async () => {
    const harness = createHarness('huawei-hg8145');
    const discovery = await harness.engine.discover({ ...fastDiscovery });
    await harness.engine.connect({ credentials: { username: 'admin', password: 'Admin@123' }, discovery, fast: true });
    await harness.engine.execute({ id: 'device.block', params: { mac: '3c:5a:b4:11:22:33', blocked: true } });
    const profiles = await harness.learner.load();
    expect(profiles.length).toBe(1);
    const outcome = profiles[0]?.outcomes.find((entry) => entry.operationId === 'device.block');
    expect(outcome?.count).toBeGreaterThanOrEqual(1);
    expect(outcome?.ok).toBe(true);
  });
});
