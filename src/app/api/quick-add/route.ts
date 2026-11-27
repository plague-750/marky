// POST /api/quick-add — إضافة سريعة واحدة: مزود + مفتاح + خريطة موديل في خطوة واحدة
// الفكرة: المستخدم يكتب «طريقة الاتصال» (اسم/رابط) + المفتاح + اسم الموديل، والباقي تلقائي بالكامل:
//  1) المزود: يطابق موجودًا أو يُنشأ تلقائيًا من النص (auto-provision)
//  2) المفتاح: يُضاف مباشرة (بتحقق التكرار)
//  3) الموديل: إن كُتب اسمه تُضاف خريطة باسمه نفسه — وبدونها يعمل التمرير المباشر أيضًا
import { NextRequest } from "next/server";
import {
  ensureSchema,
  listProviders,
  matchProviderIdFromText,
  autoProvisionProviderFromText,
  patchProvider,
  insertKey,
  findDuplicateKey,
  rememberApiName,
  listModelMappings,
  insertModelMapping,
  toSafeKey,
} from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAPABILITIES = new Set(["both", "image", "video"]);

export async function POST(req: NextRequest) {
  await ensureSchema();
  let body: {
    provider?: string;
    api_key?: string;
    capability?: string;
    label?: string;
    model?: string;
    model_type?: string;
    base_url?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "جسم الطلب ليس JSON صالحًا" }, { status: 400 });
  }

  const providerText = String(body.provider ?? "").trim();
  const apiKey = String(body.api_key ?? "").trim();
  const label = String(body.label ?? "").trim();
  const capability = (String(body.capability ?? "both").trim() || "both").toLowerCase();
  const modelName = String(body.model ?? "").trim();
  const modelType = (String(body.model_type ?? "image").trim() || "image").toLowerCase();
  const baseUrlHint = String(body.base_url ?? "").trim();

  if (!providerText) return Response.json({ error: "طريقة الاتصال مطلوبة — اكتب اسم أو رابط الموقع" }, { status: 400 });
  if (providerText.length > 60) return Response.json({ error: "نص طريقة الاتصال طويل جدًا (الحد 60 حرفًا)" }, { status: 400 });
  if (!apiKey) return Response.json({ error: "المفتاح مطلوب" }, { status: 400 });
  if (!CAPABILITIES.has(capability)) {
    return Response.json({ error: "الاستخدام يجب أن يكون: both أو image أو video" }, { status: 400 });
  }
  if (modelName && modelName.length > 160) {
    return Response.json({ error: "اسم الموديل طويل جدًا (الحد 160 حرفًا)" }, { status: 400 });
  }
  if (modelName && modelType !== "image" && modelType !== "video") {
    return Response.json({ error: "نوع الموديل يجب أن يكون image أو video" }, { status: 400 });
  }

  // 1) المزود: موجود ← استخدمه | غير موجود + auto ← أنشئه
  const providers = await listProviders();
  let providerId = matchProviderIdFromText(providerText, providers);
  let providerCreated = false;
  if (!providerId) {
    try {
      const ap = await autoProvisionProviderFromText(providerText);
      providerId = ap.id;
      providerCreated = ap.created;
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : `لم نتمكن من إنشاء مزود من «${providerText}»` },
        { status: 400 },
      );
    }
    // رابط أساسي صريح اختياري — يضبط المزود الجديد فورًا بدل التخمين
    if (providerCreated && baseUrlHint) {
      if (!/^https?:\/\/.+/i.test(baseUrlHint)) {
        return Response.json({ error: "الرابط الأساسي يجب أن يبدأ بـ http أو https" }, { status: 400 });
      }
      await patchProvider(providerId, { base_url: baseUrlHint });
    }
  }

  // 2) المفتاح: رفض التكرار ثم الإضافة
  const dup = await findDuplicateKey(providerText, apiKey);
  if (dup) {
    return Response.json(
      { error: "هذا المفتاح مضاف مسبقًا لنفس اسم الـ API — رفض التكرار", provider_id: providerId },
      { status: 409 },
    );
  }
  const key = await insertKey(providerText, apiKey, label, providerId, capability);
  await rememberApiName(providerText, providerId);

  // 3) الموديل: خريطة باسمه نفسه (التمرير المباشر يجعلها اختيارية وظيفيًا لكنها توثّق الاسم في الواجهة)
  let mappingId: number | null = null;
  if (modelName) {
    const rows = await listModelMappings();
    const maxPriority = rows.reduce((mx, m) => Math.max(mx, Number(m.priority ?? 0)), 0);
    const mapping = await insertModelMapping({
      canonical: modelName,
      type: modelType,
      provider_id: providerId,
      provider_model_name: modelName,
      priority: maxPriority + 1,
      enabled: 1,
    });
    mappingId = mapping.id;
  }

  return Response.json(
    {
      ok: true,
      provider_id: providerId,
      provider_created: providerCreated,
      key: toSafeKey(key),
      mapping_id: mappingId,
      note: modelName
        ? "تمت الإضافة: المزود + المفتاح + خريطة الموديل — تولّد الآن باسم الموديل هذا مباشرة"
        : "تمت الإضافة: المزود + المفتاح — أي اسم موديل يُمرَّر كما هو لهذا المزود",
    },
    { status: 201 },
  );
}
