import crypto from "node:crypto";

/** A reviewed strategy pins one exact replacement, never a file-wide SAFE exception. */
export interface AyasReviewedExactPatch {
  readonly effectClass: "READ_SIDE_DERIVATION";
  readonly operationType: "REPLACE_EXISTING_SOURCE";
  readonly exactFiles: readonly [string];
  readonly beforeSha256: string;
  readonly afterSha256: string;
  readonly normalizedDiffSha256: string;
  readonly changedLines: number;
  readonly effects: AyasExactPatchEffects;
}

export interface AyasExactPatchEffects {
  readonly persistentWrite: false;
  readonly externalIo: false;
  readonly network: false;
  readonly dependency: false;
  readonly provider: false;
  readonly spend: false;
  readonly publish: false;
  readonly ownerAuthority: false;
  readonly securityAuthority: false;
}

export interface AyasExactPatchHunk {
  readonly beforeLine: number;
  readonly removed: readonly string[];
  readonly added: readonly string[];
}

export interface AyasExactPatchDiff {
  readonly hunks: readonly AyasExactPatchHunk[];
  readonly changedLines: number;
  readonly sha256: string;
}

export const ayasExactPatchSha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const HEX64 = /^[0-9a-f]{64}$/;
const HEAD = /^[0-9a-f]{40}$/;
const EFFECT_KEYS = ["persistentWrite", "externalIo", "network", "dependency", "provider", "spend", "publish", "ownerAuthority", "securityAuthority"] as const;
const FORBIDDEN_ADDED_CODE = /\b(?:import|require|fetch|XMLHttpRequest|WebSocket|writeFile|appendFile|rmSync|unlink|execFile|spawn|eval|Function|localStorage|indexedDB|process\.env|child_process)\b/;

/** Bounded LCS; the hunk format and digest are independent of Git line endings. */
export function diffAyasExactPatch(before: string, after: string): AyasExactPatchDiff | null {
  if (before.length > 400_000 || after.length > 400_000) return null;
  const oldLines = before.replace(/\r\n/g, "\n").split("\n");
  const newLines = after.replace(/\r\n/g, "\n").split("\n");
  const n = oldLines.length; const m = newLines.length;
  if (n * m > 4_000_000 || n > 65_000 || m > 65_000) return null;
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    table[i * width + j] = oldLines[i] === newLines[j]
      ? 1 + table[(i + 1) * width + j + 1]!
      : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
  }
  const hunks: AyasExactPatchHunk[] = [];
  let i = 0; let j = 0; let active: { beforeLine: number; removed: string[]; added: string[] } | null = null;
  const flush = () => { if (active) { hunks.push(active); active = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && oldLines[i] === newLines[j]) { flush(); i++; j++; continue; }
    active ??= { beforeLine: i + 1, removed: [], added: [] };
    if (j < m && (i === n || table[i * width + j + 1]! >= table[(i + 1) * width + j]!)) active.added.push(newLines[j++]!);
    else if (i < n) active.removed.push(oldLines[i++]!);
  }
  flush();
  const changedLines = hunks.reduce((sum, hunk) => sum + hunk.removed.length + hunk.added.length, 0);
  return { hunks, changedLines, sha256: ayasExactPatchSha256(JSON.stringify(hunks)) };
}

export function validAyasReviewedExactPatch(value: unknown): value is AyasReviewedExactPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<AyasReviewedExactPatch>;
  const effects = item.effects as unknown as Record<string, unknown> | undefined;
  return Object.keys(item).sort().join("|") === ["afterSha256", "beforeSha256", "changedLines", "effectClass", "effects", "exactFiles", "normalizedDiffSha256", "operationType"].sort().join("|")
    && item.effectClass === "READ_SIDE_DERIVATION" && item.operationType === "REPLACE_EXISTING_SOURCE"
    && Array.isArray(item.exactFiles) && item.exactFiles.length === 1 && /^src\/[A-Za-z0-9_./-]+\.ts$/.test(item.exactFiles[0] ?? "")
    && !item.exactFiles[0]?.includes("..") && HEX64.test(item.beforeSha256 ?? "") && HEX64.test(item.afterSha256 ?? "")
    && item.beforeSha256 !== item.afterSha256 && HEX64.test(item.normalizedDiffSha256 ?? "")
    && Number.isSafeInteger(item.changedLines) && item.changedLines! > 0 && item.changedLines! <= 80
    && Boolean(effects) && Object.keys(effects!).sort().join("|") === [...EFFECT_KEYS].sort().join("|")
    && EFFECT_KEYS.every((key) => effects![key] === false);
}

/** Exact content and changed code must match the owner-reviewed manifest. */
export function verifyAyasReviewedExactPatch(manifest: AyasReviewedExactPatch | undefined, file: string, before: string, after: string): AyasExactPatchDiff | null {
  if (!validAyasReviewedExactPatch(manifest) || manifest.exactFiles[0] !== file
    || ayasExactPatchSha256(before) !== manifest.beforeSha256 || ayasExactPatchSha256(after) !== manifest.afterSha256) return null;
  const diff = diffAyasExactPatch(before, after);
  if (!diff || diff.changedLines !== manifest.changedLines || diff.sha256 !== manifest.normalizedDiffSha256
    || diff.hunks.some((hunk) => hunk.added.some((line) => FORBIDDEN_ADDED_CODE.test(line)))) return null;
  return diff;
}

