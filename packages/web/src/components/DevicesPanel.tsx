/**
 * Device Manager (spec §15).
 *
 * Cards show name, IP, MAC, connection, signal and live usage, with real
 * actions: pause/resume internet, speed limit, rename, details. Actions are only
 * rendered when the capability is genuinely supported — otherwise the card says
 * «غير مدعوم على هذا الراوتر» instead of showing a button that would fail.
 *
 * Large lists stay smooth: cards use `content-visibility: auto`, and the list
 * renders in windows of 36 with a "show more" step (no unbounded element count).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { useMemo, useState } from 'react';
import type { DeviceRecord, OperationId } from '@urlm/core';
import { COPY } from '../core/i18n';
import { connectionLabel, formatKb, formatKbps, shortMac, SIGNAL_LABEL, signalLevel, signalPercent, sortDevices } from '../core/format';
import { store, useAppState } from '../core/store';
import { Badge, Button, Callout, EmptyState, Field, Modal, Panel, SignalBars, Toggle } from './ui';

const WINDOW_SIZE = 36;

export function DevicesPanel(): JSX.Element {
  const snapshot = useAppState((state) => state.snapshot);
  const capabilities = useAppState((state) => state.describe?.capabilities ?? []);
  const [sort, setSort] = useState<'name' | 'usage' | 'signal' | 'connection'>('usage');
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(WINDOW_SIZE);
  const [selected, setSelected] = useState<DeviceRecord | null>(null);

  const devices = useMemo(() => {
    const list = snapshot?.devices ?? [];
    const filtered = query
      ? list.filter((device) =>
          `${device.name} ${device.hostname ?? ''} ${device.ip} ${device.mac}`.toLowerCase().includes(query.toLowerCase()),
        )
      : list;
    return sortDevices(filtered, sort);
  }, [snapshot, sort, query]);

  const supports = (id: OperationId): { ok: boolean; reason?: string } => {
    const entry = capabilities.find((capability) => capability.id === id);
    return { ok: entry?.supported === 'yes', reason: entry?.reason };
  };

  const canBlock = supports('device.block').ok || supports('device.unblock').ok;
  const canLimit = supports('device.limit_bandwidth').ok;
  const canRename = supports('device.rename').ok;

  const windowed = devices.slice(0, visible);
  const online = devices.filter((device) => !device.blocked).length;

  return (
    <div className="stack">
      <Panel
        title={COPY.devices.title}
        icon="📱"
        actions={
          <>
            <Badge tone="ok">{COPY.devices.count(devices.length, online)}</Badge>
            <select className="select" style={{ width: 150 }} value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
              <option value="usage">{COPY.devices.sortBy}: الاستهلاك</option>
              <option value="name">{COPY.devices.sortBy}: الاسم</option>
              <option value="signal">{COPY.devices.sortBy}: الإشارة</option>
              <option value="connection">{COPY.devices.sortBy}: الاتصال</option>
            </select>
          </>
        }
      >
        <div className="row row-wrap" style={{ marginBottom: 12 }}>
          <input
            className="input"
            style={{ maxWidth: 320 }}
            placeholder="ابحث بالاسم أو العنوان…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {!canBlock && <Badge tone="dim">{COPY.capabilities.notSupported}: إيقاف الإنترنت</Badge>}
          {!canLimit && <Badge tone="dim">{COPY.capabilities.notSupported}: تحديد السرعة</Badge>}
        </div>

        {windowed.length === 0 ? (
          <EmptyState emoji="🛰️" title={COPY.devices.empty} hint="سيظهر كل جهاز يتصل بالشبكة هنا خلال ثوانٍ." />
        ) : (
          <>
            <div className="device-grid">
              {windowed.map((device) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  canBlock={canBlock}
                  canLimit={canLimit}
                  canRename={canRename}
                  onOpen={() => setSelected(device)}
                />
              ))}
            </div>
            {visible < devices.length && (
              <div className="center" style={{ marginTop: 14 }}>
                <Button variant="ghost" onClick={() => setVisible((value) => value + WINDOW_SIZE)}>
                  عرض المزيد ({devices.length - visible})
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>

      {selected && <DeviceDialog device={selected} onClose={() => setSelected(null)} canLimit={canLimit} canRename={canRename} canBlock={canBlock} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DeviceCard({
  device,
  canBlock,
  canLimit,
  canRename,
  onOpen,
}: {
  device: DeviceRecord;
  canBlock: boolean;
  canLimit: boolean;
  canRename: boolean;
  onOpen: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const level = signalLevel(device.signal);
  const percent = signalPercent(device.signal);

  const toggleBlock = async () => {
    setBusy(true);
    try {
      await store.execute(device.blocked ? 'device.unblock' : 'device.block', {
        mac: device.mac,
        blocked: !device.blocked,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`device-card ${device.blocked ? 'is-blocked' : ''}`}>
      <header className="device-head">
        <div className="device-avatar" aria-hidden="true">{iconFor(device)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="device-name ellipsis">
            {device.name}
            {device.isUnknown && <Badge tone="warn">{COPY.devices.unknownDevice}</Badge>}
          </div>
          <div className="device-sub ltr">{device.ip || '—'}</div>
        </div>
        {device.blocked ? <Badge tone="crit">{COPY.devices.paused}</Badge> : <Badge tone="ok">{COPY.devices.online}</Badge>}
      </header>

      <div className="device-stats">
        <span>
          {COPY.devices.connection}
          <b>{connectionLabel(device.connection)}</b>
        </span>
        <span>
          {COPY.devices.usage}
          <b>{formatKbps(device.rateDownKbps) === '—' ? formatKb(device.usageKb) : formatKbps(device.rateDownKbps)}</b>
        </span>
        <span>
          {COPY.devices.signal}
          <b className="row" style={{ gap: 6 }}>
            <SignalBars percent={percent} level={level} />
            {SIGNAL_LABEL[level]}
          </b>
        </span>
      </div>

      <div className="device-actions">
        {canBlock && (
          <Button size="sm" variant={device.blocked ? 'mint' : 'danger'} onClick={() => void toggleBlock()} loading={busy}>
            {device.blocked ? COPY.devices.actions.resume : COPY.devices.actions.pause}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onOpen}>
          {COPY.devices.actions.info}
        </Button>
      </div>
      {!canBlock && <div className="tiny faint">{COPY.capabilities.notSupported}</div>}
      {canLimit && !canRename ? null : null}
    </article>
  );
}

/* ------------------------------------------------------------------ */

