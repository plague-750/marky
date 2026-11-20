// واجهة محولات المزودين (قسم 5.2) — إعدادات الاتصال تأتي من جدول providers وليست Hardcoded
import type { ProviderRow } from "../turso";

export interface GenInput {
  prompt: string;
  image_url?: string;
  aspect_ratio?: string;
  resolution?: string;
  background?: string;
  output_format?: string;
  enable_audio?: boolean;
  duration?: number;
}

export interface ProviderCreateResult {
  providerTaskId: string;
}

export interface ProviderCheckResult {
  status: "processing" | "completed" | "failed";
  urls?: string[];
  error?: string;
  progress?: number;
}

/** إعدادات الاتصال الفعلية للمزود كما تُقرأ من جدول providers — قابلة للتعديل من الواجهة */
export type ProviderRuntime = ProviderRow;

/** بناء ترويسات التوثيق حسب نوع الـ auth المضبوط للمزود (bearer | header | query) */
export function buildAuth(provider: ProviderRuntime, apiKey: string): { headers: Record<string, string>; queryKey: string | null } {
  const headerName = (provider.auth_header || "Authorization").trim();
  switch ((provider.auth_type || "bearer").toLowerCase()) {
    case "header":
      return { headers: { [headerName]: apiKey }, queryKey: null };
    case "query":
      return { headers: {}, queryKey: headerName || "api_key" };
    case "bearer":
    default:
      return { headers: { [headerName]: `Bearer ${apiKey}` }, queryKey: null };
  }
}

export interface ProviderAdapter {
  /** مهمة غير متزامنة (فيديو وبعض الصور): تعيد معرّف المهمة لدى المزود */
  createTask(apiKey: string, providerModel: string, input: GenInput, provider: ProviderRuntime): Promise<ProviderCreateResult>;
  /** صور متزامنة إن كان المزود يدعمها (CometAPI تعيد النتيجة فورًا) */
  createImageSync?(apiKey: string, providerModel: string, input: GenInput, provider: ProviderRuntime): Promise<{ urls: string[] }>;
  /** استعلام حالة مهمة جارية */
  checkTask(apiKey: string, providerTaskId: string, provider: ProviderRuntime): Promise<ProviderCheckResult>;
}
