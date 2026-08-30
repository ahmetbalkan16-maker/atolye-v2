import type {
  ImageGenerationErrorEvidence,
  ImageGenerationResult,
} from "@/types/asset";
import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import { ImageStorage } from "../storage/ImageStorage";
import {
  getOpenAIImageProviderConfig,
  imageProviderConfig,
} from "./ImageProviderConfig";
import type {
  ImageGenerationInput,
  ConfiguredImageProvider,
} from "./ImageProvider";

type OpenAIImageResponse = {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
    param?: string;
  };
};

/** HTTP statuses where a single controlled retry is safe. */
const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504]);

export class OpenAIImageProvider implements ConfiguredImageProvider {
  readonly name = "openai";
  private readonly fetcher: typeof fetch;
  private readonly delayFn: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** Wall-clock of the last dispatched request, for inter-request pacing. */
  private lastRequestAt: number | null = null;

  constructor(
    options: {
      fetcher?: typeof fetch;
      /** Injectable delay for deterministic pacing tests; defaults to setTimeout. */
      delayFn?: (ms: number) => Promise<void>;
      /** Injectable clock; defaults to Date.now. */
      now?: () => number;
    } = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.delayFn =
      options.delayFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
  }

  createImmutableImageDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name }, requiredMethods: ["generateImage"],
    });
  }

  private async paceRequest(minIntervalMs: number): Promise<void> {
    if (minIntervalMs > 0 && this.lastRequestAt !== null) {
      const wait = minIntervalMs - (this.now() - this.lastRequestAt);
      if (wait > 0) await this.delayFn(wait);
    }
    this.lastRequestAt = this.now();
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
      return failure(createdAt, input.sceneId, {
        retryable: false,
        bodySummary: "image provider configuration is invalid",
      });
    }
    if (!apiKey?.trim() || !input.projectSlug) {
      return failure(createdAt, input.sceneId, {
        retryable: false,
        model: config.model,
        bodySummary: "missing api key or project slug",
      });
    }

    try {
      await this.paceRequest(config.requestIntervalMs);
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
              // Only sent when explicitly configured away from "auto" so the
              // default request body is unchanged (and cost is not silently
              // raised - "high" is materially more expensive per image).
              ...(config.quality && config.quality !== "auto"
                ? { quality: config.quality }
                : {}),
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
          return failure(
            createdAt,
            input.sceneId,
            httpErrorEvidence(response.status, payload.error, config.model),
          );
        }

        const image = payload.data?.[0];
        if (!image?.b64_json) {
          return failure(createdAt, input.sceneId, {
            retryable: true,
            httpStatus: response.status,
            model: config.model,
            bodySummary: "provider returned no image data",
          });
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
    } catch (error) {
      // AbortError = client timeout; treat as retryable. Anything else that
      // reaches here (network drop, bounded-body abort, storage mismatch) is
      // also worth one controlled retry.
      const aborted = error instanceof Error && error.name === "AbortError";
      return failure(createdAt, input.sceneId, {
        retryable: true,
        model: config.model,
        bodySummary: aborted ? "request timed out" : "image request failed before a response",
      });
    }
  }
}

function httpErrorEvidence(
  status: number,
  providerError: OpenAIImageResponse["error"],
  model: string,
): Omit<ImageGenerationErrorEvidence, "sceneId"> {
  return {
    retryable: RETRYABLE_HTTP_STATUS.has(status),
    httpStatus: status,
    model,
    providerErrorCode: sanitizeToken(providerError?.code),
    providerErrorType: sanitizeToken(providerError?.type),
    bodySummary: sanitizeBodySummary(providerError),
  };
}

/**
 * Replaces C0 control codes and DEL with spaces. Implemented as an explicit
 * char-code filter (not a regex literal with raw control bytes) so the pattern
 * can never be mis-transcribed. Nothing secret is ever passed here - only the
 * provider's own error message / code / type.
 */
function stripControl(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code <= 0x1f || code === 0x7f ? " " : ch;
  }
  return out;
}

/** Short, control-stripped token (error code/type). Never a secret. */
function sanitizeToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = stripControl(value).trim().slice(0, 80);
  return cleaned || undefined;
}

/**
 * Bounded, sanitized excerpt of the provider's *own error object* (message /
 * type / code / param only). The request body, headers, and api key are never
 * in scope here, so no secret can leak.
 */
function sanitizeBodySummary(providerError: OpenAIImageResponse["error"]): string | undefined {
  if (!providerError || typeof providerError !== "object") return undefined;
  const parts = [
    providerError.message,
    providerError.type ? `type=${providerError.type}` : undefined,
    providerError.code ? `code=${providerError.code}` : undefined,
    providerError.param ? `param=${providerError.param}` : undefined,
  ].filter((part): part is string => typeof part === "string" && part.length > 0);
  if (parts.length === 0) return undefined;
  return stripControl(parts.join(" | ")).slice(0, 300);
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

function failure(
  createdAt: string,
  sceneId: number,
  evidence: Omit<ImageGenerationErrorEvidence, "sceneId"> & { sceneId?: number },
): ImageGenerationResult {
  return {
    success: false,
    sceneId,
    provider: "openai",
    model: evidence.model ?? imageProviderConfig.openai.model,
    createdAt,
    error: "Image generation failed.",
    errorEvidence: { ...evidence, sceneId },
  };
}
