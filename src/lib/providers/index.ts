// سجل المحولات — إرجاع المحول المناسب لكل مزود
import type { ProviderId } from "../models";
import { kieAdapter } from "./kie";
import { cometapiAdapter } from "./cometapi";
import type { ProviderAdapter } from "./types";

export function getAdapter(provider: string): ProviderAdapter {
  switch (provider) {
    case "kie":
      return kieAdapter;
    case "cometapi":
      return cometapiAdapter;
    default:
      throw new Error(`مزود غير معروف: ${provider}`);
  }
}

export type { ProviderId };