function DeviceDialog({
  device,
  onClose,
  canBlock,
  canLimit,
  canRename,
}: {
  device: DeviceRecord;
  onClose: () => void;
  canBlock: boolean;
  canLimit: boolean;
  canRename: boolean;
}): JSX.Element {
  const [name, setName] = useState(device.name);
  const [limitMbps, setLimitMbps] = useState(Math.round((device.limitKbpsDown ?? 0) / 1000) || 5);
  const [hasLimit, setHasLimit] = useState(Boolean(device.limitKbpsDown));
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'warn' | 'crit'; text: string } | null>(null);

  const run = async (label: string, id: OperationId, params: Record<string, unknown>) => {
    setBusy(label);
    setFeedback(null);
    try {
      const result = await store.execute(id, params);
      setFeedback({
        tone: result.ok ? (result.verified ? 'ok' : 'warn') : 'crit',
        text: `${result.message}${result.verified ? ` — ${COPY.verification.verified}` : ''}`,
      });
    } catch (error) {
      setFeedback({ tone: 'crit', text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open title={`${COPY.devices.actions.info}: ${device.name}`} onClose={onClose}>
      <dl className="kv">
        <dt>{COPY.devices.name}</dt>
        <dd className="ltr">{device.hostname ?? device.name}</dd>
        <dt>{COPY.devices.ip}</dt>
        <dd className="ltr">{device.ip || '—'}</dd>
        <dt>{COPY.devices.mac}</dt>
        <dd className="ltr">{device.mac}</dd>
        <dt>{COPY.devices.connection}</dt>
        <dd>{connectionLabel(device.connection)}</dd>
        <dt>{COPY.devices.signal}</dt>
        <dd>{SIGNAL_LABEL[signalLevel(device.signal)]}</dd>
        <dt>{COPY.wifi.band}</dt>
        <dd>{device.vendor ?? '—'}</dd>
      </dl>

      <div className="divider" />

      <div className="stack">
        <Field label={COPY.devices.actions.rename}>
          <div className="row">
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} disabled={!canRename} />
            <Button
              disabled={!canRename || name === device.name}
              loading={busy === 'rename'}
              onClick={() => void run('rename', 'device.rename', { mac: device.mac, name })}
            >
              {COPY.common.save}
            </Button>
          </div>
        </Field>

        <div>
          <Toggle
            checked={hasLimit}
            onChange={setHasLimit}
            disabled={!canLimit}
            label={COPY.devices.actions.limit}
            hint={canLimit ? 'يُطبَّق على مستوى الراوتر نفسه' : COPY.capabilities.notSupported}
          />
          {hasLimit && canLimit && (
            <div className="row" style={{ marginTop: 8 }}>
              <input
                className="input input-ltr"
                type="number"
                min={1}
                max={1000}
                value={limitMbps}
                onChange={(event) => setLimitMbps(Number(event.target.value))}
              />
              <span className="muted small">Mbps</span>
              <Button
                variant="primary"
                loading={busy === 'limit'}
                onClick={() => void run('limit', 'device.limit_bandwidth', { mac: device.mac, downKbps: limitMbps * 1000, upKbps: limitMbps * 1000 })}
              >
                {COPY.advanced.save}
              </Button>
            </div>
          )}
        </div>

        <div className="row row-wrap">
          {canBlock && (
            <Button
              variant={device.blocked ? 'mint' : 'danger'}
              loading={busy === 'block'}
              onClick={() => void run('block', device.blocked ? 'device.unblock' : 'device.block', { mac: device.mac, blocked: !device.blocked })}
            >
              {device.blocked ? COPY.devices.actions.resume : COPY.devices.actions.pause}
            </Button>
          )}
          {canLimit && device.limitKbpsDown ? (
            <Button variant="ghost" loading={busy === 'clear'} onClick={() => void run('clear', 'device.clear_limit', { mac: device.mac })}>
              {COPY.devices.actions.clearLimit}
            </Button>
          ) : null}
        </div>

        {feedback && <Callout tone={feedback.tone}>{feedback.text}</Callout>}

        <details className="code-block">
          <summary style={{ cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '0.8rem', direction: 'rtl' }}>
            {COPY.advanced.rawRequest}
          </summary>
          <div style={{ marginTop: 8 }}>
            {shortMac(device.mac)} · {device.connection} · {device.kind ?? 'unknown'}
          </div>
        </details>
      </div>
    </Modal>
  );
}

function iconFor(device: DeviceRecord): string {
  switch (device.kind) {
    case 'phone':
      return '📱';
    case 'computer':
      return '💻';
    case 'tv':
      return '📺';
    case 'tablet':
      return '📲';
    case 'console':
      return '🎮';
    case 'camera':
      return '📷';
    case 'printer':
      return '🖨️';
    case 'iot':
      return '💡';
    default:
      return device.blocked ? '⛔' : '🔌';
  }
}
