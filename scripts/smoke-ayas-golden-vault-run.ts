/** Stage 15O — the golden vault holds here: the vault of record is intact and every one of its cases passes in this tree. Each case is its own offline suite. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { auditAyasGoldenVaultChain, ayasGoldenVaultDigest, evaluateAyasGoldenRegression, verifyAyasGoldenVaultPins } from "../src/lib/ayas/golden/AyasGoldenVault";
import { AYAS_GOLDEN_VAULT, AYAS_GOLDEN_VAULT_RETIRED, AYAS_GOLDEN_VAULT_VERSIONS } from "../src/lib/ayas/golden/AyasGoldenVaultRegistry";
import { runAyasGoldenVault } from "./lib/AyasGoldenVaultFiles";

const repo = process.cwd();
assert.deepEqual(auditAyasGoldenVaultChain(AYAS_GOLDEN_VAULT_VERSIONS, AYAS_GOLDEN_VAULT_RETIRED), [], "golden vault chain");
const pinDrift = verifyAyasGoldenVaultPins(AYAS_GOLDEN_VAULT, (file) => fs.readFileSync(path.join(repo, file)));
// A case gets the generic suite bound; the whole vault has to fit a baseline slot, so one slow case fails the run instead of hiding in it.
const { results, durationsMs } = runAyasGoldenVault(repo, AYAS_GOLDEN_VAULT, process.env, 60_000);
const decision = evaluateAyasGoldenRegression({ vault: AYAS_GOLDEN_VAULT, candidate: { vaultDigest: ayasGoldenVaultDigest(AYAS_GOLDEN_VAULT), pinDrift, results } });
assert.deepEqual([decision.decision, decision.failingCaseIds, pinDrift], ["GOLDEN_HELD", [], []], JSON.stringify({ decision, durationsMs }));
assert.equal(results.length, AYAS_GOLDEN_VAULT.cases.length);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-golden-vault-run", vaultVersion: AYAS_GOLDEN_VAULT.version, vaultDigest: decision.vaultDigest, cases: results.length,
  gapDomains: decision.gapDomains, totalMs: Object.values(durationsMs).reduce((sum, ms) => sum + ms, 0), modelRuns: 0 }));
