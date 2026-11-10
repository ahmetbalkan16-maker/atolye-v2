/**
 * Smoke: a development request from the AYAS chat (owner decision 2026-11-10, the code lane's optional follow-up) — an
 * explicit request form becomes the same main-AYAS job as Gelişim Merkezi's request box; ordinary talk about developing
 * something does not, and the request wins over the status, report and repair intents its words would otherwise hit.
 * Temp runtime roots only; no network, no model, no live app.
 * Run: npx tsx scripts/smoke-ayas-development-request.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveAyasPreReasoningIntent } from "../src/lib/ayas/AyasIntentRouting";
import { answerAyasVideoIntent, answerDevelopmentRequest, detectAyasVideoIntent, developmentRequestOf } from "../src/lib/ayas/AyasVideoOrder";
import { listProposals, MAX_OPEN_REQUESTS } from "../src/lib/v3/council/SelfImprovement";

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

async function main() {
  await scenario("A an explicit request form is read in the owner's own words and casing", () => {
    assert.equal(developmentRequestOf("Geliştirme isteği: Gelişim Merkezi'nde işlerin tarihini göster."), "Gelişim Merkezi'nde işlerin tarihini göster");
    assert.equal(developmentRequestOf("AYAS, kendini geliştir: Hata raporlarını onay bekleyenlerle birlikte göster"), "Hata raporlarını onay bekleyenlerle birlikte göster");
    assert.equal(developmentRequestOf("yeni geliştirme talebim - Araştırma sekmesinde kaynak sayısı yazsın"), "Araştırma sekmesinde kaynak sayısı yazsın");
    assert.equal(developmentRequestOf("kendine haftalık YouTube özeti özelliği ekle"), "haftalık YouTube özeti özelliği");
    assert.equal(developmentRequestOf("AYAS'a sesli komutla video durumu sorma ekler misin?"), "sesli komutla video durumu sorma");
    assert.equal(developmentRequestOf("Feature request: Improve the Research tab"), "Improve the Research tab", "English keeps its capital I");
    assert.equal(developmentRequestOf("Geliştirme isteği:\nBirinci satır başlık\nikinci satır ayrıntı"), "Birinci satır başlık\nikinci satır ayrıntı", "several lines stay");
  });

  await scenario("B talk about developing, questions and other requests are not a request", () => {
    for (const text of ["bu videoyu nasıl geliştirebilirim", "kendini nasıl geliştiriyorsun?", "geliştirme isteği ne durumda?", "AYAS'ın gelişim raporu", "Rubicon hakkında video yap", "kendine iyi bak", "ekle", ""]) {
      assert.equal(developmentRequestOf(text), undefined, text);
    }
  });

  await scenario("C the request wins over the intents its words would hit; the others keep their routes", () => {
    const routed = resolveAyasPreReasoningIntent("Geliştirme isteği: onay bekleyen hata raporlarını tek listede göster");
    assert.deepEqual(routed, { kind: "video", video: { kind: "develop", metin: "onay bekleyen hata raporlarını tek listede göster" } });
    assert.deepEqual(detectAyasVideoIntent("Geliştirme isteği: https://example.com/x sayfasındaki gibi bir tablo incele"), { kind: "develop", metin: "https://example.com/x sayfasındaki gibi bir tablo incele" }, "a link inside the request is part of it");
    assert.equal(resolveAyasPreReasoningIntent("kendini nasıl geliştiriyorsun?").kind, "development-status");
    assert.equal(resolveAyasPreReasoningIntent("hava durumu çalışmıyor").kind, "guided-repair");
    const order = resolveAyasPreReasoningIntent("Rubicon hakkında video yap");
    assert.ok(order.kind === "video" && order.video.kind === "order");
  });

  await scenario("D the answer queues one main-AYAS job; too short, the limit and the switch are said plainly", async () => {
    const workRoot = mkdtempSync(path.join(os.tmpdir(), "ayas-dev-request-"));
    try {
      const answer = await answerAyasVideoIntent({ kind: "develop", metin: "Gelişim Merkezi'nde işlerin tarihini göster" }, workRoot, workRoot);
      assert.match(answer, /^Geliştirme isteğini kuyruğa aldım: "Gelişim Merkezi'nde işlerin tarihini göster"\./);
      assert.match(answer, /ONAYLA VE UYGULA/);
      assert.doesNotMatch(answer, /kapalı/);
      const [job] = (await listProposals(workRoot)).map((x) => x.proposal);
      assert.deepEqual([job!.kapsam, job!.kaynakTuru, job!.durum, job!.neden], ["ayas", "istek", "onaylandi", "Gelişim Merkezi'nde işlerin tarihini göster"]);
      assert.match(await answerDevelopmentRequest(workRoot, "kısa"), /biraz daha açık/);
      assert.match(await answerDevelopmentRequest(workRoot, "Araştırma sekmesinde kaynak sayısı yazsın", { ATOLYE_AYAS_GELISTIRME: "0" }), /şu an kapalı \(ATOLYE_AYAS_GELISTIRME=0\)/);
      for (let i = 2; i < MAX_OPEN_REQUESTS; i++) await answerDevelopmentRequest(workRoot, `Geliştirme isteği numarası ${i} için yeterince uzun metin`);
      assert.equal((await listProposals(workRoot)).length, MAX_OPEN_REQUESTS);
      assert.match(await answerDevelopmentRequest(workRoot, "Altıncı istek için yeterince uzun bir metin"), new RegExp(`zaten ${MAX_OPEN_REQUESTS} açık geliştirme isteğin var`));
      assert.equal((await listProposals(workRoot)).length, MAX_OPEN_REQUESTS, "nothing written past the limit");
    } finally {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  console.log(`PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
