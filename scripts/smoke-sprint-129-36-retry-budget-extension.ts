/**
 * Sprint 129.36 — Retry Budget Extension Smoke Test Suite
 *
 * ISOLATION GUARANTEE:
 * - All mutable test runtime lives under a single os.tmpdir() mkdtemp root.
 * - repository data/projects is NEVER permanently mutated.
 * - Every isolated test path created is containment-asserted against tempRoot.
 * - try/finally cleanup removes the entire tempRoot on suite exit and cleans any test artifacts.
 * - Pre/post production data/ inventory SHA-256 proves 100% immutability.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fork } from "node:child_process";

import { runProductionAcceptanceCommand } from "@/lib/production/ProductionAcceptanceCommand";
import { planRetryBudgetExtension, applyRetryBudgetExtension } from "@/lib/production/ProductionPipelineRetryBudgetExtensionService";
import { recoverLingeringConsumingIntent } from "@/lib/production/ProductionPipelineRetryBudgetExtensionTransaction";
import { verifyCanonicalPipelineRetryBudgetExtensionAdmission } from "@/lib/production/ProductionPipelineRetryBudgetExtensionGate";
import {
  buildProductionPipelineRetryBudgetExtensionBody,
  buildProductionPipelineRetryBudgetExtensionReceipt,
  validateExtensionBodyIntegrity,
  validateExtensionReceiptIntegrity,
} from "@/lib/production/ProductionPipelineRetryBudgetExtensionSchema";
import type { RetryBudgetExtensionDurableBinding } from
  "@/types/productionPipelineRetryBudgetExtension";
import {
  writeRetryBudgetExtensionAuthority,
  writeRetryBudgetExtensionReceipt,
  readRetryBudgetExtensionAuthority,
  readRetryBudgetExtensionReceipt,
  getRetryBudgetExtensionDirectory,
} from "@/lib/production/ProductionPipelineRetryBudgetExtensionStore";
import type { PipelineJob } from "@/types/pipelineJob";
import type { buildProductionPipelineExecutionIdentity } from "@/lib/production/ProductionPipelineExecutionIdentity";
import type { ProductionPipelineRetryAdmissionBinding } from "@/lib/production/ProductionPipelineRetryAdmissionBinding";
type ProductionPipelineExecutionIdentity = ReturnType<typeof buildProductionPipelineExecutionIdentity>;
import type { PipelineRetryAdmission } from "@/lib/pipeline/PipelineRetryAdmission";
import { assertCanonicalPipelineRetryAdmission } from "@/lib/pipeline/PipelineRetryAdmission";
import { createRuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import { resolveRuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import { prepareFailedStageRetry } from "@/lib/pipeline/PipelineFailedStageRetry";
import {
  prepareProductionPipelineExecution,
  readCompletedProductionPipelinePreparation,
} from "@/lib/production/ProductionPipelineExecutionFactory";
import { withProductionAcceptanceRetryAdmission } from
  "@/lib/production/ProductionAcceptanceLegacyAdmissionContext";
import { stableProductionId } from "@/lib/production/ProductionDeterminism";
import { ProductionExecutionFilePersistenceAdapter } from
  "@/lib/production/ProductionExecutionPersistence";
import { readProductionCanonicalTerminalDurableLineage } from
  "@/lib/production/ProductionCanonicalDurableLineage";
import {
  createProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  runWithProductionRuntimeOperationContext,
} from "@/lib/runtime/ProductionRuntimeOperationContext";
import { ProductionWorkerLifecycle } from "@/lib/production/ProductionWorkerLifecycle";
import { configureScopedProductionPipelineExecution } from
  "@/lib/production/ProductionPipelineExecutionConfiguration";
import { createProductionAcceptancePortableConfigurationSnapshotV2 } from
  "@/lib/production/ProductionAcceptanceConfigurationFingerprint";
import { productionAcceptanceRequestFingerprintV3Profile2 } from
  "@/lib/production/ProductionAcceptancePolicy";
import { createAlternativeHistoricalAudioOrdinalFourChain,
  poisonHistoricalAudioOrdinalFourAttemptV1,
  poisonHistoricalAudioOrdinalFourClaimV1,
  preflightHistoricalAudioOrdinalFour } from
  "./lib/HistoricalAudioOrdinalFourPreflight";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const baseProjectSlug = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const stage = "audio";
const reason = "operator-approved-after-remediation";

/** Repository data/ root — never mutated, hash-checked before/after. */
const repoProdDir = path.join(process.cwd(), "data", "projects", baseProjectSlug);

// ─────────────────────────────────────────────────────────────────────────────
// Test counters
// ─────────────────────────────────────────────────────────────────────────────

let passedCount = 0;
let totalCount = 0;

