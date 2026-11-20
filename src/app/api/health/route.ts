// GET /api/health — فحص شامل للجهوزية (قسم 9)
// الموديلات تُقرأ ديناميكيًا من جدول model_mappings مع الاحتياط الثابت
import { ensureSchema, dbHealthy, listProviders } from "@/lib/turso";
import { mergerHealthy, mergerBase, mergerConfigured } from "@/lib/merger";
import { listDynamicModels, ALL_MODELS } from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let database = "turso-disconnected";
  let ok = false;
  let models: Array<{ canonical: string; type: string; providers: string[] }> = [];
  let providers: Array<{ id: string; name: string; base_url: string; adapter_type: string; enabled: number }> = [];
  try {
    await ensureSchema();
    ok = await dbHealthy();
    database = ok ? "turso-connected" : "turso-disconnected";
    if (ok) {
      const dyn = await listDynamicModels();
      models = (dyn.length ? dyn : ALL_MODELS).map((m) => ({ canonical: m.canonical, type: m.type, providers: m.providers }));
      providers = (await listProviders()).map((p) => ({
        id: p.id,
        name: p.name,
        base_url: p.base_url,
        adapter_type: p.adapter_type,
        enabled: p.enabled,
      }));
    }
  } catch {
    ok = false;
    models = ALL_MODELS.map((m) => ({ canonical: m.canonical, type: m.type, providers: m.providers }));
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
      models,
      providers,
      merger: { base: mergerConfigured() ? mergerBase() : "(غير مضبوط)", healthy: mergerHealthyFlag },
      authRequired: !!process.env.MCP_ACCESS_TOKEN,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
