import type { AssemblyPlanData } from "@/types/assembly";
import type { AudioData } from "@/types/audio";
import type {
  ThumbnailData,
  ThumbnailGenerationMode,
  ThumbnailMimeType,
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

export interface ThumbnailAssetGenerationInput {
  projectId: string;
  projectSlug: string;
  title: string;
  prompt: string;
  thumbnail: ThumbnailData;
  assembly: AssemblyPlanData;
}

type ThumbnailAssetResultBase = {
  assetId: string;
  provider: ThumbnailProviderName;
  model?: string;
  createdAt: string;
};

type ThumbnailAssetSuccess = ThumbnailAssetResultBase & {
  success: true;
  status: "generated";
  generationMode: ThumbnailGenerationMode;
  fileName: string;
  filePath: string;
  url: string;
  mimeType: ThumbnailMimeType;
  width: number;
  height: number;
  byteLength: number;
  error?: never;
};

type ThumbnailAssetFailure = ThumbnailAssetResultBase & {
  success: false;
  status: "failed";
  error: string;
  generationMode?: never;
  fileName?: never;
  filePath?: never;
  url?: never;
  mimeType?: never;
  width?: never;
  height?: never;
  byteLength?: never;
};

export type ThumbnailAssetGenerationResult =
  | ThumbnailAssetSuccess
  | ThumbnailAssetFailure;

export interface ThumbnailProvider {
  readonly name: ThumbnailProviderName;

  generateThumbnailPlan(
    input: ThumbnailGenerationInput,
  ): Promise<ThumbnailGenerationResult>;

  generateThumbnailAsset(
    input: ThumbnailAssetGenerationInput,
  ): Promise<ThumbnailAssetGenerationResult>;
}
