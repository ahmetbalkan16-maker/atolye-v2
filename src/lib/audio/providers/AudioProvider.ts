import type {
  AudioGenerationResult,
  AudioGenerationTarget,
  AudioProviderName,
} from "@/types/audio";

export interface AudioGenerationInput {
  target: AudioGenerationTarget;
  title?: string;
  sourceText: string;
  voiceStyle?: string;
  projectSlug: string;
}

export interface AudioProvider {
  readonly name: AudioProviderName;

  validateInput(input: AudioGenerationInput): void;

  generateAudio(input: AudioGenerationInput): Promise<AudioGenerationResult>;
}
