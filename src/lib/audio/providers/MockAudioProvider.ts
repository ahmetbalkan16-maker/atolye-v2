import type {
  AudioGenerationInput,
  AudioGenerationResult,
  AudioProvider,
} from "./AudioProvider";

export class MockAudioProvider implements AudioProvider {
  async generateAudio(
    input: AudioGenerationInput,
  ): Promise<AudioGenerationResult> {
    return {
      provider: "mock",
      model: "mock-audio-model",
      url: "",
      filePath: "",
      mimeType: input.format === "wav" ? "audio/wav" : "audio/mpeg",
      status: "generated",
    };
  }
}
