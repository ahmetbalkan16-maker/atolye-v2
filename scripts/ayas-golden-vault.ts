/**
 * Stage 15O — golden vault operator script. Read-only: it prints and never writes.
 *
 *   npx tsx scripts/ayas-golden-vault.ts                 the vault of record against this working tree
 *   npx tsx scripts/ayas-golden-vault.ts --run           also run every golden case here, one at a time
 *   npx tsx scripts/ayas-golden-vault.ts --draft-next    the next version, with the pins this tree has now
 *
 * `--draft-next` prints a version to append to `AyasGoldenVaultRegistry.ts`. Appending it is a reviewed source change;
 * nothing here publishes a version, approves a change or gives a result any authority.
 */
import fs from "node:fs";
import path from "node:path";

import { auditAyasGoldenVaultChain, ayasGoldenVaultDigest, evaluateAyasGoldenRegression, isAyasGoldenVault, verifyAyasGoldenVaultPins, type AyasGoldenVault } from "../src/lib/ayas/golden/AyasGoldenVault";
import { AYAS_GOLDEN_VAULT, AYAS_GOLDEN_VAULT_RETIRED, AYAS_GOLDEN_VAULT_VERSIONS } from "../src/lib/ayas/golden/AyasGoldenVaultRegistry";
import { ayasGoldenPinsFor, ayasGoldenScriptClosure, runAyasGoldenVault } from "./lib/AyasGoldenVaultFiles";

function main(): void {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--run" && arg !== "--draft-next") || new Set(args).size !== args.length || args.length > 1) throw new Error("ARGUMENT_INVALID");
  const repoRoot = process.cwd();
  const vault = AYAS_GOLDEN_VAULT;
  if (args.includes("--draft-next")) {
    const next: AyasGoldenVault = { schemaVersion: "1", version: vault.version + 1, previousDigest: ayasGoldenVaultDigest(vault), cases: vault.cases.map((item) => ({ ...item, pins: ayasGoldenPinsFor(repoRoot, item.script) })), gaps: vault.gaps };
    console.log(JSON.stringify({ status: "DRAFT_NOT_PUBLISHED", authority: "NONE", valid: isAyasGoldenVault(next), next }, null, 2));
    return;
  }
  const chainProblems = auditAyasGoldenVaultChain(AYAS_GOLDEN_VAULT_VERSIONS, AYAS_GOLDEN_VAULT_RETIRED);
  const pinDrift = verifyAyasGoldenVaultPins(vault, (file) => fs.readFileSync(path.join(repoRoot, file)));
  // A grader that starts importing a new fixture is not fully pinned until a new version says so.
  const unpinned = vault.cases.flatMap((item) => {
    try { return ayasGoldenScriptClosure(repoRoot, item.script).filter((file) => !item.pins.some((pin) => pin.file === file)); }
    catch { return [item.script]; }
  });
  const intact = chainProblems.length === 0 && pinDrift.length === 0 && unpinned.length === 0;
  const report: Record<string, unknown> = {
    status: intact ? "VAULT_INTACT" : "VAULT_CHANGED", authority: "NONE", version: vault.version, digest: ayasGoldenVaultDigest(vault),
    publishedVersions: AYAS_GOLDEN_VAULT_VERSIONS.length, cases: vault.cases.length, domains: [...new Set(vault.cases.map((item) => item.domain))].sort(),
    gaps: vault.gaps.map((gap) => gap.domain), chainProblems, pinDrift, unpinnedGraderFiles: [...new Set(unpinned)].sort(),
  };
  if (!intact) process.exitCode = 2;
  if (args.includes("--run")) {
    const { results, durationsMs } = runAyasGoldenVault(repoRoot, vault);
    const decision = evaluateAyasGoldenRegression({ vault, candidate: { vaultDigest: ayasGoldenVaultDigest(vault), pinDrift, results } });
    report.run = { decision: decision.decision, reasonCodes: decision.reasonCodes, failingCaseIds: decision.failingCaseIds, durationsMs, totalMs: Object.values(durationsMs).reduce((sum, ms) => sum + ms, 0) };
    if (decision.decision !== "GOLDEN_HELD") process.exitCode = 2;
  }
  console.log(JSON.stringify(report, null, 2));
}

try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
