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

  narration: string;

  duration: number;

  visualGoal: string;

  emotion: string;

  transition: string;
}
export interface ScriptData {
  topic: string;

  title: string;

  subtitle: string;

  hook: string;

  introduction: string;

  chapters: ScriptChapter[];

  conclusion: string;

  callToAction: string;

  estimatedDuration: number;

  narrationWordCount: number;

  targetAudience: string;

  language: string;

  voiceStyle: string;

  musicStyle: string;

  thumbnailIdea: string;

  seoKeywords: string[];

  createdAt: string;
}