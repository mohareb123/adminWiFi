/**
 * End-to-end-ish flows with the bridge mocked at the HTTP/SSE boundary:
 * welcome → dashboard, the smart assistant (online + offline fallback), the
 * speed-test stream, and the demo/real mode switch.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { AssistantPanel } from '../src/components/AssistantPanel';
import { SpeedTestPanel } from '../src/components/SpeedTestPanel';
import { VisualProvider } from '../src/visual/provider';
import { store } from '../src/core/store';
import { EventSourceStub } from './setup';
import { matchIntent, ASSISTANT_SUGGESTIONS } from '../src/core/assistant-intents';

const stateResponse = {
  ok: true,
  state: { mode: 'simulated', profileId: 'huawei-hg8145', connected: false, phase: 'idle', updatedAt: Date.now() },
  session: null,
  describe: {
    mode: 'simulated',
    profiles: [{ id: 'huawei-hg8145', label: 'Huawei HG8145V5', arLabel: 'هواوي HG8145V5' }],
    capabilities: [],
    diagnostics: {},
    copyright: '© 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.',
  },
  snapshot: null,
  security: null,
  notifications: [],
  routers: [],
};

function jsonFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const respond = (payload: unknown) =>
      new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    for (const [fragment, payload] of Object.entries(overrides)) {
      if (url.includes(fragment)) return respond(payload);
    }
    if (url.includes('/api/state')) return respond(stateResponse);
    if (url.includes('/api/health')) {
      return respond({ ok: true, app: 'Universal Router Manager', component: 'local-bridge', version: '1.0.0', developer: 'x', copyright: 'y', uptimeSeconds: 5 });
    }
    if (url.includes('/api/speedtest/plan')) {
      return respond({ ok: true, plan: { simulated: true, downloadMbps: 42.8, uploadMbps: 8.2, pingMs: 24, jitterMs: 3, bytesPerSecond: 5_350_000, label: 'demo' } });
    }
    if (url.includes('/api/assistant')) {
      return respond({
        ok: true,
        reply: {
          intent: 'top-consumer',
          messageAr: 'أكثر جهاز استهلاكًا الآن هو Mohamed-PC بنسبة 72% من إجمالي الشبكة.',
          confidence: 0.9,
        },
      });
    }
    if (init?.method === 'POST') return respond({ ok: true, mode: 'simulated' });
    return respond({ ok: true });
  });
}

describe('assistant intents (Arabic)', () => {
  it('understands the four examples from the specification', () => {
    expect(matchIntent('النت بطيء').intent).toBe('slow-internet');
    expect(matchIntent('عايز أقفل النت عن الجهاز ده').intent).toBe('block-device');
    expect(matchIntent('مين أكتر جهاز بيستهلك النت؟').intent).toBe('top-consumer');
    expect(matchIntent('عايز أغير باسورد الواي فاي').intent).toBe('change-wifi-password');
  });

  it('normalises alef/ya/ta-marbuta variants and keeps suggestions useful', () => {
    expect(matchIntent('النت بطئ جدا').intent).toBe('slow-internet');
    expect(ASSISTANT_SUGGESTIONS.length).toBeGreaterThanOrEqual(6);
    expect(ASSISTANT_SUGGESTIONS.every((entry) => entry.phrase.length > 0)).toBe(true);
  });

  it('returns unknown for unrelated text instead of guessing', () => {
    expect(matchIntent('مرحبا كيف حالكم').intent).toBe('unknown');
  });
});

describe('application flow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', jsonFetch());
    localStorage.clear();
  });

  it('shows the splash, then the one-time developer welcome, then the app', async () => {
    render(<App />);
    expect(screen.getAllByText(/مدير الراوتر الشامل/).length).toBeGreaterThan(0);

    fireEvent.click(await screen.findByText('متابعة', {}, { timeout: 4000 }));
    await waitFor(() => expect(screen.getByText('تسجيل الدخول إلى الراوتر')).toBeTruthy());
  }, 20_000);

  it('labels demo mode and lets the user open a demo profile picker', async () => {
    localStorage.setItem('urlm.preferences.v1', JSON.stringify({ developerWelcomeSeen: true }));
    render(<App />);
    await waitFor(() => expect(screen.getAllByText('وضع تجريبي').length).toBeGreaterThan(0));
    expect(await screen.findByText('نماذج تجريبية للعرض')).toBeTruthy();
    expect(screen.getByText('هواوي HG8145V5')).toBeTruthy();
  }, 20_000);
});

describe('smart assistant panel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', jsonFetch());
  });

  it('sends the Arabic question to the bridge and renders the real answer', async () => {
    render(
      <VisualProvider>
        <AssistantPanel />
      </VisualProvider>,
    );
    const input = screen.getByPlaceholderText(/اكتب مشكلتك/);
    fireEvent.change(input, { target: { value: 'مين أكتر جهاز بيستهلك النت؟' } });
    fireEvent.click(screen.getByText('إرسال'));
    expect(await screen.findByText(/Mohamed-PC/)).toBeTruthy();
  }, 20_000);

  it('falls back to local guidance when the bridge is unreachable — and says so', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    render(
      <VisualProvider>
        <AssistantPanel />
      </VisualProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/اكتب مشكلتك/), { target: { value: 'النت بطيء' } });
    fireEvent.click(screen.getByText('إرسال'));
    const bubble = await screen.findByText(/تعذّر الوصول إلى المحرك/);
    expect(bubble.textContent).toMatch(/إعادة تشغيل الراوتر/);
  }, 20_000);
});

describe('speed test panel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', jsonFetch());
    EventSourceStub.instances.length = 0;
  });

  it('streams PING → DOWN → UP samples and shows the final measured result', async () => {
    render(
      <VisualProvider>
        <SpeedTestPanel />
      </VisualProvider>,
    );

    fireEvent.click(screen.getByText('ابدأ الاختبار'));
    const stream = EventSourceStub.instances.at(-1);
    expect(stream?.url).toContain('/api/speedtest/stream');

    stream!.emit('phase', { phase: 'ping' });
    stream!.emit('sample', { phase: 'ping', value: 22 });
    stream!.emit('phase', { phase: 'down' });
    stream!.emit('sample', { phase: 'down', value: 38.4 });
    stream!.emit('phase', { phase: 'up' });
    stream!.emit('sample', { phase: 'up', value: 7.9 });
    stream!.emit('result', {
      pingMs: 21,
      jitterMs: 2.4,
      downloadMbps: 42.8,
      uploadMbps: 8.2,
      serverLabel: 'Demo network profile',
      testedAt: new Date().toISOString(),
      method: 'simulated',
      samplesDown: [38.4, 42.8],
      samplesUp: [7.9],
      durationMs: 3200,
    });

    await waitFor(() => expect(screen.getAllByText('42.8').length).toBeGreaterThan(0));
    expect(screen.getAllByText('8.2').length).toBeGreaterThan(0);
    // The measurement method is always disclosed.
    expect(screen.getByText(/وضع تجريبي \(خط وهمي بمعايير واقعية\)/)).toBeTruthy();
  }, 20_000);
});

describe('store hydration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', jsonFetch());
  });

  it('exposes bridge health, plan and connection state after bootstrap', async () => {
    await store.bootstrap();
    const state = store.getState();
    expect(state.bridge.status).toBe('ready');
    expect(state.host.mode).toBe('simulated');
    expect(state.speedPlan.simulated).toBe(true);
    expect(state.speedPlan.downloadMbps).toBe(42.8);
  });
});
