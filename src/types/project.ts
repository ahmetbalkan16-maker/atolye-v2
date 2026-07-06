export type ProjectStatus =
  | "draft"
  | "research"
  | "script"
  | "scenes"
  | "visuals"
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

export interface ResearchData {}

export interface ScriptData {}

export interface SceneData {}

export interface VisualData {}

export interface AnimationData {}

export interface VoiceData {}

export interface SeoData {}

export interface ProjectFile {
  project: Project;
  research?: ResearchData;
  script?: ScriptData;
  scenes?: SceneData[];
  visuals?: VisualData[];
  animation?: AnimationData;
  voice?: VoiceData;
  seo?: SeoData;
}