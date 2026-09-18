import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { tickAyasResearchScheduler, AYAS_RESEARCH_LIGHT_INTERVAL_MS, AYAS_RESEARCH_DEEP_INTERVAL_MS, resolveAyasResearchGateRoot } from "../src/lib/brain/autonomy/AyasResearchScheduler";
import { createAyasResearchSchedulerStateStore } from "../src/lib/brain/autonomy/AyasResearchSchedulerStateStore";
import { createAyasResearchSourceStateStore, type AyasResearchSourceStateStore } from "../src/lib/brain/autonomy/AyasResearchSourceStateStore";
import type { AyasLightResearchDeps } from "../src/lib/brain/autonomy/AyasLightResearchEngine";
import { createAyasExternalResearchStore } from "../src/lib/brain/autonomy/AyasExternalResearchStore";
import type { AyasDeepResearchDeps } from "../src/lib/brain/autonomy/AyasDeepResearchEngine";
import { createAyasIsolatedGateRoot } from "../src/lib/brain/autonomy/AyasIsolatedGateRoot";
import { withAyasExecutionAuthorityLock } from "../src/lib/brain/autonomy/AyasExecutionAuthorityLock";
import type { AyasResearchSource } from "../src/lib/brain/autonomy/AyasResearchSourceRegistry";

/**
 * AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint, Part B/S — scheduler cadence,
 * catch-up, and concurrency-exclusion. Every scenario runs against a fully
 * isolated temp `gateRoot`/`repoRoot`, never the real `data/brain` tree
 * (clean-room). Sources are stubbed with an `http://127.0.0.1:1/` target
 * (an address nothing listens on) so the light/deep engines fail fast and
 * deterministically without any real network dependency — this file tests
 * SCHEDULING behavior, not fetch behavior (that's `smoke-ayas-safe-public-
 * fetch.ts` and the light/deep engine suites).
 */
let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const STUB_SOURCES: readonly AyasResearchSource[] = [
  { sourceId: "stub-a", provider: "StubProvider", category: "OPEN_SOURCE_AI", kind: "atom", url: "http://127.0.0.1:1/feed-a.atom", officialSource: true, expectedContentTypes: ["application/atom+xml"], notes: "unreachable by design — deterministic fast failure" },
];

/** Every scenario's own isolated LIGHT-engine dependency — MUST be scoped to that scenario's temp `gateRoot`. Without this, the light engine's default `createAyasResearchSourceStateStore()` falls back to the REAL production `data/brain/self-improvement/research-sources/` (confirmed live: an earlier version of this file without this helper actually wrote a `stub-a.json` into real production data before this fix). */
function lightDepsFor(gateRoot: string): Omit<AyasLightResearchDeps, "sources"> {
  return { stateStore: createAyasResearchSourceStateStore({ rootDir: path.join(gateRoot, "research-sources") }) };
}

/** Same isolation rationale as `lightDepsFor` — the DEEP phase's default `createAyasExternalResearchStore()` also falls back to real production data. STUB_SOURCES' unreachable URL means the deep engine never actually reaches `.record()` today, but this keeps every scenario isolated regardless of that incidental fact. */
function deepDepsFor(gateRoot: string): Omit<AyasDeepResearchDeps, "sources"> {
  return { researchStore: createAyasExternalResearchStore({ rootDir: path.join(gateRoot, "external-research") }) };
}

