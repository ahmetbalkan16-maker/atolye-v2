import crypto from "node:crypto";

import type { AyasSbomFinding, AyasSbomSummary } from "./AyasSbom";

/**
 * Stage 15G — the release provenance manifest.
 *
 * One offline record that says exactly what a build of this repository is made
 * of: the commit, the lockfile, the SBOM, the licenses, the install-time
 * scripts, what is known about advisories, the pinned models and binaries, the
 * Graphify state, the test matrix and the build output. Every part is an
 * identifier, a count, a closed state or a digest.
 *
 * It is a hash manifest, not a signature and not an approval. It vouches for
 * nothing it could not read: a part that was not checked says so, and each
 * such part is listed under `gaps`. `COMPLETE` means no gap, never "safe".
 *
 * Pure: no filesystem, no network, no clock. The collector reads the facts;
 * this module shapes, seals and compares them.
 */
export const AYAS_RELEASE_PROVENANCE_SCHEMA_VERSION = "1" as const;

export type AyasProvenanceGap =
  | "GIT_TREE_DIRTY"
  | "SBOM_BLOCKING_FINDINGS"
  | "ADVISORIES_NOT_CHECKED"
  | "ADVISORIES_NOT_CURRENT"
  | "ADVISORIES_REPORTED"
  | "ARTIFACT_IDENTITY_MISMATCH"
  | "ARTIFACTS_NOT_VERIFIED_LOCALLY"
  | "GRAPHIFY_NOT_BUILT_FROM_HEAD"
  | "GRAPHIFY_STRUCTURE_INCOMPLETE"
  | "TEST_BASELINE_ABSENT"
  | "TEST_BASELINE_NOT_BOUND_TO_HEAD"
  | "TEST_BASELINE_FAILED"
  | "BUILD_ABSENT"
  | "BUILD_NOT_BOUND_TO_HEAD";

export interface AyasAdvisoryCounts { readonly info: number; readonly low: number; readonly moderate: number; readonly high: number; readonly critical: number; readonly total: number }
export type AyasAdvisoryState =
  /** Nothing was asked. A live query sends dependency metadata to the public registry and needs the owner's authorization. */
  | { readonly state: "NOT_CHECKED"; readonly reason: string }
  /** An `npm audit` report read from a file. `current` is true only for a report the registry answered. */
  | { readonly state: "REPORT"; readonly source: "npm-offline-cache" | "npm-registry"; readonly current: boolean; readonly reportSha256: string; readonly reportedAt: string | null; readonly counts: AyasAdvisoryCounts };

export interface AyasProvenanceArtifact {
  readonly id: string;
  readonly kind: string;
  readonly role: string;
  readonly state: string;
  readonly admission: string;
  /** The recorded pin, as the lifecycle registry holds it. */
  readonly identity: Readonly<Record<string, unknown>>;
  /** What this machine holds, when it was checked. */
  readonly local: string | null;
}

export interface AyasReleaseProvenanceBody {
  readonly schemaVersion: typeof AYAS_RELEASE_PROVENANCE_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly subject: { readonly name: string; readonly version: string };
  readonly git: { readonly head: string; readonly branch: string | null; readonly treeState: "CLEAN" | "DIRTY"; readonly dirtyPaths: number };
  readonly lockfile: { readonly file: "package-lock.json"; readonly sha256: string; readonly lockfileVersion: number | null; readonly packageJsonSha256: string };
  readonly sbom: {
    readonly format: "CycloneDX"; readonly specVersion: string; readonly serialNumber: string; readonly sha256: string;
    readonly summary: AyasSbomSummary; readonly blockingFindings: readonly AyasSbomFinding[];
  };
  readonly advisories: AyasAdvisoryState;
  readonly artifacts: {
    readonly lifecycle: readonly AyasProvenanceArtifact[];
    readonly localVerification: "DONE" | "NOT_DONE";
    readonly localCodingManifest: { readonly state: "ABSENT" } | { readonly state: "PRESENT"; readonly sha256: string; readonly files: number; readonly totalBytes: number };
  };
  readonly graphify:
    | { readonly state: "ABSENT" }
    | { readonly state: "PRESENT"; readonly builtFromHead: string | null; readonly lastAnalyzedHead: string | null; readonly structural: string; readonly semantic: string; readonly nodes: number; readonly links: number; readonly anomalies: number; readonly incompleteCodeFiles: number; readonly graphSha256: string };
  readonly testMatrix: {
    readonly manifestVersion: string; readonly manifestDigest: string; readonly suites: number;
    readonly baseline: { readonly state: "ABSENT" } | { readonly state: "PRESENT"; readonly sha256: string; readonly outcome: string; readonly sourceHead: string; readonly suites: number; readonly failed: number; readonly complete: boolean };
  };
  readonly build:
    | { readonly state: "ABSENT" }
    | { readonly state: "PRESENT"; readonly buildId: string | null; readonly sha256: string; readonly files: number; readonly bytes: number; readonly stampedHead: string | null; readonly stampedLockfileSha256: string | null };
  readonly signature: { readonly state: "UNSIGNED"; readonly note: string };
}
export interface AyasReleaseProvenance extends AyasReleaseProvenanceBody {
  readonly completeness: { readonly status: "COMPLETE" | "INCOMPLETE"; readonly gaps: readonly AyasProvenanceGap[] };
  /** SHA-256 of every field above, in canonical JSON. */
  readonly manifestDigest: string;
}

