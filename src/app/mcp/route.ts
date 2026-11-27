// خادم MCP — مسار /mcp بنقل Streamable HTTP حسب مواصفة MCP (قسم 8)
// SDK رسمي: Server + WebStandardStreamableHTTPServerTransport — لا JSON-RPC يدوي.
// الأدوات الست بمخططات JSON مطابقة للبرومبت (قسم 5)؛ نتائج الاستدعاء تُصاغ بالعربية.
// قوائم الموديلات تُقرأ ديناميكيًا من جدول model_mappings — ليست Hardcoded.
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { IMAGE_MODEL, VIDEO_MODEL, resolveModel, listDynamicModels, buildPassthroughModel } from "@/lib/models";
import { runGeneration, retryGenerationTask } from "@/lib/generation";
import { runMerge, retryMergeTask } from "@/lib/merge";
import { refreshTask } from "@/lib/refresh";
import { getTask, listRecentTasks, parseUrls, listModelMappings } from "@/lib/turso";
import { RuleError } from "@/lib/errors";
import {
  fmtImageDone,
  fmtVideoDone,
  fmtMergeDone,
  fmtProcessing,
  fmtFailed,
  fmtTaskDone,
  fmtTaskLine,
  TYPE_AR,
} from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVER_INFO = { name: "media-generator-mcp", version: "2.0.0" } as const;

// تعليمات تُرسل مع initialize لتوجيه سلوك النموذج المستدعي
const SERVER_INSTRUCTIONS = `AI media generation server (dynamic providers from database — kie.ai, CometAPI and any provider you add — with automatic sequential multi-key failover, plus video merging).
Workflow: call generate_image or generate_video. If the response contains finished URLs, show them to the user.
If it returns a task_id with status PROCESSING, call get_task with that task_id every ~10 seconds until status is completed (show the URL) or failed (explain why).
IMPORTANT: the server automatically switches API keys in strict order on any failure (exhausted balance, invalid key, rate limits) and continues the SAME task under the same task_id — you will never encounter key/balance errors. Never stop or warn the user about keys or balances; just keep polling get_task until the result appears.
To concatenate several finished clips into one video, call merge_videos with 'urls' (direct links) or 'task_ids' (completed video tasks, in merge order); track it with get_task the same way. Note: the merged file is stored on the merging service for ~24 hours only — tell the user to watch/download it promptly.
If a task stays stuck or fails, call retry_task with its task_id (optionally force_provider) to re-run it instantly.
Use list_media to recall previously generated media from the database.`;

// ----------------------------- مخططات الأدوات الست -----------------------------

