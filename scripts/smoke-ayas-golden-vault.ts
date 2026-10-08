/** Stage 15O — golden vault contract, registry of record and path protection. Fixture vaults and one TEMP copy; no model, provider or network. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  AYAS_GOLDEN_DOMAINS, auditAyasGoldenVaultChain, ayasGoldenVaultDigest, evaluateAyasGoldenRegression, isAyasGoldenVault, verifyAyasGoldenVaultPins,
  type AyasGoldenCase, type AyasGoldenDomain, type AyasGoldenRun, type AyasGoldenVault,
} from "../src/lib/ayas/golden/AyasGoldenVault";
import { AYAS_GOLDEN_VAULT, AYAS_GOLDEN_VAULT_MODULE_DIR, AYAS_GOLDEN_VAULT_PINNED_FILES, AYAS_GOLDEN_VAULT_RETIRED, AYAS_GOLDEN_VAULT_VERSIONS } from "../src/lib/ayas/golden/AyasGoldenVaultRegistry";
import { classifyPatchSet, classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";
import { ayasGoldenScriptClosure } from "./lib/AyasGoldenVaultFiles";

let count = 0;
function scenario(name: string, run: () => void) { run(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

const repo = process.cwd();
const sha = (value: string | Uint8Array) => crypto.createHash("sha256").update(value).digest("hex");
const item = (id: string, domain: AyasGoldenDomain, over: Partial<AyasGoldenCase> = {}): AyasGoldenCase => {
  const script = `scripts/smoke-fixture-${id}.ts`;
  return { id: `golden.fixture.${id}`, domain, script, covers: `fixture ${id}`, pins: [{ file: script, sha256: sha(script) }], ...over };
};
/** Seven domains with one case each and the eighth as a declared gap. */
const fixture = (over: Partial<AyasGoldenVault> = {}): AyasGoldenVault => ({
  schemaVersion: "1", version: 1, previousDigest: null,
  cases: AYAS_GOLDEN_DOMAINS.filter((domain) => domain !== "REVENUE_DRY_RUN").map((domain, index) => item(`c${index + 1}`, domain)),
  gaps: [{ domain: "REVENUE_DRY_RUN", missing: "no adapter yet", reevaluateWhen: "an adapter exists" }],
  ...over,
});
const runOf = (vault: AyasGoldenVault, failing: readonly string[] = [], timedOut: readonly string[] = [], over: Partial<AyasGoldenRun> = {}): AyasGoldenRun => ({
  vaultDigest: ayasGoldenVaultDigest(vault), pinDrift: [],
  results: vault.cases.map((entry) => ({ id: entry.id, pass: !failing.includes(entry.id) && !timedOut.includes(entry.id), timedOut: timedOut.includes(entry.id) })), ...over,
});
const decide = (vault: AyasGoldenVault, candidate: AyasGoldenRun | null, baseline?: AyasGoldenRun | null) => evaluateAyasGoldenRegression({ vault, candidate, ...(baseline === undefined ? {} : { baseline }) });

scenario("the design's own list: eight domains, and the vault of record gives each one a case or a declared gap", () => {
  const order = fs.readFileSync(path.join(repo, "docs/ayas-execution/2026-09-27-master/00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md"), "utf8").replace(/\r\n/g, "\n");
  const section = order.slice(order.indexOf("## STAGE 15O"), order.indexOf("## STAGE 15P"));
  const listed = section.slice(section.indexOf("Permanent versioned protected suite:"), section.indexOf("Flow:")).split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
  assert.deepEqual(listed, ["conversation", "memory/retrieval correction", "coding repair", "security/adversarial", "production recovery", "2–3 historical golden-video projects", "revenue dry-run", "Brain UI functional regressions"]);
  assert.deepEqual([...AYAS_GOLDEN_DOMAINS], ["CONVERSATION", "MEMORY_RETRIEVAL", "CODING_REPAIR", "SECURITY_ADVERSARIAL", "PRODUCTION_RECOVERY", "HISTORICAL_VIDEO", "REVENUE_DRY_RUN", "BRAIN_UI"]);
  assert.equal(listed.length, AYAS_GOLDEN_DOMAINS.length);
  assert.match(section, /Agent cannot silently rewrite vault\./); assert.match(section, /One metric improves but golden regresses => promotion stops\./);
  assert.ok(isAyasGoldenVault(AYAS_GOLDEN_VAULT));
  const withCase = new Set(AYAS_GOLDEN_VAULT.cases.map((entry) => entry.domain)); const withGap = new Set(AYAS_GOLDEN_VAULT.gaps.map((gap) => gap.domain));
  for (const domain of AYAS_GOLDEN_DOMAINS) assert.ok(withCase.has(domain) || withGap.has(domain), domain);
  // What is not there yet is said, not implied: no revenue case exists, and video has cases and still declares what is missing.
  assert.ok(!withCase.has("REVENUE_DRY_RUN") && withGap.has("REVENUE_DRY_RUN")); assert.ok(withCase.has("HISTORICAL_VIDEO") && withGap.has("HISTORICAL_VIDEO"));
});

