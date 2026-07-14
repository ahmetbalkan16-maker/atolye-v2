export const productionReadinessSchemaVersion = "1" as const;

export type ProductionReadinessStatus =
  | "READY"
  | "NOT_CONFIGURED"
  | "INVALID"
  | "UNAVAILABLE"
  | "BLOCKED";

export type ProductionReadinessCheckId =
  | "environment"
  | "api-key"
  | "provider-selection"
  | "provider-endpoint"
  | "model-configuration"
  | "ffmpeg"
  | "ffprobe"
  | "projects-root"
  | "assets-root"
  | "images-storage"
  | "audio-storage"
  | "video-storage"
  | "thumbnail-storage"
  | "assembly-storage"
  | "filesystem-permission"
  | "storage-containment"
  | "runtime"
  | "durable-execution"
  | "health"
  | "image-provider"
  | "audio-provider"
  | "animation-provider"
  | "video-provider"
  | "assembly-provider"
  | "thumbnail-provider"
  | "publish-package-provider"
  | "publish-provider";

export const productionReadinessCheckIds: readonly ProductionReadinessCheckId[] = [
  "environment", "api-key", "provider-selection", "provider-endpoint",
  "model-configuration", "ffmpeg", "ffprobe", "projects-root", "assets-root",
  "images-storage", "audio-storage", "video-storage", "thumbnail-storage",
  "assembly-storage", "filesystem-permission", "storage-containment", "runtime",
  "durable-execution", "health", "image-provider", "audio-provider",
  "animation-provider", "video-provider", "assembly-provider", "thumbnail-provider",
  "publish-package-provider", "publish-provider",
];

export interface ProductionReadinessCheck {
  readonly id: ProductionReadinessCheckId;
  readonly status: ProductionReadinessStatus;
  readonly reasonCode: string;
  readonly critical: boolean;
}

export interface ProductionReadinessReport {
  readonly schemaVersion: typeof productionReadinessSchemaVersion;
  readonly generatedAt: string;
  readonly ready: boolean;
  readonly checks: readonly ProductionReadinessCheck[];
}
