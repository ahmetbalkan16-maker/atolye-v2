import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { collectAyasGraphifyFacts } from "../developer/AyasGraphifyStateCollector";
import { evaluateAyasGraphifyState } from "../developer/AyasGraphifyState";
import { AYAS_LIFECYCLE_REGISTRY } from "../lifecycle/AyasLifecycleRegistry";
import { verifyAyasLifecycleIdentities } from "../lifecycle/AyasLifecycleVerifier";
import { AYAS_BUILD_DIR, AYAS_BUILD_STAMP_FILE, digestAyasTextFile, readAyasGit as git } from "./AyasBuildStamp";
import { buildAyasSbom, type AyasCycloneDxBom, type AyasSbomFinding } from "./AyasSbom";
import {
  AYAS_RELEASE_PROVENANCE_SCHEMA_VERSION, sealAyasReleaseProvenance, summarizeAyasNpmAuditReport,
  type AyasAdvisoryState, type AyasReleaseProvenance, type AyasReleaseProvenanceBody,
} from "./AyasReleaseProvenance";

/**
 * Stage 15G — reads the facts a release provenance manifest records.
 *
 * Read-only. It reads files in the repository, asks Git three questions with
 * fixed arguments (through `readAyasGit`), and hashes. It installs nothing, upgrades nothing, runs no
 * package script and contacts no network endpoint: an advisory report is read
 * from a file the caller names, never fetched.
 *
 * Nothing machine-specific goes into the manifest: no absolute path, no user
 * name, no environment value. Paths are repository-relative names fixed here.
 */
export const AYAS_EVAL_MANIFEST_FILE = "docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15F/EVAL_MANIFEST.json";
const LOCAL_CODING_MANIFEST = "bin/ayas-local-coding/ARTIFACT_MANIFEST.json";
/** Not build output: caches, traces and the link farm Next keeps beside it. */
const BUILD_EXCLUDED = new Set(["cache", "trace", "diagnostics", "node_modules", "dev", AYAS_BUILD_STAMP_FILE]);
const HEAD = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;

export interface AyasReleaseProvenanceCollectOptions {
  readonly repoRoot: string;
  readonly now: Date;
  /** A report written by `scripts/ayas-eval-baseline.ts`. */
  readonly baselineReportFile?: string;
  /** An `npm audit --json` report the owner produced. `npm-registry` only for one the registry answered. */
  readonly advisoryReport?: { readonly file: string; readonly source: "npm-offline-cache" | "npm-registry" };
  /** Compare each pinned model and binary with what is on this machine. */
  readonly verifyArtifacts?: boolean;
  /** With `verifyArtifacts`: hash large files too instead of comparing their size. */
  readonly deep?: boolean;
  readonly env?: NodeJS.ProcessEnv;
}
export interface AyasReleaseProvenanceCollection {
  readonly manifest: AyasReleaseProvenance;
  readonly sbom: AyasCycloneDxBom;
  /** The exact bytes whose SHA-256 the manifest records. */
  readonly sbomText: string;
  readonly findings: readonly AyasSbomFinding[];
}

const sha256 = (bytes: Uint8Array | string) => crypto.createHash("sha256").update(bytes).digest("hex");

function hashFile(file: string): string {
  const hash = crypto.createHash("sha256");
  const handle = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) { const read = fs.readSync(handle, buffer, 0, buffer.length, null); if (read === 0) break; hash.update(buffer.subarray(0, read)); }
  } finally { fs.closeSync(handle); }
  return hash.digest("hex");
}

/** The digest of a build directory: every file's relative path and SHA-256, in path order. */
export function digestAyasBuildOutput(buildDir: string): { readonly sha256: string; readonly files: number; readonly bytes: number } {
  const hash = crypto.createHash("sha256");
  let files = 0;
  let bytes = 0;
  const walk = (dir: string, relative: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (relative === "" && BUILD_EXCLUDED.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      // A link is not followed: build output is plain files, and a link could lead out of the directory.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full, name);
      else if (entry.isFile()) { files += 1; bytes += fs.statSync(full).size; hash.update(name, "utf8").update("\0").update(hashFile(full), "utf8").update("\n"); }
    }
  };
  walk(buildDir, "");
  return { sha256: hash.digest("hex"), files, bytes };
}

