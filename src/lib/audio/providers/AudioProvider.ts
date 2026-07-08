import type { AudioProviderName, AudioStatus } from "@/types/audio";

export interface AudioGenerationInput {
  chapterId?: number;
  title?: string;
  sourceText: string;
  voiceStyle?: string;
  format: "mp3" | "wav";
}

export interface AudioGenerationResult {
  provider: AudioProviderName | string;
  model?: string;
  url?: string;
  filePath?: string;
  mimeType?: string;
  status: AudioStatus;
  error?: string;
}

export interface AudioProvider {
  generateAudio(input: AudioGenerationInput): Promise<AudioGenerationResult>;
}