scenario("contract: a vault is read only in its own shape", () => {
  assert.ok(isAyasGoldenVault(fixture()));
  const first = fixture().cases[0]!;
  const bad: unknown[] = [null, [], {}, { ...fixture(), approved: true }, { ...fixture(), schemaVersion: "2" }, { ...fixture(), version: 0 }, { ...fixture(), version: 1.5 },
    { ...fixture(), previousDigest: "a".repeat(64) }, { ...fixture(), version: 2, previousDigest: null }, { ...fixture(), version: 2, previousDigest: "short" }, { ...fixture(), cases: [] },
    { ...fixture(), cases: [...fixture().cases, first] }, // duplicate id and script
    { ...fixture(), cases: [...fixture().cases.slice(1), { ...first, id: fixture().cases[1]!.id }] },
    { ...fixture(), cases: [...fixture().cases.slice(1), { ...first, script: fixture().cases[1]!.script, pins: fixture().cases[1]!.pins }] },
    { ...fixture(), cases: [...fixture().cases.slice(1), { ...first, id: "conversation.one" }] }, { ...fixture(), cases: [...fixture().cases.slice(1), { ...first, domain: "MARKETING" }] },
    { ...fixture(), cases: [...fixture().cases.slice(1), { ...first, covers: " " }] }, { ...fixture(), cases: [...fixture().cases.slice(1), { ...first, pins: [] }] },
    { ...fixture(), cases: [...fixture().cases.slice(1), { ...first, authority: "OWNER" }] },
    { ...fixture(), cases: [...fixture().cases.slice(1), { ...first, script: "scripts/run-live.ts", pins: [{ file: "scripts/run-live.ts", sha256: sha("x") }] }] },
    // The script itself must be pinned, and a pin is a repository file under scripts/ with a real digest.
    { ...fixture(), cases: [...fixture().cases.slice(1), { ...first, pins: [{ file: "scripts/fixtures/other.ts", sha256: sha("x") }] }] },
    ...["scripts/../secret.ts", "../scripts/a.ts", "/scripts/a.ts", "scripts\\a.ts", "src/lib/a.ts", "scripts/a.sh", "scripts//a.ts"].map((file) => ({ ...fixture(), cases: [...fixture().cases.slice(1), { ...first, pins: [...first.pins, { file, sha256: sha("x") }] }] })),
    { ...fixture(), cases: [...fixture().cases.slice(1), { ...first, pins: [...first.pins, { file: "scripts/fixtures/a.ts", sha256: "A".repeat(64) }] }] },
    { ...fixture(), cases: [...fixture().cases.slice(1), { ...first, pins: [...first.pins, first.pins[0]] }] },
    { ...fixture(), cases: [...fixture().cases.slice(1), { ...first, pins: [{ ...first.pins[0], note: "x" }] }] },
    // A domain may not disappear: with its only case gone and no gap declared, the vault is not a vault.
    { ...fixture(), cases: fixture().cases.slice(1) }, { ...fixture(), gaps: [] },
    { ...fixture(), gaps: [...fixture().gaps, ...fixture().gaps] }, { ...fixture(), gaps: [{ domain: "REVENUE_DRY_RUN", missing: "", reevaluateWhen: "x" }] },
    { ...fixture(), gaps: [{ domain: "REVENUE_DRY_RUN", missing: "x", reevaluateWhen: "x", waived: true }] }, { ...fixture(), gaps: [{ domain: "OTHER", missing: "x", reevaluateWhen: "x" }] }];
  bad.forEach((value, index) => assert.equal(isAyasGoldenVault(value), false, `variant ${index}`));
  // A domain may have cases and still declare what is missing.
  assert.ok(isAyasGoldenVault({ ...fixture(), gaps: [...fixture().gaps, { domain: "HISTORICAL_VIDEO", missing: "whole projects", reevaluateWhen: "they exist" }] }));
});

