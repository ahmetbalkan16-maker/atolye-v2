import type {
  AudioGenerationInput,
  ConfiguredAudioProvider,
} from "./AudioProvider";
import type { AudioGenerationResult } from "@/types/audio";
import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";

export class MockAudioProvider implements ConfiguredAudioProvider {
  readonly name = "mock";

  createImmutableAudioDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name }, requiredMethods: ["validateInput", "generateAudio"],
    });
  }

  validateInput(_input: AudioGenerationInput): void {
    void _input;
  }

  async generateAudio(
    input: AudioGenerationInput,
  ): Promise<AudioGenerationResult> {
    return {
      success: true,
      target: input.target,
      provider: "mock",
      model: "mock-audio-model",
      url: "",
      filePath: "",
      mimeType: "audio/mock",
      byteLength: 0,
      durationSeconds: 0,
      createdAt: new Date().toISOString(),
    };
  }
}
