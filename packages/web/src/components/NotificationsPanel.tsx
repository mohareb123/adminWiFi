/**
 * In-app toast stack for the newest events (spec §46).
 *
 * Toasts are transient and cheap: at most three at a time, auto-dismissed, and
 * they only ever show events the engine actually produced — no decorative
 * notifications, no fake success.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { useEffect, useState } from 'react';
import { COPY } from '../core/i18n';
import { store, useAppState } from '../core/store';
import { Button } from './ui';
import type { PanelId } from '../App';

const ROUTE_BY_CODE: Record<string, PanelId> = {
  'new-device': 'devices',
  'speed-drop': 'bandwidth',
  offline: 'home',
  online: 'home',
  'smartfix-applied': 'assistant',
  'smartfix-failed': 'assistant',
  'security-warning': 'security',
};

export function NotificationsPanel({ onNavigate }: { onNavigate: (id: PanelId) => void }): JSX.Element {
  const notifications = useAppState((state) => state.notifications);
  const [visible, setVisible] = useState<string[]>([]);

  // Only toast events that arrive while the user is watching.
  useEffect(() => {
    const latest = notifications[0];
    if (!latest) return;
    setVisible((previous) => (previous.includes(latest.id) ? previous : [...previous, latest.id].slice(-3)));
    const timer = window.setTimeout(() => {
      setVisible((previous) => previous.filter((id) => id !== latest.id));
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [notifications]);

  const shown = notifications.filter((notification) => visible.includes(notification.id));
  if (shown.length === 0) return <></>;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {shown.map((notification) => (
        <div key={notification.id} className={`toast notification-${notification.severity}`}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
            <span aria-hidden="true">
              {notification.severity === 'critical' ? '🔴' : notification.severity === 'warning' ? '🟡' : '🟢'}
            </span>
            <div style={{ flex: 1 }}>
              <div className="bold">{notification.title}</div>
              {notification.body && <div className="small muted">{notification.body}</div>}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setVisible((previous) => previous.filter((id) => id !== notification.id))}
              aria-label={COPY.common.close}
            >
              ✕
            </button>
          </div>
          {ROUTE_BY_CODE[notification.code] && (
            <div style={{ marginTop: 8 }}>
              <Button size="sm" variant="ghost" onClick={() => onNavigate(ROUTE_BY_CODE[notification.code]!)}>
                عرض التفاصيل
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
