/**
 * AYAS Durable Guided-Repair Session product-level E2E suite.
 *
 * Deterministic / $0 / no network / no model. Proves the full restart-safe
 * flow through the REAL `AyasGuidedRepairSessionRuntime` + real durable
 * stores — a "restart" is simulated by constructing a BRAND NEW runtime
 * instance (fresh in-memory session Map, fresh `AyasGuidedRepairSessionStore`
 * / `AyasDeveloperWorkflowStore` instances) pointed at the SAME on-disk
 * store directories, exactly as a fresh Node process would after a real
 * restart. Covers Scenario B (authorization-pause restart), Scenario C
 * (authorized resume after restart), and Scenario D (stale source after
 * restart) end to end through the product session boundary, not just the
 * lower-level store/recovery units already covered elsewhere.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AyasGuidedRepairSessionRuntime, type AyasGuidedRepairDurability } from "../src/lib/ayas/execution/AyasGuidedRepairSessionRuntime";
import { AyasGuidedRepairSessionStore, AyasRepairSessionStoreError, isValidAyasRepairSessionId } from "../src/lib/ayas/execution/AyasGuidedRepairSessionStore";
import { AyasDeveloperWorkflowStore } from "../src/lib/ayas/execution/AyasDeveloperWorkflowStore";
import type { AyasGuidedRepairConversationDeps, AyasGuidedDiagnosisPlan } from "../src/lib/ayas/execution/AyasGuidedRepairConversation";
import type { AyasPatch } from "../src/lib/ayas/execution/AyasGuidedRepair";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const hash = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

function makeDurability(dataRoot: string, workspaceRoot: string): AyasGuidedRepairDurability {
  return {
    sessionStore: new AyasGuidedRepairSessionStore({ rootDir: dataRoot }),
    workflowStore: new AyasDeveloperWorkflowStore({ rootDir: dataRoot }),
    workspaceRoot,
  };
}

function makeDeps(workspaceRoot: string, absolute: string, original: string, updated: string): AyasGuidedRepairConversationDeps {
  let diagnosed = false;
  return {
    workspaceRoot,
    validators: { "run-registered-smoke-test": async () => ({ ok: true }) },
    diagnoseTurn: async (): Promise<AyasGuidedDiagnosisPlan | null> => {
      if (diagnosed) return null; // one proposal per fixture — the second turn is the approval
      diagnosed = true;
      const patches: readonly AyasPatch[] = [{ filePath: "src/fixture.ts", operation: "patch-source", expectedHash: hash(original), content: updated }];
      return {
        rootCause: "durability fixture", reproduced: true,
        evidence: [{ kind: "source", ref: "src/fixture.ts", summary: "fixture", digest: hash(original) }],
        graphifyFindings: [], patches, operationClasses: ["patch-source"], validationActions: ["run-registered-smoke-test"],
        expectedResult: "answer becomes 42", risk: "single fixture file",
        bounds: { maxFiles: 1, maxNewFiles: 0, maxRepairCycles: 0, maxValidationCycles: 1, maxDurationMs: 30_000, allowFileCreation: false },
      };
    },
  };
}

async function main() {
  await scenario("SCENARIO B — authorization-pause restart: still awaiting authorization, zero mutation, fingerprint/budgets preserved", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-repair-durability-data-"));
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-repair-durability-ws-"));
    try {
      const rel = "src/fixture.ts"; const absolute = path.join(wsRoot, rel);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      const original = "export const answer = 0;\n";
      fs.writeFileSync(absolute, original);
      const deps = makeDeps(wsRoot, absolute, original, "export const answer = 42;\n");

      const runtimeBeforeRestart = new AyasGuidedRepairSessionRuntime(() => deps, 100, 30 * 60_000, () => Date.now(), makeDurability(dataRoot, wsRoot));
      const sessionId = "a".repeat(64); // sha256-hex-shaped, matching the real product session key
      const first = await runtimeBeforeRestart.handle({ sessionId, text: "hata var, fixture bozuk", turnId: "t1", workspaceId: "atolye-v2" });
      assert.equal(first.progress, "Onay bekleniyor");
      const proposalId = first.proposal!.proposalId;
      const fingerprintBefore = first.proposal!.proposalFingerprint;
      assert.equal(fs.readFileSync(absolute, "utf8"), original, "diagnosis alone performs zero mutation");

      // --- simulated restart: a BRAND NEW runtime, fresh in-memory state ---
      const runtimeAfterRestart = new AyasGuidedRepairSessionRuntime(() => deps, 100, 30 * 60_000, () => Date.now(), makeDurability(dataRoot, wsRoot));
      const recoveredPending = runtimeAfterRestart.pending(sessionId);
      assert.equal(recoveredPending, undefined, "pending() only reflects an in-memory session — recovery happens lazily on the next turn");

      // A neutral follow-up turn (not an approval phrase) triggers lazy recovery + re-diagnosis attempt; since diagnoseTurn already fired once, it returns null this turn — but recovery itself must have restored the pending proposal first.
      // We verify recovery directly via a second call that touches the session.
      const afterRecoveryPending = await (async () => {
        // Force recovery by handling a turn, then inspect what pending() reports.
        await runtimeAfterRestart.handle({ sessionId, text: "durum ne", turnId: "t-status", workspaceId: "atolye-v2" }).catch(() => undefined);
        return runtimeAfterRestart.pending(sessionId);
      })();
      assert.ok(afterRecoveryPending, "pending proposal recovered after simulated restart");
      assert.equal(afterRecoveryPending!.proposalId, proposalId, "recovered proposal id matches");
      assert.equal(afterRecoveryPending!.proposalFingerprint, fingerprintBefore, "recovered proposal fingerprint is byte-identical");
      assert.equal(fs.readFileSync(absolute, "utf8"), original, "recovery itself performs zero mutation");
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
      fs.rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  await scenario("SCENARIO C — authorized resume after restart: recovered proposal can still be approved, gated write + validation succeed", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-repair-durability-data-"));
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-repair-durability-ws-"));
    try {
      const rel = "src/fixture.ts"; const absolute = path.join(wsRoot, rel);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      const original = "export const answer = 0;\n";
      fs.writeFileSync(absolute, original);
      const deps = makeDeps(wsRoot, absolute, original, "export const answer = 42;\n");
      const sessionId = "b".repeat(64);

      const runtime1 = new AyasGuidedRepairSessionRuntime(() => deps, 100, 30 * 60_000, () => Date.now(), makeDurability(dataRoot, wsRoot));
      await runtime1.handle({ sessionId, text: "hata var, fixture bozuk", turnId: "t1", workspaceId: "atolye-v2" });

      // --- simulated restart ---
      const runtime2 = new AyasGuidedRepairSessionRuntime(() => deps, 100, 30 * 60_000, () => Date.now(), makeDurability(dataRoot, wsRoot));
      const approved = await runtime2.handle({ sessionId, text: "onaylıyorum", turnId: "t2", workspaceId: "atolye-v2" });
      assert.equal(approved.progress, "Tamamlandı", approved.text);
      assert.equal(fs.readFileSync(absolute, "utf8"), "export const answer = 42;\n", "the gated write actually applied after recovery");
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
      fs.rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  await scenario("SCENARIO D — stale source after restart: repository changed while offline → authorization attempt is refused, zero mutation", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-repair-durability-data-"));
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-repair-durability-ws-"));
    try {
      const rel = "src/fixture.ts"; const absolute = path.join(wsRoot, rel);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      const original = "export const answer = 0;\n";
      fs.writeFileSync(absolute, original);
      const deps = makeDeps(wsRoot, absolute, original, "export const answer = 42;\n");
      const sessionId = "c".repeat(64);

      const runtime1 = new AyasGuidedRepairSessionRuntime(() => deps, 100, 30 * 60_000, () => Date.now(), makeDurability(dataRoot, wsRoot));
      await runtime1.handle({ sessionId, text: "hata var, fixture bozuk", turnId: "t1", workspaceId: "atolye-v2" });

      fs.writeFileSync(absolute, "external edit while the app was offline\n"); // repository changed while "offline"

      const runtime2 = new AyasGuidedRepairSessionRuntime(() => deps, 100, 30 * 60_000, () => Date.now(), makeDurability(dataRoot, wsRoot));
      const approved = await runtime2.handle({ sessionId, text: "onaylıyorum", turnId: "t2", workspaceId: "atolye-v2" });
      assert.notEqual(approved.progress, "Tamamlandı", "a stale recovered proposal must never report completion");
      assert.equal(fs.readFileSync(absolute, "utf8"), "external edit while the app was offline\n", "stale recovery never mutates source, and never clobbers the external edit");
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
      fs.rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  await scenario("ADVERSARIAL — a completed write must not replay after a THIRD restart re-approves the same (now-cleared) session", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-repair-durability-data-"));
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-repair-durability-ws-"));
    try {
      const rel = "src/fixture.ts"; const absolute = path.join(wsRoot, rel);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      const original = "export const answer = 0;\n";
      fs.writeFileSync(absolute, original);
      const deps = makeDeps(wsRoot, absolute, original, "export const answer = 42;\n");
      const sessionId = "1".repeat(64);

      const runtime1 = new AyasGuidedRepairSessionRuntime(() => deps, 100, 30 * 60_000, () => Date.now(), makeDurability(dataRoot, wsRoot));
      await runtime1.handle({ sessionId, text: "hata var, fixture bozuk", turnId: "t1", workspaceId: "atolye-v2" });

      const runtime2 = new AyasGuidedRepairSessionRuntime(() => deps, 100, 30 * 60_000, () => Date.now(), makeDurability(dataRoot, wsRoot));
      const approved = await runtime2.handle({ sessionId, text: "onaylıyorum", turnId: "t2", workspaceId: "atolye-v2" });
      assert.equal(approved.progress, "Tamamlandı");
      assert.equal(fs.readFileSync(absolute, "utf8"), "export const answer = 42;\n");

      // A THIRD "restart" (fresh runtime, fresh store instances) tries to
      // approve the SAME session again — the pending state was cleared on
      // completion, so there is nothing left to (re-)approve.
      const runtime3 = new AyasGuidedRepairSessionRuntime(() => deps, 100, 30 * 60_000, () => Date.now(), makeDurability(dataRoot, wsRoot));
      const replay = await runtime3.handle({ sessionId, text: "onaylıyorum", turnId: "t3", workspaceId: "atolye-v2" });
      assert.notEqual(replay.progress, "Tamamlandı", "a completed session has nothing left to replay");
      assert.equal(fs.readFileSync(absolute, "utf8"), "export const answer = 42;\n", "the file is exactly the ONE successful write — never re-applied, never reverted");
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
      fs.rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  await scenario("workspace-id mismatch on recovery never restores across workspaces", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-repair-durability-data-"));
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-repair-durability-ws-"));
    try {
      const rel = "src/fixture.ts"; const absolute = path.join(wsRoot, rel);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      const original = "export const answer = 0;\n";
      fs.writeFileSync(absolute, original);
      const deps = makeDeps(wsRoot, absolute, original, "export const answer = 42;\n");
      const sessionId = "d".repeat(64);
      const runtime1 = new AyasGuidedRepairSessionRuntime(() => deps, 100, 30 * 60_000, () => Date.now(), makeDurability(dataRoot, wsRoot));
      await runtime1.handle({ sessionId, text: "hata var, fixture bozuk", turnId: "t1", workspaceId: "atolye-v2" });

      const runtime2 = new AyasGuidedRepairSessionRuntime(() => deps, 100, 30 * 60_000, () => Date.now(), makeDurability(dataRoot, wsRoot));
      await runtime2.handle({ sessionId, text: "durum ne", turnId: "t-status", workspaceId: "a-different-workspace" }).catch(() => undefined);
      assert.equal(runtime2.pending(sessionId), undefined, "a session recovered under a different workspaceId must never restore");
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
      fs.rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  await scenario("corrupt persisted session record starts the session fresh, never crashes the turn", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-repair-durability-data-"));
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-repair-durability-ws-"));
    try {
      const sessionStore = new AyasGuidedRepairSessionStore({ rootDir: dataRoot });
      fs.mkdirSync(sessionStore.directory, { recursive: true });
      const sessionId = "e".repeat(64);
      fs.writeFileSync(path.join(sessionStore.directory, `${sessionId}.json`), "{ not json");
      const deps: AyasGuidedRepairConversationDeps = { workspaceRoot: wsRoot, diagnoseTurn: async () => null };
      const runtime = new AyasGuidedRepairSessionRuntime(() => deps, 100, 30 * 60_000, () => Date.now(), makeDurability(dataRoot, wsRoot));
      const result = await runtime.handle({ sessionId, text: "merhaba", turnId: "t1", workspaceId: "atolye-v2" });
      assert.ok(result.text.length > 0, "a corrupt session record never crashes the turn");
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
      fs.rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  await scenario("clear() removes both the in-memory session and the durable record", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-repair-durability-data-"));
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-repair-durability-ws-"));
    try {
      const rel = "src/fixture.ts"; const absolute = path.join(wsRoot, rel);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, "export const answer = 0;\n");
      const deps = makeDeps(wsRoot, absolute, "export const answer = 0;\n", "export const answer = 42;\n");
      const sessionId = "f".repeat(64);
      const durability = makeDurability(dataRoot, wsRoot);
      const runtime = new AyasGuidedRepairSessionRuntime(() => deps, 100, 30 * 60_000, () => Date.now(), durability);
      await runtime.handle({ sessionId, text: "hata var, fixture bozuk", turnId: "t1", workspaceId: "atolye-v2" });
      assert.ok(durability.sessionStore.tryLoad(sessionId)?.pending, "session persisted before clear");
      runtime.clear(sessionId);
      assert.equal(runtime.pending(sessionId), undefined);
      assert.equal(durability.sessionStore.tryLoad(sessionId), undefined, "durable record removed too");
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
      fs.rmSync(wsRoot, { recursive: true, force: true });
    }
  });

  await scenario("ADVERSARIAL — session id path traversal is rejected before it ever becomes a filesystem path", () => {
    for (const bad of ["../escape", "..\\escape", "/etc/passwd", "C:\\Windows\\evil", "a/b", ""]) {
      assert.equal(isValidAyasRepairSessionId(bad), false, bad);
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-repair-session-pathsafety-"));
    try {
      const store = new AyasGuidedRepairSessionStore({ rootDir: root });
      assert.throws(() => store.tryLoad("../escape"), (error: unknown) => error instanceof AyasRepairSessionStoreError && error.code === "AYAS_REPAIR_SESSION_STORE_INVALID_ID");
      assert.throws(() => store.save("../escape", "atolye-v2", undefined), (error: unknown) => error instanceof AyasRepairSessionStoreError && error.code === "AYAS_REPAIR_SESSION_STORE_INVALID_ID");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  console.log(`AYAS guided repair durability smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-guided-repair-durability", scenarios: count }));
}

main().catch((error) => {
  console.error("AYAS guided repair durability smoke FAILED:", error);
  process.exitCode = 1;
});
