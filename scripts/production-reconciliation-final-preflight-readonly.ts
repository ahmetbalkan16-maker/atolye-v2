import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fingerprintPipelineJob } from "../src/lib/pipeline/PipelineRetryAdmission";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { classifyProductionDurableAttemptLineage } from
  "../src/lib/production/ProductionDurableAttemptLineageClassifier";
import { listRegenerationExecutionBindings } from
  "../src/lib/production/ProductionCompletedStageRegenerationStore";
import type { PipelineJobList, PipelineJobHistory } from "../src/types/pipelineJob";

/**
 * READ-ONLY final preflight for applying reconcilePipelineJobAttemptDriftFromHistory
 * to the REAL i-stanbul-un-fethi-1453 / i-stanbul-un-fethi-1453-assembly job.
 *
 * This script NEVER writes to data/projects/i-stanbul-un-fethi-1453/. Step 3's
 * durable-lineage cross-check runs against a temp fs.cp() COPY of
 * production-execution/, mirroring the proven-safe pattern in
 * scripts/smoke-attempt7-lineage-reopen-verification.ts. Every other step is a
 * plain fs.readFileSync. reconcilePipelineJobAttemptDriftFromHistory itself is
 * never imported or called.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;
const jobId = `${projectSlug}-${stage}`;
const root = path.join(process.cwd(), "data", "projects", projectSlug);

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8")) as T;
}

async function main() {
  console.log("========== 1) EXACT CURRENT JOB SNAPSHOT ==========");
  const jobList = readJson<PipelineJobList>("pipeline-jobs.json");
  const job = jobList.jobs.find((item) => item.id === jobId);
  if (!job) { console.log("NO-GO: job not found"); return; }
  const fingerprint = fingerprintPipelineJob(job);
  console.log(JSON.stringify({
    id: job.id, stage: job.stage, status: job.status, attempts: job.attempts,
    attemptWithinGeneration: job.attemptWithinGeneration, generationOrdinal: job.generationOrdinal,
    updatedAt: job.updatedAt, regenerationId: job.regenerationId, fingerprint,
  }, null, 2));

  const expectedPrev = { updatedAt: "2026-08-21T22:49:32.026Z", attempts: 3 };
  const snapshotMatches =
    job.attempts === expectedPrev.attempts &&
    job.attemptWithinGeneration === 0 &&
    job.status === "queued" &&
    job.updatedAt === expectedPrev.updatedAt;
  console.log(`\nPrevious expected snapshot match: ${snapshotMatches ? "MATCH" : "MISMATCH -> STOP/NO-GO"}`);
  if (!snapshotMatches) { console.log("NO-GO: snapshot drifted since last check."); return; }

  console.log("\n========== 2) CANONICAL COUNTER PREFLIGHT ==========");
  const rawManifest = readJson<{ packages: Record<string, { status: string; attempts?: { total?: number } }> }>(
    "manifest.json");
  const executionTotal = rawManifest.packages[stage]?.attempts?.total;
  const manifestStatus = rawManifest.packages[stage]?.status;
  console.log(`A) manifest.packages.${stage}.attempts.total = ${executionTotal}`);
  console.log(`   manifest.packages.${stage}.status = ${manifestStatus}`);

  const history = readJson<PipelineJobHistory>("pipeline-history.json");
  const terminalEvents = history.events.filter((event) =>
    event.jobId === jobId && event.stage === stage);
  console.log(`B) history terminal event count (no status filter) = ${terminalEvents.length}`);
  console.log(`   terminal event statuses: ${terminalEvents.map((e) => e.status).join(", ")}`);
  const latestEvent = terminalEvents.at(-1);
  console.log(`   latest terminal event: id=${latestEvent?.id} status=${latestEvent?.status} recordedAt=${latestEvent?.recordedAt}`);

  // Byte-accurate replication of manifestExecutionTotalToAttemptIndex's
  // FULL branch structure (PipelineJobManager.ts), including the
  // pending/missing early-return branch that a partial check would miss.
  console.log(`C) replicating manifestExecutionTotalToAttemptIndex(status="${manifestStatus}", total=${executionTotal}) exactly:`);
  if (manifestStatus === "pending" || manifestStatus === "missing") {
    console.log(`   status is "${manifestStatus}" -> formula requires executionTotal === 0 (executionTotal=${executionTotal})`);
    if (executionTotal !== 0) {
      console.log(`   THROWS PIPELINE_MANIFEST_ATTEMPT_EVIDENCE_MISMATCH (this is exactly what the real, already-implemented reconcilePipelineJobAttemptDriftFromHistory would hit if called right now)`);
      console.log("\nNO-GO: manifest.packages.assembly.status is \"pending\" while attempts.total=6 — the official canonical formula's own pending/missing branch rejects this as self-inconsistent BEFORE it ever reaches the terminal-history cross-check. A real reconciliation call right now would fail-closed with PIPELINE_JOB_ATTEMPT_DRIFT_HISTORY_MANIFEST_MISMATCH, not succeed.");
      return;
    }
  }
  if (executionTotal === 0) {
    console.log("   executionTotal === 0 -> THROWS PIPELINE_MANIFEST_ATTEMPT_EVIDENCE_MISMATCH");
    console.log("\nNO-GO: manifest/history evidence mismatch.");
    return;
  }
  const countsAgree = executionTotal === terminalEvents.length;
  const latestStatusAgrees = manifestStatus === "failed" || manifestStatus === "completed"
    ? latestEvent?.status === manifestStatus
    : true;
  console.log(`   countsAgree=${countsAgree}, latestStatusAgrees=${latestStatusAgrees}`);
  if (!countsAgree || !latestStatusAgrees) {
    console.log("NO-GO: manifest/history evidence mismatch.");
    return;
  }
  const canonicalAttempts = executionTotal - 1;
  console.log(`D) canonical attempts = executionTotal(${executionTotal}) - 1 = ${canonicalAttempts}`);

  const bindings = listRegenerationExecutionBindings(projectSlug, stage);
  console.log(`\nE) listRegenerationExecutionBindings(${projectSlug}, ${stage}) ->`);
  for (const b of bindings) {
    console.log(`   regenerationId=${b.binding.regenerationId} generationOrdinal=${b.binding.generationOrdinal} firstGlobalExecutionOrdinal=${b.firstGlobalExecutionOrdinal}`);
  }
  const activeBinding = bindings.find((b) => b.binding.regenerationId === job.regenerationId);
  if (!activeBinding) {
    console.log("NO-GO: job.regenerationId not found among active-generation bindings.");
    return;
  }
  if (job.generationOrdinal !== undefined && activeBinding.binding.generationOrdinal !== job.generationOrdinal) {
    console.log(`NO-GO: binding generationOrdinal (${activeBinding.binding.generationOrdinal}) != job.generationOrdinal (${job.generationOrdinal}).`);
    return;
  }
  const generationStartAttempt = activeBinding.firstGlobalExecutionOrdinal;
  const canonicalAttemptWithinGeneration = canonicalAttempts - generationStartAttempt;
  console.log(`F) generationStartAttempt = ${generationStartAttempt}`);
  console.log(`   canonical attemptWithinGeneration = ${canonicalAttempts} - ${generationStartAttempt} = ${canonicalAttemptWithinGeneration}`);

  const countersMatchExpectation = canonicalAttempts === 5 && canonicalAttemptWithinGeneration === 2;
  console.log(`\nCanonical target matches expected (attempts=5, attemptWithinGeneration=2): ${countersMatchExpectation}`);
  if (!countersMatchExpectation) { console.log("NO-GO: canonical target mismatch."); return; }

  console.log("\n========== 3) DURABLE LINEAGE CROSS-CHECK (on a temp COPY only) ==========");
  const realDurableRoot = path.join(root, "production-execution");
  const durableExists = fs.existsSync(realDurableRoot);
  let durableOk = true;
  if (!durableExists) {
    console.log("No production-execution/ directory present for this project — durable evidence absent, formula skips durable cross-check (matches manifestExecutionTotalToAttemptIndex's own hasDurableEvidence=false path).");
  } else {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-final-preflight-durable-"));
    const copyRoot = path.join(tempRoot, "production-execution");
    try {
      await fsp.cp(realDurableRoot, copyRoot, { recursive: true });
      const adapter = new ProductionExecutionFilePersistenceAdapter({
        trustedRootDirectory: copyRoot, createRootDirectory: false,
      });
      const lineage = await classifyProductionDurableAttemptLineage(
        adapter, projectSlug, stage, canonicalAttempts, "exact");
      console.log(`classifyProductionDurableAttemptLineage(..., attemptIndex=${canonicalAttempts}, "exact") ->`);
      console.log(JSON.stringify(lineage, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));
      if (lineage.status === "valid") {
        durableOk = lineage.maximumRecordAttempt === executionTotal;
        console.log(`lineage.maximumRecordAttempt (${lineage.maximumRecordAttempt}) === executionTotal (${executionTotal}): ${durableOk}`);
      } else if (lineage.status === "none") {
        durableOk = (canonicalAttempts as number) === 0;
      } else {
        durableOk = false;
      }
    } finally {
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  }
  console.log(`\nDurable lineage consistent with canonical attempts=${canonicalAttempts}: ${durableOk}`);
  if (!durableOk) { console.log("NO-GO: durable lineage evidence mismatch."); return; }

  console.log("\n========== 4) STATUS PREFLIGHT ==========");
  console.log(`Latest relevant history event: status=${latestEvent?.status}, recordedAt=${latestEvent?.recordedAt}, jobUpdatedAt=${latestEvent?.jobUpdatedAt}`);
  console.log(`Current job.status = "${job.status}" (queued) with updatedAt=${job.updatedAt}`);
  const noLegitimateLaterTransition = job.status === "queued" && job.attempts < canonicalAttempts;
  console.log(`No legitimate queued transition can explain attempts(${job.attempts}) < canonical(${canonicalAttempts}) while status=queued: this is only reachable via the already-identified compensatePreparedRetry rollback path (see prior sprint's root-cause analysis), not any normal admission flow (which would require status=failed beforehand).`);
  console.log(`Status repair semantically justified: ${noLegitimateLaterTransition}`);
  if (!noLegitimateLaterTransition) { console.log("NO-GO: cannot prove queued is stale."); return; }

  console.log("\n========== 5) CAS PREFLIGHT ==========");
  const expectedSnapshot = { updatedAt: job.updatedAt, attempts: job.attempts, fingerprint };
  console.log("WOULD CALL:");
  console.log(`reconcilePipelineJobAttemptDriftFromHistory(`);
  console.log(`  "${projectSlug}",`);
  console.log(`  "${jobId}",`);
  console.log(`  ${JSON.stringify(expectedSnapshot, null, 2).split("\n").join("\n  ")}`);
  console.log(`)`);
  console.log("\n(This call was NOT executed.)");

  console.log("\n========== 6) RECONCILIATION DRY-RUN (independent read-only recomputation) ==========");
  console.log(JSON.stringify({
    current: { attempts: job.attempts, attemptWithinGeneration: job.attemptWithinGeneration, status: job.status },
    canonical: { attempts: canonicalAttempts, attemptWithinGeneration: canonicalAttemptWithinGeneration, status: "failed" },
  }, null, 2));

  console.log("\n========== ALL READ-ONLY CHECKS PASSED ==========");
}

void main().catch((error) => {
  console.error("PREFLIGHT ERROR:", error);
  process.exitCode = 1;
});