scenario("digest: independent of key order, changed by any pinned byte, case, gap or version", () => {
  const vault = fixture(); const digest = ayasGoldenVaultDigest(vault);
  assert.match(digest, /^[a-f0-9]{64}$/);
  const reordered = JSON.parse(JSON.stringify({ gaps: vault.gaps, cases: vault.cases.map((entry) => ({ pins: entry.pins, covers: entry.covers, script: entry.script, domain: entry.domain, id: entry.id })), previousDigest: null, version: 1, schemaVersion: "1" })) as AyasGoldenVault;
  assert.equal(ayasGoldenVaultDigest(reordered), digest);
  const first = vault.cases[0]!;
  for (const changed of [{ ...vault, version: 2, previousDigest: "a".repeat(64) }, { ...vault, gaps: [{ ...vault.gaps[0]!, missing: "something else" }] },
    { ...vault, cases: [{ ...first, pins: [{ ...first.pins[0]!, sha256: sha("one byte different") }] }, ...vault.cases.slice(1)] }, { ...vault, cases: [{ ...first, covers: "reworded" }, ...vault.cases.slice(1)] },
    { ...vault, cases: [...vault.cases.slice(1), first] }]) assert.notEqual(ayasGoldenVaultDigest(changed as AyasGoldenVault), digest);
});

scenario("chain: versions are contiguous, each names the one before it, and a case leaves only by name", () => {
  const v1 = fixture(); const next = (over: Partial<AyasGoldenVault> = {}): AyasGoldenVault => ({ ...v1, version: 2, previousDigest: ayasGoldenVaultDigest(v1), ...over });
  assert.deepEqual(auditAyasGoldenVaultChain([v1]), []); assert.deepEqual(auditAyasGoldenVaultChain([v1, next()]), []);
  assert.deepEqual(auditAyasGoldenVaultChain([]), ["CHAIN_EMPTY"]);
  assert.deepEqual(auditAyasGoldenVaultChain([v1, { ...next(), version: 3 }]), ["VERSION_NOT_CONTIGUOUS"]);
  assert.deepEqual(auditAyasGoldenVaultChain([next()]), ["PREVIOUS_DIGEST_MISMATCH", "VERSION_NOT_CONTIGUOUS"]);
  assert.deepEqual(auditAyasGoldenVaultChain([v1, next({ previousDigest: "b".repeat(64) })]), ["PREVIOUS_DIGEST_MISMATCH"]);
  assert.deepEqual(auditAyasGoldenVaultChain([v1, { ...next(), extra: 1 } as unknown as AyasGoldenVault]), ["VERSION_INVALID"]);
  // A published version edited in place no longer matches what the next one recorded.
  const edited = { ...v1, cases: [{ ...v1.cases[0]!, covers: "quietly weakened" }, ...v1.cases.slice(1)] };
  assert.deepEqual(auditAyasGoldenVaultChain([edited, next()]), ["PREVIOUS_DIGEST_MISMATCH"]);
  // Adding a case and re-pinning one are ordinary; dropping one silently is not.
  const added = next({ cases: [...v1.cases, item("extra", "CONVERSATION")] }); assert.deepEqual(auditAyasGoldenVaultChain([v1, added]), []);
  const second = item("c1b", "CONVERSATION"); const dropped = next({ cases: [second, ...v1.cases.slice(1)] }); const gone = v1.cases[0]!.id;
  assert.deepEqual(auditAyasGoldenVaultChain([v1, dropped]), ["CASE_REMOVED_WITHOUT_RECORD"]);
  assert.deepEqual(auditAyasGoldenVaultChain([v1, dropped], { 2: { [gone]: "replaced by a stricter case" } }), []);
  const records: readonly Record<number, Record<string, string>>[] = [{ 2: { [gone]: "" } }, { 2: { [gone]: "reason", "golden.fixture.never-existed": "reason" } }, { 2: { [gone]: "reason", [v1.cases[1]!.id]: "still present" } }, { 2: { [gone]: "reason" }, 9: { x: "no such version" } }];
  for (const record of records) {
    assert.ok(auditAyasGoldenVaultChain([v1, dropped], record).includes("RETIREMENT_RECORD_INVALID"), JSON.stringify(record));
  }
});

