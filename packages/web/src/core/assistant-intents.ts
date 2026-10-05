/**
 * Arabic intent catalogue for the Smart Assistant.
 *
 * The bridge already exposes a real assistant (`/api/assistant`) that resolves
 * intents against the live snapshot. This catalogue gives the UI the same
 * vocabulary *offline-aware*: suggestion chips, quick actions and a deterministic
 * local fallback when the bridge is unreachable (offline-first, spec §44).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

export type AssistantIntent =
  | 'slow-internet'
  | 'device-count'
  | 'block-device'
  | 'top-consumer'
  | 'change-wifi-password'
  | 'wifi-info'
  | 'guest-network'
  | 'restart-router'
  | 'security-check'
  | 'unknown';

export interface IntentMatch {
  intent: AssistantIntent;
  /** 0..1 — how strongly the phrase matched. */
  score: number;
  /** MAC / SSID / hostname extracted from the phrase, when present. */
  target?: string;
}

/** Normalising Arabic: strip diacritics, unify alef/ya/ta-marbuta, drop tatweel. */
export function normaliseArabic(input: string): string {
  return input
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

interface IntentRule {
  intent: AssistantIntent;
  /** All keywords of a group must appear; groups are OR-ed together. */
  groups: string[][];
  weight?: number;
}

const RULES: IntentRule[] = [
  {
    intent: 'slow-internet',
    groups: [
      ['نت', 'بطي'],
      ['نت', 'ضعي'],
      ['نت', 'سي'],
      ['انترنت', 'بطي'],
      ['نت', 'مش', 'شغال'],
      ['نت', 'فصل'],
      ['نت', 'بيهنج'],
      ['لاج'],
      ['تقطيع', 'نت'],
      ['speed', 'slow'],
      ['internet', 'slow'],
      ['lag'],
    ],
    weight: 1,
  },
  {
    intent: 'block-device',
    groups: [
      ['اقفل', 'نت'],
      ['اوقف', 'نت'],
      ['اقفل', 'جهاز'],
      ['امنع', 'نت'],
      ['منع', 'جهاز'],
      ['احبس', 'جهاز'],
      ['block', 'device'],
      ['cut', 'internet'],
    ],
    weight: 1.05,
  },
  {
    intent: 'top-consumer',
    groups: [
      ['اكتر', 'جهاز', 'استهلاك'],
      ['اكثر', 'جهاز', 'استهلاك'],
      ['مين', 'بيستهلك'],
      ['استهلاك', 'نت'],
      ['اكتر', 'مستهلك'],
      ['top', 'consumer'],
      ['who', 'using', 'bandwidth'],
    ],
    weight: 1,
  },
  {
    intent: 'device-count',
    groups: [
      ['كام', 'جهاز'],
      ['عدد', 'الاجهزه'],
      ['الاجهزه', 'المتصل'],
      ['مين', 'متصل'],
      ['devices', 'connected'],
      ['how', 'many', 'devices'],
    ],
    weight: 0.95,
  },
  {
    intent: 'change-wifi-password',
    groups: [
      ['غير', 'باسورد', 'واي'],
      ['تغيير', 'باسورد', 'واي'],
      ['باسورد', 'الواي'],
      ['كلمه', 'سر', 'الواي'],
      ['باسورد', 'الوايفاي'],
      ['wifi', 'password'],
      ['change', 'wifi', 'password'],
    ],
    weight: 1.05,
  },
  {
    intent: 'wifi-info',
    groups: [
      ['اسم', 'شبكه'],
      ['بيانات', 'الواي'],
      ['معلومات', 'الواي'],
      ['wifi', 'info'],
      ['ssid'],
    ],
    weight: 0.9,
  },
  {
    intent: 'guest-network',
    groups: [
      ['شبكه', 'زوار'],
      ['شبكه', 'ضيوف'],
      ['guest', 'network'],
    ],
    weight: 0.95,
  },
  {
    intent: 'restart-router',
    groups: [
      ['اريح', 'الراوتر'],
      ['ارست', 'الراوتر'],
      ['اعمل', 'ريستارت'],
      ['اعاده', 'تشغيل', 'الراوتر'],
      ['restart', 'router'],
      ['reboot', 'router'],
    ],
    weight: 1,
  },
  {
    intent: 'security-check',
    groups: [
      ['امان', 'الشبكه'],
      ['حمايه', 'الشبكه'],
      ['في', 'اختراق'],
      ['في', 'هاكر'],
      ['security', 'check'],
      ['secure', 'network'],
    ],
    weight: 1,
  },
];

/**
 * Deterministic local intent match — used to render suggestions instantly while
 * the real answer is computed, and as the offline fallback. The engine result
 * always wins when the bridge answered.
 */
export function matchIntent(phrase: string): IntentMatch {
  const text = normaliseArabic(phrase);
  if (!text) return { intent: 'unknown', score: 0 };

  let best: IntentMatch = { intent: 'unknown', score: 0 };
  for (const rule of RULES) {
    for (const group of rule.groups) {
      if (!group.every((keyword) => text.includes(keyword))) continue;
      const coverage = group.join(' ').length / Math.max(1, text.length);
      const score = Math.min(1, (rule.weight ?? 1) * (0.55 + coverage * 0.45));
      if (score > best.score) best = { intent: rule.intent, score };
      break;
    }
  }

  const target = extractTarget(text);
  if (target) best.target = target;
  return best;
}

const MAC_PATTERN = /([0-9a-f]{2}:){5}[0-9a-f]{2}/i;

/** Device names, MAC addresses or SSIDs mentioned inside the phrase. */
function extractTarget(text: string): string | undefined {
  const mac = MAC_PATTERN.exec(text);
  if (mac) return mac[0].toLowerCase();
  return undefined;
}

/** The chips shown above the assistant composer — plain, friendly Arabic. */
export const ASSISTANT_SUGGESTIONS: Array<{ label: string; phrase: string; intent: AssistantIntent }> = [
  { label: 'النت بطيء', phrase: 'النت بطيء جدا', intent: 'slow-internet' },
  { label: 'مين بيستهلك النت؟', phrase: 'مين أكتر جهاز بيستهلك النت؟', intent: 'top-consumer' },
  { label: 'كام جهاز متصل؟', phrase: 'كام جهاز متصل بالشبكة؟', intent: 'device-count' },
  { label: 'اقفل النت عن جهاز', phrase: 'عايز أقفل النت عن الجهاز ده', intent: 'block-device' },
  { label: 'غيّر باسورد الواي فاي', phrase: 'عايز أغير باسورد الواي فاي', intent: 'change-wifi-password' },
  { label: 'افحص أمان الشبكة', phrase: 'افحص أمان الشبكة', intent: 'security-check' },
  { label: 'ريستارت الراوتر', phrase: 'عايز أعمل ريستارت للراوتر', intent: 'restart-router' },
  { label: 'شبكة الزوار', phrase: 'شغّل شبكة الزوار', intent: 'guest-network' },
];
