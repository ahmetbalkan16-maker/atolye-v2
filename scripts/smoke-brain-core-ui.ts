/**
 * Atölye Brain Core — UI smoke suite (Sprint 184).
 *
 * Deterministic / GPU-free / $0 / no network. Renders the pure Brain Core
 * components with `renderToStaticMarkup` (same approach as
 * `smoke-production-health-ui.ts`) and exercises the read-only snapshot loader
 * against a temp workspace.
 */

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createBrainTaskStore,
  runBrainWorkerCycle,
  DEFAULT_BRAIN_WORKER_CONFIG,
} from "../src/lib/brain";
import type { BrainTaskInput } from "../src/lib/brain";
import {
  loadBrainConsoleSnapshot,
  type BrainConsoleSnapshot,
} from "../src/lib/brain/ui/BrainConsoleSnapshot";
import {
  BRAIN_CORE_STATES,
  BRAIN_PANELS,
  deriveBrainCoreState,
  mapTaskStatusToDisplay,
  brainDeterministicReply,
  brainWelcomeMessage,
  type BrainChatMessage,
  type BrainCoreState,
} from "../src/components/brain/brainCore";
import { BrainCoreOrb } from "../src/components/brain/BrainCoreOrb";
import { BrainConsoleView } from "../src/components/brain/BrainConsoleView";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
const NOW = "2026-09-08T03:00:00.000Z";
const START = "2026-09-08T02:00:00.000Z";
const END = "2026-09-08T02:04:00.000Z";