scenario("the vault of record: clean chain, pins equal the working tree and each script's whole grader closure", () => {
  assert.deepEqual(auditAyasGoldenVaultChain(AYAS_GOLDEN_VAULT_VERSIONS, AYAS_GOLDEN_VAULT_RETIRED), []);
  // A published version keeps its digest. The chain alone would accept a version edited in place together with a
  // re-linked successor; this list would not. Publishing a version appends one digest here.
  assert.deepEqual(AYAS_GOLDEN_VAULT_VERSIONS.map((vault) => ayasGoldenVaultDigest(vault)), [
    "1532277d2b7220fbc6eb774dbd623e648e5cab74e17cdb7ad3953584eedeba1c",
    "5f2fbf0b529f381caecd44651af2e642280bbfbc1bd7e761ca79d87dc2024a3f",
    "4cc8762192344fb7d052d4d9b281b327661ec0840688e642c6bb7fe79824efd5",
  ]);
  // Version 2 kept every case of version 1 with the same pinned bytes and added the golden video projects.
  const [first, second, third] = AYAS_GOLDEN_VAULT_VERSIONS; assert.ok(first && second && third);
  for (const entry of first.cases) assert.deepEqual(second.cases.find((candidate) => candidate.id === entry.id), entry, entry.id);
  assert.deepEqual(second.cases.filter((entry) => !first.cases.some((candidate) => candidate.id === entry.id)).map((entry) => [entry.id, entry.domain]), [["golden.video.historical-projects", "HISTORICAL_VIDEO"]]);
  // Version 3 moved only the frozen retrieval case to its exact12 successor grader; every other case and every gap is version 2's.
  assert.deepEqual(third.cases.map((entry) => entry.id), second.cases.map((entry) => entry.id)); assert.deepEqual(third.gaps, second.gaps);
  for (const entry of second.cases) if (entry.id !== "golden.memory.retrieval-evaluation") assert.deepEqual(third.cases.find((candidate) => candidate.id === entry.id), entry, entry.id);
  assert.equal(third.cases.find((entry) => entry.id === "golden.memory.retrieval-evaluation")?.script, "scripts/smoke-ayas-retrieval-evaluation-v3.ts");
  assert.equal(AYAS_GOLDEN_VAULT, AYAS_GOLDEN_VAULT_VERSIONS[AYAS_GOLDEN_VAULT_VERSIONS.length - 1]);
  assert.ok(Object.isFrozen(AYAS_GOLDEN_VAULT_VERSIONS) && Object.isFrozen(AYAS_GOLDEN_VAULT_PINNED_FILES));
  assert.deepEqual(verifyAyasGoldenVaultPins(AYAS_GOLDEN_VAULT, (file) => fs.readFileSync(path.join(repo, file))), []);
  for (const entry of AYAS_GOLDEN_VAULT.cases) {
    // Every file under scripts/ a golden script imports decides its result, so every one is pinned: no more, no less.
    assert.deepEqual(entry.pins.map((pin) => pin.file), ayasGoldenScriptClosure(repo, entry.script), entry.id);
    // LF only, so the bytes are the same in a clone as in this tree.
    for (const pin of entry.pins) assert.ok(!fs.readFileSync(path.join(repo, pin.file)).includes(13), `${pin.file} has a carriage return`);
  }
  assert.deepEqual([...AYAS_GOLDEN_VAULT_PINNED_FILES], [...new Set(AYAS_GOLDEN_VAULT_VERSIONS.flatMap((vault) => vault.cases.flatMap((entry) => entry.pins.map((pin) => pin.file))))].sort());
  assert.ok(AYAS_GOLDEN_VAULT.cases.length >= 15 && new Set(AYAS_GOLDEN_VAULT.cases.map((entry) => entry.domain)).size >= 7);
});

