import type { YouTubePackageDraft } from "@/types/youtube";
import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import { createYouTubePackagePrompt } from "../prompts/youtubePackagePrompt";
import { youtubeProviderConfig } from "../YouTubeProviderConfig";
import { resolveOllamaConfig } from "@/lib/ai/OllamaConfig";
import type {
  YouTubeGenerationInput,
  YouTubeGenerationResult,
  ConfiguredYouTubeProvider,
} from "./YouTubeProvider";
import { YOUTUBE_GENERATION_ERROR } from "./YouTubeProvider";

type OllamaChatResponse = {
  message?: { content?: string | null };
  done_reason?: string | null;
};

/**
 * Local, $0 YouTube-package provider. Same JSON prompt / draft contract as
 * `OpenAIYouTubeProvider`, but the completion runs on a local Ollama model.
 * Opt-in via `YOUTUBE_PROVIDER=ollama`. Any failure returns the same
 * normalised `YOUTUBE_GENERATION_ERROR` the pipeline already handles.
 */
export class OllamaYouTubeProvider implements ConfiguredYouTubeProvider {
  readonly name = "ollama" as const;
  readonly model: string;
  private readonly fetcher: typeof fetch;

  constructor(options: { fetcher?: typeof fetch } = {}) {
    this.fetcher = options.fetcher ?? fetch;
    try {
      this.model = resolveOllamaConfig().model;
    } catch {
      this.model = "ollama";
    }
  }

  createImmutableYoutubeDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name, model: this.model },
      requiredMethods: ["generatePublishingPackage"],
    });
  }

  async generatePublishingPackage(
    input: YouTubeGenerationInput,
  ): Promise<YouTubeGenerationResult> {
    if (process.env.YOUTUBE_PROVIDER?.trim().toLowerCase() !== "ollama") {
      return failure(this.model);
    }
    const prompt = createYouTubePackagePrompt(input);
    if (Buffer.byteLength(prompt, "utf8") > youtubeProviderConfig.openai.maximumPromptBytes) {
      return failure(this.model);
    }

    let config;
    try {
      config = resolveOllamaConfig();
    } catch {
      return failure(this.model);
    }

    // A small local model sometimes truncates or mangles the package JSON;
    // re-roll a few times (lowering the temperature each attempt) before failing.
    const attempts = 1 + Math.max(0, config.maxRetries);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const temperature = attempt === 0 ? 0.3 : Math.max(0, 0.3 * (1 - attempt / attempts));
      const draft = await this.callOnce(prompt, config, temperature);
      if (draft) return { success: true, provider: "ollama", model: config.model, draft };
    }
    return failure(config.model);
  }

  private async callOnce(
    prompt: string,
    config: ReturnType<typeof resolveOllamaConfig>,
    temperature: number,
  ): Promise<YouTubePackageDraft | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await this.fetcher(`${config.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        redirect: "error",
        body: JSON.stringify({
          model: config.model,
          stream: false,
          format: "json",
          messages: [{ role: "user", content: prompt }],
          options: {
            temperature,
            num_predict: config.maxTokens,
            ...(config.numCtx !== undefined ? { num_ctx: config.numCtx } : {}),
          },
        }),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as OllamaChatResponse;
      const content = payload.message?.content;
      if (typeof content !== "string" || !content.trim() || payload.done_reason === "length") {
        return null;
      }
      return JSON.parse(content) as YouTubePackageDraft;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function failure(model: string): YouTubeGenerationResult {
  return {
    success: false,
    provider: "ollama",
    model,
    error: YOUTUBE_GENERATION_ERROR,
  };
}
