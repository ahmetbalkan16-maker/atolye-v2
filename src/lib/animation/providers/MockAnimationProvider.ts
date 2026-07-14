import type {
  AnimationGenerationInput,
  AnimationGenerationResult,
  AnimationProvider,
} from "./AnimationProvider";

export class MockAnimationProvider implements AnimationProvider {
  readonly name = "mock";

  async generateAnimation(
    input: AnimationGenerationInput,
  ): Promise<AnimationGenerationResult> {
    const zoomIn = input.sceneId % 2 === 1;

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
      motionType: zoomIn ? "zoom-in" : "zoom-out",
      start: zoomIn
        ? frame(0, 0, 1, 1, 1)
        : frame(0.05, 0.05, 0.9, 0.9, 1.1),
      end: zoomIn
        ? frame(0.05, 0.05, 0.9, 0.9, 1.1)
        : frame(0, 0, 1, 1, 1),
      transition: "fade",
    };
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
