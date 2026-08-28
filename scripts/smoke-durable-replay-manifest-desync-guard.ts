import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import {
  executeConfiguredProductionPipelineStage,
  durableReplayManifestDesyncCode,
} from "../src/lib/production/ProductionPipelineExecutionFactory";
import type { PipelineJobList } from "../src/types/pipelineJob";

// Regression coverage for the "thumbnail resume infinite loop" incident
// (fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-...,
// 2026-08-28): a durable execution record can reach "succeeded" while the
// process crashes before the separate project-level manifest/job commit
// (PipelineRunner.runStageLegacy's success path) runs. Every later resume then
// recomputes the same deterministic durable identity, finds the same already-
// "succeeded" record, and ProductionExecutionWorkerExecutionService.execute()
// correctly replays it -- WITHOUT ever invoking the real stage handler that
// would advance the project-level job past "queued". PipelineQueueScheduler.
// getNextRunnableStage then re-selects the exact same stage forever: a
// CPU-bound, network-free, write-free infinite loop with no persisted error.
//
// This smoke test never touches i-stanbul-un-fethi-1453 or any real project --
// everything runs inside withCanonicalSmokeRuntime's isolated temp runtime root.

const slug = "smoke-durable-replay-manifest-desync-fixture";
let passCount = 0;

