// مُوزّع refreshTask — get_task يحدّث أي مهمة جارية حية من المزود/خدمة الدمج (قسم 6)
import { getTask, type TaskRow } from "./turso";
import { refreshGenerationTask } from "./generation";
import { refreshMergeTask } from "./merge";

export async function refreshTask(taskId: string): Promise<TaskRow | null> {
  const task = await getTask(taskId);
  if (!task) return null;
  if (task.status === "completed" || task.status === "failed") return task;
  if (task.type === "merge") return refreshMergeTask(task);
  return refreshGenerationTask(task);
}
