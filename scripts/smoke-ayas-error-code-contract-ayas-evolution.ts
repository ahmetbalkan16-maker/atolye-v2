import assert from "node:assert/strict";
import { AyasEvolutionError } from "../src/lib/ayas/evolution/AyasEvolutionOpportunity";

/**
 * AyasEvolutionError's own declared `code` union (src/lib/ayas/evolution/AyasEvolutionOpportunity.ts) had zero direct
 * construction coverage in any scripts/smoke-*.ts file — no test ever
 * asserted that constructing this error with a given code actually
 * carries that exact code, name, and Error/subclass identity. A typo in
 * `this.code = code` or `this.name = "..."` (or a dropped code from the
 * union) would pass every existing test silently.
 */
const CODES = ["AYAS_EVOLUTION_INVALID_ID", "AYAS_EVOLUTION_INVALID_TIME", "AYAS_EVOLUTION_INVALID_TARGET", "AYAS_EVOLUTION_SCHEMA_MISMATCH", "AYAS_EVOLUTION_INVALID_ENUM", "AYAS_EVOLUTION_REGISTER_LIMIT", "AYAS_EVOLUTION_DUPLICATE_ID", "AYAS_EVOLUTION_HISTORY_REWRITE", "AYAS_EVOLUTION_TRANSITION_REFUSED", "AYAS_EVOLUTION_SUPERSESSION_INVALID", "AYAS_EVOLUTION_REGISTER_INVALID", "AYAS_EVOLUTION_ENVIRONMENT_INVALID"] as const;

// AYAS M19.3: compile-time exhaustiveness — if a future code is added to
// AyasEvolutionError's own declared union but not to CODES above, this line
// fails `tsc --noEmit` (never silently passes at runtime).
type _AyasExpectedCode = ConstructorParameters<typeof AyasEvolutionError>[0];
type _AyasMissingCodes = Exclude<_AyasExpectedCode, (typeof CODES)[number]>;
const _ayasExhaustiveCodesCheck: _AyasMissingCodes extends never ? true : ["AYAS: CODES is missing a declared code — regenerate this smoke test", _AyasMissingCodes] = true;
void _ayasExhaustiveCodesCheck;

for (const code of CODES) {
  const error = new AyasEvolutionError(code, `test message for ${code}`);
  assert.equal(error.code, code, `constructing with code "${code}" must carry that exact code`);
  assert.equal(error.name, "AyasEvolutionError", "error.name must equal the class name");
  assert.ok(error instanceof Error, "must be a real Error instance");
  assert.ok(error instanceof AyasEvolutionError, "must be an instance of its own class");
}

console.log(JSON.stringify({ status: "PASS", suite: "ayas-error-code-contract-ayas-evolution", scenarios: CODES.length * 4 }));