scenario("pins: one changed byte or a missing file is drift, and an invalid vault verifies nothing", () => {
  const vault = fixture(); const bytes = (file: string) => Buffer.from(file);
  assert.deepEqual(verifyAyasGoldenVaultPins(vault, bytes), []);
  const target = vault.cases[2]!.script;
  assert.deepEqual(verifyAyasGoldenVaultPins(vault, (file) => (file === target ? Buffer.from(`${file} `) : bytes(file))), [target]);
  assert.deepEqual(verifyAyasGoldenVaultPins(vault, (file) => { if (file === target) throw new Error("ENOENT"); return bytes(file); }), [target]);
  assert.deepEqual(verifyAyasGoldenVaultPins({ ...vault, cases: [] }, bytes), ["VAULT_INVALID"]);
});

scenario("gate: held only when every case is golden in the candidate tree", () => {
  const vault = fixture(); const held = decide(vault, runOf(vault));
  assert.deepEqual([held.decision, held.reasonCodes, held.failingCaseIds, held.regressedCaseIds, held.cases, held.vaultVersion, held.authority], ["GOLDEN_HELD", ["ALL_GOLDEN_CASES_HELD"], [], [], 7, 1, "NONE"]);
  assert.equal(held.vaultDigest, ayasGoldenVaultDigest(vault));
  // A gap is reported with a held decision too; held speaks for the cases that exist and nothing else.
  assert.deepEqual(held.gapDomains, ["REVENUE_DRY_RUN"]);
});

scenario("gate: one golden case red stops promotion, whatever else improved", () => {
  const vault = fixture(); const [a, b] = [vault.cases[0]!.id, vault.cases[3]!.id];
  const stopped = decide(vault, runOf(vault, [a]));
  assert.deepEqual([stopped.decision, stopped.failingCaseIds, stopped.regressedCaseIds, stopped.reasonCodes], ["PROMOTION_STOPPED", [a], [], ["GOLDEN_CASE_FAILED", "BASELINE_NOT_SUPPLIED"]]);
  assert.deepEqual(decide(vault, runOf(vault, [], [b])).reasonCodes, ["GOLDEN_CASE_TIMEOUT", "BASELINE_NOT_SUPPLIED"]);
  assert.deepEqual(decide(vault, runOf(vault, [a], [b])).failingCaseIds, [a, b]);
  // A result that says both "passed" and "timed out" is not a pass.
  const contradictory = runOf(vault); const forged = { ...contradictory, results: contradictory.results.map((result) => (result.id === a ? { ...result, pass: true, timedOut: true } : result)) };
  assert.deepEqual(decide(vault, forged).failingCaseIds, [a]);
});

