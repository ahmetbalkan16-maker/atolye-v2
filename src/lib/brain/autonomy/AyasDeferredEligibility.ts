/**
 * AYAS deferred-proposal re-eligibility (M8).
 *
 * A single, pure, zero-dependency predicate — the one place "has a deferred
 * proposal's `nextEligibleAt` passed?" is computed. Before M8, the Store
 * (`decide()`) and the read-only View (`buildAyasApprovalInboxView`) each
 * had their own notion of this, and only the View's agreed with what a
 * human/operator would expect ("this deferred proposal is actionable
 * again") — the Store's `decide()` still rejected APPROVE/REJECT for it,
 * accepting only another LATER. Both now import this exact function, so
 * they cannot independently drift again.
 *
 * Deliberately has NO dependency on the Store, the daemon, the gate, or any
 * authority-bearing module — the read-only View (which itself must stay
 * free of any Store import) can safely depend on this too.
 */

/**
 * `true` when a deferred proposal with the given `nextEligibleAt` is
 * actionable again at `now`. No `nextEligibleAt` at all means "never
 * restricted" (always eligible) — matches a `LATER` decision that, for
 * whatever reason, didn't record one. An unparseable `nextEligibleAt` fails
 * CLOSED (never eligible) — `Date.parse` returns `NaN` for an invalid
 * string, and `NaN <= x` is always `false` in JavaScript, which already
 * gives the safe answer without any special-casing.
 */
export function isAyasDeferredEligibleNow(nextEligibleAt: string | undefined, now: string): boolean {
  if (!nextEligibleAt) return true;
  return Date.parse(nextEligibleAt) <= Date.parse(now);
}
