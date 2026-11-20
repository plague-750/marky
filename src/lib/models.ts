// سجل الموديلات — الأسماء الموحدة والصيغ البديلة ومزودو كل موديل (قسم 5.1)
export type ProviderId = "kie" | "cometapi";
export type TaskProvider = ProviderId | "merger";
export type MediaType = "image" | "video" | "merge";

export interface ModelDef {
  canonical: string; // الاسم كما يراه عميل MCP
  aliases: string[]; // صيغ بديلة نقبلها ونوحّدها (شرطات/نقاط)
  type: MediaType;
  providers: ProviderId[]; // من يستطيع خدمته — تُجرَّب مفاتيحهم كلها بالترتيب
  providerModel: Record<ProviderId, string>; // اسم الموديل كما يُرسل لكل مزود
}

// أسماء الموديلات لدى المزودين قابلة للتجاوز بمتغيرات البيئة
const KIE_IMAGE_MODEL = process.env.KIE_IMAGE_MODEL || "gpt-image-2-6/flare-text-to-image";
const COMETAPI_IMAGE_MODEL = process.env.COMETAPI_IMAGE_MODEL || "gpt-image-2.6-flare-text-to-image";
const KIE_VIDEO_MODEL = process.env.KIE_VIDEO_MODEL || "grok-imagine-video-1-5-preview";
const COMETAPI_VIDEO_MODEL = process.env.COMETAPI_VIDEO_MODEL || "grok-imagine-video-1-5-preview";

export const IMAGE_MODEL: ModelDef = {
  canonical: "gpt-image-2-6/flare-text-to-image",
  aliases: ["gpt-image-2.6/flare-text-to-image", "gpt-image-2.6-flare-text-to-image"],
  type: "image",
  providers: ["kie", "cometapi"],
  providerModel: { kie: KIE_IMAGE_MODEL, cometapi: COMETAPI_IMAGE_MODEL },
};

export const VIDEO_MODEL: ModelDef = {
  canonical: "grok-imagine-video-1-5-preview",
  aliases: ["grok-imagine-video-1.5-preview"],
  type: "video",
  providers: ["kie", "cometapi"],
  providerModel: { kie: KIE_VIDEO_MODEL, cometapi: COMETAPI_VIDEO_MODEL },
};

export const MERGE_MODEL: ModelDef = {
  canonical: "video-merger",
  aliases: [],
  type: "merge",
  providers: [],
  providerModel: { kie: "", cometapi: "" },
};

export const ALL_MODELS: ModelDef[] = [IMAGE_MODEL, VIDEO_MODEL];

/** توحيد اسم الموديل عبر aliases — غير معروف → null (خطأ معطيات فوري) */
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
