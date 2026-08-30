import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { PipelineQueueScheduler } from "../src/lib/pipeline/PipelineQueueScheduler";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import {
  getProjectRoot,
  resolveRuntimeStorageContext,
} from "../src/lib/runtime/RuntimeStoragePaths";
import { buildProductionPipelineExecutionIdentity } from
  "../src/lib/production/ProductionPipelineExecutionIdentity";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import {
  AdapterBackedProductionExecutionAttemptService,
  defaultProductionExecutionAttemptPolicy,
} from "../src/lib/production/ProductionExecutionDurableAttempt";
import { ProductionExecutionLifecycle } from
  "../src/lib/production/ProductionExecutionLifecycle";
import { AdapterBackedProductionExecutionClaimService } from
  "../src/lib/production/ProductionExecutionDurableClaim";
import { AdapterBackedProductionExecutionDurableStorage } from
  "../src/lib/production/ProductionExecutionDurableStorage";
import { reconcileFailedPipelineExecution } from
  "../src/lib/production/ProductionPipelineRetryReconciliation";
import { classifyProductionDurableAttemptLineage } from
  "../src/lib/production/ProductionDurableAttemptLineageClassifier";
import { diagnoseProductionAcceptanceConfiguration } from
  "../src/lib/production/ProductionAcceptancePolicy";

/**
 * SCOPED, ONE-TIME operator crash-recovery for the single run
 *   fatih-sultan-mehmet-ve-i-stanbul-un-fethi-5be83a84-3d83-49f3-8ef2-854543359ca1
 *
 * Root cause (proven, see this session's read-only diagnostics + ATOLYE_CHECKPOINT):
 * the animation-stage worker (PID 5540) was hard-killed mid-stage. It left BOTH
 * layers stuck:
 *   - pipeline-jobs.json + manifest: animation job/package status = "running"
 *     -> PipelineQueueScheduler.getNextRunnableStage refuses every stage
 *     ("Stage \"animation\" is already running.") and PipelineRunner.resumeOnce
 *     has no branch for a "running" start job -> every resume-finalize returns
 *     PRODUCTION_ACCEPTANCE_COMMAND_FAILED.
 *   - durable execution: attempt/claim `b014ac56` state = "active", lease TTL
 *     runs to 2027, so evaluateExecutionAttemptRecovery / ...ClaimRecovery both
 *     classify it "valid-active" (recoveryRequired: false). Sprint 129.39 only
 *     covered the no-attempt `unbound-orphaned-claim` variant; there is no
 *     generic path that settles a crashed-mid-attempt chain, and
 *     reconcileFailedPipelineExecution requires attempt.state === "failed".
 *
 * This script does NOT change any generic mechanism. It reproduces, for this one
 * run only, exactly what the worker's own failure path would have done had it
 * not been killed, using the existing durable + pipeline-job primitives:
 *   M1  durable attempt b014ac56: active -> failed, via
 *       ProductionExecutionLifecycle.mutate({ transition: "failed" }) -- the
 *       same call ProductionExecutionWorker uses on a handler throw -- with the
 *       attempt's OWN recorded worker/session/lease identity and the canonical
 *       terminalEventId, extended-reservation-TTL policy (mirroring
 *       ProductionPipelineExecutionFactory's own worker policy).
 *   M2  pipeline job + manifest package animation: running -> failed, via
 *       PipelineJobManager.persistStageFailure (the executor's own
 *       running->failed primitive) + ProjectManager.updatePackageStatus; a
 *       "failed" pipeline-history event is recorded.
 *   M3  reconcileFailedPipelineExecution(job) -- the EXISTING retry-prep
 *       reconciler (also run again, idempotently, by the later resume) -- closes
 *       the claim, releases the lease, terminalizes the durable record.
 *
 * Every precondition is re-verified fresh, immediately before any write, against
 * the real (non-copy) store. Any single mismatch, or any evidence of a live
 * worker, aborts with ZERO writes. Without `--commit` only the read-only
 * preflight runs.
 *
 * Never touched: the 16 generated image assets, any other stage, any other
 * project, protected/tracked data, the acceptance marker, generic pipeline /
 * durable / recovery-planner code.
 */

const TARGET_SLUG =
  "fatih-sultan-mehmet-ve-i-stanbul-un-fethi-5be83a84-3d83-49f3-8ef2-854543359ca1";
