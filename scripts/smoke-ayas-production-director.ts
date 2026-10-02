/** Stage 15I — production director session. Fixture facts and a TEMP runtime root only; no provider, no stage run, no model, nothing written outside TEMP. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import {
  AYAS_DIRECTOR_BINDINGS, AYAS_DIRECTOR_FORBIDDEN, AYAS_DIRECTOR_PUBLICATION_STAGES, AYAS_DIRECTOR_SAFE_OPERATIONS, AYAS_DIRECTOR_STAGES,
  buildAyasProductionDirectorSession, classifyAyasDirectorFault, decideAyasDirectorActions,
  type AyasDirectorDecision, type AyasDirectorProvider, type AyasDirectorSessionFacts, type AyasDirectorStageError, type AyasDirectorStageFact, type AyasProductionDirectorSession,
} from "../src/lib/ayas/director/AyasProductionDirectorSession";
import { collectAyasProductionDirectorSession, parseAyasDirectorOwnerRequest, resolveAyasDirectorProvider } from "../src/lib/ayas/director/AyasProductionDirectorCollector";
import { pipelineRecoveryStageOrder, pipelineStageDependencies } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { pipelineRetryMaxAttempts } from "../src/lib/pipeline/PipelineRetryAdmission";
import { createIsolatedRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import type { ProductionStepKey } from "../src/types/project";

let count = 0;
async function scenario(name: string, run: () => void | Promise<void>) { await run(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

const repo = process.cwd();
const envOf = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
const HEAD = "1".repeat(40);
const LOCAL: AyasDirectorProvider = { variable: "AI_PROVIDER", provider: "ollama", costClass: "local-zero-cost" };
const PAID: AyasDirectorProvider = { variable: "AI_PROVIDER", provider: "openai", costClass: "paid" };
const REQUEST = { requestId: "owner-2026-10-02-1", topic: "The fall of Constantinople", format: "DOCUMENTARY" as const, targetDurationSeconds: 720, approvedProjectCapUsd: 1 };
const PRESENT = { state: "PRESENT" as const, digest: "d".repeat(64), counts: { items: 3 } };
const ABSENT = { state: "MISSING" as const, digest: null, counts: {} };
const error = (over: Partial<AyasDirectorStageError>): AyasDirectorStageError => ({ kind: null, code: null, rootCode: null, phase: null, httpStatus: null, providerErrorCode: null, ...over });
const stageFact = (stage: ProductionStepKey, over: Partial<AyasDirectorStageFact> = {}): AyasDirectorStageFact => ({ stage, status: "pending", artifact: "MISSING", artifactDigest: null, dependsOn: pipelineStageDependencies[stage], attempts: null, provider: LOCAL, zeroCostAlternative: null, error: null, ...over });
const done = (stage: ProductionStepKey): AyasDirectorStageFact => stageFact(stage, { status: "completed", artifact: "PRESENT", artifactDigest: "d".repeat(64), attempts: 1 });
/** A pipeline with its first `completed` stages done, and any stage replaced. */
const pipeline = (completed: number, over: Partial<Record<ProductionStepKey, Partial<AyasDirectorStageFact>>> = {}): AyasDirectorStageFact[] =>
  AYAS_DIRECTOR_STAGES.map((stage, index) => ({ ...(index < completed ? done(stage) : stageFact(stage)), ...(over[stage] ?? {}) }));
