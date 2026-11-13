// GET/POST /api/keys — إدارة المفاتيح مع إخفاء إلزامي (قسم 4.4)
import { NextRequest } from "next/server";
import { ensureSchema, listKeys, insertKey, findDuplicateKey, toSafeKey } from "@/lib/turso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS = new Set(["kie", "cometapi"]);

export async function GET() {
  await ensureSchema();
  const keys = await listKeys();
  return Response.json({ keys: keys.map(toSafeKey) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  await ensureSchema();
  let body: { provider?: string; api_key?: string; label?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "جسم الطلب ليس JSON صالحًا" }, { status: 400 });
  }

  const provider = String(body.provider ?? "").trim();
  const apiKey = String(body.api_key ?? "").trim();
  const label = String(body.label ?? "").trim();

  if (!PROVIDERS.has(provider)) {
    return Response.json({ error: "المزود يجب أن يكون kie أو cometapi" }, { status: 400 });
  }
  if (!apiKey) {
    return Response.json({ error: "المفتاح مطلوب" }, { status: 400 });
  }

  // رفض التكرار لنفس المزود
  const dup = await findDuplicateKey(provider, apiKey);
  if (dup) {
    return Response.json({ error: "هذا المفتاح مضاف مسبقًا لنفس المزود — رفض التكرار" }, { status: 409 });
  }

  const key = await insertKey(provider, apiKey, label);
  return Response.json({ key: toSafeKey(key) }, { status: 201 });
}
