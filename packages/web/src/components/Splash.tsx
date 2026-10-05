/**
 * Short splash: glow + scale + fade + drawn network lines (spec §35).
 * It never blocks longer than the app needs — the shell mounts underneath it.
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { COPY } from '../core/i18n';

export function Splash({ leaving = false }: { leaving?: boolean }): JSX.Element {
  return (
    <div
      className="splash"
      role="status"
      aria-live="polite"
      style={leaving ? { opacity: 0, transition: 'opacity 320ms ease-out', pointerEvents: 'none' } : undefined}
    >
      <div className="splash-inner">
        <div className="splash-mark">
          <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
            <circle cx="60" cy="60" r="34" stroke="rgba(126,178,255,0.22)" strokeWidth="1.5" />
            <circle cx="60" cy="60" r="46" stroke="rgba(126,178,255,0.14)" strokeWidth="1.5" strokeDasharray="6 10" />
            <path
              className="splash-line"
              d="M22 74c9-16 22-24 38-24s29 8 38 24"
              stroke="url(#g1)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="70 70"
            />
            <path
              className="splash-line"
              d="M32 86c7-12 17-18 28-18s21 6 28 18"
              stroke="url(#g1)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="70 70"
              style={{ animationDelay: '160ms' }}
            />
            <circle cx="60" cy="46" r="7" fill="url(#g1)" />
            <circle cx="60" cy="46" r="14" stroke="rgba(77,216,255,0.4)" strokeWidth="1.5" />
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="120" y2="120">
                <stop stopColor="#4dd8ff" />
                <stop offset="1" stopColor="#8b7cff" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div className="splash-title">{COPY.app.nameAr}</div>
          <div className="splash-sub">{COPY.splash.starting}</div>
          <div className="brand-line" style={{ marginTop: 8 }}>{COPY.app.brand}</div>
        </div>
      </div>
    </div>
  );
}
