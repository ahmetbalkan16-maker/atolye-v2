/**
 * V3 smoke: the brains' self-improvement while idle (SelfImprovement) — when a cycle and each task are due, code
 * proposals (written once, repeats counted, decided only by the owner), a production report's wants, prompt additions
 * and settings kept only on a measured gain and never tried twice. No network, no GPU, no model.
 * Run: npx tsx scripts/smoke-v3-self-improvement.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  activeAdditions,
  additionPrompt,
  type BrainTuning,
  confirmedGain,
  type CycleRecord,
  cycleDue,
  cycleLine,
  decideProposal,
  harvestReport,
  lastDone,
  listProposals,
  MAX_ADDITIONS,
  MIN_GAIN,
  needsOwner,
  proposeDevelopment,
  readTuning,
  settleAddition,
  settleSetting,
  taskDue,
  triedBefore,
  tunedSetting,
  wantsOf,
  writeTuning,
} from "../src/lib/v3/council/SelfImprovement";

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

const H = 3_600_000;
const T0 = Date.parse("2026-11-02T12:00:00Z");
const at = (h: number) => new Date(T0 + h * H).toISOString();

async function main() {
  await scenario("A cycles and tasks fall due by their pauses; an owner's link makes a cycle due at once", () => {
    const cycles: CycleRecord[] = [
      { basla: at(0), bitis: at(0.5), gorevler: [{ gorev: "sinav", sonuc: "tamam", ayrinti: "", bitis: at(0.4) }, { gorev: "benzer", sonuc: "atlandi", ayrinti: "", bitis: at(0.5) }], maliyetUsd: 0 },
    ];
    assert.equal(lastDone(cycles, "sinav"), T0 + 0.4 * H);
    assert.equal(lastDone(cycles, "benzer"), undefined);
    assert.equal(taskDue(cycles, "sinav", T0 + 10 * H), false);
    assert.equal(taskDue(cycles, "sinav", T0 + 25 * H), true);
    assert.equal(taskDue(cycles, "benzer", T0 + 1 * H), true);
    assert.equal(taskDue(cycles, "istekler", T0 + 0.6 * H), true);
    assert.equal(cycleDue([], {}), true);
    assert.equal(cycleDue(cycles, { now: T0 + 2 * H }), false);
    assert.equal(cycleDue(cycles, { now: T0 + 7 * H }), true);
    assert.equal(cycleDue(cycles, { now: T0 + 2 * H, everyH: 1 }), true);
    assert.equal(cycleDue(cycles, { now: T0 + 1 * H, requestsWaiting: true }), true);
    assert.match(cycleLine({ ...cycles[0]!, durdu: "sipariş geldi" }), /kalite beyninin sınavı.*\(durdu: sipariş geldi\)/);
    assert.equal(cycleLine({ basla: at(0), bitis: at(1), gorevler: [], maliyetUsd: 0 }), "yapılacak iş yoktu");
  });

  await scenario("B proposals: written once, a repeat counted on the same want, decided only once by the owner", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-gelisim-"));
    assert.equal(await proposeDevelopment(root, { beyin: "ortam", baslik: "Close maps need a river layer", neden: "rivers missing", kaynak: "a" }, new Date(T0)), "yeni");
    assert.equal(await proposeDevelopment(root, { beyin: "ortam", baslik: "close maps need river layer drawn", neden: "again", kaynak: "b" }), "tekrar");
    assert.equal(await proposeDevelopment(root, { beyin: "ses", baslik: "Close maps need a river layer", neden: "other brain", kaynak: "c" }), "yeni");
    const list = await listProposals(root);
    assert.equal(list.length, 2);
    const p = list.find((x) => x.proposal.beyin === "ortam")!.proposal;
    assert.deepEqual([p.sayi, p.kaynaklar, p.durum, p.kaynakTuru], [2, ["a", "b"], "bekliyor", "fikir"]);
    // An idea comes before the owner once a second production raised it; a measured fault at once.
    assert.equal(needsOwner(p), true);
    assert.equal(needsOwner({ durum: "bekliyor", kaynakTuru: "fikir", sayi: 1 }), false);
    assert.equal(needsOwner({ durum: "bekliyor", kaynakTuru: "olcum", sayi: 1 }), true);
    assert.equal(needsOwner({ durum: "onaylandi", kaynakTuru: "olcum", sayi: 3 }), false);
    // The same production raising it again counts nothing.
    await proposeDevelopment(root, { beyin: "ses", baslik: "Close maps need a river layer", neden: "", kaynak: "c", kaynakTuru: "olcum" });
    const ses = (await listProposals(root)).find((x) => x.proposal.beyin === "ses")!.proposal;
    assert.deepEqual([ses.sayi, ses.kaynakTuru], [1, "olcum"]);
    const d = await decideProposal(root, p.id, "onaylandi", "  bunu yapalım  ");
    assert.deepEqual([d.durum, d.karar?.not], ["onaylandi", "bunu yapalım"]);
    await assert.rejects(decideProposal(root, p.id, "reddedildi"), /V3_PROPOSAL_DECIDED/);
    await assert.rejects(decideProposal(root, "nope", "onaylandi"), /V3_PROPOSAL_NOT_FOUND/);
    // A decided want raised again is counted, never reopened.
    assert.equal(await proposeDevelopment(root, { beyin: "ortam", baslik: "Close maps need a river layer", neden: "", kaynak: "d" }), "tekrar");
    assert.equal((await listProposals(root)).find((x) => x.proposal.id === p.id)!.proposal.durum, "onaylandi");
  });

  await scenario("C a report's wants: the manager's developments and code findings, not the repair brain's own", async () => {
    const report = {
      sef: { gelistirmeler: [{ baslik: "Draw siege towers", neden: "missing", beyin: "ortam" as const }, { baslik: "No brain named", neden: "x" }, { neden: "no title" }] },
      bulgular: [
        { beyin: "ses" as const, onem: "uyari" as const, baslik: "whine in mix", ayrinti: "6 kHz", oneri: "notch it", tur: "kod" as const },
        { beyin: "onarim" as const, onem: "uyari" as const, baslik: "render failed", ayrinti: "x", tur: "kod" as const },
        { beyin: "ortam" as const, onem: "uyari" as const, baslik: "no period image", ayrinti: "x", tur: "veri" as const },
      ],
    };
    const w = wantsOf(report);
    assert.deepEqual(w.map((x) => [x.beyin, x.baslik, x.kaynakTuru]), [["ortam", "Draw siege towers", "fikir"], ["sef", "No brain named", "fikir"], ["ses", "whine in mix", "olcum"]]);
    assert.match(w[2]!.neden, /6 kHz → notch it/);
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-harvest-"));
    const file = path.join(root, "yapim-raporu.json");
    writeFileSync(file, JSON.stringify(report));
    assert.deepEqual(await harvestReport(root, file, "order-1"), { yeni: 3, tekrar: 0 });
    // The same report never counts twice; a missing one is nothing.
    assert.equal(await harvestReport(root, file, "order-1"), undefined);
    assert.equal(await harvestReport(root, path.join(root, "none.json"), "x"), undefined);
    assert.equal((await listProposals(root)).length, 3);
  });

  await scenario("D prompt additions and settings: kept only on a measured gain, the oldest kept one leaves, never tried twice", async () => {
    const empty: BrainTuning = { ekler: {}, ayarlar: {}, ayarGecmisi: [] };
    const add = (metin: string) => ({ metin, tarih: at(0) });
    const lost = settleAddition(empty, "kalite", add("Look at the top edge for cut badges"), 80, 80 + MIN_GAIN - 1);
    assert.equal(lost.ekler.kalite![0]!.durum, "geri_alindi");
    assert.equal(triedBefore(lost, "kalite", "look at the top edge for cut badges"), true);
    assert.equal(triedBefore(lost, "kalite", "Count the faces in the frame"), false);
    const won = settleAddition(lost, "kalite", add("Count the faces in the frame"), 80, 90);
    assert.deepEqual(won.ekler.kalite!.map((a) => a.durum), ["geri_alindi", "kalici"]);
    assert.deepEqual([won.ekler.kalite![1]!.olcumOnce, won.ekler.kalite![1]!.olcumSonra], [80, 90]);
    let full = won;
    for (let i = 0; i < MAX_ADDITIONS; i++) full = settleAddition(full, "kalite", add(`distinct rule number ${i} about frames ${"x".repeat(i)}`), 50, 60);
    assert.equal(full.ekler.kalite!.filter((a) => a.durum === "kalici").length, MAX_ADDITIONS);
    assert.equal(full.ekler.kalite!.find((a) => a.metin === "Count the faces in the frame")!.durum, "geri_alindi");
    // The exam's noise (90 % then 73 % on the same day): one lucky run keeps nothing; both runs must beat both bases.
    assert.deepEqual(confirmedGain([73], [90]), { once: 73, sonra: 90, kalici: false });
    assert.deepEqual(confirmedGain([73, 75], [88, 90]), { once: 74, sonra: 89, kalici: true });
    assert.equal(confirmedGain([73, 90], [88, 92]).kalici, false);
    assert.equal(confirmedGain([70, 72], [76, 77]).kalici, true);
    assert.equal(confirmedGain([70, 72], [74, 75]).kalici, false);
    assert.equal(settleAddition(empty, "kalite", add("a rule kept by the confirmation only"), 74, 89, false).ekler.kalite![0]!.durum, "geri_alindi");
    const set = settleSetting(empty, "kalite", "ornekler", true, 70, 80, new Date(T0));
    assert.equal(set.ayarlar.kalite?.ornekler, true);
    const kept = settleSetting(set, "kalite", "ornekler", false, 80, 82);
    assert.equal(kept.ayarlar.kalite?.ornekler, true);
    assert.deepEqual(kept.ayarGecmisi.map((h) => h.kalici), [true, false]);
    assert.throws(() => settleSetting(empty, "kalite", "model", true, 1, 99), /V3_SETTING_NOT_TUNABLE/);
    assert.throws(() => settleSetting(empty, "kurgu", "ornekler", true, 1, 99), /V3_SETTING_NOT_TUNABLE/);
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-tuning-"));
    assert.deepEqual(await readTuning(root), empty);
    await writeTuning(root, { ...won, ayarlar: set.ayarlar });
    assert.deepEqual(await activeAdditions(root, "kalite"), ["Count the faces in the frame"]);
    assert.deepEqual(await activeAdditions(root, "kurgu"), []);
    assert.equal(await tunedSetting(root, "kalite", "ornekler"), true);
    assert.equal(await tunedSetting(root, "kalite", "kenar"), undefined);
    const p = additionPrompt([{ tur: "harita", kusurlu: true, beklenen: "a cut label", cevap: "9/10, no fault named" }], ["Count the faces in the frame"], ["Look at the top edge"]);
    assert.match(p, /FAULTY \(a cut label\)/);
    assert.match(p, /do not repeat them\): "Look at the top edge"/);
    assert.match(p, /never name a person, place or episode/);
  });

  console.log(`PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
