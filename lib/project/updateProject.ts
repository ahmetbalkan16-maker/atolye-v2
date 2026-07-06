import type { Project } from "@/types/project";
import { ProjectManager } from "./ProjectManager";

export function updateProject(project: Project) {
  return ProjectManager.updateProject(project);
}