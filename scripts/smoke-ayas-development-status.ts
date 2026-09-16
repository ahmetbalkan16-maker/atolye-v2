import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasApprovalInboxStore, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import {
  computeAyasDevelopmentStatusData,
  buildAyasDevelopmentStatusSummary,
  isAyasDevelopmentBenefitQuery,
} from "../src/lib/ayas/execution/AyasDevelopmentStatus";
import { isAyasDevelopmentStatusQuery } from "../src/lib/ayas/model/AyasComplexityRouter";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-dev-status-")); }

function proposalInput(overrides: Partial<Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy">> = {}) {
  return {
    createdAt: "2026-09-15T09:00:00.000Z",
    baseBranch: "wip/test",
    baseHead: "abc123",
    objective: "test-only bounded observability",
    currentProblem: "fixture misses one deterministic assertion",
    selectionReason: "the fixture evidence identifies this bounded gap",
    expectedUserBenefit: "the regression is caught before it reaches the user",
    expectedBehaviorChange: "the smoke test checks one additional invariant",
    unchangedBehavior: "production execution and user data do not change",
    riskIfNotDone: "the regression could remain unnoticed",
    technicalRisk: "low; one reversible assertion",
    productionImpact: "none until a separately authorized execution",
    rationale: "a deterministic smoke gap is visible",
    evidence: ["fixture evidence"],
    graphifyEvidence: ["fresh structural graph"],
    candidateRank: 1,
    risk: "low and reversible",
    safetyClassification: "SAFE" as const,
    exactFiles: ["scripts/smoke-ayas-machine-health.ts"],
    expectedDiffScope: "+1 assertion",
    testsPlanned: ["smoke-ayas-development-status"],
    estimatedCost: "zero-cost" as const,
    mutationKind: "test-fixture-mutation",
    ...overrides,
  };
}

const NOW = "2026-09-15T12:00:00.000Z"; // same Istanbul day (UTC+3) as the fixtures' default createdAt above

