/**
 * V3 smoke: background judge (vision model picks a fitting Commons image) and the background contract. Fake
 * providers only (no network).
 * Run: npx tsx scripts/smoke-v3-backgrounds.ts
 */
import assert from "node:assert/strict";
import type { AIProvider, AIProviderGenerateOptions, AIProviderResult } from "../src/lib/ai/providers/AIProvider";
import { designFor, periodNegatives } from "../src/lib/v3/backgrounds/BackgroundDesigner";
import type { EpisodeScene } from "../src/lib/v3/episode/EpisodeTypes";
import { fitScore, judgePrompt, MAX_JUDGED, MIN_FIT_SCORE, parseVerdict, passes, pickBackground, type SceneForJudge } from "../src/lib/v3/backgrounds/BackgroundJudge";
import { type CommonsCandidate, yearOf } from "../src/lib/v3/backgrounds/CommonsProvider";
import { aliasQueries, insertCaption, periodEndYear, periodRank } from "../src/lib/v3/backgrounds/HistorySources";
import { wordBudget } from "../src/lib/v3/script/ScriptPrompts";

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

/** Answers by file title found in the prompt; a title mapped to an Error throws. */
class FakeJudge implements AIProvider {
  readonly calls: { prompt: string; options?: AIProviderGenerateOptions }[] = [];
  constructor(private readonly answers: Record<string, string | Error>) {}
  async generate(prompt: string, options?: AIProviderGenerateOptions): Promise<AIProviderResult> {
    this.calls.push({ prompt, ...(options ? { options } : {}) });
    const key = Object.keys(this.answers).find((k) => prompt.includes(`FILE (from Wikimedia Commons, may be wrong): ${k}.jpg`));
    const a = key ? this.answers[key]! : "";
    if (a instanceof Error) throw a;
    return { content: a, finishReason: "stop", refused: false, complete: true, truncated: false };
  }
}

function candidate(name: string): CommonsCandidate {
  return {
    title: `File:${name}.jpg`,
    url: `https://upload.example/${name}.jpg`,
    downloadUrl: `https://upload.example/3840px-${name}.jpg`,
    previewUrl: `https://upload.example/960px-${name}.jpg`,
    description: "",
    width: 3000,
    height: 2000,
    mime: "image/jpeg",
    descriptionUrl: `https://commons.example/${name}`,
    credit: { title: name, author: "x", license: "CC0", attributionRequired: false },
  };
}

const SCENE: SceneForJudge = { konu: "Rumeli Hisarı'nın inşası", donem: "1452", mekan: "Boğaz kıyısı", tr: "Rumeli Hisarı bugün", en: "Rumelihisarı fortress", anlatim: "Hisar bugün hâlâ ayakta." };
const preview = async (c: CommonsCandidate) => Buffer.from(`img:${c.title}`);
const verdict = (puan: number | string, gosterilen = "hisar") => JSON.stringify({ puan, gosterilen, sorun: "-" });

