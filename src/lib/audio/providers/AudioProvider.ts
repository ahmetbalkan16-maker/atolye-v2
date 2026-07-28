import type {
  AudioGenerationResult,
  AudioGenerationTarget,
  AudioProviderName,
} from "@/types/audio";
import type { ProviderDispatchAdapterAuthority } from "@/lib/providers/ProviderDispatchAdapterAuthority";

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

export type ConfiguredAudioProvider = AudioProvider &
  ProviderDispatchAdapterAuthority<"createImmutableAudioDispatchAdapter">;
