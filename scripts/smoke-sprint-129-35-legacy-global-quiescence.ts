import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ProjectWriter } from "../src/lib/projects/ProjectWriter";
import { prepareProductionPipelineExecution } from
  "../src/lib/production/ProductionPipelineExecutionFactory";
import { ProductionExecutionWorkerExecutionService } from
  "../src/lib/production/ProductionExecutionWorker";
import { reconcileFailedPipelineExecution } from
  "../src/lib/production/ProductionPipelineRetryReconciliation";
import { classifyQueuedExhaustedPipelineJobDrift } from
  "../src/lib/production/ProductionQueuedExhaustedDriftClassifier";
import { ProductionExecutionFilePersistenceAdapter } from
  "../src/lib/production/ProductionExecutionPersistence";
import { buildProductionPipelineExecutionIdentity } from
  "../src/lib/production/ProductionPipelineExecutionIdentity";
import { buildVersionedProductionPipelineExecutionIdentity } from
  "../src/lib/production/ProductionLegacyPipelineExecutionIdentity";
import { readProductionCanonicalTerminalDurableLineage } from
  "../src/lib/production/ProductionCanonicalDurableLineage";
import { validateProductionGlobalTerminalQuiescence } from
  "../src/lib/production/ProductionGlobalTerminalQuiescence";
import { runProductionAcceptanceCommand } from
  "../src/lib/production/ProductionAcceptanceCommand";
import { ProductionPipelineDurableExecutionError } from
  "../src/lib/production/ProductionPipelineExecutionAdapter";
import { stableProductionId } from "../src/lib/production/ProductionDeterminism";
import type { PipelineJob, PipelineJobHistory, PipelineJobList } from
  "../src/types/pipelineJob";
import type { ProductionExecutionPersistenceAdapter,
  ProductionExecutionPersistenceRecordKind } from
  "../src/types/productionExecutionPersistence";
import type { ProjectManifest, ProjectPackageRunType, ProductionStepKey } from
  "../src/types/project";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { emitSmokeResult } from "./lib/SmokeResult";

const anchor = "2026-08-02T10:00:00.000Z";
const targetStage: ProductionStepKey = "audio";
const failureCode = "AUDIO_ASSET_GENERATION_FAILED";
let passed = 0;

