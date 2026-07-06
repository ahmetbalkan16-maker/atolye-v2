import fs from "fs";
import path from "path";
import { VisualData } from "@/types/visual";

const DATA_DIR = path.join(process.cwd(), "data", "visuals");

export class VisualManager {
  private static ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private static getFilePath(projectId: string) {
    return path.join(DATA_DIR, `${projectId}.json`);
  }

  static saveVisualData(data: VisualData) {
    this.ensureDataDir();

    const filePath = this.getFilePath(data.projectId);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");

    return data;
  }

  static getVisualData(projectId: string): VisualData | null {
    this.ensureDataDir();

    const filePath = this.getFilePath(projectId);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const raw = fs.readFileSync(filePath, "utf-8");

    return JSON.parse(raw) as VisualData;
  }

  static deleteVisualData(projectId: string) {
    this.ensureDataDir();

    const filePath = this.getFilePath(projectId);

    if (!fs.existsSync(filePath)) {
      return false;
    }

    fs.unlinkSync(filePath);

    return true;
  }
}