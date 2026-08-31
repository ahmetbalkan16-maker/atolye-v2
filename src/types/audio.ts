export type AudioStatus =
  | "planned"
  | "generating"
  | "generated"
  | "failed";

export type AudioProviderName = "mock" | "openai" | "piper";

export type AudioMimeType = "audio/wav";

export type AudioGenerationTarget =
  | {
      kind: "section";
      chapterId: number;
    }
  | {
      kind: "mix";
    };

type AudioGenerationResultBase = {
  target: AudioGenerationTarget;
  provider: AudioProviderName;
  model?: string;
  createdAt: string;
};

export type AudioGenerationMockSuccess = AudioGenerationResultBase & {
  success: true;
  provider: "mock";
  filePath: "";
  url: "";
  mimeType: "audio/mock";
  byteLength: 0;
  durationSeconds: 0;
  error?: never;
};

export type AudioGenerationRealSuccess = AudioGenerationResultBase & {
  success: true;
  provider: "openai" | "piper";
  model: string;
  filePath: string;
  url: string;
  mimeType: AudioMimeType;
  byteLength: number;
  durationSeconds: number;
  error?: never;
};

export type AudioGenerationFailure = AudioGenerationResultBase & {
  success: false;
  error: string;
  evidence?: import("./audioError").AudioAssetErrorEvidence;
  filePath?: never;
  url?: never;
  mimeType?: never;
  byteLength?: never;
  durationSeconds?: never;
};

export type AudioGenerationResult =
  | AudioGenerationMockSuccess
  | AudioGenerationRealSuccess
  | AudioGenerationFailure;

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

  byteLength?: number;

  durationSeconds?: number;
}

export interface AudioMusicPlan {
  mood: string;

  suggestion: string;

  intensity: string;

  /**
   * The licence-cleared background track actually selected + staged for this
   * project (Faz 4). Additive: absent when the music library has no admissible
   * track for the resolved mood, in which case the assembly stage renders
   * narration-only exactly as before. `assetId` points at the staged `bgm`
   * audio asset that carries the full provenance.
   */
  selected?: {
    assetId: string;
    mood: string;
    title: string;
    source: string | null;
    sourceUrl: string | null;
    license: string | null;
    rightsStatus: import("./asset").MediaRightsStatus;
    attribution: string | null;
  };
}

export interface AudioProductionInfo {
  targetFormat: "mp3" | "wav";

  sampleRate: number;

  estimatedTotalDuration: string;

  generationStatus: AudioStatus;

  audioFileUrl?: string;

  byteLength?: number;

  durationSeconds?: number;
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
