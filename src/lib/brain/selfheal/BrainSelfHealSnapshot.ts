/**
 * Atölye Brain — Self-Healing: UI view model (pure).
 *
 * Emir §18. Folds the incident + learned-pattern records into the read-only
 * shape the Self-Healing panel renders: system health, active incidents, recent
 * repairs, optimizations, learning, last action. No secrets (records are
 * already redacted); no free text from an untrusted log reaches here.
 */

import type { BrainIncident, BrainIncidentSeverity, BrainIncidentStatus } from "./BrainIncident";
import type { BrainLearnedPattern } from "./BrainLearnedPattern";
import type { BrainBenchmarkVerdict } from "./BrainOptimizationBenchmark";

export interface BrainSelfHealIncidentView {
  readonly id: string;
  readonly category: string;
  readonly severity: BrainIncidentSeverity;
  readonly status: BrainIncidentStatus;
  readonly classification: string;
  readonly symptom: string;
  readonly rootCause: string | null;
  readonly confidence: number | null;
  readonly disposition: string;
  readonly changedFiles: readonly string[];
  readonly risk: string | null;
  readonly checksSummary: string;
  readonly updatedAt: string;
  readonly needsHuman: boolean;
}

export interface BrainSelfHealOptimizationView {
  readonly id: string;
  readonly headline: string;
  readonly verdict: BrainBenchmarkVerdict["verdict"];
  readonly at: string;
}

export interface BrainSelfHealLearningView {
  readonly id: string;
  readonly signature: string;
  readonly problem: string;
  readonly rootCause: string;
  readonly fix: string;
  readonly confirmed: number;
  readonly failed: number;
  readonly status: string;
}

/** The Brain's current live activity (emir §30). */
export type BrainSelfHealLiveState =
  | "IDLE"
  | "OBSERVING"
  | "DIAGNOSING"
  | "REPAIRING"
  | "TESTING"
  | "VERIFYING"
  | "MONITORING"
  | "HEALED"
  | "NEEDS_HUMAN";

export interface BrainSelfHealSnapshot {
  readonly health: {
    readonly state: "healthy" | "watching" | "healing" | "needs-human";
    readonly openIncidents: number;
    readonly needsHuman: number;
    readonly p0: number;
    readonly summary: string;
  };
  /** v2: the single live-status word shown on the orb / panel. */
  readonly liveState: BrainSelfHealLiveState;
  /** v2: an aggregate risk read for the operator. */
  readonly currentRisk: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  /** v2: the last confirmed root cause. */
  readonly lastRootCause: string | null;
  readonly activeIncidents: readonly BrainSelfHealIncidentView[];
  readonly recentRepairs: readonly BrainSelfHealIncidentView[];
  /** v2: incidents whose patch was rolled back (auto or manual). */
  readonly recentRollbacks: readonly BrainSelfHealIncidentView[];
  readonly optimizations: readonly BrainSelfHealOptimizationView[];
  readonly learning: readonly BrainSelfHealLearningView[];
  readonly lastAction: { readonly at: string; readonly text: string } | null;
  readonly generatedAt: string;
}

const TERMINAL: readonly BrainIncidentStatus[] = ["HEALED", "FAILED", "ROLLED_BACK", "APPLIED"];

function incidentView(i: BrainIncident): BrainSelfHealIncidentView {
  const realFail = i.checks.filter((c) => c.status === "FAIL" && !c.baseline).length;
  const pass = i.checks.filter((c) => c.status === "PASS").length;
  return {
    id: i.id,
    category: i.category,
    severity: i.severity,
    status: i.status,
    classification: i.classification,
    symptom: i.symptom,
    rootCause: i.confirmedRootCause ?? i.hypotheses[0]?.statement ?? null,
    confidence: i.hypotheses[0]?.confidence ?? null,
    disposition: i.disposition,
    changedFiles: i.patch?.changedFiles ?? [],
    risk: i.patch?.risk ?? null,
    checksSummary: i.checks.length ? `${pass} pass / ${realFail} fail` : "—",
    updatedAt: i.updatedAt,
    needsHuman: Boolean(i.needsHumanReason) || i.status === "FAILED",
  };
}

export interface BrainSelfHealSnapshotInput {
  readonly incidents: readonly BrainIncident[];
  readonly learned: readonly BrainLearnedPattern[];
  readonly optimizations?: readonly BrainSelfHealOptimizationView[];
  readonly now: string;
}