scenario("gate: a baseline only says whose fault it is; it never rescues a red candidate", () => {
  const vault = fixture(); const [a, b] = [vault.cases[0]!.id, vault.cases[1]!.id];
  const regressed = decide(vault, runOf(vault, [a]), runOf(vault));
  assert.deepEqual([regressed.decision, regressed.regressedCaseIds, regressed.reasonCodes], ["PROMOTION_STOPPED", [a], ["GOLDEN_CASE_FAILED", "REGRESSED_BY_CHANGE"]]);
  const preexisting = decide(vault, runOf(vault, [a]), runOf(vault, [a]));
  assert.deepEqual([preexisting.decision, preexisting.regressedCaseIds, preexisting.reasonCodes], ["PROMOTION_STOPPED", [], ["GOLDEN_CASE_FAILED", "NOT_GOLDEN_AT_BASELINE"]]);
  const mixed = decide(vault, runOf(vault, [a, b]), runOf(vault, [a]));
  assert.deepEqual([mixed.failingCaseIds, mixed.regressedCaseIds, mixed.reasonCodes], [[a, b], [b], ["GOLDEN_CASE_FAILED", "NOT_GOLDEN_AT_BASELINE", "REGRESSED_BY_CHANGE"]]);
  // The candidate tree decides: a red baseline does not stop a candidate in which every case is golden.
  assert.equal(decide(vault, runOf(vault), runOf(vault, [a])).decision, "GOLDEN_HELD");
  assert.equal(decide(vault, runOf(vault, [a]), null).decision, "PROMOTION_STOPPED");
  // A baseline may answer for the red cases only; a red case it does not name stays unexplained.
  const answer = (results: unknown) => decide(vault, runOf(vault, [a, b]), { ...runOf(vault), results } as AyasGoldenRun);
  const partial = answer([{ id: a, pass: true, timedOut: false }]);
  assert.deepEqual([partial.decision, partial.regressedCaseIds, partial.reasonCodes], ["PROMOTION_STOPPED", [a], ["GOLDEN_CASE_FAILED", "BASELINE_NOT_SUPPLIED", "REGRESSED_BY_CHANGE"]]);
  assert.deepEqual(answer([{ id: a, pass: false, timedOut: false }, { id: b, pass: true, timedOut: true }]).reasonCodes, ["GOLDEN_CASE_FAILED", "NOT_GOLDEN_AT_BASELINE"]);
  // A baseline that names a case this vault does not have, names one twice or is malformed explains nothing.
  for (const results of [[{ id: "golden.fixture.unknown", pass: true, timedOut: false }], [{ id: a, pass: true, timedOut: false }, { id: a, pass: true, timedOut: false }],
    [{ id: a, pass: "true", timedOut: false }], [{ id: a, pass: true }], "all golden", [...runOf(vault).results, { id: a, pass: true, timedOut: false }]]) {
    assert.deepEqual([answer(results).regressedCaseIds, answer(results).reasonCodes], [[], ["GOLDEN_CASE_FAILED", "BASELINE_NOT_SUPPLIED"]], JSON.stringify(results).slice(0, 80));
  }
});

scenario("gate: what was not measured is never held", () => {
  const vault = fixture(); const full = runOf(vault);
  assert.deepEqual([decide(vault, null).decision, decide(vault, null).reasonCodes], ["GOLDEN_NOT_MEASURED", ["CANDIDATE_NOT_RUN"]]);
  const unknown = { id: "golden.fixture.unknown", pass: true, timedOut: false };
  for (const results of [[], full.results.slice(1), [...full.results, full.results[0]!], [...full.results.slice(1), unknown], [...full.results.slice(1), full.results[1]!],
    [...full.results.slice(1), { id: full.results[0]!.id, pass: "true", timedOut: false }], [...full.results.slice(1), { id: full.results[0]!.id, pass: true }], [...full.results.slice(1), null]]) {
    const result = decide(vault, { ...full, results } as unknown as AyasGoldenRun);
    assert.deepEqual([result.decision, result.reasonCodes], ["GOLDEN_NOT_MEASURED", ["CANDIDATE_RESULTS_INCOMPLETE"]], JSON.stringify(results).slice(0, 80));
  }
  assert.equal(decide(vault, { ...full, results: "all passed" } as unknown as AyasGoldenRun).decision, "GOLDEN_NOT_MEASURED");
  assert.equal(decide(vault, "GOLDEN_HELD" as unknown as AyasGoldenRun).decision, "GOLDEN_NOT_MEASURED");
});

