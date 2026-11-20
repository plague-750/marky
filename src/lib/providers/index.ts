// سجل المحولات — إرجاع المحول المناسب حسب adapter_type المضبوط للمزود في قاعدة البيانات
// قابل للتوسع: أضف محولًا جديدًا هنا وسيعمل مع أي مزود يختاره من الواجهة
import type { ProviderRuntime } from "./types";
import { kieAdapter } from "./kie";
import { cometapiAdapter } from "./cometapi";
import { getProviderById } from "../turso";
import type { ProviderAdapter } from "./types";

const ADAPTERS: Record<string, ProviderAdapter> = {
  kie: kieAdapter,
  cometapi: cometapiAdapter,
};

/** المحول حسب نوعه المخزّن في جدول providers (adapter_type) — نوع غير معروف → خطأ واضح */
export function getAdapterByType(adapterType: string): ProviderAdapter {
  const adapter = ADAPTERS[(adapterType || "kie").toLowerCase()];
  if (!adapter) throw new Error(`نوع محول غير معروف: ${adapterType} — المتاح: ${Object.keys(ADAPTERS).join("، ")}`);
  return adapter;
}

/** جلب إعدادات المزود الحية من قاعدة البيانات + محوله — مزود مفقود/معطل → null */
export async function resolveProvider(providerId: string): Promise<{ provider: ProviderRuntime; adapter: ProviderAdapter } | null> {
  const provider = await getProviderById(providerId);
  if (!provider || !provider.enabled) return null;
  const adapter = ADAPTERS[(provider.adapter_type || "kie").toLowerCase()];
  if (!adapter) return null;
  return { provider, adapter };
}

export type { ProviderAdapter, ProviderRuntime } from "./types";
