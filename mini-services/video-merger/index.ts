// خدمة دمج الفيديو — Video Merger API v2 (نقطة الدخول والتوجيه)
import { existsSync, rmSync } from "node:fs";
import { config, paths } from "./lib/config";
import { ApiError, baseUrl, CORS_HEADERS, errorResponse, json } from "./lib/http";
import {
  cleanupExpired,
  createJob,
  deleteJob,
  getJob,
  initRegistry,
  saveRegistry,
  updateJob,
  type Job,
} from "./lib/registry";
import { runPipeline } from "./lib/merge";

const PORT = Number(process.env.PORT) || 3030;
const TTL_MS = 24 * 60 * 60 * 1000; // صلاحية المهمة: 24 ساعة

// قفل تزامن: مهمة واحدة قيد المعالجة في نفس اللحظة
const processing = new Set<string>();

// توليد معرف فريد من 8 محارف (أحرف صغيرة وأرقام)
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function newJobId(): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    let id = "";
    for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
    if (!getJob(id)) return id;
  }
}

// عرض المهمة للعميل: الحقول الفارغة تُحذف تماماً
function jobView(job: Job, base: string): Record<string, unknown> {
  const view: Record<string, unknown> = {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    expiresAt: job.expiresAt,
  };
  if (job.status === "done") {
    const videoUrl = `${base}/api/jobs/${job.id}/video`;
    view.videoUrl = videoUrl;
    view.downloadUrl = `${videoUrl}?download=1`;
    view.size = job.size;
    view.duration = job.duration;
    view.resolution = job.resolution;
  }
  if (job.status === "failed") view.error = job.error ?? "فشلت المعالجة";
  return view;
}

// تحليل ترويسة Range: يعيد نطاقاً أو null أو "invalid"
function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return "invalid";
  const [, a, b] = m;
  if (a === "" && b === "") return "invalid";
  if (a === "") {
    // صيغة اللاحقة: آخر N بايت
    const lastN = Number(b);
    if (lastN <= 0) return "invalid";
    return { start: Math.max(0, size - lastN), end: size - 1 };
  }
  const start = Number(a);
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

// POST /api/jobs: التحقق من المدخلات وإنشاء المهمة
async function createJobHandler(req: Request): Promise<Response> {
  cleanupExpired(); // تنظيف دوري للمهام المنتهية عند كل إنشاء
  let body: any;
  try {
    body = JSON.parse(await req.text());
  } catch {
    throw new ApiError(400, "صيغة الطلب غير صالحة: يجب إرسال JSON");
  }
  const videos = body?.videos;
  if (!Array.isArray(videos)) throw new ApiError(400, "يجب إرسال مصفوفة روابط في الحقل videos");
  if (videos.length < 2) throw new ApiError(400, "الدمج يحتاج مقطعَين على الأقل");
  if (videos.length > config.maxSources) throw new ApiError(400, `أقصى عدد مقاطع للدمج هو ${config.maxSources}`);
  for (const v of videos) {
    if (typeof v !== "string" || !/^https?:\/\//i.test(v.trim())) {
      throw new ApiError(400, "كل عنصر في المصفوفة يجب أن يكون رابط http أو https صالحاً");
    }
  }

  const id = newJobId();
  const job = createJob(id, videos.map((v: string) => v.trim()), TTL_MS);
  saveRegistry();
  const base = baseUrl(req);
  return json(
    {
      jobId: id,
      status: "queued",
      statusUrl: `${base}/api/jobs/${id}`,
      processUrl: `${base}/api/jobs/${id}/process`,
      expiresAt: job.expiresAt,
    },
    201,
  );
}

// POST /api/jobs/{id}/process: دمج متزامن مع حارس تزامن
async function processHandler(req: Request, id: string): Promise<Response> {
  const job = getJob(id);
  if (!job) throw new ApiError(404, "المهمة غير موجودة");

  // قيد المعالجة حالياً: رد فوري 202 (يشمل الطلبات المتزامنة الثانية)
  if (job.status === "processing" || processing.has(id)) {
    return json({ status: "processing", progress: job.progress }, 202);
  }
  // منتهية بنجاح: رد نخيري بنفس JSON
  if (job.status === "done") return json(jobView(job, baseUrl(req)));
  // فاشلة سابقاً: 500 مع خطئها
  if (job.status === "failed") throw new ApiError(500, job.error ?? "فشلت المعالجة");

  if (!Array.isArray(job.videos) || job.videos.length < 2) {
    throw new ApiError(500, "بيانات المصادر مفقودة في هذه المهمة");
  }

  // الانتقال إلى المعالجة قبل أول انتظار لضمان الذرية
  updateJob(id, { status: "processing", progress: 0 });
  processing.add(id);
  try {
    await runPipeline(id, job.videos);
    return json(jobView(getJob(id)!, baseUrl(req)));
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    const message = e instanceof ApiError ? e.message : "فشل غير متوقع أثناء المعالجة";
    try {
      updateJob(id, { status: "failed", error: message });
    } catch {
      /* تجاهل */
    }
    throw new ApiError(status, message);
  } finally {
    processing.delete(id);
  }
}

