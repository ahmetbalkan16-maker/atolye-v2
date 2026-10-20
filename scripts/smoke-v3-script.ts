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
import { articleSource, sourceId, verifyFacts } from "../src/lib/v3/research/SourceResearch";
import { applyFactCheck, extractJson, ScriptError, sceneShortfalls, writeScript } from "../src/lib/v3/script/ScriptEngine";
import { factCheckPrompt, wordBudget, writingPrompt } from "../src/lib/v3/script/ScriptPrompts";
import { V3Budget, V3BudgetError } from "../src/lib/v3/script/V3Budget";
import { v3Secret } from "../src/lib/v3/V3Paths";

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

  console.log(`V3 script smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
