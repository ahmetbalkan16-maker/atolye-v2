/**
 * AYAS — continuous autonomous loop smoke suite (Sprint 186).
 *
 * Deterministic / GPU-free / $0 / no network / no model (LLM ideas injected).
 * Covers: heartbeat state change, cycle advance + gap analysis, the execution
 * gate can never be bypassed, checkpoint persistence, restart/resume, corrupt
 * checkpoint fails loud.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AYAS_LOOP_DEFAULTS,
  advanceAyasCycle,
  approveAyasImprovement,
  ayasHeartbeat,
  ayasLoopRespectsGate,
  deriveAyasGaps,
  startAyasAutonomousLoop,
  type AyasSnapshotInput,
} from "../src/lib/brain/autonomy/AyasAutonomousLoop";
import {
  createAyasAutonomousStore,
  AyasAutonomousStoreError,
} from "../src/lib/brain/autonomy/AyasAutonomousStore";
import { loadAyasAutonomousView } from "../src/lib/brain/autonomy/AyasAutonomousView";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
const T0 = "2026-09-08T02:00:00.000Z";
const later = (ms: number) => new Date(Date.parse(T0) + ms).toISOString();

function ws(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-loop-"));
}
async function withWs(body: (root: string) => Promise<void>): Promise<void> {
  const root = ws();
  try {
    await body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const snap = (over: Partial<AyasSnapshotInput> = {}): AyasSnapshotInput => ({
  observedAt: T0,
  taskTotal: 0,
  pendingApproval: 0,
  skippedUnsafe: 0,
  cyclesRecorded: 0,
  experienceTotal: 0,
  experienceConnected: false,
  safetyDecision: "proceed-with-constraints",
  storeErrors: 0,
  ...over,
});

async function run() {
  await scenario("G. heartbeat bumps the counter and stamps the time (state change)", () => {
    let state = startAyasAutonomousLoop(T0);
    assert.equal(state.heartbeatCount, 0);
    const a = ayasHeartbeat(state, later(1000));
    assert.equal(a.changed, true);
    assert.equal(a.state.heartbeatCount, 1);
    assert.equal(a.state.lastHeartbeatAt, later(1000));
    // not due yet (interval is 5 min)
    assert.equal(a.dueForCycle, false);
    state = a.state;
    // after the interval, a cycle is due
    const b = ayasHeartbeat(state, later(AYAS_LOOP_DEFAULTS.cycleIntervalMs + 1000));
    assert.equal(b.dueForCycle, true);
  });

  await scenario("gap analysis is deterministic and snapshot-grounded", () => {
    const gaps = deriveAyasGaps(snap({ cyclesRecorded: 0, pendingApproval: 2 }));
    assert.ok(gaps.some((g) => /worker cycle/i.test(g)));
    assert.ok(gaps.some((g) => /2 görev onay bekliyor/.test(g)));
    assert.deepEqual(deriveAyasGaps(snap({ cyclesRecorded: 3, experienceConnected: true, experienceTotal: 5 })),
      deriveAyasGaps(snap({ cyclesRecorded: 3, experienceConnected: true, experienceTotal: 5 })));
  });

  await scenario("cycle advances: observe → draft a proposal → park for approval", () => {
    let state = startAyasAutonomousLoop(T0);
    const r = advanceAyasCycle(state, { snapshot: snap(), llmAllowed: false }, later(1000));
    assert.equal(r.state.cycleCount, 1);
    assert.ok(r.state.observation);
    assert.ok(r.proposal, "a proposal is drafted for the top gap");
    assert.equal(r.proposal?.approvalState, "awaiting-user-approval");
    assert.equal(r.state.phase, "await-approval");
    assert.equal(r.state.pendingImprovements.length, 1);
    assert.equal(r.state.pendingImprovements[0].status, "awaiting-approval");
    state = r.state;
    // parked — a further cycle does not auto-advance
    const r2 = advanceAyasCycle(state, { snapshot: snap(), llmAllowed: false }, later(2000));
    assert.equal(r2.state.pendingImprovements.length, 1, "no new draft while parked");
  });

  await scenario("H. the loop can NEVER bypass the execution gate", () => {
    let state = startAyasAutonomousLoop(T0);
    for (let i = 0; i < 12; i += 1) {
      const r = advanceAyasCycle(state, { snapshot: snap({ cyclesRecorded: i }), llmAllowed: true, llmIdeas: ["fikir"] }, later(i * 1000 + 1));
      state = r.state;
      assert.equal(state.executionGate, "CLOSED");
      assert.equal(ayasLoopRespectsGate(state).ok, true);
      // no improvement is ever auto-approved / applied
      for (const ref of [...state.pendingImprovements, ...state.completedImprovements]) {
        assert.notEqual(ref.status, "approved", "the loop must not approve on its own");
      }
    }
    // an explicit user approval is a separate call
    const id = state.pendingImprovements[0]?.id;
    if (id) {
      const approved = approveAyasImprovement(state, id, later(99_000));
      assert.equal(approved.pendingImprovements.find((r) => r.id === id)?.status, "approved");
      assert.match(approved.nextSingleStep, /AYAS otomatik uygulamaz|onay bekliyor/);
    }
  });

  await scenario("H2. llm ideas are an INPUT — the loop imports no provider", () => {
    const raw = fs.readFileSync(path.join(REPO_ROOT, "src/lib/brain/autonomy/AyasAutonomousLoop.ts"), "utf8");
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const banned of ["AIRouter", "AIManager", "runObservedAIRequest", "OllamaProvider", "fetch(", "child_process", "PipelineRunner", "node:fs"]) {
      assert.ok(!code.includes(banned), `AyasAutonomousLoop.ts must not reference "${banned}"`);
    }
  });

  await scenario("I. checkpoint — save then load restores the state", () =>
    withWs(async (root) => {
      const store = createAyasAutonomousStore({ rootDir: root });
      let state = startAyasAutonomousLoop(T0);
      state = advanceAyasCycle(state, { snapshot: snap(), llmAllowed: false }, later(1000)).state;
      store.save(state);
      assert.ok(fs.existsSync(store.stateFile));

      const reopened = createAyasAutonomousStore({ rootDir: root });
      const loaded = reopened.load();
      assert.ok(loaded);
      assert.equal(loaded?.cycleCount, 1);
      assert.equal(loaded?.executionGate, "CLOSED");
      assert.equal(loaded?.pendingImprovements.length, 1);
    }));

  await scenario("J. restart/resume — a fresh runner picks up where it stopped", () =>
    withWs(async (root) => {
      const store = createAyasAutonomousStore({ rootDir: root });
      let state = startAyasAutonomousLoop(T0);
      state = ayasHeartbeat(state, later(1000)).state;
      state = ayasHeartbeat(state, later(2000)).state;
      state = advanceAyasCycle(state, { snapshot: snap(), llmAllowed: false }, later(3000)).state;
      store.save(state);

      // "restart": brand new store handle + resume
      const resumed = createAyasAutonomousStore({ rootDir: root }).load()!;
      assert.equal(resumed.heartbeatCount, 2);
      assert.equal(resumed.cycleCount, 1);
      const next = ayasHeartbeat(resumed, later(4000));
      assert.equal(next.state.heartbeatCount, 3, "heartbeat count continues, not resets");
    }));

  await scenario("corrupt checkpoint → loud failure, never a silent fresh start", () =>
    withWs(async (root) => {
      const store = createAyasAutonomousStore({ rootDir: root });
      fs.mkdirSync(path.dirname(store.stateFile), { recursive: true });
      fs.writeFileSync(store.stateFile, "{ not json", "utf8");
      assert.throws(
        () => store.load(),
        (e: unknown) => e instanceof AyasAutonomousStoreError && e.code === "AYAS_STORE_CORRUPT",
      );
      // wrong gate on disk is rejected too
      fs.writeFileSync(store.stateFile, JSON.stringify({ schemaVersion: "1", loopId: "x", phase: "idle", pendingImprovements: [], executionGate: "OPEN" }), "utf8");
      assert.throws(
        () => store.load(),
        (e: unknown) => e instanceof AyasAutonomousStoreError && e.code === "AYAS_STORE_INVALID",
      );
    }));

  await scenario("secret in a note → rejected on save", () =>
    withWs(async (root) => {
      const store = createAyasAutonomousStore({ rootDir: root });
      const state = startAyasAutonomousLoop(T0);
      const leaky = { ...state, notes: ["token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"] };
      // ghp_ tokens ARE redacted by redactBrainText → sanitized note is safe → save succeeds with the redacted form
      const saved = store.save(leaky);
      assert.ok(!saved.notes[0].includes("ghp_ABCDEF"), "the note is redacted before storage");
    }));

  await scenario("view loader — no checkpoint → 'not-started', not a crash", () =>
    withWs(async (root) => {
      const view = loadAyasAutonomousView({ rootDir: root });
      assert.equal(view.connected, false);
      assert.equal(view.phase, "not-started");
      assert.equal(view.executionGate, "CLOSED");
      assert.ok(!view.error);
    }));

  await scenario("view loader — reflects a real checkpoint", () =>
    withWs(async (root) => {
      const store = createAyasAutonomousStore({ rootDir: root });
      let state = startAyasAutonomousLoop(T0);
      state = advanceAyasCycle(state, { snapshot: snap({ pendingApproval: 1 }), llmAllowed: false }, later(1000)).state;
      store.save(state);
      const view = loadAyasAutonomousView({ rootDir: root });
      assert.equal(view.connected, true);
      assert.equal(view.cycleCount, 1);
      assert.equal(view.awaitingApprovalCount, 1);
      assert.ok(view.gaps.length > 0);
    }));

  console.log(`AYAS autonomous smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-autonomous", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS autonomous smoke FAILED:", error);
  process.exitCode = 1;
});
