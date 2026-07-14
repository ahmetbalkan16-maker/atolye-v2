import type { ImageGenerationResult } from "@/types/asset";
import { ImageStorage } from "../storage/ImageStorage";
import {
  getOpenAIImageProviderConfig,
  imageProviderConfig,
} from "./ImageProviderConfig";
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
  readonly name = "openai";
  private readonly fetcher: typeof fetch;

  constructor(options: { fetcher?: typeof fetch } = {}) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async generateImage(
    input: ImageGenerationInput,
  ): Promise<ImageGenerationResult> {
    const createdAt = new Date().toISOString();
    const apiKey = process.env.OPENAI_API_KEY;
    let config: ReturnType<typeof getOpenAIImageProviderConfig>;

    try {
      config = getOpenAIImageProviderConfig();
    } catch {
      return createErrorResult("Image generation failed.", createdAt, input.sceneId);
    }
    if (!apiKey?.trim() || !input.projectSlug) {
      return createErrorResult(
        "Image generation failed.",
        createdAt,
        input.sceneId,
      );
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
      const response = await this.fetcher(
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
          signal: controller.signal,
        },
      );
      const payload = await readBoundedJson(
        response,
        config.maximumResponseBytes,
        controller,
      );

      if (!response.ok) {
        return createErrorResult(
          "Image generation failed.",
          createdAt,
          input.sceneId,
        );
      }

      const image = payload.data?.[0];

      if (!image?.b64_json) {
        return createErrorResult(
          "Image generation failed.",
          createdAt,
          input.sceneId,
        );
      }

      const data = decodeStrictBase64(image.b64_json);
        const savedImage = ImageStorage.saveImage({
          projectSlug: input.projectSlug,
          data,
          mimeType: config.mimeType,
        });
        const inspection = ImageStorage.inspectStoredImage(
          input.projectSlug,
          savedImage.filePath,
          config.mimeType,
        );
        if (
          inspection.byteLength !== data.byteLength ||
          savedImage.url !== ImageStorage.getImageUrl(input.projectSlug, savedImage.fileName) ||
          savedImage.filePath !== ImageStorage.getImagePath(input.projectSlug, savedImage.fileName)
        ) throw new Error("Image generation failed.");

        return {
          success: true,
          sceneId: input.sceneId,
          provider: "openai",
          model: config.model,
          filePath: savedImage.filePath,
          url: savedImage.url,
          mimeType: config.mimeType,
          createdAt,
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return createErrorResult(
        "Image generation failed.",
        createdAt,
        input.sceneId,
      );
    }
  }
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
  controller: AbortController,
): Promise<OpenAIImageResponse> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
    controller.abort();
    throw new Error("Image generation failed.");
  }
  if (!response.body) throw new Error("Image generation failed.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        controller.abort();
        await reader.cancel();
        throw new Error("Image generation failed.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as OpenAIImageResponse;
}

function decodeStrictBase64(value: string) {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Image generation failed.");
  }
  const data = Buffer.from(value, "base64");
  if (!data.length || data.toString("base64") !== value) {
    throw new Error("Image generation failed.");
  }
  return data;
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
  sceneId: number,
): ImageGenerationResult {
  return {
    success: false,
    sceneId,
    provider: "openai",
    model: imageProviderConfig.openai.model,
    createdAt,
    error,
  };
}
