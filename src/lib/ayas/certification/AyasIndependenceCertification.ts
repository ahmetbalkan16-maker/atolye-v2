import crypto from "node:crypto";

import { canonicalAyasJson } from "../provenance/AyasReleaseProvenance";

/**
 * Stage 15H — the no-cloud independence certification.
 *
 * One offline record that says whether AYAS can keep maintaining itself with
 * cloud coding off, and exactly why not when it cannot. It decides from facts
 * that someone else read: for each fault of the canonical matrix and each link
 * of the representative maintenance task, the named scenarios of a declared
 * suite, whether that suite's pinned bytes still hold them, and whether the
 * suite passed in a baseline run of this commit.
 *
 * `LOCAL_INDEPENDENCE_READY` needs every requirement proven, a baseline bound
 * to this commit, and a local coding backend the lifecycle registry lets serve
 * autonomous coding. Anything unread, unbound or unmeasured is a gap, and one
 * gap is `LOCAL_INDEPENDENCE_DEGRADED`. There is no third result.
 *
 * The record is evidence. It approves nothing, enables nothing and registers
 * no engine: nothing in the application reads it.
 *
 * Pure: no filesystem, no network, no clock. The collector reads the facts;
 * this module shapes, judges, seals and compares them.
 */
export const AYAS_INDEPENDENCE_CERTIFICATION_SCHEMA_VERSION = "1" as const;

/** The fault matrix of the master execution order, STAGE 15H, in its order. */
export const AYAS_INDEPENDENCE_FAULTS = Object.freeze([
  "PROCESS_KILL", "REBOOT", "MODEL_DEATH", "NETWORK_LOSS", "DNS_FAILURE", "HTTP_429_500", "DISK_EXHAUSTION", "CORRUPT_STATE",
  "CLOCK_BACKWARD_FUTURE", "DUPLICATE_DAEMON", "STALE_GRAPHIFY", "GRAPHIFY_NEEDS_UPDATE", "DELAYED_OWNER", "REJECTED_PROPOSAL",
  "STALE_PROPOSAL_AFTER_NEW_HEAD", "FAILED_REGRESSION", "MEMORY_POISONING", "MALICIOUS_REPO_CONTENT", "DEPENDENCY_INSTALL_REQUEST",
  "INVALID_TOOL_SCHEMA", "EXTERNAL_AUTH_EXPIRY",
] as const);
/** The representative maintenance task: detect -> plan -> local patch -> tests -> Graphify -> proposal -> owner path -> execute -> post-verify -> recover/rollback. */
export const AYAS_MAINTENANCE_CHAIN = Object.freeze([
  "DETECT", "PLAN", "LOCAL_PATCH", "TESTS", "GRAPHIFY", "PROPOSAL", "OWNER_PATH", "EXECUTE", "POST_VERIFY", "RECOVER_ROLLBACK",
] as const);
/** What must hold besides the matrix and the chain. */
export const AYAS_INDEPENDENCE_CONDITIONS = Object.freeze(["CLOUD_CODING_OFF"] as const);

export type AyasIndependenceRequirementKind = "FAULT" | "CHAIN" | "CONDITION";
const CANONICAL: Readonly<Record<AyasIndependenceRequirementKind, readonly string[]>> = { FAULT: AYAS_INDEPENDENCE_FAULTS, CHAIN: AYAS_MAINTENANCE_CHAIN, CONDITION: AYAS_INDEPENDENCE_CONDITIONS };
const KINDS: readonly AyasIndependenceRequirementKind[] = ["FAULT", "CHAIN", "CONDITION"];

/** One named scenario of one declared suite. `marker` is a further literal the suite's script must contain (the fixture itself, when the scenario's name does not say it). */
export interface AyasIndependenceProof { readonly suite: string; readonly scenario: string; readonly marker?: string }
export interface AyasIndependenceRequirement {
  readonly kind: AyasIndependenceRequirementKind;
  readonly id: string;
  /** What AYAS does under this fault, or what this link of the chain is. */
  readonly claim: string;
  /** What the proofs do not cover. */
  readonly limit?: string;
  readonly proofs: readonly AyasIndependenceProof[];
}