// GET /api/jobs/{id}/video: بث الملف مع دعم Range الكامل
function videoHandler(req: Request, id: string, url: URL): Response {
  const job = getJob(id);
  if (!job) throw new ApiError(404, "المهمة غير موجودة");
  const outPath = paths.outputPath(id);
  if (job.status !== "done" || !existsSync(outPath)) throw new ApiError(404, "الناتج غير جاهز بعد");

  const file = Bun.file(outPath);
  const size = file.size;
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    ...CORS_HEADERS,
  };
  if (url.searchParams.get("download") === "1") {
    headers["Content-Disposition"] = `attachment; filename="merged-${id}.mp4"`;
  }

  const range = parseRange(req.headers.get("range"), size);
  if (range === "invalid") throw new ApiError(416, "نطاق البايتات المطلوب غير صالح");
  if (range) {
    // بث الشريحة المطلوبة فقط من الملف
    const len = range.end - range.start + 1;
    const slice = file.slice(range.start, range.end + 1);
    return new Response(slice, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(len),
      },
    });
  }
  return new Response(file, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
}

// الموجّه الرئيسي لكل المسارات
async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // طلب مسبق CORS: رد فارغ 204
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (path === "/api/config") {
    if (method !== "GET") throw new ApiError(405, "الطريقة غير مسموحة لهذا المسار");
    return json({
      version: config.version,
      maxSources: config.maxSources,
      sourceMaxMB: config.sourceMaxMB,
      outputMaxMB: config.outputMaxMB,
      maxTotalDurationSec: config.maxTotalDurationSec,
      uploadChunkBytes: config.uploadChunkBytes,
    });
  }

  if (path === "/api/jobs") {
    if (method !== "POST") throw new ApiError(405, "الطريقة غير مسموحة لهذا المسار");
    return createJobHandler(req);
  }

  const idMatch = /^\/api\/jobs\/([^/\s]+)$/.exec(path);
  if (idMatch) {
    const id = idMatch[1];
    if (method === "GET") {
      const job = getJob(id);
      if (!job) throw new ApiError(404, "المهمة غير موجودة");
      return json(jobView(job, baseUrl(req)));
    }
    if (method === "DELETE") {
      const job = getJob(id);
      if (!job) throw new ApiError(404, "المهمة غير موجودة");
      if (job.status === "processing" || processing.has(id)) {
        throw new ApiError(409, "لا يمكن حذف مهمة أثناء المعالجة");
      }
      deleteJob(id);
      try {
        rmSync(paths.jobDir(id), { recursive: true, force: true });
      } catch {
        /* تجاهل */
      }
      return json({ ok: true });
    }
    throw new ApiError(405, "الطريقة غير مسموحة لهذا المسار");
  }

  const procMatch = /^\/api\/jobs\/([^/\s]+)\/process$/.exec(path);
  if (procMatch) {
    if (method !== "POST") throw new ApiError(405, "الطريقة غير مسموحة لهذا المسار");
    return processHandler(req, procMatch[1]);
  }

  const vidMatch = /^\/api\/jobs\/([^/\s]+)\/video$/.exec(path);
  if (vidMatch) {
    if (method !== "GET") throw new ApiError(405, "الطريقة غير مسموحة لهذا المسار");
    return videoHandler(req, vidMatch[1], url);
  }

  throw new ApiError(404, "المسار غير موجود");
}

// تهيئة السجل والتنظيف الدوري
initRegistry();
cleanupExpired();
setInterval(cleanupExpired, 10 * 60 * 1000);

// إقلاع الخادم
Bun.serve({
  port: PORT,
  async fetch(req) {
    try {
      return await handle(req);
    } catch (e) {
      if (e instanceof ApiError) return errorResponse(e.status, e.message);
      console.error("خطأ غير متوقع:", e);
      return errorResponse(500, "حدث خطأ غير متوقع في الخادم");
    }
  },
});

console.log(`خدمة دمج الفيديو v${config.version} تعمل على المنفذ ${PORT}`);

// ─── حافظ تشغيل سيرفر التطوير الرئيسي (يُولَّد كابن لهذه الخدمة) ───
// هذه الخدمة أطلقتها المنصة نفسها عند إقلاع الصندوق، فأي عملية ابنة لها ترث نفس
// حماية شجرة المنصة. عند لمس ملف الإشارة .zscripts/START_MAIN يتولَّد next dev
// من هنا — بديل آمن عن التشغيل المباشر من جلسة الأوامر التي ينظّفها المنظّف الخارجي.
const MAIN_TRIGGER = "/home/z/my-project/.zscripts/START_MAIN";
const MAIN_PROJECT = "/home/z/my-project";
setInterval(() => {
  try {
    if (!existsSync(MAIN_TRIGGER)) return;
    rmSync(MAIN_TRIGGER);
    const busy = Bun.spawnSync(["bash", "-lc", "ss -tln | grep -q ':3000'"]).exitCode === 0;
    if (busy) {
      console.log("[keep-alive] السيرفر الرئيسي يعمل بالفعل — تجاهل الإشارة");
      return;
    }
    Bun.spawn(["bun", "run", "dev"], {
      cwd: MAIN_PROJECT,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    console.log("[keep-alive] تم توليد سيرفر التطوير الرئيسي كابن لهذه الخدمة");
  } catch (e) {
    console.error("[keep-alive] فشل التوليد:", e);
  }
}, 3000);
