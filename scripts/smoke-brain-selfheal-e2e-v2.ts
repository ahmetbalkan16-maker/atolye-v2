/**
 * Atölye Brain — Autonomous v2 END-TO-END proof (emir §33 / §34 / §41).
 *
 * Real `BrainSelfHealSandbox` (git worktree) + real `runBrainSelfHeal` loop with
 * v2 config (auto-apply + watchdog + observe adapter). Proves, on a THROWAWAY
 * git repo:
 *
 *   1. controlled telemetry fault → DETECT → INCIDENT → DIAGNOSE → GENERATE
 *      PATCH → SANDBOX → TEST → REGRESSION → VERIFY → AUTO-APPLY (SAFE, staged)
 *      → WATCHDOG (clean window) → HEALED → LEARN;
 *   2. AUTO-APPLY → WATCHDOG sees the incident signature recur → AUTO-ROLLBACK
 *      → the working tree is restored → the failed fix is learned (not as a win);
 *   3. learning speeds a second occurrence (learned pattern → the diagnosis
 *      already has the fix).
 *
 * Never touches the real repo, the execution gate, or any production authority.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { classifyBrainAnomaly, type BrainAnomalySnapshot } from "../src/lib/brain/selfheal/BrainAnomalyClassifier";
import { buildBrainIncident, brainIncidentSignature } from "../src/lib/brain/selfheal/BrainIncident";
import { createBrainSelfHealStore } from "../src/lib/brain/selfheal/BrainSelfHealStore";
import { createBrainSelfHealSandbox } from "../src/lib/brain/selfheal/BrainSelfHealSandbox";
import { buildLearnedPattern } from "../src/lib/brain/selfheal/BrainLearnedPattern";
import { buildRuntimeEvent } from "../src/lib/brain/selfheal/BrainRuntimeEvent";
import { runBrainSelfHeal, type BrainSelfHealAdapters } from "../src/lib/brain/selfheal/BrainSelfHealRunner";
import { diagnoseRootCause } from "../src/lib/brain/selfheal/BrainRootCauseEngine";
import { DEFAULT_AUTO_APPLY_CONFIG } from "../src/lib/brain/selfheal/BrainAutoApplyPolicy";
import { DEFAULT_HEAL_WATCHDOG_CONFIG } from "../src/lib/brain/selfheal/BrainHealWatchdog";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const git = (repo: string, ...a: string[]) => execFileSync("git", ["-C", repo, ...a], { stdio: "pipe" }).toString().trim();

/** throwaway repo with a bug in a SAFE (script) file so v2 may auto-apply. */
function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "sh-e2e2-"));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "t@a.local");
  git(repo, "config", "user.name", "t");
  fs.mkdirSync(path.join(repo, "scripts"));
  // the bug lives in a `scripts/smoke-*` file — genuinely SAFE per BrainPatchSafety,
  // so the v2 auto-apply policy may act on it.
  fs.writeFileSync(path.join(repo, "scripts", "smoke-selfheal-fixture-lib.js"), "module.exports.add = (a, b) => a - b; // BUG\n");
  fs.writeFileSync(
    path.join(repo, "scripts", "smoke-selfheal-fixture-test.js"),
    "const {add}=require('./smoke-selfheal-fixture-lib');if(add(2,3)!==5){console.error('FAIL');process.exit(1)}console.log('PASS')\n",
  );
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "seed");
  return { repo, head: git(repo, "rev-parse", "HEAD"), cleanup: () => fs.rmSync(repo, { recursive: true, force: true }) };
}

const CORRECT = "module.exports.add = (a, b) => a + b;\n";
const timeline = [
  { at: 1000, name: "voice:capture-start" },
  { at: 1100, name: "audio:frame" },
  { at: 5200, name: "recover:stall" },
];
const anomalySnap: BrainAnomalySnapshot = {
  reloadCause: "manual-reload-or-nav", navigationKind: "navigate", evictionKind: "unknown",
  unexpectedReload: false, browserReloadLikely: false, firstBoot: false,
  priorVoiceActive: false, priorCleanPagehide: true, priorDiedHidden: false,
  priorDiedAtPhase: "", priorHeartbeatAgeMs: 1000, priorLastEvent: "visibility:visible",
};

