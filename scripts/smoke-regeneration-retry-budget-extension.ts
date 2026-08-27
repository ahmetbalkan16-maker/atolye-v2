import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emitSmokeResult } from "./lib/SmokeResult";
import {
  buildProductionPipelineRegenerationRetryBudgetExtensionBody,
  buildProductionPipelineRegenerationRetryBudgetExtensionReceipt,
  findMatchingRegenerationRetryBudgetExtension,
  readRegenerationRetryBudgetExtensionAuthority,
  regenerationRetryBudgetExtensionPolicyVersion,
  regenerationRetryBudgetExtensionSchemaVersion,
  validateRegenerationRetryBudgetExtensionBody,
  writeRegenerationRetryBudgetExtensionAuthority,
  writeRegenerationRetryBudgetExtensionReceipt,
} from "../src/lib/production/ProductionPipelineRegenerationRetryBudgetExtension";
import {
  assertCanonicalPipelineRetryAdmission,
  freezePipelineRetryAdmission,
  type PipelineRetryAdmission,
} from "../src/lib/pipeline/PipelineRetryAdmission";
import { buildProductionPipelineExecutionIdentity } from
  "../src/lib/production/ProductionPipelineExecutionIdentity";
import { buildProductionPipelineRetryAdmissionBinding } from
  "../src/lib/production/ProductionPipelineRetryAdmissionBinding";
import { fingerprintPipelineJob } from "../src/lib/pipeline/PipelineRetryAdmission";
import type { PipelineJob } from "../src/types/pipelineJob";

/**
 * P3 smoke: the regeneration-retry-budget-extension mechanism added to
 * PipelineFailedStageRetry.ts / PipelineRetryAdmission.ts as a narrow,
 * separate sibling of the existing (unmodified) ordinal-4 extension.
 *
 * Two isolated layers are tested:
 *   A) ProductionPipelineRegenerationRetryBudgetExtension.ts's store —
 *      write/read/validate/single-use, entirely via explicit
 *      { workspaceRoot } inputs, no environment mutation.
 *   B) PipelineRetryAdmission.assertCanonicalPipelineRetryAdmission's new
 *      isRegenerationOrdinalExtension branch — this function resolves
 *      regenerationBindingForExecution() internally with no context
 *      override, so this half uses an isolated ATOLYE_WORKSPACE_ROOT
 *      (restored in `finally`) with a hand-written pipeline-lineage
 *      regeneration intent, never touching real project data.
 *
 * A full end-to-end prepareFailedStageRetry(...) integration run (job
 * genuinely "failed" -> extension found -> retry admitted at ordinal 7) is
 * NOT built here — that requires replicating the full acceptance/durable-
 * execution harness the existing ordinal-4 mechanism's own dedicated smoke
 * suite (smoke-sprint-129-36-retry-budget-extension.ts, ~1700 lines) uses.
 * Flagged as follow-up scope, not attempted this turn.
 */

const projectSlug = "regen-extension-smoke-project";
const stage = "assembly" as const;
let scenarios = 0;

async function scenario(name: string, action: () => Promise<void> | void): Promise<void> {
  await action();
  scenarios += 1;
  process.stdout.write(`PASS ${scenarios}: ${name}\n`);
}

function priorJob(overrides: Partial<{
  attempts: number; attemptWithinGeneration: number; updatedAt: string; fingerprint: string;
}> = {}) {
  return {
    id: `${projectSlug}-${stage}`, status: "failed" as const,
    attempts: overrides.attempts ?? 5, attemptWithinGeneration: overrides.attemptWithinGeneration ?? 2,
    updatedAt: overrides.updatedAt ?? "2026-08-22T00:00:00.000Z",
    fingerprint: overrides.fingerprint ?? "fingerprint-placeholder",
  };
}

function authorityBody(overrides: Partial<{
  authorityId: string; regenerationId: string; generationOrdinal: number;
  currentDurableOrdinal: number; authorizedDurableOrdinal: number;
  jobAttempts: number;
}> = {}) {
  return buildProductionPipelineRegenerationRetryBudgetExtensionBody({
    schemaVersion: regenerationRetryBudgetExtensionSchemaVersion,
    policyVersion: regenerationRetryBudgetExtensionPolicyVersion,
    authorityId: overrides.authorityId ?? "regen-auth-1",
    issuedAt: "2026-08-22T00:00:00.000Z",
    projectSlug, stage, jobId: `${projectSlug}-${stage}`,
    regenerationId: overrides.regenerationId ?? "pipeline-regen-smoke-000000000000000000000000000000000000000000",
    generationOrdinal: overrides.generationOrdinal ?? 2,
    currentDurableOrdinal: overrides.currentDurableOrdinal ?? 5,
    authorizedDurableOrdinal: overrides.authorizedDurableOrdinal ?? 6,
    reason: "operator-approved-reopen-orphaned-attempt",
    priorJob: priorJob({ attempts: overrides.jobAttempts ?? 5 }),
  });
}

