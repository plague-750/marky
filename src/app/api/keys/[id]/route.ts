// PATCH/DELETE /api/keys/{id} — تعطيل/تنشيط يدوي وحذف + تعديل طريقة الاتصال/البروتوكول (قسم 4.4)
import { NextRequest } from "next/server";
import {
  ensureSchema,
  patchKey,
  deleteKey,
  rememberApiName,
  listProviders,
  matchProviderIdFromText,
  autoProvisionProviderFromText,
  toSafeKey,
} from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await ctx.params;
  let body: { status?: string; label?: string; provider?: string; protocol?: string; capability?: string; auto_provision?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "جسم الطلب ليس JSON صالحًا" }, { status: 400 });
  }

  let autoProvisioned = false;

  const patch: { status?: string; provider?: string; protocol?: string; capability?: string } = {};
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "disabled") {
      return Response.json({ error: "الحالة يجب أن تكون active أو disabled" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.provider !== undefined) {
    const name = String(body.provider).trim();
    if (!name) return Response.json({ error: "طريقة الاتصال لا يمكن أن تكون فارغة" }, { status: 400 });
    if (name.length > 60) return Response.json({ error: "نص طريقة الاتصال طويل جدًا (الحد 60 حرفًا)" }, { status: 400 });
    patch.provider = name;
  }
  const autoProvisionWanted = Boolean(body.auto_provision);
  if (body.protocol !== undefined || (autoProvisionWanted && body.provider !== undefined)) {
    const protocol = String(body.protocol ?? "").trim();
    // المزود يجب أن يكون موجودًا في جدول providers — بلا Hardcoding.
    // معرّف صريح ← مطابقة النص الحر ← إنشاء مزود تلقائي (auto_provision) ← رفض بوضوح.
    const providers = await listProviders();
    let providerId: string | null = null;
    if (protocol && providers.some((p) => p.id === protocol)) {
      providerId = protocol;
    } else {
      providerId = matchProviderIdFromText(protocol || String(body.provider ?? ""), providers);
      if (!providerId && autoProvisionWanted) {
        try {
          const ap = await autoProvisionProviderFromText(String(body.provider ?? protocol));
          providerId = ap.id;
          autoProvisioned = ap.created;
        } catch {
          providerId = null;
        }
      }
    }
    if (!providerId) {
      return Response.json(
        { error: `المزود «${protocol}» غير موجود — أضفه أولًا من «إدارة المزودين»` },
        { status: 400 },
      );
    }
    patch.protocol = providerId;
  }
  if (body.capability !== undefined) {
    const capability = String(body.capability).trim();
    if (capability !== "both" && capability !== "image" && capability !== "video") {
      return Response.json(
        { error: "استخدام المفتاح يجب أن يكون: both أو image أو video" },
        { status: 400 },
      );
    }
    patch.capability = capability;
  }

  const key = await patchKey(id, patch);
  if (!key) return Response.json({ error: "لا يوجد مفتاح بهذا المعرّف" }, { status: 404 });
  if (patch.provider !== undefined) await rememberApiName(key.provider, key.protocol);
  return Response.json({ key: toSafeKey(key), auto_provisioned: autoProvisioned });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await ctx.params;
  const ok = await deleteKey(id);
  if (!ok) return Response.json({ error: "لا يوجد مفتاح بهذا المعرّف" }, { status: 404 });
  return Response.json({ ok: true });
}
