import { createHash } from "node:crypto";
import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import {
  animationMotionTypes,
  animationTransitionTypes,
} from "@/types/animation";
import { isValidAnimationDuration } from "../AnimationMotionPlanValidation";
import {
  canonicalAnimationProviderSchema,
  createAnimationMotionPlanSystemPrompt,
  validateAnimationProviderPlan,
} from "../AnimationStructuredOutput";
import { resolveOllamaConfig, type OllamaConfig } from "@/lib/ai/OllamaConfig";
import type {
  AnimationGenerationInput,
  AnimationGenerationResult,
  AnimationRequestIdentity,
  ConfiguredAnimationProvider,
} from "./AnimationProvider";

type Fetcher = typeof fetch;

/**
 * Local, $0 animation motion-plan provider. Same structured JSON contract as
 * `OpenAIAnimationProvider` (`createAnimationMotionPlanSystemPrompt` +
 * `validateAnimationProviderPlan`), but the completion runs on a local Ollama
 * model instead of `api.openai.com`. Opt-in via `ANIMATION_PROVIDER=ollama`.
 * Any transport / parse / schema failure is normalised to the same
 * `AnimationGenerationFailure` the pipeline already handles (it falls back to a
 * deterministic Ken Burns plan).
 */
export class OllamaAnimationProvider implements ConfiguredAnimationProvider {
  readonly name = "ollama";

  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly loadConfig: () => OllamaConfig = resolveOllamaConfig,
  ) {}

  createImmutableAnimationDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name }, requiredMethods: ["generateAnimation"],
      optionalMethods: ["getRequestIdentity"],
    });
  }

  getRequestIdentity(input: AnimationGenerationInput): AnimationRequestIdentity {
    validateInput(input);
    const config = this.loadConfig();
    const body = requestBody(input, config.model);
    return identity(input, config.model, body);
  }

  async generateAnimation(
    input: AnimationGenerationInput,
  ): Promise<AnimationGenerationResult> {
    let model: string | undefined;
    try {
      validateInput(input);
      const config = this.loadConfig();
      model = config.model;
      const body = requestBody(input, config.model);
      const requestIdentity = identity(input, config.model, body);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      let payload: OllamaChatResponse;
      try {
        const response = await this.fetcher(`${config.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: controller.signal,
          redirect: "error",
        });
        if (!response.ok) return fail(input, model, "ANIMATION_PROVIDER_HTTP_FAILED");
        payload = (await response.json()) as OllamaChatResponse;
      } finally {
        clearTimeout(timer);
      }

      const content = payload?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        return fail(input, model, "ANIMATION_RESPONSE_EMPTY");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        return fail(input, model, "ANIMATION_RESPONSE_INVALID_JSON");
      }
      const validation = validateAnimationProviderPlan(parsed);
      if (!validation.success) {
        return fail(input, model, "ANIMATION_RESPONSE_SCHEMA_INVALID");
      }
      return {
        success: true,
        sceneId: input.sceneId,
        sourceImageAssetId: input.sourceImageAssetId,
        provider: "ollama",
        model,
        generationMode: "production",
        requestIdentity: requestIdentity.requestIdentity,
        artifactType: "motion-plan",
        status: "generated",
        durationSeconds: input.durationSeconds,
        motionType: validation.plan.motionType,
        start: validation.plan.start,
        end: validation.plan.end,
        transition: validation.plan.transition,
      };
    } catch {
      return fail(input, model, "ANIMATION_MOTION_PLAN_FAILED");
    }
  }
}

interface OllamaChatResponse {
  message?: { content?: string | null };
}

function requestBody(input: AnimationGenerationInput, model: string): string {
  return JSON.stringify({
    model,
    stream: false,
    // Grammar-constrained decoding: the model cannot emit non-conforming JSON,
    // so even a small local model produces a valid motion plan.
    format: canonicalAnimationProviderSchema.jsonSchema,
    options: { temperature: 0 },
    messages: [
      { role: "system", content: createAnimationMotionPlanSystemPrompt() },
      {
        role: "user",
        content: JSON.stringify({
          animationPrompt: input.animationPrompt.trim(),
          durationSeconds: input.durationSeconds,
          allowedMotionTypes: animationMotionTypes,
          allowedTransitionTypes: animationTransitionTypes,
        }),
      },
    ],
  });
}

function identity(
  input: AnimationGenerationInput,
  model: string,
  body: string,
): AnimationRequestIdentity {
  const requestIdentity = createHash("sha256").update(body).digest("hex");
  return Object.freeze({
    assetId: `animation-${requestIdentity}`,
    requestIdentity,
    promptDigest: createHash("sha256").update(input.animationPrompt.trim()).digest("hex"),
    model,
  });
}

function validateInput(input: AnimationGenerationInput) {
  if (
    !Number.isSafeInteger(input.sceneId) || input.sceneId <= 0 ||
    !/^[a-zA-Z0-9-_]{1,200}$/.test(input.sourceImageAssetId) ||
    typeof input.animationPrompt !== "string" || !input.animationPrompt.trim() ||
    input.animationPrompt.length > 8_000 ||
    !isValidAnimationDuration(input.durationSeconds)
  ) throw new Error("invalid");
}

function fail(
  input: AnimationGenerationInput,
  model: string | undefined,
  error: Extract<AnimationGenerationResult, { success: false }>["error"],
): AnimationGenerationResult {
  return {
    success: false,
    sceneId: Number.isSafeInteger(input.sceneId) && input.sceneId > 0 ? input.sceneId : 0,
    sourceImageAssetId: input.sourceImageAssetId,
    provider: "ollama",
    model,
    generationMode: "production",
    error,
    diagnostic: {
      sceneId: Number.isSafeInteger(input.sceneId) && input.sceneId > 0 ? input.sceneId : 0,
      phase: "provider-response",
      provider: "ollama",
      ...(model ? { model } : {}),
    },
  };
}
