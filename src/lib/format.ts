// صياغة الردود العربية للأدوات (قسم 8) — المصطلحات التقنية وأسماء الأدوات تبقى بالإنجليزية
import type { TaskRow } from "./turso";
import { parseUrls } from "./turso";

export const TYPE_AR: Record<string, string> = { image: "صورة", video: "فيديو", merge: "دمج" };

export function statusAr(status: string): string {
  switch (status) {
    case "completed":
      return "✅ مكتملة";
    case "failed":
      return "❌ فاشلة";
    default:
      return "⏳ جارية";
  }
}

export function fmtImageDone(urls: string[]): string {
  const lines = [`✅ تم توليد الصورة بنجاح`, ``, `![image](<${urls[0]}>)`, ``, `الرابط المباشر: ${urls[0]}`];
  if (urls.length > 1) {
    lines.push(``, `روابط إضافية:`);
    for (const u of urls.slice(1)) lines.push(`- ${u}`);
  }
  return lines.join("\n");
}

export function fmtVideoDone(urls: string[]): string {
  const lines = [`✅ تم توليد الفيديو بنجاح`, ``, `الروابط المباشرة:`];
  for (const u of urls) lines.push(`- ${u}`);
  return lines.join("\n");
}

export function fmtMergeDone(urls: string[]): string {
  const lines = [`✅ تم دمج المقاطع بنجاح`, ``, `الرابط المباشر: ${urls[0]}`];
  if (urls.length > 1) {
    lines.push(``, `روابط إضافية:`);
    for (const u of urls.slice(1)) lines.push(`- ${u}`);
  }
  lines.push(``, `⚠️ ملف الدمج يُحذف من خدمة الدمج بعد ~24 ساعة — شاهده/نزّله سريعًا.`);
  return lines.join("\n");
}

export function fmtProcessing(task: TaskRow): string {
  const pct = Math.max(0, Math.min(100, Math.round(task.progress)));
  const head = pct > 0 && pct < 100 ? `⏳ المهمة قيد المعالجة (${pct}%) — task_id: ${task.id}` : `⏳ المهمة قيد المعالجة — task_id: ${task.id}`;
  return `${head}\n\nتابع بـ get_task كل ~10 ثوانٍ حتى تكتمل.`;
}

export function fmtFailed(reason: string): string {
  return `❌ فشلت المهمة: ${reason}`;
}

/** تنسيق مهمة مكتملة حسب نوعها */
export function fmtTaskDone(task: TaskRow): string {
  const urls = parseUrls(task.result_urls_json);
  if (task.type === "image" && urls.length) return fmtImageDone(urls);
  if (task.type === "video" && urls.length) return fmtVideoDone(urls);
  if (task.type === "merge" && urls.length) return fmtMergeDone(urls);
  return `✅ اكتملت المهمة.\n\nالروابط: ${urls.join(" ، ") || "(لا روابط)"}`;
}

/** سطر موجز لمهمة داخل قائمة list_media */
export function fmtTaskLine(task: TaskRow, index: number): string {
  const urls = parseUrls(task.result_urls_json);
  const snippet = task.prompt ? task.prompt.slice(0, 120) : task.model;
  const base = `${index}. [${TYPE_AR[task.type] ?? task.type}] ${statusAr(task.status)} — ${snippet}`;
  if (!urls.length) return base;
  return `${base}\n   ${urls.map((u) => `- ${u}`).join("\n   ")}${task.type === "merge" ? "\n   ⚠️ يُحذف بعد ~24 ساعة" : ""}`;
}