function v2Adapters(opts: {
  repo: string;
  parentDir: string;
  fix: string;
  /** number of signature recurrences the watchdog will observe post-apply. */
  recurrences: number;
  applied: { staged: string[]; rolledBack: boolean };
}): BrainSelfHealAdapters {
  let t = Date.parse("2026-09-12T12:00:00.000Z");
  const now = () => new Date((t += 1000)).toISOString();
  return {
    now,
    nowMs: () => Date.parse(now()),
    createSandbox: (base) => createBrainSelfHealSandbox(base, { repoRoot: opts.repo, parentDir: opts.parentDir, commandTimeoutMs: 60_000 }),
    draftPatch: async () => ({ files: [{ path: "scripts/smoke-selfheal-fixture-lib.js", content: opts.fix }], rationale: "flip the operator", rollbackPlan: "restore scripts/smoke-selfheal-fixture-lib.js" }),
    runChecks: async ({ sandbox, checks }) => {
      const out = [];
      for (const kind of checks) {
        if (kind === "smoke" || kind === "regression") {
          const r = await sandbox.command(["node", "scripts/smoke-selfheal-fixture-test.js"]);
          out.push({ name: `node test (${kind})`, kind, status: r.code === 0 ? ("PASS" as const) : ("FAIL" as const), detail: (r.stdout + r.stderr).trim().slice(0, 80) });
        } else {
          out.push({ name: kind, kind, status: "PASS" as const, detail: "ok" });
        }
      }
      return out;
    },
    applyToWorkingTree: async () => ({ ok: false, detail: "v2 uses autoApply" }),
    autoApplyToWorkingTree: async ({ changedFiles }) => {
      for (const f of changedFiles) fs.writeFileSync(path.join(opts.repo, f), opts.fix);
      opts.applied.staged = [...changedFiles];
      return { ok: true, detail: `staged ${changedFiles.join(", ")}` };
    },
    rollbackWorkingTree: async ({ changedFiles, baseCommit }) => {
      for (const f of changedFiles) {
        const orig = git(opts.repo, "show", `${baseCommit}:${f}`);
        fs.writeFileSync(path.join(opts.repo, f), orig + "\n");
      }
      opts.applied.rolledBack = true;
      return { ok: true, detail: "restored from base" };
    },
    observePostApply: async ({ elapsedMs }) => ({
      // once the watchdog window is complete, report the recurrences
      eventsSinceApply: opts.recurrences === 0 ? [] : [buildRuntimeEvent({ at: "2026-09-12T12:10:00.000Z", component: "voice", event: "recover:stall", severity: "error" })],
      signatureRecurrences: elapsedMs >= 0 ? opts.recurrences : 0,
      postApplyChecks: [{ name: "node test", status: "PASS" as const }],
    }),
  };
}

