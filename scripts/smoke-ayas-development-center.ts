import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AyasDevelopmentCenter } from "../src/components/brain/AyasDevelopmentCenter";
import { BRAIN_PANELS } from "../src/components/brain/brainCore";
import { createAyasApprovalInboxStore, AyasApprovalInboxStoreError } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { buildAyasApprovalInboxView, isAyasDevelopmentApprovalReady } from "../src/lib/brain/autonomy/AyasApprovalInboxView";
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
    ...overrides,
  };
}
function state(proposals: readonly AyasInboxProposalRead[], decisions: AyasApprovalInboxReadState["decisions"] = [], results: AyasApprovalInboxReadState["results"] = []): AyasApprovalInboxReadState { return { proposals, decisions, results }; }
function htmlFor(input: AyasApprovalInboxReadState): string { return renderToStaticMarkup(createElement(AyasDevelopmentCenter, { inbox: buildAyasApprovalInboxView(input, NOW), onDecision: () => undefined })); }

async function main() {
  await scenario("main AYAS panel registry exposes Gelişim Merkezi", () => assert.ok(BRAIN_PANELS.some((item) => item.id === "development" && item.connected)));
  await scenario("main Brain UI has a first-class development status card and navigation handler", () => { const src = fs.readFileSync(path.join(process.cwd(), "src/components/brain/BrainConsoleView.tsx"), "utf8"); assert.match(src, /bc-card-development/); assert.match(src, /onOpenDevelopment/); assert.match(src, /case "development"/); });
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
  await scenario("durable decision and outcome are attached to history", () => { const p = proposal({ status: "COMPLETED" }); const view = buildAyasApprovalInboxView(state([p], [{ decisionId: "d1", proposalId: p.proposalId, decision: "APPROVE", decidedAt: NOW, reservedAt: NOW, finalizedAt: NOW, finalizationOutcome: "EXECUTED" }], [{ resultId: "r1", proposalId: p.proposalId, completedAt: NOW, outcome: "COMPLETED", testsRun: ["smoke"], testResults: ["PASS"] }]), NOW); assert.equal(view.history[0]?.decision?.decision, "APPROVE"); assert.equal(view.history[0]?.result?.outcome, "COMPLETED"); });
  await scenario("responsive CSS collapses facts and preserves touch-sized actions", () => { const css = fs.readFileSync(path.join(process.cwd(), "src/components/brain/BrainCore.css"), "utf8"); assert.match(css, /\.bc-dev__facts \{ grid-template-columns: 1fr; \}/); assert.match(css, /min-height: 44px/); });
  console.log(`AYAS Gelişim Merkezi smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-development-center", scenarios: count }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
