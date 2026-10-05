/**
 * Smart Assistant (spec §12).
 *
 * Understands Egyptian-Arabic problem statements such as:
 *   "النت بطيء"            → slow-internet
 *   "عايز أقفل النت عن الجهاز ده" → block-device (+ device resolution)
 *   "مين أكتر جهاز بيستهلك النت؟" → top-consumer
 *   "عايز أغير باسورد الواي فاي"  → change-wifi-password
 *
 * The assistant only *recommends*; applying anything goes through SmartFixEngine
 * and the verification engine.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

import type { DeviceRecord, WifiNeighbor } from '../core/types';
import { normalizeArabic, similarity } from '../core/util';
import { SmartFixEngine, type SmartFixAnalysisInput, type SmartFixPlan } from './engine';

export type AssistantIntent = SmartFixAnalysisInput['intent'] | 'unknown' | 'help' | 'status';

export interface AssistantContext {
  devices: DeviceRecord[];
  support: (capability: string) => boolean;
  canLimitPerDevice: boolean;
  totalDownKbps?: number;
  totalUpKbps?: number;
  latencyMs?: number;
  packetLossPct?: number;
  neighbors?: WifiNeighbor[];
  currentChannel?: number;
  band?: '2.4GHz' | '5GHz';
}

export interface AssistantReply {
  intent: AssistantIntent;
  /** Arabic message shown in the chat bubble. */
  messageAr: string;
  plan?: SmartFixPlan;
  /** Additional candidate plans (the UI may show them as alternatives). */
  alternatives?: SmartFixPlan[];
  /** Set when the assistant needs a decision from the user. */
  choices?: Array<{ labelAr: string; action: 'select-device' | 'select-plan'; value: string }>;
  /** Set when the assistant needs a value (e.g. the new password). */
  askFor?: { key: string; labelAr: string; type: 'text' | 'password' };
  /** Confidence in the parsed intent (0..1) — low values ask a clarifying question. */
  confidence: number;
}

interface IntentPattern {
  intent: AssistantIntent;
  /** Keyword groups; a group counts when any of its words is present. */
  groups: string[][];
  /** Extra weight when several groups hit. */
  weight: number;
}

const PATTERNS: IntentPattern[] = [
  {
    intent: 'slow-internet',
    weight: 3,
    groups: [
      ['نت', 'انترنت', 'الشبكه', 'الواي', 'wifi', 'internet'],
      ['بطيء', 'بطئ', 'بطي', 'بطيئه', 'slow', 'ضعيف', 'تقطيع', 'بيهنج', 'بيقطع'],
    ],
  },
  {
    intent: 'block-device',
    weight: 3,
    groups: [
      ['اقفل', 'اقفل', 'اوقف', 'احجب', 'امنع', 'اقطع', 'block', 'kick'],
      ['نت', 'انترنت', 'الشبكه', 'واي', 'wifi', 'device', 'الجهاز'],
    ],
  },
  {
    intent: 'top-consumer',
    weight: 3,
    groups: [
      ['مين', 'اكتر', 'اكثر', 'الاكثر', 'most', 'top', 'who'],
      ['استهلاك', 'بيسحب', 'بيستهلك', 'تحميل', 'داونلود', 'download', 'بياخد'],
    ],
  },
  {
    intent: 'change-wifi-password',
    weight: 3,
    groups: [
      ['باسورد', 'باسوورد', 'كلمه', 'مرور', 'password', 'pass'],
      ['واي', 'wifi', 'الشبكه', 'الراوتر', 'اغير', 'تغيير', 'change'],
    ],
  },
  {
    intent: 'weak-security',
    weight: 2,
    groups: [
      ['امان', 'حمايه', 'امن', 'security', 'secure', 'مفتوحه', 'مكشوفه'],
      ['واي', 'wifi', 'الشبكه', 'شبكتي'],
    ],
  },
  {
    intent: 'channel-congestion',
    weight: 2,
    groups: [
      ['قناه', 'قناة', 'channel', 'تشويش', 'تداخل', 'congestion'],
      [],
    ],
  },
  {
    intent: 'restart-router',
    weight: 2,
    groups: [
      ['رست', 'اعاده', 'اعيد', 'ريبوت', 'reboot', 'restart', 'اقفل وافتح'],
      ['راوتر', 'router', 'الجهاز'],
    ],
  },
  {
    intent: 'speed-issue-device',
    weight: 2,
    groups: [
      ['جهاز', 'device', 'موبايل', 'لابتوب', 'كمبيوتر'],
      ['بيسحب', 'بيستهلك', 'بيسرع', 'بطيء', 'حدد', 'limit'],
    ],
  },
  {
    intent: 'guest-network',
    weight: 2,
    groups: [
      ['زوار', 'guest', 'ضيوف', 'للضيوف'],
      [],
    ],
  },
];

