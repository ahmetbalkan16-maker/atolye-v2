import assert from "node:assert/strict";

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

  console.log(`AYAS mutation registry smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-mutation-registry", scenarios: count }));
}
void main();
