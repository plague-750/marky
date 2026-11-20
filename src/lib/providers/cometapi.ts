// مزود CometAPI — صور متزامنة عبر نقطة images المتوافقة مع OpenAI، وفيديو عبر نقطة مهام غير متزامنة
// تنفيذ دفاعي وفق التوثيق العام: أي اختلاف في الشكل يُصنَّف كخطأ مزود وينتقل التبديل إلى المفتاح/المزود التالي
// الإعدادات (base_url + نقاط النهاية) تأتي من جدول providers مع قيم افتراضية عند الفراغ
import { ProviderError } from "../errors";
import { buildAuth, type ProviderAdapter, type ProviderCheckResult, type GenInput, type ProviderRuntime } from "./types";

const DEFAULT_BASE = "https://api.cometapi.com";
const DEFAULT_IMAGE_EP = "/v1/images/generations";
const DEFAULT_VIDEO_EP = "/v1/videos/generations";
const DEFAULT_CHECK_EP = "/v1/videos/{task_id}";

function submitUrl(provider: ProviderRuntime, kind: "image" | "video"): string {
  const base = (provider.base_url || DEFAULT_BASE).replace(/\/$/, "");
  const ep = kind === "image" ? provider.image_endpoint || DEFAULT_IMAGE_EP : provider.video_endpoint || DEFAULT_VIDEO_EP;
  return `${base}${ep.startsWith("/") ? "" : "/"}${ep}`;
}

function checkUrl(provider: ProviderRuntime, providerTaskId: string): string {
  const base = (provider.base_url || DEFAULT_BASE).replace(/\/$/, "");
  const ep = provider.check_endpoint || DEFAULT_CHECK_EP;
  const path = `${ep.startsWith("/") ? "" : "/"}${ep}`;
  // دعم {task_id} كعنصر نائب، وإلا الإضافة كمسار، وإلا كمعامل استعلام task_id
  if (path.includes("{task_id}")) return `${base}${path.replace("{task_id}", encodeURIComponent(providerTaskId))}`;
  if (path.includes("?")) return `${base}${path}&task_id=${encodeURIComponent(providerTaskId)}`;
  return `${base}${path}/${encodeURIComponent(providerTaskId)}`;
}

async function cometRequest(provider: ProviderRuntime, apiKey: string, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  const { headers } = buildAuth(provider, apiKey);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { ...headers, "Content-Type": "application/json", ...(init?.headers || {}) },
      signal: ctrl.signal,
    });
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // جسم غير JSON
    }
    if (!res.ok) {
      const msg =
        ((body?.error as { message?: string } | undefined)?.message) ||
        (body?.message as string | undefined) ||
        `HTTP ${res.status}`;
      throw new ProviderError(provider.id, res.status, msg);
    }
    return body ?? {};
  } finally {
    clearTimeout(timer);
  }
}

/** استخراج دفاعي لمعرّف المهمة من أشكال استجابة متعددة محتملة */
function extractTaskId(body: Record<string, unknown>): string | null {
  const cands = [
    body?.task_id,
    body?.taskId,
    body?.id,
    (body?.data as Record<string, unknown> | undefined)?.task_id,
    (body?.data as Record<string, unknown> | undefined)?.taskId,
    (body?.data as Record<string, unknown> | undefined)?.id,
  ];
  for (const c of cands) if (typeof c === "string" && c) return c;
  return null;
}

/** استخراج دفاعي للروابط من أشكال استجابة متعددة محتملة */
function extractUrls(body: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown, depth = 0) => {
    if (depth > 4 || v == null) return;
    if (typeof v === "string") {
      if (/^https?:\/\/\S+$/i.test(v) && /\.(mp4|webm|mov|png|jpe?g|webp|gif)(\?|$)/i.test(v)) out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    if (typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) visit(x, depth + 1);
    }
  };
  visit(body);
  return [...new Set(out)];
}

const DONE_RE = /^(succeeded|success|completed|complete|finished|done)$/i;
const FAILED_RE = /^(failed|failure|error|cancelled|canceled)$/i;

export const cometapiAdapter: ProviderAdapter = {
  // صور متزامنة: تُعيد الرابط/b64_json فورًا
  async createImageSync(apiKey, providerModel, input, provider) {
    const body = await cometRequest(provider, apiKey, submitUrl(provider, "image"), {
      method: "POST",
      body: JSON.stringify({
        model: providerModel,
        prompt: input.prompt,
        ...(input.aspect_ratio && input.aspect_ratio !== "auto" ? { aspect_ratio: input.aspect_ratio } : {}),
        ...(input.resolution ? { resolution: input.resolution } : {}),
        ...(input.background && input.background !== "auto" ? { background: input.background } : {}),
        ...(input.output_format && input.output_format !== "png" ? { output_format: input.output_format } : {}),
      }),
    });
    const items = Array.isArray(body?.data) ? (body.data as Record<string, unknown>[]) : [];
    const urls = items
      .map((it) => {
        if (typeof it?.url === "string" && it.url) return it.url;
        if (typeof it?.b64_json === "string" && it.b64_json) return `data:image/png;base64,${it.b64_json}`;
        return null;
      })
      .filter((u): u is string => !!u);
    if (!urls.length) throw new ProviderError(provider.id, 500, "استجابة توليد صور بلا روابط");
    return { urls };
  },

  async createTask(apiKey, providerModel, input, provider) {
    const body = await cometRequest(provider, apiKey, submitUrl(provider, "video"), {
      method: "POST",
      body: JSON.stringify({
        model: providerModel,
        prompt: input.prompt,
        ...(input.image_url ? { image_url: input.image_url } : {}),
        ...(input.aspect_ratio && input.aspect_ratio !== "auto" ? { aspect_ratio: input.aspect_ratio } : {}),
        ...(input.resolution ? { resolution: input.resolution } : {}),
        ...(typeof input.duration === "number" ? { duration: input.duration } : {}),
        ...(typeof input.enable_audio === "boolean" ? { enable_audio: input.enable_audio } : {}),
      }),
    });
    const taskId = extractTaskId(body);
    if (!taskId) throw new ProviderError(provider.id, 500, "استجابة إنشاء مهمة فيديو بلا معرّف");
    return { providerTaskId: taskId };
  },

  async checkTask(apiKey, providerTaskId, provider): Promise<ProviderCheckResult> {
    const body = await cometRequest(provider, apiKey, checkUrl(provider, providerTaskId));
    const status = String(body?.status ?? "").toLowerCase();
    if (FAILED_RE.test(status)) {
      const err = (body?.error as { message?: string } | undefined)?.message || (body?.error as string | undefined) || "فشل المزود دون تفاصيل";
      return { status: "failed", error: typeof err === "string" ? err : "فشل المزود دون تفاصيل" };
    }
    if (DONE_RE.test(status)) {
      const urls = extractUrls(body);
      return { status: "completed", urls: urls.length ? urls : undefined, progress: 100 };
    }
    const rawProgress = typeof body?.progress === "number" ? body.progress : undefined;
    const progress = rawProgress !== undefined && rawProgress <= 1 ? Math.round(rawProgress * 100) : rawProgress ?? 40;
    return { status: "processing", progress: Math.max(0, Math.min(100, progress)) };
  },
};
