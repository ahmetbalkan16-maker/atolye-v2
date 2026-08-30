import type { ProductionStepKey } from "./project";
import type { ProviderName } from "@/lib/ai/router/AIRouter";
import type { AnimationFailurePhase, AnimationSchemaIssue } from "./animationError";

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
  finishReason?: "stop" | "length" | "content-filter" | "tool-calls" | "unknown";
  refused?: boolean;
  responseComplete?: boolean;
  truncated?: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /**
   * Deterministic USD cost estimate for this call, from `AiPricing` (Faz 5).
   * Present only when `pricingStatus === "known"` or `"free"`; a `"free"` call
   * (mock provider) is `0`. `undefined` + `pricingStatus === "unknown"` means the
   * model has no price row — the cost guard treats that as fail-closed, never 0.
   */
  estimatedCost?: number;
  pricingStatus?: "known" | "unknown" | "free";
  costUnitKind?: "tokens" | "characters" | "images";
  costUnitCount?: number;
  error?: string;
  errorCode?: string;
  sceneId?: number;
  phase?: AnimationFailurePhase;
  httpStatus?: number;
  retryCount?: number;
  issueCount?: number;
  schemaIssues?: readonly AnimationSchemaIssue[];
  createdAt: string;
}

export interface AIUsageLog {
  projectSlug: string;
  records: AIUsageRecord[];
  createdAt: string;
  updatedAt: string;
}
