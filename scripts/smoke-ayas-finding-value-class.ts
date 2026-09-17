import assert from "node:assert/strict";

import { classifyAyasFindingValue } from "../src/lib/brain/autonomy/AyasFindingValueClass";

/**
 * M20.1 — deterministic value classification. Every scenario below asserts
 * classification driven ONLY by file paths, never by any prose a proposal
 * could supply — there is no "reason"/"objective" parameter to this
 * function at all, which is itself the structural proof authority (and
 * labeling) can never come from proposal text.
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

scenario("a smoke test file classifies as TEST_QUALITY", () => {
  assert.equal(classifyAyasFindingValue(["scripts/smoke-fixture.ts"]), "TEST_QUALITY");
});

scenario("a probe/telemetry file classifies as OBSERVABILITY", () => {
  assert.equal(classifyAyasFindingValue(["src/lib/brain/probe/BrainResourceProbe.ts"]), "OBSERVABILITY");
});

scenario("a video/assembly/audio pipeline file classifies as RELIABILITY_RECOVERY", () => {
  assert.equal(classifyAyasFindingValue(["src/lib/video/FFmpegSceneVideoProvider.ts"]), "RELIABILITY_RECOVERY");
  assert.equal(classifyAyasFindingValue(["src/lib/assembly/VideoAssemblyService.ts"]), "RELIABILITY_RECOVERY");
  assert.equal(classifyAyasFindingValue(["src/lib/audio/AudioMixer.ts"]), "RELIABILITY_RECOVERY");
});

scenario("an AYAS chat/routing/memory file classifies as PRODUCT_BEHAVIOR", () => {
  assert.equal(classifyAyasFindingValue(["src/lib/ayas/AyasStudioContext.ts"]), "PRODUCT_BEHAVIOR");
});

scenario("a mixed set (one product file, one test file) classifies by the product file, not the test file", () => {
  assert.equal(classifyAyasFindingValue(["scripts/smoke-fixture.ts", "src/lib/ayas/AyasStudioContext.ts"]), "PRODUCT_BEHAVIOR");
});

scenario("an unrecognized path defaults to PRODUCT_BEHAVIOR — never silently upgraded to something more impressive", () => {
  assert.equal(classifyAyasFindingValue(["some/unknown/path.ts"]), "PRODUCT_BEHAVIOR");
});

scenario("an empty file list defaults to TEST_QUALITY (the least presumptive default for 'nothing to classify')", () => {
  assert.equal(classifyAyasFindingValue([]), "TEST_QUALITY");
});

scenario("classification is a pure function of paths — same input, same output, twice", () => {
  const files = ["src/lib/brain/probe/X.ts", "scripts/smoke-x.ts"];
  assert.equal(classifyAyasFindingValue(files), classifyAyasFindingValue(files));
});

console.log(`AYAS finding value class smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-finding-value-class", scenarios: count }));
