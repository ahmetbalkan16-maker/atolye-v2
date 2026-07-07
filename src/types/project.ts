export type ProjectStatus =
  | "draft"
  | "research"
  | "script"
  | "scenes"
  | "visuals"
  | "audio"
  | "animation"
  | "voice"
  | "youtube"
  | "completed";

export interface Project {
  id: string;
  slug: string;
  title: string;
  description?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchData {
  topic: string;
  summary: string;
  historicalContext: string;
  timeline: string[];
  characters: string[];
  locations: string[];
  keyEvents: string[];
  strategies: string[];
  controversies: string[];
  interestingFacts: string[];
  documentaryFlow: string[];
  sceneIdeas: string[];
  imagePrompts: string[];
  animationPrompts: string[];
  musicIdeas: string[];
  soundEffects: string[];
  thumbnailIdeas: string[];
  youtubeTitles: string[];
  sources: string[];
  createdAt: string;
}

export interface ScriptSection {
  heading: string;
  narration: string;
}

export interface ScriptData {
  topic: string;
  title: string;
  intro: string;
  sections: ScriptSection[];
  outro: string;
}

export interface SceneData {
  id: number;
  title: string;
  narration: string;
  duration: number;
  visualDescription: string;
  imagePrompt: string;
  animationPrompt: string;
  cameraMovement: string;
  soundEffects: string[];
  backgroundMusic: string;
  transition: string;
  voiceEmotion: string;
  voiceSpeed: number;
  subtitle: string;
  mapRequired: boolean;
  timelineRequired: boolean;
  assetStatus: "pending" | "ready" | "failed";
  historicalNotes: string[];
  references: string[];
}

export interface ScenesFile {
  projectId: string;
  createdAt: string;
  updatedAt: string;
  totalDuration: number;
  scenes: SceneData[];
}

export type VisualData = Record<string, unknown>;

export type AnimationData = Record<string, unknown>;

export type VoiceData = Record<string, unknown>;

export type SeoData = Record<string, unknown>;

export interface ProjectFile {
  project: Project;
  research?: ResearchData;
  script?: ScriptData;
  scenes?: ScenesFile;
  visuals?: VisualData[];
  animation?: AnimationData;
  voice?: VoiceData;
  seo?: SeoData;
}
