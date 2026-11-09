import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { runAyasLightResearchScan } from "../src/lib/brain/autonomy/AyasLightResearchEngine";
import { runAyasDeepResearchScan } from "../src/lib/brain/autonomy/AyasDeepResearchEngine";
import { tickAyasResearchScheduler, AYAS_RESEARCH_DEEP_INTERVAL_MS, type AyasResearchSchedulerDeps } from "../src/lib/brain/autonomy/AyasResearchScheduler";
import { AyasResearchSchedulerStateError, createAyasResearchSchedulerStateStore } from "../src/lib/brain/autonomy/AyasResearchSchedulerStateStore";
import { createAyasResearchSourceStateStore } from "../src/lib/brain/autonomy/AyasResearchSourceStateStore";
import { createAyasExternalResearchStore } from "../src/lib/brain/autonomy/AyasExternalResearchStore";
import { createAyasResearchNoveltyStore } from "../src/lib/brain/autonomy/AyasResearchNoveltyStore";
import type { AyasResearchSource } from "../src/lib/brain/autonomy/AyasResearchSourceRegistry";
import type { AIProvider, AIProviderOutput } from "../src/lib/ai/providers/AIProvider";

/**
 * The research cycle's time budget (9 Nov 2026). The observer kills the
 * discovery child at 240 s; after a weekend off, a DEEP cycle ran 228 s and was
 * killed while writing its final checkpoint, so finished research was recorded
 * as RESEARCH_OUTCOME_UNCERTAIN and the research health turned "sorunlu".
 * These scenarios prove: no scan starts new work past `deadlineAt`, a model
 * call still running then is left behind, the sources it cut short are carried
 * and continued on the next tick, changes a LIGHT-only cycle found reach the
 * next DEEP, and — in a real child process killed like the observer kills it —
 * the checkpoint lands before the kill. Clean-room: every store is in TEMP and
 * every source is a local fixture server.
 */
let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const tempDir = (prefix: string): string => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const SUMMARY = "Adds resumable batch exports";
const FEED = `<feed><entry><title>Fixture 2.0</title><link href="https://example.test/release/2"/><summary>${SUMMARY}</summary><updated>2026-11-01T00:00:00Z</updated></entry></feed>`;
const NOTEWORTHY = JSON.stringify({ capability: "resumable exports", problemSolved: "long exports survive restarts", category: "OPEN_SOURCE_AI", confidence: "high",
  licenseCostStatus: "open-source", licenseCostNotes: "", atolyeGapStatus: "missing", atolyeGapNotes: "", isNoteworthy: true, evidenceQuote: SUMMARY });

const goodProvider = (calls: { n: number }): AIProvider => ({ async generate(): Promise<AIProviderOutput> { calls.n += 1; return NOTEWORTHY; } });
/** A model call that never answers — what a cold Ollama on a busy disk looks like from inside the budget. */
const hangingProvider = (calls: { n: number }): AIProvider => ({ generate(): Promise<AIProviderOutput> { calls.n += 1; return new Promise(() => undefined); } });

function fixtureSource(baseUrl: string, sourceId = "fixture-source"): AyasResearchSource {
  return { sourceId, provider: "FixtureProvider", category: "OPEN_SOURCE_AI", kind: "atom", url: `${baseUrl}/${sourceId}.atom`, officialSource: true, expectedContentTypes: ["application/atom+xml"], notes: "test fixture" };
}

