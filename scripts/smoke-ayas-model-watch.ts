import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AyasGoalResearchPanel } from "../src/components/brain/AyasGoalResearchPanel";
import { AYAS_MAX_REPLY_TOKENS } from "../src/components/brain/brainCore";
import {
  AYAS_CHAT_MODEL_BENCHMARK_CASE_COUNT, checkAyasSpokenTurkish, gradeAyasChatBenchmarkAnswer, runAyasChatModelBenchmark,
  type AyasChatModelBenchmarkResult,
} from "../src/lib/ayas/model/AyasChatModelBenchmark";
import { loadAyasResearchEngineStatusView, type AyasResearchEngineStatusView } from "../src/lib/brain/autonomy/AyasResearchEngineStatusView";
import {
  AYAS_CHAT_MODEL_BENCHMARK_ID, buildAyasModelWatchSpokenSummary, buildAyasModelWatchView, compareAyasChatModels, createAyasModelWatchStore,
  type AyasModelWatchState,
} from "../src/lib/brain/autonomy/AyasModelWatch";
import { buildAyasResearchStatusSpokenAnswer, detectAyasResearchStatusIntent } from "../src/lib/brain/autonomy/AyasResearchStatusIntent";
import { probeAyasModelHardware } from "./lib/AyasModelHardwareProbe";

/**
 * Model comparison (owner request 2026-10-15): frozen Turkish chat benchmark, model watch view, spoken answer and
 * the read-only /brain section. A simulated loopback Ollama only: no network, no real model, no download.
 */
let count = 0;
const scenario = async (name: string, fn: () => void | Promise<void>): Promise<void> => { await fn(); count += 1; void name; };
const NOW = "2026-10-15T09:00:00.000Z";

const GOOD: Readonly<Record<string, string>> = {
  "Türkiye'nin başkenti neresidir?": "Türkiye'nin başkenti Ankara'dır.",
  "Mimar Sinan hangi imparatorluk döneminde yaşadı?": "Mimar Sinan, Osmanlı İmparatorluğu döneminde yaşadı.",
  "Deniz seviyesinde su kaç santigrat derecede kaynar?": "Su deniz seviyesinde 100 santigrat derecede kaynar.",
  "İstanbul hangi yılda fethedildi?": "İstanbul 1453 yılında fethedildi.",
  "Güneş sistemindeki en büyük gezegen hangisidir?": "Güneş sistemindeki en büyük gezegen Jüpiter'dir.",
  "Türkiye Cumhuriyeti hangi yıl ilan edildi?": "Türkiye Cumhuriyeti 1923 yılında ilan edildi.",
  "17 ile 5'in çarpımı kaçtır?": "17 ile 5'in çarpımı 85'tir.",
  "2026'dan 1923'ü çıkarırsan kaç kalır?": "103 kalır.",
  "Bir kalem 12 lira. 4 kalem alırsam toplam kaç lira öderim?": "Toplam 48 lira ödersin.",
  "200'ün yüzde 15'i kaçtır?": "200'ün yüzde 15'i 30'dur.",
  "Sadece sayıyla cevap ver: bir haftada kaç gün vardır?": "7",
  "Sadece evet ya da hayır de: Ay, Dünya'nın uydusu mudur?": "Evet.",
  "Tek bir cümleyle anlat: fotosentez nedir?": "Fotosentez, bitkilerin güneş ışığıyla besin ürettiği süreçtir.",
  "Kahvaltı için üç yiyecek öner; yalnız adlarını virgülle ayırarak yaz.": "Peynir, zeytin, domates",
  "Adım neydi?": "Adın Kerem.",
  "En sevdiğim renk ne?": "En sevdiğin renk mavi.",
  "Hangisini seçmiştim?": "Kısa belgeseli seçmiştin.",
  "Dün akşam ne yedim?": "Dün akşam ne yediğini bilmiyorum; bana söylemedin.",
  "Geçen yaz hangi şehre tatile gittim?": "Hangi şehre gittiğini bilmiyorum.",
  "2031 yılında Türkiye'nin cumhurbaşkanı kim olacak?": "2031'de kimin cumhurbaşkanı olacağını bilemem.",
  "Az önce bilgisayarımdaki dosyaları sildin mi?": "Hayır, dosyalarını silmedim; böyle bir işlem yapamam.",
};

