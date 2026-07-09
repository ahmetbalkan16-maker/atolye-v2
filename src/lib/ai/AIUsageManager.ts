import { ProjectReader } from "@/lib/projects/ProjectReader";
import { ProjectWriter } from "@/lib/projects/ProjectWriter";
import type { AIUsageLog, AIUsageRecord } from "@/types/aiUsage";

const usageFileName = "ai-usage.json";

export class AIUsageManager {
  static async appendRecord(record: AIUsageRecord): Promise<AIUsageLog> {
    const current = await this.readUsageLog(record.projectSlug);
    const now = new Date().toISOString();
    const nextLog: AIUsageLog = {
      projectSlug: record.projectSlug,
      records: [...current.records, record],
      createdAt: current.createdAt,
      updatedAt: now,
    };

    await ProjectWriter.writeJSON(record.projectSlug, usageFileName, nextLog);

    return nextLog;
  }

  private static async readUsageLog(
    projectSlug: string,
  ): Promise<AIUsageLog> {
    const now = new Date().toISOString();
    const stored = await ProjectReader.readJSON<unknown>(
      projectSlug,
      usageFileName,
    );

    if (!this.isUsageLog(stored, projectSlug)) {
      return {
        projectSlug,
        records: [],
        createdAt: now,
        updatedAt: now,
      };
    }

    return stored;
  }

  private static isUsageLog(
    value: unknown,
    projectSlug: string,
  ): value is AIUsageLog {
    return (
      Boolean(value) &&
      typeof value === "object" &&
      (value as AIUsageLog).projectSlug === projectSlug &&
      Array.isArray((value as AIUsageLog).records) &&
      typeof (value as AIUsageLog).createdAt === "string" &&
      typeof (value as AIUsageLog).updatedAt === "string"
    );
  }
}
