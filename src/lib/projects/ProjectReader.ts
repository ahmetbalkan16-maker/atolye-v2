import { promises as fs } from "fs";
import path from "path";
import {
  getProjectRoot,
  getProjectsRoot,
  resolveRuntimeStorageContext,
  type RuntimeStorageInput,
} from "@/lib/runtime/RuntimeStoragePaths";

export class ProjectReader {
  static getProjectsRoot(input: RuntimeStorageInput = {}) {
    const context = resolveRuntimeStorageContext(input);
    return getProjectsRoot(context);
  }

  static getProjectFolder(slug: string, input: RuntimeStorageInput = {}) {
    const context = resolveRuntimeStorageContext(input);
    return getProjectRoot(slug, context);
  }

  static async readJSON<T>(
    slug: string,
    fileName: string,
    input: RuntimeStorageInput = {},
  ): Promise<T | null> {
    const context = resolveRuntimeStorageContext(input);
    requireSafeJsonFileName(fileName);
    const folder = this.getProjectFolder(slug, context);
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
    input: RuntimeStorageInput = {},
  ): Promise<ProjectJSONReadResult<T>> {
    const context = resolveRuntimeStorageContext(input);
    requireSafeJsonFileName(fileName);
    const folder = this.getProjectFolder(slug, context);
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

  static async listProjects(input: RuntimeStorageInput = {}) {
    const context = resolveRuntimeStorageContext(input);
    const root = this.getProjectsRoot(context);

    try {
      const items = await fs.readdir(root, {
        withFileTypes: true,
      });

      const projects = [];

      for (const item of items) {
        if (!item.isDirectory()) continue;

        const project = await this.readJSONState(
          item.name,
          "project.json",
          context,
        );

        if (project.status === "parsed") {
          projects.push(project.value);
        }
      }

      return projects;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }
  }
}

function requireSafeJsonFileName(fileName: string) {
  if (!/^[a-zA-Z0-9_-]+\.json$/.test(fileName)) {
    throw new Error("Invalid project storage path.");
  }
}

export type ProjectJSONReadResult<T> =
  | { status: "missing" }
  | { status: "malformed" }
  | { status: "parsed"; value: T };

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
