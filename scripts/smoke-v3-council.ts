/**
 * V3 smoke: the production council (findings, debates, report to AYAS's inbox) and the repair brain (known remedies,
 * the allowed-action whitelist, safe defaults). Fake providers only (no network, no GPU).
 * Run: npx tsx scripts/smoke-v3-council.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers/AIProvider";
import { BRAIN_NAMES, chiefItems, CouncilLog, councilMarkdown, readInbox, writeCouncilReport } from "../src/lib/v3/council/Council";
import { designedWindows, qualityPrompt } from "../src/lib/v3/council/QualityBrain";
import { decideRepair, describeRepair, knownRemedy, parseRepair, type RepairContext } from "../src/lib/v3/council/RepairBrain";
import { type ExamManifest, type ExamQuestion, gradeAnswer } from "../src/lib/v3/council/BrainExam";
import { cosine, errorSignature, learnedRemedy, MAX_RULES, ollamaEmbedder, type OwnerRule, overlap, recall, remedyTopic, remember, seedRules, enableMeaningSearch } from "../src/lib/v3/council/ExperienceMemory";
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
    assert.equal(knownRemedy(ctx("TypeError: cannot read properties of undefined")), undefined);
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
  });

  await scenario("D2 the chief's bare-sentence measures are kept as titles, never 'undefined'; the end card is not a quality fault", () => {
    const items = chiefItems(["Eski adlarla ara.", { baslik: "Süre", neden: "satır ekle", beyin: "kurgu" }, { neden: "yalnız neden" }, { beyin: "uydurma" }, 7, ""]);
    assert.deepEqual(items, [{ baslik: "Eski adlarla ara.", neden: "" }, { baslik: "Süre", neden: "satır ekle", beyin: "kurgu" }, { baslik: "yalnız neden", neden: "" }]);
    const md = councilMarkdown("Roma", new CouncilLog(), { ozet: "Özet.", onlemler: items, gelistirmeler: [] });
    assert.ok(md.includes("- Eski adlarla ara.\n") && md.includes("- Süre — satır ekle _(") && !md.includes("undefined"), md);
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

  console.log(`V3 council smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
