import { ProjectManager } from "./ProjectManager";

export function loadProject(slug: string) {
  return ProjectManager.getProject(slug);
}