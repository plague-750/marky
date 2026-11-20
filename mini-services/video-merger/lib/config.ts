// الإعدادات العامة: تُقرأ من متغيرات البيئة مع قيم افتراضية، وتعريف المسارات
import { join } from "node:path";

// قراءة رقم صحيح موجب من البيئة مع قيمة افتراضية
function intEnv(name: string, def: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

// قراءة نص من البيئة مع قيمة افتراضية
function strEnv(name: string, def: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : def;
}

export const MB = 1024 * 1024;

export const config = {
  version: "2.0.0",
  maxSources: intEnv("MAX_SOURCES", 10),
  sourceMaxMB: intEnv("SOURCE_MAX_MB", 200),
  outputMaxMB: intEnv("OUTPUT_MAX_MB", 150),
  maxTotalDurationSec: intEnv("MAX_TOTAL_DURATION_SEC", 600),
  ffmpegPreset: strEnv("FFMPEG_PRESET", "medium"),
  uploadChunkBytes: intEnv("UPLOAD_CHUNK_BYTES", 4194304),
};

// المسارات: السجل داخل مجلد الخدمة، وملفات العمل في /tmp خارج المستودع
export const paths = {
  dataDir: join(import.meta.dir, "..", ".data"),
  registryFile: join(import.meta.dir, "..", ".data", "jobs.json"),
  tmpRoot: "/tmp/video-merger",
  jobDir: (id: string) => `/tmp/video-merger/${id}`,
  outputPath: (id: string) => `/tmp/video-merger/${id}/output.mp4`,
};
