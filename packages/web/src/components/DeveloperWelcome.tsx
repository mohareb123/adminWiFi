/**
 * One-time developer welcome (spec §37).
 *
 * Shows the developer name and two subscription buttons. The links are plain
 * anchors with `target="_blank" rel="noopener noreferrer"` — they never open by
 * themselves and they are never triggered programmatically.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { COPY } from '../core/i18n';
import { Button, Panel } from './ui';

/**
 * Channel links come from the build environment so the project never ships a
 * made-up URL. Configure them in `packages/web/.env.local`:
 *
 *   VITE_YOUTUBE_URL=https://www.youtube.com/@your-channel?sub_confirmation=1
 *   VITE_WHATSAPP_URL=https://whatsapp.com/channel/XXXXXXXXXXXX
 */
export const DEVELOPER_LINKS = {
  youtube: (import.meta.env?.VITE_YOUTUBE_URL as string | undefined) ?? '',
  whatsappChannel: (import.meta.env?.VITE_WHATSAPP_URL as string | undefined) ?? '',
} as const;

export function DeveloperWelcome({ onContinue }: { onContinue: () => void }): JSX.Element {
  return (
    <div className="welcome">
      <Panel className="welcome-card">
        <div className="brand-line">{COPY.app.brand}</div>
        <h1>{COPY.welcome.title}</h1>
        <p className="muted" style={{ maxWidth: 520 }}>{COPY.welcome.body}</p>

        <div className="welcome-hints">
          {COPY.welcome.hints.map((hint) => (
            <div className="welcome-hint" key={hint}>
              <span aria-hidden="true">✦</span>
              <span>{hint}</span>
            </div>
          ))}
        </div>

        <div className="welcome-links">
          {DEVELOPER_LINKS.youtube ? (
            // A real anchor: nothing opens until the user taps it, and it opens
            // in a new tab with `noopener` (spec §37).
            <a className="btn btn-primary" href={DEVELOPER_LINKS.youtube} target="_blank" rel="noopener noreferrer">
              <span aria-hidden="true">▶️</span> {COPY.welcome.subscribeYouTube}
            </a>
          ) : (
            <Button disabled title="أضف الرابط عبر VITE_YOUTUBE_URL في ملف .env.local">
              <span aria-hidden="true">▶️</span> {COPY.welcome.subscribeYouTube}
            </Button>
          )}
          {DEVELOPER_LINKS.whatsappChannel ? (
            <a
              className="btn btn-mint"
              href={DEVELOPER_LINKS.whatsappChannel}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span aria-hidden="true">💬</span> {COPY.welcome.subscribeWhatsApp}
            </a>
          ) : (
            <Button disabled title="أضف الرابط عبر VITE_WHATSAPP_URL في ملف .env.local">
              <span aria-hidden="true">💬</span> {COPY.welcome.subscribeWhatsApp}
            </Button>
          )}
        </div>
        <p className="tiny faint">{COPY.welcome.linksNote}</p>
        {(!DEVELOPER_LINKS.youtube || !DEVELOPER_LINKS.whatsappChannel) && (
          <p className="tiny faint">
            روابط القنوات تُضبط من ملف <span className="mono">.env.local</span> — راجع{' '}
            <span className="mono">packages/web/.env.example</span>.
          </p>
        )}

        <div className="divider" />
        <div className="center">
          <div className="bold">{COPY.app.developer}</div>
          <div className="tiny faint">{COPY.app.copyright}</div>
        </div>

        <Button variant="primary" block onClick={onContinue}>
          {COPY.welcome.continue}
        </Button>
      </Panel>
    </div>
  );
}
