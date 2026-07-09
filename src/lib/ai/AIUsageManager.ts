import { ProjectReader } from "@/lib/projects/ProjectReader";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import { ProjectWriter } from "@/lib/projects/ProjectWriter";
import type { AIUsageLog, AIUsageRecord } from "@/types/aiUsage";
import type { ProductionStepKey, ProjectPackageUsage } from "@/types/project";

const usageFileName = "ai-usage.json";

export class AIUsageManager {
  static async getUsageLog(projectSlug: string): Promise<AIUsageLog> {
    return this.readUsageLog(projectSlug);
  }

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
    await this.updateManifestUsage(record);

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

  private static async updateManifestUsage(record: AIUsageRecord) {
    if (record.projectSlug === "unknown" || !this.isProductionStep(record.stage)) {
      return;
    }

    const usage = this.mapRecordToPackageUsage(record);

    await ProjectManager.updatePackageUsage(record.projectSlug, record.stage, usage);
  }

  private static mapRecordToPackageUsage(
    record: AIUsageRecord,
  ): ProjectPackageUsage {
    return {
      provider: record.provider,
      model: record.model,
      operation: record.operation,
      status: record.status,
      fallbackUsed: record.fallbackUsed,
      durationMs: record.durationMs,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
      totalTokens: record.totalTokens,
      estimatedCost: record.estimatedCost,
      updatedAt: record.createdAt,
    };
  }

  private static isProductionStep(value: string): value is ProductionStepKey {
    return (
      value === "research" ||
      value === "script" ||
      value === "scenes" ||
      value === "visuals" ||
      value === "animation" ||
      value === "video" ||
      value === "audio" ||
      value === "assembly" ||
      value === "thumbnail" ||
      value === "seo" ||
      value === "youtube" ||
      value === "export"
    );
  }
}