async function main() {
  await scenario("first-ever tick: nothing scheduled yet -> both LIGHT and DEEP are due, DEEP wins priority", async () => {
    const gateRoot = tempDir("ayas-sched-first-");
    const result = await tickAyasResearchScheduler({ repoRoot: gateRoot, gateRoot, sources: STUB_SOURCES, light: lightDepsFor(gateRoot), deep: deepDepsFor(gateRoot) });
    assert.equal(result.outcome, "DEEP");
    assert.ok(result.state.nextLightAt, "nextLightAt must be scheduled after a run");
    assert.ok(result.state.nextDeepAt, "nextDeepAt must be scheduled after a run");
  });

  await scenario("nextLightAt/nextDeepAt are scheduled ~6h / ~24h out, not some other cadence", async () => {
    const gateRoot = tempDir("ayas-sched-cadence-");
    const before = Date.now();
    const result = await tickAyasResearchScheduler({ repoRoot: gateRoot, gateRoot, sources: STUB_SOURCES, light: lightDepsFor(gateRoot), deep: deepDepsFor(gateRoot) });
    const nextLightMs = Date.parse(result.state.nextLightAt!);
    const nextDeepMs = Date.parse(result.state.nextDeepAt!);
    assert.ok(Math.abs(nextLightMs - (before + AYAS_RESEARCH_LIGHT_INTERVAL_MS)) < 5000, "nextLightAt should be ~6h out");
    assert.ok(Math.abs(nextDeepMs - (before + AYAS_RESEARCH_DEEP_INTERVAL_MS)) < 5000, "nextDeepAt should be ~24h out");
  });

  await scenario("right after a run, neither LIGHT nor DEEP is due again", async () => {
    const gateRoot = tempDir("ayas-sched-notdue-");
    await tickAyasResearchScheduler({ repoRoot: gateRoot, gateRoot, sources: STUB_SOURCES, light: lightDepsFor(gateRoot), deep: deepDepsFor(gateRoot) });
    const second = await tickAyasResearchScheduler({ repoRoot: gateRoot, gateRoot, sources: STUB_SOURCES, light: lightDepsFor(gateRoot), deep: deepDepsFor(gateRoot) });
    assert.equal(second.outcome, "NONE_DUE");
  });

  await scenario("a LIGHT-only tick (deep not yet due) does not touch nextDeepAt", async () => {
    const gateRoot = tempDir("ayas-sched-light-only-");
    const stateStore = createAyasResearchSchedulerStateStore({ rootDir: gateRoot });
    const farFuture = new Date(Date.now() + AYAS_RESEARCH_DEEP_INTERVAL_MS * 2).toISOString();
    stateStore.write({ schemaVersion: "1", nextDeepAt: farFuture, consecutiveFailures: 0 }); // deep freshly satisfied, only light is due
    const result = await tickAyasResearchScheduler({ repoRoot: gateRoot, gateRoot, sources: STUB_SOURCES, stateStore, light: lightDepsFor(gateRoot), deep: deepDepsFor(gateRoot) });
    assert.equal(result.outcome, "LIGHT");
    assert.equal(result.state.nextDeepAt, farFuture, "a LIGHT-only tick must not reschedule nextDeepAt");
  });

  await scenario("DEEP due (even if LIGHT is not) still runs and also satisfies/refreshes the LIGHT interval", async () => {
    const gateRoot = tempDir("ayas-sched-deep-subsumes-");
    const stateStore = createAyasResearchSchedulerStateStore({ rootDir: gateRoot });
    const farFuture = new Date(Date.now() + AYAS_RESEARCH_LIGHT_INTERVAL_MS * 2).toISOString();
    stateStore.write({ schemaVersion: "1", nextLightAt: farFuture, consecutiveFailures: 0 }); // light freshly satisfied, only deep is due
    const result = await tickAyasResearchScheduler({ repoRoot: gateRoot, gateRoot, sources: STUB_SOURCES, stateStore, light: lightDepsFor(gateRoot), deep: deepDepsFor(gateRoot) });
    assert.equal(result.outcome, "DEEP");
    assert.notEqual(result.state.nextLightAt, farFuture, "a DEEP run must also refresh the overlapping LIGHT schedule");
  });

  await scenario("catch-up after being 'off' for days runs exactly ONE cycle, not a replay of every missed interval", async () => {
    const gateRoot = tempDir("ayas-sched-catchup-");
    const stateStore = createAyasResearchSchedulerStateStore({ rootDir: gateRoot });
    const longAgo = new Date(Date.now() - AYAS_RESEARCH_DEEP_INTERVAL_MS * 10).toISOString(); // 10 missed deep intervals
    stateStore.write({ schemaVersion: "1", nextLightAt: longAgo, nextDeepAt: longAgo, consecutiveFailures: 0 });
    const result = await tickAyasResearchScheduler({ repoRoot: gateRoot, gateRoot, sources: STUB_SOURCES, stateStore, light: lightDepsFor(gateRoot), deep: deepDepsFor(gateRoot) });
    assert.equal(result.outcome, "DEEP", "exactly one catch-up run, not ten");
    // reschedule is now+interval, never longAgo+interval*N — proves no interval-replay bookkeeping exists
    const nextDeepMs = Date.parse(result.state.nextDeepAt!);
    assert.ok(nextDeepMs > Date.now(), "the rescheduled nextDeepAt must be in the future, derived from now — not still in the past from replaying old intervals");
  });

  await scenario("two concurrent ticks against the same gateRoot: only one actually runs, the other reports ANOTHER_RUN_ACTIVE — never a duplicate scan", async () => {
    const gateRoot = tempDir("ayas-sched-concurrent-");
    const isolated = createAyasIsolatedGateRoot(gateRoot);
    // Hold the lock ourselves for the duration of the window, exactly modeling "a run is already in progress".
    await withAyasExecutionAuthorityLock(isolated, async () => {
      const result = await tickAyasResearchScheduler({ repoRoot: gateRoot, gateRoot, sources: STUB_SOURCES, stateStore: createAyasResearchSchedulerStateStore({ rootDir: gateRoot }) });
      assert.equal(result.outcome, "ANOTHER_RUN_ACTIVE");
    });
  });

  await scenario("a process that died mid-run (stale currentRunId left in state) self-heals on the next tick rather than staying stuck", async () => {
    const gateRoot = tempDir("ayas-sched-stuck-");
    const stateStore = createAyasResearchSchedulerStateStore({ rootDir: gateRoot });
    stateStore.write({ schemaVersion: "1", currentRunId: "dead-run-id", currentMode: "DEEP", consecutiveFailures: 0 });
    const result = await tickAyasResearchScheduler({ repoRoot: gateRoot, gateRoot, sources: STUB_SOURCES, stateStore, light: lightDepsFor(gateRoot), deep: deepDepsFor(gateRoot) });
    assert.equal(result.state.currentRunId, undefined, "a completed tick must never leave currentRunId set");
    assert.notEqual(result.outcome, "ANOTHER_RUN_ACTIVE", "a stale marker with no real lock held must not be treated as an active run");
  });

  await scenario("the research scheduler's lock is completely independent from Package C's own execution-authority lock (different gateRoot) — a research run in progress never blocks a governed source-mutation execution", async () => {
    const repoRoot = tempDir("ayas-sched-independence-");
    const packageCGateRoot = createAyasIsolatedGateRoot(path.join(repoRoot, "data", "brain", "self-improvement"));
    const researchGateRoot = resolveAyasResearchGateRoot(repoRoot);
    assert.notEqual(path.resolve(packageCGateRoot), path.resolve(researchGateRoot), "the two lock roots must never be the same path");

    let packageCRanWhileResearchLockHeld = false;
    await withAyasExecutionAuthorityLock(createAyasIsolatedGateRoot(researchGateRoot), async () => {
      await withAyasExecutionAuthorityLock(packageCGateRoot, async () => {
        packageCRanWhileResearchLockHeld = true; // if this throws AYAS_LOCK_BUSY, the locks are wrongly shared
      });
    });
    assert.equal(packageCRanWhileResearchLockHeld, true);
  });

  await scenario("a research run that throws an unexpected error still advances the schedule (never a tight retry loop) and records lastError/consecutiveFailures", async () => {
    const gateRoot = tempDir("ayas-sched-error-");
    const stateStore = createAyasResearchSchedulerStateStore({ rootDir: gateRoot });
    const throwingStateStore: AyasResearchSourceStateStore = {
      dir: gateRoot,
      read: () => { throw new Error("simulated durable-store failure"); },
      list: () => [],
      write: () => { throw new Error("unreachable"); },
    };
    const light: Omit<AyasLightResearchDeps, "sources"> = { stateStore: throwingStateStore };
    const result = await tickAyasResearchScheduler({ repoRoot: gateRoot, gateRoot, sources: STUB_SOURCES, stateStore, light });
    assert.ok(result.state.nextLightAt, "the schedule must still advance despite the failure");
    assert.equal(result.state.consecutiveFailures, 1);
    assert.ok(result.state.lastError, "the failure must be recorded, not swallowed silently");
  });

  console.log(`AYAS research scheduler smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-research-scheduler", scenarios: count }));
}

main().catch((error) => { console.error(error); process.exit(1); });
