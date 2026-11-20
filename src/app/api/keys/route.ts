// GET/POST /api/keys — إدارة المفاتيح مع إخفاء إلزامي (قسم 4.4)
// اسم الـ API نص حر يكتبه المستخدم ويُحفظ تلقائيًا في جدول api_names ويظهر في الاقتراحات لاحقًا.
// البروتوكول (kie/cometapi) هو ما يحدد كيفية الاتصال الفعلية بالـ API.
import { NextRequest } from "next/server";
import {
  ensureSchema,
  listKeys,
  insertKey,
  findDuplicateKey,
  rememberApiName,
  listApiNames,
  getProviderById,
  toSafeKey,
} from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAPABILITIES = new Set(["both", "image", "video"]);

export async function GET() {
  await ensureSchema();
  const [keys, names] = await Promise.all([listKeys(), listApiNames()]);
  return Response.json(
    { keys: keys.map(toSafeKey), names },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  let body: { provider?: string; protocol?: string; api_key?: string; label?: string; capability?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "جسم الطلب ليس JSON صالحًا" }, { status: 400 });
  }

  const provider = String(body.provider ?? "").trim();
  const apiKey = String(body.api_key ?? "").trim();
  const label = String(body.label ?? "").trim();
  const capability = String(body.capability ?? "both").trim() || "both";
  // معرّف المزود (protocol) يُستنتج من الاسم إن لم يُرسل (comet → cometapi وإلا kie)
  const protocol = String(body.protocol ?? "").trim() || (/comet/i.test(provider) ? "cometapi" : "kie");

  if (!provider) {
    return Response.json({ error: "اسم الـ API مطلوب — اكتب أي اسم تحبه وسيُحفظ تلقائيًا" }, { status: 400 });
  }
  if (provider.length > 60) {
    return Response.json({ error: "اسم الـ API طويل جدًا (الحد 60 حرفًا)" }, { status: 400 });
  }
  // المزود يجب أن يكون موجودًا في جدول providers — أضف مزودك من إدارة المزودين (بلا Hardcoding)
  const providerRow = await getProviderById(protocol);
  if (!providerRow) {
    return Response.json(
      { error: `المزود «${protocol}» غير موجود — أضفه أولًا من «إدارة المزودين» أو اختر مزودًا قائمًا` },
      { status: 400 },
    );
  }
  if (!CAPABILITIES.has(capability)) {
    return Response.json({ error: "استخدام المفتاح يجب أن يكون: both (صور وفيديو) أو image (صور فقط) أو video (فيديو فقط)" }, { status: 400 });
  }
  if (!apiKey) {
    return Response.json({ error: "المفتاح مطلوب" }, { status: 400 });
  }

  // رفض التكرار لنفس اسم الـ API
  const dup = await findDuplicateKey(provider, apiKey);
  if (dup) {
    return Response.json({ error: "هذا المفتاح مضاف مسبقًا لنفس اسم الـ API — رفض التكرار" }, { status: 409 });
  }

  const key = await insertKey(provider, apiKey, label, protocol, capability);
  // حفظ الاسم — يظهر في الاقتراحات لاحقًا حتى لو حُذفت كل مفاتيحه
  await rememberApiName(provider, protocol);
  return Response.json({ key: toSafeKey(key) }, { status: 201 });
}
