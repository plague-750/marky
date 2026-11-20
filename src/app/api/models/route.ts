// GET/POST /api/models — خرائط الموديلات canonical ← provider_model_name (قسم 7 من المواصفة)
import { NextRequest } from "next/server";
import { ensureSchema, listModelMappings, insertModelMapping, getProviderById } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureSchema();
  const sp = req.nextUrl.searchParams;
  const canonical = sp.get("canonical") || undefined;
  const type = sp.get("type") || undefined;
  const providerId = sp.get("provider_id") || undefined;
  const mappings = await listModelMappings({
    canonical: canonical || undefined,
    type: type || undefined,
    provider_id: providerId || undefined,
  });
  return Response.json({ mappings }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  let body: {
    canonical?: string;
    type?: string;
    provider_id?: string;
    provider_model_name?: string;
    default_params_json?: string;
    priority?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "جسم الطلب ليس JSON صالحًا" }, { status: 400 });
  }

  const canonical = String(body.canonical ?? "").trim();
  const type = String(body.type ?? "").trim();
  const providerId = String(body.provider_id ?? "").trim();
  const providerModelName = String(body.provider_model_name ?? "").trim();
  const defaultParams = String(body.default_params_json ?? "").trim();
  const priority = Number.isFinite(Number(body.priority)) ? Math.floor(Number(body.priority)) : 0;

  if (!canonical || canonical.length > 120) {
    return Response.json({ error: "الاسم الموحد للموديل (canonical) مطلوب حتى 120 حرفًا" }, { status: 400 });
  }
  if (type !== "image" && type !== "video") {
    return Response.json({ error: "نوع الموديل يجب أن يكون image أو video" }, { status: 400 });
  }
  if (!providerId) return Response.json({ error: "معرّف المزود مطلوب" }, { status: 400 });
  if (!providerModelName) return Response.json({ error: "اسم الموديل لدى المزود (provider_model_name) مطلوب" }, { status: 400 });
  if (providerModelName.length > 160) {
    return Response.json({ error: "اسم الموديل لدى المزود طويل جدًا (الحد 160 حرفًا)" }, { status: 400 });
  }
  if (defaultParams) {
    try {
      JSON.parse(defaultParams);
    } catch {
      return Response.json({ error: "المعطيات الافتراضية يجب أن تكون JSON صالحًا" }, { status: 400 });
    }
  }

  const provider = await getProviderById(providerId);
  if (!provider) {
    return Response.json({ error: `لا يوجد مزود بالمعرّف «${providerId}» — أضفه أولًا من إدارة المزودين` }, { status: 400 });
  }

  const mapping = await insertModelMapping({
    canonical,
    type,
    provider_id: providerId,
    provider_model_name: providerModelName,
    default_params_json: defaultParams || undefined,
    priority,
    enabled: 1,
  });
  return Response.json({ mapping }, { status: 201 });
}
