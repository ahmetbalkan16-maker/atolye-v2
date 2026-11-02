/**
 * V3 smoke: learning from similar videos (ReferenceStudy) — captions, the pace measures taken alike of a reference and
 * of our own episode, frame notes, the study's lessons and their limits, targets and gaps, study requests, and the
 * memory forgetting a source studied again. No network, no GPU, no model.
 * Run: npx tsx scripts/smoke-v3-reference.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { allLessons, forgetSource, forgetWhere, hasSimilarLesson, recall, remember } from "../src/lib/v3/council/ExperienceMemory";
import {
  type Caption,
  consolidationPrompt,
  isReferenceLesson,
  nextSearch,
  parseConsolidation,
  REFERENCE_SUMMARY,
  type StudySearch,
  coveredSeconds,
  cutMeasures,
  frameShares,
  gapLesson,
  kindOf,
  listStudyRequests,
  MAX_STUDY_LESSONS_PER_BRAIN,
  measureGaps,
  parseFrameNote,
  parseJson3,
  parseStudy,
  pickSimilar,
  placeStudyRequest,
  type ReferenceRecord,
  referenceTargets,
  sampleTimes,
  shortenQuotes,
  speechMeasures,
  studyPrompt,
  targetsLine,
  transcriptExcerpt,
  youtubeId,
} from "../src/lib/v3/council/ReferenceStudy";

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

const cap = (start: number, end: number, text: string, turn = false): Caption => ({ start, end, text, turn });

async function main() {
  await scenario("A json3 captions: words joined, >> is a speaker turn, [müzik] is no word", () => {
    const json = { wireMagic: "pb3", events: [
      { tStartMs: 0, dDurationMs: 4880, segs: [{ utf8: "Bir" }, { utf8: " ulema" }, { utf8: " öldürüldü" }] },
      { tStartMs: 2350, dDurationMs: 2530, aAppend: 1, segs: [{ utf8: "\n" }] },
      { tStartMs: 5000, dDurationMs: 2000, segs: [{ utf8: ">> Hoca" }, { utf8: " Efendi?" }] },
      { tStartMs: 7000, dDurationMs: 1000, segs: [{ utf8: "[müzik]" }] },
      { tStartMs: 9000 },
    ] };
    const c = parseJson3(json);
    assert.equal(c.length, 2);
    assert.deepEqual(c[0], { start: 0, end: 4.88, text: "Bir ulema öldürüldü", turn: false });
    assert.equal(c[1]!.turn, true);
    assert.equal(c[1]!.text, "Hoca Efendi?");
    assert.deepEqual(parseJson3({}), []);
    assert.deepEqual(parseJson3(null), []);
  });

  await scenario("B speech measures: words per minute, covered time counted once, turns unknown without marks", () => {
    assert.equal(coveredSeconds([{ start: 0, end: 5 }, { start: 3, end: 8 }, { start: 10, end: 12 }]), 10);
    const lines = [cap(1, 5, "one two three four five six"), cap(4, 9, "seven eight nine ten?", true), cap(30, 32, "eleven twelve.")];
    const m = speechMeasures(lines, 60);
    assert.equal(m.kelimeDk, 12);
    assert.equal(m.konusmaPayi, 0.17);
    assert.equal(m.ilkSozSn, 1);
    assert.equal(m.sozDegisimiDk, 1);
    assert.ok(m.soruPayi! > 0 && m.soruPayi! < 1);
    // No ">>" at all: the speaker changes are unknown, not zero.
    assert.equal(speechMeasures([cap(0, 2, "a b c")], 60).sozDegisimiDk, undefined);
    // Our own lines know every speaker: the count is given.
    assert.equal(speechMeasures([cap(0, 2, "a b c")], 60, 6).sozDegisimiDk, 6);
    assert.deepEqual(speechMeasures([], 60), {});
    assert.deepEqual(cutMeasures([10, 20, 30], 120), { kesmeDk: 1.5, ortCekimSn: 30 });
    assert.deepEqual(cutMeasures([], 60), { kesmeDk: 0, ortCekimSn: 60 });
  });

  await scenario("C frame notes: only known kinds, counts clamped, shares", () => {
    const n = parseFrameNote(80.84, '{"tur":"karakter","kisi":2.4,"tarif":"Two cartoon characters on a beach"}');
    assert.deepEqual(n, { t: 80.8, tur: "karakter", kisi: 2, tarif: "Two cartoon characters on a beach" });
    assert.equal(parseFrameNote(1, '{"tur":"sky","kisi":1,"tarif":"x"}'), undefined);
    assert.equal(parseFrameNote(1, "not json"), undefined);
    assert.equal(parseFrameNote(1, '{"tur":"harita","kisi":999,"tarif":""}')!.kisi, 50);
    assert.deepEqual(frameShares([n!, n!, { t: 3, tur: "harita", kisi: 0, tarif: "" }]), { karakter: 0.67, harita: 0.33 });
    const times = sampleTimes(1000, 4);
    assert.equal(times.length, 4);
    assert.ok(times[0]! > 40 && times[3]! < 960);
  });

  await scenario("D the study prompt forbids copying and generic advice; the transcript carries time marks", () => {
    const captions = [cap(0, 3, "Bir ulema öldürüldü"), cap(10, 12, "ikinci satır", true), cap(45, 47, "üçüncü")];
    const ex = transcriptExcerpt(captions);
    assert.match(ex, /^\[0:00\] Bir ulema/);
    assert.match(ex, />> ikinci/);
    assert.match(ex, /\[0:45\] üçüncü/);
    assert.doesNotMatch(ex, /\[0:10\]/);
    const long = Array.from({ length: 900 }, (_, i) => cap(i * 2, i * 2 + 2, "kelime kelime kelime kelime kelime"));
    const cut = transcriptExcerpt(long, 1_000);
    assert.ok(cut.split(/\s+/).length < 1_200);
    assert.match(cut, /\[…\]/);
    const p = studyPrompt({ baslik: "T", kanal: "K", dil: "tr", measures: { sureSn: 600, kesmeDk: 3, ortCekimSn: 20 }, frames: [], transcript: ex });
    assert.match(p, /ONLY to learn/);
    assert.match(p, /Never copy/);
    assert.match(p, /Generic advice/);
    assert.match(p, /at most five words/);
  });

  await scenario("E study answers: known brains only, at most three each, long quotes shortened, apostrophes kept", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ beyin: "kurgu", metin: `Open every scene on a character line, lesson ${i}`, tr: "x" }));
    const s = parseStudy(JSON.stringify({ ozet: "iyi", dersler: [...many, { beyin: "kostum", metin: "a costume lesson that is long enough", tr: "" }, { beyin: "mizah", metin: "short", tr: "" }, { beyin: "mizah", metin: "Answer a grave line with a deadpan aside (e.g., 'Şu deniz manzarasına bak be. Harika ya.' at 1:03)", tr: "y" }] }));
    assert.ok(s);
    assert.equal(s.dersler.filter((d) => d.beyin === "kurgu").length, MAX_STUDY_LESSONS_PER_BRAIN);
    assert.equal(s.dersler.some((d) => (d.beyin as string) === "kostum"), false);
    const joke = s.dersler.find((d) => d.beyin === "mizah")!;
    assert.match(joke.metin, /'Şu deniz manzarasına bak be\.…'/);
    assert.equal(shortenQuotes("facts like '1635 yılında Kanuni'nin ardından gelen' at 8:28"), "facts like '1635 yılında Kanuni'nin ardından gelen' at 8:28");
    assert.equal(shortenQuotes("Kanuni'nin oğlu ve Murad'ın kardeşi"), "Kanuni'nin oğlu ve Murad'ın kardeşi");
    assert.equal(parseStudy("no json"), undefined);
  });

  await scenario("F targets: medians of the same kind, a line for the writer, gaps and their lessons", () => {
    const rec = (id: string, sureSn: number, kelimeDk: number, kesmeDk: number, sozDegisimiDk?: number): ReferenceRecord => ({ id, url: "", baslik: id, kanal: "", dil: "en", tarih: "", neden: "", olcum: { sureSn, kelimeDk, kesmeDk, ortCekimSn: 60 / kesmeDk, ilkSozSn: 0.5, ...(sozDegisimiDk !== undefined ? { sozDegisimiDk } : {}) }, kareler: [], ozet: "", dersler: [], eksik: [] });
    const refs = [rec("a", 900, 100, 4, 8), rec("b", 1200, 160, 6), rec("c", 1500, 140, 5, 10), rec("s", 50, 200, 20)];
    assert.equal(kindOf(60), "short");
    assert.equal(kindOf(600), "uzun");
    const t = referenceTargets(refs, "uzun")!;
    assert.equal(t.kaynak, 3);
    assert.equal(t.kelimeDk, 140);
    assert.equal(t.kesmeDk, 5);
    assert.equal(t.sozDegisimiDk, 9);
    assert.equal(referenceTargets(refs, "short")!.kelimeDk, 200);
    assert.equal(referenceTargets([], "uzun"), undefined);
    // No Short studied yet: all references stand in.
    assert.equal(referenceTargets(refs.slice(0, 3), "short")!.kaynak, 3);
    assert.match(targetsLine(t), /about 140 spoken words per minute/);
    assert.match(targetsLine(t), /a picture change about every 12 s/);
    const gaps = measureGaps({ sureSn: 1200, kelimeDk: 100, kesmeDk: 5.5, ortCekimSn: 11, sozDegisimiDk: 3, ilkSozSn: 9 }, t);
    assert.deepEqual(gaps.map((g) => g.olcu), ["kelimeDk", "sozDegisimiDk", "ilkSozSn"]);
    assert.ok(gaps[0]!.fark < 0);
    const l = gapLesson(gaps[0]!);
    assert.equal(l.beyin, "kurgu");
    assert.match(l.metin, /100 words\/min against the references' 140/);
    assert.match(l.metin, /tell more per scene/);
    assert.equal(gapLesson({ olcu: "kesmeDk", biz: 1, hedef: 5, fark: -0.8 }).beyin, "kalite");
  });

  await scenario("G links and search picks: YouTube only, same kind, not ours, not studied, most watched", () => {
    assert.equal(youtubeId("https://www.youtube.com/watch?v=8apicgLXhGg"), "8apicgLXhGg");
    assert.equal(youtubeId("https://youtu.be/8apicgLXhGg?t=3"), "8apicgLXhGg");
    assert.equal(youtubeId("https://www.youtube.com/shorts/abcdefghijk"), "abcdefghijk");
    assert.equal(youtubeId("https://www.youtube.com/watch?feature=x&v=Q-nWA0WeF98"), "Q-nWA0WeF98");
    assert.equal(youtubeId("https://vimeo.com/123"), undefined);
    const hit = (id: string, sureSn: number, izlenme: number, kanalId = "X") => ({ id, baslik: id, kanal: "", kanalId, sureSn, izlenme });
    const hits = [hit("short1", 50, 9e6), hit("mine1", 900, 8e6, "OURS"), hit("seen1", 900, 7e6), hit("long1", 1100, 5e6), hit("long2", 1300, 6e6), hit("huge", 4 * 3600, 9e9)];
    assert.equal(pickSimilar(hits, 1200, { ownChannelId: "OURS", studied: new Set(["seen1"]) })!.id, "long2");
    assert.equal(pickSimilar(hits, 60, { studied: new Set() })!.id, "short1");
    assert.equal(pickSimilar([hit("a", 900, 1)], 60, { studied: new Set() }), undefined);
  });

  await scenario("H study requests are written for the watcher; the memory forgets a source studied again", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-ref-"));
    const r = await placeStudyRequest(root, "https://youtu.be/8apicgLXhGg", "ayas", new Date("2026-11-02T20:00:00Z"));
    assert.equal(r.durum, "bekliyor");
    const list = await listStudyRequests(root);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.request.url, "https://www.youtube.com/watch?v=8apicgLXhGg");
    await assert.rejects(placeStudyRequest(root, "https://example.com/x", "ayas"), /REFERENCE_NOT_YOUTUBE/);
    await remember(root, { bolum: "referans 8apicgLXhGg", beyin: "kurgu", tur: "ders", konu: "referans: T", metin: "old generic lesson" });
    await remember(root, { bolum: "Caesar", beyin: "kurgu", tur: "ders", konu: "senaryo", metin: "a lesson from a production" });
    await remember(root, { bolum: "referans 8apicgLXhGg", beyin: "kurgu", tur: "ders", konu: "referans: T", metin: "old lesson two" });
    assert.equal(await forgetSource(root, "kurgu", "referans 8apicgLXhGg"), 2);
    assert.deepEqual((await recall(root, "kurgu", { limit: 10 })).map((l) => l.metin), ["a lesson from a production"]);
    assert.equal(await forgetSource(root, "kurgu", "referans 8apicgLXhGg"), 0);
    assert.equal(await forgetSource(root, "mizah", "x"), 0);
    // A broken line is kept, never lost by a rewrite.
    const file = path.join(root, "_kutuphane", "deneyim", "kurgu.jsonl");
    writeFileSync(file, `${readFileSync(file, "utf8")}{broken\n`);
    await remember(root, { bolum: "referans z", beyin: "kurgu", tur: "ders", konu: "k", metin: "z lesson" });
    assert.equal(await forgetSource(root, "kurgu", "referans z"), 1);
    assert.match(readFileSync(file, "utf8"), /\{broken/);
    assert.ok(existsSync(file));
  });

  await scenario("I own searches, consolidation and the writer's shares: the same advice never piles up", async () => {
    const list = JSON.parse(readFileSync(path.join("content", "v3", "referans-aramalari.json"), "utf8")) as { aramalar: StudySearch[] };
    assert.ok(list.aramalar.length >= 6);
    assert.ok(list.aramalar.every((s) => s.sorgu.trim() && (s.tur === "short" || s.tur === "uzun")));
    assert.ok(list.aramalar.some((s) => s.tur === "short") && list.aramalar.some((s) => s.tur === "uzun"));
    const s3 = [{ sorgu: "a", tur: "uzun" as const }, { sorgu: "b", tur: "short" as const }, { sorgu: "c", tur: "uzun" as const }];
    assert.equal(nextSearch(s3, {})!.sorgu, "a");
    assert.equal(nextSearch(s3, { a: "2026-11-02T10:00:00Z", b: "2026-11-02T09:00:00Z" })!.sorgu, "c");
    assert.equal(nextSearch(s3, { a: "2026-11-02T10:00:00Z", b: "2026-11-02T09:00:00Z", c: "2026-11-02T11:00:00Z" })!.sorgu, "b");
    assert.equal(nextSearch([], {}), undefined);
    assert.equal(isReferenceLesson({ bolum: "referans 8apicgLXhGg" }), true);
    assert.equal(isReferenceLesson({ bolum: REFERENCE_SUMMARY }), true);
    assert.equal(isReferenceLesson({ bolum: "karsilastirma x" }), false);
    assert.equal(isReferenceLesson({ bolum: "Caesar" }), false);
    const p = consolidationPrompt("mizah", [{ metin: "Undercut a grave line with a deadpan aside", kaynak: "IV. MURAD", destek: 1 }, { metin: "Let a side character mock the hero once a scene", kaynak: "özet", destek: 5 }]);
    assert.match(p, /the humour writer/);
    assert.match(p, /\[IV. MURAD\] \(1 video\) Undercut/);
    // An earlier summary brings its own count, so its support adds up.
    assert.match(p, /\[özet\] \(5 videos\) Let a side character/);
    assert.match(p, /add up the counts/);
    assert.match(p, /at most 8 lessons/);
    const merged = parseConsolidation(JSON.stringify({ dersler: [{ metin: "Open on a character in trouble within two seconds", tr: "a", destek: 2 }, { metin: "Answer every narrator stretch with a short character reply", tr: "b", destek: 5 }, { metin: "short", destek: 9 }, { metin: "Cut to a map whenever an army moves on screen", destek: "x" }] }))!;
    assert.deepEqual(merged.map((m) => m.destek), [5, 2, 1]);
    assert.equal(parseConsolidation(JSON.stringify({ dersler: [{ metin: "Only one usable consolidated lesson here" }] })), undefined);
    assert.equal(parseConsolidation("no"), undefined);
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-ref-mem-"));
    await remember(root, { bolum: "Caesar", beyin: "kurgu", tur: "ders", konu: "senaryo", metin: "A Short of at most 60 s ran 75 s: write fewer, shorter lines." });
    for (let i = 0; i < 5; i++) await remember(root, { bolum: `referans v${i}`, beyin: "kurgu", tur: "ders", konu: `referans: v${i}`, metin: `Reference technique number ${i} about hooks ${"z".repeat(i)}` });
    assert.equal(await hasSimilarLesson(root, "kurgu", "Reference technique number 3 about hooks zzz"), true);
    assert.equal(await hasSimilarLesson(root, "kurgu", "Draw every army as two facing fronts"), false);
    // The writer's shares: production lessons and reference lessons are asked apart.
    assert.deepEqual((await recall(root, "kurgu", { limit: 4, filter: (l) => !isReferenceLesson(l) })).map((l) => l.bolum), ["Caesar"]);
    assert.equal((await recall(root, "kurgu", { tur: "ders", limit: 3, filter: isReferenceLesson })).length, 3);
    assert.equal(await forgetWhere(root, "kurgu", isReferenceLesson), 5);
    assert.equal((await allLessons(root, "kurgu")).length, 1);
  });

  console.log(`PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