export interface AyasExactPatchSafetyProof {
  readonly schemaVersion: "1";
  readonly baseHead: string;
  readonly exactFiles: readonly [string];
  readonly strategyId: string;
  readonly strategyVersion: number;
  readonly registryDigest: string;
  readonly experimentId: string;
  readonly evidenceHash: string;
  readonly beforeSha256: string;
  readonly afterSha256: string;
  readonly normalizedDiffSha256: string;
  readonly changedLines: number;
  readonly hunks: readonly AyasExactPatchHunk[];
  readonly effectClass: "READ_SIDE_DERIVATION";
  readonly operationType: "REPLACE_EXISTING_SOURCE";
  readonly effects: AyasExactPatchEffects;
  readonly digest: string;
}

export function createAyasExactPatchSafetyProof(input: {
  readonly manifest: AyasReviewedExactPatch; readonly file: string; readonly before: string; readonly after: string;
  readonly baseHead: string; readonly strategyId: string; readonly strategyVersion: number;
  readonly registryDigest: string; readonly experimentId: string; readonly evidenceHash: string;
}): AyasExactPatchSafetyProof | null {
  const diff = verifyAyasReviewedExactPatch(input.manifest, input.file, input.before, input.after);
  if (!diff || !HEAD.test(input.baseHead) || !HEX64.test(input.registryDigest) || !HEX64.test(input.evidenceHash)
    || !/^ayas-experiment-[0-9a-f-]{36}$/.test(input.experimentId) || !/^exp-[a-z0-9-]+$/.test(input.strategyId)
    || !Number.isSafeInteger(input.strategyVersion) || input.strategyVersion < 1) return null;
  const material = {
    schemaVersion: "1" as const, baseHead: input.baseHead, exactFiles: [input.file] as const,
    strategyId: input.strategyId, strategyVersion: input.strategyVersion, registryDigest: input.registryDigest,
    experimentId: input.experimentId, evidenceHash: input.evidenceHash,
    beforeSha256: input.manifest.beforeSha256, afterSha256: input.manifest.afterSha256,
    normalizedDiffSha256: diff.sha256, changedLines: diff.changedLines, hunks: diff.hunks,
    effectClass: input.manifest.effectClass, operationType: input.manifest.operationType, effects: input.manifest.effects,
  };
  return { ...material, digest: ayasExactPatchSha256(JSON.stringify(material)) };
}

export function verifyAyasExactPatchSafetyProof(proof: AyasExactPatchSafetyProof | undefined, manifest: AyasReviewedExactPatch | undefined,
  expected: { readonly baseHead: string; readonly exactFiles: readonly string[]; readonly registryDigest: string; readonly strategyId: string; readonly strategyVersion: number; readonly experimentId?: string; readonly evidenceHash?: string }): boolean {
  if (!proof || !validAyasReviewedExactPatch(manifest) || proof.schemaVersion !== "1" || !HEAD.test(proof.baseHead)
    || proof.baseHead !== expected.baseHead || !HEX64.test(proof.digest)
    || !/^ayas-experiment-[0-9a-f-]{36}$/.test(proof.experimentId) || !HEX64.test(proof.evidenceHash)
    || proof.strategyId !== expected.strategyId || proof.strategyVersion !== expected.strategyVersion
    || JSON.stringify(proof.exactFiles) !== JSON.stringify(expected.exactFiles)
    || JSON.stringify(proof.exactFiles) !== JSON.stringify(manifest.exactFiles)
    || proof.registryDigest !== expected.registryDigest || (expected.experimentId !== undefined && proof.experimentId !== expected.experimentId)
    || (expected.evidenceHash !== undefined && proof.evidenceHash !== expected.evidenceHash)
    || proof.beforeSha256 !== manifest.beforeSha256 || proof.afterSha256 !== manifest.afterSha256
    || proof.normalizedDiffSha256 !== manifest.normalizedDiffSha256 || proof.changedLines !== manifest.changedLines
    || proof.effectClass !== manifest.effectClass || proof.operationType !== manifest.operationType
    || JSON.stringify(proof.effects) !== JSON.stringify(manifest.effects)
    || !Array.isArray(proof.hunks) || proof.hunks.some((hunk) => !hunk || !Number.isSafeInteger(hunk.beforeLine)
      || !Array.isArray(hunk.removed) || !Array.isArray(hunk.added))
    || ayasExactPatchSha256(JSON.stringify(proof.hunks)) !== proof.normalizedDiffSha256
    || proof.hunks.reduce((sum, hunk) => sum + hunk.removed.length + hunk.added.length, 0) !== proof.changedLines
    || proof.hunks.some((hunk) => hunk.added.some((line: string) => FORBIDDEN_ADDED_CODE.test(line)))) return false;
  const { digest, ...material } = proof;
  return Object.keys(proof).length === 17 && ayasExactPatchSha256(JSON.stringify(material)) === digest;
}

/** Recompute the actual bytes and hunks after a bounded write; never trust the mutation callback's report. */
export function verifyAyasExecutedExactPatch(proof: AyasExactPatchSafetyProof | undefined,
  manifest: AyasReviewedExactPatch | undefined, file: string, before: string, actual: string): boolean {
  return Boolean(proof && manifest && ayasExactPatchSha256(actual) === proof.afterSha256
    && verifyAyasExactPatchSafetyProof(proof, manifest, {
      baseHead: proof.baseHead, exactFiles: [file], registryDigest: proof.registryDigest,
      strategyId: proof.strategyId, strategyVersion: proof.strategyVersion,
    }) && verifyAyasReviewedExactPatch(manifest, file, before, actual));
}