scenario("gate: a moved yardstick is not a comparison", () => {
  const vault = fixture(); const full = runOf(vault);
  assert.deepEqual(decide(vault, { ...full, vaultDigest: "c".repeat(64) }).reasonCodes, ["VAULT_DIGEST_MISMATCH"]);
  assert.deepEqual(decide(vault, { ...full, pinDrift: [vault.cases[0]!.script] }).reasonCodes, ["CANDIDATE_PIN_DRIFT"]);
  assert.deepEqual(decide(vault, { ...full, pinDrift: undefined } as unknown as AyasGoldenRun).reasonCodes, ["CANDIDATE_PIN_DRIFT"]);
  assert.deepEqual(decide(vault, full, { ...full, vaultDigest: "c".repeat(64) }).reasonCodes, ["VAULT_DIGEST_MISMATCH"]);
  assert.deepEqual(decide(vault, full, { ...full, pinDrift: ["scripts/x.ts"] }).reasonCodes, ["BASELINE_PIN_DRIFT"]);
  for (const result of [decide(vault, { ...full, vaultDigest: "c".repeat(64) }), decide(vault, { ...full, pinDrift: ["scripts/x.ts"] }), decide(vault, full, { ...full, pinDrift: ["scripts/x.ts"] })]) assert.equal(result.decision, "GOLDEN_VAULT_CHANGED");
  // Results measured against another version of the vault say nothing about this one, even when every one passed.
  const other = fixture({ cases: [...fixture().cases, item("extra", "BRAIN_UI")] });
  assert.equal(decide(vault, runOf(other)).decision, "GOLDEN_VAULT_CHANGED");
  const invalid = decide({ ...vault, cases: [] }, full);
  assert.deepEqual([invalid.decision, invalid.reasonCodes, invalid.vaultDigest, invalid.vaultVersion, invalid.cases], ["GOLDEN_VAULT_CHANGED", ["VAULT_INVALID"], null, null, 0]);
  // The yardstick is checked before the results: drift with a failing case reports the drift.
  assert.equal(decide(vault, { ...runOf(vault, [vault.cases[0]!.id]), pinDrift: ["scripts/x.ts"] }).decision, "GOLDEN_VAULT_CHANGED");
});

