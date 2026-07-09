import type { AssemblyPlanData } from "@/types/assembly";
import type { AudioData } from "@/types/audio";
import type {
  ExportFormat,
  ExportPackageData,
  ExportProviderName,
  ExportStatus,
} from "@/types/export";
import type { Project } from "@/types/project";
import type { SEOData } from "@/types/seo";
import type { ThumbnailData } from "@/types/thumbnail";
import type { VideoData } from "@/types/video";
import type { YouTubePublishingPackage } from "@/types/youtube";

export interface ExportGenerationInput {
  projectId?: string;
  projectSlug?: string;
  title?: string;
  format?: ExportFormat;
  project?: Project | null;
  video?: VideoData | null;
  audio?: AudioData | null;
  assembly?: AssemblyPlanData | null;
  thumbnail?: ThumbnailData | null;
  youtube?: YouTubePublishingPackage | null;
  seo?: SEOData | null;
}

export interface ExportGenerationResult {
  provider: ExportProviderName | string;
  model?: string;
  status: ExportStatus;
  package: ExportPackageData;
  error?: string;
}

export interface ExportProvider {
  generateExportPackage(
    input: ExportGenerationInput,
  ): Promise<ExportGenerationResult>;
}
