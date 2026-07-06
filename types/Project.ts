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

  musicIdeas: string[];

  soundEffects: string[];

  thumbnailIdeas: string[];

  youtubeTitles: string[];

  sources: string[];
}

export interface ScriptChapter {
  id: number;

  title: string;

  summary: string;

  narration: string;

  duration: number;

  visualGoal: string;

  cameraShot: string;

  animationGoal: string;

  musicMood: string;

  soundEffects: string[];

  keyPoints: string[];

  imagePrompts: string[];

  animationPrompts: string[];
}
export interface ScriptData {
  id: string;

  projectId: string;

  topic: string;

  title: string;

  summary: string;

  hook: string;

  intro: string;

  chapters: ScriptChapter[];

  closing: string;

  narrationStyle: "documentary" | "cinematic" | "dramatic";

  targetAudience: string;

  language: "tr" | "en";

  estimatedDuration: number;

  totalChapters: number;

  version: string;

  aiProvider: string;

  createdAt: string;

  updatedAt: string;
}