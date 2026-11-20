// GET /api/tasks — أحدث المهام + الإحصائيات للوحة المهام (تحديث تلقائي كل ~5 ثوانٍ)
// كما يُشغّل التحديث الذاتي: المهام الجارية التي لم تُحدَّث مؤخرًا تُستعلم حالتها
// من المزود/خدمة الدمج خلفيًا حتى لا تبقى عالقة أبدًا حتى لو لم يستعلمها عميل MCP.
import { NextRequest } from "next/server";
import { ensureSchema, listRecentTasks, taskStats, parseTs, serializeTask } from "@/lib/turso";
import { refreshTask } from "@/lib/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** المهام التي تجاوز عمرها منذ آخر تحديث هذا الحد تُستعلم حالتها خلفيًا */
const STALE_MS = 15_000;
/** أقصى عدد مهام تُحدَّث خلفيًا في كل استقصاء — حماية من الضغط على المزودين */
const MAX_REFRESH_PER_POLL = 3;

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

  // التحديث الذاتي للمهام العالقة — خلفيًا دون تعطيل الاستجابة، ونتيجتها تظهر في الاستقصاء التالي
  const now = Date.now();
  const stale = tasks
    .filter(
      (t) =>
        (t.status === "processing" || t.status === "pending") &&
        now - parseTs(t.updated_at) >= STALE_MS,
    )
    .slice(0, MAX_REFRESH_PER_POLL);
  for (const t of stale) {
    refreshTask(t.id).catch(() => {}); // مقصود دون await — لا يعطل الاستجابة
  }

  return Response.json(
    { stats, tasks: tasks.map(serializeTask) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
