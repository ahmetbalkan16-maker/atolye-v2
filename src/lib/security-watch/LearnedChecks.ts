/**
 * Checks the security brain ("Bekçi") learned after it went live — the one place its self-improvement may write
 * (owner 2026-11-26: "kendini geliştirsin … ama gereksiz ve sisteme zararlı geliştirmeleri yapmasın").
 *
 * Rules, enforced by the protected core (`src/lib/brain/security/SecurityWatchModel.ts`, which automatic development
 * can never change):
 *   - a learned check can only ADD a finding; it never sees, removes or downgrades the core findings;
 *   - it is a pure function of the measured facts (no imports besides types, no I/O);
 *   - it must catch its own `exam` case, and must stay silent on a clean machine — otherwise the core turns it off and
 *     reports it ("gereksiz" or "yanlış alarm"), so a useless or noisy check never reaches the owner as a finding;
 *   - its ids are prefixed `ogrenilen:` by the core.
 *
 * Add a check by appending to LEARNED_SECURITY_CHECKS. Never delete a core check from here (none live here).
 */

import type { SecuritySeverity, SecurityWatchFacts } from "../brain/security/SecurityWatchModel";

export interface LearnedSecurityCheck {
  /** Short, stable, kebab-case. */
  readonly id: string;
  /** Learned checks may not raise "kritik"; that level stays with the core checks. */
  readonly severity: Exclude<SecuritySeverity, "kritik">;
  /** Turkish, one line. */
  readonly title: string;
  /** Turkish, what to do. */
  readonly advice: string;
  /** Which case or proposal taught it (for the case library). */
  readonly learnedFrom: string;
  /** Returns the evidence (never a secret value) when the problem is present, else null. */
  readonly evaluate: (facts: SecurityWatchFacts) => string | null;
  /** Facts (merged over a clean machine) on which this check must fire. */
  readonly exam: Partial<SecurityWatchFacts>;
}

export const LEARNED_SECURITY_CHECKS: readonly LearnedSecurityCheck[] = [];
