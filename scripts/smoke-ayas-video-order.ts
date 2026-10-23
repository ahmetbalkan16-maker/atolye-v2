/**
 * AYAS smoke: the studio-manager door — "X hakkında video yap" places an Atölye V3 production order, "video durumu"
 * reports orders, ordinary talk about videos is not an order, and the other pre-reasoning intents keep their place.
 * No network; orders are written to a temp work root.
 * Run: npx tsx scripts/smoke-ayas-video-order.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveAyasPreReasoningIntent } from "../src/lib/ayas/AyasIntentRouting";
import { answerAyasVideoIntent, detectAyasVideoIntent, lengthOf, ordersReport, periodOf, SHORT_ORDER_LENGTH } from "../src/lib/ayas/AyasVideoOrder";
import { DEFAULT_ORDER_LENGTH, listOrders, MAX_RESUMES, orderProgress, PRODUCTION_STEPS, productionCommand, type ProductionOrder, recoverInterrupted, resumeStep } from "../src/lib/v3/orders/ProductionOrders";

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
  await scenario("A orders: a video word and a making verb, the topic in the owner's casing, the period when given", () => {
    const a = detectAyasVideoIntent("Sezar'ın Rubicon'u geçmesi hakkında video yap");
    assert.deepEqual(a, { kind: "order", konu: "Sezar'ın Rubicon'u geçmesi", donem: "konunun geçtiği dönem", dil: "en" });
    const b = detectAyasVideoIntent("Bana 1453 İstanbul'un fethi hakkında bir video hazırlar mısın?");
    assert.equal(b?.kind === "order" ? b.donem : "", "1453");
    const c = detectAyasVideoIntent("Video yap: Kurtuluş Savaşı 1919-1922");
    assert.equal(c?.kind === "order" ? c.donem : "", "1919-1922");
    const d = detectAyasVideoIntent("make a video about the Fall of Rome");
    assert.equal(d?.kind === "order" ? d.konu : "", "the Fall of Rome");
    const e = detectAyasVideoIntent("Napolyon hakkında Türkçe video hazırla");
    assert.equal(e?.kind === "order" ? e.dil : "", "tr");
    assert.equal(periodOf("MÖ 49 Rubicon"), "MÖ 49");
    assert.equal(periodOf("16. yüzyıl Osmanlı donanması"), "16. yüzyıl");
  });

  await scenario("B not orders: talking about videos, watching them, a broken video, weather", () => {
    for (const t of ["Bu video çok güzel olmuş", "Dün bir belgesel izledim", "Video çalışmıyor", "Bursa'da hava nasıl?", "Videoyu yapan kim?", "YouTube videolarımı göster"]) {
      assert.equal(detectAyasVideoIntent(t), null, t);
    }
    assert.equal(resolveAyasPreReasoningIntent("Video çalışmıyor").kind, "guided-repair", "arıza cümlesi onarım akışında kalır");
    assert.equal(resolveAyasPreReasoningIntent("Bu özellik çalışmıyor").kind, "guided-repair");
  });

  await scenario("C status questions", () => {
    for (const t of ["video durumu", "Videom hazır mı?", "video siparişleri ne durumda"]) assert.deepEqual(detectAyasVideoIntent(t), { kind: "status" }, t);
    assert.equal(resolveAyasPreReasoningIntent("Rubicon hakkında video yap").kind, "video");
  });

  await scenario("D the answer places exactly one order file (AYAS writes, never produces) and the status reads it back", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ayas-video-"));
    const intent = detectAyasVideoIntent("Rubicon hakkında video yap")!;
    const said = await answerAyasVideoIntent(intent, root);
    assert.match(said, /Siparişi aldım: "Rubicon"/);
    const orders = await listOrders(root);
    assert.equal(orders.length, 1);
    assert.deepEqual([orders[0]!.order.durum, orders[0]!.order.kaynak, orders[0]!.order.dil], ["bekliyor", "ayas", "en"]);
    assert.equal(readdirSync(path.join(root, "_kutuphane", "siparisler")).filter((n) => n.endsWith(".json")).length, 1);
    assert.match(await answerAyasVideoIntent({ kind: "status" }, root), /"Rubicon" \(18 dk\) sırada/);
  });

  await scenario("E an order a gone watcher left running resumes after its last finished step, then is reported as stopped", () => {
    assert.equal(resumeStep(""), "senaryo");
    assert.equal(resumeStep(["beyinlerin hafızası", "✓ senaryo (40 sn)", "✓ gardirop (90 sn)", "✓ ses (141 sn)", "  render 300/3155"].join("\n")), "senkron");
    assert.equal(resumeStep(["✓ ses (1 sn)", "✓ birlestir (51 sn)"].join("\n")), "birlestir", "a finished production reruns only its last step");
    assert.equal(PRODUCTION_STEPS.length, 9);
    assert.equal(DEFAULT_ORDER_LENGTH, "18dk", "an order without a length is a long video (owner, 21 Oct 2026)");
    const order = { id: "x", konu: "k", donem: "49 BC", sure: "120sn", dil: "en", ton: "mizahi", kaynak: "ayas", olusturuldu: "t", durum: "calisiyor" } as ProductionOrder;
    recoverInterrupted(order, ["✓ senaryo (1 sn)", "✓ gardirop (1 sn)"].join("\n"));
    assert.deepEqual([order.durum, order.devam, order.devamAdimi], ["bekliyor", 1, "ses"]);
    assert.match(order.ozet ?? "", /ses adımından devam/);
    for (let i = 1; i < MAX_RESUMES; i++) {
      order.durum = "calisiyor";
      recoverInterrupted(order, "");
    }
    order.durum = "calisiyor";
    recoverInterrupted(order, "");
    assert.equal(order.durum, "hata");
    assert.match(order.ozet ?? "", /yarıda kesildi/);
  });

  await scenario("F the owner's length reaches the order; none keeps the long default; numbers in the topic are no length", async () => {
    const len = (t: string) => {
      const i = detectAyasVideoIntent(t);
      return i?.kind === "order" ? [i.konu, i.sure] : null;
    };
    assert.deepEqual(len("Rubicon hakkında kısa bir video yap"), ["Rubicon", SHORT_ORDER_LENGTH]);
    assert.deepEqual(len("Rubicon hakkında 3 dakikalık bir video hazırla"), ["Rubicon", "3dk"]);
    assert.deepEqual(len("Rubicon hakkında 90 saniyelik video yap"), ["Rubicon", "90sn"]);
    assert.deepEqual(len("Rubicon hakkında 2 dk'lık kısa bir video yap"), ["Rubicon", "2dk"]);
    assert.deepEqual(len("make a short video about the Fall of Rome"), ["the Fall of Rome", SHORT_ORDER_LENGTH]);
    assert.deepEqual(len("make a 3-minute video about the Fall of Rome"), ["the Fall of Rome", "3dk"]);
    assert.deepEqual(len("Yüz Yıl Savaşı hakkında video yap"), ["Yüz Yıl Savaşı", undefined]);
    assert.deepEqual(len("1453 İstanbul'un fethi hakkında 5 dakikalık video yap"), ["1453 İstanbul'un fethi", "5dk"]);
    assert.equal(lengthOf("45 dakikalık"), "45dk");
    assert.equal(lengthOf("60 dakikalık"), "45dk", "the producer's ceiling");
    assert.equal(lengthOf("5 saniyelik"), "20sn", "the producer's floor");
    const root = mkdtempSync(path.join(os.tmpdir(), "ayas-video-"));
    assert.match(await answerAyasVideoIntent(detectAyasVideoIntent("Rubicon hakkında kısa bir video yap")!, root), /\(İngilizce, 3 dk\)/);
    assert.match(await answerAyasVideoIntent(detectAyasVideoIntent("Sezar hakkında video yap")!, root), /\(İngilizce, 18 dk\)/);
    assert.deepEqual((await listOrders(root)).map((x) => x.order.sure).sort(), [DEFAULT_ORDER_LENGTH, SHORT_ORDER_LENGTH]);
  });

  await scenario("G the owner's own progress questions reach the orders, and the answer says the step, the time and why it stopped", async () => {
    for (const t of ["videom ne durumda", "videonun durumu ne", "Sezar videosu ne oldu", "video ne oldu", "videom nerede", "video yapılıyor mu", "verdiğim video siparişi ne oldu", "videoda son durum ne", "az önce istediğim video ne durumda", "is my video ready"]) {
      assert.deepEqual(detectAyasVideoIntent(t), { kind: "status" }, t);
    }
    for (const t of ["Bu video çok güzel olmuş", "Video çalışmıyor", "Ayarlar bölümü nerede?", "Sistem durumu ne?"]) assert.equal(detectAyasVideoIntent(t), null, t);
    const root = mkdtempSync(path.join(os.tmpdir(), "ayas-video-"));
    const failed = { id: "20261022T075847-sezar", konu: "Sezar’ın rubicon’u geçmesi", donem: "konunun geçtiği dönem", sure: "3dk", dil: "en", ton: "mizahi", kaynak: "ayas", olusturuldu: "2026-10-22T07:58:47.884Z", durum: "hata", baslangic: "2026-10-22T07:58:58.796Z", bitis: "2026-10-22T08:01:30.000Z", cikti: "C:/elsewhere" } as ProductionOrder;
    const running = { ...failed, id: "20261022T090000-rubicon", konu: "Rubicon", olusturuldu: "2026-10-22T09:00:00.000Z", durum: "calisiyor", baslangic: "2026-10-22T09:00:10.000Z" } as ProductionOrder;
    delete (running as { bitis?: string }).bitis;
    const dir = path.join(root, "_kutuphane", "siparisler");
    mkdirSync(dir, { recursive: true });
    for (const o of [failed, running]) {
      writeFileSync(path.join(dir, `${o.id}.json`), JSON.stringify(o));
      mkdirSync(path.join(root, "bolumler", o.id), { recursive: true });
    }
    writeFileSync(path.join(root, "bolumler", failed.id, "uret.log"), ["⚕ onarım beyni [senaryo, deneme 1]: 30 sn bekleyip yeniden — x", "⚕ onarım beyni [senaryo, deneme 2]: 30 sn bekleyip yeniden — y", 'ADIM senaryo başarısız: V3_RESEARCH_NOTHING: "Sezar’ın" için okunabilir Wikipedia makalesi bulunamadı'].join("\n"));
    writeFileSync(path.join(root, "bolumler", running.id, "uret.log"), ["✓ senaryo (40 sn)", "✓ gardirop (90 sn)", "⚕ onarım beyni [ses, deneme 1]: 180 sn bekleyip yeniden — ekran kartı sıcak"].join("\n"));
    const report = await ordersReport(root, new Date("2026-10-22T09:12:10.000Z"));
    const [first, second] = report.split("\n");
    assert.equal(first, '"Rubicon" (3 dk) yapılıyor, 12 dk oldu. Biten adımlar: araştırma ve senaryo, kostüm. Şimdi seslendirme adımında (3/9); onarım beyni 1. denemede: 180 sn bekleyip yeniden — ekran kartı sıcak', "en yeni sipariş önce");
    assert.match(second ?? "", /^"Sezar’ın rubicon’u geçmesi" \(3 dk\) durdu \(3 dk sonra\)\. Araştırma ve senaryo adımında: V3_RESEARCH_NOTHING.*bulunamadı\. Onarım beyni 2 kez denedi\.$/);
    assert.equal(orderProgress({ ...failed, durum: "teslim", video: "D:/v/final.mp4", ozet: "Teslim: TAMAM" }, ""), '"Sezar’ın rubicon’u geçmesi" (3 dk) teslim edildi: D:/v/final.mp4. Teslim: TAMAM');
    assert.equal(orderProgress({ ...failed, durum: "bekliyor", devamAdimi: "render" }, ""), '"Sezar’ın rubicon’u geçmesi" (3 dk) sırada; çizim (render) adımından devam edecek');
  });

  await scenario("H the queue runner starts the producer without a shell: a many-word topic (and & or |) stays one argument", () => {
    const order = { id: "x", konu: "Sezar’ın rubicon’u geçmesi & calc", donem: "konunun geçtiği dönem", sure: "3dk", dil: "en", ton: "mizahi", kaynak: "ayas", olusturuldu: "t", durum: "bekliyor" } as ProductionOrder;
    const { command, args } = productionCommand("D:/repo", order, "D:/out", "openai");
    assert.equal(command, process.execPath, "node itself, not npx through cmd.exe");
    assert.equal(args[args.indexOf("--konu") + 1], "Sezar’ın rubicon’u geçmesi & calc");
    assert.equal(args[args.indexOf("--donem") + 1], "konunun geçtiği dönem");
    assert.match(args[0]!, /tsx[\\/]dist[\\/]cli\.mjs$/);
    assert.ok(!args.includes("--from-step"));
    assert.deepEqual(productionCommand("D:/repo", { ...order, devamAdimi: "ses" }, "D:/out", "openai").args.slice(-2), ["--from-step", "ses"]);
    const echoed = spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...args.slice(2, 6)], { encoding: "utf8", windowsHide: true });
    assert.deepEqual(JSON.parse(echoed.stdout), ["uret", "--konu", "Sezar’ın rubicon’u geçmesi & calc", "--donem"], "the child receives the topic whole");
  });

  console.log(`AYAS video order smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
