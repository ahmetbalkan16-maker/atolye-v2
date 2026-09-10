/**
 * Atölye Brain — Autonomous v2: the incident queue (pure).
 *
 * Emir §23. When several incidents arrive at once the Brain works them by
 * severity (P0 → P3), oldest first within a severity, and NEVER opens a
 * duplicate for a signature that already has a live incident — a flapping
 * component would otherwise flood the queue.
 */

import type { BrainIncident, BrainIncidentSeverity } from "./BrainIncident";
import { brainIncidentSignature } from "./BrainIncident";
import { BRAIN_SELFHEAL_LIMITS } from "./BrainSelfHealLimits";

const SEVERITY_RANK: Readonly<Record<BrainIncidentSeverity, number>> = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });
const LIVE_STATUSES = ["OBSERVED", "DIAGNOSED", "PATCHING_SANDBOX", "TESTING", "VERIFIED", "AWAITING_APPROVAL", "APPLIED", "MONITORING"];

export interface BrainQueueDecision {
  readonly action: "enqueue" | "dedupe" | "defer";
  readonly reason: string;
  /** For `dedupe`: the id of the live incident this one collapses into. */
  readonly mergeInto?: string;
}

/** Decide what to do with a fresh incident given the current store contents. */
export function decideQueueAdmission(fresh: BrainIncident, existing: readonly BrainIncident[]): BrainQueueDecision {
  const sig = brainIncidentSignature(fresh);
  const live = existing.filter((i) => LIVE_STATUSES.includes(i.status));

  const dup = live.find((i) => brainIncidentSignature(i) === sig || i.id === fresh.id);
  if (dup) {
    return { action: "dedupe", reason: `a live incident (${dup.id}, ${dup.status}) already covers this signature`, mergeInto: dup.id };
  }

  if (live.length >= BRAIN_SELFHEAL_LIMITS.maxConcurrentIncidents) {
    return { action: "defer", reason: `${live.length} incidents already in flight (max ${BRAIN_SELFHEAL_LIMITS.maxConcurrentIncidents}) — queued` };
  }

  return { action: "enqueue", reason: "new signature, capacity available" };
}

/** Order a set of pending incidents: severity, then oldest first, then id. */
export function orderIncidentQueue(pending: readonly BrainIncident[]): readonly BrainIncident[] {
  return [...pending].sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

/** The next incident the runner should work, or null when the queue is empty / all deferred. */
export function nextQueuedIncident(all: readonly BrainIncident[]): BrainIncident | null {
  const workable = all.filter((i) => i.status === "OBSERVED" || i.status === "DIAGNOSED" || i.status === "ROLLED_BACK");
  return orderIncidentQueue(workable)[0] ?? null;
}
