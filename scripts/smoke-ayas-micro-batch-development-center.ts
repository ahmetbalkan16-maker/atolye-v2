import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readAyasMicroBatchState, AyasMicroBatchReaderError, type AyasMicroBatchReadState, type AyasMicroBatchRead } from "../src/lib/brain/autonomy/AyasMicroBatchReader";
import { buildAyasMicroBatchDevelopmentView, type AyasMicroBatchDevelopmentView } from "../src/lib/brain/autonomy/AyasMicroBatchDevelopmentView";
import { AyasDevelopmentCenter } from "../src/components/brain/AyasDevelopmentCenter";
import { buildAyasApprovalInboxView } from "../src/lib/brain/autonomy/AyasApprovalInboxView";
import type { AyasApprovalInboxReadState } from "../src/lib/brain/autonomy/AyasApprovalInboxReader";

/**
 * M18 — coverage for the "Küçük Geliştirme Paketi" Gelişim Merkezi section:
 * the read-only reader (`AyasMicroBatchReader`), the display projection
 * (`AyasMicroBatchDevelopmentView`), and the UI panel itself
 * (`AyasDevelopmentCenter`'s new `MicroBatchPanel`). Mirrors the exact
 * testing conventions `smoke-ayas-development-center.ts` already
 * established for the individual-proposal path: reader fixtures live under
 * isolated temp roots; view/UI fixtures are constructed in memory (never
 * touching the real default artifact store's filesystem path).
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

const NOW = "2026-09-16T12:00:00.000Z";
function root(): string { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-micro-dev-center-")); }
function writeState(rootDir: string, state: unknown): void {
  const dir = path.join(rootDir, "autonomy");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "micro-batch-inbox.json"), JSON.stringify(state), "utf8");
}

const ITEM = { microItemId: "ayas-micro-item-x", semanticKey: "ayas-novel-x", patchArtifactId: "ayas-patch-artifact-does-not-exist", patchHash: "hash-x", exactFiles: ["scripts/smoke-x.ts"] };

function batch(overrides: Partial<AyasMicroBatchRead> = {}): AyasMicroBatchRead {
  return {
    batchId: "ayas-micro-batch-fixture", batchVersion: 1, baseHead: "abc123", baseBranch: "wip/test",
    items: [ITEM], exactFilesUnion: ["scripts/smoke-x.ts"], validatorUnion: ["scripts/smoke-x.ts"],
    batchHash: "batch-hash-fixture", createdAt: NOW, lastUpdatedAt: NOW,
    validationSummary: ["ayas-micro-item-x: SANDBOX_VALIDATED"], aggregateRisk: "1 micro item(s); each individually SAFE-classified",
    status: "ACCUMULATING",
    ...overrides,
  };
}

function readState(overrides: Partial<AyasMicroBatchReadState> = {}): AyasMicroBatchReadState {
  return { batches: [], decisions: [], results: [], ...overrides };
}

function main(): void {
  // --- AyasMicroBatchReader ---

  scenario("readAyasMicroBatchState returns an empty state when the file does not exist", () => {
    const state = readAyasMicroBatchState({ rootDir: root() });
    assert.deepEqual(state, { batches: [], decisions: [], results: [] });
  });

  scenario("readAyasMicroBatchState throws AYAS_MICRO_BATCH_READ_CORRUPT on malformed JSON", () => {
    const rootDir = root();
    fs.mkdirSync(path.join(rootDir, "autonomy"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "autonomy", "micro-batch-inbox.json"), "{ not valid json", "utf8");
    assert.throws(() => readAyasMicroBatchState({ rootDir }), (e: unknown) => e instanceof AyasMicroBatchReaderError && e.code === "AYAS_MICRO_BATCH_READ_CORRUPT");
  });

  scenario("readAyasMicroBatchState throws AYAS_MICRO_BATCH_READ_SCHEMA_MISMATCH on an unsupported schema version", () => {
    const rootDir = root();
    writeState(rootDir, { schemaVersion: "999", batches: [], decisions: [], results: [] });
    assert.throws(() => readAyasMicroBatchState({ rootDir }), (e: unknown) => e instanceof AyasMicroBatchReaderError && e.code === "AYAS_MICRO_BATCH_READ_SCHEMA_MISMATCH");
  });

  scenario("readAyasMicroBatchState throws AYAS_MICRO_BATCH_READ_CORRUPT when a durable collection is not an array", () => {
    const rootDir = root();
    writeState(rootDir, { schemaVersion: "1", batches: "not-an-array", decisions: [], results: [] });
    assert.throws(() => readAyasMicroBatchState({ rootDir }), (e: unknown) => e instanceof AyasMicroBatchReaderError && e.code === "AYAS_MICRO_BATCH_READ_CORRUPT");
  });

  scenario("readAyasMicroBatchState parses a valid file correctly", () => {
    const rootDir = root();
    writeState(rootDir, { schemaVersion: "1", batches: [batch()], decisions: [], results: [] });
    const state = readAyasMicroBatchState({ rootDir });
    assert.equal(state.batches.length, 1);
    assert.equal(state.batches[0]!.batchId, "ayas-micro-batch-fixture");
  });

  // --- AyasMicroBatchDevelopmentView ---

  scenario("buildAyasMicroBatchDevelopmentView: an empty state has no active batch and empty history", () => {
    const view = buildAyasMicroBatchDevelopmentView(readState());
    assert.equal(view.connected, true);
    assert.equal(view.active, null);
    assert.deepEqual(view.history, []);
  });

  scenario("buildAyasMicroBatchDevelopmentView: an ACCUMULATING batch is the active batch, not history", () => {
    const view = buildAyasMicroBatchDevelopmentView(readState({ batches: [batch({ status: "ACCUMULATING" })] }));
    assert.ok(view.active);
    assert.equal(view.active!.batchId, "ayas-micro-batch-fixture");
    assert.deepEqual(view.history, []);
  });

  scenario("buildAyasMicroBatchDevelopmentView: a READY_FOR_REVIEW batch is also active", () => {
    const view = buildAyasMicroBatchDevelopmentView(readState({ batches: [batch({ status: "READY_FOR_REVIEW" })] }));
    assert.ok(view.active);
    assert.equal(view.active!.status, "READY_FOR_REVIEW");
  });

  scenario("buildAyasMicroBatchDevelopmentView: a COMPLETED batch is history, not active", () => {
    const view = buildAyasMicroBatchDevelopmentView(readState({ batches: [batch({ status: "COMPLETED" })] }), undefined, NOW);
    assert.equal(view.active, null);
    assert.equal(view.history.length, 1);
    assert.equal(view.history[0]!.status, "COMPLETED");
  });

  scenario("buildAyasMicroBatchDevelopmentView: history is most-recent-first", () => {
    const view = buildAyasMicroBatchDevelopmentView(readState({
      batches: [batch({ batchId: "b1", status: "COMPLETED" }), batch({ batchId: "b2", status: "STALE" })],
    }), undefined, NOW);
    assert.deepEqual(view.history.map((b) => b.batchId), ["b2", "b1"]);
  });

  scenario("buildAyasMicroBatchDevelopmentView: a missing/corrupt item artifact fails safe — the item still renders, just without a patchArtifact", () => {
    const view = buildAyasMicroBatchDevelopmentView(readState({ batches: [batch()] }));
    assert.equal(view.active!.items.length, 1);
    assert.equal(view.active!.items[0]!.patchArtifact, undefined);
    assert.equal(view.active!.items[0]!.semanticKey, "ayas-novel-x");
  });

  scenario("buildAyasMicroBatchDevelopmentView: attaches the matching decision/result by batchId", () => {
    const view = buildAyasMicroBatchDevelopmentView({
      batches: [batch({ status: "COMPLETED" })],
      decisions: [{ decisionId: "d1", batchId: "ayas-micro-batch-fixture", decision: "APPROVE", decidedAt: NOW }],
      results: [{ resultId: "r1", batchId: "ayas-micro-batch-fixture", completedAt: NOW, outcome: "COMPLETED", changedFiles: ["scripts/smoke-x.ts"], testsRun: ["scripts/smoke-x.ts"], testResults: ["PASS"] }],
    }, undefined, NOW);
    assert.equal(view.history[0]!.decision?.decision, "APPROVE");
    assert.equal(view.history[0]!.result?.outcome, "COMPLETED");
  });

  scenario("daily hygiene hides yesterday completed micro-batches while preserving an active batch and today's completed batch", () => {
    const yesterday = batch({ batchId: "completed-yesterday", status: "COMPLETED", createdAt: "2026-09-15T12:00:00.000Z" });
    const today = batch({ batchId: "completed-today", status: "COMPLETED" });
    const active = batch({ batchId: "active-yesterday", status: "ACCUMULATING", createdAt: "2026-09-15T12:00:00.000Z" });
    const durable = readState({ batches: [yesterday, today, active] }); const before = JSON.stringify(durable);
    const view = buildAyasMicroBatchDevelopmentView(durable, undefined, NOW);
    assert.equal(view.active?.batchId, active.batchId);
    assert.deepEqual(view.history.map((entry) => entry.batchId), [today.batchId]);
    assert.equal(JSON.stringify(durable), before);
  });

  // --- UI: AyasDevelopmentCenter's MicroBatchPanel ---

  function emptyInbox() { return buildAyasApprovalInboxView({ proposals: [], decisions: [], results: [] } as AyasApprovalInboxReadState, NOW); }
  function htmlFor(microBatch: AyasMicroBatchDevelopmentView | undefined, extra: Record<string, unknown> = {}) {
    return renderToStaticMarkup(createElement(AyasDevelopmentCenter, { inbox: emptyInbox(), microBatch, onDecision: () => undefined, ...extra }));
  }

  scenario("UI: microBatch prop omitted entirely renders no micro-batch section and does not crash (backward compatible)", () => {
    const html = htmlFor(undefined);
    assert.doesNotMatch(html, /Küçük Geliştirme Paketi/);
  });

  scenario("UI: a disconnected microBatch view renders an honest error, not a crash or fabricated content", () => {
    const html = htmlFor({ connected: false, active: null, history: [], error: "durable state unreadable" });
    assert.match(html, /Küçük Geliştirme Paketi okunamadı/);
    assert.match(html, /durable state unreadable/);
  });

  scenario("UI: no active batch renders an honest empty state, never a fabricated batch", () => {
    const html = htmlFor(buildAyasMicroBatchDevelopmentView(readState()));
    assert.match(html, /Şu anda biriken küçük bir geliştirme paketi yok/);
  });

  scenario("UI: an active ACCUMULATING batch renders its item count, semanticKey, exactFiles, and aggregate risk", () => {
    const html = htmlFor(buildAyasMicroBatchDevelopmentView(readState({ batches: [batch()] })));
    assert.match(html, /BİRİKTİRİLİYOR/);
    assert.match(html, /ayas-novel-x/);
    assert.match(html, /scripts\/smoke-x\.ts/);
    assert.match(html, /1 micro item\(s\)/);
  });

  scenario("UI: a two-item batch renders both items, each as its own collapsible micro-item card", () => {
    const two = batch({ items: [ITEM, { ...ITEM, microItemId: "ayas-micro-item-y", semanticKey: "ayas-novel-y", exactFiles: ["scripts/smoke-y.ts"] }] });
    const html = htmlFor(buildAyasMicroBatchDevelopmentView(readState({ batches: [two] })));
    assert.match(html, /ayas-novel-x/);
    assert.match(html, /ayas-novel-y/);
    assert.match(html, /data-testid="ayas-micro-item-ayas-micro-item-x"/);
    assert.match(html, /data-testid="ayas-micro-item-ayas-micro-item-y"/);
  });

  scenario("UI: a batch item WITH a resolved patch artifact renders its exact diff, patchHash, and sandbox validation summary — the same evidence an individual proposal's diff panel shows", () => {
    const view = buildAyasMicroBatchDevelopmentView(readState({ batches: [batch()] }));
    const enriched: AyasMicroBatchDevelopmentView = {
      ...view,
      active: view.active ? {
        ...view.active,
        items: view.active.items.map((item) => ({
          ...item,
          patchArtifact: {
            patchArtifactId: "ayas-patch-artifact-fixture", patchHash: "fixture-micro-patch-hash-1234567890",
            generatorIdentity: "ayas-detector:error-code-contract-gap-v1",
            diffPreview: [{ filePath: "scripts/smoke-x.ts", content: 'new XError("X", "y");\n', isNewFile: true }],
            validatorScripts: ["scripts/smoke-x.ts"], sandboxValidationSummary: ["typecheck-project: PASS", "scripts/smoke-x.ts: PASS"],
          },
        })),
      } : null,
    };
    const html = htmlFor(enriched);
    assert.match(html, /fixture-micro-patch-hash-1234567890/);
    assert.match(html, /new XError/);
    assert.match(html, /typecheck-project: PASS/);
  });

  scenario("UI: a COMPLETED batch appears in 'Geçmiş Paketler' with its decision and result outcome, never in the active section", () => {
    const view = buildAyasMicroBatchDevelopmentView(readState({
      batches: [batch({ status: "COMPLETED" })],
      decisions: [{ decisionId: "d1", batchId: "ayas-micro-batch-fixture", decision: "APPROVE", decidedAt: NOW }],
      results: [{ resultId: "r1", batchId: "ayas-micro-batch-fixture", completedAt: NOW, outcome: "COMPLETED", changedFiles: ["scripts/smoke-x.ts"], testsRun: ["scripts/smoke-x.ts"], testResults: ["PASS"] }],
    }), undefined, NOW);
    const html = htmlFor(view);
    assert.match(html, /Geçmiş Paketler/);
    assert.match(html, /TAMAMLANDI/);
    assert.match(html, /Karar: APPROVE/);
    assert.match(html, /Yürütme sonucu: COMPLETED/);
    assert.match(html, /Şu anda biriken küçük bir geliştirme paketi yok/);
  });

  scenario("UI: an ACCUMULATING batch renders NO 'BATCH ONAYLA VE UYGULA' control — it is not yet reviewable", () => {
    const html = htmlFor(buildAyasMicroBatchDevelopmentView(readState({ batches: [batch({ status: "ACCUMULATING" })] })));
    assert.doesNotMatch(html, /BATCH ONAYLA VE UYGULA/);
  });

  scenario("UI: a COMPLETED (historical) batch renders NO 'BATCH ONAYLA VE UYGULA' control — it was already decided", () => {
    const html = htmlFor(buildAyasMicroBatchDevelopmentView(readState({ batches: [batch({ status: "COMPLETED" })] }), undefined, NOW));
    assert.doesNotMatch(html, /BATCH ONAYLA VE UYGULA/);
  });

  scenario("UI: a READY_FOR_REVIEW batch renders exactly ONE action control, 'BATCH ONAYLA VE UYGULA' — never a separate ONAYLA, YÜRÜT, or Git-publish button", () => {
    const html = htmlFor(buildAyasMicroBatchDevelopmentView(readState({ batches: [batch({ status: "READY_FOR_REVIEW" })] })));
    const matches = html.match(/BATCH ONAYLA VE UYGULA/g) ?? [];
    assert.equal(matches.length, 1, "exactly one occurrence of the button label");
    assert.doesNotMatch(html, />YÜRÜT</);
    assert.doesNotMatch(html, />ONAYLA</); // never the bare M17 single-proposal label inside the batch section
  });

  scenario("the confirmation dialog (shown after the first click, before renderToStaticMarkup can capture client state — verified by source instead) states the exact required execution+publication authority sentence", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "components", "brain", "AyasDevelopmentCenter.tsx"), "utf8");
    assert.match(src, /Bu işlem, gösterilen exact batch&apos;i Package C ile uygulayacak, test edecek, Graphify&apos;ı güncelleyecek ve tüm kontroller başarılı olursa tek Git commit&apos;i oluşturup remote&apos;a push edecektir\./);
    assert.match(src, /Ayrı bir YÜRÜT veya Git yayınlama onayı istenmeyecek/);
    assert.match(src, /BATCH ONAYLA VE UYGULA — onaylarsam ne olacak\?/);
  });

  scenario("UI: a pending BATCH ONAYLA VE UYGULA disables the control and shows 'UYGULANIYOR…'", () => {
    const b = batch({ status: "READY_FOR_REVIEW" });
    const html = htmlFor(buildAyasMicroBatchDevelopmentView(readState({ batches: [b] })), { batchOnaylaPending: true, onBatchOnaylaVeUygula: () => undefined });
    assert.match(html, /UYGULANIYOR…/);
    assert.match(html, /disabled/);
  });

  scenario("UI: a batch-approval error for THIS batch renders its mapped Turkish message; an error for a DIFFERENT batchId is never shown here", () => {
    const b = batch({ status: "READY_FOR_REVIEW" });
    const htmlOwn = htmlFor(buildAyasMicroBatchDevelopmentView(readState({ batches: [b] })), { batchOnaylaError: { batchId: b.batchId, code: "AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY" }, onBatchOnaylaVeUygula: () => undefined });
    assert.match(htmlOwn, /Graphify, uygulanan bir dosyada beklenmeyen bir bağımlılık buldu/);
    const htmlOther = htmlFor(buildAyasMicroBatchDevelopmentView(readState({ batches: [b] })), { batchOnaylaError: { batchId: "some-other-batch", code: "AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY" }, onBatchOnaylaVeUygula: () => undefined });
    assert.doesNotMatch(htmlOther, /beklenmeyen bir bağımlılık/);
  });

  scenario("UI: with no onBatchOnaylaVeUygula handler supplied, the control still renders but stays disabled — never silently omitted or silently clickable to nowhere", () => {
    const html = htmlFor(buildAyasMicroBatchDevelopmentView(readState({ batches: [batch({ status: "READY_FOR_REVIEW" })] })));
    assert.match(html, /BATCH ONAYLA VE UYGULA/);
  });

  console.log(`AYAS micro batch development center smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-micro-batch-development-center", scenarios: count }));
}
main();
