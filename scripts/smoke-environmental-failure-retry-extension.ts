import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProjectWriter } from "../src/lib/projects/ProjectWriter";
import { prepareFailedStageRetry } from "../src/lib/pipeline/PipelineFailedStageRetry";
import {
  assertCanonicalPipelineRetryAdmission,
  type PipelineRetryAdmission,
} from "../src/lib/pipeline/PipelineRetryAdmission";
import { prepareProductionPipelineExecution } from
  "../src/lib/production/ProductionPipelineExecutionFactory";
import { ProductionExecutionWorkerExecutionService } from
  "../src/lib/production/ProductionExecutionWorker";
import { reconcileFailedPipelineExecution } from
  "../src/lib/production/ProductionPipelineRetryReconciliation";
import { withProductionAcceptanceRetryAdmission } from
  "../src/lib/production/ProductionAcceptanceLegacyAdmissionContext";
import {
  planRetryBudgetExtension,
  applyRetryBudgetExtension,
} from "../src/lib/production/ProductionPipelineRetryBudgetExtensionService";
import {
  createProductionAcceptanceMarkerV3,
} from "../src/lib/production/ProductionAcceptancePolicy";
import { createProductionAcceptanceProjectSlug } from
  "../src/lib/production/ProductionAcceptanceTopic";
import { createProductionAcceptancePortableConfigurationSnapshot } from
  "../src/lib/production/ProductionAcceptanceConfigurationFingerprint";
import { runProductionAcceptanceCommand } from
  "../src/lib/production/ProductionAcceptanceCommand";
import {
  buildProductionPipelineEnvironmentalFailureRetryExtensionBody,
  buildProductionPipelineEnvironmentalFailureRetryExtensionReceipt,
  computeEnvironmentalFailureRetryChallengePayload,
  findConsumedEnvironmentalFailureRetryExtension,
  findMatchingEnvironmentalFailureRetryExtension,
  readEnvironmentalFailureRetryExtensionAuthority,
  readEnvironmentalFailureRetryExtensionReceipt,
  validateEnvironmentalFailureRetryExtensionBody,
  validateEnvironmentalFailureRetryOperatorEvidence,
  writeEnvironmentalFailureRetryExtensionAuthority,
  writeEnvironmentalFailureRetryExtensionReceipt,
  type EnvironmentalFailureRetryChallengePayload,
} from "../src/lib/production/ProductionPipelineEnvironmentalFailureRetryExtension";
import { planEnvironmentalFailureRetryExtension } from
  "../src/lib/production/ProductionEnvironmentalFailureRetryPlan";
