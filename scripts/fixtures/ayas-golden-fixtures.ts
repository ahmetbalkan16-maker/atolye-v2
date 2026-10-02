/** Stage 15O fixtures: a golden vault for a TEMP fixture repository, and the evidence block a held run leaves. Nothing here touches a live path. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { AYAS_GOLDEN_DOMAINS, ayasGoldenVaultDigest, type AyasGoldenVault } from "../../src/lib/ayas/golden/AyasGoldenVault";
import { AYAS_GOLDEN_VAULT } from "../../src/lib/ayas/golden/AyasGoldenVaultRegistry";
import type { AyasExperimentGoldenEvidence } from "../../src/lib/brain/autonomy/AyasResearchExperimentEvaluation";

/**
 * A vault over a fixture repository's own suites, pinned to the bytes that repository has now. Each script becomes one
 * case of the first domains in order; every other canonical domain is a declared gap, as in a real vault.
 */
export function fixtureGoldenVault(root: string, scripts: readonly string[] = ["scripts/smoke-fixture-guard.ts"], pinned: Readonly<Record<string, readonly string[]>> = {}): AyasGoldenVault {
  const pin = (file: string) => ({ file, sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex") });
  const cases = scripts.map((script, index) => ({
    id: `golden.fixture.case-${index + 1}`, domain: AYAS_GOLDEN_DOMAINS[index]!, script, covers: `fixture golden case ${index + 1}`,
    pins: [...new Set([script, ...(pinned[script] ?? [])])].sort().map(pin),
  }));
  return { schemaVersion: "1", version: 1, previousDigest: null, cases,
    gaps: AYAS_GOLDEN_DOMAINS.slice(scripts.length).map((domain) => ({ domain, missing: "fixture repository has no case here", reevaluateWhen: "never; this is a fixture" })) };
}

/** The golden block of an experiment whose candidate tree held every case of `vault`. */
export function heldGoldenEvidence(vault: AyasGoldenVault = AYAS_GOLDEN_VAULT, reused: readonly string[] = []): AyasExperimentGoldenEvidence {
  return {
    vaultVersion: vault.version, vaultDigest: ayasGoldenVaultDigest(vault), decision: "GOLDEN_HELD", reasonCodes: ["ALL_GOLDEN_CASES_HELD"],
    cases: vault.cases.map((item) => ({ id: item.id, script: item.script, pass: true, timedOut: false, reused: reused.includes(item.script) })),
    failingCaseIds: [], regressedCaseIds: [], gapDomains: vault.gaps.map((gap) => gap.domain),
  };
}
