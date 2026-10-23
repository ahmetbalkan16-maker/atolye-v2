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
import { articleSource, readTopic, resolveTopic, sourceId, topicPrompt, verifyFacts } from "../src/lib/v3/research/SourceResearch";
import { applyFactCheck, extractJson, ScriptError, sceneShortfalls, writeScript } from "../src/lib/v3/script/ScriptEngine";
import { factCheckPrompt, wordBudget, writingPrompt } from "../src/lib/v3/script/ScriptPrompts";
import { chapterCount, isLongForm, prefixScenes, readOutline } from "../src/lib/v3/script/LongForm";
import { normalizeDraft } from "../src/lib/v3/script/DraftNormalizer";
import { livenStillMaps, mapProblems } from "../src/lib/v3/script/MapRules";
import { V3Budget, V3BudgetError, videoCapUsd } from "../src/lib/v3/script/V3Budget";
import { voxcpmLanguages } from "../src/lib/v3/tts/Voxcpm";
import { loadV3Settings, v3Secret } from "../src/lib/v3/V3Paths";

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
        { sahne: "s1-kanca", satir: 1, karar: "yanlis", gerekce: "yaz sonu", yeni_metin: "Hisar 1452 Ağustosunda tamamlandı." },
        { sahne: "s2-divan", satir: 2, karar: "tartismali", yeni_metin: "Rivayete göre kule ustaları kırk gün çalıştı." },
        { sahne: "s1-kanca", satir: 0, karar: "kaynaksiz", kaynak_onerisi: "Runciman 1965" },
        { sahne: "s9", satir: 0, karar: "yanlis", yeni_metin: "x" },
      ],
      genel_not: "kostümler uygun",
    });
    // A 12 s brief fits the fixture's 21 words, so no revision round runs here (see L and M for those).
    const openai = new FakeProvider([JSON.stringify(broken), validJson(), check]);
    const budget = new V3Budget({ providers: { openai } });
    const out = await writeScript({ brief: { konu: "Rumeli Hisarı", donem: "1452", hedefSureSn: 12, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget });
    assert.equal(out.repairs, 1);
    assert.equal(out.lengthRounds, 0);
    assert.ok(openai.calls[1]!.prompt.includes("mekan"), "onarım istemi hatayı söylemeli");
    assert.equal(out.validation.ok, true);
    assert.equal(out.episode.sahneler[0]!.satirlar[1]!.metin, "Hisar 1452 Ağustosunda tamamlandı.");
    assert.equal(out.episode.sahneler[1]!.satirlar[2]!.rivayet, true);
    assert.equal(out.factCheck.uygulanan, 2);
    assert.deepEqual(out.factCheck.iddialar.map((c) => c.sonuc), ["duzeltildi", "rivayet_eklendi", "rapor", "bulunamadi"]);
    assert.equal(budget.ledger.map((e) => e.step).join(","), "senaryo,onarim-1,dogrulama");
    assert.ok(budget.spentUsd > 0 && budget.spentUsd < 1);
  });

  await scenario("G an unreadable fact-check answer marks the episode unchecked instead of passing it", async () => {
    const openai = new FakeProvider([validJson(), "üzgünüm, yapamam"]);
    const out = await writeScript({ brief: { konu: "x", donem: "1452", hedefSureSn: 12, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget: new V3Budget({ providers: { openai } }) });
    assert.equal(out.factCheck.durum, "okunamadi");
  });

  await scenario("H a correction too long for a line is reported, not written", () => {
    const res = applyFactCheck(episode(), [{ sahne: "s1-kanca", satir: 0, karar: "yanlis", yeni_metin: "a".repeat(300) }]);
    assert.equal(res.applied, 0);
    assert.equal(res.claims[0]!.sonuc, "gecersiz_metin");
  });

  await scenario("I prompts carry the contract's values, the catalog and the language's own rules", () => {
    const tr = writingPrompt({ konu: "Fetih", donem: "1453", hedefSureSn: 90, ton: "mizahi", dil: "tr" }, CATALOG);
    for (const needle of ["yumruk_kaldir", "murekkep", "top_atisi", "paket ottoman-1453", "padisah-kavugu", "rivayete göre", `${wordBudget({ konu: "", donem: "", hedefSureSn: 90, ton: "mizahi", dil: "tr" })} konuşulan kelime`]) {
      assert.ok(tr.includes(needle), `tr istemde yok: ${needle}`);
    }
    const en = writingPrompt({ konu: "Fall of Rome", donem: "476", hedefSureSn: 90, ton: "epik", dil: "en" }, CATALOG);
    assert.ok(en.includes("American English") && en.includes("legend has it") && !en.includes("ANLATIM KURALLARI"));
    assert.ok(factCheckPrompt("{}", "en").includes("legend has it"));
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
    const out = await writeScript({ brief: { konu: "x", donem: "1452", hedefSureSn: 12, ton: "mizahi", dil: "tr", kaynakBankasi: bank }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget: new V3Budget({ providers: { openai } }) });
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
    await writeScript({ brief: { konu: "x", donem: "1452", hedefSureSn: 30, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget: new V3Budget({ providers: { openai } }) });
    assert.ok(openai.calls[1]!.prompt.includes("only 0% of scenes have two or more lines by visible characters"), "diyalog eksikliği istenmeli");
  });

  await scenario("L a script far below its spoken-word budget gets one expansion round", async () => {
    const longer = JSON.parse(validJson());
    for (let i = 0; i < 6; i++) longer.sahneler[1].satirlar.push({ karakter: "halil", metin: "Sultanım, bu iş hiç de kolay olmayacak gibi görünüyor.", duygu: "korkmus", kurgu: true });
    const openai = new FakeProvider([validJson(), JSON.stringify(longer), JSON.stringify({ iddialar: [] })]);
    const out = await writeScript({ brief: { konu: "x", donem: "1452", hedefSureSn: 42, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget: new V3Budget({ providers: { openai } }) });
    assert.equal(out.lengthRounds, 1);
    assert.ok(openai.calls[1]!.prompt.startsWith("The JSON episode below has 21 spoken words; the target is about 76. Expand"));
    assert.equal(out.spokenWords, 21 + 6 * 9);
    assert.equal(out.targetWords, 76);
    // A longer version that loses what the map rules won is not taken (they are not asked again after these rounds).
    const lostMap = JSON.parse(JSON.stringify(longer));
    lostMap.sahneler[1].mekan = "Map of the Bosphorus";
    const again = new FakeProvider([validJson(), JSON.stringify(lostMap), JSON.stringify({ iddialar: [] })]);
    const logs: string[] = [];
    const kept = await writeScript({ brief: { konu: "x", donem: "1452", hedefSureSn: 42, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget: new V3Budget({ providers: { openai: again } }), log: (m) => logs.push(m) });
    assert.equal(kept.spokenWords, 21, "the shorter script with its map kept");
    assert.ok(logs.some((m) => m.includes("uzunluk turu 1 harita sorunlarını artırdı (0 → 1)")), logs.join("\n"));
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
    const outline = { ...header, hedef_sure_sn: 720, bolumler: Array.from({ length: 6 }, (_, i) => ({ id: `b${i + 1}-bolum`, baslik: `Bölüm ${i + 1}`, ozet: `Bu bölümde olay ${i + 1} anlatılır, yerleri ve yılları ile birlikte.`, sure_sn: 100 })) };
    // Per chapter: the scenes, one lengthening round (a short chapter) that does not help, the fact check.
    const answers = [JSON.stringify(outline)];
    for (let i = 0; i < 6; i++) answers.push(JSON.stringify({ sahneler }), JSON.stringify({ ...header, sahneler }), JSON.stringify({ iddialar: [] }));
    const openai = new FakeProvider(answers);
    const lines: string[] = [];
    const out = await writeScript({ brief: { konu: "Uzun konu", donem: "1453", hedefSureSn: 720, ton: "mizahi", dil: "tr" }, catalog: CATALOG, writer: { provider: "openai", model: "gpt-4.1" }, checker: { provider: "openai", model: "gpt-4.1" }, budget: new V3Budget({ providers: { openai }, capUsd: 4 }), log: (s) => lines.push(s) });
    assert.equal(openai.calls.length, 19);
    assert.ok(openai.calls[0]!.prompt.includes("STEP 1: THE PLAN") && openai.calls[0]!.prompt.includes("in 6 chapters"));
    assert.ok(openai.calls[1]!.prompt.includes("CHAPTER 1 OF 6") && openai.calls[1]!.prompt.includes("FIXED CAST"));
    assert.ok(openai.calls[4]!.prompt.includes("CHAPTER 2 OF 6") && openai.calls[4]!.prompt.includes("THE STORY SO FAR"));
    assert.ok(openai.calls[16]!.prompt.includes("This is the last chapter"));
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

  console.log(`V3 script smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
