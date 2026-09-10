/**
 * Atölye Brain — Self-Healing: the Incident model + its state machine (pure).
 *
 * An incident is the durable record of "something looked wrong". The Brain
 * drives it OBSERVED → DIAGNOSED → PATCHING_SANDBOX → TESTING → VERIFIED on its
 * own (every step is read-only or sandbox-only work); the door out of VERIFIED
 * is AWAITING_APPROVAL, and only an operator `apply` takes it to APPLIED. A
 * failed patch (typecheck / lint / build / test / regression / a safety-limit
 * trip) auto-transitions to ROLLED_BACK, and a repeatedly-failing incident to
 * FAILED — never silently "fixed".
 *
 * This module is PURE: no fs, no git, no network, no clock beyond an injected
 * `now`. It builds and advances the record; `SelfHealingBrain` decides what to
 * do next, the operator CLI executes it, `BrainIncidentStore` persists it.
 */

import { stableBrainId } from "../BrainId";
import { redactBrainText } from "../BrainRedaction";

export const brainIncidentSchemaVersion = "1" as const;

export type BrainIncidentCategory =
  | "voice"
  | "stt"
  | "tts"
  | "ui"
  | "lifecycle"
  | "graphify"
  | "performance"
  | "network"
  | "storage"
  | "security"
  | "unknown";

export type BrainIncidentSeverity = "P0" | "P1" | "P2" | "P3";

export type BrainIncidentStatus =
  | "OBSERVED"
  | "DIAGNOSED"
  | "PATCHING_SANDBOX"
  | "TESTING"
  | "VERIFIED"
  | "AWAITING_APPROVAL"
  | "APPLIED"
  | "ROLLED_BACK"
  | "FAILED";

/** How the anomaly detector classified the raw signal before an incident was even opened. */
export type BrainAnomalyClassification =
  | "EXPECTED"
  | "TRANSIENT"
  | "USER_ACTION"
  | "KNOWN_BASELINE"
  | "REAL_INCIDENT"
  | "UNKNOWN";

/** Evidence item — always a short, redacted, structured note. Never a raw log dump. */
export interface BrainIncidentEvidence {
  readonly at: string;
  readonly source: string;
  readonly note: string;
  /** Numeric/enum signals only — no free text from an untrusted log. */
  readonly signals?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface BrainRootCauseHypothesis {
  readonly statement: string;
  /** 0..1. Never rounded up; "no proof" stays low. */
  readonly confidence: number;
  readonly evidence: readonly string[];
  readonly counterEvidence: readonly string[];
  readonly suspectFiles: readonly string[];
  /** Set when a previously-learned pattern matched this incident's signature. */
  readonly matchedLearnedPatternId?: string;
}

export interface BrainIncidentPatch {
  readonly patchId: string;
  readonly baseCommit: string;
  readonly changedFiles: readonly string[];
  /** Unified diff, redacted. Bounded by the safety limits. */
  readonly diff: string;
  readonly diffLines: number;
  readonly safetyLevel: "SAFE" | "REVIEW_REQUIRED" | "FORBIDDEN_AUTONOMOUS";
  readonly risk: "LOW" | "MEDIUM" | "HIGH";
  readonly rollbackPlan: string;
  readonly attempt: number;
}

export interface BrainIncidentCheck {
  readonly name: string;
  readonly kind: "typecheck" | "lint" | "build" | "unit" | "smoke" | "regression" | "graphify" | "security" | "benchmark";
  readonly status: "PASS" | "FAIL" | "SKIP" | "BASELINE_KNOWN_FAIL";
  readonly detail: string;
  readonly baseline?: boolean;
}

export interface BrainIncident {
  readonly schemaVersion: typeof brainIncidentSchemaVersion;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;

  readonly category: BrainIncidentCategory;
  readonly severity: BrainIncidentSeverity;
  readonly status: BrainIncidentStatus;
  readonly classification: BrainAnomalyClassification;

  readonly symptom: string;
  readonly evidence: readonly BrainIncidentEvidence[];

