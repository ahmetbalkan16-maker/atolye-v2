import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createAyasAutonomyDaemon } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasExecutionJournal, type AyasExecutionJournalEntry } from "../src/lib/brain/autonomy/AyasExecutionJournal";
import { createAyasDurableTaskJournal } from "../src/lib/brain/autonomy/AyasDurableTaskJournal";
import { AyasExecutionAuthorizationStore } from "../src/lib/ayas/execution/AyasExecutionAuthorization";
import { classifyAyasRegressionReport, isAyasMutationReliabilityAudit, summarizeAyasReliabilitySlo, type AyasMutationReliabilityAudit, type AyasSloSource } from "../src/lib/ayas/observability/AyasReliabilitySlo";
import { readAyasReliabilityState } from "../src/lib/ayas/observability/AyasReliabilityState";

let scenarios = 0;
async function scenario(name: string, fn: () => void | Promise<void>) { await fn(); scenarios++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${name}`); }
const roots: string[] = [];
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-slo-")); roots.push(root); return root; };
const available = <T>(facts: readonly T[]): AyasSloSource<T> => ({ status: "AVAILABLE", facts });
const audit: AyasMutationReliabilityAudit = { version: "1", mutationStarted: true, observedBaseHead: "a".repeat(40), scopeVerified: true,
  violation: "NONE", regression: "PASS", testCount: 1, completionRecorded: true };
const entry = (changes: Partial<AyasExecutionJournalEntry> = {}): AyasExecutionJournalEntry => ({ schemaVersion: "1", executionId: "ayas-exec-test", proposalId: "p", proposalHash: "b".repeat(64),
  baseHead: "a".repeat(40), exactFiles: ["scripts/smoke-allowed.ts"], phase: "RESULT_RECORDED", startedAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z", reliabilityAudit: audit, ...changes });
const summary = (entries: readonly AyasExecutionJournalEntry[]) => summarizeAyasReliabilitySlo({ executions: available(entries), acceptedTasks: available([]), externalWrites: available([]) });
const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();

async function daemonCase(kind: "PASS" | "FAIL" | "INVALID" | "EMPTY" | "HEAD" | "SCOPE" | "REPORT_TAMPER" = "PASS") {
  const repo = temp(), root = temp(), inbox = createAyasApprovalInboxStore({ rootDir: temp() });
  fs.mkdirSync(path.join(repo, "scripts")); fs.writeFileSync(path.join(repo, "scripts/smoke-allowed.ts"), "base\n");
  git(repo, "init", "-q"); git(repo, "config", "user.email", "smoke@example.invalid"); git(repo, "config", "user.name", "Smoke");
  git(repo, "add", "scripts/smoke-allowed.ts"); git(repo, "commit", "-qm", "fixture");
  const head = git(repo, "rev-parse", "HEAD");
  const returnedResults = [kind === "FAIL" ? "FAIL" : "PASS"];
  const daemon = createAyasAutonomyDaemon({ repoRoot: repo, gateRoot: path.join(root, "self-improvement"), inbox,
    onJournalPhase: (phase) => { if (kind === "REPORT_TAMPER" && phase === "MUTATION_COMPLETED") returnedResults[0] = "FAIL"; },
    revalidation: { readMachineHealth: async () => ({ mayStart: true, action: "ALLOW" }) as never } });
  const observation = { now: new Date().toISOString(), branch: "fixture", head, repoClean: true, graphifyFresh: true, machineAction: "ALLOW" as const, gaps: [] };
  daemon.observe(observation);
  const [p] = daemon.discover(observation, [{ objective: "bounded fixture", currentProblem: "fixture gap", selectionReason: "fixture", expectedUserBenefit: "regression caught",
    expectedBehaviorChange: "one file", unchangedBehavior: "live data", riskIfNotDone: "gap", technicalRisk: "low", productionImpact: "none", rationale: "fixture",
    evidence: ["fixture"], graphifyEvidence: ["fixture"], exactFiles: ["scripts/smoke-allowed.ts"], expectedDiffScope: "one file", testsPlanned: ["fixture"], risk: "low", rank: 1, mutationKind: "test-fixture-mutation" }]);
  assert.ok(p); daemon.decide(p.proposalId, "APPROVE"); let error: unknown;
  try { await daemon.executeApproved({ proposalId: p.proposalId, proposalHash: p.proposalHash, baseHead: head, currentHead: head, repoClean: true, exactFiles: p.exactFiles, currentExactFiles: p.exactFiles,
    applyWhileExecuting: async () => {
      fs.writeFileSync(path.join(repo, "scripts/smoke-allowed.ts"), "approved\n");
      if (kind === "SCOPE") fs.writeFileSync(path.join(repo, "scripts/smoke-forbidden.ts"), "outside approved scope\n");
      if (kind === "HEAD") { git(repo, "add", "scripts/smoke-allowed.ts"); git(repo, "commit", "-qm", "unapproved HEAD change"); }
      return { changedFiles: p.exactFiles, diffFingerprint: "fixture", testsRun: kind === "EMPTY" ? [] : ["fixture"], testResults: kind === "EMPTY" || kind === "INVALID" ? [] : returnedResults };
    } }); } catch (e) { error = e; }
  const journal = createAyasExecutionJournal({ rootDir: path.join(root, "self-improvement") });
  return { repo, root, error, journal, report: readAyasReliabilityState({ rootDir: root }), inbox };
}

async function main() {
  await scenario("empty stores are UNKNOWN rather than zero", () => { const r = summary([]); for (const k of [r.unauthorizedWrites, r.staleHeadMutation, r.regressionGateBypass, r.unexplainedTaskLoss, r.duplicateExternalWrites]) { assert.equal(k.status, "UNKNOWN"); assert.equal(k.violations, null); } assert.equal(r.globalSloCertified, false); });
  await scenario("legacy entries retain unknown coverage", () => { const r = summary([entry({ reliabilityAudit: undefined })]); assert.equal(r.staleHeadMutation.violations, null); assert.equal(r.unauthorizedWrites.unknownSamples, 1); });
  await scenario("historical base head is not compared to today's head", () => { assert.equal(summary([entry()]).staleHeadMutation.status, "SCOPED_ZERO"); });
  await scenario("real observed boundary drift breaches stale head", () => { assert.equal(summary([entry({ reliabilityAudit: { ...audit, observedBaseHead: "c".repeat(40) } })]).staleHeadMutation.violations, 1); });
  await scenario("post-mutation HEAD and unauthorized-scope violations remain positive", () => { for (const violation of ["HEAD_CHANGED", "UNAUTHORIZED_MUTATION"] as const) { const r = summary([entry({ reliabilityAudit: { ...audit, scopeVerified: false, violation } })]); assert.equal((violation === "HEAD_CHANGED" ? r.staleHeadMutation : r.unauthorizedWrites).status, "BREACH"); } });
  await scenario("failed callback report accepted as completed is a bypass", () => { assert.equal(summary([entry({ reliabilityAudit: { ...audit, regression: "FAIL" } })]).regressionGateBypass.violations, 1); });
  await scenario("unreported regression and missing lease cannot become zero", () => { const r = summary([entry({ reliabilityAudit: { ...audit, regression: "NOT_REPORTED", testCount: 0 } })]); assert.equal(r.regressionGateBypass.status, "UNKNOWN"); assert.equal(r.unauthorizedWrites.status, "UNKNOWN"); });
  await scenario("blocked dispatch and non-Git repair do not invent violations", () => { const r = summary([entry({ reliabilityAudit: { ...audit, mutationStarted: false, scopeVerified: false, completionRecorded: false } }), entry({ executionId: "repair", baseHead: "NOT_APPLICABLE_REPAIR_WORKSPACE" })]); assert.equal(r.staleHeadMutation.status, "UNKNOWN"); assert.equal(r.staleHeadMutation.observedViolations, 0); });
  await scenario("source read failure never becomes zero", () => { const r = readAyasReliabilityState({ rootDir: temp(), executions: { list: () => { throw new Error("private path secret"); } }, authorizations: { scan: () => { throw new Error("private body"); } } }); assert.equal(r.unauthorizedWrites.sourceStatus, "UNAVAILABLE"); assert.equal(r.unexplainedTaskLoss.status, "UNKNOWN"); assert.doesNotMatch(JSON.stringify(r), /private path|private body/); });
  await scenario("external attempts are unknown; confirmed duplicate effects counted once per receipt", () => { const r = summarizeAyasReliabilitySlo({ executions: available([]), acceptedTasks: available([]), externalWrites: available([{ receiptId: "one", effectKeyDigest: "d".repeat(64), outcome: "CONFIRMED" }, { receiptId: "one", effectKeyDigest: "d".repeat(64), outcome: "CONFIRMED" }, { receiptId: "two", effectKeyDigest: "d".repeat(64), outcome: "CONFIRMED" }, { receiptId: "three", effectKeyDigest: "d".repeat(64), outcome: "UNKNOWN" }]) }); assert.equal(r.duplicateExternalWrites.violations, 1); assert.equal(r.duplicateExternalWrites.samples, 3); assert.equal(r.duplicateExternalWrites.unknownSamples, 1); });
  await scenario("missing accepted journal is distinct from unreadable journal", () => { const r = summarizeAyasReliabilitySlo({ executions: available([]), acceptedTasks: available([{ taskId: "one", journal: "MISSING" }, { taskId: "two", journal: "UNKNOWN" }]), externalWrites: available([]) }); assert.equal(r.unexplainedTaskLoss.violations, 1); assert.equal(r.unexplainedTaskLoss.unknownSamples, 1); });
  await scenario("strict privacy metadata rejects added bodies and impossible states", () => { assert.equal(isAyasMutationReliabilityAudit({ ...audit, privateBody: "secret" }), false); assert.equal(isAyasMutationReliabilityAudit({ ...audit, observedBaseHead: "main" }), false); assert.equal(isAyasMutationReliabilityAudit({ ...audit, mutationStarted: false }), false); assert.equal(isAyasMutationReliabilityAudit({ ...audit, testCount: -1 }), false); assert.equal(isAyasMutationReliabilityAudit(audit), true); });
  await scenario("callback report classification preserves unknown and refuses malformed", () => { assert.equal(classifyAyasRegressionReport([], []).regression, "NOT_REPORTED"); assert.equal(classifyAyasRegressionReport(["test"], []).regression, "INVALID"); assert.equal(classifyAyasRegressionReport(undefined, undefined).regression, "INVALID"); assert.equal(classifyAyasRegressionReport(["test"], ["FAIL"]).regression, "FAIL"); });
  await scenario("journal rejects corrupt metadata on read and before write", () => { const j = createAyasExecutionJournal({ rootDir: temp() }); const e = entry(); j.record(e); assert.throws(() => j.record({ ...e, reliabilityAudit: { ...audit, privateBody: "secret" } as never }), /invalid reliability/); fs.writeFileSync(path.join(j.dir, e.executionId + ".json"), JSON.stringify({ ...e, reliabilityAudit: { ...audit, violation: "PRIVATE_MESSAGE" } })); assert.throws(() => j.list(), /invalid reliability/); });
  await scenario("real approved TEMP mutation records three scoped zeros without global certification", async () => { const f = await daemonCase(); assert.equal(f.error, undefined); for (const k of [f.report.unauthorizedWrites, f.report.staleHeadMutation, f.report.regressionGateBypass]) { assert.equal(k.status, "SCOPED_ZERO"); assert.equal(k.samples, 1); } assert.equal(f.report.duplicateExternalWrites.status, "UNKNOWN"); assert.equal(f.report.globalSloCertified, false); });
  for (const kind of ["FAIL", "INVALID"] as const) await scenario(`real ${kind} callback report never records completion`, async () => { const f = await daemonCase(kind); assert.match(String(f.error), /REGRESSION_REPORT_REFUSED/); const e = f.journal.list()[0]!; assert.equal(e.phase, "RECOVERY_REQUIRED"); assert.equal(e.reliabilityAudit?.completionRecorded, false); assert.equal(f.inbox.load().results.length, 0); assert.equal(f.report.regressionGateBypass.observedViolations, 0); });
  await scenario("empty legacy callback remains compatible with unknown regression", async () => { const f = await daemonCase("EMPTY"); assert.equal(f.error, undefined); assert.equal(f.report.regressionGateBypass.status, "UNKNOWN"); });
  await scenario("mutable callback arrays cannot alter the validated regression report", async () => { const f = await daemonCase("REPORT_TAMPER"); assert.equal(f.error, undefined); assert.deepEqual(f.inbox.load().results[0]!.testResults, ["PASS"]); });
  for (const kind of ["HEAD", "SCOPE"] as const) await scenario(`real ${kind} mutation violates the retained existing boundary`, async () => { const f = await daemonCase(kind); assert.ok(f.error); assert.equal((kind === "HEAD" ? f.report.staleHeadMutation : f.report.unauthorizedWrites).violations, 1); assert.equal(f.journal.list()[0]!.phase, "RECOVERY_REQUIRED"); });
  await scenario("expired unsettled lease is not loss; actual absent accepted journal is", () => {
    const root = temp(), store = new AyasExecutionAuthorizationStore({ rootDir: root, now: () => new Date("2026-10-01T10:00:00Z") });
    const request = { action: "query-graphify", requestedBy: "ayas-durable-runtime", intent: "fixture", plan: { activity: "self-development.graphify-state.read", taskId: "ayas-task-" + "a".repeat(32) }, canonical: "fixture" };
    const id = store.grant(request).authorizationId;
    store.consume(id, request);
    const tasks = createAyasDurableTaskJournal({ rootDir: path.join(root, "autonomy") });
    // An empty journal directory is not a created task; read/replay, never directory existence.
    fs.mkdirSync(path.join(tasks.dir, "ayas-task-" + "a".repeat(32)), { recursive: true });
    const missing = readAyasReliabilityState({ rootDir: root }); assert.equal(missing.unexplainedTaskLoss.violations, 1);
    const pending = readAyasReliabilityState({ rootDir: root, tasks: { load: () => ({ status: "RUNNING" }) as never } }); assert.equal(pending.unexplainedTaskLoss.violations, 0);
    const corrupt = readAyasReliabilityState({ rootDir: root, tasks: { load: () => { throw new Error("corrupt"); } } }); assert.equal(corrupt.unexplainedTaskLoss.violations, null);
  });
  console.log(`AYAS reliability SLO: PASS (${scenarios} scenarios; TEMP only; global certification false; no live writes)`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  for (const root of roots) { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("ayas-slo-")); fs.rmSync(root, { recursive: true, force: true }); }
});