async function test(name: string, action: () => Promise<void>) {
  await action();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

/**
 * Constructs a mixed durable topology containing 17 legacy (v1) terminal lineages
 * plus 1 current strict (v2) audio resume attempt-3 target lineage.
 * Exactly 18 lineages total matching production topology distribution.
 */
async function createMixedProductionTopologyFixture(
  runtimeRoot: string,
  projectSlug: string,
) {
  const executionRoot = path.join(runtimeRoot, "projects", projectSlug, "production-execution");
  const stageSpecs: { stage: ProductionStepKey; attempts: number; finalSucceeded: boolean }[] = [
    { stage: "research", attempts: 3, finalSucceeded: true },
    { stage: "script", attempts: 3, finalSucceeded: true },
    { stage: "scenes", attempts: 2, finalSucceeded: true },
    { stage: "visuals", attempts: 3, finalSucceeded: true },
    { stage: "animation", attempts: 3, finalSucceeded: true },
    { stage: "video", attempts: 1, finalSucceeded: true },
    { stage: "audio", attempts: 3, finalSucceeded: false },
  ];

  const jobsMap = new Map<string, PipelineJob>();

  for (const spec of stageSpecs) {
    const jobId = `${projectSlug}-${spec.stage}`;
    const runTypes: ProjectPackageRunType[] = spec.stage === "audio"
      ? ["initial", "retry", "resume"]
      : ["initial", "retry", "retry"];

    for (let attempt = 0; attempt < spec.attempts; attempt += 1) {
      const runType = runTypes[attempt];
      const createdAt = new Date(Date.parse(anchor) + (jobsMap.size + 1) * 20_000 + attempt * 1_000).toISOString();
      const queued: PipelineJob = {
        id: jobId, projectSlug, stage: spec.stage, title: spec.stage, status: "queued", attempts: attempt,
        createdAt, updatedAt: createdAt,
      };
      jobsMap.set(jobId, queued);
      await writeJobList(projectSlug, jobsMap, createdAt);

      const prepared = await prepareProductionPipelineExecution({
        projectSlug, stage: spec.stage, runType,
      });

      const shouldFail = true;

      const execution = await new ProductionExecutionWorkerExecutionService(
        prepared.executionAdapter,
      ).execute(prepared.request, async () => {
        if (shouldFail) {
          throw Object.assign(new Error("controlled stage failure"), { code: failureCode });
        }
        return { success: true, summary: "controlled stage success" };
      }, { isCancellationRequested: () => false });

      const failedAt = new Date(Date.parse(createdAt) + 5_000).toISOString();
      if (execution.status === "failed") {
        const failed: PipelineJob = {
          ...queued, status: "failed", updatedAt: failedAt, completedAt: failedAt,
          error: failureCode,
        };
        jobsMap.set(jobId, failed);
        await writeJobList(projectSlug, jobsMap, failedAt);
        const reconciled = await reconcileFailedPipelineExecution(
          failed, () => new Date(Date.parse(failedAt) + 1_000).toISOString(),
        );
        assert.equal(reconciled.ok, true, JSON.stringify(reconciled));
      } else {
        const succeeded: PipelineJob = {
          ...queued, status: "completed", updatedAt: failedAt, completedAt: failedAt,
        };
        jobsMap.set(jobId, succeeded);
        await writeJobList(projectSlug, jobsMap, failedAt);
      }
    }
  }

  // Convert all historical lineages (except target audio attempt 3) to v1 legacy format (omit operation from claim/attempt identity)
  await convertHistoricalLineagesToV1Legacy(executionRoot, projectSlug);

  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: executionRoot, createRootDirectory: false,
  });

  const targetJobId = `${projectSlug}-${targetStage}`;
  const targetIdentity = buildProductionPipelineExecutionIdentity(
    { projectSlug, stage: targetStage, runType: "resume" },
    { id: targetJobId, attempts: 2 },
  );

  const drift: PipelineJob = {
    id: targetJobId, projectSlug, stage: targetStage, title: targetStage, status: "queued", attempts: 3,
    createdAt: anchor, updatedAt: anchor,
  };
  const jobs: PipelineJobList = {
    projectSlug, jobs: [drift], createdAt: anchor, updatedAt: drift.updatedAt,
  };
  const history: PipelineJobHistory = {
    projectSlug,
    events: [{
      id: `${targetJobId}-failed-3`, jobId: targetJobId, stage: targetStage, status: "failed",
      jobCreatedAt: anchor, jobUpdatedAt: anchor, completedAt: anchor, recordedAt: anchor,
      errorCode: failureCode,
    }],
    createdAt: anchor, updatedAt: anchor,
  };
  const packages = Object.fromEntries([
    "research", "script", "scenes", "visuals", "animation", "video", "audio",
    "assembly", "thumbnail", "seo", "youtube", "export",
  ].map((key) => [key, {
    key, status: key === targetStage ? "failed" : "pending", fileName: `${key}.json`,
    ...(key === targetStage ? { error: failureCode } : {}),
  }])) as ProjectManifest["packages"];
  const manifest: ProjectManifest = {
    project: { id: `project-${projectSlug}`, slug: projectSlug, title: projectSlug,
      status: "audio", createdAt: anchor, updatedAt: anchor },
    projectId: `project-${projectSlug}`, slug: projectSlug, version: 1, packages,
    createdAt: anchor, updatedAt: anchor,
  };

  return {
    projectSlug, jobId: targetJobId, jobs, history, manifest, adapter, executionRoot,
    targetIdentity,
  };
}

/**
 * Loosely-typed shape of the durable idempotency/reservation/claim/attempt JSON
 * records this migration reads and rewrites in place. It spans both the legacy
 * flat (v1) and current nested (v2, `identity`/`durableLease`) schema generations,
 * and every field is optional/unioned by design — that heterogeneity is exactly
 * what this conversion is testing, not a gap to be typed away.
 */
interface LegacyDurableRecordContent {
  recordId?: string;
  stage?: ProductionStepKey;
  attempt?: number;
  operation?: string;
  identityFingerprint?: string;
  executionFingerprint?: string;
  identity?: {
    recordId?: string;
    identityFingerprint?: string;
    executionFingerprint?: string;
    operation?: string;
  };
  durableLease?: {
    identity?: {
      executionFingerprint?: string;
    };
  };
  integrity?: {
    algorithm?: string;
    fingerprint?: string;
  };
}