const facts = (over: Partial<AyasDirectorSessionFacts> = {}): AyasDirectorSessionFacts => ({
  observedAt: "2026-10-02T00:00:00.000Z", ownerRequest: REQUEST, repositoryHead: HEAD,
  project: { state: "PRESENT", slug: "constantinople", id: "p-1", title: "Constantinople 1453", status: "animation" }, manifest: "PRESENT",
  stages: pipeline(4), factPack: PRESENT, scenePlan: PRESENT, assetManifest: PRESENT, audio: ABSENT, assembly: ABSENT,
  review: { readiness: "MEDIA_INCOMPLETE", preAssemblyGate: "REVIEW_REQUIRED", postAssemblyGate: "NOT_EVALUATED", blockers: 0, majors: 1, rightsBlocked: false, findingCodes: ["X"] },
  cost: { state: "READ", knownUsd: 0.12, unknownPricingRecords: 0, technicalCeilingUsd: 1 },
  publication: { packageState: "MISSING", publishRecord: "ABSENT", publishStatus: null }, retryMaxAttempts: 3, ...over,
});
const failed = (stage: ProductionStepKey, over: Partial<AyasDirectorStageFact>) => facts({ stages: pipeline(AYAS_DIRECTOR_STAGES.indexOf(stage), { [stage]: { status: "failed", attempts: 1, ...over } }) });
const decisionFor = (session: { readonly decisions: readonly AyasDirectorDecision[] }, stage: ProductionStepKey | null) => session.decisions.find((decision) => decision.stage === stage)!;
const binding = (session: AyasProductionDirectorSession, id: (typeof AYAS_DIRECTOR_BINDINGS)[number]) => session.bindings.find((item) => item.id === id)!;
const safeOperations = (session: { readonly decisions: readonly AyasDirectorDecision[] }) => session.decisions.filter((decision) => decision.kind === "SAFE_OPERATION");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-director-"));
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", windowsHide: true }).trim();
}
/** A TEMP runtime root with one project, and a TEMP repository whose HEAD stands for the code. */
function fixtureRuntime(name: string) {
  const base = path.join(temp, name);
  const runtime = path.join(base, "runtime"); const workspace = path.join(base, "workspace"); const authority = path.join(base, "authority");
  for (const dir of [path.join(runtime, "projects"), workspace, authority]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(workspace, "README.md"), "fixture\n");
  git(workspace, "init", "--quiet"); git(workspace, "add", "--all"); git(workspace, "commit", "--quiet", "--message", "fixture");
  const storage = createIsolatedRuntimeStorageContext({ environment: { ATOLYE_RUNTIME_ROOT: runtime }, workspaceRoot: workspace, authorityRoot: authority });
  const slug = "constantinople";
  const folder = path.join(runtime, "projects", slug);
  const write = (file: string, value: unknown) => { fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true }); fs.writeFileSync(path.join(folder, file), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`); };
  const project = { id: "p-1", slug, title: "Constantinople 1453", status: "animation", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T01:00:00.000Z" };
  const entry = (key: ProductionStepKey, status: string, extra: Record<string, unknown> = {}) => ({ key, status, fileName: `${key}.json`, updatedAt: "2026-10-01T01:00:00.000Z", ...extra });
  const writeManifest = (packages: Record<string, unknown>) => write("manifest.json", { project, projectId: project.id, slug, version: 1, packages, createdAt: project.createdAt, updatedAt: project.updatedAt });
  write("project.json", project);
  write("research.json", { topic: "Constantinople", sources: [{ id: 1 }, { id: 2 }], mediaCandidates: [] });
  write("script.json", { chapters: [{ id: 1, title: "Walls", narration: "The walls held for a thousand years." }] });
  write("scenes.json", { scenes: [{ id: 1, chapterId: 1, title: "Walls", visualDescription: "The land walls", duration: 8 }] });
  write("visuals.json", { scenes: [] });
  writeManifest({ research: entry("research", "completed"), script: entry("script", "completed"), scenes: entry("scenes", "completed"), visuals: entry("visuals", "completed"), animation: entry("animation", "pending") });
  const snapshot = () => { const out: string[] = []; const walk = (dir: string) => { for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const full = path.join(dir, item.name); if (item.isDirectory()) walk(full); else { const stat = fs.statSync(full); out.push(`${path.relative(base, full)}|${stat.size}|${stat.mtimeMs}`); } } }; walk(runtime); walk(authority); return out.join("\n"); };
  const collect = (over: Partial<Parameters<typeof collectAyasProductionDirectorSession>[0]> = {}) =>
    collectAyasProductionDirectorSession({ projectSlug: slug, now: new Date("2026-10-02T00:00:00.000Z"), repoRoot: workspace, ownerRequest: REQUEST, storage, env: envOf({ AI_PROVIDER: "ollama", ANIMATION_PROVIDER: "ollama", AUDIO_PROVIDER: "piper", IMAGE_PROVIDER: "real", THUMBNAIL_PROVIDER: "local", YOUTUBE_PROVIDER: "ollama", VIDEO_PROVIDER: "ffmpeg", VIDEO_ASSEMBLY_PROVIDER: "ffmpeg" }), ...over });
  return { base, runtime, workspace, authority, storage, slug, folder, write, entry, writeManifest, project, snapshot, collect, head: git(workspace, "rev-parse", "HEAD") };
}

async function main() {
  try {
    await scenario("the design's own lists: sixteen bindings, four safe classes, five things it may never do, twelve stages in the pipeline's order", () => {
      const read = (file: string) => fs.readFileSync(path.join(repo, "docs/ayas-execution/2026-09-27-master", file), "utf8").replace(/\r\n/g, "\n");
      const spec = read("01_CANONICAL_SPECS/AYAS_MASTER_SPRINT_V3_PRE_ATOLYE.md");
      const section = spec.slice(spec.indexOf("# STAGE 15I"), spec.indexOf("# STAGE 15J"));
      const list = (from: string, to: string) => section.slice(section.indexOf(from), section.indexOf(to)).split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2).replace(/[;.]$/, ""));
      const named: Readonly<Record<string, string>> = {
        "owner request": "OWNER_REQUEST", "topic": "TOPIC", "target duration": "TARGET_DURATION", "format": "FORMAT", "budget authorization": "BUDGET_AUTHORIZATION", "current pipeline stage": "PIPELINE_STAGE",
        "project HEAD/config identity": "CONFIG_IDENTITY", "source/fact pack": "FACT_PACK", "scene plan": "SCENE_PLAN", "asset manifest": "ASSET_MANIFEST", "audio state": "AUDIO_STATE", "assembly state": "ASSEMBLY_STATE",
        "quality findings": "QUALITY_FINDINGS", "cost state": "COST_STATE", "fault state": "FAULT_STATE", "publication readiness": "PUBLICATION_READINESS",
      };
      assert.deepEqual(list("binds:", "AYAS watches").map((item) => named[item]), [...AYAS_DIRECTOR_BINDINGS]);
      assert.equal(list("SAFE_OPERATION classes:", "It may NOT").length, AYAS_DIRECTOR_SAFE_OPERATIONS.length);
      assert.equal(list("It may NOT autonomously:", "Source-code defect:").length, AYAS_DIRECTOR_FORBIDDEN.length);
      const order = read("00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md");
      const master = order.slice(order.indexOf("## STAGE 15I"), order.indexOf("## STAGE 15J"));
      assert.match(master, /- bounded transient retry\n- allowed zero-cost provider fallback\n- missing\/corrupt local artifact regenerate via existing stage contract\n- resume already-authorized stage via durable recovery/);
      assert.match(master, /- source code hot-patch\n- budget cap increase\n- rights classification bypass\n- publish\n- production gate bypass/);
      assert.deepEqual([...AYAS_DIRECTOR_STAGES], [...pipelineRecoveryStageOrder]);
      assert.equal(pipelineRetryMaxAttempts, 3);
    });

    await scenario("a bound, healthy production in mid-pipeline: sixteen bindings stated, the next stage planned as a resume, and nothing AYAS can start", () => {
      const session = buildAyasProductionDirectorSession(facts());
      assert.deepEqual(session.bindings.map((item) => item.id), [...AYAS_DIRECTOR_BINDINGS]);
      assert.deepEqual([session.currentStage, session.holds, session.authority, session.watch.length, session.watch.filter((entry) => entry.ready).length], ["animation", [], "NONE", 12, 4]);
      assert.deepEqual(session.bindings.filter((item) => item.state !== "BOUND").map((item) => [item.id, item.state]), [["AUDIO_STATE", "NOT_PRODUCED_YET"], ["ASSEMBLY_STATE", "NOT_PRODUCED_YET"], ["PUBLICATION_READINESS", "NOT_PRODUCED_YET"]]);
      assert.equal(session.boundCount, 13);
      assert.deepEqual(session.decisions, [{ stage: "animation", kind: "SAFE_OPERATION", safeOperation: "RESUME_AUTHORIZED_STAGE", dispatch: { action: "resume-stage", state: "AYAS_WRITE_ACTION_DISABLED", executableByAyas: false },
        reason: "The owner's production is at this stage, its dependencies are complete, and the stage's provider is zero-cost." }]);
      assert.deepEqual(binding(session, "PUBLICATION_READINESS").facts.publishDecision, "OWNER_ONLY");
      assert.deepEqual([binding(session, "COST_STATE").facts.knownUsd, binding(session, "BUDGET_AUTHORIZATION").facts.autonomousBudgetUsd], [0.12, 0]);
      // Every stage complete: nothing to do, and publication is still the owner's.
      const finished = buildAyasProductionDirectorSession(facts({ stages: pipeline(12) }));
      assert.deepEqual([finished.currentStage, finished.decisions.map((decision) => decision.kind)], ["COMPLETED", ["NONE"]]);
    });

    await scenario("bindings never guess: not provided, not produced yet and unreadable are three different facts, and the technical ceiling is not an approval", () => {
      const bare = buildAyasProductionDirectorSession(facts({ ownerRequest: null, review: null }));
      assert.deepEqual(["OWNER_REQUEST", "TARGET_DURATION", "FORMAT", "BUDGET_AUTHORIZATION", "QUALITY_FINDINGS"].map((id) => binding(bare, id as never).state), ["NOT_PROVIDED", "NOT_PROVIDED", "NOT_PROVIDED", "NOT_PROVIDED", "NOT_PROVIDED"]);
      // The topic falls back to the project's own title, and says that it did.
      assert.deepEqual([binding(bare, "TOPIC").state, binding(bare, "TOPIC").facts], ["BOUND", { topic: "Constantinople 1453", fromOwnerRequest: false }]);
      assert.deepEqual(binding(bare, "BUDGET_AUTHORIZATION").facts, { approvedProjectCapUsd: null, technicalCeilingUsd: 1, autonomousBudgetUsd: 0 });
      const partial = buildAyasProductionDirectorSession(facts({ ownerRequest: { ...REQUEST, format: null, targetDurationSeconds: null, approvedProjectCapUsd: null }, review: null }));
      assert.deepEqual(["OWNER_REQUEST", "TARGET_DURATION", "FORMAT", "BUDGET_AUTHORIZATION"].map((id) => binding(partial, id as never).state), ["BOUND", "NOT_PROVIDED", "NOT_PROVIDED", "NOT_PROVIDED"]);
      // A cap of zero is an approval of zero, not a missing one.
      assert.equal(binding(buildAyasProductionDirectorSession(facts({ ownerRequest: { ...REQUEST, approvedProjectCapUsd: 0 } })), "BUDGET_AUTHORIZATION").state, "BOUND");
      assert.equal(binding(buildAyasProductionDirectorSession(facts({ review: null })), "QUALITY_FINDINGS").state, "NOT_PRODUCED_YET");
      assert.equal(binding(buildAyasProductionDirectorSession(facts({ review: "UNREADABLE" })), "QUALITY_FINDINGS").state, "UNREADABLE");
      const broken = buildAyasProductionDirectorSession(facts({ factPack: { state: "MALFORMED", digest: null, counts: {} }, cost: { state: "UNREADABLE", knownUsd: 0, unknownPricingRecords: 0, technicalCeilingUsd: 1 }, publication: { packageState: "PRESENT", publishRecord: "UNREADABLE", publishStatus: null } }));
      assert.deepEqual(["FACT_PACK", "COST_STATE", "PUBLICATION_READINESS"].map((id) => binding(broken, id as never).state), ["UNREADABLE", "UNREADABLE", "UNREADABLE"]);
      // No usage log is a fact: nothing was spent through the pipeline.
      assert.equal(binding(buildAyasProductionDirectorSession(facts({ cost: { state: "ABSENT", knownUsd: 0, unknownPricingRecords: 0, technicalCeilingUsd: 1 } })), "COST_STATE").state, "BOUND");
      const unsetProvider = buildAyasProductionDirectorSession(facts({ stages: pipeline(4, { animation: { provider: { variable: "ANIMATION_PROVIDER", provider: null, costClass: "unknown-cost" } } }) }));
      assert.deepEqual([binding(unsetProvider, "CONFIG_IDENTITY").state, binding(unsetProvider, "CONFIG_IDENTITY").facts.unsetProviders], ["UNREADABLE", 1]);
      assert.notEqual(binding(buildAyasProductionDirectorSession(facts()), "CONFIG_IDENTITY").facts.configDigest, binding(buildAyasProductionDirectorSession(facts({ stages: pipeline(4, { animation: { provider: { variable: "ANIMATION_PROVIDER", provider: "openai", costClass: "paid" } } }) })), "CONFIG_IDENTITY").facts.configDigest);
    });

    await scenario("fault classes come from the pipeline's structured evidence, and a failure without evidence is never guessed into a retryable class", () => {
      const classify = (over: Partial<AyasDirectorStageFact>) => classifyAyasDirectorFault(stageFact("audio", over))?.faultClass ?? null;
      const failure = (evidence: Partial<AyasDirectorStageError>) => classify({ status: "failed", error: error(evidence) });
      assert.deepEqual([classify({}), classify({ status: "completed", artifact: "PRESENT" }), classify({ status: "unknown" })], [null, null, null]);
      assert.deepEqual([classify({ status: "completed", artifact: "MISSING" }), classify({ status: "completed", artifact: "MALFORMED" }), classify({ status: "running" })], ["LOCAL_ARTIFACT_MISSING", "LOCAL_ARTIFACT_CORRUPT", "RUNNING_UNVERIFIED"]);
      // The manifest's own "missing" is a stage that has produced nothing yet: not a fault, and nothing to regenerate.
      assert.deepEqual([classify({ status: "missing", artifact: "MISSING" }), classify({ status: "pending", artifact: "MALFORMED" })], [null, null]);
      assert.equal(classify({ status: "failed" }), "UNCLASSIFIED_FAILURE");
      const table: readonly (readonly [Partial<AyasDirectorStageError>, string])[] = [
        [{ httpStatus: 401 }, "PROVIDER_AUTH_OR_CONFIG"], [{ httpStatus: 403 }, "PROVIDER_AUTH_OR_CONFIG"], [{ providerErrorCode: "invalid_api_key" }, "PROVIDER_AUTH_OR_CONFIG"], [{ rootCode: "AUDIO_PROVIDER_CONFIGURATION_INVALID" }, "PROVIDER_AUTH_OR_CONFIG"],
        [{ httpStatus: 429 }, "PROVIDER_RATE_LIMITED"], [{ httpStatus: 500 }, "PROVIDER_TRANSIENT"], [{ httpStatus: 503, code: "ANIMATION_PROVIDER_HTTP_FAILED" }, "PROVIDER_TRANSIENT"], [{ httpStatus: 400 }, "PROVIDER_REQUEST_REJECTED"], [{ httpStatus: 404, code: "ANIMATION_PROVIDER_HTTP_FAILED" }, "PROVIDER_REQUEST_REJECTED"],
        [{ rootCode: "AUDIO_PROVIDER_TIMEOUT" }, "PROVIDER_TRANSIENT"], [{ rootCode: "AUDIO_PROVIDER_REQUEST_FAILED" }, "PROVIDER_TRANSIENT"], [{ code: "ANIMATION_PROVIDER_RETRY_EXHAUSTED" }, "PROVIDER_TRANSIENT"],
        [{ code: "ANIMATION_PROVIDER_REFUSAL" }, "PROVIDER_REFUSAL"],
        [{ code: "AI_RESPONSE_SCHEMA_INVALID" }, "MODEL_OUTPUT_INVALID"], [{ code: "ANIMATION_RESPONSE_INVALID_JSON" }, "MODEL_OUTPUT_INVALID"], [{ code: "ANIMATION_RESPONSE_TRUNCATED" }, "MODEL_OUTPUT_INVALID"], [{ rootCode: "AUDIO_WAV_INVALID" }, "MODEL_OUTPUT_INVALID"], [{ rootCode: "AUDIO_PROVIDER_RESPONSE_TOO_LARGE" }, "MODEL_OUTPUT_INVALID"],
        // The code decides before the phase: a model plan that fails validation is an invalid answer, not a pipeline defect.
        [{ code: "ANIMATION_RESPONSE_SCHEMA_INVALID", phase: "plan-validation" }, "MODEL_OUTPUT_INVALID"], [{ code: "THUMBNAIL_ASSET_GENERATION_FAILED", phase: "provider-result-validation" }, "MODEL_OUTPUT_INVALID"],
        [{ rootCode: "AUDIO_STORAGE_WRITE_FAILED" }, "LOCAL_STORAGE"], [{ code: "THUMBNAIL_ASSET_GENERATION_FAILED", phase: "persistence" }, "LOCAL_STORAGE"],
        [{ rootCode: "AUDIO_ASSET_REGISTRY_FAILED" }, "INTERNAL_CONTRACT"], [{ code: "ANIMATION_MOTION_PLAN_FAILED", phase: "input-validation" }, "INTERNAL_CONTRACT"], [{ code: "THUMBNAIL_ASSET_GENERATION_FAILED", phase: "asset-registration" }, "INTERNAL_CONTRACT"], [{ code: "ANIMATION_MOTION_PLAN_FAILED", phase: "settlement" }, "INTERNAL_CONTRACT"],
        [{ code: "ANIMATION_MOTION_PLAN_FAILED" }, "UNCLASSIFIED_FAILURE"], [{ code: "SOMETHING_NEW" }, "UNCLASSIFIED_FAILURE"], [{ code: "THUMBNAIL_ASSET_GENERATION_FAILED", phase: "provider-response" }, "UNCLASSIFIED_FAILURE"], [{}, "UNCLASSIFIED_FAILURE"],
      ];
      for (const [evidence, expected] of table) assert.equal(failure(evidence), expected, JSON.stringify(evidence));
      // The root cause is read before the wrapper code.
      assert.equal(classifyAyasDirectorFault(stageFact("audio", { status: "failed", error: error({ code: "AUDIO_ASSET_GENERATION_FAILED", rootCode: "AUDIO_PROVIDER_TIMEOUT" }) }))!.code, "AUDIO_PROVIDER_TIMEOUT");
    });

    await scenario("the four safe classes: each only on a zero-cost provider, inside the retry bound, and each a plan AYAS cannot start", () => {
      const resume = decisionFor(buildAyasProductionDirectorSession(facts()), "animation");
      assert.deepEqual([resume.safeOperation, resume.dispatch], ["RESUME_AUTHORIZED_STAGE", { action: "resume-stage", state: "AYAS_WRITE_ACTION_DISABLED", executableByAyas: false }]);
      for (const evidence of [{ httpStatus: 503 }, { httpStatus: 429 }, { code: "AI_RESPONSE_SCHEMA_INVALID" }, { rootCode: "AUDIO_PROVIDER_TIMEOUT" }]) {
        for (const attempts of [1, 2]) {
          const retry = decisionFor(buildAyasProductionDirectorSession(failed("audio", { attempts, error: error(evidence) })), "audio");
          assert.deepEqual([retry.kind, retry.safeOperation, retry.dispatch, retry.ownerFacts], ["SAFE_OPERATION", "BOUNDED_TRANSIENT_RETRY", { action: "retry-stage", state: "NO_AYAS_WRITE_ACTION", executableByAyas: false }, { attempts, retryMaxAttempts: 3 }], JSON.stringify(evidence));
        }
      }
      for (const artifact of ["MISSING", "MALFORMED"] as const) {
        const regenerate = decisionFor(buildAyasProductionDirectorSession(facts({ stages: pipeline(4, { scenes: { artifact } }) })), "scenes");
        assert.deepEqual([regenerate.kind, regenerate.safeOperation, regenerate.dispatch!.action], ["SAFE_OPERATION", "REGENERATE_LOCAL_ARTIFACT", "regenerate-stage"], artifact);
      }
      const fallback = decisionFor(buildAyasProductionDirectorSession(failed("audio", { provider: PAID, zeroCostAlternative: "piper", error: error({ httpStatus: 503 }) })), "audio");
      assert.deepEqual([fallback.kind, fallback.safeOperation, fallback.dispatch, fallback.ownerFacts], ["SAFE_OPERATION", "ZERO_COST_PROVIDER_FALLBACK", { action: "select-provider", state: "NO_AYAS_WRITE_ACTION", executableByAyas: false }, { from: "openai", to: "piper" }]);
      const credential = decisionFor(buildAyasProductionDirectorSession(failed("audio", { provider: PAID, zeroCostAlternative: "piper", error: error({ httpStatus: 401 }) })), "audio");
      assert.deepEqual([credential.safeOperation, credential.ownerFacts], ["ZERO_COST_PROVIDER_FALLBACK", { from: "openai", to: "piper" }]);
      // While a stage is in a fault, the pipeline is not moved past it.
      const afterFault = buildAyasProductionDirectorSession(failed("audio", { error: error({ httpStatus: 503 }) }));
      assert.deepEqual(afterFault.decisions.map((decision) => [decision.stage, decision.kind]), [["audio", "SAFE_OPERATION"]]);
      // A free public source is zero-cost too; an unknown cost class and an unset provider are not.
      assert.equal(decisionFor(buildAyasProductionDirectorSession(facts({ stages: pipeline(3, { visuals: { provider: { variable: "IMAGE_PROVIDER", provider: "real", costClass: "free-public" } } }) })), "visuals").safeOperation, "RESUME_AUTHORIZED_STAGE");
      for (const provider of [{ variable: "IMAGE_PROVIDER", provider: "somewhere", costClass: "unknown-cost" }, { variable: "IMAGE_PROVIDER", provider: null, costClass: "local-zero-cost" }, { variable: "IMAGE_PROVIDER", provider: "tier", costClass: "metered-free-tier" }, { variable: "IMAGE_PROVIDER", provider: "sub", costClass: "subscription" }] as const) {
        assert.equal(decisionFor(buildAyasProductionDirectorSession(facts({ stages: pipeline(3, { visuals: { provider } }) })), "visuals").ownerQuestion, "AUTHORIZE_PAID_STAGE", JSON.stringify(provider));
      }
      assert.equal(decisionFor(buildAyasProductionDirectorSession(facts({ stages: pipeline(3, { visuals: { provider: null } }) })), "visuals").ownerQuestion, "AUTHORIZE_PAID_STAGE");
    });

    await scenario("what goes to the owner: a paid stage, a used-up retry bound, a credential, a refusal, a rejected request, storage, an unknown failure, an unknown cost", () => {
      const ask = (input: AyasDirectorSessionFacts, stage: ProductionStepKey) => { const decision = decisionFor(buildAyasProductionDirectorSession(input), stage); return [decision.kind, decision.ownerQuestion]; };
      const paidResume = decisionFor(buildAyasProductionDirectorSession(facts({ stages: pipeline(4, { animation: { provider: PAID } }) })), "animation");
      assert.deepEqual([paidResume.kind, paidResume.ownerQuestion, paidResume.ownerFacts], ["REQUIRE_OWNER", "AUTHORIZE_PAID_STAGE", { provider: "openai", costClass: "paid", knownUsd: 0.12, approvedProjectCapUsd: 1, technicalCeilingUsd: 1 }]);
      // An approved cap does not make AYAS a spender: the question is still the owner's, with the numbers beside it.
      assert.deepEqual(ask(failed("audio", { provider: PAID, error: error({ httpStatus: 503 }) }), "audio"), ["REQUIRE_OWNER", "AUTHORIZE_PAID_STAGE"]);
      assert.deepEqual(ask(facts({ stages: pipeline(4, { scenes: { artifact: "MISSING", provider: PAID } }) }), "scenes"), ["REQUIRE_OWNER", "AUTHORIZE_PAID_STAGE"]);
      for (const attempts of [3, 4]) assert.deepEqual(ask(failed("audio", { attempts, error: error({ httpStatus: 503 }) }), "audio"), ["REQUIRE_OWNER", "EXTEND_RETRY_BUDGET"], String(attempts));
      assert.deepEqual(ask(failed("audio", { attempts: 3, error: error({ code: "AI_RESPONSE_SCHEMA_INVALID" }) }), "audio"), ["REQUIRE_OWNER", "REVIEW_INVALID_MODEL_OUTPUT"]);
      // An attempt count that is not recorded cannot be checked against the bound.
      assert.deepEqual(ask(failed("audio", { attempts: null, error: error({ httpStatus: 503 }) }), "audio"), ["REQUIRE_OWNER", "EXTEND_RETRY_BUDGET"]);
      assert.deepEqual(ask(failed("audio", { error: error({ httpStatus: 401 }) }), "audio"), ["REQUIRE_OWNER", "FIX_PROVIDER_CREDENTIAL_OR_CONFIG"]);
      assert.deepEqual(ask(failed("audio", { error: error({ code: "ANIMATION_PROVIDER_REFUSAL" }) }), "audio"), ["REQUIRE_OWNER", "DECIDE_AFTER_PROVIDER_REFUSAL"]);
      assert.deepEqual(ask(failed("audio", { error: error({ httpStatus: 400 }) }), "audio"), ["REQUIRE_OWNER", "REVIEW_REJECTED_REQUEST"]);
      assert.deepEqual(ask(failed("audio", { error: error({ rootCode: "AUDIO_STORAGE_WRITE_FAILED" }) }), "audio"), ["REQUIRE_OWNER", "FREE_LOCAL_STORAGE"]);
      assert.deepEqual(ask(failed("audio", { error: null }), "audio"), ["REQUIRE_OWNER", "REVIEW_UNCLASSIFIED_FAILURE"]);
      for (const cost of [{ state: "UNREADABLE" as const, knownUsd: 0, unknownPricingRecords: 0, technicalCeilingUsd: 1 }, { state: "READ" as const, knownUsd: 0.1, unknownPricingRecords: 1, technicalCeilingUsd: 1 }]) {
        assert.deepEqual(ask(facts({ cost }), "animation"), ["REQUIRE_OWNER", "REVIEW_UNKNOWN_COST_STATE"]);
        assert.deepEqual(ask({ ...failed("audio", { error: error({ httpStatus: 503 }) }), cost }, "audio"), ["REQUIRE_OWNER", "REVIEW_UNKNOWN_COST_STATE"]);
      }
    });

    await scenario("never in its vocabulary: it does not publish, pass a rights or quality gate, raise a budget or patch source, whatever the facts", () => {
      // Publication stages are the owner's even when everything before them is complete and zero-cost.
      for (const stage of AYAS_DIRECTOR_PUBLICATION_STAGES) {
        const index = AYAS_DIRECTOR_STAGES.indexOf(stage);
        assert.deepEqual([decisionFor(buildAyasProductionDirectorSession(facts({ stages: pipeline(index) })), stage).kind, decisionFor(buildAyasProductionDirectorSession(facts({ stages: pipeline(index) })), stage).ownerQuestion], ["REQUIRE_OWNER", "PUBLICATION_IS_OWNER_ONLY"], stage);
        assert.equal(decisionFor(buildAyasProductionDirectorSession(facts({ stages: pipeline(index + 1, { [stage]: { artifact: "MISSING" } }) })), stage).ownerQuestion, "PUBLICATION_IS_OWNER_ONLY", `${stage} regenerate`);
        assert.equal(decisionFor(buildAyasProductionDirectorSession(failed(stage, { error: error({ httpStatus: 503 }) })), stage).ownerQuestion, "PUBLICATION_IS_OWNER_ONLY", `${stage} retry`);
      }
      assert.deepEqual([...AYAS_DIRECTOR_PUBLICATION_STAGES], ["youtube", "export"]);
      // A rights or quality block stops the director from assembly on; before assembly the work it blocks has not started.
      const blocked = { readiness: "RIGHTS_BLOCKED", preAssemblyGate: "BLOCKED" as const, postAssemblyGate: "NOT_EVALUATED" as const, blockers: 2, majors: 0, rightsBlocked: true, findingCodes: ["RIGHTS"] };
      for (const review of [blocked, { ...blocked, rightsBlocked: false }, { ...blocked, preAssemblyGate: "REVIEW_REQUIRED" as const }]) {
        for (const stage of ["assembly", "thumbnail", "seo"] as const) assert.equal(decisionFor(buildAyasProductionDirectorSession(facts({ review, stages: pipeline(AYAS_DIRECTOR_STAGES.indexOf(stage)) })), stage).ownerQuestion, "REVIEW_RIGHTS_OR_QUALITY_GATE", stage);
        assert.equal(decisionFor(buildAyasProductionDirectorSession(facts({ review })), "animation").safeOperation, "RESUME_AUTHORIZED_STAGE");
      }
      // Over a wide set of facts: every decision is one of five kinds, every plan one of four classes, none executable.
      const forbidden = /publish|upload|patch|hot.?fix|raise|increase|bypass|override|force|delete|rights/i;
      const evidences: (AyasDirectorStageError | null)[] = [null, error({ httpStatus: 401 }), error({ httpStatus: 429 }), error({ httpStatus: 503 }), error({ httpStatus: 400 }), error({ code: "ANIMATION_PROVIDER_REFUSAL" }), error({ code: "AI_RESPONSE_SCHEMA_INVALID" }), error({ rootCode: "AUDIO_STORAGE_WRITE_FAILED" }), error({ phase: "settlement" })];
      let seen = 0;
      for (const stage of AYAS_DIRECTOR_STAGES) for (const status of ["pending", "running", "failed", "completed", "missing", "unknown"] as const) for (const artifact of ["PRESENT", "MISSING", "MALFORMED"] as const) for (const provider of [LOCAL, PAID, null]) for (const evidence of status === "failed" ? evidences : [null]) for (const attempts of [null, 1, 3]) {
        const input = facts({ stages: pipeline(AYAS_DIRECTOR_STAGES.indexOf(stage), { [stage]: { status, artifact, provider, zeroCostAlternative: provider === PAID ? "piper" : null, error: evidence, attempts } }) });
        const session = buildAyasProductionDirectorSession(input);
        for (const decision of session.decisions) {
          seen++;
          assert.ok(["NONE", "WAIT", "SAFE_OPERATION", "REQUIRE_OWNER", "ROUTE_CODE_DEFECT"].includes(decision.kind));
          if (decision.kind === "SAFE_OPERATION") {
            assert.ok((AYAS_DIRECTOR_SAFE_OPERATIONS as readonly string[]).includes(decision.safeOperation!));
            assert.ok(["resume-stage", "retry-stage", "regenerate-stage", "select-provider"].includes(decision.dispatch!.action) && decision.dispatch!.executableByAyas === false);
            assert.ok(!forbidden.test(`${decision.safeOperation} ${decision.dispatch!.action}`));
            assert.ok(!AYAS_DIRECTOR_PUBLICATION_STAGES.includes(decision.stage!), `${decision.stage} is never dispatched`);
            // A safe operation on the stage's own provider is zero-cost; the only other one names a zero-cost provider.
            assert.ok(input.stages.find((candidate) => candidate.stage === decision.stage)!.provider === LOCAL || decision.safeOperation === "ZERO_COST_PROVIDER_FALLBACK", `${stage} ${status} ${decision.safeOperation}`);
          } else assert.equal(decision.dispatch, undefined);
        }
        assert.equal(session.authority, "NONE");
      }
      assert.ok(seen > 3000);
      assert.deepEqual([...AYAS_DIRECTOR_FORBIDDEN], ["SOURCE_CODE_HOT_PATCH", "BUDGET_CAP_INCREASE", "RIGHTS_CLASSIFICATION_BYPASS", "PUBLISH", "PRODUCTION_GATE_BYPASS"]);
    });

    await scenario("a code defect is routed to controlled self-evolution and holds the production: no safe operation anywhere in it", () => {
      const input = failed("audio", { error: error({ rootCode: "AUDIO_ASSET_REGISTRY_FAILED", phase: "registry" }) });
      const session = buildAyasProductionDirectorSession(input);
      const routed = decisionFor(session, "audio");
      assert.deepEqual([routed.kind, routed.route, routed.dispatch, routed.safeOperation], ["ROUTE_CODE_DEFECT", { target: "STAGE_15_CONTROLLED_SELF_EVOLUTION", holdAfterStage: "video", defect: { stage: "audio", faultClass: "INTERNAL_CONTRACT", code: "AUDIO_ASSET_REGISTRY_FAILED", phase: "registry", httpStatus: null }, repositoryHead: HEAD }, undefined, undefined]);
      assert.deepEqual([session.holds, safeOperations(session).length], [["CODE_DEFECT_PENDING_REPAIR"], 0]);
      // Another stage of the same production with a fault that would otherwise be retried or regenerated waits too.
      const two = buildAyasProductionDirectorSession({ ...input, stages: input.stages.map((stage) => (stage.stage === "scenes" ? { ...stage, artifact: "MISSING" as const } : stage)) });
      assert.deepEqual(two.decisions.map((decision) => [decision.stage, decision.kind]), [["scenes", "WAIT"], ["audio", "ROUTE_CODE_DEFECT"]]);
      assert.match(decisionFor(two, "scenes").reason, /CODE_DEFECT_PENDING_REPAIR/);
      // The first stage has nothing before it to hold after.
      assert.equal(decisionFor(buildAyasProductionDirectorSession(failed("research", { error: error({ phase: "input-validation" }) })), "research").route!.holdAfterStage, null);
    });

    await scenario("holds: without an owner request, a readable record or a known commit, nothing is planned", () => {
      const unowned = buildAyasProductionDirectorSession(facts({ ownerRequest: null }));
      assert.deepEqual([unowned.holds, unowned.decisions.map((decision) => [decision.stage, decision.kind, decision.ownerQuestion])], [["OWNER_REQUEST_NOT_BOUND"], [[null, "REQUIRE_OWNER", "BIND_OWNER_REQUEST"], ["animation", "WAIT", undefined]]]);
      assert.equal(safeOperations(buildAyasProductionDirectorSession({ ...failed("audio", { error: error({ httpStatus: 503 }) }), ownerRequest: null })).length, 0);
      for (const head of [null, "main", "1".repeat(39)]) {
        const headless = buildAyasProductionDirectorSession(facts({ repositoryHead: head }));
        assert.deepEqual([headless.holds, safeOperations(headless).length, binding(headless, "CONFIG_IDENTITY").state], [["REPOSITORY_HEAD_UNKNOWN"], 0, "UNREADABLE"], String(head));
      }
      for (const over of [{ project: { state: "MISSING" as const, slug: "constantinople", id: null, title: null, status: null }, manifest: "ABSENT" as const, stages: [] }, { project: { state: "MALFORMED" as const, slug: "constantinople", id: null, title: null, status: null }, manifest: "ABSENT" as const, stages: [] }, { manifest: "ABSENT" as const, stages: [] }, { stages: pipeline(4).slice(0, 11) }]) {
        const unreadable = buildAyasProductionDirectorSession(facts(over));
        assert.deepEqual([unreadable.currentStage, unreadable.holds, unreadable.decisions.map((decision) => decision.ownerQuestion), safeOperations(unreadable).length], ["UNKNOWN", ["PROJECT_RECORD_UNREADABLE"], ["REPAIR_PROJECT_RECORD"], 0]);
      }
      assert.equal(binding(buildAyasProductionDirectorSession(facts({ project: { state: "MISSING", slug: "constantinople", id: null, title: null, status: null }, manifest: "ABSENT", stages: [] })), "PIPELINE_STAGE").state, "NOT_PRODUCED_YET");
    });

    await scenario("a running stage is reported and never taken over; a dependency that is not ready is waited for", () => {
      const running = buildAyasProductionDirectorSession(facts({ stages: pipeline(4, { animation: { status: "running" } }) }));
      assert.deepEqual(running.decisions.map((decision) => [decision.stage, decision.kind]), [["animation", "WAIT"]]);
      assert.deepEqual(running.watch.find((entry) => entry.stage === "animation")!.fault, { stage: "animation", faultClass: "RUNNING_UNVERIFIED", code: null, phase: null, httpStatus: null });
      const waiting = buildAyasProductionDirectorSession(facts({ stages: pipeline(4, { animation: { dependsOn: ["scenes", "audio"] } }) }));
      assert.deepEqual([decisionFor(waiting, "animation").kind, decisionFor(waiting, "animation").reason], ["WAIT", "Waiting on audio."]);
    });

    await scenario("the same facts give the same session and digest; a changed fact gives another digest and the same session id", () => {
      const first = buildAyasProductionDirectorSession(facts()); const second = buildAyasProductionDirectorSession(JSON.parse(JSON.stringify(facts())) as AyasDirectorSessionFacts);
      assert.equal(JSON.stringify(first), JSON.stringify(second));
      const later = buildAyasProductionDirectorSession(facts({ cost: { state: "READ", knownUsd: 0.5, unknownPricingRecords: 0, technicalCeilingUsd: 1 } }));
      assert.notEqual(later.sessionDigest, first.sessionDigest); assert.equal(later.sessionId, first.sessionId);
      assert.notEqual(buildAyasProductionDirectorSession(facts({ ownerRequest: { ...REQUEST, requestId: "owner-2" } })).sessionId, first.sessionId);
      assert.deepEqual(decideAyasDirectorActions(facts()).decisions, first.decisions);
    });

    await scenario("owner request: taken only in the shape the session binds", () => {
      assert.deepEqual(parseAyasDirectorOwnerRequest({ requestId: "r-1", topic: "  Walls  " }), { requestId: "r-1", topic: "Walls", format: null, targetDurationSeconds: null, approvedProjectCapUsd: null });
      assert.deepEqual(parseAyasDirectorOwnerRequest(REQUEST), REQUEST);
      for (const bad of [null, [], "topic", {}, { requestId: "r-1" }, { requestId: "r 1", topic: "x" }, { requestId: "r-1", topic: "" }, { requestId: "r-1", topic: "x".repeat(301) }, { ...REQUEST, format: "SHORT" }, { ...REQUEST, targetDurationSeconds: 0 }, { ...REQUEST, targetDurationSeconds: 1.5 },
        { ...REQUEST, approvedProjectCapUsd: -1 }, { ...REQUEST, approvedProjectCapUsd: "1" }, { ...REQUEST, approvedProjectCapUsd: 1001 }, { ...REQUEST, approved: true }, { ...REQUEST, publish: true }]) {
        assert.throws(() => parseAyasDirectorOwnerRequest(bad), /AYAS_DIRECTOR_OWNER_REQUEST_INVALID/, JSON.stringify(bad));
      }
    });

    await scenario("provider selection is the production path's own: an unset text, speech, thumbnail or package provider is the paid default", () => {
      const of = (variable: string, env: Record<string, string>) => { const provider = resolveAyasDirectorProvider(variable, envOf(env)); return [provider.provider, provider.costClass]; };
      for (const variable of ["AI_PROVIDER", "AUDIO_PROVIDER", "THUMBNAIL_PROVIDER", "YOUTUBE_PROVIDER"]) { assert.deepEqual(of(variable, {}), ["openai", "paid"], variable); assert.deepEqual(of(variable, { [variable]: "mock" }), ["openai", "paid"], variable); }
      assert.deepEqual([of("AI_PROVIDER", { AI_PROVIDER: "ollama" }), of("AUDIO_PROVIDER", { AUDIO_PROVIDER: " Piper " }), of("THUMBNAIL_PROVIDER", { THUMBNAIL_PROVIDER: "local" }), of("AI_PROVIDER", { AI_PROVIDER: "openrouter" })], [["ollama", "local-zero-cost"], ["piper", "local-zero-cost"], ["local", "local-zero-cost"], ["openrouter", "paid"]]);
      assert.deepEqual([of("IMAGE_PROVIDER", { IMAGE_PROVIDER: "real" }), of("IMAGE_PROVIDER", { IMAGE_PROVIDER: "openai" }), of("ANIMATION_PROVIDER", { ANIMATION_PROVIDER: "ollama" }), of("ANIMATION_PROVIDER", { ANIMATION_PROVIDER: "somewhere" })], [["real", "free-public"], ["openai", "paid"], ["ollama", "local-zero-cost"], [null, "unknown-cost"]]);
      assert.deepEqual([of("VIDEO_PROVIDER", {}), of("VIDEO_ASSEMBLY_PROVIDER", { VIDEO_ASSEMBLY_PROVIDER: "ffmpeg" }), of("VIDEO_PROVIDER", { VIDEO_PROVIDER: "cloud-render" })], [["mock", "local-zero-cost"], ["ffmpeg", "local-zero-cost"], ["cloud-render", "unknown-cost"]]);
    });

    await scenario("collector on a TEMP runtime: binds from the pipeline's own files, reads only, and names what is missing, corrupt, failed or unpriced", async () => {
      const fixture = fixtureRuntime("collector");
      const { session, facts: read, readRetries } = await fixture.collect();
      assert.deepEqual([session.currentStage, session.holds, readRetries, read.repositoryHead, read.project, read.manifest, read.retryMaxAttempts], ["animation", [], 0, fixture.head, { state: "PRESENT", slug: "constantinople", id: "p-1", title: "Constantinople 1453", status: "animation" }, "PRESENT", 3]);
      assert.deepEqual(session.decisions.map((decision) => [decision.stage, decision.kind, decision.safeOperation]), [["animation", "SAFE_OPERATION", "RESUME_AUTHORIZED_STAGE"]]);
      assert.deepEqual([read.factPack.state, read.factPack.counts, read.scenePlan.counts, read.assetManifest.state, read.cost, read.publication], ["PRESENT", { mediaCandidates: 0, sources: 2 }, { scenes: 1 }, "MISSING", { state: "ABSENT", knownUsd: 0, unknownPricingRecords: 0, technicalCeilingUsd: 1 }, { packageState: "MISSING", publishRecord: "ABSENT", publishStatus: null }]);
      assert.deepEqual(read.stages.map((stage) => [stage.stage, stage.status, stage.artifact, stage.provider!.provider]), [
        ["research", "completed", "PRESENT", "ollama"], ["script", "completed", "PRESENT", "ollama"], ["scenes", "completed", "PRESENT", "ollama"], ["visuals", "completed", "PRESENT", "real"], ["animation", "pending", "MISSING", "ollama"], ["video", "missing", "MISSING", "ffmpeg"],
        ["audio", "missing", "MISSING", "piper"], ["assembly", "missing", "MISSING", "ollama"], ["thumbnail", "missing", "MISSING", "local"], ["seo", "missing", "MISSING", "ollama"], ["youtube", "missing", "MISSING", "ollama"], ["export", "missing", "MISSING", "local"]]);
      assert.equal(binding(session, "QUALITY_FINDINGS").state, "BOUND", "the Stage 12 review ran on the artifacts");
      assert.ok(!JSON.stringify(session).includes(temp) && !JSON.stringify(session).includes(temp.replace(/\\/g, "\\\\")), "no path in the session");
      // With the unset defaults the text provider is the paid one, and AYAS plans no spend.
      const paid = await fixture.collect({ env: envOf({}) });
      assert.deepEqual([decisionFor(paid.session, "animation").kind, paid.facts.stages.find((stage) => stage.stage === "audio")!.provider, paid.facts.stages.find((stage) => stage.stage === "audio")!.zeroCostAlternative, paid.facts.stages.find((stage) => stage.stage === "assembly")!.provider!.provider], ["SAFE_OPERATION", { variable: "AUDIO_PROVIDER", provider: "openai", costClass: "paid" }, "piper", "openai"]);
      assert.deepEqual((await fixture.collect({ env: envOf({ ANIMATION_PROVIDER: "openai" }) })).session.decisions.map((decision) => decision.ownerQuestion), ["AUTHORIZE_PAID_STAGE"]);

      // A stage recorded complete whose file is gone, then one whose file is not JSON.
      fs.rmSync(path.join(fixture.folder, "scenes.json"));
      assert.deepEqual((await fixture.collect()).session.decisions.map((decision) => [decision.stage, decision.safeOperation]), [["scenes", "REGENERATE_LOCAL_ARTIFACT"]]);
      fixture.write("scenes.json", "{ not json");
      const corrupt = await fixture.collect();
      assert.deepEqual([corrupt.session.watch.find((entry) => entry.stage === "scenes")!.fault!.faultClass, binding(corrupt.session, "SCENE_PLAN").state, binding(corrupt.session, "QUALITY_FINDINGS").state], ["LOCAL_ARTIFACT_CORRUPT", "UNREADABLE", "NOT_PRODUCED_YET"]);
      fixture.write("scenes.json", { scenes: [{ id: 1, chapterId: 1, title: "Walls", visualDescription: "The land walls", duration: 8 }] });

      // Artifacts the Stage 12 review cannot read are an unreadable review, not a review that was never made.
      fixture.write("visuals.json", { visuals: "not the shape the review reads" });
      assert.equal(binding((await fixture.collect()).session, "QUALITY_FINDINGS").state, "UNREADABLE");
      fixture.write("visuals.json", { scenes: [] });

      // A failed stage: the job's structured evidence and attempt count decide.
      fixture.writeManifest({ research: fixture.entry("research", "completed"), script: fixture.entry("script", "completed"), scenes: fixture.entry("scenes", "completed"), visuals: fixture.entry("visuals", "completed"),
        animation: fixture.entry("animation", "failed", { error: "provider timeout", attempts: { total: 1, retry: 0 } }) });
      fixture.write("pipeline-jobs.json", { projectSlug: fixture.slug, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T02:00:00.000Z", jobs: [{ id: "job-1", projectSlug: fixture.slug, stage: "animation", title: "animation", status: "failed", attempts: 2, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T02:00:00.000Z",
        error: "timeout", errorEvidence: { kind: "animation-motion-plan-error", code: "ANIMATION_PROVIDER_TIMEOUT", sceneId: 1, phase: "provider-request" } }] });
      const failure = await fixture.collect();
      const animation = failure.facts.stages.find((stage) => stage.stage === "animation")!;
      assert.deepEqual([animation.status, animation.attempts, animation.error], ["failed", 2, { kind: "animation-motion-plan-error", code: "ANIMATION_PROVIDER_TIMEOUT", rootCode: null, phase: "provider-request", httpStatus: null, providerErrorCode: null }]);
      assert.deepEqual([decisionFor(failure.session, "animation").safeOperation, decisionFor(failure.session, "animation").ownerFacts], ["BOUNDED_TRANSIENT_RETRY", { attempts: 2, retryMaxAttempts: 3 }]);
      // A job list that cannot be read: the manifest's own attempt count stands in, and nothing is invented.
      fixture.write("pipeline-jobs.json", "{ not json");
      const noJobs = (await fixture.collect()).facts.stages.find((stage) => stage.stage === "animation")!;
      assert.deepEqual([noJobs.attempts, noJobs.error], [1, null]);
      assert.equal(decisionFor((await fixture.collect()).session, "animation").ownerQuestion, "REVIEW_UNCLASSIFIED_FAILURE");
      fs.rmSync(path.join(fixture.folder, "pipeline-jobs.json"));

      // What it has cost: known spend is summed; one unpriced record makes the cost unknown and stops every plan.
      fixture.writeManifest({ research: fixture.entry("research", "completed"), script: fixture.entry("script", "completed"), scenes: fixture.entry("scenes", "completed"), visuals: fixture.entry("visuals", "completed") });
      const record = (id: string, extra: Record<string, unknown>) => ({ id, projectSlug: fixture.slug, stage: "script", operation: "write", provider: "openai", status: "success", fallbackUsed: false, durationMs: 1, promptLength: 1, createdAt: "2026-10-01T00:00:00.000Z", ...extra });
      const usage = (records: unknown[]) => fixture.write("ai-usage.json", { projectSlug: fixture.slug, records, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });
      usage([record("u1", { estimatedCost: 0.2, pricingStatus: "known" }), record("u2", { estimatedCost: 0.05, pricingStatus: "known" }), record("u3", { estimatedCost: 0, pricingStatus: "free" })]);
      const priced = await fixture.collect();
      assert.deepEqual([priced.facts.cost, decisionFor(priced.session, "animation").kind], [{ state: "READ", knownUsd: 0.25, unknownPricingRecords: 0, technicalCeilingUsd: 1 }, "SAFE_OPERATION"]);
      usage([record("u1", { estimatedCost: 0.2, pricingStatus: "known" }), record("u4", { pricingStatus: "unknown" })]);
      assert.deepEqual((await fixture.collect()).session.decisions.map((decision) => decision.ownerQuestion), ["REVIEW_UNKNOWN_COST_STATE"]);
      for (const bad of ["{ not json", { records: "none" }]) { fixture.write("ai-usage.json", bad); assert.equal((await fixture.collect()).facts.cost.state, "UNREADABLE"); }
      fs.rmSync(path.join(fixture.folder, "ai-usage.json"));

      // The asset registry and the publish record are read where the pipeline keeps them.
      fixture.write("assets/assets.json", { projectSlug: fixture.slug, assets: [{ id: "a1", type: "image" }, { id: "a2", type: "audio" }] });
      fixture.write("youtube-publish.json", { status: "published" });
      const more = await fixture.collect();
      assert.deepEqual([more.facts.assetManifest.state, more.facts.assetManifest.counts, more.facts.publication], ["PRESENT", { assets: 2 }, { packageState: "MISSING", publishRecord: "PRESENT", publishStatus: "published" }]);
      fs.rmSync(path.join(fixture.folder, "assets"), { recursive: true }); fs.rmSync(path.join(fixture.folder, "youtube-publish.json"));

      // Another project, a missing project and an unsafe slug.
      const missing = await fixture.collect({ projectSlug: "nothing-here" });
      assert.deepEqual([missing.facts.project.state, missing.session.currentStage, missing.session.holds], ["MISSING", "UNKNOWN", ["PROJECT_RECORD_UNREADABLE"]]);
      for (const slug of ["../escape", "C:/secrets", "a/b", "", "UPPER", "a".repeat(121)]) await assert.rejects(() => fixture.collect({ projectSlug: slug }), /AYAS_DIRECTOR_PROJECT_SLUG_INVALID/, slug);
      assert.equal((await fixture.collect({ repoRoot: fixture.runtime })).session.holds.join(), "REPOSITORY_HEAD_UNKNOWN", "a directory that is not a repository has no HEAD");
      // Reads only: after every kind of collection above, one more round leaves each file's size and time as they were.
      const before = fixture.snapshot();
      await fixture.collect(); await fixture.collect({ env: envOf({}) }); await fixture.collect({ projectSlug: "nothing-here" });
      assert.equal(fixture.snapshot(), before, "every file in the runtime and authority roots is as it was: the collector wrote nothing");
      assert.deepEqual(fs.readdirSync(path.join(fixture.runtime, "projects")), [fixture.slug], "no folder was made for the project that does not exist");
    });

    await scenario("bounded read retry: a transient read failure is read again at most twice, and a lasting one is unreadable, never absent", async () => {
      const fixture = fixtureRuntime("retry");
      const promises = fs.promises as unknown as { readFile: (...args: unknown[]) => Promise<unknown> };
      const real = promises.readFile;
      const failing = (times: number, code: string, match: string) => { let left = times; let calls = 0; promises.readFile = (...args: unknown[]) => { if (String(args[0]).endsWith(match)) { calls++; if (left-- > 0) return Promise.reject(Object.assign(new Error("busy"), { code })); } return real.apply(fs.promises, args); }; return () => calls; };
      try {
        let calls = failing(1, "EBUSY", "research.json");
        const once = await fixture.collect();
        assert.deepEqual([once.readRetries >= 1, once.facts.factPack.state, calls() >= 2], [true, "PRESENT", true]);
        calls = failing(2, "EAGAIN", "scenes.json");
        const twice = await fixture.collect();
        assert.deepEqual([twice.facts.scenePlan.state, twice.session.decisions.map((decision) => decision.safeOperation)], ["PRESENT", ["RESUME_AUTHORIZED_STAGE"]]);
        calls = failing(1000, "EBUSY", "scenes.json");
        const lasting = await fixture.collect();
        assert.deepEqual([lasting.facts.scenePlan.state, lasting.facts.stages.find((stage) => stage.stage === "scenes")!.artifact, calls() <= 12], ["MALFORMED", "MALFORMED", true], "bounded, and unreadable is not the same as missing");
        // A failure that is not transient is not retried.
        calls = failing(1000, "EACCES", "research.json");
        const denied = await fixture.collect();
        assert.deepEqual([denied.readRetries, denied.facts.factPack.state], [0, "MALFORMED"]);
      } finally { promises.readFile = real; }
    });

    await scenario("operator script: prints the session, writes nothing, and refuses arguments it does not know", () => {
      const fixture = fixtureRuntime("operator");
      const tsx = path.join(repo, "node_modules", "tsx", "dist", "cli.mjs");
      const script = path.join(repo, "scripts", "ayas-production-director.ts");
      fs.writeFileSync(path.join(fixture.base, "request.json"), JSON.stringify(REQUEST));
      const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", ATOLYE_RUNTIME_ROOT: fixture.runtime, ATOLYE_RUNTIME_AUTHORITY_ROOT: fixture.authority, AI_PROVIDER: "ollama", ANIMATION_PROVIDER: "ollama", AUDIO_PROVIDER: "piper", IMAGE_PROVIDER: "real", THUMBNAIL_PROVIDER: "local", YOUTUBE_PROVIDER: "ollama" };
      // The script runs from another directory, so the path aliases are resolved from this repository's own tsconfig.
      const run = (...args: string[]) => spawnSync(process.execPath, [tsx, "--tsconfig", path.join(repo, "tsconfig.json"), script, ...args], { cwd: fixture.workspace, encoding: "utf8", windowsHide: true, timeout: 120_000, env });
      const before = fixture.snapshot();
      const printed = run("--project", fixture.slug, "--owner-request", path.join(fixture.base, "request.json"));
      assert.equal(printed.status, 0, printed.stderr);
      assert.match(printed.stdout, /^stage {8}animation$/m); assert.match(printed.stdout, /^bindings {5}12 of 16 bound$/m); assert.match(printed.stdout, /^authority {4}NONE$/m);
      assert.match(printed.stdout, /animation {2}SAFE_OPERATION {4}RESUME_AUTHORIZED_STAGE -> resume-stage \[AYAS_WRITE_ACTION_DISABLED; not executable by AYAS\]/);
      const json = run("--project", fixture.slug, "--json");
      assert.equal(json.status, 0, json.stderr);
      const parsed = JSON.parse(json.stdout) as { storage: string; session: AyasProductionDirectorSession };
      assert.deepEqual([parsed.storage, parsed.session.holds, parsed.session.decisions.map((decision) => decision.ownerQuestion ?? decision.kind)], ["explicit-external", ["OWNER_REQUEST_NOT_BOUND"], ["BIND_OWNER_REQUEST", "WAIT"]]);
      fs.writeFileSync(path.join(fixture.base, "bad.json"), JSON.stringify({ ...REQUEST, publish: true }));
      const refusedRequest = run("--project", fixture.slug, "--owner-request", path.join(fixture.base, "bad.json"));
      assert.equal(refusedRequest.status, 1); assert.match(refusedRequest.stderr, /AYAS_DIRECTOR_OWNER_REQUEST_INVALID/);
      for (const args of [[], ["--json"], ["--project"], ["--project", fixture.slug, "--execute"], ["--project", fixture.slug, "--project", "other"], ["--unknown"]]) {
        const refused = run(...args); assert.equal(refused.status, 1, args.join(" ")); assert.match(refused.stderr, /AYAS_DIRECTOR_ARGUMENTS_INVALID/, args.join(" "));
      }
      assert.equal(fixture.snapshot(), before, "the operator script wrote nothing");
      assert.deepEqual(fs.readdirSync(fixture.workspace).sort(), [".git", "README.md"]);
    });

    await scenario("read model only: a pure session, a collector with no write, provider or process call, and nothing that runs a stage in its reach", () => {
      const sessionModule = "src/lib/ayas/director/AyasProductionDirectorSession.ts";
      const collectorModule = "src/lib/ayas/director/AyasProductionDirectorCollector.ts";
      const cli = "scripts/ayas-production-director.ts";
      const code = (file: string) => fs.readFileSync(path.join(repo, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      assert.ok(!/node:fs|node:child_process|node:path|node:os|Date\.now|new Date\(|process\./.test(code(sessionModule)), "the session module is pure");
      for (const file of [sessionModule, collectorModule, cli]) {
        for (const forbidden of [/\bfetch\s*\(/, /node:https?|node:net|node:dns|node:tls/, /node:child_process/, /\bexec(?:File)?(?:Sync)?\s*\(|\bspawn(?:Sync)?\s*\(/, /shell\s*:\s*true/,
          /writeFile|appendFile|\bmkdir|\brm(?:Sync)?\s*\(|unlink|rename|copyFile|createWriteStream/, /ProjectWriter|PipelineRunner|PipelineStageExecutor|PipelineQueueScheduler|AyasExecutionBridge|AyasWriteExecutor|ProductionAcceptanceOrchestrator|YouTubePublish/]) {
          assert.ok(!forbidden.test(code(file)), `${file} must not contain ${forbidden}`);
        }
      }
      // The collector calls only the readers' read methods, and asks Git one thing.
      const calls = [...code(collectorModule).matchAll(/\b(ProjectManager|ProjectReader|PipelineJobManager)\.([A-Za-z]+)(?:<[^>]*>)?\(/g)].map((match) => `${match[1]}.${match[2]}`);
      assert.deepEqual([...new Set(calls)].sort(), ["PipelineJobManager.listJobsReadOnly", "ProjectManager.getManifest", "ProjectReader.getProjectFolder", "ProjectReader.readJSONState"]);
      assert.deepEqual([...code(collectorModule).matchAll(/readAyasGit\(options\.repoRoot, \[([^\]]*)\]/g)].map((match) => match[1]), ['"rev-parse", "HEAD"']);
      assert.equal(code(collectorModule).split("process.env").length - 1, 1, "the environment is read in one place: which providers are selected");
      // Nothing in the application, the daemons or a package script starts it.
      for (const starter of ["scripts/ayas-autonomy-daemon.ts", "scripts/ayas-discovery-daemon.ts", "package.json"]) {
        if (fs.existsSync(path.join(repo, starter))) assert.ok(!/ayas-production-director|AyasProductionDirector/.test(fs.readFileSync(path.join(repo, starter), "utf8")), starter);
      }
    });
  } finally {
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-director-"));
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log(`Stage 15I production director: PASS (${count} scenarios; ${AYAS_DIRECTOR_BINDINGS.length} bindings, ${AYAS_DIRECTOR_SAFE_OPERATIONS.length} safe classes; TEMP only; provider/stage/model actions 0)`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
