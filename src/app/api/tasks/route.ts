// GET /api/tasks — أحدث المهام + الإحصائيات للوحة المهام (تحديث تلقائي كل ~5 ثوانٍ)
import { NextRequest } from "next/server";
import { ensureSchema, listRecentTasks, taskStats, parseUrls } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureSchema();
  const sp = req.nextUrl.searchParams;
  const limit = Math.max(1, Math.min(50, Number(sp.get("limit") || 20)));
  const type = sp.get("type") || undefined;
  const status = sp.get("status") || undefined;

  const [tasks, stats] = await Promise.all([
    listRecentTasks(limit, { type, status }),
    taskStats(),
  ]);

  return Response.json(
    {
      stats,
      tasks: tasks.map((t) => ({
        id: t.id,
        provider: t.provider,
        model: t.model,
        type: t.type,
        prompt: t.prompt,
        status: t.status,
        progress: t.progress,
        result_urls: parseUrls(t.result_urls_json),
        error_message: t.error_message,
        attempts_count: t.attempts.length,
        attempts: t.attempts.map((a) => ({ provider: a.provider, keyLabel: a.keyLabel, ok: a.ok, errorClass: a.errorClass, error: a.error, at: a.at })),
        created_at: t.created_at,
        updated_at: t.updated_at,
        completed_at: t.completed_at,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
