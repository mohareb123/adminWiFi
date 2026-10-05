/**
 * Advanced Mode (spec §11) — the professional surface: QoS, DNS, DHCP,
 * firewall, port forwarding, WAN/LAN, logs, diagnostics, capabilities,
 * fingerprint/adapter evidence, multi-router, backup and performance.
 *
 * It renders the *same* engine as Simple Mode: nothing here bypasses
 * verification, and every write is capability-gated.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { useMemo, useState } from 'react';
import type { OperationId } from '@urlm/core';
import { COPY, OPERATION_LABELS, TECH } from '../core/i18n';
import { formatKb, formatKbps, formatRelative, formatUptime } from '../core/format';
import { store, useAppState } from '../core/store';
import { useVisuals } from '../visual/provider';
import { Badge, Button, Callout, CopyButton, Details, EmptyState, Field, KeyValue, Modal, Panel, Tile, Toggle } from './ui';

type TabId =
  | 'dns'
  | 'dhcp'
  | 'qos'
  | 'firewall'
  | 'forward'
  | 'wan'
  | 'logs'
  | 'capabilities'
  | 'fingerprint'
  | 'routers'
  | 'backup'
  | 'performance'
  | 'settings';

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'fingerprint', label: COPY.nav.fingerprint, icon: '🧬' },
  { id: 'capabilities', label: COPY.nav.capabilities, icon: '🧩' },
  { id: 'dns', label: COPY.nav.dns, icon: '🌍' },
  { id: 'dhcp', label: COPY.advanced.dhcp, icon: '🧾' },
  { id: 'qos', label: COPY.advanced.qos, icon: '🎚️' },
  { id: 'firewall', label: COPY.advanced.firewall, icon: '🧱' },
  { id: 'forward', label: COPY.advanced.portForward, icon: '🔀' },
  { id: 'wan', label: COPY.advanced.wan, icon: '🛰️' },
  { id: 'logs', label: COPY.advanced.logs, icon: '📜' },
  { id: 'routers', label: COPY.nav.routers, icon: '🗄️' },
  { id: 'backup', label: COPY.nav.backup, icon: '💾' },
  { id: 'performance', label: COPY.advanced.performance, icon: '⚙️' },
  { id: 'settings', label: COPY.nav.settings, icon: '🎛️' },
];

export function AdvancedPanel(): JSX.Element {
  const [tab, setTab] = useState<TabId>('fingerprint');

  return (
    <div className="stack">
      <Panel title={COPY.nav.advanced} icon="🧪" actions={<Badge tone="warn">إعدادات متقدمة — تُطبَّق بتحقق فعلي</Badge>}>
        <div className="advanced-tabs" role="tablist">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              className="seg"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
            >
              <span aria-hidden="true">{entry.icon}</span> {entry.label}
            </button>
          ))}
        </div>
      </Panel>

      {tab === 'fingerprint' && <FingerprintTab />}
      {tab === 'capabilities' && <CapabilitiesTab />}
      {tab === 'dns' && <DnsTab />}
      {tab === 'dhcp' && <DhcpTab />}
      {tab === 'qos' && <QosTab />}
      {tab === 'firewall' && <FirewallTab />}
      {tab === 'forward' && <ForwardTab />}
      {tab === 'wan' && <WanTab />}
      {tab === 'logs' && <LogsTab />}
      {tab === 'routers' && <RoutersTab />}
      {tab === 'backup' && <BackupTab />}
      {tab === 'performance' && <PerformanceTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * shared helpers
 * ------------------------------------------------------------------ */

function useCapability(): (id: OperationId) => { supported: boolean; reason?: string } {
  const capabilities = useAppState((state) => state.describe?.capabilities ?? []);
  return (id: OperationId) => {
    const entry = capabilities.find((capability) => capability.id === id);
    return { supported: entry?.supported === 'yes', reason: entry?.reason };
  };
}

