import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareFailedStageRetry } from "../src/lib/pipeline/PipelineFailedStageRetry";
import { runProductionAcceptanceCommand } from
  "../src/lib/production/ProductionAcceptanceCommand";
import { createProductionAcceptancePortableConfigurationSnapshotV2 } from
  "../src/lib/production/ProductionAcceptanceConfigurationFingerprint";
import { withProductionAcceptanceRetryAdmission } from
  "../src/lib/production/ProductionAcceptanceLegacyAdmissionContext";
import { productionAcceptanceRequestFingerprintV3Profile2 } from
  "../src/lib/production/ProductionAcceptancePolicy";
import { ProductionPipelineDurableExecutionError } from
  "../src/lib/production/ProductionPipelineExecutionAdapter";
import { prepareProductionPipelineExecution } from
  "../src/lib/production/ProductionPipelineExecutionFactory";
import { runWithProductionPipelineExecutionInstrumentation } from
  "../src/lib/production/ProductionPipelineExecutionInstrumentation";
import { ProductionExecutionWorkerExecutionService } from
  "../src/lib/production/ProductionExecutionWorker";
import { reconcileFailedPipelineExecution } from
  "../src/lib/production/ProductionPipelineRetryReconciliation";
import { applyRetryBudgetExtension, planRetryBudgetExtension } from
  "../src/lib/production/ProductionPipelineRetryBudgetExtensionService";
import {
  buildProductionPipelineRetryBudgetExtensionReceipt,
  validateExtensionBodyIntegrity,
  validateExtensionReceiptIntegrity,
} from "../src/lib/production/ProductionPipelineRetryBudgetExtensionSchema";
import {
  getRetryBudgetExtensionDirectory,
  readRetryBudgetExtensionReceipt,
  writeRetryBudgetExtensionReceipt,
} from "../src/lib/production/ProductionPipelineRetryBudgetExtensionStore";
import { settleFailedProductionPipelineExecution } from
  "../src/lib/production/ProductionPipelineTerminalSettlement";
import { configureScopedProductionPipelineExecution } from
  "../src/lib/production/ProductionPipelineExecutionConfiguration";
import { ProductionWorkerLifecycle } from
  "../src/lib/production/ProductionWorkerLifecycle";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import { createProductionRuntimeOperationContext, initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext } from
  "../src/lib/runtime/ProductionRuntimeOperationContext";
import type { PipelineJobList } from "../src/types/pipelineJob";
import { emitSmokeResult } from "./lib/SmokeResult";
import { createAlternativeHistoricalAudioOrdinalFourChain,
  createEmbeddedOnlyUnexpectedHistoricalAudioOrdinalFourRecord,
  poisonHistoricalAudioOrdinalFourAttemptV1,
  poisonHistoricalAudioOrdinalFourAttemptV1Binding,
  poisonHistoricalAudioOrdinalFourClaimV1,
  poisonHistoricalAudioOrdinalFourClaimV1Binding,
  poisonHistoricalAudioOrdinalFourLeaseV2Ownership,
  poisonHistoricalAudioOrdinalFourLeaseV2Version,
  preflightHistoricalAudioOrdinalFour } from
  "./lib/HistoricalAudioOrdinalFourPreflight";

const anchor = "2026-08-08T09:00:00.000Z";
const projectSlug =
  "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const productionProjectRoot = path.join(process.cwd(), "data", "projects", projectSlug);
let passed = 0;

async function test(name: string, action: () => void | Promise<void>) {
  await action();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

function hash(filePath: string) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function treeDigest(root: string) {
  const entries: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) {
        entries.push(`${path.relative(root, target).replaceAll("\\", "/")}\t${hash(target)}`);
      }
    }
  };
  visit(root);
  return createHash("sha256").update(entries.sort().join("\n")).digest("hex");
}

