import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";

import { scheduleAyasGoalResearch, createAndScheduleAyasGoalResearch, controlAyasGoalResearchJob, AYAS_GOAL_RESEARCH_ON_TIME_GRACE_MS } from "../src/lib/brain/autonomy/AyasGoalResearchSchedule";
import { withAyasExecutionAuthorityLock } from "../src/lib/brain/autonomy/AyasExecutionAuthorityLock";
import { tickAyasResearchScheduler } from "../src/lib/brain/autonomy/AyasResearchScheduler";
import { createAyasResearchSchedulerHeartbeatStore, createAyasResearchSchedulerStateStore, AyasResearchSchedulerStateError, type AyasGoalResearchJob, type AyasResearchSchedulerStateStore } from "../src/lib/brain/autonomy/AyasResearchSchedulerStateStore";
import { createAyasGoalStore } from "../src/lib/brain/autonomy/AyasGoalStore";
import { createAyasResearchSourceStateStore, ayasResearchSourceStateSchemaVersion } from "../src/lib/brain/autonomy/AyasResearchSourceStateStore";
import { createAyasExternalResearchStore } from "../src/lib/brain/autonomy/AyasExternalResearchStore";
import type { AyasResearchSource } from "../src/lib/brain/autonomy/AyasResearchSourceRegistry";
import type { AIProvider, AIProviderOutput } from "../src/lib/ai/providers/AIProvider";

const T0 = "2026-09-24T00:00:00.000Z";
const DUE = "2026-09-24T01:00:00.000Z";
const T2 = "2026-09-24T02:00:00.000Z";
const T3 = "2026-09-24T03:00:00.000Z";
const FAR_FUTURE = "2026-09-25T03:00:00.000Z";
let count = 0;
const scenario = async (name: string, fn: () => Promise<void> | void) => { await fn(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); };

const NOTEWORTHY = { capability: "local model quality", problemSolved: "better local inference", category: "OPEN_SOURCE_AI", confidence: "high", licenseCostStatus: "open-source", licenseCostNotes: "", atolyeGapStatus: "missing", atolyeGapNotes: "", isNoteworthy: true } as const;

function fixtureSource(url: string, sourceId = "fixture-source", provider = "Fixture"): AyasResearchSource {
  return { sourceId, provider, category: "OPEN_SOURCE_AI", kind: "atom", url, officialSource: true, notes: "TEMP fixture", expectedContentTypes: ["application/atom+xml"], policy: { minCheckIntervalMs: 2 * 60 * 60_000, maxRetries: 0 } };
}

/** Every store of a TEMP fixture root, never a cwd-relative default. */
function tempStores(root: string) {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("fixture root must be TEMP");
  const brain = path.join(root, "data", "brain", "self-improvement");
  return {
    gateRoot: path.join(brain, "research"),
    goalStore: createAyasGoalStore({ rootDir: path.join(brain, "goals") }),
    sourceStateStore: createAyasResearchSourceStateStore({ rootDir: path.join(brain, "research-sources") }),
    researchStore: createAyasExternalResearchStore({ rootDir: path.join(brain, "external-research") }),
  };
}

function fixture(url: string) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-goal-research-"));
  const gateRoot = path.join(repoRoot, "data", "brain", "self-improvement", "research");
  const goalStore = createAyasGoalStore({ rootDir: path.join(repoRoot, "data", "brain", "self-improvement", "goals") });
  const stateStore = createAyasResearchSchedulerStateStore({ rootDir: gateRoot });
  const sourceStateStore = createAyasResearchSourceStateStore({ rootDir: path.join(repoRoot, "data", "brain", "self-improvement", "research-sources") });
  const researchStore = createAyasExternalResearchStore({ rootDir: path.join(repoRoot, "data", "brain", "self-improvement", "external-research") });
  const source: AyasResearchSource = { sourceId: "fixture-source", provider: "Fixture", category: "OPEN_SOURCE_AI", kind: "atom", url, officialSource: true, notes: "TEMP fixture", expectedContentTypes: ["application/atom+xml"], policy: { minCheckIntervalMs: 2 * 60 * 60_000, maxRetries: 0 } };
  const goal = goalStore.create({ userIntent: "Research local AI quality", scope: "AI providers", allowedDomains: ["src/lib/ai/"], successCriteria: ["source-backed evidence"] });
  const schedule = async (policy: "CATCH_UP_ONCE" | "SKIP_AS_STALE" | "REQUIRE_OWNER_CONFIRMATION", maxLatenessMs = 2 * 60 * 60_000) => {
    const job = await scheduleAyasGoalResearch({ goalId: goal.goalId, sourceIds: [source.sourceId], scheduledFor: DUE, catchUpPolicy: policy, maxLatenessMs }, { gateRoot, stateStore, goalStore, sources: [source], now: () => T0 });
    stateStore.write({ ...stateStore.read(), nextLightAt: FAR_FUTURE, nextDeepAt: FAR_FUTURE });
    return job;
  };
  const output = JSON.stringify({ capability: "local model quality", problemSolved: "better local inference", category: "OPEN_SOURCE_AI", confidence: "high", licenseCostStatus: "open-source", licenseCostNotes: "", atolyeGapStatus: "missing", atolyeGapNotes: "", isNoteworthy: true });
  let providerCalls = 0;
  const provider: AIProvider = { async generate(): Promise<AIProviderOutput> { providerCalls++; return output; } };
  const tick = (at: string, overrides: { stateStore?: AyasResearchSchedulerStateStore; provider?: AIProvider } = {}) => tickAyasResearchScheduler({
    repoRoot, gateRoot, stateStore: overrides.stateStore ?? stateStore, goalStore, sourceStateStore, sources: [source], now: () => at,
    deep: { researchStore, provider: overrides.provider ?? provider, now: () => at, maxRetries: 0, dangerouslyAllowPrivateNetworkForTests: true },
    light: { stateStore: sourceStateStore, now: () => at, maxRetries: 0, dangerouslyAllowPrivateNetworkForTests: true },
  });
  return { repoRoot, gateRoot, goalStore, stateStore, sourceStateStore, researchStore, source, goal, schedule, tick, providerCalls: () => providerCalls };
}

