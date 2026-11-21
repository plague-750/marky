"use client";

import * as React from "react";

/**
 * أنواع مشتركة + أدوات مساعدة للوحة التحكم العربية.
 * الأنواع مطابقة لعقود واجهات الـAPI الخلفية (API contracts).
 */

export type ProviderId = "kie" | "cometapi";
/** استخدام المفتاح: صور وفيديو / صور فقط / فيديو فقط */
export type KeyCapability = "both" | "image" | "video";

/* ------------------------- أنواع الاستجابات ------------------------- */

export interface HealthModel {
  canonical: string;
  type: string;
  providers: string[];
}

export interface HealthResponse {
  ok: boolean;
  database: "turso-connected" | "turso-disconnected";
  mcpEndpoint: string;
  models: HealthModel[];
  providers?: Array<{ id: string; name: string; base_url: string; adapter_type: string; enabled: number }>;
  merger: { base: string; healthy: boolean };
  authRequired: boolean;
}

export interface ApiKey {
  id: string;
  provider: string; // اسم الـ API الحر الذي كتبه المستخدم — المجموعة الفعلية للتجربة التسلسلية
  protocol: string; // بروتوكول الاتصال: kie | cometapi
  capability: KeyCapability; // استخدام المفتاح: صور وفيديو / صور فقط / فيديو فقط
  label: string | null;
  status: "active" | "exhausted" | "disabled";
  usage_count: number;
  success_count: number;
  fail_count: number;
  last_used_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  masked_key: string;
}

export interface ApiName {
  name: string;
  protocol: string;
  updated_at: string;
}

export interface KeysResponse {
  keys: ApiKey[];
  names: ApiName[];
}

/* ------------------- أنواع المزودين وخرائط الموديلات (قسم 6) ------------------- */

/** مزود من جدول providers — إعدادات الاتصال الحقيقية قابلة للتعديل */
export interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  auth_type: string; // bearer | header | query
  auth_header: string;
  adapter_type: string; // kie | cometapi
  image_endpoint: string;
  video_endpoint: string;
  check_endpoint: string;
  enabled: number; // 1 | 0
  created_at: string;
}

export interface ProvidersResponse {
  providers: ProviderRow[];
}

/** خريطة موديل من جدول model_mappings — canonical ← اسم الموديل لدى مزود */
export interface ModelMapping {
  id: number;
  canonical: string;
  type: "image" | "video";
  provider_id: string;
  provider_model_name: string;
  default_params_json: string | null;
  priority: number;
  enabled: number; // 1 | 0
  created_at: string;
}

export interface ModelsResponse {
  mappings: ModelMapping[];
}

export type TaskType = "image" | "video" | "merge";
export type TaskStatus = "pending" | "processing" | "completed" | "failed";
export interface TaskAttempt {
  provider: string;
  keyLabel: string | null;
  ok: boolean;
  errorClass: string | null;
  error: string | null;
  at: string;
}