  readonly hypotheses: readonly BrainRootCauseHypothesis[];
  readonly confirmedRootCause?: string;

  readonly patch?: BrainIncidentPatch;
  readonly checks: readonly BrainIncidentCheck[];

  readonly learnedPatternId?: string;
  /** A short, operator-facing note about why the incident is where it is. */
  readonly disposition: string;
  /** Set once the incident can no longer be auto-progressed. */
  readonly needsHumanReason?: string;
}

export interface BrainIncidentInput {
  readonly category: BrainIncidentCategory;
  readonly severity: BrainIncidentSeverity;
  readonly classification: BrainAnomalyClassification;
  readonly symptom: string;
  readonly evidence?: readonly BrainIncidentEvidence[];
  readonly now: string;
  /** Optional stable seed so the same fault does not open two incidents. */
  readonly dedupeKey?: string;
}

const MAX_SYMPTOM = 400;
const MAX_EVIDENCE = 40;
const MAX_NOTE = 300;

function scrub(value: string, max: number): string {
  return redactBrainText(String(value ?? "")).text.replace(/\s+/g, " ").trim().slice(0, max);
}

function scrubEvidence(items: readonly BrainIncidentEvidence[] | undefined): BrainIncidentEvidence[] {
  return (items ?? []).slice(-MAX_EVIDENCE).map((e) => ({
    at: scrub(e.at, 40),
    source: scrub(e.source, 60),
    note: scrub(e.note, MAX_NOTE),
    ...(e.signals ? { signals: sanitizeSignals(e.signals) } : {}),
  }));
}

/** Signals may only be primitives — never a string that could carry an instruction. */
function sanitizeSignals(
  signals: Readonly<Record<string, string | number | boolean | null>>,
): Readonly<Record<string, string | number | boolean | null>> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(signals)) {
    const key = k.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);
    if (!key) continue;
    if (typeof v === "string") out[key] = scrub(v, 80);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[key] = v;
  }
  return Object.freeze(out);
}

export function buildBrainIncident(input: BrainIncidentInput): BrainIncident {
  const symptom = scrub(input.symptom, MAX_SYMPTOM) || "unspecified anomaly";
  const id = stableBrainId("sh", {
    dedupeKey: input.dedupeKey ?? symptom,
    category: input.category,
    day: input.now.slice(0, 10),
  });
  return {
    schemaVersion: brainIncidentSchemaVersion,
    id,
    createdAt: input.now,
    updatedAt: input.now,
    category: input.category,
    severity: input.severity,
    status: "OBSERVED",
    classification: input.classification,
    symptom,
    evidence: Object.freeze(scrubEvidence(input.evidence)),
    hypotheses: Object.freeze([]),
    checks: Object.freeze([]),
    disposition:
      input.classification === "REAL_INCIDENT"
        ? "Opened — a real anomaly with no known-baseline match."
        : `Opened as ${input.classification} — held for review, not auto-healed.`,
  };
}

export type BrainIncidentEvent =
  | { readonly kind: "diagnose"; readonly hypotheses: readonly BrainRootCauseHypothesis[]; readonly now: string }
  | { readonly kind: "confirm-root-cause"; readonly rootCause: string; readonly now: string }
  | { readonly kind: "sandbox-patch"; readonly patch: BrainIncidentPatch; readonly now: string }
  | { readonly kind: "checks"; readonly checks: readonly BrainIncidentCheck[]; readonly now: string }
  | { readonly kind: "verified"; readonly now: string }
  | { readonly kind: "await-approval"; readonly now: string }
  | { readonly kind: "apply"; readonly operatorId: string; readonly now: string }
  | { readonly kind: "rollback"; readonly reason: string; readonly now: string }
  | { readonly kind: "fail"; readonly reason: string; readonly now: string }
  | { readonly kind: "learned"; readonly learnedPatternId: string; readonly now: string }
  | { readonly kind: "add-evidence"; readonly evidence: readonly BrainIncidentEvidence[]; readonly now: string };

