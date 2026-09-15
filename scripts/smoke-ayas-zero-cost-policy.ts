import assert from "node:assert/strict";
import {
  AYAS_AUTONOMOUS_MONETARY_BUDGET_USD,
  evaluateAyasZeroCost,
  parseAyasCostClass,
} from "../src/lib/ayas/policy/AyasZeroCostPolicy";

assert.equal(AYAS_AUTONOMOUS_MONETARY_BUDGET_USD, 0);
for (const value of ["local-zero-cost", "free-public"] as const) {
  assert.equal(evaluateAyasZeroCost(value).allowed, true, value);
}
for (const value of ["paid", "subscription", "metered-free-tier", "unknown-cost"] as const) {
  assert.equal(evaluateAyasZeroCost(value).allowed, false, value);
}
assert.equal(parseAyasCostClass(undefined), "unknown-cost");
assert.equal(parseAyasCostClass("free"), "unknown-cost");
console.log(JSON.stringify({ status: "PASS", suite: "ayas-zero-cost-policy", scenarios: 8 }));
