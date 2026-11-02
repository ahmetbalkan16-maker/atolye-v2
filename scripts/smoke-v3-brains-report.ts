/**
 * V3 smoke: the brains' report to the owner (BrainsReport) and AYAS's two chat doors — "bu videodan öğren <link>"
 * writes a study request, "beyinler ne öğrendi" answers from the council, references, cycles and proposals — through
 * the chat's own intent routing (an earlier intent must not swallow them, nor they an order or a status question).
 * No network, no model.
 * Run: npx tsx scripts/smoke-v3-brains-report.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveAyasPreReasoningIntent } from "../src/lib/ayas/AyasIntentRouting";
import { AtolyeBrainsPanel } from "../src/components/brain/AtolyeBrainsPanel";
import { answerAyasVideoIntent, detectAyasVideoIntent } from "../src/lib/ayas/AyasVideoOrder";
import { brainsReportText, loadAtolyeBrainsView } from "../src/lib/v3/council/BrainsReport";
import type { CouncilSession } from "../src/lib/v3/council/DirectorCouncil";
import { listStudyRequests, type ReferenceRecord } from "../src/lib/v3/council/ReferenceStudy";
import { proposeDevelopment, recordCycle, settleAddition, writeTuning } from "../src/lib/v3/council/SelfImprovement";
import { placeOrder, saveOrder, orderDir } from "../src/lib/v3/orders/ProductionOrders";

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

const LINK = "https://www.youtube.com/watch?v=8apicgLXhGg";

async function main() {
  await scenario("A AYAS's doors: a link with a learning verb is a study, a brain question is the report; nothing else changes", () => {
    assert.deepEqual(detectAyasVideoIntent(`bu videodan öğren ${LINK}`), { kind: "study", url: LINK });
    assert.deepEqual(detectAyasVideoIntent(`${LINK} şunu bir incele`), { kind: "study", url: LINK });
    assert.deepEqual(detectAyasVideoIntent("learn from https://youtu.be/8apicgLXhGg?t=30"), { kind: "study", url: "https://youtu.be/8apicgLXhGg?t=30" });
    assert.equal(detectAyasVideoIntent(`${LINK}`), null);
    assert.equal(detectAyasVideoIntent("bu videodan öğren"), null);
    for (const q of ["beyinler ne öğrendi?", "Kurul ne dedi", "beyinler bugün neler yaptı", "beyin raporu", "atölye beyinleri ne öğrendi", "kurul raporu ver"]) assert.deepEqual(detectAyasVideoIntent(q), { kind: "brains" }, q);
    assert.deepEqual(detectAyasVideoIntent("video durumu"), { kind: "status" });
    assert.equal(detectAyasVideoIntent("Rubicon hakkında video yap")?.kind, "order");
    assert.equal(detectAyasVideoIntent("beyin nasıl çalışır"), null);
    // Through the chat's routing: no earlier intent takes them.
    assert.equal(resolveAyasPreReasoningIntent("beyinler ne öğrendi?").kind, "video");
    assert.equal(resolveAyasPreReasoningIntent("kurul raporu ver").kind, "video");
    assert.equal(resolveAyasPreReasoningIntent(`bu videoyu incele ${LINK}`).kind, "video");
  });

  await scenario("B a study request from the chat is only written, for the watcher's idle loop", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-brains-"));
    const answer = await answerAyasVideoIntent({ kind: "study", url: LINK }, root);
    assert.match(answer, /inceleme listesine aldım/);
    assert.match(answer, /hiçbir parçası kullanılmaz/);
    const reqs = await listStudyRequests(root);
    assert.deepEqual(reqs.map((r) => [r.request.id, r.request.kaynak, r.request.durum]), [["8apicgLXhGg", "ayas", "bekliyor"]]);
  });

  await scenario("C the report: the latest council, what references taught, the cycles, the brains' changes, the proposals", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-brains-"));
    assert.match(brainsReportText(await loadAtolyeBrainsView(root)), /Henüz bir yönetmen kurulu toplanmadı/);
    const order = await placeOrder(root, { konu: "Caesar and the pirates", donem: "75 BC", sure: "60sn" }, new Date("2026-11-02T16:26:58Z"));
    Object.assign(order, { durum: "teslim", bitis: "2026-11-02T18:00:00Z" });
    await saveOrder(path.join(orderDir(root), `${order.id}.json`), order);
    const dir = path.join(root, "bolumler", order.id);
    mkdirSync(dir, { recursive: true });
    const session: CouncilSession = {
      tur: 0, puan: 6.8, maliyetUsd: 0.02,
      raporlar: [{ beyin: "mizah", puan: 6, notlar: [{ id: "n1", beyin: "mizah", sahne: "s4-payback", satir: 1, sorun: "kapanış esprisi zayıf", oneri: "daha keskin", eylem: "satir" }] }, { beyin: "kurgu", puan: 7, notlar: [] }],
      yanitlar: [{ beyin: "arastirma", destek: [], itiraz: [{ id: "n1", neden: "tarih bozulur" }] }],
      karar: { ozet: "Espri ve sahne hareketi düzelecek.", duzeltmeler: [{ tur: "oyun", sahne: "s2-ransom", satir: 2, oyun: [{ karakter: "caesar", jest: "kutla" }], neden: "" }], yeniden: [] },
    };
    writeFileSync(path.join(dir, "yonetmen-kurulu-deneme.json"), JSON.stringify({ tarih: "2026-11-02T19:00:00Z", oturum: session }));
    const refDir = path.join(root, "_kutuphane", "referanslar");
    mkdirSync(refDir, { recursive: true });
    const ref: ReferenceRecord = { id: "8apicgLXhGg", url: LINK, baslik: "IV. MURAD", kanal: "Sancaray", dil: "tr", tarih: "2026-11-02T18:30:00Z", neden: "owner", olcum: { sureSn: 1031, kelimeDk: 103, kesmeDk: 3.7, ortCekimSn: 16, sozDegisimiDk: 8.6, ilkSozSn: 0 }, kareler: [], ozet: "Diyalogla anlatıyor.", dersler: [{ beyin: "kurgu", metin: "Open on a crisis", tr: "Krizle aç" }], eksik: [] };
    writeFileSync(path.join(refDir, "8apicgLXhGg.json"), JSON.stringify(ref));
    await recordCycle(root, { basla: "2026-11-02T19:20:00Z", bitis: "2026-11-02T19:22:00Z", gorevler: [{ gorev: "sinav", sonuc: "tamam", ayrinti: "kalite beyni 7/8, dengeli doğruluk %90", bitis: "2026-11-02T19:22:00Z" }], maliyetUsd: 0 });
    await writeTuning(root, settleAddition({ ekler: {}, ayarlar: {}, ayarGecmisi: [] }, "kalite", { metin: "Only report a clear fault", tarih: "2026-11-02T19:25:00Z" }, 73, 73));
    await proposeDevelopment(root, { beyin: "ses", baslik: "Notch the 6 kHz whine", neden: "measured in the mix", kaynak: order.id, kaynakTuru: "olcum" });
    await proposeDevelopment(root, { beyin: "kurgu", baslik: "An AI composer", neden: "idea", kaynak: order.id });
    const v = await loadAtolyeBrainsView(root);
    assert.equal(v.connected, true);
    assert.deepEqual([v.kurul?.bolum, v.kurul?.deneme, v.kurul?.puan, v.kurul?.beyinler.map((b) => b.ad)], ["Caesar and the pirates", true, 6.8, ["Mizah beyni", "Kurgu beyni"]]);
    assert.match(v.kurul!.itirazlar[0]!, /Araştırma beyni \(n1\): tarih bozulur/);
    assert.match(v.kurul!.duzeltmeler[0]!, /s2-ransom#2 sahnede oynanacak: caesar kutla/);
    assert.equal(v.referanslar[0]!.dersler[0], "Kurgu beyni: Krizle aç");
    assert.match(v.hedefler[0]!, /^Uzun video: Target pace measured on 1 studied reference video/);
    assert.match(v.degisiklikler[0]!, /Kalite beyni istem eki geri alındı: "Only report a clear fault" \(sınav %73 → %73\)/);
    assert.deepEqual(v.oneriler.map((o) => [o.beyin, o.baslik, o.olcum]), [["Ses beyni", "Notch the 6 kHz whine", true]]);
    assert.equal(v.fikirSayisi, 1);
    const text = brainsReportText(v);
    assert.match(text, /Son yönetmen kurulu \(deneme\) — "Caesar and the pirates": Mizah beyni 6\/10, Kurgu beyni 7\/10; ortalama 6.8\/10. 1 itiraz oldu. AYAS: Espri/);
    assert.match(text, /"IV. MURAD" \(Sancaray\): Diyalogla anlatıyor\. Dersler: Kurgu beyni: Krizle aç/);
    assert.match(text, /Son gelişim döngüsü: kalite beyninin sınavı: kalite beyni 7\/8/);
    assert.match(text, /Onayını bekleyen 1 kod önerisi var .*"Notch the 6 kHz whine".*Kod yalnız senin onayınla değişir/);
    // The same answer through AYAS's chat.
    assert.equal(await answerAyasVideoIntent({ kind: "brains" }, root), text);
    // The Gelişim Merkezi panel renders the same view, with the owner's two buttons on the measured proposal only.
    const html = renderToStaticMarkup(createElement(AtolyeBrainsPanel, { initial: v, decide: async () => ({ ok: true, view: v }) }));
    assert.match(html, /AYAS Yönetmen Kurulu <span>6.8\/10<\/span>/);
    assert.match(html, />DENEME</);
    assert.match(html, /s2-ransom#2 sahnede oynanacak/);
    assert.match(html, /Tartışma \(1 not, 1 itiraz\)/);
    assert.match(html, /href="https:\/\/www.youtube.com\/watch\?v=8apicgLXhGg"/);
    assert.match(html, /Notch the 6 kHz whine/);
    assert.equal((html.match(/>ONAYLA</g) ?? []).length, 1);
    assert.match(html, /1 fikir daha bekliyor/);
    assert.match(html, /Beyinler kodu değiştiremez/);
    assert.doesNotMatch(html, /An AI composer/);
    // An unreadable store says so; no view renders nothing.
    assert.match(renderToStaticMarkup(createElement(AtolyeBrainsPanel, { initial: { ...v, connected: false, error: "EACCES" } })), /Kayıtlar okunamadı: EACCES/);
    assert.equal(renderToStaticMarkup(createElement(AtolyeBrainsPanel, {})), "");
  });

  console.log(`PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
