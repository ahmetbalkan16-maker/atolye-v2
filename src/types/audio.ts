export type AudioStatus =
  | "planned"
  | "generating"
  | "generated"
  | "failed";

export type AudioProviderName =
  | "mock";

export interface AudioNarrator {
  style: string;

  tone: string;

  language: string;

  voiceProvider?: string;

  voiceId?: string;
}

export interface AudioSection {
  chapterId: number;

  title: string;

  duration: string;

  emotion: string;

  emphasis: string[];

  narrationNotes: string;

  pacing: string;

  sourceText: string;

  outputAssetId?: string;

  status?: AudioStatus;

  provider?: AudioProviderName | string;

  model?: string;

  audioFileUrl?: string;
}

export interface AudioMusicPlan {
  mood: string;

  suggestion: string;

  intensity: string;
}

export interface AudioProductionInfo {
  targetFormat: "mp3" | "wav";

  sampleRate: number;

  estimatedTotalDuration: string;

  generationStatus: AudioStatus;

  audioFileUrl?: string;
}

export interface AudioData {
  outputAssetId?: string;

  status?: AudioStatus;

  provider?: AudioProviderName | string;

  model?: string;

  narrator: AudioNarrator;

  sections: AudioSection[];

  music: AudioMusicPlan;

  production: AudioProductionInfo;

  createdAt: string;
}