async function withFeedServer(fn: (baseUrl: string, hits: { n: number }) => Promise<void>): Promise<void> {
  const hits = { n: 0 };
  const server = http.createServer((_req, res) => { hits.n += 1; res.writeHead(200, { "Content-Type": "application/atom+xml" }); res.end(FEED); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}

function stores(root: string) {
  return {
    gateRoot: path.join(root, "research"),
    sourceState: createAyasResearchSourceStateStore({ rootDir: path.join(root, "research-sources") }),
    researchStore: createAyasExternalResearchStore({ rootDir: path.join(root, "external-research") }),
    noveltyStore: createAyasResearchNoveltyStore({ rootDir: path.join(root, "research-novelty") }),
  };
}

function schedulerDeps(root: string, sources: readonly AyasResearchSource[], provider: AIProvider, deadlineAt?: string): AyasResearchSchedulerDeps {
  const s = stores(root);
  return {
    repoRoot: root, gateRoot: s.gateRoot, sources, ...(deadlineAt ? { deadlineAt } : {}),
    light: { stateStore: s.sourceState, dangerouslyAllowPrivateNetworkForTests: true, maxRetries: 0 },
    deep: { researchStore: s.researchStore, noveltyStore: s.noveltyStore, provider, dangerouslyAllowPrivateNetworkForTests: true, maxRetries: 0 },
  };
}

const inMs = (ms: number): string => new Date(Date.now() + ms).toISOString();

/** Child mode: one scheduler tick against the parent's fixture server, the model hanging, with or without the budget. */
async function child(root: string, baseUrl: string, mode: "budget" | "unbounded"): Promise<void> {
  // A hanging promise alone does not keep a process alive; a model request in flight does. Model that, until the tick returns.
  const inFlight = setInterval(() => undefined, 1_000);
  try {
    const result = await tickAyasResearchScheduler(schedulerDeps(root, [fixtureSource(baseUrl)], hangingProvider({ n: 0 }), mode === "budget" ? inMs(1_500) : undefined));
    console.log(JSON.stringify({ outcome: result.outcome }));
  } finally { clearInterval(inFlight); }
}

/**
 * Runs the child and kills it `killAfterReservedMs` after its cycle reserved its occurrence — the way the observer's
 * execFileSync timeout cuts a cycle that started late in the child's life. The budget is 1.5 s, the kill 4 s.
 */
function runKilledChild(root: string, baseUrl: string, mode: "budget" | "unbounded", killAfterReservedMs: number): Promise<{ readonly killed: boolean; readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [...process.execArgv, __filename, "--child", root, baseUrl, mode], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const store = createAyasResearchSchedulerStateStore({ rootDir: stores(root).gateRoot });
    const spawnedAt = Date.now();
    let stdout = ""; let stderr = ""; let killed = false; let reservedAt: number | undefined;
    proc.stdout.on("data", (chunk) => { stdout += chunk; });
    proc.stderr.on("data", (chunk) => { stderr += chunk; });
    const poll = setInterval(() => {
      if (reservedAt === undefined) { try { if (store.read().currentRunId) reservedAt = Date.now(); } catch { /* mid-write: next poll */ } }
      if ((reservedAt !== undefined && Date.now() - reservedAt >= killAfterReservedMs) || Date.now() - spawnedAt > 60_000) { killed = true; clearInterval(poll); proc.kill(); }
    }, 25);
    proc.on("close", (code) => { clearInterval(poll); resolve({ killed, code, stdout, stderr }); });
  });
}