/** JSON with object keys in sorted order at every depth, so the same value always gives the same bytes. */
export function canonicalAyasJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalAyasJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalAyasJson(record[key])}`).join(",")}}`;
}
const sha256 = (text: string) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const HASH = /^[a-f0-9]{64}$/;
const HEAD = /^[a-f0-9]{40}$/;

/** The counts of an `npm audit --json` report (report version 2). Null when the value is not such a report. */
export function summarizeAyasNpmAuditReport(report: unknown): AyasAdvisoryCounts | null {
  const counts = (report as { metadata?: { vulnerabilities?: Record<string, unknown> } } | null)?.metadata?.vulnerabilities;
  if (!counts || typeof counts !== "object") return null;
  const read = (key: string): number | null => { const value = counts[key]; return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; };
  const [info, low, moderate, high, critical, total] = ["info", "low", "moderate", "high", "critical", "total"].map(read);
  if (info === null || low === null || moderate === null || high === null || critical === null || total === null) return null;
  // A report whose parts do not add up to its total is not one this manifest will quote.
  if (info! + low! + moderate! + high! + critical! !== total) return null;
  return { info: info!, low: low!, moderate: moderate!, high: high!, critical: critical!, total: total! };
}

/** What stands between this record and a complete one. Each gap is something that was not read, not bound or not clean. */
export function findAyasProvenanceGaps(body: AyasReleaseProvenanceBody): AyasProvenanceGap[] {
  const gaps: AyasProvenanceGap[] = [];
  if (body.git.treeState !== "CLEAN") gaps.push("GIT_TREE_DIRTY");
  if (body.sbom.summary.blockingFindings > 0) gaps.push("SBOM_BLOCKING_FINDINGS");
  if (body.advisories.state === "NOT_CHECKED") gaps.push("ADVISORIES_NOT_CHECKED");
  else {
    if (!body.advisories.current) gaps.push("ADVISORIES_NOT_CURRENT");
    if (body.advisories.counts.total > 0) gaps.push("ADVISORIES_REPORTED");
  }
  if (body.artifacts.localVerification !== "DONE") gaps.push("ARTIFACTS_NOT_VERIFIED_LOCALLY");
  if (body.artifacts.lifecycle.some((artifact) => artifact.local === "MISMATCH")) gaps.push("ARTIFACT_IDENTITY_MISMATCH");
  if (body.graphify.state !== "PRESENT" || body.graphify.builtFromHead !== body.git.head) gaps.push("GRAPHIFY_NOT_BUILT_FROM_HEAD");
  else if (body.graphify.structural !== "CURRENT" || body.graphify.anomalies > 0) gaps.push("GRAPHIFY_STRUCTURE_INCOMPLETE");
  const baseline = body.testMatrix.baseline;
  if (baseline.state !== "PRESENT") gaps.push("TEST_BASELINE_ABSENT");
  else {
    if (baseline.sourceHead !== body.git.head) gaps.push("TEST_BASELINE_NOT_BOUND_TO_HEAD");
    if (baseline.failed > 0 || !baseline.complete || !["PASS", "PASS_WITH_KNOWN_LIMITATIONS"].includes(baseline.outcome)) gaps.push("TEST_BASELINE_FAILED");
  }
  if (body.build.state !== "PRESENT") gaps.push("BUILD_ABSENT");
  else if (body.build.stampedHead !== body.git.head || body.build.stampedLockfileSha256 !== body.lockfile.sha256) gaps.push("BUILD_NOT_BOUND_TO_HEAD");
  // Being unsigned is not a gap: signing is optional and the owner's decision. The signature state is recorded as a fact.
  return gaps;
}

