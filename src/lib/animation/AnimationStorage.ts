import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { requireContainedStorageFile } from "@/lib/assets/storage/StoragePathSecurity";
import type { AnimationGenerationSuccess } from "./providers/AnimationProvider";
import {
  isValidAnimationDuration,
  isValidAnimationMotionFrame,
} from "./AnimationMotionPlanValidation";
import { animationMotionTypes, animationTransitionTypes } from "@/types/animation";
import type { Asset } from "@/types/asset";
import type { AnimationMotionPlanScene } from "@/types/animation";

const ROOT = process.cwd();
const SENTINEL = ".atolye-animation-storage-v1";
const SENTINEL_VALUE = "atolye-animation-motion-plan-storage-v1";
const MIME = "application/vnd.atolye.motion-plan+json";
const MAXIMUM_BYTES = 1024 * 1024;

export interface StoredAnimationMotionPlan {
  readonly filePath: string;
  readonly mimeType: typeof MIME;
  readonly byteLength: number;
}

export interface AnimationMotionPlanArtifact {
  readonly schemaVersion: "1";
  readonly artifactType: "motion-plan";
  readonly assetId: string;
  readonly sceneId: number;
  readonly sourceImageAssetId: string;
  readonly durationSeconds: number;
  readonly provider: "openai";
  readonly model: string;
  readonly generationMode: "production";
  readonly requestIdentity: string;
  readonly promptDigest: string;
  readonly motionType: AnimationGenerationSuccess["motionType"];
  readonly start: AnimationGenerationSuccess["start"];
  readonly end: AnimationGenerationSuccess["end"];
  readonly transition: AnimationGenerationSuccess["transition"];
}

export class AnimationStorage {
  static getAnimationDir(projectSlug: string) {
    return `data/projects/${safeSegment(projectSlug)}/assets/animations`;
  }

  static getMotionPlanPath(projectSlug: string, assetId: string) {
    return `${this.getAnimationDir(projectSlug)}/${safeSegment(assetId)}.json`;
  }

  static saveMotionPlan(
    projectSlug: string,
    artifact: AnimationMotionPlanArtifact,
  ): StoredAnimationMotionPlan {
    validateArtifact(artifact);
    const relativePath = this.getMotionPlanPath(projectSlug, artifact.assetId);
    const directory = resolve(this.getAnimationDir(projectSlug));
    const absolutePath = resolve(relativePath);
    const directoryExisted = fs.existsSync(directory);
    fs.mkdirSync(directory, { recursive: true });
    requireStorageSentinel(directory, !directoryExisted);
    if (fs.existsSync(absolutePath)) throw new Error("Invalid animation storage target.");
    const temporaryPath = path.join(
      directory,
      `.${artifact.assetId}.${process.pid}.${crypto.randomUUID()}.tmp`,
    );
    const data = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    if (data.byteLength <= 0 || data.byteLength > MAXIMUM_BYTES) {
      throw new Error("Invalid animation artifact.");
    }
    let descriptor: number | undefined;
    let published = false;
    try {
      descriptor = fs.openSync(temporaryPath, "wx", 0o600);
      fs.writeFileSync(descriptor, data);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      requireStorageSentinel(directory, false);
      fs.linkSync(temporaryPath, absolutePath);
      published = true;
      fs.unlinkSync(temporaryPath);
      const inspection = this.inspectStoredMotionPlan(projectSlug, relativePath);
      if (inspection.byteLength !== data.byteLength || !sameArtifact(inspection.artifact, artifact)) {
        throw new Error("Invalid animation artifact.");
      }
      return { filePath: relativePath, mimeType: MIME, byteLength: data.byteLength };
    } catch (error) {
      if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* best effort */ }
      try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
      if (published) try { fs.rmSync(absolutePath, { force: true }); } catch { /* best effort */ }
      throw error;
    }
  }

  static inspectStoredMotionPlan(projectSlug: string, filePath: string) {
    const expectedPrefix = `${this.getAnimationDir(projectSlug)}/`;
    if (!filePath.startsWith(expectedPrefix) || path.posix.basename(filePath) !== filePath.slice(expectedPrefix.length)) {
      throw new Error("Invalid animation artifact path.");
    }
    const directory = resolve(this.getAnimationDir(projectSlug));
    requireStorageSentinel(directory, false);
    const contained = requireContainedStorageFile(directory, resolve(filePath));
    if (contained.stat.size <= 0 || contained.stat.size > MAXIMUM_BYTES) {
      throw new Error("Invalid animation artifact.");
    }
    const raw = fs.readFileSync(contained.realPath, "utf8");
    const artifact = JSON.parse(raw) as unknown;
    validateArtifact(artifact);
    return { byteLength: contained.stat.size, artifact };
  }

  static motionPlanTargetExists(projectSlug: string, assetId: string) {
    const directory = resolve(this.getAnimationDir(projectSlug));
    if (!fs.existsSync(directory)) return false;
    requireStorageSentinel(directory, false);
    return fs.existsSync(resolve(this.getMotionPlanPath(projectSlug, assetId)));
  }

  static removeMotionPlanIfExists(projectSlug: string, filePath: string) {
    try {
      const expectedPrefix = `${this.getAnimationDir(projectSlug)}/`;
      if (!filePath.startsWith(expectedPrefix)) return;
      const directory = resolve(this.getAnimationDir(projectSlug));
      requireStorageSentinel(directory, false);
      const absolutePath = resolve(filePath);
      const relative = path.relative(directory, absolutePath);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return;
      if (!fs.existsSync(absolutePath)) return;
      const contained = requireContainedStorageFile(directory, absolutePath);
      fs.rmSync(contained.realPath, { force: true });
    } catch {
      // Best-effort compensation must not replace the normalized stage failure.
    }
  }
}

