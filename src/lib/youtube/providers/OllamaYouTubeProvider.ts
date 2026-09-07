import type { YouTubePackageDraft } from "@/types/youtube";
import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import { createYouTubePackagePrompt } from "../prompts/youtubePackagePrompt";
import { youtubeProviderConfig } from "../YouTubeProviderConfig";
import { buildYouTubePackageResponseSchema } from "../YouTubePackageStructuredOutput";
import { normalizeYouTubePackageDraft } from "../YouTubePackageValidation";
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
    // The response is grammar-constrained to the draft shape (`format: <schema>`)
    // and every parsed draft is held to `normalizeYouTubePackageDraft` — the
    // exact gate `YouTubePackagePipeline` applies — so a draft that would fail
    // the pipeline is re-rolled here instead of becoming a hard failure.
    const durationSeconds = input.videoDurationSeconds;
    const schema = buildYouTubePackageResponseSchema(durationSeconds);
    const attempts = 1 + Math.max(0, config.maxRetries);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const temperature = attempt === 0 ? 0.3 : Math.max(0, 0.3 * (1 - attempt / attempts));
      const draft = await this.callOnce(prompt, config, temperature, schema);
      if (draft && isPipelineAcceptableDraft(draft, durationSeconds)) {
        return { success: true, provider: "ollama", model: config.model, draft };
      }
    }
    return failure(config.model);
  }

  private async callOnce(
    prompt: string,
    config: ReturnType<typeof resolveOllamaConfig>,
    temperature: number,
    format: Record<string, unknown>,
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
          format,
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

/**
 * `true` when the draft survives the same normaliser `YouTubePackagePipeline`
 * runs (`normalizeYouTubePackageDraft` is idempotent, so a draft that passes
 * here also passes the pipeline's re-normalise + round-trip validation).
 */
function isPipelineAcceptableDraft(
  draft: YouTubePackageDraft,
  videoDurationSeconds: number,
): boolean {
  try {
    normalizeYouTubePackageDraft(draft, videoDurationSeconds);
    return true;
  } catch {
    return false;
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
