import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { classifyProductionDurableAttemptLineage } from
  "../src/lib/production/ProductionDurableAttemptLineageClassifier";
import { readProductionExecutionRecoverySemanticAuthority,
  type ProductionOrphanReservationToleranceLookupContext } from
  "../src/lib/production/ProductionExecutionRecoveryBootstrap";
import {
  buildProductionOrphanReservationToleranceAuthorityBody,
  writeProductionOrphanReservationToleranceAuthority,
  readProductionOrphanReservationToleranceAuthority,
  validateProductionOrphanReservationToleranceAuthorityBody,
  reservationContentFingerprint,
  findMatchingOrphanReservationToleranceAuthority,
  anyDurableRecordReferencesReservationId,
} from "../src/lib/production/ProductionOrphanReservationToleranceAuthority";
import type { ProductionExecutionIdempotencyReservationRequest } from
  "../src/types/productionExecutionIdempotency";

/**
 * APPROVED, ONE-TIME production apply: creates a P3-sibling orphan
 * reservation tolerance authority for
 * data/projects/i-stanbul-un-fethi-1453's
 * production-execution/reservations/idempotency-identity-c1ca1524.json,
 * which has no linked idempotency record, no claim, and no attempt (see
 * this session's root-cause and design reports). This does NOT touch the
 * reservation itself, does NOT run a retry, and does NOT call
 * prepareFailedStageRetry / reconcileFailedPipelineExecution /
 * settleFailedProductionPipelineExecution -- it only publishes one new,
 * narrowly-scoped authority file under
 * production-execution/orphan-reservation-tolerances/, then verifies
 * (read-only) that readProductionExecutionRecoverySemanticAuthority now
 * reports "ready" when given the matching tolerance context.
 *
 * Every eligibility check is re-verified fresh against real disk state
 * immediately before the write -- nothing is trusted from an earlier
 * preflight run.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;
const jobId = `${projectSlug}-${stage}`;
const targetReservationId = "idempotency-identity-c1ca1524";
const root = path.join(process.cwd(), "data", "projects", projectSlug);

async function main() {
  console.log("========== pre-apply fresh eligibility re-verification ==========");

  const reservationPath = path.join(root, "production-execution", "reservations", `${targetReservationId}.json`);
  const reservation: ProductionExecutionIdempotencyReservationRequest =
    JSON.parse(fs.readFileSync(reservationPath, "utf8"));
  if (reservation.identity.identityFingerprint !== targetReservationId ||
    reservation.identity.projectSlug !== projectSlug || reservation.identity.stage !== stage) {
    console.error("ABORT: reservation identity does not match the expected tuple.");
    process.exitCode = 1;
    return;
  }
  console.log(`reservation: operation=${reservation.identity.operation} attempt=${reservation.attempt}`);

  const idempotencyDir = path.join(root, "production-execution", "idempotency");
  const matchingIdempotency = fs.readdirSync(idempotencyDir).filter((file) => {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(idempotencyDir, file), "utf8"));
      return rec.identityFingerprint === targetReservationId;
    } catch { return false; }
  });
  const claimsDir = path.join(root, "production-execution", "claims");
  const matchingClaims = fs.readdirSync(claimsDir).filter((file) => {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(claimsDir, file), "utf8"));
      return rec.identity?.reservationId === targetReservationId;
    } catch { return false; }
  });
  const attemptsDir = path.join(root, "production-execution", "attempts");
  const matchingAttempts = fs.readdirSync(attemptsDir).filter((file) => {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(attemptsDir, file), "utf8"));
      return rec.identity?.reservationId === targetReservationId;
    } catch { return false; }
  });
  console.log(`matching idempotency=${matchingIdempotency.length}, claims=${matchingClaims.length}, attempts=${matchingAttempts.length}`);
  if (matchingIdempotency.length !== 0 || matchingClaims.length !== 0 || matchingAttempts.length !== 0) {
    console.error("ABORT: reservation is not a proven orphan (fresh re-check found a linked/claimed/attempted record).");
    process.exitCode = 1;
    return;
  }

  const job = await PipelineJobManager.getJob(projectSlug, jobId);
  if (!job) { console.error("ABORT: job not found."); process.exitCode = 1; return; }

  const realDurableRoot = path.join(root, "production-execution");
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-orphan-tolerance-apply-"));
  const copyRoot = path.join(tempRoot, "production-execution");
  let lineageOk = false;
  try {
    await fsp.cp(realDurableRoot, copyRoot, { recursive: true });
    const copyAdapter = new ProductionExecutionFilePersistenceAdapter({
      trustedRootDirectory: copyRoot, createRootDirectory: false,
    });
    const lineage = await classifyProductionDurableAttemptLineage(
      copyAdapter, projectSlug, stage, job.attempts, "exact");
    lineageOk = lineage.status === "valid";
    console.log(`durable lineage (temp copy): status=${lineage.status}` +
      (lineage.status === "valid" ? `, maximumRecordAttempt=${lineage.maximumRecordAttempt}` : ""));
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
  if (!lineageOk) {
    console.error("ABORT: durable lineage is not valid.");
    process.exitCode = 1;
    return;
  }

  const existingMatch = findMatchingOrphanReservationToleranceAuthority(
    projectSlug, stage, jobId, targetReservationId, reservation.identity.operation, reservation.attempt);
  if (existingMatch) {
    console.log("A matching, unconsumed authority already exists -- nothing to create:",
      JSON.stringify(existingMatch));
  } else {
    console.log("\nAll pre-apply checks passed. Proceeding with the single approved write.");

    console.log("\n========== APPLY: writeProductionOrphanReservationToleranceAuthority ==========");
    const authorityId = `orphan-tol-c1ca1524-${projectSlug}`;
    const body = buildProductionOrphanReservationToleranceAuthorityBody({
      schemaVersion: "1", policyVersion: "orphan-reservation-tolerance-v1",
      authorityId, issuedAt: new Date().toISOString(),
      projectSlug, stage, jobId,
      reservationId: targetReservationId,
      operation: reservation.identity.operation,
      attempt: reservation.attempt,
      reason: "Orphan reservation tolerance: no idempotency record was ever created for this " +
        "reservation (crash between AdapterBackedProductionExecutionDurableStorage.createReservation() " +
        "and .createRecord() inside prepareProductionPipelineExecution -- see this session's root-cause " +
        "report), leaving it permanently classified 'active' by loadReservationAuthority. Fresh re-scan " +
        "at apply time confirmed zero matching idempotency records, zero matching claims, zero matching " +
        "attempts, and valid durable lineage for the current job state.",
      reservationContentFingerprint: reservationContentFingerprint(reservation),
    });

    if (!validateProductionOrphanReservationToleranceAuthorityBody(body)) {
      console.error("ABORT: locally-built authority body failed its own schema validation before write.");
      process.exitCode = 1;
      return;
    }

    const writeResult = writeProductionOrphanReservationToleranceAuthority(projectSlug, body);
    console.log("WRITE RESULT:", JSON.stringify(writeResult, null, 2));
    if (!writeResult.ok) {
      console.error(`ABORT: write refused (${writeResult.reasonCode}).`);
      process.exitCode = 1;
      return;
    }

    const readback = readProductionOrphanReservationToleranceAuthority(projectSlug, authorityId);
    console.log("\nREADBACK:", JSON.stringify(readback, null, 2));
    const readbackValid = readback.ok && readback.value &&
      validateProductionOrphanReservationToleranceAuthorityBody(readback.value) &&
      readback.value.reservationId === targetReservationId &&
      readback.value.projectSlug === projectSlug && readback.value.stage === stage &&
      readback.value.jobId === jobId;
    console.log(`Readback fully re-validated: ${readbackValid}`);
    if (!readbackValid) {
      console.error("ABORT: readback did not re-validate cleanly.");
      process.exitCode = 1;
      return;
    }
  }

  console.log("\n========== post-apply: semantic authority verification (real store, read-only) ==========");
  const realAdapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: realDurableRoot, createRootDirectory: false,
  });
  const toleranceContext: ProductionOrphanReservationToleranceLookupContext = {
    projectSlug, stage, jobId,
  };
  const semantic = await readProductionExecutionRecoverySemanticAuthority(
    realAdapter, new Date().toISOString(), undefined, toleranceContext);
  console.log(`decision=${semantic.decision}, activeReservationCount=${semantic.activeReservationCount}`);

  const claimRef = await anyDurableRecordReferencesReservationId(realAdapter, "claim", targetReservationId);
  const attemptRef = await anyDurableRecordReferencesReservationId(realAdapter, "attempt", targetReservationId);
  console.log(`(sanity, unchanged) claim reference exists: ${claimRef}, attempt reference exists: ${attemptRef}`);

  console.log(`\nFINAL STATUS: ${semantic.decision === "ready" ? "APPLIED" : "APPLIED_BUT_NOT_READY"}`);
}

void main().catch((error) => {
  console.error("APPLY ERROR:", error);
  process.exitCode = 1;
});
