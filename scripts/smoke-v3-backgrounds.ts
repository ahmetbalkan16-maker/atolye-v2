/**
 * V3 smoke: background judge (vision model picks a fitting Commons image) and the background contract. Fake
 * providers only (no network).
 * Run: npx tsx scripts/smoke-v3-backgrounds.ts
 */
import assert from "node:assert/strict";
import type { AIProvider, AIProviderGenerateOptions, AIProviderResult } from "../src/lib/ai/providers/AIProvider";
import { ancientPlace, designFor, LANDSCAPE_NEGATIVE, landscapeOnly, periodLook, periodNegatives, periodRewritePrompt, readPeriodRewrite } from "../src/lib/v3/backgrounds/BackgroundDesigner";
import type { EpisodeScene } from "../src/lib/v3/episode/EpisodeTypes";
import { fitScore, judgePrompt, MAX_JUDGED, MIN_FIT_SCORE, laterEraQuestion, parseLaterEra, parseVerdict, passes, periodWordsCheck, pickBackground, type SceneForJudge, unreadableVerdicts, VERDICT_RETRY_TOKENS, VERDICT_TOKENS } from "../src/lib/v3/backgrounds/BackgroundJudge";
import { gradeAnswer } from "../src/lib/v3/council/BrainExam";
import { CLIP_POOL, clipQuery, orderByClip } from "../src/lib/v3/backgrounds/ClipRanker";
import { cleanObjectName, type CommonsCandidate, yearOf } from "../src/lib/v3/backgrounds/CommonsProvider";
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
    const before = unreadableVerdicts();
    const pick = await pickBackground(["okunmaz", "hata", "onizlemesiz", "iyi"].map(candidate), SCENE, judge, async (c) => {
      if (c.title.includes("onizlemesiz")) throw new Error("COMMONS_PREVIEW_404");
      return preview(c);
    }, (s) => lines.push(s));
    assert.deepEqual(pick.verdicts.map((v) => v.puan), [0, 0, 0, 8]);
    assert.equal(pick.chosen?.title, "File:iyi.jpg");
    assert.equal(lines.length, 3, "okunamayan yanıt, hata ve önizleme hatası loglanır");
    assert.equal(judge.calls.length, 4, "okunamayan yanıt bir kez daha sorulur; önizlemesi inmeyen aday modele gitmez");
    assert.deepEqual([judge.calls[0]!.options?.maxTokens, judge.calls[1]!.options?.maxTokens], [VERDICT_TOKENS, VERDICT_RETRY_TOKENS]);
    assert.equal(pick.verdicts[0]!.okunamadi, true, "the judge's fault is marked, not passed off as the image's");
    assert.equal(pick.verdicts[1]!.okunamadi, undefined, "a thrown error is a different fault");
    assert.equal(unreadableVerdicts() - before, 1);
  });

  await scenario("C2 a model that thinks first: the second, larger budget gets the answer", async () => {
    const thinker: AIProvider = { generate: async (_p, o) => ({ content: (o?.maxTokens ?? 0) > VERDICT_TOKENS ? verdict(9) : "", finishReason: "length", refused: false, complete: false, truncated: true }) };
    const pick = await pickBackground(["bellini"].map(candidate), SCENE, thinker, preview);
    assert.equal(pick.verdicts[0]!.puan, 9);
    assert.equal(pick.verdicts[0]!.okunamadi, undefined);
    const blank = { ...pick.verdicts[0]!, puan: 0, okunamadi: true as const };
    assert.deepEqual(gradeAnswer({ id: "x", mod: "set", gorsel: "x.png", kaynak: "", sahne: SCENE, beklenen: { puanMax: 5 }, neden: "" }, blank), { dogru: false, neden: "okunamayan yanıt" }, "a blank answer never passes a must-fail question");
  });

  await scenario("D only the first MAX_JUDGED candidates in search order are judged", async () => {
    const names = Array.from({ length: MAX_JUDGED + 3 }, (_, i) => `aday-${i}`);
    const judge = new FakeJudge({ [`aday-${MAX_JUDGED + 1}`]: verdict(10) });
    const pick = await pickBackground(names.map(candidate), SCENE, judge, preview);
    assert.equal(judge.calls.length, 2 * MAX_JUDGED, "only the first MAX_JUDGED are judged (each blank answer asked twice)");
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
    // SDXL drew the 49 BC Corfinium as a medieval castle five times: ancient sets get the look of their time and no castles.
    assert.match(rome.negative, /castle keep, turrets, conical tower roofs/);
    assert.ok(rome.prompt2.includes("terracotta-tiled roofs") && rome.prompt2.includes("as they were in 49 BC"));
    assert.ok(!istanbul.prompt2.includes("Ancient-world") && !/castle/.test(istanbul.negative));
    assert.equal(periodLook("MS 500"), undefined);
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
    const boulanger = { ...candidate("x"), year: 1854, credit: { title: "Gustave Boulanger, Jules-César arrivé au Rubicon, 1854, Musée Picardie", author: "Gustave Boulanger", license: "Public domain", attributionRequired: false } };
    assert.equal(insertCaption(boulanger, "en"), "Gustave Boulanger, Jules-César arrivé au Rubicon, 1854, Musée Picardie · Source: Wikimedia Commons", "artist and year are not repeated");
  });

  await scenario("K artwork names: a flattened multilingual name gives way to the file name; QuickStatements keep the English title", () => {
    const garbled = 'Italian: Cicerone denuncia CatilinaCicero Denounces Catilinetitle denuncia Catilina" denuncia Catilina" Denounces Catiline"';
    assert.equal(cleanObjectName(garbled, "File:Cicero_Denounces_Catiline_in_the_Roman_Senate_by_Cesare_Maccari.png"), "Cicero Denounces Catiline in the Roman Senate by Cesare Maccari");
    assert.equal(cleanObjectName('title QS:P1476,en:"The Sultan Mehmet II" label QS:Len,"x"', "File:a.jpg"), "The Sultan Mehmet II");
    assert.equal(cleanObjectName("Jules-César arrivé au Rubicon", "File:Boulanger.jpg"), "Jules-César arrivé au Rubicon", "a clean name stays");
    assert.equal(cleanObjectName(garbled), garbled, "without a file name nothing better is known");
    // The real Commons field after its tags are stripped: hidden labels per language, English among them.
    const labels = 'Italian: Cicerone denuncia Catilina Cicero Denounces Catiline title QS:P1476,it:"Cicerone denuncia Catilina" label QS:Lit,"Cicerone denuncia Catilina" label QS:Len,"Cicero Denounces Catiline"';
    assert.equal(cleanObjectName(labels, "File:x.png"), "Cicero Denounces Catiline", "the English label wins");
    const noEnglish = 'Italian: Cicerone denuncia Catilina title QS:P1476,it:"Cicerone denuncia Catilina" label QS:Lit,"Cicerone denuncia Catilina"';
    assert.equal(cleanObjectName(noEnglish, "File:Cicero_Denounces_Catiline_by_Cesare_Maccari.png"), "Cicero Denounces Catiline by Cesare Maccari", "no English: the file name");
  });

  await scenario("L CLIP pre-ranking only reorders: best score first, unscored keep their place after, beyond the pool unchanged", () => {
    const c = ["a", "b", "c", "d", "e", "f"];
    assert.deepEqual(orderByClip(c, [0.1, 0.3, null, 0.3, 0.2]), ["b", "d", "e", "a", "c", "f"], "ties keep search order; f was beyond the pool");
    assert.deepEqual(orderByClip(c, []), c, "no scores: search order");
    assert.deepEqual(orderByClip(c, [null, null]), c);
    assert.equal(orderByClip(c, [0.5, 0.1, 0.2, 0.3, 0.4, 0.6]).length, c.length, "nothing is dropped");
    assert.equal(clipQuery({ en: "Roman Senate painting", mekan: "Roman Senate, Rome" }), "Roman Senate painting. Roman Senate, Rome.");
    assert.ok(CLIP_POOL > MAX_JUDGED, "the judge sees the best of a larger pool");
  });

  await scenario("M a set the judge itself calls medieval or shows with a church cross fails the period for antiquity; a denial does not", () => {
    const v = { title: "set", puan: 8, donem: 10, gosterilen: "Taş kuleli ve surlarla çevrili tepelik bir Orta Çağ/Antik yerleşimi", sorun: "" };
    const checked = periodWordsCheck(v, "49 BC");
    assert.equal(checked.donem, 3);
    assert.ok(!passes(checked) && checked.sorun.includes("Orta Çağ") && checked.sonrakiCag === "Orta Çağ");
    assert.equal(periodWordsCheck({ ...v, gosterilen: "Kulenin tepesinde haç var" }, "MÖ 44").donem, 3);
    assert.equal(periodWordsCheck({ ...v, gosterilen: "Roma kasabası", sorun: "kilise yok, modern öğe yok" }, "49 BC").donem, 10, "a denial is no fault");
    assert.equal(periodWordsCheck({ ...v, gosterilen: "A walled town without any church towers" }, "49 BC").donem, 10);
    assert.equal(periodWordsCheck({ ...v, gosterilen: "Caesar's army crossing the river" }, "49 BC").donem, 10, "crossing is not a cross");
    assert.equal(periodWordsCheck(v, "1453").donem, 10, "the Middle Ages are fine in 1453");
    assert.equal(periodWordsCheck({ ...v, gosterilen: "minareli bir şehir" }, "MS 500").donem, 3);
    assert.equal(periodWordsCheck({ ...v, gosterilen: "minareli bir şehir" }, "1453").donem, 10);
  });

  await scenario("N an antiquity set the judge passes is asked once more about crosses and churches; a yes fails the period", async () => {
    assert.ok(laterEraQuestion("49 BC")!.includes("bell tower") && laterEraQuestion("MS 500")!.includes("minaret") && !laterEraQuestion("MS 500")!.includes("church"));
    assert.equal(laterEraQuestion("1453"), undefined);
    assert.equal(parseLaterEra('{"var": true, "ne": "cross on a small tower"}'), "cross on a small tower");
    assert.equal(parseLaterEra('{"var": false, "ne": "none"}'), undefined);
    assert.equal(parseLaterEra("bozuk"), undefined, "an unreadable answer is no penalty");
    const asked: string[] = [];
    const judge: AIProvider = {
      generate: async (prompt, o) => {
        const img = Buffer.from(o?.images?.[0] ?? "", "base64").toString();
        if (prompt.includes("Is there anywhere in it")) {
          asked.push(img);
          return { content: img.includes("hacli") ? '{"var": true, "ne": "cross on a tower"}' : '{"var": false, "ne": "none"}', finishReason: "stop", refused: false, complete: true, truncated: false };
        }
        return { content: JSON.stringify({ puan: img.includes("zayif") ? 4 : 9, donem: 10, modern: false, tur: "cizim", gosterilen: "Roma kasabası", sorun: "" }), finishReason: "stop", refused: false, complete: true, truncated: false };
      },
    };
    const roman: SceneForJudge = { ...SCENE, donem: "49 BC", konu: "Rubicon", mekan: "Corfinium" };
    const pick = await pickBackground(["hacli", "zayif", "temiz"].map(candidate), roman, judge, preview, () => {}, { mode: "set" });
    assert.equal(pick.chosen?.title, "File:temiz.jpg");
    assert.equal(pick.verdicts[0]!.donem, 3);
    assert.ok(pick.verdicts[0]!.sorun.includes("cross on a tower") && pick.verdicts[0]!.sonrakiCag === "cross on a tower");
    assert.equal(pick.verdicts[2]!.sonrakiCag, undefined);
    assert.deepEqual(asked.map((x) => x.replace("img:File:", "")), ["hacli.jpg", "zayif.jpg", "temiz.jpg"], "every readable set is asked: a failing one may still become the best attempt");
  });

  await scenario("O a place drawn in a later era is rewritten for its period without castle words; the last resort is its countryside", () => {
    const p = periodRewritePrompt("A walled hilltop town with stone towers", "Corfinium, Italy", "49 BC", ["cross on a tower", "medieval castle keep"]);
    assert.ok(p.includes("as it looked in 49 BC") && p.includes("cross on a tower; medieval castle keep") && p.includes('{"tasarim"'));
    const good = "A small ancient Italic hill town: whitewashed stone houses with terracotta tile roofs, a low wall of large fitted stones with a simple arched gate.";
    assert.equal(readPeriodRewrite(JSON.stringify({ tasarim: good })), good);
    assert.equal(readPeriodRewrite(JSON.stringify({ tasarim: "An ancient town with stone towers and walls of fitted stones" })), undefined, "a castle word again is refused");
    assert.equal(readPeriodRewrite(JSON.stringify({ tasarim: "town" })), undefined);
    assert.equal(readPeriodRewrite("bozuk"), undefined);
    const land = landscapeOnly("Corfinium, Italy", "49 BC");
    assert.ok(land.includes("countryside near Corfinium, Italy in 49 BC") && !/building/.test(land), "SDXL reads 'no buildings' as buildings");
    assert.match(LANDSCAPE_NEGATIVE.join(","), /buildings, houses, town/);
    const ancient = ancientPlace("Corfinium, Italy", "49 BC")!;
    assert.ok(ancient.includes("terracotta tile roofs") && readPeriodRewrite(JSON.stringify({ tasarim: ancient })) === ancient, "the fallback wording passes its own check");
    assert.equal(ancientPlace("Istanbul", "1453"), undefined);
  });

  await scenario("P subject photo (no set could be drawn): exactly this place's remains or a period object, never an unrelated photo", async () => {
    const roman: SceneForJudge = { ...SCENE, konu: "Rubicon", donem: "49 BC", mekan: "Corfinium, Italy", tr: "Corfinium", en: "Corfinium ruins" };
    const p = judgePrompt(roman, candidate("corfinium-walls"), "konu");
    assert.ok(p.includes("No picture made in 49 BC exists") && p.includes("another town's ruins") && p.includes("never shown") && p.includes("remains or objects of 49 BC"));
    assert.ok(!judgePrompt(roman, candidate("x"), "arsiv").includes("No picture made in"), "the period-image rubric is unchanged");
    const judge = new FakeJudge({ "corfinium-walls": JSON.stringify({ puan: 9, donem: 8, modern: false, tur: "fotograf", gosterilen: "Corfinium surları", sorun: "-" }), "rimini-beach": JSON.stringify({ puan: 2, donem: 1, modern: true, tur: "fotograf", gosterilen: "plaj", sorun: "ilgisiz" }) });
    const pick = await pickBackground(["rimini-beach", "corfinium-walls"].map(candidate), roman, judge, preview, () => {}, { mode: "konu" });
    assert.equal(pick.chosen?.title, "File:corfinium-walls.jpg");
    const none = await pickBackground(["rimini-beach"].map(candidate), roman, judge, preview, () => {}, { mode: "konu" });
    assert.equal(none.chosen, undefined, "an unrelated photo is never chosen");
    // Corfinium's Roman ruins today: subject 10, period 9, "modern" for a house far off — a subject photo still passes.
    const ruins = { title: "Morroni", puan: 10, donem: 9, modern: true, gosterilen: "kalıntılar", sorun: "" };
    assert.ok(passes(ruins, true) && !passes(ruins));
    const judge2 = new FakeJudge({ morroni: JSON.stringify({ puan: 10, donem: 9, modern: true, tur: "fotograf", gosterilen: "Corfinium kalıntıları", sorun: "-" }) });
    assert.equal((await pickBackground(["morroni"].map(candidate), roman, judge2, preview, () => {}, { mode: "konu" })).chosen?.title, "File:morroni.jpg");
    assert.equal((await pickBackground(["morroni"].map(candidate), roman, judge2, preview, () => {}, { mode: "arsiv" })).chosen, undefined, "a period image must have nothing modern");
  });

  console.log(`V3 backgrounds smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
