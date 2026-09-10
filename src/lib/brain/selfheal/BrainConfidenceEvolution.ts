/**
 * Atölye Brain — Autonomous v2: confidence evolution (pure).
 *
 * Emir §20. A learned pattern is not static. Repeated independent confirmation
 * of the same signature → same root cause → same fix raises the Brain's
 * confidence in reusing it; a later occurrence where the same fix FAILED, or
 * fresh evidence that contradicts the recorded root cause, lowers it.
 *
 * The number is derived, deterministic, and bounded — never a free-floating
 * "the Brain feels good about this".
 */

import type { BrainLearnedPattern } from "./BrainLearnedPattern";

export interface BrainPatternConfidence {
  readonly value: number; // 0..0.95
  readonly band: "low" | "moderate" | "high" | "trusted";
  readonly rationale: string;
  /** true ⇒ the Brain may reuse the fix WITHOUT re-drafting (still tests it in the sandbox). */
  readonly reuseDirectly: boolean;
}

const clamp = (n: number) => Math.min(0.95, Math.max(0.05, Math.round(n * 100) / 100));

/**
 * Derive the current confidence in a learned pattern from its confirm/fail
 * history + age + whether recent evidence contradicts it.
 */
export function evolvePatternConfidence(
  pattern: BrainLearnedPattern,
  context: { readonly contradictedByRecentEvidence?: boolean; readonly nowMs?: number } = {},
): BrainPatternConfidence {
  const confirmed = pattern.timesConfirmed;
  const failed = pattern.timesFailed;
  const total = confirmed + failed;

  // Wilson-ish lower bound feel: start at a modest prior, reward independent
  // confirmations with diminishing returns, penalise failures heavily.
  let value = 0.45;
  value += Math.min(0.4, 0.12 * Math.log2(confirmed + 1));
  value -= Math.min(0.5, 0.2 * failed);
  if (total >= 3 && failed === 0) value += 0.1; // a clean multi-hit track record

  // staleness: a pattern not seen in ~30 d loses a little (the codebase moved on)
  const updated = Date.parse(pattern.updatedAt);
  const nowMs = context.nowMs ?? Date.now();
  if (Number.isFinite(updated) && nowMs - updated > 30 * 24 * 3_600_000) value -= 0.08;

  if (context.contradictedByRecentEvidence) value -= 0.25;
  if (pattern.status === "SUPERSEDED") value -= 0.4;

  value = clamp(value);

  const band: BrainPatternConfidence["band"] =
    value >= 0.85 ? "trusted" : value >= 0.7 ? "high" : value >= 0.5 ? "moderate" : "low";

  const reuseDirectly = band === "trusted" && failed === 0 && !context.contradictedByRecentEvidence;

  const rationale = [
    `${confirmed}× confirmed / ${failed}× failed`,
    context.contradictedByRecentEvidence ? "recent evidence contradicts the recorded root cause (−)" : null,
    Number.isFinite(updated) && nowMs - updated > 30 * 24 * 3_600_000 ? "pattern is stale (>30 d) (−)" : null,
    total >= 3 && failed === 0 ? "clean multi-hit record (+)" : null,
    reuseDirectly ? "trusted — the recorded fix may be re-applied directly (still sandbox-tested)" : null,
  ]
    .filter(Boolean)
    .join("; ");

  return { value, band, rationale, reuseDirectly };
}

/**
 * Negative learning (§19): given a pattern's failed fixes, rank a set of
 * candidate fix descriptions so previously-failed approaches sink.
 */
export function rankCandidateFixes(
  candidates: readonly string[],
  pattern: BrainLearnedPattern | null,
): readonly { readonly fix: string; readonly priority: number; readonly note: string }[] {
  const failed = new Set((pattern?.failedFixes ?? []).map(normalise));
  const success = pattern?.successfulFix ? normalise(pattern.successfulFix) : null;
  return candidates
    .map((fix) => {
      const n = normalise(fix);
      if (success && overlaps(n, success)) return { fix, priority: 100, note: "matches the recorded successful fix" };
      if ([...failed].some((f) => overlaps(n, f))) return { fix, priority: 5, note: "resembles a previously-FAILED fix — deprioritised" };
      return { fix, priority: 50, note: "novel candidate" };
    })
    .sort((a, b) => b.priority - a.priority);
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function overlaps(a: string, b: string): boolean {
  const wa = new Set(a.split(" ").filter((w) => w.length > 3));
  const wb = b.split(" ").filter((w) => w.length > 3);
  if (wa.size === 0 || wb.length === 0) return false;
  const hit = wb.filter((w) => wa.has(w)).length;
  return hit / Math.max(wa.size, wb.length) >= 0.5;
}
