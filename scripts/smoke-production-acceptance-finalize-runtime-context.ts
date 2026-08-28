/**
 * Regression coverage for the RUNTIME_OPERATION_CONTEXT_MISSING that
 * `ProductionAcceptanceOrchestrator.finalize()` threw at the end of
 * `npm run production:acceptance:execute` (and `resume-finalize`), after the
 * pipeline had already reached 12/12 and `project.json.status="completed"`.
 *
 * Root cause: PipelineRunner.run/resume establish a ProductionRuntimeOperationContext
 * only for their own scope and tear it down before returning. finalize() then ran
 * its media/registry re-verification -- AssetManager.getProjectAssets ->
 * getCommittedAudioPublicationAssets -> requireActiveProductionRuntimeOperationContext()
 * -- with no active context, so it threw once a project had any committed audio
 * publication intent (every real audio stage writes one). The bare CLI process has
 * no ambient operation scope; every existing smoke test does (withCanonicalSmokeRuntime
 * enters one), which is why this was invisible until it hit a real run.
 *
 * Fix: finalize() is now invoked through
 * `executePipelineRunnerProductionRuntimeOperation("production-acceptance-finalize", ...)`,
 * i.e. the same canonical runtime operation the pipeline stages use, derived from
 * the already-registered canonical parent authority. No ambient fallback, still
 * fail-closed when no runtime is registered.
 *
 * Never touches any real project -- everything runs inside withCanonicalSmokeRuntime's
 * isolated temp runtime root.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { emitSmokeResult } from "./lib/SmokeResult";
import {
  withCanonicalSmokeRuntime,
  type CanonicalSmokeRuntime,
} from "./lib/CanonicalSmokeRuntime";
import {
  acquireProjectWriteAuthority,
  type RuntimeStorageAuthorityLease,
} from "../src/lib/runtime/RuntimeStoragePaths";
import {
  getActiveProductionRuntimeOperationContext,
  runWithProductionRuntimeOperationContext,
  ProductionRuntimeOperationContextError,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import {
  getCommittedAudioPublicationAssets,
  prepareAudioPublicationIntent,
} from "../src/lib/audio/AudioPublicationIntentStore";
import {
  executePipelineRunnerProductionRuntimeOperation,
} from "../src/lib/pipeline/PipelineRunner";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { PipelineStageExecutor } from "../src/lib/pipeline/PipelineStageExecutor";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import {
  ProductionAcceptanceOrchestrator,
  isAuthenticProductionAcceptanceExecutionError,
} from "../src/lib/production/ProductionAcceptanceOrchestrator";
import {
  createProductionAcceptanceMarker,
  productionAcceptanceConfigurationFingerprint,
} from "../src/lib/production/ProductionAcceptancePolicy";
import { createProductionAcceptanceProjectSlug } from
  "../src/lib/production/ProductionAcceptanceTopic";
import {
  productionReadinessSchemaVersion,
  type ProductionReadinessReport,
} from "../src/types/productionReadiness";
import type { PortablePublishedFile } from
  "../src/lib/runtime/security/PortableNoClobberFilePublisher";
import type { Asset } from "../src/types/asset";
import type { PipelineRecoveryPlan } from "../src/types/pipelineRecovery";

let passed = 0;
function pass(label: string) {
  passed += 1;
  console.log(`PASS ${passed}: ${label}`);
}

function wav(dataBytes = 1600): Buffer {
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

/**
 * Seeds one committed audio publication intent + its canonical .wav for `runtime`'s
 * project -- the exact on-disk state a completed audio stage leaves behind, and the
 * precondition that makes getCommittedAudioPublicationAssets demand an active
 * operation context.
 */
