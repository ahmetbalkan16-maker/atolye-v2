import assert from "node:assert/strict";
import { CF49_REVIEW_IDS } from "../fixtures/ayas-cf49-review";

/** Reviewed status supplements the historical FAIL; it never rewrites it. */
export function assertCf49HistoricalReview(raw: unknown, exitCode: number | null): void {
  assert.ok(raw && typeof raw === "object");
  const r = raw as Record<string, unknown>;
  const expected = CF49_REVIEW_IDS.map(id => `IMPROVED ${id}: now passes — remove it from KNOWN_LIMITATIONS`);
  assert.equal(exitCode, 1, "HISTORICAL_GATE_MUST_REQUIRE_REVIEW");
  assert.equal(r.schemaVersion, "1");
  assert.equal(r.fixtureVersion, "2");
  assert.deepEqual(r.gateFailures, expected, "ONLY_EXACT_REVIEWED_IMPROVEMENTS_ALLOWED");
  assert.equal(r.networkAttempts, 0);
  assert.ok(r.determinism && Object.keys(r.determinism).length === 4);
  assert.equal(Object.values(r.determinism).every(v => v === true), true);
  assert.ok(Array.isArray(r.failures));
  for (const id of CF49_REVIEW_IDS) assert.equal(r.failures.some((f: { caseId: string }) => f.caseId === id), false, "REVIEWED_CASE_MUST_PASS");
}
