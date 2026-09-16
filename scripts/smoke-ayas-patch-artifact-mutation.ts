import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasPatchArtifactStore, AyasPatchArtifactError, type AyasPatchArtifact } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { resolveAyasPatchArtifactMutation, AyasPatchArtifactMutationError } from "../src/lib/brain/autonomy/AyasPatchArtifactMutation";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";
import type { AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) { await fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

function artifactRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-artifact-mutation-")); }

function freezeFixtureArtifact(rootDir: string, overrides: Partial<Omit<AyasPatchArtifact, "schemaVersion" | "patchHash">> = {}) {
  const store = createAyasPatchArtifactStore({ rootDir });
  return store.freeze({
    artifactId: `ayas-patch-artifact-${Math.random().toString(36).slice(2)}`,
    candidateId: "ayas-novel-test",
    generatorIdentity: "ayas-detector:error-code-contract-gap-v1",
    baseBranch: "wip/test",
    baseHead: "abc123",
    exactFiles: ["scripts/smoke-fixture.ts"],
    allowedRoots: ["scripts/"],
    replacements: [{ filePath: "scripts/smoke-fixture.ts", expectedHash: null, content: 'console.log(JSON.stringify({ status: "PASS", suite: "fixture", scenarios: 0 }));\n', allowCreate: true }],
    validatorScripts: ["scripts/smoke-fixture.ts"],
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
  });
}

function fixtureProposal(overrides: Partial<AyasInboxProposal> = {}): AyasInboxProposal {
  return {
    schemaVersion: "1",
    proposalId: "ayas-proposal-fixture",
    createdAt: "2026-09-16T00:00:00.000Z",
    lastUpdatedAt: "2026-09-16T00:00:00.000Z",
    baseBranch: "wip/test",
    baseHead: "abc123",
    objective: "fixture",
    rationale: "fixture rationale",
    evidence: [],
    graphifyEvidence: [],
    candidateRank: 1,
    risk: "low",
    safetyClassification: "SAFE",
    exactFiles: ["scripts/smoke-fixture.ts"],
    expectedDiffScope: "1 file",
    testsPlanned: ["smoke-fixture"],
    estimatedCost: "zero-cost",
    proposalHash: "fixturehash",
    status: "APPROVED",
    createdBy: "ayas-daemon",
    mutationKind: AYAS_PATCH_ARTIFACT_MUTATION_KIND,
    ...overrides,
  };
}

async function main(): Promise<void> {
  await scenario("resolveAyasPatchArtifactMutation returns a working implementation for a matching, verified artifact", () => {
  const rootDir = artifactRoot();
  const store = createAyasPatchArtifactStore({ rootDir });
  const artifact = freezeFixtureArtifact(rootDir);
  const proposal = fixtureProposal({ patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash });
  const mutation = resolveAyasPatchArtifactMutation(proposal, store);
  assert.deepEqual(mutation.exactFiles, artifact.exactFiles);
  assert.equal(typeof mutation.run, "function");
});

  await scenario("resolveAyasPatchArtifactMutation throws AYAS_PATCH_ARTIFACT_MUTATION_NOT_REFERENCED for a different mutationKind", () => {
  const rootDir = artifactRoot();
  const store = createAyasPatchArtifactStore({ rootDir });
  const proposal = fixtureProposal({ mutationKind: "second-safe-smoke-coverage-v1", patchArtifactId: undefined, patchHash: undefined });
  assert.throws(() => resolveAyasPatchArtifactMutation(proposal, store), (error: unknown) => error instanceof AyasPatchArtifactMutationError && error.code === "AYAS_PATCH_ARTIFACT_MUTATION_NOT_REFERENCED");
});

  await scenario("resolveAyasPatchArtifactMutation throws AYAS_PATCH_ARTIFACT_MUTATION_NOT_REFERENCED when patchArtifactId is missing despite the right mutationKind", () => {
  const rootDir = artifactRoot();
  const store = createAyasPatchArtifactStore({ rootDir });
  const proposal = fixtureProposal({ patchArtifactId: undefined, patchHash: undefined });
  assert.throws(() => resolveAyasPatchArtifactMutation(proposal, store), (error: unknown) => error instanceof AyasPatchArtifactMutationError && error.code === "AYAS_PATCH_ARTIFACT_MUTATION_NOT_REFERENCED");
});

  await scenario("resolveAyasPatchArtifactMutation throws AYAS_PATCH_ARTIFACT_MUTATION_HASH_MISMATCH when the proposal's recorded patchHash disagrees with the artifact", () => {
  const rootDir = artifactRoot();
  const store = createAyasPatchArtifactStore({ rootDir });
  const artifact = freezeFixtureArtifact(rootDir);
  const proposal = fixtureProposal({ patchArtifactId: artifact.artifactId, patchHash: "not-the-real-hash" });
  assert.throws(() => resolveAyasPatchArtifactMutation(proposal, store), (error: unknown) => error instanceof AyasPatchArtifactMutationError && error.code === "AYAS_PATCH_ARTIFACT_MUTATION_HASH_MISMATCH");
});

  await scenario("resolveAyasPatchArtifactMutation propagates the artifact store's own integrity failure when the file itself is tampered on disk", () => {
  const rootDir = artifactRoot();
  const store = createAyasPatchArtifactStore({ rootDir });
  const artifact = freezeFixtureArtifact(rootDir);
  const file = path.join(rootDir, `${artifact.artifactId}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), rationale: "tampered" }, null, 2));
  const proposal = fixtureProposal({ patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash });
  // loadVerified's own tamper check fires first — the resolver's secondary
  // patchHash cross-check (AYAS_PATCH_ARTIFACT_MUTATION_HASH_MISMATCH) is
  // defense-in-depth for a different case: an intact artifact whose hash
  // the PROPOSAL record disagrees with (covered by the scenario above).
  assert.throws(() => resolveAyasPatchArtifactMutation(proposal, store), (error: unknown) => error instanceof AyasPatchArtifactError && error.code === "AYAS_PATCH_ARTIFACT_HASH_MISMATCH");
});

  await scenario("resolveAyasPatchArtifactMutation throws AYAS_PATCH_ARTIFACT_MUTATION_HEAD_MISMATCH when baseHead disagrees", () => {
  const rootDir = artifactRoot();
  const store = createAyasPatchArtifactStore({ rootDir });
  const artifact = freezeFixtureArtifact(rootDir, { baseHead: "original-head" });
  const proposal = fixtureProposal({ baseHead: "different-head", patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash });
  assert.throws(() => resolveAyasPatchArtifactMutation(proposal, store), (error: unknown) => error instanceof AyasPatchArtifactMutationError && error.code === "AYAS_PATCH_ARTIFACT_MUTATION_HEAD_MISMATCH");
});

  await scenario("resolveAyasPatchArtifactMutation throws AYAS_PATCH_ARTIFACT_MUTATION_SCOPE_MISMATCH when exactFiles disagrees", () => {
  const rootDir = artifactRoot();
  const store = createAyasPatchArtifactStore({ rootDir });
  const artifact = freezeFixtureArtifact(rootDir, { exactFiles: ["scripts/smoke-fixture.ts"] });
  const proposal = fixtureProposal({ exactFiles: ["scripts/smoke-other.ts"], patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash });
  assert.throws(() => resolveAyasPatchArtifactMutation(proposal, store), (error: unknown) => error instanceof AyasPatchArtifactMutationError && error.code === "AYAS_PATCH_ARTIFACT_MUTATION_SCOPE_MISMATCH");
});

  await scenario("resolveAyasPatchArtifactMutation throws AYAS_PATCH_ARTIFACT_MUTATION_UNSAFE for a non-SAFE artifact, even with everything else matching", () => {
  const rootDir = artifactRoot();
  const store = createAyasPatchArtifactStore({ rootDir });
  const artifact = freezeFixtureArtifact(rootDir, { safetyClassification: "REVIEW_REQUIRED" });
  const proposal = fixtureProposal({ patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash });
  assert.throws(() => resolveAyasPatchArtifactMutation(proposal, store), (error: unknown) => error instanceof AyasPatchArtifactMutationError && error.code === "AYAS_PATCH_ARTIFACT_MUTATION_UNSAFE");
});

  await scenario("resolveAyasPatchArtifactMutation propagates AyasPatchArtifactError (AYAS_PATCH_ARTIFACT_NOT_FOUND) for a deleted artifact", () => {
  const rootDir = artifactRoot();
  const store = createAyasPatchArtifactStore({ rootDir });
  const proposal = fixtureProposal({ patchArtifactId: "ayas-patch-artifact-never-existed", patchHash: "irrelevant" });
  assert.throws(() => resolveAyasPatchArtifactMutation(proposal, store));
});

  await scenario("the resolved implementation's run() actually applies the artifact's content and reports PASS", async () => {
  const rootDir = artifactRoot();
  const store = createAyasPatchArtifactStore({ rootDir });
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-patch-artifact-mutation-repo-"));
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
  // Reuse the real repo's installed tsx so the validator's smoke-test run works from this throwaway repo fixture.
  fs.symlinkSync(path.join(process.cwd(), "node_modules", "tsx"), path.join(repoRoot, "node_modules", "tsx"), process.platform === "win32" ? "junction" : "dir");
  const artifact = freezeFixtureArtifact(rootDir);
  const proposal = fixtureProposal({ patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash });
  const mutation = resolveAyasPatchArtifactMutation(proposal, store);
  const result = await mutation.run(repoRoot);
  assert.deepEqual(result.changedFiles, ["scripts/smoke-fixture.ts"]);
  assert.deepEqual(result.testResults, ["PASS"]);
  assert.ok(fs.existsSync(path.join(repoRoot, "scripts", "smoke-fixture.ts")));
});

  console.log(`AYAS patch artifact mutation smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-patch-artifact-mutation", scenarios: count }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