const HELP_WORDS = ['مساعده', 'help', 'بتعمل ايه', 'ازاي استخدم', 'ممكن تعمل ايه'];
const STATUS_WORDS = ['حاله', 'status', 'الوضع', 'ملخص', 'اخبار الشبكه'];

export class SmartAssistant {
  /** Parse the user's text into an intent + device/plan recommendation. */
  static respond(text: string, context: AssistantContext): AssistantReply {
    const normalized = normalizeArabic(text);
    if (!normalized) {
      return { intent: 'unknown', confidence: 0, messageAr: 'اكتب مشكلتك بالعامية، مثال: «النت بطيء».' };
    }

    if (HELP_WORDS.some((word) => normalized.includes(normalizeArabic(word)))) {
      return {
        intent: 'help',
        confidence: 1,
        messageAr:
          'أنا أساعدك في:\n• بطء الإنترنت ومعرفة السبب\n• إيقاف الإنترنت عن جهاز معيّن\n• معرفة أكثر جهاز يستهلك الشبكة\n• تغيير اسم أو كلمة مرور الواي فاي\n• تحسين حماية الشبكة وتقليل ازدحام القناة',
      };
    }
    if (STATUS_WORDS.some((word) => normalized.includes(normalizeArabic(word)))) {
      return {
        intent: 'status',
        confidence: 0.9,
        messageAr: SmartAssistant.statusSummary(context),
      };
    }

    const scored = PATTERNS.map((pattern) => {
      let hits = 0;
      for (const group of pattern.groups) {
        if (group.length === 0) continue;
        const hit = group.some((word) => normalized.includes(normalizeArabic(word)));
        if (hit) hits += 1;
      }
      const required = pattern.groups.filter((group) => group.length > 0).length;
      const ratio = required === 0 ? 0 : hits / required;
      return { pattern, score: hits === 0 ? 0 : ratio * pattern.weight };
    })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score < 1.2) {
      const close = closestIntent(normalized);
      return {
        intent: close ?? 'unknown',
        confidence: close ? 0.4 : 0.1,
        messageAr: close
          ? `هل تقصد: «${describeIntent(close)}»؟ اكتبها بشكل أوضح لو مش كده.`
          : 'مش فاهم الطلب بالضبط. جرّب: «النت بطيء» أو «عايز أقفل النت عن الجهاز» أو «غيّر باسورد الواي فاي».',
      };
    }

    const intent = best.pattern.intent;
    const targetDevice = resolveDevice(normalized, context.devices);

    if ((intent === 'block-device' || intent === 'speed-issue-device') && !targetDevice) {
      const named = context.devices.slice(0, 6);
      if (named.length === 0) {
        return {
          intent,
          confidence: 0.5,
          messageAr: 'مفيش أجهزة معروفة حاليًا. افتح صفحة الأجهزة الأول وبعدين جرّب تاني.',
        };
      }
      return {
        intent,
        confidence: 0.6,
        messageAr: 'أي جهاز تقصد؟ اختر من الأجهزة المتصلة:',
        choices: named.map((device) => ({
          labelAr: `${device.name} (${device.ip || device.mac})`,
          action: 'select-device' as const,
          value: device.mac,
        })),
      };
    }

    const analysisInput: SmartFixAnalysisInput = {
      intent: intent as SmartFixAnalysisInput['intent'],
      targetMac: targetDevice?.mac,
      targetName: targetDevice?.name,
      totalDownKbps: context.totalDownKbps,
      totalUpKbps: context.totalUpKbps,
      latencyMs: context.latencyMs,
      packetLossPct: context.packetLossPct,
      neighbors: context.neighbors,
      currentChannel: context.currentChannel,
      band: context.band,
      support: context.support,
      canLimitPerDevice: context.canLimitPerDevice,
      deviceUsage: buildUsage(context),
    };

    const plans = SmartFixEngine.analyze(analysisInput);
    const plan = SmartFixEngine.best(plans);

    if (!plan) {
      return {
        intent,
        confidence: best.score / 3,
        messageAr: 'لقيت طلبك بس مفيش إجراء مناسب متاح على الراوتر ده. جرّب التشخيص في الوضع المتقدم.',
      };
    }

