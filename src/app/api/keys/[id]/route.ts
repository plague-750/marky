// PATCH/DELETE /api/keys/{id} — تعطيل/تنشيط يدوي وحذف + تعديل اسم الـ API/البروتوكول (قسم 4.4)
import { NextRequest } from "next/server";
import { ensureSchema, patchKey, deleteKey, rememberApiName, toSafeKey } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await ctx.params;
  let body: { status?: string; label?: string; provider?: string; protocol?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "جسم الطلب ليس JSON صالحًا" }, { status: 400 });
  }

  const patch: { status?: string; provider?: string; protocol?: string } = {};
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "disabled") {
      return Response.json({ error: "الحالة يجب أن تكون active أو disabled" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.provider !== undefined) {
    const name = String(body.provider).trim();
    if (!name) return Response.json({ error: "اسم الـ API لا يمكن أن يكون فارغًا" }, { status: 400 });
    if (name.length > 60) return Response.json({ error: "اسم الـ API طويل جدًا (الحد 60 حرفًا)" }, { status: 400 });
    patch.provider = name;
  }
  if (body.protocol !== undefined) {
    const protocol = String(body.protocol).trim();
    if (protocol !== "kie" && protocol !== "cometapi") {
      return Response.json({ error: "بروتوكول الاتصال يجب أن يكون kie أو cometapi" }, { status: 400 });
    }
    patch.protocol = protocol;
  }

  const key = await patchKey(id, patch);
  if (!key) return Response.json({ error: "لا يوجد مفتاح بهذا المعرّف" }, { status: 404 });
  if (patch.provider !== undefined) await rememberApiName(key.provider, key.protocol);
  return Response.json({ key: toSafeKey(key) });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await ctx.params;
  const ok = await deleteKey(id);
  if (!ok) return Response.json({ error: "لا يوجد مفتاح بهذا المعرّف" }, { status: 404 });
  return Response.json({ ok: true });
}
