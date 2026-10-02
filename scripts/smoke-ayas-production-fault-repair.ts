/** Stage 15L: deterministic fault evidence, plans, exact bounded coding tasks. No stage or provider is called. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { AYAS_DIRECTOR_STAGES, type AyasDirectorSessionFacts, type AyasDirectorStageFact, type AyasDirectorStageError } from "../src/lib/ayas/director/AyasProductionDirectorSession";
import { AYAS_PRODUCTION_FAULT_CLASSES, AYAS_PRODUCTION_SAFE_REPAIRS, ayasRepairBackoffSeconds, planAyasProductionRepairs, buildAyasProductionRepairCodingTask } from "../src/lib/ayas/director/AyasProductionFaultRepair";
import { pipelineStageDependencies } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { pipelineRetryMaxAttempts } from "../src/lib/pipeline/PipelineRetryAdmission";
import type { ProductionStepKey } from "../src/types/project";

let count = 0;
function scenario(name: string, run: () => void) { run(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
const present = { state: "PRESENT" as const, digest: "d".repeat(64), counts: {} };
const local = { variable: "AI_PROVIDER", provider: "ollama", costClass: "local-zero-cost" as const };
const error = (over: Partial<AyasDirectorStageError>): AyasDirectorStageError => ({ kind: null, code: null, rootCode: null, phase: null, httpStatus: null, providerErrorCode: null, ...over });
function facts(stage: ProductionStepKey = "animation", over: Partial<AyasDirectorStageFact> = {}): AyasDirectorSessionFacts {
  const index = AYAS_DIRECTOR_STAGES.indexOf(stage);
  return {
    observedAt: "2026-10-02T00:00:00.000Z", repositoryHead: "1".repeat(40), ownerRequest: { requestId: "owner-1", topic: "Constantinople", format: "DOCUMENTARY", targetDurationSeconds: 720, approvedProjectCapUsd: 0.25 },
    project: { state: "PRESENT", slug: "fixture", id: "p-1", title: "Constantinople", status: stage }, manifest: "PRESENT",
    stages: AYAS_DIRECTOR_STAGES.map((key, i) => ({ stage: key, dependsOn: pipelineStageDependencies[key], status: i < index ? "completed" : "pending", artifact: i < index ? "PRESENT" : "MISSING", artifactDigest: i < index ? present.digest : null, attempts: i < index ? 1 : null, provider: local, zeroCostAlternative: null, error: null, ...(key === stage ? over : {}) })),
    factPack: present, scenePlan: present, assetManifest: present, audio: present, assembly: present,
    review: { readiness: "MEDIA_INCOMPLETE", preAssemblyGate: "PASS", postAssemblyGate: "NOT_EVALUATED", blockers: 0, majors: 0, rightsBlocked: false, findingCodes: [] },
    cost: { state: "READ", knownUsd: 0, unknownPricingRecords: 0, technicalCeilingUsd: 1 }, publication: { packageState: "MISSING", publishRecord: "ABSENT", publishStatus: null }, retryMaxAttempts: pipelineRetryMaxAttempts,
  };
}
const fail = (stage: ProductionStepKey = "animation", over: Partial<AyasDirectorStageError> = { httpStatus: 503 }, attempts = 1) => facts(stage, { status: "failed", attempts, error: error(over) });
const plan = (f: AyasDirectorSessionFacts, stage: ProductionStepKey = "animation") => planAyasProductionRepairs(f).plans.find((item) => item.stage === stage)!;
const safe = (f: AyasDirectorSessionFacts) => planAyasProductionRepairs(f).plans.filter((item) => item.action === "AUTO_REPAIR_PLAN");

scenario("twelve canonical classes and six safe repairs", () => {
  assert.deepEqual(AYAS_PRODUCTION_FAULT_CLASSES, ["TRANSIENT_EXTERNAL", "PROVIDER_UNAVAILABLE", "RATE_LIMIT", "ASSET_MISSING", "ASSET_CORRUPT", "RIGHTS_BLOCK", "QUALITY_BLOCK", "COST_BLOCK", "HOST_DEPENDENCY", "PIPELINE_STATE_DRIFT", "CODE_DEFECT", "UNKNOWN"]);
  assert.equal(AYAS_PRODUCTION_SAFE_REPAIRS.length, 6);
});
scenario("bounded transient retry and exponential backoff", () => {
  const p = plan(fail()); assert.equal(p.faultClass, "TRANSIENT_EXTERNAL"); assert.equal(p.repair, "BOUNDED_RETRY_BACKOFF"); assert.deepEqual(p.backoff, { attempt: 2, of: 3, delaySeconds: 60 });
  assert.deepEqual([2, 3, 4, 5, 6, 7, 100].map((n) => ayasRepairBackoffSeconds(n, false)), [60, 120, 240, 480, 900, 900, 900]);
  assert.ok(p.reuse.includes("RETRY_BUDGET") && p.reuse.includes("RUNTIME_STABILITY_GUARD") && p.reuse.includes("STAGE_BOUNDED_RESUME"));
});
scenario("rate limit uses conservative bounded wait", () => { const p = plan(fail("animation", { httpStatus: 429 })); assert.equal(p.faultClass, "RATE_LIMIT"); assert.equal(p.backoff?.delaySeconds, 900); });
scenario("exhausted and missing retry count do not retry", () => {
  assert.equal(plan(fail("animation", { httpStatus: 503 }, 3)).ownerQuestion, "EXTEND_RETRY_BUDGET");
  assert.equal(plan(facts("animation", { status: "failed", error: error({ httpStatus: 503 }) })).ownerQuestion, "EXTEND_RETRY_BUDGET");
});
scenario("invalid retry evidence fails closed", () => {
  for (const attempts of [-1, 0.5, NaN, Infinity]) assert.equal(planAyasProductionRepairs(fail("animation", { httpStatus: 503 }, attempts)).counts.FAIL_CLOSED, 1);
  for (const retryMaxAttempts of [0, -1, 1.5, NaN]) assert.equal(safe({ ...fail(), retryMaxAttempts }).length, 0);
});
scenario("allowed zero-cost fallback, credential fix otherwise", () => {
  const f = facts("animation", { status: "failed", attempts: 1, provider: { ...local, provider: "openai", costClass: "paid" }, error: error({ httpStatus: 401 }), zeroCostAlternative: "local" });
  assert.equal(plan(f).faultClass, "PROVIDER_UNAVAILABLE"); assert.equal(plan(f).repair, "ZERO_COST_FALLBACK");
  assert.equal(plan(facts("animation", { status: "failed", attempts: 1, error: error({ httpStatus: 401 }) })).ownerQuestion, "FIX_PROVIDER_CREDENTIAL_OR_CONFIG");
  assert.equal(plan({ ...f, stages: f.stages.map((s) => s.stage === "animation" ? { ...s, attempts: 3 } : s) }).ownerQuestion, "EXTEND_RETRY_BUDGET");
});
scenario("missing and corrupt local asset plans", () => {
  for (const artifact of ["MISSING", "MALFORMED"] as const) {
    const p = plan(facts("animation", { status: "completed", artifact, attempts: 1 }));
    assert.equal(p.faultClass, artifact === "MISSING" ? "ASSET_MISSING" : "ASSET_CORRUPT"); assert.equal(p.repair, "REGENERATE_LOCAL_SCENE_ASSET");
  }
});
scenario("deterministic assembly rerun, no file deletion", () => {
  for (const stage of ["video", "assembly"] as const) assert.equal(plan(facts(stage, { status: "completed", artifact: "MISSING", attempts: 1 }), stage).repair, "RERUN_DETERMINISTIC_ASSEMBLY");
  assert.equal(plan(facts("assembly", { status: "completed", artifact: "MISSING", attempts: 3 }), "assembly").ownerQuestion, "EXTEND_RETRY_BUDGET");
});
scenario("durable stage resume stays disabled", () => {
  const p = plan(facts()); assert.equal(p.repair, "RESUME_DURABLE_STAGE"); assert.ok(p.reuse.includes("DURABLE_RECOVERY")); assert.equal(p.dispatch?.state, "AYAS_WRITE_ACTION_DISABLED");
});
scenario("reconcile indeterminate upload only through owner pipeline", () => {
  const f = { ...facts(), publication: { packageState: "PRESENT" as const, publishRecord: "PRESENT" as const, publishStatus: "publishing" } };
  const p = safe(f); assert.equal(p.length, 1); assert.equal(p[0]!.repair, "RECONCILE_INDETERMINATE_UPLOAD"); assert.equal(p[0]!.dispatch?.action, "reconcile-publish"); assert.equal(p[0]!.dispatch?.state, "OWNER_PUBLISH_PIPELINE_ONLY"); assert.equal(p[0]!.dispatch?.executableByAyas, false);
});
scenario("uncertain publish record stops every other repair", () => {
  for (const publishRecord of ["UNREADABLE", "ABSENT"] as const) {
    const f = { ...fail(), publication: { packageState: "PRESENT" as const, publishRecord, publishStatus: "publishing" } }; assert.equal(safe(f).length, 0); assert.equal(planAyasProductionRepairs(f).counts.FAIL_CLOSED, 1);
  }
});
scenario("rights and quality gates remain owner's", () => {
  for (const rightsBlocked of [true, false]) {
    const f = facts("assembly"); const p = plan({ ...f, review: { ...f.review as Exclude<AyasDirectorSessionFacts["review"], null | "UNREADABLE">, rightsBlocked, preAssemblyGate: "BLOCKED" } }, "assembly");
    assert.equal(p.faultClass, rightsBlocked ? "RIGHTS_BLOCK" : "QUALITY_BLOCK"); assert.equal(p.action, "REQUIRE_OWNER");
  }
  assert.equal(plan({ ...facts(), review: "UNREADABLE" }).action, "FAIL_CLOSED");
});
scenario("paid and unknown-cost repairs require owner", () => {
  assert.equal(plan(facts("animation", { status: "failed", attempts: 1, error: error({ httpStatus: 503 }), provider: { ...local, provider: "openai", costClass: "paid" } })).faultClass, "COST_BLOCK");
  const f = fail(); assert.equal(safe({ ...f, cost: { ...f.cost, unknownPricingRecords: 1 } }).length, 0);
  assert.equal(plan({ ...f, cost: { ...f.cost, knownUsd: 1.1 } }).faultClass, "COST_BLOCK");
});
scenario("host storage failure is not retried", () => { const p = plan(fail("animation", { rootCode: "ANIMATION_STORAGE_WRITE_FAILED" })); assert.equal(p.faultClass, "HOST_DEPENDENCY"); assert.equal(p.action, "REQUIRE_OWNER"); });
scenario("code defect becomes bounded task after localization", () => {
  const f = fail("animation", { phase: "asset-registration" }); const r = planAyasProductionRepairs(f); const p = plan(f);
  assert.equal(p.action, "CODING_TASK"); assert.equal(p.codingTask?.productionHotPatch, false); assert.deepEqual(p.codingTask?.steps, ["local sandbox", "tests", "Graphify", "proposal", "owner promotion", "resume"]); assert.equal(p.codingTask?.holdAfterStage, "visuals"); assert.equal(safe(f).length, 0);
  const scope = { exactFiles: ["src/lib/animation/AnimationPipeline.ts"], maxChangedLines: 40 };
  const task = buildAyasProductionRepairCodingTask(r, "animation", scope); assert.equal(task.baseHead, f.repositoryHead); assert.deepEqual(task.exactFiles, scope.exactFiles); assert.equal(task.maxChangedLines, 40); assert.ok(Object.isFrozen(task)); assert.deepEqual(buildAyasProductionRepairCodingTask(r, "animation", scope), task);
  assert.throws(() => buildAyasProductionRepairCodingTask(r, "animation", { ...scope, exactFiles: ["../escape.ts"] })); assert.throws(() => buildAyasProductionRepairCodingTask(r, "animation", { ...scope, maxChangedLines: 81 }));
  assert.throws(() => buildAyasProductionRepairCodingTask(planAyasProductionRepairs({ ...f, repositoryHead: null }), "animation", scope)); assert.throws(() => buildAyasProductionRepairCodingTask(planAyasProductionRepairs(facts()), "animation", scope));
});
scenario("unknown failure explains what is known and stops other repairs", () => {
  const f = fail("animation", { code: "UNRECOGNIZED" }); const p = plan(f); assert.equal(p.faultClass, "UNKNOWN"); assert.equal(p.action, "FAIL_CLOSED"); assert.match(p.explanation, /Known:.*animation.*attempts 1.*UNRECOGNIZED/); assert.equal(safe(f).length, 0);
});
scenario("running stage is never taken over", () => { const p = plan(facts("animation", { status: "running" })); assert.equal(p.faultClass, "PIPELINE_STATE_DRIFT"); assert.equal(p.action, "WAIT"); });
scenario("uncertain or running sibling suppresses a separate safe retry", () => {
  const f = fail();
  for (const sibling of [{ status: "running" as const }, { status: "failed" as const, attempts: 1, error: error({ code: "UNRECOGNIZED" }) }]) {
    assert.equal(safe({ ...f, stages: f.stages.map((s) => s.stage === "audio" ? { ...s, ...sibling } : s) }).length, 0);
  }
});
scenario("dependency disagreement holds all repairs", () => {
  const f = facts(); const stages = f.stages.map((s) => s.stage === "visuals" ? { ...s, status: "pending" as const, artifact: "MISSING" as const } : s.stage === "animation" ? { ...s, status: "completed" as const, artifact: "PRESENT" as const } : s);
  const r = planAyasProductionRepairs({ ...f, stages }); assert.ok(r.plans.some((p) => p.ownerQuestion === "RECONCILE_PIPELINE_STATE")); assert.equal(r.counts.AUTO_REPAIR_PLAN, 0);
});
scenario("failed stage cannot retry ahead of dependencies", () => {
  const f = fail(); assert.equal(plan({ ...f, stages: f.stages.map((s) => s.stage === "visuals" ? { ...s, status: "pending" as const, artifact: "MISSING" as const } : s) }).action, "WAIT");
});
scenario("missing duplicate and substituted stage inventories fail closed", () => {
  const f = fail(); assert.equal(safe({ ...f, stages: f.stages.slice(1) }).length, 0); assert.equal(safe({ ...f, stages: [...f.stages.slice(1), f.stages[1]!] }).length, 0);
  assert.equal(safe({ ...f, stages: f.stages.map((s) => s.stage === "animation" ? { ...s, dependsOn: [] } : s) }).length, 0);
});
scenario("global holds stop even reconciliation", () => {
  for (const f of [{ ...facts(), ownerRequest: null }, { ...facts(), repositoryHead: null }, { ...facts(), project: { ...facts().project, state: "MALFORMED" as const } }]) {
    assert.equal(safe({ ...f, publication: { packageState: "PRESENT", publishRecord: "PRESENT", publishStatus: "publishing" } }).length, 0);
  }
});
scenario("all dispatch remains non executable and fact input unchanged", () => {
  const f = fail(); const before = JSON.stringify(f); const r = planAyasProductionRepairs(f); assert.equal(r.authority, "NONE"); assert.equal(r.schemaVersion, "1"); assert.equal(r.sessionDigest.length, 64); assert.equal(JSON.stringify(f), before); assert.deepEqual(planAyasProductionRepairs(f), r);
  for (const p of r.plans) if (p.dispatch) assert.equal(p.dispatch.executableByAyas, false);
  assert.equal(Object.values(r.counts).reduce((a, b) => a + b, 0), r.plans.length);
});
scenario("operator rejects missing unknown and duplicate options", () => {
  for (const args of [[], ["--apply"], ["--project", "p", "--project", "p"], ["--project"]]) {
    const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/ayas-production-fault-repair.ts", ...args], { cwd: process.cwd(), encoding: "utf8", windowsHide: true, timeout: 15_000 }); assert.equal(r.status, 1); assert.match(r.stderr, /AYAS_PRODUCTION_REPAIR_ARGUMENTS_INVALID/);
  }
});
console.log(`Stage 15L production fault repair smoke: PASS (${count} scenarios)`);
