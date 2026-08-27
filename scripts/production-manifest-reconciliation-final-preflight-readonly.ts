import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stableProductionId } from "../src/lib/production/ProductionDeterminism";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { classifyProductionDurableAttemptLineage } from
  "../src/lib/production/ProductionDurableAttemptLineageClassifier";
import { listRegenerationExecutionBindings } from
  "../src/lib/production/ProductionCompletedStageRegenerationStore";
import type { PipelineJobList, PipelineJobHistory } from "../src/types/pipelineJob";
import type { ProjectPackageManifest } from "../src/types/project";

/**
 * READ-ONLY final preflight for applying reconcileManifestPackageStatusFromHistory
 * to the REAL i-stanbul-un-fethi-1453 / assembly manifest package.
 *
 * This script NEVER writes to data/projects/i-stanbul-un-fethi-1453/. Durable
 * lineage cross-check runs against a temp fs.cp() COPY of production-execution/
 * (mirrors scripts/smoke-attempt7-lineage-reopen-verification.ts's proven-safe
 * pattern). Every other step is a plain fs.readFileSync.
 * reconcileManifestPackageStatusFromHistory itself is never imported or called.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly" as const;
const jobId = `${projectSlug}-${stage}`;
const root = path.join(process.cwd(), "data", "projects", projectSlug);

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8")) as T;
}

function fingerprintManifestPackage(packageManifest: ProjectPackageManifest): string {
  return stableProductionId(
    "manifest-package-pre-mutation",
    JSON.parse(JSON.stringify(packageManifest)) as ProjectPackageManifest,
  );
}

async function main() {
  console.log("========== 1) FRESH READ: manifest.json + pipeline-history.json ==========");
  const rawManifest = readJson<{ updatedAt: string;
    packages: Record<string, ProjectPackageManifest> }>("manifest.json");
  const packageManifest = rawManifest.packages[stage];
  const history = readJson<PipelineJobHistory>("pipeline-history.json");
  const terminalEvents = history.events.filter((event) =>
    event.jobId === jobId && event.stage === stage);
  const latestEvent = terminalEvents.at(-1);

  console.log("========== 3) packages.assembly fields ==========");
  console.log(JSON.stringify({
    status: packageManifest.status,
    completedAt: packageManifest.completedAt,
    startedAt: packageManifest.startedAt,
    attemptsTotal: packageManifest.attempts?.total,
    generationOrdinal: packageManifest.generationOrdinal,
    regenerationId: packageManifest.regenerationId,
  }, null, 2));
  console.log(`history terminal count (no status filter) = ${terminalEvents.length}`);
  console.log(`latest terminal event: status=${latestEvent?.status} recordedAt=${latestEvent?.recordedAt}`);

  console.log("\n========== 2) canonical attempt recomputation (manifestExecutionTotalToAttemptIndex, byte-accurate replica) ==========");
  const executionTotal = packageManifest.attempts?.total;
  if (typeof executionTotal !== "number") {
    console.log("NO-GO: attempts.total missing/invalid.");
    return;
  }
  // Hypothesize "failed" as the target status -- exactly what
  // reconcileManifestPackageStatusFromHistory does; it does NOT pass the
  // manifest's own (possibly corrupted) current status into the formula.
  const hypothesizedStatus = "failed";
  if (hypothesizedStatus === "pending" as string) { /* unreachable, kept for structural parity */ }
  if (executionTotal === 0) {
    console.log("NO-GO: executionTotal is 0.");
    return;
  }
  const expectedTerminalCount = executionTotal; // hypothesizedStatus !== "running"
  const countsAgree = terminalEvents.length === expectedTerminalCount;
  const latestStatusAgrees = latestEvent?.status === hypothesizedStatus;
  console.log(`executionTotal=${executionTotal}, expectedTerminalCount=${expectedTerminalCount}, countsAgree=${countsAgree}`);
  console.log(`latest terminal event status === "failed": ${latestStatusAgrees}`);
  if (!countsAgree || !latestStatusAgrees) {
    console.log("NO-GO: history/manifest evidence mismatch under the 'failed' hypothesis.");
    return;
  }
  const canonicalAttempts = executionTotal - 1;
  console.log(`canonical attempts = executionTotal(${executionTotal}) - 1 = ${canonicalAttempts}`);

  console.log("\n========== durable lineage cross-check (temp COPY only) ==========");
  const realDurableRoot = path.join(root, "production-execution");
  const durableExists = fs.existsSync(realDurableRoot);
  let durableOk = true;
  let hasDurableEvidence = false;
  if (!durableExists) {
    console.log("No production-execution/ directory present -- durable cross-check skipped (matches hasDurableEvidence=false path).");
  } else {
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-manifest-final-preflight-durable-"));
    const copyRoot = path.join(tempRoot, "production-execution");
    try {
      await fsp.cp(realDurableRoot, copyRoot, { recursive: true });
      const adapter = new ProductionExecutionFilePersistenceAdapter({
        trustedRootDirectory: copyRoot, createRootDirectory: false,
      });
      const durableKeys = await adapter.listKeys("idempotency").catch(() => ({ ok: false as const }));
      hasDurableEvidence = durableKeys.ok && durableKeys.keys.length > 0;
      if (hasDurableEvidence) {
        const lineage = await classifyProductionDurableAttemptLineage(
          adapter, projectSlug, stage, canonicalAttempts, "exact");
        console.log(`classifyProductionDurableAttemptLineage(..., attemptIndex=${canonicalAttempts}, "exact") -> status=${lineage.status}` +
          (lineage.status === "valid" ? ` maximumRecordAttempt=${lineage.maximumRecordAttempt}` : ""));
        if (lineage.status === "valid") {
          durableOk = lineage.maximumRecordAttempt === executionTotal;
        } else if (lineage.status === "none") {
          durableOk = canonicalAttempts === 0;
        } else {
          durableOk = false;
        }
      } else {
        console.log("No idempotency keys present -- durable cross-check skipped.");
      }
    } finally {
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  }
  console.log(`durable lineage consistent: ${durableOk}`);
  if (!durableOk) {
    console.log("NO-GO: durable lineage evidence mismatch.");
    return;
  }

  console.log("\n========== 6) cross-check against job-side canonical (already established) ==========");
  const bindings = listRegenerationExecutionBindings(projectSlug, stage);
  const activeBinding = bindings.find((b) =>
    b.binding.regenerationId === packageManifest.regenerationId);
  const generationStartAttempt = activeBinding?.firstGlobalExecutionOrdinal;
  const canonicalAttemptWithinGeneration = generationStartAttempt !== undefined
    ? canonicalAttempts - generationStartAttempt : undefined;
  console.log(`job-side canonical (from prior sprints, independently re-derivable here): attempts=${canonicalAttempts}, attemptWithinGeneration=${canonicalAttemptWithinGeneration}`);
  console.log(`Matches previously established job-side canonical (attempts=5, attemptWithinGeneration=2): ${canonicalAttempts === 5 && canonicalAttemptWithinGeneration === 2}`);

  console.log("\n========== 7) fail-closed gate re-verification ==========");
  const gates = {
    "target is pending->failed only": packageManifest.status === "pending" || packageManifest.status === "failed",
    "not completed": packageManifest.status !== "completed",
    "not running": packageManifest.status !== "running",
    "pending implies completedAt set": !(packageManifest.status === "pending" && packageManifest.completedAt === undefined),
    "history/manifest count agrees": countsAgree,
    "durable lineage agrees": durableOk,
    "latest evidence unambiguous (='failed')": latestStatusAgrees,
  };
  for (const [gate, pass] of Object.entries(gates)) {
    console.log(`  ${pass ? "PASS" : "FAIL"}: ${gate}`);
  }
  const allGatesPass = Object.values(gates).every(Boolean);
  console.log(`All fail-closed gates pass: ${allGatesPass}`);
  if (!allGatesPass) {
    console.log("NO-GO.");
    return;
  }

  console.log("\n========== 8) manifest current-state eligibility ==========");
  if (packageManifest.status === "failed") {
    console.log("Current status is ALREADY 'failed' -- WOULD-CALL would return ALREADY_RECONCILED (write-free), not RECONCILED.");
  } else {
    console.log("Current status is 'pending' with completedAt set and all evidence consistent -- ELIGIBLE for RECONCILED (a real write would occur).");
  }

  console.log("\n========== 4) manifestUpdatedAt + packageFingerprint ==========");
  const packageFingerprint = fingerprintManifestPackage(packageManifest);
  console.log(`manifest.updatedAt = ${rawManifest.updatedAt}`);
  console.log(`packageFingerprint = ${packageFingerprint}`);

  console.log("\n========== 5) WOULD-CALL (not executed) ==========");
  const expected = {
    manifestUpdatedAt: rawManifest.updatedAt,
    packageSnapshot: {
      status: packageManifest.status,
      completedAt: packageManifest.completedAt,
      startedAt: packageManifest.startedAt,
      attemptsTotal: packageManifest.attempts?.total,
      generationOrdinal: packageManifest.generationOrdinal,
      regenerationId: packageManifest.regenerationId,
    },
    packageFingerprint,
  };
  console.log("WOULD CALL:");
  console.log(`PipelineJobManager.reconcileManifestPackageStatusFromHistory(`);
  console.log(`  "${projectSlug}",`);
  console.log(`  "${stage}",`);
  console.log(`  ${JSON.stringify(expected, null, 2).split("\n").join("\n  ")}`);
  console.log(`)`);
  console.log("\n(This call was NOT executed.)");

  console.log("\n========== ALL READ-ONLY CHECKS PASSED ==========");
}

void main().catch((error) => {
  console.error("PREFLIGHT ERROR:", error);
  process.exitCode = 1;
});
