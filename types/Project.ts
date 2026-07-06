export type ProjectStatus =
  | "draft"
  | "research"
  | "script"
  | "scenes"
  | "visuals"
  | "animation"
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
  sources: string[];
}

export interface ScriptData {
  title: string;
  intro: string;
  sections: {
    heading: string;
    narration: string;
  }[];
  outro: string;
  estimatedDuration: number;
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

  assetStatus: "pending" | "generated" | "approved";

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