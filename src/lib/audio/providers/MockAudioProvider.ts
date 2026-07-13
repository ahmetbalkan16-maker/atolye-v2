import type {
  AudioGenerationInput,
  AudioProvider,
} from "./AudioProvider";
import type { AudioGenerationResult } from "@/types/audio";

export class MockAudioProvider implements AudioProvider {
  readonly name = "mock";

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