function requireStorageSentinel(directory: string, allowCreate: boolean) {
  const link = fs.lstatSync(directory);
  if (!link.isDirectory() || link.isSymbolicLink()) throw new Error("Invalid animation storage root.");
  const sentinel = path.join(directory, SENTINEL);
  if (!fs.existsSync(sentinel)) {
    if (!allowCreate) throw new Error("Invalid animation storage sentinel.");
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(sentinel, "wx", 0o600);
      fs.writeFileSync(descriptor, SENTINEL_VALUE, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
    } catch (error) {
      if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* best effort */ }
      if (!fs.existsSync(sentinel)) throw error;
    }
  }
  const sentinelLink = fs.lstatSync(sentinel);
  if (
    !sentinelLink.isFile() || sentinelLink.isSymbolicLink() ||
    fs.readFileSync(sentinel, "utf8") !== SENTINEL_VALUE
  ) throw new Error("Invalid animation storage sentinel.");
  requireContainedStorageFile(directory, sentinel);
}

function validateArtifact(value: unknown): asserts value is AnimationMotionPlanArtifact {
  if (!value || typeof value !== "object") throw new Error("Invalid animation artifact.");
  const artifact = value as AnimationMotionPlanArtifact & Record<string, unknown>;
  if (
    Object.keys(artifact).length !== 15 ||
    artifact.schemaVersion !== "1" || artifact.artifactType !== "motion-plan" ||
    !safeValue(artifact.assetId) || !Number.isSafeInteger(artifact.sceneId) || artifact.sceneId <= 0 ||
    !safeValue(artifact.sourceImageAssetId) || !isValidAnimationDuration(artifact.durationSeconds) ||
    artifact.provider !== "openai" || !safeValue(artifact.model) || artifact.generationMode !== "production" ||
    !/^[a-f0-9]{64}$/.test(artifact.requestIdentity) ||
    !/^[a-f0-9]{64}$/.test(artifact.promptDigest) ||
    !animationMotionTypes.includes(artifact.motionType) ||
    !animationTransitionTypes.includes(artifact.transition) ||
    !exactFrame(artifact.start) || !exactFrame(artifact.end) ||
    !isValidAnimationMotionFrame(artifact.start) || !isValidAnimationMotionFrame(artifact.end)
  ) throw new Error("Invalid animation artifact.");
}

function exactFrame(value: unknown) {
  if (!exactKeys(value, ["crop", "transform"])) return false;
  const frame = value as AnimationGenerationSuccess["start"];
  return exactKeys(frame.crop, ["x", "y", "width", "height"]) &&
    exactKeys(frame.transform, ["scale", "translateX", "translateY"]);
}

function exactKeys(value: unknown, expected: readonly string[]) {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) =>
    key !== "__proto__" && key !== "prototype" && key !== "constructor" && key === wanted[index]);
}

export function requireStoredProductionMotionPlan(
  projectSlug: string,
  asset: Asset,
  plan: AnimationMotionPlanScene,
) {
  if (
    asset.id !== plan.animationAssetId || asset.sceneId !== plan.sceneId ||
    asset.type !== "animation" || asset.status !== "generated" ||
    asset.artifactType !== "motion-plan" || asset.mimeType !== MIME ||
    asset.sourceAssetId !== plan.sourceImageAssetId || asset.prompt !== plan.animationPrompt ||
    asset.durationSeconds !== plan.durationSeconds || asset.provider !== "openai" ||
    plan.provider !== "openai" || asset.model !== plan.model ||
    asset.generationMode !== "production" || plan.generationMode !== "production" ||
    typeof asset.filePath !== "string" || asset.url !== undefined ||
    !Number.isSafeInteger(asset.byteLength) || (asset.byteLength as number) <= 0
  ) throw new Error("Invalid animation artifact binding.");
  const inspection = AnimationStorage.inspectStoredMotionPlan(projectSlug, asset.filePath);
  const stored = inspection.artifact;
  if (
    inspection.byteLength !== asset.byteLength || stored.assetId !== asset.id ||
    stored.sceneId !== plan.sceneId || stored.sourceImageAssetId !== plan.sourceImageAssetId ||
    stored.durationSeconds !== plan.durationSeconds || stored.provider !== plan.provider ||
    stored.model !== plan.model || stored.motionType !== plan.motionType ||
    stored.transition !== plan.transition ||
    stored.promptDigest !== createHash("sha256").update(plan.animationPrompt.trim()).digest("hex") ||
    JSON.stringify(stored.start) !== JSON.stringify(plan.start) ||
    JSON.stringify(stored.end) !== JSON.stringify(plan.end)
  ) throw new Error("Invalid animation artifact binding.");
  return stored;
}

function sameArtifact(left: AnimationMotionPlanArtifact, right: AnimationMotionPlanArtifact) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function safeValue(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9._:-]{1,200}$/.test(value);
}

function safeSegment(value: string) {
  if (!/^[a-zA-Z0-9-_]{1,200}$/.test(value)) throw new Error("Invalid animation storage identity.");
  return value;
}

function resolve(relativePath: string) {
  return path.resolve(ROOT, ...relativePath.split("/"));
}
