/**
 * Smart Assistant (spec §13/§23).
 *
 * The user writes in Arabic; the real NLU runs in the bridge against the live
 * snapshot. The local intent catalogue is used for the suggestion chips and as
 * an offline fallback so the panel still helps without the bridge.
 * Every proposal carries an explicit [تطبيق الحل] button and the result is shown
 * exactly as the Verification Engine reported it — success or failure.
 *
 * © 2026 User: محمد إبراهيم أبو العز — All Rights Reserved.
 */

import { useEffect, useRef, useState } from 'react';
import type { AssistantReply, SmartFixPlan } from '@urlm/core';
import { ASSISTANT_SUGGESTIONS, matchIntent } from '../core/assistant-intents';
import { COPY } from '../core/i18n';
import { store, useAppState, shallowArrayEquals } from '../core/store';
import { Badge, Button, Callout, Panel } from './ui';

interface Turn {
  role: 'user' | 'bot';
  text: string;
  reply?: AssistantReply;
}

export function AssistantPanel(): JSX.Element {
  const transcript = useAppState((state) => state.assistant, shallowArrayEquals);
  const busy = useAppState((state) => state.assistantBusy);
  const session = useAppState((state) => state.session);
  const [input, setInput] = useState('');
  const [localTurns, setLocalTurns] = useState<Turn[]>([]);
  const [applyResult, setApplyResult] = useState<{ planId: string; tone: 'ok' | 'warn' | 'crit'; text: string } | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [pendingInput, setPendingInput] = useState<{
    key: string;
    labelAr: string;
    type: 'text' | 'password';
    plan: SmartFixPlan;
  } | null>(null);
  const [inputValue, setInputValue] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  const turns: Turn[] = [
    ...localTurns,
    ...transcript.map<Turn>((reply) => ({ role: 'bot', text: reply.messageAr, reply })),
  ];

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    if (typeof log.scrollTo === 'function') log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
    else log.scrollTop = log.scrollHeight;
  }, [turns.length]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput('');
    setLocalTurns((previous) => [...previous, { role: 'user', text: trimmed }]);
    try {
      const reply = await store.ask(trimmed);
      if (reply?.plan?.requiresInput) {
        setPendingInput({ ...reply.plan.requiresInput, plan: reply.plan });
      }
    } catch (error) {
      // Offline fallback: answer from the local catalogue, honestly labelled.
      const intent = matchIntent(trimmed);
      setLocalTurns((previous) => [
        ...previous,
        {
          role: 'bot',
          text:
            intent.intent === 'unknown'
              ? 'لم أفهم الطلب تمامًا. جرّب: «النت بطيء» أو «مين أكتر جهاز بيستهلك النت؟»'
              : offlineAnswer(intent.intent, (error as Error).message),
        },
      ]);
    }
  };

  const applyPlan = async (plan: SmartFixPlan, extra?: Record<string, unknown>) => {
    setApplying(plan.id);
    setApplyResult(null);
    try {
      const resolved: SmartFixPlan = extra
        ? { ...plan, actions: plan.actions.map((action) => ({ ...action, params: { ...action.params, ...extra } })) }
        : plan;
      const result = await store.applyPlan(resolved);
      setApplyResult({
        planId: plan.id,
        tone: result.ok ? (result.verified ? 'ok' : 'warn') : 'crit',
        text: result.ok
          ? `${COPY.assistant.applied} — ${result.message}`
          : `${COPY.assistant.applyFailed}. السبب: ${result.message}`,
      });
      setPendingInput(null);
    } catch (error) {
      setApplyResult({ planId: plan.id, tone: 'crit', text: `${COPY.assistant.applyFailed}. السبب: ${(error as Error).message}` });
    } finally {
      setApplying(null);
    }
  };

  return (
    <div className="stack">
      <Panel
        title={COPY.assistant.title}
        icon="🤖"
        actions={
          <>
            {session && <Badge tone="ok">{session.identity.vendor ?? '—'} {session.identity.model}</Badge>}
            <Button size="sm" variant="ghost" onClick={() => { setLocalTurns([]); setApplyResult(null); }}>
              {COPY.assistant.clear}
            </Button>
          </>
        }
      >
        <div className="assistant-log" ref={logRef}>
          {turns.length === 0 && (
            <Callout tone="info" icon="💡">
              اسأل بأي صيغة عامية: «النت بطيء»، «عايز أقفل النت عن جهاز»، «مين أكتر جهاز بيستهلك النت؟»، «غيّر باسورد الواي فاي».
            </Callout>
          )}

          {turns.map((turn, index) =>
            turn.role === 'user' ? (
              <div className="bubble bubble-user" key={`u-${index}`}>
                {turn.text}
              </div>
            ) : (
              <div className="bubble bubble-bot" key={`b-${index}`}>
                {turn.text}

                {turn.reply?.plan && (
                  <div style={{ marginTop: 12 }}>
                    <div className="divider" />
                    <div className="bold small">{turn.reply.plan.titleAr}</div>
                    <div className="small muted" style={{ marginTop: 4 }}>
                      {turn.reply.plan.recommendationAr}
                    </div>
                    {turn.reply.plan.impactAr && <div className="tiny faint" style={{ marginTop: 4 }}>{turn.reply.plan.impactAr}</div>}

                    <div className="row row-wrap" style={{ marginTop: 10 }}>
                      {turn.reply.plan.actions.length > 0 ? (
                        <Button
                          variant="primary"
                          size="sm"
                          loading={applying === turn.reply.plan.id}
                          onClick={() => void applyPlan(turn.reply!.plan!)}
                        >
                          ✦ {COPY.assistant.apply}
                        </Button>
                      ) : (
                        <Badge tone="warn">لا يوجد إجراء متاح على هذا الراوتر — هذه توصية فقط</Badge>
                      )}
                      <Badge tone={turn.reply.plan.confidence === 'high' ? 'ok' : turn.reply.plan.confidence === 'medium' ? 'warn' : 'dim'}>
                        الثقة: {turn.reply.plan.confidence === 'high' ? 'عالية' : turn.reply.plan.confidence === 'medium' ? 'متوسطة' : 'منخفضة'}
                      </Badge>
                    </div>

                    {applyResult?.planId === turn.reply.plan.id && (
                      <Callout tone={applyResult.tone} icon={applyResult.tone === 'ok' ? '✓' : '⚠️'}>
                        {applyResult.text}
                      </Callout>
                    )}

                    {pendingInput?.plan.id === turn.reply.plan.id && (
                      <div className="row" style={{ marginTop: 8 }}>
                        <input
                          className="input"
                          type={pendingInput.type === 'password' ? 'password' : 'text'}
                          value={inputValue}
                          placeholder={pendingInput.labelAr}
                          onChange={(event) => setInputValue(event.target.value)}
                        />
                        <Button
                          size="sm"
                          onClick={() => void applyPlan(pendingInput.plan, { [pendingInput.key]: inputValue })}
                          disabled={!inputValue}
                        >
                          {COPY.assistant.apply}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {turn.reply?.choices && turn.reply.choices.length > 0 && (
                  <div className="row row-wrap" style={{ marginTop: 10 }}>
                    {turn.reply.choices.map((choice) => (
                      <Button key={choice.value} size="sm" variant="ghost" onClick={() => void send(choice.value)}>
                        {choice.labelAr}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}

          {busy && (
            <div className="bubble bubble-bot" aria-live="polite">
              <span className="spinner" aria-hidden="true" /> {COPY.assistant.thinking}
            </div>
          )}
        </div>

        <div className="divider" />

        <div className="composer">
          <input
            className="input"
            value={input}
            placeholder={COPY.assistant.placeholder}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void send(input)}
          />
          <Button variant="primary" onClick={() => void send(input)} loading={busy} disabled={!input.trim()}>
            {COPY.assistant.send}
          </Button>
        </div>

        <div style={{ marginTop: 12 }}>
          <div className="tiny faint" style={{ marginBottom: 6 }}>{COPY.assistant.suggestions}</div>
          <div className="row row-wrap">
            {ASSISTANT_SUGGESTIONS.map((suggestion) => (
              <button key={suggestion.label} type="button" className="chip" onClick={() => void send(suggestion.phrase)}>
                {suggestion.label}
              </button>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function offlineAnswer(intent: string, error: string): string {
  const base = `تعذّر الوصول إلى المحرك (${error}).`;
  switch (intent) {
    case 'slow-internet':
      return `${base}\n\nيمكنك الآن تجربة:\n• إعادة تشغيل الراوتر\n• تغيير قناة الواي فاي من قسم الواي فاي\n• اختبار السرعة لمعرفة إن كانت المشكلة من مزوّد الخدمة`;
    case 'top-consumer':
      return `${base}\n\nافتح قسم «الأجهزة» لترتيب القائمة حسب الاستهلاك ومعرفة أعلى جهاز.`;
    case 'block-device':
      return `${base}\n\nافتح قسم «الأجهزة» ثم اختر الجهاز واضغط «إيقاف الإنترنت».`;
    case 'change-wifi-password':
      return `${base}\n\nافتح قسم «الواي فاي» ثم «تعديل الإعدادات» لتغيير الباسورد.`;
    default:
      return `${base}\n\nشغّل الجسر المحلي ثم أعد المحاولة للحصول على تحليل كامل.`;
  }
}
