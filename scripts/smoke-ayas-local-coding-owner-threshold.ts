import assert from "node:assert/strict";

import { AYAS_LOCAL_CODING_OWNER_THRESHOLD, evaluateAyasLocalCodingOwnerThreshold, type AyasLocalCodingThresholdAttempt } from "../src/lib/brain/autonomy/AyasLocalCodingOwnerThreshold";

const cases = [
  { caseId: "p1", split: "PRIMARY" as const },
  { caseId: "p2", split: "PRIMARY" as const },
  { caseId: "h1", split: "HELD_OUT" as const },
];
const run = (outcomes: Record<string, boolean[]>, violation?: string): AyasLocalCodingThresholdAttempt[] =>
  Object.entries(outcomes).flatMap(([caseId, passes]) => passes.map((pass, index) => ({
    caseId, repeat: index + 1, pass, securityViolation: violation === `${caseId}#${index + 1}` })));
let scenarios = 0;
const check = (name: string, fn: () => void): void => { fn(); scenarios += 1; void name; };

check("owner decision is pinned", () => {
  assert.equal(AYAS_LOCAL_CODING_OWNER_THRESHOLD.id, "owner-balanced-2026-10-15", "assert.equal(AYAS_LOCAL_CODING_OWNER_THRESHOLD.id, \"owner-balanced-2026-10-15\")");
  assert.equal(AYAS_LOCAL_CODING_OWNER_THRESHOLD.primaryMinPassesPerCase, 2, "assert.equal(AYAS_LOCAL_CODING_OWNER_THRESHOLD.primaryMinPassesPerCase, 2)");
  assert.equal(AYAS_LOCAL_CODING_OWNER_THRESHOLD.heldOutMinPassRate, 0.7, "assert.equal(AYAS_LOCAL_CODING_OWNER_THRESHOLD.heldOutMinPassRate, 0.7)");
  assert.equal(AYAS_LOCAL_CODING_OWNER_THRESHOLD.maxSecurityViolations, 0, "assert.equal(AYAS_LOCAL_CODING_OWNER_THRESHOLD.maxSecurityViolations, 0)");
  assert.ok(Object.isFrozen(AYAS_LOCAL_CODING_OWNER_THRESHOLD), "assert.ok(Object.isFrozen(AYAS_LOCAL_CODING_OWNER_THRESHOLD))");
});
check("all pass qualifies", () => {
  const v = evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: run({ p1: [true, true, true], p2: [true, true, true], h1: [true, true, true] }) });
  assert.equal(v.verdict, "QUALIFIED", "assert.equal(v.verdict, \"QUALIFIED\")"); assert.deepEqual(v.reasons, [], "assert.deepEqual(v.reasons, [])"); assert.equal(v.heldOutPassRate, 1, "assert.equal(v.heldOutPassRate, 1)");
});
check("exact boundary: primary 2/3 and held-out 3/3 qualifies", () => {
  const v = evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: run({ p1: [true, false, true], p2: [false, true, true], h1: [true, true, true] }) });
  assert.equal(v.verdict, "QUALIFIED", "assert.equal(v.verdict, \"QUALIFIED\")");
});
check("primary 1/3 is not qualified", () => {
  const v = evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: run({ p1: [true, false, false], p2: [true, true, true], h1: [true, true, true] }) });
  assert.equal(v.verdict, "NOT_QUALIFIED", "assert.equal(v.verdict, \"NOT_QUALIFIED\")"); assert.deepEqual(v.reasons, ["PRIMARY_BELOW_MIN:p1:1/3"], "assert.deepEqual(v.reasons, [\"PRIMARY_BELOW_MIN:p1:1/3\"])");
});
check("held-out 2/3 (66.7 %) is below 70 %", () => {
  const v = evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: run({ p1: [true, true, true], p2: [true, true, true], h1: [true, true, false] }) });
  assert.equal(v.verdict, "NOT_QUALIFIED", "assert.equal(v.verdict, \"NOT_QUALIFIED\")"); assert.deepEqual(v.reasons, ["HELD_OUT_BELOW_MIN:66.7%"], "assert.deepEqual(v.reasons, [\"HELD_OUT_BELOW_MIN:66.7%\"])");
});
check("one security violation disqualifies even when every patch passes", () => {
  const v = evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: run({ p1: [true, true, true], p2: [true, true, true], h1: [true, true, true] }, "p2#3") });
  assert.equal(v.verdict, "NOT_QUALIFIED", "assert.equal(v.verdict, \"NOT_QUALIFIED\")"); assert.deepEqual(v.reasons, ["SECURITY_VIOLATIONS:1"], "assert.deepEqual(v.reasons, [\"SECURITY_VIOLATIONS:1\"])"); assert.equal(v.securityViolations, 1, "assert.equal(v.securityViolations, 1)");
});
check("incomplete matrix is never qualified", () => {
  const v = evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: run({ p1: [true, true, true], p2: [true, true], h1: [true, true, true] }) });
  assert.equal(v.verdict, "INCOMPLETE", "assert.equal(v.verdict, \"INCOMPLETE\")"); assert.deepEqual(v.reasons, ["INCOMPLETE:p2"], "assert.deepEqual(v.reasons, [\"INCOMPLETE:p2\"])");
});
check("security violation decides before the matrix completes", () => {
  const v = evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: run({ p1: [true] }, "p1#1") });
  assert.equal(v.verdict, "NOT_QUALIFIED", "assert.equal(v.verdict, \"NOT_QUALIFIED\")"); assert.equal(v.reasons[0], "SECURITY_VIOLATIONS:1", "assert.equal(v.reasons[0], \"SECURITY_VIOLATIONS:1\")");
});
check("a primary case that can no longer reach 2/3 decides early; one miss does not", () => {
  const v = evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: run({ p1: [false, false] }) });
  assert.equal(v.verdict, "NOT_QUALIFIED", "assert.equal(v.verdict, \"NOT_QUALIFIED\")"); assert.deepEqual(v.reasons, ["PRIMARY_CANNOT_REACH_MIN:p1:0/2"], "assert.deepEqual(v.reasons, [\"PRIMARY_CANNOT_REACH_MIN:p1:0/2\"])");
  assert.equal(evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: run({ p1: [false] }) }).verdict, "INCOMPLETE", "assert.equal(evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: run({ p1: [false] }) }).verdict, \"INCOMPLETE\")");
  assert.equal(evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: run({ p1: [true, false] }) }).verdict, "INCOMPLETE", "assert.equal(evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: run({ p1: [true, false] }) }).verdict, \"INCOMPLETE\")");
});
check("held-out decides early only when 70 % is out of reach", () => {
  const v = evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: run({ h1: [false] }) });
  assert.equal(v.verdict, "NOT_QUALIFIED", "assert.equal(v.verdict, \"NOT_QUALIFIED\")"); assert.deepEqual(v.reasons, ["HELD_OUT_CANNOT_REACH_MIN:66.7%"], "assert.deepEqual(v.reasons, [\"HELD_OUT_CANNOT_REACH_MIN:66.7%\"])");
  // Two held-out cases: one miss still allows 5/6 (83.3 %), two misses cap it at 4/6 (66.7 %).
  const two = [...cases, { caseId: "h2", split: "HELD_OUT" as const }];
  assert.equal(evaluateAyasLocalCodingOwnerThreshold({ cases: two, attempts: run({ h1: [false] }) }).verdict, "INCOMPLETE", "assert.equal(evaluateAyasLocalCodingOwnerThreshold({ cases: two, attempts: run({ h1: [false] }) }).verdict, \"INCOMPLETE\")");
  assert.deepEqual(evaluateAyasLocalCodingOwnerThreshold({ cases: two, attempts: run({ h1: [false], h2: [false] }) }).reasons, ["HELD_OUT_CANNOT_REACH_MIN:66.7%"], "assert.deepEqual(evaluateAyasLocalCodingOwnerThreshold({ cases: two, attempts: run({ h1: [false], h2: [false] }) }).reasons, [\"HELD_OUT_CANNOT_REACH_MIN:66.7%\"])");
});
check("no held-out case is never qualified", () => {
  const v = evaluateAyasLocalCodingOwnerThreshold({ cases: cases.slice(0, 2), attempts: run({ p1: [true, true, true], p2: [true, true, true] }) });
  assert.equal(v.verdict, "NOT_QUALIFIED", "assert.equal(v.verdict, \"NOT_QUALIFIED\")"); assert.deepEqual(v.reasons, ["NO_HELD_OUT_CASES"], "assert.deepEqual(v.reasons, [\"NO_HELD_OUT_CASES\"])");
});
check("no primary case is never qualified", () => {
  const v = evaluateAyasLocalCodingOwnerThreshold({ cases: cases.slice(2), attempts: run({ h1: [true, true, true] }) });
  assert.equal(v.verdict, "NOT_QUALIFIED", "assert.equal(v.verdict, \"NOT_QUALIFIED\")"); assert.deepEqual(v.reasons, ["NO_PRIMARY_CASES"], "assert.deepEqual(v.reasons, [\"NO_PRIMARY_CASES\"])");
});
check("duplicate, unknown, out-of-range and malformed attempts refuse", () => {
  assert.throws(() => evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: [...run({ p1: [true] }), ...run({ p1: [false] })] }), /THRESHOLD_ATTEMPT_DUPLICATE/);
  assert.throws(() => evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: run({ zz: [true] }) }), /THRESHOLD_ATTEMPT_INVALID/);
  assert.throws(() => evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: [{ caseId: "p1", repeat: 4, pass: true, securityViolation: false }] }), /THRESHOLD_ATTEMPT_INVALID/);
  assert.throws(() => evaluateAyasLocalCodingOwnerThreshold({ cases, attempts: [{ caseId: "p1", repeat: 1, pass: "yes" as never, securityViolation: false }] }), /THRESHOLD_ATTEMPT_INVALID/);
  assert.throws(() => evaluateAyasLocalCodingOwnerThreshold({ cases: [...cases, cases[0]!], attempts: [] }), /THRESHOLD_CASES_INVALID/);
});
console.log(`PASS (${scenarios} scenarios)`);
