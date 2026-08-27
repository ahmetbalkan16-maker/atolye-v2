import path from "node:path";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { AdapterBackedProductionExecutionDurableStorage } from
  "../src/lib/production/ProductionExecutionDurableStorage";
import { reconcileOrphanedReservationWithoutClaim } from
  "../src/lib/production/ProductionPipelineRetryReconciliation";

const projectSlug = "i-stanbul-un-fethi-1453";
const recordId =
  "pipeline-record-ca987045bc8dc5fa60a86406342051cbd03eec7aa534fd2b713ea3b36c9828c2";

async function main() {
  const trustedRootDirectory = path.join(
    process.cwd(), "data", "projects", projectSlug, "production-execution",
  );
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory,
    createRootDirectory: false,
  });
  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);

  console.log("=== FRESH PRECONDITION CHECK ===");
  const before = await storage.read(recordId);
  if (!before.record) {
    console.log("RECORD NOT FOUND. Aborting, no mutation attempted.");
    return;
  }
  console.log("state:", before.record.state);
  console.log("attempt:", before.record.attempt, "maxAttempts:", before.record.maxAttempts);
  console.log("recordVersion:", before.record.recordVersion);
  console.log("lease:", before.record.durableLease
    ? { status: before.record.durableLease.status, leaseId: before.record.durableLease.identity.leaseId }
    : null);

  if (before.record.state !== "reserved") {
    console.log("PRECONDITION FAILED: state is not 'reserved'. STOPPING, no mutation attempted.");
    return;
  }

  console.log("\n=== RUNNING reconcileOrphanedReservationWithoutClaim ===");
  const result = await reconcileOrphanedReservationWithoutClaim(adapter, recordId);
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    console.log("\nRECOVERY REFUSED / FAILED. STOPPING. No further mutation attempted.");
    return;
  }

  console.log("\n=== READ-ONLY POST-VERIFICATION ===");
  const after = await storage.read(recordId);
  console.log("post state:", after.record?.state);
  console.log("post recordVersion:", after.record?.recordVersion);
  console.log("post lease:", after.record?.durableLease
    ? { status: after.record.durableLease.status }
    : null);
}

void main();
