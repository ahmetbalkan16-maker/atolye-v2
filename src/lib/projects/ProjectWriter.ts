import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export class ProjectWriter {
  static async ensureProjectFolder(slug: string) {
    const folder = path.join(process.cwd(), "data", "projects", slug);
    await fs.mkdir(folder, { recursive: true });
    return folder;
  }

  static async writeJSON(slug: string, fileName: string, data: unknown) {
    const folder = await this.ensureProjectFolder(slug);
    const file = path.join(folder, fileName);

    await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
  }

  static async writeJSONAtomically(
    slug: string,
    fileName: string,
    data: unknown,
  ) {
    const folder = await this.ensureProjectFolder(slug);
    const file = path.join(folder, fileName);
    const temporaryFile = path.join(
      folder,
      `.${fileName}.${process.pid}.${randomUUID()}.tmp`,
    );

    try {
      await fs.writeFile(
        temporaryFile,
        JSON.stringify(data, null, 2),
        "utf-8",
      );
      await fs.rename(temporaryFile, file);
    } catch (error) {
      try {
        await fs.rm(temporaryFile, { force: true });
      } catch {
        // Preserve the original persistence error.
      }

      throw error;
    }
  }
}
