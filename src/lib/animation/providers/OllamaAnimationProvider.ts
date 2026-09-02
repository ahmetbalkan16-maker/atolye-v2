import { createHash } from "node:crypto";
import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import {
  animationMotionTypes,
  animationTransitionTypes,
  type AnimationMotionType,
  type AnimationTransitionType,
} from "@/types/animation";
import { isValidAnimationDuration } from "../AnimationMotionPlanValidation";
import { validateAnimationProviderPlan } from "../AnimationStructuredOutput";
import { resolveOllamaConfig, type OllamaConfig } from "@/lib/ai/OllamaConfig";
import type {
  AnimationGenerationInput,
  AnimationGenerationResult,
  AnimationRequestIdentity,
  ConfiguredAnimationProvider,
} from "./AnimationProvider";

type Fetcher = typeof fetch;

/**
 * Local, $0 animation motion-plan provider.
 *
 * A small local model cannot reliably satisfy the full motion-plan geometry
 * contract (`crop.x + crop.width <= 1` and friends), so the LLM is only asked
 * the two *creative* choices — `motionType` and `transition`, both enum-
 * constrained via Ollama's `format`, which any model handles — and the
 * geometry is derived deterministically from `motionType` (the same safe
 * frames `MockAnimationProvider` uses). The result is a genuine, valid
 * production motion plan with real per-scene variety. Opt-in via
 * `ANIMATION_PROVIDER=ollama`. Any transport / parse failure falls back to a
 * conservative zoom-in rather than failing the stage.
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
    const model = safeModel(this.loadConfig);
    return identity(input, model);
  }

  async generateAnimation(
    input: AnimationGenerationInput,
  ): Promise<AnimationGenerationResult> {
    let model = "ollama";
    try {
      validateInput(input);
      const config = this.loadConfig();
      model = config.model;

      let motionType: AnimationMotionType = "zoom-in";
      let transition: AnimationTransitionType = "fade";
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.timeoutMs);
        let payload: { message?: { content?: string | null } };
        try {
          const response = await this.fetcher(`${config.baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: config.model,
              stream: false,
              format: {
                type: "object",
                required: ["motionType", "transition"],
                additionalProperties: false,
                properties: {
                  motionType: { type: "string", enum: [...animationMotionTypes] },
                  transition: { type: "string", enum: [...animationTransitionTypes] },
                },
              },
              options: {
                temperature: 0,
                ...(config.numCtx !== undefined ? { num_ctx: config.numCtx } : {}),
              },
              messages: [
                {
                  role: "user",
                  content:
                    "Choose the camera motion and the transition into the next shot for this " +
                    `documentary scene. Scene (${input.durationSeconds.toFixed(1)}s): ` +
                    `${input.animationPrompt.trim().slice(0, 600)}\n` +
                    `motionType one of: ${animationMotionTypes.join(", ")}. ` +
                    `transition one of: ${animationTransitionTypes.join(", ")}. ` +
                    "Return only the JSON object.",
                },
              ],
            }),
            signal: controller.signal,
            redirect: "error",
          });
          payload = response.ok ? await response.json() : {};
        } finally {
          clearTimeout(timer);
        }
        const choice = JSON.parse(payload?.message?.content ?? "{}") as {
          motionType?: unknown;
          transition?: unknown;
        };
        if ((animationMotionTypes as readonly string[]).includes(choice.motionType as string)) {
          motionType = choice.motionType as AnimationMotionType;
        }
        if ((animationTransitionTypes as readonly string[]).includes(choice.transition as string)) {
          transition = choice.transition as AnimationTransitionType;
        }
      } catch {
        // keep the conservative defaults
      }

      const { start, end } = framesFor(motionType);
      const plan = { motionType, start, end, transition };
      // Defensive: prove the derived geometry actually satisfies the contract.
      const validation = validateAnimationProviderPlan(plan);
      const finalPlan = validation.success ? validation.plan : {
        motionType: "zoom-in" as const,
        ...framesFor("zoom-in"),
        transition: "fade" as const,
      };

      return {
        success: true,
        sceneId: input.sceneId,
        sourceImageAssetId: input.sourceImageAssetId,
        provider: "ollama",
        model,
        generationMode: "production",
        requestIdentity: identity(input, model).requestIdentity,
        artifactType: "motion-plan",
        status: "generated",
        durationSeconds: input.durationSeconds,
        motionType: finalPlan.motionType,
        start: finalPlan.start,
        end: finalPlan.end,
        transition: finalPlan.transition,
      };
    } catch {
      return fail(input, model);
    }
  }
}

function framesFor(motionType: AnimationMotionType) {
  switch (motionType) {
    case "zoom-in":
      return { start: frame(0, 0, 1, 1, 1), end: frame(0.05, 0.05, 0.9, 0.9, 1.1) };
    case "zoom-out":
      return { start: frame(0.05, 0.05, 0.9, 0.9, 1.1), end: frame(0, 0, 1, 1, 1) };
    case "pan-left":
      return { start: frame(0.15, 0.05, 0.8, 0.9, 1), end: frame(0, 0.05, 0.8, 0.9, 1) };
    case "pan-right":
      return { start: frame(0, 0.05, 0.8, 0.9, 1), end: frame(0.15, 0.05, 0.8, 0.9, 1) };
    case "static":
    default: {
      const still = frame(0.05, 0.05, 0.9, 0.9, 1);
      return { start: still, end: still };
    }
  }
}

function frame(x: number, y: number, width: number, height: number, scale: number) {
  return {
    crop: { x, y, width, height },
    transform: { scale, translateX: 0, translateY: 0 },
  };
}

function identity(
  input: AnimationGenerationInput,
  model: string,
): AnimationRequestIdentity {
  const seed = JSON.stringify({
    model,
    sceneId: input.sceneId,
    sourceImageAssetId: input.sourceImageAssetId,
    animationPrompt: input.animationPrompt.trim(),
    durationSeconds: input.durationSeconds,
  });
  const requestIdentity = createHash("sha256").update(seed).digest("hex");
  return Object.freeze({
    assetId: `animation-${requestIdentity}`,
    requestIdentity,
    promptDigest: createHash("sha256").update(input.animationPrompt.trim()).digest("hex"),
    model,
  });
}

function safeModel(loadConfig: () => OllamaConfig): string {
  try {
    return loadConfig().model;
  } catch {
    return "ollama";
  }
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
): AnimationGenerationResult {
  const sceneId = Number.isSafeInteger(input.sceneId) && input.sceneId > 0 ? input.sceneId : 0;
  return {
    success: false,
    sceneId,
    sourceImageAssetId: input.sourceImageAssetId,
    provider: "ollama",
    model,
    generationMode: "production",
    error: "ANIMATION_MOTION_PLAN_FAILED",
    diagnostic: {
      sceneId,
      phase: "provider-response",
      provider: "ollama",
      ...(model ? { model } : {}),
    },
  };
}
