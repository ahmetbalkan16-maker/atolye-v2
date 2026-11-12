/**
 * V3 smoke: script engine and the $1-per-video budget. Fake providers only (no network, no spend).
 * Run: npx tsx scripts/smoke-v3-script.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AIProvider, AIProviderGenerateOptions, AIProviderResult } from "../src/lib/ai/providers/AIProvider";
import type { PackCatalogEntry } from "../src/lib/v3/costumes/CostumePackLoader";
import { applyParts, partOrders, partProblems } from "../src/lib/v3/costumes/PartDesigner";
import type { Episode } from "../src/lib/v3/episode/EpisodeTypes";
import { articleSource, factPrompt, readTopic, researchDepth, resolveTopic, sourceId, topicPrompt, verifyFacts } from "../src/lib/v3/research/SourceResearch";
import { applyFactCheck, callsByName, changesPerson, confirmSupport, correctionSupported, dialogueSceneRatio, extractJson, knownNames, ScriptError, sceneShortfalls, unresolvedErrors, writeScript } from "../src/lib/v3/script/ScriptEngine";
import { factCheckPrompt, wordBudget, writingPrompt } from "../src/lib/v3/script/ScriptPrompts";
import { chapterCount, isLongForm, prefixScenes, readOutline } from "../src/lib/v3/script/LongForm";
import { normalizeDraft } from "../src/lib/v3/script/DraftNormalizer";
import { mapSpeakers } from "../src/lib/v3/maps/MapSpeakers";
import { clearBattleCards, fitBattleMap, resolveTactics } from "../src/lib/v3/maps/Tactics";
import { aimPlanesAtShips, directBattleMaps, livenStillMaps, mapProblems, openOpeningMap } from "../src/lib/v3/script/MapRules";
import { addToldCrowds, crowdProblems, toldGroups } from "../src/lib/v3/script/CrowdRules";
import { addToldStrengths, namesSide, toldNumbers, toldStrengthCard } from "../src/lib/v3/script/ToldNumbers";
import { validateEpisode } from "../src/lib/v3/episode/EpisodeValidator";
import { cachedDiscountUsd, cachedTokensOf, V3Budget, V3BudgetError, videoCapUsd } from "../src/lib/v3/script/V3Budget";
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
    const openai = new FakeProvider([validJson(), "üzgünüm, yapamam"]);
    const out = await writeScript({ brief: { konu: "x", donem: "1452", hedefSureSn: 14, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget: new V3Budget({ providers: { openai } }) });
    assert.equal(out.factCheck.durum, "okunamadi");
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
    assert.ok(factCheckPrompt("{}", "en").includes("legend has it"));
    // A Short (60 s or less, owner 2 Nov 2026): hook in 2 s, one moment, no subscribe line, a loop; longer has none of it.
    const short = writingPrompt({ konu: "Kosovo", donem: "1389", hedefSureSn: 60, ton: "mizahi", dil: "en" }, CATALOG);
    assert.ok(short.includes("YOUTUBE SHORT") && short.includes("within 2 seconds") && short.includes("ONE moment") && short.includes("NO subscribe line") && short.includes("a loop") && short.includes(`about ${wordBudget({ konu: "", donem: "", hedefSureSn: 60, ton: "mizahi", dil: "en" })} spoken words`), short.slice(0, 400));
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
    // A 50 s Short: its words aim at 85% of the ceiling (50 × 0.85 × 1.8 ≈ 77).
    assert.ok(openai.calls[1]!.prompt.startsWith("The JSON episode below has 21 spoken words; the target is about 77. Expand"));
    assert.equal(out.spokenWords, 21 + 6 * 9);
    assert.equal(out.targetWords, 77);
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
    assert.deepEqual(researchDepth(180), { articles: 3, search: 4, facts: "15–30", maxTokens: 6_000, long: false });
    assert.deepEqual(researchDepth(1200), { articles: 6, search: 8, facts: "40–90", maxTokens: 12_000, long: true });
    const article = { title: "Fall of Constantinople", revid: 1, timestamp: "2026-01-01T00:00:00Z", text: "The city fell on 29 May 1453." };
    const long = factPrompt("Fall of Constantinople", "1453", [article], "en", 1200);
    assert.ok(long.includes("long documentary (20 minutes") && long.includes("list 40–90 atomic facts") && long.includes("Cover the WHOLE story in depth"));
    const short = factPrompt("Fall of Constantinople", "1453", [article], "en", 60);
    assert.ok(short.includes("short documentary") && short.includes("list 15–30") && !short.includes("Cover the WHOLE story"));
  });

  await scenario("L2 a Short under its word budget but well over half its ceiling is not sent to a paid expansion round", async () => {
    // 20 s Short: budget 20 × 0.85 × 1.8 ≈ 31 words; the fixture's 21 words are ~68% of it — a normal video's ±10% band
    // would have asked for more (the third Caesar Short: three rounds, all dropped over the ceiling).
    const openai = new FakeProvider([validJson(), JSON.stringify({ iddialar: [] })]);
    const budget = new V3Budget({ providers: { openai } });
    const out = await writeScript({ brief: { konu: "x", donem: "1452", hedefSureSn: 20, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget });
    assert.deepEqual([out.lengthRounds, out.spokenWords, out.targetWords], [0, 21, 31]);
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
  });

  console.log(`V3 script smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
