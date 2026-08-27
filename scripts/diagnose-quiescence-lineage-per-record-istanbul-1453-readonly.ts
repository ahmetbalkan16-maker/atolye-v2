import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { readProductionCanonicalTerminalDurableLineage } from
  "../src/lib/production/ProductionCanonicalDurableLineage";
import { buildProductionPipelineExecutionIdentity } from
  "../src/lib/production/ProductionPipelineExecutionIdentity";
import { buildVersionedProductionPipelineExecutionIdentity } from
  "../src/lib/production/ProductionLegacyPipelineExecutionIdentity";
import { regenerationBindingForExecution } from
  "../src/lib/production/ProductionCompletedStageRegenerationStore";
import { validateProductionExecutionPersistencePayload } from
  "../src/lib/production/ProductionExecutionPersistence";
import type { ProductionStepKey } from "../src/types/project";
import type { ProductionExecutionDurableRecord } from "../src/types/productionExecutionDurableStorage";

/**
 * READ-ONLY forensic: for each *latest* idempotency record in a temp fs.cp()
 * COPY of the real i-stanbul-un-fethi-1453 production-execution/ store,
 * independently re-runs the exact v2 branch of
 * ProductionGlobalTerminalQuiescence.ts's private verifyTerminalLineageVersioned()
 * -- readProductionCanonicalTerminalDurableLineage() with the same
 * currentIdentity construction -- and reports pass/fail + exact thrown error
 * per record. Never writes to, or derives a persistence adapter pointed at,
 * the real project folder.
 */

const projectSlug = "i-stanbul-un-fethi-1453";

function parseVersionedKey(key: string) {
  const match = /^(.*)-v([1-9][0-9]*)$/.exec(key);
  if (!match) return undefined;
  return { identity: match[1], version: Number(match[2]) };
}

function runTypeFromOperation(operation: string): string | undefined {
  return /^pipeline\.stage\.(initial|resume|retry)$/.exec(operation)?.[1];
}

async function main() {
  const realRoot = path.join(process.cwd(), "data", "projects", projectSlug, "production-execution");
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-quiescence-lineage-diagnosis-"));
  const copyRoot = path.join(tempRoot, "production-execution");
  try {
    await fsp.cp(realRoot, copyRoot, { recursive: true });
    const adapter = new ProductionExecutionFilePersistenceAdapter({
      trustedRootDirectory: copyRoot, createRootDirectory: false,
    });

    // Reproduce validateProductionGlobalTerminalQuiescence's own idempotency scan
    // exactly: group by recordId, keep only the highest recordVersion per id.
    const idemKeys = await adapter.listKeys("idempotency");
    if (!idemKeys.ok) { console.log("idempotency listKeys failed"); return; }
    const latestRecords = new Map<string, ProductionExecutionDurableRecord>();
    for (const key of idemKeys.keys) {
      const read = await adapter.read("idempotency", key);
      if (read.status !== "found" || !validateProductionExecutionPersistencePayload("idempotency", read.value)) {
        console.log(`SKIP (invalid payload): ${key}`);
        continue;
      }
      const record = read.value as unknown as ProductionExecutionDurableRecord;
      const parsed = parseVersionedKey(key);
      if (!parsed || parsed.identity !== record.recordId || parsed.version !== record.recordVersion ||
        record.projectSlug !== projectSlug) {
        console.log(`SKIP (identity/version mismatch): ${key}`);
        continue;
      }
      const existing = latestRecords.get(parsed.identity);
      if (!existing || existing.recordVersion < parsed.version) {
        latestRecords.set(parsed.identity, record);
      }
    }
    console.log(`Distinct recordIds (latest-version records): ${latestRecords.size}\n`);

    let failCount = 0;
    let okCount = 0;
    for (const [recordId, record] of [...latestRecords.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const runType = runTypeFromOperation(record.operation);
      const stage = record.stage as ProductionStepKey;
      const label = `recordId=${recordId} stage=${stage} attempt=${record.attempt} ` +
        `state=${record.state} identityFingerprint=${record.identityFingerprint} operation=${record.operation}`;
      if (!runType || !stage || !Number.isSafeInteger(record.attempt) || record.attempt < 1) {
        console.log(`FAIL (pre-check) ${label}\n  reason: runType/stage/attempt shape invalid`);
        failCount += 1;
        continue;
      }
      const currentIdentity = buildProductionPipelineExecutionIdentity(
        {
          projectSlug, stage, runType: runType as "initial" | "resume" | "retry",
          regeneration: regenerationBindingForExecution(projectSlug, stage, record.attempt - 1),
        },
        { id: `${projectSlug}-${stage}`, attempts: record.attempt - 1 },
      );
      try {
        await readProductionCanonicalTerminalDurableLineage(
          adapter, currentIdentity, record.identityFingerprint, undefined, record.operation,
        );
        okCount += 1;
        console.log(`OK (v2)   ${label}`);
      } catch (v2Error) {
        // Fall through to v1 identity construction, mirroring
        // verifyTerminalLineageVersioned's own fallback -- but only report
        // whether the v1Identity's claim/attempt/reservation even resolve,
        // since the full 30-assertion v1 body is private and not exported.
        const v1Identity = buildVersionedProductionPipelineExecutionIdentity(
          "production-pipeline-identity-v1",
          { projectSlug, stage, runType: runType as "initial" | "resume" | "retry" },
          { id: `${projectSlug}-${stage}`, attempts: record.attempt - 1 },
        );
        const reservationRead = await adapter.read("reservation", record.identityFingerprint);
        const claimRead = await adapter.listKeys("claim");
        const attemptRead = await adapter.listKeys("attempt");
        const claimVersions = claimRead.ok
          ? claimRead.keys.filter((k) => k.startsWith(`${v1Identity.claimId}-v`)) : [];
        const attemptVersions = attemptRead.ok
          ? attemptRead.keys.filter((k) => k.startsWith(`${v1Identity.attemptId}-v`)) : [];
        failCount += 1;
        console.log(`FAIL (v2) ${label}`);
        console.log(`  v2 error: ${v2Error instanceof Error ? v2Error.message : String(v2Error)}`);
        console.log(`  v2 currentIdentity: recordId=${currentIdentity.recordId} ` +
          `claimId=${currentIdentity.claimId} attemptId=${currentIdentity.attemptId} ` +
          `leaseId=${currentIdentity.leaseId}`);
        console.log(`  v1 fallback identity: claimId=${v1Identity.claimId} attemptId=${v1Identity.attemptId}`);
        console.log(`  v1 reservation found: ${reservationRead.status === "found"}`);
        console.log(`  v1 claim versions present: [${claimVersions.join(", ") || "NONE"}]`);
        console.log(`  v1 attempt versions present: [${attemptVersions.join(", ") || "NONE"}]`);
      }
    }
    console.log(`\nTotals: OK(v2)=${okCount} FAIL(v2)=${failCount} of ${latestRecords.size}`);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("DIAGNOSTIC ERROR:", error);
  process.exitCode = 1;
});
