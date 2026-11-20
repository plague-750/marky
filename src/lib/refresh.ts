// مُوزّع refreshTask — get_task يحدّث أي مهمة جارية حية من المزود/خدمة الدمج (قسم 6)
// ولوحة المهام تستخدمه أيضًا للتحديث الذاتي للمهام العالقة.
// الحدود الزمنية (قسم 5 من المواصفة): مهمة تجاوزت TASK_TIMEOUT_SEC تتحول إلى failed.
import { getTask, updateTask, parseTs, type TaskRow } from "./turso";
import { refreshGenerationTask } from "./generation";
import { refreshMergeTask } from "./merge";

/** الحد الأقصى لمدة المهمة بالثواني — 600 للصور و 1800 للفيديو والدمج (قسم 5) */
export const TASK_TIMEOUT_SEC = {
  image: 600,
  video: 1800,
  merge: 1800,
} as const;

/** قفل في الذاكرة — يمنع استقصاء المزود نفسه مرتين متزامنتين (MCP + لوحة المهام) */
const inflight = new Set<string>();

function timeoutExceeded(task: TaskRow): boolean {
  // المهمة المرسلة للمزود فعليًا وتجاوزت مدتها القصوى — تعتبر فاشلة نهائيًا
  if (!task.provider_task_id) return false;
  const limit = TASK_TIMEOUT_SEC[task.type as keyof typeof TASK_TIMEOUT_SEC] ?? 1800;
  const elapsedSec = (Date.now() - parseTs(task.created_at)) / 1000;
  return elapsedSec > limit;
}

export async function refreshTask(taskId: string): Promise<TaskRow | null> {
  if (inflight.has(taskId)) return getTask(taskId);
  inflight.add(taskId);
  try {
    const task = await getTask(taskId);
    if (!task) return null;
    if (task.status === "completed" || task.status === "failed") return task;
    if (timeoutExceeded(task)) {
      const limit = TASK_TIMEOUT_SEC[task.type as keyof typeof TASK_TIMEOUT_SEC] ?? 1800;
      return (
        (await updateTask(task.id, {
          status: "failed",
          error_message: `تجاوزت المهمة الحد الأقصى للمدة (${limit} ثانية) دون اكتمال — أعد المحاولة بأداة retry_task أو زر إعادة الإنتاج`,
        })) ?? task
      );
    }
    if (task.type === "merge") return refreshMergeTask(task);
    return refreshGenerationTask(task);
  } finally {
    inflight.delete(taskId);
  }
}
