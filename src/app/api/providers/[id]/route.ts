// PATCH/DELETE /api/providers/{id} — تعديل إعدادات المزود / تعطيل / حذف (قسم 7)
// الحذف يحذف معه خرائط موديلاته ومفاتيحه المتصلة (تعذر التوليد عبره بعدها)
import { NextRequest } from "next/server";
import { ensureSchema, patchProvider, deleteProvider, ADAPTER_TYPES, AUTH_TYPES } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await ctx.params;
  let body: {
    name?: string;
    base_url?: string;
    auth_type?: string;
    auth_header?: string;
    adapter_type?: string;
    image_endpoint?: string;
    video_endpoint?: string;
    check_endpoint?: string;
    enabled?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "جسم الطلب ليس JSON صالحًا" }, { status: 400 });
  }

  const patch: Parameters<typeof patchProvider>[1] = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return Response.json({ error: "اسم المزود لا يمكن أن يكون فارغًا" }, { status: 400 });
    patch.name = name;
  }
  if (body.base_url !== undefined) {
    const baseUrl = String(body.base_url).trim();
    if (!/^https?:\/\/.+/i.test(baseUrl)) {
      return Response.json({ error: "الرابط الأساسي يجب أن يبدأ بـ http أو https" }, { status: 400 });
    }
    patch.base_url = baseUrl;
  }
  if (body.auth_type !== undefined) {
    const authType = String(body.auth_type).trim();
    if (!AUTH_TYPES.has(authType)) {
      return Response.json({ error: `نوع التوثيق يجب أن يكون أحد: ${[...AUTH_TYPES].join(" أو ")}` }, { status: 400 });
    }
    patch.auth_type = authType;
  }
  if (body.auth_header !== undefined) patch.auth_header = String(body.auth_header).trim() || "Authorization";
  if (body.adapter_type !== undefined) {
    const adapterType = String(body.adapter_type).trim();
    if (!ADAPTER_TYPES.has(adapterType)) {
      return Response.json({ error: `نوع المحول يجب أن يكون أحد: ${[...ADAPTER_TYPES].join(" أو ")}` }, { status: 400 });
    }
    patch.adapter_type = adapterType;
  }
  for (const key of ["image_endpoint", "video_endpoint", "check_endpoint"] as const) {
    if (body[key] !== undefined) {
      const ep = String(body[key]).trim();
      if (ep && !ep.startsWith("/")) {
        return Response.json({ error: "نقاط النهاية يجب أن تبدأ بـ /" }, { status: 400 });
      }
      patch[key] = ep;
    }
  }
  if (body.enabled !== undefined) patch.enabled = body.enabled ? 1 : 0;

  const provider = await patchProvider(id, patch);
  if (!provider) return Response.json({ error: "لا يوجد مزود بهذا المعرّف" }, { status: 404 });
  return Response.json({ provider });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await ctx.params;
  const ok = await deleteProvider(id);
  if (!ok) return Response.json({ error: "لا يوجد مزود بهذا المعرّف" }, { status: 404 });
  return Response.json({ ok: true });
}
