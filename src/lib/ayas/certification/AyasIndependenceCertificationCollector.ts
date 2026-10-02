import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ayasLifecycleMayServe, type AyasLifecycleEntry } from "../lifecycle/AyasLifecycle";
import { AYAS_LIFECYCLE_REGISTRY } from "../lifecycle/AyasLifecycleRegistry";
import { isAyasEvalManifest, type AyasEvalManifest } from "../observability/AyasEvalGovernance";
import { readAyasGit } from "../provenance/AyasBuildStamp";
import {
  AYAS_INDEPENDENCE_CERTIFICATION_SCHEMA_VERSION, sealAyasIndependenceCertification,
  type AyasIndependenceCertification, type AyasIndependenceCertificationBody, type AyasIndependenceCodingBackend, type AyasIndependencePinState,
  type AyasIndependenceRequirement, type AyasIndependenceRequirementFact, type AyasIndependenceSuiteOutcome,
} from "./AyasIndependenceCertification";
import { AYAS_INDEPENDENCE_EVIDENCE } from "./AyasIndependenceEvidenceMap";

/**
 * Stage 15H — reads the facts an independence certification records.
 *
 * Read-only. It reads the eval manifest, the suite files the manifest pins, a baseline report the caller names and
 * the lifecycle registry, and asks Git two questions with fixed arguments. It runs no suite, no model and no
 * container, and contacts no network endpoint: whether a suite passed is read from the report, never observed here.
 *
 * Nothing machine-specific goes into the record: no absolute path, no user name, no environment value.
 */
export const AYAS_INDEPENDENCE_EVAL_MANIFEST_FILE = "docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15F/EVAL_MANIFEST.json";
const HEAD = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const OUTCOMES: readonly AyasIndependenceSuiteOutcome[] = ["PASS", "PASS_WITH_KNOWN_LIMITATIONS", "FAIL", "NOT_RUN"];
const sha256 = (bytes: Uint8Array | string) => crypto.createHash("sha256").update(bytes).digest("hex");

export interface AyasIndependenceBaselineReport {
  readonly sha256: string; readonly sourceHead: string; readonly manifestDigest: string; readonly outcome: string;
  readonly complete: boolean; readonly trials: number; readonly failed: number;
  readonly suites: ReadonlyMap<string, AyasIndependenceSuiteOutcome>;
}

/** Reads a report written by `scripts/ayas-eval-baseline.ts`. A report it cannot read in full is refused, never read in part. */
export function readAyasIndependenceBaselineReport(raw: Uint8Array): AyasIndependenceBaselineReport {
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(raw).toString("utf8")); } catch { throw new Error("AYAS_INDEPENDENCE_BASELINE_REPORT_INVALID"); }
  const report = parsed as { sourceHead?: unknown; manifestDigest?: unknown; outcome?: unknown; completeDeclaredBaseline?: unknown; trials?: unknown; failed?: unknown; results?: unknown } | null;
  if (!report || typeof report !== "object" || !HEAD.test(String(report.sourceHead)) || !HASH.test(String(report.manifestDigest)) || typeof report.outcome !== "string" ||
      typeof report.completeDeclaredBaseline !== "boolean" || typeof report.trials !== "number" || !Number.isSafeInteger(report.trials) || report.trials < 1 ||
      !Array.isArray(report.failed) || !Array.isArray(report.results)) throw new Error("AYAS_INDEPENDENCE_BASELINE_REPORT_INVALID");
  const suites = new Map<string, AyasIndependenceSuiteOutcome>();
  for (const result of report.results as readonly { id?: unknown; summary?: { status?: unknown } }[]) {
    const status = result?.summary?.status;
    if (typeof result?.id !== "string" || suites.has(result.id) || !OUTCOMES.includes(status as AyasIndependenceSuiteOutcome)) throw new Error("AYAS_INDEPENDENCE_BASELINE_REPORT_INVALID");
    suites.set(result.id, status as AyasIndependenceSuiteOutcome);
  }
  return { sha256: sha256(raw), sourceHead: String(report.sourceHead), manifestDigest: String(report.manifestDigest), outcome: report.outcome, complete: report.completeDeclaredBaseline, trials: report.trials, failed: report.failed.length, suites };
}

export function readAyasIndependenceEvalManifest(repoRoot: string): { readonly manifest: AyasEvalManifest; readonly digest: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(path.join(repoRoot, AYAS_INDEPENDENCE_EVAL_MANIFEST_FILE), "utf8")); } catch { throw new Error("AYAS_INDEPENDENCE_EVAL_MANIFEST_INVALID"); }
  if (!isAyasEvalManifest(parsed)) throw new Error("AYAS_INDEPENDENCE_EVAL_MANIFEST_INVALID");
  // The same digest the baseline runner records for the manifest it ran.
  return { manifest: parsed, digest: sha256(JSON.stringify(parsed)) };
}

/**
 * For each proof: is its suite declared, are the suite's pinned bytes the ones on disk, does the suite's script hold
 * the scenario by its exact name, and what did the baseline say about the suite. Reads files; asks Git nothing.
 */