import type { PipelineJob, PipelineJobList } from "../src/types/pipelineJob";
import type { RuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";

let passCount = 0;
function pass(condition: unknown, label: string) {
  if (!condition) throw new Error(`FAIL ${passCount + 1}: ${label}`);
  passCount += 1;
  console.log(`PASS ${passCount}: ${label}`);
}

const STAGE = "thumbnail" as const;
const GOOD_EVIDENCE = {
  observedHttpStatus: 401 as const,
  observedProviderErrorCode: "invalid_api_key",
  remediationVerified: "models=200; chat.completions=200; images.generations:gpt-image-1=200",
};

/**
 * A worker-handler failure whose `.code` the durable worker records verbatim
 * as the attempt/record failure code -- exactly like the real
 * `ThumbnailAssetGenerationError` (code THUMBNAIL_ASSET_GENERATION_FAILED)
 * that the credential rejections produced in the incident.
 */
function credentialFailure(): Error {
  const error = new Error("controlled thumbnail credential failure");
  (error as { code?: string }).code = "THUMBNAIL_ASSET_GENERATION_FAILED";
  return error;
}

// ---------------------------------------------------------------------------
// A synthetic-but-shape-valid challenge payload for a non-durable authority
// build/validate/store test. currentDurableOrdinal 4 -> authorized 5.
// ---------------------------------------------------------------------------
function syntheticChallengePayload(
  projectSlug: string,
  overrides: Partial<EnvironmentalFailureRetryChallengePayload> = {},
): EnvironmentalFailureRetryChallengePayload {
  const jobId = `${projectSlug}-${STAGE}`;
  return computeEnvironmentalFailureRetryChallengePayload({
    currentDurableOrdinal: 4,
    failureClass: "external-provider-credential-invalid",
    projectSlug,
    stage: STAGE,
    jobId,
    reason: "ordinals 2-4 failed on an invalid OPENAI_API_KEY; key replaced + verified",
    observedFailureCode: "THUMBNAIL_ASSET_GENERATION_FAILED",
    priorJob: {
      id: jobId, status: "failed", attempts: 3,
      updatedAt: "2026-08-28T13:22:18.882Z", fingerprint: "pipeline-job-pre-mutation-abcdef01",
    },
    manifestPackage: { status: "failed", failureCode: "THUMBNAIL_ASSET_GENERATION_FAILED" },
    latestHistory: { eventId: `${jobId}-failed-event`, eventFingerprint: "latest-history-fp-1234" },
    terminalDurableAttempt: {
      recordId: "pipeline-record-51d77f87",
      recordState: "cancelled", recordAttempt: 4, recordMaxAttempts: 4,
      recordIntegrityFingerprint: "idempotency-identity-c3e280b8",
      failureCategory: "provider", failureRetryable: true,
      failureCode: "THUMBNAIL_ASSET_GENERATION_FAILED",
      attemptId: "pipeline-attempt-51d77f87", attemptState: "failed",
      attemptIntegrityFingerprint: "durable-attempt-integrity-9dba2a10",
      leaseId: "pipeline-lease-51d77f87", leaseState: "released",
      leaseIntegrityFingerprint: "durable-lease-integrity-d419e5cd",
      claimId: "pipeline-claim-51d77f87", claimState: "abandoned",
      claimIntegrityFingerprint: "durable-claim-integrity-485216fb",
      reservationId: "idempotency-identity-c3e280b8",
    },
    operatorEvidence: GOOD_EVIDENCE,
    acceptanceMarkerHash: "acceptance-marker-sha256-6bbc31f9",
    configurationFingerprint: "8392ea0014b70ea6e1e0ec13e2a3f6cf426879d3c758e8148e02d605f0843662",
    authorityFingerprint: "runtime-authority-fingerprint-33bef6c0",
    ...overrides,
  });
}

// =========================================================================

async function partA(projectSlug: string, ctx: RuntimeStorageContext) {
  const isolatedInput = ctx;
  // Give the store helpers a project directory to write into.
  await fs.mkdir(path.join(ctx.projectsRoot, projectSlug), { recursive: true });

  // --- authority build + validate ---------------------------------------
  const body = buildProductionPipelineEnvironmentalFailureRetryExtensionBody(
    syntheticChallengePayload(projectSlug), "2026-08-28T14:00:00.000Z",
  );
  pass(validateEnvironmentalFailureRetryExtensionBody(body), "well-formed authority body validates");
  pass(body.authorizedDurableOrdinal === 5 && body.effectiveMaxAttempts === 5 &&
    body.baseMaxAttempts === 4 && body.currentDurableOrdinal === 4,
    "authority authorizes exactly one ordinal past the stuck one (4 -> 5)");

  // --- tamper cases -----------------------------------------------------
  const tamper = <K extends keyof EnvironmentalFailureRetryChallengePayload>(
    key: K, value: EnvironmentalFailureRetryChallengePayload[K],
  ) => buildProductionPipelineEnvironmentalFailureRetryExtensionBody(
    syntheticChallengePayload(projectSlug, { [key]: value } as Partial<EnvironmentalFailureRetryChallengePayload>),
    "2026-08-28T14:00:00.000Z",
  );

  pass(!validateEnvironmentalFailureRetryExtensionBody(
    { ...body, failureClass: "something-else" as "external-provider-credential-invalid" }),
    "authority with an unknown failureClass is rejected");
  pass(!validateEnvironmentalFailureRetryExtensionBody(
    { ...body, observedFailureCode: "FFMPEG_RENDER_FAILED" }),
    "authority whose observedFailureCode is outside the credential-sensitive allowlist is rejected");
  pass(!validateEnvironmentalFailureRetryExtensionBody(
    { ...tamper("currentDurableOrdinal", 4), authorizedDurableOrdinal: 6 } as typeof body),
    "authority whose authorizedDurableOrdinal is not currentDurableOrdinal + 1 is rejected");
  pass(!validateEnvironmentalFailureRetryExtensionBody({ ...body, integrity: {
    algorithm: "stable-production-id-v1", fingerprint: "tampered" } }),
    "authority with a tampered integrity fingerprint is rejected");
  pass(!validateEnvironmentalFailureRetryExtensionBody({ ...body,
    terminalDurableAttempt: { ...body.terminalDurableAttempt, failureCategory: "worker" as "provider" } }),
    "authority whose terminal attempt failure was not category:provider is rejected");
  pass(!validateEnvironmentalFailureRetryExtensionBody({ ...body,
    priorJob: { ...body.priorJob, attempts: 2 as 3 } }),
    "authority whose priorJob.attempts != currentDurableOrdinal - 1 is rejected");

  // --- operator evidence validation -----------------------------------
  pass(validateEnvironmentalFailureRetryOperatorEvidence(GOOD_EVIDENCE),
    "well-formed operator evidence validates");
  pass(!validateEnvironmentalFailureRetryOperatorEvidence(
    { ...GOOD_EVIDENCE, observedHttpStatus: 500 as 401 }),
    "operator evidence with a non-credential HTTP status (500) is rejected");
  pass(!validateEnvironmentalFailureRetryOperatorEvidence(
    { ...GOOD_EVIDENCE, observedProviderErrorCode: "has spaces and $" }),
    "operator evidence with an unsanitized provider error code is rejected");

  // --- store: authority write / read / replay / conflict --------------
  const w1 = writeEnvironmentalFailureRetryExtensionAuthority(projectSlug, body, isolatedInput);
  pass(w1.ok && w1.status === "created", "authority publishes to the shared retry-budget-extensions dir");
  const r1 = readEnvironmentalFailureRetryExtensionAuthority(projectSlug, body.authorityId, isolatedInput);
  pass(r1.ok && r1.value?.authorityId === body.authorityId, "published authority reads back byte-identical");
  const w2 = writeEnvironmentalFailureRetryExtensionAuthority(projectSlug, body, isolatedInput);
  pass(w2.ok && w2.status === "replayed", "re-publishing the same authority is an idempotent replay (write-free)");

  // --- store: receipt lifecycle -------------------------------------
  const consumed = buildProductionPipelineEnvironmentalFailureRetryExtensionReceipt(
    body.authorityId, "consumed", "2026-08-28T14:05:00.000Z", "2026-08-28T14:04:00.000Z",
    ["transaction:consumed-receipt-finalized"],
  );
  const rc1 = writeEnvironmentalFailureRetryExtensionReceipt(projectSlug, consumed, isolatedInput);
  pass(rc1.ok && rc1.status === "created", "consumed receipt writes once");
  const rc2 = writeEnvironmentalFailureRetryExtensionReceipt(projectSlug, consumed, isolatedInput);
  pass(rc2.ok && rc2.status === "replayed", "identical consumed receipt replays");
  const consumedOther = buildProductionPipelineEnvironmentalFailureRetryExtensionReceipt(
    body.authorityId, "consumed", "2026-08-28T14:06:00.000Z", "different-job-version", [],
  );
  const rc3 = writeEnvironmentalFailureRetryExtensionReceipt(projectSlug, consumedOther, isolatedInput);
  pass(!rc3.ok && rc3.reasonCode === "ENVIRONMENTAL_FAILURE_RETRY_EXTENSION_ALREADY_CONSUMED",
    "a second, different consumed receipt for the same authority is rejected (single-use)");
  pass(readEnvironmentalFailureRetryExtensionReceipt(
    projectSlug, body.authorityId, "consumed", isolatedInput).ok,
    "consumed receipt reads back");

  // --- findMatching / findConsumed ---------------------------------
  const jobAt3: PipelineJob = {
    id: body.jobId, projectSlug, stage: STAGE, title: "Thumbnail", status: "failed", attempts: 3,
    createdAt: "2026-08-28T12:00:00.000Z", updatedAt: "2026-08-28T13:22:18.882Z",
  };
  // findMatching wants a NOT-yet-consumed authority; ours already has a consumed
  // receipt from the lifecycle test above, so it must now return undefined.
  pass(findMatchingEnvironmentalFailureRetryExtension(
    projectSlug, STAGE, jobAt3, 5, isolatedInput) === undefined,
    "findMatching refuses an authority that already carries a consumed receipt");
  const consumedMatch = findConsumedEnvironmentalFailureRetryExtension(
    projectSlug, STAGE, { ...jobAt3, attempts: 4, updatedAt: consumed.jobVersion }, isolatedInput,
  );
  pass(consumedMatch?.authorityId === body.authorityId,
    "findConsumed matches the consumed authority for the exact post-admission job version");
  pass(findConsumedEnvironmentalFailureRetryExtension(
    projectSlug, STAGE, { ...jobAt3, attempts: 4, updatedAt: "stale" }, isolatedInput) === undefined,
    "findConsumed rejects a stale job version");

  // Note: assertCanonicalPipelineRetryAdmission recomputes and compares
  // execution-identity and binding fingerprints from the real jobs, so it can
  // only be exercised meaningfully with a genuine admission -- Part B does that
  // with the object prepareFailedStageRetry actually produces (pass, minus the
  // proof -> throws, wrong failureClass -> throws), plus the ordinal-6 ceiling.

  // --- CLI argument parsing --------------------------------------
  const cliMissingEvidence = await runProductionAcceptanceCommand([
    "environmental-failure-retry-plan", `--project-slug=${projectSlug}`, `--stage=${STAGE}`,
    `--job-id=${projectSlug}-${STAGE}`, "--reason=x",
  ]);
  pass(cliMissingEvidence.exitCode === 2, "CLI plan rejects a call missing the operator-evidence args");
  const cliBadStatus = await runProductionAcceptanceCommand([
    "environmental-failure-retry-plan", `--project-slug=${projectSlug}`, `--stage=${STAGE}`,
    `--job-id=${projectSlug}-${STAGE}`, "--reason=x", "--observed-http-status=500",
    "--observed-provider-error-code=nope", "--remediation-verified=note",
  ]);
  pass(cliBadStatus.exitCode === 2, "CLI plan rejects a non-credential observed-http-status");
}

// =========================================================================
// Part B: durable ordinal-1..4 lineage + real acceptance marker.
// =========================================================================

async function seedFailedOrdinal(
  projectSlug: string, jobAttempts: number, admission?: {
    admission: PipelineRetryAdmission; previousJob: PipelineJob;
  },
): Promise<PipelineJob> {
  const now = new Date(Date.parse("2026-08-28T12:00:00.000Z") + jobAttempts * 30_000);
  const queued: PipelineJob = {
    id: `${projectSlug}-${STAGE}`, projectSlug, stage: STAGE, title: "Thumbnail",
    status: "queued", attempts: jobAttempts,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
  await ProjectWriter.writeJSON(projectSlug, "pipeline-jobs.json", {
    projectSlug, jobs: [queued], createdAt: queued.createdAt, updatedAt: queued.updatedAt,
  } satisfies PipelineJobList);

  const runExec = async () => {
    const prepared = await prepareProductionPipelineExecution({
      projectSlug, stage: STAGE, runType: jobAttempts === 0 ? "initial" : "resume",
    });
    const execution = await new ProductionExecutionWorkerExecutionService(prepared.executionAdapter)
      .execute(prepared.request, async () => { throw credentialFailure(); },
        { isCancellationRequested: () => false });
    assert.equal(execution.status, "failed");
  };
  if (admission) {
    await withProductionAcceptanceRetryAdmission(admission.admission, admission.previousJob, runExec);
  } else {
    await runExec();
  }

  const failedAt = new Date(now.getTime() + 5_000).toISOString();
  const failedJob: PipelineJob = {
    ...queued, status: "failed", updatedAt: failedAt, startedAt: now.toISOString(),
    completedAt: failedAt, error: "THUMBNAIL_ASSET_GENERATION_FAILED",
  };
  await ProjectWriter.writeJSON(projectSlug, "pipeline-jobs.json", {
    projectSlug, jobs: [failedJob], createdAt: failedJob.createdAt, updatedAt: failedAt,
  } satisfies PipelineJobList);
  const history = await PipelineJobManager.listHistory(projectSlug);
  await ProjectWriter.writeJSON(projectSlug, "pipeline-history.json", {
    projectSlug,
    events: [...history.events, {
      id: `${failedJob.id}-failed-${failedAt}`, jobId: failedJob.id, stage: STAGE, status: "failed",
      startedAt: failedJob.startedAt, completedAt: failedAt, jobCreatedAt: failedJob.createdAt,
      jobUpdatedAt: failedAt, recordedAt: failedAt, errorCode: "THUMBNAIL_ASSET_GENERATION_FAILED",
    }],
    createdAt: history.createdAt, updatedAt: failedAt,
  });
  const reconciled = await reconcileFailedPipelineExecution(
    failedJob, () => new Date(Date.parse(failedAt) + 1_000).toISOString(),
  );
  assert.equal(reconciled.ok, true, `reconcile ordinal ${jobAttempts + 1}: ${JSON.stringify(reconciled)}`);
  return failedJob;
}

async function writeManifest(projectSlug: string, topic: string, runId: string) {
  const anchor = "2026-08-28T12:00:00.000Z";
  await ProjectWriter.writeJSON(projectSlug, "manifest.json", {
    schemaVersion: "3", id: `proj-${projectSlug}`, projectSlug, slug: projectSlug, name: projectSlug,
    topic, runId, createdAt: anchor, updatedAt: anchor,
    packages: {
      [STAGE]: { status: "failed", error: "THUMBNAIL_ASSET_GENERATION_FAILED", updatedAt: anchor },
    },
  });
}

async function partB(ctx: RuntimeStorageContext) {
  const runtimeRoot = ctx.runtimeRoot;
  const topic = "Environmental failure retry extension smoke fixture";
  const runId = "00000000-0000-4000-8000-00000000e5e5";
  const slug = createProductionAcceptanceProjectSlug(topic, runId);

  // Make FFMPEG/FFPROBE "configured" against real temp files so the acceptance
  // configuration snapshot has zero unavailable components in this environment.
  const ffDir = await fs.mkdtemp(path.join(os.tmpdir(), "envfail-ff-"));
  const ffmpeg = path.join(ffDir, "ffmpeg");
  const ffprobe = path.join(ffDir, "ffprobe");
  await fs.writeFile(ffmpeg, "#!/bin/sh\nexit 0\n");
  await fs.writeFile(ffprobe, "#!/bin/sh\nexit 0\n");
  const savedFfmpeg = process.env.FFMPEG_PATH;
  const savedFfprobe = process.env.FFPROBE_PATH;
  process.env.FFMPEG_PATH = ffmpeg;
  process.env.FFPROBE_PATH = ffprobe;

  try {
    const config = await createProductionAcceptancePortableConfigurationSnapshot();
    if (config.unavailableComponents.length > 0) {
      console.log(`  [partB] SKIPPED — acceptance configuration unavailable: ` +
        `${config.unavailableComponents.join(",")}`);
      return;
    }
    const target = path.join(runtimeRoot, "projects", slug);
    await fs.rm(target, { recursive: true, force: true });
    await createProductionAcceptanceMarkerV3(slug, runId, config, topic);

    await PipelineJobManager.listJobs(slug);
    await writeManifest(slug, topic, runId);

    // Base budget: ordinals 1, 2, 3.
    await seedFailedOrdinal(slug, 0);
    await seedFailedOrdinal(slug, 1);
    const failedAt2 = await seedFailedOrdinal(slug, 2);
    await writeManifest(slug, topic, runId);

    const jobId = `${slug}-${STAGE}`;
    // Ordinal 4 via the existing retry-budget-extension mechanism.
    const rbePlan = await planRetryBudgetExtension(slug, STAGE, jobId,
      "smoke: base budget exhausted by controlled credential failures", ctx);
    pass(rbePlan.eligible && Boolean(rbePlan.authorityId),
      "ordinal-4 retry-budget-extension plans against the seeded ordinal-3 lineage");
    const rbeApply = await applyRetryBudgetExtension(slug, STAGE, jobId,
      "smoke: base budget exhausted by controlled credential failures",
      rbePlan.authorityId!, rbePlan.authorityId!, ctx);
    pass(rbeApply.success, "ordinal-4 retry-budget-extension authority is published");
    const rbeRetry = await prepareFailedStageRetry(slug, jobId, "resume", ctx);
    if (!rbeRetry.success) throw new Error(`ORDINAL_4_RETRY_FAILED:${rbeRetry.reasonCode}`);
    pass(rbeRetry.admission.admittedDurableOrdinal === 4,
      "failed-stage retry consumes the ordinal-4 authority and admits durable ordinal 4");

    // Run + fail ordinal 4 under that admission, then reconcile it terminal.
    await withProductionAcceptanceRetryAdmission(rbeRetry.admission, rbeRetry.previousJob, async () => {
      const prepared = await prepareProductionPipelineExecution({
        projectSlug: slug, stage: STAGE, runType: "resume",
      });
      const execution = await new ProductionExecutionWorkerExecutionService(prepared.executionAdapter)
        .execute(prepared.request, async () => { throw credentialFailure(); },
          { isCancellationRequested: () => false });
      assert.equal(execution.status, "failed");
    });
    // Ordinal 4's durable records were minted with a real "now" anchor by
    // prepareFailedStageRetry (its prepared job version is Date.now()), so
    // reconcile it with real time too -- a synthetic 2026 timestamp would be
    // before the lease's acquiredAt and rejected as LEASE_TIMESTAMP_INVALID.
    void failedAt2;
    const ord4FailedAt = new Date().toISOString();
    const ord4Failed: PipelineJob = {
      ...rbeRetry.job, status: "failed", attempts: 3, updatedAt: ord4FailedAt,
      completedAt: ord4FailedAt, error: "THUMBNAIL_ASSET_GENERATION_FAILED",
    };
    await ProjectWriter.writeJSON(slug, "pipeline-jobs.json", {
      projectSlug: slug, jobs: [ord4Failed], createdAt: ord4Failed.createdAt, updatedAt: ord4FailedAt,
    } satisfies PipelineJobList);
    const hist = await PipelineJobManager.listHistory(slug);
    await ProjectWriter.writeJSON(slug, "pipeline-history.json", {
      projectSlug: slug, events: [...hist.events, {
        id: `${jobId}-failed-${ord4FailedAt}`, jobId, stage: STAGE, status: "failed",
        startedAt: ord4FailedAt, completedAt: ord4FailedAt, jobCreatedAt: ord4Failed.createdAt,
        jobUpdatedAt: ord4FailedAt, recordedAt: ord4FailedAt,
        errorCode: "THUMBNAIL_ASSET_GENERATION_FAILED",
      }], createdAt: hist.createdAt, updatedAt: ord4FailedAt,
    });
    await writeManifest(slug, topic, runId);
    const ord4Reconciled = await reconcileFailedPipelineExecution(ord4Failed);
    assert.equal(ord4Reconciled.ok, true, `ordinal-4 reconcile: ${JSON.stringify(ord4Reconciled)}`);

    const durableBefore = await durableDigest(target);

    // --- The environmental-failure retry extension --------------------
    // authorityId is a deterministic function of (project, stage, job, exact
    // durable lineage, reason, operator evidence, marker), so plan and apply
    // MUST pass byte-identical reason + evidence args -- share them here.
    const REASON = "ordinals 2-4 failed on an invalid OPENAI_API_KEY (401 invalid_api_key); " +
      "key replaced + verified (models/chat/gpt-image-1 all HTTP 200)";
    const EVIDENCE_ARGS = [
      "--observed-http-status=401", "--observed-provider-error-code=invalid_api_key",
      "--remediation-verified=models=200; chat.completions=200; images.generations:gpt-image-1=200",
    ];
    const plan = await planEnvironmentalFailureRetryExtension(
      slug, STAGE, jobId, REASON, GOOD_EVIDENCE, ctx,
    );
    pass(plan.eligible && plan.authorityId !== undefined &&
      plan.challengePayload?.authorizedDurableOrdinal === 5,
      "environmental-failure retry extension is eligible against the ordinal-4 terminal provider failure");

    // Negative: wrong observed failure code (not credential-sensitive).
    // Snapshot + restore manifest and history bytes so the positive flow below
    // sees exactly the state the eligible plan above was computed against.
    const manifestBytes = await fs.readFile(path.join(target, "manifest.json"), "utf8");
    const historyBytes = await fs.readFile(path.join(target, "pipeline-history.json"), "utf8");
    await writeManifestWithCode(slug, topic, runId, "FFMPEG_RENDER_FAILED");
    const planWrongCode = await planEnvironmentalFailureRetryExtension(
      slug, STAGE, jobId, "x", GOOD_EVIDENCE, ctx);
    pass(!planWrongCode.eligible &&
      planWrongCode.evidence.some((e) => e.includes("not-credential-sensitive")),
      "a non-credential-sensitive manifest failure code is not eligible");
    await fs.writeFile(path.join(target, "manifest.json"), manifestBytes, "utf8");
    await fs.writeFile(path.join(target, "pipeline-history.json"), historyBytes, "utf8");

    const applyArgs = [
      "apply-environmental-failure-retry", `--project-slug=${slug}`, `--stage=${STAGE}`,
      `--job-id=${jobId}`, `--reason=${REASON}`, ...EVIDENCE_ARGS,
      `--authority-id=${plan.authorityId}`, `--confirm-environmental-failure-retry=${plan.authorityId}`,
    ];
    const apply = await runProductionAcceptanceCommand(applyArgs);
    pass(apply.exitCode === 0, "apply-environmental-failure-retry publishes the authority");
    const applyReplay = await runProductionAcceptanceCommand(applyArgs);
    pass(applyReplay.exitCode === 0 &&
      (applyReplay.report as { decision?: string }).decision === "replayed",
      "a second apply of the same authority is an idempotent replay");

    const retry = await prepareFailedStageRetry(slug, jobId, "resume", ctx);
    if (!retry.success) throw new Error(`ORDINAL_5_RETRY_FAILED:${retry.reasonCode}`);
    pass(retry.admission.admittedDurableOrdinal === 5 &&
      retry.admission.environmentalFailureRetryAuthorityProof?.authorityId === plan.authorityId &&
      retry.admission.environmentalFailureRetryAuthorityProof?.failureClass ===
        "external-provider-credential-invalid",
      "failed-stage retry consumes the environmental authority and admits durable ordinal 5");
    assert.doesNotThrow(() => assertCanonicalPipelineRetryAdmission({
      admission: retry.admission, previousJob: retry.previousJob, currentJob: retry.job,
      projectSlug: slug, stage: STAGE, runType: "resume",
    }), "the real ordinal-5 admission passes assertCanonicalPipelineRetryAdmission");
    passCount += 1;
    console.log(`PASS ${passCount}: the real ordinal-5 admission passes assertCanonicalPipelineRetryAdmission`);

    // Same real admission, but with the environmental proof removed / corrupted:
    // assertCanonicalPipelineRetryAdmission must reject ordinal 5 without it.
    assert.throws(() => assertCanonicalPipelineRetryAdmission({
      admission: { ...retry.admission, environmentalFailureRetryAuthorityProof: undefined },
      previousJob: retry.previousJob, currentJob: retry.job,
      projectSlug: slug, stage: STAGE, runType: "resume",
    }), /PIPELINE_RETRY_EXECUTION_ADMISSION_FAILED/,
    "the real ordinal-5 admission is rejected once the environmental proof is stripped");
    passCount += 1;
    console.log(`PASS ${passCount}: the real ordinal-5 admission is rejected once the environmental proof is stripped`);
    assert.throws(() => assertCanonicalPipelineRetryAdmission({
      admission: { ...retry.admission, environmentalFailureRetryAuthorityProof: {
        ...retry.admission.environmentalFailureRetryAuthorityProof!,
        failureClass: "some-other-class" as "external-provider-credential-invalid" } },
      previousJob: retry.previousJob, currentJob: retry.job,
      projectSlug: slug, stage: STAGE, runType: "resume",
    }), /PIPELINE_RETRY_EXECUTION_ADMISSION_FAILED/,
    "the real ordinal-5 admission is rejected when the proof carries the wrong failureClass");
    passCount += 1;
    console.log(`PASS ${passCount}: the real ordinal-5 admission is rejected when the proof carries the wrong failureClass`);

    // After consumption the job is at attempts 4 -> a second environmental
    // extension can never be planned, and prepareFailedStageRetry now hits the
    // hard ordinal ceiling (ordinal 6 has no path for a non-regeneration retry).
    await writeOrd5FailedJob(slug, topic, runId, retry.job, jobId);
    const secondPlan = await planEnvironmentalFailureRetryExtension(
      slug, STAGE, jobId, "second attempt", GOOD_EVIDENCE, ctx);
    pass(!secondPlan.eligible && secondPlan.evidence.some((e) => e.startsWith("job:status")),
      "a second environmental-failure retry extension is refused (job already advanced past attempts 3)");
    const ceilingRetry = await prepareFailedStageRetry(slug, jobId, "resume", ctx);
    pass(!ceilingRetry.success && ceilingRetry.reasonCode === "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED",
      "prepareFailedStageRetry hits the ordinal ceiling after the single environmental retry (no ordinal 6)");

    // Canonical ordinal-1..4 records + the ordinal-4 retry-budget authority are
    // byte-unchanged by the environmental mechanism.
    const durableAfter = await durableDigest(target, ["envfail-", "receipt-", "authority-"]);
    const durableBeforeFiltered = filterDigest(durableBefore, ["envfail-", "receipt-", "authority-"]);
    pass(JSON.stringify(durableAfter) === JSON.stringify(durableBeforeFiltered),
      "ordinals 1-4 and the ordinal-4 retry-budget authority are byte-for-byte unchanged");

    await fs.rm(target, { recursive: true, force: true });
  } finally {
    if (savedFfmpeg === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = savedFfmpeg;
    if (savedFfprobe === undefined) delete process.env.FFPROBE_PATH; else process.env.FFPROBE_PATH = savedFfprobe;
    await fs.rm(ffDir, { recursive: true, force: true });
  }
}

async function writeOrd5FailedJob(
  projectSlug: string, topic: string, runId: string, queuedOrd5Job: PipelineJob, jobId: string,
) {
  const failedAt = new Date(Date.parse(queuedOrd5Job.updatedAt) + 120_000).toISOString();
  const failed: PipelineJob = {
    ...queuedOrd5Job, status: "failed", updatedAt: failedAt, completedAt: failedAt,
    error: "THUMBNAIL_ASSET_GENERATION_FAILED",
  };
  await ProjectWriter.writeJSON(projectSlug, "pipeline-jobs.json", {
    projectSlug, jobs: [failed], createdAt: failed.createdAt, updatedAt: failedAt,
  } satisfies PipelineJobList);
  await writeManifest(projectSlug, topic, runId);
  const hist = await PipelineJobManager.listHistory(projectSlug);
  await ProjectWriter.writeJSON(projectSlug, "pipeline-history.json", {
    projectSlug, events: [...hist.events, {
      id: `${jobId}-failed-${failedAt}`, jobId, stage: STAGE, status: "failed",
      startedAt: failedAt, completedAt: failedAt, jobCreatedAt: failed.createdAt,
      jobUpdatedAt: failedAt, recordedAt: failedAt, errorCode: "THUMBNAIL_ASSET_GENERATION_FAILED",
    }], createdAt: hist.createdAt, updatedAt: failedAt,
  });
}

async function writeManifestWithCode(
  projectSlug: string, topic: string, runId: string, code: string,
) {
  const anchor = "2026-08-28T12:00:00.000Z";
  await ProjectWriter.writeJSON(projectSlug, "manifest.json", {
    schemaVersion: "3", id: `proj-${projectSlug}`, projectSlug, slug: projectSlug, name: projectSlug,
    topic, runId, createdAt: anchor, updatedAt: anchor,
    packages: { [STAGE]: { status: "failed", error: code, updatedAt: anchor } },
  });
  const hist = await PipelineJobManager.listHistory(projectSlug);
  const last = hist.events.at(-1);
  if (last) {
    await ProjectWriter.writeJSON(projectSlug, "pipeline-history.json", {
      projectSlug, events: [...hist.events.slice(0, -1), { ...last, errorCode: code }],
      createdAt: hist.createdAt, updatedAt: hist.updatedAt,
    });
  }
}

async function durableDigest(projectRoot: string, excludePrefixes: string[] = []): Promise<string[]> {
  const out: string[] = [];
  const root = path.join(projectRoot, "production-execution");
  const walk = async (dir: string) => {
    let entries: fsSync.Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (excludePrefixes.some((p) => entry.name.startsWith(p))) continue;
      const rel = path.relative(root, full).replaceAll("\\", "/");
      out.push(`${rel}:${createHash("sha256").update(await fs.readFile(full)).digest("hex")}`);
    }
  };
  await walk(root);
  return out;
}

function filterDigest(digest: string[], excludePrefixes: string[]): string[] {
  return digest.filter((line) => {
    const name = line.split(":")[0].split("/").pop() ?? "";
    return !excludePrefixes.some((p) => name.startsWith(p));
  });
}

async function main() {
  const slug = "smoke-environmental-failure-retry-fixture";
  await withCanonicalSmokeRuntime({
    name: "environmental-failure-retry-extension",
    projectSlug: slug,
    operationType: "smoke-environmental-failure-retry-extension",
  }, async (runtime) => {
    await fs.rm(path.join(runtime.runtimeRoot, "projects", slug), { recursive: true, force: true });
    await ProjectManager.createProject(slug);
    await partA(slug, runtime.runtimeStorageContext);
    await partB(runtime.runtimeStorageContext);

    console.log(`Environmental-failure retry extension smoke: PASS (${passCount} scenarios)`);
    process.stdout.write(`ATOLYE_SMOKE_RESULT ${JSON.stringify({
      status: "PASS", suite: "environmental-failure-retry-extension", scenarios: passCount,
    })}\n`);
  });
}

void main();
