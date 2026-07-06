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