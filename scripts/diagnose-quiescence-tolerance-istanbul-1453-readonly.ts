import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { validateProductionGlobalTerminalQuiescence } from
  "../src/lib/production/ProductionGlobalTerminalQuiescence";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { resolveOrphanReservationTolerance } from
  "../src/lib/production/ProductionOrphanReservationToleranceAuthority";

/**
 * READ-ONLY diagnostic: runs validateProductionGlobalTerminalQuiescence(...,
 * toleranceRuntimeInput) against a temp fs.cp() COPY of the real
 * i-stanbul-un-fethi-1453 production-execution/ store, using the exact same
 * createRuntimeStorageContext() the real planner CLI uses, to determine
 * precisely why it is still returning false after the tolerance remediation.
 */

const projectSlug = "i-stanbul-un-fethi-1453";

async function main() {
  const realRoot = path.join(process.cwd(), "data", "projects", projectSlug, "production-execution");
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-quiescence-tolerance-diagnosis-"));
  const copyRoot = path.join(tempRoot, "production-execution");
  try {
    await fsp.cp(realRoot, copyRoot, { recursive: true });
    const adapter = new ProductionExecutionFilePersistenceAdapter({
      trustedRootDirectory: copyRoot, createRootDirectory: false,
    });
    const context = createRuntimeStorageContext();
    console.log("context.projectsRoot:", context.projectsRoot);
    console.log("context.runtimeRoot:", context.runtimeRoot);
    console.log("context.workspaceRoot:", context.workspaceRoot);

    const result = await validateProductionGlobalTerminalQuiescence(
      adapter, projectSlug, undefined, context,
    );
    console.log(`validateProductionGlobalTerminalQuiescence(..., context) -> ${result}`);

    // Directly exercise resolveOrphanReservationTolerance for c1ca1524 against
    // the real (unmodified) tolerance authority and reservation, using the
    // exact same context, to isolate whether the tolerance step itself is
    // what's failing.
    const reservationRead = await adapter.read("reservation", "idempotency-identity-c1ca1524");
    if (reservationRead.status !== "found") {
      console.log("c1ca1524 reservation not found in copy -- unexpected.");
      return;
    }
    const tolerated = await resolveOrphanReservationTolerance(adapter, reservationRead.value, {
      projectSlug, stage: "assembly", jobId: `${projectSlug}-assembly`, runtimeInput: context,
    });
    console.log(`resolveOrphanReservationTolerance(c1ca1524, context) -> ${tolerated}`);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("DIAGNOSTIC ERROR:", error);
  process.exitCode = 1;
});
