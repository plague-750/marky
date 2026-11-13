// تعريب روابط نتائج الدمج — في بيئة التطوير تُستبدل أصل خدمة الدمج بقاعدة عامة/نسبية عبر بوابة XTransformPort
// في الإنتاج (MERGER_PUBLIC_BASE غير مضبوط) تبقى الروابط كما تعيدها الخدمة — عامة بطبيعتها.
export function publicizeMergerUrl(url: string): string {
  const base = (process.env.MERGER_API_BASE || "").replace(/\/$/, "");
  const pub = process.env.MERGER_PUBLIC_BASE; // قد يكون نصًا فارغًا عمدًا (روابط نسبية)
  if (pub === undefined || !base || !url.startsWith(base)) return url;

  const pathWithQuery = url.slice(base.length) || "/";
  let out = `${pub}${pathWithQuery.startsWith("/") ? "" : "/"}${pathWithQuery}`;

  // الروابط النسبية (بما فيها القاعدة الفارغة) تُمرَّر عبر بوابة المنفذ الواحد — أضف XTransformPort المأخوذ من أصل الخدمة
  const isRelative = !pub.includes("://");
  if (isRelative) {
    try {
      const port = new URL(base).port;
      if (port) out += (out.includes("?") ? "&" : "?") + `XTransformPort=${port}`;
    } catch {
      // أصل غير صالح — تجاهل
    }
  }
  return out;
}

/** تحويل رابط نتيجة مخزَّن (قد يكون نسبيًا) إلى رابط مطلق تقدّم خدمة الدمج نفسها لجلبها */
export function absoluteMergerUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = (process.env.MERGER_API_BASE || "").replace(/\/$/, "");
  if (!base || !url.startsWith("/")) return url;
  try {
    const u = new URL(base + url);
    // نزّل معامل البوابة قبل إرساله للخدمة
    u.searchParams.delete("XTransformPort");
    return u.toString();
  } catch {
    return url;
  }
}
