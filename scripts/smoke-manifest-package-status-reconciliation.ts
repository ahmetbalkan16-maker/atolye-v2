import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { emitSmokeResult } from "./lib/SmokeResult";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import { runWithProductionRuntimeOperationContext } from "../src/lib/runtime/RuntimeOperationScope";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import type { PipelineJob, PipelineJobHistoryEvent, PipelineJobList } from
  "../src/types/pipelineJob";
import type { PackageStatus, ProductionStepKey } from "../src/types/project";

/**
 * reconcileManifestPackageStatusFromHistory smoke suite.
 *
 * Proves the manifest-side sibling of reconcilePipelineJobAttemptDriftFromHistory
 * against the exact real-world corruption pattern found in the real
 * i-stanbul-un-fethi-1453 project: manifest.packages.assembly.status="pending"
 * while completedAt/attempts.total/pipeline-history all prove the package's
 * last real execution failed. Reproduced here ONLY as a synthetic, isolated
 * fixture — real project data is never read or written by this suite.
 *
 * Isolation mirrors smoke-pipeline-job-attempt-drift-reconciliation.ts: a
 * fresh createRuntimeStorageContext bound via
 * runWithProductionRuntimeOperationContext().
 */

const stage: ProductionStepKey = "assembly";
const otherStage: ProductionStepKey = "thumbnail";
const timestamp0 = "2026-08-20T00:00:00.000Z";

let scenarios = 0;
async function scenario(name: string, action: () => Promise<void> | void): Promise<void> {
  await action();
  scenarios += 1;
  process.stdout.write(`PASS ${scenarios}: ${name}\n`);
}

function historyEvent(overrides: Partial<PipelineJobHistoryEvent> &
  { id: string; jobId: string; stage: ProductionStepKey }): PipelineJobHistoryEvent {
  return {
    status: "failed", jobCreatedAt: timestamp0, jobUpdatedAt: timestamp0,
    recordedAt: timestamp0,
    ...overrides,
  };
}

