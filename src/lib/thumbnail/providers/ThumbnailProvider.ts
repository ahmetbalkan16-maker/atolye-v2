import type { AssemblyPlanData } from "@/types/assembly";
import type { AudioData } from "@/types/audio";
import type {
  ThumbnailData,
  ThumbnailProviderName,
  ThumbnailStatus,
} from "@/types/thumbnail";
import type { VideoData } from "@/types/video";

export interface ThumbnailGenerationInput {
  projectId?: string;
  projectSlug?: string;
  title?: string;
  assembly?: AssemblyPlanData | null;
  video?: VideoData | null;
  audio?: AudioData | null;
}

export interface ThumbnailGenerationResult {
  provider: ThumbnailProviderName | string;
  model?: string;
  status: ThumbnailStatus;
  thumbnail: ThumbnailData;
  error?: string;
}

export interface ThumbnailProvider {
  generateThumbnailPlan(
    input: ThumbnailGenerationInput,
  ): Promise<ThumbnailGenerationResult>;
}
