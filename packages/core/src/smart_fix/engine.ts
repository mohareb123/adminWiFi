/**
 * SmartFixEngine (spec §12/§13).
 *
 * Workflow: Detect → Analyze → Recommend → Confirm → Apply → Verify.
 *
 * The engine never invents a success: if the router rejects the change or the
 * value cannot be read back, the plan reports failure with the real reason
 * ("الوظيفة غير مدعومة على هذا الراوتر" when that is the honest answer).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import type { OperationId, OperationResult, WifiNeighbor } from '../core/types';
import { formatKbps } from '../core/util';
import type { UniversalRouterEngine } from '../router_engine/engine';
import { requiresConfirmation } from '../core/notifications';

export type SmartFixConfidence = 'high' | 'medium' | 'low';

export interface SmartFixStep {
  /** detect | analyze | recommend | confirm | apply | verify */
  stage: 'detect' | 'analyze' | 'recommend' | 'confirm' | 'apply' | 'verify';
  descriptionAr: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
}

export interface SmartFixAction {
  operationId: OperationId;
  params: Record<string, unknown>;
  labelAr: string;
  /** Reversal, when the action is reversible. */
  revert?: { operationId: OperationId; params: Record<string, unknown> };
}

export interface SmartFixPlan {
  id: string;
  titleAr: string;
  /** The problem detected, in plain language. */
  problemAr: string;
  /** Why it was detected (numbers, evidence). */
  analysisAr: string;
  /** The concrete recommendation shown with an [تطبيق الحل] button. */
  recommendationAr: string;
  impactAr?: string;
  confidence: SmartFixConfidence;
  actions: SmartFixAction[];
  needsConfirmation: boolean;
  /** Set when the plan can only be completed with user input. */
  requiresInput?: { key: string; labelAr: string; type: 'text' | 'password'; placeholder?: string };
  steps: SmartFixStep[];
}

export interface SmartFixApplyResult {
  planId: string;
  ok: boolean;
  verified: boolean;
  results: OperationResult[];
  messageAr: string;
  steps: SmartFixStep[];
}

export interface SmartFixAnalysisInput {
  intent:
    | 'slow-internet'
    | 'block-device'
    | 'top-consumer'
    | 'change-wifi-password'
    | 'weak-security'
    | 'channel-congestion'
    | 'restart-router'
    | 'guest-network'
    | 'speed-issue-device';
  /** Target device MAC (when the intent is device-scoped). */
  targetMac?: string;
  targetName?: string;
  /** Latest measured rates (kbps) for the network. */
  totalDownKbps?: number;
  totalUpKbps?: number;
  /** Devices with per-device usage, ordered by consumption. */
  deviceUsage?: Array<{ mac: string; name: string; downKbps: number; upKbps: number; sharePercent: number }>;
  latencyMs?: number;
  packetLossPct?: number;
  neighbors?: WifiNeighbor[];
  currentChannel?: number;
  band?: '2.4GHz' | '5GHz';
  newPassword?: string;
  /** Which operations this router actually supports. */
  support: (capability: string) => boolean;
  /** Does the router expose per-device bandwidth limits? */
  canLimitPerDevice: boolean;
}