export interface Task {
  id: string;
  provider: string;
  model: string;
  type: TaskType;
  prompt: string | null;
  status: TaskStatus;
  progress: number;
  result_urls: string[];
  error_message: string | null;
  attempts_count: number;
  attempts: TaskAttempt[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TasksResponse {
  stats: { total: number; completed: number; failed: number; processing: number };
  tasks: Task[];
}

/* ------------------------- تسميات البروتوكولات والاستخدام ------------------------- */

export const PROVIDER_LABELS: Record<string, string> = {
  kie: "kie.ai",
  cometapi: "CometAPI",
};

/** خيارات «طريقة الاتصال» الاحتياطية عند تعذر تحميل قائمة المزودين من السيرفر */
export const DEFAULT_PROVIDER_ROWS: ProviderRow[] = [
  { id: "kie", name: "kie.ai", base_url: "https://api.kie.ai", auth_type: "bearer", auth_header: "Authorization", adapter_type: "kie", image_endpoint: "", video_endpoint: "", check_endpoint: "", enabled: 1, created_at: "" },
  { id: "cometapi", name: "CometAPI", base_url: "https://api.cometapi.com", auth_type: "bearer", auth_header: "Authorization", adapter_type: "cometapi", image_endpoint: "", video_endpoint: "", check_endpoint: "", enabled: 1, created_at: "" },
];

/** نتيجة مطابقة النص الحر ل«طريقة الاتصال» بمزود من قاعدة البيانات */
export interface SiteResolution {
  /** معرّف المزود النهائي الذي سيُحفظ كبروتوكول للمفتاح */
  protocol: string;
  /** اسم المزود للعرض */
  providerLabel: string;
  /** true = تطابق حقيقي (اسم/رابط/كلمة مفتاحية) — false = fallback لأول مزود مفعّل */
  matched: boolean;
}

/** يزيل https:// أو http:// وشرطة النهاية لتوحيد مطابقة الروابط */
function normalizeUrlish(s: string): string {
  return s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/**
 * مطابقة نص حر (اسم/رابط/نوع موقع الـ API كما كتبه المستخدم) بمزود — نفس منطق السيرفر، بلا Hardcoding:
 * تطابق تام (المعرّف/الاسم/الرابط) ← احتواء جزئي ← كلمات مفتاحية (comet/kie) ← أول مزود مفعّل (fallback).
 * تعيد null فقط إذا لم يوجد أي مزود إطلاقًا.
 */
export function resolveProtocolFromSite(value: string, providers: ProviderRow[] | null): SiteResolution | null {
  const list = providers && providers.length ? providers : DEFAULT_PROVIDER_ROWS;
  if (!list.length) return null;
  const fallbackRow = list.find((p) => p.enabled) ?? list[0];
  const fallback: SiteResolution = { protocol: fallbackRow.id, providerLabel: fallbackRow.name, matched: false };

  const v = (value || "").trim().toLowerCase();
  if (!v) return fallback;
  const vUrl = normalizeUrlish(v);

  // 1) تطابق تام مع المعرّف أو الاسم أو الرابط
  for (const p of list) {
    if (p.id.toLowerCase() === v || p.name.trim().toLowerCase() === v || normalizeUrlish(p.base_url) === vUrl) {
      return { protocol: p.id, providerLabel: p.name, matched: true };
    }
  }
  // 2) احتواء جزئي: النص يحوي اسم/معرّف/مضيف المزود أو العكس
  for (const p of list) {
    const id = p.id.toLowerCase();
    const name = p.name.trim().toLowerCase();
    const host = normalizeUrlish(p.base_url);
    const hostHit = !!host && (vUrl.includes(host) || (vUrl.length >= 5 && host.includes(vUrl)));
    const nameHit = name.length >= 3 && v.length >= 3 && (v.includes(name) || name.includes(v));
    const idHit = id.length >= 3 && v.length >= 3 && (v.includes(id) || id.includes(v));
    if (hostHit || nameHit || idHit) return { protocol: p.id, providerLabel: p.name, matched: true };
  }
  // 3) كلمات مفتاحية شائعة في النص
  if (vUrl.includes("comet") || v.includes("comet")) {
    const p = list.find((x) => x.id.toLowerCase().includes("comet") || x.name.toLowerCase().includes("comet"));
    if (p) return { protocol: p.id, providerLabel: p.name, matched: true };
  }
  if (vUrl.includes("kie") || v.includes("kie")) {
    const p = list.find((x) => x.id.toLowerCase().includes("kie") || x.name.toLowerCase().includes("kie"));
    if (p) return { protocol: p.id, providerLabel: p.name, matched: true };
  }
  // 4) fallback — أول مزود مفعّل
  return fallback;
}

export const CAPABILITY_LABELS: Record<KeyCapability, string> = {
  both: "صور وفيديو",
  image: "صور فقط",
  video: "فيديو فقط",
};

export function capabilityLabel(c: string | null | undefined): string {
  if (c === "image") return CAPABILITY_LABELS.image;
  if (c === "video") return CAPABILITY_LABELS.video;
  return CAPABILITY_LABELS.both;
}

/* --------------------- تجميع المفاتيح حسب اسم الـ API --------------------- */

export interface KeyGroup {
  name: string; // اسم الـ API كما كتبه المستخدم (أول صيغة ظهرت)
  protocol: string;
  keys: ApiKey[]; // بترتيب الإضافة — الترتيب التسلسلي داخل المجموعة
  /** ترتيب المجموعة = ترتيب أول إضافة لمفتاح تحت هذا الاسم */
  firstAddedAt: number;
}

/**
 * تجميع المفاتيح حسب اسم الـ API الحر الذي كتبه المستخدم — نفس منطق السيرفر:
 * المجموعات بترتيب أول إضافة، والمفاتيح داخل كل مجموعة بترتيب الإضافة.
 * المطابقة بالاسم غير حساسة لحالة الأحرف (تطابق منطق COLLATE NOCASE في السيرفر).
 */
export function groupKeysByName(keys: ApiKey[]): KeyGroup[] {
  const groups = new Map<string, KeyGroup>();
  const sorted = [...keys].sort((a, b) => {
    const ta = new Date(a.created_at).getTime() || 0;
    const tb = new Date(b.created_at).getTime() || 0;
    return ta - tb || a.id.localeCompare(b.id);
  });
  for (const k of sorted) {
    const nameKey = (k.provider || "بدون اسم").trim().toLowerCase();
    const label = (k.provider || "بدون اسم").trim();
    let g = groups.get(nameKey);
    if (!g) {
      g = {
        name: label,
        protocol: k.protocol,
        keys: [],
        firstAddedAt: new Date(k.created_at).getTime() || 0,
      };
      groups.set(nameKey, g);
    }
    g.keys.push(k);
  }
  return [...groups.values()].sort((a, b) => a.firstAddedAt - b.firstAddedAt);
}

/* --------------------- الوقت النسبي بالعربية --------------------- */

const RELATIVE_FMT = new Intl.RelativeTimeFormat("ar-u-nu-latn", { numeric: "auto" });

/** يحوّل طابعًا زمنيًا ISO إلى نص نسبي عربي مثل «قبل 3 دقائق». */
export function formatRelativeAr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return "الآن";
  if (abs < 3600) return RELATIVE_FMT.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return RELATIVE_FMT.format(Math.round(diffSec / 3600), "hour");
  return RELATIVE_FMT.format(Math.round(diffSec / 86400), "day");
}

/* ------------------------- نسخ إلى الحافظة ------------------------- */

/** نسخ نص إلى الحافظة مع بديل يعمل في السياقات غير الآمنة. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/* --------------------------- روابط مطلقة --------------------------- */

/** يحوّل مسارًا نسبيًا مثل /api/jobs/xxx/video إلى رابط مطلق آمن للفتح بتبويب جديد. */
export function toAbsoluteUrl(url: string): string {
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return url;
  }
}

/* --------------------- استقصاء /api/health كل 15 ثانية --------------------- */

/** حدث مشترك: يتقال عند أي تغيير في المزودين — تحديث فوري لقوائم «طريقة الاتصال» و«مزود الخريطة» */
export const PROVIDERS_CHANGED_EVENT = "media-generator:providers-changed";

export function notifyProvidersChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PROVIDERS_CHANGED_EVENT));
  }
}

export function useHealthPoller(
  intervalMs = 15000,
): { health: HealthResponse | null; loading: boolean; failed: boolean; refresh: () => void } {
  const [health, setHealth] = React.useState<HealthResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  const aliveRef = React.useRef(true);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as HealthResponse;
      if (!aliveRef.current) return;
      setHealth(data);
      setFailed(false);
    } catch {
      // فشل الاستقصاء لا يُسقط الصفحة — نبقي آخر حالة معروفة إن وجدت
      if (!aliveRef.current) return;
      setFailed(true);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    aliveRef.current = true;
    void refresh();
    const id = setInterval(() => void refresh(), intervalMs);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [refresh, intervalMs]);

  return { health, loading, failed, refresh };
}