function readAdvisories(options: AyasReleaseProvenanceCollectOptions): AyasAdvisoryState {
  if (!options.advisoryReport) {
    return { state: "NOT_CHECKED", reason: "A live advisory query sends this project's dependency list to the public npm registry and needs the owner's explicit authorization (Stage 9). No report was supplied." };
  }
  const file = path.resolve(options.repoRoot, options.advisoryReport.file);
  const raw = fs.readFileSync(file);
  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString("utf8")); } catch { throw new Error("AYAS_PROVENANCE_ADVISORY_REPORT_INVALID"); }
  const counts = summarizeAyasNpmAuditReport(parsed);
  if (!counts) throw new Error("AYAS_PROVENANCE_ADVISORY_REPORT_INVALID");
  return { state: "REPORT", source: options.advisoryReport.source, current: options.advisoryReport.source === "npm-registry", reportSha256: sha256(raw), reportedAt: fs.statSync(file).mtime.toISOString(), counts };
}

export async function collectAyasReleaseProvenance(options: AyasReleaseProvenanceCollectOptions): Promise<AyasReleaseProvenanceCollection> {
  const { repoRoot } = options;
  const env = options.env ?? process.env;

  const head = git(repoRoot, ["rev-parse", "HEAD"]).trim();
  if (!HEAD.test(head)) throw new Error("AYAS_PROVENANCE_GIT_HEAD_UNREADABLE");
  const branchName = git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const dirtyPaths = git(repoRoot, ["status", "--porcelain=v1", "-z"]).split("\0").filter(Boolean).length;

  const packageJsonFile = digestAyasTextFile(path.join(repoRoot, "package.json"));
  const packageJson = JSON.parse(packageJsonFile.text) as { name?: unknown; version?: unknown };
  const lockFile = digestAyasTextFile(path.join(repoRoot, "package-lock.json"));
  const lockfile = JSON.parse(lockFile.text) as { lockfileVersion?: unknown };
  const lockfileDigest = lockFile.sha256;
  const built = buildAyasSbom({ lockfile, lockfileDigest });
  const sbomText = `${JSON.stringify(built.sbom, null, 2)}\n`;

  // Where an entry whose pin is not a repository path lives on this machine: the same rule as the lifecycle status view.
  const localFiles: Record<string, string> = {};
  for (const entry of AYAS_LIFECYCLE_REGISTRY) {
    if (entry.identity.type === "sha256-file" && entry.identity.locator.startsWith("env:")) {
      const value = env[entry.identity.locator.slice(4)]?.trim();
      if (value) localFiles[entry.id] = value;
    }
    if (entry.identity.type === "hf-revision") {
      const candidate = path.join(repoRoot, "bin", "ayas-local-coding", entry.identity.file);
      if (fs.existsSync(candidate)) localFiles[entry.id] = candidate;
    }
  }
  const checks = options.verifyArtifacts
    ? verifyAyasLifecycleIdentities(AYAS_LIFECYCLE_REGISTRY, {
        repoRoot, localFiles, deep: options.deep === true,
        readHistoricalSource: (revision, file) => git(repoRoot, ["show", `${revision}:${file}`]),
      })
    : [];
  const lifecycle = AYAS_LIFECYCLE_REGISTRY.map((entry) => ({
    id: entry.id, kind: entry.kind, role: entry.role, state: entry.state, admission: entry.admission,
    identity: entry.identity as unknown as Readonly<Record<string, unknown>>,
    local: checks.find((check) => check.id === entry.id)?.status ?? null,
  }));

  const localManifestFile = path.join(repoRoot, LOCAL_CODING_MANIFEST);
  let localCodingManifest: AyasReleaseProvenanceBody["artifacts"]["localCodingManifest"] = { state: "ABSENT" };
  if (fs.existsSync(localManifestFile)) {
    const raw = fs.readFileSync(localManifestFile);
    const parsed = JSON.parse(raw.toString("utf8")) as { files?: readonly { sizeBytes?: unknown }[] };
    const sizes = (Array.isArray(parsed.files) ? parsed.files : []).map((file) => (typeof file.sizeBytes === "number" && Number.isSafeInteger(file.sizeBytes) && file.sizeBytes >= 0 ? file.sizeBytes : 0));
    localCodingManifest = { state: "PRESENT", sha256: sha256(raw), files: sizes.length, totalBytes: sizes.reduce((sum, size) => sum + size, 0) };
  }

  const facts = await collectAyasGraphifyFacts({ cwd: repoRoot, env });
  const graphifyStatus = evaluateAyasGraphifyState(facts);
  const graphFile = path.join(repoRoot, ".graphify", "graph.json");
  const graphify: AyasReleaseProvenanceBody["graphify"] = typeof facts.graph === "object" && fs.existsSync(graphFile)
    ? {
        state: "PRESENT", builtFromHead: graphifyStatus.graphBuiltFromHead, lastAnalyzedHead: graphifyStatus.lastAnalyzedHead,
        structural: graphifyStatus.structuralStatus, semantic: graphifyStatus.semanticStatus, nodes: facts.graph.nodes, links: facts.graph.links,
        anomalies: facts.graph.duplicateIds + facts.graph.duplicateEdges + facts.graph.dangling + facts.graph.selfLoops,
        incompleteCodeFiles: graphifyStatus.incompleteCodeFiles.length, graphSha256: hashFile(graphFile),
      }
    : { state: "ABSENT" };

  const evalManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, AYAS_EVAL_MANIFEST_FILE), "utf8")) as { version?: unknown; suites?: readonly unknown[] };
  let baseline: AyasReleaseProvenanceBody["testMatrix"]["baseline"] = { state: "ABSENT" };
  if (options.baselineReportFile) {
    const raw = fs.readFileSync(path.resolve(repoRoot, options.baselineReportFile));
    const report = JSON.parse(raw.toString("utf8")) as { outcome?: unknown; sourceHead?: unknown; selectedSuites?: unknown; failed?: unknown; completeDeclaredBaseline?: unknown };
    if (typeof report.outcome !== "string" || !HEAD.test(String(report.sourceHead)) || !Array.isArray(report.failed) || typeof report.selectedSuites !== "number") throw new Error("AYAS_PROVENANCE_BASELINE_REPORT_INVALID");
    baseline = { state: "PRESENT", sha256: sha256(raw), outcome: report.outcome, sourceHead: String(report.sourceHead), suites: report.selectedSuites, failed: report.failed.length, complete: report.completeDeclaredBaseline === true };
  }

  const buildDir = path.join(repoRoot, AYAS_BUILD_DIR);
  let build: AyasReleaseProvenanceBody["build"] = { state: "ABSENT" };
  if (fs.existsSync(path.join(buildDir, "BUILD_ID"))) {
    const buildId = fs.readFileSync(path.join(buildDir, "BUILD_ID"), "utf8").trim();
    let stampedHead: string | null = null;
    let stampedLockfileSha256: string | null = null;
    try {
      const stamp = JSON.parse(fs.readFileSync(path.join(buildDir, AYAS_BUILD_STAMP_FILE), "utf8")) as { gitHead?: unknown; treeState?: unknown; lockfileSha256?: unknown };
      // A stamp from a dirty tree does not say which source was built.
      if (stamp.treeState === "CLEAN" && HEAD.test(String(stamp.gitHead)) && HASH.test(String(stamp.lockfileSha256))) { stampedHead = String(stamp.gitHead); stampedLockfileSha256 = String(stamp.lockfileSha256); }
    } catch { /* no stamp, or not one this build wrote: the build stays unbound */ }
    build = { state: "PRESENT", buildId: /^[A-Za-z0-9_-]{1,64}$/.test(buildId) ? buildId : null, ...digestAyasBuildOutput(buildDir), stampedHead, stampedLockfileSha256 };
  }

  const body: AyasReleaseProvenanceBody = {
    schemaVersion: AYAS_RELEASE_PROVENANCE_SCHEMA_VERSION,
    generatedAt: options.now.toISOString(),
    subject: { name: typeof packageJson.name === "string" ? packageJson.name : "unknown", version: typeof packageJson.version === "string" ? packageJson.version : "0.0.0" },
    git: { head, branch: branchName && branchName !== "HEAD" ? branchName : null, treeState: dirtyPaths === 0 ? "CLEAN" : "DIRTY", dirtyPaths },
    lockfile: { file: "package-lock.json", sha256: lockfileDigest, lockfileVersion: typeof lockfile.lockfileVersion === "number" ? lockfile.lockfileVersion : null, packageJsonSha256: packageJsonFile.sha256 },
    sbom: {
      format: "CycloneDX", specVersion: built.sbom.specVersion, serialNumber: built.sbom.serialNumber, sha256: sha256(sbomText),
      summary: built.summary, blockingFindings: built.findings.filter((finding) => finding.severity === "BLOCK"),
    },
    advisories: readAdvisories(options),
    artifacts: { lifecycle, localVerification: options.verifyArtifacts ? "DONE" : "NOT_DONE", localCodingManifest },
    graphify,
    testMatrix: { manifestVersion: String(evalManifest.version ?? "unknown"), manifestDigest: sha256(JSON.stringify(evalManifest)), suites: Array.isArray(evalManifest.suites) ? evalManifest.suites.length : 0, baseline },
    build,
    signature: { state: "UNSIGNED", note: "An offline hash manifest. Online signing is optional and is the owner's decision." },
  };
  return { manifest: sealAyasReleaseProvenance(body), sbom: built.sbom, sbomText, findings: built.findings };
}
