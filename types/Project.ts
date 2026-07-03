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
  title: string;
  content: string;
}

export interface ScriptData {
  title: string;

  hook: string;

  intro: string;

  chapters: ScriptChapter[];

  closing: string;

  narrationStyle: string;
}