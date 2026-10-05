/**
 * Simple Mode dashboard (spec §10): everything a normal user needs in one
 * screen — is the internet up, how fast, how many devices, the Wi-Fi name, and
 * four big buttons. No jargon, no raw numbers without meaning.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { Suspense, lazy } from 'react';
import { COPY } from '../core/i18n';
import { formatKbps, formatMs, formatRelative, topConsumer } from '../core/format';
import { store, useAppState } from '../core/store';
import { useAnimatedNumber } from '../visual/provider';
import { LiveGraph } from './charts';
import { Badge, Button, Callout, Panel, Tile } from './ui';
import type { PanelId } from '../App';

// The animated map is a separate chunk: the dashboard paints before it arrives.
const NetworkMap = lazy(() => import('./NetworkMap').then((module) => ({ default: module.NetworkMap })));

export function SimpleDashboard({ onNavigate }: { onNavigate: (panel: PanelId) => void }): JSX.Element {
  const snapshot = useAppState((state) => state.snapshot);
  const samples = useAppState((state) => state.samples);
  const monitor = useAppState((state) => state.monitor);
  const session = useAppState((state) => state.session);
  const security = useAppState((state) => state.security);
  const speedPlan = useAppState((state) => state.speedPlan);

  const latest = samples[samples.length - 1];
  const downKbps = latest?.downKbps ?? 0;
  const upKbps = latest?.upKbps ?? 0;
  const latency = monitor[monitor.length - 1]?.latencyMs ?? null;
  const online = monitor.length > 0 ? monitor[monitor.length - 1]!.online : Boolean(snapshot?.internet.connected);

  const down = useAnimatedNumber(downKbps / 1000);
  const up = useAnimatedNumber(upKbps / 1000);

  const devices = snapshot?.devices ?? [];
  const blockedCount = devices.filter((device) => device.blocked).length;
  const heavy = topConsumer(devices);
  const bands = snapshot?.wifi?.bands ?? [];
  const mainBand = bands.find((band) => band.enabled) ?? bands[0];
  const confidence = session?.fingerprint.confidence ?? 0;

  return (
    <div className="stack">
      <div className="hero">
        <Panel>
          <div className="hero-status">
            <div className={`status-orb ${online ? 'is-on' : 'is-off'}`} aria-hidden="true">
              {online ? '🌐' : '🚫'}
            </div>
            <div style={{ flex: 1 }}>
              <div className="hero-title">{online ? COPY.simple.internetConnected : COPY.simple.internetDown}</div>
              <div className="hero-meta">
                <span>
                  {session?.identity.vendor ?? '—'} {session?.identity.model ?? ''}
                </span>
                <Badge tone={confidence >= 80 ? 'ok' : confidence >= 55 ? 'warn' : 'dim'}>
                  {COPY.simple.confidence} {confidence}%
                </Badge>
                {security && (
                  <Badge tone={security.status === 'secure' ? 'ok' : security.status === 'attention' ? 'warn' : 'crit'}>
                    {COPY.security.title}:{' '}
                    {security.status === 'secure'
                      ? COPY.security.secure
                      : security.status === 'attention'
                        ? COPY.security.attention
                        : COPY.security.critical}
                  </Badge>
                )}
              </div>
              {confidence < 55 && (
                <Callout tone="warn" icon="🔎">
                  <b>{COPY.simple.limitedConfidence}</b>
                  <div className="small">{COPY.simple.limitedConfidenceHint}</div>
                </Callout>
              )}
            </div>
          </div>

          <div className="speed-pair" style={{ marginTop: 16 }}>
            <div>
              <div className="tile-label">
                <span className="arrow-down" aria-hidden="true">↓</span> {COPY.simple.download}
              </div>
              <div className="big-number num">
                {down.toFixed(1)}
                <span className="unit">Mbps</span>
              </div>
            </div>
            <div>
              <div className="tile-label">
                <span className="arrow-up" aria-hidden="true">↑</span> {COPY.simple.upload}
              </div>
              <div className="big-number num">
                {up.toFixed(1)}
                <span className="unit">Mbps</span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <LiveGraph
              values={samples.map((sample) => sample.downKbps)}
              label={COPY.bandwidth.live}
            />
            <div className="graph-legend">
              <span className="legend-key">
                <i style={{ background: '#4dd8ff' }} /> {COPY.bandwidth.download}
              </span>
              <span className="legend-key">
                <i style={{ background: '#34e5b0' }} /> {COPY.bandwidth.upload}
              </span>
              <span className="spacer" />
              {speedPlan.simulated && <Badge tone="demo">{COPY.connect.demoBadge}</Badge>}
            </div>
          </div>
        </Panel>

        <div className="stack">
          <div className="grid grid-tiles">
            <Tile
              label={COPY.simple.devicesConnected}
              icon="📱"
              value={devices.length}
              foot={blockedCount > 0 ? `${blockedCount} ${COPY.simple.blockedDevices}` : undefined}
              tone={blockedCount > 0 ? 'warn' : 'default'}
            />
            <Tile label={COPY.simple.ping} icon="📶" value={latency === null ? '—' : Math.round(latency)} unit="ms" />
            <Tile
              label={COPY.simple.wifiName}
              icon="📡"
              value={mainBand?.ssid ? <span style={{ fontSize: '1.05rem' }}>{mainBand.ssid}</span> : '—'}
              foot={mainBand ? `${mainBand.band} · CH ${mainBand.channel}` : undefined}
            />
            <Tile
              label={COPY.simple.topConsumer}
              icon="🔥"
              value={heavy ? <span style={{ fontSize: '1rem' }}>{heavy.name}</span> : COPY.simple.nothingHeavy}
              foot={heavy ? formatKbps(heavy.rateDownKbps ?? heavy.usageKb, { perSecond: false }) : undefined}
            />
          </div>

          <Panel title={COPY.simple.quickActions} icon="⚡">
            <div className="quick-grid">
              <button type="button" className="quick-action" onClick={() => onNavigate('devices')}>
                <span className="qa-icon" aria-hidden="true">📱</span>
                <span className="qa-label">{COPY.nav.devices}</span>
                <span className="qa-hint">{devices.length} جهاز متصل</span>
              </button>
              <button type="button" className="quick-action" onClick={() => onNavigate('wifi')}>
                <span className="qa-icon" aria-hidden="true">📡</span>
                <span className="qa-label">{COPY.nav.wifi}</span>
                <span className="qa-hint">{bands.filter((band) => band.enabled).length} شبكة مُفعّلة</span>
              </button>
              <button type="button" className="quick-action" onClick={() => onNavigate('speed')}>
                <span className="qa-icon" aria-hidden="true">🚀</span>
                <span className="qa-label">{COPY.simple.speedTest}</span>
                <span className="qa-hint">قياس حقيقي للتنزيل والرفع</span>
              </button>
              <button type="button" className="quick-action" onClick={() => onNavigate('assistant')}>
                <span className="qa-icon" aria-hidden="true">🤖</span>
                <span className="qa-label">{COPY.assistant.title}</span>
                <span className="qa-hint">اسأل بالعربي: «النت بطيء»</span>
              </button>
            </div>

            <div className="row row-wrap" style={{ marginTop: 12 }}>
              <Button onClick={() => onNavigate('devices')}>
                <span aria-hidden="true">🛠️</span> {COPY.simple.routerSettings}
              </Button>
              <Button variant="ghost" onClick={() => onNavigate('advanced')}>
                <span aria-hidden="true">🧪</span> {COPY.nav.advanced}
              </Button>
              <div className="spacer" />
              <span className="tiny faint">
                {COPY.simple.lastUpdate}: {formatRelative(snapshot?.takenAt ?? Date.now())}
              </span>
            </div>
          </Panel>
        </div>
      </div>

      <Panel
        title={COPY.nav.map}
        icon="🕸️"
        actions={<span className="tiny faint">اضغط على أي جهاز لعرض تفاصيله</span>}
      >
        <Suspense fallback={<div className="skeleton" style={{ height: 380, borderRadius: 'var(--radius-lg)' }} />}>
          <NetworkMap onSelectDevice={() => onNavigate('devices')} />
        </Suspense>
      </Panel>

      {monitor.length > 0 && (
        <Panel title="جودة الاتصال" icon="📈">
          <LiveGraph
            values={monitor.map((sample) => sample.latencyMs)}
            color="#ffb94d"
            fill="rgba(255,185,77,0.14)"
            label="زمن الاستجابة"
          />
          <div className="graph-legend">
            <span>آخر قياس: {latency === null ? '—' : formatMs(latency)}</span>
            <span className="spacer" />
            <span>{monitor.filter((sample) => !sample.online).length} انقطاع مسجّل</span>
          </div>
        </Panel>
      )}

      {!snapshot && (
        <Callout tone="info" icon="⏳">
          {COPY.loading.refreshing}
        </Callout>
      )}

      {/* Keeping this button here means the user always has one obvious way to
          re-read the router without hunting through the advanced panels. */}
      <div className="center">
        <Button variant="ghost" size="sm" onClick={() => void store.refreshSnapshot()}>
          {COPY.common.refresh}
        </Button>
      </div>
    </div>
  );
}
