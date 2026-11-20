// تصنيف أخطاء المزودين — قلب نظام التبديل التسلسلي (قسم 4.2 من المواصفة)
import { maskKey } from "./turso";

export type ErrorClass = "disabled" | "exhausted" | "provider" | "params" | "temporary";

/** خطأ يرميه أي محول مزود مع حالة HTTP لصنّفه مركزيًا */
export class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** خطأ قواعد عمل عربي تظهر للعميل كما هي (مثل رفض الدمج بأقل من مقطعين) */
export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

/**
 * التصنيف الموحد للخطأ حسب جدول 4.2:
 * - disabled: مفتاح مرفوض (401/403 أو رسائل توثيق) → يُعلَّم disabled تلقائيًا
 * - exhausted: نفاد رصيد (402 أو رسائل رصيد) — يُفحص قبل 400 لأن بعض المزودين يرسلونه بحالة 400
 * - provider: الموديل غير مدعوم لدى هذا المزود → انتقل للتالي
 * - params: خطأ معطيات — توقف فورًا (تبديل المفاتيح لن يحله)
 * - temporary: 429/5xx/شبكة/timeout — انتقل للتالي والمفتاح يبقى سليمًا
 */
export function classifyProviderError(status: number, message: string): ErrorClass {
  const msg = (message || "").toLowerCase();
  if (status === 401 || status === 403 || /invalid api key|unauthorized|forbidden|authentication/.test(msg)) {
    return "disabled";
  }
  if (status === 402 || /insufficient|quota|balance|credit|out of credits|exhausted|充值/.test(msg)) {
    return "exhausted";
  }
  if ((status === 400 || status === 404 || status === 422) && /model not found|unsupported model|unknown model/.test(msg)) {
    return "provider";
  }
  if (status === 400 || status === 422) return "params";
  return "temporary";
}

/**
 * هل رسالة فشل المهمة في منتصف الطريق تطابق نمط مشكلات مفتاح/رصيد؟
 * عندئذ تُعاد إنشاء نفس المهمة بنفس task_id على المفتاح التالي (قسم 4.3.2)
 */
export function isKeyOrBalanceFailure(message: string): boolean {
  return /insufficient|balance|credit|quota|402|401|unauthorized|forbidden|invalid api key|exhausted|authentication/i.test(
    message || "",
  );
}

/** إخفاء أي مفتاح كامل قد يتسرب في رسالة خطأ — إخفاء المفاتيح إلزامي في كل الاستجابات والسجلات */
export function scrubSecrets(text: string, secrets: string[]): string {
  let out = text || "";
  for (const s of secrets) {
    if (s && s.length >= 6 && out.includes(s)) {
      out = out.split(s).join(maskKey(s));
    }
  }
  return out;
}