const IMAGE_ASPECTS = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9", "9:21", "3:1", "1:3"];
const VIDEO_ASPECTS = ["auto", "1:1", "16:9", "9:16", "3:2", "2:3"];

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** بناء قائمة الأدوات — أسماء الموديلات من جدول model_mappings مع الاحتياط الثابت عند تعذر القاعدة */
async function buildTools(): Promise<ToolDef[]> {
  let imageModels = [IMAGE_MODEL.canonical];
  let videoModels = [VIDEO_MODEL.canonical];
  try {
    const dyn = await listDynamicModels();
    const dynImages = dyn.filter((m) => m.type === "image").map((m) => m.canonical);
    const dynVideos = dyn.filter((m) => m.type === "video").map((m) => m.canonical);
    if (dynImages.length) imageModels = dynImages;
    if (dynVideos.length) videoModels = dynVideos;
  } catch {
    // الاحتياط الثابت
  }

  return [
    {
      name: "generate_image",
      description:
        "Generate an image (automatic failover across all active API keys, providers resolved dynamically from the database). Returns the finished image URL if it completes within the wait window; otherwise returns a task_id — then call get_task every ~10 seconds until completed, show the URL, and stop.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", minLength: 1, description: "What to draw. Detailed prompts give better results." },
          model: { type: "string", description: `Model name. Default: ${imageModels[0]}. Registered models: ${imageModels.join(" ، ")}. ANY other model name your provider supports is accepted and sent as-is (pass-through).`, default: imageModels[0] },
          aspect_ratio: { type: "string", enum: IMAGE_ASPECTS, default: "auto" },
          resolution: { type: "string", enum: ["1K", "2K", "4K"], default: "1K" },
          background: { type: "string", enum: ["auto", "transparent", "opaque"], default: "auto", description: "Only applied at 1K." },
          output_format: { type: "string", enum: ["png", "jpeg", "webp", "gif"], default: "png" },
          wait_seconds: { type: "integer", minimum: 0, maximum: 240, default: 90 },
        },
        required: ["prompt"],
      },
    },
    {
      name: "generate_video",
      description:
        "Generate a video with synchronized audio (optional image-to-video). Videos take minutes: a short wait with live progress streaming is attempted, then a task_id is returned — track it with get_task every ~10 seconds.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", maxLength: 4096, description: "Scene description. Dialogue in the prompt is spoken in the video." },
          image_url: { type: "string", description: "Optional public image URL as the first frame (image-to-video)." },
          model: { type: "string", description: `Model name. Default: ${videoModels[0]}. Registered models: ${videoModels.join(" ، ")}. ANY other model name your provider supports is accepted and sent as-is (pass-through).`, default: videoModels[0] },
          aspect_ratio: { type: "string", enum: VIDEO_ASPECTS, default: "auto" },
          resolution: { type: "string", enum: ["480p", "720p", "1080p"], default: "480p" },
          enable_audio: { type: "boolean", default: true },
          duration: { type: "integer", minimum: 1, maximum: 15, default: 8, description: "Duration in seconds." },
          wait_seconds: { type: "integer", minimum: 0, maximum: 240, default: 25 },
        },
        required: ["prompt"],
      },
    },
    {
      name: "merge_videos",
      description:
        "Merge several clips into ONE final video in the given order. Pass 'urls' (public direct video links — e.g. generate_video results) or 'task_ids' (completed video tasks; their result URLs are resolved from the database in this order). Merging is usually quick: a short wait with live progress is attempted, then a merge task_id is returned — track it with get_task. IMPORTANT: the merged file is stored on the merging service for ~24 hours only — tell the user to watch/download it promptly.",
      inputSchema: {
        type: "object",
        properties: {
          urls: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 10,
            description: "Public direct video URLs (http/https) in merge order — the first clip starts the final video.",
          },
          task_ids: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 10,
            description: "Alternative to urls: task_ids of COMPLETED video generation tasks — their result URLs are merged in this order.",
          },
          wait_seconds: { type: "integer", minimum: 0, maximum: 240, default: 60 },
        },
      },
    },
    {
      name: "get_task",
      description:
        "Track any task by its id — image/video generation AND merging (reads the database and refreshes live from the provider/merging service while still running). Tasks exceeding their maximum duration (600s images, 1800s videos) turn failed automatically. Poll it every ~10 seconds; when completed you will find the result URLs — show them to the user and stop polling.",
      inputSchema: {
        type: "object",
        properties: { task_id: { type: "string" } },
        required: ["task_id"],
      },
    },
    {
      name: "list_media",
      description:
        "List the latest stored images/videos/merges with their URLs from the database (no re-generation) — for recalling previous results.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["image", "video", "merge"] },
          status: { type: "string", enum: ["completed", "failed", "processing"] },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
        },
      },
    },
    {
      name: "retry_task",
      description:
        "Re-run a stuck or failed task instantly (6th tool): resets it (status=processing, clears provider binding and result) and re-submits it with the SAME original inputs and SAME task_id, trying all keys sequentially. Inputs: task_id (required); force_provider (optional) to force one specific provider by its id (e.g. 'kie' or 'cometapi' or a custom provider id). Works for image, video and merge tasks.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "معرّف المهمة العالقة أو الفاشلة" },
          force_provider: { type: "string", description: "اختياري — إجبار المحاولة على مزود محدد بمعرّفه (مثل kie أو cometapi أو مزود أضفته بنفسك)" },
        },
        required: ["task_id"],
      },
    },
  ];
}

// ----------------------------- أدوات مساعدة -----------------------------

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], ...(isError ? { isError: true } : {}) };
}

