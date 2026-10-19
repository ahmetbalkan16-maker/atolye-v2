/**
 * V3 smoke: background judge (vision model picks a fitting Commons image) and the background contract. Fake
 * providers only (no network).
 * Run: npx tsx scripts/smoke-v3-backgrounds.ts
 */
import assert from "node:assert/strict";
import type { AIProvider, AIProviderGenerateOptions, AIProviderResult } from "../src/lib/ai/providers/AIProvider";
import { MAX_JUDGED, MIN_FIT_SCORE, parseVerdict, pickBackground, type SceneForJudge } from "../src/lib/v3/backgrounds/BackgroundJudge";
import type { CommonsCandidate } from "../src/lib/v3/backgrounds/CommonsProvider";
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

  console.log(`V3 backgrounds smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
