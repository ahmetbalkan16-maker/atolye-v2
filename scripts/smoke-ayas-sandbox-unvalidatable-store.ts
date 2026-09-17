import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasSandboxUnvalidatableStore, contentFingerprintOf } from "../src/lib/brain/autonomy/AyasSandboxUnvalidatableStore";

/**
 * M21.4/Gap 4 — deterministic retry-spam suppression for a candidate whose
 * real sandbox validation fails for reasons unrelated to its own content
 * (a real live example: diagnostic-quality-gap's correctly-regenerated
 * scripts/smoke-assembly-background-music-mix.ts failing because real
 * ffmpeg behaves differently inside an isolated worktree, not because the
 * diff itself is wrong).
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-unvalidatable-")); }

scenario("a never-seen semantic key is never skipped", () => {
  const store = createAyasSandboxUnvalidatableStore({ rootDir: tmpDir() });
  assert.equal(store.shouldSkip("never-seen", contentFingerprintOf("x")), false);
});

scenario("after recording a failure, the SAME (semanticKey, content) pair is skipped on the next check", () => {
  const store = createAyasSandboxUnvalidatableStore({ rootDir: tmpDir() });
  const fp = contentFingerprintOf("some generated content");
  store.record({ semanticKey: "key-1", generatorIdentity: "gen-v1", contentFingerprint: fp, reason: "ffmpeg exit 69", requiredCapability: "unknown", now: "2026-09-17T00:00:00.000Z" });
  assert.equal(store.shouldSkip("key-1", fp), true);
});

scenario("if the source changes (a NEW content fingerprint for the same semantic key), suppression no longer applies — the retry-condition list's 'source hash changes'", () => {
  const store = createAyasSandboxUnvalidatableStore({ rootDir: tmpDir() });
  const oldFp = contentFingerprintOf("old content");
  const newFp = contentFingerprintOf("new content after a source change");
  store.record({ semanticKey: "key-2", generatorIdentity: "gen-v1", contentFingerprint: oldFp, reason: "x", requiredCapability: "unknown", now: "2026-09-17T00:00:00.000Z" });
  assert.equal(store.shouldSkip("key-2", newFp), false, "a changed fingerprint must not be suppressed by an old record for different content");
});

scenario("repeated failures of the SAME unchanged content increment attemptCount and preserve firstFailedAt, but update lastFailedAt", () => {
  const store = createAyasSandboxUnvalidatableStore({ rootDir: tmpDir() });
  const fp = contentFingerprintOf("stable content");
  const first = store.record({ semanticKey: "key-3", generatorIdentity: "gen-v1", contentFingerprint: fp, reason: "x", requiredCapability: "unknown", now: "2026-09-17T00:00:00.000Z" });
  const second = store.record({ semanticKey: "key-3", generatorIdentity: "gen-v1", contentFingerprint: fp, reason: "x", requiredCapability: "unknown", now: "2026-09-17T05:00:00.000Z" });
  assert.equal(first.attemptCount, 1);
  assert.equal(second.attemptCount, 2);
  assert.equal(second.firstFailedAt, first.firstFailedAt);
  assert.equal(second.lastFailedAt, "2026-09-17T05:00:00.000Z");
});

scenario("a new failure with a DIFFERENT fingerprint for the same key resets attemptCount/firstFailedAt — it's a genuinely different attempt", () => {
  const store = createAyasSandboxUnvalidatableStore({ rootDir: tmpDir() });
  const fpA = contentFingerprintOf("content A");
  const fpB = contentFingerprintOf("content B");
  store.record({ semanticKey: "key-4", generatorIdentity: "gen-v1", contentFingerprint: fpA, reason: "x", requiredCapability: "unknown", now: "2026-09-17T00:00:00.000Z" });
  const afterChange = store.record({ semanticKey: "key-4", generatorIdentity: "gen-v1", contentFingerprint: fpB, reason: "y", requiredCapability: "unknown", now: "2026-09-17T01:00:00.000Z" });
  assert.equal(afterChange.attemptCount, 1, "a content change is a fresh attempt, not a continuation of the old streak");
});

scenario("clear() removes the record — an operator override that forces the next tick to retry", () => {
  const store = createAyasSandboxUnvalidatableStore({ rootDir: tmpDir() });
  const fp = contentFingerprintOf("x");
  store.record({ semanticKey: "key-5", generatorIdentity: "gen-v1", contentFingerprint: fp, reason: "x", requiredCapability: "unknown", now: "2026-09-17T00:00:00.000Z" });
  assert.equal(store.shouldSkip("key-5", fp), true);
  store.clear("key-5");
  assert.equal(store.shouldSkip("key-5", fp), false);
});

scenario("free-text reason/requiredCapability fields are redacted and bounded, same as every other AYAS durable store", () => {
  const store = createAyasSandboxUnvalidatableStore({ rootDir: tmpDir() });
  const fp = contentFingerprintOf("x");
  const record = store.record({ semanticKey: "key-6", generatorIdentity: "gen-v1", contentFingerprint: fp, reason: `leaked path C:\\Users\\Metod\\secret\\${"x".repeat(1000)}`, requiredCapability: "unknown", now: "2026-09-17T00:00:00.000Z" });
  assert.ok(!record.reason.includes("C:\\Users\\Metod\\secret"));
  assert.ok(record.reason.length <= 500);
});

scenario("list() returns every recorded semantic key; a corrupt record file is skipped, never crashes the read", () => {
  const dir = tmpDir();
  const store = createAyasSandboxUnvalidatableStore({ rootDir: dir });
  store.record({ semanticKey: "key-7", generatorIdentity: "gen-v1", contentFingerprint: contentFingerprintOf("x"), reason: "x", requiredCapability: "unknown", now: "2026-09-17T00:00:00.000Z" });
  fs.writeFileSync(path.join(dir, "corrupt.json"), "{ not valid json", "utf8");
  assert.equal(store.list().length, 1);
});

console.log(`AYAS sandbox-unvalidatable store smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-sandbox-unvalidatable-store", scenarios: count }));