export function buildBrainSelfHealSnapshot(input: BrainSelfHealSnapshotInput): BrainSelfHealSnapshot {
  const incidents = [...input.incidents].sort((a, b) => (b.updatedAt < a.updatedAt ? -1 : b.updatedAt > a.updatedAt ? 1 : 0));
  const active = incidents.filter((i) => !TERMINAL.includes(i.status));
  const done = incidents.filter((i) => TERMINAL.includes(i.status)).slice(0, 10);

  const needsHuman = incidents.filter((i) => i.status === "FAILED" || i.needsHumanReason).length;
  const p0 = active.filter((i) => i.severity === "P0").length;

  const state: BrainSelfHealSnapshot["health"]["state"] =
    needsHuman > 0
      ? "needs-human"
      : active.some((i) => ["PATCHING_SANDBOX", "TESTING", "DIAGNOSED"].includes(i.status))
        ? "healing"
        : active.length > 0
          ? "watching"
          : "healthy";

  const summary =
    state === "healthy"
      ? "No open incidents — the Brain is watching."
      : state === "watching"
        ? `${active.length} incident(s) held for review.`
        : state === "healing"
          ? `${active.length} incident(s) in progress (sandbox / test).`
          : `${needsHuman} incident(s) need a human.`;

  const learning: BrainSelfHealLearningView[] = [...input.learned]
    .sort((a, b) => (b.updatedAt < a.updatedAt ? -1 : 1))
    .slice(0, 20)
    .map((p) => ({
      id: p.id,
      signature: p.signature,
      problem: p.problemPattern,
      rootCause: p.rootCause,
      fix: p.successfulFix,
      confirmed: p.timesConfirmed,
      failed: p.timesFailed,
      status: p.status,
    }));

  const lastChanged = incidents[0];
  const lastAction = lastChanged ? { at: lastChanged.updatedAt, text: `${lastChanged.id}: ${lastChanged.disposition}` } : null;

  // v2 — the single live-status word, from the most-progressed active incident.
  const STATUS_TO_LIVE: Record<string, BrainSelfHealLiveState> = {
    OBSERVED: "OBSERVING",
    DIAGNOSED: "DIAGNOSING",
    PATCHING_SANDBOX: "REPAIRING",
    TESTING: "TESTING",
    VERIFIED: "VERIFYING",
    AWAITING_APPROVAL: "NEEDS_HUMAN",
    APPLIED: "MONITORING",
    MONITORING: "MONITORING",
  };
  const liveState: BrainSelfHealLiveState =
    needsHuman > 0
      ? "NEEDS_HUMAN"
      : active.length === 0
        ? incidents.some((i) => i.status === "HEALED") && incidents[0]?.status === "HEALED"
          ? "HEALED"
          : "IDLE"
        : (active.map((i) => STATUS_TO_LIVE[i.status]).find(Boolean) ?? "OBSERVING");

  const risks = active.map((i) => i.patch?.risk).filter(Boolean) as string[];
  const currentRisk: BrainSelfHealSnapshot["currentRisk"] =
    needsHuman > 0 || risks.includes("HIGH")
      ? "HIGH"
      : risks.includes("MEDIUM")
        ? "MEDIUM"
        : risks.includes("LOW")
          ? "LOW"
          : "NONE";

  const rollbacks = incidents.filter((i) => i.status === "ROLLED_BACK").slice(0, 8);
  const lastRootCause = incidents.find((i) => i.confirmedRootCause)?.confirmedRootCause ?? incidents.find((i) => i.hypotheses[0])?.hypotheses[0]?.statement ?? null;

  return {
    health: { state, openIncidents: active.length, needsHuman, p0, summary },
    liveState,
    currentRisk,
    lastRootCause,
    activeIncidents: active.map(incidentView),
    recentRepairs: done.filter((i) => i.status === "HEALED" || i.status === "APPLIED" || i.status === "FAILED").map(incidentView),
    recentRollbacks: rollbacks.map(incidentView),
    optimizations: input.optimizations ?? [],
    learning,
    lastAction,
    generatedAt: input.now,
  };
}

export const EMPTY_BRAIN_SELFHEAL_SNAPSHOT: BrainSelfHealSnapshot = Object.freeze({
  health: { state: "healthy" as const, openIncidents: 0, needsHuman: 0, p0: 0, summary: "Self-healing store empty — the Brain is watching." },
  liveState: "IDLE" as const,
  currentRisk: "NONE" as const,
  lastRootCause: null,
  activeIncidents: [],
  recentRepairs: [],
  recentRollbacks: [],
  optimizations: [],
  learning: [],
  lastAction: null,
  generatedAt: "",
});
