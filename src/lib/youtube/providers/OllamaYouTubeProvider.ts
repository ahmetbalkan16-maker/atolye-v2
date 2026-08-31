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

type OllamaResponse = {
  choices?: Array<{ message?: { content?: string } }>;
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await this.fetcher(`${config.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        redirect: "error",
        body: JSON.stringify({
          model: config.model,
          stream: false,
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!response.ok) return failure(config.model);
      const payload = (await response.json()) as OllamaResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) return failure(config.model);
      const draft = JSON.parse(content) as YouTubePackageDraft;
      return { success: true, provider: "ollama", model: config.model, draft };
    } catch {
      return failure(config.model);
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
