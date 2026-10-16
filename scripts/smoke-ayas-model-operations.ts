import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { issueSession, resolveAccessGate } from "../src/lib/auth/accessGate";
import { summarizeAyasChatBenchmark, type AyasChatBenchmarkCategory, type AyasChatModelBenchmarkResult, type AyasChatModelCaseResult } from "../src/lib/ayas/model/AyasChatModelBenchmark";
import {
  AYAS_MODEL_SWITCH_MAX_ATTEMPTS, AYAS_MODEL_TRIAL_MAX_ERRORS, buildAyasModelOperationsView, createAyasModelOperationStore, decideAyasModelSwitch, decideAyasModelTrial,
  isAyasModelTrialDecisionAdmitted, selectAyasModelJob, type AyasModelSwitchRecord,
} from "../src/lib/brain/autonomy/AyasModelOperationStore";
import {
  ayasModelSwitchProbeCases, createAyasLiveRestarter, effectiveAyasChatModel, reconcileAyasModelSwitchOrphan, runAyasModelSwitch, setAyasChatModelLine, type AyasLiveRestartOutcome,
} from "../src/lib/brain/autonomy/AyasModelSwitchRunner";
import { runAyasModelTrial } from "../src/lib/brain/autonomy/AyasModelTrialRunner";
import { AYAS_CHAT_MODEL_BENCHMARK_ID, ayasModelSwitchHash, buildAyasModelWatchView, createAyasModelWatchStore, type AyasModelWatchState } from "../src/lib/brain/autonomy/AyasModelWatch";
import { AYAS_CANONICAL_SYNC_MARKER, createAyasUpdateTrialStore } from "../src/lib/brain/autonomy/AyasUpdateTrialStore";
import {
  admitAyasOwnerApproval, checkAyasOwnerAdmissionBinding, type AyasOwnerAdmissionAction, type AyasOwnerAdmissionSubject,
} from "../src/lib/brain/autonomy/AyasOwnerApprovalAdmission";

/**
 * Owner model operations (owner decisions 2026-10-15 item 4, design approved 2026-10-16): "İndir ve ölç" and "Bu
 * modele geç" are sealed owner decisions bound to the registry digest and to both measurements; the executor's runners
 * download in bounded slices, verify the digest, measure, and switch AYAS_OLLAMA_MODEL with a live restart, a chat
 * check and a byte-exact rollback. Everything runs in TEMP with a fake loopback Ollama, a fake registry, a fake
 * restart and a fake benchmark: no network, model, live application or real .env.local.
 */
const originalKey = process.env.AYAS_ACCESS_KEY;
const KEY = "model-operations-smoke-key-long-enough";
process.env.AYAS_ACCESS_KEY = KEY;
const gate = resolveAccessGate({ AYAS_ACCESS_KEY: KEY, NODE_ENV: "production" });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-model-operations-"));
let count = 0;
const scenario = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  try { await fn(); } catch (error) { console.error(`FAIL: ${name}`); throw error; }
  count += 1;
};
const admit = (action: AyasOwnerAdmissionAction) => async (subject: AyasOwnerAdmissionSubject) => admitAyasOwnerApproval({ gate, token: await issueSession(KEY), action, subject });
const noHold = () => undefined;
const rejects = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => (error as { code?: string }).code === code);
const sha = (text: string) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

const INCUMBENT = "gemma3:12b";
const CANDIDATE = "gemma4:12b";
const D_INCUMBENT = "a".repeat(64);
const MANIFEST = JSON.stringify({ schemaVersion: 2, layers: [{ size: 7_400_000_000 }, { size: 600_000_000 }] });
const D_CANDIDATE = sha(MANIFEST);
const BASE = "http://127.0.0.1:11434";

const COUNTS: Readonly<Record<AyasChatBenchmarkCategory, number>> = { KNOWLEDGE: 6, ARITHMETIC: 4, INSTRUCTION: 4, CONTEXT: 3, HONESTY: 4 };
/** A frozen-set result: `passed` cases, honesty ones first up to `honesty`, then knowledge, arithmetic, ... */
function fakeResult(model: string, digest: string, passed: number, options: { honesty?: number; measuredAt?: string; latencyMs?: number } = {}): AyasChatModelBenchmarkResult {
  const honesty = options.honesty ?? 4;
  let rest = passed - honesty;
  const cases: AyasChatModelCaseResult[] = [];
  for (const category of Object.keys(COUNTS) as AyasChatBenchmarkCategory[]) {
    for (let index = 0; index < COUNTS[category]; index += 1) {
      const pass = category === "HONESTY" ? index < honesty : rest-- > 0;
      cases.push({ id: `${category.toLowerCase()}-${index}`, category, pass, passes: pass ? 3 : 0, attempts: 3, ...(pass ? {} : { reason: "yanlış" }), latencyMs: options.latencyMs ?? 3000, answer: "" });
    }
  }
  return summarizeAyasChatBenchmark({ model, digest, measuredAt: options.measuredAt ?? "2026-10-16T08:00:00.000Z", repeats: 3, cases, attemptLatenciesMs: cases.map(() => options.latencyMs ?? 3000), spokenTurkishPassed: 63 });
}

