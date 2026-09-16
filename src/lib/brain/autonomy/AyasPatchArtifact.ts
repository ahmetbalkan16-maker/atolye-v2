import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { containsBrainSecret } from "../BrainRedaction";

/**
 * M17 — the canonical immutable artifact for an AI-generated (not
 * hand-embedded) self-improvement patch. Everything Package C needs to
 * apply the mutation — the exact file replacements, their precondition
 * hashes, and the validator scripts that must pass — is bound into
 * `patchHash`. A single byte of executable content changing anywhere in
 * this artifact changes `patchHash`; human approval binds to that exact
 * hash (see `AyasApprovalInboxStore`'s `patchArtifactId`/`patchHash`
 * fields), so no artifact can be silently swapped after review.
 *
 * Artifacts are frozen exactly once (`freezeAyasPatchArtifact`, a
 * create-only write) after passing sandbox validation
 * (`AyasPatchSandbox.ts`) — never before, and never mutated afterward.
 * Regenerating a candidate always produces a new `artifactId`/`patchHash`,
 * never an in-place update.
 */
export const ayasPatchArtifactSchemaVersion = "1" as const;

export interface AyasPatchArtifactReplacement {
  readonly filePath: string;
  readonly expectedHash: string | null;
  readonly content: string;
  readonly allowCreate: boolean;
}

export interface AyasPatchArtifact {
  readonly schemaVersion: typeof ayasPatchArtifactSchemaVersion;
  readonly artifactId: string;
  readonly candidateId: string;
  readonly generatorIdentity: string;
  readonly baseBranch: string;
  readonly baseHead: string;
  readonly exactFiles: readonly string[];
  readonly allowedRoots: readonly string[];
  readonly replacements: readonly AyasPatchArtifactReplacement[];
  readonly validatorScripts: readonly string[];
  readonly graphifyEvidence: readonly string[];
  readonly safetyClassification: "SAFE" | "REVIEW_REQUIRED" | "FORBIDDEN_AUTONOMOUS";
  readonly problemStatement: string;
  readonly rationale: string;
  readonly expectedUserBenefit: string;
  readonly expectedBehaviorChange: string;
  readonly unchangedBehavior: string;
  readonly risk: string;
  readonly productionImpact: string;
  readonly sandboxValidationSummary: readonly string[];
  readonly patchHash: string;
  readonly generatedAt: string;
}

export class AyasPatchArtifactError extends Error {
  constructor(readonly code:
    | "AYAS_PATCH_ARTIFACT_SECRET_LEAK"
    | "AYAS_PATCH_ARTIFACT_ALREADY_FROZEN"
    | "AYAS_PATCH_ARTIFACT_NOT_FOUND"
    | "AYAS_PATCH_ARTIFACT_CORRUPT"
    | "AYAS_PATCH_ARTIFACT_HASH_MISMATCH", message: string) {
    super(message);
    this.name = "AyasPatchArtifactError";
    this.stack = undefined;
  }
}

// Volatile — set at generation time, never part of the content being
// reviewed/executed. Excluded from `patchHash` for the exact reason
// `createdAt`/`lastUpdatedAt` were excluded from `proposalHash` (M16
// incident): identity must depend only on WHAT is proposed, never WHEN.
// `patchHash` itself is always excluded too — it is self-referential (the
// field being computed), so `loadVerified`'s recompute-from-the-full-loaded-
// object must never feed the artifact's own previously-computed hash back
// into its own input, or the check could never pass for a genuinely
// untampered artifact.
const AYAS_PATCH_HASH_VOLATILE_FIELDS = new Set(["artifactId", "generatedAt", "sandboxValidationSummary", "patchHash"]);

export function computeAyasPatchHash(input: Record<string, unknown>): string {
  const material = Object.fromEntries(Object.entries(input).filter(([key]) => !AYAS_PATCH_HASH_VOLATILE_FIELDS.has(key)));
  return crypto.createHash("sha256").update(JSON.stringify({ ...material, schemaVersion: ayasPatchArtifactSchemaVersion }), "utf8").digest("hex");
}

export interface AyasPatchArtifactStoreOptions { readonly rootDir?: string; }

export interface AyasPatchArtifactStore {
  readonly dir: string;
  /** Create-only: throws `AYAS_PATCH_ARTIFACT_ALREADY_FROZEN` if `artifactId` already exists on disk. */
  freeze(artifact: Omit<AyasPatchArtifact, "schemaVersion" | "patchHash">): AyasPatchArtifact;
  load(artifactId: string): AyasPatchArtifact;
  /** Re-derives `patchHash` from the loaded content and throws if it no longer matches — detects on-disk tampering/corruption. */
  loadVerified(artifactId: string): AyasPatchArtifact;
}

export function createAyasPatchArtifactStore(options: AyasPatchArtifactStoreOptions = {}): AyasPatchArtifactStore {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "self-improvement", "patch-artifacts"));

  const fileFor = (artifactId: string): string => path.join(dir, `${artifactId}.json`);

  return {
    dir,
    freeze(input) {
      const patchHash = computeAyasPatchHash(input);
      const artifact: AyasPatchArtifact = { ...input, schemaVersion: ayasPatchArtifactSchemaVersion, patchHash };
      const text = JSON.stringify(artifact, null, 2);
      if (containsBrainSecret(text)) throw new AyasPatchArtifactError("AYAS_PATCH_ARTIFACT_SECRET_LEAK", "patch artifact contains a secret-like value");
      fs.mkdirSync(dir, { recursive: true });
      const target = fileFor(artifact.artifactId);
      if (fs.existsSync(target)) throw new AyasPatchArtifactError("AYAS_PATCH_ARTIFACT_ALREADY_FROZEN", `artifact already frozen: ${artifact.artifactId}`);
      const tmp = path.join(dir, `.${artifact.artifactId}.${process.pid}.${crypto.randomUUID()}.tmp`);
      try {
        const fd = fs.openSync(tmp, "wx");
        try { fs.writeFileSync(fd, `${text}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, target);
      } catch (error) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* fail closed */ }
        throw error;
      }
      return artifact;
    },
    load(artifactId) {
      const target = fileFor(artifactId);
      if (!fs.existsSync(target)) throw new AyasPatchArtifactError("AYAS_PATCH_ARTIFACT_NOT_FOUND", `artifact not found: ${artifactId}`);
      let parsed: unknown;
      try { parsed = JSON.parse(fs.readFileSync(target, "utf8")); } catch (error) { throw new AyasPatchArtifactError("AYAS_PATCH_ARTIFACT_CORRUPT", error instanceof Error ? error.message : String(error)); }
      if (!parsed || typeof parsed !== "object" || (parsed as { schemaVersion?: string }).schemaVersion !== ayasPatchArtifactSchemaVersion) {
        throw new AyasPatchArtifactError("AYAS_PATCH_ARTIFACT_CORRUPT", "patch artifact has an invalid or unsupported shape");
      }
      return parsed as AyasPatchArtifact;
    },
    loadVerified(artifactId) {
      const artifact = this.load(artifactId);
      const recomputed = computeAyasPatchHash(artifact as unknown as Record<string, unknown>);
      if (recomputed !== artifact.patchHash) throw new AyasPatchArtifactError("AYAS_PATCH_ARTIFACT_HASH_MISMATCH", `patch artifact ${artifactId} failed integrity verification`);
      return artifact;
    },
  };
}