const FEED = '<feed><entry><title>Local model quality</title><link href="https://example.test/release/1"/><summary>Improved local inference quality</summary><updated>2026-09-24T00:00:00Z</updated></entry></feed>';
/** Local-only feed server: `/feed.atom` is the shared fixture, other paths get their own entry, any path containing "down" answers 503. */
async function withFeed(fn: (url: string, hits: ReadonlyMap<string, number>) => Promise<void>) {
  const hits = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const route = req.url ?? "/";
    hits.set(route, (hits.get(route) ?? 0) + 1);
    if (route.includes("down")) { res.writeHead(503, { "Content-Type": "text/plain" }); res.end("unavailable"); return; }
    res.writeHead(200, { "Content-Type": "application/atom+xml" });
    res.end(route === "/feed.atom" ? FEED : FEED.replace("https://example.test/release/1", `https://example.test/release${route.replace(/[^a-z0-9/]/gi, "")}`));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/feed.atom`, hits); }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

function spawnRaceChild(root: string, url: string, callsFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, __filename, "--race-child", root, url, callsFile], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("race child timed out")); }, 30_000);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(stdout.trim()); else reject(new Error(`race child exited ${code}: ${stderr}`)); });
  });
}

async function main() {
  if (process.argv[2] === "--restart-child") {
    const root = process.argv[3];
    if (!root) throw new Error("child root is required");
    const stores = tempStores(root);
    const result = await tickAyasResearchScheduler({ repoRoot: root, gateRoot: stores.gateRoot, goalStore: stores.goalStore, sourceStateStore: stores.sourceStateStore, sources: [], now: () => T2, deep: { researchStore: stores.researchStore } });
    console.log(result.outcome);
    return;
  }
  if (process.argv[2] === "--race-child") {
    const [root, url, callsFile] = process.argv.slice(3);
    if (!root || !url || !callsFile) throw new Error("race child needs root, url and calls file");
    const stores = tempStores(root);
    const provider: AIProvider = { async generate(): Promise<AIProviderOutput> { fs.appendFileSync(callsFile, `${process.pid}\n`); return JSON.stringify(NOTEWORTHY); } };
    const result = await tickAyasResearchScheduler({
      repoRoot: root, gateRoot: stores.gateRoot, goalStore: stores.goalStore, sourceStateStore: stores.sourceStateStore, sources: [fixtureSource(url)], now: () => DUE,
      deep: { researchStore: stores.researchStore, provider, now: () => DUE, maxRetries: 0, dangerouslyAllowPrivateNetworkForTests: true },
    });
    console.log(result.outcome);
    return;
  }
  await withFeed(async (url, hits) => {
    await scenario("one-shot intent persists, is not due early, and runs once at its due time", async () => {
      const f = fixture(url);
      const job = await f.schedule("CATCH_UP_ONCE");
      assert.equal(createAyasResearchSchedulerStateStore({ rootDir: f.gateRoot }).read().goalResearchJobs?.[0]?.jobId, job.jobId);
      f.stateStore.write({ ...f.stateStore.read(), nextLightAt: T3, nextDeepAt: T3 });
      assert.equal((await f.tick(T0)).outcome, "NONE_DUE");
      const result = await f.tick(DUE);
      assert.equal(result.outcome, "GOAL_SUCCEEDED");
      assert.equal(f.providerCalls(), 1);
      assert.equal((await f.tick(DUE)).outcome, "NONE_DUE");
      const saved = f.stateStore.read().goalResearchJobs![0]!;
      assert.equal(saved.status, "SUCCEEDED");
      assert.equal(saved.attempt, 1);
      assert.equal(saved.scheduledFor, DUE);
      assert.equal(saved.executedAt, DUE);
      assert.equal(f.researchStore.list()[0]?.goalId, f.goal.goalId);
      assert.equal(f.researchStore.list()[0]?.occurrenceId, saved.occurrenceId);
    });

    await scenario("a missed one-shot catches up once with real execution time", async () => {
      const f = fixture(url);
      await f.schedule("CATCH_UP_ONCE");
      f.stateStore.write({ ...f.stateStore.read(), nextLightAt: T3, nextDeepAt: T3 });
      assert.equal((await f.tick(T2)).outcome, "GOAL_SUCCEEDED");
      const job = f.stateStore.read().goalResearchJobs![0]!;
      assert.equal(job.missedAt, T2);
      assert.equal(job.scheduledFor, DUE);
      assert.equal(job.executedAt, T2);
      assert.equal((await f.tick(T2)).outcome, "NONE_DUE");
      assert.equal(f.providerCalls(), 1);
    });

    await scenario("multiple missed Goal jobs park older work instead of bursting provider calls", async () => {
      const f = fixture(url);
      await f.schedule("CATCH_UP_ONCE");
      const later = await scheduleAyasGoalResearch({ goalId: f.goal.goalId, sourceIds: [f.source.sourceId], scheduledFor: T2, catchUpPolicy: "CATCH_UP_ONCE", maxLatenessMs: 2 * 60 * 60_000 }, { gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore, sources: [f.source], now: () => T0 });
      assert.equal((await f.tick(T3)).outcome, "GOAL_WAITING");
      const jobs = f.stateStore.read().goalResearchJobs!;
      assert.equal(jobs.find((job) => job.jobId !== later.jobId)?.status, "AWAITING_OWNER");
      assert.equal(f.providerCalls(), 0);
      assert.equal((await f.tick(T3)).outcome, "GOAL_SUCCEEDED");
      assert.equal(f.providerCalls(), 1);
      assert.equal((await f.tick(T3)).outcome, "NONE_DUE");
    });

    await scenario("stale and skip policies never call a provider", async () => {
      for (const policy of ["CATCH_UP_ONCE", "SKIP_AS_STALE"] as const) {
        const f = fixture(url);
        await f.schedule(policy, policy === "CATCH_UP_ONCE" ? 1 : 0);
        assert.equal((await f.tick(T3)).outcome, "GOAL_SKIPPED");
        assert.equal(f.providerCalls(), 0);
        assert.equal(f.stateStore.read().goalResearchJobs![0]!.status, "SKIPPED_STALE");
      }
    });

    await scenario("owner confirmation remains parked across ticks, then executes once", async () => {
      const f = fixture(url);
      const job = await f.schedule("REQUIRE_OWNER_CONFIRMATION");
      assert.equal((await f.tick(T2)).outcome, "GOAL_WAITING");
      assert.equal((await f.tick(T2)).outcome, "NONE_DUE");
      assert.equal(f.providerCalls(), 0);
      await controlAyasGoalResearchJob(job.jobId, "CONFIRM", { gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore, now: () => T2 });
      assert.equal((await f.tick(T2)).outcome, "GOAL_SUCCEEDED");
      assert.equal(f.providerCalls(), 1);
      assert.equal(f.stateStore.read().goalResearchJobs![0]!.errorCode, undefined, "a confirmed, successful run carries no stale parking reason");
    });

    await scenario("changed goal scope invalidates a pending owner confirmation", async () => {
      const f = fixture(url);
      const job = await f.schedule("REQUIRE_OWNER_CONFIRMATION");
      await f.tick(T2);
      const file = path.join(f.goalStore.dir, `${f.goal.goalId}.json`);
      const changed = { ...f.goalStore.load(f.goal.goalId), userIntent: "different goal" };
      fs.writeFileSync(file, `${JSON.stringify(changed)}\n`);
      await assert.rejects(controlAyasGoalResearchJob(job.jobId, "CONFIRM", { gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore, now: () => T2 }), /scope changed/);
      assert.equal(f.providerCalls(), 0);
    });

    await scenario("a goal changed before due is skipped without using stale scope", async () => {
      const f = fixture(url);
      await f.schedule("CATCH_UP_ONCE");
      const file = path.join(f.goalStore.dir, `${f.goal.goalId}.json`);
      fs.writeFileSync(file, JSON.stringify({ ...f.goalStore.load(f.goal.goalId), userIntent: "another research goal" }));
      assert.equal((await f.tick(DUE)).outcome, "GOAL_SKIPPED");
      assert.equal(f.providerCalls(), 0);
    });

    await scenario("owner cancellation is durable and cannot run after restart", async () => {
      const f = fixture(url);
      const job = await f.schedule("CATCH_UP_ONCE");
      await controlAyasGoalResearchJob(job.jobId, "CANCEL", { gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore, now: () => T0 });
      assert.equal(createAyasResearchSchedulerStateStore({ rootDir: f.gateRoot }).read().goalResearchJobs![0]!.status, "CANCELLED");
      assert.equal((await f.tick(DUE)).outcome, "NONE_DUE");
      assert.equal(f.providerCalls(), 0);
    });

    await scenario("two concurrent daemons reserve only one goal occurrence", async () => {
      const f = fixture(url);
      await f.schedule("CATCH_UP_ONCE");
      const results = await Promise.all([f.tick(DUE), f.tick(DUE)]);
      assert.equal(results.filter((result) => result.outcome === "GOAL_SUCCEEDED").length, 1);
      assert.equal(f.providerCalls(), 1);
      assert.equal(f.stateStore.read().goalResearchJobs![0]!.attempt, 1);
    });

    await scenario("a final checkpoint failure leaves RUNNING; a separate process marks UNCERTAIN without a provider call", async () => {
      const f = fixture(url);
      await f.schedule("CATCH_UP_ONCE");
      let writes = 0;
      const failingStore: AyasResearchSchedulerStateStore = { file: f.stateStore.file, read: () => f.stateStore.read(), write: (state) => { if (++writes === 2) throw new Error("final checkpoint failure"); return f.stateStore.write(state); } };
      assert.equal((await f.tick(DUE, { stateStore: failingStore })).outcome, "NONE_DUE", "a Goal-path fault never stalls the cadence");
      assert.equal(f.stateStore.read().lastError, "GOAL_RESEARCH_TICK_FAILED");
      assert.equal(f.stateStore.read().goalResearchJobs![0]!.status, "RUNNING");
      const child = spawnSync(process.execPath, [...process.execArgv, __filename, "--restart-child", f.repoRoot], { encoding: "utf8", timeout: 15_000 });
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stdout.trim(), "GOAL_RECONCILED");
      assert.equal(f.stateStore.read().goalResearchJobs![0]!.status, "UNCERTAIN");
      assert.equal(f.providerCalls(), 1);
      assert.equal((await f.tick(T2)).outcome, "NONE_DUE");
      assert.equal(f.providerCalls(), 1);
    });

    await scenario("model failure is terminal for this job and never resets its attempt", async () => {
      const f = fixture(url);
      await f.schedule("CATCH_UP_ONCE");
      const failingProvider: AIProvider = { async generate(): Promise<AIProviderOutput> { throw new Error("model unavailable"); } };
      assert.equal((await f.tick(DUE, { provider: failingProvider })).outcome, "GOAL_FAILED");
      assert.equal(f.stateStore.read().goalResearchJobs![0]!.attempt, 1);
      assert.equal((await f.tick(DUE)).outcome, "NONE_DUE");
      assert.equal(f.providerCalls(), 0);
    });

    await scenario("a result persisted before a thrown store error is never replayed", async () => {
      const f = fixture(url);
      await f.schedule("CATCH_UP_ONCE");
      const throwingResearchStore = { ...f.researchStore, record: (input: Parameters<typeof f.researchStore.record>[0]) => { f.researchStore.record(input); throw new Error("post-persist interruption"); } };
      const result = await tickAyasResearchScheduler({
        repoRoot: f.repoRoot, gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore,
        sourceStateStore: f.sourceStateStore, sources: [f.source], now: () => DUE,
        deep: { researchStore: throwingResearchStore, provider: { async generate(): Promise<AIProviderOutput> { return JSON.stringify({ capability: "local model quality", problemSolved: "better local inference", category: "OPEN_SOURCE_AI", confidence: "high", licenseCostStatus: "open-source", licenseCostNotes: "", atolyeGapStatus: "missing", atolyeGapNotes: "", isNoteworthy: true }); } }, now: () => DUE, maxRetries: 0, dangerouslyAllowPrivateNetworkForTests: true },
      });
      assert.equal(result.outcome, "GOAL_FAILED");
      assert.equal(f.researchStore.list().length, 1);
      assert.equal((await f.tick(DUE)).outcome, "NONE_DUE");
    });

    await scenario("corrupt goal job state and forged occurrence fail closed", async () => {
      const f = fixture(url);
      const job = await f.schedule("CATCH_UP_ONCE");
      const original = f.stateStore.read();
      const invalid: AyasGoalResearchJob = { ...job, occurrenceId: crypto.randomBytes(32).toString("hex") };
      fs.writeFileSync(f.stateStore.file, JSON.stringify({ ...original, goalResearchJobs: [invalid] }));
      await assert.rejects(f.tick(DUE), AyasResearchSchedulerStateError);
      assert.equal(f.providerCalls(), 0);
    });

    await scenario("invalid time and unregistered source are rejected before a schedule is written", async () => {
      const f = fixture(url);
      await assert.rejects(scheduleAyasGoalResearch({ goalId: f.goal.goalId, sourceIds: [f.source.sourceId], scheduledFor: "2026-09-24 01:00", catchUpPolicy: "CATCH_UP_ONCE", maxLatenessMs: 1000 }, { gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore, sources: [f.source], now: () => T0 }));
      await assert.rejects(scheduleAyasGoalResearch({ goalId: f.goal.goalId, sourceIds: ["unregistered"], scheduledFor: DUE, catchUpPolicy: "CATCH_UP_ONCE", maxLatenessMs: 1000 }, { gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore, sources: [f.source], now: () => T0 }));
      assert.equal(f.stateStore.read().goalResearchJobs, undefined);
    });

    await scenario("rate policy defers a second job instead of bursting calls", async () => {
      const f = fixture(url);
      await f.schedule("CATCH_UP_ONCE");
      await f.tick(DUE);
      const second = await scheduleAyasGoalResearch({ goalId: f.goal.goalId, sourceIds: [f.source.sourceId], scheduledFor: T2, catchUpPolicy: "CATCH_UP_ONCE", maxLatenessMs: 2 * 60 * 60_000 }, { gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore, sources: [f.source], now: () => DUE });
      assert.equal((await f.tick(T2)).outcome, "GOAL_DEFERRED");
      assert.equal(f.providerCalls(), 1);
      assert.ok(f.stateStore.read().goalResearchJobs!.find((job) => job.jobId === second.jobId)?.nextAttemptAt);
    });

    await scenario("an on-time heartbeat minutes after the due instant runs the job; only a gap beyond the grace counts as missed", async () => {
      for (const policy of ["REQUIRE_OWNER_CONFIRMATION", "SKIP_AS_STALE"] as const) {
        const onTime = fixture(url);
        await onTime.schedule(policy, 0);
        const heartbeat = new Date(Date.parse(DUE) + AYAS_GOAL_RESEARCH_ON_TIME_GRACE_MS - 60_000).toISOString();
        assert.equal((await onTime.tick(heartbeat)).outcome, "GOAL_SUCCEEDED", `${policy}: an on-time heartbeat must run`);
        const ran = onTime.stateStore.read().goalResearchJobs![0]!;
        assert.equal(ran.missedAt, undefined);
        assert.equal(ran.scheduledFor, DUE);
        assert.equal(ran.executedAt, heartbeat, "real execution time, not the due time");
        assert.equal(onTime.providerCalls(), 1);

        const down = fixture(url);
        await down.schedule(policy, 0);
        const afterGap = new Date(Date.parse(DUE) + AYAS_GOAL_RESEARCH_ON_TIME_GRACE_MS + 60_000).toISOString();
        assert.equal((await down.tick(afterGap)).outcome, policy === "SKIP_AS_STALE" ? "GOAL_SKIPPED" : "GOAL_WAITING");
        assert.equal(down.stateStore.read().goalResearchJobs![0]!.missedAt, afterGap);
        assert.equal(down.providerCalls(), 0);
      }
    });

    await scenario("no relevant new evidence is an explicit insufficient-source state, never a fabricated finding", async () => {
      const f = fixture(url);
      await f.schedule("CATCH_UP_ONCE");
      const notNoteworthy: AIProvider = { async generate(): Promise<AIProviderOutput> { return JSON.stringify({ ...NOTEWORTHY, isNoteworthy: false }); } };
      assert.equal((await f.tick(DUE, { provider: notNoteworthy })).outcome, "GOAL_SUCCEEDED");
      const job = f.stateStore.read().goalResearchJobs![0]!;
      assert.equal(job.findingsRecorded, 0);
      assert.equal(job.errorCode, "INSUFFICIENT_SOURCE_EVIDENCE");
      assert.equal(f.researchStore.list().length, 0);
      assert.equal((await f.tick(T2)).outcome, "NONE_DUE", "insufficient evidence is terminal, not retried");
    });

    await scenario("one of three registered sources down: the others are read, the job reports the failure, nothing is fabricated, no unselected source is contacted", async () => {
      const base = url.replace("/feed.atom", "");
      const sources = [fixtureSource(`${base}/alpha.atom`, "fixture-alpha", "Alpha"), fixtureSource(`${base}/down.atom`, "fixture-down", "Down"), fixtureSource(`${base}/beta.atom`, "fixture-beta", "Beta")];
      const unselected = fixtureSource(`${base}/unselected.atom`, "fixture-unselected", "Unselected");
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-goal-research-multi-"));
      const stores = tempStores(root);
      const stateStore = createAyasResearchSchedulerStateStore({ rootDir: stores.gateRoot });
      const goal = stores.goalStore.create({ userIntent: "Research local AI quality", scope: "AI providers", allowedDomains: ["src/lib/ai/"], successCriteria: ["source-backed evidence"] });
      const registry = [...sources, unselected];
      const job = await scheduleAyasGoalResearch({ goalId: goal.goalId, sourceIds: sources.map((source) => source.sourceId), scheduledFor: DUE, catchUpPolicy: "CATCH_UP_ONCE", maxLatenessMs: 2 * 60 * 60_000 }, { gateRoot: stores.gateRoot, stateStore, goalStore: stores.goalStore, sources: registry, now: () => T0 });
      stateStore.write({ ...stateStore.read(), nextLightAt: FAR_FUTURE, nextDeepAt: FAR_FUTURE });
      let calls = 0;
      const provider: AIProvider = { async generate(): Promise<AIProviderOutput> { calls++; return JSON.stringify(NOTEWORTHY); } };
      const result = await tickAyasResearchScheduler({
        repoRoot: root, gateRoot: stores.gateRoot, stateStore, goalStore: stores.goalStore, sourceStateStore: stores.sourceStateStore, sources: registry, now: () => DUE,
        deep: { researchStore: stores.researchStore, provider, now: () => DUE, maxRetries: 0, dangerouslyAllowPrivateNetworkForTests: true },
      });
      assert.equal(result.outcome, "GOAL_FAILED");
      const saved = stateStore.read().goalResearchJobs!.find((item) => item.jobId === job.jobId)!;
      assert.equal(saved.errorCode, "RESEARCH_SOURCE_FAILURE");
      assert.equal(saved.findingsRecorded, 2);
      assert.equal(calls, 2, "the down source reaches no model call");
      assert.deepEqual(stores.researchStore.list().map((finding) => finding.provider).sort(), ["Alpha", "Beta"]);
      assert.equal(hits.get("/unselected.atom") ?? 0, 0, "a registered but unselected source is never a silent fallback");
      const again = await tickAyasResearchScheduler({ repoRoot: root, gateRoot: stores.gateRoot, stateStore, goalStore: stores.goalStore, sourceStateStore: stores.sourceStateStore, sources: registry, now: () => T2 });
      assert.equal(again.outcome, "NONE_DUE", "a failed job is not retried");
      fs.rmSync(root, { recursive: true, force: true });
    });

    await scenario("all selected registered sources down: FAILED with zero findings and zero model calls", async () => {
      const base = url.replace("/feed.atom", "");
      const sources = [fixtureSource(`${base}/down-one.atom`, "fixture-down-one", "DownOne"), fixtureSource(`${base}/down-two.atom`, "fixture-down-two", "DownTwo")];
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-goal-research-down-"));
      const stores = tempStores(root);
      const stateStore = createAyasResearchSchedulerStateStore({ rootDir: stores.gateRoot });
      const goal = stores.goalStore.create({ userIntent: "Research local AI quality", scope: "AI providers", allowedDomains: ["src/lib/ai/"], successCriteria: ["source-backed evidence"] });
      await scheduleAyasGoalResearch({ goalId: goal.goalId, sourceIds: sources.map((source) => source.sourceId), scheduledFor: DUE, catchUpPolicy: "CATCH_UP_ONCE", maxLatenessMs: 2 * 60 * 60_000 }, { gateRoot: stores.gateRoot, stateStore, goalStore: stores.goalStore, sources, now: () => T0 });
      stateStore.write({ ...stateStore.read(), nextLightAt: FAR_FUTURE, nextDeepAt: FAR_FUTURE });
      let calls = 0;
      const provider: AIProvider = { async generate(): Promise<AIProviderOutput> { calls++; return JSON.stringify(NOTEWORTHY); } };
      const result = await tickAyasResearchScheduler({
        repoRoot: root, gateRoot: stores.gateRoot, stateStore, goalStore: stores.goalStore, sourceStateStore: stores.sourceStateStore, sources, now: () => DUE,
        deep: { researchStore: stores.researchStore, provider, now: () => DUE, maxRetries: 0, dangerouslyAllowPrivateNetworkForTests: true },
      });
      assert.equal(result.outcome, "GOAL_FAILED");
      const saved = stateStore.read().goalResearchJobs![0]!;
      assert.equal(saved.findingsRecorded, 0);
      assert.equal(saved.errorCode, "RESEARCH_SOURCE_FAILURE");
      assert.equal(calls, 0);
      assert.equal(stores.researchStore.list().length, 0);
      fs.rmSync(root, { recursive: true, force: true });
    });

    await scenario("a pending owner confirmation survives a real process restart; restart never approves and never resets attempts", async () => {
      const f = fixture(url);
      await f.schedule("REQUIRE_OWNER_CONFIRMATION");
      assert.equal((await f.tick(T2)).outcome, "GOAL_WAITING");
      const child = spawnSync(process.execPath, [...process.execArgv, __filename, "--restart-child", f.repoRoot], { encoding: "utf8", timeout: 15_000 });
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stdout.trim(), "NONE_DUE");
      const parked = createAyasResearchSchedulerStateStore({ rootDir: f.gateRoot }).read().goalResearchJobs![0]!;
      assert.equal(parked.status, "AWAITING_OWNER");
      assert.equal(parked.attempt, 0);
      assert.equal(parked.confirmedAt, undefined);
      assert.equal(f.providerCalls(), 0);

      const failed = fixture(url);
      await failed.schedule("CATCH_UP_ONCE");
      const failingProvider: AIProvider = { async generate(): Promise<AIProviderOutput> { throw new Error("model unavailable"); } };
      assert.equal((await failed.tick(DUE, { provider: failingProvider })).outcome, "GOAL_FAILED");
      const restarted = spawnSync(process.execPath, [...process.execArgv, __filename, "--restart-child", failed.repoRoot], { encoding: "utf8", timeout: 15_000 });
      assert.equal(restarted.status, 0, restarted.stderr);
      assert.equal(restarted.stdout.trim(), "NONE_DUE");
      const after = createAyasResearchSchedulerStateStore({ rootDir: failed.gateRoot }).read().goalResearchJobs![0]!;
      assert.equal(after.status, "FAILED");
      assert.equal(after.attempt, 1);
    });

    await scenario("two real daemon processes racing for one due occurrence: one reservation, one model call, one finding", async () => {
      const f = fixture(url);
      await f.schedule("CATCH_UP_ONCE");
      const callsFile = path.join(f.repoRoot, "race-calls.txt");
      fs.writeFileSync(callsFile, "");
      const outcomes = await Promise.all([spawnRaceChild(f.repoRoot, url, callsFile), spawnRaceChild(f.repoRoot, url, callsFile)]);
      assert.equal(outcomes.filter((outcome) => outcome === "GOAL_SUCCEEDED").length, 1, `outcomes: ${outcomes.join(",")}`);
      assert.ok(outcomes.every((outcome) => ["GOAL_SUCCEEDED", "ANOTHER_RUN_ACTIVE", "NONE_DUE"].includes(outcome)), `outcomes: ${outcomes.join(",")}`);
      assert.equal(fs.readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean).length, 1);
      const saved = f.stateStore.read().goalResearchJobs![0]!;
      assert.equal(saved.status, "SUCCEEDED");
      assert.equal(saved.attempt, 1);
      assert.equal(f.researchStore.list().filter((finding) => finding.occurrenceId === saved.occurrenceId).length, 1);
    });

    await scenario("review: jobs queued behind each other are never counted as missed; pacing defers only inside the policy window", async () => {
      const base = url.replace("/feed.atom", "");
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-goal-research-queue-"));
      const stores = tempStores(root);
      const stateStore = createAyasResearchSchedulerStateStore({ rootDir: stores.gateRoot });
      const goal = stores.goalStore.create({ userIntent: "Research local AI quality", scope: "AI providers", allowedDomains: ["src/lib/ai/"], successCriteria: ["source-backed evidence"] });
      const sources = Array.from({ length: 6 }, (_, index) => fixtureSource(`${base}/queue-${index}.atom`, `fixture-queue-${index}`, `Queue${index}`));
      for (const source of sources) {
        await scheduleAyasGoalResearch({ goalId: goal.goalId, sourceIds: [source.sourceId], scheduledFor: DUE, catchUpPolicy: "SKIP_AS_STALE" }, { gateRoot: stores.gateRoot, stateStore, goalStore: stores.goalStore, sources, now: () => T0 });
      }
      stateStore.write({ ...stateStore.read(), nextLightAt: FAR_FUTURE, nextDeepAt: FAR_FUTURE });
      let calls = 0;
      const provider: AIProvider = { async generate(): Promise<AIProviderOutput> { calls++; return JSON.stringify(NOTEWORTHY); } };
      const tickAt = (at: string) => tickAyasResearchScheduler({ repoRoot: root, gateRoot: stores.gateRoot, stateStore, goalStore: stores.goalStore, sourceStateStore: stores.sourceStateStore, sources, now: () => at,
        deep: { researchStore: stores.researchStore, provider, now: () => at, maxRetries: 0, dangerouslyAllowPrivateNetworkForTests: true } });
      for (let heartbeat = 0; heartbeat < 6; heartbeat++) {
        const at = new Date(Date.parse(DUE) + (1 + heartbeat * 5) * 60_000).toISOString();
        assert.equal((await tickAt(at)).outcome, "GOAL_SUCCEEDED", `heartbeat ${heartbeat}: a queued on-time job runs even ${1 + heartbeat * 5} minutes after its due time`);
      }
      const jobs = stateStore.read().goalResearchJobs!;
      assert.ok(jobs.every((job) => job.status === "SUCCEEDED" && job.missedAt === undefined), "queueing while AYAS is up is never downtime");
      assert.equal(calls, 6);
      fs.rmSync(root, { recursive: true, force: true });

      const f = fixture(url);
      await f.schedule("CATCH_UP_ONCE");
      const deps = { gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore, sources: [f.source], now: () => T0 };
      // The runner is due first (DUE); the two paced jobs are due a minute later, so the order is deterministic.
      const pacedAt = new Date(Date.parse(DUE) + 60_000).toISOString();
      const patient = await scheduleAyasGoalResearch({ goalId: f.goal.goalId, sourceIds: [f.source.sourceId], scheduledFor: pacedAt, catchUpPolicy: "CATCH_UP_ONCE" }, deps);
      const strict = await scheduleAyasGoalResearch({ goalId: f.goal.goalId, sourceIds: [f.source.sourceId], scheduledFor: pacedAt, catchUpPolicy: "REQUIRE_OWNER_CONFIRMATION" }, deps);
      const onTime = new Date(Date.parse(DUE) + 2 * 60_000).toISOString();
      assert.equal((await f.tick(onTime)).outcome, "GOAL_SUCCEEDED");
      const statusOf = (jobId: string) => f.stateStore.read().goalResearchJobs!.find((job) => job.jobId === jobId)!;
      const outcomes = [(await f.tick(onTime)).outcome, (await f.tick(onTime)).outcome].sort();
      assert.deepEqual(outcomes, ["GOAL_DEFERRED", "GOAL_WAITING"]);
      assert.ok(statusOf(patient.jobId).nextAttemptAt, "a 24-hour catch-up window tolerates source pacing");
      assert.equal(statusOf(strict.jobId).errorCode, "PACING_REQUIRES_OWNER", "an on-time-only job that cannot run on time asks the owner");
      assert.equal(f.providerCalls(), 1);
    });

    await scenario("review: a downtime backlog is coalesced per goal among runnable jobs; skip policy still skips; confirmation clears the old reason", async () => {
      const f = fixture(url);
      const base = url.replace("/feed.atom", "");
      const sourceB = fixtureSource(`${base}/goal-b.atom`, "fixture-b", "GoalB");
      const gone = fixtureSource(`${base}/gone.atom`, "fixture-gone", "Gone");
      const scheduleWith = (goalId: string, sourceIds: string[], scheduledFor: string, catchUpPolicy: "CATCH_UP_ONCE" | "SKIP_AS_STALE") =>
        scheduleAyasGoalResearch({ goalId, sourceIds, scheduledFor, catchUpPolicy, maxLatenessMs: catchUpPolicy === "CATCH_UP_ONCE" ? 2 * 60 * 60_000 : 0 }, { gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore, sources: [f.source, sourceB, gone], now: () => T0 });
      const at = (minutes: number) => new Date(Date.parse(DUE) + minutes * 60_000).toISOString();
      const goalB = f.goalStore.create({ userIntent: "Track official model releases", scope: "AI providers", allowedDomains: ["src/lib/ai/"], successCriteria: ["source-backed evidence"] });
      const a1 = await scheduleWith(f.goal.goalId, [f.source.sourceId], DUE, "CATCH_UP_ONCE");
      const a2 = await scheduleWith(f.goal.goalId, [f.source.sourceId], at(30), "CATCH_UP_ONCE");
      const a3 = await scheduleWith(f.goal.goalId, ["fixture-gone"], at(40), "CATCH_UP_ONCE");
      const skip = await scheduleWith(f.goal.goalId, [f.source.sourceId], DUE, "SKIP_AS_STALE");
      const b1 = await scheduleWith(goalB.goalId, [sourceB.sourceId], at(10), "CATCH_UP_ONCE");
      f.stateStore.write({ ...f.stateStore.read(), nextLightAt: FAR_FUTURE, nextDeepAt: FAR_FUTURE });
      const statusOf = (jobId: string) => f.stateStore.read().goalResearchJobs!.find((job) => job.jobId === jobId)!;
      const tickAt = (when: string) => tickAyasResearchScheduler({ repoRoot: f.repoRoot, gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore, sourceStateStore: f.sourceStateStore, sources: [f.source, sourceB], now: () => when,
        deep: { researchStore: f.researchStore, provider: { async generate(): Promise<AIProviderOutput> { return JSON.stringify(NOTEWORTHY); } }, now: () => when, maxRetries: 0, dangerouslyAllowPrivateNetworkForTests: true } });
      assert.equal((await tickAt(T2)).outcome, "GOAL_WAITING");
      assert.equal(statusOf(a1.jobId).errorCode, "MULTIPLE_MISSED_REQUIRES_OWNER", "the older runnable catch-up of goal A waits for the owner");
      assert.equal(statusOf(a2.jobId).status, "SCHEDULED", "the latest runnable catch-up of goal A stays eligible");
      assert.equal(statusOf(a3.jobId).status, "SCHEDULED", "an unrunnable job is not chosen as the goal's catch-up");
      assert.equal(statusOf(b1.jobId).status, "SCHEDULED", "another goal's catch-up is never parked behind goal A");
      assert.equal(statusOf(skip.jobId).status, "SCHEDULED", "a skip-policy job is not part of the backlog");
      const seen: string[] = [];
      for (let index = 0; index < 4; index++) seen.push((await tickAt(T2)).outcome);
      assert.deepEqual(seen, ["GOAL_SKIPPED", "GOAL_SUCCEEDED", "GOAL_SUCCEEDED", "GOAL_SKIPPED"]);
      assert.equal(statusOf(skip.jobId).errorCode, "MISSED_STALE");
      assert.equal(statusOf(b1.jobId).status, "SUCCEEDED");
      assert.equal(statusOf(a2.jobId).status, "SUCCEEDED");
      assert.equal(statusOf(a3.jobId).errorCode, "SOURCE_REGISTRY_CHANGED");
      await controlAyasGoalResearchJob(a1.jobId, "CONFIRM", { gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore, now: () => T2 });
      assert.equal(statusOf(a1.jobId).errorCode, undefined, "a confirmation drops the old parking reason");
      assert.equal((await tickAt(T2)).outcome, "GOAL_DEFERRED", "source pacing still applies after confirmation");
      const resume = new Date(Date.parse(statusOf(a1.jobId).nextAttemptAt!) + 60_000).toISOString();
      assert.equal((await tickAt(resume)).outcome, "GOAL_SUCCEEDED", "a confirmed job is never parked again");
      assert.equal(statusOf(a1.jobId).errorCode, "EVIDENCE_ALREADY_RECORDED", "the one fixture entry was recorded by the goal's other run");
    });

    await scenario("review: creating a research goal leaves nothing active behind on a busy lock, a rejected request or a failed job write", async () => {
      const f = fixture(url);
      const deps = { gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore, sources: [f.source], now: () => T0 };
      const request = { userIntent: "Track local model releases", sourceIds: [f.source.sourceId], scheduledFor: DUE, catchUpPolicy: "CATCH_UP_ONCE" as const, maxLatenessMs: 60_000 };
      const mine = () => f.goalStore.list().filter((goal) => goal.userIntent === request.userIntent);
      await withAyasExecutionAuthorityLock(f.gateRoot, async () => {
        await assert.rejects(createAndScheduleAyasGoalResearch(request, deps));
      });
      assert.equal(mine().length, 0, "a busy research lock creates no goal");
      await assert.rejects(createAndScheduleAyasGoalResearch({ ...request, sourceIds: ["not-registered"] }, deps), /not registered/);
      await assert.rejects(createAndScheduleAyasGoalResearch({ ...request, userIntent: "hi" }, deps), /invalid research goal/);
      assert.equal(mine().length, 0, "a rejected request creates no goal");
      const failingStore: AyasResearchSchedulerStateStore = { file: f.stateStore.file, read: () => f.stateStore.read(), write: () => { throw new Error("job write failure"); } };
      await assert.rejects(createAndScheduleAyasGoalResearch(request, { ...deps, stateStore: failingStore }), /job write failure/);
      assert.deepEqual(mine().map((goal) => goal.status), ["CANCELLED"], "a goal whose job could not be written is cancelled, not left active");
      const { goal, job } = await createAndScheduleAyasGoalResearch(request, deps);
      assert.equal(job.status, "SCHEDULED");
      assert.equal(job.goalId, goal.goalId);
      assert.equal(f.stateStore.read().goalResearchJobs!.filter((item) => item.goalId === goal.goalId).length, 1);
    });

    await scenario("review: at capacity the oldest finished jobs without findings are pruned; findings and uncertain outcomes are kept", async () => {
      const f = fixture(url);
      const seed = await f.schedule("CATCH_UP_ONCE");
      const build = (index: number, kind: "cancelled" | "with-findings" | "uncertain", daysAgo = 3): AyasGoalResearchJob => {
        const jobId = `ayas-goal-research-${crypto.randomUUID()}`;
        const scheduledFor = new Date(Date.parse(T0) - daysAgo * 24 * 60 * 60_000 - (200 - index) * 60_000).toISOString();
        const base = { ...seed, jobId, scheduledFor, occurrenceId: crypto.createHash("sha256").update(`ayas-goal-research:${jobId}:${scheduledFor}`).digest("hex") };
        if (kind === "cancelled") return { ...base, status: "CANCELLED", attempt: 0, completedAt: scheduledFor };
        const run = { attempt: 1 as const, runId: crypto.randomUUID(), startedAt: scheduledFor };
        return kind === "uncertain" ? { ...base, ...run, status: "UNCERTAIN" } : { ...base, ...run, status: "SUCCEEDED", executedAt: scheduledFor, completedAt: scheduledFor, findingsRecorded: 1 };
      };
      const prunable = Array.from({ length: 98 }, (_, index) => build(index, "cancelled"));
      const kept = [build(150, "with-findings"), build(151, "uncertain")];
      f.stateStore.write({ ...f.stateStore.read(), goalResearchJobs: [...prunable, ...kept] });
      const deps = { gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore, sources: [f.source], now: () => T0 };
      const added = await scheduleAyasGoalResearch({ goalId: f.goal.goalId, sourceIds: [f.source.sourceId], scheduledFor: DUE, catchUpPolicy: "CATCH_UP_ONCE", maxLatenessMs: 60_000 }, deps);
      const jobs = f.stateStore.read().goalResearchJobs!;
      assert.equal(jobs.length, 100);
      assert.ok(jobs.some((job) => job.jobId === added.jobId));
      assert.ok(!jobs.some((job) => job.jobId === prunable[0]!.jobId), "the oldest finished job without findings is pruned");
      assert.ok(kept.every((keep) => jobs.some((job) => job.jobId === keep.jobId)), "findings and uncertain outcomes survive pruning");
      const withFindings = Array.from({ length: 100 }, (_, index) => build(index, "with-findings"));
      f.stateStore.write({ ...f.stateStore.read(), goalResearchJobs: withFindings });
      await scheduleAyasGoalResearch({ goalId: f.goal.goalId, sourceIds: [f.source.sourceId], scheduledFor: DUE, catchUpPolicy: "CATCH_UP_ONCE", maxLatenessMs: 60_000 }, deps);
      assert.ok(!f.stateStore.read().goalResearchJobs!.some((job) => job.jobId === withFindings[0]!.jobId), "with no empty history left, the oldest finished job goes next");
      f.stateStore.write({ ...f.stateStore.read(), goalResearchJobs: Array.from({ length: 100 }, (_, index) => build(index, "uncertain")) });
      await assert.rejects(scheduleAyasGoalResearch({ goalId: f.goal.goalId, sourceIds: [f.source.sourceId], scheduledFor: DUE, catchUpPolicy: "CATCH_UP_ONCE", maxLatenessMs: 60_000 }, deps), /capacity reached/, "recent uncertain outcomes await owner review and are never dropped");
      f.stateStore.write({ ...f.stateStore.read(), goalResearchJobs: Array.from({ length: 100 }, (_, index) => build(index, "with-findings", 0)) });
      await assert.rejects(scheduleAyasGoalResearch({ goalId: f.goal.goalId, sourceIds: [f.source.sourceId], scheduledFor: DUE, catchUpPolicy: "CATCH_UP_ONCE", maxLatenessMs: 60_000 }, deps), /capacity reached/, "jobs started within a day are source-pacing evidence and are never dropped");
    });

    await scenario("review: evidence another run already recorded is reported as such; invalid model output is a failed analysis", async () => {
      const f = fixture(url);
      await f.schedule("CATCH_UP_ONCE");
      assert.equal((await f.tick(DUE)).outcome, "GOAL_SUCCEEDED");
      const other = f.goalStore.create({ userIntent: "Track local inference releases", scope: "AI providers", allowedDomains: ["src/lib/ai/"], successCriteria: ["source-backed evidence"] });
      const second = await scheduleAyasGoalResearch({ goalId: other.goalId, sourceIds: [f.source.sourceId], scheduledFor: T3, catchUpPolicy: "CATCH_UP_ONCE", maxLatenessMs: 2 * 60 * 60_000 }, { gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore, sources: [f.source], now: () => DUE });
      assert.equal((await f.tick(T3)).outcome, "GOAL_SUCCEEDED");
      const known = f.stateStore.read().goalResearchJobs!.find((job) => job.jobId === second.jobId)!;
      assert.equal(known.errorCode, "EVIDENCE_ALREADY_RECORDED");
      assert.equal(known.findingsRecorded, 0);
      assert.equal(f.providerCalls(), 1, "an already-recorded entry costs no second model call");

      const g = fixture(url);
      await g.schedule("CATCH_UP_ONCE");
      const down = fixture(url);
      await down.schedule("CATCH_UP_ONCE");
      const offline: AIProvider = { async generate(): Promise<AIProviderOutput> { throw new Error("local model offline"); } };
      assert.equal((await down.tick(DUE, { provider: offline })).outcome, "GOAL_FAILED");
      assert.equal(down.stateStore.read().goalResearchJobs![0]!.errorCode, "RESEARCH_ANALYSIS_FAILED", "the source was read; the local model failed");

      const garbage: AIProvider = { async generate(): Promise<AIProviderOutput> { return "not json"; } };
      assert.equal((await g.tick(DUE, { provider: garbage })).outcome, "GOAL_FAILED");
      const bad = g.stateStore.read().goalResearchJobs![0]!;
      assert.equal(bad.errorCode, "RESEARCH_ANALYSIS_FAILED");
      assert.equal(bad.findingsRecorded, 0);
      assert.equal(g.researchStore.list().length, 0);
    });

    await scenario("review: a schema-valid source record with an unreadable check time defers instead of disabling pacing", async () => {
      const f = fixture(url);
      await f.schedule("CATCH_UP_ONCE");
      const dir = path.join(f.repoRoot, "data", "brain", "self-improvement", "research-sources");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${f.source.sourceId}.json`), JSON.stringify({ schemaVersion: ayasResearchSourceStateSchemaVersion, sourceId: f.source.sourceId, lastCheckedAt: "not-a-time", status: "OK", consecutiveFailures: 0 }));
      let outcome: string;
      try { outcome = (await f.tick(DUE)).outcome; } catch { outcome = "FAILED_CLOSED"; }
      assert.ok(outcome === "GOAL_DEFERRED" || outcome === "FAILED_CLOSED", outcome);
      assert.equal(f.providerCalls(), 0);
      assert.equal(f.stateStore.read().goalResearchJobs![0]!.attempt, 0);
    });

    await scenario("review: a far-future or maximal source check time never defers for days and never throws; the policy decides", async () => {
      for (const lastCheckedAt of [new Date(Date.parse(DUE) + 3 * 24 * 60 * 60_000).toISOString(), "9999-12-31T00:00:00.000Z"]) {
        const f = fixture(url);
        await f.schedule("CATCH_UP_ONCE");
        const dir = path.join(f.repoRoot, "data", "brain", "self-improvement", "research-sources");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${f.source.sourceId}.json`), JSON.stringify({ schemaVersion: ayasResearchSourceStateSchemaVersion, sourceId: f.source.sourceId, lastCheckedAt, status: "OK", consecutiveFailures: 0 }));
        assert.equal((await f.tick(DUE)).outcome, "GOAL_SKIPPED");
        const job = f.stateStore.read().goalResearchJobs![0]!;
        assert.equal(job.errorCode, "PACING_WINDOW_EXCEEDED");
        assert.equal(job.nextAttemptAt, undefined);
        assert.equal(f.providerCalls(), 0);
      }
    });

    await scenario("review: a fault before the reservation ends that job visibly and never stalls the regular cadence", async () => {
      const f = fixture(url);
      await f.schedule("CATCH_UP_ONCE");
      const brokenSourceState = { ...f.sourceStateStore, read: () => { throw new Error("source state unreadable"); } };
      const tickWith = (at: string) => tickAyasResearchScheduler({ repoRoot: f.repoRoot, gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore, sourceStateStore: brokenSourceState, sources: [f.source], now: () => at,
        light: { stateStore: f.sourceStateStore, now: () => at, maxRetries: 0, dangerouslyAllowPrivateNetworkForTests: true },
        deep: { researchStore: f.researchStore, now: () => at, maxRetries: 0, dangerouslyAllowPrivateNetworkForTests: true } });
      assert.equal((await tickWith(DUE)).outcome, "GOAL_SKIPPED");
      const job = f.stateStore.read().goalResearchJobs![0]!;
      assert.equal(job.errorCode, "GOAL_TICK_FAILED");
      assert.equal(job.attempt, 0);
      assert.equal(f.providerCalls(), 0);
      f.stateStore.write({ ...f.stateStore.read(), nextLightAt: DUE, nextDeepAt: FAR_FUTURE });
      assert.equal((await tickWith(DUE)).outcome, "LIGHT", "the cadence runs on the next heartbeat");
    });

    await scenario("review: a job deferred on time and then left through days of downtime is missed on restart; its policy applies, it never runs late silently", async () => {
      for (const policy of ["CATCH_UP_ONCE", "REQUIRE_OWNER_CONFIRMATION"] as const) {
        const f = fixture(url);
        await scheduleAyasGoalResearch({ goalId: f.goal.goalId, sourceIds: [f.source.sourceId], scheduledFor: DUE, catchUpPolicy: policy, maxLatenessMs: policy === "CATCH_UP_ONCE" ? 60 * 60_000 : 0 },
          { gateRoot: f.gateRoot, stateStore: f.stateStore, goalStore: f.goalStore, sources: [f.source], now: () => T0 });
        f.stateStore.write({ ...f.stateStore.read(), nextLightAt: FAR_FUTURE, nextDeepAt: FAR_FUTURE });
        const dir = path.join(f.repoRoot, "data", "brain", "self-improvement", "research-sources");
        fs.mkdirSync(dir, { recursive: true });
        // Source last read 1h50m before the plan: pacing (2h) allows it 10 minutes after the due time.
        fs.writeFileSync(path.join(dir, `${f.source.sourceId}.json`), JSON.stringify({ schemaVersion: ayasResearchSourceStateSchemaVersion, sourceId: f.source.sourceId, lastCheckedAt: new Date(Date.parse(DUE) - 110 * 60_000).toISOString(), status: "OK", consecutiveFailures: 0 }));
        assert.equal((await f.tick(new Date(Date.parse(DUE) + 60_000).toISOString())).outcome, "GOAL_DEFERRED", `${policy}: on time, paced`);
        const threeDaysLater = new Date(Date.parse(DUE) + 3 * 24 * 60 * 60_000).toISOString();
        assert.equal((await f.tick(threeDaysLater)).outcome, policy === "CATCH_UP_ONCE" ? "GOAL_SKIPPED" : "GOAL_WAITING");
        const job = f.stateStore.read().goalResearchJobs![0]!;
        assert.equal(job.errorCode, policy === "CATCH_UP_ONCE" ? "MISSED_STALE" : "MISSED_REQUIRES_OWNER");
        assert.equal(job.missedAt, threeDaysLater);
        assert.equal(f.providerCalls(), 0);
      }
    });

    await scenario("review: a job that comes due while another run holds the research lock is not missed; heartbeats keep AYAS live", async () => {
      const f = fixture(url);
      await f.schedule("SKIP_AS_STALE", 0);
      assert.equal((await f.tick(new Date(Date.parse(DUE) - 2 * 60_000).toISOString())).outcome, "NONE_DUE");
      await withAyasExecutionAuthorityLock(f.gateRoot, async () => {
        for (let minute = 3; minute <= 33; minute += 5) {
          assert.equal((await f.tick(new Date(Date.parse(DUE) + minute * 60_000).toISOString())).outcome, "ANOTHER_RUN_ACTIVE");
        }
      });
      const afterLongRun = new Date(Date.parse(DUE) + 38 * 60_000).toISOString();
      assert.equal((await f.tick(afterLongRun)).outcome, "GOAL_SUCCEEDED", "38 minutes late, but AYAS was up the whole time");
      assert.equal(f.stateStore.read().goalResearchJobs![0]!.missedAt, undefined);
      assert.equal(f.providerCalls(), 1);
    });

    await scenario("review: the liveness record starts a new streak on a gap, a clock that went backwards or an unreadable record", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-goal-research-heartbeat-"));
      const heartbeat = createAyasResearchSchedulerHeartbeatStore({ rootDir: root });
      const grace = AYAS_GOAL_RESEARCH_ON_TIME_GRACE_MS;
      const minutes = (value: number) => new Date(Date.parse(DUE) + value * 60_000).toISOString();
      assert.equal(heartbeat.beat(minutes(0), grace).liveSince, new Date(Date.parse(DUE) - grace).toISOString(), "first beat: only the grace is assumed");
      assert.equal(heartbeat.beat(minutes(5), grace).liveSince, new Date(Date.parse(DUE) - grace).toISOString(), "a normal heartbeat keeps the streak");
      assert.equal(heartbeat.beat(minutes(60), grace).liveSince, minutes(60), "a gap longer than the grace starts a new streak");
      assert.equal(heartbeat.beat(minutes(30), grace).liveSince, minutes(30), "a clock that went backwards starts a new streak");
      fs.writeFileSync(heartbeat.file, "{ not json");
      assert.throws(() => heartbeat.read(), AyasResearchSchedulerStateError);
      assert.equal(heartbeat.beat(minutes(35), grace).liveSince, minutes(35), "an unreadable record is treated as downtime");
      fs.rmSync(root, { recursive: true, force: true });
    });

    await scenario("100 future jobs reconcile in one bounded no-op tick with zero provider calls", async () => {
      const f = fixture(url);
      const seed = await f.schedule("CATCH_UP_ONCE");
      const jobs: AyasGoalResearchJob[] = Array.from({ length: 100 }, (_, index) => {
        const jobId = `ayas-goal-research-${crypto.randomUUID()}`;
        const scheduledFor = new Date(Date.parse(FAR_FUTURE) + index * 60_000).toISOString();
        return { ...seed, jobId, scheduledFor, occurrenceId: crypto.createHash("sha256").update(`ayas-goal-research:${jobId}:${scheduledFor}`).digest("hex") };
      });
      f.stateStore.write({ ...f.stateStore.read(), goalResearchJobs: jobs });
      const start = performance.now();
      assert.equal((await f.tick(T0)).outcome, "NONE_DUE");
      console.log(JSON.stringify({ benchmark: "goal-research-100-future-jobs", durationMs: Math.round((performance.now() - start) * 100) / 100 }));
      assert.equal(f.providerCalls(), 0);
    });
  });
  console.log(`AYAS goal research schedule smoke: PASS (${count} scenarios)`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