scenario("path protection: the vault, what it pins, the eval yardstick and the owner constitution are never autonomous", () => {
  const forbidden = [...AYAS_GOLDEN_VAULT_PINNED_FILES, `${AYAS_GOLDEN_VAULT_MODULE_DIR}AyasGoldenVault.ts`, `${AYAS_GOLDEN_VAULT_MODULE_DIR}AyasGoldenVaultRegistry.ts`, `${AYAS_GOLDEN_VAULT_MODULE_DIR}Anything.ts`,
    "scripts/ayas-golden-vault.ts", "scripts/lib/AyasGoldenVaultFiles.ts", "scripts/smoke-ayas-golden-vault.ts", "scripts/smoke-ayas-golden-vault-mutations.ts", "scripts/smoke-ayas-golden-vault-operator.ts", "scripts/smoke-ayas-golden-vault-run.ts",
    "scripts/fixtures/ayas-golden-fixtures.ts", "scripts/smoke-ayas-golden-experiment-gate.ts", "scripts/smoke-ayas-golden-experiment-gate-mutations.ts", "scripts/smoke-ayas-golden-sandbox-run.ts", "scripts/smoke-ayas-golden-video-projects-mutations.ts",
    "scripts/ayas-eval-baseline.ts", "src/lib/ayas/observability/AyasEvalGovernance.ts", "docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15F/EVAL_MANIFEST.json",
    "src/lib/ayas/governance/AyasOwnerConstitution.ts", "src/lib/ayas/governance/AyasOwnerConstitutionReader.ts", "src/lib/ayas/governance/AyasOwnerConstitutionStore.ts", "src/lib/ayas/governance/New.ts",
    "app/brain/constitution/page.tsx", "app/brain/constitution/actions.ts"];
  assert.ok(AYAS_GOLDEN_VAULT_PINNED_FILES.length >= 20);
  for (const file of forbidden) {
    for (const spelled of [file, `./${file}`, file.replace(/\//g, "\\"), file.toUpperCase(), ` ${file} `]) assert.equal(classifyPatchTarget(spelled).level, "FORBIDDEN_AUTONOMOUS", spelled);
    assert.ok(fs.existsSync(path.join(repo, file)) || /(?:New|Anything)\.ts$/.test(file), `${file} is protected but does not exist`);
  }
  // One protected file makes the whole set never-autonomous, next to any number of ordinary ones.
  assert.equal(classifyPatchSet(["scripts/smoke-x.ts", "docs/x.md", AYAS_GOLDEN_VAULT_PINNED_FILES[0]!]).level, "FORBIDDEN_AUTONOMOUS");
  // The protection is exact: an ordinary test or document is still what it was.
  for (const ordinary of ["scripts/smoke-x.ts", "scripts/smoke-ayas-memory.ts", "docs/x.md", "docs/ayas-execution/2026-09-27-master/EXECUTION_LEDGER.md"]) assert.equal(classifyPatchTarget(ordinary).level, "SAFE", ordinary);
  assert.equal(classifyPatchTarget("src/lib/ayas/memory/AyasMemoryTemporal.ts").level, "REVIEW_REQUIRED");
});

scenario("evidence, not authority: the contract is pure, the registry is data, and only the flow it gates reads the vault", () => {
  const contract = fs.readFileSync(path.join(repo, "src/lib/ayas/golden/AyasGoldenVault.ts"), "utf8");
  assert.deepEqual([...contract.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]), ["node:crypto"]);
  assert.doesNotMatch(contract, /node:fs|child_process|Date\.now|new Date|fetch\(|process\.env|require\(/);
  // Every decision says so itself: there is no result shape without `authority: "NONE"`.
  assert.ok(Object.values({ held: decide(fixture(), runOf(fixture())), stopped: decide(fixture(), runOf(fixture(), [fixture().cases[0]!.id])), unmeasured: decide(fixture(), null), moved: decide({ ...fixture(), cases: [] }, null) }).every((result) => result.authority === "NONE"));
  const registry = fs.readFileSync(path.join(repo, "src/lib/ayas/golden/AyasGoldenVaultRegistry.ts"), "utf8");
  assert.deepEqual([...registry.matchAll(/^import (.*) from "([^"]+)";$/gm)].map((match) => [match[1], match[2]]), [["type { AyasGoldenVault }", "./AyasGoldenVault"]]);
  // Who reads the vault: the patch-safety table, and the improvement flow it gates — the sandbox that runs it, the
  // experiment runner and its evaluation, the cycle, and every step that turns evidence into something an owner can approve.
  const importers: string[] = [];
  const walk = (dir: string) => { for (const entry of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) { if (entry.name !== "node_modules" && !entry.name.startsWith(".")) walk(relative); }
    else if (/\.tsx?$/.test(entry.name) && /from\s+["'][^"']*\/golden\/AyasGoldenVault(?:Registry)?["']/.test(fs.readFileSync(path.join(repo, relative), "utf8"))) importers.push(relative);
  } };
  for (const root of ["src", "app", "scripts"]) if (fs.existsSync(path.join(repo, root))) walk(root);
  assert.deepEqual(importers.filter((file) => file.startsWith("src/")).sort(), [
    "src/lib/ayas/evolution/AyasControlledSelfEvolutionArtifact.ts", "src/lib/ayas/evolution/AyasControlledSelfEvolutionBridge.ts", "src/lib/ayas/evolution/AyasControlledSelfEvolutionCycle.ts",
    "src/lib/brain/autonomy/AyasExactProposalSafety.ts", "src/lib/brain/autonomy/AyasRegisteredImprovementExperiment.ts", "src/lib/brain/autonomy/AyasResearchExperimentEvaluation.ts",
    "src/lib/brain/autonomy/AyasResearchExperimentSandbox.ts", "src/lib/brain/autonomy/AyasResearchImprovementCycle.ts", "src/lib/brain/selfheal/BrainPatchSafety.ts",
  ].filter((file) => fs.existsSync(path.join(repo, file))));
  // Outside src/ only the operator script, its library, the fixtures and the suites read it; no page or route does.
  assert.deepEqual(importers.filter((file) => !file.startsWith("src/") && !/^scripts\/(?:ayas-golden-vault\.ts|lib\/AyasGoldenVaultFiles\.ts|fixtures\/ayas-golden-fixtures\.ts|smoke-ayas-[a-z0-9-]+\.ts)$/.test(file)), []);
});

console.log(JSON.stringify({ status: "PASS", suite: "ayas-golden-vault", scenarios: count, vaultVersion: AYAS_GOLDEN_VAULT.version, cases: AYAS_GOLDEN_VAULT.cases.length, gaps: AYAS_GOLDEN_VAULT.gaps.length, modelRuns: 0 }));