const STAGE = "animation" as const;

// Exact identity the read-only diagnostics captured for this run's crashed
// first (ordinal-0, runType "initial") animation attempt.
const EXPECTED = {
  jobId: `${TARGET_SLUG}-${STAGE}`,
  recordId: "pipeline-record-b014ac56",
  claimId: "pipeline-claim-b014ac56",
  attemptId: "pipeline-attempt-b014ac56",
  leaseId: "pipeline-lease-b014ac56",
  executionFingerprint: "pipeline-execution-2d696e6d",
  reservationId: "idempotency-identity-43872077",
  workerId: "pipeline-worker",
  workerSessionId: "pipeline-session-v1",
  attemptVersion: 2,
  claimVersion: 1,
  leaseVersion: 1,
  deadWorkerPid: 5540,
  imageAssetCount: 16,
} as const;

const EXTENDED_TTL_SECONDS = 31_536_000; // 1y — matches ProductionPipelineExecutionFactory.ttlSeconds

const commit = process.argv.includes("--commit");
const slugArg = process.argv
  .find((value) => value.startsWith("--project-slug="))
  ?.slice("--project-slug=".length);

let writesPerformed = 0;

function fail(reason: string): never {
  console.error(`\nBLOCKED (0 mutation): ${reason}`);
  process.exitCode = 1;
  throw new Error(reason);
}