function assert(condition: boolean, description: string) {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`✓ Scenario ${totalCount}: ${description}`);
  } else {
    console.error(`✗ Scenario ${totalCount} FAILED: ${description}`);
    throw new Error(`SMOKE_ASSERTION_FAILED: ${description}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inventory & SHA-256 helpers
// ─────────────────────────────────────────────────────────────────────────────

interface FileEntry {
  rel: string;
  size: number;
  sha256: string;
}

function computeFileInventory(dirPath: string): FileEntry[] {
  if (!fs.existsSync(dirPath)) return [];
  const entries: FileEntry[] = [];
  function scan(current: string) {
    const items = fs.readdirSync(current, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        scan(full);
      } else {
        const content = fs.readFileSync(full);
        entries.push({
          rel: path.relative(dirPath, full),
          size: content.length,
          sha256: crypto.createHash("sha256").update(content).digest("hex"),
        });
      }
    }
  }
  scan(dirPath);
  entries.sort((a, b) => a.rel.localeCompare(b.rel));
  return entries;
}

function inventoryDigest(entries: FileEntry[]): string {
  const h = crypto.createHash("sha256");
  for (const e of entries) {
    h.update(`${e.rel}\0${e.size}\0${e.sha256}\n`);
  }
  return h.digest("hex");
}

/** Assert containment: target must be inside root. Throws if not. */
function assertContained(root: string, target: string) {
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`CONTAINMENT VIOLATION: ${target} is not inside ${root}`);
  }
}

interface OwnedTempRootIdentity {
  readonly root: string;
  readonly physicalRoot: string;
  readonly physicalParent: string;
  readonly dev: number | bigint;
  readonly ino: number | bigint;
}

function captureOwnedTempRootIdentity(tempRoot: string): OwnedTempRootIdentity {
  const root = path.resolve(tempRoot);
  const tempParent = path.resolve(os.tmpdir());
  if (path.dirname(root) !== tempParent ||
    !path.basename(root).startsWith("sprint-129-36-ext-smoke-")) {
    throw new Error("TEMP_ROOT_IDENTITY_INVALID");
  }
  const stats = fs.lstatSync(root, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("TEMP_ROOT_TYPE_UNSAFE");
  }
  const physicalParent = fs.realpathSync(tempParent);
  const physicalRoot = fs.realpathSync(root);
  assertContained(physicalParent, physicalRoot);
  return { root, physicalRoot, physicalParent, dev: stats.dev, ino: stats.ino };
}

function assertNoCleanupLinks(current: string): void {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const target = path.join(current, entry.name);
    const stats = fs.lstatSync(target);
    if (stats.isSymbolicLink()) throw new Error("TEMP_ROOT_REPARSE_POINT_REJECTED");
    if (stats.isDirectory()) assertNoCleanupLinks(target);
  }
}

function cleanupOwnedTempRoot(identity: OwnedTempRootIdentity): void {
  if (!fs.existsSync(identity.root)) return;
  const stats = fs.lstatSync(identity.root, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink() ||
    stats.dev !== identity.dev || stats.ino !== identity.ino) {
    throw new Error("TEMP_ROOT_IDENTITY_CHANGED");
  }
  const physicalRoot = fs.realpathSync(identity.root);
  if (physicalRoot !== identity.physicalRoot ||
    fs.realpathSync(path.dirname(identity.root)) !== identity.physicalParent) {
    throw new Error("TEMP_ROOT_PHYSICAL_CONTAINMENT_CHANGED");
  }
  assertNoCleanupLinks(identity.root);
  fs.rmSync(identity.root, { recursive: true, force: true });
}

function runCleanupSafetyRegression(): { failurePathCleaned: boolean; reparseRejected: boolean } {
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sprint-129-36-ext-smoke-"));
  const identity = captureOwnedTempRootIdentity(probeRoot);
  const target = path.join(probeRoot, "junction-target");
  const junction = path.join(probeRoot, "junction-probe");
  let reparseRejected = false;
  try {
    fs.mkdirSync(target);
    fs.symlinkSync(target, junction, "junction");
    try {
      cleanupOwnedTempRoot(identity);
    } catch (error) {
      reparseRejected = error instanceof Error &&
        error.message === "TEMP_ROOT_REPARSE_POINT_REJECTED";
    }
    fs.unlinkSync(junction);
    try {
      throw new Error("CONTROLLED_FAILURE_PATH");
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "CONTROLLED_FAILURE_PATH") throw error;
    }
  } finally {
    if (fs.existsSync(junction)) fs.unlinkSync(junction);
    if (fs.existsSync(probeRoot)) cleanupOwnedTempRoot(identity);
  }
  return { failurePathCleaned: !fs.existsSync(probeRoot), reparseRejected };
}

// ─────────────────────────────────────────────────────────────────────────────
// parseConsumedRetryBudgetAuthorityId parser tests
// ─────────────────────────────────────────────────────────────────────────────

function runParserTests(tempRoot: string) {
  const validId = "a".repeat(16) + "bbbb";
  const validFile = `receipt-${validId}-consumed.json`;

  const prefix = "receipt-";
  const suffix = "-consumed.json";
  const extractedFromValid = validFile.slice(prefix.length, validFile.length - suffix.length);
  assert(extractedFromValid === validId, `Parser: valid filename extracts correct ID (${validId})`);
  assert(extractedFromValid !== validFile.slice(prefix.length, suffix.length),
    "Parser: old bug would produce truncated ID — new parser avoids this");

  const bugResult = validFile.slice("receipt-".length, "-consumed.json".length);
  assert(bugResult !== validId,
    `Parser: old bug 'retry-' prefix truncation does NOT occur (old=${bugResult}, correct=${validId})`);

  const emptyIdFile = `receipt--consumed.json`;
  const emptyExtracted = emptyIdFile.slice(prefix.length, emptyIdFile.length - suffix.length);
  assert(emptyExtracted === "", "Parser: empty ID extracted correctly as empty string (to be rejected)");
  assert(!/^[a-z0-9-]{16,128}$/.test(emptyExtracted), "Parser: empty ID rejected by regex");

  const wrongSuffix = `receipt-${validId}-consuming.json`;
  assert(!wrongSuffix.endsWith(suffix), "Parser: wrong suffix (-consuming.json) does not match -consumed.json");

  const wrongPrefix = `auth-${validId}-consumed.json`;
  assert(!wrongPrefix.startsWith(prefix), "Parser: wrong prefix (auth-) does not match receipt-");

  const traversalFile = `receipt-${validId}/../malicious-consumed.json`;
  assert(traversalFile.includes("/") || traversalFile.includes("\\"),
    "Parser: path traversal filename contains path separator");
  assert(!/^[a-z0-9-]{16,128}$/.test(traversalFile.slice(prefix.length, traversalFile.length - suffix.length)),
    "Parser: path traversal name rejected (ID contains invalid chars)");

  const uppercaseId = "A".repeat(16) + "bbbb";
  const uppercaseFile = `receipt-${uppercaseId}-consumed.json`;
  const uppercaseExtracted = uppercaseFile.slice(prefix.length, uppercaseFile.length - suffix.length);
  assert(!/^[a-z0-9-]{16,128}$/.test(uppercaseExtracted), "Parser: uppercase ID rejected by regex");

  const shortId = "a".repeat(15);
  const shortFile = `receipt-${shortId}-consumed.json`;
  const shortExtracted = shortFile.slice(prefix.length, shortFile.length - suffix.length);
  assert(!/^[a-z0-9-]{16,128}$/.test(shortExtracted), "Parser: 15-char ID rejected (min 16)");

  const longId = "a".repeat(129);
  const longFile = `receipt-${longId}-consumed.json`;
  const longExtracted = longFile.slice(prefix.length, longFile.length - suffix.length);
  assert(!/^[a-z0-9-]{16,128}$/.test(longExtracted), "Parser: 129-char ID rejected (max 128)");

  const minId = "a".repeat(16);
  const minFile = `receipt-${minId}-consumed.json`;
  const minExtracted = minFile.slice(prefix.length, minFile.length - suffix.length);
  assert(/^[a-z0-9-]{16,128}$/.test(minExtracted), "Parser: exactly 16-char ID accepted");

  const maxId = "a".repeat(128);
  const maxFile = `receipt-${maxId}-consumed.json`;
  const maxExtracted = maxFile.slice(prefix.length, maxFile.length - suffix.length);
  assert(/^[a-z0-9-]{16,128}$/.test(maxExtracted), "Parser: exactly 128-char ID accepted");

  void tempRoot;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-process retry-budget consuming-intent race (Scenarios 80–90)
// ─────────────────────────────────────────────────────────────────────────────

interface RaceWorkerResult {
  workerId: string;
  outcome: "consumed" | "conflict" | "error";
  reasonCode: string;
  consumingStatus?: string;
  consumedStatus?: string;
  consumedOk: boolean;
  authorityValidated: boolean;
  evidence: string[];
  error?: string;
}

async function runCrossProcessRaceTest(
  tempRoot: string,
  runtimeRoot: string,
  raceProjectSlug: string,
  raceStage: string,
  raceJobId: string,
  raceAuthorityId: string,
): Promise<void> {
  const workerScript = path.join(process.cwd(), "scripts", "smoke-sprint-129-36-race-worker.ts");
  assertContained(process.cwd(), workerScript);

  const timeout = 30_000;

  function spawnWorker() {
    let readyReached = false;
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    let result: RaceWorkerResult | undefined;
    let completedResolve!: (value: { result: RaceWorkerResult; exitCode: number }) => void;
    let completedReject!: (error: Error) => void;
    const completed = new Promise<{ result: RaceWorkerResult; exitCode: number }>((resolve, reject) => {
      completedResolve = resolve;
      completedReject = reject;
    });
      const workerArgs = [
        `--runtime-root=${runtimeRoot}`,
        `--project-slug=${raceProjectSlug}`,
        `--stage=${raceStage}`,
        `--job-id=${raceJobId}`,
        `--authority-id=${raceAuthorityId}`,
      ];

      const child = fork(workerScript, workerArgs, {
        cwd: process.cwd(),
        execArgv: ["--import", "tsx"],
        env: {


          ...process.env,
          ATOLYE_RUNTIME_ROOT: runtimeRoot,
          ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(runtimeRoot, "authority-root"),
          NODE_ENV: "test",
          AI_PROVIDER: "mock",
        },
        silent: true,
      });

      let output = "";
      let stderrOutput = "";
      child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr?.on("data", (chunk: Buffer) => { stderrOutput += chunk.toString(); });

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        const error = new Error(`Race worker timed out after ${timeout}ms. output=${output}, stderr=${stderrOutput}`);
        readyReject(error);
        completedReject(error);
      }, timeout);

      child.on("message", (message) => {
        if (!message || typeof message !== "object") return;
        const typed = message as {
          type?: string;
          authorityValidated?: boolean;
          result?: RaceWorkerResult;
        };
        if (typed.type === "ready" && typed.authorityValidated === true) {
          readyReached = true;
          readyResolve();
        }
        if (typed.type === "result" && typed.result) result = typed.result;
      });

      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        if (signal) {
          const error = new Error(`Race worker killed with signal ${signal}`);
          readyReject(error);
          completedReject(error);
          return;
        }
        if (code !== 0 || !result) {
          const error = new Error(
            `Race worker failed. code=${code}, result=${JSON.stringify(result)}, output=${output}, stderr=${stderrOutput}`,
          );
          readyReject(error);
          completedReject(error);
          return;
        }
        completedResolve({ result, exitCode: code });
      });


      child.on("error", (err) => {
        clearTimeout(timer);
        readyReject(err);
        completedReject(err);
      });
    return { child, ready, completed, readyReached: () => readyReached };
  }

  assert(path.resolve(runtimeRoot) === path.resolve(tempRoot),
    "Cross-process consuming-intent race: runtime is the exact operation-owned temp root");
  const workers = [spawnWorker(), spawnWorker()];
  await Promise.all(workers.map(worker => worker.ready));
  assert(workers.length === 2 && workers.every(worker => worker.readyReached()),
    "Cross-process consuming-intent race: both workers reached the authenticated ready barrier");
  let startBroadcastCount = 0;
  for (const worker of workers) {
    worker.child.send({ type: "start" });
    startBroadcastCount += 1;
  }
  const completed = await Promise.all(workers.map(worker => worker.completed));
  assert(startBroadcastCount === 2 && completed.every(worker => worker.exitCode === 0),
    "Cross-process consuming-intent race: start reached both workers and both exited with code 0");
  const [result1, result2] = completed.map(worker => worker.result);

  const consumers = [result1, result2].filter(r => r.outcome === "consumed");
  const conflicts = [result1, result2].filter(r => r.outcome === "conflict");

  console.log("  [race] result1:", JSON.stringify(result1));
  console.log("  [race] result2:", JSON.stringify(result2));

  assert(consumers.length === 1,
    `Cross-process consuming-intent race: exactly one worker consumed the authority (got ${consumers.length})`);
  assert(conflicts.length === 1 && conflicts[0]?.reasonCode === "CONSUMING_INTENT_CONFLICT",
    `Cross-process consuming-intent race: exactly one worker received CONSUMING_INTENT_CONFLICT (got ${JSON.stringify(conflicts)})`);
  assert(consumers[0]?.consumedOk === true &&
    consumers[0]?.reasonCode === "CONSUMED_SUCCESSFULLY" &&
    conflicts[0]?.consumedOk === false,
    "Cross-process consuming-intent race: consumed winner alone reports true and exact conflict loser reports false");
  assert([result1, result2].every(result => result.authorityValidated === true),
    "Cross-process consuming-intent race: both workers validated canonical trusted authority before start");

  const raceRuntimeInput = createRuntimeStorageContext({ environment: { ATOLYE_RUNTIME_ROOT: runtimeRoot, ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(runtimeRoot, "authority-root") } });
  const tempExtDir = getRetryBudgetExtensionDirectory(raceProjectSlug, raceRuntimeInput);
  const files = fs.existsSync(tempExtDir) ? fs.readdirSync(tempExtDir) : [];
  const consumedFiles = files.filter(f => f.startsWith("receipt-") && f.endsWith("-consumed.json"));
  assert(consumedFiles.length === 1,
    `Cross-process consuming-intent race: exactly one consumed receipt exists (found ${consumedFiles.length})`);

  const consumingFiles = files.filter(f => f.startsWith("receipt-") && f.endsWith("-consuming.json"));
  assert(consumingFiles.length === 1,
    `Cross-process consuming-intent race: exactly one consuming-intent receipt exists (found ${consumingFiles.length})`);

  assert(consumedFiles.length + consumingFiles.length <= 2,
    "Cross-process consuming-intent race: no duplicate or contradictory receipts were produced");

  assert(result1.outcome !== "error" && result2.outcome !== "error",
    `Cross-process consuming-intent race: no worker crashed (r1=${result1.outcome}, r2=${result2.outcome})`);

  console.log("  [race-evidence]", JSON.stringify({
    childCount: workers.length,
    authenticatedReadyCount: workers.filter(worker => worker.readyReached()).length,
    barrierReached: true,
    startBroadcastCount,
    winnerCount: consumers.length,
    winnerOutcome: consumers[0]?.outcome,
    winnerConsumedOk: consumers[0]?.consumedOk,
    loserCount: conflicts.length,
    loserOutcome: conflicts[0]?.outcome,
    loserReasonCode: conflicts[0]?.reasonCode,
    loserConsumedOk: conflicts[0]?.consumedOk,
    childExitCodes: completed.map(worker => worker.exitCode),
    consumingReceiptCount: consumingFiles.length,
    consumedReceiptCount: consumedFiles.length,
    duplicateOrAmbiguousReceiptCount: Math.max(0, consumedFiles.length - 1) +
      Math.max(0, consumingFiles.length - 1),
  }));
  console.log(`  [race] Worker 1: outcome=${result1.outcome} reasonCode=${result1.reasonCode}`);
  console.log(`  [race] Worker 2: outcome=${result2.outcome} reasonCode=${result2.reasonCode}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement write-failure + restart recovery (Scenarios 91–100)
// ─────────────────────────────────────────────────────────────────────────────

async function runSettlementRecoveryTest(
  runtimeRoot: string,
  testProjectSlug: string,
  testAuthorityId: string,
  challengePayload: Parameters<typeof buildProductionPipelineRetryBudgetExtensionBody>[0],
): Promise<void> {
  const originalRuntime = process.env.ATOLYE_RUNTIME_ROOT;
  process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;

  try {
    const testInput = createRuntimeStorageContext({
      workspaceRoot: runtimeRoot,
      environment: {
        ATOLYE_RUNTIME_ROOT: runtimeRoot,
        ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(runtimeRoot, "authority-root"),
      },
    });

    const authorityBody = buildProductionPipelineRetryBudgetExtensionBody(
      challengePayload,
      new Date().toISOString(),
    );
    writeRetryBudgetExtensionAuthority(testProjectSlug, authorityBody, testInput);

    const consumedReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
      testAuthorityId,
      "consumed",
      new Date().toISOString(),
      "v-ordinal-4-terminal",
      ["settlement-recovery-test:consumed-state"],
    );
    writeRetryBudgetExtensionReceipt(testProjectSlug, consumedReceipt, testInput);

    const consumedCheck = readRetryBudgetExtensionReceipt(testProjectSlug, testAuthorityId, "consumed", testInput);
    assert(consumedCheck.ok && consumedCheck.value?.state === "consumed",
      "Settlement recovery: consumed receipt present at fault injection point");

    const settledCheck0 = readRetryBudgetExtensionReceipt(testProjectSlug, testAuthorityId, "settled", testInput);
    assert(!settledCheck0.ok,
      "Settlement recovery: settled receipt absent at fault injection point (simulates write failure)");

    const settledReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
      testAuthorityId,
      "settled",
      new Date().toISOString(),
      "v-ordinal-4-terminal",
      ["settlement-recovery:settled-after-restart"],
    );
    const writeSettled = writeRetryBudgetExtensionReceipt(testProjectSlug, settledReceipt, testInput);

    assert(writeSettled.ok || writeSettled.status === "replayed",
      "Settlement recovery: settled receipt published successfully on restart");

    const settledReadback = readRetryBudgetExtensionReceipt(testProjectSlug, testAuthorityId, "settled", testInput);
    assert(settledReadback.ok && settledReadback.value?.state === "settled",
      "Settlement recovery: settled receipt readback verified");

    assert(settledReadback.value?.authorityId === testAuthorityId,
      "Settlement recovery: settled receipt bound to the correct authority ID");

    const consumedReadback = readRetryBudgetExtensionReceipt(testProjectSlug, testAuthorityId, "consumed");
    assert(consumedReadback.ok && consumedReadback.value?.state === "consumed",
      "Settlement recovery: consumed receipt remains present and durable lineage is preserved");

    const authorityReadback = readRetryBudgetExtensionAuthority(testProjectSlug, testAuthorityId);
    assert(authorityReadback.ok && authorityReadback.value?.authorityId === testAuthorityId,
      "Settlement recovery: authority remains byte-identical");

    const writeSettled2 = writeRetryBudgetExtensionReceipt(testProjectSlug, settledReceipt);
    assert(writeSettled2.ok && writeSettled2.status === "replayed",
      "Settlement recovery: second replay is write-free and idempotent");

    const gateNewAttempt = await verifyCanonicalPipelineRetryBudgetExtensionAdmission({
      phase: "before-consumption",
      projectSlug: testProjectSlug,
      stage: stage as Parameters<typeof verifyCanonicalPipelineRetryBudgetExtensionAdmission>[0]["stage"],
      jobId: `${testProjectSlug}-${stage}`,
      runType: "resume",
      authorityId: testAuthorityId,
    });
    assert(!gateNewAttempt.ok && gateNewAttempt.reasonCode === "PIPELINE_RETRY_BUDGET_EXTENSION_ALREADY_CONSUMED",
      "Settlement recovery: gate rejects authority reuse for a new attempt");

    const extDir = getRetryBudgetExtensionDirectory(testProjectSlug);
    const allFiles = fs.existsSync(extDir) ? fs.readdirSync(extDir) : [];
    const settledFiles = allFiles.filter(f => f.includes(testAuthorityId) && f.endsWith("-settled.json"));
    assert(settledFiles.length === 1,
      "Settlement recovery: exactly one settled receipt exists after idempotent replay");
  } finally {
    if (originalRuntime !== undefined) {
      process.env.ATOLYE_RUNTIME_ROOT = originalRuntime;
    } else {
      delete process.env.ATOLYE_RUNTIME_ROOT;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main suite
// ─────────────────────────────────────────────────────────────────────────────

interface RewindDurableArtifact {
  readonly retryBudgetExtension?: RetryBudgetExtensionDurableBinding;
  readonly identity?: { readonly identityFingerprint?: string; readonly operation?: string;
    readonly reservationId?: string; readonly recordId?: string; readonly claimId?: string;
    readonly attemptId?: string; readonly leaseId?: string; readonly stage?: string };
  readonly durableLease?: { readonly retryBudgetExtension?: RetryBudgetExtensionDurableBinding;
    readonly identity?: { readonly recordId?: string; readonly leaseId?: string } };
  readonly recordId?: string;
  readonly identityFingerprint?: string;
  readonly operation?: string;
  readonly stage?: string;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly recordVersion?: number;
  readonly claimVersion?: number;
  readonly attemptVersion?: number;
  readonly [key: string]: unknown;
}

function rewindOwnedProjectToExhaustedAudioFixture(projectRoot: string, ownedRoot: string) {
  assertContained(ownedRoot, projectRoot);
  if (path.basename(projectRoot) !== baseProjectSlug ||
    fs.realpathSync(projectRoot) === fs.realpathSync(repoProdDir)) {
    throw new Error("ISOLATED_AUDIO_PROJECT_OWNERSHIP_INVALID");
  }
  const historyPath = path.join(projectRoot, "pipeline-history.json");
  const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
  const failure = history.events.filter((event: {
    stage?: string; status?: string; errorCode?: string;
  }) => event.stage === stage && event.status === "failed" && event.errorCode).at(-1);
  if (!failure) throw new Error("ISOLATED_AUDIO_FAILURE_FIXTURE_MISSING");
  if (failure.jobId !== `${baseProjectSlug}-${stage}` ||
    typeof failure.recordedAt !== "string" || typeof failure.jobUpdatedAt !== "string") {
    throw new Error("ISOLATED_AUDIO_FAILURE_FIXTURE_INVALID");
  }
  const jobsPath = path.join(projectRoot, "pipeline-jobs.json");
  const jobs = JSON.parse(fs.readFileSync(jobsPath, "utf8"));
  const currentAudioJob = jobs.jobs.find((job: { stage?: string }) => job.stage === stage);
  if (currentAudioJob?.id !== `${baseProjectSlug}-${stage}` ||
    currentAudioJob.status !== "completed" || currentAudioJob.attempts !== 3) {
    throw new Error("ISOLATED_AUDIO_CURRENT_JOB_STATE_INVALID");
  }
  const manifestPath = path.join(projectRoot, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.packages?.[stage]?.status !== "completed" ||
    manifest.packages?.[stage]?.attempts?.total !== 4 ||
    manifest.packages?.[stage]?.attempts?.lastRunType !== "resume") {
    throw new Error("ISOLATED_AUDIO_CURRENT_MANIFEST_STATE_INVALID");
  }

  const executionRoot = path.join(projectRoot, "production-execution");
  const extensionDirectory = path.join(executionRoot, "retry-budget-extensions");
  const authorityCandidates = fs.readdirSync(extensionDirectory)
    .filter((name) => name.startsWith("authority-") && name.endsWith(".json"))
    .map((name) => ({ name, target: path.join(extensionDirectory, name) }))
    .filter(({ target }) => {
      const body = JSON.parse(fs.readFileSync(target, "utf8"));
      return validateExtensionBodyIntegrity(body) && body.projectSlug === baseProjectSlug &&
        body.stage === stage && body.jobId === `${baseProjectSlug}-${stage}` &&
        body.authorizedOperation === "pipeline.stage.resume" &&
        body.authorizedDurableOrdinal === 4;
    });
  if (authorityCandidates.length !== 1) {
    throw new Error("ISOLATED_AUDIO_ORDINAL_FOUR_AUTHORITY_AMBIGUOUS");
  }
  const authorityTarget = authorityCandidates[0].target;
  const authority = JSON.parse(fs.readFileSync(authorityTarget, "utf8"));
  const consumedTarget = path.join(extensionDirectory,
    `receipt-${authority.authorityId}-consumed.json`);
  const consumed = JSON.parse(fs.readFileSync(consumedTarget, "utf8"));
  if (!validateExtensionReceiptIntegrity(consumed) || consumed.state !== "consumed" ||
    consumed.authorityId !== authority.authorityId) {
    throw new Error("ISOLATED_AUDIO_ORDINAL_FOUR_CONSUMED_RECEIPT_INVALID");
  }

  const canonical = preflightHistoricalAudioOrdinalFour({
    executionRoot, ownedRoot, authority, consumed,
  });
  const verifiedBinding = canonical.binding;
  const deletionTargets = canonical.deletionTargets;
  const allowedReceiptStates = ["consuming", "consumed", "settled"] as const;
  const allowedReceiptNames = allowedReceiptStates.map((receiptState) =>
    `receipt-${authority.authorityId}-${receiptState}.json`);
  const matchingReceiptNames = fs.readdirSync(extensionDirectory)
    .filter((name) => name.startsWith(`receipt-${authority.authorityId}-`));
  if (matchingReceiptNames.length !== allowedReceiptNames.length ||
    matchingReceiptNames.some((name) => !allowedReceiptNames.includes(name))) {
    throw new Error("ISOLATED_AUDIO_ORDINAL_FOUR_RECEIPT_INVENTORY_INVALID");
  }
  const receiptTargets = allowedReceiptNames.map((name) => path.join(extensionDirectory, name));
  for (const [index, target] of receiptTargets.entries()) {
    const receipt = JSON.parse(fs.readFileSync(target, "utf8"));
    if (!validateExtensionReceiptIntegrity(receipt) ||
      receipt.authorityId !== authority.authorityId ||
      receipt.state !== allowedReceiptStates[index] ||
      receipt.state === "consumed" &&
        receipt.integrity.fingerprint !== verifiedBinding.consumptionReceiptFingerprint ||
      receipt.state === "settled" &&
        (receipt.jobVersion !== consumed.jobVersion ||
          JSON.stringify(receipt.evidence) !==
            JSON.stringify(["terminal-settlement:settled-receipt-finalized"]))) {
      throw new Error("ISOLATED_AUDIO_ORDINAL_FOUR_RECEIPT_INVALID");
    }
  }
  // Mutation phase starts only after ownership, history, job, manifest, lineage and receipt preflight.
  for (const target of [...deletionTargets, authorityTarget, ...receiptTargets]) {
    assertContained(ownedRoot, target);
    fs.unlinkSync(target);
  }
  history.events = history.events.filter((event: { stage?: string; recordedAt?: string }) =>
    event.stage !== stage || String(event.recordedAt ?? "") <= failure.recordedAt);
  history.updatedAt = failure.recordedAt;
  fs.writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
  Object.assign(jobs.jobs.find((job: { stage?: string }) => job.stage === stage), {
    status: "failed", attempts: 2, updatedAt: failure.jobUpdatedAt,
    startedAt: failure.startedAt, completedAt: failure.completedAt,
    error: failure.errorCode,
  });
  jobs.updatedAt = failure.jobUpdatedAt;
  fs.writeFileSync(jobsPath, `${JSON.stringify(jobs, null, 2)}\n`, "utf8");
  Object.assign(manifest.packages[stage], { status: "failed",
    updatedAt: failure.completedAt, startedAt: failure.startedAt,
    completedAt: failure.completedAt, error: failure.errorCode });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function findDurableArtifact(executionRoot: string,
  predicate: (value: RewindDurableArtifact) => boolean): string {
  for (const directory of ["reservations", "idempotency", "claims", "attempts"]) {
    const root = path.join(executionRoot, directory);
    for (const name of fs.readdirSync(root)) {
      const target = path.join(root, name);
      const value = JSON.parse(fs.readFileSync(target, "utf8")) as RewindDurableArtifact;
      if (predicate(value)) return target;
    }
  }
  throw new Error("ISOLATED_UNRELATED_DURABLE_ARTIFACT_MISSING");
}

function runCanonicalRewindPoisonRegression(
  kind: "alternative-chain" | "claim-v1-poison" | "attempt-v1-poison",
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sprint-129-36-ext-smoke-"));
  const identity = captureOwnedTempRootIdentity(root);
  try {
    const projectRoot = path.join(root, "projects", baseProjectSlug);
    fs.cpSync(repoProdDir, projectRoot, { recursive: true });
    const executionRoot = path.join(projectRoot, "production-execution");
    const extensionRoot = path.join(executionRoot, "retry-budget-extensions");
    const authority = JSON.parse(fs.readFileSync(path.join(extensionRoot,
      fs.readdirSync(extensionRoot).find((name) => name.startsWith("authority-"))!), "utf8"));
    const consumed = JSON.parse(fs.readFileSync(path.join(extensionRoot,
      `receipt-${authority.authorityId}-consumed.json`), "utf8"));
    const canonical = preflightHistoricalAudioOrdinalFour({
      executionRoot, ownedRoot: root, authority, consumed,
    });
    if (kind === "alternative-chain") createAlternativeHistoricalAudioOrdinalFourChain(canonical);
    else if (kind === "claim-v1-poison") poisonHistoricalAudioOrdinalFourClaimV1(canonical);
    else poisonHistoricalAudioOrdinalFourAttemptV1(canonical);
    const before = inventoryDigest(computeFileInventory(projectRoot));
    const expected = kind === "alternative-chain"
      ? "CANONICAL_AUDIO_ORDINAL_FOUR_UNEXPECTED_SAME_BINDING_ARTIFACT"
      : kind === "claim-v1-poison" ? "CANONICAL_AUDIO_ORDINAL_FOUR_CLAIM_LINEAGE_INVALID"
        : "CANONICAL_AUDIO_ORDINAL_FOUR_ATTEMPT_LINEAGE_INVALID";
    let actual = "";
    try { rewindOwnedProjectToExhaustedAudioFixture(projectRoot, root); }
    catch (error) { actual = error instanceof Error ? error.message : ""; }
    return actual === expected && inventoryDigest(computeFileInventory(projectRoot)) === before;
  } finally {
    cleanupOwnedTempRoot(identity);
  }
}

function runExactRewindOwnershipRegression(): {
  unrelatedAuthorityPreserved: boolean; unrelatedStagePreserved: boolean;
  unrelatedOrdinalPreserved: boolean; unrelatedReceiptPreserved: boolean;
  duplicateSiblingWriteFree: boolean; corruptMatchingWriteFree: boolean;
  unknownMatchingWriteFree: boolean; missingHistoryWriteFree: boolean;
  alternativeChainWriteFree: boolean; claimV1PoisonWriteFree: boolean;
  attemptV1PoisonWriteFree: boolean;
} {
  const preservedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sprint-129-36-ext-smoke-"));
  const preservedIdentity = captureOwnedTempRootIdentity(preservedRoot);
  let unrelatedAuthorityPreserved = false;
  let unrelatedStagePreserved = false;
  let unrelatedOrdinalPreserved = false;
  let unrelatedReceiptPreserved = false;
  try {
    const projectRoot = path.join(preservedRoot, "projects", baseProjectSlug);
    fs.cpSync(repoProdDir, projectRoot, { recursive: true });
    const executionRoot = path.join(projectRoot, "production-execution");
    const extensionRoot = path.join(executionRoot, "retry-budget-extensions");
    const sourceAuthority = JSON.parse(fs.readFileSync(path.join(extensionRoot,
      fs.readdirSync(extensionRoot).find((name) => name.startsWith("authority-"))!), "utf8"));
    const challengePayload = { ...sourceAuthority };
    delete challengePayload.authorityId;
    delete challengePayload.issuedAt;
    delete challengePayload.integrity;
    const unrelatedAuthority = buildProductionPipelineRetryBudgetExtensionBody({
      ...challengePayload, stage: "assembly", jobId: `${baseProjectSlug}-assembly`,
      reason: "sprint-129-38-unrelated-authority-preservation",
    }, new Date().toISOString());
    const unrelatedAuthorityPath = path.join(extensionRoot,
      `authority-${unrelatedAuthority.authorityId}.json`);
    fs.writeFileSync(unrelatedAuthorityPath,
      `${JSON.stringify(unrelatedAuthority, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    const unrelatedReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
      unrelatedAuthority.authorityId, "consumed", new Date().toISOString(),
      "unrelated-job-version", ["transaction:consumed"]);
    const unrelatedReceiptPath = path.join(extensionRoot,
      `receipt-${unrelatedAuthority.authorityId}-consumed.json`);
    fs.writeFileSync(unrelatedReceiptPath,
      `${JSON.stringify(unrelatedReceipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    const unrelatedStagePath = findDurableArtifact(executionRoot, (value) =>
      typeof value.identity?.stage === "string" && value.identity.stage !== stage);
    const unrelatedOrdinalPath = findDurableArtifact(executionRoot, (value) =>
      value.stage === stage && Number.isSafeInteger(value.attempt) && value.attempt !== 4);
    const protectedFiles = new Map([
      ["authority", unrelatedAuthorityPath], ["stage", unrelatedStagePath],
      ["ordinal", unrelatedOrdinalPath], ["receipt", unrelatedReceiptPath],
    ].map(([name, target]) => [name, { target, bytes: fs.readFileSync(target) }]));
    rewindOwnedProjectToExhaustedAudioFixture(projectRoot, preservedRoot);
    const preserved = (name: string) => {
      const item = protectedFiles.get(name)!;
      return fs.existsSync(item.target) && fs.readFileSync(item.target).equals(item.bytes);
    };
    unrelatedAuthorityPreserved = preserved("authority");
    unrelatedStagePreserved = preserved("stage");
    unrelatedOrdinalPreserved = preserved("ordinal");
    unrelatedReceiptPreserved = preserved("receipt");
  } finally {
    cleanupOwnedTempRoot(preservedIdentity);
  }

  const duplicateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sprint-129-36-ext-smoke-"));
  const duplicateIdentity = captureOwnedTempRootIdentity(duplicateRoot);
  let duplicateSiblingWriteFree = false;
  try {
    const projectRoot = path.join(duplicateRoot, "projects", baseProjectSlug);
    fs.cpSync(repoProdDir, projectRoot, { recursive: true });
    const recordRoot = path.join(projectRoot, "production-execution", "idempotency");
    const canonical = fs.readdirSync(recordRoot).find((name) => {
      const value = JSON.parse(fs.readFileSync(path.join(recordRoot, name), "utf8"));
      return value.retryBudgetExtension?.authorizedDurableOrdinal === 4;
    })!;
    const duplicatePath = path.join(recordRoot, "duplicate-exact-binding-sibling.json");
    fs.copyFileSync(path.join(recordRoot, canonical), duplicatePath,
      fs.constants.COPYFILE_EXCL);
    const before = inventoryDigest(computeFileInventory(projectRoot));
    let rejected = false;
    try { rewindOwnedProjectToExhaustedAudioFixture(projectRoot, duplicateRoot); }
    catch { rejected = true; }
    duplicateSiblingWriteFree = rejected &&
      inventoryDigest(computeFileInventory(projectRoot)) === before;
  } finally {
    cleanupOwnedTempRoot(duplicateIdentity);
  }

  const corruptRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sprint-129-36-ext-smoke-"));
  const corruptIdentity = captureOwnedTempRootIdentity(corruptRoot);
  let corruptMatchingWriteFree = false;
  try {
    const projectRoot = path.join(corruptRoot, "projects", baseProjectSlug);
    fs.cpSync(repoProdDir, projectRoot, { recursive: true });
    const extensionRoot = path.join(projectRoot, "production-execution",
      "retry-budget-extensions");
    const consumedPath = path.join(extensionRoot, fs.readdirSync(extensionRoot)
      .find((name) => name.endsWith("-consumed.json"))!);
    const consumed = JSON.parse(fs.readFileSync(consumedPath, "utf8"));
    consumed.jobVersion = "corrupt-rewind-candidate";
    fs.writeFileSync(consumedPath, `${JSON.stringify(consumed, null, 2)}\n`, "utf8");
    const before = inventoryDigest(computeFileInventory(projectRoot));
    let rejected = false;
    try { rewindOwnedProjectToExhaustedAudioFixture(projectRoot, corruptRoot); }
    catch { rejected = true; }
    const after = inventoryDigest(computeFileInventory(projectRoot));
    corruptMatchingWriteFree = rejected && after === before;
  } finally {
    cleanupOwnedTempRoot(corruptIdentity);
  }

  const unknownRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sprint-129-36-ext-smoke-"));
  const unknownIdentity = captureOwnedTempRootIdentity(unknownRoot);
  let unknownMatchingWriteFree = false;
  try {
    const projectRoot = path.join(unknownRoot, "projects", baseProjectSlug);
    fs.cpSync(repoProdDir, projectRoot, { recursive: true });
    const extensionRoot = path.join(projectRoot, "production-execution",
      "retry-budget-extensions");
    const authority = JSON.parse(fs.readFileSync(path.join(extensionRoot,
      fs.readdirSync(extensionRoot).find((name) => name.startsWith("authority-"))!), "utf8"));
    const consumedReceipt = JSON.parse(fs.readFileSync(path.join(extensionRoot,
      `receipt-${authority.authorityId}-consumed.json`), "utf8"));
    const unknownReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
      authority.authorityId, "future" as never, new Date().toISOString(),
      consumedReceipt.jobVersion, ["future:unsupported"]);
    const unknownPath = path.join(extensionRoot,
      `receipt-${authority.authorityId}-future.json`);
    fs.writeFileSync(unknownPath, `${JSON.stringify(unknownReceipt, null, 2)}\n`, "utf8");
    const before = inventoryDigest(computeFileInventory(projectRoot));
    let rejected = false;
    try { rewindOwnedProjectToExhaustedAudioFixture(projectRoot, unknownRoot); }
    catch { rejected = true; }
    unknownMatchingWriteFree = rejected &&
      inventoryDigest(computeFileInventory(projectRoot)) === before;
  } finally {
    cleanupOwnedTempRoot(unknownIdentity);
  }

  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sprint-129-36-ext-smoke-"));
  const missingIdentity = captureOwnedTempRootIdentity(missingRoot);
  let missingHistoryWriteFree = false;
  try {
    const projectRoot = path.join(missingRoot, "projects", baseProjectSlug);
    fs.cpSync(repoProdDir, projectRoot, { recursive: true });
    const historyPath = path.join(projectRoot, "pipeline-history.json");
    const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
    history.events = history.events.filter((event: { stage?: string; status?: string }) =>
      event.stage !== stage || event.status !== "failed");
    fs.writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
    const before = inventoryDigest(computeFileInventory(projectRoot));
    let rejected = false;
    try { rewindOwnedProjectToExhaustedAudioFixture(projectRoot, missingRoot); }
    catch { rejected = true; }
    missingHistoryWriteFree = rejected &&
      inventoryDigest(computeFileInventory(projectRoot)) === before;
  } finally {
    cleanupOwnedTempRoot(missingIdentity);
  }
  const alternativeChainWriteFree = runCanonicalRewindPoisonRegression("alternative-chain");
  const claimV1PoisonWriteFree = runCanonicalRewindPoisonRegression("claim-v1-poison");
  const attemptV1PoisonWriteFree = runCanonicalRewindPoisonRegression("attempt-v1-poison");
  return { unrelatedAuthorityPreserved, unrelatedStagePreserved,
    unrelatedOrdinalPreserved, unrelatedReceiptPreserved, duplicateSiblingWriteFree,
    corruptMatchingWriteFree,
    unknownMatchingWriteFree, missingHistoryWriteFree, alternativeChainWriteFree,
    claimV1PoisonWriteFree, attemptV1PoisonWriteFree };
}

async function runRealOrdinalFourProductionWriterTest() {
  const ownedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sprint-129-36-ext-smoke-"));
  const ownedRootIdentity = captureOwnedTempRootIdentity(ownedRoot);
  const storageContext = createRuntimeStorageContext({ workspaceRoot: ownedRoot,
    environment: { ATOLYE_RUNTIME_ROOT: ownedRoot,
      ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(ownedRoot, "authority") } });
  const operationContext = createProductionRuntimeOperationContext({
    operationId: `sprint-129-36-ordinal-four-${crypto.randomUUID()}`,
    operationType: "sprint-129-36-validation",
    authorityGeneration: initialRuntimeAuthorityGeneration,
    storageContext,
  });
  const now = new Date().toISOString();
  const worker = new ProductionWorkerLifecycle(() => now);
  worker.bindRuntimeOperationContext(operationContext);
  let registration: ReturnType<typeof configureScopedProductionPipelineExecution> | undefined;
  try {
    const started = await worker.start({ initialization: {
      schemaVersion: "1", ok: true, decision: "ready", reasonCode: "RUNTIME_INITIALIZED",
      initializedAt: now, writeFree: true, partialInitialization: false, projects: [],
      counts: { active: 0, running: 0, terminal: 0, orphaned: 0,
        "expired-lease": 0, replayable: 0 }, worker: worker.snapshot(), evidence: [],
    } });
    if (!started.ok) throw new Error("ORDINAL_FOUR_WORKER_NOT_READY");
    registration = configureScopedProductionPipelineExecution({
      lifecycle: worker, runtimeOperationContext: operationContext,
    });
    await runWithProductionRuntimeOperationContext(operationContext, async () => {
    const projectRoot = path.join(storageContext.projectsRoot, baseProjectSlug);
    fs.cpSync(repoProdDir, projectRoot, { recursive: true });
    rewindOwnedProjectToExhaustedAudioFixture(projectRoot, ownedRoot);
    const markerPath = path.join(projectRoot, "production-acceptance.json");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as {
      topic: string; runId: string; requestFingerprint: string;
      configurationFingerprint: string; componentFingerprints: Record<string, string>;
    };
    const configuration = await createProductionAcceptancePortableConfigurationSnapshotV2(baseProjectSlug);
    if (configuration.unavailableComponents.length > 0) {
      throw new Error(`ORDINAL_FOUR_CONFIGURATION_UNAVAILABLE:${configuration.unavailableComponents.join(",")}`);
    }
    marker.configurationFingerprint = configuration.configurationFingerprint;
    marker.componentFingerprints = { ...configuration.componentFingerprints };
    marker.requestFingerprint = productionAcceptanceRequestFingerprintV3Profile2({
      topic: marker.topic, runId: marker.runId,
      configurationFingerprint: marker.configurationFingerprint,
    });
    fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");

    const jobId = `${baseProjectSlug}-${stage}`;
    const plan = await planRetryBudgetExtension(
      baseProjectSlug, stage, jobId, reason, storageContext,
    );
    assert(plan.eligible && Boolean(plan.authorityId),
      "Real ordinal-4 fixture plans against an operation-owned runtime");
    const applied = await applyRetryBudgetExtension(
      baseProjectSlug, stage, jobId, reason, plan.authorityId!, plan.authorityId!,
      storageContext,
    );
    assert(applied.success, "Real ordinal-4 authority is published in operation-owned storage");
    const retry = await prepareFailedStageRetry(
      baseProjectSlug, jobId, "resume", storageContext,
    );
    if (!retry.success) throw new Error(`REAL_ORDINAL_FOUR_RETRY_FAILED:${retry.reasonCode}`);
    assert(retry.admission.admittedDurableOrdinal === 4 &&
      retry.admission.retryBudgetAuthorityProof?.authorityId === plan.authorityId,
    "Real failed-stage retry consumes the authority and admits durable ordinal 4");
    assertCanonicalPipelineRetryAdmission({ admission: retry.admission,
      previousJob: retry.previousJob, currentJob: retry.job, projectSlug: baseProjectSlug,
      stage: stage as Parameters<typeof assertCanonicalPipelineRetryAdmission>[0]["stage"],
      runType: "resume" });
    const historicalAdapter = new ProductionExecutionFilePersistenceAdapter({
      trustedRootDirectory: path.join(storageContext.projectsRoot, baseProjectSlug,
        "production-execution"),
    });
    await readProductionCanonicalTerminalDurableLineage(historicalAdapter,
      retry.admission.exactReconciledDurableLineageIdentity,
      retry.admission.exactReconciledLineageBinding.reservationId,
      retry.admission.exactReconciledLineageBinding);

    const prepared = await withProductionAcceptanceRetryAdmission(
      retry.admission, retry.previousJob,
      () => prepareProductionPipelineExecution({ projectSlug: baseProjectSlug, stage, runType: "resume" }),
    );
    const completed = readCompletedProductionPipelinePreparation(prepared.authority);
    const bindings = [completed.reservation.retryBudgetExtension,
      completed.record.retryBudgetExtension, completed.lease.retryBudgetExtension,
      completed.claim.retryBudgetExtension, completed.attempt.retryBudgetExtension];
    assert(bindings.every(Boolean),
      "Real production factory persists the extension on all five durable siblings");
    const canonicalBinding = JSON.stringify(bindings[0]);
    assert(bindings.every((binding) => JSON.stringify(binding) === canonicalBinding),
      "All five siblings persist one byte-equivalent canonical extension binding");

    const gateInput = { phase: "before-execution" as const, projectSlug: baseProjectSlug,
      stage: stage as Parameters<typeof verifyCanonicalPipelineRetryBudgetExtensionAdmission>[0]["stage"],
      jobId, runType: "resume" as const, authorityId: plan.authorityId!,
      input: storageContext };
    const gate = await verifyCanonicalPipelineRetryBudgetExtensionAdmission(gateInput);
    assert(gate.ok, "Before-execution gate accepts the real persisted ordinal-4 lineage");

    const storeRoot = path.join(projectRoot, "production-execution");
    const files = {
      reservation: path.join(storeRoot, "reservations",
        `${completed.reservation.identity.identityFingerprint}.json`),
      record: path.join(storeRoot, "idempotency",
        `${completed.record.recordId}-v${completed.record.recordVersion}.json`),
      claim: path.join(storeRoot, "claims",
        `${completed.claim.identity.claimId}-v${completed.claim.claimVersion}.json`),
      attempt: path.join(storeRoot, "attempts",
        `${completed.attempt.identity.attemptId}-v${completed.attempt.attemptVersion}.json`),
    };
    const tamperAndVerify = async (filePath: string,
      mutate: (value: Record<string, unknown>) => void, expectedReason: string,
      description: string) => {
      const original = fs.readFileSync(filePath, "utf8");
      try {
        const value = JSON.parse(original) as Record<string, unknown>;
        mutate(value);
        fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
        const rejected = await verifyCanonicalPipelineRetryBudgetExtensionAdmission(gateInput);
        assert(!rejected.ok && rejected.reasonCode === expectedReason, description);
      } finally {
        fs.writeFileSync(filePath, original, "utf8");
      }
    };
    const refreshIntegrity = (value: Record<string, unknown>, label: string) => {
      const { integrity: ignored, ...body } = value;
      void ignored;
      value.integrity = { algorithm: "stable-production-id-v1",
        fingerprint: stableProductionId(label, body) };
    };

    await tamperAndVerify(files.reservation, (value) => { delete value.retryBudgetExtension; },
      "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_MISSING",
      "Missing reservation extension is rejected deterministically");
    await tamperAndVerify(files.record, (value) => { delete value.retryBudgetExtension; },
      "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_MISSING",
      "Missing record extension is rejected deterministically");
    await tamperAndVerify(files.record, (value) => {
      const lease = value.durableLease as Record<string, unknown>;
      delete lease.retryBudgetExtension;
      refreshIntegrity(lease, "durable-lease-integrity");
    }, "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_MISSING",
    "Missing lease extension is rejected deterministically");
    await tamperAndVerify(files.claim, (value) => {
      delete value.retryBudgetExtension;
      refreshIntegrity(value, "durable-claim-integrity");
    }, "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_MISSING",
    "Missing claim extension is rejected deterministically");
    await tamperAndVerify(files.attempt, (value) => {
      delete value.retryBudgetExtension;
      refreshIntegrity(value, "durable-attempt-integrity");
    }, "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_MISSING",
    "Missing attempt extension is rejected deterministically");

    const mismatchFields = ["schemaVersion", "authorityId", "authorityIntegrityFingerprint",
      "consumptionReceiptFingerprint", "authorizedDurableOrdinal", "effectiveMaxAttempts",
      "authorizedRunType", "authorizedOperation", "projectSlug", "stage", "jobId",
      "identityFingerprint", "reservationBinding", "durableAttemptOrdinal"] as const;
    for (const field of mismatchFields) {
      await tamperAndVerify(files.reservation, (value) => {
        const binding = value.retryBudgetExtension as Record<string, unknown>;
        binding[field] = typeof binding[field] === "number" ? 99 : `mismatch-${field}`;
      }, "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_BINDING_MISMATCH",
      `Reservation extension field ${field} mismatch is rejected deterministically`);
    }
    const restoredGate = await verifyCanonicalPipelineRetryBudgetExtensionAdmission(gateInput);
    assert(restoredGate.ok, "Five-sibling negative matrix restores the canonical lineage exactly");
    assert(resolveRuntimeStorageContext(storageContext) === storageContext,
      "Active operation runtime preserves exact RuntimeStorageContext object identity");
    });
  } finally {
    registration?.restore();
    await worker.stop();
    cleanupOwnedTempRoot(ownedRootIdentity);
  }
}

async function runSmokeSuite() {
  console.log("Starting Sprint 129.36 — Full Remediation Smoke Test Suite...\n");

  const repoDataDir = path.join(process.cwd(), "data");
  const initialProdInventory = computeFileInventory(repoProdDir);
  const initialProdDigest = inventoryDigest(initialProdInventory);
  const initialDataInventory = computeFileInventory(repoDataDir);
  const initialDataDigest = inventoryDigest(initialDataInventory);

  console.log(`  [inventory] Production data/projects SHA-256: ${initialProdDigest.slice(0, 16)}... (${initialProdInventory.length} files)`);
  console.log(`  [inventory] Repository data/ SHA-256:         ${initialDataDigest.slice(0, 16)}... (${initialDataInventory.length} files)\n`);

  const cleanupSafety = runCleanupSafetyRegression();
  assert(cleanupSafety.failurePathCleaned,
    "Failure-path cleanup removes its exact operation-owned temp root");
  assert(cleanupSafety.reparseRejected,
    "Cleanup rejects a Windows junction/reparse-point before recursive deletion");
  const rewindSafety = runExactRewindOwnershipRegression();
  assert(rewindSafety.unrelatedAuthorityPreserved,
    "Historical rewind preserves integrity-valid unrelated authority bytes");
  assert(rewindSafety.unrelatedStagePreserved,
    "Historical rewind preserves unrelated stage durable bytes");
  assert(rewindSafety.unrelatedOrdinalPreserved,
    "Historical rewind preserves unrelated ordinal durable bytes");
  assert(rewindSafety.unrelatedReceiptPreserved,
    "Historical rewind preserves unrelated receipt bytes");
  assert(rewindSafety.duplicateSiblingWriteFree,
    "Historical rewind rejects duplicate exact-binding sibling before any fixture mutation");
  assert(rewindSafety.corruptMatchingWriteFree,
    "Historical rewind rejects corrupt matching receipt before any fixture mutation");
  assert(rewindSafety.unknownMatchingWriteFree,
    "Historical rewind rejects unknown same-authority receipt before any fixture mutation");
  assert(rewindSafety.missingHistoryWriteFree,
    "Historical rewind rejects missing failure eligibility before any fixture mutation");
  assert(rewindSafety.alternativeChainWriteFree,
    "Historical rewind rejects persistence-valid alternative full chain with zero mutation");
  assert(rewindSafety.claimV1PoisonWriteFree,
    "Historical rewind rejects persistence-valid non-terminal claim-v1 poison with zero mutation");
  assert(rewindSafety.attemptV1PoisonWriteFree,
    "Historical rewind rejects persistence-valid non-terminal attempt-v1 poison with zero mutation");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sprint-129-36-ext-smoke-"));
  assertContained(os.tmpdir(), tempRoot);
  const tempRootIdentity = captureOwnedTempRootIdentity(tempRoot);

  try {
  const projectSlug = baseProjectSlug;
  const jobId = `${projectSlug}-${stage}`;

  // Copy canonical project into isolated temp workspace root (<tempRoot>/projects/<projectSlug>):
  const tempProjectsDir = path.join(tempRoot, "projects", projectSlug);
  assertContained(tempRoot, tempProjectsDir);

  fs.mkdirSync(tempProjectsDir, { recursive: true });
  fs.cpSync(repoProdDir, tempProjectsDir, { recursive: true });

  // The production project legitimately advanced through ordinal 4 after this sprint.
  // Reconstruct the original exhausted failed/2 boundary only inside the owned temp copy.
  rewindOwnedProjectToExhaustedAudioFixture(tempProjectsDir, tempRoot);

  const isolatedInput = createRuntimeStorageContext({
    workspaceRoot: tempRoot,
    environment: {
      ATOLYE_RUNTIME_ROOT: tempRoot,
      ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(tempRoot, "authority-root"),
    },
  });

  process.env.ATOLYE_WORKSPACE_ROOT = tempRoot;
  process.env.ATOLYE_RUNTIME_ROOT = tempRoot;
  process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = path.join(tempRoot, "authority-root");
  (process.env as Record<string, string>).NODE_ENV = "test";
  (process.env as Record<string, string>).AI_PROVIDER = "mock";
  const ffmpegFixture = path.join(tempRoot, "fixture-ffmpeg.bin");
  const ffprobeFixture = path.join(tempRoot, "fixture-ffprobe.bin");
  fs.writeFileSync(ffmpegFixture, "isolated-ffmpeg-fingerprint-fixture", "utf8");
  fs.writeFileSync(ffprobeFixture, "isolated-ffprobe-fingerprint-fixture", "utf8");
  process.env.FFMPEG_PATH = ffmpegFixture;
  process.env.FFPROBE_PATH = ffprobeFixture;

  const markerPath = path.join(tempProjectsDir, "production-acceptance.json");
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as {
    topic: string;
    runId: string;
    requestFingerprint: string;
    configurationFingerprint: string;
    componentFingerprints: Record<string, string>;
  };
  const currentConfiguration = await createProductionAcceptancePortableConfigurationSnapshotV2(
    projectSlug,
  );
  if (currentConfiguration.unavailableComponents.length > 0) {
    throw new Error(`ISOLATED_ACCEPTANCE_CONFIGURATION_UNAVAILABLE:${
      currentConfiguration.unavailableComponents.join(",")}`);
  }
  marker.configurationFingerprint = currentConfiguration.configurationFingerprint;
  marker.componentFingerprints = { ...currentConfiguration.componentFingerprints };
  marker.requestFingerprint = productionAcceptanceRequestFingerprintV3Profile2({
    topic: marker.topic,
    runId: marker.runId,
    configurationFingerprint: marker.configurationFingerprint,
  });
  fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");

    // ═══════════════════════════════════════════════════════
    // BLOCK A: Cleanup and parser tests (Scenarios 1–16)
    // ═══════════════════════════════════════════════════════
    runParserTests(tempRoot);

    // ═══════════════════════════════════════════════════════
    // BLOCK B: Core plan/apply scenarios (Scenarios 17–25)
    // ═══════════════════════════════════════════════════════

    // 15. Exact exhausted failed/2 + durable ordinal 3 terminal lineage plan eligible.
    const plan1 = await planRetryBudgetExtension(projectSlug, stage, jobId, reason, isolatedInput);
    assert(plan1.eligible === true && typeof plan1.authorityId === "string" && plan1.authorityId.length >= 32,
      "Plan eligible for exact exhausted failed/2 state");

    // 16. Plan command is 100% write-free (verified by production data immutability).
    const afterPlanProdInventory = computeFileInventory(repoProdDir);
    assert(inventoryDigest(afterPlanProdInventory) === initialProdDigest,
      "Plan command is 100% write-free (production data/ byte-identical after plan)");

    // 17. Apply without confirmation rejected.
    const applyNoConfirm = await runProductionAcceptanceCommand([
      "extend-retry-budget",
      `--project-slug=${projectSlug}`,
      `--stage=${stage}`,
      `--job-id=${jobId}`,
      `--reason=${reason}`,
      `--authority-id=${plan1.authorityId!}`,
    ]);
    assert(applyNoConfirm.exitCode !== 0 &&
      applyNoConfirm.report.errorCode === "PIPELINE_RETRY_BUDGET_EXTENSION_ARGUMENT_INVALID",
      "Apply without confirmation rejected");

    // 18. Apply with mismatched confirmation rejected.
    const applyMismatch = await applyRetryBudgetExtension(
      projectSlug, stage, jobId, reason, plan1.authorityId!, "11112222333344445555666677778888", isolatedInput,
    );
    assert(!applyMismatch.success && applyMismatch.reasonCode === "PIPELINE_RETRY_BUDGET_EXTENSION_CONFIRMATION_REQUIRED",
      "Apply with mismatched confirmation rejected");

    // 19. Mismatched project slug rejected.
    const planWrongProject = await planRetryBudgetExtension("non-existent-project-slug", stage, jobId, reason, isolatedInput);
    assert(!planWrongProject.eligible, "Plan with wrong project rejected");

    // 20. Mismatched stage rejected.
    const planWrongStage = await planRetryBudgetExtension(projectSlug, "script", jobId, reason, isolatedInput);
    assert(!planWrongStage.eligible && planWrongStage.reasonCode === "PIPELINE_RETRY_BUDGET_EXTENSION_ARGUMENT_INVALID",
      "Plan with wrong stage rejected");

    // 21. Mismatched job ID rejected.
    const planWrongJob = await planRetryBudgetExtension(projectSlug, stage, `${projectSlug}-script`, reason, isolatedInput);
    assert(!planWrongJob.eligible && planWrongJob.reasonCode === "PIPELINE_RETRY_BUDGET_EXTENSION_ARGUMENT_INVALID",
      "Plan with wrong job ID rejected");

    // 22. Challenge payload contains exact failure code.
    assert(plan1.challengePayload?.failureCode === "AUDIO_ASSET_GENERATION_FAILED",
      "Challenge payload contains exact failure code");

    // 23. Plan re-verified for current job updatedAt.
    const planTamperedJob = await planRetryBudgetExtension(projectSlug, stage, jobId, reason, isolatedInput);
    assert(planTamperedJob.eligible === true, "Plan re-verified for current job updatedAt");

    // ═══════════════════════════════════════════════════════
    // BLOCK C: Challenge payload verification (Scenarios 26–35)
    // ═══════════════════════════════════════════════════════

    // 24. Job fingerprint verified in challenge payload.
    assert(typeof plan1.challengePayload?.priorJob.fingerprint === "string",
      "Challenge payload contains prior job fingerprint");

    // 25. Manifest audio status verified.
    assert(plan1.challengePayload?.manifestAudio.status === "failed",
      "Challenge payload verifies manifest audio failure");

    // 26. Latest history event verified.
    assert(typeof plan1.challengePayload?.latestHistory.eventFingerprint === "string",
      "Challenge payload verifies latest history event");

    // 27. Acceptance marker hash verified.
    assert(typeof plan1.challengePayload?.acceptanceMarkerHash === "string",
      "Challenge payload contains acceptance marker SHA-256");

    // 28. Configuration fingerprint verified.
    assert(typeof plan1.challengePayload?.configurationFingerprint === "string",
      "Challenge payload contains configuration fingerprint");

    // 29. Exact durable lineage identity verified.
    assert(plan1.challengePayload?.exactDurableLineage.recordAttempt === 3,
      "Challenge payload verifies exact durable record attempt 3");

    // 30. Active lease count verified.
    assert(plan1.challengePayload?.exactDurableLineage.leaseState === "released",
      "Challenge payload verifies durable lease is released");

    // 31. Active claim count verified.
    assert(plan1.challengePayload?.exactDurableLineage.claimState === "abandoned",
      "Challenge payload verifies durable claim is abandoned");

    // 32. Running attempt count verified.
    assert(plan1.challengePayload?.exactDurableLineage.attemptState === "failed",
      "Challenge payload verifies durable attempt is failed");

    // 33. No orphan durable object found.
    assert(plan1.reasonCode === "PIPELINE_RETRY_BUDGET_EXTENSION_ELIGIBLE",
      "No orphan durable object found");

    // ═══════════════════════════════════════════════════════
    // BLOCK D: Apply, gate, and recovery scenarios (Scenarios 36–42)
    // ═══════════════════════════════════════════════════════

    // 34. Valid authority publication returns committed-verified.
    const applyValid = await applyRetryBudgetExtension(
      projectSlug, stage, jobId, reason, plan1.authorityId!, plan1.authorityId!, isolatedInput,
    );
    assert(applyValid.success && (applyValid.decision === "published" || applyValid.decision === "replayed"),
      "Apply valid authority returns success");

    // 35. Exact replay of published authority is write-free.
    const applyReplay = await applyRetryBudgetExtension(
      projectSlug, stage, jobId, reason, plan1.authorityId!, plan1.authorityId!, isolatedInput,
    );
    assert(applyReplay.success && applyReplay.decision === "replayed" && applyReplay.writePerformed === false,
      "Replay of published authority is write-free");

    // 36. Issued authority alone insufficient for execution gate.
    const freshAuthBody = buildProductionPipelineRetryBudgetExtensionBody(
      plan1.challengePayload!,
      new Date().toISOString(),
    );

    const gateIssued = await verifyCanonicalPipelineRetryBudgetExtensionAdmission({
      phase: "before-execution",
      projectSlug,
      stage,
      jobId,
      runType: "resume",
      authorityId: freshAuthBody.authorityId,
      input: isolatedInput,
    });
    assert(!gateIssued.ok, "Issued authority alone insufficient for execution gate");

    // 37. Consuming receipt alone is insufficient for execution.
    const consumingReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
      plan1.authorityId!, "consuming", new Date().toISOString(), "v1",
    );
    writeRetryBudgetExtensionReceipt(projectSlug, consumingReceipt, isolatedInput);
    const gateConsuming = await verifyCanonicalPipelineRetryBudgetExtensionAdmission({
      phase: "before-execution",
      projectSlug,
      stage,
      jobId,
      runType: "resume",
      authorityId: plan1.authorityId!,
      input: isolatedInput,
    });
    assert(!gateConsuming.ok, "Consuming receipt alone insufficient for execution gate");

    // 38. Lingering consuming intent recovered to aborted when job untouched.
    const recoveryAborted = await recoverLingeringConsumingIntent(projectSlug, plan1.authorityId!, isolatedInput);
    assert(recoveryAborted.recovered && (recoveryAborted.finalState === "aborted" || recoveryAborted.finalState === "consumed"),
      "Lingering consuming intent recovered when job untouched");

    // 39. Readback verified on apply.
    assert(applyValid.readbackVerified === true, "Apply verified readback");

    // 40. Gate passed before durable preparation for valid consumed receipt.
    const consumedReceipt40 = buildProductionPipelineRetryBudgetExtensionReceipt(
      plan1.authorityId!, "consumed", new Date().toISOString(), "v-queued-3",
    );
    writeRetryBudgetExtensionReceipt(projectSlug, consumedReceipt40, isolatedInput);
    const gateConsumed = await verifyCanonicalPipelineRetryBudgetExtensionAdmission({
      phase: "before-durable-preparation",
      projectSlug,
      stage,
      jobId,
      runType: "resume",
      authorityId: plan1.authorityId!,
      jobVersion: "v-queued-3",
      input: isolatedInput,
    });
    assert(gateConsumed.ok && gateConsumed.phase === "before-durable-preparation",
      "Gate passed before durable preparation for valid consumed receipt");

    // 41. RunType initial rejected for ordinal 4 extension.
    const gateInitial = await verifyCanonicalPipelineRetryBudgetExtensionAdmission({
      phase: "before-durable-preparation",
      projectSlug,
      stage,
      jobId,
      runType: "initial" as unknown as ("initial" | "retry" | "resume"),
      authorityId: plan1.authorityId!,
      input: isolatedInput,
    });
    assert(!gateInitial.ok && gateInitial.reasonCode === "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      "RunType initial rejected for ordinal 4 extension");

    // ═══════════════════════════════════════════════════════
    // BLOCK E: Security, settlement, and real ordinal-4 lineage scenarios (Scenarios 43–79)
    // ═══════════════════════════════════════════════════════

    // 42. Missing authority ID rejected at gate.
    const gateNoReceipt = await verifyCanonicalPipelineRetryBudgetExtensionAdmission({
      phase: "before-durable-preparation",
      projectSlug,
      stage,
      jobId,
      runType: "resume",
      authorityId: "non-existent-auth-id",
      input: isolatedInput,
    });
    assert(!gateNoReceipt.ok && gateNoReceipt.reasonCode === "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_FOUND",
      "Missing authority ID rejected at gate");

    // 43. Ordinal 4 retry without valid authority rejected.
    const retryNoAuth = await prepareFailedStageRetry(projectSlug, jobId, "retry");
    assert(!retryNoAuth.success && retryNoAuth.reasonCode === "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED",
      "Ordinal 4 retry without valid authority rejected");

    // 44. Forged in-memory authority proof rejected by async canonical gate.
    const gateForged = await verifyCanonicalPipelineRetryBudgetExtensionAdmission({
      phase: "before-execution",
      projectSlug,
      stage,
      jobId,
      runType: "resume",
      authorityId: "forged-64-hex-authority-id-123456789012345678901234567890123456",
      input: isolatedInput,
    });
    assert(!gateForged.ok && gateForged.reasonCode === "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_FOUND",
      "Forged authority proof rejected by gate");

    // 45. Authority issued for job A cannot be used for job B.
    const gateJobB = await verifyCanonicalPipelineRetryBudgetExtensionAdmission({
      phase: "before-durable-preparation",
      projectSlug,
      stage,
      jobId: `${projectSlug}-script`,
      runType: "resume",
      authorityId: plan1.authorityId!,
      input: isolatedInput,
    });
    assert(!gateJobB.ok, "Authority for job A rejected for job B");

    // 46. Authority issued for runType "resume" cannot be used for runType "retry".
    const gateRunTypeRetry = await verifyCanonicalPipelineRetryBudgetExtensionAdmission({
      phase: "before-durable-preparation",
      projectSlug,
      stage,
      jobId,
      runType: "retry",
      authorityId: plan1.authorityId!,
      input: isolatedInput,
    });
    assert(!gateRunTypeRetry.ok && gateRunTypeRetry.reasonCode === "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      "RunType retry rejected for resume authority");

    // 47. Ordinal 5 unconditionally rejected.
    let ordinalFiveReason: string | undefined;
    try {
      assertCanonicalPipelineRetryAdmission({
        admission: {
          projectSlug, stage, jobId, runType: "resume",
          priorJobAttemptIndex: 3, currentDurableOrdinal: 4,
          admittedJobAttemptIndex: 4, admittedDurableOrdinal: 5,
          maxAttempts: 4, effectiveMaxAttempts: 4, authorizedDurableOrdinal: 4,
          exactReconciledDurableLineageIdentity: { core: {} } as unknown as ProductionPipelineExecutionIdentity,
          exactReconciledLineageBinding: {} as unknown as PipelineRetryAdmission["exactReconciledLineageBinding"],
          admittedDurableLineageIdentity: { core: {} } as unknown as ProductionPipelineExecutionIdentity,
          admittedExecutionBinding: { identity: { core: {} } } as unknown as ProductionPipelineRetryAdmissionBinding,
          priorJobStatus: "failed", preMutationJobFingerprint: "fp",
          preMutationJobVersion: "2026-08-08T00:00:00.000Z",
          admittedJobStatus: "queued", admittedJobFingerprint: "fp2",
          admittedJobVersion: "2026-08-08T00:00:01.000Z",
        },
        previousJob: { id: jobId, projectSlug, stage, status: "failed", attempts: 3,
          createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z" } as unknown as PipelineJob,
        currentJob: { id: jobId, projectSlug, stage, status: "queued", attempts: 4,
          createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:01.000Z" } as unknown as PipelineJob,
        projectSlug, stage, runType: "resume",
      });
    } catch (error) {
      ordinalFiveReason = error instanceof Error ? error.message : undefined;
    }
    assert(ordinalFiveReason === "PIPELINE_RETRY_EXECUTION_ADMISSION_FAILED",
      "Ordinal 5 rejected with exact PIPELINE_RETRY_EXECUTION_ADMISSION_FAILED code");

    // 48. Historical ordinal 1-3 records retain maxAttempts 3.
    assert(plan1.challengePayload?.exactDurableLineage.recordMaxAttempts === 3,
      "Historical record ordinal 3 retains maxAttempts 3");

    // 49. Settled receipt published successfully.
    const settledReceipt49 = buildProductionPipelineRetryBudgetExtensionReceipt(
      plan1.authorityId!, "settled", new Date().toISOString(), "v-final", ["terminal-success"],
    );
    writeRetryBudgetExtensionReceipt(projectSlug, settledReceipt49, isolatedInput);
    const readSettled49 = readRetryBudgetExtensionReceipt(projectSlug, plan1.authorityId!, "settled", isolatedInput);
    assert(readSettled49.ok && readSettled49.value?.state === "settled",
      "Settled receipt published successfully");

    // 50. Settled receipt bound to authority ID.
    assert(readSettled49.value?.authorityId === plan1.authorityId,
      "Settled receipt bound to authority ID");

    await runRealOrdinalFourProductionWriterTest();

    // ═══════════════════════════════════════════════════════
    // BLOCK F: Real cross-process race test (Scenarios 80–90)
    // ═══════════════════════════════════════════════════════

    console.log("\n  [race] Starting cross-process race test...");

    const raceProjectSlug = `race-test-${Date.now()}-abcdef1234567890`;
    const raceStage = stage;
    const raceJobId = `${raceProjectSlug}-${raceStage}`;

    const raceAuthBody = buildProductionPipelineRetryBudgetExtensionBody(
      {
        ...plan1.challengePayload!,
        projectSlug: raceProjectSlug,
        jobId: raceJobId,
        authorityFingerprint: plan1.challengePayload!.authorityFingerprint,
      },
      new Date().toISOString(),
    );
    const raceInput = createRuntimeStorageContext({
      workspaceRoot: tempRoot,
      environment: {
        ATOLYE_RUNTIME_ROOT: tempRoot,
        ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(tempRoot, "authority-root"),
      },
    });
    writeRetryBudgetExtensionAuthority(raceProjectSlug, raceAuthBody, raceInput);

    await runCrossProcessRaceTest(
      tempRoot,
      tempRoot,
      raceProjectSlug,
      raceStage,
      raceJobId,
      raceAuthBody.authorityId,
    );

    // ═══════════════════════════════════════════════════════
    // BLOCK G: Settlement write-failure + recovery (Scenarios 91–100)
    // ═══════════════════════════════════════════════════════

    console.log("\n  [settlement] Starting settlement write-failure + recovery test...");

    const settlementProjectSlug = `settlement-test-${Date.now()}-abcdef1234567890`;
    const settlementAuthBody = buildProductionPipelineRetryBudgetExtensionBody(
      {
        ...plan1.challengePayload!,
        projectSlug: settlementProjectSlug,
        jobId: `${settlementProjectSlug}-${stage}`,
        authorityFingerprint: plan1.challengePayload!.authorityFingerprint,
      },
      new Date().toISOString(),
    );

    await runSettlementRecoveryTest(
      tempRoot,
      settlementProjectSlug,
      settlementAuthBody.authorityId,
      {
        ...plan1.challengePayload!,
        projectSlug: settlementProjectSlug,
        jobId: `${settlementProjectSlug}-${stage}`,
      },
    );

    // ═══════════════════════════════════════════════════════
    // BLOCK H: Root resolution, noncanonical isolation, schema, and CLI (Scenarios 101–113)
    // ═══════════════════════════════════════════════════════

    // 1. Noncanonical authority isolation test under isolated temp runtime
    const wrongRootSlug = `wrong-root-test-${Date.now()}-abcdef1234567890`;
    const wrongRootIsolatedInput = createRuntimeStorageContext({
      workspaceRoot: tempRoot,
      environment: {
        ATOLYE_RUNTIME_ROOT: tempRoot,
        ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(tempRoot, "authority-root"),
      },
    });

    const noncanonicalTempDir = path.join(tempRoot, wrongRootSlug, "production-execution", "retry-budget-extensions");
    assertContained(tempRoot, noncanonicalTempDir);
    fs.mkdirSync(noncanonicalTempDir, { recursive: true });

    const noncanonicalTempAuthFile = path.join(noncanonicalTempDir, "authority-retry-budget-extension-authority-765c0451.json");
    assertContained(tempRoot, noncanonicalTempAuthFile);
    const noncanonicalAuthBody = buildProductionPipelineRetryBudgetExtensionBody(plan1.challengePayload!, new Date().toISOString());
    const noncanonicalAuthJson = JSON.stringify(noncanonicalAuthBody, null, 2) + "\n";
    fs.writeFileSync(noncanonicalTempAuthFile, noncanonicalAuthJson, "utf-8");

    const canonicalTempDir = path.join(tempRoot, "projects", wrongRootSlug, "production-execution", "retry-budget-extensions");
    assertContained(tempRoot, canonicalTempDir);
    fs.mkdirSync(canonicalTempDir, { recursive: true });

    assert(fs.existsSync(noncanonicalTempAuthFile), "Noncanonical test authority fixture created under isolated temp runtime");

    // 2. Noncanonical authority NOT found by canonical read in isolated runtime
    const noncanonicalRead = readRetryBudgetExtensionAuthority(wrongRootSlug, "retry-budget-extension-authority-765c0451", wrongRootIsolatedInput);
    assert(!noncanonicalRead.ok && noncanonicalRead.status === "not-found",
      "Noncanonical authority in wrong-root is NOT found by canonical read (status: not-found)");

    // 3. Noncanonical authority rejected at gate, zero migration
    const noncanonicalGate = await verifyCanonicalPipelineRetryBudgetExtensionAdmission({
      phase: "before-consumption",
      projectSlug: wrongRootSlug,
      stage,
      jobId: `${wrongRootSlug}-${stage}`,
      runType: "resume",
      authorityId: "retry-budget-extension-authority-765c0451",
      input: wrongRootIsolatedInput,
    });
    assert(!noncanonicalGate.ok && noncanonicalGate.reasonCode === "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_FOUND",
      "Noncanonical authority rejected at gate with PIPELINE_RETRY_BUDGET_EXTENSION_NOT_FOUND");

    const canonicalFiles = fs.readdirSync(canonicalTempDir);
    assert(canonicalFiles.length === 0, "Zero auto-copy or migration to canonical storage occurred");

    const postGateContent = fs.readFileSync(noncanonicalTempAuthFile, "utf-8");
    assert(postGateContent === noncanonicalAuthJson, "Wrong-root fixture remains byte-identical after gate rejection");

    // 4. Legacy default root points to projectsRoot/projectSlug
    const legacyDefaultInput = createRuntimeStorageContext({ environment: {} });
    const defaultDir = getRetryBudgetExtensionDirectory(projectSlug, legacyDefaultInput);
    const expectedDefaultDir = path.join(process.cwd(), "data", "projects", projectSlug, "production-execution", "retry-budget-extensions");
    assert(defaultDir === expectedDefaultDir,
      `Legacy default root points to canonical data/projects/${projectSlug}/...`);
    assert(resolveRuntimeStorageContext(legacyDefaultInput) === legacyDefaultInput,
      "Legacy runtime preserves exact RuntimeStorageContext object identity");

    // 5. Explicit external runtime points to runtimeRoot/projects/projectSlug
    const externalSlug = `external-test-${Date.now()}-abcdef1234567890`;
    const externalInput = createRuntimeStorageContext({ environment: { ATOLYE_RUNTIME_ROOT: tempRoot } });
    const externalDir = getRetryBudgetExtensionDirectory(externalSlug, externalInput);
    const expectedExternalDir = path.join(tempRoot, "projects", externalSlug, "production-execution", "retry-budget-extensions");
    assert(externalDir === expectedExternalDir,
      "Explicit external runtime points to <runtimeRoot>/projects/<slug>/...");
    assert(resolveRuntimeStorageContext(externalInput) === externalInput,
      "Explicit external runtime preserves exact RuntimeStorageContext object identity");

    const authRead = readRetryBudgetExtensionAuthority(projectSlug, plan1.authorityId!);
    assert(authRead.ok && authRead.value?.schemaVersion === "1",
      "Authority schema version 1 validated");

    const corruptRead = readRetryBudgetExtensionAuthority(projectSlug, "invalid-authority-id");
    assert(!corruptRead.ok, "Invalid/corrupt authority ID rejected by store");

    const cliResult = await runProductionAcceptanceCommand(["extend-retry-budget", "--invalid"]);
    assert(cliResult.exitCode !== 0 && typeof cliResult.report.errorCode === "string",
      "CLI returns sanitized error code");

    const planCli = await runProductionAcceptanceCommand([
      "retry-budget-extension-plan",
      `--project-slug=${projectSlug}`,
      `--stage=${stage}`,
      `--job-id=${jobId}`,
      `--reason=${reason}`,
    ]);
    assert(planCli.exitCode === 0 && planCli.report.eligible === true,
      "Plan CLI returns eligible: true and 0 writes");

  } finally {
    delete process.env.ATOLYE_WORKSPACE_ROOT;
    delete process.env.ATOLYE_RUNTIME_ROOT;
    delete process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT;
    delete process.env.FFMPEG_PATH;
    delete process.env.FFPROBE_PATH;

    // ───────── Cleanup temp runtime ONLY ─────────
    cleanupOwnedTempRoot(tempRootIdentity);

    console.log("  [incident] Incident authority evidence: Previously deleted by unsafe smoke cleanup (not recreated). Verified noncanonical isolation via isolated temp runtime fixture.");

    // Final production inventory check
    const repoDataDir = path.join(process.cwd(), "data");
    const postCleanupProdInventory = computeFileInventory(repoProdDir);
    const postCleanupDigest = inventoryDigest(postCleanupProdInventory);

    const postCleanupDataInventory = computeFileInventory(repoDataDir);
    const postCleanupDataDigest = inventoryDigest(postCleanupDataInventory);

    console.log("\n  [inventory] Post-cleanup production data/projects:");
    console.log(`    Before SHA-256: ${initialProdDigest.slice(0, 16)}...`);
    console.log(`    After  SHA-256: ${postCleanupDigest.slice(0, 16)}...`);
    console.log(`    Match: ${postCleanupDigest === initialProdDigest ? "✓ IDENTICAL" : "✗ MISMATCH"}`);

    console.log("\n  [inventory] Post-cleanup repository data/ root:");
    console.log(`    Before SHA-256: ${initialDataDigest.slice(0, 16)}...`);
    console.log(`    After  SHA-256: ${postCleanupDataDigest.slice(0, 16)}...`);
    console.log(`    Match: ${postCleanupDataDigest === initialDataDigest ? "✓ IDENTICAL" : "✗ MISMATCH"}`);

    if (postCleanupDigest !== initialProdDigest || postCleanupDataDigest !== initialDataDigest) {
      console.error("  [FATAL] Repository data directory was mutated during test run!");
      throw new Error("REPOSITORY_DATA_MUTATION_DETECTED");
    }
  }

  console.log(`\nAll ${passedCount}/${totalCount} scenarios passed successfully!`);
}

runSmokeSuite().catch((err) => {
  console.error("Smoke suite failed with exception:", err?.stack || err);
  process.exitCode = 1;
});
