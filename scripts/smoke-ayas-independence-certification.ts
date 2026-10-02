/** Stage 15H — no-cloud independence certification. Fixture facts, TEMP repositories and a loopback fixture server only; no model, no container, nothing written to this repository. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { execFileSync, spawnSync } from "node:child_process";

import {
  AYAS_INDEPENDENCE_CONDITIONS, AYAS_INDEPENDENCE_FAULTS, AYAS_MAINTENANCE_CHAIN,
  compareAyasIndependenceCertification, evaluateAyasIndependence, findAyasIndependenceProofProblems, sealAyasIndependenceCertification, verifyAyasIndependenceCertification,
  type AyasIndependenceCertificationBody, type AyasIndependenceProofFact, type AyasIndependenceRequirement, type AyasIndependenceRequirementFact, type AyasIndependenceRequirementKind,
} from "../src/lib/ayas/certification/AyasIndependenceCertification";
import {
  AYAS_INDEPENDENCE_EVAL_MANIFEST_FILE, collectAyasIndependenceCertification, collectAyasIndependenceCodingBackends, collectAyasIndependenceRequirementFacts,
  readAyasIndependenceBaselineReport, readAyasIndependenceEvalManifest,
} from "../src/lib/ayas/certification/AyasIndependenceCertificationCollector";
import { AYAS_INDEPENDENCE_EVIDENCE } from "../src/lib/ayas/certification/AyasIndependenceEvidenceMap";
import { auditAyasLifecycleEntry, type AyasLifecycleEntry, type AyasLifecycleEvidence } from "../src/lib/ayas/lifecycle/AyasLifecycle";
import { AYAS_LIFECYCLE_REGISTRY } from "../src/lib/ayas/lifecycle/AyasLifecycleRegistry";
import { canonicalAyasJson } from "../src/lib/ayas/provenance/AyasReleaseProvenance";
import { ayasSafePublicFetch } from "../src/lib/brain/autonomy/AyasSafePublicFetch";

let count = 0;
async function scenario(name: string, run: () => void | Promise<void>) { await run(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

const repo = process.cwd();
const sha256 = (value: string | Uint8Array) => crypto.createHash("sha256").update(value).digest("hex");
const HEAD = "1".repeat(40);
const MANIFEST_DIGEST = "2".repeat(64);
const CANON: readonly (readonly [AyasIndependenceRequirementKind, readonly string[]])[] = [["FAULT", AYAS_INDEPENDENCE_FAULTS], ["CHAIN", AYAS_MAINTENANCE_CHAIN], ["CONDITION", AYAS_INDEPENDENCE_CONDITIONS]];

const proof = (over: Partial<AyasIndependenceProofFact> = {}): AyasIndependenceProofFact => ({ suite: "fixture-a", scenario: "alpha holds", marker: null, pin: "MATCH", scenarioPresent: true, markerPresent: null, outcome: "PASS", ...over });
const requirements = (change?: (id: string, kind: AyasIndependenceRequirementKind) => readonly AyasIndependenceProofFact[] | undefined): AyasIndependenceRequirementFact[] =>
  CANON.flatMap(([kind, ids]) => ids.map((id) => ({ kind, id, claim: `fixture claim for ${id}`, limit: null, proofs: change?.(id, kind) ?? [proof()] })));
const body = (over: Partial<AyasIndependenceCertificationBody> = {}): AyasIndependenceCertificationBody => ({
  schemaVersion: "1", generatedAt: "2026-10-02T00:00:00.000Z",
  git: { head: HEAD, treeState: "CLEAN", dirtyPaths: 0 },
  evalManifest: { version: "15F.4-v1", digest: MANIFEST_DIGEST, suites: 2 },
  baseline: { state: "PRESENT", sha256: "3".repeat(64), sourceHead: HEAD, manifestDigest: MANIFEST_DIGEST, outcome: "PASS", complete: true, trials: 3, suites: 2, failed: 0 },
  requirements: requirements(),
  localCodingBackends: [{ id: "coding-model.fixture", state: "ACTIVE", admission: "PROMOTED", mayServeAutonomousCoding: true }],
  authority: "NONE", ...over,
});
/** One requirement's proofs replaced; every other requirement stays proven. */
const withProof = (kind: AyasIndependenceRequirementKind, id: string, over: Partial<AyasIndependenceProofFact>) => body({ requirements: requirements((i, k) => (k === kind && i === id ? [proof(over)] : undefined)) });
const statusOf = (evaluation: ReturnType<typeof evaluateAyasIndependence>, id: string) => evaluation.requirements.find((requirement) => requirement.id === id)!;

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-independence-"));
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", windowsHide: true }).trim();
}
const FIXTURE_SCRIPT = 'scenario("alpha holds", () => {});\nscenario("beta holds — exactly", () => { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); });\n';
/** A small Git repository with an eval manifest that pins two suites. */
function fixtureRepository(name: string): string {
  const root = path.join(temp, name);
  const write = (file: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  write("scripts/smoke-ayas-fixture-a.ts", FIXTURE_SCRIPT);
  write("scripts/fixtures/fixture-data.ts", "export const data = 1;\n");
  write("scripts/smoke-ayas-fixture-b.ts", 'scenario("gamma holds", () => {});\n');
  const pin = (file: string) => ({ file, sha256: sha256(fs.readFileSync(path.join(root, file))) });
  const suite = (id: string, files: readonly string[]) => ({ id, kind: "REGRESSION", script: `scripts/smoke-ayas-${id}.ts`, args: [], grading: "EXIT_STATUS", pins: files.map(pin), slices: ["deterministic-outcome"] });
  write(AYAS_INDEPENDENCE_EVAL_MANIFEST_FILE, `${JSON.stringify({ schemaVersion: "1", version: "15F.4-v1", definitionReview: "SOURCE_REVIEWED_OWNER_CALIBRATION_PENDING", modelGrader: "NONE",
    suites: [suite("fixture-a", ["scripts/smoke-ayas-fixture-a.ts", "scripts/fixtures/fixture-data.ts"]), suite("fixture-b", ["scripts/smoke-ayas-fixture-b.ts"])], excluded: [] }, null, 2)}\n`);
  write(".gitignore", "reports/\n");
  git(root, "init", "--quiet"); git(root, "add", "--all"); git(root, "commit", "--quiet", "--message", "fixture");
  return root;
}
function writeBaseline(root: string, over: Record<string, unknown> = {}): string {
  const report = { schemaVersion: "1", sourceHead: git(root, "rev-parse", "HEAD"), manifestDigest: readAyasIndependenceEvalManifest(root).digest, outcome: "PASS", completeDeclaredBaseline: true, trials: 3, failed: [],
    results: [{ id: "fixture-a", summary: { status: "PASS" } }, { id: "fixture-b", summary: { status: "PASS" } }], ...over };
  fs.mkdirSync(path.join(root, "reports"), { recursive: true });
  const file = path.join("reports", `baseline-${crypto.randomUUID()}.json`);
  fs.writeFileSync(path.join(root, file), `${JSON.stringify(report, null, 2)}\n`);
  return file;
}
const fixtureEvidence = (proofs: AyasIndependenceRequirement["proofs"] = [{ suite: "fixture-a", scenario: "alpha holds" }]): AyasIndependenceRequirement[] =>
  CANON.flatMap(([kind, ids]) => ids.map((id) => ({ kind, id, claim: `fixture claim for ${id}`, proofs })));
const evidencePass: AyasLifecycleEvidence = { result: "PASS", ref: "docs/fixture.md", summary: "fixture evidence" };
/** A coding model the lifecycle rules let serve autonomous coding: promoted and active, with every check on record. */
const servingCodingModel: AyasLifecycleEntry = {
  id: "coding-model.fixture", kind: "coding-model", role: "fixture-coding", label: "fixture coding model", identity: { type: "ollama-digest", tag: "fixture-coder:1", digest: "a".repeat(64) },
  state: "ACTIVE", admission: "PROMOTED", compatibility: "fixture",
  record: { capability: evidencePass, regression: evidencePass, security: evidencePass, hardwareFit: evidencePass, consistency: evidencePass, heldOut: evidencePass, resourceUse: evidencePass },
  rollbackTarget: null, history: (["DISCOVERED", "PINNED", "QUALIFIED", "SHADOW", "CANARY", "ACTIVE"] as const).map((state, index) => ({ state, on: `2026-09-0${index + 1}`, basis: "fixture" })), notes: "fixture",
};

async function withFixtureServer(handler: http.RequestListener, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

async function main() {
  try {
    await scenario("the matrix is the canonical one: every fault and every link of the master order, in its order, mapped exactly once", () => {
      const order = fs.readFileSync(path.join(repo, "docs/ayas-execution/2026-09-27-master/00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md"), "utf8").replace(/\r\n/g, "\n");
      const section = order.slice(order.indexOf("## STAGE 15H"), order.indexOf("## STAGE 15I"));
      assert.match(section, /^Cloud coding OFF\.$/m);
      const bullets = section.slice(section.indexOf("Fault matrix:"), section.indexOf("Representative maintenance task")).split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
      const named: Readonly<Record<string, string>> = {
        "process kill": "PROCESS_KILL", "reboot": "REBOOT", "model death": "MODEL_DEATH", "network loss": "NETWORK_LOSS", "DNS failure": "DNS_FAILURE", "429/500": "HTTP_429_500",
        "disk exhaustion fixture": "DISK_EXHAUSTION", "corrupt state": "CORRUPT_STATE", "backward/future clock": "CLOCK_BACKWARD_FUTURE", "duplicate daemon": "DUPLICATE_DAEMON",
        "stale Graphify": "STALE_GRAPHIFY", "needs_update": "GRAPHIFY_NEEDS_UPDATE", "delayed owner": "DELAYED_OWNER", "rejected proposal": "REJECTED_PROPOSAL",
        "stale proposal after new HEAD": "STALE_PROPOSAL_AFTER_NEW_HEAD", "failed regression": "FAILED_REGRESSION", "memory poisoning": "MEMORY_POISONING",
        "malicious repo content": "MALICIOUS_REPO_CONTENT", "dependency-install request": "DEPENDENCY_INSTALL_REQUEST", "invalid MCP/tool schema": "INVALID_TOOL_SCHEMA", "external auth expiry": "EXTERNAL_AUTH_EXPIRY",
      };
      assert.equal(bullets.length, 21);
      assert.deepEqual(bullets.map((bullet) => named[bullet]), [...AYAS_INDEPENDENCE_FAULTS], "the fault list is the master order's, in its order");
      const chain = /^detect -> .*$/m.exec(section)![0].replace(/\.$/, "").split(" -> ").map((step) => step.toUpperCase().replace(/[^A-Z]+/g, "_"));
      assert.deepEqual(chain, [...AYAS_MAINTENANCE_CHAIN]);
      assert.match(section, /`LOCAL_INDEPENDENCE_READY`/); assert.match(section, /`LOCAL_INDEPENDENCE_DEGRADED`/);

      for (const [kind, ids] of CANON) assert.deepEqual(AYAS_INDEPENDENCE_EVIDENCE.filter((requirement) => requirement.kind === kind).map((requirement) => requirement.id), [...ids], `${kind}: one entry each, in order`);
      assert.equal(AYAS_INDEPENDENCE_EVIDENCE.length, 32);
      for (const requirement of AYAS_INDEPENDENCE_EVIDENCE) {
        assert.ok(requirement.proofs.length >= 1 && requirement.claim.length > 20, requirement.id);
        assert.equal(new Set(requirement.proofs.map((item) => `${item.suite}\n${item.scenario}`)).size, requirement.proofs.length, `${requirement.id}: no proof twice`);
      }
    });

    await scenario("this repository: every proof names a declared suite whose pinned bytes hold the scenario and the marker", () => {
      const { manifest } = readAyasIndependenceEvalManifest(repo);
      const facts = collectAyasIndependenceRequirementFacts(repo, manifest, AYAS_INDEPENDENCE_EVIDENCE, null);
      for (const requirement of facts) for (const item of requirement.proofs) {
        assert.deepEqual([item.pin, item.scenarioPresent, item.markerPresent === false, item.outcome], ["MATCH", true, false, "ABSENT"], `${requirement.id}: ${item.suite} / ${item.scenario}`);
        const suite = manifest.suites.find((candidate) => candidate.id === item.suite)!;
        // Only a suite graded by its exit status can be read as "every scenario in it passed".
        assert.equal(suite.grading, "EXIT_STATUS", item.suite);
      }
      // With no baseline nothing is measured: bound proofs alone prove nothing.
      const evaluation = evaluateAyasIndependence(body({ baseline: { state: "ABSENT" }, requirements: facts }));
      assert.deepEqual([evaluation.result, evaluation.counts.proven, evaluation.counts.unproven, evaluation.counts.notMeasured], ["LOCAL_INDEPENDENCE_DEGRADED", 0, 0, 32]);
    });

    await scenario("ready needs everything at once: every requirement proven, a baseline of this commit and manifest, a clean tree, a coding backend that may serve", () => {
      const evaluation = evaluateAyasIndependence(body());
      assert.deepEqual([evaluation.result, evaluation.gaps, evaluation.counts], ["LOCAL_INDEPENDENCE_READY", [], { proven: 32, notMeasured: 0, unproven: 0, proofs: 32 }]);
      assert.equal(evaluateAyasIndependence(body({ git: { head: HEAD, treeState: "DIRTY", dirtyPaths: 1 } })).gaps.join(), "GIT_TREE_DIRTY");
      // The same facts always give the same evaluation.
      assert.equal(canonicalAyasJson(evaluateAyasIndependence(body())), canonicalAyasJson(evaluation));
    });

    await scenario("one broken binding or one failed suite is one unproven requirement, named with its cause", () => {
      const cases: readonly (readonly [Partial<AyasIndependenceProofFact>, string])[] = [
        [{ pin: "NOT_DECLARED" }, "SUITE_NOT_DECLARED"], [{ pin: "MISMATCH" }, "SUITE_PIN_MISMATCH"], [{ pin: "UNREADABLE" }, "SUITE_UNREADABLE"],
        [{ scenarioPresent: false }, "SCENARIO_NOT_IN_SUITE"], [{ marker: "ENOSPC", markerPresent: false }, "MARKER_NOT_IN_SUITE"],
        [{ outcome: "FAIL" }, "SUITE_FAILED"], [{ outcome: "NOT_RUN" }, "SUITE_NOT_RUN"], [{ outcome: "ABSENT" }, "SUITE_NOT_RUN"], [{ outcome: "PASS_WITH_KNOWN_LIMITATIONS" }, "SUITE_HAS_KNOWN_LIMITATIONS"],
      ];
      const subjects: readonly (readonly [AyasIndependenceRequirementKind, string, string])[] = [["FAULT", "DNS_FAILURE", "FAULT_UNPROVEN:DNS_FAILURE"], ["CHAIN", "LOCAL_PATCH", "CHAIN_LINK_UNPROVEN:LOCAL_PATCH"], ["CONDITION", "CLOUD_CODING_OFF", "CONDITION_UNPROVEN:CLOUD_CODING_OFF"]];
      for (const [over, problem] of cases) for (const [kind, id, gap] of subjects) {
        const evaluation = evaluateAyasIndependence(withProof(kind, id, over));
        assert.deepEqual([evaluation.result, evaluation.gaps, statusOf(evaluation, id).status, statusOf(evaluation, id).problems], ["LOCAL_INDEPENDENCE_DEGRADED", [gap], "UNPROVEN", [`${problem}:fixture-a`]], `${id} ${problem}`);
        assert.equal(evaluation.counts.proven, 31);
      }
      // Every proof of a requirement has to hold, not just one of them.
      const mixed = evaluateAyasIndependence(body({ requirements: requirements((id) => (id === "REBOOT" ? [proof(), proof({ suite: "fixture-b", scenario: "gamma holds", outcome: "FAIL" })] : undefined)) }));
      assert.deepEqual([statusOf(mixed, "REBOOT").status, statusOf(mixed, "REBOOT").problems, mixed.gaps], ["UNPROVEN", ["SUITE_FAILED:fixture-b"], ["FAULT_UNPROVEN:REBOOT"]]);
      // A marker that is present, and a proof that names none, are both fine; an unbound suite reports its binding only.
      assert.deepEqual(findAyasIndependenceProofProblems(proof({ marker: "x", markerPresent: true }), true), []);
      assert.deepEqual(findAyasIndependenceProofProblems(proof({ pin: "MISMATCH", scenarioPresent: false, marker: "x", markerPresent: false }), true), ["SUITE_PIN_MISMATCH"]);
    });

    await scenario("unmeasured is never a pass: no baseline, another commit's, another manifest's, an incomplete or failed one", () => {
      const present = body().baseline as Extract<AyasIndependenceCertificationBody["baseline"], { state: "PRESENT" }>;
      const absent = evaluateAyasIndependence(body({ baseline: { state: "ABSENT" } }));
      assert.deepEqual([absent.result, absent.gaps, absent.counts.notMeasured, statusOf(absent, "PROCESS_KILL").problems], ["LOCAL_INDEPENDENCE_DEGRADED", ["BASELINE_ABSENT"], 32, ["NOT_MEASURED:fixture-a"]]);
      const otherHead = evaluateAyasIndependence(body({ baseline: { ...present, sourceHead: "9".repeat(40) } }));
      assert.deepEqual([otherHead.result, otherHead.gaps, otherHead.counts.proven, otherHead.counts.notMeasured], ["LOCAL_INDEPENDENCE_DEGRADED", ["BASELINE_NOT_BOUND_TO_HEAD"], 0, 32]);
      const otherManifest = evaluateAyasIndependence(body({ baseline: { ...present, manifestDigest: "8".repeat(64) } }));
      assert.deepEqual([otherManifest.result, otherManifest.gaps, otherManifest.counts.notMeasured], ["LOCAL_INDEPENDENCE_DEGRADED", ["BASELINE_OF_ANOTHER_MANIFEST"], 32]);
      for (const over of [{ complete: false }, { failed: 1 }, { outcome: "FAIL" }, { outcome: "RESOURCE_ABORT" }, { outcome: "INCOMPLETE_TIMEOUT" }, { trials: 0 }]) {
        const evaluation = evaluateAyasIndependence(body({ baseline: { ...present, ...over } }));
        assert.deepEqual([evaluation.result, evaluation.gaps], ["LOCAL_INDEPENDENCE_DEGRADED", ["BASELINE_INCOMPLETE_OR_FAILED"]], JSON.stringify(over));
      }
      // A binding problem is not hidden by a missing baseline.
      const both = evaluateAyasIndependence({ ...withProof("FAULT", "REBOOT", { scenarioPresent: false }), baseline: { state: "ABSENT" } });
      assert.deepEqual([statusOf(both, "REBOOT").status, both.gaps], ["UNPROVEN", ["BASELINE_ABSENT", "FAULT_UNPROVEN:REBOOT"]]);
    });

    await scenario("the canonical set is closed: a missing, repeated, unknown or proofless requirement is a gap", () => {
      const all = requirements();
      const missing = evaluateAyasIndependence(body({ requirements: all.filter((requirement) => requirement.id !== "MEMORY_POISONING") }));
      assert.deepEqual([missing.result, missing.gaps], ["LOCAL_INDEPENDENCE_DEGRADED", ["EVIDENCE_MAP_MISSING:FAULT:MEMORY_POISONING"]]);
      const repeated = evaluateAyasIndependence(body({ requirements: [...all, all[0]!] }));
      assert.deepEqual([repeated.result, repeated.gaps], ["LOCAL_INDEPENDENCE_DEGRADED", ["EVIDENCE_MAP_DUPLICATE:FAULT:PROCESS_KILL"]]);
      const unknown = evaluateAyasIndependence(body({ requirements: [...all, { kind: "FAULT", id: "SOLAR_FLARE", claim: "not in the matrix", limit: null, proofs: [proof()] }] }));
      assert.deepEqual([unknown.result, unknown.gaps], ["LOCAL_INDEPENDENCE_DEGRADED", ["EVIDENCE_MAP_UNKNOWN:FAULT:SOLAR_FLARE"]]);
      // A link filed under the fault list is not that link.
      const misfiled = evaluateAyasIndependence(body({ requirements: all.map((requirement) => (requirement.id === "EXECUTE" ? { ...requirement, kind: "FAULT" as const } : requirement)) }));
      assert.deepEqual(misfiled.gaps, ["EVIDENCE_MAP_MISSING:CHAIN:EXECUTE", "EVIDENCE_MAP_UNKNOWN:FAULT:EXECUTE"]);
      const proofless = evaluateAyasIndependence(body({ requirements: requirements((id) => (id === "TESTS" ? [] : undefined)) }));
      assert.deepEqual([proofless.result, proofless.gaps, statusOf(proofless, "TESTS").problems], ["LOCAL_INDEPENDENCE_DEGRADED", ["CHAIN_LINK_UNPROVEN:TESTS"], ["NO_PROOF_DECLARED"]]);
      assert.equal(evaluateAyasIndependence(body({ requirements: [] })).result, "LOCAL_INDEPENDENCE_DEGRADED");
    });

    await scenario("no local coding backend that may serve autonomous coding is the degraded result, with everything else proven", () => {
      for (const backends of [[], [{ id: "coding-model.fixture", state: "DEGRADED", admission: "NONE", mayServeAutonomousCoding: false }], [{ id: "coding-model.fixture", state: "ACTIVE", admission: "PROMOTED", mayServeAutonomousCoding: "yes" as unknown as boolean }]]) {
        const evaluation = evaluateAyasIndependence(body({ localCodingBackends: backends }));
        assert.deepEqual([evaluation.result, evaluation.gaps, evaluation.counts.proven], ["LOCAL_INDEPENDENCE_DEGRADED", ["LOCAL_CODING_BACKEND_NOT_QUALIFIED"], 32]);
      }
      // The registry of record: one coding model, degraded, admitted for nothing.
      assert.deepEqual(collectAyasIndependenceCodingBackends(AYAS_LIFECYCLE_REGISTRY), [{ id: "coding-model.local-coding.qwen2.5-coder-14b-q4km", state: "DEGRADED", admission: "NONE", mayServeAutonomousCoding: false }]);
      // Only the lifecycle's own serving rule can say yes, and only for a coding model.
      assert.deepEqual(auditAyasLifecycleEntry(servingCodingModel), []);
      assert.deepEqual(collectAyasIndependenceCodingBackends([servingCodingModel]), [{ id: "coding-model.fixture", state: "ACTIVE", admission: "PROMOTED", mayServeAutonomousCoding: true }]);
      assert.deepEqual(collectAyasIndependenceCodingBackends([{ ...servingCodingModel, kind: "llm" }]), []);
      assert.equal(collectAyasIndependenceCodingBackends([{ ...servingCodingModel, admission: "OWNER_SELECTED" }])[0]!.mayServeAutonomousCoding, false);
      assert.equal(collectAyasIndependenceCodingBackends([{ ...servingCodingModel, state: "CANARY", history: servingCodingModel.history.slice(0, 5) }])[0]!.mayServeAutonomousCoding, false);
    });

    await scenario("sealed: an edited record, and a record relabelled READY and hashed again, are both refused", () => {
      const sealed = sealAyasIndependenceCertification(body({ localCodingBackends: [] }));
      assert.equal(sealed.evaluation.result, "LOCAL_INDEPENDENCE_DEGRADED");
      assert.equal(verifyAyasIndependenceCertification(JSON.parse(JSON.stringify(sealed))).ok, true);
      const problems = (value: unknown) => { const result = verifyAyasIndependenceCertification(value); return result.ok ? [] : [...result.problems]; };
      assert.deepEqual(problems({ ...sealed, generatedAt: "2026-10-03T00:00:00.000Z" }), ["CERTIFICATION_DIGEST_MISMATCH"]);
      const relabelled = { ...sealed, evaluation: { ...sealed.evaluation, result: "LOCAL_INDEPENDENCE_READY", gaps: [] } };
      const { certificationDigest: dropped, ...unsealed } = relabelled; void dropped;
      assert.deepEqual(problems({ ...unsealed, certificationDigest: sha256(canonicalAyasJson(unsealed)) }), ["EVALUATION_NOT_IMPLIED_BY_FACTS"]);
      assert.deepEqual(problems(null), ["NOT_AN_OBJECT"]); assert.deepEqual(problems([]), ["NOT_AN_OBJECT"]);
      assert.deepEqual(problems({ ...sealed, schemaVersion: "2" }), ["SCHEMA_VERSION"]);
      assert.deepEqual(problems({ ...sealed, authority: "OWNER" }), ["AUTHORITY"]);
      assert.deepEqual(problems({ ...sealed, evaluation: { ...sealed.evaluation, result: "READY" } }), ["EVALUATION"]);
      assert.deepEqual(problems({ ...sealed, git: { ...sealed.git, head: "main" } }), ["GIT_HEAD"]);
      assert.deepEqual(compareAyasIndependenceCertification(sealed, sealed), []);
      const later = sealAyasIndependenceCertification(body({ git: { head: "4".repeat(40), treeState: "DIRTY", dirtyPaths: 2 }, evalManifest: { version: "15F.4-v2", digest: "5".repeat(64), suites: 3 }, baseline: { state: "ABSENT" }, requirements: requirements().slice(1) }));
      assert.deepEqual(compareAyasIndependenceCertification(sealed, later), ["GIT_HEAD", "TREE_STATE", "EVAL_MANIFEST", "BASELINE", "REQUIREMENTS", "LOCAL_CODING_BACKENDS"]);
      assert.deepEqual(compareAyasIndependenceCertification(sealed, sealAyasIndependenceCertification(body())), ["LOCAL_CODING_BACKENDS", "RESULT"]);
    });

    await scenario("baseline report: one this module cannot read in full is refused whole", () => {
      const good = { sourceHead: HEAD, manifestDigest: MANIFEST_DIGEST, outcome: "PASS", completeDeclaredBaseline: true, trials: 2, failed: [], results: [{ id: "a", summary: { status: "PASS" } }, { id: "b", summary: { status: "PASS_WITH_KNOWN_LIMITATIONS" } }] };
      const read = (value: unknown) => readAyasIndependenceBaselineReport(Buffer.from(typeof value === "string" ? value : JSON.stringify(value)));
      const report = read(good);
      assert.deepEqual([report.sourceHead, report.trials, report.complete, report.failed, [...report.suites]], [HEAD, 2, true, 0, [["a", "PASS"], ["b", "PASS_WITH_KNOWN_LIMITATIONS"]]]);
      for (const bad of ["not json", null, [], { ...good, sourceHead: "HEAD" }, { ...good, manifestDigest: "x" }, { ...good, outcome: 1 }, { ...good, completeDeclaredBaseline: "yes" }, { ...good, trials: 0 }, { ...good, trials: 1.5 },
        { ...good, failed: 0 }, { ...good, results: {} }, { ...good, results: [{ id: "a" }] }, { ...good, results: [{ id: "a", summary: { status: "GREEN" } }] }, { ...good, results: [good.results[0], good.results[0]] }, { ...good, results: [null] }]) {
        assert.throws(() => read(bad), /AYAS_INDEPENDENCE_BASELINE_REPORT_INVALID/, JSON.stringify(bad));
      }
    });

    await scenario("collector on a TEMP repository: bound proofs and a bound baseline are READY; a drifted pin, a renamed scenario, an undeclared suite and another commit are not", () => {
      const root = fixtureRepository("collector");
      const baselineReportFile = writeBaseline(root);
      const collect = (over: Partial<Parameters<typeof collectAyasIndependenceCertification>[0]> = {}) =>
        collectAyasIndependenceCertification({ repoRoot: root, now: new Date("2026-10-02T00:00:00.000Z"), baselineReportFile, evidence: fixtureEvidence(), registry: [servingCodingModel], ...over });
      const ready = collect();
      assert.deepEqual([ready.evaluation.result, ready.evaluation.gaps, ready.git.treeState, ready.evalManifest.suites, ready.baseline.state === "PRESENT" && ready.baseline.trials], ["LOCAL_INDEPENDENCE_READY", [], "CLEAN", 2, 3]);
      assert.equal(verifyAyasIndependenceCertification(ready).ok, true);
      const text = JSON.stringify(ready);
      for (const local of [temp, temp.replace(/\\/g, "/"), temp.replace(/\\/g, "\\\\"), os.homedir(), os.homedir().replace(/\\/g, "\\\\")]) assert.ok(!text.includes(local), "nothing machine-specific in the record");

      // The whole literal is the name: a prefix of it, or a longer name around it, is another scenario.
      for (const [name, present] of [["alpha holds", true], ["alpha", false], ["alpha holds ", false], ["beta holds — exactly", true], ["", false]] as const) {
        assert.equal(collect({ evidence: fixtureEvidence([{ suite: "fixture-a", scenario: name }]) }).requirements[0]!.proofs[0]!.scenarioPresent, present, JSON.stringify(name));
      }
      const marked = collect({ evidence: fixtureEvidence([{ suite: "fixture-a", scenario: "beta holds — exactly", marker: 'code: "ENOSPC"' }]) });
      assert.deepEqual([marked.requirements[0]!.proofs[0]!.markerPresent, marked.evaluation.result], [true, "LOCAL_INDEPENDENCE_READY"]);
      const unmarked = collect({ evidence: fixtureEvidence([{ suite: "fixture-a", scenario: "alpha holds", marker: "EDQUOT" }]) });
      assert.deepEqual([unmarked.requirements[0]!.proofs[0]!.markerPresent, unmarked.evaluation.result, unmarked.evaluation.requirements[0]!.problems], [false, "LOCAL_INDEPENDENCE_DEGRADED", ["MARKER_NOT_IN_SUITE:fixture-a"]]);
      const undeclared = collect({ evidence: fixtureEvidence([{ suite: "fixture-missing", scenario: "alpha holds" }]) });
      // An undeclared suite is also one no baseline ran.
      assert.deepEqual([undeclared.requirements[0]!.proofs[0]!.pin, undeclared.evaluation.requirements[0]!.problems], ["NOT_DECLARED", ["SUITE_NOT_DECLARED:fixture-missing", "SUITE_NOT_RUN:fixture-missing"]]);
      // A suite the report does not list was not run.
      const unlisted = collect({ baselineReportFile: writeBaseline(root, { results: [{ id: "fixture-b", summary: { status: "PASS" } }] }) });
      assert.deepEqual([unlisted.requirements[0]!.proofs[0]!.outcome, unlisted.evaluation.requirements[0]!.problems], ["ABSENT", ["SUITE_NOT_RUN:fixture-a"]]);
      assert.equal(collect({ registry: AYAS_LIFECYCLE_REGISTRY }).evaluation.gaps.join(), "LOCAL_CODING_BACKEND_NOT_QUALIFIED");
      assert.deepEqual(collect({ baselineReportFile: undefined }).evaluation.gaps, ["BASELINE_ABSENT"]);

      // A pinned file that is not the script still unbinds the suite: the scenario is not looked for in unvouched bytes.
      fs.writeFileSync(path.join(root, "scripts/fixtures/fixture-data.ts"), "export const data = 2;\n");
      const drifted = collect();
      assert.deepEqual([drifted.requirements[0]!.proofs[0]!.pin, drifted.requirements[0]!.proofs[0]!.scenarioPresent, drifted.git.treeState, drifted.evaluation.counts.unproven], ["MISMATCH", false, "DIRTY", 32]);
      assert.ok(drifted.evaluation.gaps.includes("GIT_TREE_DIRTY") && drifted.evaluation.gaps.includes("FAULT_UNPROVEN:PROCESS_KILL"));
      fs.rmSync(path.join(root, "scripts/fixtures/fixture-data.ts"));
      assert.equal(collect().requirements[0]!.proofs[0]!.pin, "UNREADABLE");
      git(root, "checkout", "--quiet", "--", "scripts/fixtures/fixture-data.ts");
      assert.equal(collect().evaluation.result, "LOCAL_INDEPENDENCE_READY");

      // The same baseline after another commit speaks for the earlier commit only.
      fs.writeFileSync(path.join(root, "notes.md"), "a later change\n"); git(root, "add", "--all"); git(root, "commit", "--quiet", "--message", "later");
      const moved = collect();
      assert.deepEqual([moved.evaluation.result, moved.evaluation.gaps, moved.evaluation.counts.notMeasured], ["LOCAL_INDEPENDENCE_DEGRADED", ["BASELINE_NOT_BOUND_TO_HEAD"], 32]);
      assert.deepEqual(compareAyasIndependenceCertification(ready, moved), ["GIT_HEAD", "RESULT"]);

      fs.writeFileSync(path.join(root, AYAS_INDEPENDENCE_EVAL_MANIFEST_FILE), "{}\n");
      assert.throws(() => collect(), /AYAS_INDEPENDENCE_EVAL_MANIFEST_INVALID/);
    });

    await scenario("operator script: prints by default, writes a new file only, verifies a stored record, and DEGRADED is not an error", () => {
      const root = fixtureRepository("operator");
      const tsx = path.join(repo, "node_modules", "tsx", "dist", "cli.mjs");
      const script = path.join(repo, "scripts", "ayas-independence-certification.ts");
      const run = (...args: string[]) => spawnSync(process.execPath, [tsx, script, ...args], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120_000, env: { ...process.env, NODE_ENV: "test" } });
      const printed = run();
      assert.equal(printed.status, 0, printed.stderr);
      assert.match(printed.stdout, /^result {7}LOCAL_INDEPENDENCE_DEGRADED$/m); assert.match(printed.stdout, /^authority {4}NONE$/m); assert.match(printed.stdout, /BASELINE_ABSENT/);
      assert.deepEqual(fs.readdirSync(root).sort(), [".git", ".gitignore", "docs", "scripts"], "nothing is written without --out");
      const written = run("--out", "reports/CERTIFICATION.json", "--baseline-report", writeBaseline(root));
      assert.equal(written.status, 0, written.stderr);
      const stored = JSON.parse(fs.readFileSync(path.join(root, "reports", "CERTIFICATION.json"), "utf8"));
      assert.equal(verifyAyasIndependenceCertification(stored).ok, true);
      // The fixture manifest declares none of the suites of record, and the registry of record qualifies no coding model.
      assert.deepEqual([stored.evaluation.result, stored.baseline.trials, stored.evaluation.counts.unproven, stored.evaluation.gaps.includes("LOCAL_CODING_BACKEND_NOT_QUALIFIED")], ["LOCAL_INDEPENDENCE_DEGRADED", 3, 32, true]);
      const again = run("--out", "reports/CERTIFICATION.json");
      assert.equal(again.status, 1, "an existing record is not overwritten"); assert.match(again.stderr, /EEXIST/);
      const json = run("--json"); assert.equal(json.status, 0, json.stderr); assert.equal(JSON.parse(json.stdout).evaluation.result, "LOCAL_INDEPENDENCE_DEGRADED");
      const same = run("--verify", "reports/CERTIFICATION.json", "--baseline-report", fs.readdirSync(path.join(root, "reports")).filter((name) => name.startsWith("baseline-")).map((name) => `reports/${name}`)[0]!, "--json");
      assert.equal(same.status, 0, same.stderr); assert.deepEqual([JSON.parse(same.stdout).seal, JSON.parse(same.stdout).changedSince], ["INTACT", []]);
      const changed = run("--verify", "reports/CERTIFICATION.json", "--json");
      assert.equal(changed.status, 1); assert.deepEqual(JSON.parse(changed.stdout).changedSince, ["BASELINE"]);
      fs.writeFileSync(path.join(root, "reports", "CERTIFICATION.json"), JSON.stringify({ ...stored, evaluation: { ...stored.evaluation, result: "LOCAL_INDEPENDENCE_READY", gaps: [] } }));
      const broken = run("--verify", "reports/CERTIFICATION.json", "--json");
      assert.equal(broken.status, 1); assert.equal(JSON.parse(broken.stdout).seal, "BROKEN");
      for (const args of [["--unknown"], ["--out"], ["--out", "record.txt"], ["--out", "a.json", "--out", "b.json"], ["--out", "a.json", "--verify", "reports/CERTIFICATION.json"], ["--baseline-report"]]) {
        const refused = run(...args); assert.equal(refused.status, 1, args.join(" ")); assert.match(refused.stderr, /AYAS_INDEPENDENCE_ARGUMENTS_INVALID/, args.join(" "));
      }
      const unreadable = run("--baseline-report", ".gitignore"); assert.equal(unreadable.status, 1); assert.match(unreadable.stderr, /AYAS_INDEPENDENCE_BASELINE_REPORT_INVALID/);
    });

    // The one fault of the matrix no declared suite exercised directly: a 5xx answer on the research fetch path.
    let hits: Record<string, number> = {};
    await withFixtureServer(
      (req, res) => { hits[req.url ?? ""] = (hits[req.url ?? ""] ?? 0) + 1; res.writeHead(req.url === "/unavailable" ? 503 : 500, { "Content-Type": "text/plain", "Retry-After": "1" }); res.end("internal detail: upstream credentials rejected"); },
      async (base) => {
        await scenario("a source answering 500 or 503 is an endpoint failure: one request each, never retried inline", async () => {
          hits = {};
          for (const [route, status] of [["/error", 500], ["/unavailable", 503]] as const) {
            const result = await ayasSafePublicFetch(`${base}${route}`, { timeoutMs: 3000, maxRetries: 3, retryBaseDelayMs: 1, dangerouslyAllowPrivateNetworkForTests: true });
            assert.equal(result.ok, false);
            if (!result.ok) {
              assert.deepEqual([result.code, result.failureClass, result.attempts], ["AYAS_FETCH_HTTP_ERROR", "PERMANENT_ENDPOINT", 1], route);
              assert.equal(result.message, `HTTP ${status}`, "the answer's body is not kept");
            }
            assert.equal(hits[route], 1, `${route}: exactly one request, no retry storm against a failing endpoint`);
          }
        });
      },
    );

    await scenario("evidence only: a pure evaluator, a read-only collector, no network or process start, and nothing in the application reads the record", () => {
      const evaluator = "src/lib/ayas/certification/AyasIndependenceCertification.ts";
      const map = "src/lib/ayas/certification/AyasIndependenceEvidenceMap.ts";
      const collector = "src/lib/ayas/certification/AyasIndependenceCertificationCollector.ts";
      const cli = "scripts/ayas-independence-certification.ts";
      const code = (file: string) => fs.readFileSync(path.join(repo, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      for (const file of [evaluator, map]) assert.ok(!/node:fs|node:child_process|node:path|node:os|Date\.now|new Date\(|process\./.test(code(file)), `${file} is pure`);
      for (const file of [evaluator, map, collector, cli]) {
        for (const forbidden of [/\bfetch\s*\(/, /node:https?|node:net|node:dns|node:tls/, /node:child_process/, /\bexec(?:File)?(?:Sync)?\s*\(|\bspawn(?:Sync)?\s*\(/, /["'`]npm["'`]|\bnpx\b/, /shell\s*:\s*true/, /process\.env/]) {
          assert.ok(!forbidden.test(code(file)), `${file} must not contain ${forbidden}`);
        }
      }
      // Git is asked two things, through the one read-only probe.
      assert.deepEqual([...code(collector).matchAll(/readAyasGit\(repoRoot, \[([^\]]*)\]/g)].map((match) => match[1]!.split(",")[0]!.trim()).sort(), ['"rev-parse"', '"status"']);
      // The collector writes nothing; the operator script writes one new file and never replaces one.
      assert.ok(!/writeFileSync|appendFileSync|rmSync|unlinkSync|renameSync|mkdirSync|copyFileSync/.test(code(collector)));
      assert.deepEqual(code(cli).match(/writeFileSync\([^\n]*/g)?.map((call) => /\{ flag: "wx" \}/.test(call)), [true]);
      assert.ok(!/rmSync|unlinkSync|renameSync|copyFileSync/.test(code(cli)));
      // The result gates nothing: only the operator script and the two suites import these modules.
      const importers: string[] = [];
      const walk = (dir: string) => {
        if (!fs.existsSync(path.join(repo, dir))) return;
        for (const entry of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
          const relative = `${dir}/${entry.name}`;
          if (entry.isDirectory()) { if (entry.name !== "node_modules" && !entry.name.startsWith(".")) walk(relative); }
          else if (/\.tsx?$/.test(entry.name) && /certification\/AyasIndependence|LOCAL_INDEPENDENCE_READY/.test(fs.readFileSync(path.join(repo, relative), "utf8"))) importers.push(relative);
        }
      };
      for (const dir of ["src", "app", "scripts"]) walk(dir);
      const allowed = [evaluator, map, collector, cli, "scripts/smoke-ayas-independence-certification.ts", "scripts/smoke-ayas-independence-certification-mutations.ts"];
      assert.deepEqual(importers.filter((file) => !allowed.includes(file)), [], "nothing else reads or names the certification result");
      assert.ok(!fs.readFileSync(path.join(repo, "package.json"), "utf8").includes("ayas-independence-certification"), "no package script starts it");
    });
  } finally {
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-independence-"));
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log(`Stage 15H independence certification: PASS (${count} scenarios; ${AYAS_INDEPENDENCE_FAULTS.length} faults, ${AYAS_MAINTENANCE_CHAIN.length} links; TEMP only; model/container/production actions 0)`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
