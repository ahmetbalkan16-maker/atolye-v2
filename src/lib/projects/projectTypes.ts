export type ProjectStatus =
  | "research"
  | "script"
  | "scenes"
  | "thumbnail"
  | "seo"
  | "finished";

export type Project = {
  id: string;
  slug: string;
  title: string;
  topic: string;
  description?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  result?: unknown;
};