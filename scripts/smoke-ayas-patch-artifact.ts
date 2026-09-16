import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasPatchArtifactStore, computeAyasPatchHash, AyasPatchArtifactError, type AyasPatchArtifact } from "../src/lib/brain/autonomy/AyasPatchArtifact";

let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-artifact-")); }

function baseInput(overrides: Partial<Omit<AyasPatchArtifact, "schemaVersion" | "patchHash">> = {}): Omit<AyasPatchArtifact, "schemaVersion" | "patchHash"> {
  return {
    artifactId: `ayas-patch-artifact-${Math.random().toString(36).slice(2)}`,
    candidateId: "ayas-novel-test",
    generatorIdentity: "ayas-detector:error-code-contract-gap-v1",
    baseBranch: "wip/test",
    baseHead: "abc123",
    exactFiles: ["scripts/smoke-ayas-fixture.ts"],
    allowedRoots: ["scripts/"],
    replacements: [{ filePath: "scripts/smoke-ayas-fixture.ts", expectedHash: null, content: "console.log('fixture');\n", allowCreate: true }],
    validatorScripts: ["scripts/smoke-ayas-fixture.ts"],
    graphifyEvidence: ["fixture evidence"],
    safetyClassification: "SAFE",
    problemStatement: "fixture problem",
    rationale: "fixture rationale",
    expectedUserBenefit: "fixture benefit",
    expectedBehaviorChange: "fixture change",
    unchangedBehavior: "fixture unchanged",
    risk: "low",
    productionImpact: "none",
    sandboxValidationSummary: ["typecheck-project: PASS"],
    generatedAt: "2026-09-16T00:00:00.000Z",
    ...overrides,
  };
}

scenario("freeze computes a patchHash and persists the artifact to disk", () => {
  const store = createAyasPatchArtifactStore({ rootDir: root() });
  const artifact = store.freeze(baseInput());
  assert.equal(typeof artifact.patchHash, "string");
  assert.ok(artifact.patchHash.length > 32);
  assert.equal(artifact.schemaVersion, "1");
  assert.ok(fs.existsSync(path.join(store.dir, `${artifact.artifactId}.json`)));
});

scenario("load returns exactly what was frozen", () => {
  const store = createAyasPatchArtifactStore({ rootDir: root() });
  const frozen = store.freeze(baseInput());
  const loaded = store.load(frozen.artifactId);
  assert.deepEqual(loaded, frozen);
});

scenario("loadVerified succeeds for an untampered artifact", () => {
  const store = createAyasPatchArtifactStore({ rootDir: root() });
  const frozen = store.freeze(baseInput());
  const verified = store.loadVerified(frozen.artifactId);
  assert.equal(verified.patchHash, frozen.patchHash);
});

scenario("loadVerified throws AYAS_PATCH_ARTIFACT_HASH_MISMATCH for a tampered file", () => {
  const dir = root();
  const store = createAyasPatchArtifactStore({ rootDir: dir });
  const frozen = store.freeze(baseInput());
  const file = path.join(store.dir, `${frozen.artifactId}.json`);
  const tampered = { ...JSON.parse(fs.readFileSync(file, "utf8")), rationale: "tampered rationale" };
  fs.writeFileSync(file, JSON.stringify(tampered, null, 2));
  assert.throws(() => store.loadVerified(frozen.artifactId), (error: unknown) => error instanceof AyasPatchArtifactError && error.code === "AYAS_PATCH_ARTIFACT_HASH_MISMATCH");
});

scenario("load throws AYAS_PATCH_ARTIFACT_NOT_FOUND for a missing artifact", () => {
  const store = createAyasPatchArtifactStore({ rootDir: root() });
  assert.throws(() => store.load("ayas-patch-artifact-does-not-exist"), (error: unknown) => error instanceof AyasPatchArtifactError && error.code === "AYAS_PATCH_ARTIFACT_NOT_FOUND");
});

scenario("freeze is create-only: freezing the same artifactId twice throws AYAS_PATCH_ARTIFACT_ALREADY_FROZEN", () => {
  const store = createAyasPatchArtifactStore({ rootDir: root() });
  const input = baseInput();
  store.freeze(input);
  assert.throws(() => store.freeze(input), (error: unknown) => error instanceof AyasPatchArtifactError && error.code === "AYAS_PATCH_ARTIFACT_ALREADY_FROZEN");
});

