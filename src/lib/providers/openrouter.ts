// محول OpenRouter — توليد الصور عبر chat/completions مع modalities (توثيق OpenRouter الرسمي)
// الاستجابة تعيد الصور في choices[0].message.images[] — كل صورة image_url.url (رابط أو data URI)
// لا يوجد فيديو غير متزامن هنا: المفتاح يجب أن يكون capability = image
import { ProviderError } from "../errors";
import { buildAuth, type ProviderAdapter, type ProviderCheckResult, type GenInput, type ProviderRuntime } from "./types";

const DEFAULT_BASE = "https://openrouter.ai/api/v1";

function chatUrl(provider: ProviderRuntime): string {
  const base = (provider.base_url || DEFAULT_BASE).replace(/\/$/, "");
  // الرابط الأساسي قد يشمل /api/v1 أو لا — نضمن /chat/completions في النهاية
  if (base.endsWith("/chat/completions")) return base;
  if (/\/api\/v\d+$/.test(base) || /\/v\d+$/.test(base)) return `${base}/chat/completions`;
  return `${base}/chat/completions`;
}

/** استخراج دفاعي للروابط من استجابة chat completions (صور base64 أو روابط مباشرة) */
function extractImageUrls(body: unknown): string[] {
  const out: string[] = [];
  const pushUrl = (v: unknown) => {
    if (typeof v === "string" && v && (v.startsWith("data:image/") || /^https?:\/\/\S+$/i.test(v))) out.push(v);
  };
  const visit = (v: unknown, depth = 0) => {
    if (depth > 6 || v == null) return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    if (typeof v === "object") {
      const rec = v as Record<string, unknown>;
      // الشكل الموثق: { type: "image_url", image_url: { url } }
      const imgUrl = rec.image_url;
      if (imgUrl && typeof imgUrl === "object") pushUrl((imgUrl as Record<string, unknown>).url);
      else if (typeof imgUrl === "string") pushUrl(imgUrl);
      if (typeof rec.b64_json === "string") pushUrl(`data:image/png;base64,${rec.b64_json}`);
      for (const x of Object.values(rec)) visit(x, depth + 1);
    }
  };
  visit(body);
  return [...new Set(out)].slice(0, 8);
}

export const openrouterAdapter: ProviderAdapter = {
  async createImageSync(apiKey, providerModel, input, provider) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 180_000);
    const { headers } = buildAuth(provider, apiKey);
    try {
      const res = await fetch(chatUrl(provider), {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: providerModel,
          modalities: ["image", "text"],
          messages: [{ role: "user", content: input.prompt }],
        }),
      });
      let body: Record<string, unknown> | null = null;
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        // جسم غير JSON
      }
      if (!res.ok) {
        const err = (body?.error as { message?: string; code?: unknown } | undefined) || {};
        const rawMsg = err.message || `HTTP ${res.status}`;
        // قيود المنطقة تُصنَّف كـ «موديل غير مدعوم» وليس رفض مفتاح — حتى لا يُعطَّل المفتاح بالخطأ
        if (/not available in your region|geo.?restrict/i.test(rawMsg)) {
          throw new ProviderError(provider.id, 404, `Model not found (region restricted): ${rawMsg}`);
        }
        throw new ProviderError(provider.id, typeof err.code === "number" ? err.code : res.status, rawMsg);
      }
      const urls = extractImageUrls(body);
      if (!urls.length) throw new ProviderError(provider.id, 500, "استجابة توليد صور بلا روابط");
      return { urls };
    } finally {
      clearTimeout(timer);
    }
  },

  async createTask() {
    // OpenRouter لا يوفر مهام فيديو غير متزامنة — المفاتيح capability=image لا تدخل دورة الفيديو أصلًا
    throw new ProviderError("openrouter", 400, "Model not found: video tasks unsupported on OpenRouter adapter");
  },

  async checkTask(): Promise<ProviderCheckResult> {
    return { status: "failed", error: "لا توجد مهام متابعة على OpenRouter — الصور تُعاد فورًا" };
  },
};
