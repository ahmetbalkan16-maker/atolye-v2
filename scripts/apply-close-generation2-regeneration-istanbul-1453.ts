import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import {
  readRegenerationIntent,
  readRegenerationPreparedReceipt,
  isRegenerationCompleted,
  markRegenerationCompleted,
} from "../src/lib/pipeline/PipelineStageRegenerationStore";

/**
 * APPROVED, ONE-TIME closure of i-stanbul-un-fethi-1453's dangling generation-2
 * regeneration (pipeline-regen-9474575560c5cd3bb373d77feafc2a08c4abd52be2bc304c,
 * fromStage="assembly", reasonCode=AUDIO_REBIND_COMPENSATION, prepared
 * 2026-08-21T22:37:25Z) — its target stage (assembly) was attempted under it and
 * failed; it was never marked completed, which blocks
 * `createPipelineCompletedStageRegenerationPlan` from creating any new plan for this
 * project via the "active regeneration" conflict guard.
 *
 * `markRegenerationCompleted` writes only `completed.json` (a write-once audit/gate
 * marker) into this regeneration's own directory — it does not touch manifest.json,
 * pipeline-jobs.json, any asset, or claim the underlying stage succeeded. It only
 * means "this regeneration lineage is no longer active/pending".
 */

const projectSlug = "i-stanbul-un-fethi-1453";
const regenerationId = "pipeline-regen-9474575560c5cd3bb373d77feafc2a08c4abd52be2bc304c";

function fail(reason: string): never {
  console.error(`BLOCKED: ${reason}`);
  process.exitCode = 1;
  throw new Error(reason);
}

async function main() {
  const context = createRuntimeStorageContext();

  const intent = readRegenerationIntent(projectSlug, regenerationId, context);
  if (!intent) fail("intent.json not found for this regenerationId.");
  if (intent!.projectSlug !== projectSlug) fail("intent.projectSlug mismatch.");
  if (intent!.regenerationId !== regenerationId) fail("intent.regenerationId mismatch.");
  if (intent!.fromStage !== "assembly") fail(`intent.fromStage=${intent!.fromStage}, expected "assembly".`);
  if (intent!.generationOrdinal !== 2) fail(`intent.generationOrdinal=${intent!.generationOrdinal}, expected 2.`);
  if (intent!.reasonCode !== "AUDIO_REBIND_COMPENSATION") {
    fail(`intent.reasonCode=${intent!.reasonCode}, expected AUDIO_REBIND_COMPENSATION.`);
  }
  console.log("intent.json verified:", JSON.stringify(intent, null, 2).slice(0, 400), "...");

  const receipt = readRegenerationPreparedReceipt(projectSlug, regenerationId, context);
  if (!receipt) fail("prepared.json not found for this regenerationId.");
  console.log(`prepared.json present, fingerprint=${receipt!.fingerprint}`);

  if (isRegenerationCompleted(projectSlug, regenerationId, context)) {
    console.log("Already marked completed. No-op.");
    return;
  }

  const completedAt = new Date().toISOString();
  markRegenerationCompleted(projectSlug, regenerationId, context, completedAt);
  console.log(`Marked completed at ${completedAt}.`);

  if (!isRegenerationCompleted(projectSlug, regenerationId, context)) {
    fail("post-write verification failed: completed.json still not detected.");
  }
  console.log("Post-write verification: completed.json now present. Done.");
}

void main().catch((error) => {
  console.error("EXECUTION ERROR:", error);
  process.exitCode = 1;
});
