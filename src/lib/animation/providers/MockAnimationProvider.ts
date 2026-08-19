import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import { animationMotionTypes, type AnimationMotionType } from "@/types/animation";
import type {
  AnimationGenerationInput,
  AnimationGenerationResult,
  ConfiguredAnimationProvider,
} from "./AnimationProvider";

export class MockAnimationProvider implements ConfiguredAnimationProvider {
  readonly name = "mock";

  createImmutableAnimationDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name }, requiredMethods: ["generateAnimation"],
      optionalMethods: ["getRequestIdentity"],
    });
  }

  async generateAnimation(
    input: AnimationGenerationInput,
  ): Promise<AnimationGenerationResult> {
    // Deterministic round-robin over every motion type (visual pacing
    // variety), keyed purely on sceneId so repeated calls for the same
    // scene stay identical (see "mock plans are deterministic" smoke test).
    const motionType =
      animationMotionTypes[
        ((input.sceneId % animationMotionTypes.length) + animationMotionTypes.length) %
          animationMotionTypes.length
      ];
    const { start, end } = framesFor(motionType);

    return {
      success: true,
      sceneId: input.sceneId,
      sourceImageAssetId: input.sourceImageAssetId,
      provider: "mock",
      model: "deterministic-motion-plan-v1",
      generationMode: "mock",
      artifactType: "motion-plan",
      status: "generated",
      durationSeconds: input.durationSeconds,
      motionType,
      start,
      end,
      transition: "fade",
    };
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

function frame(
  x: number,
  y: number,
  width: number,
  height: number,
  scale: number,
) {
  return {
    crop: { x, y, width, height },
    transform: { scale, translateX: 0, translateY: 0 },
  };
}
