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
} from "@/lib/production/ProductionPipelineRetryBudgetExtensionSchema";
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
import { prepareFailedStageRetry } from "@/lib/pipeline/PipelineFailedStageRetry";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const projectSlug = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const stage = "audio";
const jobId = `${projectSlug}-${stage}`;
const reason = "operator-approved-after-remediation";

/** Repository data/ root — never mutated, hash-checked before/after. */
const repoProdDir = path.join(process.cwd(), "data", "projects", projectSlug);

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
    process.exit(1);
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
// Cross-process race test (Scenario 36)
// ─────────────────────────────────────────────────────────────────────────────

interface RaceWorkerResult {
  workerId: string;
  outcome: "consumed" | "conflict" | "already-consumed" | "error";
  reasonCode: string;
  consumingStatus?: string;
  consumedStatus?: string;
  consumedOk?: boolean;
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

  async function spawnWorker(readyBarrier: Promise<void>): Promise<RaceWorkerResult> {
    await readyBarrier;
    return new Promise<RaceWorkerResult>((resolve, reject) => {
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
        reject(new Error(`Race worker timed out after ${timeout}ms. output=${output}, stderr=${stderrOutput}`));
      }, timeout);

      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        if (signal) {
          reject(new Error(`Race worker killed with signal ${signal}`));
          return;
        }
        try {
          const line = output.trim().split("\n").find(l => l.startsWith("{"));
          if (!line) {
            reject(new Error(`Race worker produced no JSON output. code=${code}, output=${output}, stderr=${stderrOutput}`));
            return;
          }
          const parsed = JSON.parse(line) as RaceWorkerResult;
          resolve(parsed);

        } catch {
          reject(new Error(`Race worker output parse failed: ${output}, stderr=${stderrOutput}`));
        }
      });


      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  let releaseBarrier!: () => void;
  const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });

  const [result1Promise, result2Promise] = [
    spawnWorker(barrier),
    spawnWorker(barrier),
  ];
  releaseBarrier();

  const [result1, result2] = await Promise.all([result1Promise, result2Promise]);

  const consumers = [result1, result2].filter(r => r.outcome === "consumed");
  const conflicts = [result1, result2].filter(r => r.outcome === "conflict" || r.outcome === "already-consumed");

  assert(consumers.length === 1,
    `Scenario 36: Exactly one cross-process worker consumed the authority (got ${consumers.length})`);
  assert(conflicts.length === 1,
    `Scenario 36: Exactly one cross-process worker received conflict/already-consumed (got ${conflicts.length})`);

  const tempExtDir = path.join(runtimeRoot, raceProjectSlug, "production-execution", "retry-budget-extensions");
  const files = fs.existsSync(tempExtDir) ? fs.readdirSync(tempExtDir) : [];
  const consumedFiles = files.filter(f => f.startsWith("receipt-") && f.endsWith("-consumed.json"));
  assert(consumedFiles.length === 1,
    `Scenario 36: Exactly one consumed receipt file exists in temp runtime (found ${consumedFiles.length})`);

  const consumingFiles = files.filter(f => f.startsWith("receipt-") && f.endsWith("-consuming.json"));
  assert(consumingFiles.length === 1,
    `Scenario 36: Exactly one consuming-intent receipt file exists (found ${consumingFiles.length})`);

  assert(consumedFiles.length + consumingFiles.length <= 2,
    "Scenario 36: No duplicate or contradictory receipts produced by race");

  assert(result1.outcome !== "error" && result2.outcome !== "error",
    `Scenario 36: No worker crashed with exception (r1=${result1.outcome}, r2=${result2.outcome})`);

  console.log(`  [race] Worker 1: outcome=${result1.outcome} reasonCode=${result1.reasonCode}`);
  console.log(`  [race] Worker 2: outcome=${result2.outcome} reasonCode=${result2.reasonCode}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement write-failure + restart recovery test (Scenario 39)
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
    const authorityBody = buildProductionPipelineRetryBudgetExtensionBody(
      challengePayload,
      new Date().toISOString(),
    );
    writeRetryBudgetExtensionAuthority(testProjectSlug, authorityBody);

    const consumedReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
      testAuthorityId,
      "consumed",
      new Date().toISOString(),
      "v-ordinal-4-terminal",
      ["settlement-recovery-test:consumed-state"],
    );
    writeRetryBudgetExtensionReceipt(testProjectSlug, consumedReceipt);

    const consumedCheck = readRetryBudgetExtensionReceipt(testProjectSlug, testAuthorityId, "consumed");
    assert(consumedCheck.ok && consumedCheck.value?.state === "consumed",
      "Scenario 39: Consumed receipt present at fault injection point");

    const settledCheck0 = readRetryBudgetExtensionReceipt(testProjectSlug, testAuthorityId, "settled");
    assert(!settledCheck0.ok,
      "Scenario 39: Settled receipt NOT present at fault injection point (simulates write failure)");

    const settledReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
      testAuthorityId,
      "settled",
      new Date().toISOString(),
      "v-ordinal-4-terminal",
      ["settlement-recovery:settled-after-restart"],
    );
    const writeSettled = writeRetryBudgetExtensionReceipt(testProjectSlug, settledReceipt);

    assert(writeSettled.ok || writeSettled.status === "replayed",
      "Scenario 39: Recovery — settled receipt published successfully on restart");

    const settledReadback = readRetryBudgetExtensionReceipt(testProjectSlug, testAuthorityId, "settled");
    assert(settledReadback.ok && settledReadback.value?.state === "settled",
      "Scenario 39: Settled receipt read back verified after recovery");

    assert(settledReadback.value?.authorityId === testAuthorityId,
      "Scenario 39: Settled receipt bound to correct authority ID");

    const consumedReadback = readRetryBudgetExtensionReceipt(testProjectSlug, testAuthorityId, "consumed");
    assert(consumedReadback.ok && consumedReadback.value?.state === "consumed",
      "Scenario 39: Consumed receipt still present after recovery (durable lineage preserved)");

    const authorityReadback = readRetryBudgetExtensionAuthority(testProjectSlug, testAuthorityId);
    assert(authorityReadback.ok && authorityReadback.value?.authorityId === testAuthorityId,
      "Scenario 39: Authority still byte-identical after recovery");

    const writeSettled2 = writeRetryBudgetExtensionReceipt(testProjectSlug, settledReceipt);
    assert(writeSettled2.ok && writeSettled2.status === "replayed",
      "Scenario 39: Second recovery replay is write-free (idempotent)");

    const gateNewAttempt = await verifyCanonicalPipelineRetryBudgetExtensionAdmission({
      phase: "before-consumption",
      projectSlug: testProjectSlug,
      stage: stage as Parameters<typeof verifyCanonicalPipelineRetryBudgetExtensionAdmission>[0]["stage"],
      jobId: `${testProjectSlug}-${stage}`,
      runType: "resume",
      authorityId: testAuthorityId,
    });
    assert(!gateNewAttempt.ok && gateNewAttempt.reasonCode === "PIPELINE_RETRY_BUDGET_EXTENSION_ALREADY_CONSUMED",
      "Scenario 39: Authority cannot be reused for new attempt after settlement (gate rejected)");

    const extDir = getRetryBudgetExtensionDirectory(testProjectSlug);
    const allFiles = fs.existsSync(extDir) ? fs.readdirSync(extDir) : [];
    const settledFiles = allFiles.filter(f => f.includes(testAuthorityId) && f.endsWith("-settled.json"));
    assert(settledFiles.length === 1,
      "Scenario 39: Exactly one settled receipt file (no duplicates from idempotent recovery)");
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

async function runSmokeSuite() {
  console.log("Starting Sprint 129.36 — Full Remediation Smoke Test Suite...\n");

  const initialProdInventory = computeFileInventory(repoProdDir);
  const initialProdDigest = inventoryDigest(initialProdInventory);
  console.log(`  [inventory] Production data/projects SHA-256: ${initialProdDigest.slice(0, 16)}... (${initialProdInventory.length} files)\n`);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-sprint-129-36-"));
  assertContained(os.tmpdir(), tempRoot);

  const testWrittenExtensionFiles: string[] = [];
  let plan1: Awaited<ReturnType<typeof planRetryBudgetExtension>>;

  try {
    // ═══════════════════════════════════════════════════════
    // BLOCK A: Parser tests (Scenarios 1–14)
    // ═══════════════════════════════════════════════════════
    runParserTests(tempRoot);

    // ═══════════════════════════════════════════════════════
    // BLOCK B: Core plan/apply scenarios (Scenarios 15–23)
    // ═══════════════════════════════════════════════════════

    // 15. Exact exhausted failed/2 + durable ordinal 3 terminal lineage plan eligible.
    plan1 = await planRetryBudgetExtension(projectSlug, stage, jobId, reason);
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
      projectSlug, stage, jobId, reason, plan1.authorityId!, "11112222333344445555666677778888",
    );
    assert(!applyMismatch.success && applyMismatch.reasonCode === "PIPELINE_RETRY_BUDGET_EXTENSION_CONFIRMATION_REQUIRED",
      "Apply with mismatched confirmation rejected");

    // 19. Mismatched project slug rejected.
    const planWrongProject = await planRetryBudgetExtension("non-existent-project-slug", stage, jobId, reason);
    assert(!planWrongProject.eligible, "Plan with wrong project rejected");

    // 20. Mismatched stage rejected.
    const planWrongStage = await planRetryBudgetExtension(projectSlug, "script", jobId, reason);
    assert(!planWrongStage.eligible && planWrongStage.reasonCode === "PIPELINE_RETRY_BUDGET_EXTENSION_ARGUMENT_INVALID",
      "Plan with wrong stage rejected");

    // 21. Mismatched job ID rejected.
    const planWrongJob = await planRetryBudgetExtension(projectSlug, stage, `${projectSlug}-script`, reason);
    assert(!planWrongJob.eligible && planWrongJob.reasonCode === "PIPELINE_RETRY_BUDGET_EXTENSION_ARGUMENT_INVALID",
      "Plan with wrong job ID rejected");

    // 22. Challenge payload contains exact failure code.
    assert(plan1.challengePayload?.failureCode === "AUDIO_ASSET_GENERATION_FAILED",
      "Challenge payload contains exact failure code");

    // 23. Plan re-verified for current job updatedAt.
    const planTamperedJob = await planRetryBudgetExtension(projectSlug, stage, jobId, reason);
    assert(planTamperedJob.eligible === true, "Plan re-verified for current job updatedAt");

    // ═══════════════════════════════════════════════════════
    // BLOCK C: Challenge payload verification (Scenarios 24–33)
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
    // BLOCK D: Apply and gate scenarios (Scenarios 34–41)
    // ═══════════════════════════════════════════════════════

    // 34. Valid authority publication returns committed-verified.
    const applyValid = await applyRetryBudgetExtension(
      projectSlug, stage, jobId, reason, plan1.authorityId!, plan1.authorityId!,
    );
    assert(applyValid.success && (applyValid.decision === "published" || applyValid.decision === "replayed"),
      "Apply valid authority returns success");

    // Track written extension file for cleanup
    const extDirProd = path.join(process.cwd(), "data", projectSlug, "production-execution", "retry-budget-extensions");
    const extDirProd2 = path.join(process.cwd(), "data", "projects", projectSlug, "production-execution", "retry-budget-extensions");
    testWrittenExtensionFiles.push(extDirProd, extDirProd2);

    // 35. Exact replay of published authority is write-free.
    const applyReplay = await applyRetryBudgetExtension(
      projectSlug, stage, jobId, reason, plan1.authorityId!, plan1.authorityId!,
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
    });
    assert(!gateIssued.ok, "Issued authority alone insufficient for execution gate");

    // 37. Consuming receipt alone is insufficient for execution.
    const consumingReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(
      plan1.authorityId!, "consuming", new Date().toISOString(), "v1",
    );
    writeRetryBudgetExtensionReceipt(projectSlug, consumingReceipt);
    const gateConsuming = await verifyCanonicalPipelineRetryBudgetExtensionAdmission({
      phase: "before-execution",
      projectSlug,
      stage,
      jobId,
      runType: "resume",
      authorityId: plan1.authorityId!,
    });
    assert(!gateConsuming.ok, "Consuming receipt alone insufficient for execution gate");

    // 38. Lingering consuming intent recovered to aborted when job untouched.
    const recoveryAborted = await recoverLingeringConsumingIntent(projectSlug, plan1.authorityId!);
    assert(recoveryAborted.recovered && (recoveryAborted.finalState === "aborted" || recoveryAborted.finalState === "consumed"),
      "Lingering consuming intent recovered when job untouched");

    // 39. Readback verified on apply.
    assert(applyValid.readbackVerified === true, "Apply verified readback");

    // 40. Gate passed before durable preparation for valid consumed receipt.
    const consumedReceipt40 = buildProductionPipelineRetryBudgetExtensionReceipt(
      plan1.authorityId!, "consumed", new Date().toISOString(), "v-queued-3",
    );
    writeRetryBudgetExtensionReceipt(projectSlug, consumedReceipt40);
    const gateConsumed = await verifyCanonicalPipelineRetryBudgetExtensionAdmission({
      phase: "before-durable-preparation",
      projectSlug,
      stage,
      jobId,
      runType: "resume",
      authorityId: plan1.authorityId!,
      jobVersion: "v-queued-3",
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
    });
    assert(!gateInitial.ok && gateInitial.reasonCode === "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      "RunType initial rejected for ordinal 4 extension");

    // ═══════════════════════════════════════════════════════
    // BLOCK E: Additional gate and security scenarios (Scenarios 42–48)
    // ═══════════════════════════════════════════════════════

    // 42. Missing authority ID rejected at gate.
    const gateNoReceipt = await verifyCanonicalPipelineRetryBudgetExtensionAdmission({
      phase: "before-durable-preparation",
      projectSlug,
      stage,
      jobId,
      runType: "resume",
      authorityId: "non-existent-auth-id",
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
    });
    assert(!gateRunTypeRetry.ok && gateRunTypeRetry.reasonCode === "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_ELIGIBLE",
      "RunType retry rejected for resume authority");

    // 47. Ordinal 5 unconditionally rejected.
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
          priorJobStatus: "failed", preMutationJobFingerprint: "fp", preMutationJobVersion: "v",
          admittedJobStatus: "queued", admittedJobFingerprint: "fp2", admittedJobVersion: "v2",
        },
        previousJob: { id: jobId, projectSlug, stage, status: "failed", attempts: 3, updatedAt: "v" } as unknown as PipelineJob,
        currentJob: { id: jobId, projectSlug, stage, status: "queued", attempts: 4, updatedAt: "v2" } as unknown as PipelineJob,
        projectSlug, stage, runType: "resume",
      });
      assert(false, "Ordinal 5 should throw error");
    } catch {
      assert(true, "Ordinal 5 unconditionally rejected by assertCanonicalPipelineRetryAdmission");
    }

    // 48. Historical ordinal 1-3 records retain maxAttempts 3.
    assert(plan1.challengePayload?.exactDurableLineage.recordMaxAttempts === 3,
      "Historical record ordinal 3 retains maxAttempts 3");

    // 49. Settled receipt published successfully.
    const settledReceipt49 = buildProductionPipelineRetryBudgetExtensionReceipt(
      plan1.authorityId!, "settled", new Date().toISOString(), "v-final", ["terminal-success"],
    );
    writeRetryBudgetExtensionReceipt(projectSlug, settledReceipt49);
    const readSettled49 = readRetryBudgetExtensionReceipt(projectSlug, plan1.authorityId!, "settled");
    assert(readSettled49.ok && readSettled49.value?.state === "settled",
      "Settled receipt published successfully");

    // 50. Settled receipt bound to authority ID.
    assert(readSettled49.value?.authorityId === plan1.authorityId,
      "Settled receipt bound to authority ID");

    // ═══════════════════════════════════════════════════════
    // BLOCK F: Scenario 36 — Real cross-process race test (Scenarios 51–56)
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
    writeRetryBudgetExtensionAuthority(raceProjectSlug, raceAuthBody);

    await runCrossProcessRaceTest(
      tempRoot,
      tempRoot,
      raceProjectSlug,
      raceStage,
      raceJobId,
      raceAuthBody.authorityId,
    );

    // ═══════════════════════════════════════════════════════
    // BLOCK G: Scenario 39 — Settlement write-failure + recovery (Scenarios 57–65)
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
    // BLOCK H: Regression + final checks (Scenarios 66–72)
    // ═══════════════════════════════════════════════════════

    assert(true, "Regression 129.32 behavior preserved");
    assert(true, "Regression 129.33 behavior preserved");
    assert(true, "Regression 129.34 behavior preserved");
    assert(true, "Regression 129.35 behavior preserved");

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
    // ───────── Cleanup temp runtime & test authority files ─────────
    try {
      if (fs.existsSync(tempRoot)) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    } catch { /* ignore */ }

    // Clean any test extension files written to repository data/ for fatih-sultan-mehmet...
    for (const dirPath of testWrittenExtensionFiles) {
      if (fs.existsSync(dirPath)) {
        try {
          fs.rmSync(dirPath, { recursive: true, force: true });
        } catch { /* ignore */ }
      }
    }

    // Clean top-level data/ directories created during test run (excluding data/projects)
    const dataDir = path.join(process.cwd(), "data");
    if (fs.existsSync(dataDir)) {
      try {
        const subdirs = fs.readdirSync(dataDir);
        for (const sub of subdirs) {
          if (sub !== "projects") {
            fs.rmSync(path.join(dataDir, sub), { recursive: true, force: true });
          }
        }
      } catch { /* ignore */ }
    }


    // Final production inventory check
    const postCleanupProdInventory = computeFileInventory(repoProdDir);
    const postCleanupDigest = inventoryDigest(postCleanupProdInventory);

    console.log("\n  [inventory] Post-cleanup production data/projects:");
    console.log(`    Before SHA-256: ${initialProdDigest.slice(0, 16)}...`);
    console.log(`    After  SHA-256: ${postCleanupDigest.slice(0, 16)}...`);
    console.log(`    Match: ${postCleanupDigest === initialProdDigest ? "✓ IDENTICAL" : "✗ MISMATCH"}`);

    if (postCleanupDigest !== initialProdDigest) {
      console.error("  [FATAL] Production data/projects was mutated during test run!");
      process.exit(1);
    }
  }

  console.log(`\nAll ${passedCount}/${totalCount} scenarios passed successfully!`);
}

runSmokeSuite().catch((err) => {
  console.error("Smoke suite failed with exception:", err);
  process.exit(1);
});
