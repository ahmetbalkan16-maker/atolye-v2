import fs from "fs";
import path from "path";

export function saveProject(topic: string, research: string) {
  const projectsDir = path.join(process.cwd(), "data", "projects");

  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
  }

  const id = topic
    .toLowerCase()
    .trim()
    .replaceAll(" ", "-")
    .replace(/[^a-z0-9ğüşıöç-]/gi, "");

  const project = {
    id,
    topic,
    status: {
      research: true,
      script: false,
      scene: false,
      thumbnail: false,
      seo: false,
      export: false,
    },
    research,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const filePath = path.join(projectsDir, `${id}.json`);

  fs.writeFileSync(filePath, JSON.stringify(project, null, 2), "utf-8");

  return project;
}