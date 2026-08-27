import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { classifyProductionDurableAttemptLineage } from
  "../src/lib/production/ProductionDurableAttemptLineageClassifier";

/**
 * READ-ONLY, isolated (temp fs.cp() copy) verification: confirms whether
 * classifyProductionDurableAttemptLineage(..., "assembly", 6, "exact")
 * returns "valid" for the real i-stanbul-un-fethi-1453 durable store.
 * NEVER touches the real production-execution/ directory -- runs entirely
 * against a temp copy, mirroring this session's established pattern from
 * scripts/smoke-attempt7-lineage-reopen-verification.ts. This is the
 * mandatory gate before any coding proceeds, per this sprint's order.
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const stage = "assembly";

async function main() {
  const realDurableRoot = path.join(process.cwd(), "data", "projects", projectSlug, "production-execution");
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-lineage-exact-6-verify-"));
  const copyRoot = path.join(tempRoot, "production-execution");
  try {
    await fsp.cp(realDurableRoot, copyRoot, { recursive: true });
    const adapter = new ProductionExecutionFilePersistenceAdapter({
      trustedRootDirectory: copyRoot, createRootDirectory: false,
    });
    for (const candidate of [2, 3, 4, 5, 6, 7, 8]) {
      const lineage = await classifyProductionDurableAttemptLineage(
        adapter, projectSlug, stage, candidate, "exact",
      );
      console.log(`expectedJobAttempt=${candidate} -> ${JSON.stringify(lineage)}`);
    }
    console.log("\n-- preparation mode (mode default) for comparison --");
    for (const candidate of [2, 3, 4, 5, 6, 7, 8]) {
      const lineage = await classifyProductionDurableAttemptLineage(
        adapter, projectSlug, stage, candidate, "preparation",
      );
      console.log(`expectedJobAttempt=${candidate} -> ${JSON.stringify(lineage)}`);
    }
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("VERIFY ERROR:", error);
  process.exitCode = 1;
});