async function main() {
  // --- classifier: exact spec example phrasings ---------------------------
  const positivePhrasings = [
    "Bugün hangi yönlerini geliştirmeye çalıştın?",
    "Bugün kendinde ne geliştirmeye çalıştın?",
    "Ne onay bekliyorsun?",
    "Benden ne onay bekliyorsun?",
    "Bugün hangi geliştirmeleri düşündün?",
    "Hangilerini reddettin?",
    "Hangilerini daha sonraya bıraktın?",
    "Neden bunu geliştirmek istiyorsun?",
    "Bunu onaylarsam bana ne faydası olacak?",
    "Onay verirsem tam olarak ne yapacaksın?",
    "Neden bunu kendin yapamıyorsun?",
    "Şu anda recovery gereken bir iş var mı?",
  ];
  await scenario("the classifier recognizes every spec example phrasing (multiple distinct Turkish phrasings, not one hardcoded string)", () => {
    for (const phrase of positivePhrasings) assert.ok(isAyasDevelopmentStatusQuery(phrase), `expected a match: "${phrase}"`);
  });

  await scenario("the classifier does not fire on ordinary production-pipeline or unrelated chat (no regression on normal AYAS chat)", () => {
    const negativePhrasings = [
      "Bu videoyu nasıl geliştirebilirim?",
      "Bugün hava nasıl?",
      "İstanbul'un Fethi projesi ne durumda?",
      "Kaç proje tamamlandı?",
      "Merhaba nasılsın",
      "Yarın müsait misin?",
      "Bu sahneyi biraz daha geliştirebilir miyiz?",
      "Videoyu ne zaman bırakacaksın render'a?",
      "Bu projeyi kabul ettin mi?",
      "Projeyi bekliyor musun?",
    ];
    for (const phrase of negativePhrasings) assert.equal(isAyasDevelopmentStatusQuery(phrase), false, `expected NO match: "${phrase}"`);
  });

  // --- zero-activity / zero-pending ----------------------------------------
  await scenario("an empty store reports zero activity today and zero pending, honestly, without manufacturing work", () => {
    const data = computeAyasDevelopmentStatusData("bugün ne geliştirmeye çalıştın", NOW, { rootDir: root() });
    assert.equal(data.connected, true);
    assert.equal(data.hasAnyActivityToday, false);
    assert.equal(data.hasAnyPending, false);
    assert.equal(data.pendingCount, 0);
    const summary = buildAyasDevelopmentStatusSummary(data);
    assert.match(summary, /Bugün kayıtlı yeni bir gelişim girişimim yok/);
    assert.match(summary, /Şu anda senden onay bekleyen bir öneri yok/);
  });

  // --- one pending SAFE proposal, created today -----------------------------
  await scenario("exactly one pending SAFE proposal created today is surfaced with its full explanation", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    inbox.createProposal(proposalInput({ objective: "tek öneri" }));
    const data = computeAyasDevelopmentStatusData("bugün ne onay bekliyor", NOW, { rootDir });
    assert.equal(data.pendingCount, 1);
    assert.equal(data.pending[0]?.objective, "tek öneri");
    assert.equal(data.pending[0]?.expectedUserBenefit, "the regression is caught before it reaches the user");
    assert.equal(data.todayCreated.length, 1);
    assert.equal(data.hasAnyActivityToday, true);
    const summary = buildAyasDevelopmentStatusSummary(data);
    assert.match(summary, /tek öneri/);
  });

  // --- multiple pending SAFE proposals ---------------------------------------
  await scenario("multiple pending SAFE proposals are all surfaced", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    inbox.createProposal(proposalInput({ objective: "öneri A" }));
    inbox.createProposal(proposalInput({ objective: "öneri B" }));
    const data = computeAyasDevelopmentStatusData("ne onay bekliyorsun", NOW, { rootDir });
    assert.equal(data.pendingCount, 2);
    const objectives = data.pending.map((p) => p.objective).sort();
    assert.deepEqual(objectives, ["öneri A", "öneri B"]);
  });

  // --- REVIEW_REQUIRED / FORBIDDEN_AUTONOMOUS ---------------------------------
  await scenario("a REVIEW_REQUIRED pending proposal is surfaced with its safety classification", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    inbox.createProposal(proposalInput({ objective: "insan incelemesi gerekli", safetyClassification: "REVIEW_REQUIRED" }));
    const data = computeAyasDevelopmentStatusData("ne onay bekliyorsun", NOW, { rootDir });
    assert.equal(data.pending[0]?.safetyClassification, "REVIEW_REQUIRED");
  });

  await scenario("a FORBIDDEN_AUTONOMOUS pending proposal is surfaced with its safety classification", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    inbox.createProposal(proposalInput({ objective: "AYAS kendi başına yapamaz", safetyClassification: "FORBIDDEN_AUTONOMOUS" }));
    const data = computeAyasDevelopmentStatusData("ne onay bekliyorsun", NOW, { rootDir });
    assert.equal(data.pending[0]?.safetyClassification, "FORBIDDEN_AUTONOMOUS");
  });

  // --- DEFERRED ---------------------------------------------------------------
  await scenario("a DEFERRED proposal still awaiting its next-eligible time is NOT re-offered as pending, but IS visible in recent history", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    const p = inbox.createProposal(proposalInput({ objective: "daha sonraya bırakılan" }));
    inbox.decide(p.proposalId, "LATER", NOW);
    const data = computeAyasDevelopmentStatusData("hangilerini daha sonraya bıraktın", NOW, { rootDir });
    assert.equal(data.pending.find((x) => x.objective === "daha sonraya bırakılan"), undefined);
    assert.ok(data.recentDeferred.some((x) => x.objective === "daha sonraya bırakılan"));
  });

  await scenario("a DEFERRED proposal whose next-eligible time has passed reappears as pending", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    const p = inbox.createProposal(proposalInput({ objective: "tekrar gündemde" }));
    inbox.decide(p.proposalId, "LATER", "2026-09-01T00:00:00.000Z");
    const data = computeAyasDevelopmentStatusData("ne onay bekliyorsun", NOW, { rootDir });
    assert.ok(data.pending.some((x) => x.objective === "tekrar gündemde"));
  });

  // --- RECOVERY_REQUIRED --------------------------------------------------------
  await scenario("a RECOVERY_REQUIRED proposal is surfaced, and the summary states no automatic replay is offered", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    const p = inbox.createProposal(proposalInput({ objective: "belirsiz sonuç" }));
    inbox.decide(p.proposalId, "APPROVE", NOW);
    const reservation = inbox.reserveApproval(p.proposalId, p.proposalHash, p.baseHead, p.exactFiles, NOW);
    inbox.finalizeApproval(reservation.reservationId, "RECOVERY_REQUIRED", NOW);
    const data = computeAyasDevelopmentStatusData("şu anda recovery gereken bir iş var mı", NOW, { rootDir });
    assert.equal(data.recoveryRequired.length, 1);
    assert.equal(data.recoveryRequired[0]?.objective, "belirsiz sonuç");
    const summary = buildAyasDevelopmentStatusSummary(data);
    assert.match(summary, /RECOVERY_REQUIRED/);
    assert.match(summary, /otomatik olarak tekrar denenmez/);
  });

  // --- COMPLETED today / REJECTED ------------------------------------------------
  await scenario("a proposal executed and completed today is counted in today's completed list", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    const p = inbox.createProposal(proposalInput({ objective: "tamamlanan iş" }));
    inbox.decide(p.proposalId, "APPROVE", NOW);
    const reservation = inbox.reserveApproval(p.proposalId, p.proposalHash, p.baseHead, p.exactFiles, NOW);
    inbox.recordResult(
      { resultId: "r1", proposalId: p.proposalId, authorizationId: reservation.authorizationId, startedAt: NOW, completedAt: NOW, changedFiles: p.exactFiles, diffFingerprint: "x", testsRun: ["t"], testResults: ["PASS"], outcome: "COMPLETED", gateAuditIdentity: "g1", operatorReviewStatus: "WAITING_REVIEW" },
      "COMPLETED",
    );
    inbox.finalizeApproval(reservation.reservationId, "EXECUTED", NOW);
    const data = computeAyasDevelopmentStatusData("bugün ne yaptın", NOW, { rootDir });
    assert.ok(data.todayCompleted.some((x) => x.objective === "tamamlanan iş"));
  });

  await scenario("a rejected proposal is surfaced in recent history", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    const p = inbox.createProposal(proposalInput({ objective: "reddedilen öneri" }));
    inbox.decide(p.proposalId, "REJECT", NOW);
    const data = computeAyasDevelopmentStatusData("hangilerini reddettin", NOW, { rootDir });
    assert.ok(data.recentRejected.some((x) => x.objective === "reddedilen öneri"));
  });

  // --- today vs older distinction -----------------------------------------------
  await scenario("a proposal created on an earlier day is NOT counted as today's, but still appears in pending while unresolved", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    inbox.createProposal(proposalInput({ objective: "dünden kalan", createdAt: "2026-09-10T09:00:00.000Z" }));
    const data = computeAyasDevelopmentStatusData("ne onay bekliyorsun", NOW, { rootDir });
    assert.equal(data.todayCreated.length, 0);
    assert.ok(data.pending.some((x) => x.objective === "dünden kalan"));
  });

  // --- benefit-question resolution -------------------------------------------
  await scenario("isAyasDevelopmentBenefitQuery recognizes benefit-style phrasing", () => {
    assert.ok(isAyasDevelopmentBenefitQuery("Bunu onaylarsam bana ne faydası olacak?"));
    assert.ok(isAyasDevelopmentBenefitQuery("Onay verirsem tam olarak ne yapacaksın?"));
    assert.equal(isAyasDevelopmentBenefitQuery("Bugün ne yaptın?"), false);
  });

  await scenario("a benefit question with exactly one pending proposal resolves to it, unambiguously, with full explanation", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    inbox.createProposal(proposalInput({ objective: "tek aday", expectedUserBenefit: "daha hızlı geri bildirim", riskIfNotDone: "fark edilmeyen regresyon" }));
    const data = computeAyasDevelopmentStatusData("Bunu onaylarsam bana ne faydası olacak?", NOW, { rootDir });
    assert.equal(data.benefitFocus?.kind, "single");
    assert.equal(data.benefitFocus?.kind === "single" ? data.benefitFocus.proposal.objective : null, "tek aday");
    const summary = buildAyasDevelopmentStatusSummary(data);
    assert.match(summary, /tek aday/);
    assert.match(summary, /daha hızlı geri bildirim/);
    assert.match(summary, /fark edilmeyen regresyon/);
  });

  await scenario("a benefit question with zero pending proposals says so honestly, without guessing", () => {
    const data = computeAyasDevelopmentStatusData("Bunu onaylarsam ne olur?", NOW, { rootDir: root() });
    assert.equal(data.benefitFocus?.kind, "none");
    const summary = buildAyasDevelopmentStatusSummary(data);
    assert.match(summary, /bulamadım|yok/);
  });

  await scenario("a benefit question with MULTIPLE pending proposals asks for clarification instead of guessing which one", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    inbox.createProposal(proposalInput({ objective: "aday bir" }));
    inbox.createProposal(proposalInput({ objective: "aday iki" }));
    const data = computeAyasDevelopmentStatusData("Bunu onaylarsam bana ne faydası olacak?", NOW, { rootDir });
    assert.equal(data.benefitFocus?.kind, "ambiguous");
    const summary = buildAyasDevelopmentStatusSummary(data);
    assert.match(summary, /netleştirir misin|hangisini/);
    assert.match(summary, /aday bir/);
    assert.match(summary, /aday iki/);
  });

  // --- missing explanation handled safely -------------------------------------
  await scenario("a proposal with a missing/blank explanation field renders a safe fallback, never a blank or crash", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    inbox.createProposal(proposalInput({ objective: "eksik açıklamalı", expectedUserBenefit: "   ", currentProblem: "" }));
    const data = computeAyasDevelopmentStatusData("Bunu onaylarsam bana ne faydası olacak?", NOW, { rootDir });
    assert.equal(data.pending[0]?.expectedUserBenefit, null);
    assert.equal(data.pending[0]?.currentProblem, null);
    assert.ok(data.pending[0]?.missingExplanation.length ?? 0 > 0);
    assert.equal(data.pending[0]?.approvalReady, false);
    const summary = buildAyasDevelopmentStatusSummary(data);
    assert.match(summary, /belirtilmemiş/);
  });

  // --- fail-closed on corrupt durable state -------------------------------------
  await scenario("a corrupt approval-inbox.json fails closed (connected: false, honest message), never throws or fabricates", () => {
    const rootDir = root();
    fs.mkdirSync(path.join(rootDir, "autonomy"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "autonomy", "approval-inbox.json"), "{ not valid json");
    const data = computeAyasDevelopmentStatusData("bugün ne geliştirdin", NOW, { rootDir });
    assert.equal(data.connected, false);
    const summary = buildAyasDevelopmentStatusSummary(data);
    assert.match(summary, /ulaşılamıyor/);
  });

  // --- no authority side effects ------------------------------------------------
  await scenario("computing status (both general and benefit mode) never mutates the durable approval-inbox.json — bytes are identical before and after", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    inbox.createProposal(proposalInput({ objective: "değişmemesi gereken" }));
    const stateFile = path.join(rootDir, "autonomy", "approval-inbox.json");
    const before = fs.readFileSync(stateFile, "utf8");
    computeAyasDevelopmentStatusData("ne onay bekliyorsun", NOW, { rootDir });
    computeAyasDevelopmentStatusData("Bunu onaylarsam bana ne faydası olacak?", NOW, { rootDir });
    const after = fs.readFileSync(stateFile, "utf8");
    assert.equal(after, before, "a read-only status query must never write to the durable approval inbox");
  });

  await scenario("the module never imports a decision/reservation/gate/daemon authority surface — pure read projection only", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "ayas", "execution", "AyasDevelopmentStatus.ts"), "utf8");
    assert.doesNotMatch(src, /AyasExecutionGateStore|AyasAutonomyDaemon|\.decide\(|reserveApproval|finalizeApproval|consumeApproval|createAyasApprovalInboxStore/);
  });

  await scenario("no file anywhere under the AYAS chat/reasoning/tool tree can reach an approval decision, reservation, or finalization — chat structurally cannot bypass the approval authority boundary, no matter what the user types (\"tamam yap\", \"hepsini onayla\", …)", () => {
    const ayasDir = path.join(process.cwd(), "src", "lib", "ayas");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && entry.name.endsWith(".ts")) {
          const text = fs.readFileSync(full, "utf8");
          if (/reserveApproval|finalizeApproval|consumeApproval|\binbox\.decide\(/.test(text)) offenders.push(full);
        }
      }
    };
    walk(ayasDir);
    assert.deepEqual(offenders, [], `unexpected approval-authority reference(s): ${offenders.join(", ")}`);
  });

  console.log(`AYAS development status smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-development-status", scenarios: count }));
}
main().catch((error) => { console.error("AYAS development status smoke FAILED:", error); process.exitCode = 1; });
