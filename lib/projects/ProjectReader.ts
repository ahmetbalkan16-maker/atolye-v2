import { promises as fs } from "fs";
import path from "path";

export class ProjectReader {
  static getProjectFolder(slug: string) {
    return path.join(process.cwd(), "data", "projects", slug);
  }

  static async readJSON<T>(
    slug: string,
    fileName: string
  ): Promise<T | null> {
    const folder = this.getProjectFolder(slug);
    const file = path.join(folder, fileName);

    try {
      const content = await fs.readFile(file, "utf-8");
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }
}