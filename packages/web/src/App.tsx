/**
 * Application shell.
 *
 * Flow: splash → one-time developer welcome → connect (if not authenticated) →
 * tabbed workspace (Simple Mode panels + Advanced Mode). The router tab bar is
 * the only navigation; every panel is lazy-mounted on first visit and kept
 * mounted afterwards so switching is instant and never re-fetches (spec §48).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { Suspense, lazy, startTransition, useEffect, useMemo, useState } from 'react';
import { COPY } from './core/i18n';
import { store, useAppState } from './core/store';
import { initPreferences, useVisuals, VisualProvider } from './visual/provider';
import { AboutPanel } from './components/AboutPanel';
import { ConnectScreen } from './components/ConnectScreen';
import { DeveloperWelcome } from './components/DeveloperWelcome';
import { DevicesPanel } from './components/DevicesPanel';
import { SecurityPanel } from './components/SecurityPanel';
import { SimpleDashboard } from './components/SimpleDashboard';
import { SpeedTestPanel } from './components/SpeedTestPanel';
import { Splash } from './components/Splash';
import { TopBar } from './components/TopBar';
import { WifiPanel } from './components/WifiPanel';
import { Badge, Button, Callout, Modal, Panel, TabBar, Toggle } from './components/ui';

// Heavy panels are code-split: the first paint never waits for the graphs.
const NetworkMap = lazy(() => import('./components/NetworkMap').then((module) => ({ default: module.NetworkMap })));
const BandwidthPanel = lazy(() => import('./components/BandwidthPanel').then((module) => ({ default: module.BandwidthPanel })));
const AssistantPanel = lazy(() => import('./components/AssistantPanel').then((module) => ({ default: module.AssistantPanel })));
const AdvancedPanel = lazy(() => import('./components/AdvancedPanel').then((module) => ({ default: module.AdvancedPanel })));
const NotificationsPanel = lazy(() => import('./components/NotificationsPanel').then((module) => ({ default: module.NotificationsPanel })));

export type PanelId =
  | 'home'
  | 'devices'
  | 'wifi'
  | 'map'
  | 'bandwidth'
  | 'speed'
  | 'security'
  | 'assistant'
  | 'advanced'
  | 'settings'
  | 'about';

const TABS: Array<{ id: PanelId; label: string; icon: string }> = [
  { id: 'home', label: COPY.nav.home, icon: '🏠' },
  { id: 'devices', label: COPY.nav.devices, icon: '📱' },
  { id: 'wifi', label: COPY.nav.wifi, icon: '📡' },
  { id: 'map', label: COPY.nav.map, icon: '🕸️' },
  { id: 'bandwidth', label: COPY.nav.bandwidth, icon: '📈' },
  { id: 'speed', label: COPY.nav.speed, icon: '🚀' },
  { id: 'security', label: COPY.nav.security, icon: '🛡️' },
  { id: 'assistant', label: COPY.nav.assistant, icon: '🤖' },
  { id: 'advanced', label: COPY.nav.advanced, icon: '🧪' },
  { id: 'settings', label: COPY.nav.settings, icon: '⚙️' },
  { id: 'about', label: COPY.nav.about, icon: 'ℹ️' },
];

export function App(): JSX.Element {
  return (
    <VisualProvider>
      <AppShell />
    </VisualProvider>
  );
}

function AppShell(): JSX.Element {
  const bridge = useAppState((state) => state.bridge);
  const host = useAppState((state) => state.host);
  const session = useAppState((state) => state.session);
  const snapshot = useAppState((state) => state.snapshot);
  const notifications = useAppState((state) => state.notifications);
  const { preferences, update } = useVisuals();

  const [splashGone, setSplashGone] = useState(false);
  const [panel, setPanel] = useState<PanelId>('home');
  const [visited, setVisited] = useState<Set<PanelId>>(() => new Set<PanelId>(['home']));

  useEffect(() => {
    initPreferences();
    void store.bootstrap();
    // The splash is intentionally brief: it covers startup, not the network.
    const timer = window.setTimeout(() => setSplashGone(true), 900);
    return () => {
      window.clearTimeout(timer);
      store.dispose();
    };
  }, []);

  // Browser notifications mirror the in-app ones, only when the user allowed it.
  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const latest = notifications[0];
    if (!latest) return;
    if (latest.severity === 'info' && !preferences.notifyDevices) return;
    if (latest.code === 'speed-drop' && !preferences.notifySpeedDrop) return;
    if (latest.code === 'offline' && !preferences.notifyDisconnect) return;
    const key = `urlm.notified.${latest.id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    new Notification(latest.title, { body: latest.body, dir: 'rtl', lang: 'ar' });
  }, [notifications, preferences]);

  const navigate = (id: PanelId) => {
    // Panels are lazy-mounted: the transition keeps the current screen
    // interactive while the new chunk streams in (no suspended-input warning).
    startTransition(() => {
      setPanel(id);
      setVisited((previous) => (previous.has(id) ? previous : new Set(previous).add(id)));
    });
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  };

  const connectionState = useMemo(() => {
    if (bridge.status === 'offline') return 'offline';
    if (!session && host.mode === 'real') return 'connect';
    if (!session && host.mode === 'simulated' && !snapshot) return 'connect';
    return 'ready';
  }, [bridge.status, session, host.mode, snapshot]);

  if (!splashGone) return <Splash />;

  if (!preferences.developerWelcomeSeen) {
    return <DeveloperWelcome onContinue={() => update({ developerWelcomeSeen: true })} />;
  }

  return (
    <div className="shell">
      <TopBar onOpenSettings={() => navigate('settings')} />

      {bridge.status === 'offline' && (
        <Callout
          tone="crit"
          icon="🔌"
          actions={
            <Button size="sm" onClick={() => void store.bootstrap()}>
              {COPY.common.retry}
            </Button>
          }
        >
          <b>{COPY.errors.bridgeOffline}</b>
          <div className="small">{bridge.lastErrorAr ?? COPY.errors.bridgeOfflineHint}</div>
          <div className="small faint">{COPY.errors.bridgeHint}</div>
        </Callout>
      )}

      <Suspense fallback={<Panel><div className="skeleton" style={{ height: 180 }} /></Panel>}>
        {connectionState === 'connect' && bridge.status !== 'offline' ? (
          <ConnectScreen />
        ) : (
          <>
            {visited.has('home') && (
              <section hidden={panel !== 'home'}>
                <SimpleDashboard onNavigate={navigate} />
              </section>
            )}
            {visited.has('devices') && (
              <section hidden={panel !== 'devices'}>
                <DevicesPanel />
              </section>
            )}
            {visited.has('wifi') && (
              <section hidden={panel !== 'wifi'}>
                <WifiPanel />
              </section>
            )}
            {visited.has('map') && (
              <section hidden={panel !== 'map'}>
                <Panel title={COPY.nav.map} icon="🕸️">
                  <NetworkMap />
                </Panel>
              </section>
            )}
            {visited.has('bandwidth') && (
              <section hidden={panel !== 'bandwidth'}>
                <BandwidthPanel />
              </section>
            )}
            {visited.has('speed') && (
              <section hidden={panel !== 'speed'}>
                <SpeedTestPanel />
              </section>
            )}
            {visited.has('security') && (
              <section hidden={panel !== 'security'}>
                <SecurityPanel />
              </section>
            )}
            {visited.has('assistant') && (
              <section hidden={panel !== 'assistant'}>
                <AssistantPanel />
              </section>
            )}
            {visited.has('advanced') && (
              <section hidden={panel !== 'advanced'}>
                <AdvancedPanel />
              </section>
            )}
            {visited.has('settings') && (
              <section hidden={panel !== 'settings'}>
                <SettingsPanel />
              </section>
            )}
            {visited.has('about') && (
              <section hidden={panel !== 'about'}>
                <AboutPanel />
              </section>
            )}
          </>
        )}
      </Suspense>

      {/* Its own boundary: toasts must never suspend the screen behind them. */}
      <Suspense fallback={null}>
        <NotificationsPanel onNavigate={navigate} />
      </Suspense>
      <TabBar tabs={TABS} active={panel} onChange={(id) => navigate(id as PanelId)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SettingsPanel(): JSX.Element {
  const { preferences, update, fps } = useVisuals();
  const [askingPermission, setAskingPermission] = useState(false);

  return (
    <div className="stack">
      <Panel title={COPY.settings.title} icon="⚙️" actions={<Badge tone="dim">{fps} FPS</Badge>}>
        <div className="stack">
          <Toggle checked={preferences.largeText} onChange={(value) => update({ largeText: value })} label={COPY.settings.largeText} hint="نصوص ومساحات لمس أكبر" />
          <Toggle checked={preferences.highContrast} onChange={(value) => update({ highContrast: value })} label={COPY.settings.highContrast} />
          <Toggle checked={preferences.reducedMotion} onChange={(value) => update({ reducedMotion: value })} label={COPY.settings.reducedMotion} />
          <Toggle checked={preferences.lowData} onChange={(value) => update({ lowData: value })} label={COPY.settings.lowData} hint="يوقف الرسوم المتحركة والجزيئات لتوفير البطارية والبيانات" />
        </div>
      </Panel>

      <Panel title={COPY.settings.notifications} icon="🔔">
        <div className="stack">
          <Toggle checked={preferences.notifyDevices} onChange={(value) => update({ notifyDevices: value })} label="جهاز جديد يتصل بالشبكة" />
          <Toggle checked={preferences.notifySpeedDrop} onChange={(value) => update({ notifySpeedDrop: value })} label="انخفاض السرعة" />
          <Toggle checked={preferences.notifyDisconnect} onChange={(value) => update({ notifyDisconnect: value })} label="انقطاع الإنترنت" />
          <Toggle checked={preferences.notifySmartFix} onChange={(value) => update({ notifySmartFix: value })} label="تطبيق إصلاح ذكي" />
          <div className="row row-wrap">
            <Button
              size="sm"
              onClick={() => {
                setAskingPermission(true);
                if (typeof Notification !== 'undefined') {
                  void Notification.requestPermission().finally(() => setAskingPermission(false));
                }
              }}
              loading={askingPermission}
            >
              تفعيل تنبيهات النظام
            </Button>
            <span className="tiny faint">اختياري — التنبيهات داخل التطبيق تعمل دائمًا.</span>
          </div>
        </div>
      </Panel>

      <Panel title={COPY.settings.privacy} icon="🔒">
        <p className="small muted">{COPY.settings.privacyBody}</p>
      </Panel>

      <Modal open={false} title="" onClose={() => undefined}>
        <span />
      </Modal>
    </div>
  );
}
