// POST /api/generate — توليد صورة/فيديو مباشرة من «استوديو التوليد» في اللوحة
// نفس خط أنابيب MCP بالضبط: إنشاء المهمة على مجمع المفاتيح مجمّعًا حسب أسماء الـ API
// بالتجربة التسلسلية مع التبديل الفوري عند أي خطأ أو نفاد رصيد، ثم العودة للوحة المهام.
import { NextRequest } from "next/server";
import { ensureSchema, serializeTask } from "@/lib/turso";
import { runGeneration } from "@/lib/generation";
import { IMAGE_MODEL, VIDEO_MODEL, normalizeModel } from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_ASPECTS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"];
const VIDEO_ASPECTS = ["auto", "16:9", "9:16", "1:1"];
const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"];
const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"];

function pickEnum(v: unknown, allowed: string[], fallback: string): string {
  return typeof v === "string" && allowed.includes(v) ? v : fallback;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? Math.floor(v) : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export async function POST(req: NextRequest) {
  await ensureSchema();

  let body: {
    type?: string;
    prompt?: string;
    aspect_ratio?: string;
    resolution?: string;
    duration?: number | string;
    enable_audio?: boolean;
    image_url?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "جسم الطلب ليس JSON صالحًا" }, { status: 400 });
  }

  const type = body.type === "video" ? "video" : body.type === "image" ? "image" : "";
  if (!type) {
    return Response.json({ error: "النوع يجب أن يكون image أو video" }, { status: 400 });
  }

  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) {
    return Response.json({ error: "الوصف (prompt) مطلوب" }, { status: 400 });
  }
  if (prompt.length > 4096) {
    return Response.json({ error: "طول الوصف يتجاوز 4096 حرفًا" }, { status: 400 });
  }

  const model = normalizeModel(type === "video" ? VIDEO_MODEL.canonical : IMAGE_MODEL.canonical)!;

  if (type === "image") {
    const outcome = await runGeneration({
      type: "image",
      model,
      input: {
        prompt,
        aspect_ratio: pickEnum(body.aspect_ratio, IMAGE_ASPECTS, "auto"),
        resolution: pickEnum(body.resolution, IMAGE_RESOLUTIONS, "1K"),
        background: "auto",
        output_format: "png",
      },
      prompt,
      // نافذة انتظار قصيرة داخل الطلب: الصور المتزامنة تكتمل فورًا، والأبعد تُتابع من لوحة المهام
      waitSeconds: 25,
    });
    return Response.json(
      { outcome: outcome.kind, task: serializeTask(outcome.task) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const imageUrl =
    typeof body.image_url === "string" && /^https?:\/\/\S+/i.test(body.image_url.trim())
      ? body.image_url.trim()
      : undefined;

  const outcome = await runGeneration({
    type: "video",
    model,
    input: {
      prompt,
      ...(imageUrl ? { image_url: imageUrl } : {}),
      aspect_ratio: pickEnum(body.aspect_ratio, VIDEO_ASPECTS, "auto"),
      resolution: pickEnum(body.resolution, VIDEO_RESOLUTIONS, "480p"),
      enable_audio: body.enable_audio === undefined ? true : Boolean(body.enable_audio),
      duration: clampInt(body.duration, 1, 15, 8),
    },
    prompt,
    // الفيديو يأخذ دقائق — نعيد task_id سريعًا واللوحة تتابع التحديث كل 5 ثوانٍ
    waitSeconds: 8,
  });

  return Response.json(
    { outcome: outcome.kind, task: serializeTask(outcome.task) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