export type AyasIndependencePinState = "MATCH" | "MISMATCH" | "UNREADABLE" | "NOT_DECLARED";
export type AyasIndependenceSuiteOutcome = "PASS" | "PASS_WITH_KNOWN_LIMITATIONS" | "FAIL" | "NOT_RUN" | "ABSENT";
export interface AyasIndependenceProofFact {
  readonly suite: string;
  readonly scenario: string;
  readonly marker: string | null;
  /** Every pinned file of the suite, compared with the eval manifest. */
  readonly pin: AyasIndependencePinState;
  readonly scenarioPresent: boolean;
  /** Null when the proof names no marker. */
  readonly markerPresent: boolean | null;
  /** The suite's result in the baseline report; `ABSENT` when there is no report or the report does not list it. */
  readonly outcome: AyasIndependenceSuiteOutcome;
}
export interface AyasIndependenceRequirementFact {
  readonly kind: AyasIndependenceRequirementKind;
  readonly id: string;
  readonly claim: string;
  readonly limit: string | null;
  readonly proofs: readonly AyasIndependenceProofFact[];
}
export interface AyasIndependenceCodingBackend { readonly id: string; readonly state: string; readonly admission: string; readonly mayServeAutonomousCoding: boolean }

export interface AyasIndependenceCertificationBody {
  readonly schemaVersion: typeof AYAS_INDEPENDENCE_CERTIFICATION_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly git: { readonly head: string; readonly treeState: "CLEAN" | "DIRTY"; readonly dirtyPaths: number };
  readonly evalManifest: { readonly version: string; readonly digest: string; readonly suites: number };
  readonly baseline:
    | { readonly state: "ABSENT" }
    | { readonly state: "PRESENT"; readonly sha256: string; readonly sourceHead: string; readonly manifestDigest: string; readonly outcome: string; readonly complete: boolean; readonly trials: number; readonly suites: number; readonly failed: number };
  readonly requirements: readonly AyasIndependenceRequirementFact[];
  /** Every coding model the lifecycle registry holds, and whether its serving policy lets it do autonomous coding. */
  readonly localCodingBackends: readonly AyasIndependenceCodingBackend[];
  readonly authority: "NONE";
}

export type AyasIndependenceRequirementStatus = "PROVEN" | "NOT_MEASURED" | "UNPROVEN";
export type AyasIndependenceResult = "LOCAL_INDEPENDENCE_READY" | "LOCAL_INDEPENDENCE_DEGRADED";
export interface AyasIndependenceEvaluation {
  readonly result: AyasIndependenceResult;
  /** Why the result is not READY. Empty exactly when it is. */
  readonly gaps: readonly string[];
  readonly requirements: readonly { readonly kind: AyasIndependenceRequirementKind; readonly id: string; readonly status: AyasIndependenceRequirementStatus; readonly problems: readonly string[] }[];
  readonly counts: { readonly proven: number; readonly notMeasured: number; readonly unproven: number; readonly proofs: number };
}
export interface AyasIndependenceCertification extends AyasIndependenceCertificationBody {
  readonly evaluation: AyasIndependenceEvaluation;
  /** SHA-256 of every field above, in canonical JSON. */
  readonly certificationDigest: string;
}

const sha256 = (text: string) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const HASH = /^[a-f0-9]{64}$/;
const HEAD = /^[a-f0-9]{40}$/;
const GAP_PREFIX: Readonly<Record<AyasIndependenceRequirementKind, string>> = { FAULT: "FAULT_UNPROVEN", CHAIN: "CHAIN_LINK_UNPROVEN", CONDITION: "CONDITION_UNPROVEN" };

/** A baseline can speak for this commit only when it ran this commit with this eval manifest. */
function baselineSpeaksForHead(body: AyasIndependenceCertificationBody): boolean {
  return body.baseline.state === "PRESENT" && body.baseline.sourceHead === body.git.head && body.baseline.manifestDigest === body.evalManifest.digest;
}

/**
 * What is wrong with one proof. A binding problem (the suite is not declared, its bytes are not the pinned ones, the
 * scenario or the marker is not in it) makes the requirement unproven whatever a baseline says. `NOT_MEASURED` is the
 * one problem that is only an absence: no baseline that speaks for this commit.
 */
