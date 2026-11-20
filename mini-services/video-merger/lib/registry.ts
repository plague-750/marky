// سجل المهام: تحميل عند الإقلاع وحفظ فوري على القرص عند كل تعديل
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { paths } from "./config";
import { ApiError } from "./http";

export type JobStatus = "queued" | "processing" | "done" | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  progress: number;
  createdAt: string;
  expiresAt: string;
  // حقول داخلية لا تُعرض للعميل
  videos?: string[];
  // حقول تظهر عند النجاح أو الفشل فقط
  error?: string;
  size?: number;
  duration?: number;
  resolution?: string;
}

const jobs = new Map<string, Job>();

// إنشاء مجلد .data وتحميل السجل إن وُجد (مع تجاهل الأخطاء بلطف)
export function initRegistry(): void {
  try {
    mkdirSync(paths.dataDir, { recursive: true });
  } catch {
    /* تجاهل */
  }
  try {
    const raw = readFileSync(paths.registryFile, "utf8");
    const parsed = JSON.parse(raw) as Record<string, Job>;
    for (const [id, job] of Object.entries(parsed)) jobs.set(id, job);
  } catch {
    /* لا يوجد سجل بعد */
  }
}

// كتابة فورية للسجل (تتجاهل أخطاء الكتابة)
export function saveRegistry(): void {
  try {
    writeFileSync(paths.registryFile, JSON.stringify(Object.fromEntries(jobs), null, 2));
  } catch {
    /* تجاهل */
  }
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

// تعديل مهمة محفوظة وحفظ فوري
export function updateJob(id: string, patch: Partial<Job>): Job {
  const job = jobs.get(id);
  if (!job) throw new ApiError(404, "المهمة غير موجودة");
  Object.assign(job, patch);
  saveRegistry();
  return job;
}

// إنشاء مهمة جديدة بصلاحية 24 ساعة مع حفظ المصادر داخلياً
export function createJob(id: string, videos: string[], ttlMs: number): Job {
  const now = new Date();
  const job: Job = {
    id,
    status: "queued",
    progress: 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    videos,
  };
  jobs.set(id, job);
  saveRegistry();
  return job;
}

export function deleteJob(id: string): boolean {
  const ok = jobs.delete(id);
  if (ok) saveRegistry();
  return ok;
}

// حذف المهام المنتهية الصلاحية من السجل ومن /tmp
export function cleanupExpired(): void {
  const now = Date.now();
  let changed = false;
  for (const [id, job] of jobs) {
    if (new Date(job.expiresAt).getTime() < now) {
      jobs.delete(id);
      try {
        rmSync(`/tmp/video-merger/${id}`, { recursive: true, force: true });
      } catch {
        /* تجاهل */
      }
      changed = true;
    }
  }
  if (changed) saveRegistry();
}
