/**
 * Top bar: bridge state, demo/real switch, notifications, quick settings.
 *
 * The mode switch is explicit and reversible: the demo profiles are clearly
 * labelled so a simulated router is never mistaken for the user's own device.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { useState } from 'react';
import { COPY } from '../core/i18n';
import { formatRelative } from '../core/format';
import { store, useAppState } from '../core/store';
import { useVisuals } from '../visual/provider';
import { Badge, Button, Callout, Modal, Panel, Toggle } from './ui';

export function TopBar({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element {
  const bridge = useAppState((state) => state.bridge);
  const host = useAppState((state) => state.host);
  const session = useAppState((state) => state.session);
  const notifications = useAppState((state) => state.notifications);
  const unread = useAppState((state) => state.unreadNotifications);
  const phase = useAppState((state) => state.phase);
  const runtime = useAppState((state) => state.runtime);
  const onDevice = runtime.kind === 'device';
  const { preferences } = useVisuals();
  const [openNotifications, setOpenNotifications] = useState(false);
  const [openMode, setOpenMode] = useState(false);

  const statusTone = bridge.status === 'ready' ? 'ok' : bridge.status === 'offline' ? 'crit' : 'warn';

  return (
    <>
      <header className="row row-wrap" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 10, flex: 1, minWidth: 220 }}>
          <span className={`dot dot-${statusTone === 'ok' ? 'ok' : statusTone === 'crit' ? 'crit' : 'warn'}`} aria-hidden="true" />
          <div>
            <div className="bold" style={{ lineHeight: 1.2 }}>
              {COPY.app.nameAr}
            </div>
            <div className="tiny faint">
              {bridge.status === 'ready'
                ? `${onDevice ? 'محرّك الهاتف جاهز' : 'الجسر المحلي متصل'}${session ? ` · ${session.identity.vendor ?? ''} ${session.identity.model ?? ''}` : ''}`
                : bridge.status === 'offline'
                  ? COPY.errors.bridgeOffline
                  : COPY.splash.starting}
              {preferences.advanced ? ' · الوضع المتقدم' : ''}
            </div>
          </div>
        </div>

        {phase && bridge.status === 'ready' && (
          <Badge tone="dim">{phase.messageKey.replace('phase.', '')}</Badge>
        )}

        <Badge tone={host.mode === 'simulated' ? 'demo' : 'ok'}>
          {host.mode === 'simulated' ? COPY.connect.demoBadge : COPY.connect.realMode}
        </Badge>

        <Button size="sm" variant="ghost" onClick={() => setOpenMode(true)} title="تبديل الوضع">
          🔀
        </Button>

        <button type="button" className="btn btn-ghost btn-sm bell" onClick={() => { setOpenNotifications(true); store.markNotificationsRead(); }}>
          🔔
          {unread > 0 && <span className="bell-count">{unread}</span>}
          <span className="visually-hidden">التنبيهات</span>
        </button>

        <Button size="sm" variant="ghost" onClick={onOpenSettings} title="الإعدادات">
          ⚙️
        </Button>
      </header>

      <Modal open={openNotifications} title={COPY.notifications.title} onClose={() => setOpenNotifications(false)}>
        {notifications.length === 0 ? (
          <Callout tone="info">{COPY.notifications.empty}</Callout>
        ) : (
          <div className="notifications">
            {notifications.map((notification) => (
              <div key={notification.id} className={`notification notification-${notification.severity}`}>
                <span aria-hidden="true">
                  {notification.severity === 'critical' ? '🔴' : notification.severity === 'warning' ? '🟡' : '🟢'}
                </span>
                <div style={{ flex: 1 }}>
                  <div className="bold">{notification.title}</div>
                  {notification.body && <div className="small muted">{notification.body}</div>}
                  <div className="tiny faint">{formatRelative(notification.at)}</div>
                </div>
                {notification.action?.operationId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void store.execute(notification.action!.operationId!, {}, true)}
                  >
                    {notification.action.label}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal open={openMode} title="وضع التشغيل" onClose={() => setOpenMode(false)}>
        <div className="stack">
          <Callout tone={host.mode === 'simulated' ? 'info' : 'warn'} icon={host.mode === 'simulated' ? '🧪' : '⚠️'}>
            {host.mode === 'simulated'
              ? 'الوضع التجريبي يستخدم راوترًا وهميًا داخل التطبيق نفسه — آمن تمامًا ولا يلمس شبكتك.'
              : onDevice
                ? 'الوضع الحقيقي يتصل بالراوتر من هذا الهاتف مباشرة عبر شبكة الواي فاي. لا يُطبَّق أي تغيير بدون تأكيدك.'
                : 'الوضع الحقيقي يتصل بالراوتر على شبكتك عبر الجسر المحلي. لا يُطبَّق أي تغيير بدون تأكيدك.'}
          </Callout>
          <Toggle
            checked={host.mode === 'real'}
            onChange={(value) => value && void store.setMode('real')}
            label="استخدم الراوتر الحقيقي على شبكتي"
            hint={onDevice ? 'يعمل من الهاتف مباشرة — تأكد أنك متصل بواي فاي الراوتر' : 'يتطلب تشغيل الجسر المحلي على نفس الشبكة'}
          />
          <Button variant="ghost" onClick={() => void store.setMode('simulated')}>
            العودة للوضع التجريبي
          </Button>
          <Panel title="الأوضاع المتاحة" icon="🧩">
            <p className="small muted">
              الوضع الحقيقي: يكتشف بوابة الشبكة ثم يسجّل الدخول ببياناتك ويتحقق من كل تغيير. الوضع التجريبي: نماذج
              واقعية (Huawei / TP-Link / ZTE / D-Link / OpenWrt) لاستعراض كل الشاشات بدون أي مخاطرة.
            </p>
          </Panel>
        </div>
      </Modal>
    </>
  );
}
