/**
 * V3 smoke: Crowns & Doodles' video goals (owner, 5 Nov 2026) — the one goals file, length-normalised targets, the
 * Short beat map handed to the writer, the first-3-seconds and scene-plan QC, post-publish records that never count
 * an unmeasured number as reached, targets that only ever rise, and the pilot's balanced plan.
 * No network, no model, no production data (records go to a TEMP work root).
 * Run: npx tsx scripts/smoke-v3-channel-goals.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  channelGoalNote, evaluatePerformance, latestPerVideo, loadChannelGoals, nextShortTargets, openingChecks, parseChannelGoals,
  PERFORMANCE_METRICS, performanceLessons, pilotTrends, scenePlanCheck, shortBeatRule, shortBeats, type VideoPerformanceRecord, viewTargetSeconds,
} from "../src/lib/v3/publish/ChannelGoals";
import { listPerformance, parsePerformanceInput, savePerformance } from "../src/lib/v3/publish/VideoPerformanceStore";
import { writingPrompt } from "../src/lib/v3/script/ScriptPrompts";

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

const contentRoot = path.join(process.cwd(), "content", "v3");
const goals = loadChannelGoals(contentRoot)!;
const empty = Object.fromEntries(PERFORMANCE_METRICS.map((k) => [k, null])) as VideoPerformanceRecord["metrikler"];
const rec = (videoId: string, metrics: Partial<VideoPerformanceRecord["metrikler"]>, extra: Partial<VideoPerformanceRecord> = {}): VideoPerformanceRecord =>
  ({ schemaVersion: 1, videoId, sureSn: 45, olcumTarihi: "2026-11-12", olcumAni: "7g", kaynak: "studio-elle", metrikler: { ...empty, ...metrics }, ...extra });

async function main() {
  await scenario("A the goals file holds the owner's real Studio numbers and is the only source", () => {
    assert.ok(goals, "content/v3/kanal-hedefleri.json is read");
    assert.equal(goals.kanal.ad, "Crowns & Doodles");
    assert.equal(goals.kanal.dil, "en-US");
    const v = goals.baslangic.video;
    assert.deepEqual([v.videoId, v.izlemeyiSecenler, v.ortIzlemeSn, v.goruntuleme], ["q8JW_i5Gt0M", 0.52, 23, 1190], "video numbers, not the channel's");
    assert.equal((goals.baslangic.kanal as { izlemeyiSecenler: number }).izlemeyiSecenler, 0.519);
    assert.deepEqual([goals.hedefler.short.izlemeyiSecenler.min, goals.hedefler.short.izlemeyiSecenler.max], [0.58, 0.6]);
    assert.equal(goals.hedefler.uzun.durum, "HEDEF_TANIMLANMADI", "no invented long-video target");
    assert.deepEqual(goals.diziler.map((d) => [d.oncelik, d.ad]), [[1, "History's Most Insane Moments"], [2, "Wars That Changed Everything"], [3, "Rise and Fall of Empires"]]);
    // The numbers live in the JSON only: the code that uses them does not repeat them.
    for (const file of ["src/lib/v3/publish/ChannelGoals.ts", "src/lib/v3/script/ScriptPrompts.ts", "scripts/atolye-v3.ts"]) {
      assert.doesNotMatch(readFileSync(path.join(process.cwd(), file), "utf8"), /0\.58\b|0\.622\b|26–28 s/, `${file} copies a goal number`);
    }
  });

  await scenario("B watch time is judged by the video's own length: 45 s → 26–28 s, 30 s and 60 s scale; a long video has no target", () => {
    assert.deepEqual(viewTargetSeconds(goals, 45), { min: 26, max: 28 });
    assert.deepEqual(viewTargetSeconds(goals, 30), { min: 17.3, max: 18.7 });
    assert.deepEqual(viewTargetSeconds(goals, 60), { min: 34.7, max: 37.3 });
    assert.equal(viewTargetSeconds(goals, 600), undefined);
  });

  await scenario("C the Short beat map: 0–2 s hook stays, the rest keeps its share; the writer gets it for a Short only", () => {
    assert.deepEqual(shortBeats(goals, 45).map((b) => [b.id, b.basSn, b.bitSn]), [["kanca", 0, 2], ["baglam", 2, 9], ["catisma", 9, 24], ["doruk", 24, 38], ["final", 38, 45]]);
    const b30 = shortBeats(goals, 30);
    assert.deepEqual([b30[0]!.basSn, b30[0]!.bitSn, b30.at(-1)!.bitSn], [0, 2, 30]);
    assert.ok(b30.every((b, i) => b.bitSn > b.basSn && (i === 0 || b.basSn === b30[i - 1]!.bitSn)));
    assert.equal(shortBeats(goals, 60).at(-1)!.bitSn, 60);
    const rule = shortBeatRule(goals, 45, "en");
    assert.match(rule, /^- BEAT MAP \(approximate; the story's own flow comes first\): 0–2 s the hook/);
    assert.match(rule, /38–45 s a memorable closing quip .*never "subscribe"/);
    const brief = { konu: "Caesar and the pirates", donem: "75 BC", ton: "mizahi" as const, dil: "en" as const };
    assert.ok(writingPrompt({ ...brief, hedefSureSn: 45, kisaZamanHaritasi: rule }, []).includes(rule));
    assert.ok(!writingPrompt({ ...brief, hedefSureSn: 45 }, []).includes("BEAT MAP"), "without goals the prompt is as before");
    assert.match(shortBeatRule(goals, 45, "tr"), /^- ZAMAN HARİTASI/);
  });

  await scenario("D a missing number is never a pass: VERI_EKSIK; the Caesar baseline is below the new targets; a long video has none", () => {
    const caesar = rec("q8JW_i5Gt0M", { izlemeyiSecenler: 0.52, ortIzlemeSn: 23 }, { sureSn: 44 });
    const e = evaluatePerformance(caesar, goals);
    assert.equal(e.sonuc, "HEDEF_ALTI");
    assert.deepEqual(e.kontroller.map((c) => c.durum), ["HEDEF_ALTI", "HEDEF_ALTI"]);
    assert.equal(e.kontroller[0]!.baslangicFarki, 0);
    assert.equal(evaluatePerformance(rec("x0000000001", { ortIzlemeSn: 30 }), goals).sonuc, "VERI_EKSIK");
    assert.equal(evaluatePerformance(rec("x0000000002", {}), goals).kontroller[1]!.durum, "OLCULMEDI");
    assert.equal(evaluatePerformance(rec("x0000000003", { izlemeyiSecenler: 0.59, ortIzlemeSn: 27 }), goals).sonuc, "HEDEFTE");
    assert.equal(evaluatePerformance(rec("x0000000004", { izlemeyiSecenler: 0.7, ortGoruntulenenYuzde: 1.1 }), goals).sonuc, "HEDEF_USTU", "Studio's own viewed share is preferred (a loop passes 100%)");
    assert.equal(evaluatePerformance(rec("x0000000005", { izlemeyiSecenler: 0.7, ortIzlemeSn: 300 }, { sureSn: 900 }), goals).sonuc, "HEDEF_YOK");
    assert.deepEqual(performanceLessons(rec("x0000000006", {}), evaluatePerformance(rec("x0000000006", {}), goals)), [], "no lesson from numbers nobody measured");
    const lessons = performanceLessons(caesar, e, { kanca: "0.0 sn'de Caesar konuşuyor" });
    assert.equal(lessons.length, 1);
    assert.match(lessons[0]!.metin, /52% of the feed chose to view it \(target 58%–60%\).*Its opening: 0\.0 sn'de Caesar konuşuyor\. Below target — the first 2 seconds/);
  });

  await scenario("E the owner's Studio reading parses as written (Turkish numbers, percents); bad input fails loudly", () => {
    const r = parsePerformanceInput({ videoId: "q8JW_i5Gt0M", sureSn: 44, olcumAni: "7g", olcumTarihi: "2026-11-05", metrikler: { izlemeyiSecenler: "52%", kaydiranlar: 48, goruntuleme: "1.190", izlenmeSaat: "3,8", ortIzlemeSn: 23, ortGoruntulenenYuzde: "104%" }, ulkeler: [{ ulke: "us", pay: "25,5%", goruntuleme: 307, ortIzlemeSn: 30 }], trafik: { shortsAkisi: "96,8%", youtubeArama: 0.008 } });
    assert.deepEqual([r.metrikler.izlemeyiSecenler, r.metrikler.kaydiranlar, r.metrikler.goruntuleme, r.metrikler.izlenmeSaat, r.metrikler.ortGoruntulenenYuzde], [0.52, 0.48, 1190, 3.8, 1.04]);
    assert.equal(parsePerformanceInput({ videoId: "q8JW_i5Gt0M", sureSn: 44, olcumAni: "48s", metrikler: { izlenmeSaat: "3.9" } }).metrikler.izlenmeSaat, 3.9, "a plain decimal point stays a decimal");
    assert.equal(r.metrikler.aboneKazanimi, null, "not in the file → null, never 0");
    assert.deepEqual(r.ulkeler, [{ ulke: "US", pay: 0.255, goruntuleme: 307, ortIzlemeSn: 30 }]);
    assert.deepEqual(r.trafik, { shortsAkisi: 0.968, youtubeArama: 0.008 });
    assert.throws(() => parsePerformanceInput({ videoId: "q8JW_i5Gt0", sureSn: 44, olcumAni: "7g" }), /videoId 11 karakterlik/);
    assert.throws(() => parsePerformanceInput({ videoId: "q8JW_i5Gt0M", olcumAni: "7g" }), /sureSn/);
    assert.throws(() => parsePerformanceInput({ videoId: "q8JW_i5Gt0M", sureSn: 44, olcumAni: "7g", metrikler: { ctr: 0.1 } }), /bilinmeyen metrik: ctr/);
    assert.throws(() => parsePerformanceInput({ videoId: "q8JW_i5Gt0M", sureSn: 44, olcumAni: "7g", metrikler: { izlemeyiSecenler: "150%" } }), /çok büyük/);
  });

  await scenario("F the next Short's target only rises: three measured Shorts above the band move it up; fewer or worse never lower it", () => {
    const owner = goals.hedefler.short.izlemeyiSecenler;
    assert.deepEqual(nextShortTargets(goals, [rec("a0000000001", { izlemeyiSecenler: 0.9, ortIzlemeSn: 40 })]).izlemeyiSecenler, owner, "one great video does not move it");
    const good = ["2026-11-10", "2026-11-11", "2026-11-12"].map((d, i) => rec(`g000000000${i}`, { izlemeyiSecenler: [0.64, 0.66, 0.7][i]!, ortIzlemeSn: 27 }, { olcumTarihi: d }));
    const raised = nextShortTargets(goals, good);
    assert.deepEqual([raised.izlemeyiSecenler.min, raised.izlemeyiSecenler.max], [0.66, 0.68]);
    assert.deepEqual(raised.ortIzlenmeOrani, goals.hedefler.short.ortIzlenmeOrani, "a metric still inside its band keeps it");
    const bad = good.map((r) => ({ ...r, metrikler: { ...r.metrikler, izlemeyiSecenler: 0.4 } }));
    assert.deepEqual(nextShortTargets(goals, bad).izlemeyiSecenler, owner, "never lowered");
    assert.equal(latestPerVideo([rec("v0000000001", { izlemeyiSecenler: 0.5 }, { olcumAni: "7g", olcumTarihi: "2026-11-12" }), rec("v0000000001", { izlemeyiSecenler: 0.6 }, { olcumAni: "48s", olcumTarihi: "2026-11-13" })])[0]!.metrikler.izlemeyiSecenler, 0.5, "the 7-day reading wins");
  });

  await scenario("G the pilot: 2+2+2 Shorts, each series at two hours and each hour two series; tendencies are series-adjusted and labelled as such", () => {
    const plan = goals.pilot.videolar;
    assert.equal(plan.length, 6);
    assert.deepEqual(goals.diziler.map((d) => plan.filter((v) => v.dizi === d.id).length), [2, 2, 2]);
    for (const d of goals.diziler) assert.equal(new Set(plan.filter((v) => v.dizi === d.id).map((v) => v.saat)).size, 2, `${d.id} at two hours`);
    for (const h of ["19:00", "20:00", "21:00"]) assert.equal(new Set(plan.filter((v) => v.saat === h).map((v) => v.dizi)).size, 2, `${h} carries two series`);
    assert.ok(plan.every((v) => v.dogruluk), "every pilot topic carries its accuracy note");
    const records = plan.map((v) => rec(`p00000000${String(v.no).padStart(2, "0")}`, { izlemeyiSecenler: 0.5 + (v.saat === "21:00" ? 0.04 : 0) + (v.dizi === "insane-moments" ? 0.05 : 0) }, { pilotNo: v.no }));
    const t = pilotTrends(goals, records);
    assert.equal(t.olculen, 6);
    const at = (h: string) => t.saatler.find((s) => s.saat === h)!.diziyeGoreFark!;
    assert.ok(at("21:00") > at("19:00") && at("21:00") > at("20:00"), "the hour effect shows after taking out the series");
    assert.match(t.uyari, /kesin sonuç değildir/);
    assert.equal(pilotTrends(goals, []).olculen, 0);
  });

  await scenario("H the first three seconds and the scene plan are measured from the plan; the goal note never claims a pass", () => {
    const good = openingChecks(goals, { firstLine: { text: "You kidnapped the wrong Roman.", byCharacter: true, startS: 0.3 }, firstVisualEventS: 0.5, firstSceneCards: ["yer_tarih"] });
    assert.deepEqual(good.map((c) => c.ok), [true, true, true]);
    const bad = openingChecks(goals, { firstLine: { text: "In the year 75 BC, a young Roman nobleman sailed to Rhodes to study.", byCharacter: false, startS: 2.5 }, firstSceneCards: ["kelime"] });
    assert.deepEqual(bad.map((c) => c.ok), [false, false, false]);
    assert.match(bad[0]!.text, /ANLATICI, 14 kelime/);
    const scene = (id: string, extra: Record<string, unknown> = {}) => ({ id, muzik_ruh_hali: "playful", satirlar: [{ jest: "point", sfx: "pop" }], kamera: [{ tip: "zoom", t: 0 }], gecis: "wipe", ...extra });
    assert.equal(scenePlanCheck([scene("s1"), scene("s2")]).ok, true);
    const gaps = scenePlanCheck([scene("s1"), scene("s2", { kamera: undefined, gecis: undefined, satirlar: [{}] }), scene("s3", { kamera: undefined, satirlar: [{}], harita: { kamera: [{}], ordular: [{}] } })]);
    assert.equal(gaps.ok, false);
    assert.match(gaps.text, /kamera: s2; efekt: s2, s3; karakter hareketi: s2; geçiş: s2/);
    assert.match(channelGoalNote(goals, 45), /yayından sonra ölçülür — şimdi geçti sayılmaz[^]*\n- İzlemeyi seçenler: hedef %58–%60 \(başlangıç %52\)\n- Ortalama izlenme: hedef 26–28 sn \/ 45 sn/);
    assert.match(channelGoalNote(goals, 900), /HEDEF_TANIMLANMADI/);
  });

  await scenario("I records are kept per video, moment and day in the work root; a broken goals file is refused", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-kanal-"));
    const r = parsePerformanceInput({ videoId: "q8JW_i5Gt0M", sureSn: 44, olcumAni: "7g", olcumTarihi: "2026-11-05", metrikler: { izlemeyiSecenler: 0.52 } });
    const file = await savePerformance(root, r);
    assert.match(file, /_kutuphane[\\/]kanal[\\/]performans[\\/]q8JW_i5Gt0M-7g-2026-11-05\.json$/);
    await savePerformance(root, { ...r, metrikler: { ...r.metrikler, izlemeyiSecenler: 0.53 } });
    await savePerformance(root, { ...r, olcumAni: "48s", olcumTarihi: "2026-11-04" });
    const all = await listPerformance(root);
    assert.equal(all.length, 2, "the same video, moment and day is replaced, not duplicated");
    assert.equal(latestPerVideo(all)[0]!.metrikler.izlemeyiSecenler, 0.53);
    const raw = JSON.parse(readFileSync(path.join(contentRoot, "kanal-hedefleri.json"), "utf8"));
    assert.throws(() => parseChannelGoals({ ...raw, shortsYapisi: { ...raw.shortsYapisi, bolumler: [{ id: "a", basSn: 0, bitSn: 2 }, { id: "b", basSn: 3, bitSn: 45 }, { id: "c", basSn: 45, bitSn: 46 }] } }), /ardışık değil/);
    assert.throws(() => parseChannelGoals({ ...raw, hedefler: { ...raw.hedefler, short: { ...raw.hedefler.short, izlemeyiSecenler: { min: 0.6, max: 0.5 } } } }), /min ≤ max/);
    assert.throws(() => parseChannelGoals({ ...raw, pilot: { ...raw.pilot, videolar: [{ ...raw.pilot.videolar[0], dizi: "yok" }] } }), /bilinmeyen dizi/);
  });

  console.log(`PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
