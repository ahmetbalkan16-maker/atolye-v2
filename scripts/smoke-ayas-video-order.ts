/**
 * AYAS smoke: the studio-manager door — "X hakkında video yap" places an Atölye V3 production order, "video durumu"
 * reports orders, ordinary talk about videos is not an order, and the other pre-reasoning intents keep their place.
 * No network; orders are written to a temp work root.
 * Run: npx tsx scripts/smoke-ayas-video-order.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveAyasPreReasoningIntent } from "../src/lib/ayas/AyasIntentRouting";
import { answerAyasVideoIntent, detectAyasVideoIntent, periodOf } from "../src/lib/ayas/AyasVideoOrder";
import { DEFAULT_ORDER_LENGTH, listOrders, MAX_RESUMES, PRODUCTION_STEPS, type ProductionOrder, recoverInterrupted, resumeStep } from "../src/lib/v3/orders/ProductionOrders";

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
    assert.match(await answerAyasVideoIntent({ kind: "status" }, root), /"Rubicon" sırada/);
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

  console.log(`AYAS video order smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
