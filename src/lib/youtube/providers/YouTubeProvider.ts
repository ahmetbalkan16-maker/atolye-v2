import type { AssemblyPlanData } from "@/types/assembly";
import type { AudioData } from "@/types/audio";
import type { ThumbnailData } from "@/types/thumbnail";
import type { VideoData } from "@/types/video";
import type {
  YouTubeProviderName,
  YouTubePublishingPackage,
  YouTubeStatus,
} from "@/types/youtube";

export interface YouTubeGenerationInput {
  projectId?: string;
  projectSlug?: string;
  title?: string;
  video?: VideoData | null;
  audio?: AudioData | null;
  assembly?: AssemblyPlanData | null;
  thumbnail?: ThumbnailData | null;
}

export interface YouTubeGenerationResult {
  provider: YouTubeProviderName | string;
  model?: string;
  status: YouTubeStatus;
  package: YouTubePublishingPackage;
  error?: string;
}

export interface YouTubeProvider {
  generatePublishingPackage(
    input: YouTubeGenerationInput,
  ): Promise<YouTubeGenerationResult>;
}
