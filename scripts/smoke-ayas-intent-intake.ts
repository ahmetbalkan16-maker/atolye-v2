/**
 * AYAS queued-intent authorization pipeline (Master Sprint §21–23).
 *
 * Deterministic / no browser / $0 / no network. Proves the reconnect chain
 * USER → AUTH → AUTHORIZATION → ACTION POLICY → EXECUTION GATE:
 *
 *   - a mobile *execution* intent + Execution Gate CLOSED → DENIED, never runs
 *     (the §23 acceptance criterion);
 *   - *reasoning* intents pass to the Brain only;
 *   - dedup by clientIntentId, order by clientSeq, idempotent batch replay;
 *   - the durable ledger stores digests, not raw utterances, and is loud on
 *     corruption;
 *   - the intake layer imports no execution primitive.
 *
 * Run: npx tsx scripts/smoke-ayas-intent-intake.ts
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  admitAyasIntents,
  ayasExecutionGate,
  classifyAyasIntent,
  evaluateAyasIntent,
  type AyasQueuedIntent,
} from "../src/lib/ayas/intake/AyasIntentPipeline";
import {
  AyasIntentLedgerError,
  createAyasIntentLedger,
} from "../src/lib/ayas/intake/AyasIntentLedger";

const REPO_ROOT = path.resolve(__dirname, "..");
const NOW = "2026-07-21T09:00:00.000Z";
const digest = (text: string) =>
  `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

let count = 0;
async function scenario(name: string, run: () => unknown | Promise<unknown>) {
  await run();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function intent(over: Partial<AyasQueuedIntent> = {}): AyasQueuedIntent {
  return {
    clientIntentId: "intent-00000001",
    clientSeq: 1,
    kind: "ask",
    text: "Bugün ne yapmalıyım?",
    submittedAt: NOW,
    ...over,
  };
}

const authed = { authenticated: true, executionGate: ayasExecutionGate, nowIso: NOW };

async function main() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-ayas-intake-"));

  try {
    await scenario("reasoning intent, authenticated → accepted, every stage passes", () => {
      const evaluation = evaluateAyasIntent(intent({ kind: "brainstorm" }), authed);
      assert.equal(evaluation.decision, "accepted-reasoning");
      assert.equal(evaluation.classification, "reasoning");
      assert.deepEqual(
        evaluation.steps.map((s) => `${s.stage}:${s.outcome}`),
        [
          "authentication:pass",
          "authorization:pass",
          "action-policy:pass",
          "execution-gate:pass",
        ],
      );
    });

    await scenario("EXECUTION intent + gate CLOSED → DENIED at the gate, never runs (§23)", () => {
      const evaluation = evaluateAyasIntent(
        intent({ kind: "run-pipeline", clientIntentId: "intent-exec-0001" }),
        authed,
      );
      assert.equal(evaluation.decision, "denied-execution-gate-closed");
      assert.equal(evaluation.classification, "execution");
      const gateStep = evaluation.steps.find((s) => s.stage === "execution-gate");
      assert.equal(gateStep?.outcome, "deny");
      assert.match(gateStep?.detail ?? "", /CLOSED/);
      // action policy still ran and passed — the DENY is the gate, not the policy.
      assert.equal(
        evaluation.steps.find((s) => s.stage === "action-policy")?.outcome,
        "pass",
      );
    });

    await scenario("forbidden intent → denied at the gate, classification forbidden", () => {
      const evaluation = evaluateAyasIntent(
        intent({ kind: "pull-model", clientIntentId: "intent-forbid-01" }),
        authed,
      );
      assert.equal(evaluation.decision, "denied-execution-gate-closed");
      assert.equal(evaluation.classification, "forbidden");
    });

    await scenario("unauthenticated → denied at AUTH, no further stage runs", () => {
      const evaluation = evaluateAyasIntent(intent(), {
        authenticated: false,
        executionGate: ayasExecutionGate,
        nowIso: NOW,
      });
      assert.equal(evaluation.decision, "denied-unauthenticated");
      assert.deepEqual(evaluation.steps.map((s) => s.stage), ["authentication"]);
    });

    await scenario("malformed shape → rejected at AUTHORIZATION", () => {
      for (const bad of [
        intent({ text: "   " }),
        intent({ clientSeq: -1 }),
        intent({ clientIntentId: "x" }),
        intent({ submittedAt: "not-a-date" }),
        intent({ text: "a".repeat(5000) }),
      ]) {
        const evaluation = evaluateAyasIntent(bad, authed);
        assert.equal(evaluation.decision, "rejected");
        assert.equal(
          evaluation.steps.find((s) => s.stage === "authorization")?.outcome,
          "deny",
        );
      }
    });

    await scenario("unknown intent kind → rejected at ACTION POLICY", () => {
      assert.equal(classifyAyasIntent("teleport"), "unknown");
      const evaluation = evaluateAyasIntent(
        intent({ kind: "teleport", clientIntentId: "intent-unknown-1" }),
        authed,
      );
      assert.equal(evaluation.decision, "rejected");
      assert.equal(
        evaluation.steps.find((s) => s.stage === "action-policy")?.outcome,
        "deny",
      );
    });

    await scenario("admitAyasIntents: dedup by clientIntentId, order by clientSeq", () => {
      const batch: AyasQueuedIntent[] = [
        intent({ clientIntentId: "intent-c-03", clientSeq: 3, kind: "ask" }),
        intent({ clientIntentId: "intent-a-01", clientSeq: 1, kind: "run-pipeline" }),
        intent({ clientIntentId: "intent-b-02", clientSeq: 2, kind: "note" }),
        intent({ clientIntentId: "intent-a-01", clientSeq: 1, kind: "run-pipeline" }), // dup in-batch
      ];
      const result = admitAyasIntents(batch, [], { ...authed, textDigest: digest });
      assert.deepEqual(
        result.entries.map((e) => e.clientIntentId),
        ["intent-a-01", "intent-b-02", "intent-c-03"],
      );
      assert.equal(result.highWaterSeq, 3);
      assert.equal(result.outcomes[3].duplicate, true);
      assert.equal(
        result.entries.find((e) => e.clientIntentId === "intent-a-01")?.decision,
        "denied-execution-gate-closed",
      );
    });

    await scenario("admitAyasIntents: idempotent — replay leaves the ledger unchanged", () => {
      const batch = [intent({ clientIntentId: "intent-x-05", clientSeq: 5 })];
      const first = admitAyasIntents(batch, [], { ...authed, textDigest: digest });
      const second = admitAyasIntents(batch, first.entries, { ...authed, textDigest: digest });
      assert.equal(second.ledgerChanged, false);
      assert.deepEqual(second.entries, first.entries);
      assert.equal(second.outcomes[0].decision, "duplicate");
    });

    await scenario("ledger stores a digest, never the raw utterance", () => {
      const secretish = "my api key is sk-verySecretValue1234567890";
      const result = admitAyasIntents(
        [intent({ clientIntentId: "i-secret-01", text: secretish })],
        [],
        { ...authed, textDigest: digest },
      );
      const entry = result.entries[0];
      assert.equal(entry.textDigest, digest(secretish));
      assert.ok(!JSON.stringify(entry).includes("verySecretValue"));
    });

    await scenario("durable ledger round-trips through a temp dir + is idempotent", () => {
      const ledger = createAyasIntentLedger({
        rootDir: tempRoot,
        now: () => new Date(NOW),
      });
      const batch: AyasQueuedIntent[] = [
        intent({ clientIntentId: "durable-01", clientSeq: 1, kind: "ask" }),
        intent({ clientIntentId: "durable-02", clientSeq: 2, kind: "run-pipeline" }),
      ];
      const first = ledger.admit(batch, { authenticated: true });
      assert.equal(first.ledgerChanged, true);
      assert.equal(first.outcomes[1].decision, "denied-execution-gate-closed");

      const reopened = createAyasIntentLedger({ rootDir: tempRoot });
      const state = reopened.read();
      assert.deepEqual(
        state.entries.map((e) => e.clientIntentId),
        ["durable-01", "durable-02"],
      );
      assert.equal(state.highWaterSeq, 2);

      const replay = reopened.admit(batch, { authenticated: true });
      assert.equal(replay.ledgerChanged, false);
    });

    await scenario("corrupt ledger file is loud, never treated as empty", () => {
      const corruptRoot = path.join(tempRoot, "corrupt");
      fs.mkdirSync(path.join(corruptRoot, "ayas-intents"), { recursive: true });
      fs.writeFileSync(
        path.join(corruptRoot, "ayas-intents", "ledger.json"),
        "{ not json",
      );
      const ledger = createAyasIntentLedger({ rootDir: corruptRoot });
      assert.throws(
        () => ledger.read(),
        (error: unknown) =>
          error instanceof AyasIntentLedgerError &&
          error.code === "AYAS_INTENT_LEDGER_CORRUPT",
      );
    });

    await scenario("batch over the cap is rejected", () => {
      const ledger = createAyasIntentLedger({ rootDir: path.join(tempRoot, "big") });
      const huge = Array.from({ length: 101 }, (_unused, i) =>
        intent({ clientIntentId: `big-${String(i).padStart(4, "0")}`, clientSeq: i }));
      assert.throws(
        () => ledger.admit(huge, { authenticated: true }),
        (error: unknown) =>
          error instanceof AyasIntentLedgerError &&
          error.code === "AYAS_INTENT_LEDGER_BATCH_TOO_LARGE",
      );
    });

    await scenario("static: the intake layer imports no execution primitive", () => {
      const files = [
        "src/lib/ayas/intake/AyasIntentPipeline.ts",
        "src/lib/ayas/intake/AyasIntentLedger.ts",
        "app/api/ayas/intake/route.ts",
      ];
      const forbidden =
        /PipelineRunner|PipelineQueueScheduler|BrainWorkerCycle|ProductionExecution|child_process|execa|nvidia-smi|ffmpeg|executionGate\s*=\s*["']OPEN|spawnSync|\.spawn\(/;
      for (const file of files) {
        const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
        assert.ok(
          !forbidden.test(source),
          `${file} must not reference an execution primitive`,
        );
      }
    });

    console.log(`AYAS intent intake: PASS (${count} scenarios)`);
    console.log(
      JSON.stringify({ status: "PASS", suite: "ayas-intent-intake", scenarios: count }),
    );
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error("AYAS intent intake FAILED:", error);
    process.exitCode = 1;
  }
})();