function OperationRow({
  id,
  params,
  children,
  requireConfirm,
}: {
  id: OperationId;
  params: Record<string, unknown>;
  children: React.ReactNode;
  requireConfirm?: boolean;
}): JSX.Element {
  const can = useCapability();
  const capability = can(id);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'warn' | 'crit'; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (!capability.supported) {
    return (
      <div className="row row-wrap">
        {children}
        <Badge tone="dim">{COPY.capabilities.notSupported}</Badge>
      </div>
    );
  }

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const outcome = await store.execute(id, params, requireConfirm);
      setResult({
        tone: outcome.ok ? (outcome.verified ? 'ok' : 'warn') : 'crit',
        text: outcome.ok
          ? `${outcome.verified ? '✓ ' : ''}${outcome.message}`
          : `⚠️ لم يتم تطبيق التغيير. السبب: ${outcome.message}`,
      });
    } catch (error) {
      setResult({ tone: 'crit', text: `⚠️ ${(error as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="row row-wrap">
        {children}
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          onClick={() => (requireConfirm ? setConfirming(true) : void run())}
        >
          {COPY.advanced.save}
        </Button>
      </div>
      {result && <Callout tone={result.tone}>{result.text}</Callout>}
      <Modal
        open={confirming}
        title={COPY.common.danger}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {COPY.common.cancel}
            </Button>
            <Button variant="danger" onClick={() => { setConfirming(false); void run(); }}>
              {COPY.common.confirm}
            </Button>
          </>
        }
      >
        <p className="small">
          هذه العملية تُغيّر إعدادًا حساسًا على الراوتر. سيتم التحقق من النتيجة بعد التطبيق، وسنخبرك بالنتيجة الحقيقية.
        </p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * tabs
 * ------------------------------------------------------------------ */

function FingerprintTab(): JSX.Element {
  const session = useAppState((state) => state.session);
  const describe = useAppState((state) => state.describe);

  if (!session) return <Callout tone="info">{COPY.capabilities.empty}</Callout>;

  return (
    <div className="adv-grid">
      <Panel title={COPY.fingerprint.title} icon="🧬">
        <KeyValue
          entries={[
            [TECH.vendor, session.identity.vendor ?? '—'],
            [TECH.model, `${session.identity.model ?? '—'} ${session.identity.hardwareVersion ?? ''}`.trim()],
            [TECH.firmware, session.identity.firmware ?? '—'],
            ['الرقم التسلسلي', session.identity.serialNumber ?? '—'],
            [TECH.confidence, `${session.fingerprint.confidence}% (${session.fingerprint.quality})`],
            [TECH.adapter, `${session.adapter.displayName} (${session.adapter.id})`],
            [TECH.loginType, session.loginRecipe.kind],
            ['واجهة الإدارة', session.baseUrl],
            ['أُسِّس في', formatRelative(session.authenticatedAt)],
          ]}
        />
        {session.fingerprint.advisories.length > 0 && (
          <div className="stack" style={{ marginTop: 10 }}>
            {session.fingerprint.advisories.map((advisory) => (
              <Callout tone="warn" key={advisory}>
                {advisory}
              </Callout>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={`${COPY.fingerprint.candidates} / ${TECH.evidence}`} icon="🔬">
        {describe?.fingerprint ? (
          <div className="stack">
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>الاحتمال</th>
                    <th>{TECH.vendor}</th>
                    <th>{TECH.confidence}</th>
                    <th>{TECH.adapter}</th>
                  </tr>
                </thead>
                <tbody>
                  {describe.fingerprint.candidates.map((candidate) => (
                    <tr key={candidate.signatureId}>
                      <td className="ltr">{candidate.signatureId}</td>
                      <td>{candidate.vendor}</td>
                      <td className="num">{candidate.confidence}%</td>
                      <td className="ltr">{candidate.adapter}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {describe.diagnostics ? (
              <Details summary={COPY.advanced.rawRequest}>
                <pre style={{ margin: 0 }}>{JSON.stringify(describe.diagnostics, null, 2).slice(0, 3000)}</pre>
              </Details>
            ) : null}
          </div>
        ) : (
          <EmptyState emoji="🔬" title="لا توجد بيانات بصمة" />
        )}
      </Panel>
    </div>
  );
}

function CapabilitiesTab(): JSX.Element {
  const capabilities = useAppState((state) => state.describe?.capabilities ?? []);
  if (capabilities.length === 0) return <Callout tone="info">{COPY.capabilities.empty}</Callout>;
  return (
    <Panel title={COPY.capabilities.title} icon="🧩" actions={<Badge tone="dim">الفحص يعتمد على استجابة الراوتر الفعلية</Badge>}>
      <div className="matrix">
        {capabilities.map((capability) => (
          <div key={capability.id} className={`matrix-cell ${capability.supported === 'yes' ? 'yes' : capability.supported === 'no' ? 'no' : ''}`}>
            <span aria-hidden="true">{capability.supported === 'yes' ? '✓' : capability.supported === 'no' ? '✕' : '?'}</span>
            <span style={{ flex: 1 }}>{OPERATION_LABELS[capability.id as OperationId] ?? capability.id}</span>
            <span className="tiny faint ltr">{capability.source}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function DnsTab(): JSX.Element {
  const snapshot = useAppState((state) => state.snapshot);
  const [primary, setPrimary] = useState(snapshot?.wan.dns[0] ?? '');
  const [secondary, setSecondary] = useState(snapshot?.wan.dns[1] ?? '');

  const presets = [
    { label: COPY.dns.google, primary: '8.8.8.8', secondary: '8.8.4.4' },
    { label: COPY.dns.cloudflare, primary: '1.1.1.1', secondary: '1.0.0.1' },
    { label: COPY.dns.quad9, primary: '9.9.9.9', secondary: '149.112.112.112' },
  ];

  return (
    <Panel title={COPY.dns.title} icon="🌍">
      <KeyValue entries={[[COPY.dns.current, <span className="ltr">{(snapshot?.wan.dns ?? []).join(' · ') || '—'}</span>]]} />
      <div className="divider" />
      <div className="row row-wrap">
        {presets.map((preset) => (
          <Button
            key={preset.label}
            size="sm"
            variant="ghost"
            onClick={() => {
              setPrimary(preset.primary);
              setSecondary(preset.secondary);
            }}
          >
            {preset.label} <span className="ltr tiny faint">{preset.primary}</span>
          </Button>
        ))}
      </div>
      <div className="connect-grid" style={{ marginTop: 12 }}>
        <Field label={COPY.dns.primary}>
          <input className="input input-ltr" value={primary} onChange={(event) => setPrimary(event.target.value)} />
        </Field>
        <Field label={COPY.dns.secondary}>
          <input className="input input-ltr" value={secondary} onChange={(event) => setSecondary(event.target.value)} />
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <OperationRow id="dns.set" params={{ primary, secondary }} requireConfirm>
          <span className="small muted">{COPY.dns.confirmBody}</span>
        </OperationRow>
      </div>
    </Panel>
  );
}

function DhcpTab(): JSX.Element {
  const snapshot = useAppState((state) => state.snapshot);
  const lan = snapshot?.lan;
  const [poolStart, setPoolStart] = useState(lan?.poolStart ?? '');
  const [poolEnd, setPoolEnd] = useState(lan?.poolEnd ?? '');
  const [leaseHours, setLeaseHours] = useState(lan?.leaseHours ?? 24);

  return (
    <Panel title={COPY.advanced.dhcp} icon="🧾">
      <KeyValue
        entries={[
          ['عنوان الراوتر', <span className="ltr">{lan?.ip ?? '—'}</span>],
          ['القناع', <span className="ltr">{lan?.netmask ?? '—'}</span>],
          ['عدد الأجهزة', lan?.clientCount ?? snapshot?.counts.devices ?? 0],
        ]}
      />
      <div className="divider" />
      <div className="connect-grid">
        <Field label="بداية النطاق">
          <input className="input input-ltr" value={poolStart} onChange={(event) => setPoolStart(event.target.value)} />
        </Field>
        <Field label="نهاية النطاق">
          <input className="input input-ltr" value={poolEnd} onChange={(event) => setPoolEnd(event.target.value)} />
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <OperationRow id="dhcp.set_pool" params={{ poolStart, poolEnd }} requireConfirm>
          <span className="small muted">تغيير نطاق العناوين يقطع الاتصال مؤقتًا عن الأجهزة التي ستحصل على عنوان جديد.</span>
        </OperationRow>
      </div>
      <div className="divider" />
      <Field label="مدة الإيجار (ساعات)">
        <input
          className="input input-ltr"
          type="number"
          min={1}
          max={720}
          value={leaseHours}
          onChange={(event) => setLeaseHours(Number(event.target.value))}
        />
      </Field>
      <div style={{ marginTop: 12 }}>
        <OperationRow id="dhcp.set_lease" params={{ leaseHours }}>
          <span className="small muted">مدة أطول = عناوين أكثر ثباتًا.</span>
        </OperationRow>
      </div>
    </Panel>
  );
}

function QosTab(): JSX.Element {
  const snapshot = useAppState((state) => state.snapshot);
  const [mac, setMac] = useState(snapshot?.devices[0]?.mac ?? '');
  const [downMbps, setDownMbps] = useState(10);
  const [upMbps, setUpMbps] = useState(5);

  return (
    <Panel title={COPY.advanced.qos} icon="🎚️">
      <p className="panel-sub">حدّد سرعة جهاز معيّن داخل الشبكة. القيمة تُطبَّق على الراوتر نفسه.</p>
      <Field label="الجهاز">
        <select className="select" value={mac} onChange={(event) => setMac(event.target.value)}>
          {(snapshot?.devices ?? []).map((device) => (
            <option key={device.id} value={device.mac}>
              {device.name} — {device.ip}
            </option>
          ))}
        </select>
      </Field>
      <div className="connect-grid" style={{ marginTop: 12 }}>
        <Field label="حد التنزيل (Mbps)">
          <input className="input input-ltr" type="number" min={1} value={downMbps} onChange={(event) => setDownMbps(Number(event.target.value))} />
        </Field>
        <Field label="حد الرفع (Mbps)">
          <input className="input input-ltr" type="number" min={1} value={upMbps} onChange={(event) => setUpMbps(Number(event.target.value))} />
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <OperationRow id="device.limit_bandwidth" params={{ mac, downKbps: downMbps * 1000, upKbps: upMbps * 1000 }}>
          <span className="small muted">سيتم التحقق من التطبيق فعليًا بعد الحفظ.</span>
        </OperationRow>
      </div>
      <div className="divider" />
      <OperationRow id="device.clear_limit" params={{ mac }}>
        <span className="small muted">إزالة أي تحديد سرعة سابق على الجهاز المختار.</span>
      </OperationRow>
    </Panel>
  );
}

function FirewallTab(): JSX.Element {
  const [level, setLevel] = useState<'low' | 'medium' | 'high'>('medium');
  return (
    <Panel title={COPY.advanced.firewall} icon="🧱">
      <Field label="مستوى الحماية">
        <select className="select" value={level} onChange={(event) => setLevel(event.target.value as typeof level)}>
          <option value="low">منخفض — أقل تقييدًا</option>
          <option value="medium">متوسط — موصى به</option>
          <option value="high">مرتفع — أكثر تقييدًا (قد يمنع بعض التطبيقات)</option>
        </select>
      </Field>
      {level === 'low' && <Callout tone="warn" icon="⚠️">المستوى المنخفض يفتح منافذ أكثر للإنترنت — استخدمه فقط عند الحاجة.</Callout>}
      <div style={{ marginTop: 12 }}>
        <OperationRow id="firewall.set_level" params={{ level }} requireConfirm>
          <span className="small muted">تغيير الجدار الناري قد يقطع بعض الاتصالات مؤقتًا.</span>
        </OperationRow>
      </div>
    </Panel>
  );
}

function ForwardTab(): JSX.Element {
  const [name, setName] = useState('خدمة');
  const [externalPort, setExternalPort] = useState(8080);
  const [internalIp, setInternalIp] = useState('192.168.1.10');
  const [internalPort, setInternalPort] = useState(80);
  const [protocol, setProtocol] = useState<'tcp' | 'udp'>('tcp');

  return (
    <Panel title={COPY.advanced.portForward} icon="🔀">
      <Callout tone="warn" icon="⚠️">
        تحويل المنافذ يفتح خدمة داخلية على الإنترنت. لا تفعّله إلا إذا كنت تعرف ما تفعله.
      </Callout>
      <div className="connect-grid" style={{ marginTop: 12 }}>
        <Field label="الاسم">
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="المنفذ الخارجي">
          <input className="input input-ltr" type="number" value={externalPort} onChange={(event) => setExternalPort(Number(event.target.value))} />
        </Field>
        <Field label="عنوان الجهاز الداخلي">
          <input className="input input-ltr" value={internalIp} onChange={(event) => setInternalIp(event.target.value)} />
        </Field>
        <Field label="المنفذ الداخلي">
          <input className="input input-ltr" type="number" value={internalPort} onChange={(event) => setInternalPort(Number(event.target.value))} />
        </Field>
        <Field label="البروتوكول">
          <select className="select" value={protocol} onChange={(event) => setProtocol(event.target.value as 'tcp' | 'udp')}>
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
          </select>
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <OperationRow
          id="port_forward.add"
          params={{ name, externalPort, internalIp, internalPort, protocol }}
          requireConfirm
        >
          <span className="small muted">سيتم التحقق من القاعدة بعد إضافتها.</span>
        </OperationRow>
      </div>
    </Panel>
  );
}

function WanTab(): JSX.Element {
  const snapshot = useAppState((state) => state.snapshot);
  const [mtu, setMtu] = useState(snapshot?.wan.mtu ?? 1492);

  return (
    <div className="adv-grid">
      <Panel title={COPY.advanced.wan} icon="🛰️">
        <KeyValue
          entries={[
            ['عنوان الإنترنت', <span className="ltr">{snapshot?.wan.publicIp ?? snapshot?.wan.ip ?? '—'}</span>],
            ['البوابة', <span className="ltr">{snapshot?.wan.gateway ?? '—'}</span>],
            ['خوادم DNS', <span className="ltr">{(snapshot?.wan.dns ?? []).join(' · ') || '—'}</span>],
            ['نوع الاتصال', snapshot?.wan.connectionType ?? '—'],
            ['مدة التشغيل', formatUptime(snapshot?.wan.uptimeSeconds)],
            ['بيانات مستلمة', formatKb(snapshot?.wan.bytesDownKb)],
            ['بيانات مرسلة', formatKb(snapshot?.wan.bytesUpKb)],
          ]}
        />
      </Panel>

      <Panel title="ضبط الاتصال" icon="🧰">
        <Field label="MTU" hint="القيم الشائعة: 1500 لكيبل، 1492 لـ PPPoE.">
          <input className="input input-ltr" type="number" value={mtu} onChange={(event) => setMtu(Number(event.target.value))} />
        </Field>
        <div style={{ marginTop: 12 }}>
          <OperationRow id="wan.set_mtu" params={{ mtu }} requireConfirm>
            <span className="small muted">قيمة غير مناسبة قد تُضعف الاتصال.</span>
          </OperationRow>
        </div>
        <div className="divider" />
        <OperationRow id="wan.reconnect" params={{}} requireConfirm>
          <span className="small muted">إعادة الاتصال بالإنترنت: ينقطع الاتصال لدقائق ثم يعود.</span>
        </OperationRow>
      </Panel>
    </div>
  );
}

function LogsTab(): JSX.Element {
  const notifications = useAppState((state) => state.notifications);
  const describe = useAppState((state) => state.describe);
  const monitor = useAppState((state) => state.monitor);

  const diagnostics = useMemo(() => describe?.diagnostics ?? {}, [describe]);

  return (
    <div className="adv-grid">
      <Panel title={COPY.advanced.logs} icon="📜" actions={<CopyButton value={JSON.stringify(notifications, null, 2)} />}>
        {notifications.length === 0 ? (
          <EmptyState emoji="🧾" title="لا توجد أحداث بعد" />
        ) : (
          <div className="notifications">
            {notifications.map((notification) => (
              <div key={notification.id} className={`notification notification-${notification.severity}`}>
                <span aria-hidden="true">{notification.severity === 'critical' ? '🔴' : notification.severity === 'warning' ? '🟡' : '🟢'}</span>
                <div>
                  <div className="bold">{notification.title}</div>
                  {notification.body && <div className="small muted">{notification.body}</div>}
                  <div className="tiny faint">{formatRelative(notification.at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={COPY.advanced.diagnostics} icon="🧪" actions={<CopyButton value={JSON.stringify(diagnostics, null, 2)} label="نسخ التشخيص" />}>
        <KeyValue
          entries={[
            ['عدد الطلبات', String((diagnostics as { requests?: number }).requests ?? monitor.length)],
            ['فشل الطلبات', String((diagnostics as { failures?: number }).failures ?? 0)],
            ['البيانات المستلمة', `${Math.round(((diagnostics as { bytesIn?: number }).bytesIn ?? 0) / 1024)} KB`],
          ]}
        />
        <div className="divider" />
        <Details summary={COPY.advanced.rawRequest}>
          <pre style={{ margin: 0 }}>{JSON.stringify(diagnostics, null, 2).slice(0, 4000)}</pre>
        </Details>
      </Panel>
    </div>
  );
}

function RoutersTab(): JSX.Element {
  const routers = useAppState((state) => state.routers);
  const [label, setLabel] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  if (routers.length === 0) {
    return <EmptyState emoji="🗄️" title={COPY.routers.empty} hint="اضغط «تذكّر هذا الراوتر» عند تسجيل الدخول ليظهر هنا مع إعداداته المحفوظة." />;
  }

  return (
    <Panel title={COPY.routers.title} icon="🗄️" actions={<Badge tone="dim">بيانات الدخول مشفّرة على هذا الجهاز</Badge>}>
      <div className="stack">
        {routers.map((router) => (
          <div className="saved-router" key={router.target.id}>
            <span aria-hidden="true">📡</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="bold">{router.label}</div>
              <div className="tiny faint ltr">
                {router.target.host} · {router.vendor ?? '—'} {router.model ?? ''} · {router.adapterId}
              </div>
              <div className="tiny faint">
                آخر اتصال: {formatRelative(router.lastConnectedAt)} · ثقة {router.fingerprintSummary?.confidence ?? 0}%
              </div>
            </div>
            <Button size="sm" onClick={() => void store.connectSaved(router.target.id)}>
              {COPY.routers.connect}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(router.target.id); setLabel(router.label); }}>
              إعادة تسمية
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void store.forgetRouter(router.target.id)}>
              {COPY.routers.forget}
            </Button>
          </div>
        ))}
      </div>

      <Modal
        open={Boolean(editing)}
        title="إعادة تسمية الراوتر"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>{COPY.common.cancel}</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (editing) void store.renameRouter(editing, label);
                setEditing(null);
              }}
            >
              {COPY.common.save}
            </Button>
          </>
        }
      >
        <Field label="الاسم">
          <input className="input" value={label} onChange={(event) => setLabel(event.target.value)} />
        </Field>
      </Modal>
    </Panel>
  );
}

function BackupTab(): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'warn' | 'crit'; text: string } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const preferencesRaw = useMemo(() => JSON.stringify(localStorage.getItem('urlm.preferences.v1') ?? '{}', null, 2), []);

  const run = async (label: string, id: OperationId, params: Record<string, unknown>, confirm: boolean) => {
    setBusy(label);
    setFeedback(null);
    try {
      const result = await store.execute(id, params, confirm);
      setFeedback({
        tone: result.ok ? (result.verified ? 'ok' : 'warn') : 'crit',
        text: result.ok ? `${result.message}` : `⚠️ لم يتم التطبيق. السبب: ${result.message}`,
      });
    } catch (error) {
      setFeedback({ tone: 'crit', text: `⚠️ ${(error as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const exportSettings = () => {
    const blob = new Blob([preferencesRaw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'urm-settings-backup.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importSettings = (file: File) => {
    void file.text().then((text) => {
      try {
        localStorage.setItem('urlm.preferences.v1', text);
        setFeedback({ tone: 'ok', text: 'تم استيراد إعدادات التطبيق. أعد تحميل الصفحة لتطبيقها.' });
      } catch {
        setFeedback({ tone: 'crit', text: 'ملف غير صالح.' });
      }
    });
  };

  return (
    <div className="adv-grid">
      <Panel title={COPY.backup.title} icon="💾">
        <div className="stack">
          <OperationRow id="router.backup" params={{}}>
            <span className="small muted">نسخة احتياطية من إعدادات الراوتر (يفتح ملف التنزيل من الراوتر).</span>
          </OperationRow>
          <div className="divider" />
          <Callout tone="warn" icon="⚠️">{COPY.backup.restoreConfirm}</Callout>
          <Button variant="danger" loading={busy === 'restore'} onClick={() => setRestoring(true)}>
            {COPY.backup.restore}
          </Button>
          {feedback && <Callout tone={feedback.tone}>{feedback.text}</Callout>}
        </div>
      </Panel>

      <Panel title={COPY.backup.settingsBackup} icon="🗂️">
        <div className="stack">
          <div className="row row-wrap">
            <Button onClick={exportSettings}>{COPY.backup.exportFile}</Button>
            <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
              {COPY.backup.importFile}
              <input
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) importSettings(file);
                }}
              />
            </label>
          </div>
          <Details summary="عرض إعدادات التطبيق الحالية">
            <pre style={{ margin: 0 }}>{preferencesRaw}</pre>
          </Details>
          <Callout tone="info" icon="🔒">
            نسخة الإعدادات لا تحتوي على أي باسورد — فقط تفضيلات العرض والتنبيهات.
          </Callout>
        </div>
      </Panel>

      <Modal
        open={restoring}
        title={COPY.backup.restore}
        onClose={() => setRestoring(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRestoring(false)}>{COPY.common.cancel}</Button>
            <Button
              variant="danger"
              onClick={() => {
                setRestoring(false);
                void run('restore', 'router.restore', { confirmed: true }, true);
              }}
            >
              {COPY.common.confirm}
            </Button>
          </>
        }
      >
        <p className="small">{COPY.backup.restoreConfirm}</p>
      </Modal>
    </div>
  );
}

function PerformanceTab(): JSX.Element {
  const { profile, fps, report } = useVisuals();
  const reportData = report() as { tickers?: string[]; device?: Record<string, unknown>; autoTier?: string; frameBudgetMs?: number };

  return (
    <div className="adv-grid">
      <Panel title={COPY.advanced.performance} icon="⚙️">
        <div className="grid grid-tiles">
          <Tile label="معدل الإطارات" icon="🎞️" value={fps} unit="FPS" tone={fps >= 55 ? 'ok' : fps >= 40 ? 'warn' : 'crit'} />
          <Tile label="ميزانية الإطار" icon="⏱️" value={reportData.frameBudgetMs ?? 16} unit="ms" />
          <Tile label="جودة الرسوم" icon="✨" value={profile.tier} foot={reportData.autoTier} />
          <Tile label="جزيئات الخريطة" icon="🕸️" value={profile.particles} />
        </div>
        <div className="divider" />
        <KeyValue
          entries={[
            ['السرعات المُنتظرة', `${profile.targetFps} FPS`],
            ['ضبابية الزجاج', `${profile.blurPx}px`],
            ['الحركات', profile.animations ? COPY.common.on : COPY.common.off],
            ['معدل تحديث الشاشة', `${(reportData.device as { estimatedRefreshHz?: number })?.estimatedRefreshHz ?? 60} Hz`],
          ]}
        />
        <p className="tiny faint" style={{ marginTop: 8 }}>
          جودة الرسوم تُخفَّض تلقائيًا إذا انخفض معدل الإطارات، وتُرفع عند ثباته — بدون أي تدخل منك.
        </p>
      </Panel>
    </div>
  );
}

function SettingsTab(): JSX.Element {
  const { preferences, update } = useVisuals();
  const [quality, setQuality] = useState(preferences.qualityOverride ?? 'auto');

  return (
    <div className="adv-grid">
      <Panel title={COPY.settings.accessibility} icon="♿">
        <div className="stack">
          <Toggle checked={preferences.largeText} onChange={(value) => update({ largeText: value })} label={COPY.settings.largeText} hint="يزيد حجم كل النصوص واللمس" />
          <Toggle checked={preferences.highContrast} onChange={(value) => update({ highContrast: value })} label={COPY.settings.highContrast} />
          <Toggle checked={preferences.reducedMotion} onChange={(value) => update({ reducedMotion: value })} label={COPY.settings.reducedMotion} hint="يوقف كل الحركات ويخفّض جودة الرسوم" />
          <Toggle checked={preferences.lowData} onChange={(value) => update({ lowData: value })} label={COPY.settings.lowData} />
        </div>
      </Panel>

      <Panel title={COPY.settings.notifications} icon="🔔">
        <div className="stack">
          <Toggle checked={preferences.notifyDevices} onChange={(value) => update({ notifyDevices: value })} label="جهاز جديد يتصل" />
          <Toggle checked={preferences.notifySpeedDrop} onChange={(value) => update({ notifySpeedDrop: value })} label="انخفاض السرعة" />
          <Toggle checked={preferences.notifyDisconnect} onChange={(value) => update({ notifyDisconnect: value })} label="انقطاع الإنترنت" />
          <Toggle checked={preferences.notifySmartFix} onChange={(value) => update({ notifySmartFix: value })} label="تطبيق إصلاح ذكي" />
        </div>
      </Panel>

      <Panel title={COPY.settings.quality} icon="🎛️">
        <Field label={COPY.settings.quality}>
          <select
            className="select"
            value={quality}
            onChange={(event) => {
              const value = event.target.value;
              setQuality(value);
              update({ qualityOverride: value === 'auto' ? undefined : (value as never) });
            }}
          >
            <option value="auto">{COPY.settings.qualityAuto}</option>
            <option value="ultra">فائقة (120 FPS)</option>
            <option value="high">عالية (60 FPS)</option>
            <option value="balanced">متوازنة</option>
            <option value="lite">خفيفة (توفير البطارية)</option>
          </select>
        </Field>
      </Panel>

      <Panel title={COPY.settings.privacy} icon="🔒">
        <p className="small muted">{COPY.settings.privacyBody}</p>
        <ul className="small muted" style={{ paddingInlineStart: 18 }}>
          <li>لا يتم إرسال أي بيانات شبكة أو بيانات دخول إلى أي خادم خارجي.</li>
          <li>الباسورد يُخزَّن مشفّرًا (AES-256-GCM) على هذا الجهاز فقط عند تفعيل «تذكّر هذا الراوتر».</li>
          <li>التطبيق يعمل بدون إنترنت لعرض آخر بيانات معروفة.</li>
        </ul>
      </Panel>
    </div>
  );
}
