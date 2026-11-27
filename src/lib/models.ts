// سجل الموديلات — ديناميكي من جدول model_mappings (قسم 4 من المواصفة)
// مع الاحتفاظ بتعريفات افتراضية كاحتياط عند تعذر قراءة قاعدة البيانات
import { getEnabledMappingsForModel, listModelMappings, listProviders } from "./turso";

export type TaskProvider = string;
export type MediaType = "image" | "video" | "merge";

export interface ModelDef {
  canonical: string; // الاسم كما يراه عميل MCP
  aliases: string[]; // صيغ بديلة نقبلها ونوحّدها (شرطات/نقاط)
  type: MediaType;
  providers: string[]; // مزودو الخدمة بترتيب الأولوية — من جدول model_mappings
  providerModel: Record<string, string>; // اسم الموديل كما يُرسل لكل مزود
  /** مزودون عليه خرائط معطّلة صراحةً — يُستبعدون حتى من التمرير المباشر */
  blocked?: Record<string, boolean>;
}

// أسماء الموديلات الافتراضية (احتياط فقط — الحقيقة في قاعدة البيانات) قابلة للتجاوز بمتغيرات البيئة
const KIE_IMAGE_MODEL = process.env.KIE_IMAGE_MODEL || "gpt-image-2-6/flare-text-to-image";
const COMETAPI_IMAGE_MODEL = process.env.COMETAPI_IMAGE_MODEL || "gpt-image-2.6-flare-text-to-image";
const NPEXAPI_IMAGE_MODEL = process.env.NPEXAPI_IMAGE_MODEL || "gpt-image-2-6/flare-text-to-image";
const KIE_VIDEO_MODEL = process.env.KIE_VIDEO_MODEL || "grok-imagine-video-1-5-preview";
const COMETAPI_VIDEO_MODEL = process.env.COMETAPI_VIDEO_MODEL || "grok-imagine-video-1-5-preview";
const NPEXAPI_VIDEO_MODEL = process.env.NPEXAPI_VIDEO_MODEL || "grok-imagine-video-1-5-preview";

export const IMAGE_MODEL: ModelDef = {
  canonical: "gpt-image-2-6/flare-text-to-image",
  aliases: ["gpt-image-2.6/flare-text-to-image", "gpt-image-2.6-flare-text-to-image"],
  type: "image",
  providers: ["kie", "cometapi", "npexapi"],
  providerModel: { kie: KIE_IMAGE_MODEL, cometapi: COMETAPI_IMAGE_MODEL, npexapi: NPEXAPI_IMAGE_MODEL },
};

export const VIDEO_MODEL: ModelDef = {
  canonical: "grok-imagine-video-1-5-preview",
  aliases: ["grok-imagine-video-1.5-preview"],
  type: "video",
  providers: ["kie", "cometapi", "npexapi"],
  providerModel: { kie: KIE_VIDEO_MODEL, cometapi: COMETAPI_VIDEO_MODEL, npexapi: NPEXAPI_VIDEO_MODEL },
};

export const MERGE_MODEL: ModelDef = {
  canonical: "video-merger",
  aliases: [],
  type: "merge",
  providers: [],
  providerModel: {},
};

export const ALL_MODELS: ModelDef[] = [IMAGE_MODEL, VIDEO_MODEL];

/** بناء تعريف موديل من صفوف خرائطه المفعّلة في قاعدة البيانات مرتبة بالأولوية */
function modelFromMappings(canonical: string, type: MediaType, rows: Awaited<ReturnType<typeof listModelMappings>>): ModelDef {
  const providers: string[] = [];
  const providerModel: Record<string, string> = {};
  for (const r of rows) {
    if (!providers.includes(r.provider_id)) providers.push(r.provider_id);
    providerModel[r.provider_id] = r.provider_model_name;
  }
  return { canonical, aliases: [], type, providers, providerModel };
}

/** المزودون الذين لديهم خرائط معطّلة صراحةً للاسم الموحد — يستثنون من التمرير المباشر */
async function blockedProvidersFor(canonicals: string[]): Promise<Record<string, boolean>> {
  const blocked: Record<string, boolean> = {};
  try {
    const rows = await listModelMappings();
    for (const r of rows) {
      if (r.enabled) continue;
      if (canonicals.includes(r.canonical)) blocked[r.provider_id] = true;
    }
  } catch {
    // تعذر القراءة — لا حجب
  }
  return blocked;
}

