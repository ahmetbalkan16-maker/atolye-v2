import assert from "node:assert/strict";
import { AyasGateRootIsolationError } from "../src/lib/brain/autonomy/AyasIsolatedGateRoot";

/**
 * AyasGateRootIsolationError's own declared `code` union (src/lib/brain/autonomy/AyasIsolatedGateRoot.ts) had zero direct
 * construction coverage in any scripts/smoke-*.ts file — no test ever
 * asserted that constructing this error with a given code actually
 * carries that exact code, name, and Error/subclass identity. A typo in
 * `this.code = code` or `this.name = "..."` (or a dropped code from the
 * union) would pass every existing test silently.
 */
const CODES = ["AYAS_GATE_ROOT_IS_PRODUCTION"] as const;

for (const code of CODES) {
  const error = new AyasGateRootIsolationError(code, `test message for ${code}`);
  assert.equal(error.code, code, `constructing with code "${code}" must carry that exact code`);
  assert.equal(error.name, "AyasGateRootIsolationError", "error.name must equal the class name");
  assert.ok(error instanceof Error, "must be a real Error instance");
  assert.ok(error instanceof AyasGateRootIsolationError, "must be an instance of its own class");
}

console.log(JSON.stringify({ status: "PASS", suite: "ayas-error-code-contract-ayas-gate-root-isolation", scenarios: CODES.length * 4 }));