    const requiresInput = plan.requiresInput;
    return {
      intent,
      confidence: Math.min(1, best.score / 3),
      messageAr: `${plan.analysisAr}\n\n💡 الحل المقترح:\n${plan.recommendationAr}${plan.impactAr ? `\n${plan.impactAr}` : ''}`,
      // The plan always travels with the reply: it is what states honestly
      // whether anything can be applied on this router.
      plan,
      alternatives: plans.filter((entry) => entry.id !== plan.id).slice(0, 3),
      askFor: requiresInput,
    };
  }

  static statusSummary(context: AssistantContext): string {
    const lines = [
      `📱 الأجهزة المتصلة: ${context.devices.length}`,
      context.totalDownKbps ? `⬇️ التحميل الحالي: ${(context.totalDownKbps / 1000).toFixed(1)} Mbps` : '⬇️ لا توجد قراءة سرعة حاليًا',
      context.latencyMs !== undefined ? `📡 زمن الاستجابة: ${Math.round(context.latencyMs)} ms` : '📡 لم يتم قياس زمن الاستجابة بعد',
    ];
    const blocked = context.devices.filter((device) => device.blocked).length;
    if (blocked > 0) lines.push(`🚫 أجهزة موقوفة: ${blocked}`);
    return lines.join('\n');
  }
}

/* ------------------------------------------------------------------ */

function buildUsage(context: AssistantContext): SmartFixAnalysisInput['deviceUsage'] {
  const devices = context.devices;
  const hasLiveRates = devices.some((device) => (device.rateDownKbps ?? 0) > 0 || (device.rateUpKbps ?? 0) > 0);
  const total = context.totalDownKbps ?? devices.reduce((sum, device) => sum + (device.rateDownKbps ?? 0), 0);

  // Fall back to accumulated usage when the router exposes no live rates —
  // the "top consumer" answer stays truthful either way.
  const weight = (device: (typeof devices)[number]): { down: number; up: number } =>
    hasLiveRates
      ? { down: device.rateDownKbps ?? 0, up: device.rateUpKbps ?? 0 }
      : { down: device.usageKb ?? 0, up: 0 };

  const totalWeight = devices.reduce((sum, device) => {
    const value = weight(device);
    return sum + value.down + value.up;
  }, 0);

  return devices
    .map((device) => {
      const value = weight(device);
      return {
        mac: device.mac,
        name: device.name,
        downKbps: value.down,
        upKbps: value.up,
        sharePercent: totalWeight > 0 ? ((value.down + value.up) / totalWeight) * 100 : 0,
      };
    })
    .filter((entry) => entry.downKbps > 0 || entry.upKbps > 0)
    .sort((a, b) => b.downKbps - a.downKbps);
}

function resolveDevice(normalized: string, devices: DeviceRecord[]): DeviceRecord | undefined {
  if (devices.length === 0) return undefined;
  // "الجهاز ده" / "this device" refers to the most recently seen unknown/likely
  // offender — the busiest device is the most useful interpretation.
  const explicit = devices.find((device) => {
    const name = normalizeArabic(device.name);
    return name.length > 2 && normalized.includes(name);
  });
  if (explicit) return explicit;
  const byIp = devices.find((device) => device.ip && normalized.includes(device.ip));
  if (byIp) return byIp;
  if (/(ده|دي|هذا|this)/.test(normalized)) {
    return [...devices].sort((a, b) => (b.rateDownKbps ?? b.usageKb ?? 0) - (a.rateDownKbps ?? a.usageKb ?? 0))[0];
  }
  const fuzzy = devices
    .map((device) => ({ device, score: similarity(normalized, normalizeArabic(device.name)) }))
    .sort((a, b) => b.score - a.score)[0];
  return fuzzy && fuzzy.score > 0.55 ? fuzzy.device : undefined;
}

function closestIntent(normalized: string): AssistantIntent | undefined {
  const candidates: Array<[AssistantIntent, string]> = [
    ['slow-internet', 'النت بطيء'],
    ['block-device', 'اقفل النت عن جهاز'],
    ['top-consumer', 'مين اكتر جهاز بيستهلك النت'],
    ['change-wifi-password', 'اغير باسورد الواي فاي'],
    ['weak-security', 'حمايه الواي فاي'],
    ['channel-congestion', 'ازدحام القناه'],
    ['restart-router', 'اعاده تشغيل الراوتر'],
    ['guest-network', 'شبكه الزوار'],
  ];
  const scored = candidates
    .map(([intent, phrase]) => ({ intent, score: similarity(normalized, normalizeArabic(phrase)) }))
    .sort((a, b) => b.score - a.score)[0];
  return scored && scored.score > 0.3 ? scored.intent : undefined;
}

function describeIntent(intent: AssistantIntent): string {
  switch (intent) {
    case 'slow-internet':
      return 'النت بطيء';
    case 'block-device':
      return 'عايز أقفل النت عن جهاز';
    case 'top-consumer':
      return 'مين أكتر جهاز بيستهلك النت';
    case 'change-wifi-password':
      return 'عايز أغير باسورد الواي فاي';
    case 'weak-security':
      return 'حماية الواي فاي ضعيفة';
    case 'channel-congestion':
      return 'الشبكات المجاورة بتزحم القناة';
    case 'restart-router':
      return 'عايز أعيد تشغيل الراوتر';
    case 'guest-network':
      return 'عايز أشغّل شبكة زوار';
    default:
      return String(intent);
  }
}
