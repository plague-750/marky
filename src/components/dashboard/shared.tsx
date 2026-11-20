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

/** استنتاج البروتوكول من الاسم الحر — comet → CometAPI وkie → kie.ai وإلا null */
export function detectProtocolFromName(name: string): ProviderId | null {
  const n = (name || "").toLowerCase();
  if (n.includes("comet")) return "cometapi";
  if (n.includes("kie")) return "kie";
  return null;
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