function assert(condition: unknown, reason: string): asserts condition {
  if (!condition) fail(reason);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM => the PID exists but is owned by another user (still "alive").
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

function trackedDataProjectsDiff(): string {
  try {
    return execFileSync("git", ["diff", "HEAD", "--numstat", "--", "data/projects/"], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
  } catch (error) {
    return `git-diff-failed: ${(error as Error).message}`;
  }
}

interface DurableSnapshot {
  attemptState: string;
  attemptVersion: number;
  attemptFinalizedAt?: string;
  attemptJournalCodes: string[];
  claimState: string;
  claimVersion: number;
  recordState: string;
  leaseStatus: string;
  leaseExpiresAt: string;
  attemptRecoveryClassification: string;
  attemptRecoveryRequired: boolean;
}

async function readDurableSnapshot(
  adapter: ProductionExecutionFilePersistenceAdapter,
): Promise<DurableSnapshot> {
  const attempts = new AdapterBackedProductionExecutionAttemptService(adapter);
  const claims = new AdapterBackedProductionExecutionClaimService(adapter);
  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);

  const attemptRead = await attempts.readExecutionAttempt(EXPECTED.attemptId);
  assert(!attemptRead.error && attemptRead.attempt, `durable attempt read error: ${attemptRead.error ?? "missing"}`);
  const attempt = attemptRead.attempt!;

  const claimAssessment = await claims.evaluateExecutionClaimRecovery(EXPECTED.claimId, nowIso());
  assert(claimAssessment.claim, "durable claim not found");
  const claim = claimAssessment.claim!;

  const recordRead = await storage.read(EXPECTED.recordId);
  assert(recordRead.record, `durable record not found: ${recordRead.reasonCode}`);
  const record = recordRead.record!;
  assert(record.durableLease, "durable record has no lease");

  const attemptRecovery = await attempts.evaluateExecutionAttemptRecovery(EXPECTED.attemptId, nowIso());

  return {
    attemptState: attempt.state,
    attemptVersion: attempt.attemptVersion,
    attemptFinalizedAt: attempt.finalizedAt,
    attemptJournalCodes: attempt.journal.map((entry) => entry.payload.code),
    claimState: claim.state,
    claimVersion: claim.claimVersion,
    recordState: record.state,
    leaseStatus: record.durableLease!.status,
    leaseExpiresAt: record.durableLease!.expiresAt,
    attemptRecoveryClassification: attemptRecovery.classification,
    attemptRecoveryRequired: attemptRecovery.recoveryRequired,
  };
}

/** Read-only image-asset fingerprint used to prove the 16 images are untouched. */
function imageAssetFingerprint(projectFolder: string): { count: number; sha: Record<string, string> } {
  const imagesDir = path.join(projectFolder, "assets", "images");
  const files = fs
    .readdirSync(imagesDir)
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .sort();
  const sha: Record<string, string> = {};
  for (const name of files) sha[name] = sha256(path.join(imagesDir, name));
  return { count: files.length, sha };
}

function assertResumeUnblocked(
  plan: Awaited<ReturnType<typeof PipelineRecoveryPlanner.createResumePlan>>,
  next: Awaited<ReturnType<typeof PipelineQueueScheduler.getNextRunnableStage>>,
  phase: "preflight" | "post-audit",
): void {
  assert(plan.startStage === STAGE && plan.blocked === false, `${phase}: resume plan not { startStage: animation, blocked: false }: ${JSON.stringify(plan)}`);
  if (phase === "preflight") {
    // The blocker: a dangling "running" job makes the scheduler refuse EVERY stage.
    assert(!next.stage && /already running/.test(next.reason ?? ""), `preflight: scheduler is not in the "already running" block: ${JSON.stringify(next)}`);
  } else {
    // After the fix the job is "failed" (not "running"): the scheduler now reports
    // "failed and requires manual retry" -- which is exactly the state
    // PipelineRunner.resumeOnce's `startJob.status === "failed"` branch consumes
    // (via prepareFailedStageRetry -> queued -> scheduled). The "already running"
    // deadlock is gone; a normal resume-finalize can now proceed.
    assert(!next.stage && /is failed and requires manual retry/.test(next.reason ?? ""), `post-audit: scheduler not in the resumable "failed" state: ${JSON.stringify(next)}`);
    assert(!/already running/.test(next.reason ?? ""), `post-audit: scheduler still reports "already running": ${JSON.stringify(next)}`);
  }
}

async function main(): Promise<void> {
  console.log("========== SCOPED CRASH RECOVERY — fatih 5be83a84 / animation ==========");
  console.log(`mode: ${commit ? "APPLY (--commit)" : "DRY RUN (read-only preflight only)"}`);

  // -------------------------------------------------------------- arg guard
  assert(slugArg === TARGET_SLUG, `--project-slug must be exactly "${TARGET_SLUG}" (got ${slugArg ?? "none"})`);

  const context = resolveRuntimeStorageContext({});
  const projectFolder = ProjectReader.getProjectFolder(TARGET_SLUG);
  assert(fs.existsSync(projectFolder), `project folder not found: ${projectFolder}`);
  const durableRoot = `${getProjectRoot(TARGET_SLUG, context)}/production-execution`;
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: durableRoot,
    createRootDirectory: false,
  });

  // ================================================================ STAGE 0
  console.log("\n---------- STAGE 0: READ-ONLY PREFLIGHT ----------");

  // 0.1 dead worker
  assert(!isProcessAlive(EXPECTED.deadWorkerPid), `worker PID ${EXPECTED.deadWorkerPid} is ALIVE — refusing to reconcile a live run`);
  const lockOwnerPath = path.join(projectFolder, ".pipeline-jobs.lock", "owner.json");
  if (fs.existsSync(lockOwnerPath)) {
    const owner = JSON.parse(fs.readFileSync(lockOwnerPath, "utf8")) as { pid?: number; jobId?: string };
    assert(owner.pid === EXPECTED.deadWorkerPid, `stale lock owner pid ${owner.pid} != expected ${EXPECTED.deadWorkerPid}`);
    assert((owner.jobId ?? "").endsWith(`-${STAGE}`), `stale lock owner jobId ${owner.jobId} is not the animation job`);
    assert(!isProcessAlive(owner.pid), `stale lock owner pid ${owner.pid} is ALIVE`);
    console.log(`  stale lock: owner pid=${owner.pid} (dead), jobId=${owner.jobId} — will be auto-recovered by the lock layer`);
  } else {
    console.log("  stale lock: already gone");
  }

  // 0.2 pipeline job
  const job0 = await PipelineJobManager.getJob(TARGET_SLUG, EXPECTED.jobId);
  assert(job0, `pipeline job ${EXPECTED.jobId} not found`);
  assert(job0!.id === EXPECTED.jobId, `job id ${job0!.id} != ${EXPECTED.jobId}`);
  assert(job0!.status === "running", `job status is "${job0!.status}", expected "running"`);
  assert(job0!.attempts === 0, `job attempts is ${job0!.attempts}, expected 0`);
  assert(!job0!.cancelRequestedAt, "job has cancelRequestedAt set");
  assert(!job0!.regenerationId, `job has regenerationId ${job0!.regenerationId}`);
  console.log(`  pipeline job: status=running attempts=0 id=${job0!.id} — OK`);

  // 0.3 manifest
  const manifest0 = await ProjectManager.getManifest(TARGET_SLUG);
  assert(manifest0, "manifest not found");
  assert(manifest0!.packages.animation.status === "running", `manifest animation status "${manifest0!.packages.animation.status}", expected "running"`);
  assert(manifest0!.project.status === "animation", `manifest project.status "${manifest0!.project.status}", expected "animation"`);
  for (const done of ["research", "script", "scenes", "visuals"] as const) {
    assert(manifest0!.packages[done].status === "completed", `manifest ${done} status "${manifest0!.packages[done].status}", expected "completed"`);
  }
  for (const pending of ["video", "audio", "assembly", "thumbnail", "seo", "youtube", "export"] as const) {
    assert(manifest0!.packages[pending].status === "pending", `manifest ${pending} status "${manifest0!.packages[pending].status}", expected "pending"`);
  }
  console.log("  manifest: animation=running, research/script/scenes/visuals=completed, downstream=pending — OK");

  // 0.4 durable identity mapping
  const identity = buildProductionPipelineExecutionIdentity(
    { projectSlug: TARGET_SLUG, stage: STAGE, runType: "initial", regeneration: undefined },
    { id: EXPECTED.jobId, attempts: 0 },
  );
  assert(identity.recordId === EXPECTED.recordId, `computed recordId ${identity.recordId} != ${EXPECTED.recordId}`);
  assert(identity.claimId === EXPECTED.claimId, `computed claimId ${identity.claimId} != ${EXPECTED.claimId}`);
  assert(identity.attemptId === EXPECTED.attemptId, `computed attemptId ${identity.attemptId} != ${EXPECTED.attemptId}`);
  assert(identity.leaseId === EXPECTED.leaseId, `computed leaseId ${identity.leaseId} != ${EXPECTED.leaseId}`);
  assert(identity.executionFingerprint === EXPECTED.executionFingerprint, `computed executionFingerprint ${identity.executionFingerprint} != ${EXPECTED.executionFingerprint}`);
  console.log(`  durable identity (stage=animation runType=initial attempts=0): all 5 IDs match on-disk records`);
  console.log(`  canonical terminalEventId: ${identity.terminalEventId}`);

  // 0.5 durable attempt / claim / record state
  const attemptsSvc = new AdapterBackedProductionExecutionAttemptService(adapter);
  const attemptRead = await attemptsSvc.readExecutionAttempt(EXPECTED.attemptId);
  assert(!attemptRead.error && attemptRead.attempt, `durable attempt read failed: ${attemptRead.error ?? "missing"}`);
  const attempt = attemptRead.attempt!;
  assert(attempt.state === "active", `durable attempt state "${attempt.state}", expected "active"`);
  assert(attempt.attemptVersion === EXPECTED.attemptVersion, `attemptVersion ${attempt.attemptVersion} != ${EXPECTED.attemptVersion}`);
  assert(!attempt.finalizedAt, `attempt already finalizedAt ${attempt.finalizedAt}`);
  assert(attempt.journal.length === 2, `attempt journal length ${attempt.journal.length}, expected 2`);
  assert(attempt.journal[0].entryType === "ATTEMPT_OPENED", `journal[0] entryType ${attempt.journal[0].entryType}`);
  assert(attempt.journal[1].payload.code === "WORKER_RUNNING", `journal[1] code ${attempt.journal[1].payload.code}`);
  assert(!attempt.journal.some((entry) => ["OUTCOME_FINALIZED", "ATTEMPT_ABANDONED"].includes(entry.entryType)), "attempt journal already has a terminal entry");
  assert(attempt.identity.workerId === EXPECTED.workerId, `attempt workerId ${attempt.identity.workerId} != ${EXPECTED.workerId}`);
  assert(attempt.identity.workerSessionId === EXPECTED.workerSessionId, `attempt workerSessionId ${attempt.identity.workerSessionId} != ${EXPECTED.workerSessionId}`);
  assert(attempt.identity.leaseId === EXPECTED.leaseId, `attempt leaseId ${attempt.identity.leaseId} != ${EXPECTED.leaseId}`);
  assert(attempt.identity.claimId === EXPECTED.claimId, `attempt claimId ${attempt.identity.claimId} != ${EXPECTED.claimId}`);
  assert(attempt.binding.claimVersion === EXPECTED.claimVersion, `attempt binding.claimVersion ${attempt.binding.claimVersion} != ${EXPECTED.claimVersion}`);
  assert(attempt.binding.leaseVersion === EXPECTED.leaseVersion, `attempt binding.leaseVersion ${attempt.binding.leaseVersion} != ${EXPECTED.leaseVersion}`);

  const snap0 = await readDurableSnapshot(adapter);
  assert(snap0.claimState === "active", `durable claim state "${snap0.claimState}", expected "active"`);
  assert(snap0.claimVersion === EXPECTED.claimVersion, `durable claim version ${snap0.claimVersion} != ${EXPECTED.claimVersion}`);
  assert(snap0.recordState === "reserved", `durable record state "${snap0.recordState}", expected "reserved"`);
  assert(snap0.leaseStatus === "active", `durable lease status "${snap0.leaseStatus}", expected "active"`);
  assert(new Date(snap0.leaseExpiresAt).getUTCFullYear() >= 2027, `durable lease expiresAt ${snap0.leaseExpiresAt} not the long TTL`);
  assert(snap0.attemptRecoveryClassification === "active" && snap0.attemptRecoveryRequired === false,
    `generic attempt-recovery no longer classifies this "active"/no-recovery: ${JSON.stringify(snap0)} — investigate before applying`);
  console.log(`  durable: attempt=active(v2) claim=active(v1) record=reserved lease=active(->${snap0.leaseExpiresAt.slice(0, 10)})`);
  console.log(`  generic evaluateExecutionAttemptRecovery => "${snap0.attemptRecoveryClassification}" recoveryRequired=${snap0.attemptRecoveryRequired} (the deadlock)`);

  // reservation exists
  const reservationRead = await adapter.read("reservation", EXPECTED.reservationId);
  assert(reservationRead.status === "found", `reservation ${EXPECTED.reservationId} not found (${reservationRead.status})`);
  console.log(`  reservation ${EXPECTED.reservationId}: present`);

  // 0.6 scheduler / resume plan confirm the blocker
  const plan0 = await PipelineRecoveryPlanner.createResumePlan(TARGET_SLUG);
  const next0 = await PipelineQueueScheduler.getNextRunnableStage(
    TARGET_SLUG, plan0.stagesToRun.length ? plan0.stagesToRun : undefined,
  );
  assertResumeUnblocked(plan0, next0, "preflight");
  console.log(`  createResumePlan => startStage=animation blocked=false`);
  console.log(`  getNextRunnableStage => stage=null reason="${next0.reason}"  (the blocker)`);

  // 0.7 16 images
  const img0 = imageAssetFingerprint(projectFolder);
  assert(img0.count === EXPECTED.imageAssetCount, `image asset count ${img0.count} != ${EXPECTED.imageAssetCount}`);
  const assetsJson = JSON.parse(
    fs.readFileSync(path.join(projectFolder, "assets", "assets.json"), "utf8"),
  ) as { assets: Array<{ type: string; status: string }> };
  const generatedImages = assetsJson.assets.filter((a) => a.type === "image" && a.status === "generated").length;
  assert(generatedImages === EXPECTED.imageAssetCount, `assets.json generated image count ${generatedImages} != ${EXPECTED.imageAssetCount}`);
  console.log(`  images: ${img0.count} PNGs on disk, ${generatedImages} generated in assets.json — captured sha256 x${img0.count}`);

  // 0.8 tracked data clean
  const diffBefore = trackedDataProjectsDiff();
  assert(diffBefore === "", `tracked data/projects/ already has changes before apply:\n${diffBefore}`);
  console.log("  git diff HEAD -- data/projects/ : empty (tracked data clean)");

  // 0.9 acceptance config fingerprint
  const diag0 = await diagnoseProductionAcceptanceConfiguration(TARGET_SLUG);
  assert(diag0.matches === true, `acceptance config fingerprint no longer matches: ${JSON.stringify(diag0)}`);
  console.log("  acceptance config fingerprint: matches=true");

  console.log("\nSTAGE 0: ALL PREFLIGHT ASSERTIONS PASSED.");

  if (!commit) {
    console.log("\nDRY RUN — no --commit flag. Zero writes performed. Re-run with --commit to apply.");
    return;
  }

  // ================================================================ STAGE 1
  console.log("\n---------- STAGE 1: APPLY ----------");

  // M1 — durable attempt active -> failed (the worker's own failure transition)
  console.log("M1: durable attempt b014ac56 active -> failed (ProductionExecutionLifecycle.mutate transition=failed)");
  const lifecycle = new ProductionExecutionLifecycle(adapter);
  const m1 = await lifecycle.mutate(
    {
      attemptId: EXPECTED.attemptId,
      claimId: EXPECTED.claimId,
      workerId: EXPECTED.workerId,
      workerSessionId: EXPECTED.workerSessionId,
      leaseId: EXPECTED.leaseId,
      expectedAttemptVersion: EXPECTED.attemptVersion,
      eventId: identity.terminalEventId,
      transition: "failed",
      evaluatedAt: nowIso(),
      metadata: {
        code: "WORKER_CRASH_RECONCILED",
        summary:
          "Worker process ended before the animation stage produced a terminal result; operator crash reconciliation (run 5be83a84).",
        evidence: ["failure:WORKER_CRASH_RECONCILED", "worker:handler-failed", "operator:crash-recovery"],
      },
    },
    { attempt: { ...defaultProductionExecutionAttemptPolicy, reservationTtlSeconds: EXTENDED_TTL_SECONDS } },
  );
  console.log(`   -> ok=${m1.ok} decision=${m1.decision} reasonCode=${m1.reasonCode} state=${m1.state ?? "-"}`);
  assert(m1.ok, `M1 refused: ${m1.reasonCode}`);
  assert(m1.decision === "applied" || m1.decision === "replayed", `M1 unexpected decision ${m1.decision}`);
  if (m1.decision === "applied") writesPerformed += 1;
  assert(m1.attempt?.state === "failed" && Boolean(m1.attempt?.finalizedAt), `M1 attempt not failed/finalized: ${JSON.stringify(m1.attempt?.state)}`);

  // M2 — pipeline job + manifest running -> failed (executor's own primitive)
  console.log("M2: pipeline job + manifest animation running -> failed (PipelineJobManager.persistStageFailure)");
  const failureReason =
    "Worker crash reconciled: process ended before the animation stage produced a terminal result (run 5be83a84).";
  const m2 = await PipelineJobManager.persistStageFailure(
    TARGET_SLUG,
    STAGE,
    async () => {
      await ProjectManager.updatePackageStatus(TARGET_SLUG, STAGE, "failed", failureReason, { runType: "initial" });
    },
    failureReason,
    undefined,
  );
  console.log(`   -> persistStageFailure returned ${m2}`);
  assert(m2 === true, "M2 refused (persistStageFailure returned false) — job was no longer 'running'");
  writesPerformed += 1;

  // M3 — settle claim / lease / record via the existing retry-prep reconciler
  console.log("M3: reconcileFailedPipelineExecution(job) — close claim, release lease, terminalize record");
  const jobAfterFlip = await PipelineJobManager.getJob(TARGET_SLUG, EXPECTED.jobId);
  assert(jobAfterFlip && jobAfterFlip.status === "failed", `M3 pre-check: job status is ${jobAfterFlip?.status}, expected "failed"`);
  const m3 = await reconcileFailedPipelineExecution(jobAfterFlip!, undefined, { storageContext: context });
  console.log(`   -> ok=${m3.ok} reasonCode=${m3.reasonCode} writeFree=${m3.writeFree}`);
  assert(m3.ok, `M3 refused: ${m3.reasonCode} (${m3.evidence.join(", ")})`);
  if (!m3.writeFree) writesPerformed += 1;

  console.log(`\nSTAGE 1: APPLY COMPLETE (${writesPerformed} write step(s)).`);

  // ================================================================ STAGE 2
  console.log("\n---------- STAGE 2: READ-ONLY POST-AUDIT ----------");

  const snap1 = await readDurableSnapshot(adapter);
  assert(snap1.attemptState === "failed", `post: durable attempt state "${snap1.attemptState}", expected "failed"`);
  assert(snap1.attemptFinalizedAt, "post: durable attempt has no finalizedAt");
  assert(snap1.claimState !== "active", `post: durable claim still "active" (${snap1.claimState})`);
  assert(snap1.leaseStatus !== "active", `post: durable lease still "active" (${snap1.leaseStatus})`);
  assert(["failed", "cancelled"].includes(snap1.recordState), `post: durable record state "${snap1.recordState}" not terminal`);
  // The terminal attempt now reports "stale-claim-version" simply because settlement
  // closed (version-bumped) its claim -- expected, and NOT a blocker:
  // reconcileFailedPipelineExecution only gates on attempt.state === "failed" (line 185),
  // and the exact-ordinal-0 durable lineage classifier still returns "valid".
  const lineage1 = await classifyProductionDurableAttemptLineage(adapter, TARGET_SLUG, STAGE, 0, "exact");
  assert(lineage1.status === "valid", `post: exact ordinal-0 durable lineage is "${lineage1.status}", expected "valid"`);
  console.log(`  durable: attempt=${snap1.attemptState}(finalized) claim=${snap1.claimState}(v${snap1.claimVersion}) lease=${snap1.leaseStatus} record=${snap1.recordState}`);
  console.log(`  evaluateExecutionAttemptRecovery => "${snap1.attemptRecoveryClassification}" (expected post-settlement)`);
  console.log(`  classifyProductionDurableAttemptLineage(ordinal 0, exact) => "${lineage1.status}"  (resume's prepareFailedStageRetry re-verifies this)`);

  const job1 = await PipelineJobManager.getJob(TARGET_SLUG, EXPECTED.jobId);
  assert(job1 && job1.status === "failed" && job1.attempts === 0, `post: pipeline job ${JSON.stringify({ status: job1?.status, attempts: job1?.attempts })} != failed/0`);
  const manifest1 = await ProjectManager.getManifest(TARGET_SLUG);
  assert(manifest1 && manifest1.packages.animation.status === "failed", `post: manifest animation status ${manifest1?.packages.animation.status} != failed`);
  console.log(`  pipeline job: status=failed attempts=0 ; manifest animation: failed`);

  const history = JSON.parse(
    fs.readFileSync(path.join(projectFolder, "pipeline-history.json"), "utf8"),
  ) as { events: Array<{ stage: string; status: string }> };
  const animationFailedEvents = history.events.filter((e) => e.stage === STAGE && e.status === "failed");
  assert(animationFailedEvents.length === 1, `post: expected exactly 1 animation "failed" history event, found ${animationFailedEvents.length}`);
  console.log(`  pipeline-history: 1 animation "failed" event recorded (audit trail preserved)`);

  const plan1 = await PipelineRecoveryPlanner.createResumePlan(TARGET_SLUG);
  const next1 = await PipelineQueueScheduler.getNextRunnableStage(
    TARGET_SLUG, plan1.stagesToRun.length ? plan1.stagesToRun : undefined,
  );
  assertResumeUnblocked(plan1, next1, "post-audit");
  console.log(`  createResumePlan => startStage=animation blocked=false`);
  console.log(`  getNextRunnableStage => stage=${next1.stage}  (no longer "already running")`);

  const img1 = imageAssetFingerprint(projectFolder);
  assert(img1.count === img0.count, `post: image count changed ${img0.count} -> ${img1.count}`);
  for (const [name, hash] of Object.entries(img0.sha)) {
    assert(img1.sha[name] === hash, `post: image ${name} sha256 changed`);
  }
  console.log(`  images: ${img1.count}/16 present, all sha256 byte-for-byte unchanged`);

  const diag1 = await diagnoseProductionAcceptanceConfiguration(TARGET_SLUG);
  assert(diag1.matches === true, `post: acceptance config fingerprint no longer matches: ${JSON.stringify(diag1)}`);
  console.log("  acceptance config fingerprint: matches=true");

  const diffAfter = trackedDataProjectsDiff();
  assert(diffAfter === "", `post: tracked data/projects/ changed:\n${diffAfter}`);
  console.log("  git diff HEAD -- data/projects/ : still empty (tracked data untouched)");

  console.log("\nSTAGE 2: POST-AUDIT PASSED.");
  console.log("\n=== SCOPED CRASH RECOVERY COMPLETE — run 5be83a84 is now resume-eligible from animation ===");
}

void main().catch((error) => {
  console.error("\n!!! STOPPED !!!", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