export function findAyasIndependenceProofProblems(proof: AyasIndependenceProofFact, measured: boolean): string[] {
  const problems: string[] = [];
  // A scenario is looked for only in bytes the manifest vouches for, so an unbound suite has one problem, not three.
  if (proof.pin !== "MATCH") problems.push(proof.pin === "NOT_DECLARED" ? "SUITE_NOT_DECLARED" : proof.pin === "MISMATCH" ? "SUITE_PIN_MISMATCH" : "SUITE_UNREADABLE");
  else {
    if (proof.scenarioPresent !== true) problems.push("SCENARIO_NOT_IN_SUITE");
    if (proof.markerPresent !== null && proof.markerPresent !== true) problems.push("MARKER_NOT_IN_SUITE");
  }
  if (!measured) problems.push("NOT_MEASURED");
  // A suite that passed only with declared known limitations is not counted: the named scenario may be one of them.
  else if (proof.outcome !== "PASS") problems.push(proof.outcome === "FAIL" ? "SUITE_FAILED" : proof.outcome === "PASS_WITH_KNOWN_LIMITATIONS" ? "SUITE_HAS_KNOWN_LIMITATIONS" : "SUITE_NOT_RUN");
  return problems;
}

/** Judges the facts. The same facts always give the same evaluation; nothing here reads anything. */
export function evaluateAyasIndependence(body: AyasIndependenceCertificationBody): AyasIndependenceEvaluation {
  const gaps: string[] = [];
  if (body.git.treeState !== "CLEAN") gaps.push("GIT_TREE_DIRTY");
  if (body.baseline.state !== "PRESENT") gaps.push("BASELINE_ABSENT");
  else {
    if (body.baseline.sourceHead !== body.git.head) gaps.push("BASELINE_NOT_BOUND_TO_HEAD");
    if (body.baseline.manifestDigest !== body.evalManifest.digest) gaps.push("BASELINE_OF_ANOTHER_MANIFEST");
    if (!body.baseline.complete || body.baseline.failed > 0 || !["PASS", "PASS_WITH_KNOWN_LIMITATIONS"].includes(body.baseline.outcome) || body.baseline.trials < 1) gaps.push("BASELINE_INCOMPLETE_OR_FAILED");
  }
  const measured = baselineSpeaksForHead(body);

  // The canonical set is closed: each fault, link and condition exactly once, and nothing else.
  for (const kind of KINDS) {
    for (const id of CANONICAL[kind]) {
      const found = body.requirements.filter((requirement) => requirement.kind === kind && requirement.id === id).length;
      if (found !== 1) gaps.push(`EVIDENCE_MAP_${found === 0 ? "MISSING" : "DUPLICATE"}:${kind}:${id}`);
    }
  }
  for (const requirement of body.requirements) {
    if (!KINDS.includes(requirement.kind) || !CANONICAL[requirement.kind].includes(requirement.id)) gaps.push(`EVIDENCE_MAP_UNKNOWN:${String(requirement.kind)}:${String(requirement.id)}`);
  }

  const requirements = body.requirements.map((requirement) => {
    const problems = requirement.proofs.length === 0
      ? ["NO_PROOF_DECLARED"]
      : [...new Set(requirement.proofs.flatMap((proof) => findAyasIndependenceProofProblems(proof, measured).map((problem) => `${problem}:${proof.suite}`)))];
    const status: AyasIndependenceRequirementStatus = problems.length === 0 ? "PROVEN" : problems.every((problem) => problem.startsWith("NOT_MEASURED:")) ? "NOT_MEASURED" : "UNPROVEN";
    return { kind: requirement.kind, id: requirement.id, status, problems };
  });
  // An unmeasured requirement is already named by the baseline gap above; a broken or failed one is named here.
  for (const requirement of requirements) if (requirement.status === "UNPROVEN") gaps.push(`${GAP_PREFIX[requirement.kind] ?? "REQUIREMENT_UNPROVEN"}:${requirement.id}`);

  if (!body.localCodingBackends.some((backend) => backend.mayServeAutonomousCoding === true)) gaps.push("LOCAL_CODING_BACKEND_NOT_QUALIFIED");

  const count = (status: AyasIndependenceRequirementStatus) => requirements.filter((requirement) => requirement.status === status).length;
  // Belt and braces: READY is never reached with a requirement that is not proven, whatever the gap list says.
  const ready = gaps.length === 0 && requirements.length > 0 && requirements.every((requirement) => requirement.status === "PROVEN");
  if (!ready && gaps.length === 0) gaps.push("REQUIREMENTS_NOT_PROVEN");
  return {
    result: ready ? "LOCAL_INDEPENDENCE_READY" : "LOCAL_INDEPENDENCE_DEGRADED", gaps, requirements,
    counts: { proven: count("PROVEN"), notMeasured: count("NOT_MEASURED"), unproven: count("UNPROVEN"), proofs: body.requirements.reduce((sum, requirement) => sum + requirement.proofs.length, 0) },
  };
}

