import fs from "fs/promises";
import path from "path";

export async function getProject(slug: string) {
  const folder = path.join(process.cwd(), "data", "projects");

  const files = await fs.readdir(folder);

  const file = files.find(
    (f) => f.replace(".json", "") === slug
  );

  if (!file) {
    return null;
  }

  const json = await fs.readFile(
    path.join(folder, file),
    "utf8"
  );

  return JSON.parse(json);
}