function pass(condition: unknown, label: string) {
  if (!condition) throw new Error(`FAIL ${passCount + 1}: ${label}`);
  passCount++;
  console.log(`PASS ${passCount}: ${label}`);
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

async function digestDurableEvidence(root: string) {
  const count = async (name: string) => {
    try {
      return (await fs.readdir(path.join(root, "production-execution", name))).length;
    } catch {
      return 0;
    }
  };
  return {
    reservations: await count("reservations"),
    claims: await count("claims"),
    idempotency: await count("idempotency"),
    attempts: await count("attempts"),
  };
}

/** Races `promise` against a bounded timeout so a regressed infinite loop fails fast, not by hanging the suite. */
async function withBound<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT: ${label} did not settle within ${ms}ms (possible infinite loop regression)`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function main() {
  await withCanonicalSmokeRuntime({
    name: "durable-replay-manifest-desync-guard",
    projectSlug: slug,
    operationType: "smoke-durable-replay-manifest-desync-guard",
  }, async (runtime) => {
    const target = path.join(runtime.runtimeRoot, "projects", slug);
    await fs.rm(target, { recursive: true, force: true });

    await ProjectManager.createProject(slug);
    await PipelineJobManager.listJobs(slug);

    const upstreamStages = [
      "research", "script", "scenes", "visuals", "animation", "video", "audio", "assembly",
    ] as const;
    // isStageFileReady (PipelineRecoveryPlanner.ts) only deep-validates "video"
    // (via isCompatibleVideoData) and "youtube" -- every other upstream stage
    // just needs its file to exist and parse. Give "video" the minimal shape
    // isCompatibleVideoData actually requires so the recovery plan can walk
    // past it to "thumbnail". PipelineRunner.resumeOnce also strict-preflights
    // script+scenes (validateProductionAcceptancePreflight) whenever the resume
    // start stage is past "scenes" -- thumbnail is -- so those two need a real,
    // internally-consistent minimal shape too; every other stage can stay a
    // plain stub.
    const stageFixtureContent: Partial<Record<typeof upstreamStages[number], unknown>> = {
      script: {
        topic: "smoke", title: "smoke", subtitle: "s", hook: "h", introduction: "i",
        chapters: [{ id: 1, title: "c1", narration: "n", duration: 90, visualGoal: "g", emotion: "e" }],
        estimatedDuration: 90,
      },
      scenes: {
        scenes: [{ id: 1, chapterId: 1, title: "s1", description: "d", duration: 90 }],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      video: { projectId: slug, createdAt: "2026-01-01T00:00:00.000Z", scenes: [], status: "generated" },
    };
    for (const stage of upstreamStages) {
      await fs.writeFile(path.join(target, `${stage}.json`),
        JSON.stringify(stageFixtureContent[stage] ?? { fixture: stage }), "utf8");
      await PipelineJobManager.startStage(slug, stage, () =>
        ProjectManager.updatePackageStatus(slug, stage, "running").then(() => undefined));
      await PipelineJobManager.persistStageSuccess(slug, stage, () =>
        ProjectManager.updatePackageStatus(slug, stage, "completed").then(() => undefined));
    }

    const recovery = await PipelineRecoveryPlanner.createResumePlan(slug);
    pass(recovery.startStage === "thumbnail" && recovery.blocked === false,
      "fixture recovery plan starts unblocked at thumbnail");

    const thumbnailJobBefore = (await readJson<PipelineJobList>(
      path.join(target, "pipeline-jobs.json"))).jobs.find((job) => job.stage === "thumbnail");
    pass(thumbnailJobBefore?.status === "queued" && thumbnailJobBefore.attempts === 0,
      "thumbnail job starts queued with zero attempts, matching the real incident's manifest state");

    // --- Simulate the crash-consistency gap ------------------------------
    // Drive the durable layer straight to "succeeded" via the same primitive
    // PipelineRunner uses internally, but WITHOUT going through
    // PipelineRunner.runStage/runStageLegacy -- i.e. without ever calling
    // PipelineJobManager.startStage/persistStageSuccess for thumbnail. This
    // reproduces exactly what a process crash between "durable attempt
    // finalized" and "project manifest committed" leaves behind.
    const context = { projectSlug: slug, stage: "thumbnail" as const, runType: "resume" as const };
    let firstHandlerCalls = 0;
    const firstResult = await executeConfiguredProductionPipelineStage(context, async () => {
      firstHandlerCalls += 1;
      return true;
    });
    pass(firstResult === true && firstHandlerCalls === 1,
      "first durable execution for a never-attempted stage runs the real handler exactly once");

    const thumbnailJobAfterCrash = (await readJson<PipelineJobList>(
      path.join(target, "pipeline-jobs.json"))).jobs.find((job) => job.stage === "thumbnail");
    pass(thumbnailJobAfterCrash?.status === "queued" && thumbnailJobAfterCrash.attempts === 0,
      "project-level job is still queued/zero-attempts after the simulated crash (the gap this guard detects)");

    // --- The guard must now fail closed, not silently replay -------------
    const evidenceBeforeGuard = await digestDurableEvidence(target);
    let secondHandlerCalls = 0;
    await assert.rejects(
      executeConfiguredProductionPipelineStage(context, async () => {
        secondHandlerCalls += 1;
        return true;
      }),
      (error: unknown) => error instanceof Error &&
        "code" in error && (error as { code: unknown }).code === durableReplayManifestDesyncCode,
      "re-preparing the same already-succeeded-but-unpersisted identity throws PIPELINE_DURABLE_REPLAY_MANIFEST_DESYNC",
    );
    pass(secondHandlerCalls === 0,
      "the guard rejects before the real handler is ever reached a second time (no duplicate provider call)");
    pass(JSON.stringify(await digestDurableEvidence(target)) === JSON.stringify(evidenceBeforeGuard),
      "the guard's rejection is durable-write-free, matching the original incident's zero-writes-per-iteration signature");

    // --- Through the real PipelineRunner.resume() path --------------------
    // This is the exact call the real incident's resumeAndFinalize() drove.
    // Bounded: a regression that reintroduces the infinite loop must fail
    // this test with a clear timeout, not hang the whole suite.
    await assert.rejects(
      withBound(PipelineRunner.resume(slug), 15_000, "PipelineRunner.resume(slug) for the desynced stage"),
      (error: unknown) => error instanceof Error &&
        "code" in error && (error as { code: unknown }).code === durableReplayManifestDesyncCode,
      "PipelineRunner.resume() surfaces the same guard instead of looping forever",
    );

    const jobsAfterResume = (await readJson<PipelineJobList>(path.join(target, "pipeline-jobs.json"))).jobs;
    const thumbnailJobAfterResume = jobsAfterResume.find((job) => job.stage === "thumbnail");
    pass(thumbnailJobAfterResume?.status === "failed", "thumbnail job is persisted as failed, not left stuck queued forever");
    pass(thumbnailJobAfterResume?.error === durableReplayManifestDesyncCode,
      "the persisted failure records the exact diagnosable reason code");
    const manifest = await readJson<{ packages: Record<string, { status: string }> }>(
      path.join(target, "manifest.json"));
    pass(manifest.packages.thumbnail?.status === "failed",
      "manifest.json's thumbnail package is also persisted as failed (UI-visible, not stuck at pending)");
    const downstream = jobsAfterResume.filter((job) =>
      ["seo", "youtube", "export"].includes(job.stage));
    pass(downstream.every((job) => job.status === "queued"),
      "downstream stages remain untouched (queued) -- the failure did not cascade or fake progress past thumbnail");

    // --- Recovery: the existing retry-budget mechanism, not new plumbing --
    // A "failed" job at attempts=1 is well within the default retry budget, so
    // PipelineRunner.resume() should admit a fresh retry -- which computes a
    // NEW durable attempt ordinal that no longer collides with the stale
    // "succeeded" record, escaping the replay trap without any bespoke
    // second mechanism. It may itself fail again (this fixture's mock
    // provider path is not the focus here) but it must not throw the exact
    // same desync error twice in a row, and it must not hang.
    const secondAttempt = await withBound(
      PipelineRunner.resume(slug).then(
        (result) => ({ kind: "resolved" as const, result }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      ),
      15_000,
      "second PipelineRunner.resume(slug) after retry-budget admission",
    );
    const secondAttemptIsSameDesync = secondAttempt.kind === "rejected" &&
      secondAttempt.error instanceof Error && "code" in secondAttempt.error &&
      (secondAttempt.error as { code: unknown }).code === durableReplayManifestDesyncCode;
    pass(!secondAttemptIsSameDesync,
      "retrying after retry-budget admission advances to a fresh durable attempt ordinal, not the same stale replay");

    console.log(`Durable replay/manifest desync guard smoke: PASS (${passCount} scenarios)`);
    process.stdout.write(`ATOLYE_SMOKE_RESULT ${JSON.stringify({
      status: "PASS", suite: "durable-replay-manifest-desync-guard", scenarios: passCount,
    })}\n`);
  });
}

void main();
