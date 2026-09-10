/**
 * Atölye Brain — Self-Healing END-TO-END synthetic-failure smoke (emir §10 / §23).
 *
 * Proves the full chain on a THROWAWAY temp git repo — the real
 * `BrainSelfHealSandbox` (git worktree) + the real `runBrainSelfHeal` loop +
 * fixture `draftPatch` / `runChecks` adapters:
 *
 *   FAULT → DETECT → INCIDENT → DIAGNOSE → ROOT CAUSE → PATCH SANDBOX → TEST →
 *   REGRESSION → VERIFY → REPORT → (operator) APPLY → LEARN
 *
 * and separately the failure path:  bad patch → checks FAIL → ROLLBACK → LEARN(failed)
 *
 * Never touches the real repo, the execution gate, or any production authority.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  classifyBrainAnomaly,
  type BrainAnomalySnapshot,
} from "../src/lib/brain/selfheal/BrainAnomalyClassifier";
import { buildBrainIncident, brainIncidentSignature } from "../src/lib/brain/selfheal/BrainIncident";
import { createBrainSelfHealStore } from "../src/lib/brain/selfheal/BrainSelfHealStore";
import { createBrainSelfHealSandbox } from "../src/lib/brain/selfheal/BrainSelfHealSandbox";
import { buildLearnedPattern } from "../src/lib/brain/selfheal/BrainLearnedPattern";
import {
  runBrainSelfHeal,
  type BrainSelfHealAdapters,
  type DraftedPatch,
} from "../src/lib/brain/selfheal/BrainSelfHealRunner";
import type { BrainTimelineEvent } from "../src/lib/brain/selfheal/BrainRootCauseEngine";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const git = (repo: string, ...argv: string[]) => execFileSync("git", ["-C", repo, ...argv], { stdio: "pipe" }).toString().trim();

/** A throwaway git repo with a known-safe bug: `add` subtracts. */
function makeBuggyRepo(): { repo: string; head: string; cleanup: () => void } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "sh-e2e-repo-"));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "selfheal-test@atolye.local");
  git(repo, "config", "user.name", "selfheal-test");
  fs.writeFileSync(path.join(repo, "lib.js"), "module.exports.add = (a, b) => a - b; // BUG: should be a + b\n");
  fs.writeFileSync(
    path.join(repo, "test.js"),
    "const { add } = require('./lib');\nif (add(2, 3) !== 5) { console.error('FAIL add(2,3)=' + add(2,3)); process.exit(1); }\nconsole.log('PASS');\n",
  );
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "seed: buggy add");
  const head = git(repo, "rev-parse", "HEAD");
  return { repo, head, cleanup: () => fs.rmSync(repo, { recursive: true, force: true }) };
}

const CORRECT_FIX = "module.exports.add = (a, b) => a + b;\n";
const STILL_BROKEN_FIX = "module.exports.add = (a, b) => a * b;\n"; // multiply — still wrong

const timeline: BrainTimelineEvent[] = [
  { at: 1000, name: "wake-hit" },
  { at: 1100, name: "capture-start" },
  { at: 2000, name: "capture-end" },
];

function adapters(over: {
  fix: string;
  parentDir: string;
  repo: string;
  now?: () => string;
  applied?: { current: string[] };
}): BrainSelfHealAdapters {
  let t = Date.parse("2026-09-11T12:00:00.000Z");
  const now = over.now ?? (() => new Date((t += 1000)).toISOString());
  return {
    now,
    nowMs: () => Date.parse(now()),
    createSandbox: (base) => createBrainSelfHealSandbox(base, { repoRoot: over.repo, parentDir: over.parentDir, commandTimeoutMs: 60_000 }),
    draftPatch: async ({ suspectFiles }): Promise<DraftedPatch | null> => ({
      files: [{ path: "lib.js", content: over.fix }],
      rationale: `the ${suspectFiles.join(", ") || "add"} function has the wrong operator`,
      rollbackPlan: "git worktree remove --force <sandbox>",
    }),
    runChecks: async ({ sandbox, checks }) => {
      const out = [];
      for (const kind of checks) {
        if (kind === "smoke" || kind === "regression") {
          const r = await sandbox.command(["node", "test.js"]);
          out.push({
            name: kind === "smoke" ? "node test.js" : "regression: node test.js",
            kind,
            status: r.code === 0 ? ("PASS" as const) : ("FAIL" as const),
            detail: (r.stdout + r.stderr).trim().slice(0, 120),
          });
        } else {
          out.push({ name: kind, kind, status: "PASS" as const, detail: "synthetic OK" });
        }
      }
      return out;
    },
    applyToWorkingTree: async ({ changedFiles }) => {
      // in the synthetic test, "apply" = copy the fix into the temp repo working tree
      for (const f of changedFiles) fs.writeFileSync(path.join(over.repo, f), over.fix);
      if (over.applied) over.applied.current = [...changedFiles];
      return { ok: true, detail: `wrote ${changedFiles.join(", ")}` };
    },
  };
}