/** Rewinds only the fully verified current audio ordinal-4 authority inside an owned temp copy. */
function rewindExactAudioOrdinalFour(projectRoot: string, ownedRoot: string) {
  assert.equal(path.basename(projectRoot), projectSlug);
  assert.equal(path.relative(ownedRoot, projectRoot).startsWith(".."), false);
  assert.notEqual(fs.realpathSync(projectRoot), fs.realpathSync(productionProjectRoot));
  const historyPath = path.join(projectRoot, "pipeline-history.json");
  const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
  const failure = history.events.filter((event: Record<string, unknown>) =>
    event.stage === "audio" && event.status === "failed" && event.errorCode).at(-1);
  assert.ok(failure);
  assert.equal(failure.jobId, `${projectSlug}-audio`);
  assert.equal(typeof failure.recordedAt, "string");
  assert.equal(typeof failure.jobUpdatedAt, "string");
  const jobsPath = path.join(projectRoot, "pipeline-jobs.json");
  const jobs = JSON.parse(fs.readFileSync(jobsPath, "utf8"));
  const audioJob = jobs.jobs.find((job: Record<string, unknown>) => job.stage === "audio");
  assert.equal(audioJob?.id, `${projectSlug}-audio`);
  assert.equal(audioJob?.status, "completed");
  assert.equal(audioJob?.attempts, 3);
  const manifestPath = path.join(projectRoot, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.packages?.audio?.status, "completed");
  assert.equal(manifest.packages?.audio?.attempts?.total, 4);
  assert.equal(manifest.packages?.audio?.attempts?.lastRunType, "resume");

  const executionRoot = path.join(projectRoot, "production-execution");
  const extensionRoot = path.join(executionRoot, "retry-budget-extensions");
  const authorityFiles = fs.readdirSync(extensionRoot)
    .filter((name) => name.startsWith("authority-") && name.endsWith(".json"))
    .map((name) => path.join(extensionRoot, name));
  const matchingAuthorities = authorityFiles.filter((target) => {
    const body = JSON.parse(fs.readFileSync(target, "utf8"));
    return validateExtensionBodyIntegrity(body) && body.projectSlug === projectSlug &&
      body.stage === "audio" && body.jobId === `${projectSlug}-audio` &&
      body.authorizedOperation === "pipeline.stage.resume" &&
      body.authorizedDurableOrdinal === 4;
  });
  assert.equal(matchingAuthorities.length, 1, "exact audio ordinal-4 authority must be singular");
  const authorityPath = matchingAuthorities[0];
  const authority = JSON.parse(fs.readFileSync(authorityPath, "utf8"));
  const consumedPath = path.join(extensionRoot,
    `receipt-${authority.authorityId}-consumed.json`);
  const consumed = JSON.parse(fs.readFileSync(consumedPath, "utf8"));
  assert.equal(validateExtensionReceiptIntegrity(consumed), true);
  assert.equal(consumed.authorityId, authority.authorityId);
  assert.equal(consumed.state, "consumed");

  const canonical = preflightHistoricalAudioOrdinalFour({
    executionRoot, ownedRoot, authority, consumed,
  });
  const deletionTargets = canonical.deletionTargets;
  const allowedReceiptStates = ["consuming", "consumed", "settled"] as const;
  const allowedReceiptNames = allowedReceiptStates.map((state) =>
    `receipt-${authority.authorityId}-${state}.json`);
  const matchingReceiptNames = fs.readdirSync(extensionRoot)
    .filter((name) => name.startsWith(`receipt-${authority.authorityId}-`));
  assert.deepEqual(matchingReceiptNames.sort(), [...allowedReceiptNames].sort());
  const receiptPaths = allowedReceiptNames.map((name) => path.join(extensionRoot, name));
  for (const [index, target] of receiptPaths.entries()) {
    const receipt = JSON.parse(fs.readFileSync(target, "utf8"));
    assert.equal(validateExtensionReceiptIntegrity(receipt), true);
    assert.equal(receipt.authorityId, authority.authorityId);
    assert.equal(receipt.state, allowedReceiptStates[index]);
    if (receipt.state === "consumed") {
      assert.equal(receipt.integrity.fingerprint, canonical.binding.consumptionReceiptFingerprint);
    }
    if (receipt.state === "settled") {
      assert.equal(receipt.jobVersion, consumed.jobVersion);
      assert.deepEqual(receipt.evidence,
        ["terminal-settlement:settled-receipt-finalized"]);
    }
  }

  // Mutation phase: every ownership, lineage, historical-state and receipt check is complete.
  for (const target of [...deletionTargets, authorityPath, ...receiptPaths]) {
    assert.equal(path.relative(ownedRoot, target).startsWith(".."), false);
    fs.unlinkSync(target);
  }

  history.events = history.events.filter((event: Record<string, unknown>) =>
    event.stage !== "audio" || String(event.recordedAt ?? "") <= String(failure.recordedAt));
  history.updatedAt = failure.recordedAt;
  fs.writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
  Object.assign(jobs.jobs.find((job: Record<string, unknown>) => job.stage === "audio"), {
    status: "failed", attempts: 2, updatedAt: failure.jobUpdatedAt,
    startedAt: failure.startedAt, completedAt: failure.completedAt, error: failure.errorCode,
  });
  jobs.updatedAt = failure.jobUpdatedAt;
  fs.writeFileSync(jobsPath, `${JSON.stringify(jobs, null, 2)}\n`, "utf8");
  Object.assign(manifest.packages.audio, { status: "failed", updatedAt: failure.completedAt,
    startedAt: failure.startedAt, completedAt: failure.completedAt, error: failure.errorCode });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function runRewindPreflightRegression(
  kind: "unknown-receipt" | "missing-history" | "duplicate-sibling" |
    "alternative-chain" | "claim-v1-poison" | "attempt-v1-poison" |
    "claim-v1-binding-poison" | "attempt-v1-binding-poison" |
    "lease-v2-ownership-poison" | "lease-v2-version-poison" |
    "embedded-only-unexpected") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-sprint-129-38-preflight-"));
  try {
    const projectRoot = path.join(root, "data", "projects", projectSlug);
    fs.mkdirSync(path.dirname(projectRoot), { recursive: true });
    fs.cpSync(productionProjectRoot, projectRoot, { recursive: true });
    const executionRoot = path.join(projectRoot, "production-execution");
    const extensionRoot = path.join(executionRoot, "retry-budget-extensions");
    const authority = JSON.parse(fs.readFileSync(path.join(extensionRoot,
      fs.readdirSync(extensionRoot).find((name) => name.startsWith("authority-"))!), "utf8"));
    const consumed = JSON.parse(fs.readFileSync(path.join(extensionRoot,
      `receipt-${authority.authorityId}-consumed.json`), "utf8"));
    if (kind === "unknown-receipt") {
      const unknown = buildProductionPipelineRetryBudgetExtensionReceipt(authority.authorityId,
        "future" as never, anchor, consumed.jobVersion, ["future:unsupported"]);
      fs.writeFileSync(path.join(extensionRoot,
        `receipt-${authority.authorityId}-future.json`), `${JSON.stringify(unknown, null, 2)}\n`);
    } else if (kind === "missing-history") {
      const historyPath = path.join(projectRoot, "pipeline-history.json");
      const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
      history.events = history.events.filter((event: Record<string, unknown>) =>
        event.stage !== "audio" || event.status !== "failed");
      fs.writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
    } else if (kind === "duplicate-sibling") {
      const recordRoot = path.join(projectRoot, "production-execution", "idempotency");
      const canonical = fs.readdirSync(recordRoot).find((name) => {
        const value = JSON.parse(fs.readFileSync(path.join(recordRoot, name), "utf8"));
        return value.retryBudgetExtension?.authorizedDurableOrdinal === 4;
      })!;
      fs.copyFileSync(path.join(recordRoot, canonical),
        path.join(recordRoot, "duplicate-exact-binding-sibling.json"),
        fs.constants.COPYFILE_EXCL);
    } else {
      const canonical = preflightHistoricalAudioOrdinalFour({
        executionRoot, ownedRoot: root, authority, consumed,
      });
      if (kind === "alternative-chain") {
        createAlternativeHistoricalAudioOrdinalFourChain(canonical);
      } else if (kind === "claim-v1-poison") {
        poisonHistoricalAudioOrdinalFourClaimV1(canonical);
      } else if (kind === "attempt-v1-poison") {
        poisonHistoricalAudioOrdinalFourAttemptV1(canonical);
      } else if (kind === "claim-v1-binding-poison") {
        poisonHistoricalAudioOrdinalFourClaimV1Binding(canonical);
      } else if (kind === "attempt-v1-binding-poison") {
        poisonHistoricalAudioOrdinalFourAttemptV1Binding(canonical);
      } else if (kind === "lease-v2-ownership-poison") {
        poisonHistoricalAudioOrdinalFourLeaseV2Ownership(canonical);
      } else if (kind === "lease-v2-version-poison") {
        poisonHistoricalAudioOrdinalFourLeaseV2Version(canonical);
      } else {
        createEmbeddedOnlyUnexpectedHistoricalAudioOrdinalFourRecord(canonical);
      }
    }
    const before = treeDigest(projectRoot);
    const expected: string | undefined = kind === "alternative-chain"
      ? "CANONICAL_AUDIO_ORDINAL_FOUR_UNEXPECTED_SAME_BINDING_ARTIFACT"
      : kind === "claim-v1-poison" ? "CANONICAL_AUDIO_ORDINAL_FOUR_CLAIM_LINEAGE_INVALID"
        : kind === "attempt-v1-poison" ? "CANONICAL_AUDIO_ORDINAL_FOUR_ATTEMPT_LINEAGE_INVALID"
          : kind === "claim-v1-binding-poison"
            ? "CANONICAL_AUDIO_ORDINAL_FOUR_CLAIM_BINDING_INVALID"
            : kind === "attempt-v1-binding-poison"
              ? "CANONICAL_AUDIO_ORDINAL_FOUR_ATTEMPT_BINDING_INVALID"
              : kind === "lease-v2-ownership-poison" || kind === "lease-v2-version-poison"
                ? "CANONICAL_AUDIO_ORDINAL_FOUR_EMBEDDED_LEASE_CANONICAL_INVALID"
                : kind === "embedded-only-unexpected"
                  ? "CANONICAL_AUDIO_ORDINAL_FOUR_UNEXPECTED_SAME_BINDING_ARTIFACT"
          : undefined;
    if (expected) assert.throws(() => rewindExactAudioOrdinalFour(projectRoot, root),
      new RegExp(expected));
    else assert.throws(() => rewindExactAudioOrdinalFour(projectRoot, root));
    assert.equal(treeDigest(projectRoot), before);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
}

async function refreshMarker(projectRoot: string) {
  const markerPath = path.join(projectRoot, "production-acceptance.json");
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  const configuration = await createProductionAcceptancePortableConfigurationSnapshotV2(projectSlug);
  assert.deepEqual(configuration.unavailableComponents, []);
  marker.configurationFingerprint = configuration.configurationFingerprint;
  marker.componentFingerprints = { ...configuration.componentFingerprints };
  marker.requestFingerprint = productionAcceptanceRequestFingerprintV3Profile2({
    topic: marker.topic, runId: marker.runId,
    configurationFingerprint: marker.configurationFingerprint,
  });
  fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
}

async function main() {
  await test("Rewind preflight rejects unknown same-authority receipt with zero mutation", () => {
    runRewindPreflightRegression("unknown-receipt");
  });
  await test("Rewind preflight rejects missing historical failure with zero mutation", () => {
    runRewindPreflightRegression("missing-history");
  });
  await test("Rewind preflight rejects duplicate exact-binding sibling with zero mutation", () => {
    runRewindPreflightRegression("duplicate-sibling");
  });
  await test("Rewind rejects persistence-valid alternative full chain with zero mutation", () => {
    runRewindPreflightRegression("alternative-chain");
  });
  await test("Rewind rejects persistence-valid non-terminal claim-v1 poison with zero mutation", () => {
    runRewindPreflightRegression("claim-v1-poison");
  });
  await test("Rewind rejects persistence-valid non-terminal attempt-v1 poison with zero mutation", () => {
    runRewindPreflightRegression("attempt-v1-poison");
  });
  await test("Rewind rejects persistence-valid claim-v1 binding poison with zero mutation", () => {
    runRewindPreflightRegression("claim-v1-binding-poison");
  });
  await test("Rewind rejects persistence-valid attempt-v1 binding poison with zero mutation", () => {
    runRewindPreflightRegression("attempt-v1-binding-poison");
  });
  await test("Rewind rejects persistence-valid lease-v2 ownership poison with zero mutation", () => {
    runRewindPreflightRegression("lease-v2-ownership-poison");
  });
  await test("Rewind rejects persistence-valid lease-v2 version poison with zero mutation", () => {
    runRewindPreflightRegression("lease-v2-version-poison");
  });
  await test("Rewind rejects embedded-only unexpected same-authority record with zero mutation", () => {
    runRewindPreflightRegression("embedded-only-unexpected");
  });
  const ownedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-sprint-129-38-"));
  const ownedIdentity = fs.lstatSync(ownedRoot);
  const environmentKeys = ["ATOLYE_WORKSPACE_ROOT", "ATOLYE_RUNTIME_ROOT",
    "ATOLYE_RUNTIME_AUTHORITY_ROOT", "NODE_ENV", "AI_PROVIDER", "FFMPEG_PATH",
    "FFPROBE_PATH"] as const;
  const environmentBefore = environmentKeys.map((key) => ({ key,
    present: Object.prototype.hasOwnProperty.call(process.env, key), value: process.env[key] }));
  let worker: ProductionWorkerLifecycle | undefined;
  let registration: ReturnType<typeof configureScopedProductionPipelineExecution> | undefined;
  try {
    process.env.ATOLYE_WORKSPACE_ROOT = ownedRoot;
    process.env.ATOLYE_RUNTIME_ROOT = ownedRoot;
    process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = path.join(ownedRoot, "authority");
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.AI_PROVIDER = "mock";
    const ffmpegPath = path.join(ownedRoot, "ffmpeg-fixture.bin");
    const ffprobePath = path.join(ownedRoot, "ffprobe-fixture.bin");
    fs.writeFileSync(ffmpegPath, "sprint-129-38-ffmpeg", "utf8");
    fs.writeFileSync(ffprobePath, "sprint-129-38-ffprobe", "utf8");
    process.env.FFMPEG_PATH = ffmpegPath;
    process.env.FFPROBE_PATH = ffprobePath;
    const storageContext = createRuntimeStorageContext({ workspaceRoot: ownedRoot,
      authorityRoot: path.join(ownedRoot, "authority"), environment: process.env });
    const operationContext = createProductionRuntimeOperationContext({
      operationId: `sprint-129-38-${Date.now()}`, operationType: "pipeline-stage-execution",
      authorityGeneration: initialRuntimeAuthorityGeneration, storageContext });
    worker = new ProductionWorkerLifecycle(() => anchor);
    worker.bindRuntimeOperationContext(operationContext);
    const started = await worker.start({ initialization: { schemaVersion: "1", ok: true,
      decision: "ready", reasonCode: "RUNTIME_INITIALIZED", initializedAt: anchor,
      writeFree: true, partialInitialization: false, projects: [],
      counts: { active: 0, running: 0, terminal: 0, orphaned: 0, "expired-lease": 0,
        replayable: 0 }, worker: worker.snapshot(), evidence: [] } });
    assert.equal(started.ok, true);
    registration = configureScopedProductionPipelineExecution({ lifecycle: worker,
      runtimeOperationContext: operationContext });
    await runWithProductionRuntimeOperationContext(operationContext, async () => {
    const projectRoot = path.join(storageContext.projectsRoot, projectSlug);
    fs.mkdirSync(path.dirname(projectRoot), { recursive: true });
    fs.cpSync(productionProjectRoot, projectRoot, { recursive: true });
    rewindExactAudioOrdinalFour(projectRoot, ownedRoot);
    await refreshMarker(projectRoot);
    const receiptRoot = getRetryBudgetExtensionDirectory(projectSlug,
      storageContext);

    const unrelatedAuthorityId = "retry-budget-extension-authority-unrelated-audio";
    const unrelatedConsumed = buildProductionPipelineRetryBudgetExtensionReceipt(
      unrelatedAuthorityId, "consumed", anchor, "audio-job-version", ["transaction:consumed"]);
    const unrelatedSettled = buildProductionPipelineRetryBudgetExtensionReceipt(
      unrelatedAuthorityId, "settled", new Date(Date.parse(anchor) + 1_000).toISOString(),
      unrelatedConsumed.jobVersion, ["terminal-settlement:settled-receipt-finalized"]);
    const unrelatedConsumedWrite = writeRetryBudgetExtensionReceipt(projectSlug,
      unrelatedConsumed, storageContext);
    assert.equal(unrelatedConsumedWrite.ok, true);
    assert.equal(writeRetryBudgetExtensionReceipt(projectSlug, unrelatedSettled,
      storageContext).ok, true);
    const unrelatedFiles = fs.readdirSync(receiptRoot).sort();
    const unrelatedHashes = new Map(unrelatedFiles.map((name) =>
      [name, hash(path.join(receiptRoot, name))]));

    const jobsPath = path.join(projectRoot, "pipeline-jobs.json");
    const initialJobs = JSON.parse(fs.readFileSync(jobsPath, "utf8")) as PipelineJobList;
    const assembly = initialJobs.jobs.find((job) => job.stage === "assembly")!;
    let providerDispatchCalls = 0;
    await test("Scenario A - assembly failed/0 reconciles and prepares queued/1 without provider dispatch", async () => {
      await runWithProductionPipelineExecutionInstrumentation({ onEvent(event) {
        if (event === "provider-dispatch-entered") providerDispatchCalls += 1;
      } }, async () => {
        const reconciled = await reconcileFailedPipelineExecution(assembly,
          () => new Date(Date.parse(anchor) + 60_000).toISOString(),
          { storageContext });
        assert.equal(reconciled.ok, true);
        assert.deepEqual(fs.readdirSync(receiptRoot).sort(), unrelatedFiles);
        for (const [name, digest] of unrelatedHashes) {
          assert.equal(hash(path.join(receiptRoot, name)), digest);
        }
        const retry = await prepareFailedStageRetry(projectSlug, assembly.id, "resume",
          storageContext);
        assert.equal(retry.success, true);
        if (!retry.success) return;
        assert.equal(retry.previousJob.status, "failed");
        assert.equal(retry.previousJob.attempts, 0);
        assert.equal(retry.job.status, "queued");
        assert.equal(retry.job.attempts, 1);
        assert.equal(retry.admission.runType, "resume");
        assert.equal(retry.admission.priorJobAttemptIndex, 0);
        assert.equal(retry.admission.admittedJobAttemptIndex, 1);
      });
      assert.equal(providerDispatchCalls, 0);
    });

    const audioJobId = `${projectSlug}-audio`;
    const plan = await planRetryBudgetExtension(projectSlug, "audio", audioJobId,
      "sprint-129-38-real-path", storageContext);
    assert.equal(plan.eligible, true);
    const applied = await applyRetryBudgetExtension(projectSlug, "audio", audioJobId,
      "sprint-129-38-real-path", plan.authorityId!, plan.authorityId!,
      storageContext);
    assert.equal(applied.success, true);
    const retry = await prepareFailedStageRetry(projectSlug, audioJobId, "resume",
      storageContext);
    assert.equal(retry.success, true);
    if (!retry.success) return;
    const prepared = await withProductionAcceptanceRetryAdmission(retry.admission,
      retry.previousJob, () => prepareProductionPipelineExecution({
        projectSlug, stage: "audio", runType: "resume",
      }));
    const execution = await new ProductionExecutionWorkerExecutionService(
      prepared.executionAdapter).execute(prepared.request, async () => {
        throw Object.assign(new Error("AUDIO_ASSET_GENERATION_FAILED"),
          { code: "AUDIO_ASSET_GENERATION_FAILED" });
      }, { isCancellationRequested: () => false });
    assert.equal(execution.status, "failed");
    const binding = execution.attempt?.retryBudgetExtension;
    assert.ok(binding);
    const settledPath = path.join(receiptRoot,
      `receipt-${binding.authorityId}-settled.json`);
    let canonicalSettledBytes: Buffer | undefined;

    await test("Scenario B - real extension-backed failed settlement creates deterministic settled", async () => {
      assert.equal(fs.existsSync(settledPath), false);
      const result = await settleFailedProductionPipelineExecution({ ...prepared.settlement,
        expectedProjectSlug: projectSlug, expectedStage: "audio",
        storageContext }, execution);
      assert.equal(result.ok, true);
      assert.equal(result.writeFree, false);
      const settled = readRetryBudgetExtensionReceipt(projectSlug, binding.authorityId,
        "settled", storageContext);
      assert.equal(settled.ok, true);
      assert.equal(settled.value?.timestamp, execution.attempt?.finalizedAt);
      canonicalSettledBytes = fs.readFileSync(settledPath);
    });

    await test("Scenario C - real settlement replay is write-free and byte-identical", async () => {
      const before = fs.readFileSync(settledPath);
      const result = await settleFailedProductionPipelineExecution({ ...prepared.settlement,
        expectedProjectSlug: projectSlug, expectedStage: "audio",
        storageContext,
        request: { ...prepared.settlement.request,
          finishedAt: new Date(Date.parse(anchor) + 86_400_000).toISOString() },
      }, execution);
      assert.equal(result.ok, true);
      assert.equal(result.writeFree, true);
      assert.deepEqual(fs.readFileSync(settledPath), before);
    });

    await test("Scenario D - stale integrity-valid settled receipt fails closed without clobber", async () => {
      assert.ok(canonicalSettledBytes);
      const canonical = readRetryBudgetExtensionReceipt(projectSlug, binding.authorityId,
        "settled", storageContext);
      assert.equal(canonical.ok, true);
      const stale = buildProductionPipelineRetryBudgetExtensionReceipt(binding.authorityId,
        "settled", new Date(Date.parse(anchor) + 172_800_000).toISOString(),
        canonical.value!.jobVersion, ["terminal-settlement:settled-receipt-finalized"]);
      assert.notEqual(stale.integrity.fingerprint, canonical.value!.integrity.fingerprint);
      fs.writeFileSync(settledPath, `${JSON.stringify(stale, null, 2)}\n`, "utf8");
      const staleBytes = fs.readFileSync(settledPath);
      const result = await settleFailedProductionPipelineExecution({ ...prepared.settlement,
        expectedProjectSlug: projectSlug, expectedStage: "audio",
        storageContext }, execution);
      assert.equal(result.ok, false);
      assert.equal(result.writeFree, true);
      assert.equal(result.reasonCode, "PIPELINE_FAILED_SETTLEMENT_RECEIPT_BINDING_FAILED");
      assert.equal(result.causeReasonCode,
        "PIPELINE_RETRY_BUDGET_EXTENSION_SETTLED_BINDING_MISMATCH");
      assert.deepEqual(fs.readFileSync(settledPath), staleBytes);
      assert.equal(fs.readdirSync(receiptRoot).filter((name) =>
        name === path.basename(settledPath)).length, 1);
      for (const [name, digest] of unrelatedHashes) {
        assert.equal(hash(path.join(receiptRoot, name)), digest);
      }
      fs.writeFileSync(settledPath, canonicalSettledBytes);
    });

    await test("Scenario E - unrelated stage receipts remain byte-identical", () => {
      for (const [name, digest] of unrelatedHashes) {
        assert.equal(hash(path.join(receiptRoot, name)), digest);
      }
    });

    await test("Scenario F - real settlement fails closed on matching receipt corruption", async () => {
      const consumedPath = path.join(receiptRoot,
        `receipt-${binding.authorityId}-consumed.json`);
      const corrupt = JSON.parse(fs.readFileSync(consumedPath, "utf8"));
      corrupt.jobVersion = "tampered-job-version";
      fs.writeFileSync(consumedPath, `${JSON.stringify(corrupt, null, 2)}\n`, "utf8");
      const result = await settleFailedProductionPipelineExecution({ ...prepared.settlement,
        expectedProjectSlug: projectSlug, expectedStage: "audio",
        storageContext }, execution);
      assert.equal(result.ok, false);
      assert.equal(result.reasonCode, "PIPELINE_FAILED_SETTLEMENT_RECEIPT_BINDING_FAILED");
      assert.equal(result.causeReasonCode,
        "PIPELINE_RETRY_BUDGET_EXTENSION_RECEIPT_CORRUPT");
    });

    await test("safe compensation code is public without internal detail", async () => {
      const command = await runProductionAcceptanceCommand(["resume-finalize",
        `--project-slug=${projectSlug}`, "--confirm-production-acceptance"], {
        readiness: async () => ({ ready: true, checks: [] } as never),
        execute: async () => ({ completion: {} } as never),
        resume: async () => { throw new ProductionPipelineDurableExecutionError(
          "private receipt path", "PIPELINE_RETRY_COMPENSATION_FAILED"); },
      });
      assert.equal(command.report.errorCode, "PIPELINE_RETRY_COMPENSATION_FAILED");
      assert.equal(JSON.stringify(command.report).includes("private receipt"), false);
    });
    });
  } finally {
    registration?.restore();
    if (worker) await worker.stop();
    for (const item of environmentBefore) {
      if (item.present) (process.env as Record<string, string | undefined>)[item.key] = item.value;
      else delete (process.env as Record<string, string | undefined>)[item.key];
    }
    const currentIdentity = fs.lstatSync(ownedRoot);
    assert.equal(currentIdentity.isDirectory(), true);
    assert.equal(currentIdentity.isSymbolicLink(), false);
    assert.equal(currentIdentity.dev, ownedIdentity.dev);
    assert.equal(currentIdentity.ino, ownedIdentity.ino);
    fs.rmSync(ownedRoot, { recursive: true });
  }
  emitSmokeResult("sprint-129-38-cross-stage-settled-receipt-replay", passed);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
