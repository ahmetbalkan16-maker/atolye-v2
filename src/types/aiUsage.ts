import type { ProductionStepKey } from "./project";
import type { ProviderName } from "@/lib/ai/router/AIRouter";

export type AIUsageStatus =
  | "success"
  | "fallback"
  | "failed";

export type AIUsageProvider = ProviderName;

export type AIUsageStage = ProductionStepKey | "unknown";

export interface AIRequestContext {
  projectSlug?: string;
  stage?: AIUsageStage;
  operation: string;
  provider?: AIUsageProvider;
  model?: string;
}

export interface AIUsageRecord {
  id: string;
  projectSlug: string;
  stage: AIUsageStage;
  operation: string;
  provider: AIUsageProvider;
  model?: string;
  status: AIUsageStatus;
  fallbackUsed: boolean;
  durationMs: number;
  promptLength: number;
  responseLength?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  error?: string;
  createdAt: string;
}

export interface AIUsageLog {
  projectSlug: string;
  records: AIUsageRecord[];
  createdAt: string;
  updatedAt: string;
}