export function sealAyasIndependenceCertification(body: AyasIndependenceCertificationBody): AyasIndependenceCertification {
  const sealed = { ...body, evaluation: evaluateAyasIndependence(body) };
  return { ...sealed, certificationDigest: sha256(canonicalAyasJson(sealed)) };
}

/** Whether a stored record is well formed, is still the bytes it was sealed as, and says what its own facts imply. */
export function verifyAyasIndependenceCertification(value: unknown): { readonly ok: true; readonly certification: AyasIndependenceCertification } | { readonly ok: false; readonly problems: readonly string[] } {
  const record = value as AyasIndependenceCertification | null;
  if (!record || typeof record !== "object" || Array.isArray(record)) return { ok: false, problems: ["NOT_AN_OBJECT"] };
  const problems: string[] = [];
  if (record.schemaVersion !== AYAS_INDEPENDENCE_CERTIFICATION_SCHEMA_VERSION) problems.push("SCHEMA_VERSION");
  if (!HEAD.test(String(record.git?.head))) problems.push("GIT_HEAD");
  if (!HASH.test(String(record.evalManifest?.digest))) problems.push("EVAL_MANIFEST_DIGEST");
  if (!Array.isArray(record.requirements) || !Array.isArray(record.localCodingBackends) || !record.baseline || typeof record.baseline !== "object") problems.push("FACTS");
  if (record.authority !== "NONE") problems.push("AUTHORITY");
  if (!record.evaluation || !Array.isArray(record.evaluation.gaps) || !["LOCAL_INDEPENDENCE_READY", "LOCAL_INDEPENDENCE_DEGRADED"].includes(String(record.evaluation.result))) problems.push("EVALUATION");
  if (problems.length) return { ok: false, problems };
  const { certificationDigest, ...sealed } = record;
  if (!HASH.test(String(certificationDigest)) || sha256(canonicalAyasJson(sealed)) !== certificationDigest) problems.push("CERTIFICATION_DIGEST_MISMATCH");
  // The evaluation is part of what was sealed, but it must also be what the facts imply: a record edited to say READY
  // and re-hashed is still refused.
  const { evaluation, ...body } = sealed;
  if (canonicalAyasJson(evaluateAyasIndependence(body as AyasIndependenceCertificationBody)) !== canonicalAyasJson(evaluation)) problems.push("EVALUATION_NOT_IMPLIED_BY_FACTS");
  return problems.length ? { ok: false, problems } : { ok: true, certification: record };
}

export type AyasIndependenceDrift = "GIT_HEAD" | "TREE_STATE" | "EVAL_MANIFEST" | "BASELINE" | "REQUIREMENTS" | "LOCAL_CODING_BACKENDS" | "RESULT";

/** What differs between a stored record and the facts as they are now. An empty list means nothing it records has changed. */
export function compareAyasIndependenceCertification(recorded: AyasIndependenceCertification, current: AyasIndependenceCertification): AyasIndependenceDrift[] {
  const drift: AyasIndependenceDrift[] = [];
  const differs = (a: unknown, b: unknown) => canonicalAyasJson(a) !== canonicalAyasJson(b);
  if (recorded.git.head !== current.git.head) drift.push("GIT_HEAD");
  if (recorded.git.treeState !== current.git.treeState) drift.push("TREE_STATE");
  if (recorded.evalManifest.digest !== current.evalManifest.digest) drift.push("EVAL_MANIFEST");
  if (differs(recorded.baseline, current.baseline)) drift.push("BASELINE");
  if (differs(recorded.requirements, current.requirements)) drift.push("REQUIREMENTS");
  if (differs(recorded.localCodingBackends, current.localCodingBackends)) drift.push("LOCAL_CODING_BACKENDS");
  if (recorded.evaluation.result !== current.evaluation.result) drift.push("RESULT");
  return drift;
}
