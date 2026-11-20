// POST /api/tasks/{id}/retry — إعادة إنتاج مهمة يدويًا من لوحة المهام
// متاحة لأي حالة (فاشلة/جارية عالقة/مكتملة) وأي نوع (صورة/فيديو/دمج):
// تصفير كامل للمهمة ثم محاولة إنشاء فورية بنفس المعطيات الأصلية وبنفس task_id.
import { NextRequest } from "next/server";
import { ensureSchema, getTask, serializeTask } from "@/lib/turso";
import { retryGenerationTask } from "@/lib/generation";
import { retryMergeTask } from "@/lib/merge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await ctx.params;

  const task = await getTask(id);
  if (!task) return Response.json({ error: "لا توجد مهمة بهذا المعرّف" }, { status: 404 });

  const updated = task.type === "merge" ? await retryMergeTask(id) : await retryGenerationTask(id);
  if (!updated) {
    return Response.json({ error: "لا يمكن إعادة إنتاج هذا النوع من المهام" }, { status: 400 });
  }

  return Response.json(
    { task: serializeTask(updated) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
