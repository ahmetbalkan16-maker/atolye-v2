export type ProjectStatus =
  | "draft"
  | "research"
  | "script"
  | "scenes"
  | "visuals"
  | "animation"
  | "video"
  | "audio"
  | "assembly"
  | "thumbnail"
  | "seo"
  | "voice"
  | "youtube"
  | "export"
  | "completed";

export interface Project {
  id: string;
  slug: string;
  title: string;
  description?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export type ProductionStepKey =
  | "research"
  | "script"
  | "scenes"
  | "visuals"
  | "animation"
  | "video"
  | "audio"
  | "assembly"
  | "thumbnail"
  | "seo"
  | "youtube"
  | "export";

export type PackageStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "missing";

export interface ProjectPackageManifest {
  key: ProductionStepKey;
  status: PackageStatus;
  fileName: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  errorEvidence?: AIResponseSchemaEvidence;
  attempts?: ProjectPackageAttemptMetadata;
  usage?: ProjectPackageUsage;
}

export type ProjectPackageRunType = "initial" | "resume" | "retry";

export interface ProjectPackageAttemptMetadata {
  total: number;
  retry: number;
  lastAttemptAt?: string;
  lastRunType?: ProjectPackageRunType;
}

export interface ProjectPackageUsage {
  provider?: string;
  model?: string;
  operation?: string;
  status?: string;
  fallbackUsed?: boolean;
  requestCount?: number;
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  updatedAt?: string;
}

export interface ProjectManifest {
  project: Project;
  projectId: string;
  slug: string;
  version: 1;
  packages: Record<ProductionStepKey, ProjectPackageManifest>;
  createdAt: string;
  updatedAt: string;
}
import type { AIResponseSchemaEvidence } from "./aiResponse";
