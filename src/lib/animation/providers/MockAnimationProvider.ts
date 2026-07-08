import type {
  AnimationGenerationInput,
  AnimationGenerationResult,
  AnimationProvider,
} from "./AnimationProvider";

export class MockAnimationProvider implements AnimationProvider {
  async generateAnimation(
    _input: AnimationGenerationInput,
  ): Promise<AnimationGenerationResult> {
    return {
      provider: "mock",
      model: "mock-animation-model",
      url: "",
      filePath: "",
      status: "generated",
    };
  }
}