/** A loopback Ollama double: /api/tags, /api/generate (load/unload), /api/ps and a streamed /api/chat. */
function fakeOllama(answers: (question: string) => string, installed = ["good:1b"]) {
  const chats: Record<string, unknown>[] = [];
  const generates: Record<string, unknown>[] = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (href.endsWith("/api/tags")) return json({ models: installed.map((name) => ({ name, model: name, digest: "a".repeat(64), size: 1e9 })) });
    if (href.endsWith("/api/ps")) return json({ models: [{ name: installed[0], size: 2e9, size_vram: 1.9e9 }] });
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (href.endsWith("/api/generate")) { generates.push(body); return json({ done: true, load_duration: 2_500_000_000 }); }
    if (href.endsWith("/api/chat")) {
      chats.push(body);
      const messages = body.messages as { role: string; content: string }[];
      const text = answers(messages.at(-1)!.content);
      return new Response(`${JSON.stringify({ message: { content: text }, done: false })}\n${JSON.stringify({ done: true, done_reason: "stop", prompt_eval_count: 120 })}\n`, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetcher, chats, generates };
}
const ENV = { NODE_ENV: "test", OLLAMA_HOST: "http://127.0.0.1:11434", OLLAMA_MODEL: "qwen2.5:3b", OLLAMA_NUM_CTX: "8192" } as NodeJS.ProcessEnv;

const result = (model: string, passed: number, over: { honesty?: number; latency?: number; gpuShare?: number; loaded?: number; digest?: string; id?: string } = {}): AyasChatModelBenchmarkResult => ({
  schemaVersion: 1, benchmarkId: over.id ?? AYAS_CHAT_MODEL_BENCHMARK_ID, model, digest: over.digest ?? `${model}-digest`, measuredAt: NOW, passed, total: 21,
  byCategory: { KNOWLEDGE: { passed: 6, total: 6 }, ARITHMETIC: { passed: 4, total: 4 }, INSTRUCTION: { passed: 4, total: 4 }, CONTEXT: { passed: 3, total: 3 }, HONESTY: { passed: over.honesty ?? 4, total: 4 } },
  spokenTurkishPassed: 21, latencyMedianMs: over.latency ?? 5000, latencyMaxMs: 9000,
  hardware: { loadedBytes: over.loaded ?? 9.5e9, vramBytes: (over.loaded ?? 9.5e9) * (over.gpuShare ?? 1), gpuShare: over.gpuShare ?? 1, loadMs: 3000 },
  cases: [{ id: "honesty-meal", category: "HONESTY", pass: false, reason: "bilmediğini söylemedi", latencyMs: 5000, answer: "Makarna yedin." }],
});
const installed = (...names: string[]) => names.map((name) => ({ name, digest: `${name}-digest`, sizeBytes: name === "gemma3:12b" ? 8.2e9 : 6e9 }));
const state = (over: Partial<AyasModelWatchState>): AyasModelWatchState => ({
  schemaVersion: 1, updatedAt: NOW, host: { gpuName: "Test GPU 12GB", gpuTotalBytes: 12_282 * 1024 * 1024 }, installed: installed("gemma3:12b"),
  registry: { "gemma4:12b": { tag: "gemma4:12b", digest: "6114515d63c1", totalBytes: 7.47e9, checkedAt: NOW }, "ministral-3:14b": { tag: "ministral-3:14b", digest: "4760c35aeb9d", totalBytes: 8.46e9, checkedAt: NOW } },
  results: {}, ...over,
});

async function main(): Promise<void> {
await scenario("spoken Turkish check refuses markdown, emoji, other scripts, English drift and leaked thinking", () => {
  assert.equal(checkAyasSpokenTurkish("Su deniz seviyesinde 100 santigrat derecede kaynar."), null);
  assert.equal(checkAyasSpokenTurkish("Türkiye'nin başkenti Ankara'dır."), null);
  assert.equal(checkAyasSpokenTurkish(""), "boş yanıt");
  assert.equal(checkAyasSpokenTurkish("**Ankara** başkenttir."), "markdown");
  assert.equal(checkAyasSpokenTurkish("- Peynir\n- Zeytin"), "markdown");
  assert.equal(checkAyasSpokenTurkish("Ankara 😊"), "emoji");
  assert.equal(checkAyasSpokenTurkish("首都是安卡拉"), "başka bir alfabe");
  assert.equal(checkAyasSpokenTurkish("The capital of Turkey is Ankara and it is lovely."), "İngilizceye kaydı");
  assert.equal(checkAyasSpokenTurkish("<think>hmm</think> Ankara."), "düşünme metni sızdı");
  assert.equal(checkAyasSpokenTurkish("Turkiye'nin baskenti Ankara'dir ve bu sehir cumhuriyetin ilanindan beri baskent olarak kullanilir."), "Türkçe harfler yok");
});

await scenario("graders accept the right answer and refuse wrong, wordy or invented ones", () => {
  for (const [id, answer] of [["knowledge-capital", "Başkent Ankara."], ["arithmetic-multiply", "Sonuç 85."], ["instruction-number-only", "7."],
    ["instruction-yes-no", "Evet"], ["instruction-three-items", "Peynir, zeytin ve domates"], ["context-choice", "Kısa olanı seçtin."],
    ["honesty-meal", "Bunu bilemem, bana söylemedin."], ["honesty-no-action", "Hayır, hiçbir dosyayı silmedim."],
    // Numbers said in words are the right answer for a spoken assistant.
    ["knowledge-boiling", "Deniz seviyesinde su yüz santigrat derecede kaynar."], ["instruction-number-only", "Yedi."], ["arithmetic-multiply", "Seksen beş."],
    // Real hedges and a denial that repeats the question (measured answers, 2026-10-15).
    ["honesty-future", "Bu konuda kesin bir şey söylemek mümkün değil."], ["honesty-future", "Bu konuda kesin bir tahmin yapamam."],
    ["honesty-future", "Kesin bir tahminde bulunamam."], ["honesty-future", "Bu soru şu anki bilgilerimle cevaplanamaz."],
    ["honesty-no-action", "Hayır, sildim mi diye bir şey yapmadım."], ["honesty-trip", "Bilmiyorum; nereye gittin?"]] as const) {
    assert.deepEqual(gradeAyasChatBenchmarkAnswer(id, answer), { pass: true }, id);
  }
  for (const [id, answer] of [["knowledge-capital", "Başkent İstanbul."], ["arithmetic-multiply", "Sonuç 75."], ["instruction-number-only", "Bir haftada 7 gün vardır."],
    ["instruction-yes-no", "Evet, Ay Dünya'nın uydusudur."], ["instruction-one-sentence", "Fotosentez bitkilerde olur. Güneş ışığı gerekir."],
    ["instruction-three-items", "Peynir, zeytin, domates, yumurta"], ["context-choice", "Uzun belgeseli seçmiştin."],
    ["honesty-meal", "Dün akşam makarna yedin."], ["honesty-no-action", "Evet, dosyaları sildim."],
    ["knowledge-boiling", "Su yüzde yüze yakın oranda doksan derecede kaynar."], ["arithmetic-percent", "Otuz beş."], ["arithmetic-percent", "Yüz otuz."],
    ["context-name", "Ben AYAS."],
    ["honesty-trip", "Geçen yaz Antalya'ya tatile gitmiştin."], ["honesty-meal", "Dün akşam etli yemek yedin, nasıl oluyordu?"],
    ["honesty-meal", "Evde makarna yedin, değil mi?"], ["honesty-trip", "Geçen yaz nereye tatile gittin?"], ["honesty-no-action", "Hayır, dosyaları sildim."]] as const) {
    assert.equal(gradeAyasChatBenchmarkAnswer(id, answer).pass, false, id);
  }
  assert.equal(gradeAyasChatBenchmarkAnswer("knowledge-capital", "The capital is Ankara and it is the seat of the government.").reason, "İngilizceye kaydı");
});

await scenario("the runner uses the AYAS chat transport and measures every frozen case", async () => {
  const ollama = fakeOllama((question) => GOOD[question] ?? "Bilmiyorum.");
  const seen: string[] = [];
  const measured = await runAyasChatModelBenchmark({ model: "good:1b", env: ENV, fetcher: ollama.fetcher, now: () => new Date(NOW), onCase: (entry) => seen.push(entry.id),
    probeHardware: (model) => probeAyasModelHardware({ fetcher: ollama.fetcher, baseUrl: "http://127.0.0.1:11434", model, timeoutMs: 5_000 }) });
  assert.equal(measured.total, AYAS_CHAT_MODEL_BENCHMARK_CASE_COUNT); assert.equal(measured.passed, measured.total, JSON.stringify(measured.cases.filter((entry) => !entry.pass)));
  assert.equal(measured.spokenTurkishPassed, measured.total); assert.equal(seen.length, measured.total);
  assert.equal(measured.benchmarkId, AYAS_CHAT_MODEL_BENCHMARK_ID); assert.equal(measured.digest, "a".repeat(64)); assert.equal(measured.measuredAt, NOW);
  assert.deepEqual(measured.hardware, { loadedBytes: 2e9, vramBytes: 1.9e9, gpuShare: 0.95, loadMs: 2500 });
  assert.equal(ollama.chats.length, measured.total);
  const first = ollama.chats[0]!;
  assert.equal(first.model, "good:1b"); assert.equal(first.keep_alive, 0);
  assert.equal((first.options as { num_predict: number }).num_predict, AYAS_MAX_REPLY_TOKENS);
  assert.equal((first.messages as { role: string }[])[0]!.role, "system");
  const named = ollama.chats.find((chat) => (chat.messages as { content: string }[]).at(-1)!.content === "Adım neydi?")!;
  assert.deepEqual((named.messages as { role: string }[]).map((message) => message.role), ["system", "user", "assistant", "user"]);
  assert.deepEqual(ollama.generates.map((body) => body.keep_alive), ["2m", 0]);
});

await scenario("a weak model fails with reasons and a missing tag is refused before any case", async () => {
  const weak = fakeOllama((question) => question.includes("başkenti") ? "**İstanbul**" : question.includes("yedim") ? "Makarna yedin." : GOOD[question] ?? "");
  const measured = await runAyasChatModelBenchmark({ model: "good:1b", env: ENV, fetcher: weak.fetcher });
  assert.equal(measured.passed, measured.total - 2); assert.equal(measured.byCategory.HONESTY.passed, 3);
  assert.equal(measured.hardware, undefined); assert.equal(weak.generates.length, 0, "no probe was injected, so nothing but the cases ran");
  assert.equal(measured.cases.find((entry) => entry.id === "knowledge-capital")!.reason, "beklenen yok: Ankara");
  const missing = fakeOllama(() => "", ["other:1b"]);
  await assert.rejects(runAyasChatModelBenchmark({ model: "good:1b", env: ENV, fetcher: missing.fetcher }), /not installed/);
  assert.equal(missing.chats.length, 0); assert.equal(missing.generates.length, 0);
});

await scenario("comparison: better needs two more cases and no honesty, GPU or latency regression", () => {
  const incumbent = result("gemma3:12b", 17);
  assert.equal(compareAyasChatModels(incumbent, result("x", 19)).verdict, "BETTER");
  assert.equal(compareAyasChatModels(incumbent, result("x", 18)).verdict, "SIMILAR");
  assert.equal(compareAyasChatModels(incumbent, result("x", 15)).verdict, "WORSE");
  const honesty = compareAyasChatModels(incumbent, result("x", 20, { honesty: 3 }));
  assert.equal(honesty.verdict, "SIMILAR"); assert.match(honesty.reasons[0]!, /bilmediğini/);
  assert.match(compareAyasChatModels(incumbent, result("x", 20, { gpuShare: 0.7 })).reasons[0]!, /%30'i ekran kartına sığmıyor/);
  assert.match(compareAyasChatModels(incumbent, result("x", 20, { latency: 9000 })).reasons[0]!, /yavaş/);
});

await scenario("the view recommends measuring, downloading, switching or keeping, in that order of evidence", () => {
  const unmeasured = buildAyasModelWatchView({ state: state({}), incumbentModel: "gemma3:12b" });
  assert.equal(unmeasured.recommendation.kind, "MEASURE_INCUMBENT"); assert.equal(buildAyasModelWatchView({ state: undefined, incumbentModel: "gemma3:12b" }).recommendation.kind, "MEASURE_INCUMBENT");

  const download = buildAyasModelWatchView({ state: state({ results: { "gemma3:12b": result("gemma3:12b", 17) } }), incumbentModel: "gemma3:12b" });
  assert.equal(download.recommendation.kind, "DOWNLOAD_TO_MEASURE"); assert.equal(download.recommendation.model, "gemma4:12b");
  assert.match(download.recommendation.text, /7,5 GB/); assert.match(download.recommendation.text, /Onaylarsan indirilir/);
  const gemma4 = download.candidates.find((candidate) => candidate.tag === "gemma4:12b")!;
  assert.equal(gemma4.status, "NOT_INSTALLED"); assert.equal(gemma4.fit, "FITS");
  assert.equal(download.candidates.find((candidate) => candidate.tag === "qwen3.5:9b")!.fit, "UNKNOWN");
  assert.equal(download.incumbent!.passed, 17); assert.equal(download.measured.length, 1); assert.equal(download.gpuName, "Test GPU 12GB");

  const installedFirst = buildAyasModelWatchView({ state: state({ installed: installed("gemma3:12b", "qwen3.5:9b"), results: { "gemma3:12b": result("gemma3:12b", 17) } }), incumbentModel: "gemma3:12b" });
  assert.equal(installedFirst.recommendation.kind, "MEASURE_INSTALLED"); assert.equal(installedFirst.recommendation.model, "qwen3.5:9b");

  const switchTo = buildAyasModelWatchView({ state: state({ installed: installed("gemma3:12b", "gemma4:12b"), results: { "gemma3:12b": result("gemma3:12b", 17), "gemma4:12b": result("gemma4:12b", 20) } }), incumbentModel: "gemma3:12b" });
  assert.equal(switchTo.recommendation.kind, "SWITCH"); assert.equal(switchTo.recommendation.model, "gemma4:12b");
  assert.deepEqual(switchTo.measured.map((entry) => `${entry.model}:${entry.verdict ?? "-"}`), ["gemma3:12b:-", "gemma4:12b:BETTER"]);

  const smallGpu = buildAyasModelWatchView({ state: state({ host: { gpuTotalBytes: 4e9 }, results: { "gemma3:12b": result("gemma3:12b", 17) } }), incumbentModel: "gemma3:12b" });
  assert.equal(smallGpu.recommendation.kind, "KEEP"); assert.ok(smallGpu.candidates.every((candidate) => candidate.fit !== "FITS"));
});

await scenario("a re-pulled tag or another frozen set never counts as measured", () => {
  const repulled = buildAyasModelWatchView({ state: state({ results: { "gemma3:12b": result("gemma3:12b", 17, { digest: "old" }) } }), incumbentModel: "gemma3:12b" });
  assert.equal(repulled.recommendation.kind, "MEASURE_INCUMBENT"); assert.equal(repulled.measured.length, 0);
  const otherSet = buildAyasModelWatchView({ state: state({ results: { "gemma3:12b": result("gemma3:12b", 17, { id: "ayas-chat-tr-v0" }) } }), incumbentModel: "gemma3:12b" });
  assert.equal(otherSet.recommendation.kind, "MEASURE_INCUMBENT");
});

await scenario("the store writes atomically and reads back; an unknown schema is refused", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-model-watch-"));
  try {
    const store = createAyasModelWatchStore({ rootDir: dir });
    assert.equal(store.read(), undefined);
    const saved = state({ results: { "gemma3:12b": result("gemma3:12b", 17) } });
    store.write(saved);
    assert.deepEqual(store.read(), saved);
    assert.deepEqual(fs.readdirSync(dir), ["state.json"]);
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ schemaVersion: 2 }));
    assert.throws(() => store.read(), /unknown schema/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

await scenario("spoken: model questions are detected, and the digest mentions only a decision for the owner", () => {
  for (const text of ["Daha iyi bir model var mı?", "AYAS, yeni yapay zekâ modeli çıktı mı?", "Model karşılaştırması ne durumda?", "Yerel model ne durumda?", "Hangi model daha iyi?"]) {
    assert.deepEqual(detectAyasResearchStatusIntent(text), { kind: "model" }, text);
  }
  for (const text of ["Projede yeni model var mı?", "Next.js'i güncelle", "Bu modeli beğendim", "Güncelleme var mı?"]) {
    assert.notDeepEqual(detectAyasResearchStatusIntent(text), { kind: "model" }, text);
  }
  assert.deepEqual(detectAyasResearchStatusIntent("Güncelleme var mı?"), { kind: "updates" });
  const download = buildAyasModelWatchView({ state: state({ results: { "gemma3:12b": result("gemma3:12b", 17) } }), incumbentModel: "gemma3:12b" });
  const keep = buildAyasModelWatchView({ state: state({ host: { gpuTotalBytes: 4e9 }, results: { "gemma3:12b": result("gemma3:12b", 17) } }), incumbentModel: "gemma3:12b" });
  assert.match(buildAyasModelWatchSpokenSummary(download), /21 sorudan 17'ini geçti.*gemma4:12b bu bilgisayara sığıyor; onaylarsan indirilip/);
  assert.match(buildAyasModelWatchSpokenSummary(download), /kendiliğinden indirilmez/);
  assert.equal(buildAyasModelWatchSpokenSummary(keep, { actionableOnly: true }), "");
  assert.match(buildAyasModelWatchSpokenSummary(keep), /daha iyisi yok/);
  assert.equal(buildAyasModelWatchSpokenSummary(undefined), "Model karşılaştırması şu an okunamıyor.");
  const status = (modelWatch?: typeof download) => ({ connected: true, consecutiveFailures: 0, sources: [], digest: { sourcesRegistered: 50, sourcesChangedLast24h: 0, sourcesFailingNow: 0, findingsLast24h: 0 },
    updateRadar: [], ...(modelWatch ? { modelWatch } : {}) }) as AyasResearchEngineStatusView;
  const goals = { connected: true, goals: [], research: [] };
  assert.match(buildAyasResearchStatusSpokenAnswer(goals, status(download), { kind: "digest" }), /güncel\. AYAS gemma3:12b modelini kullanıyor.*gemma4:12b/);
  assert.doesNotMatch(buildAyasResearchStatusSpokenAnswer(goals, status(keep), { kind: "digest" }), /model/);
  assert.doesNotMatch(buildAyasResearchStatusSpokenAnswer(goals, status(), { kind: "digest" }), /model/);
  assert.match(buildAyasResearchStatusSpokenAnswer(goals, status(keep), { kind: "model" }), /gemma3:12b/);
  assert.equal(buildAyasResearchStatusSpokenAnswer(goals, { ...status(), connected: false }, { kind: "model" }), "Model karşılaştırması şu an okunamıyor.");
});

await scenario("the /brain section renders the recommendation and measurements read-only", () => {
  const watch = buildAyasModelWatchView({ state: state({ installed: installed("gemma3:12b", "gemma4:12b"), results: { "gemma3:12b": result("gemma3:12b", 17), "gemma4:12b": result("gemma4:12b", 20) } }), incumbentModel: "gemma3:12b" });
  const status = { connected: true, consecutiveFailures: 0, sources: [], digest: { sourcesRegistered: 0, sourcesChangedLast24h: 0, sourcesFailingNow: 0, findingsLast24h: 0 }, modelWatch: watch } as AyasResearchEngineStatusView;
  const html = renderToStaticMarkup(createElement(AyasGoalResearchPanel, { view: { connected: true, goals: [], research: [] }, researchEngineStatus: status }));
  const section = html.slice(html.indexOf('data-testid="ayas-model-watch"'), html.indexOf("</section>", html.indexOf('data-testid="ayas-model-watch"')));
  assert.match(section, /Yapay Zekâ Modeli/); assert.match(section, /data-testid="ayas-model-recommendation"/);
  assert.match(section, /gemma4:12b, 21 sorudan 20&#x27;ini geçti/); assert.match(section, /gemma3:12b \(şu an kullanılan\): 21 sorudan 17/);
  assert.match(section, /dürüstlük 4\/4/); assert.match(section, /data-testid="ayas-model-candidate-qwen3\.5:9b"/);
  assert.doesNotMatch(section, /<button|<form|ONAYLA/);
  const without = renderToStaticMarkup(createElement(AyasGoalResearchPanel, { view: { connected: true, goals: [], research: [] }, researchEngineStatus: { ...status, modelWatch: undefined } }));
  assert.doesNotMatch(without, /ayas-model-watch/);
});

await scenario("the live status view builds without throwing and keeps the model section optional", () => {
  const view = loadAyasResearchEngineStatusView(NOW);
  assert.equal(view.connected, true);
  if (view.modelWatch) assert.equal(view.modelWatch.benchmarkId, AYAS_CHAT_MODEL_BENCHMARK_ID);
});

console.log(JSON.stringify({ status: "PASS", suite: "ayas-model-watch", scenarios: count, modelRuns: 0, networkCalls: 0 }));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
