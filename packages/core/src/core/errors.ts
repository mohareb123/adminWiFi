/**
 * Error model + Error UX mapping (spec §41).
 * User-facing messages are Arabic-first; technical detail stays available for
 * Advanced Mode without ever leaking into Simple Mode.
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

export type RouterErrorCode =
  | 'network-unreachable'
  | 'timeout'
  | 'tls-error'
  | 'auth-required'
  | 'auth-failed'
  | 'session-expired'
  | 'captcha-required'
  | 'unsupported-operation'
  | 'adapter-missing'
  | 'not-authenticated'
  | 'invalid-params'
  | 'device-rejected'
  | 'verification-failed'
  | 'rate-limited'
  | 'bridge-offline'
  | 'bridge-forbidden'
  | 'parse-error'
  | 'cancelled'
  | 'unknown';

export interface ErrorCopy {
  /** Simple Mode copy: plain language, actionable. */
  friendly: string;
  /** One-line suggestion, optional. */
  hint?: string;
}

const COPY: Record<RouterErrorCode, ErrorCopy> = {
  'network-unreachable': {
    friendly: 'تعذر الوصول إلى الراوتر.',
    hint: 'تأكد أنك متصل بشبكة الواي فاي الخاصة بالراوتر.',
  },
  timeout: {
    friendly: 'الراوتر لم يستجب في الوقت المتوقع.',
    hint: 'حاول مرة أخرى، أو أعد تشغيل الراوتر إذا تكرر الأمر.',
  },
  'tls-error': {
    friendly: 'اتصال الإدارة الآمن (HTTPS) به شهادة غير موثوقة.',
    hint: 'جرّب الاتصال عبر HTTP من الإعدادات المتقدمة.',
  },
  'auth-required': {
    friendly: 'هذا الراوتر يحتاج تسجيل الدخول.',
    hint: 'أدخل اسم المستخدم وكلمة المرور.',
  },
  'auth-failed': {
    friendly: 'تعذر تسجيل الدخول.',
    hint: 'تأكد من اسم المستخدم وكلمة المرور.',
  },
  'session-expired': {
    friendly: 'انتهت جلسة الدخول.',
    hint: 'سيتم تسجيل الدخول مرة أخرى تلقائيًا.',
  },
  'captcha-required': {
    friendly: 'الراوتر يطلب رمز تحقق (CAPTCHA) من صفحة الإدارة.',
    hint: 'افتح صفحة الراوتر وسجّل الدخول مرة واحدة، ثم أعد المحاولة.',
  },
  'unsupported-operation': {
    friendly: 'غير مدعوم على هذا الراوتر.',
    hint: 'هذه الوظيفة غير متاحة في واجهة إدارة جهازك.',
  },
  'adapter-missing': {
    friendly: 'لا يوجد تعريف مخصص لهذا الراوتر بعد.',
    hint: 'سيتم استخدام المحرك العام (Generic) للوظائف المدعومة.',
  },
  'not-authenticated': {
    friendly: 'يجب تسجيل الدخول للراوتر أولًا.',
  },
  'invalid-params': {
    friendly: 'القيم المدخلة غير مقبولة.',
    hint: 'راجع القيم وحاول مرة أخرى.',
  },
  'device-rejected': {
    friendly: 'الراوتر رفض التغيير.',
    hint: 'قد تكون القيمة غير مسموح بها في هذا الطراز.',
  },
  'verification-failed': {
    friendly: 'لم يتم تطبيق التغيير.',
    hint: 'تم إرسال الطلب لكن الراوتر لم يقر بالإعداد الجديد.',
  },
  'rate-limited': {
    friendly: 'الراوتر يحد من عدد الطلبات.',
    hint: 'انتظر قليلًا ثم أعد المحاولة.',
  },
  'bridge-offline': {
    friendly: 'جسر الاتصال المحلي (Local Bridge) غير متصل.',
    hint: 'شغّل الجسر على جهاز موجود داخل الشبكة للوصول للراوتر الحقيقي.',
  },
  'bridge-forbidden': {
    friendly: 'الجسر المحلي رفض الطلب.',
    hint: 'الأمر مسموح فقط للأجهزة المحلية (localhost).',
  },
  'parse-error': {
    friendly: 'رد الراوتر غير متوقع.',
    hint: 'قد يكون هذا الطراز غير مدعوم بالكامل.',
  },
  cancelled: {
    friendly: 'تم إلغاء العملية.',
  },
  unknown: {
    friendly: 'حدث خطأ غير متوقع.',
    hint: 'جرّب مرة أخرى، وإذا استمر استخدم التشخيصات في الوضع المتقدم.',
  },
};

