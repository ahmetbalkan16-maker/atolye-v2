import assert from "node:assert/strict";
import { classifyAyasMicroCandidate, AYAS_MICRO_MAX_FILES, AYAS_MICRO_MAX_TOTAL_LINES } from "../src/lib/brain/autonomy/AyasMicroClassifier";

let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

const TRUSTED_GENERATOR = "ayas-detector:error-code-contract-gap-v1";

scenario("a small SAFE-domain candidate from the trusted generator classifies MICRO_SAFE", () => {
  const result = classifyAyasMicroCandidate({ exactFiles: ["scripts/smoke-fixture.ts"], totalLines: 20, generatorIdentity: TRUSTED_GENERATOR });
  assert.equal(result.domainSafety, "SAFE");
  assert.equal(result.classification, "MICRO_SAFE");
});

scenario("a REVIEW_REQUIRED domain target classifies NOT_SAFE, never either safe lane", () => {
  const result = classifyAyasMicroCandidate({ exactFiles: ["src/lib/auth/session.ts"], totalLines: 5, generatorIdentity: TRUSTED_GENERATOR });
  assert.equal(result.domainSafety, "REVIEW_REQUIRED");
  assert.equal(result.classification, "NOT_SAFE");
});

scenario("a FORBIDDEN_AUTONOMOUS domain target classifies NOT_SAFE, never either safe lane", () => {
  const result = classifyAyasMicroCandidate({ exactFiles: ["src/lib/ayas/execution/AyasExecutionGateStore.ts"], totalLines: 5, generatorIdentity: TRUSTED_GENERATOR });
  assert.equal(result.domainSafety, "FORBIDDEN_AUTONOMOUS");
  assert.equal(result.classification, "NOT_SAFE");
});

scenario("a SAFE-domain candidate from an UNTRUSTED generator classifies PRIORITY_SAFE, not MICRO_SAFE", () => {
  const result = classifyAyasMicroCandidate({ exactFiles: ["scripts/smoke-fixture.ts"], totalLines: 10, generatorIdentity: "ayas-detector:some-future-generator-v1" });
  assert.equal(result.domainSafety, "SAFE");
  assert.equal(result.classification, "PRIORITY_SAFE");
});

scenario(`a candidate exceeding ${AYAS_MICRO_MAX_FILES} files classifies PRIORITY_SAFE even from the trusted generator`, () => {
  const files = Array.from({ length: AYAS_MICRO_MAX_FILES + 1 }, (_, i) => `scripts/smoke-fixture-${i}.ts`);
  const result = classifyAyasMicroCandidate({ exactFiles: files, totalLines: 10, generatorIdentity: TRUSTED_GENERATOR });
  assert.equal(result.classification, "PRIORITY_SAFE");
});

scenario(`a candidate exceeding ${AYAS_MICRO_MAX_TOTAL_LINES} lines classifies PRIORITY_SAFE even from the trusted generator`, () => {
  const result = classifyAyasMicroCandidate({ exactFiles: ["scripts/smoke-fixture.ts"], totalLines: AYAS_MICRO_MAX_TOTAL_LINES + 1, generatorIdentity: TRUSTED_GENERATOR });
  assert.equal(result.classification, "PRIORITY_SAFE");
});

scenario("exactly at the file/line bounds still classifies MICRO_SAFE (bounds are inclusive)", () => {
  const files = Array.from({ length: AYAS_MICRO_MAX_FILES }, (_, i) => `scripts/smoke-fixture-${i}.ts`);
  const result = classifyAyasMicroCandidate({ exactFiles: files, totalLines: AYAS_MICRO_MAX_TOTAL_LINES, generatorIdentity: TRUSTED_GENERATOR });
  assert.equal(result.classification, "MICRO_SAFE");
});

scenario("classification is never influenced by candidate/proposal-shaped text fields — only structural inputs are accepted by the function signature", () => {
  // Structural proof, not a runtime assertion: classifyAyasMicroCandidate's input type has no `reason`/`objective`/free-text field at all.
  const result = classifyAyasMicroCandidate({ exactFiles: ["scripts/smoke-fixture.ts"], totalLines: 1, generatorIdentity: TRUSTED_GENERATOR });
  assert.equal(result.classification, "MICRO_SAFE");
});

console.log(`AYAS micro classifier smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-micro-classifier", scenarios: count }));
