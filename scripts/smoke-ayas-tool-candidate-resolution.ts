/**
 * AYAS Action Runtime RELIABILITY sprint — deterministic tool-candidate
 * resolver smoke suite.
 *
 * Deterministic / $0 / no network / no model. Direct pure-function coverage
 * of `resolveDeterministicToolCandidate` (`AyasChatStream.ts`) — the
 * structural pre-resolution that lets an EXPLICIT, UNAMBIGUOUS checkpoint/
 * roadmap/changelog/file-path request dispatch reliably without depending on
 * the reasoning core's stochastic tool naming for that decision. For each of
 * the four candidates: a direct explicit request, a paraphrase, a polite
 * form, an unrelated counterexample, an ambiguous form (two candidates named
 * at once → must defer, never guess), and a mutating-lookalike form (an
 * edit/delete/commit-shaped request naming the same file/document → must
 * defer to the existing honest-decline path rather than silently answering
 * a READ for a request that asked to WRITE). Also proves ordinary
 * conversation never spuriously resolves a candidate.
 *
 * End-to-end dispatch-count/provenance/grounding coverage lives in
 * `smoke-ayas-reasoning.ts`'s "ACTION RUNTIME RELIABILITY —" scenarios,
 * which exercise this resolver through the full `streamAyasChat` pipeline.
 */

import assert from "node:assert/strict";

import { resolveDeterministicToolCandidate } from "../src/lib/ayas/AyasChatStream";

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function assertResolves(
  text: string,
  expectedAction: string,
  expectedInput: Readonly<Record<string, string>>,
) {
  const got = resolveDeterministicToolCandidate(text);
  assert.ok(got, `expected a deterministic candidate for: "${text}"`);
  assert.equal(got!.action, expectedAction, text);
  assert.deepEqual(got!.toolInput, expectedInput, text);
}

function assertDefers(text: string) {
  assert.equal(resolveDeterministicToolCandidate(text), null, `expected no deterministic candidate for: "${text}"`);
}

async function run() {
  // ---- checkpoint -----------------------------------------------------
  await scenario("checkpoint — direct explicit request resolves", () => {
    assertResolves("Checkpoint'e bak, en son nerede kalmışız?", "read-project-document", { documentId: "checkpoint" });
  });
  await scenario("checkpoint — paraphrase resolves", () => {
    assertResolves("Checkpoint dosyasında nerede kaldığımızı görebilir misin?", "read-project-document", { documentId: "checkpoint" });
  });
  await scenario("checkpoint — polite form resolves", () => {
    assertResolves("Checkpoint'i inceleyebilir misin lütfen?", "read-project-document", { documentId: "checkpoint" });
  });
  await scenario("checkpoint — unrelated counterexample defers (no candidate)", () => {
    assertDefers("Bugün moralim biraz düşük, biraz konuşabilir miyiz?");
  });
  await scenario("checkpoint — ambiguous form (checkpoint + roadmap together) defers", () => {
    assertDefers("Checkpoint ve roadmap'e birlikte bakar mısın?");
  });
  await scenario("checkpoint — mutating lookalike defers (must not silently READ instead of the asked WRITE)", () => {
    assertDefers("Checkpoint dosyasını güncelle, yeni bir madde ekle.");
  });

  // ---- roadmap ----------------------------------------------------------
  await scenario("roadmap — direct explicit request resolves", () => {
    assertResolves("Roadmap'i oku, sıradaki işi söyle.", "read-project-document", { documentId: "roadmap" });
  });
  await scenario("roadmap — paraphrase resolves", () => {
    assertResolves("Roadmap'te sırada ne var, bakabilir misin?", "read-project-document", { documentId: "roadmap" });
  });
  await scenario("roadmap — polite form resolves", () => {
    assertResolves("Roadmap dosyasına bakman mümkün mü acaba?", "read-project-document", { documentId: "roadmap" });
  });
  await scenario("roadmap — unrelated counterexample defers", () => {
    assertDefers("Yarın hava nasıl olacak sence?");
  });
  await scenario("roadmap — ambiguous form (roadmap + changelog together) defers", () => {
    assertDefers("Roadmap ve changelog'u karşılaştırabilir misin?");
  });
  await scenario("roadmap — mutating lookalike defers", () => {
    assertDefers("Roadmap'i güncelleyip yeni bir madde ekler misin?");
  });

  // ---- changelog ----------------------------------------------------------
  await scenario("changelog — direct explicit request resolves", () => {
    assertResolves("Changelog'a bak.", "read-project-document", { documentId: "changelog" });
  });
  await scenario("changelog — paraphrase resolves", () => {
    assertResolves("Changelog dosyasında en son ne değişmiş?", "read-project-document", { documentId: "changelog" });
  });
  await scenario("changelog — polite form resolves", () => {
    assertResolves("Changelog'u kontrol edebilir misin lütfen?", "read-project-document", { documentId: "changelog" });
  });
  await scenario("changelog — unrelated counterexample defers", () => {
    assertDefers("Bana kısa bir espri yapar mısın?");
  });
  await scenario("changelog — ambiguous form (changelog + checkpoint together) defers", () => {
    assertDefers("Changelog'a ve checkpoint'e bakar mısın?");
  });
  await scenario("changelog — mutating lookalike defers", () => {
    assertDefers("Changelog dosyasını sil.");
  });

  // ---- inspect-source-file -----------------------------------------------
  await scenario("inspect-source-file — direct explicit request resolves", () => {
    assertResolves("src/lib/ayas/AyasChatStream.ts dosyasını incele.", "inspect-source-file", { filePath: "src/lib/ayas/AyasChatStream.ts" });
  });
  await scenario("inspect-source-file — paraphrase resolves", () => {
    assertResolves(
      "src/lib/ayas/execution/AyasExecutionPolicy.ts dosyasının ne işe yaradığını açıklar mısın?",
      "inspect-source-file",
      { filePath: "src/lib/ayas/execution/AyasExecutionPolicy.ts" },
    );
  });
  await scenario("inspect-source-file — polite form resolves", () => {
    assertResolves("scripts/smoke-ayas-reasoning.ts dosyasına bakabilir misin lütfen?", "inspect-source-file", {
      filePath: "scripts/smoke-ayas-reasoning.ts",
    });
  });
  await scenario("inspect-source-file — unrelated counterexample defers", () => {
    assertDefers("Bugün ne yapmalıyım, biraz fikir verir misin?");
  });
  await scenario("inspect-source-file — ambiguous form (two file paths named together) defers", () => {
    assertDefers("src/lib/ayas/AyasChatStream.ts ve scripts/smoke-ayas-reasoning.ts dosyalarını karşılaştırır mısın?");
  });
  await scenario("inspect-source-file — mutating lookalike defers", () => {
    assertDefers("src/lib/ayas/AyasChatStream.ts dosyasını düzenle.");
  });

  // ---- ordinary conversation never spuriously dispatches -----------------
  await scenario("ordinary conversation never resolves a spurious candidate", () => {
    for (const text of [
      "Bugün nasılsın?",
      "Merhaba, bana yardımcı olabilir misin?",
      "Konuşma bağlamı nedir?",
      "Teşekkürler, iyi çalışmalar.",
      "Bugün biraz yoruldum.",
    ]) {
      assertDefers(text);
    }
  });

  console.log(`AYAS tool candidate resolution smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-tool-candidate-resolution", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS tool candidate resolution smoke FAILED:", error);
  process.exitCode = 1;
});
