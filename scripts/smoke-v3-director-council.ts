/**
 * V3 smoke: AYAS as the director (DirectorCouncil) — the council's script view, the critics' reports and replies, AYAS's
 * fixes from the fixed menu and their limits, the writer's rewrites, the fixed episode, the session as a transcript,
 * and the retouch round carrying the fixes and choosing the best round by the council's mean. Fake models only.
 * Run: npx tsx scripts/smoke-v3-director-council.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers/AIProvider";
import {
  applyEdits,
  bubbleFor,
  compactScript,
  councilCapUsd,
  councilMean,
  criticPrompt,
  DIRECTOR_BAR,
  findScene,
  lineIndex,
  type DirectorEdit,
  editsStep,
  effectiveEdits,
  holdCouncil,
  MAX_NOTES,
  onStage,
  parseCriticReport,
  parseDecision,
  parseReply,
  parseRewrites,
  sessionDebate,
} from "../src/lib/v3/council/DirectorCouncil";
import { bestRound, keepRound, restoreRound, retouchDebate, type RoundScore, roundLine, withDirector } from "../src/lib/v3/council/RetouchBrain";
import { assertEpisode } from "../src/lib/v3/episode/EpisodeValidator";
import { V3Budget } from "../src/lib/v3/script/V3Budget";

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

const episode = assertEpisode(JSON.parse(readFileSync(path.join("content", "v3", "ornekler", "rubicon-an.json"), "utf8")));
const MAP = episode.sahneler[0]!.id;
const STAGE = episode.sahneler[1]!.id;

/** Answers by the prompt's kind, and counts the calls. */
class CouncilModel implements AIProvider {
  readonly calls: string[] = [];
  constructor(private readonly answers: { critic: (prompt: string) => string; reply?: string; director?: string; rewrite?: string }) {}
  async generate(prompt: string): Promise<AIProviderResult> {
    const kind = prompt.includes("Score the cut") ? "critic" : prompt.includes("support the notes") ? "reply" : prompt.startsWith("You are AYAS") ? "director" : prompt.includes("asked for these lines to be rewritten") ? "rewrite" : "other";
    this.calls.push(kind);
    const content = kind === "critic" ? this.answers.critic(prompt) : kind === "reply" ? (this.answers.reply ?? "{}") : kind === "director" ? (this.answers.director ?? "{}") : kind === "rewrite" ? (this.answers.rewrite ?? "{}") : "{}";
    return { content, finishReason: "stop", refused: false, complete: true, truncated: false };
  }
}

const critic = (puan: number, notlar: unknown[] = []) => JSON.stringify({ puan, notlar });
const budgetOf = (model: AIProvider) => new V3Budget({ providers: { ollama: model }, capUsd: 0.1 });

