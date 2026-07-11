import { promises as fs } from "fs";
import path from "path";

export class ProjectReader {
  static getProjectsRoot() {
    return path.join(process.cwd(), "data", "projects");
  }

  static getProjectFolder(slug: string) {
    return path.join(this.getProjectsRoot(), slug);
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

  static async readJSONState<T>(
    slug: string,
    fileName: string,
  ): Promise<ProjectJSONReadResult<T>> {
    const folder = this.getProjectFolder(slug);
    const file = path.join(folder, fileName);
    let content: string;

    try {
      content = await fs.readFile(file, "utf-8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { status: "missing" };
      }

      throw error;
    }

    try {
      return {
        status: "parsed",
        value: JSON.parse(content) as T,
      };
    } catch {
      return { status: "malformed" };
    }
  }

  static async listProjects() {
    const root = this.getProjectsRoot();

    try {
      const items = await fs.readdir(root, {
        withFileTypes: true,
      });

      const projects = [];

      for (const item of items) {
        if (!item.isDirectory()) continue;

        const project = await this.readJSON(
          item.name,
          "project.json"
        );

        if (project) {
          projects.push(project);
        }
      }

      return projects;
    } catch {
      return [];
    }
  }
}

export type ProjectJSONReadResult<T> =
  | { status: "missing" }
  | { status: "malformed" }
  | { status: "parsed"; value: T };

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
