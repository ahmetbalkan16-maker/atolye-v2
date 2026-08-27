import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createPipelineCompletedStageRegenerationPlan,
  PipelineRegenerationPlanError,
} from "../src/lib/pipeline/PipelineCompletedStageRegenerationPlanner";
import {
  preparePipelineCompletedStageRegeneration,
  PipelineRegenerationPreparationError,
} from "../src/lib/pipeline/PipelineCompletedStageRegenerationService";
import { bootstrapRuntimeBackupStorageAuthority } from "../src/lib/runtime/backup/RuntimeBackupAuthority";
import { createVerifiedRuntimeBackup } from "../src/lib/runtime/backup/RuntimeBackupService";
import { createRuntimeStorageContext, type RuntimeStorageContext } from
  "../src/lib/runtime/RuntimeStoragePaths";
import type { ProjectManifest, ProductionStepKey } from "../src/types/project";
import type { PipelineJobList } from "../src/types/pipelineJob";

/**
 * Covers Part B: the plain-pipeline (marker-less) completed-stage regeneration
 * module — `PipelineCompletedStageRegenerationPlanner`/`Service` — the sibling of the
 * acceptance-gated `ProductionCompletedStageRegeneration*` for projects that were
 * created through the ordinary pipeline and structurally cannot obtain a
 * `production-acceptance.json` marker (see `src/types/pipelineRegeneration.ts`).
 *
 * Every scenario runs inside `withGitBackedRuntime` (see its docstring below) —
 * an isolated project tree per scenario, never touches data/projects/. This file used
 * to split scenarios between that and `withCanonicalSmokeRuntime`, but
 * `createPipelineCompletedStageRegenerationPlan` unconditionally computes a
 * `projectAggregateFingerprint` via `collectRuntimeBackupInventory`, which requires
 * `context.runtimeRoot` to be contained within a real, git-initialized
 * `context.workspaceRoot` — `withCanonicalSmokeRuntime`'s split
 * "workspaceRoot: process.cwd(), runtimeRoot: elsewhere" layout does not satisfy that
 * for *any* scenario that calls the planner, not just the backup-dependent ones.
 */

let passCount = 0;
function pass(label: string) { passCount += 1; console.log(`PASS: ${label}`); }

const STAGE_ORDER: readonly ProductionStepKey[] = [
  "research", "script", "scenes", "visuals", "animation", "video", "audio",
  "assembly", "thumbnail", "seo", "youtube", "export",
];

function writeJson(storageContext: RuntimeStorageContext, slug: string, relativePath: string, value: unknown) {
  const target = path.join(storageContext.projectsRoot, slug, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2));
}

/**
 * Builds a minimal, internally-consistent "plain pipeline" project through a
 * completed `assembly` stage — no `production-acceptance.json` marker, exactly the
 * shape i-stanbul-un-fethi-1453 is in.
 */
