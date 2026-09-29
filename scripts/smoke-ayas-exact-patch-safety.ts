import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createAyasExactPatchSafetyProof, diffAyasExactPatch, ayasExactPatchSha256,
  validAyasReviewedExactPatch, verifyAyasExactPatchSafetyProof, verifyAyasReviewedExactPatch,
  verifyAyasExecutedExactPatch,
  type AyasExactPatchSafetyProof } from "../src/lib/brain/selfheal/AyasExactPatchSafety";
import { AYAS_DEFAULT_IMPROVEMENT_REGISTRY, ayasImprovementRegistryDigest,
  generateAyasRenderToolSupersessionPatch } from "../src/lib/brain/autonomy/AyasResearchExperimentRegistry";

const file = "src/lib/ayas/memory/AyasMemoryTemporal.ts";
const before = fs.readFileSync(path.join(process.cwd(), file), "utf8");
const after = generateAyasRenderToolSupersessionPatch(before);
const diff = diffAyasExactPatch(before, after);
assert.ok(diff);
const strategy = AYAS_DEFAULT_IMPROVEMENT_REGISTRY.strategies.find((item) => item.strategyId === "exp-memory-render-tool-supersession");
assert.ok(strategy?.reviewedExactPatch);
const manifest = strategy.reviewedExactPatch;
assert.ok(validAyasReviewedExactPatch(manifest));
assert.deepEqual(verifyAyasReviewedExactPatch(manifest, file, before, after), diff);
assert.equal(ayasExactPatchSha256(before), manifest.beforeSha256);
assert.equal(ayasExactPatchSha256(after), manifest.afterSha256);
assert.equal(diff.changedLines, 15);
const baseHead = "a".repeat(40);
const registryDigest = ayasImprovementRegistryDigest(AYAS_DEFAULT_IMPROVEMENT_REGISTRY);
const experimentId = `ayas-experiment-${"b".repeat(8)}-${"b".repeat(4)}-${"b".repeat(4)}-${"b".repeat(4)}-${"b".repeat(12)}`;
const evidenceHash = "c".repeat(64);
const proof = createAyasExactPatchSafetyProof({ manifest, file, before, after, baseHead,
  strategyId: strategy.strategyId, strategyVersion: strategy.version, registryDigest, experimentId, evidenceHash });
assert.ok(proof);
const expected = { baseHead, exactFiles: [file], registryDigest, strategyId: strategy.strategyId,
  strategyVersion: strategy.version, experimentId, evidenceHash };
assert.equal(verifyAyasExactPatchSafetyProof(proof, manifest, expected), true);
const forged = (change: Partial<AyasExactPatchSafetyProof>): AyasExactPatchSafetyProof => {
  const material = Object.fromEntries(Object.entries({ ...proof, ...change }).filter(([key]) => key !== "digest"));
  return { ...material, digest: ayasExactPatchSha256(JSON.stringify(material)) } as unknown as AyasExactPatchSafetyProof;
};
assert.equal(verifyAyasReviewedExactPatch(manifest, file, before, `${after}\n// different diff`), null);
assert.equal(verifyAyasExactPatchSafetyProof(forged({ baseHead: "d".repeat(40) }), manifest, expected), false);
assert.equal(verifyAyasExactPatchSafetyProof(forged({ exactFiles: [file, "src/extra.ts"] as never }), manifest, expected), false);
assert.equal(verifyAyasExactPatchSafetyProof(forged({ changedLines: 81 }), manifest, expected), false);
assert.equal(verifyAyasExactPatchSafetyProof(forged({ effects: { ...proof.effects, persistentWrite: true } as never }), manifest, expected), false);
assert.equal(verifyAyasExactPatchSafetyProof(forged({ effects: { ...proof.effects, network: true } as never }), manifest, expected), false);
assert.equal(verifyAyasExactPatchSafetyProof(forged({ afterSha256: "d".repeat(64) }), manifest, expected), false);
assert.equal(verifyAyasExactPatchSafetyProof(forged({ evidenceHash: "d".repeat(64) }), manifest, expected), false);
assert.equal(verifyAyasExactPatchSafetyProof(proof, manifest, { ...expected, baseHead: "d".repeat(40) }), false);
assert.equal(verifyAyasExactPatchSafetyProof(proof, manifest, { ...expected, registryDigest: "d".repeat(64) }), false);
assert.equal(verifyAyasExecutedExactPatch(proof, manifest, file, before, after), true);
assert.equal(verifyAyasExecutedExactPatch(proof, manifest, file, before, `${after}\n// execution changed content`), false);
assert.equal(verifyAyasExecutedExactPatch(proof, manifest, file, `${before}\n// stale base`, after), false);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-exact-patch-safety", scenarios: 19, changedLines: diff.changedLines }));
