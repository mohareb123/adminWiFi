/**
 * Connect screen — the only place the user types anything sensitive.
 *
 * Universal login (spec §8/§9): the user sees Username + Password + Login, and
 * the engine decides whether that becomes a form POST, a session/cookie login,
 * a token exchange or HTTP Basic — the UI never asks about mechanisms.
 * Credentials are never stored in the browser: "تذكّر هذا الراوتر" sends them to
 * the Local Bridge, which keeps them encrypted (AES-256-GCM) on this machine.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { useEffect, useState } from 'react';
import { COPY, phaseLabel } from '../core/i18n';
import { store, useAppState } from '../core/store';
import { Badge, Button, Callout, Field, Panel, Toggle } from './ui';

const STEP_KEYS = [
  'phase.discovering',
  'phase.fingerprinting',
  'phase.capabilities',
  'phase.authenticating',
  'phase.ready',
] as const;

export function ConnectScreen(): JSX.Element {
  const bridge = useAppState((state) => state.bridge);
  const host = useAppState((state) => state.host);
  const phase = useAppState((state) => state.phase);
  const progress = useAppState((state) => state.progress);
  const routers = useAppState((state) => state.routers);
  const describe = useAppState((state) => state.describe);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hostAddress, setHostAddress] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Prefill demo credentials so the preview is usable in one tap.
  useEffect(() => {
    if (bridge.status !== 'ready') return;
    if (host.mode === 'simulated' && !username) {
      setUsername('admin');
      setPassword('Admin@123');
    }
  }, [bridge.status, host.mode, username]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await store.connect({ username, password, remember, host: hostAddress || undefined });
      if (!ok) setError(COPY.connect.wrongPassword);
    } catch (thrown) {
      const message = (thrown as Error).message;
      setError(message.includes('auth') ? COPY.connect.wrongPassword : message);
    } finally {
      setBusy(false);
    }
  };

  const activeStep = STEP_KEYS.findIndex((key) => key === phase?.messageKey);

  return (
    <div className="connect">
      <div className="connect-card">
        <Panel
          title={COPY.connect.title}
          icon="🔐"
          actions={<Badge tone={host.mode === 'simulated' ? 'demo' : 'ok'}>{host.mode === 'simulated' ? COPY.connect.demoBadge : COPY.connect.realMode}</Badge>}
        >
          <p className="panel-sub">{COPY.connect.subtitle}</p>

          {bridge.status === 'offline' && (
            <Callout tone="warn" icon="🔌" >
              <b>{COPY.errors.bridgeOffline}</b>
              <div className="small" style={{ marginTop: 4 }}>{bridge.lastErrorAr ?? COPY.errors.bridgeOfflineHint}</div>
              <div className="small faint" style={{ marginTop: 4 }}>{COPY.errors.bridgeHint}</div>
              <pre className="code-block" style={{ marginTop: 8 }}>npm run dev:bridge</pre>
            </Callout>
          )}

          <div className="connect-grid" style={{ marginTop: 14 }}>
            <Field label={COPY.connect.username}>
              <input
                className="input input-ltr"
                value={username}
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
                placeholder="admin"
              />
            </Field>
            <Field label={COPY.connect.password}>
              <input
                className="input input-ltr"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void submit()}
                placeholder="••••••••"
              />
            </Field>
          </div>

          {showAdvanced && (
            <Field label={COPY.connect.advancedHost} hint="اتركه فارغًا لاستخدام البوابة المكتشفة تلقائيًا">
              <input
                className="input input-ltr"
                value={hostAddress}
                onChange={(event) => setHostAddress(event.target.value)}
                placeholder="192.168.1.1"
              />
            </Field>
          )}

          <div className="row row-wrap" style={{ marginTop: 14 }}>
            <Toggle
              checked={remember}
              onChange={setRemember}
              label={COPY.connect.remember}
              hint={COPY.connect.rememberHint}
            />
            <div className="spacer" />
            <Button variant="ghost" size="sm" onClick={() => setShowAdvanced((value) => !value)}>
              {showAdvanced ? 'إخفاء المتقدم' : 'خيارات متقدمة'}
            </Button>
            <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={bridge.status !== 'ready'}>
              {COPY.connect.login}
            </Button>
          </div>

          {error && (
            <Callout tone="crit" icon="⚠️">
              {error}
            </Callout>
          )}

          {busy && (
            <div className="stack" style={{ marginTop: 12 }}>
              <div className="progress-steps">
                {STEP_KEYS.map((key, index) => (
                  <span
                    key={key}
                    className={`step ${index === activeStep ? 'active' : index < activeStep ? 'done' : ''}`}
                  >
                    {index < activeStep ? '✓' : '•'} {phaseLabel(key)}
                  </span>
                ))}
              </div>
              {progress && progress.total > 0 && (
                <div className="progress">
                  <i style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
                </div>
              )}
              <div className="small muted">
                {phaseLabel(phase?.messageKey, COPY.connect.discovering)}
                {phase?.detail ? ` — ${phase.detail}` : ''}
              </div>
            </div>
          )}
        </Panel>

        {routers.length > 0 && (
          <Panel title={COPY.connect.savedRouters} icon="💾">
            <div className="stack">
              {routers.map((router) => (
                <div className="saved-router" key={router.target.id}>
                  <span aria-hidden="true">📡</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="bold ellipsis">{router.label}</div>
                    <div className="tiny faint ltr">
                      {router.target.host} · {router.vendor ?? '—'} {router.model ?? ''}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() =>
                      void store.connectSaved(router.target.id).catch((thrown: Error) => setError(thrown.message))
                    }
                  >
                    {COPY.connect.connectSaved}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void store.forgetRouter(router.target.id)}>
                    {COPY.connect.forget}
                  </Button>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {host.mode === 'simulated' && describe?.profiles && describe.profiles.length > 0 && (
          <Panel title={COPY.connect.demoProfiles} icon="🧪">
            <div className="stack">
              {describe.profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  className="demo-profile"
                  onClick={() => void store.setMode('simulated', profile.id)}
                >
                  <span aria-hidden="true">🧩</span>
                  <div style={{ flex: 1 }}>
                    <div className="bold">{profile.arLabel}</div>
                    <div className="tiny faint ltr">{profile.label}</div>
                  </div>
                  {host.profileId === profile.id ? <Badge tone="demo">الحالي</Badge> : <Badge>تجربة</Badge>}
                </button>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
