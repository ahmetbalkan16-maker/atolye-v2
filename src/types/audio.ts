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

  generationStatus: "planned" | "generated" | "failed";

  audioFileUrl?: string;
}

export interface AudioData {
  narrator: AudioNarrator;

  sections: AudioSection[];

  music: AudioMusicPlan;

  production: AudioProductionInfo;

  createdAt: string;
}