function ws(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "brain-ui-"));
}
async function withWs(body: (root: string) => Promise<void>): Promise<void> {
  const root = ws();
  try {
    await body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const task = (over: Partial<BrainTaskInput> = {}): BrainTaskInput => ({
  kind: "analyze-codebase",
  title: "map brain",
  rationale: "boundaries",
  priority: "normal",
  dependsOn: [],
  payload: {},
  createdAt: START,
  ...over,
});

function baseSnapshot(over: Partial<BrainConsoleSnapshot> = {}): BrainConsoleSnapshot {
  return {
    generatedAt: NOW,
    executionGate: "CLOSED",
    connected: { tasks: false, cycles: false, experience: false },
    errors: [],
    tasks: {
      total: 0,
      byStatus: {
        queued: 0, running: 0, "blocked-on-dependency": 0, "blocked-on-approval": 0,
        succeeded: 0, failed: 0, cancelled: 0, "skipped-unsafe": 0,
      },
      pendingApproval: 0,
      skippedUnsafe: 0,
      items: [],
    },
    cyclesRecorded: 0,
    experience: { total: 0 },
    safety: {
      decision: "proceed-with-constraints",
      snapshotSource: "unavailable",
      reasons: ["resource snapshot unavailable — assuming a shared, thermally-constrained GPU (conservative bundle)"],
      hardwareProfileId: "gtx-1650-4gb",
    },
    ...over,
  };
}

function renderView(props: Partial<Parameters<typeof BrainConsoleView>[0]> & { snapshot: BrainConsoleSnapshot }) {
  const messages: readonly BrainChatMessage[] = props.messages ?? [brainWelcomeMessage(props.snapshot)];
  return renderToStaticMarkup(
    createElement(BrainConsoleView, {
      ...props,
      snapshot: props.snapshot,
      coreState: props.coreState ?? deriveBrainCoreState(props.snapshot),
      activePanel: props.activePanel ?? "chat",
      messages,
    }),
  );
}

async function run() {
  /* --------------------------- A. core state ------------------------- */

  await scenario("1. all 7 core states are described with a hue + intensity", () => {
    const states: BrainCoreState[] = ["idle", "active", "thinking", "learning", "working", "warning", "error"];
    for (const s of states) {
      const info = BRAIN_CORE_STATES[s];
      assert.equal(info.state, s);
      assert.ok(info.intensity > 0 && info.intensity <= 1);
      assert.ok(["cyan", "violet", "amber", "emerald", "rose"].includes(info.hue));
    }
  });

  await scenario("2. deriveBrainCoreState — errors → error, pending approval → warning, else idle", () => {
    assert.equal(deriveBrainCoreState(baseSnapshot({ errors: ["task queue: BRAIN_TASK_STORE_CORRUPT — bad"] })), "error");
    assert.equal(
      deriveBrainCoreState(baseSnapshot({ tasks: { ...baseSnapshot().tasks, pendingApproval: 1 } })),
      "warning",
    );
    assert.equal(deriveBrainCoreState(baseSnapshot({ safety: { ...baseSnapshot().safety, decision: "hold" } })), "warning");
    assert.equal(deriveBrainCoreState(baseSnapshot()), "idle");
    assert.equal(
      deriveBrainCoreState(baseSnapshot({ experience: { total: 3 } })),
      "learning",
    );
  });

  await scenario("3. mapTaskStatusToDisplay covers every BrainTaskStatus with a tone", () => {
    for (const status of [
      "queued", "running", "blocked-on-dependency", "blocked-on-approval",
      "succeeded", "failed", "cancelled", "skipped-unsafe",
    ] as const) {
      const d = mapTaskStatusToDisplay(status);
      assert.ok(d.label.length > 0);
      assert.ok(["neutral", "info", "good", "bad", "warn", "muted"].includes(d.tone));
    }
    assert.equal(mapTaskStatusToDisplay("skipped-unsafe").tone, "bad");
    assert.equal(mapTaskStatusToDisplay("blocked-on-approval").tone, "warn");
  });

  /* --------------------------- B. orb render ------------------------- */

  await scenario("4. orb renders per state with data-state, data-hue, aria-label", () => {
    for (const state of ["idle", "thinking", "working", "warning", "error"] as const) {
      const html = renderToStaticMarkup(createElement(BrainCoreOrb, { state }));
      assert.ok(html.includes(`data-state="${state}"`), `orb missing data-state ${state}`);
      assert.ok(html.includes(`data-hue="${BRAIN_CORE_STATES[state].hue}"`));
      assert.ok(html.includes('role="img"'));
      assert.ok(/aria-label="Brain Core/.test(html));
      assert.ok(html.includes("bc-orb__core") && html.includes("bc-orb__particles"));
    }
  });

  await scenario("5. orb honours showLabel + custom size", () => {
    const withLabel = renderToStaticMarkup(createElement(BrainCoreOrb, { state: "idle", size: 140 }));
    assert.ok(withLabel.includes("bc-pip"));
    assert.ok(withLabel.includes("140px"));
    const noLabel = renderToStaticMarkup(createElement(BrainCoreOrb, { state: "idle", showLabel: false }));
    assert.ok(!noLabel.includes("bc-pip__dot"));
  });

  /* ------------------------- C. console view ------------------------- */

  await scenario("6. console renders the CLOSED execution-gate badge + all panel tabs", () => {
    const html = renderView({ snapshot: baseSnapshot() });
    assert.ok(html.includes("Yürütme kapısı: CLOSED"));
    for (const panel of BRAIN_PANELS) {
      assert.ok(html.includes(`data-testid="bc-tab-${panel.id}"`), `missing tab ${panel.id}`);
    }
    assert.ok(html.includes('data-testid="bc-refresh"'));
  });

  await scenario("7. research + production panels render an honest 'Not connected' state", () => {
    for (const panel of ["research", "production"] as const) {
      const html = renderView({ snapshot: baseSnapshot(), activePanel: panel });
      assert.ok(html.includes('data-testid="bc-not-connected"'));
      assert.ok(html.includes("Not connected"));
    }
  });

  await scenario("8. tasks panel — empty state vs real rows with status badges", () => {
    const empty = renderView({ snapshot: baseSnapshot(), activePanel: "tasks" });
    assert.ok(empty.includes('data-testid="bc-tasks-empty"'));

    const connected = baseSnapshot({
      connected: { tasks: true, cycles: false, experience: false },
      tasks: {
        total: 2,
        byStatus: { ...baseSnapshot().tasks.byStatus, queued: 1, "blocked-on-approval": 1 },
        pendingApproval: 1,
        skippedUnsafe: 0,
        items: [
          { taskId: "brain-task-1", kind: "analyze-codebase", title: "map graph", priority: "normal", status: "queued", autonomy: "auto-safe", requiresApproval: false, blocked: false, createdAt: START },
          { taskId: "brain-task-2", kind: "apply-improvement", title: "apply 12", priority: "high", status: "blocked-on-approval", autonomy: "requires-user-approval", requiresApproval: true, blocked: true, createdAt: START },
        ],
      },
    });
    const html = renderView({ snapshot: connected, activePanel: "tasks" });
    assert.ok(html.includes('data-testid="bc-tasks"'));
    assert.ok(html.includes("map graph") && html.includes("apply 12"));
    assert.ok(html.includes("Queued") && html.includes("Awaiting approval"));
    assert.ok(html.includes("1 onay bekliyor"));
  });

  await scenario("9. safety panel lists the conservative reasons + gate", () => {
    const html = renderView({ snapshot: baseSnapshot(), activePanel: "safety" });
    assert.ok(html.includes('data-testid="bc-safety"'));
    assert.ok(html.includes("proceed-with-constraints"));
    assert.ok(html.includes("probe yok"));
    assert.ok(html.includes("conservative bundle"));
  });

  await scenario("10. learning panel — empty until a cycle exists, then shows the report", () => {
    const empty = renderView({ snapshot: baseSnapshot(), activePanel: "learning" });
    assert.ok(empty.includes('data-testid="bc-learning-empty"'));
    const withCycle = renderView({
      snapshot: baseSnapshot({
        lastCycle: {
          cycleId: "brain-worker-cycle-abc", startedAt: START, finishedAt: END,
          tasksConsidered: 3, tasksRun: 2, problemsFound: 0, awaitingApproval: 1,
          nextSingleStep: "review parked tasks",
        },
      }),
      activePanel: "learning",
    });
    assert.ok(withCycle.includes('data-testid="bc-learning"'));
    assert.ok(withCycle.includes("brain-worker-cycle-abc"));
    assert.ok(withCycle.includes("review parked tasks"));
  });

  await scenario("11. core state drives the orb hue inside the console (state transition)", () => {
    const idle = renderView({ snapshot: baseSnapshot(), coreState: "idle" });
    assert.ok(idle.includes('data-hue="cyan"') && idle.includes('data-state="idle"'));
    const warn = renderView({ snapshot: baseSnapshot(), coreState: "warning" });
    assert.ok(warn.includes('data-hue="amber"') && warn.includes('data-state="warning"'));
    const err = renderView({ snapshot: baseSnapshot({ errors: ["x"] }), coreState: "error" });
    assert.ok(err.includes('data-hue="rose"'));
    assert.ok(err.includes('role="alert"'));
  });

  await scenario("11b. the state readout under the orb shows label · tr + a character line", () => {
    const html = renderView({ snapshot: baseSnapshot(), coreState: "thinking" });
    assert.ok(html.includes("bc-stateline__label"));
    assert.ok(html.includes(BRAIN_CORE_STATES.thinking.label));
    assert.ok(html.includes(BRAIN_CORE_STATES.thinking.tr));
    assert.ok(html.includes(BRAIN_CORE_STATES.thinking.characterTr));
    // every state carries a non-empty premium one-liner
    for (const s of Object.values(BRAIN_CORE_STATES)) {
      assert.ok(s.characterTr.trim().length > 8, `characterTr for ${s.state}`);
    }
  });

  await scenario("11c. status cards are drawn only from the real snapshot; research/production are 'off'", () => {
    const empty = renderView({ snapshot: baseSnapshot() });
    assert.ok(empty.includes('data-testid="bc-cards"'));
    for (const k of ["Tasks", "Memory", "Learning", "Safety", "Research", "Production"]) {
      assert.ok(empty.includes(k), `missing status card ${k}`);
    }
    assert.ok(empty.includes("bc-statcard--off"), "research/production render as an 'off' card");

    const withData = renderView({
      snapshot: baseSnapshot({
        connected: { tasks: true, cycles: true, experience: true },
        tasks: { ...baseSnapshot().tasks, total: 7, pendingApproval: 2 },
        cyclesRecorded: 3,
        experience: { total: 4, lastTopic: "İstanbul 1453" },
      }),
    });
    assert.ok(withData.includes(">7<"), "tasks total card shows the real number");
    assert.ok(withData.includes("2 onay bekliyor"));
    assert.ok(withData.includes("bc-statcard--warn"), "pending approval marks the tasks card as a warning");
    assert.ok(withData.includes("İstanbul 1453"));
  });

  await scenario("12. chat reply is deterministic, never fakes an LLM, reflects real numbers", () => {
    const snap = baseSnapshot({ cyclesRecorded: 2, tasks: { ...baseSnapshot().tasks, total: 4, pendingApproval: 1 } });
    const a = brainDeterministicReply("merhaba", snap, 1);
    const b = brainDeterministicReply("merhaba", snap, 1);
    assert.deepEqual(a, b);
    assert.equal(a.role, "brain");
    assert.match(a.text, /konuşma katmanı .* henüz bağlı değil/i);
    assert.match(a.text, /KAPALI/);
    assert.match(a.text, /kuyrukta 4 görev/);
    assert.match(a.text, /1 onay bekliyor/);
  });

  /* --------------------- D. responsive / perf (static) --------------- */

  await scenario("13. CSS is responsive + reduced-motion aware + overflow-safe + no WebGL/canvas", () => {
    const rawCss = fs.readFileSync(path.join(REPO_ROOT, "src/components/brain/BrainCore.css"), "utf8");
    const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, ""); // drop comments — check rules, not prose
    assert.ok(css.includes("@media (min-width: 960px)"), "missing desktop breakpoint");
    assert.ok(css.includes("@media (max-width: 640px)"), "missing mobile breakpoint");
    assert.ok(css.includes("prefers-reduced-motion"), "missing reduced-motion guard");
    assert.ok(css.includes("100dvh"), "expected dynamic viewport height for mobile");
    assert.ok(/\.bc-shell\s*\{[^}]*overflow-x:\s*hidden/.test(css), "shell must clip horizontal overflow");
    assert.ok(css.includes("clamp("), "expected fluid clamp() sizing");
    for (const banned of ["WebGL", "getContext", "canvas", "requestAnimationFrame"]) {
      assert.ok(!css.includes(banned), `CSS must not reference ${banned}`);
    }
  });

  await scenario("14. no Brain UI module contains a client fetch / timer / execution primitive", () => {
    const files = [
      "src/components/brain/brainCore.ts",
      "src/components/brain/BrainCoreOrb.tsx",
      "src/components/brain/BrainConsoleView.tsx",
      "src/components/brain/BrainCoreConsole.tsx",
      "src/lib/brain/ui/BrainConsoleSnapshot.ts",
    ];
    for (const file of files) {
      const raw = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      for (const banned of ["fetch(", "XMLHttpRequest", "setInterval(", "child_process", "execFile", "spawn(", "PipelineRunner", "requestAnimationFrame", "nvidia-smi", "ffprobe"]) {
        assert.ok(!code.includes(banned), `${file} must not reference "${banned}"`);
      }
    }
  });

  /* ---------------------- E. snapshot loader ------------------------- */

  await scenario("15. loader — empty workspace → all sections 'not connected', no mock data", () =>
    withWs(async (root) => {
      const snap = await loadBrainConsoleSnapshot({ rootDir: root, nowIso: NOW });
      assert.equal(snap.connected.tasks, false);
      assert.equal(snap.connected.cycles, false);
      assert.equal(snap.connected.experience, false);
      assert.equal(snap.tasks.total, 0);
      assert.equal(snap.executionGate, "CLOSED");
      assert.equal(snap.safety.snapshotSource, "unavailable");
      assert.equal(snap.errors.length, 0);
    }));

  await scenario("16. loader — reflects a real queue + a real worker cycle", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      store.enqueue(task({ title: "analyze" }));
      store.enqueue(task({ kind: "apply-improvement", title: "apply 12" }));
      runBrainWorkerCycle(store, {
        config: DEFAULT_BRAIN_WORKER_CONFIG, startedAtIso: START, finishedAtIso: END,
      });

      const snap = await loadBrainConsoleSnapshot({ rootDir: root, nowIso: NOW });
      assert.equal(snap.connected.tasks, true);
      assert.equal(snap.connected.cycles, true);
      assert.equal(snap.tasks.total, 2);
      assert.equal(snap.tasks.byStatus.succeeded, 1);
      assert.equal(snap.tasks.pendingApproval, 1);
      assert.ok(snap.lastCycle);
      assert.equal(snap.lastCycle?.tasksRun, 1);
      assert.equal(deriveBrainCoreState(snap), "warning"); // a parked approval task
    }));

  await scenario("17. loader — a corrupt task store surfaces as errors[], not a crash", () =>
    withWs(async (root) => {
      const store = createBrainTaskStore({ rootDir: root });
      fs.mkdirSync(path.dirname(store.queueFile), { recursive: true });
      fs.writeFileSync(store.queueFile, "{ not json", "utf8");
      const snap = await loadBrainConsoleSnapshot({ rootDir: root, nowIso: NOW });
      assert.ok(snap.errors.some((e) => e.includes("BRAIN_TASK_STORE_CORRUPT")));
      assert.equal(snap.connected.tasks, false);
      assert.equal(deriveBrainCoreState(snap), "error");
      // and the console renders that error visibly
      const html = renderView({ snapshot: snap });
      assert.ok(html.includes('role="alert"'));
      assert.ok(html.includes("BRAIN_TASK_STORE_CORRUPT"));
    }));

  console.log(`Atölye Brain Core UI smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-core-ui", scenarios: count }));
}

run().catch((error) => {
  console.error("Atölye Brain Core UI smoke FAILED:", error);
  process.exitCode = 1;
});
