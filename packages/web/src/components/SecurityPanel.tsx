/**
 * Security Center (spec §21): 🟢 Secure / 🟡 Attention / 🔴 Critical with an
 * honest score — only checks that could actually be evaluated count, and the
 * skipped ones are listed instead of being silently treated as safe.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import { useState } from 'react';
import type { OperationId } from '@urlm/core';
import { COPY } from '../core/i18n';
import { formatRelative } from '../core/format';
import { store, useAppState } from '../core/store';
import { Badge, Button, Callout, EmptyState, Panel } from './ui';
import { ScoreRing } from './charts';

export function SecurityPanel(): JSX.Element {
  const security = useAppState((state) => state.security);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'warn' | 'crit'; text: string } | null>(null);

  if (!security) {
    return (
      <Panel title={COPY.security.title} icon="🛡️">
        <EmptyState emoji="🛡️" title="سجّل الدخول لعرض تقرير الأمان" hint="نفحص حماية الواي فاي، الشبكات المفتوحة، الأجهزة المجهولة وإعدادات الراوتر الخطرة." />
      </Panel>
    );
  }

  const tone = security.status === 'secure' ? 'ok' : security.status === 'attention' ? 'warn' : 'crit';
  const statusLabel =
    security.status === 'secure' ? COPY.security.secure : security.status === 'attention' ? COPY.security.attention : COPY.security.critical;

  const applyFix = async (findingId: string, operationId: OperationId, params: Record<string, unknown> = {}) => {
    setBusy(findingId);
    setFeedback(null);
    try {
      const result = await store.execute(operationId, params, true);
      setFeedback({
        tone: result.ok ? (result.verified ? 'ok' : 'warn') : 'crit',
        text: result.ok
          ? `✓ ${result.message}`
          : `⚠️ لم يتم تطبيق التغيير. السبب: ${result.message}`,
      });
      await store.refreshSnapshot();
    } catch (error) {
      setFeedback({ tone: 'crit', text: `⚠️ ${(error as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <Panel title={COPY.security.title} icon="🛡️" actions={<Badge tone="dim">فُحص {formatRelative(security.checkedAt)}</Badge>}>
        <div className="row row-wrap" style={{ gap: 18 }}>
          <ScoreRing score={security.score} label={COPY.security.score} tone={tone} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="hero-title">
              <span aria-hidden="true">{tone === 'ok' ? '🟢' : tone === 'warn' ? '🟡' : '🔴'}</span> <span>{statusLabel}</span>
            </div>
            <p className="small muted">
              تم تقييم {security.evaluated} فحصًا من إجمالي {security.evaluated + security.skipped.length}. الفحوص غير المتاحة
              على هذا الراوتر لا تُحسب كآمنة.
            </p>
            {security.skipped.length > 0 && (
              <div className="tiny faint">غير متاح على هذا الراوتر: {security.skipped.join(' · ')}</div>
            )}
          </div>
        </div>

        {feedback && <Callout tone={feedback.tone} icon={feedback.tone === 'ok' ? '✓' : '⚠️'}>{feedback.text}</Callout>}
      </Panel>

      <Panel title={COPY.security.findings} icon="🔎">
        {security.findings.length === 0 ? (
          <EmptyState emoji="✅" title={COPY.security.noFindings} />
        ) : (
          <div className="stack">
            {security.findings.map((finding) => (
              <div
                key={finding.id}
                className={`finding ${finding.status === 'critical' ? 'finding-crit' : finding.status === 'attention' ? 'finding-warn' : ''}`}
              >
                <span style={{ fontSize: '1.2rem' }} aria-hidden="true">
                  {finding.status === 'critical' ? '🔴' : finding.status === 'attention' ? '🟡' : '🟢'}
                </span>
                <div style={{ flex: 1 }}>
                  <div className="bold">{finding.titleAr}</div>
                  <div className="small muted">{finding.detailAr}</div>
                  {finding.evidence && <div className="tiny faint ltr">{finding.evidence}</div>}
                </div>
                {finding.fix ? (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busy === finding.id}
                    onClick={() => void applyFix(finding.id, finding.fix!.operationId, finding.fix!.params ?? {})}
                  >
                    {finding.fix.labelAr}
                  </Button>
                ) : finding.status !== 'ok' ? (
                  <Badge tone="warn">لا يوجد إجراء تلقائي آمن</Badge>
                ) : (
                  <Badge tone="ok">سليم</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Callout tone="info" icon="ℹ️">
        لا يقوم التطبيق بفحص كلمات المرور أو تجربة الدخول على أجهزة أخرى. كل الفحوص تعتمد على بيانات الراوتر نفسه وعلى
        قائمة الأجهزة المتصلة بشبكتك.
      </Callout>
    </div>
  );
}
