/**
 * V3 smoke: failed controlled-evolution cases become main-AYAS development jobs (owner decision 2026-11-10) — read
 * from the discovery child's status, one job per gap, none while one is open or closed lately, a few at most; an
 * unreadable, stale or passing status opens none. Temp roots only; no network, no model.
 * Run: npx tsx scripts/smoke-v3-evolution-jobs.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nextJob, scopeOf } from "../src/lib/v3/council/DevQueue";
import { EVOLUTION_REOPEN_DAYS, evolutionGaps, evolutionSignature, evolutionStatusFile, gapsToOpen, MAX_OPEN_EVOLUTION_JOBS, openEvolutionJobs } from "../src/lib/v3/council/EvolutionJobs";
import { listProposals, updateProposal } from "../src/lib/v3/council/SelfImprovement";

let scenarios = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
  scenarios++;
}

const NOW = Date.parse("2026-11-10T16:40:00.000Z");
const HEAD = "1c11e4f6aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
/** The status as AyasControlledEvolutionLocalGaps writes it. */
const status = (opportunities: { need: string; stage8: string; origin?: string }[], at = "2026-11-10T04:26:01.890Z") => ({
  at, head: HEAD, mode: "AUTO", measurement: "MEASURED", measureAttempts: 1,
  snapshot: { benchmarkId: "cognitive-quality", passed: 52, caseCount: 55, failing: 3 },
  opportunities: opportunities.map((o, i) => ({ opportunityId: `opp-${i}`, origin: o.origin ?? "LOCAL_EVALUATOR", need: o.need, readiness: "BLOCKED", reason: "x", stage8: o.stage8 })),
  plan: { candidate: null, strategyApplies: null, reason: "measured gap without a registered owner-reviewed strategy (NEEDS_EXPERIMENT_DESIGN)" }, executionAuthority: "NONE",
});

async function main() {
  await scenario("A the gaps without a strategy are read; covered, foreign, stale and passing ones are not", () => {
    const s = status([
      { need: `2 INTENT_ACCURACY case(s) of cognitive-quality fail at ${HEAD.slice(0, 12)}`, stage8: "NEEDS_EXPERIMENT_DESIGN" },
      { need: `1 TEMPORAL_CORRECTNESS case(s) of cognitive-quality fail at ${HEAD.slice(0, 12)}`, stage8: "HYPOTHESIS" },
      { need: "an operator's own opportunity", stage8: "NEEDS_EXPERIMENT_DESIGN", origin: "OPERATOR" },
    ]);
    assert.deepEqual(evolutionGaps(s, NOW), [{ imza: "cognitive-quality|INTENT_ACCURACY", benchmarkId: "cognitive-quality", dimension: "INTENT_ACCURACY", count: 2, head: HEAD }], "a gap a strategy covers is the cycle's own experiment");
    assert.deepEqual(evolutionGaps({ ...s, at: "2026-11-07T00:00:00.000Z" }, NOW), [], "a status older than two days");
    assert.deepEqual(evolutionGaps({ ...s, snapshot: null }, NOW), [], "nothing measured");
    assert.deepEqual(evolutionGaps(status([]), NOW), [], "55/55: nothing to evolve");
    assert.deepEqual(evolutionGaps("not json", NOW), []);
  });

  await scenario("B one job per gap: an open one blocks, a closed one for a week, never more than a few at once", async () => {
    const workRoot = mkdtempSync(path.join(os.tmpdir(), "v3-evrim-is-"));
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "v3-evrim-repo-"));
    try {
      const now = new Date(NOW);
      assert.deepEqual(await openEvolutionJobs(workRoot, repoRoot, now), [], "no status file: nothing");
      mkdirSync(path.dirname(evolutionStatusFile(repoRoot)), { recursive: true });
      writeFileSync(evolutionStatusFile(repoRoot), "{broken");
      assert.deepEqual(await openEvolutionJobs(workRoot, repoRoot, now), [], "an unreadable status opens nothing");
      const dims = ["INTENT_ACCURACY", "CONTEXT_CONTINUITY", "MEMORY_RELEVANCE", "ANSWER_RELEVANCE"];
      writeFileSync(evolutionStatusFile(repoRoot), JSON.stringify(status(dims.map((d) => ({ need: `1 ${d} case(s) of cognitive-quality fail at ${HEAD.slice(0, 12)}`, stage8: "NEEDS_EXPERIMENT_DESIGN" })))));
      const opened = await openEvolutionJobs(workRoot, repoRoot, now);
      assert.equal(opened.length, MAX_OPEN_EVOLUTION_JOBS, "four gaps, three jobs");
      const job = opened[0]!;
      assert.deepEqual([job.kapsam, job.kaynakTuru, job.durum, job.beyin, evolutionSignature(job)], ["ayas", "olcum", "onaylandi", "sef", "cognitive-quality|INTENT_ACCURACY"]);
      assert.match(job.baslik, /^Kontrollü evrim: 1 INTENT_ACCURACY vakası geçmiyor \(cognitive-quality\)$/);
      assert.match(job.neden, /NEEDS_EXPERIMENT_DESIGN[\s\S]*eval-pinli suite'lere dokunma/);
      assert.match(job.karar!.not!, /ONAYLA VE UYGULA/);
      assert.equal(scopeOf(job), "ayas");
      assert.equal(nextJob([job], NOW)?.id, job.id, "the evening developer takes it");
      assert.equal(nextJob([job], NOW, { ATOLYE_AYAS_GELISTIRME: "0" }), undefined, "main-AYAS jobs switched off");
      assert.deepEqual(await openEvolutionJobs(workRoot, repoRoot, now), [], "open jobs block their gaps and fill the room");
      // The first is built and applied: its gap waits a week; the room it freed goes to the fourth gap.
      await updateProposal(workRoot, job.id, (p) => ({ ...p, durum: "yapildi", is: { deneme: 1, baslangic: now.toISOString(), bitis: now.toISOString() } }));
      const next = await openEvolutionJobs(workRoot, repoRoot, now);
      assert.deepEqual(next.map(evolutionSignature), ["cognitive-quality|ANSWER_RELEVANCE"]);
      assert.equal((await listProposals(workRoot)).length, MAX_OPEN_EVOLUTION_JOBS + 1);
      const later = (await listProposals(workRoot)).map((x) => x.proposal);
      const gap = { imza: "cognitive-quality|INTENT_ACCURACY", benchmarkId: "cognitive-quality", dimension: "INTENT_ACCURACY", count: 1, head: HEAD };
      const closedOnly = later.filter((p) => p.durum === "yapildi");
      assert.deepEqual(gapsToOpen([gap], closedOnly, NOW + (EVOLUTION_REOPEN_DAYS - 1) * 86_400_000), [], "within the week");
      assert.deepEqual(gapsToOpen([gap], closedOnly, NOW + (EVOLUTION_REOPEN_DAYS + 1) * 86_400_000), [gap], "after it, a gap still failing gets a new job");
    } finally {
      rmSync(workRoot, { recursive: true, force: true });
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  console.log(`PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
