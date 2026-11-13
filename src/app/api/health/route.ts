// GET /api/health — فحص شامل للجهوزية (قسم 9)
import { ensureSchema, dbHealthy } from "@/lib/turso";
import { mergerHealthy, mergerBase, mergerConfigured } from "@/lib/merger";
import { ALL_MODELS } from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let database = "turso-disconnected";
  let ok = false;
  try {
    await ensureSchema();
    ok = await dbHealthy();
    database = ok ? "turso-connected" : "turso-disconnected";
  } catch {
    ok = false;
  }

  // فحص خدمة الدمج بمهلة 4 ثوانٍ — لا يعطل ok
  let mergerHealthyFlag = false;
  try {
    mergerHealthyFlag = await mergerHealthy();
  } catch {
    mergerHealthyFlag = false;
  }

  return Response.json(
    {
      ok,
      database,
      mcpEndpoint: "/mcp",
      models: ALL_MODELS.map((m) => ({ canonical: m.canonical, type: m.type, providers: m.providers })),
      merger: { base: mergerConfigured() ? mergerBase() : "(غير مضبوط)", healthy: mergerHealthyFlag },
      authRequired: !!process.env.MCP_ACCESS_TOKEN,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
