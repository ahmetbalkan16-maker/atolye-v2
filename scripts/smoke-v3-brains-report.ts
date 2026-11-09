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
import { currentStep, loadBrainCouncil, logLineBrain } from "../src/lib/v3/council/BrainCouncilFeed";
import { brainsReportText, loadAtolyeBrainsView } from "../src/lib/v3/council/BrainsReport";
import { say } from "../src/lib/v3/council/DevBrain";
import type { CouncilSession } from "../src/lib/v3/council/DirectorCouncil";
import { listStudyRequests, type ReferenceRecord } from "../src/lib/v3/council/ReferenceStudy";
import { decideProposal, listProposals, proposeDevelopment, recordCycle, settleAddition, updateProposal, writeTuning } from "../src/lib/v3/council/SelfImprovement";
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
    assert.deepEqual(detectAyasVideoIntent(`bu videodan öğren ${LINK}`), { kind: "study", urls: [LINK] });
    assert.deepEqual(detectAyasVideoIntent(`${LINK} şunu bir incele`), { kind: "study", urls: [LINK] });
    assert.deepEqual(detectAyasVideoIntent("learn from https://youtu.be/8apicgLXhGg?t=30"), { kind: "study", urls: ["https://youtu.be/8apicgLXhGg?t=30"] });
    // A link alone, or with words that are no other request, is studied (owner, 2 Nov 2026: "when I send a link").
    assert.deepEqual(detectAyasVideoIntent(`${LINK}`), { kind: "study", urls: [LINK] });
    assert.deepEqual(detectAyasVideoIntent(`şuna bir bak ${LINK} çok iyi`), { kind: "study", urls: [LINK] });
    // A link inside another video request keeps that request.
    assert.equal(detectAyasVideoIntent(`Kosova videosunu yükle ${LINK}`)?.kind, "publish");
    assert.equal(detectAyasVideoIntent(`${LINK} video durumu`)?.kind, "status");
    assert.equal(detectAyasVideoIntent("bu videodan öğren"), null);
    assert.equal(resolveAyasPreReasoningIntent(LINK).kind, "video");
    // A question about the video goes to the conversation; a learning verb still studies it.
    assert.equal(detectAyasVideoIntent(`${LINK} bunu neden önerdin?`), null);
    assert.equal(detectAyasVideoIntent(`bu kimin kanalı ${LINK}`), null);
    assert.equal(detectAyasVideoIntent(`${LINK} bu güzel mi`), null);
    assert.deepEqual(detectAyasVideoIntent(`${LINK} bunu incele, neden tutmuş?`), { kind: "study", urls: [LINK] });
    // Every link of a message is studied.
    const LINK_B = "https://youtu.be/Q-nWA0WeF98";
    assert.deepEqual(detectAyasVideoIntent(`${LINK} ${LINK_B}`), { kind: "study", urls: [LINK, LINK_B] });
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
    const answer = await answerAyasVideoIntent({ kind: "study", urls: [LINK] }, root);
    assert.match(answer, /inceleme listesine aldım/);
    assert.match(answer, /hiçbir parçası kullanılmaz/);
    const reqs = await listStudyRequests(root);
    assert.deepEqual(reqs.map((r) => [r.request.id, r.request.kaynak, r.request.durum]), [["8apicgLXhGg", "ayas", "bekliyor"]]);
    // Two links: two requests, one answer.
    const root2 = mkdtempSync(path.join(os.tmpdir(), "v3-brains-"));
    assert.match(await answerAyasVideoIntent({ kind: "study", urls: [LINK, "https://youtu.be/Q-nWA0WeF98", LINK] }, root2), /^2 videoyu inceleme listesine aldım/);
    assert.deepEqual((await listStudyRequests(root2)).map((r) => r.request.id).sort(), ["8apicgLXhGg", "Q-nWA0WeF98"]);
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
    // The single idea is listed apart (owner, 6 Nov 2026: "onaya bir şey düşmüyor ki nasıl onay vericem"), with its own buttons.
    assert.equal((html.match(/>ONAYLA</g) ?? []).length, 2);
    assert.match(html, /1 fikir daha bekliyor/);
    assert.match(html, /Beyinler kodu kendileri değiştiremez. Onayladığın öneri geliştirme kuyruğuna girer/);
    assert.match(html, /<details data-testid="atolye-ideas"><summary>Diğer fikirler \(1\) — tek bir üretimden geldi; istersen şimdi onaylayabilirsin<\/summary>/);
    assert.match(html, /data-testid="atolye-idea-[^"]+".*An AI composer/);
    assert.deepEqual(v.fikirler?.map((f) => f.baslik), ["An AI composer"]);
    assert.match(text, /Ayrıca tek bir üretimden gelen 1 fikir var; Gelişim Merkezi'nde "Diğer fikirler" altında/);
    assert.doesNotMatch(html, /Geliştirme kuyruğu/, "nothing approved yet");
    // An approved proposal is in the development queue; the developer's kept build waits "hazır" on its branch.
    const idea = (await listProposals(root)).find((x) => x.proposal.baslik === "An AI composer")!.proposal;
    await decideProposal(root, idea.id, "onaylandi");
    const queued = await loadAtolyeBrainsView(root);
    assert.deepEqual(queued.kuyruk.map((k) => [k.baslik, k.durum]), [["An AI composer", "Kuyrukta"]]);
    assert.match(brainsReportText(queued), /Geliştirme kuyruğu: "An AI composer" — Kuyrukta\./);
    await updateProposal(root, idea.id, (q) => ({ ...q, durum: "hazir", is: { deneme: 1, baslangic: "2026-11-03T02:00:00Z", bitis: "2026-11-03T02:40:00Z", dal: `gelistirme/${idea.id}`, dosyalar: ["src/lib/v3/mix/MusicComposer.ts"] } }));
    const ready = await loadAtolyeBrainsView(root);
    // Since the code lane (owner decision 2026-11-09) a ready build waits for the owner's "ONAYLA VE UYGULA".
    assert.deepEqual(ready.kuyruk.map((k) => [k.durum, k.ayrinti]), [["Hazır — onayını bekliyor", `dal gelistirme/${idea.id} · 1 dosya · testler geçti`]]);
    assert.match(renderToStaticMarkup(createElement(AtolyeBrainsPanel, { initial: ready })), /Geliştirme kuyruğu:.*<b>Hazır — onayını bekliyor<\/b> — An AI composer/);
    // An unreadable store says so; no view renders nothing.
    assert.match(renderToStaticMarkup(createElement(AtolyeBrainsPanel, { initial: { ...v, connected: false, error: "EACCES" } })), /Kayıtlar okunamadı: EACCES/);
    assert.equal(renderToStaticMarkup(createElement(AtolyeBrainsPanel, {})), "");
  });

  await scenario("D the homepage's council: a production's step decides who works, its log lines are the brains' words; debates, cycles and the developer brain fill the rest; nothing is made up", async () => {
    // Real log lines (Caesar Short, 3 Nov 2026) go to the brain that wrote them; the PC's health and counters to no one.
    const lines: [string, string | undefined][] = [
      ["✓ gardirop (248 sn)", "sef"],
      ["  Julius Caesar portre ✓ konu 10/10, dönem 7/10, diger · Bust Julius Caesar.jpg", "kostum"],
      ["  · konu 0/10, dönem 3/10, eser · AIC 100345: Adoration", "ortam"],
      ["⚠ s2-negotiation: DÖNEME AİT GÖRSEL BULUNAMADI — 4 aday incelendi", "ortam"],
      ["  müzik: yatak 1 (historical): özgün müzik", "ses"],
      ["ses temizliği: ortam 65509c6e.wav — 23 sabit tiz çizgi → 1", "ses"],
      ["⚕ onarım beyni [kapak, deneme 3]: 90 sn bekleyip yeniden", "onarim"],
      ["- [x] Ses seviyesi -14.0 LUFS", "kalite"],
      ["  kapak portre ✓ konu 9/10, dönem 8/10", "ortam"],
      ["↺ rötuş beyni: 1. tur başlıyor", "sef"],
      ["GPU 74 °C — soğuması bekleniyor (sınır 74 °C)", undefined],
      ["sağlık: GPU 70 °C · işlemci hız %85", undefined],
      ["  render 1200/1204", undefined],
      ["Ollama gemma4:12b bellekten indiriliyor (render için RAM)", undefined],
    ];
    for (const [l, who] of lines) assert.equal(logLineBrain(l)?.kim, who, l);
    assert.equal(logLineBrain("✓ ses (375 sn)")?.metin, "seslendirme bitti (375 sn)");
    assert.equal(currentStep("✓ senaryo (95 sn)\n✓ gardirop (248 sn)\n"), "ses");
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-meclis-"));
    // Nothing recorded yet: every brain waits and says it has no record.
    const empty = await loadBrainCouncil(root);
    assert.deepEqual([empty.beyinler.length, empty.akis.length, empty.uretim], [10, 0, undefined]);
    assert.ok(empty.beyinler.every((b) => b.durum === "bekliyor" && b.is === "henüz kaydı yok"));
    // A delivered production with its brains' debates, a cycle, the developer brain's notes, a production running.
    const done = await placeOrder(root, { konu: "Rubicon", donem: "49 BC", sure: "60sn" }, new Date("2026-11-03T08:00:00Z"));
    Object.assign(done, { durum: "teslim", bitis: "2026-11-03T09:00:00Z", cikti: path.join(root, "bolumler", done.id) });
    await saveOrder(path.join(orderDir(root), `${done.id}.json`), done);
    mkdirSync(done.cikti!, { recursive: true });
    writeFileSync(path.join(done.cikti!, "yapim-raporu.json"), JSON.stringify({ tarih: "2026-11-03T09:00:00Z", tartismalar: [{ beyin: "kostum", konu: "kostüm incelemesi", kayit: [{ rol: "Tarihçi", metin: "toga too bright" }, { rol: "Şef", metin: "2 düzeltme uygulandı" }] }] }));
    await recordCycle(root, { basla: "2026-11-03T10:00:00Z", bitis: "2026-11-03T10:05:00Z", gorevler: [{ gorev: "benzer", sonuc: "tamam", ayrinti: "1 video incelendi", bitis: "2026-11-03T10:02:00Z" }, { gorev: "ogren", sonuc: "tamam", ayrinti: "3 commit okundu", bitis: "2026-11-03T10:04:00Z" }, { gorev: "sinav", sonuc: "atlandi", ayrinti: "", bitis: "2026-11-03T10:05:00Z" }], maliyetUsd: 0 });
    await say(root, "işi araştırdım", undefined, new Date("2026-11-03T11:00:00Z"));
    await say(root, "notumla Claude'a veriyorum", "Claude", new Date("2026-11-03T11:01:00Z"));
    const run = await placeOrder(root, { konu: "Caesar and the pirates", donem: "75 BC", sure: "60sn" }, new Date("2026-11-03T12:00:00Z"));
    Object.assign(run, { durum: "calisiyor", cikti: path.join(root, "bolumler", run.id) });
    await saveOrder(path.join(orderDir(root), `${run.id}.json`), run);
    mkdirSync(run.cikti!, { recursive: true });
    writeFileSync(path.join(run.cikti!, "uret.log"), ["✓ senaryo (95 sn)", "GPU 74 °C — soğuması bekleniyor (sınır 74 °C)", "  Julius Caesar portre ✓ konu 10/10, dönem 7/10", "gardırop: \"Caesar's laurel\" tasarlandı", ""].join("\n"));
    const kurul = { tarih: "2026-11-03T08:30:00Z", beyinler: [{ ad: "Mizah beyni", puan: 6, notlar: ["s4#1: espri zayıf → daha keskin"] }], itirazlar: ["Araştırma beyni (n1): tarih bozulur"], ayas: "Espri düzelecek." };
    const v = await loadBrainCouncil(root, kurul);
    assert.match(v.uretim!, /^"Caesar and the pirates" yapılıyor — kostüm adımı \(2\/9\)$/);
    const by = (id: string) => v.beyinler.find((b) => b.id === id)!;
    assert.deepEqual([by("kostum").durum, by("kostum").is], ["calisiyor", "kostüm adımında"], "the step's brain works");
    assert.deepEqual([by("ses").durum, by("ses").is], ["bekliyor", "henüz kaydı yok"]);
    assert.equal(by("arastirma").is, "ilgili videoları kendi arayıp inceleme: 1 video incelendi", "a waiting brain shows its last record");
    assert.equal(by("gelistirici").is, "notumla Claude'a veriyorum");
    // The feed: newest first — the running production's words, then the developer brain, the cycle, the debates, the council.
    assert.deepEqual(v.akis.slice(0, 3).map((l) => [l.kim, l.metin]), [["kostum", "gardırop: \"Caesar's laurel\" tasarlandı"], ["kostum", "Julius Caesar portre ✓ konu 10/10, dönem 7/10"], ["sef", "araştırma ve senaryo bitti (95 sn)"]]);
    assert.ok(v.akis.some((l) => l.kim === "gelistirici" && l.kime === "Claude"));
    assert.ok(v.akis.some((l) => l.kim === "kostum" && l.rol === "Tarihçi" && l.metin === "kostüm incelemesi: toga too bright"));
    assert.ok(v.akis.some((l) => l.kim === "mizah" && l.kime === "AYAS" && l.metin === "6/10 — s4#1: espri zayıf → daha keskin"));
    assert.ok(v.akis.some((l) => l.kim === "arastirma" && l.metin === "itiraz (n1): tarih bozulur"));
    assert.ok(!v.akis.some((l) => /GPU|sınav/.test(l.metin)), "no health line, no skipped task");
    // The brains' report carries the council and the developer brain; the Gelişim Merkezi shows the brain's card.
    const report = await loadAtolyeBrainsView(root);
    assert.equal(report.meclis.beyinler.length, 10);
    assert.equal(report.gelistirici?.hazirlik.seviye, "baslangic");
    assert.match(brainsReportText(report), /Geliştirici beyni \(gündüz araştırır, akşam 16:30'dan sonra Claude yapar, o da Claude'dan öğrenir\): henüz bir tahmini notlanmadı/);
    const html = renderToStaticMarkup(createElement(AtolyeBrainsPanel, { initial: report }));
    assert.match(html, /Geliştirici Beyni <span>YENİ BAŞLADI<\/span>/);
    assert.match(html, /her akşam 16:30&#x27;dan sonra Claude onu sipariş yokken ayrı bir kopyada yapar/);
  });

  console.log(`PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
