import { ThumbnailStorage } from "../ThumbnailStorage";
import { thumbnailProviderConfig } from "../ThumbnailProviderConfig";
import { createMockThumbnailData } from "./MockThumbnailProvider";
import type {
  ThumbnailAssetGenerationInput,
  ThumbnailAssetGenerationResult,
  ThumbnailGenerationInput,
  ThumbnailGenerationResult,
  ThumbnailProvider,
} from "./ThumbnailProvider";

type OpenAIImageResponse = {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
};

export class OpenAIThumbnailProvider implements ThumbnailProvider {
  readonly name = "openai" as const;
  private readonly timeoutMs: number;
  private readonly maximumResponseBytes: number;

  constructor(options: { timeoutMs?: number; maximumResponseBytes?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? thumbnailProviderConfig.openai.timeoutMs;
    this.maximumResponseBytes =
      options.maximumResponseBytes ?? thumbnailProviderConfig.openai.maximumResponseBytes;
  }

  async generateThumbnailPlan(
    input: ThumbnailGenerationInput,
  ): Promise<ThumbnailGenerationResult> {
    const thumbnail = createMockThumbnailData(input);
    return {
      provider: "openai",
      model: thumbnailProviderConfig.openai.model,
      status: "planned",
      thumbnail: {
        ...thumbnail,
        provider: "openai",
        model: thumbnailProviderConfig.openai.model,
        generation: {
          provider: "openai",
          model: thumbnailProviderConfig.openai.model,
          status: "planned",
        },
      },
    };
  }

  async generateThumbnailAsset(
    input: ThumbnailAssetGenerationInput,
  ): Promise<ThumbnailAssetGenerationResult> {
    const assetId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) return failure(assetId, createdAt);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: thumbnailProviderConfig.openai.model,
          prompt: input.prompt,
          size: thumbnailProviderConfig.openai.size,
          n: 1,
        }),
        signal: controller.signal,
      });
      const payload = await readBoundedJson(
        response,
        this.maximumResponseBytes,
        controller,
      );
      const encoded = payload.data?.[0]?.b64_json;

      if (!response.ok || typeof encoded !== "string" || !encoded) {
        return failure(assetId, createdAt);
      }

      const data = decodeStrictBase64(encoded);
      const saved = ThumbnailStorage.saveThumbnail({
        projectSlug: input.projectSlug,
        assetId,
        data,
        mimeType: thumbnailProviderConfig.openai.mimeType,
      });

      return {
        success: true,
        assetId,
        provider: "openai",
        model: thumbnailProviderConfig.openai.model,
        status: "generated",
        generationMode: "production",
        createdAt,
        ...saved,
      };
    } catch {
      return failure(assetId, createdAt);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
  controller: AbortController,
): Promise<OpenAIImageResponse> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)
  ) {
    controller.abort();
    throw new Error("Invalid thumbnail provider response.");
  }
  if (!response.body) throw new Error("Invalid thumbnail provider response.");

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
        throw new Error("Invalid thumbnail provider response.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
  return JSON.parse(data.toString("utf8")) as OpenAIImageResponse;
}

function decodeStrictBase64(value: string) {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) throw new Error("Invalid thumbnail provider response.");
  const data = Buffer.from(value, "base64");
  if (data.length === 0 || data.toString("base64") !== value) {
    throw new Error("Invalid thumbnail provider response.");
  }
  return data;
}

function failure(assetId: string, createdAt: string): ThumbnailAssetGenerationResult {
  return {
    success: false,
    assetId,
    provider: "openai",
    model: thumbnailProviderConfig.openai.model,
    status: "failed",
    createdAt,
    error: "Thumbnail provider request failed.",
  };
}