async function main() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-regen-extension-"));
  try {
    // ═══════════════════════ Part A: store layer ═══════════════════════
    const storeInput = { workspaceRoot: tempRoot };

    await scenario("a well-formed authority validates and round-trips through write/read", async () => {
      const body = authorityBody();
      assert.equal(validateRegenerationRetryBudgetExtensionBody(body), true);
      const written = writeRegenerationRetryBudgetExtensionAuthority(projectSlug, body, storeInput);
      assert.equal(written.ok, true);
      assert.equal(written.status, "created");
      const read = readRegenerationRetryBudgetExtensionAuthority(projectSlug, body.authorityId, storeInput);
      assert.equal(read.ok, true);
      assert.deepEqual(read.value, body);
    });

    await scenario("writing the same authority twice replays write-free instead of conflicting", async () => {
      const body = authorityBody({ authorityId: "regen-auth-replay" });
      const first = writeRegenerationRetryBudgetExtensionAuthority(projectSlug, body, storeInput);
      assert.equal(first.status, "created");
      const second = writeRegenerationRetryBudgetExtensionAuthority(projectSlug, body, storeInput);
      assert.equal(second.ok, true);
      assert.equal(second.status, "replayed");
      assert.equal(second.writeFree, true);
    });

    await scenario("authorizedDurableOrdinal must be exactly currentDurableOrdinal+1 — never a skip", () => {
      const skip = authorityBody({ authorityId: "regen-auth-skip",
        currentDurableOrdinal: 5, authorizedDurableOrdinal: 8 });
      assert.equal(validateRegenerationRetryBudgetExtensionBody(skip), false);
      const wrote = writeRegenerationRetryBudgetExtensionAuthority(projectSlug, skip, storeInput);
      assert.equal(wrote.ok, false);
      assert.equal(wrote.reasonCode, "PIPELINE_REGENERATION_RETRY_BUDGET_EXTENSION_INTEGRITY_MISMATCH");
    });

    await scenario("a tampered authority (integrity fingerprint mismatch) fails validation", () => {
      const body = authorityBody({ authorityId: "regen-auth-tamper" });
      const tampered = { ...body, authorizedDurableOrdinal: 7 };
      assert.equal(validateRegenerationRetryBudgetExtensionBody(tampered), false);
    });

    await scenario("findMatchingRegenerationRetryBudgetExtension matches only the exact tuple", async () => {
      const target = authorityBody({ authorityId: "regen-auth-match-target",
        regenerationId: "pipeline-regen-match-target", generationOrdinal: 2,
        currentDurableOrdinal: 5, authorizedDurableOrdinal: 6, jobAttempts: 5 });
      const decoy = authorityBody({ authorityId: "regen-auth-match-decoy",
        regenerationId: "pipeline-regen-match-decoy", generationOrdinal: 2,
        currentDurableOrdinal: 5, authorizedDurableOrdinal: 6, jobAttempts: 5 });
      writeRegenerationRetryBudgetExtensionAuthority(projectSlug, target, storeInput);
      writeRegenerationRetryBudgetExtensionAuthority(projectSlug, decoy, storeInput);
      const job: PipelineJob = {
        id: `${projectSlug}-${stage}`, projectSlug, stage, title: "Video Editing",
        status: "failed", attempts: 5, createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z",
        regenerationId: "pipeline-regen-match-target", generationOrdinal: 2, attemptWithinGeneration: 2,
      };
      const found = findMatchingRegenerationRetryBudgetExtension(
        projectSlug, stage, job, 6, storeInput,
      );
      assert.ok(found);
      assert.equal(found?.authorityId, "regen-auth-match-target");
    });

    await scenario("findMatchingRegenerationRetryBudgetExtension ignores a wrong admittedDurableOrdinal", () => {
      const body = authorityBody({ authorityId: "regen-auth-wrong-ordinal",
        regenerationId: "pipeline-regen-wrong-ordinal" });
      writeRegenerationRetryBudgetExtensionAuthority(projectSlug, body, storeInput);
      const job: PipelineJob = {
        id: `${projectSlug}-${stage}`, projectSlug, stage, title: "Video Editing",
        status: "failed", attempts: 5, createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z",
        regenerationId: "pipeline-regen-wrong-ordinal", generationOrdinal: 2, attemptWithinGeneration: 2,
      };
      // Authority authorizes ordinal 6; asking for 7 must not match.
      const found = findMatchingRegenerationRetryBudgetExtension(
        projectSlug, stage, job, 7, storeInput,
      );
      assert.equal(found, undefined);
    });

    await scenario("a consumed authority is no longer matched — single-use enforced", async () => {
      const body = authorityBody({ authorityId: "regen-auth-consumed",
        regenerationId: "pipeline-regen-consumed" });
      writeRegenerationRetryBudgetExtensionAuthority(projectSlug, body, storeInput);
      const job: PipelineJob = {
        id: `${projectSlug}-${stage}`, projectSlug, stage, title: "Video Editing",
        status: "failed", attempts: 5, createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z",
        regenerationId: "pipeline-regen-consumed", generationOrdinal: 2, attemptWithinGeneration: 2,
      };
      assert.ok(findMatchingRegenerationRetryBudgetExtension(projectSlug, stage, job, 6, storeInput));
      const receipt = buildProductionPipelineRegenerationRetryBudgetExtensionReceipt(
        body.authorityId, "consumed", "2026-08-22T00:01:00.000Z",
        "2026-08-22T00:01:00.000Z", ["test:consumed"],
      );
      const written = writeRegenerationRetryBudgetExtensionReceipt(projectSlug, receipt, storeInput);
      assert.equal(written.ok, true);
      const foundAfter = findMatchingRegenerationRetryBudgetExtension(projectSlug, stage, job, 6, storeInput);
      assert.equal(foundAfter, undefined);
    });

    await scenario("an aborted authority is no longer matched either", async () => {
      const body = authorityBody({ authorityId: "regen-auth-aborted",
        regenerationId: "pipeline-regen-aborted" });
      writeRegenerationRetryBudgetExtensionAuthority(projectSlug, body, storeInput);
      const receipt = buildProductionPipelineRegenerationRetryBudgetExtensionReceipt(
        body.authorityId, "aborted", "2026-08-22T00:01:00.000Z",
        "2026-08-22T00:01:00.000Z", ["test:aborted"],
      );
      writeRegenerationRetryBudgetExtensionReceipt(projectSlug, receipt, storeInput);
      const job: PipelineJob = {
        id: `${projectSlug}-${stage}`, projectSlug, stage, title: "Video Editing",
        status: "failed", attempts: 5, createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z",
        regenerationId: "pipeline-regen-aborted", generationOrdinal: 2, attemptWithinGeneration: 2,
      };
      const found = findMatchingRegenerationRetryBudgetExtension(projectSlug, stage, job, 6, storeInput);
      assert.equal(found, undefined);
    });

    await scenario("the authority/receipt filename prefixes never collide with the ordinal-4 mechanism", async () => {
      const dir = path.join(tempRoot, "data", "projects", projectSlug,
        "production-execution", "retry-budget-extensions");
      const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      assert.ok(files.length > 0);
      for (const file of files) {
        assert.ok(file.startsWith("regen-authority-") || file.startsWith("regen-receipt-"),
          `unexpected file outside the regen- prefix: ${file}`);
      }
    });

    // ═════════════ Part B: assertCanonicalPipelineRetryAdmission ═════════════
    const isolatedRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-regen-admission-"));
    const savedEnv = process.env.ATOLYE_WORKSPACE_ROOT;
    try {
      process.env.ATOLYE_WORKSPACE_ROOT = isolatedRoot;
      const regenerationId = "pipeline-regen-" + "0".repeat(48);
      const admissionProjectSlug = "regen-admission-smoke-project";
      const admissionStage = "assembly" as const;
      const jobId = `${admissionProjectSlug}-${admissionStage}`;

      // Minimal hand-written pipeline-lineage intent — enough for
      // regenerationBindingForExecution()'s read (readJson does no schema
      // validation beyond JSON.parse at this layer; validation happens when
      // an intent is actually consumed to prepare a regeneration, not here).
      const intentDir = path.join(isolatedRoot, "data", "projects", admissionProjectSlug,
        "pipeline-regeneration", "regenerations", regenerationId);
      fs.mkdirSync(intentDir, { recursive: true });
      const jobsPostState = {
        jobs: [{ stage: admissionStage, attempts: 3 }],
      };
      const intent = {
        schemaVersion: "pipeline-regeneration-v1",
        regenerationId, projectSlug: admissionProjectSlug, projectId: "smoke-project-id",
        fromStage: "assembly", generationOrdinal: 2, planFingerprint: "plan-fingerprint-smoke",
        reasonCode: "operator-approved", backupId: "backup-smoke",
        backupManifestFingerprint: "backup-manifest-smoke",
        exactPrestateFingerprint: "prestate-smoke",
        preservedStages: [], affectedStages: ["assembly", "thumbnail", "seo", "youtube", "export"],
        createdAt: "2026-08-22T00:00:00.000Z",
        mutations: [{
          relativePath: "pipeline-jobs.json", preSha256: null,
          postSha256: "post-sha-smoke",
          postBase64: Buffer.from(JSON.stringify(jobsPostState), "utf8").toString("base64"),
          writeOnce: true,
        }],
      };
      fs.writeFileSync(path.join(intentDir, "intent.json"), JSON.stringify(intent, null, 2) + "\n");

      function buildAdmission(input: {
        priorAttempts: number; priorAWG: number;
        admittedAttempts: number; admittedAWG: number;
        maxAttempts: number; extension: boolean;
      }): { admission: PipelineRetryAdmission; previousJob: PipelineJob; currentJob: PipelineJob } {
        const previousJob: PipelineJob = {
          id: jobId, projectSlug: admissionProjectSlug, stage: admissionStage, title: "Video Editing",
          status: "failed", attempts: input.priorAttempts,
          createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-22T00:00:00.000Z",
          regenerationId, generationOrdinal: 2, attemptWithinGeneration: input.priorAWG,
        };
        const currentJob: PipelineJob = {
          ...previousJob, status: "queued", attempts: input.admittedAttempts,
          updatedAt: "2026-08-22T00:01:00.000Z", startedAt: undefined, completedAt: undefined,
          cancelRequestedAt: undefined, error: undefined, errorEvidence: undefined,
          attemptWithinGeneration: input.admittedAWG,
          globalExecutionOrdinal: input.admittedAttempts,
        };
        const regeneration = { regenerationId, generationOrdinal: 2, planFingerprint: "plan-fingerprint-smoke",
          fromStage: "assembly" as const, reasonCode: "operator-approved" };
        const exactIdentity = buildProductionPipelineExecutionIdentity(
          { projectSlug: admissionProjectSlug, stage: admissionStage, runType: "resume", regeneration },
          previousJob,
        );
        const admittedIdentity = buildProductionPipelineExecutionIdentity(
          { projectSlug: admissionProjectSlug, stage: admissionStage, runType: "resume", regeneration },
          currentJob,
        );
        const admittedBinding = buildProductionPipelineRetryAdmissionBinding(
          { projectSlug: admissionProjectSlug, stage: admissionStage, runType: "resume", regeneration },
          currentJob,
        );
        const preMutationJobFingerprint = fingerprintPipelineJob(previousJob);
        const admittedJobFingerprint = fingerprintPipelineJob(currentJob);
        const admission = freezePipelineRetryAdmission({
          projectSlug: admissionProjectSlug, stage: admissionStage, jobId, runType: "resume",
          priorJobAttemptIndex: input.priorAttempts, currentDurableOrdinal: input.priorAttempts + 1,
          admittedJobAttemptIndex: input.admittedAttempts, admittedDurableOrdinal: input.admittedAttempts + 1,
          maxAttempts: input.maxAttempts,
          ...(input.extension ? {
            baseMaxAttempts: input.priorAttempts - input.priorAWG + 3,
            effectiveMaxAttempts: input.admittedAttempts + 1,
            authorizedDurableOrdinal: input.admittedAttempts + 1,
            retryBudgetAuthorityProof: {
              authorityId: "regen-auth-admission-smoke",
              authorityIntegrityFingerprint: "authority-fp-smoke",
              consumptionReceiptFingerprint: "receipt-fp-smoke",
              authoritySchemaVersion: "1",
            },
          } : {}),
          exactReconciledDurableLineageIdentity: exactIdentity,
          exactReconciledLineageBinding: {
            state: "terminal", operation: "pipeline.stage.resume",
            durableOrdinal: input.priorAttempts, maxAttempts: input.maxAttempts,
            reservationId: "reservation-smoke", workerId: "worker-smoke", workerSessionId: "session-smoke",
            recordVersion: 1, reservationVersion: 1, claimVersion: 1, attemptVersion: 1, leaseVersion: 1,
            reservationIdentityFingerprint: "reservation-fp-smoke", recordIntegrityFingerprint: "record-fp-smoke",
            recordIntegrityVersion: 1, leaseIntegrityFingerprint: "lease-fp-smoke",
            claimIntegrityFingerprint: "claim-fp-smoke", attemptIntegrityFingerprint: "attempt-fp-smoke",
          },
          admittedDurableLineageIdentity: admittedIdentity,
          admittedExecutionBinding: admittedBinding,
          priorJobStatus: "failed", preMutationJobFingerprint,
          preMutationJobVersion: previousJob.updatedAt,
          admittedJobStatus: "queued", admittedJobFingerprint,
          admittedJobVersion: currentJob.updatedAt,
        });
        return { admission, previousJob, currentJob };
      }

      await scenario("a well-formed regeneration-extension admission at ordinal 7-equivalent is accepted", () => {
        // generationStartAttempt = priorAttempts - priorAWG = 5 - 2 = 3;
        // generationMaxAttempts = 3 + 3 = 6 — admittedDurableOrdinal (7)
        // exceeds it, which is exactly what the extension must clear.
        const { admission, previousJob, currentJob } = buildAdmission({
          priorAttempts: 5, priorAWG: 2, admittedAttempts: 6, admittedAWG: 3,
          maxAttempts: 7, extension: true,
        });
        assertCanonicalPipelineRetryAdmission({
          admission, previousJob, currentJob,
          projectSlug: admissionProjectSlug, stage: admissionStage, runType: "resume",
        });
      });

      await scenario("the same admission without the ordinal-4 mechanism's fields untouched stays rejected unextended", () => {
        // Same ordinals, but no extension proof at all — must still be
        // rejected by the ordinary generationMaxAttempts(6) ceiling. Proves
        // the new branch never silently widens the budget by itself.
        const { admission, previousJob, currentJob } = buildAdmission({
          priorAttempts: 5, priorAWG: 2, admittedAttempts: 6, admittedAWG: 3,
          maxAttempts: 6, extension: false,
        });
        assert.throws(() => assertCanonicalPipelineRetryAdmission({
          admission, previousJob, currentJob,
          projectSlug: admissionProjectSlug, stage: admissionStage, runType: "resume",
        }), /PIPELINE_RETRY_EXECUTION_ADMISSION_FAILED/);
      });

      await scenario("an extension-flagged admission for an ordinal still within the ordinary budget is rejected", () => {
        // isRegenerationOrdinalExtension requires
        // effectiveMaxAttempts === admittedDurableOrdinal; a claimed
        // extension whose numbers actually describe an ordinary
        // (unexceeded) retry doesn't satisfy that shape, so it falls back
        // to the plain generationMaxAttempts check and must still pass
        // ONLY if consistent — here maxAttempts is deliberately wrong to
        // prove the mismatch is caught.
        const { admission, previousJob, currentJob } = buildAdmission({
          priorAttempts: 2, priorAWG: 0, admittedAttempts: 3, admittedAWG: 1,
          maxAttempts: 99, extension: true,
        });
        assert.throws(() => assertCanonicalPipelineRetryAdmission({
          admission, previousJob, currentJob,
          projectSlug: admissionProjectSlug, stage: admissionStage, runType: "resume",
        }), /PIPELINE_RETRY_EXECUTION_ADMISSION_FAILED/);
      });
    } finally {
      if (savedEnv === undefined) delete process.env.ATOLYE_WORKSPACE_ROOT;
      else process.env.ATOLYE_WORKSPACE_ROOT = savedEnv;
      await fsp.rm(isolatedRoot, { recursive: true, force: true });
    }

    assert.ok(scenarios >= 11);
    process.stdout.write(`Regeneration retry budget extension smoke: PASS (${scenarios} scenarios)\n`);
    emitSmokeResult("regeneration-retry-budget-extension", scenarios);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
