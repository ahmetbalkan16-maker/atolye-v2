/**
 * Atölye Brain — AYAS Report Center view-model smoke (emir §7–§15).
 *
 * `buildBrainReportCenterView`: buckets, counts, system-health %, the per
 * incident chain (evidence / timeline / root cause / proposed fix / checks /
 * decision / watchdog / learning), `filterReports`, and the honest empty view.
 * No fs, no network — pure.
 */

import assert from "node:assert/strict";

import {
  advanceIncident,
  buildBrainIncident,
  type BrainIncident,
  type BrainIncidentCheck,
} from "../src/lib/brain/selfheal/BrainIncident";
import { buildLearnedPattern } from "../src/lib/brain/selfheal/BrainLearnedPattern";
import { buildSelfHealDecision } from "../src/lib/brain/selfheal/BrainSelfHealDecision";
import {
  buildBrainReportCenterView,
  EMPTY_BRAIN_REPORT_CENTER_VIEW,
  filterReports,
  systemHealthPercent,
} from "../src/lib/brain/selfheal/BrainReportCenter";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const NOW = "2026-09-12T09:00:00.000Z";
const GREEN: BrainIncidentCheck[] = [
  { name: "tsc", kind: "typecheck", status: "PASS", detail: "0" },
  { name: "eslint", kind: "lint", status: "PASS", detail: "0" },
  { name: "next build", kind: "build", status: "PASS", detail: "0" },
  { name: "smoke", kind: "smoke", status: "PASS", detail: "" },
  { name: "regression", kind: "regression", status: "PASS", detail: "" },
  { name: "security", kind: "security", status: "PASS", detail: "" },
];

function diagnosed(over: Partial<Parameters<typeof buildBrainIncident>[0]> = {}, suspect = ["scripts/smoke-x.ts"], confidence = 0.88): BrainIncident {
  let i = buildBrainIncident({
    category: "voice",
    severity: "P1",
    classification: "REAL_INCIDENT",
    symptom: "wake sonrası komut yakalama 1.2 sn içinde erken kapanıyor",
    now: NOW,
    evidence: [{ at: "2026-09-12T08:55:00.000Z", source: "voice-lab", note: "37 olay / 50 turn" }],
    ...over,
  });
  i = advanceIncident(i, {
    kind: "diagnose",
    now: NOW,
    hypotheses: [
      { statement: "VAD pre-roll konuşma durumu kirlenmesi", confidence, evidence: ["37/50 turn"], counterEvidence: [], suspectFiles: suspect },
    ],
  }).incident;
  return i;
}

function verified(
  over?: Partial<Parameters<typeof buildBrainIncident>[0]>,
  suspect: string[] = ["scripts/smoke-x.ts"],
  safety: "SAFE" | "REVIEW_REQUIRED" | "FORBIDDEN_AUTONOMOUS" = "SAFE",
): BrainIncident {
  let i = diagnosed(over, suspect);
  i = advanceIncident(i, {
    kind: "sandbox-patch",
    now: NOW,
    patch: {
      patchId: "p1",
      baseCommit: "abc1234",
      changedFiles: suspect,
      diff: "@@ -1 +1 @@\n-a\n+b",
      diffLines: 10,
      safetyLevel: safety,
      risk: "LOW",
      rollbackPlan: "git checkout -- <files>",
      attempt: 1,
    },
  }).incident;
  i = advanceIncident(i, { kind: "checks", now: NOW, checks: GREEN }).incident;
  i = advanceIncident(i, { kind: "verified", now: NOW }).incident;
  i = advanceIncident(i, { kind: "await-approval", now: NOW }).incident;
  return i;
}