let fixtureIndex = 0;
function fixture(options: { measured?: boolean; registryDigest?: string } = {}) {
  const base = path.join(temp, `f${fixtureIndex++}`);
  const store = createAyasModelOperationStore({ rootDir: path.join(base, "ops") });
  const watchStore = createAyasModelWatchStore({ rootDir: path.join(base, "watch") });
  const state: AyasModelWatchState = {
    schemaVersion: 1, updatedAt: "2026-10-16T08:00:00.000Z",
    installed: [{ name: INCUMBENT, digest: D_INCUMBENT, sizeBytes: 8_100_000_000 }, ...(options.measured ? [{ name: CANDIDATE, digest: D_CANDIDATE, sizeBytes: 8_000_000_000 }] : [])],
    registry: { [CANDIDATE]: { tag: CANDIDATE, digest: options.registryDigest ?? D_CANDIDATE, totalBytes: 8_000_000_000, checkedAt: "2026-10-15T09:17:00.000Z" } },
    results: { [INCUMBENT]: fakeResult(INCUMBENT, D_INCUMBENT, 18), ...(options.measured ? { [CANDIDATE]: fakeResult(CANDIDATE, D_CANDIDATE, 20) } : {}) },
  };
  watchStore.write(state);
  return { base, store, watchStore, deps: { store, watch: watchStore.read(), incumbentModel: INCUMBENT, safeModeHold: noHold } };
}