function pickEnum(v: unknown, allowed: string[], fallback: string): string {
  return typeof v === "string" && allowed.includes(v) ? v : fallback;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? Math.floor(v) : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** مُرسِل إشعارات التقدم — يعمل فقط إذا زوّد العميل الطلب بـ _meta.progressToken */
function makeProgressSender(extra: { sendNotification: (n: unknown) => Promise<void>; _meta?: Record<string, unknown> }): (progress: number, message: string) => Promise<void> {
  const progressToken = extra._meta?.progressToken;
  return async (progress: number, message: string) => {
    if (progressToken === undefined || progressToken === null) return;
    try {
      await extra.sendNotification({
        method: "notifications/progress",
        params: { progressToken, progress: Math.max(0, Math.min(100, Math.round(progress))), total: 100, message },
      });
    } catch {
      // تجاهل فشل بث التقدم — لا يؤثر على المهمة
    }
  };
}

function outcomeToResult(kind: "completed" | "processing" | "failed", task: import("@/lib/turso").TaskRow) {
  if (kind === "completed") return textResult(fmtTaskDone(task));
  if (kind === "failed") return textResult(fmtFailed(task.error_message || "سبب غير معروف"), true);
  return textResult(fmtProcessing(task));
}

/** قائمة الموديلات المتاحة لرسالة الخطأ — من القاعدة مع الاحتياط */
async function availableModelsText(type: "image" | "video"): Promise<string> {
  try {
    const dyn = await listDynamicModels();
    const list = dyn.filter((m) => m.type === type).map((m) => m.canonical);
    if (list.length) return `${list.join(" ، ")} — ويمكن أيضًا تمرير أي اسم موديل آخر وسإرساله كما هو للمزودين`;
  } catch {
    // احتياط ثابت
  }
  return type === "image" ? IMAGE_MODEL.canonical : VIDEO_MODEL.canonical;
}

/**
 * حلّ اسم الموديل مع التمرير المباشر:
 * مسجل في الخرائط → تعريفه الكامل | غير مسجل → يُرسل كما هو لكل مزود مفعّل (خطأ الطول فقط يُرفض)
 */
async function resolveModelOrPassthrough(modelInput: string, type: "image" | "video"): Promise<ModelDef | { error: string }> {
  const clean = (modelInput || "").trim();
  if (!clean) return { error: "اسم الموديل فارغ" };
  if (clean.length > 160) return { error: `اسم الموديل طويل جدًا (${clean.length} حرفًا — الحد 160)` };
  const resolved = await resolveModel(clean);
  if (resolved && resolved.type === type) return resolved;
  if (resolved && resolved.type !== type) {
    return { error: `الموديل «${clean}» موديل ${resolved.type === "video" ? "فيديو" : "صور"} وليس ${type === "video" ? "فيديو" : "صور"}` };
  }
  // غير مسجل — لكن يوجد اسم موديل بالطول الكامل معطّل بالكامل → حكمه بيد المستخدم (لا نمرّره)
  try {
    const anyRows = await listModelMappings({ canonical: clean });
    if (anyRows.length) {
      return { error: `الموديل «${clean}» موجود لكن كل خرائطه معطلة — فعّل خريطة من إدارة الموديلات` };
    }
  } catch {
    // تجاهل — استمر في التمرير
  }
  return buildPassthroughModel(clean, type);
}

// ----------------------------- منطق الأدوات -----------------------------

async function callTool(name: string, args: Record<string, unknown>, extra: ToolExtra) {
  switch (name) {
    case "generate_image": {
      const prompt = String(args.prompt ?? "").trim();
      if (!prompt) return textResult("❌ المعطى prompt مطلوب لتوليد الصورة.", true);
      const modelInput = args.model ? String(args.model) : IMAGE_MODEL.canonical;
      const modelRes = await resolveModelOrPassthrough(modelInput, "image");
      if ("error" in modelRes) {
        return textResult(`❌ ${modelRes.error}. المتاح للصور: ${await availableModelsText("image")}`, true);
      }
      const model = modelRes;
      const outcome = await runGeneration({
        type: "image",
        model,
        input: {
          prompt,
          aspect_ratio: pickEnum(args.aspect_ratio, IMAGE_ASPECTS, "auto"),
          resolution: pickEnum(args.resolution, ["1K", "2K", "4K"], "1K"),
          background: pickEnum(args.background, ["auto", "transparent", "opaque"], "auto"),
          output_format: pickEnum(args.output_format, ["png", "jpeg", "webp", "gif"], "png"),
        },
        prompt,
        waitSeconds: clampInt(args.wait_seconds, 0, 240, 90),
        onProgress: makeProgressSender(extra),
      });
      return outcomeToResult(outcome.kind, outcome.task);
    }

    case "generate_video": {
      const prompt = String(args.prompt ?? "").trim();
      if (!prompt) return textResult("❌ المعطى prompt مطلوب لتوليد الفيديو.", true);
      if (prompt.length > 4096) return textResult("❌ طول الوصف يتجاوز 4096 حرفًا.", true);
      const modelInput = args.model ? String(args.model) : VIDEO_MODEL.canonical;
      const modelRes = await resolveModelOrPassthrough(modelInput, "video");
      if ("error" in modelRes) {
        return textResult(`❌ ${modelRes.error}. المتاح للفيديو: ${await availableModelsText("video")}`, true);
      }
      const model = modelRes;
      const imageUrl = typeof args.image_url === "string" && /^https?:\/\//i.test(args.image_url) ? args.image_url : undefined;
      const outcome = await runGeneration({
        type: "video",
        model,
        input: {
          prompt,
          ...(imageUrl ? { image_url: imageUrl } : {}),
          aspect_ratio: pickEnum(args.aspect_ratio, VIDEO_ASPECTS, "auto"),
          resolution: pickEnum(args.resolution, ["480p", "720p", "1080p"], "480p"),
          enable_audio: args.enable_audio === undefined ? true : Boolean(args.enable_audio),
          duration: clampInt(args.duration, 1, 15, 8),
        },
        prompt,
        waitSeconds: clampInt(args.wait_seconds, 0, 240, 25),
        onProgress: makeProgressSender(extra),
      });
      return outcomeToResult(outcome.kind, outcome.task);
    }

    case "merge_videos": {
      const urls = Array.isArray(args.urls) ? args.urls.map((u) => String(u)) : undefined;
      const taskIds = Array.isArray(args.task_ids) ? args.task_ids.map((u) => String(u)) : undefined;
      if ((!urls || urls.length === 0) && (!taskIds || taskIds.length === 0)) {
        return textResult("❌ الدمج يحتاج مقطعَين على الأقل. مرّر urls (روابط مباشرة) أو task_ids لمهام مكتملة.", true);
      }
      const outcome = await runMerge({
        urls,
        task_ids: taskIds,
        waitSeconds: clampInt(args.wait_seconds, 0, 240, 60),
        onProgress: makeProgressSender(extra),
      });
      if (outcome.kind === "completed") return textResult(fmtMergeDone((outcome.task.result_urls_json ? JSON.parse(outcome.task.result_urls_json) : []) as string[]));
      if (outcome.kind === "failed") return textResult(fmtFailed(outcome.task.error_message || "سبب غير معروف"), true);
      return textResult(fmtProcessing(outcome.task));
    }

    case "get_task": {
      const taskId = String(args.task_id ?? "").trim();
      if (!taskId) return textResult("❌ المعطى task_id مطلوب.", true);
      const task = await refreshTask(taskId);
      if (!task) return textResult(`❌ لا توجد مهمة بهذا المعرّف: ${taskId}`, true);
      if (task.status === "completed") return textResult(fmtTaskDone(task));
      if (task.status === "failed") return textResult(fmtFailed(task.error_message || "سبب غير معروف"), true);
      return textResult(fmtProcessing(task));
    }

    case "list_media": {
      const type = pickEnum(args.type, ["image", "video", "merge"], "");
      const status = pickEnum(args.status, ["completed", "failed", "processing"], "");
      const limit = clampInt(args.limit, 1, 50, 10);
      const tasks = await listRecentTasks(limit, { type: type || undefined, status: status || undefined });
      if (!tasks.length) return textResult("📋 لا توجد وسائط مخزنة مطابقة حتى الآن.");
      const lines = tasks.map((t, i) => fmtTaskLine(t, i + 1));
      return textResult(`📋 أحدث الوسائط المخزنة (${tasks.length}):\n\n${lines.join("\n\n")}`);
    }

    case "retry_task": {
      // الأداة السادسة (قسم 5): إعادة محاولة مهمة عالقة أو فاشلة فورًا — اختياريًا على مزود محدد
      const taskId = String(args.task_id ?? "").trim();
      if (!taskId) return textResult("❌ المعطى task_id مطلوب لإعادة المحاولة.", true);
      const forceProvider = typeof args.force_provider === "string" && args.force_provider.trim() ? args.force_provider.trim() : undefined;
      const task = await getTask(taskId);
      if (!task) return textResult(`❌ لا توجد مهمة بهذا المعرّف: ${taskId}`, true);

      if (task.type === "merge") {
        const updated = await retryMergeTask(taskId);
        if (!updated) return textResult("❌ تعذّرت إعادة محاولة مهمة الدمج.", true);
        if (updated.status === "completed") return textResult(fmtMergeDone(parseUrls(updated.result_urls_json)));
        if (updated.status === "failed") return textResult(fmtFailed(updated.error_message || "سبب غير معروف"), true);
        return textResult(fmtProcessing(updated));
      }
      if (task.type !== "image" && task.type !== "video") {
        return textResult(`❌ نوع المهمة «${task.type}» غير قابل لإعادة المحاولة.`, true);
      }
      const updated = await retryGenerationTask(taskId, forceProvider);
      if (!updated) return textResult("❌ تعذّرت إعادة محاولة المهمة.", true);
      if (updated.status === "completed") {
        const urls = parseUrls(updated.result_urls_json);
        if (updated.type === "image" && urls.length) return textResult(fmtImageDone(urls));
        if (updated.type === "video" && urls.length) return textResult(fmtVideoDone(urls));
      }
      if (updated.status === "failed") return textResult(fmtFailed(updated.error_message || "سبب غير معروف"), true);
      const forcedNote = forceProvider ? `\n\n(مُجبرة على المزود: ${forceProvider})` : "";
      return textResult(`🔄 أُعيدت إنتاج المهمة بنفس المعطيات وهي الآن قيد المعالجة.\n\n${fmtProcessing(updated)}${forcedNote}`);
    }

    default:
      return textResult(
        `❌ أداة غير معروفة: ${name}. المتاح: generate_image، generate_video، merge_videos، get_task، list_media، retry_task`,
        true,
      );
  }
}

type ToolExtra = Parameters<Parameters<Server["setRequestHandler"]>[1]>[1] extends never ? never : {
  sendNotification: (n: unknown) => Promise<void>;
  _meta?: Record<string, unknown>;
};

// ----------------------------- إدارة الجلسات -----------------------------

interface SessionEntry {
  transport: WebStandardStreamableHTTPServerTransport;
  server: Server;
}

// خريطة الجلسات على globalThis لتبقى عبر إعادة التحميل الساخن في التطوير
const g = globalThis as unknown as { __mcpSessions?: Map<string, SessionEntry> };
const SESSIONS: Map<string, SessionEntry> = (g.__mcpSessions ??= new Map());

function createServer(): Server {
  const server = new Server(SERVER_INFO, {
    instructions: SERVER_INSTRUCTIONS,
    capabilities: { tools: {} },
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await buildTools() }));

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const name = String(req.params.name ?? "");
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      return await callTool(name, args, extra as unknown as ToolExtra);
    } catch (e) {
      // أخطاء قواعد العمل تخرج للعميل كما هي (رسائل عربية واضحة)؛ أخطاء المفاتيح/الرصيد لا تخرج أبدًا
      if (e instanceof RuleError) return textResult(e.message, true);
      console.error("MCP tool error:", e instanceof Error ? e.message : e);
      return textResult("❌ حدث خطأ داخلي غير متوقع أثناء تنفيذ الأداة. أعد المحاولة لاحقًا.", true);
    }
  });

  return server;
}