const anomalySnap: BrainAnomalySnapshot = {
  reloadCause: "manual-reload-or-nav",
  navigationKind: "navigate",
  evictionKind: "unknown",
  unexpectedReload: false,
  browserReloadLikely: false,
  firstBoot: false,
  priorVoiceActive: false,
  priorCleanPagehide: true,
  priorDiedHidden: false,
  priorDiedAtPhase: "",
  priorHeartbeatAgeMs: 1000,
  priorLastEvent: "visibility:visible",
};

async function run() {
  await scenario("E2E — FAULT → DETECT → INCIDENT → DIAGNOSE → PATCH SANDBOX → TEST → REGRESSION → VERIFY → REPORT → APPLY → LEARN", async () => {
    const { repo, head, cleanup } = makeBuggyRepo();
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sh-e2e-store-"));
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "sh-e2e-wt-"));
    try {
      // ---- DETECT: an early-VAD-endpoint anomaly ----
      const detection = classifyBrainAnomaly({
        lifecycle: anomalySnap,
        voice: { phase: "idle", mic: "on", recoveryCount: 0, droppedFrames: 0, frameAgeMs: 200, lastError: null, lastCaptureMs: 640, lastSttMs: 1400 },
      });
      assert.equal(detection.classification, "REAL_INCIDENT");
      assert.equal(detection.openIncident, true);

      // ---- INCIDENT ----
      const store = createBrainSelfHealStore({ rootDir: storeRoot });
      const incident = buildBrainIncident({
        category: detection.category,
        severity: detection.severity,
        classification: detection.classification,
        symptom: "command capture endpoints ~1 s after the wake word; the add function subtracts",
        now: "2026-09-11T12:00:00.000Z",
        evidence: [{ at: "2026-09-11T12:00:00.000Z", source: "vad", note: detection.reason, signals: detection.signals }],
      });

      // ---- seed a learned pattern so DIAGNOSE has a high-confidence match ----
      const seed = buildLearnedPattern(incident, {
        successfulFix: "flip the operator in lib.js",
        regressionResult: "node test.js PASS",
        risk: "LOW",
        status: "APPLIED",
        now: "2026-09-10T00:00:00.000Z",
      });
      // point it at a SAFE path so the loop may auto-draft
      store.saveLearnedPattern({ ...seed, affectedFiles: ["scripts/lib.js"], signature: brainIncidentSignature(incident) });

      // ---- RUN THE LOOP (autonomous, up to AWAITING_APPROVAL) ----
      const run1 = await runBrainSelfHeal({
        incident,
        timeline,
        recentCommits: [{ hash: head, subject: "seed: buggy add", ageHours: 1, files: ["lib.js"] }],
        baseCommit: head,
        store,
        adapters: adapters({ fix: CORRECT_FIX, parentDir, repo }),
      });

      const kinds = run1.steps.map((s) => s.step.kind);
      assert.ok(kinds.includes("diagnose"), "diagnosed");
      assert.ok(kinds.includes("draft-patch"), "drafted a patch");
      assert.ok(kinds.includes("run-checks"), "ran checks");
      assert.ok(kinds.includes("verify"), `verified — steps: ${kinds.join(" → ")}`);
      assert.equal(run1.incident.status, "AWAITING_APPROVAL", "stops for the operator");
      assert.equal(run1.incident.patch?.changedFiles.includes("lib.js"), true);
      const smokeCheck = run1.incident.checks.find((c) => c.kind === "smoke");
      assert.equal(smokeCheck?.status, "PASS", "the sandbox test passed on the fix");
      assert.ok(run1.incident.checks.some((c) => c.kind === "regression" && c.status === "PASS"), "regression passed");
      assert.match(run1.report, /AWAITING OPERATOR APPROVAL/);
      assert.match(run1.report, /🧠 ATÖLYE BRAIN/);

      // the live repo is STILL buggy — the Brain never wrote the working tree
      assert.match(fs.readFileSync(path.join(repo, "lib.js"), "utf-8"), /a - b/, "working tree untouched pre-approval");

      // ---- OPERATOR APPROVES → APPLY → LEARN ----
      const applied = { current: [] as string[] };
      const run2 = await runBrainSelfHeal({
        incident: run1.incident,
        timeline,
        recentCommits: [{ hash: head, subject: "seed: buggy add", ageHours: 1, files: ["lib.js"] }],
        baseCommit: head,
        store,
        adapters: adapters({ fix: CORRECT_FIX, parentDir, repo, applied }),
        operatorApprovalId: "op-metod-2026-09-11",
      });
      assert.equal(run2.incident.status, "APPLIED");
      assert.deepEqual(applied.current, ["lib.js"]);
      assert.match(fs.readFileSync(path.join(repo, "lib.js"), "utf-8"), /a \+ b/, "fix applied to the working tree");
      assert.equal(run2.incident.learnedPatternId != null, true, "learned");
      // the loop never pushed / merged / deployed
      assert.equal(run2.steps.every((s) => s.step.kind !== "halt" || !/push|deploy|merge/.test(s.note)), true);

      // ---- LEARN reinforced the seeded pattern (not a fresh one) ----
      const learned = store.listLearnedPatterns();
      assert.equal(learned.length, 1, "reinforced, not duplicated");
      assert.equal(learned[0].timesConfirmed >= 2, true, `confirmed ${learned[0].timesConfirmed}×`);
    } finally {
      cleanup();
      fs.rmSync(storeRoot, { recursive: true, force: true });
      fs.rmSync(parentDir, { recursive: true, force: true });
    }
  });

  await scenario("E2E — a bad patch fails the sandbox check → ROLLBACK → LEARN(failed), never a false 'fixed'", async () => {
    const { repo, head, cleanup } = makeBuggyRepo();
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sh-e2e-store-"));
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "sh-e2e-wt-"));
    try {
      const store = createBrainSelfHealStore({ rootDir: storeRoot });
      const incident = buildBrainIncident({
        category: "voice",
        severity: "P1",
        classification: "REAL_INCIDENT",
        symptom: "the add function subtracts instead of adding",
        now: "2026-09-11T12:00:00.000Z",
      });
      const seed = buildLearnedPattern(incident, { successfulFix: "flip operator", regressionResult: "PASS", risk: "LOW", status: "APPLIED", now: "2026-09-10T00:00:00.000Z" });
      store.saveLearnedPattern({ ...seed, affectedFiles: ["scripts/lib.js"], signature: brainIncidentSignature(incident) });

      const result = await runBrainSelfHeal({
        incident,
        timeline,
        recentCommits: [{ hash: head, subject: "seed", ageHours: 1, files: ["lib.js"] }],
        baseCommit: head,
        store,
        adapters: adapters({ fix: STILL_BROKEN_FIX, parentDir, repo }), // multiply — test still fails
        maxIterations: 40,
      });

      const kinds = result.steps.map((s) => s.step.kind);
      assert.ok(kinds.includes("rollback"), `rolled back — steps: ${kinds.join(" → ")}`);
      assert.ok(["ROLLED_BACK", "FAILED"].includes(result.incident.status), `status ${result.incident.status}`);
      assert.notEqual(result.incident.status, "APPLIED", "a broken patch is never 'applied'");
      assert.notEqual(result.incident.status, "VERIFIED");
      // it retried up to the attempt cap then handed to a human
      assert.ok((result.incident.patch?.attempt ?? 0) <= 3, "bounded attempts");
      assert.match(fs.readFileSync(path.join(repo, "lib.js"), "utf-8"), /a - b/, "live repo untouched — no false fix");

      // the learned pattern recorded a FAILED fix, its confirmed count did NOT rise
      const learned = store.listLearnedPatterns();
      assert.equal(learned[0].timesFailed >= 1, true, "failure recorded");
      assert.equal(learned[0].timesConfirmed, 1, "a failed patch is not learned as a win");
    } finally {
      cleanup();
      fs.rmSync(storeRoot, { recursive: true, force: true });
      fs.rmSync(parentDir, { recursive: true, force: true });
    }
  });

  await scenario("E2E — sandbox worktree is always cleaned up (no leaked worktrees)", async () => {
    const { repo, head, cleanup } = makeBuggyRepo();
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sh-e2e-store-"));
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "sh-e2e-wt-"));
    try {
      const store = createBrainSelfHealStore({ rootDir: storeRoot });
      const incident = buildBrainIncident({ category: "voice", severity: "P1", classification: "REAL_INCIDENT", symptom: "add subtracts", now: "2026-09-11T12:00:00.000Z" });
      const seed = buildLearnedPattern(incident, { successfulFix: "flip", regressionResult: "PASS", risk: "LOW", status: "APPLIED", now: "2026-09-10T00:00:00.000Z" });
      store.saveLearnedPattern({ ...seed, affectedFiles: ["scripts/lib.js"], signature: brainIncidentSignature(incident) });
      await runBrainSelfHeal({ incident, timeline, recentCommits: [], baseCommit: head, store, adapters: adapters({ fix: CORRECT_FIX, parentDir, repo }) });
      const worktrees = git(repo, "worktree", "list").split("\n").filter((l) => l.includes("wt-"));
      assert.equal(worktrees.length, 0, `no leaked worktrees, got: ${worktrees.join(" | ")}`);
      const leftover = fs.readdirSync(parentDir).filter((f) => f.startsWith("wt-"));
      assert.equal(leftover.length, 0, "sandbox dirs removed");
    } finally {
      cleanup();
      fs.rmSync(storeRoot, { recursive: true, force: true });
      fs.rmSync(parentDir, { recursive: true, force: true });
    }
  });

  console.log(`Atölye Brain self-heal E2E smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-selfheal-e2e", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
