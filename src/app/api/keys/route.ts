// GET/POST /api/keys — إدارة المفاتيح مع إخفاء إلزامي (قسم 4.4)
// «طريقة الاتصال» نص حر يكتبه المستخدم (اسم/رابط/نوع موقع الـ API) ويُحفظ كما كُتب في api_names
// ويطابَق بمزود من جدول providers (بلا Hardcoding) — هذا المطابقة هي ما يحدد كيفية الاتصال الفعلية.
import { NextRequest } from "next/server";
import {
  ensureSchema,
  listKeys,
  insertKey,
  findDuplicateKey,
  rememberApiName,
  listApiNames,
  listProviders,
  matchProviderIdFromText,
  resolveProviderIdFromText,
  autoProvisionProviderFromText,
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
  let body: { provider?: string; protocol?: string; api_key?: string; label?: string; capability?: string; auto_provision?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "جسم الطلب ليس JSON صالحًا" }, { status: 400 });
  }

  const provider = String(body.provider ?? "").trim();
  const apiKey = String(body.api_key ?? "").trim();
  const label = String(body.label ?? "").trim();
  const capability = String(body.capability ?? "both").trim() || "both";
  const protocolHint = String(body.protocol ?? "").trim();

  if (!provider) {
    return Response.json(
      { error: "طريقة الاتصال مطلوبة — اكتب اسم أو رابط موقع الـ API وسيُحفظ تلقائيًا" },
      { status: 400 },
    );
  }
  if (provider.length > 60) {
    return Response.json({ error: "نص طريقة الاتصال طويل جدًا (الحد 60 حرفًا)" }, { status: 400 });
  }

  // مطابقة النص الحر بمزود من جدول providers — بلا Hardcoding:
  // معرّف صريح ← نص صريح ← إنشاء مزود تلقائي من النص (auto_provision) ← أول مزود مفعّل (توافق قديم)
  const autoProvision = Boolean(body.auto_provision);
  const providers = await listProviders();
  let protocol: string;
  let autoProvisioned = false;
  if (protocolHint && providers.some((p) => p.id === protocolHint)) {
    protocol = protocolHint;
  } else {
    const matched = matchProviderIdFromText(protocolHint || provider, providers);
    if (matched) {
      protocol = matched;
    } else if (autoProvision) {
      // أي موقع جديد يكتبه المستخدم يُنشأ له مزود فورًا مع ربطه بكل الموديلات — بلا أي خطوة يدوية
      try {
        const ap = await autoProvisionProviderFromText(provider);
        protocol = ap.id;
        autoProvisioned = ap.created;
      } catch (e) {
        return Response.json(
          { error: e instanceof Error ? e.message : `لم نتمكن من مطابقة «${provider}» بأي مزود — أضف مزودًا من «إدارة المزودين»` },
          { status: 400 },
        );
      }
    } else {
      const resolved = resolveProviderIdFromText(protocolHint || provider, providers);
      if (!resolved) {
        return Response.json(
          { error: `لم نتمكن من مطابقة «${provider}» بأي مزود — أضف مزودًا من «إدارة المزودين»` },
          { status: 400 },
        );
      }
      protocol = resolved;
    }
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
  // حفظ نص الموقع كما كُتب — يظهر في الاقتراحات لاحقًا حتى لو حُذفت كل مفاتيحه
  await rememberApiName(provider, protocol);
  return Response.json({ key: toSafeKey(key), resolved_protocol: protocol, auto_provisioned: autoProvisioned }, { status: 201 });
}
