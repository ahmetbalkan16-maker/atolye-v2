export type ProjectStatus =
  | "draft"
  | "research"
  | "script"
  | "scenes"
  | "visuals"
  | "animation"
  | "video"
  | "audio"
  | "thumbnail"
  | "seo"
  | "assembly"
  | "voice"
  | "youtube"
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
  | "thumbnail"
  | "seo"
  | "assembly";

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
  error?: string;
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