/** Legal status transitions. Missing entry ⇒ the event is refused (returns the incident unchanged + a reason). */
const ALLOWED: Readonly<Record<BrainIncidentStatus, Partial<Record<BrainIncidentEvent["kind"], BrainIncidentStatus>>>> =
  Object.freeze({
    OBSERVED: { diagnose: "DIAGNOSED", "add-evidence": "OBSERVED", fail: "FAILED" },
    DIAGNOSED: {
      "confirm-root-cause": "DIAGNOSED",
      "sandbox-patch": "PATCHING_SANDBOX",
      "add-evidence": "DIAGNOSED",
      fail: "FAILED",
    },
    PATCHING_SANDBOX: { checks: "TESTING", rollback: "ROLLED_BACK", fail: "FAILED", "add-evidence": "PATCHING_SANDBOX" },
    TESTING: {
      checks: "TESTING",
      verified: "VERIFIED",
      rollback: "ROLLED_BACK",
      "sandbox-patch": "PATCHING_SANDBOX",
      fail: "FAILED",
      "add-evidence": "TESTING",
    },
    VERIFIED: { "await-approval": "AWAITING_APPROVAL", rollback: "ROLLED_BACK", "add-evidence": "VERIFIED", learned: "VERIFIED" },
    AWAITING_APPROVAL: { apply: "APPLIED", rollback: "ROLLED_BACK", fail: "FAILED", "add-evidence": "AWAITING_APPROVAL" },
    APPLIED: { learned: "APPLIED", rollback: "ROLLED_BACK", "add-evidence": "APPLIED" },
    ROLLED_BACK: { learned: "ROLLED_BACK", "sandbox-patch": "PATCHING_SANDBOX", fail: "FAILED", "add-evidence": "ROLLED_BACK" },
    FAILED: { learned: "FAILED", "add-evidence": "FAILED" },
  });

export interface BrainIncidentTransition {
  readonly incident: BrainIncident;
  readonly changed: boolean;
  readonly refusedReason?: string;
}

export function advanceIncident(incident: BrainIncident, event: BrainIncidentEvent): BrainIncidentTransition {
  const nextStatus = ALLOWED[incident.status]?.[event.kind];
  if (!nextStatus) {
    return {
      incident,
      changed: false,
      refusedReason: `event "${event.kind}" is not allowed from status "${incident.status}"`,
    };
  }

  const base = { ...incident, status: nextStatus, updatedAt: event.now };

  switch (event.kind) {
    case "diagnose": {
      const hypotheses = [...event.hypotheses]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 8)
        .map(sanitizeHypothesis);
      return {
        incident: {
          ...base,
          hypotheses: Object.freeze(hypotheses),
          disposition: hypotheses.length
            ? `Diagnosed — top hypothesis at confidence ${hypotheses[0].confidence.toFixed(2)}.`
            : "Diagnosed — no hypothesis crossed the confidence floor.",
        },
        changed: true,
      };
    }
    case "confirm-root-cause":
      return {
        incident: { ...base, confirmedRootCause: scrub(event.rootCause, MAX_SYMPTOM), disposition: "Root cause confirmed." },
        changed: true,
      };
    case "sandbox-patch":
      return {
        incident: {
          ...base,
          patch: sanitizePatch(event.patch),
          checks: Object.freeze([]),
          disposition: `Patch attempt ${event.patch.attempt} built in the sandbox (${event.patch.safetyLevel}, risk ${event.patch.risk}).`,
        },
        changed: true,
      };
    case "checks": {
      const checks = [...incident.checks, ...event.checks.map(sanitizeCheck)].slice(-40);
      const failed = checks.filter((c) => c.status === "FAIL" && !c.baseline);
      return {
        incident: {
          ...base,
          checks: Object.freeze(checks),
          disposition: failed.length
            ? `Testing — ${failed.length} check(s) failing: ${failed.map((c) => c.name).join(", ")}.`
            : "Testing — all checks green in the sandbox.",
        },
        changed: true,
      };
    }
    case "verified":
      return { incident: { ...base, disposition: "Verified — sandbox is green; ready for operator approval." }, changed: true };
    case "await-approval":
      return { incident: { ...base, disposition: "Awaiting operator approval to apply the verified patch." }, changed: true };
    case "apply":
      return {
        incident: {
          ...base,
          disposition: `Applied to the working tree by operator ${scrub(event.operatorId, 60)} (not pushed).`,
        },
        changed: true,
      };
    case "rollback":
      return { incident: { ...base, disposition: `Rolled back: ${scrub(event.reason, MAX_NOTE)}` }, changed: true };
    case "fail":
      return {
        incident: {
          ...base,
          needsHumanReason: scrub(event.reason, MAX_NOTE),
          disposition: `Failed — needs a human: ${scrub(event.reason, MAX_NOTE)}`,
        },
        changed: true,
      };
    case "learned":
      return {
        incident: { ...base, learnedPatternId: scrub(event.learnedPatternId, 80), disposition: `${incident.disposition} (pattern learned)` },
        changed: true,
      };
    case "add-evidence": {
      const evidence = [...incident.evidence, ...scrubEvidence(event.evidence)].slice(-MAX_EVIDENCE);
      return { incident: { ...base, evidence: Object.freeze(evidence) }, changed: true };
    }
  }
}