function buildEligibleProject(
  storageContext: RuntimeStorageContext,
  slug: string,
  projectId: string,
  options: { readonly assemblyCompleted?: boolean; readonly withMarker?: boolean } = {},
) {
  const now = new Date().toISOString();
  const assemblyPackageStatus = options.assemblyCompleted === false ? "pending" : "completed";
  const assemblyJobStatus = options.assemblyCompleted === false ? "queued" : "completed";
  writeJson(storageContext, slug, "project.json",
    { id: projectId, slug, title: "t", status: "assembly", createdAt: now, updatedAt: now });
  const packages = Object.fromEntries(STAGE_ORDER.map((stage) => [stage, {
    key: stage,
    status: stage === "assembly" ? assemblyPackageStatus : "completed",
    fileName: `${stage}.json`,
    updatedAt: now,
  }])) as ProjectManifest["packages"];
  const manifest: ProjectManifest = {
    project: { id: projectId, slug, title: "t", status: "assembly", createdAt: now, updatedAt: now },
    projectId, slug, version: 1, packages, createdAt: now, updatedAt: now,
  };
  writeJson(storageContext, slug, "manifest.json", manifest);
  writeJson(storageContext, slug, "pipeline-jobs.json", {
    projectSlug: slug,
    jobs: STAGE_ORDER.map((stage) => ({
      id: `${slug}-${stage}`, projectSlug: slug, stage, title: stage,
      status: stage === "assembly" ? assemblyJobStatus : "completed",
      attempts: 1, createdAt: now, updatedAt: now,
    })),
    createdAt: now, updatedAt: now,
  } satisfies PipelineJobList);
  for (const stage of ["research", "script", "scenes", "visuals", "animation", "assembly"] as const) {
    writeJson(storageContext, slug, `${stage}.json`, { stage, ok: true });
  }
  writeJson(storageContext, slug, "video.json",
    { projectId, createdAt: now, scenes: [], status: "generated" });
  writeJson(storageContext, slug, "audio.json", {
    outputAssetId: "mix-1", status: "generated",
    narrator: { style: "documentary", tone: "cinematic", language: "tr" },
    sections: [{ chapterId: 1, title: "s1", duration: "10s", emotion: "cinematic", emphasis: [],
      narrationNotes: "clear", pacing: "normal", sourceText: "text",
      outputAssetId: "section-1", status: "generated", durationSeconds: 10 }],
    music: { mood: "cinematic", suggestion: "orchestral", intensity: "medium" },
    production: { targetFormat: "wav", sampleRate: 44100, estimatedTotalDuration: "00:00:10",
      generationStatus: "generated" },
    createdAt: now,
  });
  writeJson(storageContext, slug, "assets/assets.json",
    { projectId, projectSlug: slug, assets: [], createdAt: now, updatedAt: now });
  const audioDir = path.join(storageContext.projectsRoot, slug, "assets", "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  fs.writeFileSync(path.join(audioDir, "section-1.wav"), Buffer.from("not-really-a-wav-1"));
  fs.writeFileSync(path.join(audioDir, "mix-1.wav"), Buffer.from("not-really-a-wav-2"));
  fs.mkdirSync(path.join(storageContext.projectsRoot, slug, "production-execution"), { recursive: true });
  if (options.withMarker) {
    writeJson(storageContext, slug, "production-acceptance.json", { schemaVersion: "3", fake: true });
  }
}

/**
 * Both `collectRuntimeBackupInventory()` (used by the planner for every plan, to
 * compute `projectAggregateFingerprint`) and `createVerifiedRuntimeBackup()` gather
 * git metadata over `context.workspaceRoot` and require `context.runtimeRoot` to be
 * *contained within* it (see how the already-proven
 * `smoke-sprint-129-41-completed-stage-regeneration.ts` sets this up: a freshly
 * `git init`'d temp workspace with the runtime root nested inside) — so every
 * scenario in this file uses this setup rather than `withCanonicalSmokeRuntime`.
 */
async function withGitBackedRuntime<T>(
  operation: (storageContext: RuntimeStorageContext) => Promise<T>,
): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-smoke-pipeline-regen-backup-"));
  const workspaceRoot = path.join(root, "workspace");
  const runtimeRoot = path.join(workspaceRoot, "data");
  const authorityRoot = path.join(root, "authority");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.mkdirSync(authorityRoot, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.email", "smoke@example.invalid"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.name", "smoke"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, ".gitkeep"), "");
  execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
  execFileSync("git", ["commit", "--quiet", "-m", "init"], { cwd: workspaceRoot });
  const storageContext = createRuntimeStorageContext({
    workspaceRoot, authorityRoot, environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
  });
  try {
    return await operation(storageContext);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function run() {
  await withGitBackedRuntime(async (storageContext) => {
    const projectId = "project-pipeline-regen";

    // 1. Plan happy path: eligible project, correct downstream invalidation set.
    {
      const slug = "pipeline-regen-plan-ok";
      buildEligibleProject(storageContext, slug, projectId);
      const plan = await createPipelineCompletedStageRegenerationPlan({
        projectSlug: slug, fromStage: "assembly", context: storageContext,
      });
      assert.equal(plan.fromStage, "assembly");
      assert.deepEqual([...plan.regeneratedStages], ["assembly"]);
      assert.deepEqual([...plan.invalidatedStages], ["thumbnail", "seo", "youtube", "export"]);
      assert.deepEqual([...plan.preservedStages],
        ["research", "script", "scenes", "visuals", "animation", "video", "audio"]);
      assert.equal(plan.currentGeneration, 0);
      assert.equal(plan.proposedGeneration, 1);
      assert.match(plan.planFingerprint, /^[a-f0-9]{64}$/);
    }
    pass("plan computes correct downstream invalidation set (thumbnail -> seo -> youtube -> export)");

    // 2. Plan rejects when assembly is not completed.
    {
      const slug = "pipeline-regen-plan-not-completed";
      buildEligibleProject(storageContext, slug, projectId, { assemblyCompleted: false });
      await assert.rejects(
        createPipelineCompletedStageRegenerationPlan({
          projectSlug: slug, fromStage: "assembly", context: storageContext,
        }),
        (error: unknown) => error instanceof PipelineRegenerationPlanError &&
          error.code === "PIPELINE_REGENERATION_SOURCE_NOT_COMPLETED",
      );
    }
    pass("plan rejects a project whose assembly stage is not completed");

    // 3. Plan rejects (mutual exclusion) when a production-acceptance.json marker exists —
    //    that project belongs to the acceptance-gated regeneration system, not this one.
    {
      const slug = "pipeline-regen-plan-has-marker";
      buildEligibleProject(storageContext, slug, projectId, { withMarker: true });
      await assert.rejects(
        createPipelineCompletedStageRegenerationPlan({
          projectSlug: slug, fromStage: "assembly", context: storageContext,
        }),
        (error: unknown) => error instanceof PipelineRegenerationPlanError &&
          error.code === "PIPELINE_REGENERATION_ACCEPTANCE_MANAGED",
      );
    }
    pass("plan refuses a project that already has a production-acceptance.json marker");

    // 4. Plan rejects an out-of-scope stage (still unsupported after the "animation"
    //    extension — only "assembly" and "animation" are in
    //    `supportedPipelineRegenerationFromStages`).
    {
      const slug = "pipeline-regen-plan-bad-stage";
      buildEligibleProject(storageContext, slug, projectId);
      await assert.rejects(
        createPipelineCompletedStageRegenerationPlan({
          projectSlug: slug, fromStage: "video", context: storageContext,
        }),
        (error: unknown) => error instanceof PipelineRegenerationPlanError &&
          error.code === "PIPELINE_REGENERATION_STAGE_INVALID",
      );
    }
    pass("plan rejects a fromStage outside the supported set (\"video\")");

    // 5. Prepare rejects a request whose confirmation doesn't match the plan fingerprint.
    {
      const slug = "pipeline-regen-prepare-bad-confirmation";
      buildEligibleProject(storageContext, slug, projectId);
      const plan = await createPipelineCompletedStageRegenerationPlan({
        projectSlug: slug, fromStage: "assembly", context: storageContext,
      });
      const backupAuthority = bootstrapRuntimeBackupStorageAuthority(storageContext);
      await assert.rejects(
        preparePipelineCompletedStageRegeneration({
          plan, backupId: "irrelevant", reasonCode: "TEST_REASON",
          confirmation: "0".repeat(64), context: storageContext, backupAuthority,
        }),
        (error: unknown) => error instanceof PipelineRegenerationPreparationError &&
          error.code === "PIPELINE_REGENERATION_REQUEST_INVALID",
      );
    }
    pass("prepare rejects a confirmation that doesn't match the plan fingerprint");

    // 6. Prepare rejects a backup id that doesn't resolve to a real, verified backup.
    {
      const slug = "pipeline-regen-prepare-bad-backup";
      buildEligibleProject(storageContext, slug, projectId);
      const plan = await createPipelineCompletedStageRegenerationPlan({
        projectSlug: slug, fromStage: "assembly", context: storageContext,
      });
      const backupAuthority = bootstrapRuntimeBackupStorageAuthority(storageContext);
      await assert.rejects(
        preparePipelineCompletedStageRegeneration({
          plan, backupId: "no-such-backup-id", reasonCode: "TEST_REASON",
          confirmation: plan.planFingerprint, context: storageContext, backupAuthority,
        }),
        (error: unknown) => error instanceof PipelineRegenerationPreparationError &&
          error.code === "PIPELINE_REGENERATION_BACKUP_INVALID",
      );
    }
    pass("prepare rejects a backup id that isn't a real, verified runtime backup");
  });

  // 7. Prepare happy path: a genuine, verified backup -> manifest/jobs correctly
  //    flipped to pending/queued for exactly the effective sequence, prior
  //    assembly.json snapshotted, nothing else touched. Needs its own
  //    git-backed runtime (see `withGitBackedRuntime`) rather than
  //    `withCanonicalSmokeRuntime`'s split workspace/runtime roots, because
  //    `createVerifiedRuntimeBackup` requires the runtime root to be contained
  //    within a real git-initialized workspace root.
  await withGitBackedRuntime(async (storageContext) => {
    const projectId = "project-pipeline-regen";
    const slug = "pipeline-regen-prepare-ok";
    buildEligibleProject(storageContext, slug, projectId);
    const plan = await createPipelineCompletedStageRegenerationPlan({
      projectSlug: slug, fromStage: "assembly", context: storageContext,
    });
    const backupAuthority = bootstrapRuntimeBackupStorageAuthority(storageContext);
    const backup = createVerifiedRuntimeBackup({ authority: backupAuthority, projectSlug: slug });
    const result = await preparePipelineCompletedStageRegeneration({
      plan, backupId: backup.backupId, reasonCode: "SILENT_AUDIO_REPAIR",
      confirmation: plan.planFingerprint, context: storageContext, backupAuthority,
    });
    assert.equal(result.status, "prepared");
    assert.equal(result.intent.generationOrdinal, 1);

    const manifest = JSON.parse(fs.readFileSync(
      path.join(storageContext.projectsRoot, slug, "manifest.json"), "utf8")) as ProjectManifest;
    const jobs = JSON.parse(fs.readFileSync(
      path.join(storageContext.projectsRoot, slug, "pipeline-jobs.json"), "utf8")) as PipelineJobList;
    for (const stage of ["assembly", "thumbnail", "seo", "youtube", "export"] as const) {
      assert.equal(manifest.packages[stage].status, "pending", `manifest.packages.${stage}`);
      assert.equal(jobs.jobs.find((job) => job.stage === stage)?.status, "queued", `job ${stage}`);
    }
    for (const stage of ["research", "script", "scenes", "visuals", "animation", "video", "audio"] as const) {
      assert.equal(manifest.packages[stage].status, "completed", `manifest.packages.${stage} untouched`);
      assert.equal(jobs.jobs.find((job) => job.stage === stage)?.status, "completed",
        `job ${stage} untouched`);
    }
    const snapshotPath = path.join(storageContext.projectsRoot, slug,
      "pipeline-regeneration", "regenerations", result.intent.regenerationId,
      "snapshots", "generation-0", "assembly.json");
    assert.equal(fs.existsSync(snapshotPath), true, "prior assembly.json should be snapshotted");

    // Idempotent replay: preparing again with the identical plan/backup/reason must
    // return the same prepared result rather than re-mutating or erroring.
    const replay = await preparePipelineCompletedStageRegeneration({
      plan, backupId: backup.backupId, reasonCode: "SILENT_AUDIO_REPAIR",
      confirmation: plan.planFingerprint, context: storageContext, backupAuthority,
    });
    assert.equal(replay.status, "already-prepared");
    assert.equal(replay.intent.regenerationId, result.intent.regenerationId);
  });
  pass("prepare (with a real verified backup) requeues exactly assembly+downstream, " +
    "snapshots the prior assembly.json, and is idempotent on replay");

  // 8. A prepared-but-not-yet-completed regeneration blocks a fresh plan even if the
  //    source stage's completed status is independently restored in the meantime
  //    (e.g. a concurrent actor racing the same project) — the active-regeneration
  //    check is a separate guard from "is assembly completed", and must still catch
  //    this even after #7 shows the ordinary "assembly now pending" case.
  await withGitBackedRuntime(async (storageContext) => {
    const projectId = "project-pipeline-regen";
    const slug = "pipeline-regen-prepare-conflict";
    buildEligibleProject(storageContext, slug, projectId);
    const plan = await createPipelineCompletedStageRegenerationPlan({
      projectSlug: slug, fromStage: "assembly", context: storageContext,
    });
    const backupAuthority = bootstrapRuntimeBackupStorageAuthority(storageContext);
    const backup = createVerifiedRuntimeBackup({ authority: backupAuthority, projectSlug: slug });
    await preparePipelineCompletedStageRegeneration({
      plan, backupId: backup.backupId, reasonCode: "FIRST_REASON",
      confirmation: plan.planFingerprint, context: storageContext, backupAuthority,
    });
    // Simulate assembly's completed status being restored out-of-band, so the
    // "active regeneration" conflict guard — not the unrelated "not completed" one —
    // is what this assertion actually exercises.
    buildEligibleProject(storageContext, slug, projectId);
    await assert.rejects(
      createPipelineCompletedStageRegenerationPlan({
        projectSlug: slug, fromStage: "assembly", context: storageContext,
      }),
      (error: unknown) => error instanceof PipelineRegenerationPlanError &&
        error.code === "PIPELINE_REGENERATION_CONFLICT",
    );
  });
  pass("a fresh plan is refused while a regeneration is already prepared and incomplete");

  // 9. fromStage: "animation" — the extension added to remediate a real project where
  //    `visuals` was regenerated out-of-band after `animation`/`video` had already
  //    consumed an earlier, narrower snapshot of it (see
  //    `supportedPipelineRegenerationFromStages`'s docstring). The closure must
  //    invalidate exactly {animation, video, assembly, thumbnail, seo, youtube,
  //    export} (video depends on animation; assembly/thumbnail/seo/youtube/export
  //    transitively depend on video) while preserving {research, script, scenes,
  //    visuals, audio} — audio only depends on script, never on animation/video, so
  //    it must never be touched by this path.
  await withGitBackedRuntime(async (storageContext) => {
    const projectId = "project-pipeline-regen";
    const slug = "pipeline-regen-plan-animation-ok";
    buildEligibleProject(storageContext, slug, projectId);
    const plan = await createPipelineCompletedStageRegenerationPlan({
      projectSlug: slug, fromStage: "animation", context: storageContext,
    });
    assert.equal(plan.fromStage, "animation");
    assert.deepEqual([...plan.regeneratedStages], ["animation"]);
    assert.deepEqual([...plan.invalidatedStages],
      ["video", "assembly", "thumbnail", "seo", "youtube", "export"]);
    assert.deepEqual([...plan.preservedStages],
      ["research", "script", "scenes", "visuals", "audio"]);
    assert.equal(plan.currentGeneration, 0);
    assert.equal(plan.proposedGeneration, 1);
    assert.match(plan.planFingerprint, /^[a-f0-9]{64}$/);

    // audio.json content itself (not just its status) must be byte-for-byte untouched
    // by prepare() — captured before the mutation runs.
    const audioBefore = fs.readFileSync(
      path.join(storageContext.projectsRoot, slug, "audio.json"), "utf8");

    const backupAuthority = bootstrapRuntimeBackupStorageAuthority(storageContext);
    const backup = createVerifiedRuntimeBackup({ authority: backupAuthority, projectSlug: slug });
    const result = await preparePipelineCompletedStageRegeneration({
      plan, backupId: backup.backupId, reasonCode: "SCENE_VIDEO_LINEAGE_REMEDIATION",
      confirmation: plan.planFingerprint, context: storageContext, backupAuthority,
    });
    assert.equal(result.status, "prepared");
    assert.equal(result.intent.generationOrdinal, 1);

    const manifest = JSON.parse(fs.readFileSync(
      path.join(storageContext.projectsRoot, slug, "manifest.json"), "utf8")) as ProjectManifest;
    const jobs = JSON.parse(fs.readFileSync(
      path.join(storageContext.projectsRoot, slug, "pipeline-jobs.json"), "utf8")) as PipelineJobList;
    for (const stage of
      ["animation", "video", "assembly", "thumbnail", "seo", "youtube", "export"] as const) {
      assert.equal(manifest.packages[stage].status, "pending", `manifest.packages.${stage}`);
      assert.equal(jobs.jobs.find((job) => job.stage === stage)?.status, "queued", `job ${stage}`);
    }
    for (const stage of ["research", "script", "scenes", "visuals", "audio"] as const) {
      assert.equal(manifest.packages[stage].status, "completed", `manifest.packages.${stage} untouched`);
      assert.equal(jobs.jobs.find((job) => job.stage === stage)?.status, "completed",
        `job ${stage} untouched`);
    }
    const audioAfter = fs.readFileSync(
      path.join(storageContext.projectsRoot, slug, "audio.json"), "utf8");
    assert.equal(audioBefore, audioAfter, "audio.json must be byte-for-byte untouched");
  });
  pass("fromStage: \"animation\" invalidates exactly animation+video+downstream, " +
    "preserving audio and everything upstream of animation");

  console.log(`\nPASS (${passCount} scenarios)`);
}

run().catch((error) => {
  console.error("SMOKE_FAILED", error);
  process.exitCode = 1;
});