async function convertHistoricalLineagesToV1Legacy(executionRoot: string, projectSlug: string) {
  // Target audio attempt-3 recordId
  const targetId = buildProductionPipelineExecutionIdentity(
    { projectSlug, stage: "audio", runType: "resume" },
    { id: `${projectSlug}-audio`, attempts: 2 },
  );

  const recordInfoMap = new Map<string, { stage: ProductionStepKey; attempt: number; operation: string }>();
  const resToRecordMap = new Map<string, string>();

  // Pass 1: Build recordInfoMap and resToRecordMap from idempotency records
  const idemDir = path.join(executionRoot, "idempotency");
  if (await fs.access(idemDir).then(() => true).catch(() => false)) {
    const files = await fs.readdir(idemDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const content = JSON.parse(await fs.readFile(path.join(idemDir, file), "utf8")) as LegacyDurableRecordContent;
      if (content.recordId && content.stage && content.attempt && content.operation) {
        recordInfoMap.set(content.recordId, {
          stage: content.stage,
          attempt: content.attempt,
          operation: content.operation,
        });
        if (content.identityFingerprint) {
          resToRecordMap.set(content.identityFingerprint, content.recordId);
        }
      }
    }
  }

  // Pass 2: Convert all non-target files to exact v1
  const kinds = ["idempotency", "reservation", "claim", "attempt"] as const;
  for (const kind of kinds) {
    const dir = path.join(executionRoot, kind);
    if (!(await fs.access(dir).then(() => true).catch(() => false))) continue;
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(dir, file);
      const content = JSON.parse(await fs.readFile(filePath, "utf8")) as LegacyDurableRecordContent;

      // If file belongs to target audio attempt 3, keep current v2 format
      let recId = content.recordId ?? content.identity?.recordId;
      if (!recId && content.identity?.identityFingerprint) {
        recId = resToRecordMap.get(content.identity.identityFingerprint);
      }
      if (!recId || recId === targetId.recordId) continue;

      const info = recordInfoMap.get(recId);
      if (!info) continue;

      const { stage, attempt, operation } = info;
      const runType = /^pipeline\.stage\.(initial|resume|retry)$/.exec(operation)?.[1] as "initial" | "resume" | "retry" | undefined;

      if (stage && attempt && runType) {
        const v1Identity = buildVersionedProductionPipelineExecutionIdentity(
          "production-pipeline-identity-v1",
          { projectSlug, stage, runType },
          { id: `${projectSlug}-${stage}`, attempts: attempt - 1 },
        );

        if (content.executionFingerprint) {
          content.executionFingerprint = v1Identity.executionFingerprint;
        }
        if (content.identity?.executionFingerprint) {
          content.identity.executionFingerprint = v1Identity.executionFingerprint;
        }
        if (content.durableLease?.identity?.executionFingerprint) {
          content.durableLease.identity.executionFingerprint = v1Identity.executionFingerprint;
        }

        if (kind === "claim" || kind === "attempt") {
          if (content.identity && "operation" in content.identity) {
            delete content.identity.operation;
          }
        }

        if (content.integrity) {
          if (kind === "idempotency") {
            content.integrity.fingerprint = content.identityFingerprint;
          } else {
            const { integrity: unused, ...body } = content;
            void unused;
            const prefix = kind === "claim" ? "durable-claim-integrity" : "durable-attempt-integrity";
            content.integrity = {
              algorithm: "stable-production-id-v1",
              fingerprint: stableProductionId(prefix, body),
            };
          }
        }

        await fs.writeFile(filePath, JSON.stringify(content, null, 2), "utf8");
      }
    }
  }
}

async function writeJobList(projectSlug: string, jobsMap: Map<string, PipelineJob>, updatedAt: string) {
  await ProjectWriter.writeJSON(projectSlug, "pipeline-jobs.json", {
    projectSlug, jobs: Array.from(jobsMap.values()), createdAt: anchor, updatedAt,
  } satisfies PipelineJobList);
}

interface DurablePhysicalSnapshot {
  readonly fileCount: number;
  readonly files: readonly { relativePath: string; byteLength: number; sha256: string }[];
  readonly aggregateSha256: string;
}