export class SmartFixEngine {
  /**
   * Detect + Analyze + Recommend. Pure function: no network side effects.
   */
  static analyze(input: SmartFixAnalysisInput): SmartFixPlan[] {
    const plans: SmartFixPlan[] = [];

    switch (input.intent) {
      case 'slow-internet': {
        const top = input.deviceUsage?.[0];
        if (top && top.sharePercent >= 35 && input.canLimitPerDevice) {
          const suggested = suggestLimit(input.totalDownKbps ?? 0, top.sharePercent);
          plans.push({
            id: `limit-${top.mac}`,
            titleAr: `تحديد سرعة ${top.name}`,
            problemAr: `جهاز ${top.name} يستهلك ${top.sharePercent.toFixed(0)}% من سرعة الشبكة.`,
            analysisAr: `الاستهلاك الحالي للجهاز ${formatKbps(top.downKbps)} تحميل و${formatKbps(top.upKbps)} رفع — أي ${top.sharePercent.toFixed(0)}% من إجمالي ${formatKbps(input.totalDownKbps ?? 0)}.`,
            recommendationAr: `تحديد السرعة إلى ${suggested} Mbps للجهاز ${top.name}.`,
            impactAr: 'سيستمر الجهاز في العمل لكن دون أن يستهلك كل السرعة.',
            confidence: top.sharePercent >= 60 ? 'high' : 'medium',
            actions: [
              {
                operationId: 'device.limit_bandwidth',
                params: { mac: top.mac, downKbps: suggested * 1000, upKbps: Math.round(suggested * 1000 * 0.25) },
                labelAr: `تحديد ${suggested} Mbps`,
                revert: { operationId: 'device.clear_limit', params: { mac: top.mac } },
              },
            ],
            needsConfirmation: false,
            steps: baseSteps(),
          });
        } else if (input.latencyMs !== undefined && input.latencyMs > 120) {
          plans.push({
            id: 'high-latency-dns',
            titleAr: 'تحسين استجابة الإنترنت',
            problemAr: 'زمن الاستجابة (Ping) مرتفع.',
            analysisAr: `متوسط زمن الاستجابة ${Math.round(input.latencyMs)} ms — القيم الطبيعية أقل من 60 ms.`,
            recommendationAr: 'تغيير DNS إلى مزود أسرع (Cloudflare 1.1.1.1 أو Google 8.8.8.8).',
            confidence: 'medium',
            actions: [
              {
                operationId: 'dns.set',
                params: { primary: '1.1.1.1', secondary: '1.0.0.1' },
                labelAr: 'تطبيق DNS سريع',
                revert: { operationId: 'dns.set', params: { primary: 'auto', secondary: 'auto' } },
              },
            ],
            needsConfirmation: true,
            steps: baseSteps(),
          });
        } else {
          plans.push({
            id: 'diagnose-slow',
            titleAr: 'تشخيص بطء الإنترنت',
            problemAr: 'لم يتم اكتشاف سبب واضح للبطء من الراوتر.',
            analysisAr: `إجمالي السرعة ${formatKbps(input.totalDownKbps ?? 0)}، عدد الأجهزة النشطة ${input.deviceUsage?.length ?? 0}.`,
            recommendationAr: 'ننصح بإجراء اختبار سرعة، ثم مراجعة الأجهزة الأكثر استهلاكًا.',
            confidence: 'low',
            actions: [],
            needsConfirmation: false,
            steps: baseSteps(),
          });
        }
        break;
      }

      case 'speed-issue-device': {
        if (!input.targetMac) break;
        const suggested = suggestLimit(input.totalDownKbps ?? 20_000, 50);
        plans.push({
          id: `limit-${input.targetMac}`,
          titleAr: `تحديد سرعة ${input.targetName ?? 'الجهاز'}`,
          problemAr: 'عند تشغيل هذا الجهاز تنخفض سرعة باقي الشبكة.',
          analysisAr: input.totalDownKbps
            ? `إجمالي السرعة المكتشفة ${formatKbps(input.totalDownKbps)}؛ تحديد حد للجهاز يمنعه من استهلاك الشبكة بالكامل.`
            : 'لم نتمكن من قراءة إجمالي السرعة من الراوتر، وسيتم استخدام قيمة آمنة.',
          recommendationAr: `تحديد السرعة إلى ${suggested} Mbps للجهاز.`,
          confidence: 'medium',
          actions: [
            {
              operationId: 'device.limit_bandwidth',
              params: { mac: input.targetMac, downKbps: suggested * 1000, upKbps: Math.round(suggested * 1000 * 0.25) },
              labelAr: `تحديد ${suggested} Mbps`,
              revert: { operationId: 'device.clear_limit', params: { mac: input.targetMac } },
            },
          ],
          needsConfirmation: false,
          steps: baseSteps(),
        });
        break;
      }

      case 'block-device': {
        if (!input.targetMac) break;
        plans.push({
          id: `block-${input.targetMac}`,
          titleAr: `إيقاف الإنترنت عن ${input.targetName ?? 'الجهاز'}`,
          problemAr: 'طلب المستخدم إيقاف الإنترنت عن جهاز محدد.',
          analysisAr: input.support('device_block')
            ? 'الراوتر يدعم حجب الأجهزة (قائمة MAC filter).'
            : 'هذا الراوتر لا يدعم حجب الأجهزة من الواجهة المتاحة.',
          recommendationAr: input.support('device_block')
            ? `حجب الجهاز ${input.targetName ?? input.targetMac} من الاتصال بالإنترنت.`
            : 'الوظيفة غير مدعومة على هذا الراوتر.',
          confidence: input.support('device_block') ? 'high' : 'low',
          actions: input.support('device_block')
            ? [
                {
                  operationId: 'device.block',
                  params: { mac: input.targetMac, blocked: true },
                  labelAr: 'إيقاف الإنترنت',
                  revert: { operationId: 'device.unblock', params: { mac: input.targetMac, blocked: false } },
                },
              ]
            : [],
          needsConfirmation: false,
          steps: baseSteps(),
        });
        break;
      }

      case 'top-consumer': {
        const top = input.deviceUsage?.[0];
        plans.push({
          id: 'top-consumer-report',
          titleAr: 'الأجهزة الأكثر استهلاكًا',
          problemAr: top
            ? `${top.name} هو الأكثر استهلاكًا حاليًا (${top.sharePercent.toFixed(0)}%).`
            : 'لا توجد بيانات استهلاك لكل جهاز على هذا الراوتر.',
          analysisAr: (input.deviceUsage ?? [])
            .slice(0, 4)
            .map((device) => `${device.name}: ${formatKbps(device.downKbps)} (${device.sharePercent.toFixed(0)}%)`)
            .join(' · ') || 'الراوتر لا يوفّر إحصاءات لكل جهاز.',
          recommendationAr: top ? `يمكنك تحديد سرعة ${top.name} للحد من استهلاكه.` : 'استخدم اختبار السرعة لقياس الأداء الحالي.',
          confidence: top ? 'high' : 'low',
          actions:
            top && input.canLimitPerDevice
              ? [
                  {
                    operationId: 'device.limit_bandwidth',
                    params: { mac: top.mac, downKbps: suggestLimit(input.totalDownKbps ?? 0, top.sharePercent) * 1000 },
                    labelAr: 'تحديد السرعة',
                  },
                ]
              : [],
          needsConfirmation: false,
          steps: baseSteps(),
        });
        break;
      }

      case 'weak-security': {
        plans.push({
          id: 'wifi-security',
          titleAr: 'تحسين حماية الواي فاي',
          problemAr: 'حماية الشبكة ضعيفة أو مفتوحة.',
          analysisAr: 'التشفير الحالي لا يحمي الشبكة بشكل كافٍ.',
          recommendationAr: 'تفعيل WPA2/WPA3 مع كلمة مرور قوية.',
          confidence: 'high',
          actions: [
            {
              operationId: 'wifi.set_security',
              params: { security: 'WPA2-PSK', band: input.band ?? '2.4GHz' },
              labelAr: 'تفعيل WPA2',
            },
          ],
          needsConfirmation: true,
          steps: baseSteps(),
        });
        break;
      }

      case 'change-wifi-password': {
        const password = input.newPassword;
        if (!password) {
          plans.push({
            id: 'wifi-password-input',
            titleAr: 'تغيير كلمة مرور الواي فاي',
            problemAr: 'لا يمكن تغيير كلمة المرور بدون قيمة جديدة.',
            analysisAr: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.',
            recommendationAr: 'اكتب كلمة المرور الجديدة ثم اضغط تطبيق.',
            confidence: 'high',
            actions: [],
            needsConfirmation: true,
            requiresInput: { key: 'newPassword', labelAr: 'كلمة المرور الجديدة', type: 'password', placeholder: '8 أحرف على الأقل' },
            steps: baseSteps(),
          });
        } else {
          plans.push({
            id: 'wifi-password',
            titleAr: 'تغيير كلمة مرور الواي فاي',
            problemAr: 'تم طلب تغيير كلمة مرور الشبكة.',
            analysisAr: 'سيتم فصل الأجهزة المتصلة وستحتاج لإعادة الاتصال بكلمة المرور الجديدة.',
            recommendationAr: 'تطبيق كلمة المرور الجديدة والتحقق من قبول الراوتر لها.',
            confidence: 'high',
            actions: [
              {
                operationId: 'wifi.set_password',
                params: { password, band: input.band ?? '2.4GHz' },
                labelAr: 'تطبيق كلمة المرور',
              },
            ],
            needsConfirmation: true,
            steps: baseSteps(),
          });
        }
        break;
      }

      case 'channel-congestion': {
        const suggestion = suggestChannel(input.neighbors ?? [], input.band ?? '2.4GHz', input.currentChannel);
        plans.push({
          id: 'wifi-channel',
          titleAr: 'تقليل ازدحام القناة',
          problemAr: `القناة الحالية (${input.currentChannel ?? '؟'}) مزدحمة بالشبكات المجاورة.`,
          analysisAr: suggestion.analysisAr,
          recommendationAr: `الانتقال إلى القناة ${suggestion.channel}.`,
          confidence: suggestion.confidence,
          actions: [
            {
              operationId: 'wifi.set_channel',
              params: { channel: suggestion.channel, band: input.band ?? '2.4GHz' },
              labelAr: `تغيير القناة إلى ${suggestion.channel}`,
            },
          ],
          needsConfirmation: false,
          steps: baseSteps(),
        });
        break;
      }

      case 'restart-router': {
        plans.push({
          id: 'reboot',
          titleAr: 'إعادة تشغيل الراوتر',
          problemAr: 'كثير من مشاكل البطء تُحل بإعادة تشغيل الراوتر.',
          analysisAr: input.latencyMs !== undefined ? `زمن الاستجابة الحالي ${Math.round(input.latencyMs)} ms.` : 'لم يتم قياس زمن الاستجابة.',
          recommendationAr: 'إعادة تشغيل الراوتر — سيتم قطع الاتصال لمدة دقيقة تقريبًا.',
          confidence: 'medium',
          actions: [{ operationId: 'router.reboot', params: {}, labelAr: 'إعادة التشغيل' }],
          needsConfirmation: true,
          steps: baseSteps(),
        });
        break;
      }

      case 'guest-network': {
        plans.push({
          id: 'guest-network',
          titleAr: 'شبكة الزوار',
          problemAr: 'شبكة الزوار توفّر إنترنت للضيوف بدون الوصول إلى شبكتك الأساسية.',
          analysisAr: input.support('guest_network') ? 'الراوتر يدعم شبكة الزوار.' : 'الراوتر لا يعرض إعداد شبكة الزوار.',
          recommendationAr: input.support('guest_network') ? 'تفعيل شبكة زوار منفصلة عن شبكتك الأساسية.' : 'الوظيفة غير مدعومة على هذا الراوتر.',
          confidence: input.support('guest_network') ? 'high' : 'low',
          actions: input.support('guest_network')
            ? [{ operationId: 'wifi.set_guest_network', params: { enabled: true }, labelAr: 'تفعيل شبكة الزوار' }]
            : [],
          needsConfirmation: false,
          steps: baseSteps(),
        });
        break;
      }
    }

    return plans;
  }

