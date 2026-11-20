// مزود CometAPI — صور متزامنة عبر نقطة images المتوافقة مع OpenAI، وفيديو عبر نقطة مهام غير متزامنة
// تنفيذ دفاعي وفق التوثيق العام: أي اختلاف في الشكل يُصنَّف كخطأ مزود وينتقل التبديل إلى المفتاح/المزود التالي
import { ProviderError } from "../errors";
import { type ProviderAdapter, type ProviderCheckResult, type GenInput } from "./types";

const BASE = "https://api.cometapi.com";

async function cometRequest(apiKey: string, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(init?.headers || {}) },
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
      throw new ProviderError("cometapi", res.status, msg);
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
  async createImageSync(apiKey, providerModel, input: GenInput) {
    const body = await cometRequest(apiKey, "/v1/images/generations", {
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
    if (!urls.length) throw new ProviderError("cometapi", 500, "استجابة توليد صور بلا روابط");
    return { urls };
  },

  async createTask(apiKey, providerModel, input: GenInput) {
    const body = await cometRequest(apiKey, "/v1/videos/generations", {
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
    if (!taskId) throw new ProviderError("cometapi", 500, "استجابة إنشاء مهمة فيديو بلا معرّف");
    return { providerTaskId: taskId };
  },

  async checkTask(apiKey, providerTaskId): Promise<ProviderCheckResult> {
    const body = await cometRequest(apiKey, `/v1/videos/${encodeURIComponent(providerTaskId)}`);
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
