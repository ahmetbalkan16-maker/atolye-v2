import type { ImageGenerationResult } from "@/types/asset";
import { ImageStorage } from "../storage/ImageStorage";
import { imageProviderConfig } from "./ImageProviderConfig";
import type {
  ImageGenerationInput,
  ImageProvider,
} from "./ImageProvider";

type OpenAIImageResponse = {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
  error?: {
    message?: string;
  };
};

export class OpenAIImageProvider implements ImageProvider {
  async generateImage(
    input: ImageGenerationInput,
  ): Promise<ImageGenerationResult> {
    const createdAt = new Date().toISOString();
    const apiKey = process.env.OPENAI_API_KEY;
    const config = imageProviderConfig.openai;

    if (!apiKey) {
      return createErrorResult(
        "OpenAI image provider not configured",
        createdAt,
      );
    }

    try {
      const response = await fetch(
        "https://api.openai.com/v1/images/generations",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            prompt: createPrompt(input),
            size: input.size ?? config.size,
            n: 1,
          }),
        },
      );
      const payload = (await response.json()) as OpenAIImageResponse;

      if (!response.ok) {
        return createErrorResult(
          payload.error?.message ??
            `OpenAI image request failed: ${response.status}`,
          createdAt,
        );
      }

      const image = payload.data?.[0];

      if (!image?.b64_json && !image?.url) {
        return createErrorResult("OpenAI image response is empty", createdAt);
      }

      if (image.b64_json) {
        if (!input.projectSlug) {
          return createErrorResult(
            "Project slug is required to store OpenAI image output",
            createdAt,
          );
        }

        const savedImage = ImageStorage.saveImage({
          projectSlug: input.projectSlug,
          data: image.b64_json,
          mimeType: config.mimeType,
        });

        return {
          provider: "openai",
          model: config.model,
          filePath: savedImage.filePath,
          url: savedImage.url,
          mimeType: savedImage.mimeType,
          createdAt,
        };
      }

      return {
        provider: "openai",
        model: config.model,
        url: image.url,
        mimeType: config.mimeType,
        createdAt,
      };
    } catch (error) {
      return createErrorResult(
        error instanceof Error
          ? error.message
          : "OpenAI image request failed",
        createdAt,
      );
    }
  }
}

function createPrompt(input: ImageGenerationInput) {
  if (!input.style) {
    return input.prompt;
  }

  return `${input.prompt}\n\nStyle: ${input.style}`;
}

function createErrorResult(
  error: string,
  createdAt: string,
): ImageGenerationResult {
  return {
    provider: "openai",
    model: imageProviderConfig.openai.model,
    mimeType: imageProviderConfig.openai.mimeType,
    createdAt,
    error,
  };
}
