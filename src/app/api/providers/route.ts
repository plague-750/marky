// GET/POST /api/providers — إدارة المزودين (قسم 7 من المواصفة)
// المزودون يُقرأون ويُضافون من قاعدة البيانات — بلا Hardcoding
import { NextRequest } from "next/server";
import { ensureSchema, listProviders, insertProvider, getProviderById, PROVIDER_ID_RE, ADAPTER_TYPES, AUTH_TYPES } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSchema();
  const providers = await listProviders();
  return Response.json({ providers }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  let body: {
    id?: string;
    name?: string;
    base_url?: string;
    auth_type?: string;
    auth_header?: string;
    adapter_type?: string;
    image_endpoint?: string;
    video_endpoint?: string;
    check_endpoint?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "جسم الطلب ليس JSON صالحًا" }, { status: 400 });
  }

  const id = String(body.id ?? "").trim();
  const name = String(body.name ?? "").trim();
  const baseUrl = String(body.base_url ?? "").trim();
  const adapterType = String(body.adapter_type ?? "kie").trim() || "kie";
  const authType = String(body.auth_type ?? "bearer").trim() || "bearer";
  const authHeader = String(body.auth_header ?? "Authorization").trim() || "Authorization";
  const imageEndpoint = String(body.image_endpoint ?? "").trim();
  const videoEndpoint = String(body.video_endpoint ?? "").trim();
  const checkEndpoint = String(body.check_endpoint ?? "").trim();

  if (!PROVIDER_ID_RE.test(id)) {
    return Response.json(
      { error: "معرّف المزود مطلوب ويجب أن يكون بالإنجليزية/الأرقام فقط (حروف وأرقام وشرطات) حتى 40 حرفًا" },
      { status: 400 },
    );
  }
  if (!name) return Response.json({ error: "اسم المزود مطلوب" }, { status: 400 });
  if (name.length > 80) return Response.json({ error: "اسم المزود طويل جدًا (الحد 80 حرفًا)" }, { status: 400 });
  if (!/^https?:\/\/.+/i.test(baseUrl)) {
    return Response.json({ error: "الرابط الأساسي (Base URL) مطلوب ويجب أن يبدأ بـ http أو https" }, { status: 400 });
  }
  if (!ADAPTER_TYPES.has(adapterType)) {
    return Response.json({ error: `نوع المحول يجب أن يكون أحد: ${[...ADAPTER_TYPES].join(" أو ")}` }, { status: 400 });
  }
  if (!AUTH_TYPES.has(authType)) {
    return Response.json({ error: `نوع التوثيق يجب أن يكون أحد: ${[...AUTH_TYPES].join(" أو ")}` }, { status: 400 });
  }
  for (const [ep, label] of [
    [imageEndpoint, "نقطة الصور"],
    [videoEndpoint, "نقطة الفيديو"],
    [checkEndpoint, "نقطة الاستعلام"],
  ] as const) {
    if (ep && !ep.startsWith("/")) {
      return Response.json({ error: `${label} يجب أن تبدأ بـ / (مثال: /api/v1/jobs/createTask)` }, { status: 400 });
    }
  }

  const existing = await getProviderById(id);
  if (existing) {
    return Response.json({ error: `معرّف المزود «${id}» مستخدم مسبقًا — اختر معرّفًا آخر` }, { status: 409 });
  }

  const provider = await insertProvider({
    id,
    name,
    base_url: baseUrl,
    auth_type: authType,
    auth_header: authHeader,
    adapter_type: adapterType,
    image_endpoint: imageEndpoint,
    video_endpoint: videoEndpoint,
    check_endpoint: checkEndpoint,
    enabled: 1,
  });
  return Response.json({ provider }, { status: 201 });
}
