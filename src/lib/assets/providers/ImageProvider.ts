import type {
  ImageGenerationResult,
  ImageProviderName,
} from "@/types/asset";
import type { ProviderDispatchAdapterAuthority } from "@/lib/providers/ProviderDispatchAdapterAuthority";

export interface ImageGenerationInput {
  prompt: string;

  style?: string;

  size?: string;

  sceneId: number;

  projectSlug?: string;
}

export interface ImageProvider {
  readonly name: ImageProviderName;

  generateImage(
    input: ImageGenerationInput,
  ): Promise<ImageGenerationResult>;
}

export type ConfiguredImageProvider = ImageProvider &
  ProviderDispatchAdapterAuthority<"createImmutableImageDispatchAdapter">;