async function run() {
  await scenario("v2 E2E — controlled fault → … → AUTO-APPLY (SAFE) → WATCHDOG clean → HEALED → LEARN", async () => {
    const { repo, head, cleanup } = makeRepo();
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sh-e2e2-store-"));
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "sh-e2e2-wt-"));
    try {
      // ---- DETECT: a frame-stall anomaly ----
      const detection = classifyBrainAnomaly({
        lifecycle: anomalySnap,
        voice: { phase: "wake", mic: "on", recoveryCount: 0, droppedFrames: 0, frameAgeMs: 5200, lastError: null, lastCaptureMs: -1, lastSttMs: -1 },
      });
      assert.equal(detection.classification, "REAL_INCIDENT");

      const store = createBrainSelfHealStore({ rootDir: storeRoot });
      const incident = buildBrainIncident({
        category: detection.category,
        severity: detection.severity,
        classification: detection.classification,
        symptom: "the audio capture graph stopped producing frames while armed; scripts add subtracts",
        now: "2026-09-12T12:00:00.000Z",
      });
      // seed a learned pattern pointing at the SAFE file so the loop auto-drafts + is high confidence
      const seed = buildLearnedPattern(incident, { successfulFix: "flip the operator in scripts/smoke-selfheal-fixture-lib.js", regressionResult: "node test PASS", risk: "LOW", status: "APPLIED", now: "2026-09-11T00:00:00.000Z" });
      store.saveLearnedPattern({ ...seed, affectedFiles: ["scripts/smoke-selfheal-fixture-lib.js"], signature: brainIncidentSignature(incident) });

      const applied = { staged: [] as string[], rolledBack: false };
      const result = await runBrainSelfHeal({
        incident,
        timeline,
        recentCommits: [{ hash: head, subject: "seed", ageHours: 1, files: ["scripts/smoke-selfheal-fixture-lib.js"] }],
        baseCommit: head,
        store,
        adapters: v2Adapters({ repo, parentDir, fix: CORRECT, recurrences: 0, applied }),
        autoApply: { ...DEFAULT_AUTO_APPLY_CONFIG, enabled: true, confidenceThreshold: 0.7 },
        healWatchdog: { ...DEFAULT_HEAL_WATCHDOG_CONFIG, checkpointsMs: [0] }, // window "complete" immediately for the test
        maxIterations: 40,
      });

      const kinds = result.steps.map((s) => s.step.kind);
      assert.ok(kinds.includes("auto-apply-to-working-tree"), `auto-applied — steps: ${kinds.join(" → ")}`);
      assert.ok(kinds.includes("monitor"), "watchdog ran");
      assert.equal(result.incident.status, "HEALED", `status ${result.incident.status}`);
      assert.equal(result.incident.appliedBy, "autonomous-safe");
      assert.equal(result.incident.healVerdict, "HEALED");
      assert.deepEqual(applied.staged, ["scripts/smoke-selfheal-fixture-lib.js"]);
      assert.equal(applied.rolledBack, false);
      assert.match(fs.readFileSync(path.join(repo, "scripts", "smoke-selfheal-fixture-lib.js"), "utf-8"), /a \+ b/, "fix is live");
      assert.ok(result.incident.learnedPatternId, "learned");
      // never pushed / committed
      assert.equal(git(repo, "log", "--oneline").split("\n").length, 1, "no new commit");
    } finally {
      cleanup();
      fs.rmSync(storeRoot, { recursive: true, force: true });
      fs.rmSync(parentDir, { recursive: true, force: true });
    }
  });

  await scenario("v2 E2E — AUTO-APPLY → WATCHDOG sees the signature recur → AUTO-ROLLBACK → tree restored → learn-failed", async () => {
    const { repo, head, cleanup } = makeRepo();
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sh-e2e2-store-"));
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "sh-e2e2-wt-"));
    try {
      const store = createBrainSelfHealStore({ rootDir: storeRoot });
      const incident = buildBrainIncident({ category: "voice", severity: "P1", classification: "REAL_INCIDENT", symptom: "audio graph stalls; scripts add subtracts", now: "2026-09-12T12:00:00.000Z" });
      const seed = buildLearnedPattern(incident, { successfulFix: "flip operator scripts/smoke-selfheal-fixture-lib.js", regressionResult: "PASS", risk: "LOW", status: "APPLIED", now: "2026-09-11T00:00:00.000Z" });
      store.saveLearnedPattern({ ...seed, affectedFiles: ["scripts/smoke-selfheal-fixture-lib.js"], signature: brainIncidentSignature(incident) });

      const applied = { staged: [] as string[], rolledBack: false };
      const result = await runBrainSelfHeal({
        incident,
        timeline,
        recentCommits: [],
        baseCommit: head,
        store,
        // the fix passes the sandbox test, but the watchdog will "see" the signature recur post-apply
        adapters: v2Adapters({ repo, parentDir, fix: CORRECT, recurrences: 1, applied }),
        autoApply: { ...DEFAULT_AUTO_APPLY_CONFIG, enabled: true, confidenceThreshold: 0.7 },
        healWatchdog: { ...DEFAULT_HEAL_WATCHDOG_CONFIG, checkpointsMs: [0] },
        maxIterations: 40,
      });

      const kinds = result.steps.map((s) => s.step.kind);
      assert.ok(kinds.includes("auto-apply-to-working-tree"));
      assert.ok(kinds.includes("auto-rollback"), `auto-rolled-back — steps: ${kinds.join(" → ")}`);
      assert.equal(applied.rolledBack, true, "rollback adapter fired");
      assert.match(fs.readFileSync(path.join(repo, "scripts", "smoke-selfheal-fixture-lib.js"), "utf-8"), /a - b/, "working tree restored to the buggy base");
      assert.ok(["ROLLED_BACK", "FAILED"].includes(result.incident.status), `status ${result.incident.status}`);
      assert.notEqual(result.incident.status, "HEALED", "a fix the watchdog rejected is never HEALED");
      const learned = store.listLearnedPatterns();
      assert.equal(learned[0].timesFailed >= 1, true, "failure recorded");
      assert.equal(learned[0].timesConfirmed, 1, "not learned as a win");
    } finally {
      cleanup();
      fs.rmSync(storeRoot, { recursive: true, force: true });
      fs.rmSync(parentDir, { recursive: true, force: true });
    }
  });

  await scenario("v2 E2E — learning speeds the next occurrence: 2nd incident's diagnosis already carries the fix", async () => {
    const store = createBrainSelfHealStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "sh-e2e2-learn-")) });
    try {
      const inc1 = buildBrainIncident({ category: "voice", severity: "P1", classification: "REAL_INCIDENT", symptom: "wake capture stalls after four seconds while armed", now: "2026-09-12T12:00:00.000Z" });
      // first time: full diagnosis, no learned pattern
      const d1 = diagnoseRootCause({ incident: inc1, timeline, recentCommits: [], learnedPatterns: [] });
      const firstBest = d1.best?.statement ?? "";

      // record the verified fix
      store.saveLearnedPattern(buildLearnedPattern(inc1, { successfulFix: "resume the suspended AudioContext on rearm", regressionResult: "200-turn PASS", risk: "MEDIUM", status: "HEALED" as never, now: "2026-09-12T12:30:00.000Z" }));

      // second time: same signature — diagnosis consults the learned pattern first
      const inc2 = buildBrainIncident({ category: "voice", severity: "P1", classification: "REAL_INCIDENT", symptom: "wake capture stalls after four seconds while armed", now: "2026-09-13T09:00:00.000Z" });
      const d2 = diagnoseRootCause({ incident: inc2, timeline: [], recentCommits: [], learnedPatterns: store.listLearnedPatterns() });
      assert.ok(d2.best?.matchedLearnedPatternId, `2nd diagnosis matched a learned pattern — got: ${d2.best?.statement}`);
      assert.match(d2.best!.statement, /Recurrence of a known pattern/);
      assert.ok(d2.best!.confidence >= (d1.best?.confidence ?? 0), `2nd diagnosis at least as confident (${d2.best!.confidence} vs ${d1.best?.confidence})`);
      void firstBest;
    } finally {
      // temp store dir auto-cleaned by the OS; nothing persistent
    }
  });

  console.log(`Atölye Brain autonomous v2 E2E smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-selfheal-e2e-v2", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
