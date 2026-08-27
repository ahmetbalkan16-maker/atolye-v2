import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ProjectReader } from "@/lib/projects/ProjectReader";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";

/**
 * Storage primitives for the plain-pipeline (non-acceptance-marker) completed-stage
 * regeneration lineage. Deliberately a separate root (`pipeline-regeneration/`, not
 * `production-regeneration/`) from the acceptance-gated system in
 * `ProductionCompletedStageRegenerationStore.ts` — the two lineages must never share a
 * directory, since the acceptance side's durable-execution admission code
 * (`requireRegenerationExecutionAdmission`) scans `production-regeneration/` and has no
 * concept of a marker-less project; keeping the roots distinct makes the two systems
 * physically impossible to cross-read.
 */

export const pipelineRegenerationRootName = "pipeline-regeneration" as const;

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalRegenerationJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function regenerationProjectFolder(projectSlug: string, context?: RuntimeStorageContext) {
  return ProjectReader.getProjectFolder(projectSlug, context ?? {});
}

export function regenerationRoot(projectSlug: string, context?: RuntimeStorageContext) {
  return path.join(regenerationProjectFolder(projectSlug, context), pipelineRegenerationRootName);
}

export function regenerationDirectory(
  projectSlug: string,
  regenerationId: string,
  context?: RuntimeStorageContext,
) {
  return path.join(regenerationRoot(projectSlug, context), "regenerations", regenerationId);
}

export function listRegenerationIds(projectSlug: string, context?: RuntimeStorageContext) {
  const root = path.join(regenerationRoot(projectSlug, context), "regenerations");
  if (!fs.existsSync(root)) return [] as string[];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^pipeline-regen-[a-f0-9]{48}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function readRegenerationIntent(
  projectSlug: string,
  regenerationId: string,
  context?: RuntimeStorageContext,
) {
  return readJson<import("@/types/pipelineRegeneration").PipelineRegenerationIntent>(
    path.join(regenerationDirectory(projectSlug, regenerationId, context), "intent.json"));
}

export function readRegenerationPreparedReceipt(
  projectSlug: string,
  regenerationId: string,
  context?: RuntimeStorageContext,
) {
  return readJson<import("@/types/pipelineRegeneration").PipelineRegenerationPreparedReceipt>(
    path.join(regenerationDirectory(projectSlug, regenerationId, context), "prepared.json"));
}

export function isRegenerationCompleted(
  projectSlug: string,
  regenerationId: string,
  context?: RuntimeStorageContext,
) {
  return fs.existsSync(path.join(
    regenerationDirectory(projectSlug, regenerationId, context), "completed.json"));
}

export function markRegenerationCompleted(
  projectSlug: string,
  regenerationId: string,
  context: RuntimeStorageContext | undefined,
  completedAt: string,
) {
  writeJsonOnce(
    path.join(regenerationDirectory(projectSlug, regenerationId, context), "completed.json"),
    {
      schemaVersion: "pipeline-regeneration-v1",
      regenerationId,
      completedAt,
    },
  );
}

export function writeOnce(filePath: string, bytes: string | Buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(filePath, bytes, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = fs.readFileSync(filePath);
    const expected = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (!existing.equals(expected)) throw new Error("PIPELINE_REGENERATION_IMMUTABLE_CONFLICT");
  }
}

export function writeJsonOnce(filePath: string, value: unknown) {
  writeOnce(filePath, canonicalRegenerationJson(value));
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("PIPELINE_REGENERATION_JOURNAL_INVALID");
  }
}