export function sealAyasReleaseProvenance(body: AyasReleaseProvenanceBody): AyasReleaseProvenance {
  const gaps = findAyasProvenanceGaps(body);
  const sealed = { ...body, completeness: { status: gaps.length === 0 ? ("COMPLETE" as const) : ("INCOMPLETE" as const), gaps } };
  return { ...sealed, manifestDigest: sha256(canonicalAyasJson(sealed)) };
}

/** Whether a stored manifest is well formed and is still the bytes it was sealed as. */
export function verifyAyasReleaseProvenance(value: unknown): { readonly ok: true; readonly manifest: AyasReleaseProvenance } | { readonly ok: false; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const manifest = value as AyasReleaseProvenance | null;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return { ok: false, problems: ["NOT_AN_OBJECT"] };
  if (manifest.schemaVersion !== AYAS_RELEASE_PROVENANCE_SCHEMA_VERSION) problems.push("SCHEMA_VERSION");
  if (!HEAD.test(String(manifest.git?.head))) problems.push("GIT_HEAD");
  for (const [name, digest] of [["LOCKFILE_DIGEST", manifest.lockfile?.sha256], ["PACKAGE_JSON_DIGEST", manifest.lockfile?.packageJsonSha256], ["SBOM_DIGEST", manifest.sbom?.sha256], ["TEST_MANIFEST_DIGEST", manifest.testMatrix?.manifestDigest]] as const) {
    if (!HASH.test(String(digest))) problems.push(name);
  }
  if (!Array.isArray(manifest.completeness?.gaps) || !["COMPLETE", "INCOMPLETE"].includes(String(manifest.completeness?.status))) problems.push("COMPLETENESS");
  if (problems.length) return { ok: false, problems };
  const { manifestDigest, ...sealed } = manifest;
  if (!HASH.test(String(manifestDigest)) || sha256(canonicalAyasJson(sealed)) !== manifestDigest) problems.push("MANIFEST_DIGEST_MISMATCH");
  // The gaps are part of what was sealed, but they must also be the gaps the facts imply: a manifest edited to say
  // COMPLETE and re-hashed is still refused.
  const { completeness, ...body } = sealed;
  const implied = findAyasProvenanceGaps(body as AyasReleaseProvenanceBody);
  if (canonicalAyasJson(implied) !== canonicalAyasJson(completeness.gaps) || completeness.status !== (implied.length === 0 ? "COMPLETE" : "INCOMPLETE")) problems.push("COMPLETENESS_NOT_IMPLIED_BY_FACTS");
  return problems.length ? { ok: false, problems } : { ok: true, manifest };
}

export type AyasProvenanceDrift = "GIT_HEAD" | "TREE_STATE" | "LOCKFILE" | "PACKAGE_JSON" | "SBOM" | "ADVISORIES" | "ARTIFACTS" | "GRAPHIFY" | "TEST_MATRIX" | "TEST_BASELINE" | "BUILD";

/** What differs between a stored manifest and the facts as they are now. An empty list means nothing it records has changed. */
export function compareAyasReleaseProvenance(recorded: AyasReleaseProvenanceBody, current: AyasReleaseProvenanceBody): AyasProvenanceDrift[] {
  const drift: AyasProvenanceDrift[] = [];
  const differs = (a: unknown, b: unknown) => canonicalAyasJson(a) !== canonicalAyasJson(b);
  if (recorded.git.head !== current.git.head) drift.push("GIT_HEAD");
  if (recorded.git.treeState !== current.git.treeState) drift.push("TREE_STATE");
  if (recorded.lockfile.sha256 !== current.lockfile.sha256) drift.push("LOCKFILE");
  if (recorded.lockfile.packageJsonSha256 !== current.lockfile.packageJsonSha256) drift.push("PACKAGE_JSON");
  if (recorded.sbom.sha256 !== current.sbom.sha256) drift.push("SBOM");
  if (differs(recorded.advisories, current.advisories)) drift.push("ADVISORIES");
  if (differs(recorded.artifacts, current.artifacts)) drift.push("ARTIFACTS");
  if (differs(recorded.graphify, current.graphify)) drift.push("GRAPHIFY");
  if (recorded.testMatrix.manifestDigest !== current.testMatrix.manifestDigest) drift.push("TEST_MATRIX");
  if (differs(recorded.testMatrix.baseline, current.testMatrix.baseline)) drift.push("TEST_BASELINE");
  if (differs(recorded.build, current.build)) drift.push("BUILD");
  return drift;
}
