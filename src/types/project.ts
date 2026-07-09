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
  usage?: ProjectPackageUsage;
}

export interface ProjectPackageUsage {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
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
