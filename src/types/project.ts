export type ProjectStatus =
  | "draft"
  | "research"
  | "script"
  | "scenes"
  | "visuals"
  | "audio"
  | "thumbnail"
  | "seo"
  | "assembly"
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

export interface ProjectManifest {
  project: Project;
  packages: {
    research: boolean;
    script: boolean;
    scenes: boolean;
    visuals: boolean;
    audio: boolean;
    thumbnail: boolean;
    seo: boolean;
    assembly: boolean;
  };
  updatedAt: string;
}