/** A fake loopback Ollama plus registry: installed models, a pull stream that can succeed, stall or error, and /api/ps. */
function fakeOllama(options: { pull?: "success" | "stall" | "error"; pulledDigest?: string; busy?: boolean; installed?: { name: string; digest: string; size: number }[]; manifest?: string } = {}) {
  const installed = [...(options.installed ?? [{ name: INCUMBENT, digest: D_INCUMBENT, size: 8_100_000_000 }])];
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url.replace(BASE, "").replace("https://registry.ollama.ai/v2/library", "registry")}`);
    if (url.startsWith("https://registry.ollama.ai/")) return new Response(options.manifest ?? MANIFEST);
    if (url.endsWith("/api/tags")) return Response.json({ models: installed.map((model) => ({ name: model.name, digest: model.digest, size: model.size })) });
    if (url.endsWith("/api/ps")) return Response.json({ models: options.busy ? [{ name: INCUMBENT }] : [] });
    if (url.endsWith("/api/pull")) {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: unknown) => controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
          send({ status: "pulling manifest" });
          send({ status: "pulling layer", digest: "sha256:l1", total: 7_400_000_000, completed: 3_700_000_000 });
          send({ status: "pulling layer", digest: "sha256:l2", total: 600_000_000, completed: 600_000_000 });
          if (options.pull === "error") { send({ error: "connection reset" }); controller.close(); return; }
          if (options.pull === "stall") { signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError"))); return; }
          installed.push({ name: CANDIDATE, digest: options.pulledDigest ?? D_CANDIDATE, size: 8_000_000_000 });
          send({ status: "success" }); controller.close();
        },
      });
      return new Response(body);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls, installed };
}

async function approveTrial(f: ReturnType<typeof fixture>) {
  return decideAyasModelTrial({ tag: CANDIDATE, registryDigest: D_CANDIDATE, decision: "APPROVE" }, { ...f.deps, admit: admit("decideAyasModelTrial") });
}

function switchFixture(options: { liveText?: string; repoText?: string } = {}) {
  const f = fixture({ measured: true });
  const repoRoot = path.join(f.base, "repo"); const liveRoot = path.join(f.base, "live");
  fs.mkdirSync(repoRoot, { recursive: true }); fs.mkdirSync(liveRoot, { recursive: true });
  const liveText = options.liveText ?? "AYAS_ACCESS_KEY=secret-one\r\nOLLAMA_MODEL=qwen2.5:3b\r\n# AYAS chat\r\nAYAS_OLLAMA_MODEL=gemma3:12b\r\nOTHER=1\r\n";
  const repoText = options.repoText ?? "OLLAMA_MODEL=qwen2.5:3b\nAYAS_OLLAMA_MODEL=gemma3:12b\n";
  fs.writeFileSync(path.join(liveRoot, ".env.local"), liveText); fs.writeFileSync(path.join(repoRoot, ".env.local"), repoText);
  const watch = f.watchStore.read()!;
  const switchHash = ayasModelSwitchHash({ candidate: watch.results[CANDIDATE]!, incumbentModel: INCUMBENT, incumbent: watch.results[INCUMBENT]! });
  const restarts: AyasLiveRestartOutcome["status"][] = [];
  const outcomes: AyasLiveRestartOutcome["status"][] = [];
  const probes: { model: string; caseIds: readonly string[] }[] = [];
  let probePasses = true;
  const deps = {
    repoRoot, liveRoot, store: f.store, watchStore: f.watchStore, incumbentModel: INCUMBENT,
    restartLive: async (): Promise<AyasLiveRestartOutcome> => { const status = outcomes.shift() ?? "RESTARTED"; restarts.push(status); return { status, summary: status }; },
    probe: async (model: string, caseIds: readonly string[]) => {
      probes.push({ model, caseIds });
      const result = fakeResult(model, D_CANDIDATE, 20);
      const cases = result.cases.filter((entry) => caseIds.includes(entry.id)).map((entry, index) => (probePasses || index > 0 ? entry : { ...entry, pass: false, reason: "yanlış" }));
      return { ...result, cases, total: cases.length, passed: cases.filter((entry) => entry.pass).length };
    },
  };
  const read = () => ({ live: fs.readFileSync(path.join(liveRoot, ".env.local"), "utf8"), repo: fs.readFileSync(path.join(repoRoot, ".env.local"), "utf8") });
  return { ...f, repoRoot, liveRoot, liveText, repoText, switchHash, restarts, outcomes, probes, deps, read, failProbe: () => { probePasses = false; } };
}

async function main(): Promise<void> {
  await scenario("model decisions are their own owner actions: neither authorizes the other, an update or a proposal", async () => {
    const trialSubject: AyasOwnerAdmissionSubject = { kind: "model-trial", tag: CANDIDATE, registryDigest: D_CANDIDATE, decision: "APPROVE" };
    const switchSubject: AyasOwnerAdmissionSubject = { kind: "model-switch", tag: CANDIDATE, switchHash: "b".repeat(64), decision: "SWITCH" };
    const at = new Date().toISOString();
    assert.equal(checkAyasOwnerAdmissionBinding(await admit("decideAyasModelTrial")(trialSubject), { subject: trialSubject, at, usedActionRefs: new Set() }).ok, true);
    assert.deepEqual(checkAyasOwnerAdmissionBinding(await admit("switchAyasModel")(trialSubject), { subject: trialSubject, at, usedActionRefs: new Set() }), { ok: false, reason: "INVALID_ACTION" });
    assert.deepEqual(checkAyasOwnerAdmissionBinding(await admit("applyAyasUpdate")(switchSubject), { subject: switchSubject, at, usedActionRefs: new Set() }), { ok: false, reason: "INVALID_ACTION" });
    const proposal: AyasOwnerAdmissionSubject = { kind: "proposal", proposalId: "p", proposalHash: "h", decision: "APPROVE" };
    for (const action of ["decideAyasModelTrial", "switchAyasModel"] as const) {
      assert.deepEqual(checkAyasOwnerAdmissionBinding(await admit(action)(proposal), { subject: proposal, at, usedActionRefs: new Set() }), { ok: false, reason: "INVALID_ACTION" });
    }
    await assert.rejects(admit("decideAyasModelTrial")({ kind: "model-trial", tag: "GEMMA 4", registryDigest: D_CANDIDATE, decision: "APPROVE" }), /OWNER_ADMISSION_INVALID_SUBJECT/);
  });

  await scenario("İndir ve ölç binds to the registry digest on the card, only for a watched model that is not the current one", async () => {
    const f = fixture();
    await rejects(decideAyasModelTrial({ tag: "llama3:8b", registryDigest: D_CANDIDATE, decision: "APPROVE" }, { ...f.deps, admit: admit("decideAyasModelTrial") }), "MODEL_OPERATION_NOT_A_CANDIDATE");
    await rejects(decideAyasModelTrial({ tag: CANDIDATE, registryDigest: "c".repeat(64), decision: "APPROVE" }, { ...f.deps, admit: admit("decideAyasModelTrial") }), "MODEL_TRIAL_REGISTRY_CHANGED");
    await rejects(decideAyasModelTrial({ tag: CANDIDATE, registryDigest: D_CANDIDATE, decision: "APPROVE" }, { ...f.deps, watch: undefined, admit: admit("decideAyasModelTrial") }), "MODEL_TRIAL_REGISTRY_UNKNOWN");
    await rejects(decideAyasModelTrial({ tag: CANDIDATE, registryDigest: D_CANDIDATE, decision: "APPROVE" }, { ...f.deps, incumbentModel: CANDIDATE, admit: admit("decideAyasModelTrial") }), "MODEL_OPERATION_NOT_A_CANDIDATE");
    await rejects(decideAyasModelTrial({ tag: CANDIDATE, registryDigest: D_CANDIDATE, decision: "APPROVE" }, { ...f.deps, safeModeHold: () => "AYAS_SAFE_READ_ONLY", admit: admit("decideAyasModelTrial") }), "AYAS_SAFE_READ_ONLY");
    const record = await approveTrial(f);
    assert.equal(record.totalBytes, 8_000_000_000); assert.equal(isAyasModelTrialDecisionAdmitted(record), true);
    assert.equal(isAyasModelTrialDecisionAdmitted({ ...record, registryDigest: "d".repeat(64) }), false, "an edited digest is never trusted");
    await rejects(approveTrial(f), "MODEL_TRIAL_ALREADY_APPROVED");
    const job = selectAyasModelJob({ decisions: f.store.loadDecisions(), jobs: f.store.loadJobs() });
    assert.equal(job.kind, "TRIAL");
    await decideAyasModelTrial({ tag: CANDIDATE, registryDigest: D_CANDIDATE, decision: "WITHDRAW" }, { ...f.deps, admit: admit("decideAyasModelTrial") });
    assert.equal(selectAyasModelJob({ decisions: f.store.loadDecisions(), jobs: f.store.loadJobs() }).kind, "NONE", "a withdrawal stops it");
    await rejects(decideAyasModelTrial({ tag: CANDIDATE, registryDigest: D_CANDIDATE, decision: "WITHDRAW" }, { ...f.deps, admit: admit("decideAyasModelTrial") }), "MODEL_TRIAL_NOT_APPROVED");
  });

  await scenario("a changed registry manifest fails the trial before any byte is downloaded and shows the new digest", async () => {
    const f = fixture();
    const decision = await approveTrial(f);
    const ollama = fakeOllama({ pull: "success", manifest: JSON.stringify({ schemaVersion: 2, layers: [{ size: 1 }] }) });
    const done = await runAyasModelTrial(decision, undefined, { store: f.store, watchStore: f.watchStore, baseUrl: BASE, incumbentModel: INCUMBENT, fetcher: ollama.fetcher, measure: async () => { throw new Error("must not measure"); } });
    assert.equal(done.status, "FAILED"); assert.match(done.failureReason!, /farklı/);
    assert.ok(!ollama.calls.some((call) => call.includes("/api/pull")), "nothing pulled");
    assert.notEqual(f.watchStore.read()!.registry[CANDIDATE]!.digest, D_CANDIDATE, "the card shows the new digest");
    assert.equal(selectAyasModelJob({ decisions: f.store.loadDecisions(), jobs: f.store.loadJobs() }).kind, "NONE");
  });

  await scenario("not enough room or a non-loopback Ollama: nothing is downloaded", async () => {
    const f = fixture();
    const decision = await approveTrial(f);
    const ollama = fakeOllama({ pull: "success" });
    const low = await runAyasModelTrial(decision, undefined, { store: f.store, baseUrl: BASE, incumbentModel: INCUMBENT, fetcher: ollama.fetcher, freeBytes: () => 9e9, measure: async () => { throw new Error("no"); } });
    assert.equal(low.status, "FAILED"); assert.match(low.failureReason!, /yer yetersiz/);
    const g = fixture();
    const remote = fakeOllama();
    const refused = await runAyasModelTrial(await approveTrial(g), undefined, { store: g.store, baseUrl: "http://192.168.1.5:11434", incumbentModel: INCUMBENT, fetcher: remote.fetcher, measure: async () => { throw new Error("no"); } });
    assert.equal(refused.status, "FAILED"); assert.deepEqual(remote.calls, []);
    assert.ok(!ollama.calls.some((call) => call.includes("/api/pull")));
  });

  await scenario("the download runs in bounded slices and continues; the pulled digest is checked; both models are measured", async () => {
    const f = fixture();
    const decision = await approveTrial(f);
    const stalled = fakeOllama({ pull: "stall" });
    const measured: string[] = [];
    const base = { store: f.store, watchStore: f.watchStore, baseUrl: BASE, incumbentModel: INCUMBENT, freeBytes: () => 500e9, sliceMs: 50,
      measure: async (model: string) => { measured.push(model); return model === CANDIDATE ? fakeResult(CANDIDATE, D_CANDIDATE, 20) : fakeResult(INCUMBENT, D_INCUMBENT, 18, { measuredAt: "2026-10-16T09:00:00.000Z" }); } };
    const first = await runAyasModelTrial(decision, undefined, { ...base, fetcher: stalled.fetcher });
    assert.equal(first.status, "PULLING"); assert.equal(first.slices, 1); assert.equal(first.completedBytes, 4_300_000_000); assert.equal(first.totalBytes, 8_000_000_000);
    assert.equal(first.consecutiveErrors, 0); assert.equal(stalled.calls.filter((call) => call.startsWith("GET registry")).length, 1);
    const job = selectAyasModelJob({ decisions: f.store.loadDecisions(), jobs: f.store.loadJobs() });
    assert.ok(job.kind === "TRIAL" && job.trial?.trialId === first.trialId, "the next run continues the same trial");
    // The incumbent's stored result is for other bytes: it is measured again so the comparison is fair.
    const state = f.watchStore.read()!;
    f.watchStore.write({ ...state, installed: [{ name: INCUMBENT, digest: D_INCUMBENT, sizeBytes: 1 }], results: { [INCUMBENT]: fakeResult(INCUMBENT, "e".repeat(64), 18) } });
    const finishing = fakeOllama({ pull: "success" });
    const done = await runAyasModelTrial(decision, first, { ...base, fetcher: finishing.fetcher });
    assert.ok(!finishing.calls.some((call) => call.startsWith("GET registry")), "the registry is read once, before the first byte");
    assert.equal(done.status, "MEASURED"); assert.equal(done.installedDigest, D_CANDIDATE); assert.equal(done.slices, 2);
    assert.deepEqual(measured, [INCUMBENT, CANDIDATE]);
    assert.deepEqual(done.measured, { passed: 20, total: 21, incumbentModel: INCUMBENT, verdict: "BETTER" });
    assert.equal(done.lastError, undefined);
    const view = buildAyasModelWatchView({ state: f.watchStore.read(), incumbentModel: INCUMBENT });
    const candidate = view.measured.find((entry) => entry.model === CANDIDATE)!;
    assert.equal(candidate.verdict, "BETTER"); assert.match(candidate.switchHash!, /^[0-9a-f]{64}$/);
    assert.equal(view.measured.find((entry) => entry.isIncumbent)!.switchHash, undefined);
    assert.equal(selectAyasModelJob({ decisions: f.store.loadDecisions(), jobs: f.store.loadJobs() }).kind, "NONE", "a measured trial is final");
    const operations = buildAyasModelOperationsView({ decisions: f.store.loadDecisions(), jobs: f.store.loadJobs() });
    assert.equal(operations.trialApprovals.length, 1); assert.equal(operations.trials[0]!.status, "MEASURED");
  });

  await scenario("pulled bytes that differ from the approved digest are never measured; a busy Ollama postpones the measurement", async () => {
    const f = fixture();
    const decision = await approveTrial(f);
    const wrong = fakeOllama({ pull: "success", pulledDigest: "f".repeat(64) });
    const done = await runAyasModelTrial(decision, undefined, { store: f.store, watchStore: f.watchStore, baseUrl: BASE, incumbentModel: INCUMBENT, fetcher: wrong.fetcher, measure: async () => { throw new Error("must not measure"); } });
    assert.equal(done.status, "FAILED"); assert.match(done.failureReason!, /eşleşmiyor/);
    const g = fixture();
    const decisionG = await approveTrial(g);
    const busy = fakeOllama({ busy: true, installed: [{ name: INCUMBENT, digest: D_INCUMBENT, size: 1 }, { name: CANDIDATE, digest: D_CANDIDATE, size: 1 }] });
    const waiting = await runAyasModelTrial(decisionG, undefined, { store: g.store, watchStore: g.watchStore, baseUrl: BASE, incumbentModel: INCUMBENT, fetcher: busy.fetcher, measure: async () => { throw new Error("must not measure"); } });
    assert.equal(waiting.status, "MEASURING"); assert.match(waiting.lastError!, /başka bir modeli/);
    assert.ok(!busy.calls.some((call) => call.includes("/api/pull")), "already installed with the approved digest: not pulled again");
  });

  await scenario("repeated download errors fail the trial after a bounded number of runs", async () => {
    const f = fixture();
    const decision = await approveTrial(f);
    const failing = fakeOllama({ pull: "error" });
    let trial = await runAyasModelTrial(decision, undefined, { store: f.store, baseUrl: BASE, incumbentModel: INCUMBENT, fetcher: failing.fetcher, measure: async () => { throw new Error("no"); } });
    assert.equal(trial.status, "PULLING"); assert.equal(trial.consecutiveErrors, 1); assert.match(trial.lastError!, /connection reset/);
    for (let run = 1; run < AYAS_MODEL_TRIAL_MAX_ERRORS; run += 1) trial = await runAyasModelTrial(decision, trial, { store: f.store, baseUrl: BASE, incumbentModel: INCUMBENT, fetcher: failing.fetcher, measure: async () => { throw new Error("no"); } });
    assert.equal(trial.status, "FAILED"); assert.match(trial.failureReason!, /üst üste/);
  });

  await scenario("Bu modele geç is recorded only for a better measured model, bound to both measurements, once", async () => {
    const f = fixture({ measured: true });
    const watch = f.watchStore.read()!;
    const switchHash = ayasModelSwitchHash({ candidate: watch.results[CANDIDATE]!, incumbentModel: INCUMBENT, incumbent: watch.results[INCUMBENT]! });
    const deps = { ...f.deps, admit: admit("switchAyasModel") };
    await rejects(decideAyasModelSwitch({ tag: CANDIDATE, switchHash: "0".repeat(64) }, deps), "MODEL_SWITCH_CHANGED");
    const similar = { ...watch, results: { ...watch.results, [CANDIDATE]: fakeResult(CANDIDATE, D_CANDIDATE, 19) } };
    await rejects(decideAyasModelSwitch({ tag: CANDIDATE, switchHash }, { ...deps, watch: similar }), "MODEL_SWITCH_NOT_BETTER");
    const record = await decideAyasModelSwitch({ tag: CANDIDATE, switchHash }, deps);
    assert.equal(record.fromModel, INCUMBENT);
    await rejects(decideAyasModelSwitch({ tag: CANDIDATE, switchHash }, deps), "MODEL_SWITCH_ALREADY_DECIDED");
    const job = selectAyasModelJob({ decisions: f.store.loadDecisions(), jobs: f.store.loadJobs() });
    assert.ok(job.kind === "SWITCH" && job.decision.decisionId === record.decisionId, "the switch goes first");
    const g = fixture({ measured: true });
    g.store.upsertSwitch({ schemaVersion: 1, switchId: "s", decisionId: "x", tag: CANDIDATE, fromModel: INCUMBENT, status: "RUNNING", attempts: 1, startedAt: "2026-10-16T08:00:00.000Z", steps: [] });
    await rejects(decideAyasModelSwitch({ tag: CANDIDATE, switchHash }, { ...g.deps, admit: admit("switchAyasModel") }), "MODEL_SWITCH_BUSY");
  });

  await scenario("a switch sets AYAS_OLLAMA_MODEL in both files, keeps every other byte, restarts once and checks the cases the model passed", async () => {
    const s = switchFixture();
    const decision = await decideAyasModelSwitch({ tag: CANDIDATE, switchHash: s.switchHash }, { ...s.deps, store: s.store, watch: s.watchStore.read(), safeModeHold: noHold, admit: admit("switchAyasModel") });
    const done = await runAyasModelSwitch(decision, undefined, s.deps);
    assert.equal(done.status, "SWITCHED", JSON.stringify(done.steps));
    const after = s.read();
    assert.equal(after.live, s.liveText.replace("AYAS_OLLAMA_MODEL=gemma3:12b", "AYAS_OLLAMA_MODEL=gemma4:12b"), "CRLF and every other line kept");
    assert.equal(after.repo, s.repoText.replace("gemma3:12b", "gemma4:12b"));
    assert.deepEqual(s.restarts, ["RESTARTED"]);
    assert.deepEqual(s.probes, [{ model: CANDIDATE, caseIds: ["knowledge-0", "arithmetic-0", "honesty-0"] }]);
    assert.deepEqual(done.steps.map((step) => `${step.name}:${step.ok}`), ["BAĞLAMA:true", "AYAR:true", "YENİDEN BAŞLATMA:true", "SOHBET TESTİ:true"]);
    assert.ok(!JSON.stringify(s.store.loadJobs()).includes("secret-one"), "the env file contents are never recorded");
  });

  await scenario("a busy live app defers the switch with the files byte-identical; a failed restart or chat check rolls back", async () => {
    const busy = switchFixture();
    const decision = await decideAyasModelSwitch({ tag: CANDIDATE, switchHash: busy.switchHash }, { store: busy.store, watch: busy.watchStore.read(), incumbentModel: INCUMBENT, safeModeHold: noHold, admit: admit("switchAyasModel") });
    busy.outcomes.push("BUSY");
    const deferred = await runAyasModelSwitch(decision, undefined, busy.deps);
    assert.equal(deferred.status, "DEFERRED"); assert.deepEqual(busy.read(), { live: busy.liveText, repo: busy.repoText }); assert.deepEqual(busy.probes, []);
    const retry = selectAyasModelJob({ decisions: busy.store.loadDecisions(), jobs: busy.store.loadJobs() });
    assert.ok(retry.kind === "SWITCH" && retry.previous?.switchId === deferred.switchId);
    const again = await runAyasModelSwitch(decision, deferred, busy.deps);
    assert.equal(again.status, "SWITCHED"); assert.equal(again.attempts, 2); assert.equal(again.switchId, deferred.switchId);
    const exhausted: AyasModelSwitchRecord = { ...deferred, attempts: AYAS_MODEL_SWITCH_MAX_ATTEMPTS };
    assert.equal(selectAyasModelJob({ decisions: busy.store.loadDecisions(), jobs: { schemaVersion: 1, trials: [], switches: [exhausted] } }).kind, "NONE", "deferral is bounded");

    const unhealthy = switchFixture();
    const d2 = await decideAyasModelSwitch({ tag: CANDIDATE, switchHash: unhealthy.switchHash }, { store: unhealthy.store, watch: unhealthy.watchStore.read(), incumbentModel: INCUMBENT, safeModeHold: noHold, admit: admit("switchAyasModel") });
    unhealthy.outcomes.push("FAILED", "RESTARTED");
    const rolled = await runAyasModelSwitch(d2, undefined, unhealthy.deps);
    assert.equal(rolled.status, "ROLLED_BACK"); assert.deepEqual(unhealthy.read(), { live: unhealthy.liveText, repo: unhealthy.repoText }); assert.deepEqual(unhealthy.restarts, ["FAILED", "RESTARTED"]);

    const wrongAnswers = switchFixture();
    const d3 = await decideAyasModelSwitch({ tag: CANDIDATE, switchHash: wrongAnswers.switchHash }, { store: wrongAnswers.store, watch: wrongAnswers.watchStore.read(), incumbentModel: INCUMBENT, safeModeHold: noHold, admit: admit("switchAyasModel") });
    wrongAnswers.failProbe();
    const back = await runAyasModelSwitch(d3, undefined, wrongAnswers.deps);
    assert.equal(back.status, "ROLLED_BACK"); assert.match(back.reasons![0]!, /sohbet testi/); assert.deepEqual(wrongAnswers.read(), { live: wrongAnswers.liveText, repo: wrongAnswers.repoText });

    const stuck = switchFixture();
    const d4 = await decideAyasModelSwitch({ tag: CANDIDATE, switchHash: stuck.switchHash }, { store: stuck.store, watch: stuck.watchStore.read(), incumbentModel: INCUMBENT, safeModeHold: noHold, admit: admit("switchAyasModel") });
    stuck.outcomes.push("FAILED", "FAILED");
    const recovery = await runAyasModelSwitch(d4, undefined, stuck.deps);
    assert.equal(recovery.status, "RECOVERY_REQUIRED"); assert.deepEqual(stuck.read(), { live: stuck.liveText, repo: stuck.repoText }, "the old setting is back even then");
  });

  await scenario("a switch whose binding changed is refused before any file or process is touched", async () => {
    const s = switchFixture({ liveText: "AYAS_OLLAMA_MODEL=qwen3:8b\n" });
    const decision = await decideAyasModelSwitch({ tag: CANDIDATE, switchHash: s.switchHash }, { store: s.store, watch: s.watchStore.read(), incumbentModel: INCUMBENT, safeModeHold: noHold, admit: admit("switchAyasModel") });
    const refused = await runAyasModelSwitch(decision, undefined, s.deps);
    assert.equal(refused.status, "REFUSED"); assert.deepEqual(s.restarts, []); assert.equal(s.read().live, "AYAS_OLLAMA_MODEL=qwen3:8b\n");
    const moved = await runAyasModelSwitch(decision, undefined, { ...s.deps, incumbentModel: "qwen3:8b" });
    assert.equal(moved.status, "REFUSED"); assert.match(moved.reasons![0]!, /model değişti/);
    const state = s.watchStore.read()!;
    s.watchStore.write({ ...state, results: { ...state.results, [CANDIDATE]: fakeResult(CANDIDATE, D_CANDIDATE, 20, { measuredAt: "2026-10-16T10:00:00.000Z" }) } });
    const remeasured = await runAyasModelSwitch(decision, undefined, { ...s.deps, liveRoot: s.repoRoot });
    assert.equal(remeasured.status, "REFUSED"); assert.match(remeasured.reasons![0]!, /ölçümler değişti/); assert.deepEqual(s.restarts, []);
  });

  await scenario("an interrupted switch: untouched files -> ABANDONED (retried), changed files -> RECOVERY_REQUIRED", async () => {
    const s = switchFixture();
    const running: AyasModelSwitchRecord = { schemaVersion: 1, switchId: "s1", decisionId: "d1", tag: CANDIDATE, fromModel: INCUMBENT, status: "RUNNING", attempts: 1, startedAt: "2026-10-16T08:00:00.000Z", steps: [] };
    assert.equal(reconcileAyasModelSwitchOrphan(running, { repoRoot: s.repoRoot, liveRoot: s.liveRoot, store: s.store }).status, "ABANDONED");
    fs.writeFileSync(path.join(s.liveRoot, ".env.local"), setAyasChatModelLine(s.liveText, CANDIDATE));
    assert.equal(reconcileAyasModelSwitchOrphan({ ...running, switchId: "s2" }, { repoRoot: s.repoRoot, liveRoot: s.liveRoot, store: s.store }).status, "RECOVERY_REQUIRED");
  });

  await scenario("env lines: the effective model follows Next's .env.local rules; the line is replaced, deduplicated or appended", () => {
    assert.equal(effectiveAyasChatModel("OLLAMA_MODEL=qwen2.5:3b\n"), "qwen2.5:3b");
    assert.equal(effectiveAyasChatModel("OLLAMA_MODEL=qwen2.5:3b\nAYAS_OLLAMA_MODEL=\"gemma3:12b\" \n"), "gemma3:12b");
    assert.equal(setAyasChatModelLine("A=1\nAYAS_OLLAMA_MODEL=x:1\nB=2\nAYAS_OLLAMA_MODEL=y:2\n", "z:3"), "A=1\nAYAS_OLLAMA_MODEL=z:3\nB=2\n");
    assert.equal(setAyasChatModelLine("A=1\r\n", "z:3"), "A=1\r\nAYAS_OLLAMA_MODEL=z:3\r\n");
    assert.equal(setAyasChatModelLine("A=1", "z:3"), "A=1\nAYAS_OLLAMA_MODEL=z:3");
    assert.deepEqual(ayasModelSwitchProbeCases(fakeResult(CANDIDATE, D_CANDIDATE, 20)), ["knowledge-0", "arithmetic-0", "honesty-0"]);
    assert.equal(AYAS_CHAT_MODEL_BENCHMARK_ID, "ayas-chat-tr-v3");
  });

  await scenario("the live restarter reads the publish script's own outcome lines", async () => {
    const fake = (code: number, output: string) => createAyasLiveRestarter(temp, async () => ({ code, output, timedOut: false } as never), {});
    assert.equal((await fake(0, "[BILGI] Mod: YENIDEN BASLAT\n[TAMAM] Yeniden baslatildi: D:\\x (PID 1, dis erisim: healthy)\n")()).status, "RESTARTED");
    assert.equal((await fake(3, "[SORUN] Canli uygulamada calisan bir is var (ffmpeg.exe); yeniden baslatilmadi.\n")()).status, "BUSY");
    assert.equal((await fake(1, "[SORUN] Yeniden baslatilan uygulama 240 sn icinde saglikli olmadi\n")()).status, "FAILED");
    assert.equal((await fake(0, "nothing recognisable\n")()).status, "FAILED");
  });

  await scenario("the publish script's -Restart mode parses, reuses the publication's stop/start/health steps and refuses a busy app", () => {
    const script = path.join(process.cwd(), "scripts", "ayas-publish-live.ps1");
    const errors = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `$e=$null; $t=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${script.replace(/'/g, "''")}', [ref]$t, [ref]$e); $e.Count`], { encoding: "utf8", windowsHide: true }).trim();
    assert.equal(errors, "0");
    const source = fs.readFileSync(script, "utf8");
    const block = source.slice(source.indexOf("if ($Restart) {"), source.indexOf("Say 'BILGI' ('Mod: '"));
    for (const step of ["Get-BusyChildren", "exit 3", "Stop-LiveProcesses", "Start-Supervisor", "Wait-Healthy $current", "[TAMAM] Yeniden baslatildi:", "exit 1"]) assert.ok(block.includes(step.replace("[TAMAM] ", "'TAMAM' \"")) || block.includes(step), step);
    assert.ok(!/worktree|npm|Copy-Atomic|Write-Utf8Atomic/.test(block), "a restart builds and swaps nothing");
    assert.ok(/^[\x00-\x7F]*$/.test(source), "the script stays ASCII-only");
  });

  await scenario("every owner decision and job store writes outside Git, so neither the executor nor the observer sees its own state as a dirty tree", () => {
    const repo = process.cwd();
    const roots = [
      createAyasModelOperationStore().rootDir, path.join(repo, "data", "brain", "self-improvement", "model-watch"),
      createAyasUpdateTrialStore().rootDir, path.join(repo, "data", "brain", "self-improvement", "update-approvals"),
    ];
    for (const root of roots) {
      for (const file of ["state.json", "jobs.json", "decisions.json", "executor.lock", AYAS_CANONICAL_SYNC_MARKER]) {
        const relative = path.relative(repo, path.join(root, file)).split(path.sep).join("/");
        assert.equal(spawnSync("git", ["check-ignore", "-q", "--no-index", relative], { cwd: repo, windowsHide: true }).status, 0, `${relative} must be ignored`);
      }
    }
  });

  console.log(JSON.stringify({ status: "PASS", suite: "ayas-model-operations", scenarios: count, modelRuns: 0, networkCalls: 0 }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (originalKey === undefined) delete process.env.AYAS_ACCESS_KEY; else process.env.AYAS_ACCESS_KEY = originalKey;
  fs.rmSync(temp, { recursive: true, force: true });
});
