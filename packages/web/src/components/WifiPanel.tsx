/**
 * Wi-Fi Manager + Wi-Fi Analyzer (spec §17/§18).
 *
 * Every control is capability-gated: a band that the router does not have is
 * never shown, and an operation that is not supported shows
 * «غير مدعوم على هذا الراوتر» instead of a button that would fail. All writes
 * go through the engine, which verifies the result before reporting success.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { useEffect, useState } from 'react';
import type { WifiBandInfo } from '@urlm/core';
import { COPY } from '../core/i18n';
import { store, useAppState } from '../core/store';
import { Badge, Button, Callout, Field, Modal, Panel, Toggle } from './ui';
import { ChannelChart } from './charts';

const CHANNELS_24 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const CHANNELS_5 = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 149, 153, 157, 161, 165];

export function WifiPanel(): JSX.Element {
  const snapshot = useAppState((state) => state.snapshot);
  const capabilities = useAppState((state) => state.describe?.capabilities ?? []);
  const neighbors = useAppState((state) => state.neighbors);
  const scanning = useAppState((state) => state.neighborsLoading);
  const [editing, setEditing] = useState<WifiBandInfo | null>(null);

  const bands = snapshot?.wifi.bands ?? [];
  const supports = (id: string) => capabilities.find((entry) => entry.id === id)?.supported === 'yes';

  useEffect(() => {
    void store.loadNeighbors().catch(() => undefined);
  }, []);

  const bestChannel = (band: '2.4GHz' | '5GHz'): number | undefined => {
    if (!neighbors || neighbors.length === 0) return undefined;
    const list = band === '2.4GHz' ? CHANNELS_24 : CHANNELS_5;
    const load = new Map<number, number>();
    for (const neighbor of neighbors.filter((entry) => entry.band === band)) {
      for (const channel of [neighbor.channel - 1, neighbor.channel, neighbor.channel + 1]) {
        load.set(channel, (load.get(channel) ?? 0) + 1);
      }
    }
    let best = list[0] as number;
    let bestLoad = Number.POSITIVE_INFINITY;
    for (const channel of list) {
      const value = load.get(channel) ?? 0;
      if (value < bestLoad) {
        bestLoad = value;
        best = channel;
      }
    }
    return best;
  };

  return (
    <div className="stack">
      <Panel
        title={COPY.wifi.title}
        icon="📡"
        actions={
          <>
            {!supports('wifi_ssid') && <Badge tone="dim">{COPY.capabilities.notSupported}: اسم الشبكة</Badge>}
            {!supports('wifi_5ghz') && <Badge tone="dim">{COPY.wifi.hidden5}</Badge>}
          </>
        }
      >
        <p className="panel-sub">{COPY.wifi.hint}</p>
        <div className="band-grid" style={{ marginTop: 12 }}>
          {bands.map((band) => (
            <BandCard
              key={band.band}
              band={band}
              onEdit={() => setEditing(band)}
              capable={{
                ssid: supports('wifi_ssid'),
                password: supports('wifi_password'),
                channel: true,
                security: true,
                guest: supports('wifi_guest'),
              }}
            />
          ))}
          {bands.length === 0 && <Callout tone="info">لم نتمكن من قراءة إعدادات الواي فاي من هذا الراوتر بعد.</Callout>}
        </div>
      </Panel>

      <Panel
        title={COPY.wifi.analyzer}
        icon="📊"
        actions={
          <Button size="sm" loading={scanning} onClick={() => void store.loadNeighbors(true)}>
            {COPY.loading.scanning}
          </Button>
        }
      >
        {neighbors && neighbors.length > 0 ? (
          <>
            <div className="row row-wrap" style={{ marginBottom: 10 }}>
              <Badge>{neighbors.length} {COPY.wifi.neighbors}</Badge>
              {bestChannel('2.4GHz') !== undefined && (
                <Badge tone="ok">
                  {COPY.wifi.bestChannel} 2.4GHz: {bestChannel('2.4GHz')}
                </Badge>
              )}
              {bestChannel('5GHz') !== undefined && (
                <Badge tone="ok">
                  {COPY.wifi.bestChannel} 5GHz: {bestChannel('5GHz')}
                </Badge>
              )}
            </div>
            <ChannelChart
              neighbors={neighbors}
              mine={bands.filter((band) => band.enabled).map((band) => ({ channel: band.channel ?? 0, band: band.band }))}
            />
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>{COPY.wifi.ssid}</th>
                    <th>{COPY.wifi.band}</th>
                    <th>{COPY.wifi.channel}</th>
                    <th>{COPY.wifi.signal}</th>
                    <th>{COPY.wifi.security}</th>
                  </tr>
                </thead>
                <tbody>
                  {neighbors.map((neighbor, index) => (
                    <tr key={`${neighbor.bssid ?? neighbor.ssid}-${index}`}>
                      <td className="ellipsis" style={{ maxWidth: 180 }}>{neighbor.ssid || '—'}</td>
                      <td>{neighbor.band}</td>
                      <td className="num">{neighbor.channel}</td>
                      <td className="num">{neighbor.signalDbm} dBm</td>
                      <td className="ltr">{neighbor.security ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <Callout tone="info" icon="🔍">
            {scanning ? COPY.loading.scanning : 'لم يتم العثور على شبكات مجاورة — بعض الراوترات لا توفّر هذه القراءة.'}
          </Callout>
        )}
      </Panel>

      {editing && <BandEditor band={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function BandCard({
  band,
  capable,
  onEdit,
}: {
  band: WifiBandInfo;
  capable: { ssid: boolean; password: boolean; channel: boolean; security: boolean; guest: boolean };
  onEdit: () => void;
}): JSX.Element {
  return (
    <div className={`band-card ${band.enabled ? '' : 'is-off'}`}>
      <div className="row">
        <Badge tone={band.band === '5GHz' ? 'demo' : 'default'}>{band.band}</Badge>
        <Badge tone={band.enabled ? 'ok' : 'dim'}>{band.enabled ? COPY.wifi.enabled : COPY.common.off}</Badge>
        {band.guest && <Badge tone="warn">{COPY.wifi.guest}</Badge>}
        <div className="spacer" />
        <span className="tiny faint">{band.clients ?? 0} جهاز</span>
      </div>

      <div>
        <div className="tile-label">{COPY.wifi.ssid}</div>
        <div className="bold">{band.ssid || '—'}</div>
      </div>

      <div className="device-stats">
        <span>
          {COPY.wifi.channel}
          <b className="num">{band.channel ?? '—'}</b>
        </span>
        <span>
          {COPY.wifi.security}
          <b className="ltr">{band.security ?? '—'}</b>
        </span>
        <span>
          {COPY.wifi.password}
          <b className="ltr">••••••••</b>
        </span>
      </div>

      <div className="device-actions">
        <Button size="sm" onClick={onEdit} disabled={!capable.ssid && !capable.password && !capable.channel}>
          تعديل الإعدادات
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function BandEditor({ band, onClose }: { band: WifiBandInfo; onClose: () => void }): JSX.Element {
  const capabilities = useAppState((state) => state.describe?.capabilities ?? []);
  const [ssid, setSsid] = useState(band.ssid);
  const [password, setPassword] = useState('');
  const [channel, setChannel] = useState(band.channel ?? 6);
  const [security, setSecurity] = useState(band.security ?? 'WPA2-PSK');
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'warn' | 'crit'; text: string } | null>(null);

  const supports = (id: string) => capabilities.find((entry) => entry.id === id)?.supported === 'yes';
  const channels = band.band === '5GHz' ? CHANNELS_5 : CHANNELS_24;

  const run = async (label: string, id: Parameters<typeof store.execute>[0], params: Record<string, unknown>) => {
    setBusy(label);
    setFeedback(null);
    try {
      const result = await store.execute(id, params, true);
      setFeedback({
        tone: result.ok ? (result.verified ? 'ok' : 'warn') : 'crit',
        text: `${result.message}${result.verified ? ' ✓' : ''}`,
      });
    } catch (error) {
      setFeedback({ tone: 'crit', text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const bandIndex = band.band === '5GHz' ? 2 : 1;

  return (
    <Modal open title={`${COPY.wifi.title} — ${band.band}`} onClose={onClose}>
      <div className="stack">
        <Field label={COPY.wifi.ssid} hint={!supports('wifi_ssid') ? COPY.capabilities.notSupported : undefined}>
          <div className="row">
            <input className="input" value={ssid} onChange={(event) => setSsid(event.target.value)} disabled={!supports('wifi_ssid')} />
            <Button
              loading={busy === 'ssid'}
              disabled={!supports('wifi_ssid') || !ssid || ssid === band.ssid}
              onClick={() => void run('ssid', 'wifi.set_ssid', { ssid, band: bandIndex })}
            >
              {COPY.common.save}
            </Button>
          </div>
        </Field>

        <Field
          label={COPY.wifi.password}
          hint="كلمة مرور من 8 أحرف على الأقل"
          error={password && password.length < 8 ? 'الباسورد قصير جدًا (أقل من 8 أحرف).' : undefined}
        >
          <div className="row">
            <input
              className="input input-ltr"
              type="password"
              value={password}
              placeholder="••••••••"
              onChange={(event) => setPassword(event.target.value)}
              disabled={!supports('wifi_password')}
            />
            <Button
              variant="primary"
              loading={busy === 'password'}
              disabled={!supports('wifi_password') || password.length < 8}
              onClick={() => void run('password', 'wifi.set_password', { password, band: bandIndex })}
            >
              {COPY.common.save}
            </Button>
          </div>
        </Field>

        <Field label={COPY.wifi.channel} hint="اختر قناة أقل ازدحامًا من تحليل الشبكات المجاورة">
          <div className="row">
            <select className="select" value={channel} onChange={(event) => setChannel(Number(event.target.value))}>
              {channels.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <Button
              loading={busy === 'channel'}
              disabled={channel === band.channel}
              onClick={() => void run('channel', 'wifi.set_channel', { channel, band: bandIndex })}
            >
              {COPY.common.save}
            </Button>
          </div>
        </Field>

        <Field label={COPY.wifi.security}>
          <div className="row">
            <select className="select" value={security} onChange={(event) => setSecurity(event.target.value)}>
              <option value="WPA2-PSK">WPA2-PSK</option>
              <option value="WPA3-PSK">WPA3-PSK</option>
              <option value="WPA/WPA2-PSK">WPA/WPA2</option>
              <option value="WPA2-Enterprise">WPA2-Enterprise</option>
              <option value="WPA-PSK">WPA</option>
              <option value="open">مفتوحة (غير موصى بها)</option>
            </select>
            <Button
              loading={busy === 'security'}
              disabled={security === band.security}
              onClick={() => void run('security', 'wifi.set_security', { security, band: bandIndex })}
            >
              {COPY.common.save}
            </Button>
          </div>
          {security === 'open' && (
            <Callout tone="crit" icon="⚠️">
              الشبكة المفتوحة تعني أن أي شخص قريب يمكنه الدخول واستخدام الإنترنت.
            </Callout>
          )}
        </Field>

        <Toggle
          checked={band.enabled}
          onChange={(value) => void run('enabled', 'wifi.set_band_enabled', { enabled: value, band: bandIndex })}
          label={`${COPY.wifi.enabled} (${band.band})`}
          hint="إيقاف النطاق يقطع الأجهزة المتصلة عليه"
        />

        {band.guest !== undefined && (
          <Toggle
            checked={Boolean(band.guest)}
            onChange={(value) => void run('guest', 'wifi.set_guest_network', { enabled: value, band: bandIndex })}
            label={COPY.wifi.guest}
            hint={supports('wifi_guest') ? 'شبكة منفصلة للزوار بدون الوصول لشبكتك' : COPY.capabilities.notSupported}
            disabled={!supports('wifi_guest')}
          />
        )}

        {feedback && <Callout tone={feedback.tone}>{feedback.text}</Callout>}
      </div>
    </Modal>
  );
}
