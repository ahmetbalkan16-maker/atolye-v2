/**
 * V3 smoke: the production council (findings, debates, report to AYAS's inbox) and the repair brain (known remedies,
 * the allowed-action whitelist, safe defaults). Fake providers only (no network, no GPU).
 * Run: npx tsx scripts/smoke-v3-council.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openai } from "../src/lib/ai/client";
import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers/AIProvider";
import { BRAIN_NAMES, chiefItems, CouncilLog, councilMarkdown, isMeasureBrain, MEASURE_BRAINS, readInbox, writeCouncilReport } from "../src/lib/v3/council/Council";
import { designedWindows, EDGE_STRIPS_FILTER, edgeStripArgs, frameChecks, frameExamples, frameKindAt, judgeFrame, layoutReview, layoutSkip, narratedSpans, pixelSkip, qualityPrompt, teachFrame } from "../src/lib/v3/council/QualityBrain";
import { mapFramingFaults } from "../src/lib/v3/council/MapFramingCheck";
import { cutSides, layoutFaults, MIN_PROBES, overlapShare } from "../src/lib/v3/council/LayoutCheck";
import { examScore, eyeQuestion, faultsAt, type FrameQuestion, MIN_EYE_QUESTIONS, questionProblems } from "../src/lib/v3/council/QualityExam";
import { BAND_MIN_FRAMES, frameStats, PIXEL_H, PIXEL_W, pixelFaults } from "../src/lib/v3/council/PixelCheck";
import type { V3LayoutBox } from "../src/lib/v3/render/RenderPlanTypes";
import { decideRepair, describeRepair, knownRemedy, parseRepair, type RepairContext } from "../src/lib/v3/council/RepairBrain";
import { type ExamManifest, type ExamQuestion, gradeAnswer } from "../src/lib/v3/council/BrainExam";
import { cosine, errorSignature, exampleDir, learnedRemedy, MAX_RULES, ollamaEmbedder, type OwnerRule, overlap, recall, remedyTopic, remember, seedRules, enableMeaningSearch } from "../src/lib/v3/council/ExperienceMemory";
import { designFor } from "../src/lib/v3/backgrounds/BackgroundDesigner";
import { judgePrompt, parseVerdict } from "../src/lib/v3/backgrounds/BackgroundJudge";
import { partPrompt } from "../src/lib/v3/costumes/PartDesigner";
import type { EpisodeScene } from "../src/lib/v3/episode/EpisodeTypes";
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

class FakeModel implements AIProvider {
  calls = 0;
  constructor(private readonly answer: string | Error) {}
  async generate(): Promise<AIProviderResult> {
    this.calls++;
    if (this.answer instanceof Error) throw this.answer;
    return { content: this.answer, finishReason: "stop", refused: false, complete: true, truncated: false };
  }
}

const ctx = (error: string, extra: Partial<RepairContext> = {}): RepairContext => ({ step: "gorsel", error, attempt: 1, optional: false, env: {}, ...extra });

async function main() {
  await scenario("A known failures get their remedy without a model", () => {
    assert.equal(knownRemedy(ctx("COMMONS_DOWNLOAD_429"))?.tur, "bekle_tekrar");
    assert.equal(knownRemedy(ctx("RuntimeError: CUDA out of memory. Tried to allocate"))?.tur, "gpu_bosalt");
    assert.equal(knownRemedy(ctx("V3_GPU_TOO_HOT: GPU 80 °C"))?.tur, "bekle_tekrar");
    const cut = knownRemedy(ctx("V3_SCRIPT_INVALID: 3 onarımdan sonra: V3_SCRIPT_JSON_CUT: JSON yarıda", { step: "senaryo", env: { ATOLYE_V3_WRITER_MAX_TOKENS: "9640" } }));
    assert.deepEqual(cut && cut.tur === "ayar" ? [cut.anahtar, cut.deger] : [], ["ATOLYE_V3_WRITER_MAX_TOKENS", "14460"]);
    assert.equal(knownRemedy(ctx("V3_SCRIPT_JSON_CUT", { env: { ATOLYE_V3_WRITER_MAX_TOKENS: "16000" } }))?.tur, "dur");
    const render = knownRemedy(ctx("Error: Target closed", { step: "render" }));
    assert.deepEqual(render && render.tur === "ayar" ? [render.anahtar, render.deger] : [], ["ATOLYE_V3_RENDER_CONCURRENCY", "2"]);
    assert.equal(knownRemedy(ctx("Error: Target closed", { step: "render", env: { ATOLYE_V3_RENDER_CONCURRENCY: "1" } }))?.tur, "dur");
    assert.equal(knownRemedy(ctx("ENOSPC: no space left on device"))?.tur, "dur");
    assert.equal(knownRemedy(ctx("V3_BUDGET_EXCEEDED: parca-1", { step: "gardirop", optional: true }))?.tur, "atla");
    assert.equal(knownRemedy(ctx('V3_RESEARCH_NOTHING: "Sezar’ın rubicon’u geçmesi" için okunabilir Wikipedia makalesi bulunamadı', { step: "senaryo" }))?.tur, "dur", "aynı arama yine boş döner");
    assert.equal(knownRemedy(ctx("V3_RESEARCH_THIN: yalnız 3 doğrulanmış olgu", { step: "senaryo" }))?.tur, "bekle_tekrar");
    assert.equal(knownRemedy(ctx("V3_RESEARCH_THIN: yalnız 3 doğrulanmış olgu", { step: "senaryo", attempt: 2 }))?.tur, "dur");
    // The history gate (owner, 9 Nov 2026): one fresh script, then the video waits for a person.
    assert.equal(knownRemedy(ctx("V3_SCRIPT_HISTORY: tarih hatası düzeltilemedi — s4 #1", { step: "senaryo" }))?.tur, "bekle_tekrar");
    assert.equal(knownRemedy(ctx("V3_SCRIPT_HISTORY: tarih hatası düzeltilemedi — s4 #1", { step: "senaryo", attempt: 2 }))?.tur, "dur");
    assert.equal(knownRemedy(ctx("TypeError: cannot read properties of undefined")), undefined);
  });

  await scenario("A2 an empty OpenAI account (also a 429) is not waited out: a required step stops, an optional one is skipped", async () => {
    const realFetch = globalThis.fetch;
    const realKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test";
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "You have no credits remaining.", type: "insufficient_quota", code: "credit_balance_exhausted" } }), { status: 429 })) as typeof fetch;
    let message = "";
    try {
      await openai.chat.completions.create({ model: "gpt-4.1-mini", messages: [{ role: "user", content: "x" }] }).catch((e: Error) => (message = e.message));
    } finally {
      globalThis.fetch = realFetch;
      if (realKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = realKey;
    }
    assert.equal(message, "OpenAI request failed: 429 insufficient_quota credit_balance_exhausted");
    assert.equal(knownRemedy(ctx(message, { step: "senaryo" }))?.tur, "dur");
    assert.match(describeRepair(knownRemedy(ctx(message, { step: "senaryo" }))!), /OpenAI kredisi bitti/);
    assert.equal(knownRemedy(ctx(`ADIM kapak: ${message}`, { step: "kapak", optional: true }))?.tur, "atla");
    // A real rate limit (no account code in the message) is still waited out.
    assert.equal(knownRemedy(ctx("OpenAI request failed: 429 requests rate_limit_exceeded"))?.tur, "bekle_tekrar");
    assert.equal(knownRemedy(ctx("OpenAI request failed: 429"))?.tur, "bekle_tekrar");
  });

  await scenario("B an unknown failure goes to the model, which may only pick an allowed action", async () => {
    const c = ctx("TypeError: x is undefined", { step: "portre", optional: true });
    const pick = await decideRepair(c, new FakeModel('{"tur": "atla", "neden": "portre isteğe bağlı"}'));
    assert.deepEqual([pick.tur, pick.kaynak], ["atla", "model"]);
    assert.equal(parseRepair('{"tur": "ayar", "anahtar": "PATH", "deger": "C:/evil", "neden": "x"}', c), undefined, "izinli olmayan ayar reddedilir");
    assert.equal(parseRepair('{"tur": "kod_yaz", "neden": "x"}', c), undefined);
    assert.equal(parseRepair('{"tur": "atla"}', ctx("x", { optional: false })), undefined, "zorunlu adım atlanamaz");
    assert.equal(parseRepair('{"tur": "bekle_tekrar", "saniye": 9999}', c)?.tur, "bekle_tekrar");
    const capped = parseRepair('{"tur": "bekle_tekrar", "saniye": 9999}', c);
    assert.equal(capped && capped.tur === "bekle_tekrar" ? capped.saniye : -1, 300);
  });

  await scenario("C no usable answer: an optional step is skipped, a required one stops — never a guess", async () => {
    assert.deepEqual([(await decideRepair(ctx("weird", { optional: true }), new FakeModel("bilmiyorum"))).tur], ["atla"]);
    const stop = await decideRepair(ctx("weird"), new FakeModel(new Error("ollama kapalı")));
    assert.deepEqual([stop.tur, stop.kaynak], ["dur", "varsayilan"]);
    assert.match(describeRepair(stop), /üretim durdu/);
  });

  await scenario("D the council report: findings and debates reach AYAS's inbox (append-only), the markdown separates measures from developments", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-kurul-"));
    const log = new CouncilLog();
    log.find({ beyin: "ortam", onem: "uyari", baslik: "dönem görseli bulunamadı", ayrinti: "s1", tur: "veri", yer: "s1" });
    log.find({ beyin: "kostum", onem: "eksik", baslik: "parça tasarlanamadı", ayrinti: "scutum", tur: "veri" });
    log.debate("kostum", "parça: scutum", [{ rol: "Tarihçi", metin: "kenar bronz olmalı" }, { rol: "Şef", metin: "revize" }]);
    log.debate("kostum", "boş", []);
    const plan = { ozet: "İyi.", onlemler: [{ baslik: "Arama adları", neden: "görsel yok", beyin: "ortam" as const }], gelistirmeler: [{ baslik: "Kalkan çizimi", neden: "tekrar eden ret", beyin: "kostum" as const }] };
    const file = await writeCouncilReport({ workDir: root, workRoot: root, bolum: "Test", log, plan });
    await writeCouncilReport({ workDir: root, workRoot: root, bolum: "Test 2", log });
    const report = JSON.parse(readFileSync(file, "utf8")) as { bulgular: unknown[]; tartismalar: unknown[] };
    assert.equal(report.bulgular.length, 2);
    assert.equal(report.tartismalar.length, 1, "boş tartışma kaydedilmez");
    const inbox = (await readInbox(root)) as { bolum: string; eksik: number; gelistirmeler: number }[];
    assert.deepEqual(inbox.map((l) => [l.bolum, l.eksik]), [["Test", 1], ["Test 2", 1]]);
    assert.equal(inbox[0]!.gelistirmeler, 1);
    const md = councilMarkdown("Test", log, plan);
    assert.ok(md.includes("Önlemler (Atölye kendisi alır, kod değişmez)") && md.includes("Geliştirme önerileri (owner onayı gerekir)") && md.includes("**Tarihçi:** kenar bronz olmalı"));
    assert.ok(qualityPrompt("49 BC").includes("49 BC"));
    // Owner, 22 Oct 2026: the frame is also judged on whether it shows what is being said; badges and map names are part
    // of the show. The DRAMATIZATION corner label is no longer drawn (owner, 23 Oct 2026), so the judge is not told of it.
    const told = qualityPrompt("49 BC", [], undefined, "Caesar's army marched south, town after town.");
    assert.ok(told.includes('says: "Caesar\'s army marched south') && told.includes('"anlati": <0-10>') && told.includes("SHOW what is being said"));
    assert.ok(!qualityPrompt("49 BC").includes('"anlati"'), "without the narration, no story score is asked");
    assert.ok(qualityPrompt("49 BC").includes("portrait badge") && !qualityPrompt("49 BC").includes("DRAMATIZATION"));
    // The Cannae measurement, 9 Nov 2026 (216 BC, 0/10): "a religious cross on the map" — the blocks' troop signs (an
    // upright sword, an ✕) are part of the show; a side's cross emblem before 312 is refused by the validator instead.
    assert.match(qualityPrompt("216 BC"), /Part of the show, never a fault:[^\n]*troop sign[^\n]*upright sword with its crossguard[^\n]*never a religious cross/);
    assert.ok(qualityPrompt("216 BC").includes("a cross on a roof or tower"), "a later era's cross on a building is still a fault");
  });

  await scenario("D1b only the narrator's lines are scored as told-but-not-shown (Cannae, 9 Nov 2026: Hannibal's \"Hmm... not yet.\" came back as a proposal)", () => {
    const ep = {
      oyuncu_kadrosu: [{ id: "anlatici", gorunur: false }, { id: "hannibal", gorunur: true }],
      sahneler: [{ satirlar: [{ karakter: "anlatici", metin: "Fifty thousand Romans fall. [pause]" }, { karakter: "hannibal", metin: "Hmm... not yet." }] }, { satirlar: [{ karakter: "anlatici", metin: "[sigh]" }] }],
    };
    const lines = [{ sceneIndex: 0, lineIndex: 0, start: 38, end: 43 }, { sceneIndex: 0, lineIndex: 1, start: 49, end: 51 }, { sceneIndex: 1, lineIndex: 0, start: 52, end: 53 }, { sceneIndex: 5, lineIndex: 0, start: 60, end: 61 }];
    const speech = (t: string) => t.replace(/\[[^\]]*\]/g, "").trim();
    assert.deepEqual(narratedSpans(ep, lines, speech), [{ from: 38, to: 43, text: "Fifty thousand Romans fall." }], "the character's quip, a stage direction alone and a missing line are not told");
  });

  await scenario("D2 the chief's bare-sentence measures are kept as titles, never 'undefined'; the end card is not a quality fault", () => {
    const items = chiefItems(["Eski adlarla ara.", { baslik: "Süre", neden: "satır ekle", beyin: "kurgu" }, { neden: "yalnız neden" }, { beyin: "uydurma" }, 7, ""]);
    assert.deepEqual(items, [{ baslik: "Eski adlarla ara.", neden: "" }, { baslik: "Süre", neden: "satır ekle", beyin: "kurgu" }, { baslik: "yalnız neden", neden: "" }]);
    const md = councilMarkdown("Roma", new CouncilLog(), { ozet: "Özet.", onlemler: items, gelistirmeler: [] });
    assert.ok(md.includes("- Eski adlarla ara.\n") && md.includes("- Süre — satır ekle _(") && !md.includes("undefined"), md);
    // 13 Nov 2026: a measure is written only to a brain some prompt reads (43 sound measures were never read).
    assert.deepEqual([isMeasureBrain("kurgu"), isMeasureBrain("mizah"), isMeasureBrain("ses"), isMeasureBrain("sef"), isMeasureBrain(undefined)], [true, true, false, false, false]);
    assert.ok(!(MEASURE_BRAINS as readonly string[]).includes("ses"));
    const plan = { fps: 30, shots: [{ start: 0, titleCards: [{ style: "kapak" as const, start: 0, end: 105 }] }, { start: 2664, titleCards: [{ style: "abone" as const, start: 342, end: 492 }, { style: "bilgi" as const, start: 0, end: 60 }] }] };
    const windows = designedWindows(plan as unknown as Parameters<typeof designedWindows>[0]);
    assert.deepEqual(windows.map((w) => [w.from.toFixed(1), w.to.toFixed(1)]), [["0.0", "3.5"], ["100.2", "105.2"]]);
    assert.ok(qualityPrompt("49 BC", [], windows[1]!.what).includes("SUBSCRIBE button") && !qualityPrompt("49 BC").includes("By design"));
  });

  await scenario("E experience memory: lessons are kept, the relevant ones come back once, newest first on a tie", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-deneyim-"));
    await remember(root, { bolum: "Rubicon", beyin: "ortam", tur: "ders", konu: "a street in Rome 49 BC", metin: "sunset sky; church bell tower" });
    await remember(root, { bolum: "Rubicon", beyin: "ortam", tur: "ders", konu: "a street in Rome 49 BC", metin: "sunset sky; church bell tower" });
    await remember(root, { bolum: "Fatih", beyin: "ortam", tur: "ders", konu: "Ottoman tent 1453", metin: "modern camping tent" });
    const rome = await recall(root, "ortam", { konu: "Roman street with a temple, 49 BC", tur: "ders" });
    assert.deepEqual(rome.map((l) => l.metin), ["sunset sky; church bell tower"], "relevant only, each text once");
    assert.equal((await recall(root, "ortam")).length, 2);
    assert.deepEqual(await recall(root, "kurgu"), [], "another brain's file is separate");
    assert.ok(overlap("Roman street", "a street in Rome") > 0 && overlap("tent", "river") === 0);
  });

  await scenario("F a remedy that worked is reused for the same failure; one that failed is not repeated", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-ilac-"));
    const err1 = "Remotion still failed: Target closed at D:\\renders\\a.png (job 4a1b2c3d4e5f)";
    const err2 = "Remotion still failed: Target closed at D:\\other\\b.png (job 99aa88bb77cc)";
    assert.equal(errorSignature(err1), errorSignature(err2), "paths, hashes and numbers do not split a failure");
    assert.equal(await learnedRemedy(root, "gardirop", err1), undefined);
    const wait = { tur: "bekle_tekrar" as const, saniye: 30, neden: "geçici" };
    await remember(root, { bolum: "x", beyin: "onarim", tur: "ilac", konu: remedyTopic("gardirop", err1), metin: "bekle", sonuc: "ise_yaradi", eylem: wait });
    assert.deepEqual(await learnedRemedy(root, "gardirop", err2), wait);
    const c: RepairContext = { step: "gardirop", error: err2, attempt: 1, optional: false, env: {} };
    assert.equal((await decideRepair(c, undefined, wait)).kaynak, "hafiza", "memory before the model");
    await remember(root, { bolum: "x", beyin: "onarim", tur: "ilac", konu: remedyTopic("gardirop", err1), metin: "bekle", sonuc: "ise_yaramadi", eylem: wait });
    assert.equal(await learnedRemedy(root, "gardirop", err1), undefined, "the latest use did not work");
    assert.equal((await decideRepair({ ...c, error: "ENOSPC no space left" }, undefined, wait)).kaynak, "bilinen", "a known remedy still comes first");
  });

  await scenario("G lessons reach the brains: set prompt, part prompt, writer prompt; the set judge writes an English lesson", () => {
    const scene = { arka_plan_sorgusu: { tr: "Roma", en: "Roman street" }, mekan: "a street in Rome" } as unknown as EpisodeScene;
    assert.match(designFor(scene, { donem: "49 BC" }, [], ["sunset sky"]).prompt2, /Avoid what failed before: sunset sky\./);
    assert.match(partPrompt({ slot: "hand", tarif: "scroll" }, "49 BC", "<svg/>", undefined, undefined, undefined, ["too thick"]), /SIMILAR PARTS FAILED BEFORE[^\n]*too thick/);
    const brief = { konu: "x", donem: "49 BC", hedefSureSn: 60, ton: "mizahi" as const, dil: "en" as const, dersler: ["A 120 s episode ran 90 s"] };
    assert.match(writingPrompt(brief, []), /LESSONS FROM EARLIER EPISODES[\s\S]*A 120 s episode ran 90 s/);
    const borders = writingPrompt({ ...brief, tarihiSinirlar: [{ yil: -100, adlar: ["Parthia", "Roman Republic"] }, { yil: -1, adlar: ["Roman Empire"] }] }, []);
    assert.match(borders, /REAL HISTORICAL BORDERS[\s\S]*100 BC \(yil -100\): Parthia, Roman Republic \| 1 BC \(yil -1\): Roman Empire/);
    assert.doesNotMatch(writingPrompt(brief, []), /REAL HISTORICAL BORDERS/);
    assert.equal(parseVerdict('{"puan": 4, "donem": 3, "gosterilen": "sokak", "sorun": "gün batımı", "kacin": "sunset sky"}')?.kacin, "sunset sky");
    assert.match(judgePrompt({ konu: "x", donem: "49 BC", mekan: "y", tr: "y", en: "y", anlatim: "" }, { title: "t" }, "set"), /"kacin"/);
    assert.doesNotMatch(judgePrompt({ konu: "x", donem: "49 BC", mekan: "y", tr: "y", en: "y", anlatim: "" }, { title: "t" }, "arsiv"), /"kacin"/);
  });

  await scenario("H brains' exam: expectations graded, the question file is consistent", () => {
    const q = (beklenen: ExamQuestion["beklenen"]): ExamQuestion => ({ id: "q", mod: "set", gorsel: "x.png", kaynak: "x", sahne: { konu: "", donem: "", mekan: "", tr: "", en: "", anlatim: "" }, beklenen, neden: "" });
    const v = (puan: number, donem: number, modern = false) => ({ title: "x", puan, donem, modern, gosterilen: "", sorun: "" });
    assert.equal(gradeAnswer(q({ gecmeli: true }), v(8, 8)).dogru, true);
    assert.equal(gradeAnswer(q({ gecmeli: true }), v(8, 8, true)).dogru, false, "modern never passes");
    assert.equal(gradeAnswer(q({ donemMax: 4 }), v(9, 10)).dogru, false, "the church-tower town the old judge passed");
    assert.equal(gradeAnswer(q({ puanMax: 5 }), v(5, 9)).dogru, true);
    assert.equal(gradeAnswer(q({ gecmeli: true }), undefined).neden, "cevap yok");
    const manifest = JSON.parse(readFileSync(path.join(__dirname, "..", "content", "v3", "beyin-sinavi.json"), "utf8")) as ExamManifest;
    const ids = manifest.sorular.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, "unique question ids");
    for (const x of manifest.sorular) {
      assert.ok(["arsiv", "set", "portre", "parca", "referans"].includes(x.mod), x.id);
      assert.ok(Object.keys(x.beklenen).length > 0 && x.neden, x.id);
    }
  });

  await scenario("owner rules: a 'kural' lesson is recalled every time whatever the topic, never under a type filter, at most MAX_RULES", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-kural-"));
    await remember(root, { bolum: "rubicon", beyin: "kurgu", tur: "kural", konu: "boş sahne", metin: "Never leave a scene to the narrator alone: put a visible character on stage." });
    await remember(root, { bolum: "rubicon", beyin: "kurgu", tur: "ders", konu: "senaryo", metin: "Put one sfx on a gag in every scene." });
    const any = await recall(root, "kurgu", { konu: "Ottoman navy sfx", limit: 1 });
    assert.deepEqual(any.map((l) => l.tur), ["kural", "ders"], "the rule comes first and does not count against the limit");
    assert.deepEqual((await recall(root, "kurgu", { konu: "completely unrelated words" })).map((l) => l.tur), ["kural"], "a rule needs no shared words");
    assert.deepEqual((await recall(root, "kurgu", { tur: "ders" })).map((l) => l.tur), ["ders"], "a type filter leaves rules out (the part drawer asks for ders)");
    assert.equal((await recall(root, "kurgu", { tur: "kural" })).length, 1);
    // 13 Nov 2026: a list of types — the costume historian and part drawer ask for rules, lessons and the chief's measures.
    await remember(root, { bolum: "x", beyin: "kurgu", tur: "onlem", konu: "Short süre", metin: "Kısa satırlar yaz." });
    await remember(root, { bolum: "x", beyin: "kurgu", tur: "ilac", konu: "s | e", metin: "bekle" });
    assert.deepEqual((await recall(root, "kurgu", { tur: ["kural", "ders", "onlem"], limit: 5 })).map((l) => l.tur), ["kural", "onlem", "ders"], "rules first, then lessons and measures (newest first); a remedy stays out");
    assert.deepEqual((await recall(root, "kurgu", { tur: ["ders", "onlem"], limit: 5 })).map((l) => l.tur), ["onlem", "ders"], "no 'kural' in the list: no rules; newest first");
    assert.deepEqual((await recall(root, "kurgu", { tur: ["kural"] })).map((l) => l.tur), ["kural"]);
    await remember(root, { bolum: "rubicon", beyin: "kurgu", tur: "kural", konu: "boş sahne", metin: "Never leave a scene to the narrator alone: put a visible character on stage." });
    assert.equal((await recall(root, "kurgu", { tur: "kural" })).length, 1, "the same rule twice is recalled once");
    for (let i = 0; i < MAX_RULES + 3; i++) await remember(root, { bolum: "x", beyin: "kalite", tur: "kural", konu: "k", metin: `rule ${i}` });
    const rules = await recall(root, "kalite", { tur: "kural" });
    assert.equal(rules.length, MAX_RULES);
    assert.equal(rules[rules.length - 1]!.metin, `rule ${MAX_RULES + 2}`, "the newest rules are kept");
    const prompt = qualityPrompt("49 BC", ["the same name written twice on a map"]);
    assert.match(prompt, /The owner also found these faults in earlier videos that this check missed — look for them too:\n- the same name written twice on a map/);
    assert.doesNotMatch(qualityPrompt("49 BC"), /owner also found/);
    // The checked-in owner rules: valid brains, within the memory's 300 characters, seeded once.
    const file = JSON.parse(readFileSync(path.resolve("content/v3/owner-kurallari.json"), "utf8")) as { kurallar: OwnerRule[] };
    assert.ok(file.kurallar.length >= 3);
    for (const r of file.kurallar) {
      assert.ok(r.beyin in BRAIN_NAMES, r.beyin);
      assert.ok(r.metin.length <= 300 && r.konu.length > 0, r.metin);
    }
    const fresh = mkdtempSync(path.join(os.tmpdir(), "v3-tohum-"));
    assert.equal(await seedRules(fresh, file.kurallar), file.kurallar.length);
    assert.equal(await seedRules(fresh, file.kurallar), 0, "a second seed adds nothing");
    assert.ok((await recall(fresh, "kurgu", { konu: "anything", limit: 0 })).every((l) => l.tur === "kural"));
  });

  await scenario("meaning search: a lesson with no shared word is found by meaning; vectors cached; a failing model falls back to words", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-anlam-"));
    await remember(root, { bolum: "rubicon", beyin: "ortam", tur: "ders", konu: "fortified village", metin: "Avoid medieval castles with red tile roofs for an ancient town." });
    await remember(root, { bolum: "rubicon", beyin: "ortam", tur: "ders", konu: "harbour", metin: "Keep the sea calm and the ships of the period." });
    // A fake model: two meanings (walls / water) as 2-d vectors.
    let calls = 0;
    const fake = { name: "sahte", embed: async (texts: readonly string[]) => (calls++, texts.map((t) => (/castle|walled|fortified|town|hilltop/i.test(t) ? [1, 0.05] : /sea|ship|harbour|port/i.test(t) ? [0.05, 1] : [0.7, 0.7]))) };
    assert.deepEqual(await recall(root, "ortam", { konu: "a walled hilltop settlement", tur: "ders" }), [], "meaning search is off by default: no shared word, nothing found");
    assert.match(await enableMeaningSearch(fake), /^anlam araması \(sahte/);
    const found = await recall(root, "ortam", { konu: "a walled hilltop settlement", tur: "ders" });
    assert.deepEqual(found.map((l) => l.konu), ["fortified village"], "found by meaning, the harbour lesson is not");
    assert.equal(cosine([1, 0], [1, 0]), 1);
    assert.ok(existsSync(path.join(root, "_kutuphane", "deneyim", ".anlam-sahte.json")), "vectors are cached");
    const before = calls;
    await recall(root, "ortam", { konu: "another walled town", tur: "ders" });
    assert.equal(calls, before + 1, "cached lessons are not embedded again (only the question)");
    const broken = { name: "bozuk", embed: async () => Promise.reject(new Error("EMBED_HTTP_404")) };
    assert.match(await enableMeaningSearch(broken), /kelime araması — bozuk kullanılamadı \(EMBED_HTTP_404\)/);
    assert.deepEqual(await recall(root, "ortam", { konu: "a walled hilltop settlement", tur: "ders" }), [], "back to words");
    assert.match(await enableMeaningSearch(undefined), /^kelime araması — kapalı/);
    assert.equal(ollamaEmbedder("http://127.0.0.1:1", "0"), undefined, "ATOLYE_V3_EMBED_MODEL=0 turns it off");
  });

  await scenario("Q the quality brain's frame-fault check (owner, 26 Oct 2026): questions by kind of frame, a yes is a fault, taught frames shown as examples (never a question's own)", async () => {
    const plan = { fps: 30, shots: [
      { start: 0, duration: 90, transitionIn: "kes", geoMap: { close: {} } },
      { start: 90, duration: 90, transitionIn: "kaydir", inserts: [{ start: 30, end: 60 }] },
      { start: 180, duration: 60, transitionIn: "kes", geoMap: {} },
    ] } as unknown as Parameters<typeof frameKindAt>[0];
    assert.deepEqual([0.5, 3.1, 4.5, 5.5, 6.5, 9].map((t) => frameKindAt(plan, t)), ["yakin-harita", "gecis", "resim", "sahne", "harita", undefined]);
    // A transition is a transition for as long as the renderer draws it (transitionFrames): a dissolve half a second.
    const soft = { fps: 30, shots: [{ start: 0, duration: 90, transitionIn: "kes" }, { start: 90, duration: 90, transitionIn: "cozul" }] } as unknown as Parameters<typeof frameKindAt>[0];
    assert.deepEqual([89, 90, 104, 105].map((f) => frameKindAt(soft, f / 30)), ["sahne", "gecis", "gecis", "sahne"]);
    assert.deepEqual(frameChecks("resim").map((c) => c.key), ["bos"], "a period picture is not judged on badges or beards");
    assert.deepEqual(frameChecks("sahne").map((c) => c.key), ["kenar", "ustuste", "bos", "bozuk"]);
    const pointed = qualityPrompt("1389", [], undefined, undefined, { kind: "yakin-harita", examples: [{ kusurlu: true, metin: "rozet kesik" }, { kusurlu: false, metin: "kaynak satırı" }] });
    assert.ok(pointed.includes('"kenar": true|false') && !pointed.includes('"bozuk"') && pointed.includes("Picture 1: a FAULT the check missed: rozet kesik") && pointed.includes("Picture 2: NOT a fault") && pointed.includes("The frame you judge is picture 3."), pointed);
    assert.ok(qualityPrompt("1389", [], undefined, undefined, { kind: "harita", edges: true }).includes("The frame you judge is picture 1. Picture 2 shows that same frame's top edge"), "the edge strips follow the frame");
    assert.ok(EDGE_STRIPS_FILTER.endsWith("vstack=inputs=4") && edgeStripArgs("v.mp4", 12.345, "o.jpg").join(" ").includes("-ss 12.35 -i v.mp4"));
    assert.ok(!qualityPrompt("1389").includes("true|false"), "without the pointed questions the prompt is as before");
    // A yes caps the score and names the fault; the examples go before the judged frame.
    let seen: readonly string[] = [];
    const judge: AIProvider = { generate: async (_p, o) => ((seen = o?.images ?? []), { content: '{"puan": 9, "kenar": true, "ustuste": false, "bos": false, "sorunlar": []}', finishReason: "stop", refused: false, complete: true, truncated: false }) };
    const v = await judgeFrame({ judge, image: "KARE", donem: "1389", kind: "yakin-harita", examples: [{ image: "ORNEK", kusurlu: true, metin: "rozet kesik" }] });
    assert.deepEqual([v.puan, v.sorunlar[0], seen], [4, "kenarda kesik rozet, yüz ya da yazı", ["ORNEK", "KARE"]]);
    assert.equal((await judgeFrame({ judge: new FakeModel("bozuk"), image: "K", donem: "1389" })).okunamadi, true);
    // Teaching: the frame kept as a picture, recalled for frames of its kind only, and once.
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-kalite-"));
    const shot = path.join(root, "kare.jpg");
    writeFileSync(shot, "jpeg");
    const lesson = { workRoot: root, ffmpeg: "ffmpeg", kind: "yakin-harita" as const, kusurlu: true, metin: "Lazar'ın rozeti üst kenarda kesik", bolum: "kosova", frame: shot };
    assert.equal(await teachFrame({ ...lesson, ad: "kosova-rozet" }), true);
    assert.equal(await teachFrame({ ...lesson, ad: "kosova-rozet" }), false, "taught once");
    await teachFrame({ ...lesson, ad: "kosova-yalanci", kusurlu: false, metin: "kaynak satırı kusur değil" });
    const lessons = await recall(root, "kalite", { tur: "ders", limit: 100 });
    const close = await frameExamples(lessons, exampleDir(root), "yakin-harita");
    assert.deepEqual(close.map((e) => [e.kusurlu, e.metin]), [[true, "Lazar'ın rozeti üst kenarda kesik"], [false, "kaynak satırı kusur değil"]], "a missed fault and a false alarm in turn");
    await teachFrame({ ...lesson, ad: "kosova-yalanci-2", kusurlu: false, metin: "yeni bir yanlış alarm" });
    const mixed = await frameExamples(await recall(root, "kalite", { tur: "ders", limit: 100 }), exampleDir(root), "yakin-harita");
    assert.deepEqual(mixed.map((e) => e.kusurlu), [true, false], "two false alarms taught later do not crowd out the fault");
    assert.deepEqual(await frameExamples(lessons, exampleDir(root), "harita"), [], "a close map's lesson is not a wide map's");
    assert.equal((await frameExamples(lessons, exampleDir(root), "yakin-harita", (f) => f === "kosova-rozet.jpg")).length, 1, "a question never sees its own frame");
  });

  await scenario("Q2 the frame exam (owner, 9 Nov 2026: 8 → 30+ questions): the file is consistent with 30+ eye questions; the eye's score apart from the measures", () => {
    const file = JSON.parse(readFileSync(path.join(process.cwd(), "content", "v3", "kalite-sinavi.json"), "utf8")) as { sorular: FrameQuestion[] };
    assert.deepEqual(questionProblems(file.sorular), []);
    const eye = file.sorular.filter(eyeQuestion);
    assert.ok(eye.length >= MIN_EYE_QUESTIONS && eye.some((q) => q.kusurlu) && eye.some((q) => !q.kusurlu), `göz sorusu ${eye.length}`);
    assert.ok(file.sorular.filter((q) => q.bozma).every((q) => q.kusurlu && q.olcum === "goz"), "a laid-on fault is an eye fault");
    // A broken file is named line by line.
    const bad = questionProblems([
      { id: "A b", kaynak: "D:/x.mp4", saniye: -1, donem: "1", tur: "sahne", kusurlu: true },
      { id: "c", kaynak: "v.mp4", saniye: 1, donem: "1", tur: "sahne", kusurlu: false, ne: "temiz", bozma: "negate" },
    ] as FrameQuestion[]);
    assert.equal(bad.length, 7, bad.join("\n"));
    // Scores: the balanced mean; a judge that calls every frame faulty gets 50 and is named.
    const s = examScore([{ kusurlu: true, dogru: true }, { kusurlu: true, dogru: false }, { kusurlu: false, dogru: true }, { kusurlu: false, dogru: true }]);
    assert.deepEqual([s.dogru, s.toplam, s.dengeli, s.hepAyni], [3, 4, 75, false]);
    const all = examScore([{ kusurlu: true, dogru: true }, { kusurlu: false, dogru: false }, { kusurlu: false, dogru: false }]);
    assert.deepEqual([all.dengeli, all.hepAyni], [50, true]);
    assert.equal(examScore([{ kusurlu: true, dogru: true }]).dengeli, undefined, "no clean frame: no balanced score");
    // A measured fault counts for the moments it covers.
    assert.deepEqual(faultsAt([{ from: 19.5, to: 21, ayrinti: "kesik" }, { from: 29, to: 31.5, ayrinti: "üst üste" }], 20.2).map((f) => f.ayrinti), ["kesik"]);
    assert.deepEqual(faultsAt([{ from: 19.5, to: 21, ayrinti: "kesik" }], 22), []);
  });

  await scenario("L the layout check (owner, 2 Nov 2026): a box cut by the edge or printed over another, only when it lasts; covers and skipped frames", () => {
    const box = (tur: V3LayoutBox["tur"], ad: string, x: number, y: number, w = 200, h = 140): V3LayoutBox => ({ tur, ad, x, y, w, h });
    const lazarCut = box("rozet", "Prince Lazar", 660, -34);
    assert.deepEqual(cutSides(lazarCut, 1920, 1080), { ust: 34 });
    assert.deepEqual(cutSides(box("rozet", "x", 1, -5), 1920, 1080), {}, "a stroke or a spring's wobble is no cut");
    assert.deepEqual(cutSides(box("yazi", "x", -500, 10), 1920, 1080), {}, "wholly outside is not shown, not cut");
    assert.equal(overlapShare(box("balon", "a", 0, 0, 100, 100), box("yazi", "b", 50, 50, 100, 100)), 0.25);
    const file = (kareler: { kare: number; ogeler: V3LayoutBox[] }[]) => ({ fps: 30, width: 1920, height: 1080, every: 15, kareler });
    const faults = layoutFaults(file([
      { kare: 0, ogeler: [lazarCut, box("balon", "NEW MANAGEMENT!", 1300, 380, 300, 70), box("yazi", "BAYEZID'S COUNTERATTACK", 1336, 395, 229, 67)] },
      { kare: 15, ogeler: [lazarCut, box("balon", "NEW MANAGEMENT!", 1300, 380, 300, 70), box("yazi", "BAYEZID'S COUNTERATTACK", 1336, 395, 229, 67)] },
      { kare: 30, ogeler: [box("etiket", "Serbian coalition", 500, -20, 240, 36)] },
    ]));
    assert.deepEqual(faults.map((f) => [f.tur, f.from, f.to]), [["kenar", 0, 1], ["ustuste", 0, 1]], "a cut on one probe only (the label) is a passing move");
    assert.ok(faults[0]!.ayrinti.includes('"Prince Lazar" rozet üst kenarda kesik (34 px dışarıda)') && faults[1]!.ayrinti.includes("konuşma yazısı ile") && faults[1]!.ayrinti.includes("harita yazısı"), faults.map((f) => f.ayrinti).join(" | "));
    // An info card over the picture: only the card is judged; a skipped frame ends a run.
    const card = { kare: 0, ogeler: [box("kart", "Strength", 300, 120, 900, 70), box("yazi", "SERBIA", -40, 10), box("yazi", "BLACK SEA", 10, 10)] };
    assert.deepEqual(layoutFaults(file([card, { ...card, kare: 15 }])), [], "names under an info card are not judged");
    const cut = (kare: number) => ({ kare, ogeler: [lazarCut] });
    assert.deepEqual(layoutFaults(file([cut(0), cut(15), cut(30)]), (f) => f === 15).length, 0, "a transition between two probes splits the run");
    assert.equal(MIN_PROBES, 2);
  });

  await scenario("L2 the map framing check (the Taranto Short, 11 Nov 2026: every check passed while the attack showed empty sea): a Short's acting units outside the window, at its edge or behind a character are measured faults", async () => {
    // s6 as rendered: the sailor stands at 0.26 of the stage, the window round him; the ships (1053, 486) and the admiral's
    // badge (960, 540) never in it. s5's first beat: six planes whose wedge reaches the top edge.
    const shot = (id: string, start: number, performers: unknown[], geoMap: unknown) => ({ id, start, duration: 300, performers, geoMap, titleCards: [], camera: [] });
    const sailor = { castId: "italian-sailor", x: 0.26, depth: 0.08, moves: [] };
    const ships = { kind: "gemi", color: "#b3263a", count: 3, start: 9, path: [{ x: 1053, y: 486 }], lossStart: 237, losses: [2.4] };
    const badge = { castId: "luigi", label: "Admiral Inigo Campioni", start: 9, path: [{ x: 960, y: 540 }] };
    const planes = { kind: "ucak", color: "#3a7e6b", count: 6, start: 9, path: [{ x: 635, y: 112 }] };
    const base = { arrows: [], armies: [], territories: [], cities: [], lakes: [], rivers: [], land: "" };
    const plan = {
      fps: 30,
      width: 1080,
      height: 1920,
      stage: { width: 1920, height: 1080 },
      shots: [shot("s6", 0, [sailor], { ...base, vehicles: [ships], badges: [badge] }), shot("s5", 300, [], { ...base, vehicles: [planes, { ...ships, path: [{ x: 1053, y: 486 }] }] })],
    } as unknown as Parameters<typeof mapFramingFaults>[0];
    const faults = mapFramingFaults(plan);
    assert.deepEqual(faults.map((f) => [f.shot, f.at]), [["s6", 0.3], ["s6", 7.9], ["s5", 10.3]]);
    // The window round the sailor is pulled toward them (ShotView's pairAim) as far as it goes: they reach its edge, cut.
    assert.ok(faults[0]!.ayrinti.includes("gemi ×3") && /kadraj (dışında|kenarında kesik)/.test(faults[0]!.ayrinti), faults[0]!.ayrinti);
    assert.ok(faults[2]!.ayrinti.includes("ucak ×6 kadraj kenarında kesik"), faults[2]!.ayrinti);
    // The sailor just right of the ships (UnitFraming.besideAction): the window pulled toward them shows both, nothing behind him.
    const fixed = { ...plan, shots: [shot("s6", 0, [{ ...sailor, x: 0.65 }], { ...base, vehicles: [ships], badges: [badge] })] } as unknown as typeof plan;
    assert.deepEqual(mapFramingFaults(fixed), []);
    // In front of the ships: behind the character.
    const hidden = { ...plan, shots: [shot("s6", 0, [{ ...sailor, x: 0.53 }], { ...base, vehicles: [ships] })] } as unknown as typeof plan;
    assert.ok(mapFramingFaults(hidden)[0]?.ayrinti.includes("karakterin arkasında"), JSON.stringify(mapFramingFaults(hidden)));
    // A 16:9 plan (a long video, or a Short laid out whole, 12 Nov 2026: "every scene fully visible") is judged against
    // its whole frame: the sailor's ships and badge are in it, the planes' wedge is still cut at the top.
    const wide = { ...plan, width: 1920, height: 1080, stage: undefined } as typeof plan;
    assert.deepEqual(mapFramingFaults(wide).map((f) => [f.shot, f.at, f.ayrinti]), [["s5", 10.3, "ucak ×6 kadraj kenarında kesik"]]);
    // A badge set at the frame's left edge is cut; set inside, nothing is reported.
    const edgeBadge = (x: number) => ({ ...wide, shots: [shot("s6", 0, [sailor], { ...base, vehicles: [ships], badges: [{ ...badge, path: [{ x, y: 300 }] }] })] }) as unknown as typeof plan;
    assert.deepEqual(mapFramingFaults(edgeBadge(30)).map((f) => f.ayrinti), ["Admiral Inigo Campioni kadraj kenarında kesik"]);
    assert.deepEqual(mapFramingFaults(edgeBadge(400)), []);
    // Behind the character on the whole frame too.
    assert.ok(mapFramingFaults({ ...wide, shots: [shot("s6", 0, [{ ...sailor, x: 0.53 }], { ...base, vehicles: [ships] })] } as unknown as typeof plan)[0]?.ayrinti.includes("karakterin arkasında"));
    // Counted with the layout faults even when the render wrote no boxes, each a quality finding with its time.
    const council = new CouncilLog();
    const n = await layoutReview({ file: path.join(os.tmpdir(), "v3-yok", "yerlesim.json"), plan, council });
    assert.equal(n, 3);
    assert.equal(council.findings.filter((f) => f.baslik.startsWith("harita kadrajı")).length, 3);
  });

  await scenario("P the pixel check: a flat dark band down an edge, land painted as sea for a moment, designed moments skipped", () => {
    const W = PIXEL_W;
    const H = PIXEL_H;
    const frame = (paint: (x: number, y: number) => [number, number, number]) => {
      const rgb = new Uint8Array(W * H * 3);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgb.set(paint(x, y), (y * W + x) * 3);
      return rgb;
    };
    const land: [number, number, number] = [180, 190, 140];
    const sea: [number, number, number] = [34, 64, 106];
    const empty: [number, number, number] = [21, 18, 28];
    assert.deepEqual(frameStats(frame(() => land)), { sea: 0, dark: 0 });
    const banded = frameStats(frame((x) => (x < 11 ? empty : land)));
    assert.deepEqual(banded.band, { side: "sol", px: 132 }, "11 of 160 columns at 1920 px");
    assert.equal(frameStats(frame(() => sea)).sea, 1);
    // A soft vignette is no band: it darkens step by step.
    assert.equal(frameStats(frame((x) => { const v = Math.min(180, 12 + x * 6); return [v, v, v]; })).band, undefined);
    // Two frames of sea in a land shot are a flash; a camera that glides out to sea for good is not.
    const at = (i: number) => i / 30;
    const glitch = Array.from({ length: 90 }, (_, i) => ({ t: at(i), s: { sea: i === 45 || i === 46 ? 0.84 : 0.01, dark: 0 } }));
    const flashes = pixelFaults(glitch);
    assert.deepEqual(flashes.map((f) => f.tur), ["zemin"]);
    assert.ok(flashes[0]!.ayrinti.includes("zemin bir an deniz rengine boyandı") && Math.abs(flashes[0]!.from - 1.5) < 1e-9, flashes[0]!.ayrinti);
    const glide = Array.from({ length: 120 }, (_, i) => ({ t: at(i), s: { sea: i < 60 ? 0.05 : 0.8, dark: 0 } }));
    assert.deepEqual(pixelFaults(glide), [], "a lasting change is the story");
    const word = Array.from({ length: 90 }, (_, i) => ({ t: at(i), s: { sea: 0, dark: i >= 40 && i < 52 ? 0.95 : 0.02 } }));
    assert.deepEqual(pixelFaults(word).map((f) => f.tur), ["karanlik"]);
    assert.deepEqual(pixelFaults(word, (t) => t >= 40 / 30 && t < 52 / 30), [], "a full-screen word is dark by design");
    const band = Array.from({ length: 30 }, (_, i) => ({ t: at(i), s: { sea: 0, dark: 0.1, ...(i >= 10 && i < 13 ? { band: { side: "sol" as const, px: 132 } } : {}) } }));
    assert.deepEqual(pixelFaults(band).map((f) => [f.tur, f.ayrinti]), [["serit", "sol kenarda koyu şerit (132 px, görüntü kareyi doldurmuyor)"]]);
    assert.equal(BAND_MIN_FRAMES, 2);
    // The plan's designed moments: white/ink transitions, a full-screen word, a period picture; a slide is judged.
    const plan = { fps: 30, width: 1920, height: 1080, shots: [
      { start: 0, duration: 60, transitionIn: "kaydir", inserts: [], titleCards: [] },
      { start: 60, duration: 60, transitionIn: "beyaz", inserts: [{ start: 30, end: 45 }], titleCards: [{ style: "kelime", start: 50, end: 59 }] },
    ] } as unknown as Parameters<typeof pixelSkip>[0];
    const skipPx = pixelSkip(plan);
    assert.deepEqual([0.1, 2.1, 2.5, 3.1, 3.5, 3.8].map(skipPx), [false, true, false, true, false, true]);
    const skipBox = layoutSkip(plan);
    assert.deepEqual([3, 30, 63, 95].map(skipBox), [true, false, true, true], "transitions and the period picture");
    // Measured, the vision model is asked only what needs an eye.
    assert.deepEqual(frameChecks("sahne", true).map((c) => c.key), ["bozuk"]);
    assert.deepEqual(frameChecks("harita", true), []);
    const measuredPrompt = qualityPrompt("1389", [], undefined, undefined, { kind: "sahne", measured: true });
    assert.ok(!measuredPrompt.includes('"kenar"') && measuredPrompt.includes('"bozuk": true|false') && measuredPrompt.includes("measured exactly elsewhere"), measuredPrompt);
  });

  console.log(`V3 council smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