/**
 * حلّ الموديل ديناميكيًا من جدول model_mappings (قابل للتعديل من الواجهة):
 * يقبل الاسم canonical كما هو أو صيغته البديلة (نقاط ↔ شرطات).
 * لا توجد خرائط مفعّلة → null (خطأ معطيات فوري للعميل).
 */
export async function resolveModelDynamic(name: string): Promise<ModelDef | null> {
  const clean = (name || "").trim();
  if (!clean) return null;
  const candidates = [clean, clean.replace(/\./g, "-"), clean.replace(/-/g, ".")];
  for (const c of candidates) {
    // حدّد النوع من أول خريطة موجودة بالاسم
    const anyRows = await listModelMappings({ canonical: c });
    if (!anyRows.length) continue;
    const type = (anyRows[0].type === "video" ? "video" : "image") as MediaType;
    const rows = await getEnabledMappingsForModel(c, type);
    if (rows.length) {
      const model = modelFromMappings(c, type, rows);
      model.blocked = await blockedProvidersFor([c, clean]);
      return model;
    }
    return null; // الاسم موجود لكن كل خرائطه معطلة أو مزودوها معطلون
  }
  return null;
}

/**
 * تمرير مباشر (Pass-through): اسم موديل غير مسجل في الخرائط — يُرسل كما هو لكل مزود مفعّل.
 * هذا يجعل إضافة مزود + مفتاح + اسم موديل تعمل فورًا دون تعبئة خرائط يدوية.
 */
export async function buildPassthroughModel(name: string, type: "image" | "video"): Promise<ModelDef> {
  const canonical = (name || "").trim();
  let enabledProviderIds: string[] = [];
  try {
    enabledProviderIds = (await listProviders()).filter((p) => p.enabled).map((p) => p.id);
  } catch {
    enabledProviderIds = [];
  }
  const blocked: Record<string, boolean> = {};
  try {
    const rows = await listModelMappings({ canonical });
    for (const r of rows) if (!r.enabled) blocked[r.provider_id] = true;
  } catch {
    // لا حجب
  }
  return { canonical, aliases: [], type, providers: enabledProviderIds, providerModel: {}, blocked };
}

/** كل الموديلات المفعّلة من قاعدة البيانات مجمّعة حسب الاسم الموحد — لقوائم الأدوات والجهوزية */
export async function listDynamicModels(): Promise<ModelDef[]> {
  const rows = await listModelMappings();
  const byKey = new Map<string, { canonical: string; type: MediaType; rows: typeof rows }>();
  for (const r of rows) {
    if (!r.enabled) continue;
    const key = `${r.canonical}::${r.type}`;
    const entry = byKey.get(key) ?? { canonical: r.canonical, type: (r.type === "video" ? "video" : "image") as MediaType, rows: [] };
    entry.rows.push(r);
    byKey.set(key, entry);
  }
  const models: ModelDef[] = [];
  for (const entry of byKey.values()) {
    // المزودون المفعّلون فقط في الترتيب
    const active = entry.rows.filter((r) => r.enabled);
    if (!active.length) continue;
    models.push(modelFromMappings(entry.canonical, entry.type, active));
  }
  return models.sort((a, b) => a.canonical.localeCompare(b.canonical));
}

/** توحيد اسم الموديل عبر aliases — احتياط ثابت عند تعذر قاعدة البيانات */
export function normalizeModel(name: string): ModelDef | null {
  if (!name) return null;
  const clean = name.trim();
  for (const m of ALL_MODELS) {
    if (clean === m.canonical || m.aliases.includes(clean)) return m;
    // الصيغ البديلة بالنقاط تُوحَّد إلى الشرطات
    if (clean.replace(/\./g, "-") === m.canonical) return m;
  }
  return null;
}

/** الحل النهائي: قاعدة البيانات أولًا ثم الافتراضيات الثابتة */
export async function resolveModel(name: string): Promise<ModelDef | null> {
  try {
    const dynamic = await resolveModelDynamic(name);
    if (dynamic) return dynamic;
    const clean = (name || "").trim().replace(/\./g, "-");
    // لا تخترع موديلات غير موجودة في القاعدة عند توفّرها — فقط احتياط عند فراغ القاعدة
    const rows = await listModelMappings();
    if (rows.length) return null;
    return normalizeModel(clean);
  } catch {
    return normalizeModel((name || "").trim());
  }
}
