// PATCH/DELETE /api/models/{id} — تعديل خريطة موديل / تفعيل / تعطيل / حذف (قسم 7)
import { NextRequest } from "next/server";
import { ensureSchema, patchModelMapping, deleteModelMapping, getProviderById } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (id === null) return Response.json({ error: "معرّف الخريطة غير صالح" }, { status: 400 });

  let body: {
    canonical?: string;
    type?: string;
    provider_id?: string;
    provider_model_name?: string;
    default_params_json?: string | null;
    priority?: number;
    enabled?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "جسم الطلب ليس JSON صالحًا" }, { status: 400 });
  }

  const patch: Parameters<typeof patchModelMapping>[1] = {};
  if (body.canonical !== undefined) {
    const canonical = String(body.canonical).trim();
    if (!canonical || canonical.length > 120) return Response.json({ error: "الاسم الموحد غير صالح" }, { status: 400 });
    patch.canonical = canonical;
  }
  if (body.type !== undefined) {
    const type = String(body.type).trim();
    if (type !== "image" && type !== "video") return Response.json({ error: "النوع يجب أن يكون image أو video" }, { status: 400 });
    patch.type = type;
  }
  if (body.provider_id !== undefined) {
    const providerId = String(body.provider_id).trim();
    const provider = await getProviderById(providerId);
    if (!provider) return Response.json({ error: "لا يوجد مزود بهذا المعرّف" }, { status: 400 });
    patch.provider_id = providerId;
  }
  if (body.provider_model_name !== undefined) {
    const name = String(body.provider_model_name).trim();
    if (!name || name.length > 160) return Response.json({ error: "اسم الموديل لدى المزود غير صالح" }, { status: 400 });
    patch.provider_model_name = name;
  }
  if (body.default_params_json !== undefined) {
    if (body.default_params_json === null || String(body.default_params_json).trim() === "") {
      patch.default_params_json = null;
    } else {
      try {
        JSON.parse(String(body.default_params_json));
        patch.default_params_json = String(body.default_params_json);
      } catch {
        return Response.json({ error: "المعطيات الافتراضية يجب أن تكون JSON صالحًا" }, { status: 400 });
      }
    }
  }
  if (body.priority !== undefined) {
    const p = Number(body.priority);
    if (!Number.isFinite(p)) return Response.json({ error: "الأولوية يجب أن تكون رقمًا" }, { status: 400 });
    patch.priority = Math.floor(p);
  }
  if (body.enabled !== undefined) patch.enabled = body.enabled ? 1 : 0;

  const mapping = await patchModelMapping(id, patch);
  if (!mapping) return Response.json({ error: "لا توجد خريطة موديل بهذا المعرّف" }, { status: 404 });
  return Response.json({ mapping });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id: rawId } = await ctx.params;
  const id = parseId(rawId);
  if (id === null) return Response.json({ error: "معرّف الخريطة غير صالح" }, { status: 400 });
  const ok = await deleteModelMapping(id);
  if (!ok) return Response.json({ error: "لا توجد خريطة موديل بهذا المعرّف" }, { status: 404 });
  return Response.json({ ok: true });
}