function seedCommittedAudioIntent(runtime: CanonicalSmokeRuntime): { projectId: string; assetId: string } {
  const assetId = randomUUID();
  const projectId = `project-${runtime.projectSlug}`;
  const fileName = `${assetId}.wav`;
  const bytes = wav();
  const audioDir = path.join(
    runtime.runtimeStorageContext.projectsRoot, runtime.projectSlug, "assets", "audio",
  );
  fs.mkdirSync(audioDir, { recursive: true });
  const canonicalPath = path.join(audioDir, fileName);
  fs.writeFileSync(canonicalPath, bytes, { flag: "wx" });
  const stat = fs.statSync(canonicalPath);
  const publication: PortablePublishedFile = {
    mode: "hard-link",
    device: stat.dev,
    inode: stat.ino,
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const asset: Asset = {
    id: assetId,
    projectId,
    projectSlug: runtime.projectSlug,
    sceneId: 1,
    type: "audio",
    status: "generated",
    provider: "openai",
    model: "tts-1",
    prompt: "fixture narration",
    filePath: `data/projects/${runtime.projectSlug}/assets/audio/${fileName}`,
    url: `/api/assets/audio/${runtime.projectSlug}/${fileName}`,
    mimeType: "audio/wav",
    byteLength: bytes.length,
    durationSeconds: 1,
    createdAt: "2026-08-08T00:00:00.000Z",
  };
  const authority: RuntimeStorageAuthorityLease = acquireProjectWriteAuthority(
    runtime.projectSlug, runtime.runtimeStorageContext,
  );
  try {
    prepareAudioPublicationIntent({
      projectSlug: runtime.projectSlug,
      projectId,
      compensationRef: `audio-comp-${randomUUID()}`,
      asset,
      publication,
      authority,
      context: runtime.runtimeStorageContext,
    });
  } finally {
    authority.release();
  }
  return { projectId, assetId };
}

async function scenarioRawHazardAndFixMechanism() {
  await withCanonicalSmokeRuntime(
    { name: "acceptance-finalize-runtime-context-mechanism", enterOperationContext: false },
    async (runtime) => {
      const { projectId, assetId } = await runWithProductionRuntimeOperationContext(
        runtime.operationContext,
        async () => seedCommittedAudioIntent(runtime),
      );

      // (A) Exactly what finalize()'s registry read did before the fix: no ambient
      // operation scope -> RUNTIME_OPERATION_CONTEXT_MISSING.
      assert.equal(getActiveProductionRuntimeOperationContext(), undefined);
      assert.throws(
        () => AssetManager.getProjectAssets(runtime.projectSlug, projectId),
        (error: unknown) =>
          error instanceof ProductionRuntimeOperationContextError &&
          error.code === "RUNTIME_OPERATION_CONTEXT_MISSING",
        "raw hazard must still reproduce without the wrap",
      );
      pass("AssetManager.getProjectAssets throws RUNTIME_OPERATION_CONTEXT_MISSING with no active operation context");

      // (B) The literal call the new finalizeWithinCanonicalRuntimeOperation makes.
      const registry = await executePipelineRunnerProductionRuntimeOperation(
        "production-acceptance-finalize",
        async () => AssetManager.getProjectAssets(runtime.projectSlug, projectId),
      );
      const committedAudio = registry.assets.filter(
        (item) => item.type === "audio" && item.id === assetId,
      );
      assert.equal(committedAudio.length, 1, "committed audio intent surfaces through the canonical runtime operation");
      pass("executePipelineRunnerProductionRuntimeOperation('production-acceptance-finalize', ...) resolves the registry read");

      // The authority binding check inside getCommittedAudioPublicationAssets passes
      // because the finalize-derived context shares the pipeline's storage authority.
      const committedDirect = await executePipelineRunnerProductionRuntimeOperation(
        "production-acceptance-finalize",
        async () => getCommittedAudioPublicationAssets(runtime.projectSlug, projectId),
      );
      assert.equal(committedDirect.length, 1);
      assert.equal(committedDirect[0].id, assetId);
      pass("committed audio publication authority binding check passes under the finalize operation");

      // (C) Nested under an already-active context (the condition every existing
      // acceptance smoke test runs finalize in) -> reused, never MISMATCH.
      const nested = await runWithProductionRuntimeOperationContext(
        runtime.operationContext,
        () => executePipelineRunnerProductionRuntimeOperation(
          "production-acceptance-finalize",
          async () => AssetManager.getProjectAssets(runtime.projectSlug, projectId),
        ),
      );
      assert.equal(nested.assets.filter((item) => item.id === assetId).length, 1);
      pass("finalize operation nested inside an active context is reused, not rejected as a mismatch");
    },
  );
}

function readyReport(): ProductionReadinessReport {
  return {
    schemaVersion: productionReadinessSchemaVersion,
    generatedAt: new Date().toISOString(),
    ready: true,
    checks: [],
  };
}

async function scenarioOrchestratorWiring(options: { withAmbientContext: boolean }) {
  await withCanonicalSmokeRuntime(
    {
      name: `acceptance-finalize-wiring-${options.withAmbientContext ? "ambient" : "bare"}`,
      enterOperationContext: false,
    },
    async (runtime) => {
      const runId = randomUUID();
      const topic = "Runtime context finalize regression fixture";
      const slug = createProductionAcceptanceProjectSlug(topic, runId);
      const fingerprint = productionAcceptanceConfigurationFingerprint();

      // Marker first (mirrors the real orchestrator ordering), then a minimal project.json.
      await createProductionAcceptanceMarker(slug, runId, fingerprint, topic);
      const projectFolder = path.join(runtime.runtimeStorageContext.projectsRoot, slug);
      fs.writeFileSync(
        path.join(projectFolder, "project.json"),
        JSON.stringify({
          id: `id-${runId}`,
          slug,
          title: topic,
          status: "completed",
          createdAt: "2026-08-08T00:00:00.000Z",
          updatedAt: "2026-08-08T00:00:00.000Z",
        }),
        "utf8",
      );

      const originalEvaluate = ProductionAcceptanceOrchestrator.evaluateReadiness;
      const originalCreatePlan = PipelineRecoveryPlanner.createResumePlan;
      const originalLoadState = PipelineStageExecutor.loadState;
      let loadStateCalls = 0;
      let contextActiveDuringFinalize: boolean | undefined;
      try {
        ProductionAcceptanceOrchestrator.evaluateReadiness = async () => readyReport();
        PipelineRecoveryPlanner.createResumePlan = async (
          projectSlug: string,
        ): Promise<PipelineRecoveryPlan> => ({
          projectSlug,
          type: "resume",
          startStage: null,
          stagesToRun: [],
          blocked: false,
          dependencies: [],
          createdAt: "2026-08-08T00:00:00.000Z",
        });
        // Earliest seam inside finalize() after readProductionAcceptanceMarker:
        // observe whether finalize established the runtime operation context before
        // its media/registry re-verification, then bail out write-free.
        PipelineStageExecutor.loadState = async () => {
          loadStateCalls += 1;
          contextActiveDuringFinalize =
            getActiveProductionRuntimeOperationContext() !== undefined;
          return null;
        };

        const invoke = () => ProductionAcceptanceOrchestrator.resumeAndFinalize(slug);
        await assert.rejects(
          options.withAmbientContext
            ? runWithProductionRuntimeOperationContext(runtime.operationContext, invoke)
            : invoke(),
          (error: unknown) => {
            assert.ok(
              !(error instanceof ProductionRuntimeOperationContextError),
              `finalize must not throw a runtime-operation-context error (${options.withAmbientContext ? "ambient" : "bare"})`,
            );
            assert.ok(
              isAuthenticProductionAcceptanceExecutionError(error),
              "expected the normal downstream ProductionAcceptanceExecutionError",
            );
            return true;
          },
        );

        assert.equal(loadStateCalls, 1, "finalize() reached its media/registry re-verification");
        assert.equal(
          contextActiveDuringFinalize,
          true,
          `finalize() ran inside an active ProductionRuntimeOperationContext (${options.withAmbientContext ? "ambient" : "bare"})`,
        );
        pass(
          `ProductionAcceptanceOrchestrator.resumeAndFinalize establishes the runtime operation context for finalize() (${options.withAmbientContext ? "ambient outer context" : "bare CLI, no ambient context"})`,
        );
      } finally {
        ProductionAcceptanceOrchestrator.evaluateReadiness = originalEvaluate;
        PipelineRecoveryPlanner.createResumePlan = originalCreatePlan;
        PipelineStageExecutor.loadState = originalLoadState;
      }
    },
  );
}

async function main() {
  await scenarioRawHazardAndFixMechanism();
  await scenarioOrchestratorWiring({ withAmbientContext: false });
  await scenarioOrchestratorWiring({ withAmbientContext: true });

  assert.equal(passed, 6);
  console.log(`Production acceptance finalize runtime-context smoke: PASS (${passed} scenarios)`);
  emitSmokeResult("production-acceptance-finalize-runtime-context", passed);
}

void main().catch((error) => {
  console.error("Production acceptance finalize runtime-context smoke FAILED:", error);
  process.exitCode = 1;
});
