import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { classifyProductionDurableAttemptLineage } from
  "../src/lib/production/ProductionDurableAttemptLineageClassifier";
import { readProductionExecutionRecoverySemanticAuthority } from
  "../src/lib/production/ProductionExecutionRecoveryBootstrap";
import {
  reservationContentFingerprint,
  findMatchingOrphanReservationToleranceAuthority,
  anyDurableRecordReferencesReservationId,
} from "../src/lib/production/ProductionOrphanReservationToleranceAuthority";
import type { ProductionExecutionIdempotencyReservationRequest } from
  "../src/types/productionExecutionIdempotency";

/**
 * READ-ONLY final preflight for the P3-sibling orphan reservation tolerance
 * authority mechanism, against the REAL i-stanbul-un-fethi-1453 project's
 * orphaned reservation (idempotency-identity-c1ca1524). NEVER writes a
 * tolerance authority, NEVER touches the reservation, NEVER calls
 * prepareFailedStageRetry / reconcileFailedPipelineExecution /
 * settleFailedProductionPipelineExecution, NEVER starts a retry. Every call
 * this script makes is either a plain read or runs against a temp fs.cp()
 * COPY of production-execution/ (mirroring this session's proven-safe
 * pattern from scripts/smoke-attempt7-lineage-reopen-verification.ts).
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;
const jobId = `${projectSlug}-${stage}`;
const targetReservationId = "idempotency-identity-c1ca1524";

async function main() {
  console.log("========== 1) fresh job/manifest/history state ==========");
  const job = await PipelineJobManager.getJob(projectSlug, jobId);
  console.log(`job: status=${job?.status} attempts=${job?.attempts} attemptWithinGeneration=${job?.attemptWithinGeneration}`);

  const manifest = await ProjectManager.ensureManifest(projectSlug);
  const packageManifest = manifest?.packages?.[stage];
  console.log(`manifest.packages.assembly: status=${packageManifest?.status} attempts.total=${packageManifest?.attempts?.total}`);

  const rawHistory = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), "data", "projects", projectSlug, "pipeline-history.json"), "utf8"));
  const terminalEvents = rawHistory.events.filter((e: { jobId: string; stage: string }) =>
    e.jobId === jobId && e.stage === stage);
  console.log(`history terminal count (jobId+stage filtered) = ${terminalEvents.length}`);

  console.log("\n========== target reservation: fresh read ==========");
  const root = path.join(process.cwd(), "data", "projects", projectSlug);
  const reservationPath = path.join(root, "production-execution", "reservations", `${targetReservationId}.json`);
  const reservation: ProductionExecutionIdempotencyReservationRequest =
    JSON.parse(fs.readFileSync(reservationPath, "utf8"));
  const contentFingerprint = reservationContentFingerprint(reservation);
  console.log(JSON.stringify({
    reservationId: reservation.identity.identityFingerprint,
    projectSlug: reservation.identity.projectSlug,
    jobId,
    stage: reservation.identity.stage,
    operation: reservation.identity.operation,
    attempt: reservation.attempt,
    requestedAt: reservation.requestedAt,
    reservationContentFingerprint: contentFingerprint,
  }, null, 2));

  console.log("\n========== matching candidates: idempotency / claims / attempts (fresh, full scan) ==========");
  const idempotencyDir = path.join(root, "production-execution", "idempotency");
  const idempotencyFiles = fs.readdirSync(idempotencyDir);
  const matchingIdempotencyCandidates = idempotencyFiles.filter((file) => {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(idempotencyDir, file), "utf8"));
      return rec.identityFingerprint === targetReservationId;
    } catch { return false; }
  });
  console.log(`matching idempotency candidates (identityFingerprint === "${targetReservationId}"): ${matchingIdempotencyCandidates.length}`);

  const claimsDir = path.join(root, "production-execution", "claims");
  const claimFiles = fs.readdirSync(claimsDir);
  const matchingClaims = claimFiles.filter((file) => {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(claimsDir, file), "utf8"));
      return rec.identity?.reservationId === targetReservationId;
    } catch { return false; }
  });
  console.log(`matching claims (identity.reservationId === target): ${matchingClaims.length}`);

  const attemptsDir = path.join(root, "production-execution", "attempts");
  const attemptFiles = fs.readdirSync(attemptsDir);
  const matchingAttempts = attemptFiles.filter((file) => {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(attemptsDir, file), "utf8"));
      return rec.identity?.reservationId === targetReservationId;
    } catch { return false; }
  });
  console.log(`matching attempts/executions (identity.reservationId === target): ${matchingAttempts.length}`);

  const eligible = matchingIdempotencyCandidates.length === 0 &&
    matchingClaims.length === 0 && matchingAttempts.length === 0;
  console.log(`\nEligibility (candidates===0 AND claims===0 AND attempts===0): ${eligible}`);
  if (!eligible) { console.log("NO-GO: reservation is not a proven orphan."); return; }

  console.log("\n========== durable lineage cross-check (temp COPY only) ==========");
  const realDurableRoot = path.join(root, "production-execution");
  let lineageStatus = "skipped";
  {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-orphan-tolerance-final-preflight-"));
    const copyRoot = path.join(tempRoot, "production-execution");
    try {
      await fsp.cp(realDurableRoot, copyRoot, { recursive: true });
      const adapter = new ProductionExecutionFilePersistenceAdapter({
        trustedRootDirectory: copyRoot, createRootDirectory: false,
      });
      const lineage = await classifyProductionDurableAttemptLineage(
        adapter, projectSlug, stage, (job?.attempts ?? 0), "exact");
      lineageStatus = lineage.status;
      console.log(`classifyProductionDurableAttemptLineage(attemptIndex=job.attempts=${job?.attempts}, "exact") -> status=${lineage.status}` +
        (lineage.status === "valid" ? `, maximumRecordAttempt=${lineage.maximumRecordAttempt}` : ""));

      console.log("\n========== existing matching tolerance authority? (there should be none yet) ==========");
      const existingMatch = findMatchingOrphanReservationToleranceAuthority(
        projectSlug, stage, jobId, targetReservationId, reservation.identity.operation, reservation.attempt);
      console.log(`Existing matching tolerance authority: ${existingMatch ? JSON.stringify(existingMatch) : "none"}`);

      console.log("\n========== semantic authority current decision (WITHOUT any tolerance context -- exact real behavior today) ==========");
      const semanticNow = await readProductionExecutionRecoverySemanticAuthority(adapter, new Date().toISOString());
      console.log(`decision=${semanticNow.decision}, activeReservationCount=${semanticNow.activeReservationCount}`);

      console.log("\n========== semantic authority IF a tolerance authority existed (dry evaluation via resolveOrphanReservationTolerance) ==========");
      const claimRef = await anyDurableRecordReferencesReservationId(adapter, "claim", targetReservationId);
      const attemptRef = await anyDurableRecordReferencesReservationId(adapter, "attempt", targetReservationId);
      console.log(`anyDurableRecordReferencesReservationId(claim) = ${claimRef}`);
      console.log(`anyDurableRecordReferencesReservationId(attempt) = ${attemptRef}`);
    } finally {
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  }

  console.log("\n========== 8) expected snapshot / WOULD-CREATE authority body (not written) ==========");
  console.log(JSON.stringify({
    reservationId: targetReservationId,
    projectSlug, jobId, stage, operation: reservation.identity.operation,
    attempt: reservation.attempt,
    reservationContentFingerprint: contentFingerprint,
    matchingIdempotencyCandidates: matchingIdempotencyCandidates.length,
    matchingClaims: matchingClaims.length,
    matchingAttemptsExecutions: matchingAttempts.length,
    currentJobAttempts: job?.attempts, currentJobStatus: job?.status,
    manifestAttemptsTotal: packageManifest?.attempts?.total, manifestStatus: packageManifest?.status,
    historyTerminalCount: terminalEvents.length,
    durableLineageStatus: lineageStatus,
  }, null, 2));
  console.log("\n(No authority was created. No reservation was touched. No retry was started.)");

  console.log("\n========== ALL READ-ONLY CHECKS COMPLETE ==========");
}

void main().catch((error) => {
  console.error("PREFLIGHT ERROR:", error);
  process.exitCode = 1;
});