function freshProjectSlug(): string {
  return `manifest-reconcile-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

interface PackageSpec {
  readonly status: PackageStatus;
  readonly completedAt?: string;
  readonly startedAt?: string;
  readonly attemptsTotal?: number;
  readonly generationOrdinal?: number;
  readonly regenerationId?: string;
}

interface Fixture {
  readonly tempRoot: string;
  readonly projectSlug: string;
  readonly operationContext: ReturnType<typeof createProductionRuntimeOperationContext>;
  readonly projectRoot: string;
}

function buildManifestRaw(
  projectSlug: string,
  projectId: string,
  packages: Partial<Record<ProductionStepKey, PackageSpec>>,
  manifestUpdatedAt: string,
): Record<string, unknown> {
  const packagesRaw: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(packages)) {
    packagesRaw[key] = {
      key, status: spec.status, fileName: `${key}.json`, updatedAt: timestamp0,
      startedAt: spec.startedAt, completedAt: spec.completedAt,
      attempts: spec.attemptsTotal !== undefined ? { total: spec.attemptsTotal, retry: 0 } : undefined,
      generationOrdinal: spec.generationOrdinal, regenerationId: spec.regenerationId,
    };
  }
  return {
    project: { id: projectId, slug: projectSlug, title: "Manifest Reconciliation Fixture",
      status: "assembly", createdAt: timestamp0, updatedAt: timestamp0 },
    projectId, slug: projectSlug, version: 1, packages: packagesRaw,
    createdAt: timestamp0, updatedAt: manifestUpdatedAt,
  };
}

async function buildFixture(options: {
  projectSlug: string;
  packages: Partial<Record<ProductionStepKey, PackageSpec>>;
  manifestUpdatedAt: string;
  events: readonly PipelineJobHistoryEvent[];
  jobs?: readonly PipelineJob[];
}): Promise<Fixture> {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-manifest-reconcile-"));
  const projectSlug = options.projectSlug;
  const projectId = `${projectSlug}-id`;

  const storageContext = createRuntimeStorageContext({
    workspaceRoot: tempRoot,
    environment: {
      ATOLYE_RUNTIME_ROOT: path.join(tempRoot, "data"),
      ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(tempRoot, "authority"),
    },
  });
  const operationContext = createProductionRuntimeOperationContext({
    operationId: `manifest-reconcile-${crypto.randomUUID()}`,
    operationType: "manifest-reconcile-smoke",
    authorityGeneration: initialRuntimeAuthorityGeneration,
    storageContext,
  });

  const projectRoot = path.join(storageContext.projectsRoot, projectSlug);
  fs.mkdirSync(projectRoot, { recursive: true });

  fs.writeFileSync(path.join(projectRoot, "project.json"), JSON.stringify({
    id: projectId, slug: projectSlug, title: "Manifest Reconciliation Fixture",
    status: "assembly", createdAt: timestamp0, updatedAt: timestamp0,
  }, null, 2) + "\n");

  fs.writeFileSync(path.join(projectRoot, "manifest.json"), JSON.stringify(
    buildManifestRaw(projectSlug, projectId, options.packages, options.manifestUpdatedAt),
    null, 2) + "\n");

  fs.writeFileSync(path.join(projectRoot, "pipeline-history.json"), JSON.stringify({
    projectSlug, createdAt: timestamp0, updatedAt: timestamp0,
    events: options.events,
  }, null, 2) + "\n");

  const jobList: PipelineJobList = {
    projectSlug, createdAt: timestamp0, updatedAt: timestamp0,
    jobs: (options.jobs ?? []).map((job) => ({ ...job, projectSlug })),
  };
  fs.writeFileSync(path.join(projectRoot, "pipeline-jobs.json"), JSON.stringify(jobList, null, 2) + "\n");

  return { tempRoot, projectSlug, operationContext, projectRoot };
}

async function cleanup(fixture: Fixture): Promise<void> {
  await fsp.rm(fixture.tempRoot, { recursive: true, force: true });
}

function manifestFileBytes(fixture: Fixture): Buffer {
  return fs.readFileSync(path.join(fixture.projectRoot, "manifest.json"));
}

function readManifest(fixture: Fixture): { updatedAt: string;
  packages: Record<string, { status: string; completedAt?: string; startedAt?: string;
    updatedAt?: string; attempts?: { total: number }; generationOrdinal?: number;
    regenerationId?: string }> } {
  return JSON.parse(fs.readFileSync(path.join(fixture.projectRoot, "manifest.json"), "utf8"));
}

function run<T>(fixture: Fixture, action: () => Promise<T>): Promise<T> {
  return runWithProductionRuntimeOperationContext(fixture.operationContext, action);
}

// The exact real corruption shape: 6 lifetime terminal events split 3/3
// across two generations, manifest left at status="pending" with
// completedAt/startedAt/attempts.total all reflecting the real last
// (failed) execution.
function realCorruptionEvents(jobId: string): PipelineJobHistoryEvent[] {
  return [1, 2, 3, 4, 5, 6].map((n) => historyEvent({
    id: `${jobId}-failed-${n}`, jobId, stage, status: "failed",
    recordedAt: `2026-08-20T00:0${n}:00.000Z`,
    generationOrdinal: n <= 3 ? 1 : 2, attemptWithinGeneration: n <= 3 ? n - 1 : n - 4,
  }));
}

const corruptedAssembly: PackageSpec = {
  status: "pending", completedAt: "2026-08-20T00:06:00.000Z", startedAt: "2026-08-20T00:05:50.000Z",
  attemptsTotal: 6, generationOrdinal: 2, regenerationId: "pipeline-regen-fixture-gen2",
};

async function main() {
  // ═══════════ 1) Real corruption pattern → reconcile succeeds ═══════════
  await scenario("real corruption pattern: pending+completedAt+6-terminal-failed -> reconciled to failed", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const fixture = await buildFixture({
      projectSlug,
      packages: { assembly: corruptedAssembly },
      manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
      events: realCorruptionEvents(jobId),
    });
    try {
      const expected = {
        manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
        packageSnapshot: {
          status: "pending" as const, completedAt: corruptedAssembly.completedAt,
          startedAt: corruptedAssembly.startedAt, attemptsTotal: 6,
          generationOrdinal: 2, regenerationId: "pipeline-regen-fixture-gen2",
        },
      };
      const result = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, stage, expected));
      assert.equal(result.ok, true);
      assert.equal(result.reasonCode, "MANIFEST_PACKAGE_STATUS_DRIFT_RECONCILED");
      assert.equal(result.writeFree, false);
      assert.equal(result.canonicalStatus, "failed");
      const written = readManifest(fixture);
      assert.equal(written.packages.assembly.status, "failed");
      // Only status (and the package's own updatedAt) change — everything
      // else is preserved exactly as evidence proved it.
      assert.equal(written.packages.assembly.completedAt, corruptedAssembly.completedAt);
      assert.equal(written.packages.assembly.startedAt, corruptedAssembly.startedAt);
      assert.equal(written.packages.assembly.attempts?.total, 6);
      assert.equal(written.packages.assembly.generationOrdinal, 2);
      assert.equal(written.packages.assembly.regenerationId, "pipeline-regen-fixture-gen2");
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 2) Already canonical (failed) → write-free no-op ═══════════
  await scenario("already failed and evidence-consistent: write-free no-op", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const fixture = await buildFixture({
      projectSlug,
      packages: { assembly: { ...corruptedAssembly, status: "failed" } },
      manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
      events: realCorruptionEvents(jobId),
    });
    try {
      const before = manifestFileBytes(fixture);
      const result = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, stage,
          {
            manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
            packageSnapshot: { status: "failed", completedAt: corruptedAssembly.completedAt,
              startedAt: corruptedAssembly.startedAt, attemptsTotal: 6,
              generationOrdinal: 2, regenerationId: "pipeline-regen-fixture-gen2" },
          }));
      assert.equal(result.ok, true);
      assert.equal(result.reasonCode, "MANIFEST_PACKAGE_STATUS_DRIFT_ALREADY_RECONCILED");
      assert.equal(result.writeFree, true);
      assert.deepEqual(manifestFileBytes(fixture), before);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 3) completed → reject, never overwritten ═══════════
  await scenario("status=completed: rejected, never touched even if history looks failed-shaped", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const fixture = await buildFixture({
      projectSlug,
      packages: { assembly: { ...corruptedAssembly, status: "completed" } },
      manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
      events: realCorruptionEvents(jobId),
    });
    try {
      const before = manifestFileBytes(fixture);
      const result = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, stage,
          { manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
            packageSnapshot: { status: "completed", completedAt: corruptedAssembly.completedAt,
              startedAt: corruptedAssembly.startedAt, attemptsTotal: 6,
              generationOrdinal: 2, regenerationId: "pipeline-regen-fixture-gen2" } }));
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "MANIFEST_PACKAGE_STATUS_DRIFT_STATUS_INELIGIBLE");
      assert.deepEqual(manifestFileBytes(fixture), before);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 4) running → reject ═══════════
  await scenario("status=running: rejected, in-flight execution never touched", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const fixture = await buildFixture({
      projectSlug,
      packages: { assembly: { status: "running", startedAt: "2026-08-20T00:05:50.000Z",
        attemptsTotal: 7, generationOrdinal: 2, regenerationId: "pipeline-regen-fixture-gen2" } },
      manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
      events: realCorruptionEvents(jobId),
    });
    try {
      const before = manifestFileBytes(fixture);
      const result = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, stage,
          { manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
            packageSnapshot: { status: "running", completedAt: undefined,
              startedAt: "2026-08-20T00:05:50.000Z", attemptsTotal: 7,
              generationOrdinal: 2, regenerationId: "pipeline-regen-fixture-gen2" } }));
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "MANIFEST_PACKAGE_STATUS_DRIFT_STATUS_INELIGIBLE");
      assert.deepEqual(manifestFileBytes(fixture), before);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 5) pending + no completedAt → reject (legitimate state) ═══════════
  await scenario("pending with no completedAt: the ordinary post-regeneration-prep state, rejected as nothing-to-repair", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const fixture = await buildFixture({
      projectSlug,
      packages: { assembly: { status: "pending", attemptsTotal: 3,
        generationOrdinal: 2, regenerationId: "pipeline-regen-fixture-gen2" } },
      manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
      events: realCorruptionEvents(jobId).slice(0, 3),
    });
    try {
      const before = manifestFileBytes(fixture);
      const result = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, stage,
          { manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
            packageSnapshot: { status: "pending", completedAt: undefined, startedAt: undefined,
              attemptsTotal: 3, generationOrdinal: 2, regenerationId: "pipeline-regen-fixture-gen2" } }));
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "MANIFEST_PACKAGE_STATUS_DRIFT_PENDING_WITHOUT_COMPLETION_EVIDENCE");
      assert.deepEqual(manifestFileBytes(fixture), before);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 6) history/attempt mismatch → reject ═══════════
  await scenario("manifest attempts.total disagrees with history terminal count: rejected", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    // manifest claims 6, but only 4 terminal events exist.
    const events = realCorruptionEvents(jobId).slice(0, 4);
    const fixture = await buildFixture({
      projectSlug,
      packages: { assembly: corruptedAssembly },
      manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
      events,
    });
    try {
      const before = manifestFileBytes(fixture);
      const result = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, stage,
          { manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
            packageSnapshot: { status: "pending", completedAt: corruptedAssembly.completedAt,
              startedAt: corruptedAssembly.startedAt, attemptsTotal: 6,
              generationOrdinal: 2, regenerationId: "pipeline-regen-fixture-gen2" } }));
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "MANIFEST_PACKAGE_STATUS_DRIFT_HISTORY_MANIFEST_MISMATCH");
      assert.deepEqual(manifestFileBytes(fixture), before);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 7) multi-stage isolation ═══════════
  await scenario("multi-stage isolation: reconciling assembly never touches an independently-corrupted thumbnail package", async () => {
    const projectSlug = freshProjectSlug();
    const assemblyJobId = `${projectSlug}-assembly`;
    const thumbnailJobId = `${projectSlug}-thumbnail`;
    const thumbnailEvents = [1, 2, 3].map((n) => historyEvent({
      id: `${thumbnailJobId}-failed-${n}`, jobId: thumbnailJobId, stage: otherStage, status: "failed",
      recordedAt: `2026-08-20T00:1${n}:00.000Z`,
    }));
    const fixture = await buildFixture({
      projectSlug,
      packages: {
        assembly: corruptedAssembly,
        thumbnail: { status: "pending", completedAt: "2026-08-20T00:13:00.000Z",
          startedAt: "2026-08-20T00:12:50.000Z", attemptsTotal: 3 },
      },
      manifestUpdatedAt: "2026-08-20T00:13:00.000Z",
      events: [...realCorruptionEvents(assemblyJobId), ...thumbnailEvents],
    });
    try {
      const thumbnailBefore = JSON.stringify(readManifest(fixture).packages.thumbnail);
      const result = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, stage,
          { manifestUpdatedAt: "2026-08-20T00:13:00.000Z",
            packageSnapshot: { status: "pending", completedAt: corruptedAssembly.completedAt,
              startedAt: corruptedAssembly.startedAt, attemptsTotal: 6,
              generationOrdinal: 2, regenerationId: "pipeline-regen-fixture-gen2" } }));
      assert.equal(result.ok, true);
      assert.equal(readManifest(fixture).packages.assembly.status, "failed");
      assert.equal(JSON.stringify(readManifest(fixture).packages.thumbnail), thumbnailBefore,
        "thumbnail package must be completely untouched");

      // Reconcile thumbnail on its own too — proves per-package isolation
      // both directions.
      const assemblyAfterFirst = JSON.stringify(readManifest(fixture).packages.assembly);
      const manifestUpdatedAtAfterFirst = readManifest(fixture).updatedAt;
      const thumbResult = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, otherStage,
          { manifestUpdatedAt: manifestUpdatedAtAfterFirst,
            packageSnapshot: { status: "pending", completedAt: "2026-08-20T00:13:00.000Z",
              startedAt: "2026-08-20T00:12:50.000Z", attemptsTotal: 3,
              generationOrdinal: undefined, regenerationId: undefined } }));
      assert.equal(thumbResult.ok, true);
      assert.equal(readManifest(fixture).packages.thumbnail.status, "failed");
      assert.equal(JSON.stringify(readManifest(fixture).packages.assembly), assemblyAfterFirst,
        "assembly package must be completely untouched by the thumbnail reconciliation");
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 8) CAS snapshot mismatch (multiple axes) ═══════════
  await scenario("CAS conflict: wrong manifestUpdatedAt / wrong packageSnapshot field / wrong fingerprint each refuse, byte-identical", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const fixture = await buildFixture({
      projectSlug,
      packages: { assembly: corruptedAssembly },
      manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
      events: realCorruptionEvents(jobId),
    });
    try {
      const before = manifestFileBytes(fixture);
      const correctSnapshot = { status: "pending" as const, completedAt: corruptedAssembly.completedAt,
        startedAt: corruptedAssembly.startedAt, attemptsTotal: 6,
        generationOrdinal: 2, regenerationId: "pipeline-regen-fixture-gen2" };

      const wrongManifestUpdatedAt = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, stage,
          { manifestUpdatedAt: "2099-01-01T00:00:00.000Z", packageSnapshot: correctSnapshot }));
      assert.equal(wrongManifestUpdatedAt.ok, false);
      assert.equal(wrongManifestUpdatedAt.reasonCode, "MANIFEST_PACKAGE_STATUS_DRIFT_CAS_CONFLICT");

      const wrongAttemptsTotal = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, stage,
          { manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
            packageSnapshot: { ...correctSnapshot, attemptsTotal: 999 } }));
      assert.equal(wrongAttemptsTotal.ok, false);
      assert.equal(wrongAttemptsTotal.reasonCode, "MANIFEST_PACKAGE_STATUS_DRIFT_CAS_CONFLICT");

      const wrongFingerprint = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, stage,
          { manifestUpdatedAt: "2026-08-20T00:06:00.000Z", packageSnapshot: correctSnapshot,
            packageFingerprint: "not-the-real-fingerprint" }));
      assert.equal(wrongFingerprint.ok, false);
      assert.equal(wrongFingerprint.reasonCode, "MANIFEST_PACKAGE_STATUS_DRIFT_CAS_CONFLICT");

      assert.deepEqual(manifestFileBytes(fixture), before);

      // Sanity: the correct snapshot (no fingerprint pinned) is accepted.
      const accepted = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, stage,
          { manifestUpdatedAt: "2026-08-20T00:06:00.000Z", packageSnapshot: correctSnapshot }));
      assert.equal(accepted.ok, true);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 9) Concurrent/stale manifest (generic) ═══════════
  await scenario("concurrent modification between snapshot capture and reconciliation call: CAS rejects the now-stale snapshot", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const fixture = await buildFixture({
      projectSlug,
      packages: { assembly: corruptedAssembly },
      manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
      events: realCorruptionEvents(jobId),
    });
    try {
      const expected = { manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
        packageSnapshot: { status: "pending" as const, completedAt: corruptedAssembly.completedAt,
          startedAt: corruptedAssembly.startedAt, attemptsTotal: 6,
          generationOrdinal: 2, regenerationId: "pipeline-regen-fixture-gen2" } };

      // A concurrent process fully rewrites the manifest (e.g. a real
      // running->failed transition elsewhere) before this call runs.
      const currentManifest = readManifest(fixture);
      const concurrentlyModified = {
        ...currentManifest,
        packages: { ...currentManifest.packages,
          assembly: { ...currentManifest.packages.assembly, status: "running", completedAt: undefined } },
        updatedAt: "2026-08-20T12:00:00.000Z",
      };
      fs.writeFileSync(path.join(fixture.projectRoot, "manifest.json"),
        JSON.stringify(concurrentlyModified, null, 2) + "\n");
      const afterConcurrentWrite = manifestFileBytes(fixture);

      const result = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, stage, expected));
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "MANIFEST_PACKAGE_STATUS_DRIFT_CAS_CONFLICT");
      assert.deepEqual(manifestFileBytes(fixture), afterConcurrentWrite,
        "the concurrent writer's state must be preserved untouched");
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 10) Ambiguous terminal evidence ═══════════
  await scenario("latest terminal history event is not 'failed': rejected as ambiguous evidence", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    // 6 terminal events (count matches manifest), but the LATEST one is
    // "cancelled", not "failed" -- manifest's "pending" cannot be safely
    // repaired to "failed" here.
    const events = [1, 2, 3, 4, 5].map((n) => historyEvent({
      id: `${jobId}-failed-${n}`, jobId, stage, status: "failed",
      recordedAt: `2026-08-20T00:0${n}:00.000Z`,
    })).concat([historyEvent({
      id: `${jobId}-cancelled-6`, jobId, stage, status: "cancelled",
      recordedAt: "2026-08-20T00:06:00.000Z",
    })]);
    const fixture = await buildFixture({
      projectSlug,
      packages: { assembly: corruptedAssembly },
      manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
      events,
    });
    try {
      const before = manifestFileBytes(fixture);
      const result = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, stage,
          { manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
            packageSnapshot: { status: "pending", completedAt: corruptedAssembly.completedAt,
              startedAt: corruptedAssembly.startedAt, attemptsTotal: 6,
              generationOrdinal: 2, regenerationId: "pipeline-regen-fixture-gen2" } }));
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "MANIFEST_PACKAGE_STATUS_DRIFT_AMBIGUOUS_EVIDENCE");
      assert.deepEqual(manifestFileBytes(fixture), before);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 11) Generation boundary ═══════════
  await scenario("generation boundary: lifetime history spanning two generations reconciles correctly; generationOrdinal/regenerationId preserved untouched", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const fixture = await buildFixture({
      projectSlug,
      packages: { assembly: corruptedAssembly }, // 3 events gen1 + 3 events gen2
      manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
      events: realCorruptionEvents(jobId),
    });
    try {
      const result = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, stage,
          { manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
            packageSnapshot: { status: "pending", completedAt: corruptedAssembly.completedAt,
              startedAt: corruptedAssembly.startedAt, attemptsTotal: 6,
              generationOrdinal: 2, regenerationId: "pipeline-regen-fixture-gen2" } }));
      assert.equal(result.ok, true);
      const written = readManifest(fixture).packages.assembly;
      assert.equal(written.status, "failed");
      // generationOrdinal/regenerationId are NEVER touched by this repair.
      assert.equal(written.generationOrdinal, 2);
      assert.equal(written.regenerationId, "pipeline-regen-fixture-gen2");
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 12) Job-attempt reconciliation regression (both mechanisms coexist) ═══════════
  await scenario("job-attempt reconciliation regression: both reconciliation functions succeed independently in the same fixture, neither touches the other's file", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const job: PipelineJob = {
      id: jobId, projectSlug: "x", stage, title: "Video Editing", status: "queued",
      attempts: 3, createdAt: timestamp0, updatedAt: timestamp0,
      generationOrdinal: 2, attemptWithinGeneration: 0,
    };
    const fixture = await buildFixture({
      projectSlug,
      packages: { assembly: corruptedAssembly },
      manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
      events: realCorruptionEvents(jobId),
      jobs: [job],
    });
    try {
      const jobsBefore = fs.readFileSync(path.join(fixture.projectRoot, "pipeline-jobs.json"));

      const manifestResult = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, stage,
          { manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
            packageSnapshot: { status: "pending", completedAt: corruptedAssembly.completedAt,
              startedAt: corruptedAssembly.startedAt, attemptsTotal: 6,
              generationOrdinal: 2, regenerationId: "pipeline-regen-fixture-gen2" } }));
      assert.equal(manifestResult.ok, true);
      // reconcileManifestPackageStatusFromHistory must never touch pipeline-jobs.json.
      assert.deepEqual(fs.readFileSync(path.join(fixture.projectRoot, "pipeline-jobs.json")), jobsBefore);

      const manifestAfterManifestCall = manifestFileBytes(fixture);
      const jobResult = await run(fixture, () =>
        PipelineJobManager.reconcilePipelineJobAttemptDriftFromHistory(
          fixture.projectSlug, jobId, { updatedAt: job.updatedAt, attempts: job.attempts }));
      assert.equal(jobResult.ok, true);
      assert.equal(jobResult.reasonCode, "PIPELINE_JOB_ATTEMPT_DRIFT_RECONCILED");
      // reconcilePipelineJobAttemptDriftFromHistory must never touch manifest.json.
      assert.deepEqual(manifestFileBytes(fixture), manifestAfterManifestCall);
    } finally { await cleanup(fixture); }
  });

  // ═══════════ 13) updatePackageUsage-shaped stale-write race ═══════════
  await scenario("updatePackageUsage-shaped partial write (only usage + top-level updatedAt change) is still caught by the multi-field CAS", async () => {
    const projectSlug = freshProjectSlug();
    const jobId = `${projectSlug}-assembly`;
    const fixture = await buildFixture({
      projectSlug,
      packages: { assembly: corruptedAssembly },
      manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
      events: realCorruptionEvents(jobId),
    });
    try {
      const expected = { manifestUpdatedAt: "2026-08-20T00:06:00.000Z",
        packageSnapshot: { status: "pending" as const, completedAt: corruptedAssembly.completedAt,
          startedAt: corruptedAssembly.startedAt, attemptsTotal: 6,
          generationOrdinal: 2, regenerationId: "pipeline-regen-fixture-gen2" } };

      // Mirrors ProjectManager.updatePackageUsage's EXACT write shape:
      // packages[stage].status/completedAt/startedAt/attempts/generationOrdinal/
      // regenerationId are ALL preserved byte-for-byte (only `usage` is
      // added), yet the manifest's top-level `updatedAt` still advances,
      // because every ProjectWriter.writeJSON call bumps it.
      const currentManifest = readManifest(fixture) as unknown as Record<string, unknown>;
      const currentPackages = currentManifest.packages as Record<string, Record<string, unknown>>;
      const raceWrite = {
        ...currentManifest,
        packages: {
          ...currentPackages,
          assembly: { ...currentPackages.assembly, usage: { provider: "openai", requestCount: 1 } },
        },
        updatedAt: "2026-08-20T00:06:30.000Z", // the only externally-visible change besides `usage`
      };
      fs.writeFileSync(path.join(fixture.projectRoot, "manifest.json"),
        JSON.stringify(raceWrite, null, 2) + "\n");

      // Sanity: packages.assembly's OWN status/completedAt/attempts are
      // genuinely unchanged by this race write -- if a reconciliation
      // design CAS'd on package-level fields alone, it would (wrongly)
      // still match `expected` here.
      const afterRace = readManifest(fixture);
      assert.equal(afterRace.packages.assembly.status, "pending");
      assert.equal(afterRace.packages.assembly.completedAt, corruptedAssembly.completedAt);
      assert.equal(afterRace.packages.assembly.attempts?.total, 6);
      assert.notEqual(afterRace.updatedAt, expected.manifestUpdatedAt);

      const beforeCall = manifestFileBytes(fixture);
      const result = await run(fixture, () =>
        PipelineJobManager.reconcileManifestPackageStatusFromHistory(
          fixture.projectSlug, stage, expected));
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "MANIFEST_PACKAGE_STATUS_DRIFT_CAS_CONFLICT",
        "the top-level manifestUpdatedAt check must catch this even though every " +
        "package-level field the reconciliation cares about is untouched");
      assert.deepEqual(manifestFileBytes(fixture), beforeCall,
        "no write must happen once the CAS conflict is detected");
    } finally { await cleanup(fixture); }
  });

  assert.ok(scenarios >= 13);
  process.stdout.write(`Manifest package status reconciliation smoke: PASS (${scenarios} scenarios)\n`);
  emitSmokeResult("manifest-package-status-reconciliation", scenarios);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
