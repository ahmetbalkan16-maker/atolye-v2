import fs from "fs";
import path from "path";

const ROOT_DIR = process.cwd();

function resolvePath(relativePath: string) {
  return path.join(ROOT_DIR, relativePath);
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export class FileStorage {
  static exists(relativePath: string) {
    return fs.existsSync(resolvePath(relativePath));
  }

  static saveJson(relativePath: string, data: unknown) {
    const filePath = resolvePath(relativePath);
    ensureDir(filePath);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");

    return data;
  }

  static saveJsonAtomically(relativePath: string, data: unknown) {
    const filePath = resolvePath(relativePath);
    ensureDir(filePath);
    const temporaryPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );

    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2), "utf-8");
      fs.renameSync(temporaryPath, filePath);
      return data;
    } catch (error) {
      try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
      throw error;
    }
  }

  static loadJson<T>(relativePath: string): T | null {
    const filePath = resolvePath(relativePath);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  }

  static listDirs(relativePath: string) {
    const dirPath = resolvePath(relativePath);

    if (!fs.existsSync(dirPath)) {
      return [];
    }

    return fs
      .readdirSync(dirPath)
      .filter((item) => fs.statSync(path.join(dirPath, item)).isDirectory());
  }

  static remove(relativePath: string) {
    const filePath = resolvePath(relativePath);

    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { recursive: true, force: true });
    }
  }
}
