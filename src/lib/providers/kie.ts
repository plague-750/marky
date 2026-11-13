// مزود kie.ai — Jobs API الموحد (الأشكال المقاسة فعليًا بتاريخ التنفيذ، لا اختراع حقول)
import { ProviderError } from "../errors";
import { type ProviderAdapter, type ProviderCheckResult, type GenInput } from "./types";

const BASE = "https://api.kie.ai/api/v1/jobs";

/**
 * نداء موحد: ملاحظة مقاسة — kie قد يعيد HTTP 200 مع `code` خطأ داخل الجسم
 * (مثل مفتاح خاطئ: {"code":401,"msg":"Unauthorized ..."} بحالة HTTP 200)
 * لذلك نعتمد body.code كحالة فعالة إن وُجد ولم يكن 200.
 */
async function kieRequest(apiKey: string, url: string, init?: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(init?.headers || {}) },
      signal: ctrl.signal,
    });
    let body: { code?: number; msg?: string; message?: string; data?: unknown } | null = null;
    try {
      body = await res.json();
    } catch {
      // جسم غير JSON
    }
    const bodyCode = typeof body?.code === "number" ? body.code : null;
    const effectiveStatus = bodyCode !== null && bodyCode !== 200 ? bodyCode : res.status;
    if (!res.ok || (bodyCode !== null && bodyCode !== 200)) {
      throw new ProviderError("kie", effectiveStatus, body?.msg || body?.message || `HTTP ${res.status}`);
    }
    return body?.data ?? body;
  } finally {
    clearTimeout(timer);
  }
}

function buildInput(input: GenInput): Record<string, unknown> {
  const out: Record<string, unknown> = { prompt: input.prompt };
  if (input.aspect_ratio) out.aspect_ratio = input.aspect_ratio;
  if (input.resolution) out.resolution = input.resolution;
  if (input.background && input.background !== "auto") out.background = input.background;
  if (input.output_format && input.output_format !== "png") out.output_format = input.output_format;
  if (input.image_url) out.image_url = input.image_url;
  if (typeof input.duration === "number") out.duration = input.duration;
  if (typeof input.enable_audio === "boolean") out.enable_audio = input.enable_audio;
  return out;
}

export const kieAdapter: ProviderAdapter = {
  async createTask(apiKey, providerModel, input) {
    const data = (await kieRequest(apiKey, `${BASE}/createTask`, {
      method: "POST",
      body: JSON.stringify({ model: providerModel, input: buildInput(input) }),
    })) as { taskId?: string; recordId?: string } | undefined;
    const taskId = data?.taskId || data?.recordId;
    if (!taskId) throw new ProviderError("kie", 500, "استجابة إنشاء مهمة بلا معرّف");
    return { providerTaskId: String(taskId) };
  },

  async checkTask(apiKey, providerTaskId): Promise<ProviderCheckResult> {
    const data = (await kieRequest(
      apiKey,
      `${BASE}/recordInfo?taskId=${encodeURIComponent(providerTaskId)}`,
    )) as {
      state?: string;
      resultJson?: string | Record<string, unknown>;
      failMsg?: string | null;
      progress?: number;
    } | undefined;

    const state = String(data?.state || "").toLowerCase();

    // resultJson نص JSON داخل JSON — يحتاج JSON.parse ثانيًا
    let urls: string[] = [];
    const rj = data?.resultJson;
    if (rj) {
      try {
        const parsed: unknown = typeof rj === "string" ? JSON.parse(rj) : rj;
        const list = (parsed as { resultUrls?: unknown })?.resultUrls;
        if (Array.isArray(list)) urls = list.filter((u): u is string => typeof u === "string" && !!u);
      } catch {
        // تجاهل جسم نتيجة غير متوقع
      }
    }

    if (state === "success") {
      return { status: "completed", urls: urls.length ? urls : undefined, progress: 100 };
    }
    if (state === "fail") {
      return { status: "failed", error: data?.failMsg || "فشل المزود دون تفاصيل", progress: 100 };
    }
    // تقدير التقدم من الحالة عند غياب حقل رقمي
    const progress =
      typeof data?.progress === "number"
        ? Math.max(0, Math.min(100, data.progress))
        : state === "generating"
          ? 55
          : state === "queuing"
            ? 15
            : 5;
    return { status: "processing", progress };
  },
};