function checkAuth(req: Request): Response | null {
  const token = process.env.MCP_ACCESS_TOKEN;
  if (!token) return null;
  const h = req.headers.get("authorization") || "";
  if (h === `Bearer ${token}`) return null;
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: مطلوب توكن وصول صالح عبر Authorization: Bearer" }, id: null }),
    { status: 401, headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="mcp"' } },
  );
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

async function handleWithTransport(req: Request, entry: SessionEntry): Promise<Response> {
  try {
    // النقل القياسي يعمل بواجهات Web Request/Response مباشرة — بديل تام لجسر Node
    const res = await entry.transport.handleRequest(req);
    // دمج ترويسات CORS مع الحفاظ على البث الحي
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    console.error("MCP transport error:", e instanceof Error ? e.message : e);
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }
}

// ----------------------------- معالجات المسار -----------------------------

export async function POST(req: Request) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const sessionId = req.headers.get("mcp-session-id");
  let entry = sessionId ? SESSIONS.get(sessionId) : undefined;

  if (sessionId && !entry) {
    // جلسة غير معروفة (انتهت أو أعاد التشغيل مسح الذاكرة) — 404 حسب المواصفة
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found — أعد التهيئة بطلب initialize" }, id: null }),
      { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }

  if (!entry) {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      // يُسجَّل المعرّف عند اكتمال initialize
      onsessioninitialized: (sid: string) => {
        SESSIONS.set(sid, entry!);
      },
    });
    const server = createServer();
    await server.connect(transport);
    // حذف تلقائي عند إغلاق الجلسة (DELETE أو خطأ)
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) SESSIONS.delete(sid);
    };
    entry = { transport, server };
  }

  return handleWithTransport(req, entry);
}

export async function GET(req: Request) {
  const denied = checkAuth(req);
  if (denied) return denied;
  const sessionId = req.headers.get("mcp-session-id");
  const entry = sessionId ? SESSIONS.get(sessionId) : undefined;
  if (sessionId && !entry) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
  if (!entry) {
    // فتح قناة SSE مستقلة يتطلب جلسة قائمة في وضع الجلسات
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Mcp-Session-Id header required" }, id: null }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
  return handleWithTransport(req, entry);
}

export async function DELETE(req: Request) {
  const denied = checkAuth(req);
  if (denied) return denied;
  const sessionId = req.headers.get("mcp-session-id");
  const entry = sessionId ? SESSIONS.get(sessionId) : undefined;
  if (sessionId && !entry) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
  if (!entry) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Mcp-Session-Id header required" }, id: null }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
  return handleWithTransport(req, entry);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