async function main() {
  await scenario("A the council reads the script: scenes by kind, who is on stage, numbered lines, voices only", () => {
    const s = compactScript(episode, { scenes: [{ start: 0, end: 12 }, { start: 12, end: 40 }] });
    assert.match(s, new RegExp(`SCENE ${MAP} — map`));
    assert.match(s, new RegExp(`SCENE ${STAGE} — stage — .* — set: nehir_gecidi, roma, gece — on stage: legionary, caesar — 12–40 s`));
    assert.match(s, /#3 caesar \(kararli\): The die is cast! \[gesture yumruk_kaldir, bubble "THE DIE IS CAST!"\]/);
    assert.match(s, /#0 anlatici \(voice only\)/);
    assert.deepEqual([...onStage(episode.sahneler[0]!)], []);
    assert.deepEqual([...onStage(episode.sahneler[1]!)].sort(), ["caesar", "legionary"]);
    assert.equal(councilCapUsd(60), 0.1);
    assert.equal(councilCapUsd(1500), 0.3);
  });

  await scenario("B critics' reports: known scenes, lines in range, menu fixes or 'yok', score clamped, numbered notes", () => {
    // The Caesar Short's critics wrote "s1" for "s1-capture": a short id finds its one scene, an ambiguous one none.
    assert.equal(findScene(episode, "s1")?.id, STAGE);
    assert.equal(findScene(episode, STAGE)?.id, STAGE);
    assert.equal(findScene({ sahneler: [episode.sahneler[1]!, { ...episode.sahneler[1]!, id: "s1-other" }] }, "s1"), undefined);
    assert.equal(findScene(episode, ""), undefined);
    assert.equal(parseCriticReport("kurgu", critic(6, [{ sahne: "s1", satir: 2, sorun: "kısa kimlik", oneri: "x", eylem: "satir" }]), episode)!.notlar[0]!.sahne, STAGE);
    assert.match(criticPrompt("kurgu", "", { baslik: "", sureSn: 1, shorts: true }, [], STAGE), new RegExp(`"sahne": "${STAGE}"`));
    const r = parseCriticReport("mizah", critic(12, [
      { sahne: STAGE, satir: 5, sorun: "espri düz kalıyor", oneri: "daha keskin yaz", eylem: "satir" },
      { sahne: "nope", sorun: "x", oneri: "y", eylem: "satir" },
      { sahne: STAGE, satir: 99, sorun: "satır yok", oneri: "z", eylem: "oyun" },
      { sahne: MAP, sorun: "harita boş", oneri: "ordu ekle", eylem: "haritayi_degistir" },
      ...Array.from({ length: 8 }, () => ({ sahne: STAGE, sorun: "fazla", oneri: "a", eylem: "satir" })),
    ]), episode, 4)!;
    assert.equal(r.puan, 10);
    assert.equal(r.notlar.length, MAX_NOTES);
    assert.deepEqual(r.notlar.map((n) => n.id), ["n4", "n5", "n6", "n7", "n8"]);
    assert.equal(r.notlar[1]!.satir, undefined);
    assert.equal(r.notlar[2]!.eylem, "yok");
    assert.equal(parseCriticReport("kurgu", "no json", episode), undefined);
    assert.equal(parseCriticReport("kurgu", '{"notlar": []}', episode), undefined);
    const y = parseReply("arastirma", JSON.stringify({ destek: ["n4", "n4", "n99"], itiraz: [{ id: "n5", neden: "tarih bozulur" }, { id: "n77", neden: "x" }, { id: "n6" }] }), new Set(["n4", "n5", "n6"]));
    assert.deepEqual(y.destek, ["n4"]);
    assert.deepEqual(y.itiraz, [{ id: "n5", neden: "tarih bozulur" }]);
    assert.deepEqual(parseReply("kurgu", "garbage", new Set(["n1"])), { beyin: "kurgu", destek: [], itiraz: [] });
    assert.equal(councilMean([{ beyin: "kurgu", puan: 6, notlar: [] }, { beyin: "mizah", puan: 7, notlar: [] }, { beyin: "kalite", puan: 7, notlar: [] }]), 6.7);
  });

  await scenario("C AYAS's fixes: only the menu, only actors on that stage (never the speaker), no set on a map", () => {
    const d = parseDecision(episode, JSON.stringify({ ozet: "Kesim iyi ama espriler zayıf.", duzeltmeler: [
      { tur: "satir", sahne: STAGE, satir: 5, talimat: "Make the punchline sharper", neden: "espri" },
      { tur: "satir", sahne: STAGE, satir: 5, talimat: "again", neden: "tekrar" },
      { tur: "oyun", sahne: STAGE, satir: 0, oyun: [{ karakter: "legionary", jest: "omuz_silk", duygu: "saskin" }, { karakter: "pompey", jest: "kutla" }, { karakter: "caesar", jest: "dans_et", efekt: "ter" }, { karakter: "legionary", jest: "kutla", efekt: "unlem" }], neden: "anlatılan oynansın" },
      // AYAS writes line numbers as "#3" too (Caesar Short, 2 Nov 2026); the speaker's own act is kept for its line.
      { tur: "oyun", sahne: STAGE, satir: "#3", oyun: [{ karakter: "caesar", jest: "yumruk_kaldir", duygu: "kizgin" }], neden: "konuşan kendisi" },
      { tur: "set", sahne: MAP, manzara: "ova", neden: "harita" },
      { tur: "set", sahne: STAGE, manzara: "uzay", tasarim: "short", neden: "geçersiz" },
      { tur: "set", sahne: STAGE, manzara: "nehir_kiyisi", neden: "kıyı daha uygun" },
      { tur: "haritayi_buyut", sahne: MAP },
      { tur: "satir", sahne: "nope", satir: 0, talimat: "x" },
    ] }))!;
    assert.equal(d.ozet, "Kesim iyi ama espriler zayıf.");
    assert.deepEqual(d.duzeltmeler.map((e) => e.tur), ["satir", "oyun", "oyun", "set"]);
    assert.equal(d.elenen, 4);
    const act = d.duzeltmeler[1] as Extract<DirectorEdit, { tur: "oyun" }>;
    // One act per character: its first gesture and face, an effect it gained later.
    assert.deepEqual(act.oyun, [{ karakter: "legionary", jest: "omuz_silk", duygu: "saskin", efekt: "unlem" }, { karakter: "caesar", efekt: "ter" }]);
    const own = d.duzeltmeler[2] as Extract<DirectorEdit, { tur: "oyun" }>;
    assert.equal(own.satir, 3);
    const spoken = applyEdits(episode, [own], []).sahneler[1]!.satirlar[3]!;
    assert.deepEqual([spoken.jest, spoken.duygu, spoken.oyun], ["yumruk_kaldir", "kizgin", undefined]);
    assert.equal(lineIndex(episode.sahneler[1]!, `${STAGE}#4`), 4);
    assert.equal(lineIndex(episode.sahneler[1]!, "7"), undefined);
    assert.equal(lineIndex(episode.sahneler[1]!, "line two"), undefined);
    const capped = parseDecision(episode, JSON.stringify({ ozet: "", duzeltmeler: [0, 1, 2, 3, 4, 5].map((i) => ({ tur: "satir", sahne: STAGE, satir: i, talimat: "tighten" })) }), 3)!;
    assert.equal(capped.duzeltmeler.length, 3);
    assert.equal(parseDecision(episode, "nothing"), undefined);
  });

  await scenario("D rewrites: only ordered lines, sane length, a bubble only where one was; the fixed episode stays valid", () => {
    const edits: DirectorEdit[] = [
      { tur: "satir", sahne: STAGE, satir: 5, talimat: "sharper", neden: "" },
      { tur: "satir", sahne: STAGE, satir: 2, talimat: "shorter", neden: "" },
      { tur: "satir", sahne: STAGE, satir: 4, talimat: "louder", neden: "" },
      { tur: "oyun", sahne: STAGE, satir: 0, oyun: [{ karakter: "legionary", jest: "omuz_silk" }], neden: "" },
      { tur: "set", sahne: STAGE, manzara: "nehir_kiyisi", tasarim: "A muddy Roman riverbank at night, torches, no bridge", neden: "" },
    ];
    const rw = parseRewrites(episode, edits, JSON.stringify({ satirlar: [
      { sahne: STAGE, satir: 5, metin: "Right behind you, sir! Well... a bit behind.", balon: "A bit behind!" },
      { sahne: STAGE, satir: 2, metin: "x".repeat(200) },
      { sahne: STAGE, satir: 4, metin: "Forward, Thirteenth! Into history!", balon: "no bubble here" },
      { sahne: STAGE, satir: 1, metin: "not ordered" },
    ] }));
    assert.deepEqual(rw.map((r) => r.satir), [5, 4]);
    assert.equal(rw[0]!.balon, "A bit behind!");
    assert.equal(rw[1]!.balon, undefined);
    // A bubble the new line does not say is replaced by the line's own last words; an added stage direction is dropped.
    const loose = parseRewrites(episode, [{ tur: "satir", sahne: STAGE, satir: 1, talimat: "x", neden: "" }], JSON.stringify({ satirlar: [{ sahne: STAGE, satir: 1, metin: "(leans in) Sir, do we swim it or salute it? Pick one!", balon: "You raised your ransom?" }] }));
    assert.equal(loose[0]!.metin, "Sir, do we swim it or salute it? Pick one!");
    assert.equal(loose[0]!.balon, "Pick one!");
    assert.equal(bubbleFor("One two three four five six seven eight nine ten.", ""), "One two three four five six seven eight…");
    assert.equal(rw[0]!.eski, "Right behind you, sir! Mostly.");
    const effective = effectiveEdits(edits, rw);
    assert.equal(effective.some((e) => e.tur === "satir" && e.satir === 2), false);
    assert.equal(editsStep(effective), "ses");
    assert.equal(editsStep(effective.filter((e) => e.tur !== "satir")), "gorsel");
    assert.equal(editsStep(effective.filter((e) => e.tur === "oyun")), "render");
    assert.equal(editsStep([]), undefined);
    const fixed = assertEpisode(applyEdits(episode, effective, rw));
    const sc = fixed.sahneler[1]!;
    assert.equal(sc.satirlar[5]!.metin, "Right behind you, sir! Well... a bit behind.");
    assert.equal(sc.satirlar[5]!.balon, "A bit behind!");
    assert.equal(sc.satirlar[2]!.metin, episode.sahneler[1]!.satirlar[2]!.metin);
    assert.deepEqual(sc.satirlar[0]!.oyun, [{ karakter: "legionary", jest: "omuz_silk" }]);
    assert.equal(sc.ortam?.manzara, "nehir_kiyisi");
    assert.equal(sc.ortam?.uslup, "roma");
    assert.match(sc.arka_plan_sorgusu.tasarim ?? "", /muddy Roman riverbank/);
    assert.equal(sc.arka_plan_sorgusu.en, "Rubicon river at night");
    assert.deepEqual(fixed.sahneler[0], episode.sahneler[0]);
    // The original episode is untouched.
    assert.equal(episode.sahneler[1]!.satirlar[5]!.metin, "Right behind you, sir! Mostly.");
  });

  await scenario("E a council under the bar: critics, replies, AYAS's decision and the rewrite; the transcript says it all", async () => {
    const model = new CouncilModel({
      critic: (p) => (p.includes("the humour writer") ? critic(5, [{ sahne: STAGE, satir: 5, sorun: "son espri zayıf", oneri: "daha keskin bir kapanış", eylem: "satir" }]) : p.includes("the picture critic") ? critic(6, [{ sahne: STAGE, satir: 0, sorun: "anlatıcı konuşurken lejyoner kıpırdamıyor", oneri: "omuz silksin", eylem: "oyun" }]) : critic(7, [{ sahne: MAP, sorun: "harita boş", oneri: "ordu ekle", eylem: "yok" }])),
      reply: JSON.stringify({ destek: ["n2"], itiraz: [{ id: "n3", neden: "anlatıcı satırı sade kalmalı" }] }),
      director: JSON.stringify({ ozet: "Kurul 6.3; espri ve sahne hareketi düzelecek.", duzeltmeler: [{ tur: "satir", sahne: STAGE, satir: 5, talimat: "Sharper last joke", neden: "mizah" }, { tur: "oyun", sahne: STAGE, satir: 0, oyun: [{ karakter: "legionary", jest: "omuz_silk" }], neden: "kalite" }] }),
      rewrite: JSON.stringify({ satirlar: [{ sahne: STAGE, satir: 5, metin: "Right behind you, sir! Well... a bit behind.", balon: "A bit behind!" }] }),
    });
    const s = await holdCouncil({ budget: budgetOf(model), critic: { provider: "ollama" }, director: { provider: "ollama" }, episode, dil: "en", round: 0, canRevise: true, context: { baslik: episode.baslik, sureSn: 40, shorts: true, tempo: ["our cut: 120 words/min"], qc: ["Kanca geç"] }, lessons: async (b) => (b === "mizah" ? ["Answer a grave line with a deadpan aside"] : []), earlier: [], check: (e) => void assertEpisode(e) });
    assert.equal(s.raporlar.length, 4);
    assert.equal(s.puan, 6.3);
    assert.ok(s.puan < DIRECTOR_BAR);
    assert.equal(s.yanitlar.length, 4);
    assert.deepEqual(model.calls.filter((c) => c === "director").length, 1);
    assert.deepEqual(model.calls.filter((c) => c === "rewrite").length, 1);
    assert.equal(s.karar!.duzeltmeler.length, 2);
    assert.equal(s.karar!.yeniden[0]!.metin, "Right behind you, sir! Well... a bit behind.");
    assert.equal(s.maliyetUsd, 0);
    const lines = sessionDebate(s);
    assert.ok(lines.some((l) => l.rol === "Mizah beyni (5/10)" && /son espri zayıf/.test(l.metin)));
    assert.ok(lines.some((l) => /itiraz n3: anlatıcı satırı sade kalmalı/.test(l.metin)));
    assert.ok(lines.some((l) => l.rol === "AYAS (yönetmen)" && /kurul 6.3\/10/.test(l.metin) && /satır yeniden yazılacak/.test(l.metin)));
    assert.ok(lines.some((l) => /"Right behind you, sir! Mostly\." → "Right behind you, sir! Well/.test(l.metin)));
  });

  await scenario("F AYAS is not asked when the cut passes, no round is left, or nothing is fixable; bad fixes are dropped", async () => {
    const good = new CouncilModel({ critic: () => critic(9, [{ sahne: STAGE, satir: 1, sorun: "iyi", oneri: "dokunma", eylem: "satir" }]) });
    const passed = await holdCouncil({ budget: budgetOf(good), critic: { provider: "ollama" }, director: { provider: "ollama" }, episode, dil: "en", round: 0, canRevise: true, context: { baslik: "", sureSn: 40, shorts: true }, lessons: async () => [], earlier: [], check: () => {} });
    assert.equal(passed.karar, undefined);
    assert.match(passed.kararYok!, /eşiği geçti/);
    assert.equal(good.calls.includes("director"), false);
    const weak = () => new CouncilModel({ critic: () => critic(5, [{ sahne: STAGE, satir: 1, sorun: "zayıf", oneri: "yeniden yaz", eylem: "satir" }]), director: JSON.stringify({ ozet: "x", duzeltmeler: [{ tur: "oyun", sahne: STAGE, satir: 0, oyun: [{ karakter: "legionary", jest: "kutla" }] }] }) });
    const last = await holdCouncil({ budget: budgetOf(weak()), critic: { provider: "ollama" }, director: { provider: "ollama" }, episode, dil: "en", round: 2, canRevise: false, context: { baslik: "", sureSn: 40, shorts: true }, lessons: async () => [], earlier: [], check: () => {} });
    assert.match(last.kararYok!, /hakkı kalmadı/);
    const nothing = new CouncilModel({ critic: () => critic(4, [{ sahne: MAP, sorun: "harita", oneri: "x", eylem: "yok" }]) });
    assert.match((await holdCouncil({ budget: budgetOf(nothing), critic: { provider: "ollama" }, director: { provider: "ollama" }, episode, dil: "en", round: 0, canRevise: true, context: { baslik: "", sureSn: 40, shorts: true }, lessons: async () => [], earlier: [], check: () => {} })).kararYok!, /giderilecek not yok/);
    const refused = await holdCouncil({ budget: budgetOf(weak()), critic: { provider: "ollama" }, director: { provider: "ollama" }, episode, dil: "en", round: 0, canRevise: true, context: { baslik: "", sureSn: 40, shorts: true }, lessons: async () => [], earlier: [], check: () => { throw new Error("V3_EPISODE_INVALID: test"); } });
    assert.deepEqual(refused.karar!.duzeltmeler, []);
    assert.match(refused.kararYok!, /doğrulamasından geçmedi/);
    const silent = new CouncilModel({ critic: () => "no json" });
    assert.match((await holdCouncil({ budget: budgetOf(silent), critic: { provider: "ollama" }, director: { provider: "ollama" }, episode, dil: "en", round: 0, canRevise: true, context: { baslik: "", sureSn: 40, shorts: true }, lessons: async () => [], earlier: [], check: () => {} })).kararYok!, /yanıt vermedi/);
  });

  await scenario("G the retouch round carries AYAS's fixes; the best round wins on the council's mean when the bars tie", async () => {
    const decision = { ozet: "x", duzeltmeler: [{ tur: "oyun", sahne: STAGE, satir: 0, oyun: [{ karakter: "legionary", jest: "kutla" }], neden: "" }, { tur: "set", sahne: STAGE, manzara: "nehir_kiyisi", neden: "kıyı" }] as DirectorEdit[], yeniden: [] };
    const alone = withDirector(undefined, 0, decision)!;
    assert.deepEqual([alone.tur, alone.adim, alone.setler.map((s) => s.neden)], [1, "gorsel", ["AYAS: kıyı"]]);
    const merged = withDirector({ tur: 1, adim: "gardirop", kisiler: [{ castId: "caesar", kisi: "Caesar", puan: 6, farklar: [] }], setler: [{ sahne: STAGE, neden: "hakem 4/10" }] }, 0, decision)!;
    assert.deepEqual([merged.adim, merged.setler.length, merged.kisiler.length], ["gardirop", 1, 1]);
    assert.equal(withDirector(undefined, 0, { ozet: "", duzeltmeler: [], yeniden: [] }), undefined);
    assert.equal(withDirector(undefined, 0, { ozet: "", duzeltmeler: [decision.duzeltmeler[0]!], yeniden: [] })!.adim, "render");
    assert.ok(retouchDebate(alone).some((d) => d.rol === "AYAS (yönetmen)" && /sahnede oynanacak/.test(d.metin)));
    const r = (tur: number, kurul?: number, likeness = 8): RoundScore => ({ tur, kisiler: [{ castId: "caesar", puan: likeness }], setler: [], ...(kurul !== undefined ? { kurul } : {}) });
    assert.equal(bestRound([r(0, 6.3), r(1, 7.5), r(2, 7.0)])!.tur, 1);
    assert.equal(bestRound([r(0, 6.3), r(1, 9, 6)])!.tur, 0);
    assert.equal(bestRound([r(0, 7), r(1, 7)])!.tur, 0);
    assert.equal(bestRound([r(0), r(1)])!.tur, 0);
    assert.match(roundLine(r(1, 7.5)), /kurul 7.5\/10/);
    assert.doesNotMatch(roundLine(r(1)), /kurul/);
  });

  await scenario("H a kept round keeps its script; restoring an older round never deletes the current script", async () => {
    const work = mkdtempSync(path.join(os.tmpdir(), "v3-director-"));
    writeFileSync(path.join(work, "final.mp4"), "round0");
    writeFileSync(path.join(work, "episode.json"), "script0");
    writeFileSync(path.join(work, "yonetmen-kurulu.json"), "{}");
    await keepRound(work, "final.mp4", { tur: 0, kisiler: [], setler: [], kurul: 6 });
    assert.equal(readFileSync(path.join(work, "tur0", "episode.json"), "utf8"), "script0");
    writeFileSync(path.join(work, "final.mp4"), "round1");
    writeFileSync(path.join(work, "episode.json"), "script1");
    await restoreRound(work, "final.mp4", 0);
    assert.equal(readFileSync(path.join(work, "final.mp4"), "utf8"), "round0");
    assert.equal(readFileSync(path.join(work, "episode.json"), "utf8"), "script0");
    // A round kept before scripts were kept (no episode.json in it): the current script stays.
    mkdirSync(path.join(work, "tur5"));
    writeFileSync(path.join(work, "final-tur5.mp4"), "round5");
    writeFileSync(path.join(work, "episode.json"), "script-now");
    await restoreRound(work, "final.mp4", 5);
    assert.equal(readFileSync(path.join(work, "episode.json"), "utf8"), "script-now");
    assert.ok(existsSync(path.join(work, "yonetmen-kurulu.json")));
  });

  console.log(`PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