  /**
   * Confirm → Apply → Verify. Executes real operations through the engine and
   * verifies each of them; the caller only reports success when `verified`.
   */
  static async apply(
    plan: SmartFixPlan,
    engine: UniversalRouterEngine,
    onStep?: (steps: SmartFixStep[]) => void,
  ): Promise<SmartFixApplyResult> {
    const steps = plan.steps.map((step) => ({ ...step }));
    const results: OperationResult[] = [];
    const update = () => onStep?.(steps.map((step) => ({ ...step })));

    const setStage = (stage: SmartFixStep['stage'], status: SmartFixStep['status']) => {
      const step = steps.find((entry) => entry.stage === stage);
      if (step) step.status = status;
      update();
    };

    setStage('detect', 'done');
    setStage('analyze', 'done');
    setStage('recommend', 'done');

    if (plan.actions.length === 0) {
      setStage('apply', 'skipped');
      setStage('verify', 'skipped');
      return {
        planId: plan.id,
        ok: false,
        verified: false,
        results,
        messageAr: plan.recommendationAr,
        steps,
      };
    }

    setStage('confirm', plan.needsConfirmation && !requiresConfirmation(plan.actions[0]!.operationId) ? 'done' : 'done');
    setStage('apply', 'running');

    for (const action of plan.actions) {
      const result = await engine.execute({ id: action.operationId, params: action.params, confirmed: true });
      results.push(result);
      if (!result.ok) {
        setStage('apply', 'failed');
        setStage('verify', 'skipped');
        return {
          planId: plan.id,
          ok: false,
          verified: false,
          results,
          messageAr: result.message,
          steps,
        };
      }
    }
    setStage('apply', 'done');
    setStage('verify', results.every((result) => result.verified) ? 'done' : 'failed');

    const verified = results.every((result) => result.verified);
    const anyAccepted = results.some((result) => result.ok);
    return {
      planId: plan.id,
      ok: anyAccepted,
      verified,
      results,
      messageAr: verified
        ? '✓ تم تطبيق الحل بنجاح والتحقق من الإعداد الجديد.'
        : anyAccepted
          ? 'تم إرسال التغيير وقبله الراوتر، لكن هذا الطراز لا يسمح بقراءة القيمة للتأكيد.'
          : 'لم يتم تطبيق التغيير.',
      steps,
    };
  }

