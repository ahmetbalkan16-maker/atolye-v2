import fs from "fs";
import path from "path";
import { Project } from "./projectTypes";

export function getProjects(): Project[] {
  const dirPath = path.join(process.cwd(), "data", "projects");

  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files = fs
    .readdirSync(dirPath)
    .filter((file) => file.endsWith(".json"));

  const projects = files.map((file) => {
    const filePath = path.join(dirPath, file);
    const content = fs.readFileSync(filePath, "utf-8");

    return JSON.parse(content) as Project;
  });

  projects.sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return projects;
}