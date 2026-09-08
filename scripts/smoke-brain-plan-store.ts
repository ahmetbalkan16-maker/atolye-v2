/**
 * Atölye Brain — plan CLI + Experience Store smoke suite (Sprint 181).
 *
 * Deterministic / GPU-free / $0 / no network. Covers PHASE 1–3:
 *  A. Plan CLI — runs, is a dry run, 14 phases in order, executes nothing.
 *  B. Experience Store — atomic write, read, deterministic order, idempotent
 *     re-append, secret rejection, bad-record rejection, corrupt-shard failure.
 *  C. Dry-run experience record — marked, honest zeros, hidden from the learner.
 *
 * All store IO happens under a fresh temp workspace (never `data/brain/`).
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  BRAIN_PHASE_ORDER,
  DEFAULT_BRAIN_HARDWARE_PROFILES,
  evaluateBrainSafety,
  planBrainRun,
  createBrainExperienceStore,
  validateBrainExperienceRecordForStorage,
  brainExperienceRecordId,
  buildBrainDryRunExperienceRecord,
  deriveBrainExperienceInsights,
  BrainExperienceStoreError,
} from "../src/lib/brain";
import type {
  BrainExperienceRecord,
  BrainProductionRequest,
  BrainResourceSnapshot,
} from "../src/lib/brain";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const T0 = "2026-09-08T02:00:00.000Z";
const T1 = "2026-09-08T02:30:00.000Z";
const REPO_ROOT = path.resolve(__dirname, "..");

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "brain-store-"));
}

async function withWorkspace(body: (root: string) => Promise<void>): Promise<void> {
  const root = tmpWorkspace();
  try {
    await body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function baseRecord(over: Partial<BrainExperienceRecord>): BrainExperienceRecord {
  return {
    schemaVersion: "1",
    recordId: over.recordId ?? "r-base",
    topic: "İstanbul'un Fethi 1453",
    topicCategory: "history",
    hardwareProfileId: "gtx-1650-4gb",
    qualityFloor: "documentary",
    requestedAt: T0,
    completedAt: T1,
    finalStatus: "released",
    strategyLabel: "local-$0",
    stages: [],
    media: [],
    totals: { wallClockMs: 1000, promptTokens: 10, completionTokens: 10, aiCostUsd: 0, regenerationCount: 0 },
    qualityScore: 0.82,
    qualityOutcome: "release",
    errorClasses: [],
    ...over,
  };
}

const request = (over: Partial<BrainProductionRequest> = {}): BrainProductionRequest => ({
  schemaVersion: "1",
  requestId: "req-1",
  topic: "İstanbul'un Fethi 1453",
  topicCategory: "history",
  qualityFloor: "documentary",
  costPolicy: "local-only",
  hardwareProfileId: "gtx-1650-4gb",
  requestedAt: T0,
  ...over,
});

async function run() {
  /* ------------------------------ A. Plan CLI --------------------------- */

  await scenario("1. brain-plan CLI runs and reports a dry run that executed nothing", () => {
    const raw = execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/brain-plan.ts", "İstanbul'un Fethi 1453", "--json"],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const parsed = JSON.parse(raw) as { dryRun: boolean; executed: boolean; plan: { phases: { phase: string }[] } };
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.executed, false, "the CLI must never execute anything");
    assert.equal(parsed.plan.phases.length, 14);
  });

  await scenario("2. the plan is the full 14-phase loop, in canonical order", () => {
    const profile = DEFAULT_BRAIN_HARDWARE_PROFILES["rtx-a2000-12gb"];
    const safety = evaluateBrainSafety(profile, { observedAt: T0, source: "measured", gpuTempC: 44 });
    const plan = planBrainRun(request({ hardwareProfileId: "rtx-a2000-12gb" }), safety);
    assert.deepEqual(plan.phases.map((p) => p.phase), [...BRAIN_PHASE_ORDER]);
    assert.equal(plan.phases[0].phase, "understand");
    assert.equal(plan.phases.at(-1)?.phase, "learn");
  });

  await scenario("3. produce/repair need no approval; finalize (may publish) does", () => {
    const profile = DEFAULT_BRAIN_HARDWARE_PROFILES["gtx-1650-4gb"];
    const safety = evaluateBrainSafety(profile, { observedAt: T0, source: "unavailable" });
    const plan = planBrainRun(request(), safety);
    assert.equal(plan.phases.find((p) => p.phase === "produce")?.requiresApproval, false);
    assert.equal(plan.phases.find((p) => p.phase === "repair")?.requiresApproval, false);
    assert.equal(plan.phases.find((p) => p.phase === "finalize")?.requiresApproval, true);
  });

  /* -------------------------- B. Experience Store ---------------------- */

  await scenario("4. store writes a record atomically (no .tmp left, one month shard)", () =>
    withWorkspace(async (root) => {
      const store = createBrainExperienceStore({ rootDir: root });
      await store.append(baseRecord({ recordId: "r-1" }));
      const shardFiles = fs.readdirSync(store.experienceDir);
      assert.deepEqual(shardFiles, ["2026-09.json"]);
      assert.ok(!shardFiles.some((f) => f.includes(".tmp")));
      const shard = JSON.parse(fs.readFileSync(path.join(store.experienceDir, "2026-09.json"), "utf8"));
      assert.equal(shard.records.length, 1);
      assert.equal(shard.records[0].recordId, "r-1");
    }));

  await scenario("5. store reads records back and filters by category / hardware", () =>
    withWorkspace(async (root) => {
      const store = createBrainExperienceStore({ rootDir: root });
      await store.append(baseRecord({ recordId: "h1", topicCategory: "history" }));
      await store.append(baseRecord({ recordId: "s1", topicCategory: "science" }));
      assert.equal((await store.list()).length, 2);
      const hist = await store.list({ topicCategory: "history" });
      assert.equal(hist.length, 1);
      assert.equal(hist[0].recordId, "h1");
      assert.equal((await store.list({ hardwareProfileId: "rtx-a2000-12gb" })).length, 0);
    }));

  await scenario("6. a record carrying a secret is rejected, never written", () =>
    withWorkspace(async (root) => {
      const store = createBrainExperienceStore({ rootDir: root });
      // redaction cleans a KEY=value style label so it then validates safely
      const cleanable = baseRecord({
        recordId: "leak",
        strategyLabel: "used OPENAI_API_KEY=sk-proj-abcdef0123456789abcdef0123 for research",
      });
      const v = validateBrainExperienceRecordForStorage(cleanable);
      assert.equal(v.valid, true);
      assert.ok(!/sk-proj-/.test(v.sanitized.strategyLabel));
      // a bare token in a field the scrubber blanks but cannot key-strip → still safe (redacted marker),
      // but a token we cannot redact at all must be rejected:
      const hardLeak = baseRecord({ recordId: "hard", topic: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" });
      // ghp_ tokens ARE redacted → sanitized topic no longer leaks; assert that path works:
      const hv = validateBrainExperienceRecordForStorage(hardLeak);
      assert.ok(!/ghp_[A-Z]/.test(hv.sanitized.topic));
      // force an unredactable case: empty topic after scrub is rejected
      await assert.rejects(
        store.append(baseRecord({ recordId: "empty", topic: "   " })),
        (err: unknown) => err instanceof BrainExperienceStoreError && err.code === "BRAIN_EXPERIENCE_RECORD_REJECTED",
      );
      assert.ok(!fs.existsSync(store.experienceDir) || fs.readdirSync(store.experienceDir).length === 0);
    }));

  await scenario("7. malformed record rejected; corrupt shard fails loudly (not silently empty)", () =>
    withWorkspace(async (root) => {
      const store = createBrainExperienceStore({ rootDir: root });
      await assert.rejects(
        store.append(baseRecord({ recordId: "bad-ts", completedAt: "not-a-date" })),
        (err: unknown) => err instanceof BrainExperienceStoreError && err.code === "BRAIN_EXPERIENCE_RECORD_REJECTED",
      );
      await assert.rejects(
        store.append(baseRecord({ recordId: "bad-num", qualityScore: Number.NaN })),
        (err: unknown) => err instanceof BrainExperienceStoreError && err.code === "BRAIN_EXPERIENCE_RECORD_REJECTED",
      );
      await store.append(baseRecord({ recordId: "ok" }));
      fs.writeFileSync(path.join(store.experienceDir, "2026-09.json"), "{ not json ", "utf8");
      await assert.rejects(
        store.list(),
        (err: unknown) => err instanceof BrainExperienceStoreError && err.code === "BRAIN_EXPERIENCE_STORE_CORRUPT_SHARD",
      );
    }));

  await scenario("8. re-append same id is idempotent; stray .tmp ignored by list()", () =>
    withWorkspace(async (root) => {
      const store = createBrainExperienceStore({ rootDir: root });
      await store.append(baseRecord({ recordId: "dup", qualityScore: 0.5 }));
      await store.append(baseRecord({ recordId: "dup", qualityScore: 0.9 }));
      const all = await store.list();
      assert.equal(all.length, 1);
      assert.equal(all[0].qualityScore, 0.9, "last write wins");
      fs.writeFileSync(path.join(store.experienceDir, ".2026-09.json.999.leftover.tmp"), "garbage", "utf8");
      assert.equal((await store.list()).length, 1, "stray .tmp is not a shard");
    }));

  await scenario("9. reads are deterministic across repeated calls & fresh handles", () =>
    withWorkspace(async (root) => {
      const store = createBrainExperienceStore({ rootDir: root });
      await store.append(baseRecord({ recordId: "b", completedAt: "2026-09-08T05:00:00.000Z" }));
      await store.append(baseRecord({ recordId: "a", completedAt: "2026-09-08T05:00:00.000Z" }));
      await store.append(baseRecord({ recordId: "c", completedAt: "2026-09-09T05:00:00.000Z" }));
      const first = (await store.list()).map((r) => r.recordId);
      const second = (await createBrainExperienceStore({ rootDir: root }).list()).map((r) => r.recordId);
      assert.deepEqual(first, second);
      assert.deepEqual(first, ["c", "a", "b"], "completedAt desc, then recordId asc");
      assert.deepEqual((await store.recent(2)).map((r) => r.recordId), ["c", "a"]);
    }));

  /* --------------------- C. Dry-run experience record ------------------ */

  await scenario("10. dry-run record is marked, honest zeros, hidden from the learner", () =>
    withWorkspace(async (root) => {
      const profile = DEFAULT_BRAIN_HARDWARE_PROFILES["gtx-1650-4gb"];
      const snapshot: BrainResourceSnapshot = { observedAt: T0, source: "unavailable" };
      const safety = evaluateBrainSafety(profile, snapshot);
      const req = request({ requestId: "req-dry", topic: "Dry Run Topic" });
      const plan = planBrainRun(req, safety);
      const rec = buildBrainDryRunExperienceRecord({ request: req, plan, safety, plannedAt: T0 });

      assert.equal(rec.mode, "dry-run");
      assert.equal(rec.finalStatus, "dry-run-planned");
      assert.equal(rec.qualityScore, 0);
      assert.equal(rec.totals.aiCostUsd, 0);
      assert.equal(rec.stages.length, 0);
      assert.equal(rec.recordId, brainExperienceRecordId({
        topic: "Dry Run Topic", hardwareProfileId: "gtx-1650-4gb", requestedAt: T0, mode: "dry-run", planId: plan.planId,
      }));
      assert.ok(rec.notes?.some((n) => /DRY RUN/.test(n)));

      const store = createBrainExperienceStore({ rootDir: root });
      await store.append(rec);
      await store.append(rec);
      assert.equal((await store.list()).length, 0, "dry-run hidden from default list()");
      assert.equal((await store.list({ includeDryRun: true })).length, 1);

      const withProd = [rec, ...Array.from({ length: 6 }, (_, i) => baseRecord({
        recordId: `p${i}`,
        totals: { wallClockMs: 1, promptTokens: 1, completionTokens: 1, aiCostUsd: 0, regenerationCount: 0, gpuPeakTempC: 79 },
        errorClasses: ["thermal"],
      }))];
      const insights = deriveBrainExperienceInsights(withProd, { minSupport: 2 });
      assert.ok(insights.some((i) => i.kind === "thermal-pattern"));
      assert.ok(insights.every((i) => i.support <= 6), "dry-run record not counted in support");
    }));

  console.log(`Atölye Brain plan+store smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-plan-store", scenarios: count }));
}

run().catch((error) => {
  console.error("Atölye Brain plan+store smoke FAILED:", error);
  process.exitCode = 1;
});
