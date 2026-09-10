/**
 * Atölye Brain — AYAS Report Center end-to-end smoke (emir §9–§12, §26, §39).
 *
 * The whole operator chain against a real durable store (temp dir):
 *
 *   incident (VERIFIED) → loadBrainSelfHealSnapshot → Report Center view shows
 *   the full chain + a decidable "awaiting" report → operator records ONAYLA →
 *   reload → bucket moves to "investigating", no further decision offered,
 *   `canApplyFromDecision` is true and the CLI-gate resolves the approvalId →
 *   a later REDDET flips it back off. Nothing runs git / the apply / the gate.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  advanceIncident,
  buildBrainIncident,
  type BrainIncidentCheck,
} from "../src/lib/brain/selfheal/BrainIncident";
import { buildLearnedPattern } from "../src/lib/brain/selfheal/BrainLearnedPattern";
import {
  buildSelfHealDecision,
  canApplyFromDecision,
} from "../src/lib/brain/selfheal/BrainSelfHealDecision";
import { createBrainSelfHealStore } from "../src/lib/brain/selfheal/BrainSelfHealStore";
import { loadBrainSelfHealSnapshot } from "../src/lib/brain/ui/BrainSelfHealConsoleSnapshot";
import { detectAyasReportIntent, buildAyasReportSpokenAnswer } from "../src/lib/brain/selfheal/BrainReportCenter";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const NOW = "2026-09-12T18:00:00.000Z";
const GREEN: BrainIncidentCheck[] = [
  { name: "npx tsc --noEmit", kind: "typecheck", status: "PASS", detail: "0 errors" },
  { name: "npx eslint .", kind: "lint", status: "PASS", detail: "0 errors" },
  { name: "npx next build", kind: "build", status: "PASS", detail: "exit 0" },
  { name: "smoke-brain-selfheal", kind: "smoke", status: "PASS", detail: "40 scenarios" },
  { name: "regression sweep", kind: "regression", status: "PASS", detail: "all green" },
  { name: "smoke-brain-selfheal-security", kind: "security", status: "PASS", detail: "14 scenarios" },
];

function verifiedIncident() {
  let i = buildBrainIncident({
    category: "voice",
    severity: "P1",
    classification: "REAL_INCIDENT",
    symptom: "AYAS wake sonrası komut yakalama 1.2 sn içinde erken kapanıyor",
    now: NOW,
    evidence: [{ at: "2026-09-12T17:55:00.000Z", source: "voice-lab", note: "37 olay / 50 turn — postWakeSpeechMs 0" }],
  });
  i = advanceIncident(i, {
    kind: "diagnose",
    now: NOW,
    hypotheses: [
      {
        statement: "VAD pre-roll konuşma durumu 'AYAS' kelimesiyle kirleniyor; hasCommand erken doğru oluyor",
        confidence: 0.91,
        evidence: ["37/50 turn erken kapanma", "postWakeSpeechMs sayacı sıfır"],
        counterEvidence: [],
        suspectFiles: ["scripts/smoke-selfheal-fixture-lib.js"],
      },
    ],
  }).incident;
  i = advanceIncident(i, {
    kind: "sandbox-patch",
    now: NOW,
    patch: {
      patchId: `${i.id}-a1`,
      baseCommit: "abc1234def5678",
      changedFiles: ["scripts/smoke-selfheal-fixture-lib.js"],
      diff: "@@ -1,3 +1,4 @@\n context\n-old line\n+new line\n context",
      diffLines: 4,
      safetyLevel: "SAFE",
      risk: "LOW",
      rollbackPlan: "git checkout -- scripts/smoke-selfheal-fixture-lib.js",
      attempt: 1,
    },
  }).incident;
  i = advanceIncident(i, { kind: "checks", now: NOW, checks: GREEN }).incident;
  i = advanceIncident(i, { kind: "verified", now: NOW }).incident;
  i = advanceIncident(i, { kind: "await-approval", now: NOW }).incident;
  return i;
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sh-report-e2e-"));
}

async function run() {
  await scenario("chain — VERIFIED incident → snapshot shows full report + a decidable 'awaiting' entry", () => {
    const root = tmp();
    try {
      const store = createBrainSelfHealStore({ rootDir: root });
      const inc = store.saveIncident(verifiedIncident());

      const snap = loadBrainSelfHealSnapshot({ rootDir: root, now: () => NOW });
      assert.equal(snap.error, null);
      assert.equal(snap.reportCenter.reports.length, 1);
      const r = snap.reportCenter.reports[0];
      assert.equal(r.id, inc.id);
      assert.equal(r.bucket, "awaiting");
      assert.equal(r.canDecide, true);
      assert.equal(r.needsHumanDirect, false);
      assert.equal(r.confidence, 0.91);
      assert.match(r.rootCause ?? "", /pre-roll/);
      assert.ok(r.timeline.length >= 3);
      assert.equal(r.sandbox, "PASS");
      assert.equal(r.regression, "PASS");
      assert.equal(r.security, "PASS");
      assert.ok(r.proposedFix);
      assert.equal(snap.reportCenter.counts.awaitingApproval, 1);
      assert.equal(snap.reportCenter.counts.open, 1);
      assert.equal(snap.reportCenter.systemHealthPercent, 97);
      // no raw diff leaks through the snapshot
      assert.equal(JSON.stringify(snap.reportCenter).includes("@@ -1,3"), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("chain — operator ONAYLA → decision recorded, bucket → investigating, CLI-gate resolves the approvalId", () => {
    const root = tmp();
    try {
      const store = createBrainSelfHealStore({ rootDir: root });
      const inc = store.saveIncident(verifiedIncident());

      // the button: record the decision (NO git, NO apply)
      const decision = store.recordSelfHealDecision(
        buildSelfHealDecision({ incidentId: inc.id, decision: "APPROVE", now: NOW, note: "sandbox + regresyon yeşil, düşük risk" }),
      );
      assert.match(decision.operatorApprovalId, /^op-[0-9a-f]{8}$/);

      const snap = loadBrainSelfHealSnapshot({ rootDir: root, now: () => NOW });
      const r = snap.reportCenter.reports[0];
      assert.equal(r.bucket, "investigating");
      assert.equal(r.canDecide, false, "no further decision offered after APPROVE");
      assert.equal(r.operatorDecision?.decision, "APPROVE");
      assert.equal(r.operatorDecision?.operatorApprovalId, decision.operatorApprovalId);
      assert.equal(snap.reportCenter.counts.awaitingApproval, 0);

      // the CLI `apply` gate (no --operator flag) resolves the id from the store
      const stored = store.loadSelfHealDecision(inc.id);
      assert.equal(canApplyFromDecision(stored), true);
      assert.equal(stored!.operatorApprovalId, decision.operatorApprovalId);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("chain — a later REDDET flips the CLI-gate back off", () => {
    const root = tmp();
    try {
      const store = createBrainSelfHealStore({ rootDir: root });
      const inc = store.saveIncident(verifiedIncident());
      store.recordSelfHealDecision(buildSelfHealDecision({ incidentId: inc.id, decision: "APPROVE", now: NOW }));
      store.recordSelfHealDecision(buildSelfHealDecision({ incidentId: inc.id, decision: "REJECT", now: "2026-09-12T19:00:00.000Z" }));
      assert.equal(canApplyFromDecision(store.loadSelfHealDecision(inc.id)), false);
      const snap = loadBrainSelfHealSnapshot({ rootDir: root, now: () => NOW });
      assert.equal(snap.reportCenter.reports[0].bucket, "awaiting", "REJECT → decidable again");
      assert.equal(snap.reportCenter.reports[0].canDecide, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("chain — a HEALED + learned incident → resolved bucket + learning card + 'rapor ver' summary", () => {
    const root = tmp();
    try {
      const store = createBrainSelfHealStore({ rootDir: root });
      let i = verifiedIncident();
      i = advanceIncident(i, { kind: "apply", operatorId: "op-abc12345", now: NOW }).incident;
      i = advanceIncident(i, { kind: "monitor", now: NOW }).incident;
      i = advanceIncident(i, { kind: "healed", evidence: ["imza 10 dk penceresinde tekrar etmedi", "hata artışı yok"], now: NOW }).incident;
      const learned = buildLearnedPattern(i, {
        successfulFix: "pre-roll SADECE ses; postWakeSpeechMs ayrı sayaç; hasCommand post-wake konuşma ister",
        regressionResult: "200-turn PASS",
        risk: "LOW",
        status: "APPLIED",
        now: NOW,
      });
      i = advanceIncident(i, { kind: "learned", learnedPatternId: learned.id, now: NOW }).incident;
      store.saveIncident(i);
      store.saveLearnedPattern(learned);

      const snap = loadBrainSelfHealSnapshot({ rootDir: root, now: () => NOW });
      assert.equal(snap.reportCenter.reports[0].bucket, "resolved");
      assert.equal(snap.reportCenter.reports[0].watchdog.verdict, "HEALED");
      assert.equal(snap.reportCenter.learning.length, 1);
      assert.equal(snap.reportCenter.counts.resolved, 1);
      assert.equal(snap.reportCenter.counts.learnedPatterns, 1);

      // "AYAS, rapor ver" answers from this snapshot, deterministically
      assert.deepEqual(detectAyasReportIntent("AYAS rapor ver"), { kind: "summary" });
      const spoken = buildAyasReportSpokenAnswer(snap.reportCenter, { kind: "summary" });
      assert.match(spoken, /açık bir sorun yok/i);
      assert.match(spoken, /1 doğrulanmış çözüm öğrenildi/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await scenario("chain — a missing store → empty Report Center view, no crash", () => {
    const root = path.join(tmp(), "does-not-exist-yet");
    const snap = loadBrainSelfHealSnapshot({ rootDir: root, now: () => NOW });
    assert.equal(snap.error, null);
    assert.equal(snap.reportCenter.reports.length, 0);
    assert.equal(snap.reportCenter.systemHealthPercent, 100);
    assert.match(buildAyasReportSpokenAnswer(snap.reportCenter, { kind: "summary" }), /açık bir sorun yok/i);
  });

  console.log(`Atölye Brain report-center E2E smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-report-e2e", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
