/**
 * Atölye Brain — Self-Healing: learned-pattern model (pure).
 *
 * Emir §13. A learned pattern is the durable memory of "this class of incident
 * had this root cause and this fix worked (or these fixes failed)". The next
 * matching incident consults it BEFORE running the full diagnosis.
 *
 * A pattern is only recorded from a VERIFIED (or APPLIED) incident whose
 * regression passed. A rolled-back / failed patch is recorded as a
 * `failedFix`, never as a win.
 */

import { stableBrainId } from "../BrainId";
import { redactBrainText } from "../BrainRedaction";
import type { BrainIncident, BrainIncidentCategory } from "./BrainIncident";
import { brainIncidentSignature } from "./BrainIncident";

export const brainLearnedPatternSchemaVersion = "1" as const;

export interface BrainLearnedPattern {
  readonly schemaVersion: typeof brainLearnedPatternSchemaVersion;
  readonly id: string;
  readonly signature: string;
  readonly category: BrainIncidentCategory;
  readonly problemPattern: string;
  readonly rootCause: string;
  readonly successfulFix: string;
  readonly failedFixes: readonly string[];
  readonly affectedFiles: readonly string[];
  readonly regressionResult: string;
  readonly performanceResult: string | null;
  readonly risk: "LOW" | "MEDIUM" | "HIGH";
  readonly status: "VERIFIED" | "APPLIED" | "SUPERSEDED";
  readonly timesConfirmed: number;
  readonly timesFailed: number;
  readonly firstSeenAt: string;
  readonly updatedAt: string;
  readonly sourceIncidentIds: readonly string[];
}

const scrub = (v: string, max: number): string =>
  redactBrainText(String(v ?? "")).text.replace(/\s+/g, " ").trim().slice(0, max);

export interface BrainLearnOutcome {
  readonly successfulFix: string;
  readonly failedFixes?: readonly string[];
  readonly regressionResult: string;
  readonly performanceResult?: string | null;
  readonly risk: "LOW" | "MEDIUM" | "HIGH";
  readonly status: "VERIFIED" | "APPLIED";
  readonly now: string;
}

/** Build a fresh learned pattern from a verified incident. */
export function buildLearnedPattern(incident: BrainIncident, outcome: BrainLearnOutcome): BrainLearnedPattern {
  const signature = brainIncidentSignature(incident);
  const id = stableBrainId("shp", { signature, category: incident.category });
  return {
    schemaVersion: brainLearnedPatternSchemaVersion,
    id,
    signature,
    category: incident.category,
    problemPattern: scrub(incident.symptom, 400),
    rootCause: scrub(incident.confirmedRootCause ?? incident.hypotheses[0]?.statement ?? "unknown", 400),
    successfulFix: scrub(outcome.successfulFix, 400),
    failedFixes: (outcome.failedFixes ?? []).map((f) => scrub(f, 300)).slice(0, 10),
    affectedFiles: (incident.patch?.changedFiles ?? incident.hypotheses[0]?.suspectFiles ?? []).map((f) => scrub(f, 200)).slice(0, 20),
    regressionResult: scrub(outcome.regressionResult, 300),
    performanceResult: outcome.performanceResult ? scrub(outcome.performanceResult, 300) : null,
    risk: outcome.risk,
    status: outcome.status,
    timesConfirmed: 1,
    timesFailed: 0,
    firstSeenAt: outcome.now,
    updatedAt: outcome.now,
    sourceIncidentIds: [incident.id],
  };
}

/** Fold a new occurrence into an existing pattern (confirmed win or a later failure). */
export function reinforceLearnedPattern(
  pattern: BrainLearnedPattern,
  update: { readonly confirmed: boolean; readonly incidentId: string; readonly failedFix?: string; readonly now: string },
): BrainLearnedPattern {
  return {
    ...pattern,
    timesConfirmed: pattern.timesConfirmed + (update.confirmed ? 1 : 0),
    timesFailed: pattern.timesFailed + (update.confirmed ? 0 : 1),
    failedFixes: update.failedFix
      ? [...new Set([...pattern.failedFixes, scrub(update.failedFix, 300)])].slice(0, 10)
      : pattern.failedFixes,
    sourceIncidentIds: [...new Set([...pattern.sourceIncidentIds, update.incidentId])].slice(0, 40),
    updatedAt: update.now,
  };
}

/** Look up a pattern by incident signature. Exact match, then a loose token-overlap match. */
export function matchLearnedPattern(
  patterns: readonly BrainLearnedPattern[],
  signature: string,
): BrainLearnedPattern | null {
  const exact = patterns.find((p) => p.signature === signature && p.status !== "SUPERSEDED");
  if (exact) return exact;

  const [cat, rest = ""] = signature.split(":");
  const wanted = new Set(rest.split(" ").filter(Boolean));
  if (wanted.size === 0) return null;

  let best: { pattern: BrainLearnedPattern; overlap: number } | null = null;
  for (const p of patterns) {
    if (p.status === "SUPERSEDED") continue;
    const [pcat, prest = ""] = p.signature.split(":");
    if (pcat !== cat) continue;
    const got = new Set(prest.split(" ").filter(Boolean));
    let overlap = 0;
    for (const w of wanted) if (got.has(w)) overlap += 1;
    const ratio = overlap / Math.max(wanted.size, got.size);
    if (ratio >= 0.6 && (!best || ratio > best.overlap)) best = { pattern: p, overlap: ratio };
  }
  return best?.pattern ?? null;
}

/** A compact, operator-facing learning-card. */
export function describeLearnedPattern(p: BrainLearnedPattern): string {
  return [
    `PATTERN: ${p.problemPattern}`,
    `ROOT CAUSE: ${p.rootCause}`,
    `SUCCESSFUL FIX: ${p.successfulFix}`,
    p.failedFixes.length ? `FAILED FIXES: ${p.failedFixes.join(" | ")}` : null,
    `REGRESSION: ${p.regressionResult}`,
    p.performanceResult ? `PERFORMANCE: ${p.performanceResult}` : null,
    `STATUS: ${p.status} (confirmed ${p.timesConfirmed}× / failed ${p.timesFailed}×)`,
  ]
    .filter(Boolean)
    .join("\n");
}
