import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { readProductionExecutionRecoverySemanticAuthority } from
  "../src/lib/production/ProductionExecutionRecoveryBootstrap";
import { classifyProductionDurableAttemptLineage } from
  "../src/lib/production/ProductionDurableAttemptLineageClassifier";

/**
 * READ-ONLY diagnostic: runs readProductionExecutionRecoverySemanticAuthority
 * (the exact function readAndVerifyFailedChain's requireQuiescence branch
 * calls) against a temp fs.cp() COPY of the real i-stanbul-un-fethi-1453
 * production-execution/ store, to determine directly whether its "ready"
 * decision is what's blocking prepareFailedStageRetry.
 */

const projectSlug = "i-stanbul-un-fethi-1453";

async function main() {
  const realRoot = path.join(process.cwd(), "data", "projects", projectSlug, "production-execution");
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-compensation-diagnosis-"));
  const copyRoot = path.join(tempRoot, "production-execution");
  try {
    await fsp.cp(realRoot, copyRoot, { recursive: true });
    const adapter = new ProductionExecutionFilePersistenceAdapter({
      trustedRootDirectory: copyRoot, createRootDirectory: false,
    });

    const evaluatedAt = new Date().toISOString();
    const authority = await readProductionExecutionRecoverySemanticAuthority(adapter, evaluatedAt);
    console.log("========== readProductionExecutionRecoverySemanticAuthority result ==========");
    console.log(JSON.stringify(authority, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("DIAGNOSTIC ERROR:", error);
  process.exitCode = 1;
});
