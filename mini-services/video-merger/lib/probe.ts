// فحص ملفات الفيديو عبر ffprobe واستخراج الخصائص المطلوبة
import { ApiError } from "./http";

export interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  duration: number;
  hasAudio: boolean;
}

// تحويل كسر مثل "30000/1001" إلى رقم
function parseFraction(v: unknown): number {
  if (typeof v !== "string" || !v.includes("/")) return Number(v) || 0;
  const [a, b] = v.split("/");
  const num = Number(a);
  const den = Number(b);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

// تشغيل ffprobe وإرجاع JSON الخصائص
async function ffprobeJson(file: string): Promise<{ streams?: any[]; format?: { duration?: string } }> {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) throw new ApiError(500, "تعذر تحليل أحد المقاطع (ffprobe)");
  try {
    return JSON.parse(stdout);
  } catch {
    throw new ApiError(500, "تعذر تحليل أحد المقاطع (ffprobe)");
  }
}

// فحص مصدر/ناتج: الأبعاد والإطار ومدة الصوت
export async function probeVideo(file: string): Promise<ProbeResult> {
  const info = await ffprobeJson(file);
  const streams = info.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  if (!video || typeof video.width !== "number" || typeof video.height !== "number") {
    throw new ApiError(500, "أحد المقاطع لا يحتوي على مسار فيديو صالح");
  }
  const hasAudio = streams.some((s) => s.codec_type === "audio");
  const duration = Number(video.duration ?? info.format?.duration ?? 0);
  const fps = parseFraction(video.avg_frame_rate) || parseFraction(video.r_frame_rate) || 0;
  return {
    width: video.width,
    height: video.height,
    fps,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    hasAudio,
  };
}
