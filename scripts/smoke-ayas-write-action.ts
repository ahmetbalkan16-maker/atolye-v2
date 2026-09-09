/**
 * AYAS write action (`resume-stage`) smoke suite (spec §13–§16, §23).
 *
 * Deterministic / $0 / no network / no real PipelineRunner. Covers:
 *  - the strict validator: wildcard project/stage, unknown stage, stage not in
 *    the resume plan, unsafe slug, shell content, unexpected keys, bad authz id;
 *  - the executor (mock runner): one bounded stage, a plan re-check, a run that
 *    overshoots its bound → fail closed, a runner failure → throw;
 *  - the bridge: `resume-stage` is DENIED `write-execution-disabled` by default;
 *    with `writeActionsEnabled: true` + a TEST-opened gate it runs end to end,
 *    audits, settles to READY; a crash faults the gate to CLOSED and the
 *    single-use authorization can never be replayed; the request's
 *    `authorizationId` must match the supplied one.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  validateAyasResumeStageRequest,
  canonicalAyasResumeStageRequest,
  AYAS_RESUMABLE_STAGES,
} from "../src/lib/ayas/execution/AyasWriteActionPolicy";
import { createAyasResumeStageExecutor, type AyasPipelineResumeRunner } from "../src/lib/ayas/execution/AyasWriteExecutor";
import { AyasExecutionGateStore } from "../src/lib/ayas/execution/AyasExecutionGateStore";
import { AyasExecutionAuthorizationStore } from "../src/lib/ayas/execution/AyasExecutionAuthorization";
import { createAyasExecutionBridge } from "../src/lib/ayas/execution/AyasExecutionBridge";
import { ayasExecutionRequestSchemaVersion } from "../src/lib/ayas/execution/AyasExecutionPolicy";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const ACT_ID = "authz-activation-00000000-1111-2222-3333";
const AUTHZ = "authz-abcdef01-2345-6789-abcd-ef0123456789";

function req(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: ayasExecutionRequestSchemaVersion,
    action: "resume-stage",
    requestedBy: "ayas-session-1",
    intent: "Kullanıcı visuals aşamasını devam ettirmemi istedi.",
    projectSlug: "osmanlinin-kurulusu",
    stage: "visuals",
    authorizationId: AUTHZ,
    ...over,
  };
}

const okRunner = (over: Partial<Awaited<ReturnType<AyasPipelineResumeRunner["resume"]>>> = {}): AyasPipelineResumeRunner => ({
  async resume(projectSlug, options) {
    return {
      success: true,
      projectSlug,
      resumedFrom: options.stopAfterStage ?? null,
      completedStages: [options.stopAfterStage ?? "visuals"],
      blocked: false,
      stoppedAfterStage: options.stopAfterStage,
      ...over,
    };
  },
});

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-write-"));
}
function openTestGate(root: string) {
  let clock = Date.parse("2026-09-09T12:00:00.000Z");
  const gate = new AyasExecutionGateStore({ rootDir: root, now: () => new Date((clock += 1000)) });
  gate.transition({ event: "arm" });
  gate.transition({ event: "confirm-ready" });
  gate.transition({ event: "open", activationAuthorizationId: ACT_ID });
  assert.equal(gate.read().state, "OPEN");
  return gate;
}

async function run() {
  /* ---------------------------- validator (§14) ---------------------------- */

  await scenario("validator — a well-formed resume-stage request validates", () => {
    const v = validateAyasResumeStageRequest(req(), { planStages: ["visuals", "animation"] });
    assert.equal(v.ok, true);
    if (v.ok) {
      assert.equal(v.request.stage, "visuals");
      assert.equal(v.request.projectSlug, "osmanlinin-kurulusu");
    }
  });

  await scenario("validator — the 12 canonical stages, and only those, are resumable", () => {
    assert.equal(AYAS_RESUMABLE_STAGES.length, 12);
    for (const stage of AYAS_RESUMABLE_STAGES) {
      assert.equal(validateAyasResumeStageRequest(req({ stage }), { planStages: [stage] }).ok, true, stage);
    }
    assert.equal(validateAyasResumeStageRequest(req({ stage: "deploy" })).ok, false);
  });

  await scenario("validator — wildcard / multi project → DENY", () => {
    for (const projectSlug of ["*", "all", "a,b"]) {
      const v = validateAyasResumeStageRequest(req({ projectSlug }));
      assert.equal(v.ok, false, projectSlug);
      if (!v.ok) assert.ok(["wildcard-project", "unsafe-project-slug"].includes(v.reason));
    }
  });

  await scenario("validator — wildcard / multi stage → DENY", () => {
    for (const stage of ["*", "all", "visuals,audio"]) {
      const v = validateAyasResumeStageRequest(req({ stage }));
      assert.equal(v.ok, false, stage);
      if (!v.ok) assert.ok(["wildcard-stage", "unknown-stage"].includes(v.reason));
    }
  });

  await scenario("validator — a stage outside the resume plan → DENY (stage-not-in-plan)", () => {
    const v = validateAyasResumeStageRequest(req({ stage: "audio" }), { planStages: ["visuals", "animation"] });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, "stage-not-in-plan");
  });

  await scenario("validator — unsafe slug / shell content / unexpected keys / bad authz id → DENY", () => {
    assert.equal(validateAyasResumeStageRequest(req({ projectSlug: "../etc" })).ok, false);
    assert.equal(validateAyasResumeStageRequest(req({ projectSlug: "\\\\host\\share" })).ok, false);
    assert.equal(validateAyasResumeStageRequest(req({ intent: "rm -rf / && resume" })).ok, false);
    assert.equal(validateAyasResumeStageRequest(req({ extra: "nope" })).ok, false);
    assert.equal(validateAyasResumeStageRequest(req({ authorizationId: "not-an-authz" })).ok, false);
    assert.equal(validateAyasResumeStageRequest(req({ action: "run-pipeline-stage" })).ok, false);
  });

  await scenario("validator — canonical string is stable and omits volatile fields", () => {
    const a = validateAyasResumeStageRequest(req({ intent: "x" }), { planStages: ["visuals"] });
    const b = validateAyasResumeStageRequest(req({ intent: "y" }), { planStages: ["visuals"] });
    assert.ok(a.ok && b.ok);
    // intent differs but the binding key is the same (action+project+stage+requestedBy)
    assert.equal(canonicalAyasResumeStageRequest(a.request), canonicalAyasResumeStageRequest(b.request));
    const c = validateAyasResumeStageRequest(req({ stage: "animation" }), { planStages: ["animation"] });
    assert.ok(c.ok);
    assert.notEqual(canonicalAyasResumeStageRequest(a.request), canonicalAyasResumeStageRequest(c.request));
  });

  /* ---------------------------- executor (§15, §16) ----------------------- */

  await scenario("executor — runs EXACTLY the requested stage (bounded), reports side effect", async () => {
    let seenOptions: unknown;
    const exec = createAyasResumeStageExecutor({
      runner: {
        async resume(projectSlug, options) {
          seenOptions = options;
          return { success: true, projectSlug, resumedFrom: "visuals", completedStages: ["visuals"], blocked: false, stoppedAfterStage: "visuals" };
        },
      },
    });
    const v = validateAyasResumeStageRequest(req(), { planStages: ["visuals"] });
    assert.ok(v.ok);
    const result = await exec(v.request);
    assert.deepEqual(seenOptions, { stopAfterStage: "visuals" });
    assert.equal(result.action, "resume-stage");
    assert.equal(result.write, true);
    assert.equal(result.sideEffectApplied, true);
    assert.deepEqual(result.data.ranStages, ["visuals"]);
  });

  await scenario("executor — a run that overshoots its bound → throws (fail closed)", async () => {
    const exec = createAyasResumeStageExecutor({
      runner: {
        async resume(projectSlug) {
          return { success: true, projectSlug, resumedFrom: "visuals", completedStages: ["visuals", "animation", "video"], blocked: false, stoppedAfterStage: "video" };
        },
      },
    });
    const v = validateAyasResumeStageRequest(req(), { planStages: ["visuals"] });
    assert.ok(v.ok);
    await assert.rejects(() => exec(v.request), /bounded to "visuals"/);
  });

  await scenario("executor — plan re-check: a stage that left the plan by exec time → throws", async () => {
    const exec = createAyasResumeStageExecutor({
      runner: okRunner(),
      planner: { async createResumePlan() { return { stagesToRun: ["animation"] } as never; } },
    });
    const v = validateAyasResumeStageRequest(req({ stage: "visuals" }), { planStages: ["visuals"] });
    assert.ok(v.ok);
    await assert.rejects(() => exec(v.request), /no longer in the resume plan/);
  });

  await scenario("executor — a runner failure surfaces as an unsuccessful result, not a throw", async () => {
    const exec = createAyasResumeStageExecutor({
      runner: { async resume(projectSlug) { return { success: false, projectSlug, resumedFrom: null, completedStages: [], blocked: true, reason: "dependency not ready" }; } },
    });
    const v = validateAyasResumeStageRequest(req(), { planStages: ["visuals"] });
    assert.ok(v.ok);
    const result = await exec(v.request);
    assert.equal(result.sideEffectApplied, false);
    assert.match(result.summary, /çalıştırılamadı/);
  });

  /* ---------------------------- bridge (§23) ------------------------------ */

  await scenario("bridge — resume-stage is DENIED `write-execution-disabled` by default", async () => {
    const root = tmpRoot();
    const gate = openTestGate(root);
    const authorizations = new AyasExecutionAuthorizationStore({ rootDir: root });
    const bridge = createAyasExecutionBridge({ gate, authorizations }); // writeActionsEnabled defaults false
    const out = await bridge.requestExecution({ rawRequest: req(), authorizationId: AUTHZ });
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.equal(out.stage, "policy");
      assert.equal(out.reason, "write-execution-disabled");
    }
    assert.equal(gate.read().state, "OPEN", "a denied write must not move the gate");
  });

  await scenario("bridge — with writeActionsEnabled + a TEST-opened gate, resume-stage runs end to end", async () => {
    const root = tmpRoot();
    const gate = openTestGate(root);
    const authorizations = new AyasExecutionAuthorizationStore({ rootDir: root });
    const bridge = createAyasExecutionBridge({
      gate,
      authorizations,
      writeActionsEnabled: true,
      resumeStageExecutor: createAyasResumeStageExecutor({ runner: okRunner() }),
      resumePlanStages: async () => ["visuals", "animation"],
    });
    const v = validateAyasResumeStageRequest(req(), { planStages: ["visuals", "animation"] });
    assert.ok(v.ok);
    const grant = authorizations.grant({
      action: "resume-stage",
      requestedBy: v.request.requestedBy,
      intent: v.request.intent,
      projectSlug: v.request.projectSlug,
      canonical: canonicalAyasResumeStageRequest(v.request),
    });
    // the request must name the authorization it consumes
    const raw = req({ authorizationId: grant.authorizationId });
    const out = await bridge.requestExecution({ rawRequest: raw, authorizationId: grant.authorizationId });
    assert.equal(out.ok, true, out.ok ? "" : `${out.stage}/${out.reason}: ${out.detail}`);
    if (out.ok) {
      assert.equal(out.gateStateAfter, "READY");
      assert.equal(out.result.write, true);
      assert.equal(out.result.sideEffectApplied, true);
    }
    assert.equal(authorizations.read(grant.authorizationId).state, "completed");
    assert.deepEqual(gate.readLog().map((e) => e.event).slice(-3), ["begin-execution", "complete-execution", "settle"]);
  });

  await scenario("bridge — request.authorizationId must match the supplied id", async () => {
    const root = tmpRoot();
    const bridge = createAyasExecutionBridge({
      gate: openTestGate(root),
      authorizations: new AyasExecutionAuthorizationStore({ rootDir: root }),
      writeActionsEnabled: true,
      resumeStageExecutor: createAyasResumeStageExecutor({ runner: okRunner() }),
    });
    const out = await bridge.requestExecution({
      rawRequest: req({ authorizationId: "authz-11111111-1111-1111-1111-111111111111" }),
      authorizationId: "authz-22222222-2222-2222-2222-222222222222",
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, "authorization-id-mismatch");
  });

  await scenario("bridge — a write executor crash FAULTS the gate to CLOSED; the authz can't be replayed", async () => {
    const root = tmpRoot();
    const gate = openTestGate(root);
    const authorizations = new AyasExecutionAuthorizationStore({ rootDir: root });
    const bridge = createAyasExecutionBridge({
      gate,
      authorizations,
      writeActionsEnabled: true,
      resumeStageExecutor: async () => { throw new Error("simulated pipeline crash"); },
      resumePlanStages: async () => ["visuals"],
    });
    const v = validateAyasResumeStageRequest(req(), { planStages: ["visuals"] });
    assert.ok(v.ok);
    const grant = authorizations.grant({
      action: "resume-stage", requestedBy: v.request.requestedBy, intent: v.request.intent,
      projectSlug: v.request.projectSlug, canonical: canonicalAyasResumeStageRequest(v.request),
    });
    const raw = req({ authorizationId: grant.authorizationId });
    const out = await bridge.requestExecution({ rawRequest: raw, authorizationId: grant.authorizationId });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.stage, "executor");
    assert.equal(gate.readStateFailClosed().state, "CLOSED");
    assert.equal(authorizations.read(grant.authorizationId).state, "failed");

    // replay: a fault CLOSED the gate — bring it back through the real path, then
    // re-send → the single-use authorization is already `failed` → DENY at authz.
    gate.transition({ event: "arm" });
    gate.transition({ event: "confirm-ready" });
    gate.transition({ event: "open", activationAuthorizationId: ACT_ID });
    assert.equal(gate.read().state, "OPEN");
    const replay = await bridge.requestExecution({ rawRequest: raw, authorizationId: grant.authorizationId });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.stage, "authorization");
  });

  await scenario("bridge — stage-not-in-plan is rejected at the bridge via resumePlanStages", async () => {
    const root = tmpRoot();
    const bridge = createAyasExecutionBridge({
      gate: openTestGate(root),
      authorizations: new AyasExecutionAuthorizationStore({ rootDir: root }),
      writeActionsEnabled: true,
      resumeStageExecutor: createAyasResumeStageExecutor({ runner: okRunner() }),
      resumePlanStages: async () => ["animation", "video"], // "visuals" is NOT in the plan
    });
    const out = await bridge.requestExecution({ rawRequest: req(), authorizationId: AUTHZ });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, "stage-not-in-plan");
  });

  console.log(`AYAS write action smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-write-action", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS write action smoke FAILED:", error);
  process.exitCode = 1;
});