  /** Pick the most useful plan for a free-form problem statement. */
  static best(plans: SmartFixPlan[]): SmartFixPlan | undefined {
    const weight = (plan: SmartFixPlan): number => {
      const confidenceScore = plan.confidence === 'high' ? 3 : plan.confidence === 'medium' ? 2 : 1;
      return confidenceScore * 10 + plan.actions.length * 4 + (plan.needsConfirmation ? 0 : 1);
    };
    return [...plans].sort((a, b) => weight(b) - weight(a))[0];
  }
}

/* ------------------------------------------------------------------ */

function baseSteps(): SmartFixStep[] {
  return [
    { stage: 'detect', descriptionAr: 'فحص الحالة الحالية', status: 'pending' },
    { stage: 'analyze', descriptionAr: 'تحليل البيانات', status: 'pending' },
    { stage: 'recommend', descriptionAr: 'تحديد الحل المقترح', status: 'pending' },
    { stage: 'confirm', descriptionAr: 'تأكيد المستخدم', status: 'pending' },
    { stage: 'apply', descriptionAr: 'تطبيق التغيير على الراوتر', status: 'pending' },
    { stage: 'verify', descriptionAr: 'التحقق من الإعداد الجديد', status: 'pending' },
  ];
}

function suggestLimit(totalDownKbps: number, sharePercent: number): number {
  if (!totalDownKbps || totalDownKbps <= 0) return 10;
  const fairShare = totalDownKbps / Math.max(2, Math.ceil(sharePercent / 15));
  const mbps = fairShare / 1000;
  return Math.max(2, Math.min(100, Math.round(mbps)));
}