scenario("freeze refuses content containing a secret-like value", () => {
  const store = createAyasPatchArtifactStore({ rootDir: root() });
  const input = baseInput({ rationale: "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
  assert.throws(() => store.freeze(input), (error: unknown) => error instanceof AyasPatchArtifactError && error.code === "AYAS_PATCH_ARTIFACT_SECRET_LEAK");
});

scenario("patchHash excludes artifactId/generatedAt/sandboxValidationSummary — two artifacts with identical content but different volatile fields hash identically", () => {
  const h1 = computeAyasPatchHash(baseInput({ artifactId: "a", generatedAt: "2026-01-01T00:00:00.000Z", sandboxValidationSummary: ["x: PASS"] }) as unknown as Record<string, unknown>);
  const h2 = computeAyasPatchHash(baseInput({ artifactId: "b", generatedAt: "2026-02-02T00:00:00.000Z", sandboxValidationSummary: ["y: PASS", "z: PASS"] }) as unknown as Record<string, unknown>);
  assert.equal(h1, h2);
});

scenario("patchHash changes when replacement content changes by even one byte", () => {
  const h1 = computeAyasPatchHash(baseInput() as unknown as Record<string, unknown>);
  const h2 = computeAyasPatchHash(baseInput({ replacements: [{ filePath: "scripts/smoke-ayas-fixture.ts", expectedHash: null, content: "console.log('fixture!');\n", allowCreate: true }] }) as unknown as Record<string, unknown>);
  assert.notEqual(h1, h2);
});

scenario("patchHash changes when baseHead changes", () => {
  const h1 = computeAyasPatchHash(baseInput({ baseHead: "abc123" }) as unknown as Record<string, unknown>);
  const h2 = computeAyasPatchHash(baseInput({ baseHead: "def456" }) as unknown as Record<string, unknown>);
  assert.notEqual(h1, h2);
});

scenario("patchHash changes when exactFiles changes", () => {
  const h1 = computeAyasPatchHash(baseInput({ exactFiles: ["scripts/a.ts"] }) as unknown as Record<string, unknown>);
  const h2 = computeAyasPatchHash(baseInput({ exactFiles: ["scripts/b.ts"] }) as unknown as Record<string, unknown>);
  assert.notEqual(h1, h2);
});

scenario("patchHash changes when validatorScripts changes", () => {
  const h1 = computeAyasPatchHash(baseInput({ validatorScripts: ["scripts/a.ts"] }) as unknown as Record<string, unknown>);
  const h2 = computeAyasPatchHash(baseInput({ validatorScripts: ["scripts/a.ts", "scripts/b.ts"] }) as unknown as Record<string, unknown>);
  assert.notEqual(h1, h2);
});

scenario("distinct artifacts (different artifactId) never collide on disk", () => {
  const store = createAyasPatchArtifactStore({ rootDir: root() });
  const a1 = store.freeze(baseInput({ artifactId: "ayas-patch-artifact-one" }));
  const a2 = store.freeze(baseInput({ artifactId: "ayas-patch-artifact-two" }));
  assert.notEqual(a1.artifactId, a2.artifactId);
  assert.equal(a1.patchHash, a2.patchHash, "identical content, different id, still same content hash");
  assert.equal(store.load("ayas-patch-artifact-one").artifactId, "ayas-patch-artifact-one");
  assert.equal(store.load("ayas-patch-artifact-two").artifactId, "ayas-patch-artifact-two");
});

scenario("freeze is create-only even for a DIFFERENT payload reusing the same artifactId — immutability cannot be bypassed by changing content", () => {
  const store = createAyasPatchArtifactStore({ rootDir: root() });
  const artifactId = "ayas-patch-artifact-reused-id";
  store.freeze(baseInput({ artifactId }));
  assert.throws(
    () => store.freeze(baseInput({ artifactId, rationale: "a completely different, later regeneration" })),
    (error: unknown) => error instanceof AyasPatchArtifactError && error.code === "AYAS_PATCH_ARTIFACT_ALREADY_FROZEN",
  );
  // The originally frozen content must still be exactly what loads back — never silently replaced.
  const loaded = store.load(artifactId);
  assert.equal(loaded.rationale, "fixture rationale");
});

scenario("loadVerified detects tampering of the actual executable payload (replacements[].content), not just explanation text", () => {
  const dir = root();
  const store = createAyasPatchArtifactStore({ rootDir: dir });
  const frozen = store.freeze(baseInput());
  const file = path.join(store.dir, `${frozen.artifactId}.json`);
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  onDisk.replacements[0].content = "console.log('a silently swapped payload');\n";
  fs.writeFileSync(file, JSON.stringify(onDisk, null, 2));
  assert.throws(() => store.loadVerified(frozen.artifactId), (error: unknown) => error instanceof AyasPatchArtifactError && error.code === "AYAS_PATCH_ARTIFACT_HASH_MISMATCH");
});

console.log(`AYAS patch artifact smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-patch-artifact", scenarios: count }));
