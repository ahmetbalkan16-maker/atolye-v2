/**
 * V3 smoke: script engine and the $1-per-video budget. Fake providers only (no network, no spend).
 * Run: npx tsx scripts/smoke-v3-script.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AIProvider, AIProviderGenerateOptions, AIProviderResult } from "../src/lib/ai/providers/AIProvider";
import type { PackCatalogEntry } from "../src/lib/v3/costumes/CostumePackLoader";
import { applyParts, partOrders, partProblems } from "../src/lib/v3/costumes/PartDesigner";
import type { Episode } from "../src/lib/v3/episode/EpisodeTypes";
import { infoboxFacts, parseInfobox, wikitextToPlain } from "../src/lib/v3/research/Infobox";
import { articleExcerpt, articleSource, castCandidates, castExcerpt, copiesWikipedia, factPrompt, fetchInfoboxFacts, normalizeForMatch, readTopic, researchDepth, researchTopic, resolveTopic, sourceId, topicPhrase, topicPrompt, verifyFacts, webSkipReason, wikidataFacts, wikidataItemIds, wikidataSource, wikidataTime } from "../src/lib/v3/research/SourceResearch";
import { cleanUrl, htmlToText, privateAddress, readSearchAnswer, reputableScore, robotsAllows, safePageFetch, webQueries, webRefusal, webSearchCostUsd, webSourceId } from "../src/lib/v3/research/WebResearch";
import { applyFactCheck, callsByName, changesPerson, confirmSupport, COPY_RUN_WORDS, copiedFromSources, correctionSupported, dialogueSceneRatio, extractJson, FACT_CHECK_RETRY_MAX_TOKENS, knownNames, ScriptError, sceneShortfalls, unresolvedErrors, writeScript } from "../src/lib/v3/script/ScriptEngine";
import { bankFactLines, EVIDENCE_CHARS, factCheckPrompt, wordBudget, writingPrompt } from "../src/lib/v3/script/ScriptPrompts";
import { closingText, ensureClosingLine, mainCharacter } from "../src/lib/v3/script/ClosingLine";
import { chapterCount, isLongForm, prefixScenes, readOutline } from "../src/lib/v3/script/LongForm";
import { normalizeDraft } from "../src/lib/v3/script/DraftNormalizer";
import { sideColours, tooClose } from "../src/lib/v3/script/SideColours";
import { mapSpeakers } from "../src/lib/v3/maps/MapSpeakers";
import { clearBattleCards, fitBattleMap, resolveTactics, siegeOrder } from "../src/lib/v3/maps/Tactics";
import { aimPlanesAtShips, directBattleMaps, livenStillMaps, mapProblems, openOpeningMap, vehiclesOnToldLine } from "../src/lib/v3/script/MapRules";
import { STATE_COLOURS, TOLD_WORDS } from "../src/lib/v3/maps/MapBuilder";
import { addToldCrowds, crowdProblems, toldGroups } from "../src/lib/v3/script/CrowdRules";
import { addToldStrengths, namesSide, toldNumbers, toldStrengthCard } from "../src/lib/v3/script/ToldNumbers";
import { validateEpisode } from "../src/lib/v3/episode/EpisodeValidator";
import { cachedDiscountUsd, cachedTokensOf, fellBackChecks, V3Budget, V3BudgetError, videoCapUsd } from "../src/lib/v3/script/V3Budget";
import { OpenAITextProvider } from "../src/lib/v3/script/OpenAIText";
import { voxcpmLanguages } from "../src/lib/v3/tts/Voxcpm";
import { loadV3Settings, v3Secret } from "../src/lib/v3/V3Paths";
import { inventedPeople } from "../src/lib/v3/research/CastCheck";

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

class FakeProvider implements AIProvider {
  readonly calls: { prompt: string; options?: AIProviderGenerateOptions }[] = [];
  constructor(private readonly answers: string[], private readonly usage = { promptTokens: 1000, completionTokens: 500 }) {}
  async generate(prompt: string, options?: AIProviderGenerateOptions): Promise<AIProviderResult> {
    this.calls.push({ prompt, ...(options ? { options } : {}) });
    const content = this.answers.shift() ?? "";
    return { content, finishReason: "stop", refused: false, complete: true, truncated: false, usage: { ...this.usage, totalTokens: this.usage.promptTokens + this.usage.completionTokens } };
  }
}

const CATALOG: PackCatalogEntry[] = [{ pack: "ottoman-1453", title: "Osmanlı 1453", items: { head: ["padisah-kavugu"], beard: ["sakal-genc"], hand: ["kilic"] } }];

function episode(): Episode {
  const costume = { giysi: "kaftan" as const, renkler: { ana: "#b3263a", ikincil: "#e8b23a", ic: "#f3d27a", sus: "#e8b23a" }, bas: "padisah-kavugu", ayakkabi: "sari-mest" };
  return {
    id: "rumeli-hisari",
    baslik: "Boğazkesen",
    konu: "Rumeli Hisarı'nın inşası",
    donem: "1452",
    hedef_sure_sn: 30,
    ton: "mizahi",
    kaynaklar: [{ id: "avunduk-2008", kunye: "Avunduk, Rumelihisarı, TDVİA 35, 2008" }],
    oyuncu_kadrosu: [
      { id: "anlatici", ad: "Anlatıcı", rol: "anlatıcı", kostum_paketi: "", renk: "#333333", ses_id: "anlatici", konusma_tarzi: "sakin", gorunur: false },
      { id: "mehmed", ad: "II. Mehmed", rol: "padişah", kostum_paketi: "ottoman-1453", renk: "#b3263a", ses_id: "mehmed", konusma_tarzi: "kararlı", gorunur: true, kostum: costume },
      { id: "halil", ad: "Çandarlı Halil", rol: "vezir", kostum_paketi: "ottoman-1453", renk: "#2f6b3a", ses_id: "halil", konusma_tarzi: "temkinli", gorunur: true, kostum: { giysi: "cubbe", renkler: { ana: "#2f6b3a", ikincil: "#e8b23a", ic: "#f3d27a", sus: "#e8b23a" }, ayakkabi: "kahve-mest" } },
      { id: "zaganos", ad: "Zağanos Paşa", rol: "komutan", kostum_paketi: "ottoman-1453", renk: "#7a1f2b", ses_id: "zaganos", konusma_tarzi: "coşkulu", gorunur: true, kostum: { giysi: "zirh", renkler: { ana: "#7a1f2b", ikincil: "#3b2a22", ic: "#2f3a56", sus: "#e1ad3e" }, ayakkabi: "kahve-cizme" } },
    ],
    sahneler: [
      {
        id: "s1-kanca",
        sure_hedef: 12,
        mekan: "Boğaz kıyısı",
        arka_plan_sorgusu: { tr: "Rumeli Hisarı", en: "Rumeli Fortress" },
        ortam: { zaman: "gun", manzara: "sahil", uslup: "osmanli" },
        duygu: "merak",
        muzik_ruh_hali: "gizemli",
        satirlar: [
          { karakter: "anlatici", metin: "Bir kale dört ayda biter mi?", duygu: "notr", kaynak: ["avunduk-2008"] },
          { karakter: "anlatici", metin: "Hisar 1452 yazında tamamlandı.", duygu: "notr", kaynak: ["avunduk-2008"] },
        ],
      },
      {
        id: "s2-divan",
        sure_hedef: 18,
        mekan: "Edirne Sarayı",
        arka_plan_sorgusu: { tr: "Edirne Sarayı", en: "Edirne Palace" },
        ortam: { zaman: "gun", manzara: "saray_ici", uslup: "osmanli" },
        duygu: "komik",
        muzik_ruh_hali: "hafif",
        satirlar: [
          { karakter: "mehmed", metin: "Boğazı keseceğiz!", duygu: "kararli", jest: "isaret_et", kurgu: true },
          { karakter: "halil", metin: "Sultanım, Bizans buna kızar.", duygu: "korkmus", kurgu: true },
          { karakter: "anlatici", metin: "Kule ustaları kırk gün çalıştı.", duygu: "notr" },
        ],
      },
    ],
  };
}

const validJson = () => JSON.stringify(episode());

async function main() {
  await scenario("A a paid call inside the cap goes out and is booked at its reported usage", async () => {
    const openai = new FakeProvider(["merhaba"]);
    const budget = new V3Budget({ providers: { openai } });
    const { used } = await budget.generate("deneme", { provider: "openai", model: "gpt-4.1" }, "istem", { maxTokens: 2000 });
    assert.equal(used.provider, "openai");
    assert.equal(openai.calls.length, 1);
    assert.equal(openai.calls[0]!.options?.model, "gpt-4.1");
    // 1000 in × $2/M + 500 out × $8/M = $0.006
    assert.equal(budget.spentUsd, 0.006);
    assert.equal(budget.capUsd, 1);
  });

  await scenario("A2 the prompt head OpenAI read from its cache is booked at its own price (9 Nov 2026: more writing exams for the same $1)", async () => {
    const cachedReply = (cached: number) => ({ generate: async () => ({ content: "ok", finishReason: "stop" as const, refused: false, complete: true, truncated: false, usage: { promptTokens: 10_000, completionTokens: 500, totalTokens: 10_500, cachedPromptTokens: cached } }) });
    const budget = new V3Budget({ providers: { openai: cachedReply(8_000) } });
    await budget.generate("cirak-yaz", { provider: "openai", model: "gpt-4.1" }, "istem", { maxTokens: 2000 });
    // 2000 in × $2/M + 8000 cached × $0.50/M + 500 out × $8/M = $0.012 (full price would be $0.024).
    assert.equal(budget.spentUsd, 0.012);
    assert.equal(budget.ledger[0]!.cachedTokens, 8_000);
    // A model without a known cached price is booked at full price; more cached than sent is capped.
    const other = new V3Budget({ providers: { openai: cachedReply(50_000) } });
    await other.generate("x", { provider: "openai", model: "gpt-4.1" }, "istem", { maxTokens: 2000 });
    assert.equal(other.spentUsd, 0.009, "at most the whole prompt is cached");
    assert.equal(cachedDiscountUsd("openai", "gpt-unknown", 1_000_000), 0);
    assert.equal(cachedDiscountUsd("openai", "gpt-4.1-2025-04-14", 1_000_000), 1.5, "a dated snapshot priced as its model");
    // The provider that reports it reads OpenAI's own field.
    const keyBefore = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test";
    try {
      const fake = (async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "x" } }], usage: { prompt_tokens: 3000, completion_tokens: 10, total_tokens: 3010, prompt_tokens_details: { cached_tokens: 2048 } } }), { status: 200 })) as unknown as typeof fetch;
      const r = await new OpenAITextProvider(fake).generate("p", { model: "gpt-4.1", maxTokens: 20 });
      assert.deepEqual([r.content, cachedTokensOf(r), r.usage?.promptTokens], ["x", 2048, 3000]);
    } finally {
      if (keyBefore === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = keyBefore;
    }
  });

  await scenario("B a call that would cross the cap is never made: the free local model writes instead", async () => {
    const openai = new FakeProvider(["pahalı"]);
    const ollama = new FakeProvider(["yerel"]);
    const budget = new V3Budget({ capUsd: 0.01, providers: { openai, ollama }, fallback: { provider: "ollama" } });
    const { result, used } = await budget.generate("senaryo", { provider: "openai", model: "gpt-4.1" }, "istem", { maxTokens: 3000 });
    assert.equal(openai.calls.length, 0);
    assert.equal(used.provider, "ollama");
    assert.equal(result.content, "yerel");
    assert.equal(budget.ledger[0]!.fellBackFrom, "openai/gpt-4.1");
    assert.equal(budget.spentUsd, 0);
  });

  await scenario("B2 a fact check the cap sent to the free model is found in the ledger (13 Nov 2026 audit: fellBackFrom was read by nobody)", async () => {
    const budget = new V3Budget({ capUsd: 0.01, providers: { openai: new FakeProvider([]), ollama: new FakeProvider(["a", "b", "c", "d", "e"]) }, fallback: { provider: "ollama" } });
    for (const step of ["senaryo", "dogrulama", "dogrulama-3-tekrar", "dogrulama-rotus", "dogrulamax"]) await budget.generate(step, { provider: "openai", model: "gpt-4.1" }, "istem", { maxTokens: 3000 });
    const fell = fellBackChecks([...budget.ledger, { step: "dogrulama-2", provider: "openai", model: "gpt-4.1", ceilingUsd: 0.01, costUsd: 0.01, reason: "WITHIN_RESERVED_CAP" }]);
    assert.deepEqual(fell.gate.map((e) => e.step), ["dogrulama", "dogrulama-3-tekrar"], "the history gate's checks; a paid one and the script itself are not");
    assert.deepEqual(fell.other.map((e) => e.step), ["dogrulama-rotus"]);
    assert.deepEqual(fellBackChecks([{ step: "dogrulama" }, {}]).gate, [], "a ledger read from maliyet.json may hold anything");
    // Every paid step of the production adds to the video's maliyet.json, the script step and the chief included (the
    // script step's repair retries each got a fresh cap and wrote only their own spend).
    const producer = readFileSync(path.join(process.cwd(), "scripts", "atolye-v3.ts"), "utf8");
    const writes = [...producer.matchAll(/writeJson\(f\("maliyet\.json"\), \{([^\n]*)\}\)/g)].map((m) => m[1]!);
    assert.ok(writes.length >= 5, `${writes.length} maliyet.json writes`);
    for (const w of writes) assert.match(w, /toplamUsd: \w+\.toplamUsd \+ [\w.]+\.spentUsd, adimlar: \[\.\.\.\w+\.adimlar, /, w);
    assert.ok(!/scriptBudget\(paths, (capUsd|0\.05)\)/.test(producer), "no paid step starts from the whole cap");
  });

  await scenario("C without a fallback the over-cap call stops the run before spending", async () => {
    const openai = new FakeProvider(["pahalı"]);
    const budget = new V3Budget({ capUsd: 0.01, providers: { openai } });
    await assert.rejects(budget.generate("senaryo", { provider: "openai", model: "gpt-4.1" }, "istem", { maxTokens: 3000 }), (e: unknown) => e instanceof V3BudgetError && e.code === "V3_BUDGET_EXCEEDED");
    assert.equal(openai.calls.length, 0);
  });

  await scenario("D a model missing from the price table is never called", async () => {
    const openai = new FakeProvider(["?"]);
    const budget = new V3Budget({ providers: { openai } });
    await assert.rejects(budget.generate("senaryo", { provider: "openai", model: "gpt-9-turbo" }, "istem", { maxTokens: 100 }), (e: unknown) => e instanceof V3BudgetError && e.code === "V3_BUDGET_UNKNOWN_PRICE");
    assert.equal(openai.calls.length, 0);
  });

  await scenario("E JSON is found inside fences and chatter, braces inside strings do not confuse it", () => {
    assert.deepEqual(extractJson('İşte:\n```json\n{"a":"{x}","b":[1,{"c":2}]}\n```\nbitti'), { a: "{x}", b: [1, { c: 2 }] });
    assert.throws(() => extractJson('{"a": 1, "b": '), (e: unknown) => e instanceof ScriptError && e.code === "V3_SCRIPT_JSON_CUT");
    assert.throws(() => extractJson("yok"), (e: unknown) => e instanceof ScriptError && e.code === "V3_SCRIPT_NO_JSON");
  });

  await scenario("F write → repair → fact-check: a wrong line is corrected, a disputed one hedged, an unsupported one reported", async () => {
    const broken = JSON.parse(validJson());
    delete broken.sahneler[0].mekan;
    const check = JSON.stringify({
      iddialar: [
        { sahne: "s1-kanca", satir: 1, karar: "yanlis", gerekce: "yaz sonu", yeni_metin: "Hisar 1452 Ağustosunda tamamlandı.", dayanak: "Rumeli Hisarı Ağustos 1452'de tamamlandı" },
        { sahne: "s2-divan", satir: 2, karar: "tartismali", yeni_metin: "Rivayete göre kule ustaları kırk gün çalıştı." },
        { sahne: "s1-kanca", satir: 0, karar: "kaynaksiz", kaynak_onerisi: "Runciman 1965" },
        { sahne: "s9", satir: 0, karar: "yanlis", yeni_metin: "x" },
      ],
      genel_not: "kostümler uygun",
    });
    // A 14 s brief (a Short: its words aim at 85% of it) fits the fixture's 21 words, so no revision round runs here
    // (see L and M for those).
    const openai = new FakeProvider([JSON.stringify(broken), validJson(), check, JSON.stringify({ iliski: "celisir", neden: "x" })]);
    const budget = new V3Budget({ providers: { openai } });
    const out = await writeScript({ brief: { konu: "Rumeli Hisarı Ağustos 1452'de tamamlandı", donem: "1452", hedefSureSn: 14, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget });
    assert.equal(out.repairs, 1);
    assert.equal(out.lengthRounds, 0);
    assert.ok(openai.calls[1]!.prompt.includes("mekan"), "onarım istemi hatayı söylemeli");
    assert.equal(out.validation.ok, true);
    assert.equal(out.episode.sahneler[0]!.satirlar[1]!.metin, "Hisar 1452 Ağustosunda tamamlandı.");
    assert.equal(out.episode.sahneler[1]!.satirlar[2]!.rivayet, true);
    assert.equal(out.factCheck.uygulanan, 2);
    assert.deepEqual(out.factCheck.iddialar.map((c) => c.sonuc), ["duzeltildi", "rivayet_eklendi", "rapor", "bulunamadi"]);
    assert.equal(budget.ledger.map((e) => e.step).join(","), "senaryo,onarim-1,dogrulama,dogrulama-dayanak");
    assert.ok(budget.spentUsd > 0 && budget.spentUsd < 1);
  });

  await scenario("G an unreadable fact-check answer marks the episode unchecked instead of passing it", async () => {
    const openai = new FakeProvider([validJson(), "üzgünüm, yapamam", '{"iddialar": [{"sahne": "s1-kanca", "satir": 1, "kar']);
    const budget = new V3Budget({ providers: { openai } });
    const logged: string[] = [];
    const out = await writeScript({ brief: { konu: "x", donem: "1452", hedefSureSn: 14, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget, log: (s) => logged.push(s) });
    assert.equal(out.factCheck.durum, "okunamadi");
    assert.equal(out.validation.ok, true);
    // 13 Nov 2026 audit: an unreadable answer is asked once more, with room for a long script's claims.
    assert.equal(budget.ledger.map((e) => e.step).join(","), "senaryo,dogrulama,dogrulama-tekrar");
    assert.deepEqual(openai.calls.slice(1).map((c) => c.options?.maxTokens), [3_000, FACT_CHECK_RETRY_MAX_TOKENS]);
    assert.equal(openai.calls[2]!.prompt, openai.calls[1]!.prompt, "the same question, asked again");
    assert.ok(logged.some((l) => /tarih doğrulamasının yanıtı okunamadı/.test(l)));
    // The second look reads: the episode is checked after all.
    const again = new FakeProvider([validJson(), '{"iddialar": [{"sahne": "s1-kanca", "satir": 1, "kar', JSON.stringify({ iddialar: [] })]);
    const b2 = new V3Budget({ providers: { openai: again } });
    const ok = await writeScript({ brief: { konu: "x", donem: "1452", hedefSureSn: 14, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget: b2 });
    assert.equal(ok.factCheck.durum, "tamam");
    assert.equal(b2.ledger.map((e) => e.step).join(","), "senaryo,dogrulama,dogrulama-tekrar");
  });

  await scenario("G2 an unchecked script still has the order compared fact by fact (the history gate is not skipped)", async () => {
    const order = "Rumeli Hisarı (1452): II. Mehmed Boğazkesen'i dört ayda yaptırır; Çandarlı Halil Paşa savaşa karşı çıkar, Zağanos Paşa savaşı ister; hisar Ağustos 1452'de biter ve Bizans'ın Karadeniz yolu kesilir.";
    const swapped = JSON.parse(validJson());
    swapped.sahneler[0].satirlar[0].metin = "Zağanos Paşa hisarı dört ayda bitirir.";
    const fidelity = JSON.stringify({ olgular: [{ olgu: "II. Mehmed Boğazkesen'i dört ayda yaptırır", sahne: "s1-kanca", satir: 0, karar: "celisir", gerekce: "hisarı yaptıran Mehmed", yeni_metin: "Mehmed hisarı dört ayda bitirtir." }] });
    const openai = new FakeProvider([JSON.stringify(swapped), "???", "!!!", fidelity]);
    const budget = new V3Budget({ providers: { openai } });
    const out = await writeScript({ brief: { konu: order, donem: "1452", hedefSureSn: 14, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget });
    assert.equal(budget.ledger.map((e) => e.step).join(","), "senaryo,dogrulama,dogrulama-tekrar,dogrulama-siparis");
    assert.equal(out.factCheck.durum, "okunamadi", "still unchecked: QC raises it");
    assert.equal(out.episode.sahneler[0]!.satirlar[0]!.metin, "Mehmed hisarı dört ayda bitirtir.", "the order's deed back to Mehmed");
    assert.equal(out.factCheck.uygulanan, 1);
  });

  await scenario("H a correction too long for a line is reported, not written", () => {
    const res = applyFactCheck(episode(), [{ sahne: "s1-kanca", satir: 0, karar: "yanlis", yeni_metin: "a".repeat(300) }]);
    assert.equal(res.applied, 0);
    assert.equal(res.claims[0]!.sonuc, "gecersiz_metin");
  });

  // The history gate (owner, 9 Nov 2026, after the Cannae Short was stopped for swapped deeds: "evet durdur ve bu
  // durdurmayı sonraki videolar için sisteme ekle").
  const ORDER = "Rumeli Hisarı (1452): II. Mehmed Boğazkesen'i dört ayda yaptırır; Çandarlı Halil Paşa savaşa karşı çıkar, Zağanos Paşa savaşı ister; hisar Ağustos 1452'de biter ve Bizans'ın Karadeniz yolu kesilir.";
  const gateBrief = { konu: ORDER, donem: "1452", hedefSureSn: 14, ton: "mizahi" as const, dil: "tr" as const };
  const gateModels = { writer: { provider: "openai" as const, model: "gpt-4.1" }, checker: { provider: "openai" as const, model: "gpt-4.1" } };

  await scenario("H2 the order is compared fact by fact: a deed given back to its person is applied, a rewritten joke is not", async () => {
    const swapped = JSON.parse(validJson());
    swapped.sahneler[0].satirlar[0].metin = "Zağanos Paşa hisarı dört ayda bitirir.";
    const fidelity = JSON.stringify({ olgular: [
      { olgu: "II. Mehmed Boğazkesen'i dört ayda yaptırır", sahne: "s1-kanca", satir: 0, karar: "celisir", gerekce: "hisarı yaptıran Mehmed", yeni_metin: "Mehmed hisarı dört ayda bitirtir." },
      { olgu: "Çandarlı Halil Paşa savaşa karşı çıkar", sahne: "s2-divan", satir: 1, karar: "celisir", yeni_metin: "Sultanım, bu iş olmaz." },
      { olgu: "hisar Ağustos 1452'de biter", sahne: "s1-kanca", satir: 1, karar: "ayni" },
    ] });
    const openai = new FakeProvider([JSON.stringify(swapped), JSON.stringify({ iddialar: [] }), fidelity]);
    const budget = new V3Budget({ providers: { openai } });
    const out = await writeScript({ brief: gateBrief, catalog: CATALOG, ...gateModels, budget });
    assert.equal(out.episode.sahneler[0]!.satirlar[0]!.metin, "Mehmed hisarı dört ayda bitirtir.", "the deed back to Mehmed");
    assert.equal(out.episode.sahneler[1]!.satirlar[1]!.metin, "Sultanım, Bizans buna kızar.", "Halil's joke keeps its words");
    assert.equal(budget.ledger.map((e) => e.step).join(","), "senaryo,dogrulama,dogrulama-siparis");
    assert.deepEqual(out.factCheck.iddialar.map((c) => [c.denetim, c.sonuc]), [["siparis", "duzeltildi"]]);
    assert.ok(openai.calls[1]!.prompt.includes("THE OWNER'S ORDER") && openai.calls[1]!.prompt.includes(ORDER), "the fact check reads the order");
    assert.ok(openai.calls[2]!.prompt.includes('s2-divan #1 Çandarlı Halil [invented wording]: "Sultanım, Bizans buna kızar."'), openai.calls[2]!.prompt.slice(0, 600));
    // A bare topic has no facts to compare: no fidelity call.
    const bare = new FakeProvider([validJson(), JSON.stringify({ iddialar: [] })]);
    const b2 = new V3Budget({ providers: { openai: bare } });
    await writeScript({ brief: { ...gateBrief, konu: "Rumeli Hisarı" }, catalog: CATALOG, ...gateModels, budget: b2 });
    assert.equal(b2.ledger.map((e) => e.step).join(","), "senaryo,dogrulama");
    assert.equal(changesPerson("Maharbal's cavalry closes the rear.", "Hasdrubal's cavalry hits the Roman rear.", knownNames("Hasdrubal's cavalry hits the Roman rear; Maharbal speaks", [{ ad: "Maharbal" }])), true, "the Cannae swap");
    assert.equal(changesPerson("Now that's what I call a group hug.", "The trap's shut—no Roman's getting out now.", knownNames("Hasdrubal's cavalry hits the Roman rear", [{ ad: "Maharbal" }])), false, "a rewritten joke names no other person");
  });

  await scenario("H3 a character's invented line told wrong is never patched alone; a sourced line may go to the one history gives it to, the bubble following", () => {
    // Cannae (9 Nov 2026): one-line corrections of the Hannibal–Maharbal exchange made it worse in two runs of six.
    const kept = applyFactCheck(episode(), [{ sahne: "s2-divan", satir: 1, karar: "yanlis", yeni_metin: "Zağanos Paşa: Sultanım, hemen saldıralım!" }]);
    assert.equal(kept.claims[0]!.sonuc, "sahne");
    assert.equal(kept.episode.sahneler[1]!.satirlar[1]!.metin, "Sultanım, Bizans buna kızar.", "the exchange is left to a new draft");
    assert.deepEqual(unresolvedErrors(kept.claims).map((c) => c.sonuc), ["sahne"]);
    const sourced = () => {
      const ep = episode();
      for (const l of ep.sahneler[1]!.satirlar) delete (l as { kurgu?: boolean }).kurgu;
      return ep;
    };
    const ep = sourced();
    (ep.sahneler[1]!.satirlar[1] as { balon?: string }).balon = "Bizans kızar.";
    const res = applyFactCheck(ep, [{ sahne: "s2-divan", satir: 1, karar: "yanlis", yeni_metin: "Zağanos Paşa: \"Sultanım, hemen saldıralım!\"" }]);
    const line = res.episode.sahneler[1]!.satirlar[1]! as { karakter: string; metin: string; balon?: string };
    assert.deepEqual([line.karakter, line.metin, line.balon], ["zaganos", "Sultanım, hemen saldıralım!", "Sultanım, hemen saldıralım!"]);
    assert.equal(res.claims[0]!.karakter, "zaganos");
    const byId = applyFactCheck(sourced(), [{ sahne: "s2-divan", satir: 1, karar: "yanlis", karakter: "mehmed", yeni_metin: "Boğazı keseceğiz, Halil!" }]);
    assert.equal(byId.episode.sahneler[1]!.satirlar[1]!.karakter, "mehmed");
    assert.equal(validateEpisode(byId.episode).ok, true);
    // A correction calling its own speaker by name goes to the one its reason names (Cannae: "Hannibal, let's march
    // on Rome now!" had been written for Hannibal's own line).
    const self = applyFactCheck(sourced(), [{ sahne: "s2-divan", satir: 0, karar: "yanlis", gerekce: "boğazı kesmeyi Zağanos Paşa istedi, Mehmed değil", yeni_metin: "Mehmed, boğazı hemen keselim!" }]);
    assert.equal(self.episode.sahneler[1]!.satirlar[0]!.karakter, "zaganos");
    assert.equal(callsByName("So, Hannibal, let's march on Rome!", "Hannibal"), true);
    assert.equal(callsByName("Hannibal marches on Rome.", "Hannibal"), false, "a name in a sentence is not an address");
    assert.equal(callsByName("You know how to win, Varro.", "Gaius Terentius Varro"), true);
  });

  await scenario("H4 a wrong line the corrections cannot fix stops the script before any costume; a second look may fix it", async () => {
    // The order states the fact the corrections rest on (a correction without a `dayanak` is not applied, see H5).
    const told = "Rumeli Hisarı 1452 yazında dört ayda tamamlandı";
    const tooLong = JSON.stringify({ iddialar: [{ sahne: "s1-kanca", satir: 1, karar: "yanlis", gerekce: "hisar Ağustos'ta değil", yeni_metin: "a".repeat(300), dayanak: told }] });
    const contradicts = JSON.stringify({ iliski: "celisir", neden: "x" });
    const openai = new FakeProvider([validJson(), tooLong, contradicts, tooLong, contradicts]);
    const budget = new V3Budget({ providers: { openai } });
    await assert.rejects(writeScript({ brief: { ...gateBrief, konu: told }, catalog: CATALOG, ...gateModels, budget }), (e: unknown) => e instanceof ScriptError && e.code === "V3_SCRIPT_HISTORY" && /tarih hatası düzeltilemedi/.test(e.message) && /s1-kanca #1/.test(e.message) && e.reasons?.length === 1);
    assert.equal(budget.ledger.map((e) => e.step).join(","), "senaryo,dogrulama,dogrulama-dayanak,dogrulama-2,dogrulama-dayanak");
    const fixedSecond = JSON.stringify({ iddialar: [{ sahne: "s1-kanca", satir: 1, karar: "yanlis", yeni_metin: "Hisar 1452 yazında tamamlandı.", dayanak: `"${told}."` }] });
    const again = new FakeProvider([validJson(), tooLong, contradicts, fixedSecond, contradicts]);
    const out = await writeScript({ brief: { ...gateBrief, konu: told }, catalog: CATALOG, ...gateModels, budget: new V3Budget({ providers: { openai: again } }) });
    assert.equal(out.episode.sahneler[0]!.satirlar[1]!.metin, "Hisar 1452 yazında tamamlandı.");
    assert.deepEqual(out.factCheck.iddialar.map((c) => c.sonuc), ["rapor", "duzeltildi"]);
    // A character's line told wrong stops at once, with who said what, for the next draft's writer.
    const exchange = new FakeProvider([validJson(), JSON.stringify({ iddialar: [{ sahne: "s2-divan", satir: 1, karar: "yanlis", gerekce: "savaşa karşı çıkan Halil'di; burada savaşı istiyor" }] })]);
    const b3 = new V3Budget({ providers: { openai: exchange } });
    await assert.rejects(writeScript({ brief: { ...gateBrief, konu: "Rumeli Hisarı" }, catalog: CATALOG, ...gateModels, budget: b3 }), (e: unknown) => e instanceof ScriptError && e.code === "V3_SCRIPT_HISTORY" && e.reasons?.[0] === "s2-divan #1 (Çandarlı Halil: \"Sultanım, Bizans buna kızar.\"): savaşa karşı çıkan Halil'di; burada savaşı istiyor");
    assert.equal(b3.ledger.map((e) => e.step).join(","), "senaryo,dogrulama", "no second look patches an exchange");
    assert.deepEqual(unresolvedErrors([{ sahne: "s9", satir: 0, karar: "yanlis", sonuc: "bulunamadi" }]), [], "the checker's slip of index never stops a video");
  });

  await scenario("H5 a correction only from the checker's memory is not applied (Gallipoli, 10 Nov 2026: 'I order you to die' moved to August); one a verified fact backs is", async () => {
    const bank = { kaynaklar: [], olgular: [{ metin: "Rumeli Hisarı was completed in the summer of 1452, in four months.", kaynak: "wikipedia-rumelihisari" }], alintilar: [{ metin: "x", kaynak: "wikipedia-rumelihisari", alinti: "The fortress was completed on 31 August 1452." }] };
    const memory = { sahne: "s1-kanca", satir: 1, karar: "yanlis" as const, gerekce: "it was said later, in August", yeni_metin: "Later, in August, the hisar is done." };
    const original = episode().sahneler[0]!.satirlar[1]!.metin;
    const res = applyFactCheck(episode(), [memory], { support: { bank, order: "Rumeli Hisarı" } });
    assert.equal(res.applied, 0);
    assert.equal(res.claims[0]!.sonuc, "dayanaksiz");
    assert.equal(res.episode.sahneler[0]!.satirlar[1]!.metin, original, "the written line stays");
    assert.deepEqual(unresolvedErrors(res.claims), [], "an unsupported claim is reported, never a stop");
    // A dayanak that is not in the bank (the checker's own sentence) or is only a few words is not a support.
    assert.equal(applyFactCheck(episode(), [{ ...memory, dayanak: "The order was given in August 1915 at Chunuk Bair." }], { support: { bank } }).claims[0]!.sonuc, "dayanaksiz");
    assert.equal(applyFactCheck(episode(), [{ ...memory, dayanak: "in four months" }], { support: { bank } }).claims[0]!.sonuc, "dayanaksiz");
    // Copied from a fact (with the "[source-id]" it was shown), from a research quote, or from the order: applied.
    for (const dayanak of ["- [wikipedia-rumelihisari] Rumeli Hisarı was completed in the summer of 1452, in four months.", "completed on 31 August 1452", "“Rumeli Hisarı 1452 yazında dört ayda tamamlandı”"]) {
      const ok = applyFactCheck(episode(), [{ ...memory, dayanak }], { support: { bank, order: "Rumeli Hisarı 1452 yazında dört ayda tamamlandı. Kısa bir video." } });
      assert.equal(ok.claims[0]!.sonuc, "duzeltildi", dayanak);
      assert.equal(ok.episode.sahneler[0]!.satirlar[1]!.metin, memory.yeni_metin);
    }
    assert.equal(correctionSupported(undefined, { bank }), false);
    // Order-fidelity claims rest on the order itself; callers without support (old ones, the council) keep the old way.
    assert.equal(applyFactCheck(episode(), [{ ...memory, denetim: "siparis" }], { support: { bank } }).claims[0]!.sonuc, "duzeltildi");
    assert.equal(applyFactCheck(episode(), [memory]).claims[0]!.sonuc, "duzeltildi");
    // In the script step: the unsupported correction is kept out and the video goes on.
    const openai = new FakeProvider([validJson(), JSON.stringify({ iddialar: [memory] })]);
    const budget = new V3Budget({ providers: { openai } });
    const out = await writeScript({ brief: { ...gateBrief, konu: "Rumeli Hisarı" }, catalog: CATALOG, ...gateModels, budget });
    assert.equal(out.episode.sahneler[0]!.satirlar[1]!.metin, original);
    assert.deepEqual(out.factCheck.iddialar.map((c) => c.sonuc), ["dayanaksiz"]);
    assert.equal(budget.ledger.map((e) => e.step).join(","), "senaryo,dogrulama", "no second look for an unsupported claim");
    assert.ok(factCheckPrompt("{}", "en").includes('"dayanak"'));
    // A real fact that says nothing on the line (Zanzibar, measured 11 Nov 2026: "the Glasgow was sunk" given to erase
    // "it fires back") is asked once more; only "celisir" lets the rewrite in, an unreadable answer does not.
    const real = { ...memory, dayanak: "Rumeli Hisarı was completed in the summer of 1452, in four months." };
    const ask = (answer: string) => {
      const fake = new FakeProvider([answer]);
      return { fake, run: confirmSupport(episode(), [real, memory], { bank }, { budget: new V3Budget({ providers: { openai: fake } }), checker: gateModels.checker }) };
    };
    for (const [answer, iliski, sonuc] of [[JSON.stringify({ iliski: "sessiz", neden: "the fact does not say" }), "sessiz", "dayanaksiz"], ["???", "okunamadi", "dayanaksiz"], [JSON.stringify({ iliski: "celisir" }), "celisir", "duzeltildi"]] as const) {
      const { fake, run } = ask(answer);
      const confirmed = await run;
      assert.equal(fake.calls.length, 1, "only the claim with a real fact is asked");
      assert.ok(fake.calls[0]!.prompt.includes(original) && fake.calls[0]!.prompt.includes(real.dayanak));
      assert.equal(confirmed[0]!.dayanak_iliskisi, iliski);
      assert.equal(confirmed[1]!.dayanak_iliskisi, undefined);
      assert.equal(applyFactCheck(episode(), confirmed, { support: { bank } }).claims[0]!.sonuc, sonuc);
    }
  });

  await scenario("I prompts carry the contract's values, the catalog and the language's own rules", () => {
    const tr = writingPrompt({ konu: "Fetih", donem: "1453", hedefSureSn: 90, ton: "mizahi", dil: "tr" }, CATALOG);
    for (const needle of ["yumruk_kaldir", "murekkep", "top_atisi", "paket ottoman-1453", "padisah-kavugu", "rivayete göre", `${wordBudget({ konu: "", donem: "", hedefSureSn: 90, ton: "mizahi", dil: "tr" })} konuşulan kelime`]) {
      assert.ok(tr.includes(needle), `tr istemde yok: ${needle}`);
    }
    const en = writingPrompt({ konu: "Fall of Rome", donem: "476", hedefSureSn: 240, ton: "epik", dil: "en" }, CATALOG);
    assert.ok(en.includes("American English") && en.includes("legend has it") && !en.includes("ANLATIM KURALLARI"));
    // The close battle's drawing is only as good as the writer's data (owner, 12 Nov 2026: "başka haritalarda konularda
    // yapabilsinler"): real kinds (only archers and guns shoot), each side's men in "etiket", the field's woods and
    // river, and a line after the losses.
    for (const needle of ["no other kind shoots", "number of\n    men in \"etiket\"", "\"arazi\"\n    woods, fields and hills", "never the losses on a scene's last line"]) assert.ok(en.includes(needle), `battle drawing rule missing: ${needle}`);
    assert.ok(factCheckPrompt("{}", "en").includes("legend has it"));
    // A Short (60 s or less, owner 2 Nov 2026): hook in 2 s, one moment, no subscribe line, a loop; longer has none of it.
    const short = writingPrompt({ konu: "Kosovo", donem: "1389", hedefSureSn: 60, ton: "mizahi", dil: "en" }, CATALOG);
    assert.ok(short.includes("YOUTUBE SHORT") && short.includes("within 2 seconds") && short.includes("ONE moment") && short.includes("MAIN CHARACTER") && short.includes("Crowns & Doodles") && short.includes(`about ${wordBudget({ konu: "", donem: "", hedefSureSn: 60, ton: "mizahi", dil: "en" })} spoken words`), short.slice(0, 400));
    assert.ok(writingPrompt({ konu: "Kosova", donem: "1389", hedefSureSn: 45, ton: "mizahi", dil: "tr" }, CATALOG).includes("YOUTUBE SHORTS"));
    // A Short's shares (owner, 3 Nov 2026, after DFT Tarih's Shorts): ~70% on the map, the hook and the payoff on stage.
    assert.ok(short.includes("SHARES OF A SHORT") && short.includes("about 70% of the running time on the map") && short.includes("3–5 scenes") && short.includes("as their\n  badges"), short.slice(0, 400));
    assert.ok(writingPrompt({ konu: "Kosova", donem: "1389", hedefSureSn: 45, ton: "mizahi", dil: "tr" }, CATALOG).includes("SHORT PAYLARI"));
    assert.ok(!en.includes("SHARES OF A SHORT"));
    assert.ok(!en.includes("YOUTUBE SHORT"), "a 4-minute video is a normal one");
    // Owner, 11 Nov 2026: a Short runs up to 3 minutes; its scene count grows with the length, still one event.
    const long = writingPrompt({ konu: "Taranto", donem: "1940", hedefSureSn: 180, ton: "epik", dil: "en" }, CATALOG);
    assert.ok(long.includes("YOUTUBE SHORT") && long.includes("7–12 scenes") && long.includes("3–5 visible characters") && long.includes("still one event") && !long.includes("3–5 scenes"), long.slice(0, 400));
    assert.ok(!short.includes("still one event") && short.includes("3 visible characters"));
    // Owner, 11 Nov 2026: real period pictures in the Shorts, as in the Gallipoli video — every map scene marks its line.
    assert.ok(long.includes("REAL PERIOD PICTURES") && long.includes("EVERY map scene marks one NARRATOR line") && !en.includes("REAL PERIOD PICTURES"), long.slice(0, 300));
    assert.ok(writingPrompt({ konu: "Taranto", donem: "1940", hedefSureSn: 180, ton: "mizahi", dil: "tr" }, CATALOG).includes("GERÇEK DÖNEM GÖRSELLERİ"));
  });

  await scenario("J the OpenAI key is borrowed from the named env file for this process only, and nothing else is", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "v3-secret-"));
    const file = path.join(dir, "main.env");
    writeFileSync(file, "OPENAI_API_KEY=sk-test-123\nOTHER_SECRET=nope\n");
    assert.equal(v3Secret("OPENAI_API_KEY", dir, { ATOLYE_V3_SECRETS_ENV: file }), "sk-test-123");
    assert.equal(v3Secret("OPENAI_API_KEY", dir, { ATOLYE_V3_SECRETS_ENV: file, OPENAI_API_KEY: "sk-env" }), "sk-env");
    assert.throws(() => v3Secret("OTHER_SECRET", dir, { ATOLYE_V3_SECRETS_ENV: file }), /V3_SECRET_NOT_ALLOWED/);
    assert.equal(v3Secret("OPENAI_API_KEY", dir, {}), undefined);
  });

  await scenario("J2 the switches of .env.v3.local reach the run; a variable already set wins and nothing else is copied", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "v3-settings-"));
    writeFileSync(path.join(dir, ".env.v3.local"), "# yorum\nATOLYE_V3_TTS_EN=voxcpm\nATOLYE_V3_MUSIC_COMPOSER=0\nOPENAI_API_KEY=sk-nope\nPATH=x\n");
    const env: Record<string, string | undefined> = { ATOLYE_V3_MUSIC_COMPOSER: "1" };
    assert.deepEqual(loadV3Settings(dir, env), ["ATOLYE_V3_TTS_EN"]);
    assert.equal(env.ATOLYE_V3_TTS_EN, "voxcpm");
    assert.equal(env.ATOLYE_V3_MUSIC_COMPOSER, "1");
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.PATH, undefined);
    assert.deepEqual([...voxcpmLanguages(env)], ["en"]);
    assert.deepEqual(loadV3Settings(path.join(dir, "yok"), {}), []);
  });

  await scenario("K with a source bank an invented book is sent back, and cited sources carry the bank's exact text", async () => {
    const bank = { kaynaklar: [{ id: "avunduk-2008", kunye: "Uğur Avunduk, \"Rumelihisarı\", TDVİA 35, 2008, s. 237–240" }], olgular: [{ metin: "İnşa 1452 Martında başladı.", kaynak: "avunduk-2008" }] };
    const invented = JSON.parse(validJson());
    invented.kaynaklar = [{ id: "uydurma-1992", kunye: "Bilinmeyen Yazar, Hayali Tarih, 1992" }];
    for (const s of invented.sahneler) for (const l of s.satirlar) if (l.kaynak) l.kaynak = ["uydurma-1992"];
    const okNoFact = JSON.stringify({ iddialar: [] });
    const openai = new FakeProvider([JSON.stringify(invented), validJson(), okNoFact]);
    const out = await writeScript({ brief: { konu: "x", donem: "1452", hedefSureSn: 14, ton: "mizahi", dil: "tr", kaynakBankasi: bank }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget: new V3Budget({ providers: { openai } }) });
    assert.equal(out.repairs, 1);
    assert.ok(openai.calls[0]!.prompt.includes("SOURCE BANK") && openai.calls[0]!.prompt.includes("[avunduk-2008] İnşa 1452 Martında başladı."));
    assert.ok(openai.calls[1]!.prompt.includes("uydurma-1992"), "onarım istemi banka dışı kaynağı söylemeli");
    assert.equal(out.episode.kaynaklar[0]!.kunye, bank.kaynaklar[0]!.kunye);
    // The editor gets the bank as ground truth, so a verified fact is never "corrected".
    assert.ok(openai.calls[2]!.prompt.includes("VERIFIED FACTS") && openai.calls[2]!.prompt.includes("[avunduk-2008] İnşa 1452 Martında başladı."));
  });

  await scenario("M a script with too little dialogue is asked for more exchanges in its revision round", async () => {
    const monologue = JSON.parse(validJson());
    monologue.sahneler[1].satirlar = monologue.sahneler[1].satirlar.filter((l: { karakter: string }) => l.karakter !== "halil");
    const openai = new FakeProvider([JSON.stringify(monologue), JSON.stringify(monologue), JSON.stringify({ iddialar: [] })]);
    // Under half a minute: a Short asked no map shares, so the dialogue's revision round is the first call after writing.
    await writeScript({ brief: { konu: "x", donem: "1452", hedefSureSn: 25, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget: new V3Budget({ providers: { openai } }) });
    assert.ok(openai.calls[1]!.prompt.includes("only 0% of scenes have dialogue (a map scene"), "diyalog eksikliği istenmeli (Short: harita sahnesinde rozet satırı sayılır)");
  });

  await scenario("L a script far below its spoken-word budget gets one expansion round", async () => {
    const longer = JSON.parse(validJson());
    for (let i = 0; i < 6; i++) longer.sahneler[1].satirlar.push({ karakter: "halil", metin: "Sultanım, bu iş hiç de kolay olmayacak gibi görünüyor.", duygu: "korkmus", kurgu: true });
    const openai = new FakeProvider([validJson(), JSON.stringify(longer), JSON.stringify({ iddialar: [] })]);
    // No repair rounds here: the fixture has no map, and the Short's map share (asked in those rounds) is not this test's.
    const out = await writeScript({ brief: { konu: "x", donem: "1452", hedefSureSn: 50, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget: new V3Budget({ providers: { openai } }), maxRepairs: 0 });
    assert.equal(out.lengthRounds, 1);
    // A 50 s Short: its words aim at 92% of the ceiling (50 × 0.92 × 1.8 ≈ 83; 85% until 13 Nov 2026).
    assert.ok(openai.calls[1]!.prompt.startsWith("The JSON episode below has 21 spoken words; the target is about 83. Expand"));
    assert.equal(out.spokenWords, 21 + 6 * 9);
    assert.equal(out.targetWords, 83);
    // A longer version that loses what the map rules won is not taken (they are not asked again after these rounds).
    const lostMap = JSON.parse(JSON.stringify(longer));
    lostMap.sahneler[1].mekan = "Map of the Bosphorus";
    const again = new FakeProvider([validJson(), JSON.stringify(lostMap), JSON.stringify({ iddialar: [] })]);
    const logs: string[] = [];
    const kept = await writeScript({ brief: { konu: "x", donem: "1452", hedefSureSn: 50, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget: new V3Budget({ providers: { openai: again } }), log: (m) => logs.push(m), maxRepairs: 0 });
    assert.equal(kept.spokenWords, 21, "the shorter script with its map kept");
    assert.ok(logs.some((m) => m.includes("uzunluk turu 1 harita sorunlarını artırdı (1 → 2)")), logs.join("\n"));
  });

  await scenario("P a group the narrator tells is seen as a crowd: asked in the repair round, added as a last resort", async () => {
    const narrators = new Set(["anlatici"]);
    const line = (metin: string) => ({ satirlar: [{ karakter: "anlatici", metin, duygu: "notr" as const }] });
    // A Short tells its one moment: every group the narrator names; a long episode only a group that acts.
    assert.deepEqual(toldGroups(line("Once freed, Caesar came back with troops. He captured the pirates."), narrators).map((g) => [g.stem, g.soldiers, g.first]), [["troop", true, true], ["pirate", false, true]]);
    assert.deepEqual(toldGroups(line("The Senate orders Caesar to disband his army and come home."), narrators, true), [], "an army far away is not on this stage");
    assert.deepEqual(toldGroups(line("The janissaries stormed the walls."), narrators, true).map((g) => g.stem), ["janissar"]);
    assert.deepEqual(toldGroups(line("Askerler kaleye saldırdı, korsanları da yakaladılar."), narrators, true).map((g) => g.stem), ["asker", "korsan"], "the caught pirates are there too");
    assert.deepEqual(toldGroups(line("The army, the soldiers and the troops: one group."), narrators).map((g) => g.stem), ["army"]);
    assert.deepEqual(toldGroups({ satirlar: [{ karakter: "mehmed", metin: "My soldiers!", duygu: "notr" }] }, narrators), [], "only the narrator's telling counts");
    const ep = episode();
    const told = { ...ep, hedef_sure_sn: 20, sahneler: ep.sahneler.map((s, i) => (i === 1 ? { ...s, satirlar: [{ karakter: "anlatici", metin: "Mehmed came back with his soldiers. He captured the pirates.", duygu: "notr" as const }, ...s.satirlar] } : s)) };
    assert.match(crowdProblems(told, true)[0]!, /^scene "s2-divan" tells of "soldiers" and "pirates" but shows no crowd of them/);
    assert.deepEqual(crowdProblems({ ...told, sahneler: told.sahneler.map((s, i) => (i === 1 ? { ...s, kalabalik: [{ ad: "Ottoman soldiers", kostum_paketi: "ottoman-1453", kostum: ep.oyuncu_kadrosu[3]!.kostum!, sayi: 6, duzen: "ordu" as const }, { ad: "Pirates", kostum_paketi: "ottoman-1453", kostum: ep.oyuncu_kadrosu[3]!.kostum!, sayi: 4, duzen: "sira" as const }] } : s)) }, true), [], "a crowd of each group: nothing to ask");
    // The last resort: soldiers dressed like the armoured cast member, moving with the line; no one to dress the pirates.
    const fixed = addToldCrowds(told, true);
    const crowd = fixed.episode.sahneler[1]!.kalabalik!;
    assert.deepEqual(crowd.map((c) => [c.ad, c.sayi, c.duzen, c.kostum.giysi, c.hareket?.tur]), [["Soldiers", 5, "ordu", "zirh", "yuru"]]);
    assert.ok(fixed.fixes.some((x) => x.includes('"pirates" anlatılıyor ama kalabalığı giydirecek oyuncu yok')), fixed.fixes.join("\n"));
    assert.equal(validateEpisode(fixed.episode).ok, true);
    // No soldier in the cast: the commander's men, their helmet ordered for the period.
    const noArmour = { ...told, oyuncu_kadrosu: told.oyuncu_kadrosu.filter((c) => c.id !== "zaganos") };
    const men = addToldCrowds(noArmour, true).episode.sahneler[1]!.kalabalik![0]!;
    assert.deepEqual([men.kostum.giysi, men.kostum.bas, men.kostum.renkler.ana], ["zirh", "yeni:helmet of II. Mehmed's soldiers (1452)", "#b3263a"]);
    // Through the writer: the repair round asks for the crowd; a round that breaks the script is dropped, the crowd added.
    const openai = new FakeProvider([JSON.stringify(told), "", JSON.stringify({ iddialar: [] })]);
    const logs: string[] = [];
    const out = await writeScript({ brief: { konu: "x", donem: "1452", hedefSureSn: 20, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget: new V3Budget({ providers: { openai } }), log: (m) => logs.push(m) });
    assert.ok(openai.calls[1]!.prompt.includes("CROWDS") && openai.calls[1]!.prompt.includes('"soldiers"'), "the repair round asks for the crowd");
    assert.equal(out.episode.sahneler[1]!.kalabalik?.[0]?.ad, "Soldiers");
    assert.ok(logs.some((m) => m.includes("kalabalık eklendi")), logs.join("\n"));
  });

  await scenario("P3 armies the narrator counts off the map get their card (the Cannae Short, 9 Nov 2026: numbers over standing puppets)", async () => {
    const cannae = "On August 2nd, 216 BC, Rome fields its biggest army ever—eighty-six thousand men. Hannibal? Only fifty thousand.";
    assert.deepEqual(toldNumbers(cannae.split(/(?<=[.!?;])\s+/)[0]!).map((n) => [n.value, n.after]), [[86_000, "men"]], "2nd and 216 are no armies");
    assert.deepEqual(toldNumbers("In 3000 BC 8000 men built it."), [{ value: 8000, index: 11, end: 15, after: "men built it" }], "an era is no army; 8000 is past any year");
    assert.deepEqual(toldNumbers("Fifty thousand Romans fall.").map((n) => [n.value, n.after]), [[50_000, "Romans fall"]]);
    assert.deepEqual(toldNumbers("In 1389 Murad led 30,000 men and a thousand archers.").map((n) => n.value), [30_000, 1_000], "a year is not counted");
    assert.deepEqual(toldNumbers("Two hundred and fifty thousand soldiers, 2.5 million people.").map((n) => n.value), [250_000, 2_500_000]);
    assert.deepEqual(toldNumbers("He marched 1,200 miles, paid 10,000 talents and lost 5,000 ships."), [], "distances, money and fleets are no armies");
    assert.deepEqual(toldNumbers("Mehmed geldi; seksen altı bin asker, on bin süvari.", "tr").map((n) => n.value), [86_000, 10_000]);
    assert.deepEqual(toldNumbers("On the hill stood the army.", "en"), [], "'on' is a number only in Turkish");
    assert.equal(namesSide("Rome", "Romans"), true);
    assert.equal(namesSide("Carthage", "Carthaginians"), true);
    assert.equal(namesSide("army", "Armenians"), false, "a common word names no side");
    assert.equal(namesSide("Then", "Thebans"), false);
    const sides = [{ ad: "Romans", renk: "#d9d9d9", sayi: "", leaders: [] }, { ad: "Carthaginians", renk: "#4b5320", sayi: "", leaders: ["Hannibal"] }] as const;
    assert.deepEqual(toldStrengthCard(cannae, 1, sides), { tur: "guc", satir: 1, taraflar: [{ ad: "Romans", renk: "#d9d9d9", sayi: "86,000" }, { ad: "Carthaginians", renk: "#4b5320", sayi: "50,000" }] });
    assert.deepEqual(toldStrengthCard("Hannibal brings 50,000 men. The consuls? 86,000.", 0, sides)!.taraflar!.map((t) => [t.ad, t.sayi]), [["Carthaginians", "50,000"], ["Romans", "86,000"]], "a leader points at his side");
    assert.deepEqual(toldStrengthCard("Rome fields 86,000 men and loses 50,000 of them.", 0, sides), { tur: "sayac", satir: 0, deger: 86_000, etiket: "men" }, "one army counted twice is no two sides");
    assert.deepEqual(toldStrengthCard("Fifty thousand Romans fall. Rome's worst defeat.", 0, sides), { tur: "sayac", satir: 0, deger: 50_000, etiket: "Romans fall" });
    assert.equal(toldStrengthCard("They marched 300 miles in ten days.", 0, sides), undefined);
    // The last resort, on an episode shaped like the Short: its map's strength bar gives the sides.
    const ep = episode();
    const map = { merkez: [16.2, 41.3] as [number, number], genislik_km: 900, guc: [{ satir: 0, taraflar: [{ ad: "Romans", renk: "#d9d9d9", sayi: "86,000" }, { ad: "Carthaginians", renk: "#4b5320", sayi: "50,000" }] as const }] };
    const shaped: Episode = {
      ...ep,
      sahneler: [
        { ...ep.sahneler[0]!, satirlar: [ep.sahneler[0]!.satirlar[0]!, { karakter: "anlatici", metin: cannae, duygu: "notr" }] },
        { ...ep.sahneler[1]!, harita: map, satirlar: [{ karakter: "anlatici", metin: "Varro packs 86,000 men deep.", duygu: "notr" }] },
        { ...ep.sahneler[1]!, id: "s3-sonra", satirlar: [{ karakter: "anlatici", metin: "Fifty thousand Romans fall. Rome's worst defeat.", duygu: "uzgun" }, { karakter: "mehmed", metin: "Not yet. 10,000 more!", duygu: "kararli" }] },
      ],
    };
    assert.equal(validateEpisode(shaped).ok, true, JSON.stringify(validateEpisode(shaped).errors.slice(0, 2)));
    const counted = addToldStrengths(shaped);
    assert.deepEqual(counted.episode.sahneler.map((s) => s.bilgi_kartlari?.map((c) => [c.tur, c.satir])), [[["guc", 1]], undefined, [["sayac", 0]]], "the map scene keeps its own bar; a character's line is not the narrator's");
    assert.equal(validateEpisode(counted.episode).ok, true);
    assert.ok(counted.fixes.some((f) => f.includes("güç kartı eklendi (Romans 86,000 / Carthaginians 50,000, satır 1)")) && counted.fixes.some((f) => f.includes("sayaç kartı eklendi (50,000 Romans fall")), counted.fixes.join("\n"));
    assert.equal(addToldStrengths(counted.episode).fixes.length, 0, "a scene with a card is left alone: a second pass changes nothing");
    const writerCard = { ...shaped, sahneler: shaped.sahneler.map((s, i) => (i === 0 ? { ...s, bilgi_kartlari: [{ tur: "sayac" as const, satir: 1, deger: 86_000, etiket: "Romans" }] } : s)) };
    assert.equal(addToldStrengths(writerCard).episode.sahneler[0]!.bilgi_kartlari!.length, 1, "the writer's own card stays the only one");
    // The writer is asked for it first.
    assert.match(writingPrompt({ konu: "Cannae", donem: "216 BC", hedefSureSn: 60, ton: "mizahi", dil: "en" }, CATALOG), /"tur": "guc", "satir": 1, "taraflar": \[\{"ad": "Romans"[\s\S]*both sides' numbers/);
  });

  await scenario("N2 a long video is researched deeper: more articles, three times the facts, the whole story in order", () => {
    assert.deepEqual(researchDepth(180), { articles: 4, search: 6, facts: "25–45", maxTokens: 9_000, long: false, mainChars: 40_000, otherChars: 14_000, cast: 6, castChars: 5_000, castFacts: "1–3", castTokens: 2_500, webQueries: 3, webPages: 4, webChars: 8_000, webFacts: "2–5", webPerPage: 6, webTokens: 3_500 });
    assert.deepEqual(researchDepth(1200), { articles: 6, search: 8, facts: "40–90", maxTokens: 12_000, long: true, mainChars: 40_000, otherChars: 20_000, cast: 8, castChars: 8_000, castFacts: "2–4", castTokens: 4_500, webQueries: 4, webPages: 6, webChars: 10_000, webFacts: "3–6", webPerPage: 8, webTokens: 6_000 });
    const article = { title: "Fall of Constantinople", revid: 1, timestamp: "2026-01-01T00:00:00Z", text: "The city fell on 29 May 1453." };
    const long = factPrompt("Fall of Constantinople", "1453", [article], "en", 1200);
    assert.ok(long.includes("long documentary (20 minutes") && long.includes("list 40–90 atomic facts") && long.includes("Cover the WHOLE story in depth"));
    const short = factPrompt("Fall of Constantinople", "1453", [article], "en", 60);
    assert.ok(short.includes("short documentary") && short.includes("list 25–45") && !short.includes("Cover the WHOLE story"));
    assert.match(short, /evidence for checking only — "metin" says the fact in your own words/, "the quote is evidence, the fact is told anew");
    // A 3-minute Short's worst case stays well under a tenth of its $1 (gpt-4.1-mini, V3Budget's chars × 1.4 / 4 rule).
    const ceiling = (chars: number, out: number) => ((chars * 1.4) / 4) * 0.4e-6 + out * 1.6e-6;
    const d = researchDepth(180);
    const usd = ceiling(2_000 + d.mainChars + (d.articles - 1) * d.otherChars, d.maxTokens) + ceiling(1_500 + d.cast * d.castChars, d.castTokens);
    assert.ok(usd < 0.04, `Short research ceiling $${usd.toFixed(4)}`);
  });

  await scenario("N3 an article is read whole up to its limit, without the reference tail, and a long one keeps its aftermath", () => {
    const para = (s: string, n: number) => Array.from({ length: n }, (_, i) => `${s} paragraph ${i} tells what happened on the night of 13 November 1942 near Savo Island.`).join("\n");
    const text = [`The Naval Battle of Guadalcanal was fought from 12 to 15 November 1942.\n${para("Lead", 3)}`, `Background\n\n${para("Background", 60)}`, `Battle\n\n${para("Battle", 120)}`, `Aftermath\n\n${para("Aftermath", 20)}`, "See also\n\nIron Bottom Sound", "References\n\nFrank, Richard (1990). Guadalcanal."].join("\n\n\n");
    const whole = articleExcerpt(text, 100_000);
    assert.ok(whole.includes("Aftermath paragraph 19") && !whole.includes("Frank, Richard") && !whole.includes("See also"), "the whole body, no reference tail");
    const cut = articleExcerpt(text, 9_000);
    assert.ok(cut.length <= 9_000, `${cut.length}`);
    assert.ok(cut.startsWith("The Naval Battle of Guadalcanal was fought") && cut.includes("\n\n\nAftermath\n") && cut.includes("Aftermath paragraph 0") && cut.includes("Background paragraph 0"), "lead, the start, and how it ended");
    assert.ok(!cut.includes("Battle paragraph 119"), "the middle gives way");
  });

  await scenario("N4 the cast: the people and ships the main article names most are read where they mention the topic", () => {
    const main = { title: "Naval Battle of Guadalcanal", revid: 10, timestamp: "2026-11-01T00:00:00Z", text: "The battle saw Rear Admiral Daniel J. Callaghan and Vice Admiral Hiroaki Abe clash; Hiei was crippled.\n\n\nBattle\n\nCallaghan died on the bridge. Abe withdrew. Hiei sank. Callaghan was hit. Willis A. Lee led South Dakota and Washington; Lee sank Kirishima. Washington fired. The United States Navy and Japan fought in World War II. Guadalcanal campaign. Iron Bottom Sound took the wrecks; Iron Bottom Sound grew. A Rear Admiral fell too. ISBN (identifier) ISBN" };
    const links = ["Daniel J. Callaghan", "Hiroaki Abe", "Japanese battleship Hiei", "Willis A. Lee", "USS Washington (BB-56)", "United States Navy", "Japan", "World War II", "Guadalcanal campaign", "Guadalcanal", "Iron Bottom Sound", "Battle of Savo Island", "Naval Battle of Guadalcanal", "1942", "Pacific War", "Rear Admiral", "ISBN (identifier)"];
    const picked = castCandidates(main, links, [main.title], 6);
    assert.deepEqual(picked.slice(0, 3), ["Daniel J. Callaghan", "Hiroaki Abe", "Japanese battleship Hiei"], "named in the lead and most often");
    assert.ok(picked.includes("Willis A. Lee") && picked.includes("USS Washington (BB-56)") && picked.includes("Iron Bottom Sound"), picked.join(" | "));
    for (const generic of ["United States Navy", "Japan", "World War II", "Guadalcanal campaign", "Guadalcanal", "Battle of Savo Island", "1942", "Pacific War", "Naval Battle of Guadalcanal", "Rear Admiral", "ISBN (identifier)"]) assert.ok(!picked.includes(generic), generic);
    assert.equal(topicPhrase("Naval Battle of Guadalcanal"), "Guadalcanal");
    assert.equal(topicPhrase("Attack on Pearl Harbor"), "Pearl Harbor");
    assert.equal(topicPhrase("Crossing the Rubicon"), "Rubicon");
    assert.equal(topicPhrase("Anglo-Zanzibar War"), "Anglo-Zanzibar");
    const callaghan = { title: "Daniel J. Callaghan", revid: 11, timestamp: "2026-10-01T00:00:00Z", text: "Daniel Judson Callaghan (July 26, 1890 – November 13, 1942) was an officer of the United States Navy.\n\n\nEarly life\n\nHe was born in San Francisco and studied at the Naval Academy, where he rowed and sailed every summer.\n\n\nWorld War II\n\nHe was killed in action on the bridge of San Francisco during the Naval Battle of Guadalcanal on 13 November 1942, and was awarded the Medal of Honor." };
    const ex = castExcerpt(callaghan, "Guadalcanal", 5_000)!;
    assert.ok(ex.startsWith("Daniel Judson Callaghan") && ex.includes("killed in action on the bridge") && !ex.includes("rowed and sailed"), ex);
    assert.equal(castExcerpt({ ...callaghan, title: "Japan", text: "Japan is an island country in East Asia.\n\n\nHistory\n\nIts history is long and has many periods across the centuries of its islands." } as typeof callaghan, "Guadalcanal", 5_000), undefined, "an article that never mentions the topic is not part of it");
  });

  await scenario("N5 Wikidata (CC0): dates to their precision, the place, counts and participants, cited by item and revision", () => {
    const time = (t: string, precision: number, rank = "normal") => ({ rank, mainsnak: { snaktype: "value", datavalue: { type: "time", value: { time: t, precision, calendarmodel: "http://www.wikidata.org/entity/Q1985727" } } } });
    const item = (id: string) => ({ rank: "normal", mainsnak: { snaktype: "value", datavalue: { type: "wikibase-entityid", value: { id } } } });
    const entity = {
      id: "Q1065588",
      lastrevid: 2_300_000_001,
      modified: "2026-09-01T10:00:00Z",
      labels: { en: { value: "Naval Battle of Guadalcanal" } },
      claims: {
        P580: [time("+1942-11-12T00:00:00Z", 11), time("+1942-11-01T00:00:00Z", 11, "deprecated")],
        P582: [time("+1942-11-15T00:00:00Z", 11)],
        P625: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { type: "globecoordinate", value: { latitude: -9.25, longitude: 159.75 } } } }],
        P361: [item("Q1052327")],
        P710: [item("Q11220"), item("Q188842"), item("Q999")],
        P1120: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { type: "quantity", value: { amount: "+1732", unit: "1" } } }, qualifiers: { P642: [{ snaktype: "value", datavalue: { type: "wikibase-entityid", value: { id: "Q11220" } } }] } }],
      },
    };
    assert.deepEqual(wikidataItemIds(entity), ["Q1052327", "Q11220", "Q188842", "Q999"]);
    const labels = new Map([["Q1052327", "Guadalcanal campaign"], ["Q11220", "United States Navy"], ["Q188842", "Imperial Japanese Navy"]]);
    const facts = wikidataFacts(entity, labels, "en");
    assert.deepEqual(facts.map((f) => f.metin), [
      "Naval Battle of Guadalcanal began on 12 November 1942.",
      "Naval Battle of Guadalcanal ended on 15 November 1942.",
      "Naval Battle of Guadalcanal is placed at 9.25° S, 159.75° E.",
      "Naval Battle of Guadalcanal was part of Guadalcanal campaign.",
      "Participants in Naval Battle of Guadalcanal included United States Navy, Imperial Japanese Navy.",
      "Naval Battle of Guadalcanal: 1,732 (of United States Navy) deaths.",
    ], "the deprecated start date and the unlabelled participant are left out");
    assert.ok(facts.every((f) => f.kaynak === "wikidata-q1065588" && f.alinti.startsWith("Q1065588 P") && f.alinti.length >= 20));
    assert.equal(wikidataFacts(entity, labels, "tr")[0]!.metin, "Naval Battle of Guadalcanal 12 Kasım 1942 tarihinde başladı.");
    assert.deepEqual(wikidataSource(entity), { id: "wikidata-q1065588", kunye: 'Wikidata, Q1065588 "Naval Battle of Guadalcanal" (revision 2300000001, 2026-09-01; CC0)', url: "https://www.wikidata.org/w/index.php?title=Q1065588&oldid=2300000001" });
    assert.equal(wikidataTime({ time: "-0049-01-10T00:00:00Z", precision: 9, calendarmodel: "http://www.wikidata.org/entity/Q1985786" }, "en"), "49 BC (Julian calendar)");
    assert.equal(wikidataTime({ time: "+1942-11-00T00:00:00Z", precision: 10 }, "tr"), "Kasım 1942");
    assert.equal(wikidataTime({ time: "+1900-00-00T00:00:00Z", precision: 7 }, "en"), undefined, "a century is no date");
  });

  await scenario("N6 research reads the main article, the cast and Wikidata; a fact still needs its quote; Wikidata offline is skipped", async () => {
    const mainText = [
      "The Naval Battle of Guadalcanal took place from 12 to 15 November 1942. Rear Admiral Daniel J. Callaghan led the American cruisers against Vice Admiral Hiroaki Abe, whose battleship Hiei was crippled.",
      `Battle\n\nCallaghan was killed on the bridge of San Francisco. Abe withdrew his force. Hiei sank on 14 November. Callaghan's ships fought at close range. On the night of 14 November Rear Admiral Willis A. Lee sank Kirishima. Lee commanded Washington. ${"Iron Bottom Sound filled with wrecks of many ships. ".repeat(40)}`,
      "Aftermath\n\nThe Japanese never again tried to bring battleships into the waters off Guadalcanal.",
      "References\n\nHammel, Eric (1988).",
    ].join("\n\n\n");
    const pages: Record<string, { text: string; revid: number; links?: string[]; qid?: string }> = {
      "Naval Battle of Guadalcanal": { text: mainText, revid: 100, links: ["Daniel J. Callaghan", "Hiroaki Abe", "Willis A. Lee", "World War II", "Japan"], qid: "Q1065588" },
      "Guadalcanal campaign": { text: `The Guadalcanal campaign was fought from August 1942 to February 1943 in the Solomon Islands. ${"It was a long campaign. ".repeat(40)}`, revid: 101 },
      "Daniel J. Callaghan": { text: "Daniel Judson Callaghan (1890 – 13 November 1942) was a rear admiral of the United States Navy.\n\n\nWorld War II\n\nCallaghan was killed in action aboard San Francisco during the Naval Battle of Guadalcanal and received the Medal of Honor posthumously.", revid: 102 },
      "Hiroaki Abe": { text: "Hiroaki Abe (1889 – 1949) was an admiral in the Imperial Japanese Navy.\n\n\nCareer\n\nAt the Naval Battle of Guadalcanal his force lost the battleship Hiei, and he was relieved of his command and forced to retire.", revid: 103 },
      "Willis A. Lee": { text: "Willis Augustus Lee Jr. (1888 – 1945) was a vice admiral of the United States Navy and an Olympic shooter.\n\n\nCareer\n\nHe commanded the shooting team at the 1920 Olympics, where he won five gold medals in a single meet.", revid: 104 },
    };
    const urls: string[] = [];
    let wikidataUp = true;
    const fetchJson = async (url: string): Promise<unknown> => {
      urls.push(url);
      const q = new URL(url).searchParams;
      if (url.startsWith("https://www.wikidata.org/")) {
        if (!wikidataUp) throw new Error("fetch failed");
        if (q.get("props") === "labels") return { entities: { Q1052327: { id: "Q1052327", labels: { en: { value: "Guadalcanal campaign" } } } } };
        return { entities: { Q1065588: { id: "Q1065588", lastrevid: 7, modified: "2026-09-01T00:00:00Z", labels: { en: { value: "Naval Battle of Guadalcanal" } }, claims: { P580: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { type: "time", value: { time: "+1942-11-12T00:00:00Z", precision: 11 } } } }], P361: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { type: "wikibase-entityid", value: { id: "Q1052327" } } } }] } } } };
      }
      if (q.get("list") === "search") return { query: { search: [{ title: "Naval Battle of Guadalcanal" }, { title: "Guadalcanal campaign" }] } };
      const page = pages[q.get("titles") ?? ""];
      if (!page) return { query: { pages: { "-1": { title: q.get("titles"), missing: "" } } } };
      if (q.get("prop") === "links") return { query: { pages: { "1": { title: q.get("titles"), links: (page.links ?? []).map((title) => ({ ns: 0, title })) } } } };
      if (q.get("prop") === "pageprops") return { query: { pages: { "1": { title: q.get("titles"), ...(page.qid ? { pageprops: { wikibase_item: page.qid } } : {}) } } } };
      return { query: { pages: { "1": { title: q.get("titles"), extract: page.text, revisions: [{ revid: page.revid, timestamp: "2026-11-01T00:00:00Z" }] } } } };
    };
    const id = sourceId;
    const mainAnswer = JSON.stringify({ olgular: [
      { metin: "The battle lasted from 12 to 15 November 1942.", kaynak: id("Naval Battle of Guadalcanal"), alinti: "The Naval Battle of Guadalcanal took place from 12 to 15 November 1942." },
      { metin: "Callaghan died on his flagship's bridge.", kaynak: id("Naval Battle of Guadalcanal"), alinti: "Callaghan was killed on the bridge of San Francisco." },
      { metin: "Lee's force sank Kirishima.", kaynak: id("Naval Battle of Guadalcanal"), alinti: "On the night of 14 November Rear Admiral Willis A. Lee sank Kirishima." },
      { metin: "Japan never again sent battleships there.", kaynak: id("Naval Battle of Guadalcanal"), alinti: "The Japanese never again tried to bring battleships into the waters off Guadalcanal." },
      { metin: "The campaign ran until February 1943.", kaynak: id("Guadalcanal campaign"), alinti: "The Guadalcanal campaign was fought from August 1942 to February 1943" },
      { metin: "Invented: Abe had four battleships.", kaynak: id("Naval Battle of Guadalcanal"), alinti: "Abe led four battleships into Iron Bottom Sound." },
    ] });
    const castAnswer = JSON.stringify({ olgular: [
      { metin: "Callaghan received the Medal of Honor after his death.", kaynak: id("Daniel J. Callaghan"), alinti: "received the Medal of Honor posthumously" },
      { metin: "Abe was relieved of his command after losing Hiei.", kaynak: id("Hiroaki Abe"), alinti: "he was relieved of his command and forced to retire" },
    ] });
    const openai = new FakeProvider([mainAnswer, castAnswer, mainAnswer, castAnswer], { promptTokens: 20_000, completionTokens: 4_000 });
    const budget = new V3Budget({ providers: { openai } });
    const logs: string[] = [];
    const out = await researchTopic({ cacheDir: os.tmpdir(), konu: "Naval Battle of Guadalcanal", donem: "1942", dil: "en", budget, model: { provider: "openai", model: "gpt-4.1-mini" }, seconds: 180, fetchJson, web: false, log: (s) => logs.push(s) });
    assert.deepEqual(budget.ledger.map((e) => e.step), ["arastirma", "arastirma-kadro"]);
    const castPrompt = openai.calls[1]!.prompt;
    assert.ok(castPrompt.includes('title="Daniel J. Callaghan"') && castPrompt.includes('title="Hiroaki Abe"') && !castPrompt.includes("Olympic shooter"), "Lee's article never mentions the battle, so it is not read for the cast");
    assert.ok(!openai.calls[0]!.prompt.includes("Hammel, Eric"), "no reference tail in the read");
    assert.deepEqual(out.bank.olgular.map((o) => o.kaynak), [
      "wikipedia-naval-battle-of-guadalcanal", "wikipedia-naval-battle-of-guadalcanal", "wikipedia-naval-battle-of-guadalcanal", "wikipedia-naval-battle-of-guadalcanal", "wikipedia-guadalcanal-campaign",
      "wikidata-q1065588", "wikidata-q1065588", "wikipedia-daniel-j-callaghan", "wikipedia-hiroaki-abe",
    ]);
    assert.equal(out.bank.reddedilen, 1, "the invented quote is still thrown out");
    assert.deepEqual(out.bank.kaynaklar.map((k) => k.id), ["wikipedia-naval-battle-of-guadalcanal", "wikipedia-guadalcanal-campaign", "wikipedia-daniel-j-callaghan", "wikipedia-hiroaki-abe", "wikidata-q1065588"]);
    assert.ok(out.bank.kaynaklar.find((k) => k.id === "wikidata-q1065588")!.kunye.includes("CC0"));
    assert.equal(out.bank.alintilar.length, out.bank.olgular.length, "every fact keeps its evidence");
    assert.ok(logs.some((l) => l.includes("kadro makaleleri \"Daniel J. Callaghan\" (rev 102)")) && logs.some((l) => l.includes("ana makaleler 5, kadro 2) + Wikidata 2")), logs.join("\n"));
    assert.ok(urls.every((u) => u.startsWith("https://en.wikipedia.org/w/api.php?") || u.startsWith("https://www.wikidata.org/w/api.php?")));
    // Offline Wikidata and a broken link list: a line in the log, the research goes on.
    wikidataUp = false;
    const offline = await researchTopic({ cacheDir: os.tmpdir(), konu: "Naval Battle of Guadalcanal", donem: "1942", dil: "en", budget, model: { provider: "openai", model: "gpt-4.1-mini" }, seconds: 180, web: false, fetchJson: async (u) => { if (new URL(u).searchParams.get("prop") === "links") throw new Error("COMMONS_HTTP_503"); return fetchJson(u); }, log: (s) => logs.push(s) });
    assert.ok(logs.some((l) => l.startsWith("araştırma: Wikidata okunamadı (fetch failed)")) && logs.some((l) => l.startsWith("araştırma: kadro makaleleri okunamadı (COMMONS_HTTP_503)")), logs.slice(-4).join("\n"));
    assert.equal(offline.bank.olgular.length, 5);
    assert.ok(!offline.bank.kaynaklar.some((k) => k.id.startsWith("wikidata-")));
  });

  await scenario("N6b the battle infobox (Siege of Baghdad 1638, owner 13 Nov 2026: the defenders' strength was missing): strength, losses, commanders per side, each quoting its field; no box, a malformed or a person's box give nothing", async () => {
    const wikitext = `{{Short description|Part of the Ottoman–Safavid War (1623–1639)}}
{{Infobox military conflict
| conflict          = Siege of Baghdad
| part_of           = the [[Ottoman–Safavid War (1623–1639)]]
| image             = Verovering van Bagdad door de Turken, 1638.jpg
| caption           = ''Conquest of Baghdad by the Ottoman in 1638'', by [[Caspar Luyken]], 1896.
| date              = 15 November – 25 December 1638
| location          = [[Baghdad]]
| coordinates       = {{coord|display=inline,title}}
| territory         = The [[Ottoman Empire|Ottomans]] re-capture Baghdad and re-establish [[Ottoman Iraq]]
| result            = Ottoman victory
| combatant1        = {{flagicon image|Safavid Flag.svg}} [[Safavid Iran|Safavid Empire]]
| combatant2        = {{Flagicon image|Flag of Ottoman Empire (1517-1793).svg}} [[Ottoman Empire]]
| commander1        = {{flagicon image|Safavid Flag.svg}} [[Bektash Mirimanidze|Bektash Khan Gorji]]{{pow}}<ref name="pows">{{Cite book |last=X |title=Y |pages=165}}</ref><br>{{flagicon image|Safavid Flag.svg}} Saru Khan{{KIA}}
| commander2        = {{Flagicon image|Flag of Ottoman Empire (1517-1793).svg}} [[Murad IV|Sultan Murad IV]]<br/> [[Tayyar Mehmed Pasha|Grand Vizier Tayyar Mehmed Pasha]]{{KIA}}
| units1            =
| strength1         = 40,000 infantry<br>211 fortified city towers<ref name="Islamic">{{cite book|last=Mikaberidze|title=Conflict and Conquest in the Islamic World|page=177}}</ref><br>100 cannons
| strength2         = 108,589 (35,000 infantry and 73,589 cavalry)
* 88,000 engaged<br>200 cannons<ref name="Islamic"/>
| casualties1       = 20,000+ Massacred<ref name="pows"></ref>
| casualties2       = Heavy
| casualties3       = Most of the city residents were massacred by the Ottomans after the capture<ref name="Islamic"/>
| campaignbox       = {{Campaignbox Ottoman–Safavid War (1623–39)}}
}}
The '''siege of Baghdad''' ({{Langx|fa|محاصره بغداد}}) in the winter of 1638 marked the re-establishment of [[Ottoman Iraq|Ottoman control over Iraq]].`;
    const box = parseInfobox(wikitext)!;
    assert.equal(box.kind, "Infobox military conflict");
    const field = (n: string) => box.fields.find((f) => f.name === n)?.value;
    assert.equal(field("strength1"), "40,000 infantry; 211 fortified city towers; 100 cannons", "the defenders' garrison, footnote out");
    assert.equal(field("strength2"), "108,589 (35,000 infantry and 73,589 cavalry); 88,000 engaged; 200 cannons");
    assert.equal(field("casualties1"), "20,000+ Massacred");
    assert.equal(field("commander1"), "Bektash Khan Gorji (prisoner of war); Saru Khan (killed in action)", "links to their label, flags gone, fates said");
    assert.equal(field("location"), "Baghdad");
    assert.ok(!box.fields.some((f) => /image|caption|campaignbox|coordinates|units1|part_of/.test(f.name)), "only the fields that matter for the story");
    const { facts, text } = infoboxFacts("Siege of Baghdad (1638)", box, sourceId("Siege of Baghdad (1638)"), "en");
    const strength1 = facts.find((f) => f.alinti.includes("strength1"))!;
    assert.equal(strength1.metin, "Strength of the Safavid Empire side in the Siege of Baghdad (1638): 40,000 infantry; 211 fortified city towers; 100 cannons.");
    assert.equal(strength1.alinti, 'Wikipedia infobox of "Siege of Baghdad (1638)", strength1 (Safavid Empire): 40,000 infantry; 211 fortified city towers; 100 cannons', "the quote is the field's own text, marked as the infobox's");
    assert.ok(facts.some((f) => f.metin === "Casualties and losses of the Safavid Empire side in the Siege of Baghdad (1638): 20,000+ Massacred."));
    assert.ok(facts.every((f) => f.alinti.length <= 300 && text.includes(f.alinti) && f.kaynak === "wikipedia-siege-of-baghdad-1638"));
    assert.deepEqual(facts.slice(0, 4).map((f) => f.alinti.split(", ")[1]!.split(/[ :]/)[0]), ["strength1", "strength2", "casualties1", "casualties2"], "numbers first");
    // Through the fetch, pinned to the revision read; a quote is still checked like any other.
    const urls: string[] = [];
    const answer = { query: { pages: [{ title: "Siege of Baghdad (1638)", revisions: [{ revid: 1378917458, slots: { main: { content: wikitext } } }] }] } };
    const article = { title: "Siege of Baghdad (1638)", revid: 1378917458, timestamp: "2026-11-13T00:00:00Z", text: "The siege of Baghdad in the winter of 1638 marked the re-establishment of Ottoman control over Iraq." };
    const fetched = await fetchInfoboxFacts(async (u) => (urls.push(u), answer), article, "tr");
    assert.equal(fetched.length, facts.length);
    assert.ok(fetched.some((f) => f.metin === "Siege of Baghdad (1638) — Safavid Empire tarafının gücü: 40,000 infantry; 211 fortified city towers; 100 cannons."));
    const q = new URL(urls[0]!).searchParams;
    assert.ok(q.get("revids") === "1378917458" && q.get("rvsection") === "0" && q.get("prop") === "revisions" && urls[0]!.startsWith("https://en.wikipedia.org/w/api.php?"));
    assert.deepEqual(await fetchInfoboxFacts(async () => ({ query: { pages: [{ revisions: [{ revid: 999, slots: { main: { content: wikitext } } }] }] } }), article, "en"), [], "another revision's wikitext is not this article's");
    assert.equal((await fetchInfoboxFacts(async () => answer, article, "en", 3)).length, 3, "bounded");
    // Nothing: no infobox, a person's infobox, an unclosed one, an empty one, an old cache's or an odd answer.
    assert.equal(parseInfobox("The siege of Baghdad in 1638 ended Safavid rule."), undefined);
    assert.equal(parseInfobox("{{Infobox officeholder\n| name = Murad IV\n| strength1 = 1\n}}"), undefined, "not a battle's box");
    assert.equal(parseInfobox("{{Infobox military conflict\n| strength1 = 40,000 infantry {{pow\n| result = Ottoman victory\n"), undefined, "malformed: never closed");
    assert.equal(parseInfobox("{{Infobox military conflict\n| image = x.jpg\n| strength1 = <ref>only a note</ref>\n}}"), undefined, "no field with text");
    for (const odd of [{ query: { pages: { "1": { title: "Siege of Baghdad (1638)", extract: "plain text", revisions: [{ revid: 1378917458, timestamp: "2026-11-13T00:00:00Z" }] } } } }, {}, null, "html", { query: { pages: [{ revisions: [{ revid: 1378917458, slots: { main: { content: 42 } } }] }] } }]) {
      assert.deepEqual(await fetchInfoboxFacts(async () => odd, article, "en"), [], JSON.stringify(odd));
    }
    // Bounded in size: a huge field is cut at a list item, a huge wikitext is not walked past its limit.
    const huge = parseInfobox(`{{Infobox battle\n| strength1 = ${Array.from({ length: 400 }, (_, i) => `${i + 1},000 men of unit ${i}`).join("<br>")}\n}}`)!;
    assert.ok(huge.fields[0]!.value.length <= 220 && /men of unit \d+$/.test(huge.fields[0]!.value), huge.fields[0]!.value);
    assert.equal(wikitextToPlain("{{ubl|[[Ottoman Empire]]|{{flagicon|Iran}} [[Safavid Iran|Safavids]]}}"), "Ottoman Empire; Safavids");
    // Waterloo's box (13 Nov 2026): block templates and <hr> keep numbers apart, an approximate count and a flag-labelled count are said.
    assert.equal(wikitextToPlain("{{tree list}}\n* '''Total''': 118,000\n** 7,500 gunners{{sfn|Bodart|1908|p=487}}{{tree list/end}}{{Ubl|{{*}}282{{ndash}}288 guns{{#tag:ref|Bodart's older estimate.{{sfn|Bodart|1908}}|group=nb}}}}<hr />Wellington's army: {{approximately|68,000}} soldiers\n** {{flagicon|Nassau}} 3,000"), "Total: 118,000; 7,500 gunners; 282 – 288 guns; Wellington's army: c. 68,000 soldiers; Nassau 3,000");
    assert.equal(wikitextToPlain("26,000–27,000{{efn|24–26,000}}{{Ubl|{{*}}25,000 killed}}"), "26,000–27,000; 25,000 killed", "a footnote's number never joins the count");

    // In the research: the infobox's facts join the bank with their evidence, free; offline or off they are skipped softly.
    const mainText = `${article.text} ${"Murad IV led the army from Constantinople across Anatolia to the walls of the city. ".repeat(20)}`;
    const fetchJson = async (url: string): Promise<unknown> => {
      const p = new URL(url).searchParams;
      if (p.get("list") === "search") return { query: { search: [{ title: "Siege of Baghdad (1638)" }] } };
      if (p.get("prop") === "revisions" && p.get("revids")) return answer;
      return { query: { pages: { "1": { title: "Siege of Baghdad (1638)", extract: mainText, revisions: [{ revid: 1378917458, timestamp: "2026-11-13T00:00:00Z" }] } } } };
    };
    const mid = sourceId("Siege of Baghdad (1638)");
    const quoted = ["The siege of Baghdad in the winter of 1638 marked the re-establishment of Ottoman control over Iraq.", "Murad IV led the army from Constantinople across Anatolia"];
    const modelAnswer = JSON.stringify({ olgular: [...quoted.map((alinti, i) => ({ metin: `Fact ${i}.`, kaynak: mid, alinti })), { metin: "Fact 2.", kaynak: mid, alinti: quoted[1] }, { metin: "Fact 3.", kaynak: mid, alinti: quoted[0] }, { metin: "Fact 4.", kaynak: mid, alinti: quoted[1] }, { metin: "Invented: the garrison was about 20,000.", kaynak: mid, alinti: "The Safavid garrison numbered about 20,000 men." }] });
    const logs: string[] = [];
    const research = (fj: (u: string) => Promise<unknown>, extra: { infobox?: boolean } = {}) =>
      researchTopic({ cacheDir: os.tmpdir(), konu: "Siege of Baghdad", donem: "1638", dil: "en", budget: new V3Budget({ providers: { openai: new FakeProvider([modelAnswer]) } }), model: { provider: "openai", model: "gpt-4.1-mini" }, seconds: 60, cast: false, wikidata: false, web: false, fetchJson: fj, log: (s) => logs.push(s), ...extra });
    const out = await research(fetchJson);
    const defenders = out.bank.alintilar.find((f) => f.alinti.includes("strength1 (Safavid Empire)"))!;
    assert.ok(defenders && out.bank.olgular.some((o) => o.metin === defenders.metin && o.kaynak === mid), "the defenders' strength is in the bank the writer reads");
    assert.equal(out.bank.reddedilen, 1, "the invented garrison is still thrown out");
    assert.equal(out.bank.olgular.length, 5 + facts.length);
    assert.ok(logs.some((l) => l.includes(`bilgi kutusu olguları (güç, kayıp, komutan, sonuç) "Siege of Baghdad (1638)" ${facts.length}`)) && out.bank.aciklama.includes("bilgi kutusu"), logs.join("\n"));
    logs.length = 0;
    const offline = await research(async (u) => { if (new URL(u).searchParams.get("revids")) throw new Error("COMMONS_HTTP_503"); return fetchJson(u); });
    assert.equal(offline.bank.olgular.length, 5);
    assert.ok(logs.some((l) => l.startsWith('araştırma: "Siege of Baghdad (1638)" bilgi kutusu okunamadı (COMMONS_HTTP_503)')), logs.join("\n"));
    assert.equal((await research(fetchJson, { infobox: false })).bank.olgular.length, 5);
  });

  await scenario("N9 the open web (owner, 12 Nov 2026): reputable pages read politely, a fact kept only with its quote in that page, searches booked; off, Ollama and offline skip softly", async () => {
    const wiki = `The Naval Battle of Guadalcanal took place from 12 to 15 November 1942. Rear Admiral Daniel J. Callaghan led the American cruisers. ${"The fighting at night was confused and fierce. ".repeat(30)}`;
    const fetchJson = async (url: string): Promise<unknown> => {
      const q = new URL(url).searchParams;
      if (q.get("list") === "search") return { query: { search: [{ title: "Naval Battle of Guadalcanal" }] } };
      return { query: { pages: { "1": { title: "Naval Battle of Guadalcanal", extract: wiki, revisions: [{ revid: 100, timestamp: "2026-11-01T00:00:00Z" }] } } } };
    };
    const wikiId = sourceId("Naval Battle of Guadalcanal");
    const mainAnswer = JSON.stringify({ olgular: [
      { metin: "The battle lasted from 12 to 15 November 1942.", kaynak: wikiId, alinti: "The Naval Battle of Guadalcanal took place from 12 to 15 November 1942." },
      { metin: "Callaghan led the American cruisers.", kaynak: wikiId, alinti: "Rear Admiral Daniel J. Callaghan led the American cruisers." },
      { metin: "The night fighting was confused.", kaynak: wikiId, alinti: "The fighting at night was confused and fierce." },
      { metin: "It was fierce at night.", kaynak: wikiId, alinti: "The fighting at night was confused and fierce. The fighting" },
      { metin: "The battle was in 1942, at night.", kaynak: wikiId, alinti: "took place from 12 to 15 November 1942. Rear Admiral" },
    ] });
    const filler = "The cruisers fought at very close range in the dark, and many of their crews never saw the enemy they fired at. ".repeat(16);
    const navyHtml = `<html><head><title>The Naval Battle of Guadalcanal, 12-15 November 1942</title><meta property="og:site_name" content="Naval History and Heritage Command"><script>var t = "In the night of 13 November the destroyer Laffey nearly collided with Hiei";</script><style>.x{color:red}</style></head><body><nav><ul><li>Sign up for our newsletter and get the latest research updates from the archive</li></ul></nav><main><h1>Guadalcanal</h1><p>At 01:48 on 13 November 1942 the destroyer Laffey passed so close to the battleship Hiei that the two ships nearly collided.</p><p>${filler}</p></main><footer>This is an official website of the Department of the Navy, all rights reserved.</footer></body></html>`;
    const museumHtml = `<html><head><title>Guadalcanal: The Naval Battles &amp; Their Cost</title></head><body><div><p>The light cruiser Juneau was sunk by the submarine I-26 on 13 November 1942, and only ten of her crew survived.</p><p>The battle was fought from 12 to 15 November 1942 and decided the campaign at sea.</p><p>${filler}</p></div></body></html>`;
    const pageUrls = { navy: "https://www.history.navy.mil/research/histories/guadalcanal.html", museum: "https://www.nationalww2museum.org/war/articles/guadalcanal-naval?utm_source=x" };
    const hits = [
      { url: "https://en.wikipedia.org/wiki/Naval_Battle_of_Guadalcanal", title: "Wikipedia" },
      { url: "https://www.reddit.com/r/history/comments/1/guadalcanal", title: "Reddit" },
      { url: "https://www.youtube.com/watch?v=abc", title: "Video" },
      { url: "http://insecure.example.org/guadalcanal", title: "Insecure" },
      { url: "https://www.example.edu/guadalcanal.pdf", title: "A PDF" },
      { url: "https://forum.example.com/t/guadalcanal", title: "A forum" },
      { url: "https://offline.example.org/guadalcanal", title: "Offline" },
      { url: "https://blocked.example.com/private/guadalcanal", title: "Robots" },
      { url: "https://broken.example.net/guadalcanal", title: "Broken" },
      { url: pageUrls.museum, title: "Museum" },
      { url: pageUrls.navy, title: "NHHC" },
      { url: "https://www.history.navy.mil/research/other.html", title: "NHHC again" },
    ];
    const searched: { prompt: string; model: string }[] = [];
    const search = async (prompt: string, opts: { model: string; maxOutputTokens: number }) => {
      searched.push({ prompt, model: opts.model });
      return { hits, searches: 1, inputTokens: 9_000, outputTokens: 300 };
    };
    const fetched: string[] = [];
    const fetchPage = async (url: string) => {
      fetched.push(url);
      const u = new URL(url);
      if (u.hostname === "offline.example.org") return { ok: false as const, reason: "ağ: fetch failed" };
      if (u.pathname === "/robots.txt") return u.hostname === "blocked.example.com" ? { ok: true as const, body: "User-agent: *\nDisallow: /private\n", contentType: "text/plain", finalUrl: url } : { ok: false as const, reason: "HTTP 404" };
      if (u.hostname === "broken.example.net") return { ok: false as const, reason: "HTTP 500" };
      if (u.hostname === "www.history.navy.mil") return { ok: true as const, body: navyHtml, contentType: "text/html; charset=utf-8", finalUrl: url };
      if (u.hostname === "www.nationalww2museum.org") return { ok: true as const, body: museumHtml, contentType: "text/html", finalUrl: url };
      return { ok: false as const, reason: "HTTP 404" };
    };
    const navyId = webSourceId(pageUrls.navy);
    const museumId = webSourceId(cleanUrl(pageUrls.museum));
    const webAnswer = JSON.stringify({ olgular: [
      { metin: "Laffey nearly rammed Hiei at 01:48.", kaynak: navyId, alinti: "At 01:48 on 13 November 1942 the destroyer Laffey passed so close to the battleship Hiei that the two ships nearly collided." },
      { metin: "Read from the page's script.", kaynak: navyId, alinti: "In the night of 13 November the destroyer Laffey nearly collided with Hiei" },
      { metin: "Read from the menu.", kaynak: navyId, alinti: "Sign up for our newsletter and get the latest research updates" },
      { metin: "Only ten of Juneau's crew survived her sinking by I-26.", kaynak: museumId, alinti: "The light cruiser Juneau was sunk by the submarine I-26 on 13 November 1942, and only ten of her crew survived." },
      { metin: "The battle was fought from 12 to 15 November 1942.", kaynak: museumId, alinti: "The battle was fought from 12 to 15 November 1942" },
      { metin: "Invented: Juneau carried 900 men.", kaynak: museumId, alinti: "Juneau carried nine hundred men into the sound." },
    ] });
    const tmp = mkdtempSync(path.join(os.tmpdir(), "v3-web-"));
    const logs: string[] = [];
    const openai = new FakeProvider([mainAnswer, webAnswer], { promptTokens: 20_000, completionTokens: 2_000 });
    const budget = new V3Budget({ providers: { openai } });
    type ResearchInput = Parameters<typeof researchTopic>[0];
    const research = (b: V3Budget, web: ResearchInput["web"], extra: Partial<ResearchInput> = {}) =>
      researchTopic({ cacheDir: tmp, konu: "Naval Battle of Guadalcanal", donem: "1942", dil: "en", budget: b, model: { provider: "openai", model: "gpt-4.1-mini" }, seconds: 60, cast: false, wikidata: false, fetchJson, web, env: {}, log: (s) => logs.push(s), ...extra });
    const out = await research(budget, { search, fetchPage, cacheDir: path.join(tmp, "web"), today: "2026-11-12" });
    // Three searches, each booked: OpenAI's $0.01 fee and the reported tokens, which hold its 8,000-token block (gpt-4.1-mini).
    assert.deepEqual(budget.ledger.map((e) => e.step), ["arastirma", "arastirma-web-arama", "arastirma-web-arama", "arastirma-web-arama", "arastirma-web"]);
    const searchCost = 0.01 + 9_000 * 0.4e-6 + 300 * 1.6e-6;
    for (const e of budget.ledger.filter((x) => x.step === "arastirma-web-arama")) assert.ok(Math.abs(e.costUsd - searchCost) < 1e-6 && e.ceilingUsd > 0.0145 && e.ceilingUsd < 0.0155, JSON.stringify(e));
    assert.equal(searched.length, 3);
    assert.ok(searched[0]!.prompt.includes("Naval Battle of Guadalcanal 1942") && /museums, national archives/.test(searched[0]!.prompt) && searched[1]!.prompt.includes("timeline"));
    assert.ok(searched.every((s) => s.model === "gpt-4.1-mini") && /Do not use Wikipedia, social media, forums, video sites/.test(searched[0]!.prompt));
    // Never fetched: Wikipedia (read already), social media, video, http, a PDF, a forum, a second page of the same site, a robots-refused path.
    assert.ok(!fetched.some((u) => /wikipedia|reddit|youtube|insecure|\.pdf|forum\.|other\.html|\/private\//.test(u)), fetched.join("\n"));
    assert.ok(fetched.includes("https://blocked.example.com/robots.txt"));
    const webLog = logs.find((l) => l.startsWith("araştırma: web — "))!;
    assert.ok(webLog.includes("3 arama") && webLog.includes("Wikipedia (zaten okundu) 1") && webLog.includes("sosyal medya 1") && webLog.includes("video sitesi 1") && webLog.includes("forum 1") && webLog.includes("2 sayfa okundu"), webLog);
    assert.ok(webLog.includes("robots.txt izin vermiyor") && webLog.includes("ağ: fetch failed") && webLog.includes("HTTP 500"), webLog);
    // The official site is read before the museum; the page's script, menu and footer are not its text.
    const webPrompt = openai.calls[1]!.prompt;
    assert.ok(webPrompt.indexOf(navyId) < webPrompt.indexOf(museumId) && webPrompt.includes("KNOWN FACTS") && webPrompt.includes("Callaghan led the American cruisers."));
    assert.ok(!webPrompt.includes("newsletter") && !webPrompt.includes("var t =") && !webPrompt.includes("Department of the Navy, all rights"));
    assert.ok(webPrompt.includes('title="Guadalcanal: The Naval Battles & Their Cost"'), "entities decoded");
    // Kept: the two quoted facts that add to Wikipedia. Dropped: script and menu quotes, the invented one, the repeat.
    const webFacts = out.bank.alintilar.filter((f) => f.kaynak.startsWith("web-"));
    assert.deepEqual(webFacts.map((f) => f.metin), ["Laffey nearly rammed Hiei at 01:48.", "Only ten of Juneau's crew survived her sinking by I-26."]);
    assert.equal(out.bank.reddedilen, 3, "three quotes are not in their page's text");
    assert.ok(logs.some((l) => l.includes("web olguları 2") && l.includes("1 olgu Wikipedia'dakini tekrarladığı için")), logs.join("\n"));
    const navySource = out.bank.kaynaklar.find((k) => k.id === navyId)!;
    assert.deepEqual(navySource, { id: navyId, kunye: 'Naval History and Heritage Command, "The Naval Battle of Guadalcanal, 12-15 November 1942" (history.navy.mil, read 2026-11-12)', url: pageUrls.navy });
    assert.equal(out.bank.kaynaklar.find((k) => k.id === museumId)!.url, "https://www.nationalww2museum.org/war/articles/guadalcanal-naval", "tracking parameters dropped");
    assert.match(navyId, /^web-history-navy-mil-[0-9a-f]{8}$/);
    assert.ok(out.bank.aciklama.includes("görselleri alınmadı"));
    const episodeCheck = validateEpisode({ ...episode(), kaynaklar: out.bank.kaynaklar });
    assert.ok(!episodeCheck.errors.some((e) => e.path.startsWith("$.kaynaklar")), JSON.stringify(episodeCheck.errors.filter((e) => e.path.startsWith("$.kaynaklar"))));

    // A day later the same searches come from the cache: no fee, no call.
    const again = new V3Budget({ providers: { openai: new FakeProvider([mainAnswer, webAnswer], { promptTokens: 20_000, completionTokens: 2_000 }) } });
    await research(again, { search: async () => assert.fail("a cached search is not made again"), fetchPage: async () => assert.fail("a cached page is not fetched again"), cacheDir: path.join(tmp, "web"), today: "2026-11-12" });
    assert.deepEqual(again.ledger.map((e) => e.step), ["arastirma", "arastirma-web"]);

    // Offline search: one line per search, the research goes on with Wikipedia alone.
    logs.length = 0;
    const offline = await research(new V3Budget({ providers: { openai: new FakeProvider([mainAnswer]) } }), { search: async () => { throw new Error("fetch failed"); }, fetchPage, cacheDir: path.join(tmp, "web-offline"), today: "2026-11-12" });
    assert.equal(logs.filter((l) => /^araştırma: web araması ".+" yapılamadı \(fetch failed\); atlandı$/.test(l)).length, 3, logs.join("\n"));
    assert.equal(offline.bank.olgular.length, 5);
    assert.ok(!offline.bank.kaynaklar.some((k) => k.id.startsWith("web-")));

    // Off by the setting, and on Ollama: no search at all, a line in the log.
    const cases: [Record<string, string>, ResearchInput["model"], string][] = [[{ ATOLYE_V3_WEB_ARASTIRMA: "0" }, { provider: "openai", model: "gpt-4.1-mini" }, "ATOLYE_V3_WEB_ARASTIRMA=0"], [{}, { provider: "ollama" }, "sağlayıcı ollama"]];
    for (const [env, model, why] of cases) {
      logs.length = 0;
      const b = new V3Budget({ providers: { openai: new FakeProvider([mainAnswer]), ollama: new FakeProvider([mainAnswer]) } });
      await research(b, { search: async () => assert.fail("no search when off"), fetchPage }, { env, model });
      assert.ok(logs.some((l) => l.startsWith("araştırma: açık web araştırması atlandı (") && l.includes(why)), logs.join("\n"));
      assert.ok(!b.ledger.some((e) => e.step.startsWith("arastirma-web")));
    }
    assert.match(webSkipReason({ model: "gpt-4.1" }, { provider: "openai", model: "gpt-4.1" }, {}) ?? "", /fiyatı sabit değil/, "a search model without a fixed search price is not used");

    // The cap holds for searches: a search that would cross it is not made, and nothing falls back to a free model.
    const tight = new V3Budget({ providers: {}, capUsd: 0.02, fallback: { provider: "ollama" } });
    let ran = 0;
    await tight.paid("arastirma-web-arama", { provider: "openai", model: "gpt-4.1-mini" }, 0.015, async () => (ran++, { value: 1, costUsd: 0.0151 }));
    await assert.rejects(tight.paid("arastirma-web-arama", { provider: "openai", model: "gpt-4.1-mini" }, 0.015, async () => (ran++, { value: 1 })), /V3_BUDGET_EXCEEDED/);
    assert.equal(ran, 1);
    assert.equal(tight.spentUsd, 0.0151);
  });

  await scenario("N10 the web page rules: robots.txt groups, refused hosts, HTML to text, OpenAI's answer, and the fetch reaches public https hosts only", async () => {
    const robots = "User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /search\nDisallow: /*.php$\nAllow: /search/about\n\nUser-agent: AtolyeV3\nUser-agent: OtherBot\nDisallow: /drafts/\n";
    assert.equal(robotsAllows(robots, "/history/guadalcanal"), true);
    assert.equal(robotsAllows(robots, "/drafts/x"), false, "its own group");
    assert.equal(robotsAllows(robots, "/search?q=x"), true, "its own group replaces the * group");
    assert.equal(robotsAllows(robots, "/search?q=x", "SomeBot"), false);
    assert.equal(robotsAllows(robots, "/search/about", "SomeBot"), true, "the longer Allow wins");
    assert.equal(robotsAllows(robots, "/page.php", "SomeBot"), false);
    assert.equal(robotsAllows(robots, "/page.php?x=1", "SomeBot"), true, "$ anchors the end");
    assert.equal(robotsAllows("", "/x"), true);
    assert.equal(webRefusal("https://de.m.wikipedia.org/wiki/X"), "Wikipedia (zaten okundu)");
    assert.equal(webRefusal("https://www.quora.com/q"), "sosyal medya");
    assert.equal(webRefusal("https://example.org/forums/topic/1"), "forum");
    assert.equal(webRefusal("https://www.grokipedia.com/page/X"), "içerik çiftliği / ödev / yapay zekâ sitesi");
    assert.equal(webRefusal("https://www.history.navy.mil/a.html"), undefined);
    const article = Array.from({ length: 6 }, (_, i) => "Sentence " + i + " of the article is long enough to count as one of the real sentences of its text.").join(" ");
    assert.equal(copiesWikipedia(article + " A footer line.", normalizeForMatch(article)), true, "a mirror of the article read is not another source");
    assert.equal(copiesWikipedia(article.replace(/article/g, "report"), normalizeForMatch(article)), false);
    assert.ok(reputableScore("https://www.history.navy.mil/x") > reputableScore("https://www.nationalww2museum.org/x") && reputableScore("https://www.nationalww2museum.org/x") > reputableScore("https://blog.example.com/x"));
    const t = htmlToText(`<title>A &#8211; B</title><body><p>First paragraph is long enough to be kept as page text here.</p><div>short</div><aside>Related articles you might enjoy reading next time around</aside><p>Second&nbsp;paragraph, also long enough to be kept as page text.</p></body>`, "https://www.example.org/x");
    assert.deepEqual(t, { title: "A – B", site: "example.org", text: "First paragraph is long enough to be kept as page text here.\nSecond paragraph, also long enough to be kept as page text." });
    const answer = readSearchAnswer({ output: [
      { type: "web_search_call", action: { type: "search", query: "q", sources: [{ type: "url", url: "https://a.example.org/1#top" }] } },
      { type: "message", content: [{ type: "output_text", text: "A — https://a.example.org/1\nB — https://b.example.org/2.", annotations: [{ type: "url_citation", url: "https://a.example.org/1?utm_source=openai", title: "Page A" }] }] },
    ], usage: { input_tokens: 9100, output_tokens: 120 } });
    assert.deepEqual(answer, { hits: [{ url: "https://a.example.org/1", title: "Page A" }, { url: "https://b.example.org/2", title: "" }], searches: 1, inputTokens: 9100, outputTokens: 120 });
    assert.ok(Math.abs(webSearchCostUsd("gpt-4.1-mini", answer)! - (0.01 + 9_100 * 0.4e-6 + 120 * 1.6e-6)) < 1e-9);
    assert.ok(Math.abs(webSearchCostUsd("gpt-4.1-mini", { hits: [], searches: 2, inputTokens: 300, outputTokens: 0 })! - (0.02 + 16_000 * 0.4e-6)) < 1e-9, "each search is billed, its block at least");
    assert.equal(webSearchCostUsd("gpt-4.1-mini", { hits: [], searches: 1 }), undefined, "no usage: the budget books the ceiling");
    assert.deepEqual(webQueries("Naval Battle of Guadalcanal", "1942", ["Daniel J. Callaghan", "Hiroaki Abe", "Japanese battleship Hiei (1912)", "Willis A. Lee"], 3), ["Naval Battle of Guadalcanal 1942", "Naval Battle of Guadalcanal timeline dates numbers losses", "Naval Battle of Guadalcanal Daniel J. Callaghan, Hiroaki Abe, Japanese battleship Hiei"]);
    // The fetch: a private address (directly, by DNS or by a redirect) is never requested; a PDF body is not read.
    const asked: string[] = [];
    const fake = (async (url: string | URL | Request) => {
      asked.push(String(url));
      if (String(url).includes("/moved")) return new Response(null, { status: 302, headers: { location: "https://intranet.example.org/secret" } });
      if (String(url).includes(".pdf")) return new Response("%PDF", { headers: { "content-type": "application/pdf" } });
      return new Response(`<p>${"x".repeat(5000)}</p>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }) as typeof fetch;
    const page = safePageFetch({ fetchImpl: fake, maxBytes: 1_000, resolve: async (h) => (h === "intranet.example.org" ? ["10.1.2.3"] : ["93.184.215.14"]) });
    assert.deepEqual(await page("https://192.168.1.1/x"), { ok: false, reason: "özel ağ adresi" });
    assert.deepEqual(await page("https://intranet.example.org/x"), { ok: false, reason: "özel ağ adresi" });
    assert.deepEqual(await page("https://localhost/x"), { ok: false, reason: "yerel adres" });
    assert.deepEqual(await page("http://www.example.org/x"), { ok: false, reason: "yalnız https (443)" });
    assert.deepEqual(await page("https://www.example.org/moved"), { ok: false, reason: "özel ağ adresi" });
    assert.deepEqual(await page("https://www.example.org/a.pdf"), { ok: false, reason: "metin değil (application/pdf)" });
    const ok = await page("https://www.example.org/x");
    assert.ok(ok.ok && ok.body.length <= 1_000, "the body is cut at its cap");
    assert.ok(!asked.some((u) => /192\.168|intranet|localhost|^http:/.test(u)), asked.join("\n"));
    assert.ok(privateAddress("127.0.0.1") && privateAddress("::1") && privateAddress("fd00::1") && privateAddress("::ffff:10.0.0.1") && !privateAddress("93.184.215.14"));
  });

  await scenario("N7 the writer and the fact checker see each fact's evidence, told to paraphrase; a hand-made bank reads as before", () => {
    const bank = {
      kaynaklar: [{ id: "wikipedia-x", kunye: 'Wikipedia, "X" (revision 1, 2026-11-01)' }],
      olgular: [{ metin: "Callaghan died on his flagship's bridge.", kaynak: "wikipedia-x" }, { metin: "Lee sank Kirishima.", kaynak: "wikipedia-x" }],
      alintilar: [{ metin: "Callaghan died on his flagship's bridge.", kaynak: "wikipedia-x", alinti: 'Callaghan was killed on the bridge of "San Francisco".' }, { metin: "Lee sank Kirishima.", kaynak: "wikipedia-x", alinti: `On the night of 14 November ${"Lee's battleships fought on. ".repeat(20)}` }],
    };
    const prompt = writingPrompt({ konu: "Naval Battle of Guadalcanal", donem: "1942", hedefSureSn: 180, ton: "mizahi", dil: "en", kaynakBankasi: bank }, CATALOG);
    assert.ok(prompt.includes(`- [wikipedia-x] Callaghan died on his flagship's bridge.\n  evidence: "Callaghan was killed on the bridge of 'San Francisco'."`), "the quote beside its fact");
    assert.match(prompt, /Tell every fact in YOUR OWN words: never copy an evidence sentence, or a run of more than eight\nof its words/);
    assert.ok(/evidence: "On the night of 14 November[^"]*…"/.test(prompt) && !prompt.includes("Lee's battleships fought on. ".repeat(20)), "a long quote is cut");
    const check = factCheckPrompt("{}", "en", bank);
    assert.ok(check.includes('evidence: "Callaghan was killed') && check.includes('"dayanak" may copy the fact or its evidence'));
    // The checker's dayanak copied from the shown evidence counts as support.
    assert.equal(correctionSupported(`evidence: "Callaghan was killed on the bridge of 'San Francisco'."`, { bank }), true);
    assert.equal(correctionSupported("On the night of 14 November Lee's battleships fought on", { bank }), true);
    // A hand-made bank (no quotes) is shown exactly as before.
    const plain = { kaynaklar: bank.kaynaklar, olgular: bank.olgular };
    const old = writingPrompt({ konu: "x", donem: "1942", hedefSureSn: 180, ton: "mizahi", dil: "en", kaynakBankasi: plain }, CATALOG);
    assert.ok(old.includes("- [wikipedia-x] Callaghan died on his flagship's bridge.\n- [wikipedia-x] Lee sank Kirishima.") && !old.includes("evidence") && !factCheckPrompt("{}", "en", plain).includes("evidence"));
    // The evidence share is bounded: past it, facts are listed alone.
    const many = { kaynaklar: bank.kaynaklar, olgular: Array.from({ length: 200 }, (_, i) => ({ metin: `Fact ${i}.`, kaynak: "wikipedia-x" })), alintilar: Array.from({ length: 200 }, (_, i) => ({ metin: `Fact ${i}.`, kaynak: "wikipedia-x", alinti: `${"word ".repeat(40)}${i}` })) };
    const lines = bankFactLines(many, EVIDENCE_CHARS.checker);
    assert.ok(lines.text.length < EVIDENCE_CHARS.checker + 200 * 40, `${lines.text.length}`);
    assert.ok(lines.text.includes("- [wikipedia-x] Fact 199.") && !lines.text.includes(" 199\""));
  });

  await scenario("N8 a line that copies a source sentence word for word is sent back to be told in its own words", () => {
    const bank = { kaynaklar: [], olgular: [], alintilar: [{ metin: "f", kaynak: "wikipedia-x", alinti: "The Japanese never again tried to bring battleships into the waters off Guadalcanal during the campaign." }] };
    const ep = { sahneler: [{ id: "s3", satirlar: [{ metin: "And after that, the Japanese never again tried to bring battleships into the waters off Guadalcanal!" }, { metin: "Tokyo kept its battleships away from Guadalcanal after that." }] }] };
    const found = copiedFromSources(ep, bank);
    assert.equal(found.length, 1);
    assert.match(found[0]!, /^scene "s3" line 0 copies a source sentence word for word/);
    assert.deepEqual(copiedFromSources(ep, { kaynaklar: [], olgular: [] }), [], "a hand-made bank has no quotes to compare");
    assert.equal(COPY_RUN_WORDS, 12);
  });

  await scenario("L2 a Short within its band (90–104% of its word budget) is not sent to a paid expansion round", async () => {
    // 14 s Short: budget 14 × 0.92 × 1.8 ≈ 23 words; the fixture's 21 words are 91% of it (a Short's band was 65–110% until
    // 13 Nov 2026: the 3-minute Shorts came out at 107 s; owner: not much under 2:30, so 90%; the Caesar overshoot is the top 104%).
    const openai = new FakeProvider([validJson(), JSON.stringify({ iddialar: [] })]);
    const budget = new V3Budget({ providers: { openai } });
    const out = await writeScript({ brief: { konu: "x", donem: "1452", hedefSureSn: 14, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget });
    assert.deepEqual([out.lengthRounds, out.spokenWords, out.targetWords], [0, 21, 23]);
    assert.equal(budget.ledger.map((e) => e.step).join(","), "senaryo,dogrulama");
  });

  await scenario("N research: a fact is kept only when its quote is really in the cited article", () => {
    const articles = [{ title: "Crossing the Rubicon", revid: 1, timestamp: "2026-08-19T00:00:00Z", text: "In January 49 BC, Julius Caesar led a single legion, Legio XIII Gemina, across the Rubicon river.\nThe phrase “the die is cast” is attributed to him." }];
    const id = sourceId("Crossing the Rubicon");
    assert.equal(id, "wikipedia-crossing-the-rubicon");
    const { kept, rejected } = verifyFacts(
      {
        olgular: [
          { metin: "Caesar crossed with one legion.", kaynak: id, alinti: "Julius Caesar led a single legion, Legio XIII Gemina, across the Rubicon river." },
          { metin: "The die is cast.", kaynak: id, alinti: 'The phrase "the die is cast" is attributed to him' },
          { metin: "Caesar had ten legions with him.", kaynak: id, alinti: "Caesar crossed the Rubicon with ten legions" },
          { metin: "Wrong source.", kaynak: "wikipedia-x", alinti: "Julius Caesar led a single legion" },
          { metin: "Too short.", kaynak: id, alinti: "Caesar" },
        ],
      },
      articles,
    );
    assert.deepEqual(kept.map((f) => f.metin), ["Caesar crossed with one legion.", "The die is cast."], "akıllı tırnak ve satır sonu eşleşir");
    assert.equal(rejected, 3, "uydurma alıntı, yanlış kaynak, çok kısa alıntı atılır");
    assert.equal(articleSource(articles[0]!).url, "https://en.wikipedia.org/w/index.php?oldid=1");
  });

  await scenario("N2 a Turkish AYAS order is named as English Wikipedia knows it before the search; a yearless period is filled", async () => {
    const prompt = topicPrompt("Sezar’ın rubicon’u geçmesi", "konunun geçtiği dönem");
    assert.match(prompt, /TOPIC: Sezar’ın rubicon’u geçmesi/);
    assert.match(prompt, /If PERIOD has no year/);
    assert.deepEqual(readTopic('Sure! {"konu":"Julius Caesar crossing the Rubicon","donem":"49 BC","wiki":["Crossing the Rubicon","Julius Caesar","Caesar\'s civil war","Rubicon"]}'), { konu: "Julius Caesar crossing the Rubicon", donem: "49 BC", wiki: ["Crossing the Rubicon", "Julius Caesar", "Caesar's civil war"] }, "en çok üç makale");
    assert.equal(readTopic('{"konu":"The Fall of Rome","donem":"unknown","wiki":[]}')?.donem, "", "yılsız dönem boş kalır, sahibinkinin yerine geçmez");
    assert.equal(readTopic('{"konu":"","wiki":[]}'), undefined);
    assert.equal(readTopic("not json"), undefined);
    const openai = new FakeProvider(['{"konu":"Julius Caesar crossing the Rubicon","donem":"49 BC","wiki":["Crossing the Rubicon"]}'], { promptTokens: 200, completionTokens: 40 });
    const budget = new V3Budget({ providers: { openai } });
    const topic = await resolveTopic({ konu: "Sezar’ın rubicon’u geçmesi", donem: "konunun geçtiği dönem", budget, model: { provider: "openai", model: "gpt-4.1-mini" } });
    assert.deepEqual([topic?.donem, topic?.wiki], ["49 BC", ["Crossing the Rubicon"]]);
    assert.equal(budget.ledger[0]?.step, "konu");
  });

  await scenario("O wardrobe: 'yeni:' orders are collected once, replaced by library ids or dropped, and drawn parts pass the gates", () => {
    const ep = episode();
    const withOrders: Episode = {
      ...ep,
      oyuncu_kadrosu: ep.oyuncu_kadrosu.map((c) => (c.kostum ? { ...c, kostum: { ...c.kostum, bas: "yeni:Roman legionary helmet with a red crest", el_on: "yeni:short Roman sword" } } : c)),
    };
    const orders = partOrders(withOrders);
    assert.deepEqual(orders.map((o) => [o.slot, o.tarif]), [["head", "Roman legionary helmet with a red crest"], ["hand", "short Roman sword"]]);
    const made = new Map<string, string | undefined>([["head:roman legionary helmet with a red crest", "roman-helmet-ab12cd"], ["hand:short roman sword", undefined]]);
    const fixed = applyParts(withOrders, made);
    const k = fixed.oyuncu_kadrosu.find((c) => c.kostum)!.kostum!;
    assert.equal(k.bas, "gardirop/roman-helmet-ab12cd");
    assert.equal(k.el_on, undefined, "kabul edilmeyen parça kostümden çıkar");
    const good = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-170 -300 340 380"><path d="M-106 -52 C-110 -140 -60 -204 0 -208 C60 -204 110 -140 106 -52 Z" style="fill:#b8862f;stroke:#1d1b26;stroke-width:6"/></svg>';
    assert.deepEqual(partProblems(good, "head"), []);
    assert.ok(partProblems(good.replace("<path", '<image href="x.png"/><path'), "head").length > 0, "dış kaynak reddedilir");
    assert.ok(partProblems(good.replace(/#1d1b26/g, "#000000"), "head").some((p) => p.includes("outline")));
    assert.ok(partProblems(good.replace("-208", "-950"), "head").some((p) => p.includes("frame")));
    assert.ok(partProblems(good.replace(/-1\d\d|-20\d/g, "-40"), "head").some((p) => p.includes("above the head")));
  });

  await scenario("P a short script gets per-scene asks: the scenes furthest below their share of the target first", () => {
    const ep = episode();
    const asks = sceneShortfalls(ep, 400);
    assert.ok(asks.length >= 1 && asks.length <= 5);
    assert.match(asks[0]!, /^scene "[a-z0-9-]+" has \d+ spoken words and needs about \d+: add \d+ words there/);
    assert.deepEqual(sceneShortfalls(ep, 1), [], "hedefe ulaşmış senaryoya istek yok");
  });

  await scenario("L a long episode is planned in chapters and written chapter by chapter; scene ids carry the chapter; $4 cap", async () => {
    assert.equal(isLongForm({ hedefSureSn: 300 }), false);
    assert.equal(isLongForm({ hedefSureSn: 1080 }), true);
    assert.deepEqual([chapterCount(720), chapterCount(1200), chapterCount(1800), chapterCount(4000)], [6, 10, 15, 15]);
    assert.deepEqual([videoCapUsd(120), videoCapUsd(1080)], [1, 4]);
    const base = episode();
    const { sahneler, ...header } = base;
    const outline = { ...header, hedef_sure_sn: 720, bolumler: Array.from({ length: 6 }, (_, i) => ({ id: `b${i + 1}-bolum`, baslik: `Bölüm ${i + 1}`, ozet: `Bu bölümde olay ${i + 1} anlatılır, yerleri ve yılları ile birlikte.`, sure_sn: 100, ...(i ? { baglanti: `Bölüm ${i}'in sonundaki divandan devam eder.` } : {}) })) };
    // Per chapter: the scenes, one lengthening round (a short chapter) that does not help, the fact check; then the
    // story editor's pass over the whole, which mends one break.
    const answers = [JSON.stringify(outline)];
    for (let i = 0; i < 6; i++) answers.push(JSON.stringify({ sahneler }), JSON.stringify({ ...header, sahneler }), JSON.stringify({ iddialar: [] }));
    answers.push(JSON.stringify({ kopukluklar: [{ sahne: "b2-bolum-s1-kanca", satir: 0, sorun: "bölüm 1'den zaman atlıyor", yeni_metin: "İki yıl sonra Boğaz'da yeni bir kale yükseliyordu." }, { sahne: "yok", satir: 0, sorun: "x", yeni_metin: "y" }] }));
    const openai = new FakeProvider(answers);
    const lines: string[] = [];
    const out = await writeScript({ brief: { konu: "Uzun konu", donem: "1453", hedefSureSn: 720, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget: new V3Budget({ providers: { openai }, capUsd: 4 }), log: (s) => lines.push(s) });
    assert.equal(openai.calls.length, 20);
    assert.ok(openai.calls[0]!.prompt.includes("STEP 1: THE PLAN") && openai.calls[0]!.prompt.includes("in 6 chapters"));
    assert.ok(openai.calls[0]!.prompt.includes("GO DEEP") && openai.calls[0]!.prompt.includes("ONE CONTINUOUS STORY") && openai.calls[0]!.prompt.includes('"baglanti"'));
    assert.ok(openai.calls[1]!.prompt.includes("CHAPTER 1 OF 6") && openai.calls[1]!.prompt.includes("FIXED CAST"));
    assert.ok(!openai.calls[1]!.prompt.includes("AS WRITTEN"), "the first chapter has no chapter before it");
    assert.ok(openai.calls[4]!.prompt.includes("CHAPTER 2 OF 6") && openai.calls[4]!.prompt.includes("THE STORY SO FAR"));
    // The chapter before as written: its last place and lines, and the plan's bridge.
    assert.ok(openai.calls[4]!.prompt.includes('THE CHAPTER BEFORE, AS WRITTEN — it ended at "Edirne Sarayı"') && openai.calls[4]!.prompt.includes("  Anlatıcı: Bir kale dört ayda biter mi?") && openai.calls[4]!.prompt.includes("(the plan: Bölüm 1'in sonundaki divandan devam eder.)"), openai.calls[4]!.prompt.slice(-1800));
    assert.ok(openai.calls[16]!.prompt.includes("This is the last chapter"));
    assert.ok(openai.calls[19]!.prompt.includes("story editor") && openai.calls[19]!.prompt.includes("[b6-bolum-s2-divan | Edirne Sarayı]"));
    assert.equal(out.episode.sahneler.find((s) => s.id === "b2-bolum-s1-kanca")!.satirlar[0]!.metin, "İki yıl sonra Boğaz'da yeni bir kale yükseliyordu.");
    assert.ok(lines.some((l) => l.includes("akış denetimi: 1 kopukluk düzeltildi — b2-bolum-s1-kanca#0: bölüm 1'den zaman atlıyor")), lines.join("\n"));
    assert.ok(readOutline({ ...outline, bolumler: outline.bolumler.map((b) => ({ ...b, baglanti: undefined })) }, { hedefSureSn: 720 }).problems.some((p) => p.startsWith("bolumler[1].baglanti is missing")), "a plan with no bridges is sent back");
    assert.equal(out.episode.sahneler.length, sahneler.length * 6);
    assert.ok(out.episode.sahneler.every((s) => /^b[1-6]-bolum-/.test(s.id)), "every scene id starts with its chapter");
    assert.equal(new Set(out.episode.sahneler.map((s) => s.id)).size, out.episode.sahneler.length, "no two scenes share an id");
    assert.equal(out.episode.hedef_sure_sn, 720);
    assert.ok(out.validation.ok);
    assert.ok(lines[0]!.startsWith("senaryo planı: 6 bölüm"));
    // The plan's chapter lengths are scaled to the target; a broken plan is sent back.
    const read = readOutline({ ...outline, bolumler: outline.bolumler.map((b) => ({ ...b, sure_sn: 60 })) }, { hedefSureSn: 720 });
    assert.equal(read.outline!.bolumler.reduce((n, b) => n + b.sure_sn, 0), 720);
    assert.ok(readOutline({ ...outline, bolumler: [] }, { hedefSureSn: 720 }).problems.some((p) => p.includes("4–16 chapters")));
    assert.ok(prefixScenes([{ id: "s1" }, { id: "b2-x-s2" }], "b2-x").every((s) => String(s.id).startsWith("b2-x-")));
  });

  await scenario("L1 a long episode is checked only when every chapter's fact check reads; an unreadable one is asked once more (13 Nov 2026 audit)", async () => {
    const { sahneler, ...header } = episode();
    const outline = { ...header, hedef_sure_sn: 720, bolumler: Array.from({ length: 6 }, (_, i) => ({ id: `b${i + 1}-bolum`, baslik: `Bölüm ${i + 1}`, ozet: `Bu bölümde olay ${i + 1} anlatılır, yerleri ve yılları ile birlikte.`, sure_sn: 100, ...(i ? { baglanti: `Bölüm ${i}'in sonundaki divandan devam eder.` } : {}) })) };
    const run = async (checks: (i: number) => string[]) => {
      const answers = [JSON.stringify(outline)];
      for (let i = 0; i < 6; i++) answers.push(JSON.stringify({ sahneler }), JSON.stringify({ ...header, sahneler }), ...checks(i));
      answers.push(JSON.stringify({ kopukluklar: [] }));
      const openai = new FakeProvider(answers);
      const budget = new V3Budget({ providers: { openai }, capUsd: 4 });
      const out = await writeScript({ brief: { konu: "Uzun konu", donem: "1453", hedefSureSn: 720, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget });
      return { out, steps: budget.ledger.map((e) => e.step).filter((s) => s.startsWith("dogrulama")) };
    };
    const empty = JSON.stringify({ iddialar: [] });
    // Chapter 3's answer was cut and reads on the second look; chapter 5's never reads: the episode is unchecked.
    const cut = await run((i) => (i === 2 ? ['{"iddialar": [{"sahne": "s1', empty] : i === 4 ? ["?", "?"] : [empty]));
    assert.deepEqual(cut.steps, ["dogrulama-1", "dogrulama-2", "dogrulama-3", "dogrulama-3-tekrar", "dogrulama-4", "dogrulama-5", "dogrulama-5-tekrar", "dogrulama-6"]);
    assert.equal(cut.out.factCheck.durum, "okunamadi", "one unreadable chapter of six leaves the episode unchecked");
    const healed = await run((i) => (i === 2 ? ["?", empty] : [empty]));
    assert.equal(healed.out.factCheck.durum, "tamam", "every chapter read (one on its second look)");
  });

  await scenario("map rules (owner, 21 Oct 2026): between places on the living map — a map-named scene needs a map, a map needs something happening, a voyage needs its route", () => {
    const line = (metin: string) => ({ karakter: "anlatici", metin, duygu: "notr" });
    const scene = (id: string, mekan: string, metin: string[], harita?: object) => ({ id, mekan, satirlar: metin.map(line), ...(harita ? { harita } : {}) });
    // The Mongol test: the fleet crossed on a beach, the outro was "a map" without one.
    const mongol = { sahneler: [scene("s3", "Tsushima Island beach", ["The Mongol fleet sailed from Korea.", "They invaded Tsushima first."]), scene("s8", "Map of East Asia zooming out", ["And so it ended."])] };
    const found = mapProblems(mongol);
    assert.ok(found.some((p) => p.includes('scene "s8" is set on a map')));
    assert.ok(found.some((p) => p.includes("no map shows the route")));
    const still = mapProblems({ sahneler: [scene("m1", "Map of Asia", ["Here is Japan."], { merkez: [135, 35], genislik_km: 3000 })] });
    assert.ok(still.some((p) => p.includes('map scene "m1" shows nothing happening')));
    // Left still after the repair rounds (Belgrade's outro): the camera closes in on the place as a last resort.
    const stillMap = { ...episode(), sahneler: [scene("m1", "Map of Asia", ["Here is Japan.", "And here it stays."], { merkez: [135, 35], genislik_km: 3000, sehirler: [{ ad: "Kyoto", konum: [135.77, 35.01] }] })] } as unknown as Episode;
    const livened = livenStillMaps(stillMap);
    assert.deepEqual(livened.episode.sahneler[0]!.harita!.kamera, [{ satir: 1, merkez: [135.77, 35.01], genislik_km: 1650 }]);
    assert.ok(livened.fixes.length === 1 && !mapProblems(livened.episode).some((p) => p.includes("shows nothing happening")));
    assert.equal(livenStillMaps(livened.episode).fixes.length, 0, "a second pass changes nothing");
    const living = { sahneler: [scene("m1", "Map of the Korea Strait", ["The Mongol fleet sailed from Korea.", "It invaded Tsushima."], { merkez: [129, 34], genislik_km: 1200, oklar: [{ noktalar: [[129, 35], [129.3, 34.3]], satir: 0 }] })] };
    assert.deepEqual(mapProblems(living), [], "a crossing drawn on the map is fine");
    const court = { ...scene("c1", "Kublai's court", ["The Khan was angry.", "He shouted at everyone."]), ortam: { zaman: "gun", manzara: "saray_ici", uslup: "cin" } };
    assert.deepEqual(mapProblems({ sahneler: [court] }), [], "a story in one place needs no map");
    // Owner, 22 Oct 2026: every character scene lives in its drawn set.
    assert.ok(mapProblems({ sahneler: [scene("c2", "Kublai's court", ["The Khan was angry."])] }).some((p) => p.includes('character scene "c2" has no "ortam"')));
    assert.ok(mapProblems({ sahneler: [scene("t1", "Saray", ["Ordu kuzeye yürüdü.", "Donanma denizi geçti."])] }).some((p) => p.includes("no map shows the route")), "Turkish verbs count too");
    const marching = { sahneler: [scene("m2", "Map of Italy", ["Caesar crossed the Rubicon.", "He marched on Rome."], { merkez: [12.5, 43], genislik_km: 1300, ordular: [{ ad: "Caesar", konum: [12.2, 44.4], renk: "#c0392b", yol: [[12.5, 41.9]], yol_satir: 1 }] })] };
    assert.deepEqual(mapProblems(marching), [], "a marching army is a route on the map");
    // The Hannibal test (22 Oct 2026): Saguntum fell with the army standing in rows; a one-word card scene needs no set.
    const legion = { ad: "Carthaginian army", duzen: "ordu" };
    const siege = { ...scene("s3", "Saguntum gates", ["After eight months, Saguntum fell."]), ortam: { zaman: "aksam", manzara: "sur_onu", uslup: "roma" }, kalabalik: [legion] };
    assert.ok(mapProblems({ sahneler: [siege] }).some((p) => p.includes('scene "s3": line 0 tells the crowd moving or fighting') && p.includes('"satir": 0')));
    assert.deepEqual(mapProblems({ sahneler: [{ ...siege, kalabalik: [{ ...legion, hareket: { tur: "hucum", satir: 0 } }] }] }), [], "a charging crowd is fine");
    const card = { ...scene("s10", "kelime", ["Elephants."]), yazi_karti: [{ metin: "ELEPHANTS", stil: "kelime" }] };
    assert.deepEqual(mapProblems({ sahneler: [card] }), [], "a one-word card over black needs no living set");
  });

  await scenario("close maps by the writer (the 1456 Belgrade run, 23 Oct 2026): a side's formation moved into its yerler, set and mood values mapped, a fortress without walls asked for", () => {
    const draft = {
      sahneler: [
        { id: "s4", duygu: "tense and dramatic", ortam: { zaman: "early morning", manzara: "Castle walls at dawn", uslup: "Medieval Hungarian", hava: "smoky", isik: "torches" }, satirlar: [] },
        {
          id: "s6",
          mekan: "Close map: Belgrade Fortress and battlefield",
          satirlar: [{ karakter: "anlatici", metin: "Suddenly everyone is fighting everywhere.", duygu: "notr" }],
          harita: {
            merkez: [20.45, 44.83],
            genislik_km: 18,
            birlikler: [
              { taraf: "Ottomans", renk: "#b3263a", amblem: "hilal", sayi: 8, kusatma: [20.46, 44.83], km: 2, kayip: 4, yerler: [{ konum: [20.46, 44.83], satir: 0 }, { satir: 2 }] },
              { taraf: "Hungarians", renk: "#2f6fb0", amblem: "hac", sayi: 3, kayip: 1, yerler: [{ konum: [20.45, 44.83], satir: 0 }] },
            ],
            yapilar: [{ tur: "kale", ad: "Belgrade Fortress", konum: [20.4503, 44.8233] }],
          },
        },
      ],
    };
    const n = normalizeDraft(draft, []);
    const [s4, s6] = (n.value as { sahneler: Record<string, unknown>[] }).sahneler;
    assert.equal(s4!.duygu, "gerilim");
    assert.deepEqual(s4!.ortam, { zaman: "gun", manzara: "sur_onu", uslup: "ortacag", hava: "sis", isik: "mesale" });
    const [ottomans, hungarians] = (s6!.harita as { birlikler: Record<string, unknown>[] }).birlikler;
    assert.deepEqual(ottomans!.yerler, [{ satir: 0, kusatma: [20.46, 44.83], km: 2 }, { satir: 2, kusatma: [20.46, 44.83], km: 2, kayip: 4 }], "the ring in each formation, the losses on the last");
    assert.ok(!("kusatma" in ottomans!) && !("kayip" in ottomans!));
    assert.deepEqual(hungarians!.yerler, [{ satir: 0, kume: [20.45, 44.83], kayip: 1 }], "a place without a formation is a cluster");
    const found = mapProblems(n.value);
    assert.ok(found.some((p) => p.includes('close map "s6" tells a siege or walls but draws none')), JSON.stringify(found));
  });

  await scenario("tactics (owner, 26 Oct 2026): units by kind round each side's center, charges and sweeps from the narration, one block a side asked to split", () => {
    // Kosovo 1389 as the writer gives it: coordinates only for each side's center; the Serbs to the north.
    const SRB = { taraf: "Serbs", renk: "#3a5eb3", amblem: "kalkan" };
    const OTT = { taraf: "Ottomans", renk: "#3fae3a", amblem: "hilal" };
    const harita = {
      merkez: [21.05, 42.68],
      genislik_km: 16,
      birlikler: [
        { ...SRB, ad: "Serbian knights", tur: "suvari", kanat: "merkez", sayi: 4, yerler: [{ satir: 0, cephe: [[21.035, 42.697], [21.065, 42.697]] }, { satir: 1, hareket: "hucum", hedef: "Janissaries", kayip: 1 }] },
        { ...SRB, ad: "Vuk", tur: "suvari", kanat: "sol", sayi: 3, yerler: [{ satir: 0 }, { satir: 2, hareket: "hucum", hedef: "Bayezid" }] },
        { ...SRB, ad: "Serbian foot", tur: "piyade", kanat: "arka", sayi: 3, yerler: [{ satir: 0 }, { satir: 2, hareket: "ilerle" }] },
        { ...OTT, ad: "Janissaries", tur: "kilicli", kanat: "merkez", sayi: 4, yerler: [{ satir: 0, cephe: [[21.035, 42.668], [21.065, 42.668]], hatlar: 2 }, { satir: 1, kayip: 1 }] },
        { ...OTT, ad: "Ottoman archers", tur: "okcu", kanat: "on", sayi: 3, yerler: [{ satir: 0 }, { satir: 1, hareket: "geri" }] },
        { ...OTT, ad: "Bayezid", tur: "suvari", kanat: "sag", sayi: 3, yerler: [{ satir: 0 }, { satir: 3, hareket: "kusat", hedef: "Serbian knights" }] },
      ],
    };
    const fixes = resolveTactics(harita as never);
    const u = harita.birlikler as unknown as { ad: string; yerler: { cephe?: [number, number][]; uzerinden?: [number, number]; hatlar?: number }[] }[];
    const mid = (c: [number, number][] | undefined) => [(c![0]![0] + c![c!.length - 1]![0]) / 2, (c![0]![1] + c![c!.length - 1]![1]) / 2] as const;
    // The order: facing south the Serbs' left wing is to the east; facing north the Ottomans' right wing is to the east,
    // their archers in front (north) of the Janissaries, the Serbian foot behind (north of) the knights.
    assert.ok(mid(u[1]!.yerler[0]!.cephe)[0] > 21.065, `Serbian left wing east: ${mid(u[1]!.yerler[0]!.cephe)}`);
    assert.ok(mid(u[5]!.yerler[0]!.cephe)[0] > 21.065, `Ottoman right wing east: ${mid(u[5]!.yerler[0]!.cephe)}`);
    assert.ok(mid(u[4]!.yerler[0]!.cephe)[1] > 42.668 && mid(u[4]!.yerler[0]!.cephe)[1] < 42.697, "archers in front of the Janissaries");
    assert.ok(mid(u[2]!.yerler[0]!.cephe)[1] > 42.697, "the reserve behind the knights");
    // The charge reaches the Janissaries' front; the archers fall back; the hold keeps its place; the sweep goes round
    // the knights' flank by a waypoint further out.
    const knights = mid(u[0]!.yerler[1]!.cephe);
    assert.ok(knights[1] > 42.668 && knights[1] - 42.668 < 0.01, `knights at the Janissaries' front: ${knights}`);
    assert.ok(mid(u[4]!.yerler[1]!.cephe)[1] < mid(u[4]!.yerler[0]!.cephe)[1], "archers fall back south");
    assert.deepEqual(u[3]!.yerler[1]!.cephe, u[3]!.yerler[0]!.cephe, "a line without a move holds");
    const sweep = u[5]!.yerler[1]!;
    assert.ok(sweep.uzerinden && sweep.cephe && Math.abs(sweep.uzerinden[0] - 21.05) > Math.abs(mid(sweep.cephe)[0] - 21.05) - 1e-6, JSON.stringify(sweep));
    assert.equal(u[3]!.yerler[0]!.hatlar, 2, "the center's depth is kept");
    assert.ok(fixes.some((f) => f.includes("kanadını dolaşıp kuşatır")) && fixes.some((f) => f.includes("sol kanatta")));
    // A commander speaks from the unit named after him, else from his side's center (not from no side at all, as the
    // speaker matching did when a side became several units).
    const talk = mapSpeakers({ id: "s", satirlar: [{ karakter: "bayezid", metin: "Now!", duygu: "kararli" }, { karakter: "lazar", metin: "Hold!", duygu: "notr" }], harita } as never, [
      { id: "bayezid", ad: "Bayezid", rol: "Ottoman prince", renk: "#3fae3a", gorunur: true },
      { id: "lazar", ad: "Prince Lazar", rol: "ruler of the Serbs", renk: "#2a4a99", gorunur: true },
    ] as never);
    assert.deepEqual(talk.sideBadges.map((b) => [b.karakter, b.taraf]), [["bayezid", 5], ["lazar", 0]]);
    // Written formations always win; a second run changes nothing.
    const again = JSON.stringify(harita);
    assert.deepEqual(resolveTactics(harita as never), []);
    assert.equal(JSON.stringify(harita), again);
    // Kosovo as it was written (one block a side, "Janissaries, infantry, cavalry"): split, by kind, with moves.
    const lone = {
      id: "s5",
      mekan: "Close map: the field of Kosovo",
      satirlar: [{ karakter: "anlatici", metin: "The Serbian cavalry charges.", duygu: "notr" }, { karakter: "anlatici", metin: "Both sides take heavy losses.", duygu: "notr" }],
      harita: { merkez: [21.05, 42.68], genislik_km: 16, birlikler: [
        { ...SRB, sayi: 6, tur: "suvari", etiket: "Heavy cavalry, infantry", yerler: [{ satir: 0, cephe: [[21.03, 42.69], [21.07, 42.69]] }, { satir: 1, cephe: [[21.03, 42.672], [21.07, 42.672]], kayip: 2 }] },
        { ...OTT, sayi: 7, tur: "piyade", etiket: "Janissaries, infantry, cavalry", yerler: [{ satir: 0, cephe: [[21.03, 42.67], [21.07, 42.67]] }, { satir: 1, cephe: [[21.03, 42.67], [21.07, 42.67]], kayip: 2 }] },
      ] },
    };
    const asked = mapProblems({ donem: "1389", oyuncu_kadrosu: [], sahneler: [lone] } as unknown as Episode).join("\n");
    assert.match(asked, /"Heavy cavalry, infantry"\) is several kinds of troops/);
    assert.match(asked, /is a field battle but "Serbs" and "Ottomans" are one block/);
    assert.match(writingPrompt({ konu: "Kosovo", donem: "1389", hedefSureSn: 180, ton: "epik", dil: "en" }, CATALOG), /SPLIT EACH SIDE INTO ITS BODIES OF TROOPS[\s\S]*"hareket": "ilerle"[\s\S]*TELL THE BATTLE STEP\s+BY STEP/);
    // Owner, after the Mohács trial: the guns behind the Janissaries (they stood in front until indirect fire), the whole
    // battle in one narrator line and the units moving on the commanders' jokes.
    const battery = (year: number) => {
      const m = { merkez: [18.65, 45.94], genislik_km: 30, birlikler: [
        { ...OTT, ad: "Janissaries", tur: "tufekci", kanat: "merkez", sayi: 4, yerler: [{ satir: 0, cephe: [[18.6, 45.92], [18.7, 45.92]] }] },
        { ...OTT, ad: "Artillery", tur: "topcu", kanat: "arka", sayi: 3, yerler: [{ satir: 0 }] },
        { ...SRB, ad: "Hungarian horse", tur: "suvari", kanat: "merkez", sayi: 4, yerler: [{ satir: 0, cephe: [[18.6, 45.98], [18.7, 45.98]] }] },
      ] };
      resolveTactics(m as never, "harita", year);
      const c = (m.birlikler[1]!.yerler[0] as unknown as { cephe: [number, number][] }).cephe;
      return (c[0]![1] + c[1]![1]) / 2;
    };
    assert.ok(battery(1526) > 45.92, "1526: the guns in front of the Janissaries");
    assert.ok(battery(1916) < 45.92, "1916: the guns behind (indirect fire)");
    // A siege (the Siege of Baghdad Short, 13 Nov 2026: Janissaries and guns inside the walls before the breach, the
    // garrison one heap mid-town): besiegers outside in order — guns nearest the attacked wall, foot behind — the
    // garrison on that wall; the breach's own line is the story's and stays.
    const siege = {
      merkez: [44.42, 33.35], genislik_km: 8,
      surlar: [{ ad: "Walls", noktalar: [[44.41, 33.34], [44.43, 33.34], [44.43, 33.36], [44.41, 33.36]], gedik: { konum: [44.42, 33.36], satir: 1 } }],
      birlikler: [
        { ...OTT, ad: "Janissaries", tur: "piyade", kanat: "merkez", sayi: 4, yerler: [{ satir: 0, cephe: [[44.415, 33.355], [44.425, 33.355]] }, { satir: 1, cephe: [[44.418, 33.358], [44.422, 33.358]] }] },
        { ...OTT, ad: "Guns", tur: "topcu", kanat: "on", sayi: 3, yerler: [{ satir: 0, cephe: [[44.416, 33.349], [44.424, 33.349]] }] },
        { ...OTT, ad: "Horse", tur: "suvari", kanat: "sag", sayi: 3, yerler: [{ satir: 0, cephe: [[44.404, 33.37], [44.408, 33.37]] }] },
        { taraf: "Safavids", ad: "Garrison", tur: "piyade", kanat: "merkez", sayi: 4, yerler: [{ satir: 0, kume: [44.42, 33.35] }] },
      ],
    };
    const siegeFixes = siegeOrder(siege as never);
    const sMid = (u: number, e = 0) => { const c = (siege.birlikler[u]!.yerler[e] as unknown as { cephe: [number, number][] }).cephe; return [(c[0]![0] + c[1]![0]) / 2, (c[0]![1] + c[1]![1]) / 2] as const; };
    assert.equal(siegeFixes.length, 3, siegeFixes.join("\n"));
    assert.ok(sMid(1)[1] > 33.36 && sMid(0)[1] > sMid(1)[1], `guns outside the north wall, the foot behind them: ${sMid(1)} ${sMid(0)}`);
    assert.ok(Math.abs(sMid(3)[1] - 33.36) < 0.002, `the garrison on the attacked wall: ${sMid(3)}`);
    assert.deepEqual(sMid(0, 1).map((v) => Math.round(v * 1e4) / 1e4), [44.42, 33.358], "the storm through the breach is the story's");
    assert.deepEqual(sMid(2).map((v) => Math.round(v * 1e4) / 1e4), [44.406, 33.37], "a unit already outside keeps its place");
    assert.deepEqual(siegeOrder({ merkez: [44.42, 33.35], genislik_km: 8, birlikler: siege.birlikler } as never), [], "no walls, no siege order");
    const packed = mapProblems({ donem: "1526", oyuncu_kadrosu: [], sahneler: [{
      id: "s5", mekan: "Close map: Mohács",
      satirlar: [{ karakter: "anlatici", metin: "The Hungarians charge, the Ottomans hold, then surround them.", duygu: "notr" }, { karakter: "ibrahim", metin: "A plan!", duygu: "mutlu" }, { karakter: "suleiman", metin: "Classic.", duygu: "notr" }],
      harita: { merkez: [18.65, 45.94], genislik_km: 30, birlikler: [
        { ...SRB, ad: "Hungarian foot", tur: "piyade", kanat: "merkez", sayi: 3, yerler: [{ satir: 0, cephe: [[18.6, 45.98], [18.7, 45.98]] }, { satir: 1, hareket: "hucum", hedef: "Janissaries", cephe: [[18.6, 45.93], [18.7, 45.93]], kayip: 1 }] },
        { ...SRB, ad: "Hungarian horse", tur: "suvari", kanat: "sol", sayi: 2, yerler: [{ satir: 0, cephe: [[18.72, 45.98], [18.76, 45.98]] }] },
        { ...OTT, ad: "Janissaries", tur: "tufekci", kanat: "merkez", sayi: 4, yerler: [{ satir: 0, cephe: [[18.6, 45.92], [18.7, 45.92]] }, { satir: 1, kayip: 1 }] },
        { ...OTT, ad: "Sipahis", tur: "suvari", kanat: "sag", sayi: 3, yerler: [{ satir: 0, cephe: [[18.72, 45.92], [18.76, 45.92]] }, { satir: 2, hareket: "kusat", hedef: "Hungarian foot", cephe: [[18.6, 45.95], [18.6, 45.97]] }] },
      ] },
    }] } as unknown as Episode).join("\n");
    assert.match(packed, /the battle is not told step by step — units move on lines 1, 2, spoken by a character/);
  });

  await scenario("the normaliser's battle passes (the Mohács trials, 26 Oct 2026): blocks capped, moves onto the narrator's line, the map fitted to the armies, no info card over the fighting", () => {
    const HUN = { taraf: "Hungarians", renk: "#2f6fb0", amblem: "hac" };
    const OTT = { taraf: "Ottomans", renk: "#b3263a", amblem: "hilal" };
    const say = (karakter: string, metin: string) => ({ karakter, metin, duygu: "notr" });
    const draft = {
      donem: "1526",
      sahneler: [{
        id: "s5",
        mekan: "Close map: Mohács battlefield",
        satirlar: [
          say("anlatici", "The Hungarians launched a frontal assault."),
          say("ibrahim", "Let's see if they like surprises."),
          say("anlatici", "The Hungarian cavalry charged the Janissaries."),
          say("suleiman", "I love it when a plan comes together."),
          say("anlatici", "The Hungarian army collapsed."),
          say("anlatici", "Hungary lost its king."),
        ],
        bilgi_kartlari: [
          { tur: "liste", baslik: "Why the Ottomans Won", satir: 1, maddeler: [{ metin: "Superior planning", satir: 1 }, { metin: "More cannons", satir: 1 }, { metin: "Encirclement", satir: 3 }] },
          { tur: "sayac", satir: 2, deger: 14000, etiket: "Hungarians killed" },
        ],
        harita: {
          merkez: [18.68, 45.94],
          genislik_km: 32,
          birlikler: [
            { ...HUN, ad: "Hungarian cavalry", tur: "suvari", kanat: "merkez", sayi: 6, yerler: [{ satir: 0, cephe: [[18.67, 45.96], [18.69, 45.96]] }, { satir: 3, hareket: "hucum", hedef: "Janissaries", kayip: 2 }, { satir: 4, bozgun: true, kayip: 2 }] },
            { ...HUN, ad: "Hungarian infantry", tur: "piyade", kanat: "sol", sayi: 3, yerler: [{ satir: 0 }, { satir: 3, hareket: "hucum", kayip: 1 }] },
            { ...HUN, ad: "Hungarian right wing", tur: "suvari", kanat: "sag", sayi: 3, yerler: [{ satir: 0 }, { satir: 4, hareket: "geri", bozgun: true }] },
            { ...OTT, ad: "Janissaries", tur: "tufekci", kanat: "merkez", sayi: 7, yerler: [{ satir: 0, cephe: [[18.67, 45.93], [18.69, 45.93]] }, { satir: 4, kayip: 3 }] },
            { ...OTT, ad: "Ottoman artillery", tur: "topcu", kanat: "arka", sayi: 3, yerler: [{ satir: 0 }] },
            { ...OTT, ad: "Sipahi cavalry", tur: "suvari", kanat: "sag", sayi: 6, yerler: [{ satir: 0 }, { satir: 4, hareket: "kusat", hedef: "Hungarian cavalry" }] },
          ],
        },
      }],
    };
    const n = normalizeDraft(draft, []);
    const s5 = (n.value as { sahneler: Record<string, unknown>[] }).sahneler[0]!;
    const map = s5.harita as { genislik_km: number; merkez: [number, number]; birlikler: { ad: string; sayi: number; yerler: { satir: number; kayip?: number }[] }[] };
    const unit = (ad: string) => map.birlikler.find((u) => u.ad === ad)!;
    // capUnitBlocks: a side of three units draws each with at most four blocks, losses scaled and never all of them.
    assert.equal(unit("Janissaries").sayi, 4);
    assert.deepEqual(unit("Janissaries").yerler.map((y) => y.kayip ?? 0), [0, 2], "3 of 7 lost → 2 of 4");
    assert.equal(unit("Sipahi cavalry").sayi, 4);
    assert.deepEqual(unit("Hungarian cavalry").yerler.map((y) => y.kayip ?? 0), [0, 1, 1], "4 of 6 lost → 2 of 4, one a line");
    // narrateMoves: the charge told on the sultan's joke goes to the narrator's line before it.
    assert.deepEqual(unit("Hungarian cavalry").yerler.map((y) => y.satir), [0, 2, 4]);
    assert.deepEqual(unit("Hungarian infantry").yerler.map((y) => y.satir), [0, 2]);
    assert.ok(n.fixes.some((f) => f.includes('"Hungarian cavalry": 3. satırdaki (bir karakterin sözü) hareket anlatıcının 2. satırına alındı')), n.fixes.join("\n"));
    // fitBattleMap: armies 3 km apart on a 32 km map → the map narrows on them (the tactics may widen it a little again).
    assert.ok(map.genislik_km >= 4 && map.genislik_km < 16, `fitted: ${map.genislik_km} km`);
    assert.ok(Math.abs(map.merkez[1] - 45.945) < 0.01, `centred on the armies: ${map.merkez}`);
    assert.ok(n.fixes.some((f) => f.includes("meydan savaşı haritası ordulara oturtuldu (32 km →")), n.fixes.join("\n"));
    // clearBattleCards: the moves are on lines 2 and 4; the list ends where the charge starts, its last item coming in
    // after the others, and the counter told on the charge goes after the battle.
    const [why, killed] = s5.bilgi_kartlari as { satir: number; bitis_satir?: number; maddeler?: { satir?: number }[] }[];
    assert.deepEqual([why!.satir, why!.bitis_satir, why!.maddeler!.map((m) => m.satir)], [1, 2, [1, 1, undefined]]);
    assert.deepEqual([killed!.satir, killed!.bitis_satir], [5, undefined]);
    assert.ok(n.fixes.some((f) => f.includes('"Why the Ottomans Won": 2. satırda birlikler hareket ediyor — kart orada biter')), n.fixes.join("\n"));
    assert.deepEqual(clearBattleCards(s5), [], "a second pass changes nothing");
    assert.deepEqual(mapProblems(n.value as unknown as Episode).filter((p) => p.includes("bilgi")), []);
    // A card on the battle's last line goes before its first move; off a close map nothing is touched.
    const last = { satirlar: [say("anlatici", "They stand."), say("anlatici", "They flee.")], bilgi_kartlari: [{ tur: "sayac", satir: 1, deger: 5, etiket: "x" }], harita: { genislik_km: 10, birlikler: [{ ...HUN, yerler: [{ satir: 0 }, { satir: 1, bozgun: true }] }, { ...OTT, yerler: [{ satir: 0 }] }] } };
    const wide = structuredClone({ ...last, harita: { ...last.harita, genislik_km: 900 } });
    assert.ok(clearBattleCards(last)[0]!.includes("kart savaştan önceye (0. satır) alındı"));
    assert.deepEqual(last.bilgi_kartlari, [{ tur: "sayac", satir: 0, bitis_satir: 1, deger: 5, etiket: "x" }]);
    assert.deepEqual(clearBattleCards(wide), []);
  });

  await scenario("dialogue in a Short told on the map (Zanzibar, 4 Nov 2026): a badge's one line makes a map scene's dialogue; a stage scene still needs two", () => {
    const line = (karakter: string) => ({ karakter, metin: "x", duygu: "notr" });
    const ep = {
      oyuncu_kadrosu: [{ id: "anlatici", gorunur: false }, { id: "khalid", gorunur: true }, { id: "rawson", gorunur: true }],
      sahneler: [
        { id: "s1", satirlar: [line("khalid")] },
        { id: "s2", harita: { merkez: [39.19, -6.16], genislik_km: 30 }, satirlar: [line("anlatici"), line("rawson")] },
        { id: "s3", harita: { merkez: [39.19, -6.16], genislik_km: 8 }, satirlar: [line("anlatici"), line("khalid")] },
        { id: "s4", harita: { merkez: [39.19, -6.16], genislik_km: 8 }, satirlar: [line("anlatici")] },
        { id: "s5", satirlar: [line("rawson"), line("khalid")] },
      ],
    } as unknown as Episode;
    assert.equal(dialogueSceneRatio(ep), 0.2, "a long video as before: only s5");
    assert.equal(dialogueSceneRatio(ep, { short: true }), 0.6, "a Short: s2, s3 (badge lines) and s5; never the narrator alone, never one line on stage");
  });

  await scenario("Waterloo (6 Nov 2026): the Prussians placed at Plancenoit, off the writer's map, are taken in — the climax is on screen", () => {
    const harita = {
      merkez: [4.4, 50.7],
      genislik_km: 10,
      birlikler: [
        { taraf: "France", ad: "French infantry", tur: "piyade", kanat: "merkez", renk: "#2f6fb0", sayi: 5, yerler: [{ satir: 0, cephe: [[4.41, 50.695], [4.42, 50.695]] }, { satir: 2, hareket: "ilerle", cephe: [[4.402, 50.699], [4.412, 50.699]] }] },
        { taraf: "United Kingdom", ad: "British squares", tur: "piyade", kanat: "merkez", renk: "#c0392b", sayi: 5, yerler: [{ satir: 0, cephe: [[4.39, 50.705], [4.4, 50.705]] }] },
        { taraf: "Prussia", ad: "Prussian infantry", tur: "piyade", kanat: "sol", renk: "#1f2d55", sayi: 4, yerler: [{ satir: 2, cephe: [[4.45, 50.66], [4.46, 50.66]] }] },
      ],
      rozetler: [{ karakter: "blucher", konum: [4.45, 50.66], satir: 2 }],
    };
    const map = structuredClone(harita) as unknown as Record<string, unknown> & { merkez: [number, number]; genislik_km: number };
    const fixes = fitBattleMap(map, "s3");
    assert.ok(fixes[0]?.includes("haritanın dışında kalan birlik ya da rozet haritaya alındı"), fixes.join("\n"));
    const kmLon = 111.32 * Math.cos((map.merkez[1] * Math.PI) / 180);
    const inside = (p: [number, number]) => Math.abs(p[0] - map.merkez[0]) * kmLon <= map.genislik_km / 2 && Math.abs(p[1] - map.merkez[1]) * 110.57 <= (map.genislik_km * 9) / 16 / 2;
    assert.ok(inside([4.45, 50.66]) && inside([4.39, 50.705]), `Plancenoit and the British line both on the map: ${JSON.stringify([map.merkez, map.genislik_km])}`);
    // Through the normaliser: the second fit (after the tactics) does not crop them out again.
    const ep = { id: "w", baslik: "W", konu: "Waterloo", donem: "1815", oyuncu_kadrosu: [], sahneler: [{ id: "s3", satirlar: [{ karakter: "anlatici", metin: "They attack." }, { karakter: "anlatici", metin: "Hold." }, { karakter: "anlatici", metin: "Blücher's Prussians arrive." }], harita: structuredClone(harita) }] };
    const out = normalizeDraft(ep, []).value as { sahneler: { harita: { merkez: [number, number]; genislik_km: number } }[] };
    const m2 = out.sahneler[0]!.harita;
    const kmLon2 = 111.32 * Math.cos((m2.merkez[1] * Math.PI) / 180);
    assert.ok(Math.abs(4.45 - m2.merkez[0]) * kmLon2 <= m2.genislik_km / 2 && Math.abs(50.66 - m2.merkez[1]) * 110.57 <= (m2.genislik_km * 9) / 16 / 2, `still inside after the tactics: ${JSON.stringify(m2)}`);
  });

  await scenario("Taranto (11 Nov 2026): an invented admiral with a made-up article and a ranked, full-named invented pilot stop the script; the real cast passes", async () => {
    const articles: Record<string, { title: string; text: string }> = {
      "Andrew Cunningham, 1st Viscount Cunningham of Hyndhope": { title: "Andrew Cunningham, 1st Viscount Cunningham of Hyndhope", text: "Admiral of the Fleet Andrew Browne Cunningham ..." },
      "Inigo Campioni": { title: "Inigo Campioni", text: "Inigo Campioni was an Italian admiral ..." },
      "Horatio Nelson": { title: "Horatio Nelson, 1st Viscount Nelson", text: "Vice-Admiral Horatio Nelson ..." },
    };
    const lookup = async (t: string) => articles[t] ?? ("missing" as const);
    const cast = (list: { id: string; ad: string; wiki?: string }[]) => ({ oyuncu_kadrosu: [{ id: "anlatici", ad: "Narrator", gorunur: false }, ...list.map((c) => ({ id: c.id, ad: c.ad, gorunur: true, ...(c.wiki ? { portre: { wiki: c.wiki } } : {}) }))] }) as never;
    const faulty = await inventedPeople(cast([
      { id: "cunningham", ad: "Admiral Andrew Cunningham", wiki: "Andrew Cunningham, 1st Viscount Cunningham of Hyndhope" },
      { id: "pignati", ad: "Admiral Luigi de Pignati", wiki: "Luigi de Pignati" },
      { id: "pilot", ad: "Lt. Bill Jenkins" },
      { id: "sailor", ad: "Giuseppe" },
    ]), lookup);
    assert.equal(faulty.length, 2, faulty.join("\n"));
    assert.ok(faulty[0]!.includes("Luigi de Pignati") && faulty[0]!.includes("not a real person"));
    assert.ok(faulty[1]!.includes("Lt. Bill Jenkins") && faulty[1]!.includes("rank and a full name"));
    // Roles, nationalities and first names are no people; a real one's article must be about them.
    assert.deepEqual(await inventedPeople(cast([{ id: "a", ad: "Admiral Inigo Campioni", wiki: "Inigo Campioni" }, { id: "b", ad: "Swordfish Pilot" }, { id: "c", ad: "Italian Admiral" }, { id: "d", ad: "Cilician Pirate Chief" }, { id: "e", ad: "Captain Giuseppe" }]), lookup), []);
    assert.ok((await inventedPeople(cast([{ id: "a", ad: "Admiral Inigo Campioni", wiki: "Horatio Nelson" }]), lookup))[0]!.includes("someone else"));
    // An offline Wikipedia decides nothing.
    assert.deepEqual(await inventedPeople(cast([{ id: "p", ad: "Admiral Luigi de Pignati", wiki: "Luigi de Pignati" }]), async () => "error" as const), []);
    // Siege of Baghdad (13 Nov 2026): the Safavid commander the verified facts name is real without his own article;
    // the facts must name him in full (a surname alone, or another man, proves nothing).
    const baghdad = "The Safavid commander, Bektash Khan, had made extensive repairs to the fortifications.";
    assert.deepEqual(await inventedPeople(cast([{ id: "b", ad: "Bektash Khan", wiki: "Bektash Khan" }, { id: "s", ad: "General Saru Khan" }]), lookup, `${baghdad}\nKilling their commander Saru Khan in his own tent.`), []);
    assert.equal((await inventedPeople(cast([{ id: "b", ad: "Bektash Khan", wiki: "Bektash Khan" }]), lookup)).length, 1);
    assert.equal((await inventedPeople(cast([{ id: "x", ad: "Imam Quli Khan", wiki: "Imam Quli Khan (Baghdad)" }, { id: "y", ad: "Captain Rustam Mirza" }]), lookup, baghdad)).length, 2);
  });

  await scenario("the Guadalcanal Short's dawn map (12 Nov 2026): the planes a narrator line names fly on it, the ship it tells sunk goes down on it, a dawn map is no night map", async () => {
    const line = (metin: string, karakter = "anlatici") => ({ karakter, metin, duygu: "notr" as const });
    const base = episode();
    // s5-hiei-doomed as the writer left it: one still ship for 9 s, planes and the sinking only on Abe's joke.
    const hiei = { tur: "gemi" as const, renk: "#a39b6a", sayi: 1, konum: [159.91, -9.19] as [number, number], satir: 0, kayip: 1, kayip_satir: 1 };
    const planes = { tur: "ucak" as const, renk: "#5f5f34", sayi: 3, konum: [160.05, -9.42] as [number, number], satir: 1, yol: [[160.05, -9.42], [159.91, -9.19]] as [number, number][], yol_satir: 1, hedef: [159.91, -9.19] as [number, number] };
    const scene = {
      ...base.sahneler[1]!,
      id: "s5-hiei-doomed",
      mekan: "Close map: Savo Sound",
      satirlar: [line("At dawn, U.S. planes from Henderson Field and Enterprise finish off Hiei. Abe has to abandon ship. Hiei is scuttled."), line("Well, there goes my ride home.", base.sahneler[1]!.satirlar[0]!.karakter)],
      harita: { merkez: [159.91, -9.19] as [number, number], genislik_km: 20, zaman: "gece" as const, araclar: [hiei, planes], tarih: [{ satir: 0, metin: "Dawn, 14 Nov 1942" }] },
    };
    const ep = { ...base, donem: "1942", sahneler: [base.sahneler[0]!, scene] } as unknown as Episode;
    const told = vehiclesOnToldLine(ep);
    const h = told.episode.sahneler[1]!.harita!;
    assert.deepEqual([h.araclar![1]!.satir, h.araclar![1]!.yol_satir], [0, 0], "the planes fly with the line that names them");
    assert.equal(h.araclar![0]!.kayip_satir, 0, "Hiei goes down on the line that tells it");
    assert.equal(h.zaman, "safak");
    assert.equal(told.fixes.length, 3, told.fixes.join(" | "));
    assert.ok(validateEpisode(told.episode).ok);
    assert.equal(vehiclesOnToldLine(told.episode).fixes.length, 0, "a second pass changes nothing");
    // MapBuilder times the loss at the told word: "scuttled" is one now (else she sank at the line's start, before the planes).
    assert.ok(TOLD_WORDS.kayip.test("scuttled"));
    // Not named on the line before (a character's line, or the narrator speaking of something else): left alone.
    const quiet = { ...scene, satirlar: [line("Abe's flagship drifts, her rudder jammed."), scene.satirlar[1]!] };
    assert.equal(vehiclesOnToldLine({ ...ep, sahneler: [base.sahneler[0]!, { ...quiet, harita: { ...scene.harita, zaman: undefined } }] } as unknown as Episode).fixes.length, 0);
    // Ships are named on every naval line: a ship's route is never moved by its word.
    const sailing = { ...scene, satirlar: [line("Washington's ships close in."), line("Then they turn.")], harita: { ...scene.harita, zaman: undefined, araclar: [{ ...hiei, kayip: undefined, kayip_satir: undefined, yol: [[159.91, -9.19], [159.95, -9.2]] as [number, number][], yol_satir: 1 }] } };
    assert.equal(vehiclesOnToldLine({ ...ep, sahneler: [base.sahneler[0]!, sailing] } as unknown as Episode).fixes.length, 0);
    // The night battle's date keeps its night, even when its narration tells the sinking "by dawn" (s6).
    const nightLine = line("The next night, Lee's battleships arrive; Kirishima is gone by dawn.");
    assert.equal(vehiclesOnToldLine({ ...ep, sahneler: [base.sahneler[0]!, { ...quiet, satirlar: [nightLine], harita: { ...scene.harita, araclar: [], tarih: [{ satir: 0, metin: "Night, 14–15 Nov 1942" }] } }] } as unknown as Episode).fixes.length, 0);
    assert.equal(vehiclesOnToldLine({ ...ep, sahneler: [base.sahneler[0]!, { ...quiet, satirlar: [nightLine], harita: { ...scene.harita, araclar: [], tarih: undefined } }] } as unknown as Episode).fixes.length, 0, "undated: a line that says night too");
    // The director's pass runs it before aiming the planes.
    assert.equal(directBattleMaps(ep).episode.sahneler[1]!.harita!.araclar![1]!.yol_satir, 0);
  });

  await scenario("the Taranto Short's maps (owner, 11 Nov 2026): planes flying at a sunk ship strike it; the opening map rings the town its first line names and the carrier sails from line 0", async () => {
    const line = (metin: string) => ({ karakter: "anlatici", metin, duygu: "notr" as const });
    const base = episode();
    const planes = { tur: "ucak" as const, renk: "#3a7e6b", sayi: 6, konum: [17.23, 40.49] as [number, number], satir: 0, yol: [[17.23, 40.49], [17.25, 40.47]] as [number, number][], yol_satir: 1 };
    const ship = { tur: "gemi" as const, renk: "#b3263a", sayi: 3, konum: [17.25, 40.47] as [number, number], satir: 0, kayip: 1, kayip_satir: 1 };
    const opening = {
      ...base.sahneler[0]!,
      id: "s2-map-intro",
      mekan: "Map: Central Mediterranean",
      satirlar: [line("The night of November 11, 1940. Taranto, Italy: the heart of the Italian battle fleet."), line("From the south, HMS Illustrious launches 21 biplanes."), line("Vintage ones.")],
      harita: { merkez: [17.2, 40.5] as [number, number], genislik_km: 1200, sehirler: [{ ad: "Malta", konum: [14.5, 35.9] as [number, number] }, { ad: "Taranto", konum: [17.25, 40.47] as [number, number] }], kamera: [{ satir: 0, merkez: [17.2, 40.5] as [number, number], genislik_km: 1200 }], araclar: [{ tur: "gemi" as const, renk: "#2e4a7d", sayi: 1, konum: [15.7, 36.9] as [number, number], satir: 1, yol: [[15.7, 36.9], [17.25, 40.47]] as [number, number][], yol_satir: 2 }] },
    };
    const raid = { ...base.sahneler[1]!, id: "s5-harbor-attack", mekan: "Close map: Taranto harbor", satirlar: [line("Torpedoes drop."), line("Two Swordfish are shot down.")], harita: { merkez: [17.25, 40.47] as [number, number], genislik_km: 10, araclar: [planes, { ...planes, konum: [17.27, 40.45] as [number, number], hedef: [17.26, 40.46] as [number, number] }, ship, { ...planes, konum: [17.2, 40.5] as [number, number], yol: [[17.2, 40.5], [17.22, 40.48]] as [number, number][] }] } };
    const ep = { ...base, donem: "1940", sahneler: [opening, raid] } as unknown as Episode;
    // Item 1: the planes flying at the battleship that goes down get it as their target; the writer's target stays, a
    // route ending elsewhere is left alone.
    const aimed = aimPlanesAtShips(ep);
    assert.deepEqual(aimed.episode.sahneler[1]!.harita!.araclar!.map((a) => a.hedef), [[17.25, 40.47], [17.26, 40.46], undefined, undefined]);
    assert.deepEqual(aimed.fixes, ["s5-harbor-attack: araclar[0] uçakları battığı anlatılan gemiyi hedef alır"]);
    assert.ok(validateEpisode(aimed.episode).ok);
    // A ship that is not lost is no target: the planes fly past it.
    assert.equal(aimPlanesAtShips({ ...ep, sahneler: [{ ...raid, harita: { ...raid.harita, araclar: [planes, { ...ship, kayip: undefined, kayip_satir: undefined }] } }] } as unknown as Episode).fixes.length, 0);
    // Item 4: nothing happened on the opening map's line 0 — Taranto (named there, not the map's first city) gets its
    // ring with that line and the carrier sails from it.
    const opened = openOpeningMap(ep);
    const h = opened.episode.sahneler[0]!.harita!;
    assert.deepEqual(h.vurgular, [{ satir: 0, konum: [17.25, 40.47] }]);
    assert.deepEqual([h.araclar![0]!.satir, h.araclar![0]!.yol_satir], [0, 0]);
    assert.equal(opened.fixes.length, 2, opened.fixes.join(" | "));
    assert.ok(validateEpisode(opened.episode).ok);
    assert.equal(opened.episode.sahneler[1], ep.sahneler[1], "only the story's first map");
    assert.equal(openOpeningMap(opened.episode).fixes.length, 0, "a second pass changes nothing: line 0 now moves");
    // A first line that already moves is kept; a route told from line 3 on is told by its own line.
    assert.equal(openOpeningMap({ ...ep, sahneler: [{ ...opening, harita: { ...opening.harita, kamera: [{ satir: 0, merkez: [17.25, 40.47], genislik_km: 300 }] } }] } as unknown as Episode).fixes.length, 0);
    const late = openOpeningMap({ ...ep, sahneler: [{ ...opening, satirlar: [...opening.satirlar, line("Then it sails.")], harita: { ...opening.harita, araclar: [{ ...opening.harita.araclar[0]!, satir: 3, yol_satir: 3 }] } }] } as unknown as Episode);
    assert.deepEqual([late.episode.sahneler[0]!.harita!.araclar![0]!.yol_satir, late.fixes.length], [3, 1]);
    // No city named in line 0: the map's first city.
    assert.deepEqual(openOpeningMap({ ...ep, sahneler: [{ ...opening, satirlar: [line("Night falls on the sea."), ...opening.satirlar.slice(1)] }] } as unknown as Episode).episode.sahneler[0]!.harita!.vurgular, [{ satir: 0, konum: [14.5, 35.9] }]);
    // The director's pass runs both.
    const directed = directBattleMaps(ep);
    assert.ok(directed.episode.sahneler[1]!.harita!.araclar![0]!.hedef && directed.episode.sahneler[0]!.harita!.vurgular?.length === 1);
    // 12 Nov 2026: the writer is told the map's time of day (the night raid was drawn in daylight), and a model's own word
    // for it is mapped, not refused.
    const prompt = writingPrompt({ konu: "Taranto", donem: "1940", hedefSureSn: 60, ton: "mizahi", dil: "en" }, CATALOG);
    assert.ok(prompt.includes(`"zaman": "gece"`) && /searchlights/.test(prompt), "the map's night is in the writer's prompt");
    const night = normalizeDraft({ ...ep, sahneler: [{ ...raid, harita: { ...raid.harita, zaman: "night" } }] }, []);
    assert.equal((night.value as Episode).sahneler[0]!.harita!.zaman, "gece");
    assert.ok(night.fixes.includes(`sahneler[0].harita.zaman "night" → gece`), night.fixes.join(" | "));
    assert.ok(validateEpisode(night.value).ok);
  });

  await scenario("the Baghdad Short's two greens (owner, 13 Nov 2026, \"haritada ülkelerin rengi aynı\"): a side too close to another shown with it is recoloured everywhere, a side keeps one colour and its shades", () => {
    // The writer's colours: Ottomans #3fae3a (their conquests #7fdc7a, a shade), Safavids #556B2F — both green.
    const unit = (taraf: string, renk: string, ad: string) => ({ taraf, renk, ad, amblem: "kalkan", sayi: 4, yerler: [{ satir: 0, kume: [44.42, 33.35] }] });
    const draft = () => ({
      sahneler: [
        { id: "wide", harita: { merkez: [40, 36], genislik_km: 2000, bolgeler: [{ ad: "Ottoman Empire", renk: "#3fae3a" }, { ad: "Ottoman Conquests 1600–1638", renk: "#7fdc7a" }, { ad: "Safavid Persia", renk: "#556B2F" }], guc: [{ satir: 0, taraflar: [{ ad: "Ottomans", renk: "#3fae3a", sayi: "108,589" }, { ad: "Safavids", renk: "#556B2F", sayi: "~20,000" }] }] } },
        { id: "walls", harita: { merkez: [44.42, 33.35], genislik_km: 6, birlikler: [unit("Ottomans", "#3fae3a", "Janissaries"), unit("Safavids", "#556B2F", "Garrison")], oklar: [{ noktalar: [[44.4, 33.3], [44.42, 33.35]], renk: "#556B2F" }, { noktalar: [[44.4, 33.3], [44.42, 33.35]], renk: "#3fae3a" }] } },
        // The writer's slip: the Ottomans in another green in the last scene.
        { id: "assault", harita: { merkez: [44.42, 33.35], genislik_km: 6, birlikler: [unit("Ottomans", "#2e8b57", "Janissaries"), unit("Safavids", "#556B2F", "Garrison")] } },
      ],
    });
    assert.ok(tooClose("#3fae3a", "#556B2F") && tooClose("#3fae3a", "#206040"), "green and olive, green and dark green: one colour to the eye");
    assert.ok(!tooClose("#3fae3a", "#e67e22") && !tooClose("#c0392b", "#e67e22") && !tooClose("#3fae3a", "#7a64b8"), "green/orange, crimson/orange, green/purple tell apart");
    const d = draft();
    const fixes = sideColours(d.sahneler);
    const [wide, walls, assault] = d.sahneler as unknown as { harita: { bolgeler?: { ad: string; renk: string }[]; birlikler?: { taraf: string; renk: string }[]; guc?: { taraflar: { ad: string; renk: string }[] }[]; oklar?: { renk: string }[] } }[];
    const safavid = wide!.harita.bolgeler![2]!.renk;
    assert.notEqual(safavid.toLowerCase(), "#556b2f", fixes.join(" | "));
    assert.ok(STATE_COLOURS.includes(safavid) && !tooClose(safavid, "#3fae3a") && !tooClose(safavid, "#7fdc7a"), `a palette colour far from both Ottoman greens: ${safavid}`);
    // The same new colour on the side everywhere: its state, its bar, its blocks in both scenes, its arrow.
    assert.deepEqual([wide!.harita.guc![0]!.taraflar[1]!.renk, walls!.harita.birlikler![1]!.renk, assault!.harita.birlikler![1]!.renk, walls!.harita.oklar![0]!.renk], [safavid, safavid, safavid, safavid]);
    // The Ottomans keep their colour, their conquests stay their lighter shade, and their blocks are one colour.
    assert.deepEqual([wide!.harita.bolgeler![0]!.renk, wide!.harita.bolgeler![1]!.renk, walls!.harita.birlikler![0]!.renk, assault!.harita.birlikler![0]!.renk, walls!.harita.oklar![1]!.renk], ["#3fae3a", "#7fdc7a", "#3fae3a", "#3fae3a", "#3fae3a"]);
    assert.ok(fixes.some((f) => f.includes('"Ottomans"') && f.includes("#2e8b57 → #3fae3a")) && fixes.some((f) => f.includes("Safavid") && f.includes(`→ ${safavid}`)), fixes.join(" | "));
    // Colours that already tell apart are left alone; so is a side the writer named twice in one colour (Venice's state,
    // the Venetians' blocks), and a side's shade that is also a palette step.
    const calm = { sahneler: [{ harita: { bolgeler: [{ ad: "Roman Republic", renk: "#c0392b" }, { ad: "Carthage", renk: "#e67e22" }, { ad: "Republic of Venice", renk: "#4f86c6" }], birlikler: [unit("Venetians", "#4f86c6", "Fleet"), unit("Ottomans", "#3fae3a", "Navy")] } }] };
    assert.deepEqual(sideColours(calm.sahneler), []);
    // Two sides fighting in one scene in the very same colour are still two sides.
    const twins = { sahneler: [{ harita: { birlikler: [unit("Hungarians", "#c0392b", "Knights"), unit("Ottomans", "#c0392b", "Sipahis")] } }] };
    assert.equal(sideColours(twins.sahneler).length, 1);
    assert.notEqual(twins.sahneler[0]!.harita.birlikler[1]!.renk, "#c0392b");
    assert.equal(twins.sahneler[0]!.harita.birlikler[0]!.renk, "#c0392b", "the side introduced first keeps its colour");
    // Wired into the draft normaliser.
    const n = normalizeDraft(draft(), []);
    const out = n.value as { sahneler: { harita: { bolgeler?: { renk: string }[] } }[] };
    assert.equal(out.sahneler[0]!.harita.bolgeler![2]!.renk, safavid, n.fixes.join(" | "));
  });

  await scenario("the main character closes every video with a subscribe invitation (owner, 13 Nov 2026, the Baghdad Short ended on the narrator)", () => {
    const cast = [{ id: "anlatici", ad: "Narrator", gorunur: false }, { id: "murad", ad: "Murad IV", gorunur: true }, { id: "soldier", ad: "Soldier", gorunur: true }];
    const line = (karakter: string, metin: string) => ({ karakter, metin, duygu: "notr" as const });
    const base = { oyuncu_kadrosu: cast, sahneler: [
      { id: "s1", satirlar: [line("murad", "Forty days!"), line("murad", "Attack!"), line("soldier", "Run!")] },
      { id: "s6", sahne_duzeni: [{ karakter: "soldier", x: 0.6 }], satirlar: [line("anlatici", "Murad builds a kiosk.")] },
    ] } as unknown as Episode;
    assert.equal(mainCharacter(base), "murad");
    // Named in the topic wins over the most lines (the Baghdad Short picked the Safavid soldier).
    assert.equal(mainCharacter({ ...base, oyuncu_kadrosu: [...cast, { id: "bektash", ad: "Bektash Khan", gorunur: true }] } as unknown as Episode, "1638 Siege of Baghdad: Bektash Khan holds"), "bektash");
    const added = ensureClosingLine(base, "en", "Crowns & Doodles");
    const last = added.episode.sahneler.at(-1)!;
    assert.equal(last.satirlar.at(-1)!.karakter, "murad");
    assert.ok(/subscribe to Crowns & Doodles/.test(last.satirlar.at(-1)!.metin), last.satirlar.at(-1)!.metin);
    assert.ok(last.sahne_duzeni!.some((b) => b.karakter === "murad"), "the main character is put on stage");
    // A narrator invitation the writer wrote is handed to the main character; one already his is left alone.
    const narrated = { ...base, sahneler: [base.sahneler[0]!, { ...base.sahneler[1]!, satirlar: [line("anlatici", "Subscribe for more sieges!")] }] } as Episode;
    const handed = ensureClosingLine(narrated, "en", "Crowns & Doodles").episode.sahneler.at(-1)!.satirlar;
    assert.deepEqual([handed.length, handed[0]!.karakter, handed[0]!.metin], [1, "murad", "Subscribe for more sieges!"]);
    assert.deepEqual(ensureClosingLine(ensureClosingLine(base, "en", "C").episode, "en", "C").fixes, []);
    // A map ending gets no new speaker (one without a badge cannot speak there).
    const mapEnd = { ...base, sahneler: [base.sahneler[0]!, { ...base.sahneler[1]!, harita: { merkez: [0, 0], genislik_km: 10 } }] } as unknown as Episode;
    assert.deepEqual(ensureClosingLine(mapEnd, "en", "C").fixes, []);
    assert.ok(closingText("tr", "Crowns & Doodles").metin.includes("abone"));
  });

  console.log(`V3 script smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
