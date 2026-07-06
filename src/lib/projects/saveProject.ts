import fs from "fs";
import path from "path";
import { Project } from "./projectTypes";

function createSlug(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[ğ]/g, "g")
    .replace(/[ü]/g, "u")
    .replace(/[ş]/g, "s")
    .replace(/[ı]/g, "i")
    .replace(/[ö]/g, "o")
    .replace(/[ç]/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function saveProject(topic: string, result: unknown): Project {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const slug = createSlug(topic);

  const project: Project = {
    id,
    slug,
    title: topic,
    topic,
    status: "research",
    createdAt: now,
    updatedAt: now,
    result,
  };

  const dirPath = path.join(process.cwd(), "data", "projects");

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  const filePath = path.join(dirPath, `${slug}.json`);

  fs.writeFileSync(filePath, JSON.stringify(project, null, 2), "utf-8");

  return project;
}