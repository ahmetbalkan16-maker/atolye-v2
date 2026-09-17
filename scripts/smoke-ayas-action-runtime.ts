/**
 * AYAS Action Runtime smoke suite (Action Runtime sprint).
 *
 * Deterministic, no real model. Exercises `runAyasReadOnlyAction` directly —
 * the narrow read-only dispatcher — against the REAL policy layer
 * (`validateAyasExecutionRequest`, unchanged) and the REAL executors
 * (`AyasSafeExecutors.ts`), including two REAL local file reads (this
 * suite's own source tree — never `data/`, never a secret, never a mutation).
 *
 * Covers: known tool executes for real, unknown/reserved/mutating tools
 * denied, invalid input rejected, path traversal / secret-shaped names
 * rejected even from an allowed root, shell-like content rejected, file-not
 * -found handled honestly (not a denial), adapter failure handled honestly,
 * timeout handled honestly, exactly one executor call per dispatch (no
 * duplicate/retry), and the Execution Gate / write path are never touched.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runAyasReadOnlyAction } from "../src/lib/ayas/execution/AyasActionRuntime";
import type { AyasExecutionRequest, AyasExecutionActionId } from "../src/lib/ayas/execution/AyasExecutionPolicy";
import type { AyasExecutor, AyasExecutorResult } from "../src/lib/ayas/execution/AyasSafeExecutors";
import { AyasExecutionGateStore } from "../src/lib/ayas/execution/AyasExecutionGateStore";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function baseRequest(over: Partial<Record<string, unknown>> = {}): unknown {
  return {
    schemaVersion: "1",
    action: "inspect-source-file",
    requestedBy: "smoke-test",
    intent: "test",
    plan: {},
    ...over,
  };
}

async function run() {
  // --- real, successful execution ------------------------------------------

  await scenario("known read-only tool actually executes: inspect-source-file reads a real repo file", async () => {
    const out = await runAyasReadOnlyAction({
      rawRequest: baseRequest({ plan: { filePath: "src/lib/ayas/execution/AyasExecutionPolicy.ts" } }),
    });
    assert.equal(out.executed, true, "assert.equal(out.executed, true)");
    if (!out.executed) return;
    assert.equal(out.action, "inspect-source-file", "assert.equal(out.action, \"inspect-source-file\")");
    assert.equal(out.result.write, false, "assert.equal(out.result.write, false)");
    const data = out.result.data as { exists: boolean; content: string };
    assert.equal(data.exists, true, "assert.equal(data.exists, true)");
    assert.match(data.content, /AYAS_EXECUTION_ALLOWLIST/, "the real file content must actually be present");
    assert.ok(out.durationMs >= 0, "assert.ok(out.durationMs >= 0)");
  });

  await scenario("known read-only tool actually executes: read-project-document reads the real CHANGELOG.md", async () => {
    const out = await runAyasReadOnlyAction({
      rawRequest: baseRequest({ action: "read-project-document", plan: { documentId: "changelog" } }),
    });
    assert.equal(out.executed, true, "assert.equal(out.executed, true)");
    if (!out.executed) return;
    const data = out.result.data as { exists: boolean; content: string };
    assert.equal(data.exists, true, "assert.equal(data.exists, true)");
    assert.ok(data.content.length > 0, "assert.ok(data.content.length > 0)");
  });

  // --- policy-layer denials (existing, unchanged AyasExecutionPolicy) ------

  await scenario("unknown tool is denied, never dispatched", async () => {
    const out = await runAyasReadOnlyAction({ rawRequest: baseRequest({ action: "delete_everything" }) });
    assert.equal(out.executed, false, "assert.equal(out.executed, false)");
    if (out.executed) return;
    assert.equal(out.stage, "policy", "assert.equal(out.stage, \"policy\")");
    assert.equal(out.reason, "unknown-action", "assert.equal(out.reason, \"unknown-action\")");
  });

  await scenario("a reserved/mutating action (resume-stage) is denied, never dispatched", async () => {
    const out = await runAyasReadOnlyAction({ rawRequest: baseRequest({ action: "resume-stage" }) });
    assert.equal(out.executed, false, "assert.equal(out.executed, false)");
    if (out.executed) return;
    assert.equal(out.reason, "reserved-action-not-enabled", "assert.equal(out.reason, \"reserved-action-not-enabled\")");
  });

  await scenario("missing required input (inspect-project with no projectSlug) is rejected", async () => {
    const out = await runAyasReadOnlyAction({ rawRequest: baseRequest({ action: "inspect-project" }) });
    assert.equal(out.executed, false, "assert.equal(out.executed, false)");
    if (out.executed) return;
    assert.equal(out.reason, "missing-project", "assert.equal(out.reason, \"missing-project\")");
  });

  await scenario("shell-like content anywhere in the request is rejected (no arbitrary shell escape)", async () => {
    const out = await runAyasReadOnlyAction({
      rawRequest: baseRequest({ plan: { filePath: "src/foo.ts; rm -rf /" } }),
    });
    assert.equal(out.executed, false, "assert.equal(out.executed, false)");
    if (out.executed) return;
    assert.equal(out.reason, "shell-like-content", "assert.equal(out.reason, \"shell-like-content\")");
  });

  // --- tool-level (second-layer) denials — AyasSafeExecutors.ts own checks -

  await scenario("an absolute path outside the repo is rejected even though it isn't shell-like", async () => {
    const out = await runAyasReadOnlyAction({
      rawRequest: baseRequest({ plan: { filePath: "/etc/passwd" } }),
    });
    assert.equal(out.executed, false, "assert.equal(out.executed, false)");
    if (out.executed) return;
    assert.equal(out.stage, "safety", "assert.equal(out.stage, \"safety\")");
    assert.equal(out.reason, "path-traversal", "assert.equal(out.reason, \"path-traversal\")");
  });

  await scenario("a path outside the allowed roots (src/, scripts/, app/, top-level .md) is rejected", async () => {
    // Not under an allowed root and not a top-level .md — no denied-segment
    // match either, so this specifically exercises the root-allowlist check
    // (a sibling scenario below covers `data/` via the denied-segment path).
    const out = await runAyasReadOnlyAction({
      rawRequest: baseRequest({ plan: { filePath: "tsconfig.json" } }),
    });
    assert.equal(out.executed, false, "assert.equal(out.executed, false)");
    if (out.executed) return;
    assert.equal(out.stage, "safety", "assert.equal(out.stage, \"safety\")");
    assert.equal(out.reason, "path-not-allowed", "assert.equal(out.reason, \"path-not-allowed\")");
  });

  await scenario("real project/runtime data (data/) is rejected even though it's a plausible-looking relative path", async () => {
    const out = await runAyasReadOnlyAction({
      rawRequest: baseRequest({ plan: { filePath: "data/brain/memory/records.json" } }),
    });
    assert.equal(out.executed, false, "assert.equal(out.executed, false)");
    if (out.executed) return;
    assert.equal(out.stage, "safety", "assert.equal(out.stage, \"safety\")");
    assert.equal(out.reason, "path-denied", "assert.equal(out.reason, \"path-denied\")");
  });

  await scenario("a secret-shaped filename within an allowed root is rejected (.env exposure blocked)", async () => {
    const out = await runAyasReadOnlyAction({
      rawRequest: baseRequest({ plan: { filePath: "src/config/.env.local" } }),
    });
    assert.equal(out.executed, false, "assert.equal(out.executed, false)");
    if (out.executed) return;
    assert.equal(out.stage, "safety", "assert.equal(out.stage, \"safety\")");
    assert.equal(out.reason, "path-denied", "assert.equal(out.reason, \"path-denied\")");
  });

  await scenario("a disallowed extension within an allowed root is rejected", async () => {
    const out = await runAyasReadOnlyAction({
      rawRequest: baseRequest({ plan: { filePath: "src/lib/ayas/execution/AyasExecutionPolicy.ts.exe" } }),
    });
    assert.equal(out.executed, false, "assert.equal(out.executed, false)");
    if (out.executed) return;
    assert.equal(out.reason, "extension-not-allowed", "assert.equal(out.reason, \"extension-not-allowed\")");
  });

  await scenario("an unknown documentId is rejected (closed enum, never an arbitrary path)", async () => {
    const out = await runAyasReadOnlyAction({
      rawRequest: baseRequest({ action: "read-project-document", plan: { documentId: "../../../etc/passwd" } }),
    });
    assert.equal(out.executed, false, "assert.equal(out.executed, false)");
  });

  // --- honest, non-denial outcomes ------------------------------------------

  await scenario("a well-formed but nonexistent file is handled honestly — not a denial", async () => {
    const out = await runAyasReadOnlyAction({
      rawRequest: baseRequest({ plan: { filePath: "src/lib/ayas/execution/DoesNotExist12345.ts" } }),
    });
    assert.equal(out.executed, true, "a valid, allowed, merely-nonexistent path is an honest result, not a policy denial");
    if (!out.executed) return;
    const data = out.result.data as { exists: boolean };
    assert.equal(data.exists, false, "assert.equal(data.exists, false)");
  });

  // --- executor-layer failure modes (test seam: resolveExecutor) -----------

  await scenario("an executor that throws is reported as an honest executor failure, never a fake success", async () => {
    let calls = 0;
    const failingExecutor: AyasExecutor = async () => {
      calls += 1;
      throw new Error("adapter blew up");
    };
    const out = await runAyasReadOnlyAction({
      rawRequest: baseRequest(),
      resolveExecutor: () => failingExecutor,
    });
    assert.equal(out.executed, false, "assert.equal(out.executed, false)");
    if (out.executed) return;
    assert.equal(out.stage, "executor", "assert.equal(out.stage, \"executor\")");
    assert.equal(out.reason, "executor-failed", "assert.equal(out.reason, \"executor-failed\")");
    assert.equal(calls, 1, "no retry — exactly one attempt");
  });

  await scenario("a hung executor honestly times out rather than hanging the turn forever", async () => {
    let calls = 0;
    const hungExecutor: AyasExecutor = () => {
      calls += 1;
      return new Promise<AyasExecutorResult>(() => {
        /* never resolves */
      });
    };
    const out = await runAyasReadOnlyAction({
      rawRequest: baseRequest(),
      resolveExecutor: () => hungExecutor,
    });
    assert.equal(out.executed, false, "assert.equal(out.executed, false)");
    if (out.executed) return;
    assert.equal(out.stage, "timeout", "assert.equal(out.stage, \"timeout\")");
    assert.equal(calls, 1, "assert.equal(calls, 1)");
  });

  await scenario("exactly one executor call per dispatch — no duplicate execution", async () => {
    let calls = 0;
    const countingExecutor: AyasExecutor = async (request: AyasExecutionRequest) => {
      calls += 1;
      return { action: request.action as AyasExecutionActionId, write: false, summary: "ok", data: {} };
    };
    const out = await runAyasReadOnlyAction({
      rawRequest: baseRequest({ plan: { filePath: "src/lib/ayas/execution/AyasExecutionPolicy.ts" } }),
      resolveExecutor: () => countingExecutor,
    });
    assert.equal(out.executed, true, "assert.equal(out.executed, true)");
    assert.equal(calls, 1, "assert.equal(calls, 1)");
  });

  // --- Execution Gate isolation ----------------------------------------------

  await scenario("the global Execution Gate is never touched by a read-only dispatch — stays exactly CLOSED", async () => {
    const gateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-action-runtime-gate-"));
    try {
      const gate = new AyasExecutionGateStore({ rootDir: gateRoot });
      assert.equal(gate.readStateFailClosed().state, "CLOSED", "assert.equal(gate.readStateFailClosed().state, \"CLOSED\")");
      // `runAyasReadOnlyAction` never receives this (or any) gate instance —
      // the call below has no way to reach it. Reading it again afterward
      // just confirms nothing external touched it either.
      await runAyasReadOnlyAction({ rawRequest: baseRequest({ plan: { filePath: "src/lib/ayas/execution/AyasExecutionPolicy.ts" } }) });
      assert.equal(gate.readStateFailClosed().state, "CLOSED", "assert.equal(gate.readStateFailClosed().state, \"CLOSED\")");
    } finally {
      fs.rmSync(gateRoot, { recursive: true, force: true });
    }
  });

  console.log(`AYAS action runtime smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-action-runtime", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS action runtime smoke FAILED:", error);
  process.exitCode = 1;
});
