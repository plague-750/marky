// PATCH/DELETE /api/keys/{id} — تعطيل/تنشيط يدوي وحذف (قسم 4.4)
import { NextRequest } from "next/server";
import { ensureSchema, patchKey, deleteKey, toSafeKey } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await ctx.params;
  let body: { status?: string; label?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "جسم الطلب ليس JSON صالحًا" }, { status: 400 });
  }

  const patch: { status?: string; label?: string } = {};
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "disabled") {
      return Response.json({ error: "الحالة يجب أن تكون active أو disabled" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.label !== undefined) patch.label = String(body.label);

  const key = await patchKey(id, patch);
  if (!key) return Response.json({ error: "لا يوجد مفتاح بهذا المعرّف" }, { status: 404 });
  return Response.json({ key: toSafeKey(key) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await ctx.params;
  const ok = await deleteKey(id);
  if (!ok) return Response.json({ error: "لا يوجد مفتاح بهذا المعرّف" }, { status: 404 });
  return Response.json({ ok: true });
}
