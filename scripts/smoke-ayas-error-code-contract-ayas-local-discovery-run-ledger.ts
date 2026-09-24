import assert from "node:assert/strict";
import { AyasLocalDiscoveryRunLedgerError } from "../src/lib/brain/autonomy/AyasLocalDiscoveryRunLedger";

/**
 * AyasLocalDiscoveryRunLedgerError's own declared `code` union (src/lib/brain/autonomy/AyasLocalDiscoveryRunLedger.ts) had zero direct
 * construction coverage in any scripts/smoke-*.ts file — no test ever
 * asserted that constructing this error with a given code actually
 * carries that exact code, name, and Error/subclass identity. A typo in
 * `this.code = code` or `this.name = "..."` (or a dropped code from the
 * union) would pass every existing test silently.
 */
const CODES = ["AYAS_DISCOVERY_LEDGER_CORRUPT", "AYAS_DISCOVERY_LEDGER_IO", "AYAS_DISCOVERY_LEDGER_INVALID"] as const;

// AYAS M19.3: compile-time exhaustiveness — if a future code is added to
// AyasLocalDiscoveryRunLedgerError's own declared union but not to CODES above, this line
// fails `tsc --noEmit` (never silently passes at runtime).
type _AyasExpectedCode = ConstructorParameters<typeof AyasLocalDiscoveryRunLedgerError>[0];
type _AyasMissingCodes = Exclude<_AyasExpectedCode, (typeof CODES)[number]>;
const _ayasExhaustiveCodesCheck: _AyasMissingCodes extends never ? true : ["AYAS: CODES is missing a declared code — regenerate this smoke test", _AyasMissingCodes] = true;
void _ayasExhaustiveCodesCheck;

for (const code of CODES) {
  const error = new AyasLocalDiscoveryRunLedgerError(code, `test message for ${code}`);
  assert.equal(error.code, code, `constructing with code "${code}" must carry that exact code`);
  assert.equal(error.name, "AyasLocalDiscoveryRunLedgerError", "error.name must equal the class name");
  assert.ok(error instanceof Error, "must be a real Error instance");
  assert.ok(error instanceof AyasLocalDiscoveryRunLedgerError, "must be an instance of its own class");
}

console.log(JSON.stringify({ status: "PASS", suite: "ayas-error-code-contract-ayas-local-discovery-run-ledger", scenarios: CODES.length * 4 }));
