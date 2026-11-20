// عميل خدمة دمج الفيديو — Video Merger API v2 (قسم 7)
// بلا مفاتيح أو توثيق. روابط النتائج فقط تُخزَّن — لا تنزيل أي وسائط إلى سيرفرنا أبدًا.
import { publicizeMergerUrl } from "./urls";

export function mergerBase(): string {
  return (process.env.MERGER_API_BASE || "").replace(/\/$/, "");
}

export function mergerConfigured(): boolean {
  return mergerBase().length > 0;
}

async function mergerFetch(path: string, init?: RequestInit, timeoutMs = 30_000): Promise<{ res: Response; body: Record<string, unknown> | null }> {
  const res = await fetch(`${mergerBase()}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // جسم غير JSON
  }
  return { res, body };
}

/** فحص جهوزية الخدمة: GET /api/config بمهلة 4 ثوانٍ */
export async function mergerHealthy(): Promise<boolean> {
  if (!mergerConfigured()) return false;
  try {
    const { res } = await mergerFetch("/api/config", {}, 4_000);
    return res.ok;
  } catch {
    return false;
  }
}

/** POST /api/jobs — إنشاء مهمة دمج */
export async function mergerCreateJob(videos: string[]): Promise<{ jobId: string; expiresAt?: string }> {
  const { res, body } = await mergerFetch(
    "/api/jobs",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videos }) },
    20_000,
  );
  const jobId = typeof body?.jobId === "string" ? body.jobId : null;
  if (!res.ok || !jobId) {
    throw new Error((body?.error as string) || `HTTP ${res.status}`);
  }
  return { jobId, expiresAt: typeof body?.expiresAt === "string" ? body.expiresAt : undefined };
}

export interface MergerProcessResult {
  state: "done" | "processing" | "failed";
  videoUrl?: string;
  downloadUrl?: string;
  error?: string;
  size?: number;
  duration?: number;
  resolution?: string;
  expiresAt?: string;
}

/**
 * POST /api/jobs/{id}/process — تنفيذ الدمج (متزامن يستغرق ~10-15 ثانية)
 * أي خطأ HTTP معلن من الخدمة (4xx/5xx بجسم error) = فشل نهائي فوري — لا إعادة محاولة
 */
export async function mergerProcess(jobId: string): Promise<MergerProcessResult> {
  const { res, body } = await mergerFetch(`/api/jobs/${encodeURIComponent(jobId)}/process`, { method: "POST" }, 300_000);
  if (res.status === 202) return { state: "processing" };
  if (res.ok) {
    const st = String(body?.status ?? "done").toLowerCase();
    if (/^(error|failed|failure|cancelled)$/.test(st)) {
      return { state: "failed", error: (body?.error as string) || "فشل الدمج لدى الخدمة" };
    }
    return {
      state: "done",
      videoUrl: (body?.videoUrl as string) || undefined,
      downloadUrl: (body?.downloadUrl as string) || undefined,
      size: typeof body?.size === "number" ? body.size : undefined,
      duration: typeof body?.duration === "number" ? body.duration : undefined,
      resolution: typeof body?.resolution === "string" ? body.resolution : undefined,
      expiresAt: typeof body?.expiresAt === "string" ? body.expiresAt : undefined,
    };
  }
  return { state: "failed", error: (body?.error as string) || `HTTP ${res.status}` };
}

export interface MergerJobState {
  state: "completed" | "failed" | "processing" | "not_found";
  progress: number;
  videoUrl?: string;
  downloadUrl?: string;
  error?: string;
  expiresAt?: string;
}

const MERGER_DONE_RE = /^(done|completed|complete|success|succeeded|finished)$/i;
const MERGER_FAILED_RE = /^(error|failed|failure|cancelled|canceled)$/i;

/** GET /api/jobs/{id} — تحليل دفاعي للحالة (قسم 7.2) */
export async function mergerGetJob(jobId: string): Promise<MergerJobState> {
  const { res, body } = await mergerFetch(`/api/jobs/${encodeURIComponent(jobId)}`, {}, 15_000);
  if (res.status === 404) {
    return { state: "not_found", progress: 100, error: (body?.error as string) || "مهمة غير موجودة" };
  }
  const rawStatus = String(body?.status ?? "").toLowerCase();
  const hasError = typeof body?.error === "string" && body.error.length > 0;
  // قد يرد الجسم فيه error بدون حقل status → عاملها failed فورًا
  let state: MergerJobState["state"];
  if (MERGER_DONE_RE.test(rawStatus)) state = "completed";
  else if (MERGER_FAILED_RE.test(rawStatus) || (!rawStatus && hasError)) state = "failed";
  else state = "processing";

  // progress قد يأتي كسرًا 0..1 → اضربه في 100
  let progress = 0;
  const rawProgress = body?.progress;
  if (typeof rawProgress === "number") progress = rawProgress <= 1 ? Math.round(rawProgress * 100) : Math.round(rawProgress);
  progress = Math.max(0, Math.min(100, progress));

  const videoUrl = typeof body?.videoUrl === "string" ? body.videoUrl : undefined;
  const downloadUrl = typeof body?.downloadUrl === "string" ? body.downloadUrl : undefined;
  return {
    state,
    progress,
    videoUrl,
    downloadUrl,
    error: hasError ? (body?.error as string) : undefined,
    expiresAt: typeof body?.expiresAt === "string" ? body.expiresAt : undefined,
  };
}

/** رابط النتيجة النهائي: فضّل videoUrl ثم downloadUrl ثم اضبطه من jobId (قسم 7.2) — مع تعريب الروابط */
export function mergerResultUrl(jobId: string, videoUrl?: string, downloadUrl?: string): string {
  const raw = videoUrl || downloadUrl || `${mergerBase()}/api/jobs/${jobId}/video`;
  return publicizeMergerUrl(raw);
}

/** DELETE /api/jobs/{id} — حذف فوري (تنظيف اختياري) */
export async function mergerDeleteJob(jobId: string): Promise<boolean> {
  try {
    const { res } = await mergerFetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }, 10_000);
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}