function sanitizeHypothesis(h: BrainRootCauseHypothesis): BrainRootCauseHypothesis {
  return {
    statement: scrub(h.statement, MAX_SYMPTOM),
    confidence: clamp01(h.confidence),
    evidence: (h.evidence ?? []).slice(0, 12).map((e) => scrub(e, MAX_NOTE)),
    counterEvidence: (h.counterEvidence ?? []).slice(0, 12).map((e) => scrub(e, MAX_NOTE)),
    suspectFiles: (h.suspectFiles ?? []).slice(0, 20).map((f) => scrub(f, 200)),
    ...(h.matchedLearnedPatternId ? { matchedLearnedPatternId: scrub(h.matchedLearnedPatternId, 80) } : {}),
  };
}

function sanitizePatch(p: BrainIncidentPatch): BrainIncidentPatch {
  const diff = redactBrainText(String(p.diff ?? "")).text.slice(0, 200_000);
  return {
    patchId: scrub(p.patchId, 80),
    baseCommit: scrub(p.baseCommit, 80).replace(/[^0-9a-f]/gi, "").slice(0, 40),
    changedFiles: (p.changedFiles ?? []).slice(0, 60).map((f) => scrub(f, 200)),
    diff,
    diffLines: Math.max(0, Math.floor(p.diffLines)),
    safetyLevel: p.safetyLevel,
    risk: p.risk,
    rollbackPlan: scrub(p.rollbackPlan, MAX_NOTE),
    attempt: Math.max(1, Math.floor(p.attempt)),
  };
}

function sanitizeCheck(c: BrainIncidentCheck): BrainIncidentCheck {
  return {
    name: scrub(c.name, 80),
    kind: c.kind,
    status: c.status,
    detail: scrub(c.detail, MAX_NOTE),
    ...(c.baseline ? { baseline: true } : {}),
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

/** A short, stable signature of an incident — for dedupe + learned-pattern matching. */
export function brainIncidentSignature(incident: Pick<BrainIncident, "category" | "symptom">): string {
  const symptom = incident.symptom
    .toLowerCase()
    .replace(/[0-9]+/g, "#")
    .replace(/[^a-z#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 3)
    .slice(0, 8)
    .join(" ");
  return `${incident.category}:${symptom}`;
}

export const BRAIN_INCIDENT_TERMINAL: readonly BrainIncidentStatus[] = Object.freeze(["APPLIED", "FAILED"]);
export const BRAIN_INCIDENT_AUTONOMOUS_CEILING: BrainIncidentStatus = "AWAITING_APPROVAL";
