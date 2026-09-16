import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveAyasMutation, isAyasMutationKindRegistered, AyasMutationRegistryError, type AyasMutationImplementation } from "../src/lib/brain/autonomy/AyasMutationRegistry";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }

const testEntry: AyasMutationImplementation = { exactFiles: ["src/fixture.ts"], run: async () => ({ changedFiles: ["src/fixture.ts"], testsRun: [], testResults: [] }) };
const testRegistry = new Map<string, AyasMutationImplementation>([["fixture-mutation", testEntry]]);

async function main() {
  await scenario("an unregistered mutationKind never resolves against the real registry", () => {
    assert.equal(isAyasMutationKindRegistered("anything"), false);
    assert.throws(() => resolveAyasMutation("anything", []), (e: unknown) => e instanceof AyasMutationRegistryError && e.code === "AYAS_MUTATION_KIND_UNKNOWN");
  });
  await scenario("the real registry's one reviewed entry (first-safe-smoke-coverage-v1) resolves with its exact declared exactFiles", () => {
    assert.equal(isAyasMutationKindRegistered("first-safe-smoke-coverage-v1"), true);
    const impl = resolveAyasMutation("first-safe-smoke-coverage-v1", ["scripts/smoke-ayas-proposal-terminal-state-dedup.ts"]);
    assert.deepEqual(impl.exactFiles, ["scripts/smoke-ayas-proposal-terminal-state-dedup.ts"]);
  });
  await scenario("unknown mutationKind is rejected before any gate/reservation activity", () => {
    assert.throws(() => resolveAyasMutation("does-not-exist", ["src/fixture.ts"], testRegistry), (e: unknown) => e instanceof AyasMutationRegistryError && e.code === "AYAS_MUTATION_KIND_UNKNOWN");
  });
  await scenario("known mutationKind with matching exactFiles resolves", () => {
    const impl = resolveAyasMutation("fixture-mutation", ["src/fixture.ts"], testRegistry);
    assert.equal(impl, testEntry);
  });
  await scenario("known mutationKind with a scope mismatch is rejected", () => {
    assert.throws(() => resolveAyasMutation("fixture-mutation", ["src/other.ts"], testRegistry), (e: unknown) => e instanceof AyasMutationRegistryError && e.code === "AYAS_MUTATION_SCOPE_MISMATCH");
  });
  await scenario("scope check is order-sensitive (not just set equality)", () => {
    const registry = new Map<string, AyasMutationImplementation>([["multi", { exactFiles: ["a.ts", "b.ts"], run: testEntry.run }]]);
    assert.throws(() => resolveAyasMutation("multi", ["b.ts", "a.ts"], registry), (e: unknown) => e instanceof AyasMutationRegistryError && e.code === "AYAS_MUTATION_SCOPE_MISMATCH");
    assert.doesNotThrow(() => resolveAyasMutation("multi", ["a.ts", "b.ts"], registry));
  });
  await scenario("empty exactFiles never matches a non-empty registered scope", () => {
    assert.throws(() => resolveAyasMutation("fixture-mutation", [], testRegistry), (e: unknown) => e instanceof AyasMutationRegistryError && e.code === "AYAS_MUTATION_SCOPE_MISMATCH");
  });
  await scenario("isAyasMutationKindRegistered reflects the supplied registry, not a global mutable one", () => {
    assert.equal(isAyasMutationKindRegistered("fixture-mutation", testRegistry), true);
    assert.equal(isAyasMutationKindRegistered("fixture-mutation"), false);
  });
  await scenario("M16: the real registry's second reviewed entry (second-safe-smoke-coverage-v1) resolves with its exact declared exactFiles", () => {
    assert.equal(isAyasMutationKindRegistered("second-safe-smoke-coverage-v1"), true);
    const impl = resolveAyasMutation("second-safe-smoke-coverage-v1", ["scripts/smoke-ayas-machine-health-non-gpu-stage.ts"]);
    assert.deepEqual(impl.exactFiles, ["scripts/smoke-ayas-machine-health-non-gpu-stage.ts"]);
  });
  await scenario("M16 end-to-end: second-safe-smoke-coverage-v1's real run() writes its embedded content and its own declared validator actually PASSes", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-second-mutation-e2e-"));
    fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
    fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(repoRoot, "node_modules"), "junction");
    fs.symlinkSync(path.join(process.cwd(), "src"), path.join(repoRoot, "src"), "junction");
    const impl = resolveAyasMutation("second-safe-smoke-coverage-v1", ["scripts/smoke-ayas-machine-health-non-gpu-stage.ts"]);
    const result = await impl.run(repoRoot);
    assert.deepEqual(result.changedFiles, ["scripts/smoke-ayas-machine-health-non-gpu-stage.ts"]);
    assert.deepEqual(result.testResults, ["PASS"], "the embedded content must be real, working test code — not just syntactically valid");
    assert.equal(fs.existsSync(path.join(repoRoot, "scripts/smoke-ayas-machine-health-non-gpu-stage.ts")), true);
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  console.log(`AYAS mutation registry smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-mutation-registry", scenarios: count }));
}
void main();
