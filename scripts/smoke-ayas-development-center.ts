import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AyasDevelopmentCenter } from "../src/components/brain/AyasDevelopmentCenter";
import { BRAIN_PANELS } from "../src/components/brain/brainCore";
import { createAyasApprovalInboxStore, AyasApprovalInboxStoreError } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { buildAyasApprovalInboxView, isAyasDevelopmentApprovalReady, istanbulDay, type AyasDevelopmentPatchArtifact } from "../src/lib/brain/autonomy/AyasApprovalInboxView";
import type { AyasApprovalInboxReadState, AyasInboxProposalRead } from "../src/lib/brain/autonomy/AyasApprovalInboxReader";

const NOW = "2026-09-15T12:00:00.000Z";
let count = 0;
async function scenario(name: string, body: () => void | Promise<void>) { await body(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

function proposal(overrides: Partial<AyasInboxProposalRead> = {}): AyasInboxProposalRead {
  return {
    proposalId: "ayas-proposal-safe",
    proposalHash: "hash-safe",
    createdAt: NOW,
    lastUpdatedAt: NOW,
    baseHead: "b6808e314f33337875c7906247e09a4a055f2401",
    objective: "AYAS yanıt gecikmesini görünür kıl",
    currentProblem: "Kullanıcı uzun yanıt sırasında ilerlemeyi göremiyor.",
    selectionReason: "Ölçülen bekleme süresi ve kullanıcı geri bildirimi aynı sorunu gösteriyor.",
    expectedUserBenefit: "Yanıt hazırlanırken sistemin çalıştığını göreceksin ve gereksiz tekrar göndermeyeceksin.",
    expectedBehaviorChange: "Uzun yanıtlarda mevcut bekleme alanında ilerleme durumu gösterilecek.",
    unchangedBehavior: "Model seçimi, yanıt içeriği ve üretim yürütme kapısı değişmeyecek.",
    riskIfNotDone: "Belirsiz bekleme, aynı isteğin tekrar gönderilmesine yol açabilir.",
    technicalRisk: "Düşük; yalnızca mevcut UI durumunun gösterimi değişir.",
    productionImpact: "Üretim yürütmesi yok; yalnızca AYAS arayüzü etkilenir.",
    rationale: "Ölçülen gecikmeyi daha anlaşılır yap.",
    evidence: ["chat duration fixture"],
    graphifyEvidence: ["BrainCoreConsole → BrainConsoleView"],
    exactFiles: ["src/components/brain/BrainConsoleView.tsx"],
    expectedDiffScope: "Bir mevcut durum satırı ve regresyon testi",
    risk: "low and reversible",
    safetyClassification: "SAFE",
    testsPlanned: ["smoke-brain-core-ui", "npx tsc --noEmit"],
    status: "PENDING",
    mutationKind: "test-fixture-mutation",
    ...overrides,
  };
}
function state(proposals: readonly AyasInboxProposalRead[], decisions: AyasApprovalInboxReadState["decisions"] = [], results: AyasApprovalInboxReadState["results"] = []): AyasApprovalInboxReadState { return { proposals, decisions, results }; }
function htmlFor(input: AyasApprovalInboxReadState): string { return renderToStaticMarkup(createElement(AyasDevelopmentCenter, { inbox: buildAyasApprovalInboxView(input, NOW), onDecision: () => undefined })); }

async function main() {
  await scenario("main AYAS panel registry exposes Gelişim Merkezi", () => assert.ok(BRAIN_PANELS.some((item) => item.id === "development" && item.connected)));
  // Stage 11: the home "Gelişim Merkezi" card became the Control Center's approvals/development tiles and
  // owner-attention items, which open this panel through the generic select-and-scroll `onOpenPanel`.
  await scenario("main Brain UI has a first-class development entry and navigation handler", () => { const src = fs.readFileSync(path.join(process.cwd(), "src/components/brain/BrainConsoleView.tsx"), "utf8"); assert.match(src, /AyasDomainTiles/); assert.match(src, /onOpenPanel/); assert.match(src, /case "development"/); const model = fs.readFileSync(path.join(process.cwd(), "src/lib/brain/ui/AyasControlCenterModel.ts"), "utf8"); assert.match(model, /id: "approvals", title: "Onaylar"[^}]*panel: "development"/); });
  await scenario("pending SAFE proposal appears", () => assert.match(htmlFor(state([proposal()])), /AYAS yanıt gecikmesini görünür kıl/));
  await scenario("expectedUserBenefit is displayed as the approval answer", () => assert.match(htmlFor(state([proposal()])), /Yanıt hazırlanırken sistemin çalıştığını göreceksin/));
  await scenario("currentProblem is displayed", () => assert.match(htmlFor(state([proposal()])), /Kullanıcı uzun yanıt sırasında ilerlemeyi göremiyor/));
  await scenario("riskIfNotDone is displayed", () => assert.match(htmlFor(state([proposal()])), /aynı isteğin tekrar gönderilmesine yol açabilir/));
  await scenario("technical risk and safety classification are displayed", () => { const html = htmlFor(state([proposal()])); assert.match(html, /Düşük; yalnızca mevcut UI/); assert.match(html, /SAFE/); });
  await scenario("exact files are available", () => assert.match(htmlFor(state([proposal()])), /BrainConsoleView\.tsx/));
  await scenario("test plan is available", () => assert.match(htmlFor(state([proposal()])), /smoke-brain-core-ui/));
  await scenario("Graphify evidence is available", () => assert.match(htmlFor(state([proposal()])), /BrainCoreConsole → BrainConsoleView/));
  await scenario("production impact is available", () => assert.match(htmlFor(state([proposal()])), /Üretim yürütmesi yok/));
  await scenario("missing human explanation is not approval-ready", () => assert.equal(isAyasDevelopmentApprovalReady(proposal({ expectedUserBenefit: undefined })), false));
  await scenario("Store authority refuses a legacy SAFE proposal with incomplete explanation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-dev-store-"));
    const store = createAyasApprovalInboxStore({ rootDir: root });
    const legacy = proposal({ expectedUserBenefit: undefined });
    store.save({ schemaVersion: "1", revision: 0, proposals: [{ ...legacy, schemaVersion: "1", baseBranch: "test", candidateRank: 1, estimatedCost: "zero-cost", createdBy: "ayas-daemon" } as never], decisions: [], results: [] });
    assert.throws(() => store.decide(legacy.proposalId, "APPROVE", NOW), (error: unknown) => error instanceof AyasApprovalInboxStoreError && error.code === "AYAS_INBOX_UNSAFE_APPROVAL");
  });
  await scenario("SAFE exposes approve, reject and later decisions", () => { const html = htmlFor(state([proposal()])); assert.match(html, />ONAYLA</); assert.match(html, />REDDET</); assert.match(html, />DAHA SONRA</); });
  await scenario("SAFE approval uses a concise second confirmation before authority creation", () => { const src = fs.readFileSync(path.join(process.cwd(), "src/components/brain/AyasDevelopmentCenter.tsx"), "utf8"); assert.match(src, /Onay verirsem ne olacak\?/); assert.match(src, /ONAYI KESİNLEŞTİR/); assert.match(src, /tek kullanımlık bir yürütme yetkisi oluşturur/); });
  await scenario("REVIEW_REQUIRED is not ordinary-approvable", () => { const html = htmlFor(state([proposal({ proposalId: "review", safetyClassification: "REVIEW_REQUIRED" })])); assert.match(html, /İNSAN İNCELEMESİ GEREKİYOR/); assert.doesNotMatch(html, />ONAYLA</); });
  await scenario("FORBIDDEN_AUTONOMOUS is not ordinary-approvable", () => { const html = htmlFor(state([proposal({ proposalId: "forbidden", safetyClassification: "FORBIDDEN_AUTONOMOUS" })])); assert.match(html, /AYAS BUNU KENDİ BAŞINA UYGULAYAMAZ/); assert.doesNotMatch(html, />ONAYLA</); });
  await scenario("RECOVERY_REQUIRED is visible with uncertainty guidance", () => { const html = htmlFor(state([proposal({ proposalId: "recovery", status: "RECOVERY_REQUIRED" })])); assert.match(html, /RECOVERY_REQUIRED/); assert.match(html, /Yürütme sonucu belirsiz olabilir/); });
  await scenario("recovery item has no ordinary retry control", () => assert.doesNotMatch(htmlFor(state([proposal({ proposalId: "recovery", status: "RECOVERY_REQUIRED" })])), /TEKRAR ÇALIŞTIR|YENİDEN DENE/));
  await scenario("rejected history item is not pending", () => { const view = buildAyasApprovalInboxView(state([proposal({ status: "REJECTED" })]), NOW); assert.equal(view.pending.length, 0); assert.equal(view.history.length, 1); });
  await scenario("completed history item is not pending", () => { const view = buildAyasApprovalInboxView(state([proposal({ status: "COMPLETED" })]), NOW); assert.equal(view.pending.length, 0); assert.equal(view.history.length, 1); });
  await scenario("DEFERRED is displayed correctly in history", () => assert.match(htmlFor(state([proposal({ status: "DEFERRED", nextEligibleAt: "2026-09-16T12:00:00.000Z" })])), /DAHA SONRA/));
  await scenario("empty inbox fabricates no activity", () => { const html = htmlFor(state([])); assert.match(html, /Onay bekleyen gerçek bir öneri yok/); assert.match(html, /Bugün değerlendirilmiş bir gelişim adayı yok/); assert.match(html, /Henüz kalıcı bir karar/); });
  await scenario("today contains actual evaluated statuses without changing pending semantics", () => { const view = buildAyasApprovalInboxView(state([proposal(), proposal({ proposalId: "done", status: "COMPLETED" })]), NOW); assert.equal(view.today.length, 2); assert.equal(view.pending.length, 1); });
  await scenario("daily hygiene hides yesterday COMPLETED and STALE records from the main history projection", () => {
    const yesterday = "2026-09-14T12:00:00.000Z";
    const view = buildAyasApprovalInboxView(state([proposal({ proposalId: "completed-yesterday", status: "COMPLETED", createdAt: yesterday }), proposal({ proposalId: "stale-yesterday", status: "STALE", createdAt: yesterday })]), NOW);
    assert.deepEqual(view.history, []);
  });
  await scenario("daily hygiene keeps yesterday PENDING and APPROVED-pending-execution records visible", () => {
    const yesterday = "2026-09-14T12:00:00.000Z";
    const pending = proposal({ proposalId: "pending-yesterday", createdAt: yesterday });
    const approved = proposal({ proposalId: "approved-yesterday", status: "APPROVED", createdAt: yesterday });
    const view = buildAyasApprovalInboxView(state([pending, approved]), NOW);
    assert.deepEqual(view.pending.map((item) => item.proposalId), [pending.proposalId]);
    assert.deepEqual(view.history.map((item) => item.proposalId), [approved.proposalId]);
  });
  await scenario("daily hygiene keeps yesterday RECOVERY_REQUIRED visible but keeps today's terminal result visible normally", () => {
    const recovery = proposal({ proposalId: "recovery-yesterday", status: "RECOVERY_REQUIRED", createdAt: "2026-09-14T12:00:00.000Z" });
    const todayDone = proposal({ proposalId: "completed-today", status: "COMPLETED" });
    const view = buildAyasApprovalInboxView(state([recovery, todayDone]), NOW);
    assert.deepEqual(view.history.map((item) => item.proposalId).sort(), [recovery.proposalId, todayDone.proposalId].sort());
  });
  await scenario("Istanbul midnight boundary is shared by the daily projection", () => {
    assert.equal(istanbulDay("2026-09-14T20:59:59.999Z"), "2026-09-14");
    assert.equal(istanbulDay("2026-09-14T21:00:00.000Z"), "2026-09-15");
  });
  await scenario("daily projection never mutates durable approval state", () => {
    const durable = state([proposal({ proposalId: "completed-yesterday", status: "COMPLETED", createdAt: "2026-09-14T12:00:00.000Z" })]);
    const before = JSON.stringify(durable); buildAyasApprovalInboxView(durable, NOW);
    assert.equal(JSON.stringify(durable), before);
  });
  await scenario("durable decision and outcome are attached to history", () => { const p = proposal({ status: "COMPLETED" }); const view = buildAyasApprovalInboxView(state([p], [{ decisionId: "d1", proposalId: p.proposalId, decision: "APPROVE", decidedAt: NOW, reservedAt: NOW, finalizedAt: NOW, finalizationOutcome: "EXECUTED" }], [{ resultId: "r1", proposalId: p.proposalId, completedAt: NOW, outcome: "COMPLETED", testsRun: ["smoke"], testResults: ["PASS"] }]), NOW); assert.equal(view.history[0]?.decision?.decision, "APPROVE"); assert.equal(view.history[0]?.result?.outcome, "COMPLETED"); });
  await scenario("responsive CSS collapses facts and preserves touch-sized actions", () => { const css = fs.readFileSync(path.join(process.cwd(), "src/components/brain/BrainCore.css"), "utf8"); assert.match(css, /\.bc-dev__facts \{ grid-template-columns: 1fr; \}/); assert.match(css, /min-height: 44px/); });
  await scenario("APPROVED proposal exposes YÜRÜT", () => assert.match(htmlFor(state([proposal({ status: "APPROVED" })])), />YÜRÜT</));
  await scenario("durable one-click correction: an APPROVED proposal whose decision carries the owner-approved reason does NOT expose the legacy YÜRÜT control", () => {
    const p = proposal({ status: "APPROVED" });
    const html = htmlFor(state([p], [{ decisionId: "d1", proposalId: p.proposalId, decision: "APPROVE", decidedAt: NOW, reason: "owner-approved: pending execution enablement" }]));
    assert.doesNotMatch(html, />YÜRÜT</);
  });
  await scenario("an APPROVED proposal from the legacy manual ONAYLA flow (no owner-approved reason) still exposes YÜRÜT, unchanged", () => {
    const p = proposal({ status: "APPROVED" });
    const html = htmlFor(state([p], [{ decisionId: "d1", proposalId: p.proposalId, decision: "APPROVE", decidedAt: NOW }]));
    assert.match(html, />YÜRÜT</);
  });
  for (const status of ["PENDING", "REJECTED", "DEFERRED", "RESERVED", "COMPLETED", "ABANDONED", "RECOVERY_REQUIRED", "STALE", "FAILED"] as const) {
    await scenario(`${status} does not expose YÜRÜT`, () => assert.doesNotMatch(htmlFor(state([proposal({ status })])), />YÜRÜT</));
  }
  await scenario("RECOVERY_REQUIRED exposes neither YÜRÜT nor ordinary replay", () => { const html = htmlFor(state([proposal({ status: "RECOVERY_REQUIRED" })])); assert.doesNotMatch(html, />YÜRÜT</); assert.doesNotMatch(html, /TEKRAR ÇALIŞTIR|YENİDEN DENE/); assert.match(html, /Yürütme sonucu belirsiz olabilir/); });
  await scenario("M16: a STALE proposal shows the Turkish 'lost currency' label and lands in history, not pending", () => {
    const p = proposal({ status: "STALE" });
    const view = buildAyasApprovalInboxView(state([p]), NOW);
    assert.equal(view.pending.length, 0);
    assert.equal(view.history.length, 1);
    assert.match(htmlFor(state([p])), /GÜNCELLİĞİNİ YİTİRDİ/);
  });
  await scenario("M16: a real (non-empty) PASS validator result is visibly rendered, not silently dropped", () => {
    const p = proposal({ status: "COMPLETED" });
    const html = htmlFor(state([p], [], [{ resultId: "r1", proposalId: p.proposalId, completedAt: NOW, outcome: "COMPLETED", testsRun: ["scripts/smoke-ayas-example.ts"], testResults: ["PASS"] }]));
    assert.match(html, /Testler: PASS/);
  });
  await scenario("M16: a real validator FAILURE is visibly rendered too, not hidden behind a generic success message", () => {
    const p = proposal({ status: "RECOVERY_REQUIRED" });
    const html = htmlFor(state([p], [], [{ resultId: "r1", proposalId: p.proposalId, completedAt: NOW, outcome: "FAILED", testsRun: ["scripts/smoke-ayas-example.ts"], testResults: ["FAIL"] }]));
    assert.match(html, /Testler: FAIL/);
  });
  await scenario("YÜRÜT opens a second confirmation before dispatch", () => { const html = renderToStaticMarkup(createElement(AyasDevelopmentCenter, { inbox: buildAyasApprovalInboxView(state([proposal({ status: "APPROVED" })]), NOW), onExecute: () => undefined })); assert.match(html, />YÜRÜT</); assert.doesNotMatch(html, /YÜRÜTMEYİ BAŞLAT/); });
  await scenario("execution confirmation states one-shot consumption", () => { const src = fs.readFileSync(path.join(process.cwd(), "src/components/brain/AyasDevelopmentCenter.tsx"), "utf8"); assert.match(src, /Yürütürsem ne olacak\?/); assert.match(src, /YÜRÜTMEYİ BAŞLAT/); assert.match(src, /tek kullanımlıktır/); });
  await scenario("executingId disables the YÜRÜT control for that proposal", () => { const p = proposal({ status: "APPROVED" }); const html = renderToStaticMarkup(createElement(AyasDevelopmentCenter, { inbox: buildAyasApprovalInboxView(state([p]), NOW), executingId: p.proposalId, onExecute: () => undefined })); assert.match(html, /YÜRÜTÜLÜYOR…/); });
  await scenario("YÜRÜT only calls setConfirming — the client never dispatches onExecute before the confirmation screen", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/brain/AyasDevelopmentCenter.tsx"), "utf8");
    const control = src.slice(src.indexOf("function ExecuteControl"));
    const initialButton = control.slice(control.lastIndexOf("return (\n    <div className=\"bc-dev__actions\">"));
    assert.doesNotMatch(initialButton.split("YÜRÜT<")[0] ?? "", /onExecute\?\.\(/, "the initial YÜRÜT button must only open confirmation, never dispatch directly");
  });
  await scenario("VAZGEÇ (cancel) never calls onExecute — it only resets local confirmation state", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/brain/AyasDevelopmentCenter.tsx"), "utf8");
    const control = src.slice(src.indexOf("function ExecuteControl"), src.indexOf("function TimelineCard"));
    const cancelButtonLine = control.split("\n").find((line) => line.includes("VAZGEÇ"));
    assert.ok(cancelButtonLine);
    assert.doesNotMatch(cancelButtonLine ?? "", /onExecute/, "VAZGEÇ must never reference onExecute");
    assert.match(cancelButtonLine ?? "", /setConfirming\(false\)/);
  });
  await scenario("YÜRÜTMEYİ BAŞLAT is the only control wired to onExecute, with the exact proposalId", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/brain/AyasDevelopmentCenter.tsx"), "utf8");
    const control = src.slice(src.indexOf("function ExecuteControl"), src.indexOf("function TimelineCard"));
    const dispatchLine = control.split("\n").find((line) => line.includes("onExecute?.({ proposalId: proposal.proposalId })"));
    assert.ok(dispatchLine, "exactly one dispatch call, bound to this proposal's own id");
    assert.match(dispatchLine ?? "", /YÜRÜTMEYİ BAŞLAT/);
  });
  await scenario("a returned execution error for this proposal renders a visible, non-silent message", () => {
    const p = proposal({ status: "APPROVED" });
    const html = renderToStaticMarkup(createElement(AyasDevelopmentCenter, { inbox: buildAyasApprovalInboxView(state([p]), NOW), executionError: { proposalId: p.proposalId, code: "AYAS_MUTATION_KIND_UNKNOWN" }, onExecute: () => undefined }));
    assert.match(html, /Bu öneri için kayıtlı bir uygulama bulunamadı/);
    assert.match(html, /role="alert"/);
  });
  await scenario("an unrecognized error code still renders a visible fallback message, never nothing", () => {
    const p = proposal({ status: "APPROVED" });
    const html = renderToStaticMarkup(createElement(AyasDevelopmentCenter, { inbox: buildAyasApprovalInboxView(state([p]), NOW), executionError: { proposalId: p.proposalId, code: "SOME_FUTURE_CODE" }, onExecute: () => undefined }));
    assert.match(html, /SOME_FUTURE_CODE/);
  });
  await scenario("an execution error for a DIFFERENT proposal never bleeds into this one", () => {
    const p = proposal({ status: "APPROVED" });
    const html = renderToStaticMarkup(createElement(AyasDevelopmentCenter, { inbox: buildAyasApprovalInboxView(state([p]), NOW), executionError: { proposalId: "some-other-proposal", code: "AYAS_MUTATION_KIND_UNKNOWN" }, onExecute: () => undefined }));
    assert.doesNotMatch(html, /Bu öneri için kayıtlı bir uygulama bulunamadı/);
  });
  await scenario("no execution error present renders no alert at all", () => {
    const p = proposal({ status: "APPROVED" });
    const html = renderToStaticMarkup(createElement(AyasDevelopmentCenter, { inbox: buildAyasApprovalInboxView(state([p]), NOW), onExecute: () => undefined }));
    assert.doesNotMatch(html, /role="alert"/);
  });
  await scenario("M17: a statically pre-written (non-artifact) proposal renders no patch/diff panel", () => {
    const html = htmlFor(state([proposal()]));
    assert.doesNotMatch(html, /AYAS bu değişikliği kendi oluşturdu/);
    assert.doesNotMatch(html, /Patch hash/);
  });
  await scenario("M17: a sandbox-drafted proposal's exact diff, patchHash, validators, and sandbox result all render", () => {
    const p = proposal({ mutationKind: "patch-artifact:v1" });
    const view = buildAyasApprovalInboxView(state([p]), NOW);
    const patchArtifact: AyasDevelopmentPatchArtifact = {
      patchArtifactId: "ayas-patch-artifact-fixture",
      patchHash: "fixture-patch-hash-1234567890",
      generatorIdentity: "ayas-detector:error-code-contract-gap-v1",
      diffPreview: [{ filePath: "scripts/smoke-ayas-error-code-contract-widget.ts", content: 'new WidgetError("X", "y");\n', isNewFile: true }],
      validatorScripts: ["scripts/smoke-ayas-error-code-contract-widget.ts"],
      sandboxValidationSummary: ["typecheck-project: PASS", "scripts/smoke-ayas-error-code-contract-widget.ts: PASS"],
    };
    const enrichedView = { ...view, pending: view.pending.map((item) => ({ ...item, patchArtifact })) };
    const html = renderToStaticMarkup(createElement(AyasDevelopmentCenter, { inbox: enrichedView, onDecision: () => undefined }));
    assert.match(html, /AYAS bu değişikliği kendi oluşturdu/);
    assert.match(html, /fixture-patch-hash-1234567890/);
    assert.match(html, /new WidgetError/);
    assert.match(html, /typecheck-project: PASS/);
    assert.match(html, /scripts\/smoke-ayas-error-code-contract-widget\.ts/);
  });
  console.log(`AYAS Gelişim Merkezi smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-development-center", scenarios: count }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
