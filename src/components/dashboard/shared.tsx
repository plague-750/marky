"use client";

import * as React from "react";

/**
 * أنواع مشتركة + أدوات مساعدة للوحة التحكم العربية.
 * الأنواع مطابقة لعقود واجهات الـAPI الخلفية (API contracts).
 */

export type ProviderId = "kie" | "cometapi";

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
  merger: { base: string; healthy: boolean };
  authRequired: boolean;
}

export interface ApiKey {
  id: string;
  provider: string; // اسم الـ API الحر الذي كتبه المستخدم
  protocol: string; // بروتوكول الاتصال: kie | cometapi
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

/* ------------------------- تسميات البروتوكولات ------------------------- */

export const PROVIDER_LABELS: Record<string, string> = {
  kie: "kie.ai",
  cometapi: "CometAPI",
};

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
