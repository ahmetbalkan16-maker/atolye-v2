/**
 * V3 smoke: the production council (findings, debates, report to AYAS's inbox) and the repair brain (known remedies,
 * the allowed-action whitelist, safe defaults). Fake providers only (no network, no GPU).
 * Run: npx tsx scripts/smoke-v3-council.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers/AIProvider";
import { CouncilLog, councilMarkdown, readInbox, writeCouncilReport } from "../src/lib/v3/council/Council";
import { qualityPrompt } from "../src/lib/v3/council/QualityBrain";
import { decideRepair, describeRepair, knownRemedy, parseRepair, type RepairContext } from "../src/lib/v3/council/RepairBrain";
import { type ExamManifest, type ExamQuestion, gradeAnswer } from "../src/lib/v3/council/BrainExam";
import { errorSignature, learnedRemedy, overlap, recall, remedyTopic, remember } from "../src/lib/v3/council/ExperienceMemory";
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

  console.log(`V3 council smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