async function main() {
  await scenario("A the best candidate at or above the bar wins; the image goes to the judge as base64", async () => {
    const judge = new FakeJudge({ "kran-santiye": verdict(2, "vinç"), "rumelihisari-bugun": verdict(9), "bellini": verdict(9), "harita": verdict(7) });
    const pick = await pickBackground(["kran-santiye", "rumelihisari-bugun", "bellini", "harita"].map(candidate), SCENE, judge, preview);
    assert.equal(pick.chosen?.title, "File:rumelihisari-bugun.jpg", "eşit puanda arama sırasında önce gelen seçilir");
    assert.equal(pick.verdict?.puan, 9);
    assert.equal(pick.verdicts.length, 4);
    assert.deepEqual(judge.calls[1]!.options?.images, [Buffer.from("img:File:rumelihisari-bugun.jpg").toString("base64")]);
    assert.ok(judge.calls[1]!.options?.jsonSchema, "puan şeması gönderilir");
    assert.ok(judge.calls[0]!.prompt.includes("Rumelihisarı fortress") && judge.calls[0]!.prompt.includes("Hisar bugün hâlâ ayakta."));
  });

  await scenario("B nothing at or above the bar: no image is picked (the caller uses a set)", async () => {
    const judge = new FakeJudge({ a: verdict(MIN_FIT_SCORE - 1), b: verdict(3) });
    const pick = await pickBackground(["a", "b"].map(candidate), SCENE, judge, preview);
    assert.equal(pick.chosen, undefined);
    assert.deepEqual(pick.verdicts.map((v) => v.puan), [MIN_FIT_SCORE - 1, 3]);
  });

  await scenario("C an unreadable answer, a judge error or a failed preview scores 0 and never wins", async () => {
    const judge = new FakeJudge({ okunmaz: "üzgünüm, göremiyorum", hata: new Error("ollama kapalı"), iyi: verdict(8) });
    const lines: string[] = [];
    const pick = await pickBackground(["okunmaz", "hata", "onizlemesiz", "iyi"].map(candidate), SCENE, judge, async (c) => {
      if (c.title.includes("onizlemesiz")) throw new Error("COMMONS_PREVIEW_404");
      return preview(c);
    }, (s) => lines.push(s));
    assert.deepEqual(pick.verdicts.map((v) => v.puan), [0, 0, 0, 8]);
    assert.equal(pick.chosen?.title, "File:iyi.jpg");
    assert.equal(lines.length, 2, "hata ve önizleme hatası loglanır");
    assert.equal(judge.calls.length, 3, "önizlemesi inmeyen aday modele gitmez");
  });

  await scenario("D only the first MAX_JUDGED candidates in search order are judged", async () => {
    const names = Array.from({ length: MAX_JUDGED + 3 }, (_, i) => `aday-${i}`);
    const judge = new FakeJudge({ [`aday-${MAX_JUDGED + 1}`]: verdict(10) });
    const pick = await pickBackground(names.map(candidate), SCENE, judge, preview);
    assert.equal(judge.calls.length, MAX_JUDGED);
    assert.equal(pick.chosen, undefined);
  });

  await scenario("E verdict parsing: fenced JSON and string scores read, out-of-range and missing scores do not", () => {
    assert.equal(parseVerdict('```json\n{"puan": "8", "gosterilen": "kale", "sorun": "yok"}\n```')?.puan, 8);
    assert.equal(parseVerdict('{"puan": 7.6, "gosterilen": "", "sorun": ""}')?.puan, 8);
    assert.equal(parseVerdict('{"puan": 11}'), undefined);
    assert.equal(parseVerdict('{"gosterilen": "kale"}'), undefined);
    assert.equal(parseVerdict("puan: 9"), undefined);
  });

  await scenario("F Turkish word budget is the measured rate of finished video (1.8 words/s)", () => {
    assert.equal(wordBudget({ konu: "x", donem: "1452", hedefSureSn: 90, ton: "mizahi", dil: "tr" }), 162);
  });

  await scenario("G period rule: a photo of the place as it stands today never wins, however well it shows the subject", async () => {
    const judge = new FakeJudge({
      "rumelihisari-2013": JSON.stringify({ puan: 10, donem: 0, modern: true, tur: "fotograf", gosterilen: "hisar, arabalar", sorun: "günümüz" }),
      "gravur-1838": JSON.stringify({ puan: 9, donem: 6, modern: false, tur: "eser", gosterilen: "gravür", sorun: "geç tasvir" }),
      "harita-1430": JSON.stringify({ puan: 9, donem: 10, modern: false, tur: "harita", gosterilen: "Buondelmonti", sorun: "-" }),
      "temiz-ama-modern": JSON.stringify({ puan: 9, donem: 8, modern: true, tur: "fotograf", gosterilen: "x", sorun: "vapur" }),
    });
    const pick = await pickBackground(["rumelihisari-2013", "gravur-1838", "temiz-ama-modern", "harita-1430"].map(candidate), SCENE, judge, preview);
    assert.equal(pick.chosen?.title, "File:harita-1430.jpg");
    assert.equal(passes(pick.verdicts[0]!), false, "konu 10 ama dönem 0");
    assert.equal(passes(pick.verdicts[2]!), false, "modern öğe varsa geçmez");
    assert.ok(judge.calls[0]!.prompt.includes("MADE IN (metadata, may be missing or wrong): unknown"));
    const none = await pickBackground(["rumelihisari-2013"].map(candidate), SCENE, new FakeJudge({ "rumelihisari-2013": JSON.stringify({ puan: 10, donem: 1, modern: true }) }), preview);
    assert.equal(none.chosen, undefined, "uygun dönem görseli yoksa hiçbir şey seçilmez");
  });

  await scenario("H verdict fields: donem, modern and tur are read; old answers without them still parse", () => {
    const v = parseVerdict('{"puan": 8, "donem": "9", "modern": false, "tur": "eser", "gosterilen": "minyatür", "sorun": "-"}')!;
    assert.deepEqual([v.puan, v.donem, v.modern, v.tur], [8, 9, false, "eser"]);
    assert.equal(parseVerdict('{"puan": 8, "donem": 14}')?.donem, undefined, "aralık dışı dönem puanı yok sayılır");
    const old = parseVerdict('{"puan": 8, "gosterilen": "", "sorun": ""}')!;
    assert.equal(passes({ title: "x", ...old }), true);
    assert.equal(fitScore({ title: "x", puan: 9, donem: 4, gosterilen: "", sorun: "" }), 4);
    assert.ok(judgePrompt(SCENE, candidate("a"), "set").includes("drawn background"));
    assert.match(judgePrompt(SCENE, candidate("a"), "set"), /flat cartoon with clean dark outlines/);
  });

  await scenario("H2 set style: flat bright cartoon, never a painting; later-era religious buildings banned by period", () => {
    const scene = { arka_plan_sorgusu: { tr: "Roma sokağı", en: "Roman street" }, mekan: "a street in Rome" } as unknown as EpisodeScene;
    const rome = designFor(scene, { donem: "49 BC" });
    assert.match(rome.prompt, /^flat 2D vector cartoon background, bold clean dark outlines, flat bright saturated colors/);
    assert.ok(!/smooth gradients/.test(rome.prompt));
    assert.match(rome.negative, /painterly/);
    assert.match(rome.negative, /bell tower/);
    assert.match(rome.negative, /minaret/);
    const istanbul = designFor(scene, { donem: "1453" });
    assert.ok(!/bell tower|minaret/.test(istanbul.negative), "1453'te kiliseler ve minareler vardı");
    assert.deepEqual(periodNegatives("Sezar dönemi"), []);
  });

  await scenario("I years and ranking: period end from the episode, image year from metadata, period works judged first", () => {
    assert.equal(periodEndYear("1452"), 1452);
    assert.equal(periodEndYear("1451–1453"), 1453);
    assert.equal(periodEndYear("Kurtuluş Savaşı (1919-1922)"), 1922);
    assert.equal(periodEndYear("MÖ 44"), -44);
    assert.equal(periodEndYear("Sezar dönemi"), undefined);
    assert.equal(yearOf("circa 1838"), 1838);
    assert.equal(yearOf("2013-09-21 14:02"), 2013);
    assert.equal(yearOf(""), undefined);
    assert.deepEqual([1430, undefined, 1838, 2006].map((y) => periodRank(y, 1452)), [0, 1, 1, 2]);
    assert.deepEqual([1920, 1960].map((y) => periodRank(y, 1922)), [0, 2]);
  });

  await scenario("J other names: Wikipedia redirects give the old spellings worth a search, not the near-duplicates", () => {
    const q = aliasQueries("Rumelihisarı", ["Rumeli Hisari", "Rumeli Hisarı", "Rumelihisari", "Rumelia Fortress", "Rumeli Hizari", "Rumeli Hisar", "Roumeli Hissar Castle", "Rumeli Fortress"]);
    assert.equal(q[0], "Roumeli Hissar");
    assert.ok(!q.includes("Rumeli Hisari") && !q.includes("Rumelihisari"), JSON.stringify(q));
    assert.ok(q.length <= 2);
    const met = { ...candidate("x"), source: "met" as const, year: 1480, credit: { title: "Sultan Mehmed II", author: "Gentile Bellini — The Metropolitan Museum of Art", license: "CC0", attributionRequired: false } };
    assert.equal(insertCaption(met, "en"), "Sultan Mehmed II, Gentile Bellini, 1480 · Source: The Met");
    assert.equal(insertCaption({ ...candidate("Rumelihisarı (8393629929)"), credit: { title: "Rumelihisarı (8393629929)", author: "Wikimedia Commons", license: "CC BY 2.0", attributionRequired: true } }, "tr"), "Rumelihisarı · Kaynak: Wikimedia Commons");
  });

  console.log(`V3 backgrounds smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
