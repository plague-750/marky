// واجهة محولات المزودين (قسم 5.2)
import type { ProviderId } from "../models";

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

export interface ProviderAdapter {
  /** مهمة غير متزامنة (فيديو وبعض الصور): تعيد معرّف المهمة لدى المزود */
  createTask(apiKey: string, providerModel: string, input: GenInput): Promise<ProviderCreateResult>;
  /** صور متزامنة إن كان المزود يدعمها (CometAPI تعيد النتيجة فورًا) */
  createImageSync?(apiKey: string, providerModel: string, input: GenInput): Promise<{ urls: string[] }>;
  /** استعلام حالة مهمة جارية */
  checkTask(apiKey: string, providerTaskId: string): Promise<ProviderCheckResult>;
}

export type { ProviderId };
