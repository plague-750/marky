// مُوزّع refreshTask — get_task يحدّث أي مهمة جارية حية من المزود/خدمة الدمج (قسم 6)
// ولوحة المهام تستخدمه أيضًا للتحديث الذاتي للمهام العالقة.
import { getTask, type TaskRow } from "./turso";
import { refreshGenerationTask } from "./generation";
import { refreshMergeTask } from "./merge";

/** قفل في الذاكرة — يمنع استقصاء المزود نفسه مرتين متزامنتين (MCP + لوحة المهام) */
const inflight = new Set<string>();

export async function refreshTask(taskId: string): Promise<TaskRow | null> {
  if (inflight.has(taskId)) return getTask(taskId);
  inflight.add(taskId);
  try {
    const task = await getTask(taskId);
    if (!task) return null;
    if (task.status === "completed" || task.status === "failed") return task;
    if (task.type === "merge") return refreshMergeTask(task);
    return refreshGenerationTask(task);
  } finally {
    inflight.delete(taskId);
  }
}
