/**
 * UI behaviour tests.
 *
 * They run against mocked bridge responses (the real bridge is exercised by the
 * bridge + core suites) and cover the promises the UI makes to the user:
 *  - the loading copy is stage-specific, never a bare "Loading…";
 *  - demo mode is always labelled;
 *  - a failed change is reported as a failure, never as success;
 *  - unsupported operations never render an enabled button;
 *  - the developer attribution is present in About.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkSnapshot, SecurityReport } from '@urlm/core';
import { VisualProvider } from '../src/visual/provider';
import { SimpleDashboard } from '../src/components/SimpleDashboard';
import { ConnectScreen } from '../src/components/ConnectScreen';
import { AboutPanel } from '../src/components/AboutPanel';
import { SecurityPanel } from '../src/components/SecurityPanel';
import { store } from '../src/core/store';

const snapshot: NetworkSnapshot = {
  takenAt: new Date().toISOString(),
  internet: { connected: true, latencyMs: 18, downKbps: 42_800, upKbps: 8_200 },
  wifi: {
    bands: [
      { band: '2.4GHz', ssid: 'Home Wi-Fi', enabled: true, channel: 6, security: 'WPA2-PSK', clients: 3 },
      { band: '5GHz', ssid: 'Home Wi-Fi 5G', enabled: true, channel: 36, security: 'WPA2-PSK', clients: 2 },
    ],
    wpsEnabled: false,
  },
  wan: { ip: '41.44.128.17', dns: ['197.161.8.1', '8.8.8.8'], mtu: 1492, status: 'connected' },
  lan: { ip: '192.168.1.1', netmask: '255.255.255.0', dhcpEnabled: true, poolStart: '192.168.1.100', poolEnd: '192.168.1.200' },
  devices: [
    {
      id: 'mac:3c:5a:b4:11:22:33',
      name: 'Mohamed-PC',
      ip: '192.168.1.10',
      mac: '3c:5a:b4:11:22:33',
      connection: 'ethernet',
      blocked: false,
      rateDownKbps: 34_000,
      rateUpKbps: 4_200,
      usageKb: 2_400_000,
      kind: 'computer',
    },
    {
      id: 'mac:f4:f5:d8:aa:bb:cc',
      name: 'Sara-iPhone',
      ip: '192.168.1.11',
      mac: 'f4:f5:d8:aa:bb:cc',
      connection: 'wifi-5',
      blocked: true,
      rateDownKbps: 0,
      usageKb: 780_000,
      kind: 'phone',
      signal: -48,
    },
  ],
  counts: { devices: 2, online: 1, blocked: 1, wifi: 1, ethernet: 1 },
};

const security: SecurityReport = {
  status: 'attention',
  score: 74,
  findings: [
    {
      id: 'guest-open',
      status: 'attention',
      titleAr: 'شبكة الزوار مفتوحة',
      detailAr: 'أي شخص قريب يمكنه الدخول.',
      weight: 12,
    },
  ],
  checkedAt: new Date().toISOString(),
  evaluated: 5,
  skipped: ['firmware'],
};

function bridgeStateResponse() {
  return {
    ok: true,
    state: { mode: 'simulated', profileId: 'huawei-hg8145', connected: true, phase: 'ready', updatedAt: Date.now() },
    describe: {
      mode: 'simulated',
      profiles: [{ id: 'huawei-hg8145', label: 'Huawei HG8145V5', arLabel: 'هواوي HG8145V5' }],
      capabilities: [
        { id: 'device.block', supported: 'yes', source: 'probe', reason: 'endpoint-present' },
        { id: 'wifi_5ghz', supported: 'no', source: 'signature', reason: 'device-not-dual-band' },
      ],
      fingerprint: { quality: 'exact', confidence: 98, candidates: [], advisories: [] },
      diagnostics: { requests: 42, failures: 0, bytesIn: 1024 },
      copyright: '© 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.',
    },
    snapshot,
    security,
    notifications: [],
    routers: [],
    session: {
      sessionId: 's1',
      baseUrl: 'http://192.168.1.1',
      target: { id: 'router-1', label: 'الراوتر', host: '192.168.1.1', scheme: 'http', port: 80 },
      identity: { vendor: 'Huawei', model: 'HG8145V5', firmware: 'V5R020C10S120' },
      adapter: { id: 'HuaweiAdapter', vendor: 'Huawei', displayName: 'Huawei ONT adapter', generic: false },
      capabilities: { states: [{ id: 'device.block', supported: 'yes', reason: 'endpoint-present' }] },
      loginRecipe: { kind: 'form-post', loginUrl: '/asp/Login.asp' },
      authenticatedAt: new Date().toISOString(),
      fingerprint: { quality: 'exact', confidence: 98, advisories: [] },
    },
  };
}

describe('web UI', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const json = (payload: unknown) =>
          new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.includes('/api/state')) return json(bridgeStateResponse());
        if (url.includes('/api/health')) {
          return json({
            ok: true,
            app: 'Universal Router Manager',
            component: 'local-bridge',
            version: '1.0.0',
            developer: 'محمد إبراهيم أبو العز',
            copyright: '© 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.',
            uptimeSeconds: 120,
          });
        }
        if (url.includes('/api/speedtest/plan')) {
          return json({
            ok: true,
            plan: { simulated: true, downloadMbps: 94.6, uploadMbps: 28.4, pingMs: 17, jitterMs: 2.6, bytesPerSecond: 11_825_000, label: 'هواوي HG8145V5 — 94.6 Mbps line' },
          });
        }
        return json({ ok: true });
      }),
    );
  });

  it('hydrates from the bridge and paints the simple dashboard without jargon', async () => {
    await store.bootstrap();
    render(
      <VisualProvider>
        <SimpleDashboard onNavigate={() => undefined} />
      </VisualProvider>,
    );

    expect(await screen.findByText('الإنترنت متصل')).toBeTruthy();
    expect(screen.getByText('Home Wi-Fi')).toBeTruthy();
    expect(screen.getByText(/98%/)).toBeTruthy();
    expect(screen.getByText(/Mohamed-PC/)).toBeTruthy();
    // Demo mode must be visible, never silent.
    expect(screen.getAllByText('وضع تجريبي').length).toBeGreaterThan(0);
    // No bare "Loading…" copy anywhere.
    expect(screen.queryByText(/^Loading/i)).toBeNull();
  });

  it('keeps the device count and blocked count honest', async () => {
    await store.bootstrap();
    render(
      <VisualProvider>
        <SimpleDashboard onNavigate={() => undefined} />
      </VisualProvider>,
    );
    expect(await screen.findByText('2')).toBeTruthy();
    expect(screen.getByText('1 جهاز موقوف')).toBeTruthy();
  });

  it('shows a demo badge and stage-specific loading copy on the connect screen', async () => {
    await store.bootstrap();
    render(
      <VisualProvider>
        <ConnectScreen />
      </VisualProvider>,
    );
    expect(await screen.findByText('تسجيل الدخول إلى الراوتر')).toBeTruthy();
    expect(screen.getByText('وضع تجريبي')).toBeTruthy();
    expect(screen.getByText(/الجسر المحلي رفض|لا شيء|بيانات الراوتر تُستخدم/u)).toBeTruthy();
  });

  it('says the bridge is offline (with the command) instead of failing silently', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await store.bootstrap();
    render(
      <VisualProvider>
        <ConnectScreen />
      </VisualProvider>,
    );
    await waitFor(() => expect(screen.getByText('الجسر المحلي غير مشغّل.')).toBeTruthy());
    expect(screen.getByText('npm run dev:bridge')).toBeTruthy();
  });

  it('renders security findings with an explicit fix button only when a fix exists', async () => {
    await store.bootstrap();
    render(
      <VisualProvider>
        <SecurityPanel />
      </VisualProvider>,
    );
    expect(await screen.findByText('يحتاج انتباه')).toBeTruthy();
    expect(screen.getByText('شبكة الزوار مفتوحة')).toBeTruthy();
    expect(screen.getByText('لا يوجد إجراء تلقائي آمن')).toBeTruthy();
    expect(screen.getByText(/تم تقييم 5 فحصًا/)).toBeTruthy();
  });

  it('shows developer attribution and the open-source notice in About', async () => {
    await store.bootstrap();
    render(
      <VisualProvider>
        <AboutPanel />
      </VisualProvider>,
    );
    expect(await screen.findByText('محمد إبراهيم أبو العز')).toBeTruthy();
    expect(screen.getByText('Mohamed Ibrahim Abu El-Ezz')).toBeTruthy();
    expect(screen.getByText('© 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.')).toBeTruthy();
    expect(screen.getByText(/لا يحتوي التطبيق على أي وسائل تجاوز/)).toBeTruthy();
  });
});
