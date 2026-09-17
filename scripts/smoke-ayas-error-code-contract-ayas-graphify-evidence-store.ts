import assert from "node:assert/strict";
import { AyasGraphifyEvidenceStoreError } from "../src/lib/brain/autonomy/AyasGraphifyEvidenceStore";

/**
 * AyasGraphifyEvidenceStoreError's own declared `code` union (src/lib/brain/autonomy/AyasGraphifyEvidenceStore.ts) had zero direct
 * construction coverage in any scripts/smoke-*.ts file — no test ever
 * asserted that constructing this error with a given code actually
 * carries that exact code, name, and Error/subclass identity. A typo in
 * `this.code = code` or `this.name = "..."` (or a dropped code from the
 * union) would pass every existing test silently.
 */
const CODES = ["AYAS_GRAPHIFY_EVIDENCE_IO", "AYAS_GRAPHIFY_EVIDENCE_CORRUPT"] as const;

// AYAS M19.3: compile-time exhaustiveness — if a future code is added to
// AyasGraphifyEvidenceStoreError's own declared union but not to CODES above, this line
// fails `tsc --noEmit` (never silently passes at runtime).
type _AyasExpectedCode = ConstructorParameters<typeof AyasGraphifyEvidenceStoreError>[0];
type _AyasMissingCodes = Exclude<_AyasExpectedCode, (typeof CODES)[number]>;
const _ayasExhaustiveCodesCheck: _AyasMissingCodes extends never ? true : ["AYAS: CODES is missing a declared code — regenerate this smoke test", _AyasMissingCodes] = true;
void _ayasExhaustiveCodesCheck;

for (const code of CODES) {
  const error = new AyasGraphifyEvidenceStoreError(code, `test message for ${code}`);
  assert.equal(error.code, code, `constructing with code "${code}" must carry that exact code`);
  assert.equal(error.name, "AyasGraphifyEvidenceStoreError", "error.name must equal the class name");
  assert.ok(error instanceof Error, "must be a real Error instance");
  assert.ok(error instanceof AyasGraphifyEvidenceStoreError, "must be an instance of its own class");
}

console.log(JSON.stringify({ status: "PASS", suite: "ayas-error-code-contract-ayas-graphify-evidence-store", scenarios: CODES.length * 4 }));
