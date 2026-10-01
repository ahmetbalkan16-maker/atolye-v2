import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createAyasExactPatchSafetyProof, diffAyasExactPatch, ayasExactPatchSha256,
  validAyasReviewedExactPatch, verifyAyasExactPatchSafetyProof, verifyAyasReviewedExactPatch,
  verifyAyasExecutedExactPatch,
  type AyasExactPatchSafetyProof } from "../src/lib/brain/selfheal/AyasExactPatchSafety";
import { AYAS_DEFAULT_IMPROVEMENT_REGISTRY, ayasImprovementRegistryDigest,
  generateAyasRenderToolSupersessionPatch } from "../src/lib/brain/autonomy/AyasResearchExperimentRegistry";

const file = "src/lib/ayas/memory/AyasMemoryTemporal.ts";
const strategy = AYAS_DEFAULT_IMPROVEMENT_REGISTRY.strategies.find((item) => item.strategyId === "exp-memory-render-tool-supersession");
assert.ok(strategy?.reviewedExactPatch);
const manifest = strategy.reviewedExactPatch;
assert.ok(validAyasReviewedExactPatch(manifest));
// The reviewed baseline and the applied result are immutable history, not the live file. The governed patch was
// applied in APPLIED_COMMIT and the file has changed again since (Stage 15C), so the live source is neither state.
// Reading both from the commits themselves also proves what was applied is exactly what was reviewed.
const REVIEWED_BASE_COMMIT = "71f554eb72e6f5aaafb272f31bff402664f602cc";
const APPLIED_COMMIT = "3367d415b12a6214a7f58fb95d6d849ccd0cd66a";
const atCommit = (commit: string): string => execFileSync("git", ["show", `${commit}:${file}`], { cwd: process.cwd(), encoding: "utf8", windowsHide: true, maxBuffer: 16_000_000 });
const before = atCommit(REVIEWED_BASE_COMMIT);
assert.equal(ayasExactPatchSha256(before), manifest.beforeSha256);
const after = generateAyasRenderToolSupersessionPatch(before);
assert.equal(ayasExactPatchSha256(after), manifest.afterSha256);
assert.equal(atCommit(APPLIED_COMMIT), after, "the applied commit must hold exactly the reviewed patch result");
assert.equal(execFileSync("git", ["rev-parse", `${APPLIED_COMMIT}^`], { cwd: process.cwd(), encoding: "utf8", windowsHide: true }).trim(), REVIEWED_BASE_COMMIT);
// A strategy bound to its reviewed baseline cannot be replayed against any other source: not the applied result,
// and not the file as it stands today.
const live = fs.readFileSync(path.join(process.cwd(), file), "utf8");
assert.throws(() => generateAyasRenderToolSupersessionPatch(after), /render-tool strategy source mismatch/);
if (ayasExactPatchSha256(live) !== manifest.beforeSha256) assert.throws(() => generateAyasRenderToolSupersessionPatch(live), /render-tool strategy source mismatch/);
const diff = diffAyasExactPatch(before, after);
assert.ok(diff);
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
console.log(JSON.stringify({ status: "PASS", suite: "ayas-exact-patch-safety", scenarios: 23, changedLines: diff.changedLines }));
