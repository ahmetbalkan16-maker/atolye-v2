import type { AssemblyPlanData } from "@/types/assembly";
import type { SEOData } from "@/types/seo";
import type { ThumbnailData } from "@/types/thumbnail";
import type {
  YouTubePackageDraft,
  YouTubeProviderName,
} from "@/types/youtube";

export const YOUTUBE_GENERATION_ERROR =
  "YouTube package generation failed." as const;

export interface YouTubeGenerationInput {
  projectId: string;
  projectSlug: string;
  title: string;
  videoDurationSeconds: number;
  assembly: AssemblyPlanData;
  thumbnail: ThumbnailData;
  seo: SEOData;
}

export type YouTubeGenerationResult =
  | {
      success: true;
      provider: YouTubeProviderName;
      model?: string;
      draft: YouTubePackageDraft;
      error?: never;
    }
  | {
      success: false;
      provider: YouTubeProviderName;
      model?: string;
      error: typeof YOUTUBE_GENERATION_ERROR;
      draft?: never;
    };

export interface YouTubeProvider {
  readonly name: YouTubeProviderName;
  readonly model?: string;
  generatePublishingPackage(
    input: YouTubeGenerationInput,
  ): Promise<YouTubeGenerationResult>;
}
