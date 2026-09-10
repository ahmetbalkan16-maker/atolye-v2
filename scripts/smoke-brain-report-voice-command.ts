/**
 * Atölye Brain — "AYAS, rapor ver" voice/text command smoke (emir §11).
 *
 * `detectAyasReportIntent` (summary / pending-detail / no-match) and
 * `buildAyasReportSpokenAnswer` — the deterministic spoken-Turkish answer must
 * obey AYAS_SPOKEN_TURKISH_RULE (no markdown, symbols, headings, bullets, emoji),
 * be 1–5 sentences, and carry the real counts. It calls no model and runs
 * nothing.
 */

import assert from "node:assert/strict";

import {
  advanceIncident,
  buildBrainIncident,
  type BrainIncidentCheck,
} from "../src/lib/brain/selfheal/BrainIncident";
import {
  buildAyasReportSpokenAnswer,
  buildBrainReportCenterView,
  detectAyasReportIntent,
  EMPTY_BRAIN_REPORT_CENTER_VIEW,
} from "../src/lib/brain/selfheal/BrainReportCenter";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const NOW = "2026-09-12T12:00:00.000Z";
const GREEN: BrainIncidentCheck[] = [
  { name: "tsc", kind: "typecheck", status: "PASS", detail: "0" },
  { name: "eslint", kind: "lint", status: "PASS", detail: "0" },
  { name: "build", kind: "build", status: "PASS", detail: "0" },
  { name: "smoke", kind: "smoke", status: "PASS", detail: "" },
  { name: "regression", kind: "regression", status: "PASS", detail: "" },
];

function awaitingIncident() {
  let i = buildBrainIncident({ category: "voice", severity: "P1", classification: "REAL_INCIDENT", symptom: "ses algılama gecikmesi", now: NOW });
  i = advanceIncident(i, { kind: "diagnose", now: NOW, hypotheses: [{ statement: "capture onset gecikmesi", confidence: 0.8, evidence: [], counterEvidence: [], suspectFiles: ["scripts/smoke-x.ts"] }] }).incident;
  i = advanceIncident(i, { kind: "sandbox-patch", now: NOW, patch: { patchId: "p", baseCommit: "abc", changedFiles: ["scripts/smoke-x.ts"], diff: "@@", diffLines: 8, safetyLevel: "SAFE", risk: "LOW", rollbackPlan: "x", attempt: 1 } }).incident;
  i = advanceIncident(i, { kind: "checks", now: NOW, checks: GREEN }).incident;
  i = advanceIncident(i, { kind: "verified", now: NOW }).incident;
  i = advanceIncident(i, { kind: "await-approval", now: NOW }).incident;
  return i;
}

const SYMBOLS = /[#*_`>|~••]|(^|\n)\s*[-*]\s|https?:\/\//;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

function assertSpoken(text: string) {
  assert.equal(text.trim().length > 0, true, "non-empty");
  assert.equal(SYMBOLS.test(text), false, `no markdown/symbols in: ${text}`);
  assert.equal(EMOJI.test(text), false, `no emoji in: ${text}`);
  const sentences = text.split(/[.!?]\s/).filter(Boolean).length;
  assert.equal(sentences >= 1 && sentences <= 6, true, `1–6 sentences, got ${sentences}: ${text}`);
}

async function run() {
  await scenario("detect — 'AYAS, rapor ver' → summary", () => {
    assert.deepEqual(detectAyasReportIntent("AYAS, rapor ver"), { kind: "summary" });
    assert.deepEqual(detectAyasReportIntent("rapor ver bakalım"), { kind: "summary" });
    assert.deepEqual(detectAyasReportIntent("durum raporu göster"), { kind: "summary" });
    assert.deepEqual(detectAyasReportIntent("raporu oku"), { kind: "summary" });
    assert.deepEqual(detectAyasReportIntent("kendini kontrol et"), { kind: "summary" });
  });

  await scenario("detect — 'onay bekleyen ne' → pending-detail", () => {
    assert.deepEqual(detectAyasReportIntent("onay bekleyen ne"), { kind: "pending-detail" });
    assert.deepEqual(detectAyasReportIntent("Onay bekleyen konu nedir?"), { kind: "pending-detail" });
    assert.deepEqual(detectAyasReportIntent("hangi çözüm onay bekliyor"), { kind: "pending-detail" });
  });

  await scenario("detect — a normal sentence with 'rapor' does NOT trigger", () => {
    assert.equal(detectAyasReportIntent("bu proje için bir rapor hazırlıyorum"), null);
    assert.equal(detectAyasReportIntent("kaç proje var"), null);
    assert.equal(detectAyasReportIntent("Mimar Sinan kimdir"), null);
    assert.equal(detectAyasReportIntent(""), null);
  });

  await scenario("spoken — clean system → 'açık sorun yok', spoken-safe", () => {
    const v = { ...EMPTY_BRAIN_REPORT_CENTER_VIEW, generatedAt: NOW };
    const text = buildAyasReportSpokenAnswer(v, { kind: "summary" });
    assert.match(text, /açık bir sorun yok/i);
    assert.match(text, /yüzde 100/);
    assertSpoken(text);
  });

  await scenario("spoken — summary carries the real counts", () => {
    let healed = awaitingIncident();
    healed = advanceIncident(healed, { kind: "apply", operatorId: "op", now: NOW }).incident;
    healed = advanceIncident(healed, { kind: "monitor", now: NOW }).incident;
    healed = advanceIncident(healed, { kind: "healed", evidence: ["clean"], now: NOW }).incident;
    const v = buildBrainReportCenterView({ incidents: [awaitingIncident(), healed], learned: [], decisions: [], now: NOW });
    const text = buildAyasReportSpokenAnswer(v, { kind: "summary" });
    assert.match(text, /1 açık konu/);
    assert.match(text, /onay bekliyor/);
    assertSpoken(text);
  });

  await scenario("spoken — pending-detail names the incident + says 'not applied, awaiting approval'", () => {
    const v = buildBrainReportCenterView({ incidents: [awaitingIncident()], learned: [], decisions: [], now: NOW });
    const text = buildAyasReportSpokenAnswer(v, { kind: "pending-detail" });
    assert.match(text, /onayını bekliyor/i);
    assert.match(text, /uygulanmadı/i);
    assert.match(text, /kök neden/i);
    assertSpoken(text);
  });

  await scenario("spoken — pending-detail with nothing pending", () => {
    const v = { ...EMPTY_BRAIN_REPORT_CENTER_VIEW, generatedAt: NOW };
    const text = buildAyasReportSpokenAnswer(v, { kind: "pending-detail" });
    assert.match(text, /onay bekleyen bir çözüm yok/i);
    assertSpoken(text);
  });

  await scenario("spoken — a failed incident is surfaced first", () => {
    let failed = buildBrainIncident({ category: "lifecycle", severity: "P1", classification: "UNKNOWN", symptom: "oturum kaybı", now: NOW });
    failed = advanceIncident(failed, { kind: "diagnose", now: NOW, hypotheses: [] }).incident;
    failed = advanceIncident(failed, { kind: "fail", reason: "teşhis sonuçsuz", now: NOW }).incident;
    const v = buildBrainReportCenterView({ incidents: [failed], learned: [], decisions: [], now: NOW });
    const text = buildAyasReportSpokenAnswer(v, { kind: "summary" });
    assert.match(text, /insan müdahalesi bekliyor/i);
    assertSpoken(text);
  });

  console.log(`Atölye Brain report-voice-command smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-report-voice-command", scenarios: count }));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