async function run() {
  await scenario("empty store → empty view, health 100, honest headline", () => {
    const v = buildBrainReportCenterView({ incidents: [], learned: [], decisions: [], now: NOW });
    assert.equal(v.reports.length, 0);
    assert.equal(v.systemHealthPercent, 100);
    assert.equal(v.counts.open, 0);
    assert.match(v.headline, /Açık sorun yok/);
    assert.equal(EMPTY_BRAIN_REPORT_CENTER_VIEW.systemHealthPercent, 100);
  });

  await scenario("a verified incident with no decision → bucket 'awaiting', canDecide, health −3", () => {
    const v = buildBrainReportCenterView({ incidents: [verified()], learned: [], decisions: [], now: NOW });
    assert.equal(v.reports.length, 1);
    const r = v.reports[0];
    assert.equal(r.bucket, "awaiting");
    assert.equal(r.canDecide, true);
    assert.equal(r.needsHumanDirect, false);
    assert.equal(v.counts.awaitingApproval, 1);
    assert.equal(v.counts.open, 1);
    assert.equal(v.systemHealthPercent, 97);
    assert.match(v.headline, /onay/i);
  });

  await scenario("full chain — evidence, timeline, root cause + confidence, proposed fix, checks", () => {
    const r = buildBrainReportCenterView({ incidents: [verified()], learned: [], decisions: [], now: NOW }).reports[0];
    assert.ok(r.evidence.some((e) => e.note.includes("37 olay")));
    assert.ok(r.timeline.length >= 2);
    assert.equal(r.timeline[0].label.includes("Açıldı"), true);
    assert.equal(r.rootCause, "VAD pre-roll konuşma durumu kirlenmesi");
    assert.equal(r.confidence, 0.88);
    assert.deepEqual(r.suspectFiles, ["scripts/smoke-x.ts"]);
    assert.ok(r.proposedFix);
    assert.match(r.proposedFix!.summary, /1 dosya · 10 satır · SAFE · risk LOW/);
    assert.equal(r.sandbox, "PASS");
    assert.equal(r.regression, "PASS");
    assert.equal(r.security, "PASS");
    // the raw unified diff is NEVER surfaced
    assert.equal(JSON.stringify(r).includes("@@"), false);
  });

  await scenario("an APPROVE decision → bucket moves to 'investigating', canDecide false, decision shown", () => {
    const inc = verified();
    const d = buildSelfHealDecision({ incidentId: inc.id, decision: "APPROVE", now: NOW });
    const r = buildBrainReportCenterView({ incidents: [inc], learned: [], decisions: [d], now: NOW }).reports[0];
    assert.equal(r.bucket, "investigating");
    assert.equal(r.canDecide, false);
    assert.equal(r.operatorDecision?.decision, "APPROVE");
    assert.equal(r.operatorDecision?.operatorApprovalId, d.operatorApprovalId);
  });

  await scenario("a REJECT decision → still awaiting, operator may re-decide", () => {
    const inc = verified();
    const d = buildSelfHealDecision({ incidentId: inc.id, decision: "REJECT", now: NOW });
    const r = buildBrainReportCenterView({ incidents: [inc], learned: [], decisions: [d], now: NOW }).reports[0];
    assert.equal(r.bucket, "awaiting");
    assert.equal(r.canDecide, true);
    assert.equal(r.operatorDecision?.decision, "REJECT");
  });

  await scenario("a FAILED incident → bucket 'failed', needsHumanDirect, health −16, liveState NEEDS_HUMAN", () => {
    let i = diagnosed();
    i = advanceIncident(i, { kind: "fail", reason: "teşhis sonuçsuz", now: NOW }).incident;
    const v = buildBrainReportCenterView({ incidents: [i], learned: [], decisions: [], now: NOW });
    assert.equal(v.reports[0].bucket, "failed");
    assert.equal(v.reports[0].needsHumanDirect, true);
    assert.equal(v.reports[0].canDecide, false);
    assert.equal(v.counts.failed, 1);
    assert.equal(v.systemHealthPercent, 84);
    assert.equal(v.liveState, "NEEDS_HUMAN");
  });

  await scenario("a HEALED incident → bucket 'resolved', severity tone 'resolved'", () => {
    let i = verified();
    i = advanceIncident(i, { kind: "apply", operatorId: "op-x", now: NOW }).incident;
    i = advanceIncident(i, { kind: "monitor", now: NOW }).incident;
    i = advanceIncident(i, { kind: "healed", evidence: ["imza tekrar etmedi"], now: NOW }).incident;
    const r = buildBrainReportCenterView({ incidents: [i], learned: [], decisions: [], now: NOW }).reports[0];
    assert.equal(r.bucket, "resolved");
    assert.equal(r.severityTone, "resolved");
    assert.equal(r.watchdog.verdict, "HEALED");
    assert.ok(r.watchdog.evidence.includes("imza tekrar etmedi"));
  });

  await scenario("a ROLLED_BACK incident → bucket 'rolledBack', health −8", () => {
    let i = verified();
    i = advanceIncident(i, { kind: "apply", operatorId: "op-x", now: NOW }).incident;
    i = advanceIncident(i, { kind: "monitor", now: NOW }).incident;
    i = advanceIncident(i, { kind: "heal-failed", reason: "imza tekrar etti", now: NOW }).incident;
    const v = buildBrainReportCenterView({ incidents: [i], learned: [], decisions: [], now: NOW });
    assert.equal(v.reports[0].bucket, "rolledBack");
    assert.equal(v.counts.rolledBack, 1);
    assert.equal(v.systemHealthPercent, 92);
  });

  await scenario("a FORBIDDEN-area fix → needsHumanDirect, canDecide false (no approve button)", () => {
    const inc = verified(undefined, ["src/lib/brain/selfheal/BrainSelfHealGuards.ts"], "FORBIDDEN_AUTONOMOUS");
    const r = buildBrainReportCenterView({ incidents: [inc], learned: [], decisions: [], now: NOW }).reports[0];
    assert.equal(r.needsHumanDirect, true);
    assert.equal(r.canDecide, false);
  });

  await scenario("learned pattern joins into learning + the report's learning block", () => {
    let i = verified();
    i = advanceIncident(i, { kind: "apply", operatorId: "op-x", now: NOW }).incident;
    i = advanceIncident(i, { kind: "monitor", now: NOW }).incident;
    i = advanceIncident(i, { kind: "healed", evidence: ["clean"], now: NOW }).incident;
    const learned = buildLearnedPattern(i, { successfulFix: "pre-roll audio-only + postWakeSpeechMs gate", regressionResult: "200-turn PASS", risk: "LOW", status: "APPLIED", now: NOW });
    i = advanceIncident(i, { kind: "learned", learnedPatternId: learned.id, now: NOW }).incident;
    const v = buildBrainReportCenterView({ incidents: [i], learned: [learned], decisions: [], now: NOW });
    assert.equal(v.learning.length, 1);
    assert.equal(v.reports[0].learning.learned, true);
    assert.match(v.reports[0].learning.fix ?? "", /postWakeSpeechMs/);
  });

  await scenario("filterReports by status + category", () => {
    const a = verified({ symptom: "ses A" }, ["scripts/smoke-a.ts"]);
    let b = diagnosed({ symptom: "ui B", category: "ui" }, ["scripts/smoke-b.ts"]);
    b = advanceIncident(b, { kind: "fail", reason: "x", now: NOW }).incident;
    const reports = buildBrainReportCenterView({ incidents: [a, b], learned: [], decisions: [], now: NOW }).reports;
    assert.equal(filterReports(reports, { status: "awaiting" }).length, 1);
    assert.equal(filterReports(reports, { status: "failed" }).length, 1);
    assert.equal(filterReports(reports, { category: "voice" }).length, 1);
    assert.equal(filterReports(reports, { status: "all", category: "all" }).length, 2);
  });

  await scenario("systemHealthPercent clamps to 0 under heavy load", () => {
    const many = Array.from({ length: 10 }, (_, n) => {
      let i = diagnosed({ symptom: `fail ${n}`, severity: "P0" });
      i = advanceIncident(i, { kind: "fail", reason: "x", now: NOW }).incident;
      return i;
    });
    const reports = buildBrainReportCenterView({ incidents: many, learned: [], decisions: [], now: NOW }).reports;
    assert.equal(systemHealthPercent(reports), 0);
  });

  await scenario("optimizations pass through the view", () => {
    const v = buildBrainReportCenterView({
      incidents: [],
      learned: [],
      decisions: [],
      optimizations: [{ id: "opt-1", headline: "sttLatency: 1800 ms → 1250 ms (+30.5%)", verdict: "ACCEPT", at: NOW }],
      now: NOW,
    });
    assert.equal(v.optimizations.length, 1);
    assert.match(v.optimizations[0].headline, /1250 ms/);
  });

  await scenario("latency observation passes through the view (default null)", () => {
    const plain = buildBrainReportCenterView({ incidents: [], learned: [], decisions: [], now: NOW });
    assert.equal(plain.latency, null);

    const withLatency = buildBrainReportCenterView({
      incidents: [],
      learned: [],
      decisions: [],
      latency: {
        generatedAt: NOW,
        totalSamples: 24,
        rejectedSamples: 0,
        baseline: { generatedAt: NOW, entries: [] },
        findings: [
          { metric: "sttMs", metricTr: "STT süresi", verdict: "REGRESSION", trend: "degrading", baselineMs: 1200, currentMs: 1750, deltaPct: 0.46, baselineSamples: 16, recentSamples: 8, recentWindowMs: 7200000, confidence: 0.72, evidence: ["baz çizgi 1200 ms"] },
        ],
        headline: { metric: "sttMs", metricTr: "STT süresi", verdict: "REGRESSION", trend: "degrading", baselineMs: 1200, currentMs: 1750, deltaPct: 0.46, baselineSamples: 16, recentSamples: 8, recentWindowMs: 7200000, confidence: 0.72, evidence: ["baz çizgi 1200 ms"] },
      },
      now: NOW,
    });
    assert.equal(withLatency.latency?.headline?.verdict, "REGRESSION");
    assert.equal(EMPTY_BRAIN_REPORT_CENTER_VIEW.latency, null);
  });

  console.log(`Atölye Brain report-center smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-report-center", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