async function durablePhysicalSnapshot(executionRoot: string): Promise<DurablePhysicalSnapshot> {
  const files: Array<{ relativePath: string; byteLength: number; sha256: string }> = [];
  async function visit(directory: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const stat = await fs.lstat(absolute);
      assert.equal(stat.isSymbolicLink(), false, `durable symlink rejected: ${absolute}`);
      if (stat.isDirectory()) await visit(absolute);
      else {
        assert.equal(stat.isFile(), true, `durable special entry rejected: ${absolute}`);
        const bytes = await fs.readFile(absolute);
        files.push({
          relativePath: path.relative(executionRoot, absolute).split(path.sep).join("/"),
          byteLength: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  }
  await visit(executionRoot);
  files.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
  );
  const material = files
    .map((file) => `${file.relativePath}\t${file.byteLength}\t${file.sha256}`)
    .join("\n");
  return {
    fileCount: files.length,
    files,
    aggregateSha256: createHash("sha256").update(material, "utf8").digest("hex"),
  };
}

function adapterWithReadMutation(
  base: ProductionExecutionPersistenceAdapter,
  mutate: (kind: ProductionExecutionPersistenceRecordKind, key: string, value: unknown) => unknown,
): ProductionExecutionPersistenceAdapter {
  return {
    write: base.write.bind(base),
    listKeys: base.listKeys.bind(base),
    read: async (kind, key) => {
      const read = await base.read(kind, key);
      if (read.status !== "found") return read;
      return { ...read, value: mutate(kind, key, structuredClone(read.value)) } as never;
    },
  };
}

async function main() {
  const run = await withCanonicalSmokeRuntime(
    {
      name: "sprint-129-35-legacy-global-quiescence",
      now: anchor,
      operationType: "pipeline-stage-execution",
    },
    async (runtime) => {
      const fixture = await createMixedProductionTopologyFixture(
        runtime.runtimeRoot,
        runtime.projectSlug,
      );
      const beforeSnapshot = await durablePhysicalSnapshot(fixture.executionRoot);

      const recordKeys = await fixture.adapter.listKeys("idempotency");
      assert.equal(recordKeys.ok, true);
      const targetRecordKey = recordKeys.keys.find((k) => k.startsWith(fixture.targetIdentity.recordId));
      assert.ok(targetRecordKey, "target record key found");
      const targetRecordRead = await fixture.adapter.read("idempotency", targetRecordKey);
      assert.equal(targetRecordRead.status, "found");
      const targetReservationId = (targetRecordRead.value as unknown as Record<string, unknown>).identityFingerprint as string;

      // --- TEST 1: Exact topology counts & target vs legacy verifier separation ---
      await test("mixed topology exact counts and target/legacy verifier separation", async () => {
        const reservations = await fixture.adapter.listKeys("reservation");
        const idempotency = await fixture.adapter.listKeys("idempotency");
        assert.equal(reservations.ok, true);
        assert.equal(idempotency.ok, true);
        assert.equal(reservations.keys.length, 18);

        // Target audio attempt 3 passes strict v2 canonical reader
        const targetLineage = await readProductionCanonicalTerminalDurableLineage(
          fixture.adapter,
          fixture.targetIdentity,
          targetReservationId,
          undefined,
          "pipeline.stage.resume",
        );
        assert.equal(targetLineage.record.attempt, 3);
        assert.equal(targetLineage.record.state, "cancelled");
        assert.equal(targetLineage.claim.identity.operation, "pipeline.stage.resume"); // Strict v2!

        // Global quiescence passes with mixed topology
        const quiescent = await validateProductionGlobalTerminalQuiescence(
          fixture.adapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(quiescent, true);

        // Classifier yields exact-drift
        const classification = await classifyQueuedExhaustedPipelineJobDrift({
          projectSlug: fixture.projectSlug,
          stage: targetStage,
          jobs: fixture.jobs,
          history: fixture.history,
          manifest: fixture.manifest,
          adapter: fixture.adapter,
        });
        assert.equal(classification.status, "exact-drift");
      });

      // --- TEST 2: Strict target reader rejects target if mutated to v1 legacy format ---
      await test("target lineage matching legacy v1 format only is strictly rejected for target admission", async () => {
        const mutatedTargetAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "claim" && key.startsWith(fixture.targetIdentity.claimId)) {
            const claim = structuredClone(value) as Record<string, unknown>;
            if (claim.identity && typeof claim.identity === "object") {
              delete (claim.identity as Record<string, unknown>).operation; // strip operation -> v1 format
            }
            return claim;
          }
          return value;
        });

        // Strict target reader must reject
        await assert.rejects(
          () =>
            readProductionCanonicalTerminalDurableLineage(
              mutatedTargetAdapter,
              fixture.targetIdentity,
              targetReservationId,
              undefined,
              "pipeline.stage.resume",
            ),
          /CANONICAL_DURABLE_(IDENTITY_BINDING_MISMATCH|VERSION_INVALID)/,
        );

        // Classifier must reject
        const classification = await classifyQueuedExhaustedPipelineJobDrift({
          projectSlug: fixture.projectSlug,
          stage: targetStage,
          jobs: fixture.jobs,
          history: fixture.history,
          manifest: fixture.manifest,
          adapter: mutatedTargetAdapter,
        });
        assert.equal(classification.status, "rejected");
      });

      const sampleLegacyRecordKey = recordKeys.keys.find((k) => !k.startsWith(fixture.targetIdentity.recordId))!;
      const legacyRecordBaseId = sampleLegacyRecordKey.split("-v")[0];

      const claimKeys = await fixture.adapter.listKeys("claim");
      assert.equal(claimKeys.ok, true);
      const sampleLegacyClaimKey = claimKeys.keys.find((k) => !k.startsWith(fixture.targetIdentity.claimId))!;
      const legacyClaimBaseId = sampleLegacyClaimKey.split("-v")[0];

      const attemptKeys = await fixture.adapter.listKeys("attempt");
      assert.equal(attemptKeys.ok, true);
      const sampleLegacyAttemptKey = attemptKeys.keys.find((k) => !k.startsWith(fixture.targetIdentity.attemptId))!;
      const legacyAttemptBaseId = sampleLegacyAttemptKey.split("-v")[0];

      const reservationKeys = await fixture.adapter.listKeys("reservation");
      assert.equal(reservationKeys.ok, true);
      const legacyReservationKey = reservationKeys.keys.find((k) => k !== targetReservationId)!;

      // --- TEST 3: Negative adversarial matrix (27 cases) ---
      await test("negative matrix 1: legacy record active/reserved hits global-authority gate", async () => {
        const activeRecordAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "idempotency" && key.startsWith(legacyRecordBaseId)) {
            return { ...(value as Record<string, unknown>), state: "reserved" };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          activeRecordAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 2: active lease in legacy lineage is rejected", async () => {
        const activeLeaseAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "idempotency" && key.startsWith(legacyRecordBaseId)) {
            const rec = value as Record<string, unknown>;
            const lease = rec.durableLease as Record<string, unknown>;
            return { ...rec, durableLease: { ...lease, status: "active" } };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          activeLeaseAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 3: active claim in legacy lineage is rejected", async () => {
        const activeClaimAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "claim" && key.startsWith(legacyClaimBaseId)) {
            return { ...(value as Record<string, unknown>), state: "active" };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          activeClaimAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 4: opened attempt in legacy lineage is rejected", async () => {
        const openedAttemptAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "attempt" && key.startsWith(legacyAttemptBaseId)) {
            return { ...(value as Record<string, unknown>), state: "opened" };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          openedAttemptAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 5: active attempt in legacy lineage is rejected", async () => {
        const activeAttemptAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "attempt" && key.startsWith(legacyAttemptBaseId)) {
            return { ...(value as Record<string, unknown>), state: "active" };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          activeAttemptAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 6: legacy execution fingerprint mutation is rejected", async () => {
        const mutatedFpAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "idempotency" && key.startsWith(legacyRecordBaseId)) {
            return { ...(value as Record<string, unknown>), executionFingerprint: "pipeline-execution-mutated" };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          mutatedFpAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 7: operation mutation in legacy record is rejected", async () => {
        const mutatedOpAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "idempotency" && key.startsWith(legacyRecordBaseId)) {
            return { ...(value as Record<string, unknown>), operation: "pipeline.stage.invalid" };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          mutatedOpAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 8: run-type mutation in legacy record is rejected", async () => {
        const mutatedRunTypeAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "idempotency" && key.startsWith(legacyRecordBaseId)) {
            return { ...(value as Record<string, unknown>), operation: "invalid-grammar" };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          mutatedRunTypeAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 9: record/reservation mismatch in legacy lineage is rejected", async () => {
        const mismatchAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "reservation" && key === legacyReservationKey) {
            const res = value as Record<string, unknown>;
            const identity = res.identity as Record<string, unknown>;
            return { ...res, identity: { ...identity, requestId: "pipeline-request-wrong" } };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          mismatchAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 10: record/lease mismatch in legacy lineage is rejected", async () => {
        const mismatchAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "idempotency" && key.startsWith(legacyRecordBaseId)) {
            const rec = value as Record<string, unknown>;
            const lease = rec.durableLease as Record<string, unknown>;
            const identity = lease.identity as Record<string, unknown>;
            return {
              ...rec,
              durableLease: {
                ...lease,
                identity: { ...identity, leaseId: "pipeline-lease-wrong" },
              },
            };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          mismatchAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 11: claim/attempt cross-binding mismatch is rejected", async () => {
        const mismatchAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "attempt" && key.startsWith(legacyAttemptBaseId)) {
            const att = value as Record<string, unknown>;
            const binding = att.binding as Record<string, unknown>;
            return { ...att, binding: { ...binding, reservationVersion: 99 } };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          mismatchAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 12: version gap in legacy record series is rejected", async () => {
        const gapAdapter: ProductionExecutionPersistenceAdapter = {
          write: fixture.adapter.write.bind(fixture.adapter),
          read: fixture.adapter.read.bind(fixture.adapter),
          listKeys: async (kind) => {
            const listed = await fixture.adapter.listKeys(kind);
            if (!listed.ok) return listed;
            if (kind === "idempotency") {
              return { ...listed, keys: listed.keys.filter((k) => !k.endsWith("-v2")) };
            }
            return listed;
          },
        };
        const res = await validateProductionGlobalTerminalQuiescence(
          gapAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 13: duplicate/ambiguous version key is rejected", async () => {
        const duplicateAdapter: ProductionExecutionPersistenceAdapter = {
          write: fixture.adapter.write.bind(fixture.adapter),
          read: fixture.adapter.read.bind(fixture.adapter),
          listKeys: async (kind) => {
            const listed = await fixture.adapter.listKeys(kind);
            if (!listed.ok) return listed;
            if (kind === "idempotency") {
              return { ...listed, keys: [...listed.keys, `${legacyRecordBaseId}-v1`] };
            }
            return listed;
          },
        };
        const res = await validateProductionGlobalTerminalQuiescence(
          duplicateAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 14: immutable identity change across versions is rejected", async () => {
        const mutatedAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "idempotency" && key.endsWith("-v1") && !key.startsWith(fixture.targetIdentity.recordId)) {
            return { ...(value as Record<string, unknown>), stage: "visuals" };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          mutatedAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 15: orphan reservation is rejected", async () => {
        const orphanAdapter: ProductionExecutionPersistenceAdapter = {
          write: fixture.adapter.write.bind(fixture.adapter),
          read: async (kind, key) => {
            if (kind === "reservation" && key === "idempotency-identity-orphan") {
              return {
                ok: true,
                status: "found",
                kind,
                key,
                value: {
                  schemaVersion: "1",
                  identity: {
                    schemaVersion: "1",
                    identityFingerprint: "idempotency-identity-orphan",
                    projectSlug: fixture.projectSlug,
                    stage: "research",
                  },
                },
              } as never;
            }
            return fixture.adapter.read(kind, key);
          },
          listKeys: async (kind) => {
            const listed = await fixture.adapter.listKeys(kind);
            if (!listed.ok) return listed;
            if (kind === "reservation") {
              return { ...listed, keys: [...listed.keys, "idempotency-identity-orphan"] };
            }
            return listed;
          },
        };
        const res = await validateProductionGlobalTerminalQuiescence(
          orphanAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 16: orphan claim is rejected", async () => {
        const orphanAdapter: ProductionExecutionPersistenceAdapter = {
          write: fixture.adapter.write.bind(fixture.adapter),
          read: fixture.adapter.read.bind(fixture.adapter),
          listKeys: async (kind) => {
            const listed = await fixture.adapter.listKeys(kind);
            if (!listed.ok) return listed;
            if (kind === "claim") {
              return { ...listed, keys: [...listed.keys, "pipeline-claim-orphan-v1"] };
            }
            return listed;
          },
        };
        const res = await validateProductionGlobalTerminalQuiescence(
          orphanAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 17: orphan attempt is rejected", async () => {
        const orphanAdapter: ProductionExecutionPersistenceAdapter = {
          write: fixture.adapter.write.bind(fixture.adapter),
          read: fixture.adapter.read.bind(fixture.adapter),
          listKeys: async (kind) => {
            const listed = await fixture.adapter.listKeys(kind);
            if (!listed.ok) return listed;
            if (kind === "attempt") {
              return { ...listed, keys: [...listed.keys, "pipeline-attempt-orphan-v1"] };
            }
            return listed;
          },
        };
        const res = await validateProductionGlobalTerminalQuiescence(
          orphanAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 18: missing reservation is rejected", async () => {
        const missingResAdapter: ProductionExecutionPersistenceAdapter = {
          write: fixture.adapter.write.bind(fixture.adapter),
          read: async (kind, key) => {
            if (kind === "reservation" && key === legacyReservationKey) {
              return { ok: false, status: "not-found", kind, key, errorCode: "PERSISTENCE_NOT_FOUND" } as never;
            }
            return fixture.adapter.read(kind, key);
          },
          listKeys: async (kind) => {
            const listed = await fixture.adapter.listKeys(kind);
            if (!listed.ok) return listed;
            if (kind === "reservation") {
              return { ...listed, keys: listed.keys.filter((k) => k !== legacyReservationKey) };
            }
            return listed;
          },
        };
        const res = await validateProductionGlobalTerminalQuiescence(
          missingResAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 19: foreign project in reservation is rejected", async () => {
        const foreignSlugAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "reservation" && key === legacyReservationKey) {
            const res = value as Record<string, unknown>;
            const identity = res.identity as Record<string, unknown>;
            return { ...res, identity: { ...identity, projectSlug: "foreign-project" } };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          foreignSlugAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 20: foreign stage in record is rejected", async () => {
        const foreignStageAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "idempotency" && key.startsWith(legacyRecordBaseId)) {
            return { ...(value as Record<string, unknown>), stage: "unknown-stage" };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          foreignStageAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 21: unsupported legacy identity version (unknown schema) is rejected", async () => {
        const unsupportedSchemaAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "idempotency" && key.startsWith(legacyRecordBaseId)) {
            return { ...(value as Record<string, unknown>), schemaVersion: "99" };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          unsupportedSchemaAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 22: malformed payload in claim is rejected", async () => {
        const malformedClaimAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "claim" && key.startsWith(legacyClaimBaseId)) {
            return { ...(value as Record<string, unknown>), schemaVersion: "invalid" };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          malformedClaimAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 23: corrupt integrity in attempt is rejected", async () => {
        const corruptIntegrityAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "attempt" && key.startsWith(legacyAttemptBaseId)) {
            const att = value as Record<string, unknown>;
            const integrity = att.integrity as Record<string, unknown>;
            return { ...att, integrity: { ...integrity, fingerprint: "corrupt-fingerprint" } };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          corruptIntegrityAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 24: success record + failed attempt mismatch is rejected", async () => {
        const mismatchAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "attempt" && key.startsWith(legacyAttemptBaseId)) {
            // attempt state succeeded, but record state cancelled
            return { ...(value as Record<string, unknown>), state: "succeeded" };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          mismatchAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 25: failed record + released success claim mismatch is rejected", async () => {
        const mismatchAdapter = adapterWithReadMutation(fixture.adapter, (kind, key, value) => {
          if (kind === "claim" && key.startsWith(legacyClaimBaseId)) {
            // record is cancelled/failed, but claim state is released (success)
            return { ...(value as Record<string, unknown>), state: "released" };
          }
          return value;
        });
        const res = await validateProductionGlobalTerminalQuiescence(
          mismatchAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 26: extra unconsumed durable object is rejected", async () => {
        const extraAdapter: ProductionExecutionPersistenceAdapter = {
          write: fixture.adapter.write.bind(fixture.adapter),
          read: fixture.adapter.read.bind(fixture.adapter),
          listKeys: async (kind) => {
            const listed = await fixture.adapter.listKeys(kind);
            if (!listed.ok) return listed;
            if (kind === "claim") {
              return { ...listed, keys: [...listed.keys, "extra-unconsumed-claim-v1"] };
            }
            return listed;
          },
        };
        const res = await validateProductionGlobalTerminalQuiescence(
          extraAdapter,
          fixture.projectSlug,
          fixture.targetIdentity,
        );
        assert.equal(res, false);
      });

      await test("negative matrix 27: target identity mismatch is rejected", async () => {
        const wrongTargetIdentity = buildProductionPipelineExecutionIdentity(
          { projectSlug: fixture.projectSlug, stage: "research", runType: "initial" },
          { id: `${fixture.projectSlug}-research`, attempts: 0 },
        );
        const classification = await classifyQueuedExhaustedPipelineJobDrift({
          projectSlug: fixture.projectSlug,
          stage: targetStage,
          jobs: fixture.jobs,
          history: fixture.history,
          manifest: fixture.manifest,
          adapter: fixture.adapter,
        });
        assert.equal(classification.status, "exact-drift");
        // Target mismatch when calling quiescence directly with wrong identity:
        const res = await validateProductionGlobalTerminalQuiescence(
          fixture.adapter,
          fixture.projectSlug,
          wrongTargetIdentity,
        );
        assert.equal(res, false);
      });

      // --- TEST 4: Physical byte immutability ---
      await test("physical byte immutability: aggregate SHA-256 and file inventory remain 100% byte-identical", async () => {
        const afterSnapshot = await durablePhysicalSnapshot(fixture.executionRoot);
        assert.equal(afterSnapshot.fileCount, beforeSnapshot.fileCount);
        assert.deepEqual(afterSnapshot.files, beforeSnapshot.files);
        assert.equal(afterSnapshot.aggregateSha256, beforeSnapshot.aggregateSha256);
      });

      // --- TEST 5: CLI Error Sanitization ---
      await test("CLI sanitized error contract includes PIPELINE_RETRY_DURABLE_CONFLICT", async () => {
        const durableConflictError = new ProductionPipelineDurableExecutionError(
          "durable conflict",
          "PIPELINE_RETRY_DURABLE_CONFLICT",
        );

        const commandResult = await runProductionAcceptanceCommand(
          ["resume-finalize", `--project-slug=${fixture.projectSlug}`, "--confirm-production-acceptance"],
          {
            readiness: async () => ({ ready: true, checks: [] } as never),
            execute: async () => ({ completion: {} } as never),
            resume: async () => {
              throw durableConflictError;
            },
          },
        );

        assert.equal(commandResult.exitCode, 1);
        assert.equal(commandResult.report.errorCode, "PIPELINE_RETRY_DURABLE_CONFLICT");
        assert.equal("stack" in commandResult.report, false);
        assert.equal("secret" in commandResult.report, false);
        assert.equal("path" in commandResult.report, false);
      });

      await test("CLI masks unknown/unauthenticated error as generic PRODUCTION_ACCEPTANCE_COMMAND_FAILED", async () => {
        const unknownError = new Error("raw internal exception with secret /path/to/key");

        const commandResult = await runProductionAcceptanceCommand(
          ["resume-finalize", `--project-slug=${fixture.projectSlug}`, "--confirm-production-acceptance"],
          {
            readiness: async () => ({ ready: true, checks: [] } as never),
            execute: async () => ({ completion: {} } as never),
            resume: async () => {
              throw unknownError;
            },
          },
        );

        assert.equal(commandResult.exitCode, 1);
        assert.equal(commandResult.report.errorCode, "PRODUCTION_ACCEPTANCE_COMMAND_FAILED");
        assert.equal(JSON.stringify(commandResult.report).includes("secret"), false);
        assert.equal(JSON.stringify(commandResult.report).includes("/path/to/key"), false);
      });
    },
  );

  assert.equal(run.finalization.cleanupCompleted, true);
  assert.equal(run.finalization.runtimeRemainder, 0);
  assert.equal(run.finalization.authorityRemainder, 0);
  assert.equal(run.finalization.lockGateQuarantineRemainder, 0);
  assert.equal(run.finalization.newlyCreatedGlobalInventory.length, 0);
  emitSmokeResult("sprint-129-35-legacy-global-quiescence", passed);
}

void main().catch((error) => {
  process.stderr.write(
    `Sprint 129.35 legacy global quiescence smoke FAILED: ${
      error instanceof Error ? error.stack ?? error.message : "unknown"
    }\n`,
  );
  process.exitCode = 1;
});
