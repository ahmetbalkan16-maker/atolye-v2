/** Adversarial evidence controls. Additional failure or missing proof must refuse review. */
import assert from "node:assert/strict";
import { assertCf49HistoricalReview } from "./lib/AyasCf49EvidenceReview";
import { CF49_REVIEW_IDS } from "./fixtures/ayas-cf49-review";
const good = { schemaVersion: "1", fixtureVersion: "2", networkAttempts: 0,
  gateFailures: CF49_REVIEW_IDS.map(id => `IMPROVED ${id}: now passes — remove it from KNOWN_LIMITATIONS`),
  failures: [], determinism: { repeat: true, shuffled: true, west: true, east: true } };
assertCf49HistoricalReview(good, 1);
const bad = [null, {}, { ...good, schemaVersion: "99" }, { ...good, fixtureVersion: "3" },
  { ...good, networkAttempts: 1 }, { ...good, gateFailures: good.gateFailures.slice(1) },
  { ...good, gateFailures: [...good.gateFailures, "REGRESSION missing-current"] },
  { ...good, gateFailures: [...good.gateFailures, good.gateFailures[0]] },
  { ...good, failures: [{ caseId: CF49_REVIEW_IDS[0] }] },
  { ...good, determinism: {} }, { ...good, determinism: { ...good.determinism, west: false } },
  { ...good, determinism: { ...good.determinism, west: "true" } }, { ...good, failures: null }];
for (const r of bad) assert.throws(() => assertCf49HistoricalReview(r, 1), assert.AssertionError);
for (const code of [null, 0, 2]) assert.throws(() => assertCf49HistoricalReview(good, code), assert.AssertionError);
console.log(JSON.stringify({ status: "PASS", negativeControls: bad.length + 3, baseline: "PASS", noIO: true }));
