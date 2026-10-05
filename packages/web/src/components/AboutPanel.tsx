/**
 * ABOUT screen (spec §38): name, version, developer, copyright, OSS licences,
 * capabilities, diagnostics and the privacy statement.
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { COPY } from '../core/i18n';
import { store, useAppState } from '../core/store';
import { useVisuals } from '../visual/provider';
import { Badge, Button, Callout, CopyButton, Details, KeyValue, Panel, Tile } from './ui';

const APP_VERSION = '1.0.0';
/** Bumped whenever a dependency or bundled asset changes. */
const BUILD_TAG = '2026.10';

export function AboutPanel(): JSX.Element {
  const health = useAppState((state) => state.bridge.health);
  const session = useAppState((state) => state.session);
  const describe = useAppState((state) => state.describe);
  const plan = useAppState((state) => state.speedPlan);
  const { profile, fps, report } = useVisuals();

  return (
    <div className="stack">
      <Panel title={COPY.about.title} icon="ℹ️">
        <div className="row row-wrap" style={{ gap: 18 }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h2>{COPY.app.nameAr}</h2>
            <p className="muted small">{COPY.app.tagline}</p>
            <KeyValue
              entries={[
                [COPY.about.version, `${APP_VERSION} (${BUILD_TAG})`],
                [COPY.about.developer, COPY.app.developer],
                ['الاسم بالإنجليزية', 'Mohamed Ibrahim Abu El-Ezz'],
                [COPY.about.copyright, COPY.app.copyright],
                ['البصمة', COPY.app.brand],
              ]}
            />
          </div>
          <div className="grid grid-tiles" style={{ flex: 1, minWidth: 260 }}>
            <Tile label="الجسر المحلي" icon="🔌" value={health ? `v${health.version}` : '—'} foot={health ? `يعمل منذ ${Math.round(health.uptimeSeconds / 60)} دقيقة` : 'غير متصل'} tone={health ? 'ok' : 'crit'} />
            <Tile label="معدل الإطارات" icon="🎞️" value={fps} unit="FPS" />
            <Tile label="جودة الرسوم" icon="✨" value={profile.tier} />
          </div>
        </div>

        <div className="divider" />
        <div className="row row-wrap">
          <Badge tone="ok">{COPY.settings.privacy}</Badge>
          <Badge tone="dim">{COPY.common.offline}</Badge>
          <Badge tone="dim">بدون تتبع — بدون إعلانات</Badge>
          {plan.simulated && <Badge tone="demo">وضع تجريبي</Badge>}
        </div>
      </Panel>

      <div className="adv-grid">
        <Panel title={COPY.about.privacy} icon="🔒">
          <p className="small muted">{COPY.settings.privacyBody}</p>
          <Callout tone="info" icon="🛡️">
            يستخدم التطبيق الوسائل الآمنة فقط في الاكتشاف (قراءة البوابة، ARP، SSDP، فحص منافذ الإدارة). لا يوجد أي محاولة
            لتجاوز تسجيل الدخول أو تخمين كلمات المرور.
          </Callout>
          <Callout tone="warn" icon="📄">
            {COPY.about.notice}
          </Callout>
        </Panel>

        <Panel title={COPY.about.capabilities} icon="🧩">
          {describe?.capabilities?.length ? (
            <div className="matrix">
              {describe.capabilities.slice(0, 24).map((capability) => (
                <div key={capability.id} className={`matrix-cell ${capability.supported === 'yes' ? 'yes' : 'no'}`}>
                  <span aria-hidden="true">{capability.supported === 'yes' ? '✓' : '✕'}</span>
                  <span className="ltr tiny">{capability.id}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">سجّل الدخول إلى راوتر لعرض الإمكانيات المدعومة.</p>
          )}
        </Panel>

        <Panel title={COPY.about.diagnostics} icon="🧪" actions={<CopyButton value={JSON.stringify({ describe, report: report(), session }, null, 2)} label="نسخ التقرير" />}>
          <Details summary="عرض التقرير الكامل (بدون أي بيانات دخول)">
            <pre style={{ margin: 0 }}>{JSON.stringify({ describe, report: report(), session }, null, 2).slice(0, 6000)}</pre>
          </Details>
          <div className="divider" />
          <div className="row row-wrap">
            <Button size="sm" variant="ghost" onClick={() => void store.refreshSnapshot()}>
              تحديث البيانات
            </Button>
            <Button size="sm" variant="ghost" onClick={() => window.open('/api/export', '_blank')}>
              تنزيل تقرير التشخيص
            </Button>
          </div>
        </Panel>

        <Panel title={COPY.about.licenses} icon="📚">
          <p className="small muted">
            يستخدم هذا المشروع مكتبات مفتوحة المصدر: React وReact DOM (MIT)، Vite (MIT)، TypeScript (Apache-2.0)،
            Vitest (MIT). التفاصيل الكاملة والتراخيص في ملف <span className="mono">docs/THIRD-PARTY.md</span>.
          </p>
          <p className="tiny faint">
            أسماء الراوترات والعلامات التجارية المذكورة (Huawei, TP-Link, ZTE, D-Link, Xiaomi, ASUS, MikroTik, Netgear,
            Linksys, OpenWrt…) مملوكة لأصحابها، ويُذكر بعضها هنا لأغراض التوافق فقط دون أي ادعاء ملكية.
          </p>
        </Panel>
      </div>
    </div>
  );
}
