/**
 * UI primitives. Small, dependency-free, accessibility-first.
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';

/* ------------------------------------------------------------------ */

export function Panel({
  title,
  icon,
  actions,
  children,
  className = '',
  flush = false,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}): JSX.Element {
  return (
    <section className={`panel panel-accent ${flush ? 'panel-flush' : ''} ${className}`}>
      {(title || actions) && (
        <header className="panel-head" style={flush ? { padding: '14px 16px 0' } : undefined}>
          <h2 className="panel-title">
            {icon && <span aria-hidden="true">{icon}</span>}
            {title}
          </h2>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Tile({
  label,
  icon,
  value,
  unit,
  foot,
  tone = 'default',
}: {
  label: ReactNode;
  icon?: ReactNode;
  value: ReactNode;
  unit?: string;
  foot?: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'crit';
}): JSX.Element {
  const toneClass = tone === 'ok' ? 'tile-ok' : tone === 'warn' ? 'tile-warn' : tone === 'crit' ? 'tile-crit' : '';
  return (
    <div className={`tile ${toneClass}`}>
      <div className="tile-label">
        {icon && <span aria-hidden="true">{icon}</span>}
        {label}
      </div>
      <div className="tile-value">
        <span className="num">{value}</span>
        {unit && <span className="tile-unit">{unit}</span>}
      </div>
      {foot && <div className="tile-foot">{foot}</div>}
    </div>
  );
}

export function Badge({
  children,
  tone = 'default',
  title,
}: {
  children: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'crit' | 'demo' | 'dim';
  title?: string;
}): JSX.Element {
  const map = {
    default: '',
    ok: 'badge-ok',
    warn: 'badge-warn',
    crit: 'badge-crit',
    demo: 'badge-demo',
    dim: 'badge-dim',
  } as const;
  return (
    <span className={`badge ${map[tone]}`} title={title}>
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  disabled,
  type = 'button',
  icon,
  title,
  block,
  loading,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'mint' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
  type?: 'button' | 'submit';
  icon?: ReactNode;
  title?: string;
  block?: boolean;
  loading?: boolean;
}): JSX.Element {
  const variantClass =
    variant === 'primary'
      ? 'btn-primary'
      : variant === 'mint'
        ? 'btn-mint'
        : variant === 'danger'
          ? 'btn-danger'
          : variant === 'ghost'
            ? 'btn-ghost'
            : '';
  return (
    <button
      type={type}
      className={`btn ${variantClass} ${size === 'sm' ? 'btn-sm' : ''} ${block ? 'btn-block' : ''}`}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      aria-busy={loading ? true : undefined}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}): JSX.Element {
  return (
    <label className="toggle" style={disabled ? { opacity: 0.55 } : undefined}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true" />
      <span>
        <span style={{ fontWeight: 600 }}>{label}</span>
        {hint && <span className="field-hint" style={{ display: 'block' }}>{hint}</span>}
      </span>
    </label>
  );
}

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}): JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Callout({
  tone = 'info',
  icon,
  children,
  actions,
}: {
  tone?: 'info' | 'warn' | 'crit' | 'ok';
  icon?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div className={`callout callout-${tone}`} role={tone === 'crit' ? 'alert' : undefined}>
      {icon && <span aria-hidden="true">{icon}</span>}
      <div style={{ flex: 1 }}>{children}</div>
      {actions}
    </div>
  );
}

export function Progress({ value, label }: { value: number; label?: string }): JSX.Element {
  return (
    <div>
      {label && <div className="panel-sub" style={{ marginBottom: 6 }}>{label}</div>}
      <div className="progress" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

export function EmptyState({ emoji = '✨', title, hint, action }: { emoji?: string; title: ReactNode; hint?: ReactNode; action?: ReactNode }): JSX.Element {
  return (
    <div className="empty-state">
      <div className="emoji" aria-hidden="true">{emoji}</div>
      <div className="bold">{title}</div>
      {hint && <div className="small">{hint}</div>}
      {action}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
  footer,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" tabIndex={-1} ref={ref}>
        <div className="panel-head">
          <h2 className="panel-title">{title}</h2>
          <div className="panel-actions">
            <Button variant="ghost" size="sm" onClick={onClose} title="إغلاق">
              إغلاق
            </Button>
          </div>
        </div>
        {children}
        {footer && <div className="row row-wrap" style={{ marginTop: 16, justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function SignalBars({ percent, level }: { percent: number; level: string }): JSX.Element {
  const bars = [1, 2, 3, 4];
  const active = Math.max(1, Math.round((percent / 100) * 4));
  const cls = level === 'weak' ? 'crit' : level === 'fair' ? 'warn' : '';
  return (
    <span className={`signal-bars ${cls}`} title={`${percent}%`} aria-label={`قوة الإشارة ${percent}%`}>
      {bars.map((bar, index) => (
        <i key={bar} className={index < active ? 'on' : ''} style={{ height: 4 + bar * 3 }} />
      ))}
    </span>
  );
}

export function KeyValue({ entries }: { entries: Array<[ReactNode, ReactNode]> }): JSX.Element {
  return (
    <dl className="kv">
      {entries.map(([key, value], index) => (
        <div key={index} style={{ display: 'contents' }}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type TabDef = { id: string; label: ReactNode; icon?: ReactNode };

export function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
}): JSX.Element {
  return (
    <nav className="tabbar" aria-label="أقسام التطبيق">
      <div className="tabbar-inner" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="tab"
            aria-current={active === tab.id ? 'page' : undefined}
            aria-selected={active === tab.id}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon && <span className="tab-icon" aria-hidden="true">{tab.icon}</span>}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

/** Copy-to-clipboard with a transient confirmation (used in diagnostics). */
export function CopyButton({ value, label = 'نسخ' }: { value: string; label?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true)).catch(() => setCopied(false));
      }}
    >
      {copied ? 'تم النسخ' : label}
    </Button>
  );
}

/** Collapsible technical detail — Advanced Mode only. */
export function Details({ summary, children }: { summary: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <details className="code-block" style={{ padding: '8px 10px' }}>
      <summary style={{ cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '0.82rem', direction: 'rtl' }}>{summary}</summary>
      <div style={{ marginTop: 8 }}>{children}</div>
    </details>
  );
}
