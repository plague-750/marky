// خط أنابيب الدمج: تنزيل المصادر ← فحصها ← أمر ffmpeg واحد ← التحقق من الناتج
import { mkdir, unlink } from "node:fs/promises";
import { statSync, unlinkSync } from "node:fs";
import { config, MB, paths } from "./config";
import { ApiError } from "./http";
import { updateJob } from "./registry";
import { downloadSource } from "./download";
import { probeVideo, type ProbeResult } from "./probe";

// تقريب رقم لأقرب عدد زوجي (شرط ترميز yuv420p)
function evenize(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

// حساب أبعاد اللوحة: أكبر عرض/ارتفاع مع سقف 1920×1080 وقيم زوجية
function computeCanvas(probes: ProbeResult[]): { W: number; H: number } {
  let W = Math.max(...probes.map((p) => p.width));
  let H = Math.max(...probes.map((p) => p.height));
  if (W > 1920 || H > 1080) {
    // تقليص متناسب مع الحفاظ على أكبر نسبة أبعاد
    const factor = Math.min(1920 / W, 1080 / H);
    W = evenize(W * factor);
    H = evenize(H * factor);
  } else {
    W = evenize(W);
    H = evenize(H);
  }
  return { W, H };
}

export async function runPipeline(jobId: string, videos: string[]): Promise<void> {
  const dir = paths.jobDir(jobId);
  const outPath = paths.outputPath(jobId);
  await mkdir(dir, { recursive: true });
  const n = videos.length;

  try {
    // (أ) التنزيل: التقدم من 0 إلى 40 موزعاً على كل المصادر
    for (let i = 0; i < n; i++) {
      const base = (i / n) * 40;
      const span = 40 / n;
      await downloadSource({
        url: videos[i],
        dest: `${dir}/src-${i}.bin`,
        index: i,
        onProgress: (frac) => updateJob(jobId, { progress: Math.min(40, Math.round(base + span * frac)) }),
      });
    }

    // (ب) فحص كل مقطع واستخراج الخصائص والتحقق من مجموع المدد
    const probes: ProbeResult[] = [];
    for (let i = 0; i < n; i++) probes.push(await probeVideo(`${dir}/src-${i}.bin`));
    const totalDuration = probes.reduce((s, p) => s + p.duration, 0);
    if (totalDuration > config.maxTotalDurationSec) {
      throw new ApiError(500, `مجموع مدد المقاطع يتجاوز ${config.maxTotalDurationSec} ثانية`);
    }

    // (ج) بناء مرشحات ffmpeg: لوحة موحدة للفيديو وصوت متسق للكل
    const { W, H } = computeCanvas(probes);
    const chains: string[] = [];
    for (let i = 0; i < n; i++) {
      chains.push(
        `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,setsar=1,format=yuv420p[v${i}]`,
      );
      const p = probes[i];
      if (p.hasAudio) {
        chains.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
      } else {
        // توليد صمت بنفس مدة المقطع عند غياب المسار الصوتي
        const d = Math.max(p.duration, 0.1).toFixed(3);
        chains.push(`anullsrc=channel_layout=stereo:sample_rate=44100[z${i}];[z${i}]atrim=duration=${d},asetpts=PTS-STARTPTS[a${i}]`);
      }
    }
    chains.push(`${probes.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[vout][aout]`);
    const filterComplex = chains.join(";");

    const args: string[] = ["ffmpeg", "-y"];
    for (let i = 0; i < n; i++) args.push("-i", `${dir}/src-${i}.bin`);
    args.push(
      "-filter_complex", filterComplex,
      "-map", "[vout]", "-map", "[aout]",
      "-c:v", "libx264", "-preset", config.ffmpegPreset, "-crf", "18",
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100",
      "-movflags", "+faststart",
      "-f", "mp4", "-progress", "pipe:1", "-nostats",
      outPath,
    );

    updateJob(jobId, { progress: 40 });
    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      timeout: 15 * 60 * 1000, // سقف أمان: 15 دقيقة
    });

    // قراءة سطور التقدم من stdout وتحويل out_time_us إلى نسبة إنجاز 40→90
    const readProgress = (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          const eq = line.indexOf("=");
          if (eq <= 0) continue;
          const key = line.slice(0, eq);
          const val = line.slice(eq + 1);
          if (key === "out_time_us" && totalDuration > 0) {
            const us = Number(val);
            if (Number.isFinite(us)) {
              const pct = 40 + (50 * (us / 1e6)) / totalDuration;
              updateJob(jobId, { progress: Math.max(40, Math.min(90, Math.round(pct))) });
            }
          }
        }
      }
    })();

    // جمع ذيل سجل stderr لرسائل الخطأ التشخيصية
    let stderrTail = "";
    const readStderr = (async () => {
      const text = await new Response(proc.stderr).text();
      stderrTail = text.trim().split("\n").slice(-3).join(" | ").slice(0, 300);
    })();

    const [code] = await Promise.all([proc.exited, readProgress, readStderr]);
    if (code !== 0) {
      throw new ApiError(500, `فشل ترميز الفيديو${stderrTail ? `: ${stderrTail}` : ""}`);
    }

    // (د) التحقق من الناتج: الحد الأقصى للحجم ثم اعتباره جاهزاً (90→100)
    const size = statSync(outPath).size;
    if (size > config.outputMaxMB * MB) {
      try {
        unlinkSync(outPath);
      } catch {
        /* تجاهل */
      }
      throw new ApiError(413, "حجم الناتج يتجاوز الحد المسموح");
    }
    const out = await probeVideo(outPath);
    updateJob(jobId, {
      status: "done",
      progress: 100,
      size,
      duration: out.duration > 0 ? out.duration : totalDuration,
      resolution: `${out.width}x${out.height}`,
    });
  } finally {
    // تنظيف المصادر المؤقتة دائماً مع الإبقاء على output.mp4
    for (let i = 0; i < n; i++) {
      try {
        await unlink(`${dir}/src-${i}.bin`);
      } catch {
        /* تجاهل */
      }
    }
  }
}
