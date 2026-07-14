import type { YouTubePackageDraft } from "@/types/youtube";
import { createYouTubePackagePrompt } from "../prompts/youtubePackagePrompt";
import { youtubeProviderConfig } from "../YouTubeProviderConfig";
import type {
  YouTubeGenerationInput,
  YouTubeGenerationResult,
  YouTubeProvider,
} from "./YouTubeProvider";
import { YOUTUBE_GENERATION_ERROR } from "./YouTubeProvider";

type OpenAIResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export class OpenAIYouTubeProvider implements YouTubeProvider {
  readonly name = "openai" as const;
  readonly model = youtubeProviderConfig.openai.model;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maximumResponseBytes: number;

  constructor(options: {
    fetcher?: typeof fetch;
    timeoutMs?: number;
    maximumResponseBytes?: number;
  } = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? youtubeProviderConfig.openai.timeoutMs;
    this.maximumResponseBytes =
      options.maximumResponseBytes ??
      youtubeProviderConfig.openai.maximumResponseBytes;
  }

  async generatePublishingPackage(
    input: YouTubeGenerationInput,
  ): Promise<YouTubeGenerationResult> {
    if (
      process.env.YOUTUBE_PROVIDER?.trim().toLowerCase() !== "openai" ||
      !process.env.OPENAI_API_KEY?.trim()
    ) {
      return failure();
    }

    const prompt = createYouTubePackagePrompt(input);
    if (Buffer.byteLength(prompt, "utf8") > youtubeProviderConfig.openai.maximumPromptBytes) {
      return failure();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim()}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.model,
            temperature: 0.3,
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: prompt }],
          }),
        },
      );
      if (!response.ok) return failure();
      const payload = await readBoundedJson(
        response,
        this.maximumResponseBytes,
        controller,
      );
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) return failure();
      const draft = JSON.parse(content) as YouTubePackageDraft;
      return {
        success: true,
        provider: "openai",
        model: this.model,
        draft,
      };
    } catch {
      return failure();
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
  controller: AbortController,
): Promise<OpenAIResponse> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
    controller.abort();
    throw new Error("invalid");
  }
  if (!response.body) throw new Error("invalid");
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
        throw new Error("invalid");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as OpenAIResponse;
}

function failure(): YouTubeGenerationResult {
  return {
    success: false,
    provider: "openai",
    model: youtubeProviderConfig.openai.model,
    error: YOUTUBE_GENERATION_ERROR,
  };
}