async function main(): Promise<void> {
  if (process.argv[2] === "--child") {
    const [root, baseUrl, mode] = process.argv.slice(3);
    if (!root || !path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("child root must be TEMP");
    await child(root, baseUrl!, mode === "budget" ? "budget" : "unbounded");
    return;
  }

  await scenario("LIGHT: no source check starts at or after the deadline; skipped sources keep their prior state", async () => {
    await withFeedServer(async (base, hits) => {
      const s = stores(tempDir("ayas-budget-light-"));
      const result = await runAyasLightResearchScan({ sources: [fixtureSource(base, "a"), fixtureSource(base, "b")], stateStore: s.sourceState,
        dangerouslyAllowPrivateNetworkForTests: true, maxRetries: 0, deadlineAt: inMs(-1) });
      assert.deepEqual(result.results.map((r) => r.status), ["SKIPPED_DEADLINE", "SKIPPED_DEADLINE"]);
      assert.equal(result.sourcesSkipped, 2);
      assert.equal(hits.n, 0, "nothing was fetched");
      assert.equal(s.sourceState.read("a"), undefined, "an unchecked source has no new state, so a later tick still checks it");
    });
  });

  await scenario("DEEP: past the deadline a source is deferred without a fetch or a model call", async () => {
    await withFeedServer(async (base, hits) => {
      const s = stores(tempDir("ayas-budget-deep-before-"));
      const calls = { n: 0 };
      const result = await runAyasDeepResearchScan({ sources: [fixtureSource(base)], researchStore: s.researchStore, noveltyStore: s.noveltyStore,
        provider: goodProvider(calls), dangerouslyAllowPrivateNetworkForTests: true, maxRetries: 0, deadlineAt: inMs(-1) });
      assert.deepEqual(result.deferredSourceIds, ["fixture-source"]);
      assert.equal(hits.n, 0);
      assert.equal(calls.n, 0);
      assert.equal(result.findingsRecorded, 0);
    });
  });

  await scenario("DEEP: a model call still running at the deadline is left behind; the entry stays unjudged and its source deferred", async () => {
    await withFeedServer(async (base) => {
      const s = stores(tempDir("ayas-budget-deep-hang-"));
      const calls = { n: 0 };
      const started = Date.now();
      const result = await runAyasDeepResearchScan({ sources: [fixtureSource(base)], researchStore: s.researchStore, noveltyStore: s.noveltyStore,
        provider: hangingProvider(calls), dangerouslyAllowPrivateNetworkForTests: true, maxRetries: 0, deadlineAt: inMs(400) });
      assert.ok(Date.now() - started < 5_000, "the scan returned at the deadline instead of waiting for the model");
      assert.equal(calls.n, 1);
      assert.deepEqual(result.deferredSourceIds, ["fixture-source"]);
      assert.equal(result.sourceErrors.length, 0, "running out of time is not a source error");
      assert.equal(s.noveltyStore.assess({ sourceId: "fixture-source", url: "https://example.test/release/2", versionTag: "Fixture 2.0", contentText: `Fixture 2.0\n${SUMMARY}` }).isNovel, true,
        "the abandoned entry is not remembered, so the next scan analyzes it");
    });
  });

  await scenario("DEEP without a deadline keeps today's behaviour: everything analyzed, nothing deferred", async () => {
    await withFeedServer(async (base) => {
      const s = stores(tempDir("ayas-budget-deep-none-"));
      const result = await runAyasDeepResearchScan({ sources: [fixtureSource(base)], researchStore: s.researchStore, noveltyStore: s.noveltyStore,
        provider: goodProvider({ n: 0 }), dangerouslyAllowPrivateNetworkForTests: true, maxRetries: 0 });
      assert.deepEqual(result.deferredSourceIds, []);
      assert.equal(result.findingsRecorded, 1);
    });
  });

  await scenario("scheduler: a DEEP cycle cut by the budget is a successful cycle that owes its remaining sources, and the next tick finishes them", async () => {
    await withFeedServer(async (base) => {
      const root = tempDir("ayas-budget-continue-");
      const sources = [fixtureSource(base)];
      const cut = await tickAyasResearchScheduler(schedulerDeps(root, sources, hangingProvider({ n: 0 }), inMs(600)));
      assert.equal(cut.outcome, "DEEP");
      assert.equal(cut.state.currentRunId, undefined, "the checkpoint was written: nothing is left uncertain");
      assert.equal(cut.state.consecutiveFailures, 0);
      assert.equal(cut.state.lastError, undefined);
      assert.equal(cut.state.lastSuccessfulResearchAt, cut.state.lastExecutedAt);
      assert.deepEqual(cut.state.pendingDeepSourceIds, ["fixture-source"]);
      assert.equal(cut.state.nextDeepAt, cut.state.lastExecutedAt, "the continuation is due at once, not a full interval later");

      const calls = { n: 0 };
      const next = await tickAyasResearchScheduler(schedulerDeps(root, sources, goodProvider(calls)));
      assert.equal(next.outcome, "DEEP", "the next tick continues the cut DEEP cycle");
      assert.equal(next.light?.results[0]?.status, "SKIPPED_RATE_POLICY", "the source is not fetched again for the change check");
      assert.equal(next.deep?.findingsRecorded, 1, "the owed source was analyzed");
      assert.equal(calls.n, 1);
      assert.equal(next.state.pendingDeepSourceIds, undefined);
      assert.ok(Math.abs(Date.parse(next.state.nextDeepAt!) - (Date.parse(next.state.lastExecutedAt!) + AYAS_RESEARCH_DEEP_INTERVAL_MS)) < 1_000, "back on the 3 h cadence");
      assert.equal(next.state.lastMissedCount, 0, "a continuation counts no missed occurrence");
      assert.equal((await tickAyasResearchScheduler(schedulerDeps(root, sources, goodProvider(calls)))).outcome, "NONE_DUE");
    });
  });

  await scenario("scheduler: a continuation that judges nothing new does not continue again; the owed source waits for the regular cadence", async () => {
    await withFeedServer(async (base) => {
      const root = tempDir("ayas-budget-no-progress-");
      const sources = [fixtureSource(base)];
      const first = await tickAyasResearchScheduler(schedulerDeps(root, sources, hangingProvider({ n: 0 }), inMs(500)));
      assert.equal(first.state.nextDeepAt, first.state.lastExecutedAt, "the first cut cycle continues");
      const second = await tickAyasResearchScheduler(schedulerDeps(root, sources, hangingProvider({ n: 0 }), inMs(500)));
      assert.equal(second.outcome, "DEEP");
      assert.deepEqual(second.state.pendingDeepSourceIds, ["fixture-source"], "the source is still owed");
      assert.ok(Math.abs(Date.parse(second.state.nextDeepAt!) - (Date.parse(second.state.lastExecutedAt!) + AYAS_RESEARCH_DEEP_INTERVAL_MS)) < 1_000, "no third try every tick");
      assert.equal((await tickAyasResearchScheduler(schedulerDeps(root, sources, hangingProvider({ n: 0 }), inMs(500)))).outcome, "NONE_DUE");
    });
  });

  await scenario("scheduler: a change a LIGHT-only cycle found is analyzed by the next DEEP cycle", async () => {
    await withFeedServer(async (base) => {
      const root = tempDir("ayas-budget-light-carry-");
      const sources = [fixtureSource(base)];
      const stateStore = createAyasResearchSchedulerStateStore({ rootDir: stores(root).gateRoot });
      stateStore.write({ schemaVersion: "1", consecutiveFailures: 0, nextDeepAt: inMs(AYAS_RESEARCH_DEEP_INTERVAL_MS) });
      const calls = { n: 0 };
      const light = await tickAyasResearchScheduler(schedulerDeps(root, sources, goodProvider(calls)));
      assert.equal(light.outcome, "LIGHT");
      assert.equal(light.light?.results[0]?.changed, true);
      assert.deepEqual(light.state.pendingDeepSourceIds, ["fixture-source"]);
      assert.equal(calls.n, 0, "a LIGHT cycle calls no model");

      stateStore.write({ ...stateStore.read(), nextDeepAt: inMs(-1_000) });
      const deep = await tickAyasResearchScheduler(schedulerDeps(root, sources, goodProvider(calls)));
      assert.equal(deep.outcome, "DEEP");
      assert.equal(deep.light?.results[0]?.changed, false, "this cycle's own change check saw nothing new");
      assert.equal(deep.deep?.findingsRecorded, 1, "the earlier change still got its analysis");
      assert.equal(deep.state.pendingDeepSourceIds, undefined);
    });
  });

  await scenario("scheduler: with no budget left nothing is reserved or recorded as research", async () => {
    const root = tempDir("ayas-budget-exhausted-");
    const result = await tickAyasResearchScheduler(schedulerDeps(root, [], goodProvider({ n: 0 }), inMs(-1)));
    assert.equal(result.outcome, "NONE_DUE");
    const state = createAyasResearchSchedulerStateStore({ rootDir: stores(root).gateRoot }).read();
    assert.equal(state.totalAttempts, undefined);
    assert.equal(state.currentRunId, undefined);
    assert.equal(state.lastSuccessfulResearchAt, undefined);
  });

  await scenario("state: pendingDeepSourceIds is validated and fails closed", () => {
    const gateRoot = tempDir("ayas-budget-state-");
    const store = createAyasResearchSchedulerStateStore({ rootDir: gateRoot });
    for (const bad of [["a", "a"], [""], "a", [1]]) {
      assert.throws(() => store.write({ schemaVersion: "1", consecutiveFailures: 0, pendingDeepSourceIds: bad as unknown as string[] }), AyasResearchSchedulerStateError);
    }
    store.write({ schemaVersion: "1", consecutiveFailures: 0, pendingDeepSourceIds: ["a", "b"] });
    assert.deepEqual(store.read().pendingDeepSourceIds, ["a", "b"]);
  });

  await withFeedServer(async (base) => {
    await scenario("reproduction: an unbounded cycle killed like the observer kills it leaves its reservation uncertain", async () => {
      const root = tempDir("ayas-budget-kill-unbounded-");
      const run = await runKilledChild(root, base, "unbounded", 4_000);
      assert.equal(run.killed, true, `the child must still be inside the cycle when killed: ${run.stderr}`);
      const state = createAyasResearchSchedulerStateStore({ rootDir: stores(root).gateRoot }).read();
      assert.ok(state.currentRunId, "the reservation survived the kill — the 9 Nov 2026 failure");
      // The dead child still owns the lock; it becomes reclaimable after 10 minutes (live: busy at 03:53, reclaimed at 03:59).
      const lockDir = path.join(stores(root).gateRoot, "execution", ".authority-lock");
      const eleven = new Date(Date.now() - 11 * 60_000);
      fs.utimesSync(lockDir, eleven, eleven);
      const recovered = await tickAyasResearchScheduler(schedulerDeps(root, [fixtureSource(base)], goodProvider({ n: 0 })));
      assert.equal(recovered.outcome, "RECOVERED_UNCERTAIN");
      assert.equal(recovered.state.consecutiveFailures, 1);
    });

    await scenario("fix: the same cycle with the budget writes its checkpoint before the kill, and the next tick completes the research", async () => {
      const root = tempDir("ayas-budget-kill-budget-");
      const run = await runKilledChild(root, base, "budget", 4_000);
      assert.equal(run.killed, false, `the child finished inside its life: ${run.stderr}`);
      assert.equal(run.code, 0, run.stderr);
      assert.equal(JSON.parse(run.stdout.trim()).outcome, "DEEP");
      const state = createAyasResearchSchedulerStateStore({ rootDir: stores(root).gateRoot }).read();
      assert.equal(state.currentRunId, undefined);
      assert.equal(state.consecutiveFailures, 0);
      assert.deepEqual(state.pendingDeepSourceIds, ["fixture-source"]);
      const next = await tickAyasResearchScheduler(schedulerDeps(root, [fixtureSource(base)], goodProvider({ n: 0 })));
      assert.equal(next.outcome, "DEEP");
      assert.equal(next.deep?.findingsRecorded, 1);
      assert.equal(next.state.consecutiveFailures, 0);
      assert.equal(next.state.pendingDeepSourceIds, undefined);
    });
  });

  await scenario("the discovery child passes the research tick a budget well inside the observer's 240 s kill", () => {
    const daemon = fs.readFileSync(path.join(__dirname, "ayas-discovery-daemon.ts"), "utf8");
    const budget = Number(/const AYAS_DISCOVERY_RESEARCH_BUDGET_MS = ([\d_]+);/.exec(daemon)?.[1]?.replace(/_/g, ""));
    const ceiling = Number(/const AYAS_DISCOVERY_CHILD_WORK_CEILING_MS = ([\d_]+);/.exec(daemon)?.[1]?.replace(/_/g, ""));
    const observer = fs.readFileSync(path.join(__dirname, "ayas-autonomy-daemon.ts"), "utf8");
    const kill = Number(/ayas-discovery-daemon\.ts[\s\S]*?timeout: ([\d_]+)/.exec(observer)?.[1]?.replace(/_/g, ""));
    assert.ok(budget > 0 && ceiling > 0 && kill > 0, "constants found");
    assert.ok(budget < ceiling && ceiling < kill, `${budget} < ${ceiling} < ${kill}`);
    assert.ok(kill - budget >= 90_000, "an in-flight fetch, the final checkpoint and the later discovery steps fit after the budget");
    assert.match(daemon, /tickAyasResearchScheduler\(\{[^}]*deadlineAt: new Date\(childStartedAt \+ AYAS_DISCOVERY_RESEARCH_BUDGET_MS\)\.toISOString\(\)/);
  });

  console.log(`AYAS research time budget smoke: PASS (${count} scenarios)`);
}

main().catch((error) => { console.error(error); process.exit(1); });
