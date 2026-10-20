/**
 * V3 smoke: likenesses of real people (portrait + period note → drawn face and costume) and distinct looks for every
 * named character. Pure functions only (no network, no spend, no render).
 * Run: npx tsx scripts/smoke-v3-likeness.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { toRenderCast } from "../src/lib/v3/costumes/CastMapper";
import { distinctLooks } from "../src/lib/v3/costumes/LookVariety";
import { partOrders, partProblems, partPrompt } from "../src/lib/v3/costumes/PartDesigner";
import { AGES, type CastCostume, type Episode, EYE_STYLES, FACE_SHAPES, HAIR_STYLES, NOSES } from "../src/lib/v3/episode/EpisodeTypes";
import { validateEpisode } from "../src/lib/v3/episode/EpisodeValidator";
import { appearanceSentences, applySheet, likenessOrders, periodNotePrompt, readPeriodNote, sheetPrompt } from "../src/lib/v3/faces/LikenessDesigner";

let scenarios = 0;
function scenario(name: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
  scenarios++;
}

const legionary = (): CastCostume => ({ giysi: "tunik", renkler: { ana: "#b8283a", ikincil: "#e8b23a", ic: "#fffbe5", sus: "#b0b0b0" }, bas: "yeni:Roman legionary helmet with a red crest", ayakkabi: "kahve-cizme" });

function episode(): Episode {
  return {
    id: "rubicon",
    baslik: "Crossing the Rubicon",
    konu: "Julius Caesar crosses the Rubicon",
    donem: "49 BC",
    hedef_sure_sn: 30,
    ton: "mizahi",
    kaynaklar: [{ id: "wiki-caesar", kunye: "Wikipedia, Julius Caesar" }],
    oyuncu_kadrosu: [
      { id: "anlatici", ad: "Narrator", rol: "narrator", kostum_paketi: "", renk: "#333333", ses_id: "en-anlatici", konusma_tarzi: "dry", gorunur: false },
      { id: "caesar", ad: "Caesar", rol: "Roman general, age 50", kostum_paketi: "gardirop", renk: "#b3263a", ses_id: "en-genc-lider", konusma_tarzi: "bold", gorunur: true, portre: { wiki: "Julius Caesar" }, kostum: { giysi: "toga", renkler: { ana: "#f3d27a", ikincil: "#e8b23a", ic: "#fffbe5", sus: "#b3263a" }, ayakkabi: "kahve-cizme" } },
      { id: "legionary", ad: "Marcus", rol: "legionary", kostum_paketi: "gardirop", renk: "#7a1f2b", ses_id: "en-gur-asker", konusma_tarzi: "gruff", gorunur: true, kostum: legionary() },
      { id: "legionary2", ad: "Lucius", rol: "legionary", kostum_paketi: "gardirop", renk: "#2f6b3a", ses_id: "en-telasli", konusma_tarzi: "nervous", gorunur: true, kostum: legionary() },
      { id: "senator", ad: "Senator", rol: "senator", kostum_paketi: "gardirop", renk: "#2f6fb0", ses_id: "en-yasli-temkinli", konusma_tarzi: "pompous", gorunur: true, kostum: { giysi: "toga", renkler: { ana: "#fffbe5", ikincil: "#b0b0b0", ic: "#e8e8e8", sus: "#7c4a03" }, ayakkabi: "siyah-cizme" } },
    ],
    sahneler: [
      {
        id: "s1",
        sure_hedef: 12,
        mekan: "Rubicon river",
        arka_plan_sorgusu: { tr: "Rubicon", en: "Rubicon" },
        duygu: "merak",
        muzik_ruh_hali: "gizemli",
        kalabalik: [{ ad: "legion", kostum_paketi: "gardirop", sayi: 8, duzen: "ordu", kostum: legionary() }],
        satirlar: [
          { karakter: "anlatici", metin: "In 49 BC Caesar reached a small river.", duygu: "notr", kaynak: ["wiki-caesar"] },
          { karakter: "caesar", metin: "The die is cast.", duygu: "kararli", kurgu: true },
          { karakter: "legionary", metin: "Is that a good thing?", duygu: "saskin", kurgu: true },
          { karakter: "legionary2", metin: "Nobody tells us anything.", duygu: "uzgun", kurgu: true },
          { karakter: "senator", metin: "This is most irregular!", duygu: "kizgin", kurgu: true },
        ],
      },
    ],
  };
}

const SHEET = {
  yuz: { sekil: "uzun", ten: "#f1dcc6", burun: "kemerli", kas_renk: "#5b4a3a", yas: "orta" },
  sac: { stil: "seyrek", renk: "#5b4a3a" },
  sac_parca: null,
  bas: "yeni:Julius Caesar's laurel wreath of narrow green bay leaves tied at the back with a red ribbon",
  sakal: null,
  biyik: null,
  giysi: "toga",
  renkler: { ana: "#f2efe6", ikincil: "#7a1f3d", ic: "#e8e2d4", sus: "#7a1f3d" },
  yaka: "yok",
  gogus: null,
  el_on: "yeni:Julius Caesar's short Roman gladius",
  tarif: "A lean, balding Roman general with a laurel wreath and a purple-bordered toga.",
};

function main() {
  scenario("A: appearance sentences — only the ones about looks and dress", () => {
    const text = "Caesar was born in 100 BC. Suetonius says he was tall, fair-complexioned and had keen black eyes. He combed his thin hair forward to hide his baldness. He crossed the Rubicon in 49 BC. He wore a purple toga and red boots on formal occasions.";
    const s = appearanceSentences(text);
    assert.equal(s.length, 3);
    assert.ok(s.every((x) => !/crossed the Rubicon|born in/.test(x)));
    assert.match(s[1]!, /baldness/);
  });

  scenario("B: period note — read, bounded, age optional", () => {
    const n = readPeriodNote('{"yas": 50, "gorunus": "lean, balding, clean-shaven", "giyim": "general\'s red cloak over a tunic", "simge": "", "fark": "busts show him older"}');
    assert.equal(n?.yas, 50);
    assert.match(n!.giyim, /red cloak/);
    assert.equal(readPeriodNote('{"yas": "fifty", "gorunus": "x", "giyim": "y"}')?.yas, undefined);
    assert.equal(readPeriodNote("no json"), undefined);
    const ep = episode();
    const p = periodNotePrompt(ep.oyuncu_kadrosu[1]!, ep, "Julius Caesar", ["He combed his thin hair forward."]);
    assert.match(p, /IN 49 BC/);
    assert.match(p, /combed his thin hair/);
  });

  scenario("C: likeness sheet → costume: face, detailed eyes, orders cut to 80 chars, null removes", () => {
    const base: CastCostume = { ...episode().oyuncu_kadrosu[1]!.kostum!, sakal: "byzantine-1453/sakal-koyu" };
    const r = applySheet(base, SHEET);
    assert.deepEqual(r.kostum.yuz, { goz: "detayli", sekil: "uzun", burun: "kemerli", yas: "orta", ten: "#f1dcc6", kas_renk: "#5b4a3a" });
    assert.equal(r.kostum.sakal, undefined, "clean-shaven in 49 BC: the script's beard goes");
    assert.ok(r.kostum.bas!.startsWith("yeni:Julius Caesar's laurel") && r.kostum.bas!.length <= 85);
    assert.deepEqual(r.kostum.sac, { stil: "seyrek", renk: "#5b4a3a" });
    assert.equal(r.kostum.renkler.ikincil, "#7a1f3d");
    assert.equal(r.sorunlar.length, 0);
    const ep = episode();
    const next = { ...ep, oyuncu_kadrosu: ep.oyuncu_kadrosu.map((c) => (c.id === "caesar" ? { ...c, kostum: r.kostum } : c)) };
    assert.ok(validateEpisode(next).ok, JSON.stringify(validateEpisode(next).errors));
    assert.deepEqual(likenessOrders(r.kostum).map((o) => o.slot).sort(), ["hand", "head"]);
    assert.match(sheetPrompt(ep.oyuncu_kadrosu[1]!, ep, "Julius Caesar", undefined, "File:Bust.jpg"), /as they looked THEN/);
  });

  scenario("D: an unreadable sheet keeps the script's costume and says so", () => {
    const base = episode().oyuncu_kadrosu[1]!.kostum!;
    const r = applySheet(base, { giysi: "spacesuit", renkler: { ana: "red" }, sac: { stil: "mohawk", renk: "#000000" } });
    assert.equal(r.kostum.giysi, "toga");
    assert.deepEqual(r.kostum.renkler, base.renkler);
    assert.equal(r.kostum.sac, undefined);
    assert.ok(r.sorunlar.some((s) => s.includes("giysi")) && r.sorunlar.some((s) => s.includes("renk")) && r.sorunlar.some((s) => s.includes("saç")));
  });

  scenario("E: a drawn haircut drops the parametric hair; new parts reach the wardrobe orders", () => {
    const r = applySheet(episode().oyuncu_kadrosu[1]!.kostum!, { ...SHEET, sac_parca: "yeni:Julius Caesar's thin hair combed forward over a bald crown", gogus: "yeni:Julius Caesar's gold brooch" });
    assert.equal(r.kostum.sac, undefined);
    const ep = episode();
    const next = { ...ep, oyuncu_kadrosu: ep.oyuncu_kadrosu.map((c) => (c.id === "caesar" ? { ...c, kostum: r.kostum } : c)) };
    const slots = partOrders(next).map((o) => o.slot);
    assert.ok(slots.includes("hair") && slots.includes("chest"));
  });

  scenario("F: distinct looks — twins differ, bare heads get hair, real people and crowds stay", () => {
    const ep = episode();
    const { episode: out, fixes } = distinctLooks(ep);
    const k = (id: string) => out.oyuncu_kadrosu.find((c) => c.id === id)!.kostum!;
    assert.notEqual(k("legionary").renkler.ana, k("legionary2").renkler.ana, "same helmet, same tunic: the colour changes");
    assert.ok(k("senator").sac, "the bare-headed senator gets hair");
    assert.ok(k("caesar").sac, "Caesar had no headwear yet: hair too");
    assert.notEqual(`${k("senator").sac!.stil}${k("senator").sac!.renk}`, `${k("caesar").sac!.stil}${k("caesar").sac!.renk}`);
    assert.deepEqual(out.sahneler[0]!.kalabalik![0]!.kostum, legionary(), "a crowd keeps one shared look");
    assert.ok(fixes.length >= 3);
    assert.ok(validateEpisode(out).ok);
    assert.equal(distinctLooks(out).fixes.length, 0, "a second pass changes nothing");
  });

  scenario("G: render cast — face, drawn hair and chest piece reach the rig", () => {
    const r = applySheet(episode().oyuncu_kadrosu[1]!.kostum!, { ...SHEET, sac_parca: "ortak/sac-kisa-yan", gogus: "ortak/altin-zincir" });
    const [m] = toRenderCast([{ ...episode().oyuncu_kadrosu[1]!, kostum: r.kostum }], "kukla");
    assert.deepEqual(m!.costume.look, { faceShape: "uzun", skin: "#f1dcc6", nose: "kemerli", eyes: "detayli", browColor: "#5b4a3a", age: "orta" });
    assert.equal(m!.costume.hairPart, "ortak/sac-kisa-yan");
    assert.equal(m!.costume.chest, "ortak/altin-zincir");
    assert.equal(m!.costume.hair, undefined);
  });

  scenario("H: validator — likeness fields checked", () => {
    const ep = episode();
    const bad = { ...ep, oyuncu_kadrosu: ep.oyuncu_kadrosu.map((c) => (c.id === "caesar" ? { ...c, kostum: { ...c.kostum!, yuz: { burun: "pointy", ten: "pink" } } } : c)) };
    const v = validateEpisode(bad);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.path.endsWith("kostum.yuz.burun")) && v.errors.some((e) => e.path.endsWith("kostum.yuz.ten")));
  });

  scenario("I: part designer — face frame matches the rig, chin per face shape, haircut must reach the crown", () => {
    const p = partPrompt({ slot: "beard", tarif: "Henry VIII's short red beard" }, "1536", "<svg/>", undefined, undefined, "genis");
    assert.match(p, /eyes at \(-21,-4\) and \(41,-4\)/);
    assert.match(p, /chin is at y = 124/);
    assert.doesNotMatch(partPrompt({ slot: "hand", tarif: "sword" }, "1536", "<svg/>", undefined, undefined, "genis"), /chin is at/);
    const low = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-170 -300 340 380"><path d="M-80 0 L-60 -40 L0 -50 Z" style="fill:#5b4a3a;stroke:#1d1b26;stroke-width:5"/></svg>';
    assert.ok(partProblems(low, "hair").some((s) => s.includes("crown")));
    assert.equal(partProblems(low, "chest").length, 0);
  });

  scenario("J: the JSON schema lists the same choices as the code", () => {
    const schema = JSON.parse(readFileSync(path.join(__dirname, "..", "docs", "v3", "episode.schema.json"), "utf8")) as { $defs: { kostum: { properties: Record<string, { properties?: Record<string, { enum?: string[] }> }> } } };
    const k = schema.$defs.kostum.properties;
    assert.deepEqual(k.sac!.properties!.stil!.enum, [...HAIR_STYLES]);
    assert.deepEqual(k.yuz!.properties!.sekil!.enum, [...FACE_SHAPES]);
    assert.deepEqual(k.yuz!.properties!.burun!.enum, [...NOSES]);
    assert.deepEqual(k.yuz!.properties!.goz!.enum, [...EYE_STYLES]);
    assert.deepEqual(k.yuz!.properties!.yas!.enum, [...AGES]);
  });

  console.log(`V3 likeness smoke: PASS (${scenarios} scenarios)`);
}

main();