function suggestChannel(
  neighbors: WifiNeighbor[],
  band: '2.4GHz' | '5GHz',
  currentChannel?: number,
): { channel: number; analysisAr: string; confidence: SmartFixConfidence } {
  const channels = band === '2.4GHz' ? [1, 6, 11] : [36, 40, 44, 48, 149, 153, 157, 161];
  const congestion = new Map<number, number>();
  for (const channel of channels) congestion.set(channel, 0);
  for (const neighbor of neighbors) {
    if (neighbor.band !== band) continue;
    // Only overlapping channels truly interfere on 2.4 GHz.
    for (const channel of channels) {
      const distance = Math.abs(channel - neighbor.channel);
      if (band === '5GHz' ? distance <= 4 : distance <= 4) {
        const weight = Math.max(0, 5 - distance) * (1 + (100 + neighbor.signalDbm) / 100);
        congestion.set(channel, (congestion.get(channel) ?? 0) + weight);
      }
    }
  }
  if (currentChannel) congestion.set(currentChannel, (congestion.get(currentChannel) ?? 0) + 3);
  const best = [...congestion.entries()].sort((a, b) => a[1] - b[1])[0];
  const busy = neighbors.filter((neighbor) => neighbor.band === band).length;
  return {
    channel: best?.[0] ?? (band === '2.4GHz' ? 6 : 36),
    analysisAr: `تم رصد ${busy} شبكة مجاورة على نطاق ${band}. القناة ${best?.[0]} هي الأقل ازدحامًا حاليًا.`,
    confidence: busy >= 4 ? 'high' : 'medium',
  };
}