export function collectAyasIndependenceRequirementFacts(
  repoRoot: string, manifest: AyasEvalManifest, evidence: readonly AyasIndependenceRequirement[], baseline: AyasIndependenceBaselineReport | null,
): AyasIndependenceRequirementFact[] {
  const suiteFacts = new Map<string, { readonly pin: AyasIndependencePinState; readonly text: string | null }>();
  const suiteFact = (id: string) => {
    const known = suiteFacts.get(id);
    if (known) return known;
    const suite = manifest.suites.find((candidate) => candidate.id === id);
    let fact: { readonly pin: AyasIndependencePinState; readonly text: string | null } = { pin: "NOT_DECLARED", text: null };
    if (suite) {
      try {
        let script: Buffer | null = null;
        let match = true;
        for (const pin of suite.pins) {
          const bytes = fs.readFileSync(path.join(repoRoot, pin.file));
          if (sha256(bytes) !== pin.sha256) match = false;
          if (pin.file === suite.script) script = bytes;
        }
        // The scenario is looked for only in bytes the manifest vouches for.
        fact = match && script ? { pin: "MATCH", text: script.toString("utf8") } : { pin: "MISMATCH", text: null };
      } catch { fact = { pin: "UNREADABLE", text: null }; }
    }
    suiteFacts.set(id, fact);
    return fact;
  };
  return evidence.map((requirement) => ({
    kind: requirement.kind, id: requirement.id, claim: requirement.claim, limit: requirement.limit ?? null,
    proofs: requirement.proofs.map((proof) => {
      const suite = suiteFact(proof.suite);
      return {
        suite: proof.suite, scenario: proof.scenario, marker: proof.marker ?? null, pin: suite.pin,
        // The name as a whole double-quoted literal: a longer name that merely contains it does not count.
        scenarioPresent: suite.text !== null && proof.scenario.length > 0 && suite.text.includes(JSON.stringify(proof.scenario)),
        markerPresent: proof.marker === undefined ? null : suite.text !== null && proof.marker.length > 0 && suite.text.includes(proof.marker),
        outcome: baseline?.suites.get(proof.suite) ?? "ABSENT",
      };
    }),
  }));
}

/** Every coding model the registry holds, with what its serving policy says about autonomous coding. */
export function collectAyasIndependenceCodingBackends(registry: readonly AyasLifecycleEntry[]): AyasIndependenceCodingBackend[] {
  return registry.filter((entry) => entry.kind === "coding-model").map((entry) => ({ id: entry.id, state: entry.state, admission: entry.admission, mayServeAutonomousCoding: ayasLifecycleMayServe(entry, "AUTONOMOUS_CODING") }));
}

export interface AyasIndependenceCollectOptions {
  readonly repoRoot: string;
  readonly now: Date;
  /** A report written by `scripts/ayas-eval-baseline.ts`. */
  readonly baselineReportFile?: string;
  /** Tests only: the evidence map and the registry default to the ones of record. */
  readonly evidence?: readonly AyasIndependenceRequirement[];
  readonly registry?: readonly AyasLifecycleEntry[];
}

export function collectAyasIndependenceCertification(options: AyasIndependenceCollectOptions): AyasIndependenceCertification {
  const { repoRoot } = options;
  const head = readAyasGit(repoRoot, ["rev-parse", "HEAD"]).trim();
  if (!HEAD.test(head)) throw new Error("AYAS_INDEPENDENCE_GIT_HEAD_UNREADABLE");
  const dirtyPaths = readAyasGit(repoRoot, ["status", "--porcelain=v1", "-z"]).split("\0").filter(Boolean).length;
  const { manifest, digest } = readAyasIndependenceEvalManifest(repoRoot);
  const baseline = options.baselineReportFile ? readAyasIndependenceBaselineReport(fs.readFileSync(path.resolve(repoRoot, options.baselineReportFile))) : null;
  const body: AyasIndependenceCertificationBody = {
    schemaVersion: AYAS_INDEPENDENCE_CERTIFICATION_SCHEMA_VERSION,
    generatedAt: options.now.toISOString(),
    git: { head, treeState: dirtyPaths === 0 ? "CLEAN" : "DIRTY", dirtyPaths },
    evalManifest: { version: manifest.version, digest, suites: manifest.suites.length },
    baseline: baseline
      ? { state: "PRESENT", sha256: baseline.sha256, sourceHead: baseline.sourceHead, manifestDigest: baseline.manifestDigest, outcome: baseline.outcome, complete: baseline.complete, trials: baseline.trials, suites: baseline.suites.size, failed: baseline.failed }
      : { state: "ABSENT" },
    requirements: collectAyasIndependenceRequirementFacts(repoRoot, manifest, options.evidence ?? AYAS_INDEPENDENCE_EVIDENCE, baseline),
    localCodingBackends: collectAyasIndependenceCodingBackends(options.registry ?? AYAS_LIFECYCLE_REGISTRY),
    authority: "NONE",
  };
  return sealAyasIndependenceCertification(body);
}