export interface RouterErrorOptions {
  status?: number;
  url?: string;
  cause?: unknown;
  detail?: string;
  technicalResponseSample?: string;
  retryable?: boolean;
}

export class RouterError extends Error {
  readonly code: RouterErrorCode;
  readonly status?: number;
  readonly url?: string;
  readonly detail?: string;
  readonly responseSample?: string;
  readonly retryable: boolean;
  /** Underlying error (never `Error.cause`, which is reserved). */
  readonly originalError?: unknown;

  constructor(code: RouterErrorCode, options: RouterErrorOptions = {}) {
    const copy = COPY[code];
    super(`${code}: ${copy.friendly}`);
    this.name = 'RouterError';
    this.code = code;
    this.status = options.status;
    this.url = options.url;
    this.detail = options.detail;
    this.responseSample = options.technicalResponseSample;
    this.originalError = options.cause;
    this.retryable = options.retryable ?? isRetryable(code, options.status);
  }

  /** Simple Mode presentation. */
  get copy(): ErrorCopy {
    return COPY[this.code];
  }

  /** Arabic-first message for Simple Mode. */
  get userMessage(): string {
    return this.copy.friendly;
  }

  get userHint(): string | undefined {
    return this.copy.hint;
  }

  /** Advanced Mode one-liner. */
  get technicalMessage(): string {
    const parts = [`${this.code}`];
    if (this.status) parts.push(`HTTP ${this.status}`);
    if (this.url) parts.push(this.url);
    if (this.detail) parts.push(this.detail);
    return parts.join(' · ');
  }

  toJSON() {
    return {
      code: this.code,
      userMessage: this.userMessage,
      technicalMessage: this.technicalMessage,
      status: this.status,
      url: this.url,
    };
  }
}

function isRetryable(code: RouterErrorCode, status?: number): boolean {
  if (code === 'timeout' || code === 'rate-limited' || code === 'network-unreachable') return true;
  if (code === 'session-expired') return true;
  if (status && status >= 500) return true;
  return false;
}

export function isRouterError(value: unknown): value is RouterError {
  return value instanceof RouterError;
}

/** Map an arbitrary thrown value into a RouterError. */
export function toRouterError(error: unknown, fallback: RouterErrorCode = 'unknown'): RouterError {
  if (isRouterError(error)) return error;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (error.name === 'AbortError') return new RouterError('cancelled', { cause: error });
    if (message.includes('fetch failed') || message.includes('econnrefused'))
      return new RouterError('network-unreachable', { cause: error, detail: error.message });
    if (message.includes('timed out') || message.includes('timeout'))
      return new RouterError('timeout', { cause: error, detail: error.message });
    if (message.includes('certificate') || message.includes('tls') || message.includes('ssl'))
      return new RouterError('tls-error', { cause: error, detail: error.message });
    return new RouterError(fallback, { cause: error, detail: error.message });
  }
  return new RouterError(fallback, { detail: String(error) });
}

/** HTTP status → error code mapping used by the HTTP client and adapters. */
export function errorCodeFromStatus(status: number): RouterErrorCode {
  if (status === 401) return 'auth-failed';
  if (status === 403 || status === 405) return 'bridge-forbidden';
  if (status === 404) return 'unsupported-operation';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'network-unreachable';
  return 'unknown';
}
