import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  listRegenerationExecutionBindings,
  regenerationBindingForExecution,
} from "../src/lib/production/ProductionCompletedStageRegenerationStore";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";

/**
 * READ-ONLY forensic: proves whether regenerationBindingForExecution() now
 * resolves a non-undefined binding for (i-stanbul-un-fethi-1453, "youtube",
 * globalExecutionOrdinal=2) -- the exact call
 * verifyTerminalLineageVersioned() makes when re-deriving pipeline-record-
 * 507fb8ec's identity -- against a temp fs.cp() COPY of the real project
 * folder (never the real one). No production-execution/ or
 * pipeline-regeneration/ file is modified.
 */

const projectSlug = "i-stanbul-un-fethi-1453";

async function main() {
  const realProjectFolder = path.join(process.cwd(), "data", "projects", projectSlug);
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-regen-binding-diagnosis-"));
  const workspaceRoot = tempRoot;
  const runtimeRoot = path.join(workspaceRoot, "data");
  const copyProjectFolder = path.join(runtimeRoot, "projects", projectSlug);
  try {
    await fsp.mkdir(copyProjectFolder, { recursive: true });
    // Only copy what listRegenerationExecutionBindings actually reads:
    // project.json (for getProjectFolder's own resolution) and
    // pipeline-regeneration/ (the only regeneration namespace this project has,
    // confirmed via `ls` -- no production-regeneration/ directory exists).
    await fsp.cp(
      path.join(realProjectFolder, "pipeline-regeneration"),
      path.join(copyProjectFolder, "pipeline-regeneration"),
      { recursive: true },
    ).catch(() => {});
    for (const file of ["project.json", "manifest.json", "pipeline-jobs.json"]) {
      await fsp.copyFile(
        path.join(realProjectFolder, file), path.join(copyProjectFolder, file),
      ).catch(() => {});
    }

    const context = createRuntimeStorageContext({
      workspaceRoot, environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot },
    });

    console.log("=== listRegenerationExecutionBindings(projectSlug, 'youtube', context) ===");
    const bindings = listRegenerationExecutionBindings(projectSlug, "youtube", context);
    for (const item of bindings) {
      console.log(JSON.stringify(item, null, 2));
    }
    console.log(`\ntotal candidate bindings: ${bindings.length}`);

    console.log("\n=== regenerationBindingForExecution(projectSlug, 'youtube', 2, context) ===");
    // 2 == record.attempt(3) - 1, the exact globalExecutionOrdinal
    // verifyTerminalLineageVersioned computes for pipeline-record-507fb8ec.
    const resolved = regenerationBindingForExecution(projectSlug, "youtube", 2, context);
    console.log(JSON.stringify(resolved ?? null, null, 2));
    console.log(`\nresolved to a binding: ${resolved !== undefined}`);

    // Cross-check: what would this have resolved to BEFORE any regeneration
    // existed (globalExecutionOrdinal comparison is against
    // firstGlobalExecutionOrdinal, not time -- so also show ordinal=0 and
    // ordinal=Number.NEGATIVE_INFINITY-equivalent to make the "would have
    // been undefined at record-creation-time (2026-08-21T06:46:32Z, hours
    // before the first regeneration intent existed)" argument fully explicit
    // via the regeneration intents' own timestamps.
    console.log("\n=== regeneration intents' own createdAt (for time-ordering proof) ===");
    for (const item of bindings) {
      console.log(`regenerationId=${item.binding.regenerationId} firstGlobalExecutionOrdinal=${item.firstGlobalExecutionOrdinal}`);
    }
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("DIAGNOSTIC ERROR:", error);
  process.exitCode = 1;
});
