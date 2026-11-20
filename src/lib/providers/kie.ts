// مزود kie.ai — Jobs API الموحد (الأشكال المقاسة فعليًا بتاريخ التنفيذ، لا اختراع حقول)
// الإعدادات (base_url + نقاط النهاية) تأتي من جدول providers مع قيم افتراضية عند الفراغ
import { ProviderError } from "../errors";
import { buildAuth, type ProviderAdapter, type ProviderCheckResult, type GenInput, type ProviderRuntime } from "./types";

const DEFAULT_BASE = "https://api.kie.ai";
const DEFAULT_CREATE_EP = "/api/v1/jobs/createTask";
const DEFAULT_CHECK_EP = "/api/v1/jobs/recordInfo";

function createUrl(provider: ProviderRuntime): string {
  const base = (provider.base_url || DEFAULT_BASE).replace(/\/$/, "");
  const ep = provider.image_endpoint || provider.video_endpoint || DEFAULT_CREATE_EP;
  return `${base}${ep.startsWith("/") ? "" : "/"}${ep}`;
}

function checkUrl(provider: ProviderRuntime, providerTaskId: string): string {
  const base = (provider.base_url || DEFAULT_BASE).replace(/\/$/, "");
  const ep = provider.check_endpoint || DEFAULT_CHECK_EP;
  const path = `${ep.startsWith("/") ? "" : "/"}${ep}`;
  // دعم {task_id} كعنصر نائب أو الإضافة كمعامل استعلام taskId
  if (path.includes("{task_id}")) return `${base}${path.replace("{task_id}", encodeURIComponent(providerTaskId))}`;
  return `${base}${path}${path.includes("?") ? "&" : "?"}taskId=${encodeURIComponent(providerTaskId)}`;
}

/**
 * نداء موحد: ملاحظة مقاسة — kie قد يعيد HTTP 200 مع `code` خطأ داخل الجسم
 * (مثل مفتاح خاطئ: {"code":401,"msg":"Unauthorized ..."} بحالة HTTP 200)
 * لذلك نعتمد body.code كحالة فعالة إن وُجد ولم يكن 200.
 */
async function kieRequest(provider: ProviderRuntime, apiKey: string, url: string, init?: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  const { headers } = buildAuth(provider, apiKey);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { ...headers, "Content-Type": "application/json", ...(init?.headers || {}) },
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
      throw new ProviderError(provider.id, effectiveStatus, body?.msg || body?.message || `HTTP ${res.status}`);
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
  async createTask(apiKey, providerModel, input, provider) {
    const data = (await kieRequest(provider, apiKey, createUrl(provider), {
      method: "POST",
      body: JSON.stringify({ model: providerModel, input: buildInput(input) }),
    })) as { taskId?: string; recordId?: string } | undefined;
    const taskId = data?.taskId || data?.recordId;
    if (!taskId) throw new ProviderError(provider.id, 500, "استجابة إنشاء مهمة بلا معرّف");
    return { providerTaskId: String(taskId) };
  },

  async checkTask(apiKey, providerTaskId, provider): Promise<ProviderCheckResult> {
    const data = (await kieRequest(provider, apiKey, checkUrl(provider, providerTaskId))) as {
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
