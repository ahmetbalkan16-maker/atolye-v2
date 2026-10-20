/**
 * V3 smoke: likenesses of real people (portrait + period note → drawn face and costume) and distinct looks for every
 * named character. Pure functions only (no network, no spend, no render).
 * Run: npx tsx scripts/smoke-v3-likeness.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toRenderCast } from "../src/lib/v3/costumes/CastMapper";
import { clothesClashes, distinctLooks } from "../src/lib/v3/costumes/LookVariety";
import { partOrders, partProblems, partPrompt } from "../src/lib/v3/costumes/PartDesigner";
import { AGES, type CastCostume, type Episode, EYE_STYLES, FACE_SHAPES, HAIR_STYLES, NOSES } from "../src/lib/v3/episode/EpisodeTypes";
import { validateEpisode } from "../src/lib/v3/episode/EpisodeValidator";
import { appearanceSentences, applySheet, castLooks, cloakFromNote, likenessOrders, noteColours, peopleDir, periodNotePrompt, personVersions, readPeriodNote, sheetPrompt, withNoteCloak } from "../src/lib/v3/faces/LikenessDesigner";
import { LIKENESS_OK, MAX_RETOUCH_ROUNDS, planRetouch, retouchDebate } from "../src/lib/v3/council/RetouchBrain";
import type { V3Paths } from "../src/lib/v3/V3Paths";

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

  scenario("K retouch brain: a weak likeness or a set under the bar starts one more round, never two", () => {
    const likenesses = [
      { castId: "caesar", kisi: "Julius Caesar", kaynak: "tasarim", benzerlik: 8, farklar: ["rounder face"] },
      { castId: "pompey", kisi: "Pompey", kaynak: "tasarim", benzerlik: 6, farklar: ["laurel crown, portrait bare-headed", "cheeks not full enough"] },
      { castId: "cicero", kisi: "Cicero", kaynak: "kutuphane" },
    ];
    const sets = [{ sahne: "s1" }, { sahne: "s4", esikAlti: true, secim: { puan: 5, donem: 8, sorun: "sunset sky" } }];
    const plan = planRetouch({ round: 0, likenesses, sets })!;
    assert.equal(plan.tur, 1);
    assert.equal(plan.adim, "gardirop", "a person redesign starts at the wardrobe");
    assert.deepEqual(plan.kisiler.map((k) => [k.castId, k.puan]), [["pompey", 6]]);
    assert.deepEqual(plan.setler.map((x) => x.sahne), ["s4"]);
    assert.match(retouchDebate(plan).at(-1)!.metin, /1. rötuş turu/);
    assert.equal(planRetouch({ round: 0, likenesses: likenesses.slice(0, 1), sets: [] }), undefined, "nothing weak: no retouch");
    assert.equal(planRetouch({ round: MAX_RETOUCH_ROUNDS, likenesses, sets }), undefined, "the production always ends");
    assert.equal(planRetouch({ round: 0, likenesses: [], sets })!.adim, "gorsel");
    assert.equal(LIKENESS_OK, 8, "owner: the worst acceptable likeness is 8/10");
    assert.deepEqual(planRetouch({ round: 1, likenesses: [{ ...likenesses[1]!, benzerlik: 7 }], sets: [] })?.tur, 2, "a second round for what is still under 8");
  });

  scenario("L people library: versions are never overwritten; a redesign gets the art director's differences", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-kisiler-"));
    const paths = { workRoot: root } as unknown as V3Paths;
    assert.deepEqual(personVersions(paths, "Pompey", "49 BC"), []);
    mkdirSync(peopleDir(paths), { recursive: true });
    writeFileSync(path.join(peopleDir(paths), "pompey--49-bc.json"), "{}");
    writeFileSync(path.join(peopleDir(paths), "pompey--49-bc--v2.json"), "{}");
    assert.deepEqual(personVersions(paths, "Pompey", "49 BC").map((x) => path.basename(x)), ["pompey--49-bc.json", "pompey--49-bc--v2.json"]);
    const ep = episode();
    const p = sheetPrompt(ep.oyuncu_kadrosu[1]!, ep, "Pompey", undefined, undefined, ["laurel crown, portrait bare-headed"]);
    assert.match(p, /FELL SHORT. The art director's differences: laurel crown, portrait bare-headed/);
    assert.doesNotMatch(sheetPrompt(ep.oyuncu_kadrosu[1]!, ep, "Pompey", undefined, undefined), /FELL SHORT/);
  });

  scenario("M cloak: the sheet's pelerin, the historian's cloak as fallback, validated, drawn by the rig", () => {
    const base = episode().oyuncu_kadrosu[1]!.kostum!;
    assert.equal(applySheet(base, { ...SHEET, pelerin: "#a02020" }).kostum.pelerin, "#a02020");
    assert.equal(applySheet({ ...base, pelerin: "#a02020" }, { ...SHEET, pelerin: null }).kostum.pelerin, undefined, "null removes the cloak");
    assert.ok(applySheet(base, { ...SHEET, pelerin: "red" }).sorunlar.some((s) => s.startsWith("pelerin")));
    assert.equal(cloakFromNote("He wore a white Roman general's toga with a purple stripe (toga praetexta), a red military cloak (paludamentum), and a laurel wreath"), "#b3262e");
    assert.equal(cloakFromNote("a white toga with a broad purple stripe, no headwear"), undefined);
    assert.equal(cloakFromNote("a heavy fur-lined mantle"), "#b3262e", "a cloak with no colour word is crimson");
    assert.equal(cloakFromNote("a blue cloak over mail"), "#2f5fa0");
    const note = { gorunus: "", giyim: "toga and a red military cloak (paludamentum)", simge: "", fark: "" };
    assert.equal(withNoteCloak(base, note).pelerin, "#b3262e");
    assert.equal(withNoteCloak({ ...base, pelerin: "#123456" }, note).pelerin, "#123456", "the designer's cloak wins");
    assert.deepEqual(noteColours("white toga with a broad purple stripe"), ["#f3f3f3", "#6b2d7b"]);
    const ep = episode();
    const caped = { ...ep, oyuncu_kadrosu: ep.oyuncu_kadrosu.map((c) => (c.id === "caesar" ? { ...c, kostum: { ...c.kostum!, pelerin: "#b3262e" } } : c)) };
    assert.ok(validateEpisode(caped).ok);
    assert.ok(!validateEpisode({ ...ep, oyuncu_kadrosu: ep.oyuncu_kadrosu.map((c) => (c.id === "caesar" ? { ...c, kostum: { ...c.kostum!, pelerin: "red" } } : c)) }).ok, "a cloak colour must be #RRGGBB");
    const [m] = toRenderCast([caped.oyuncu_kadrosu[1]!], "kukla");
    assert.equal(m!.costume.cape, "#b3262e");
    const schema = JSON.parse(readFileSync(path.resolve("docs/v3/episode.schema.json"), "utf8")) as { $defs: { kostum: { properties: Record<string, unknown> } } };
    assert.ok(schema.$defs.kostum.properties.pelerin, "the schema knows the cloak");
  });

  scenario("N clothes: named characters in the same clothes are told apart, from the historian's colours first", () => {
    const toga = (ikincil: string): CastCostume => ({ giysi: "toga", renkler: { ana: "#f3f3f3", ikincil, ic: "#f6e7d8", sus: "#b8283a" }, ayakkabi: "kahve-mest" });
    const ep = episode();
    const romans: Episode = {
      ...ep,
      oyuncu_kadrosu: [
        ep.oyuncu_kadrosu[0]!,
        { ...ep.oyuncu_kadrosu[1]!, kostum: { ...toga("#b8283a"), bas: "gardirop/laurel-a" } },
        { ...ep.oyuncu_kadrosu[4]!, id: "pompey", ad: "Pompey", portre: { wiki: "Pompey" }, kostum: { ...toga("#b8283a"), bas: "gardirop/laurel-b", pelerin: "#b3262e" } },
        { ...ep.oyuncu_kadrosu[4]!, id: "cicero", ad: "Cicero", renk: "#2f6fb0", portre: { wiki: "Cicero" }, kostum: { ...toga("#b8283a"), sac: { stil: "seyrek", renk: "#e0c080" } } },
      ],
    };
    assert.deepEqual(clothesClashes(romans), ["caesar + cicero"], "Pompey's cloak already sets him apart");
    const { episode: out, fixes } = distinctLooks(romans, new Map([["cicero", noteColours("a white senator's toga with a broad purple stripe")]]));
    const k = (id: string) => out.oyuncu_kadrosu.find((c) => c.id === id)!.kostum!;
    assert.equal(k("caesar").renkler.ikincil, "#b8283a", "the first real person keeps his colours");
    assert.equal(k("cicero").renkler.ikincil, "#6b2d7b", "white is skipped (it is the toga), purple from the note");
    assert.ok(fixes.some((f) => f.includes("tarihçinin notundan")));
    assert.deepEqual(clothesClashes(out), []);
    const noNote = distinctLooks(romans).episode.oyuncu_kadrosu.find((c) => c.id === "cicero")!.kostum!;
    assert.equal(noNote.renkler.ikincil, "#2f6fb0", "without a note: the character's own colour");
    const brownish = { ...romans, oyuncu_kadrosu: romans.oyuncu_kadrosu.map((c) => (c.id === "cicero" ? { ...c, renk: "#8a5a2b" } : c)) };
    assert.equal(distinctLooks(brownish).episode.oyuncu_kadrosu.find((c) => c.id === "cicero")!.kostum!.renkler.ikincil, "#6e1823", "an own colour too close to the red sash gives way to a dark shade");
    assert.equal(distinctLooks(out).fixes.length, 0, "a second pass changes nothing");
    const p = sheetPrompt(romans.oyuncu_kadrosu[3]!, romans, "Cicero", undefined, undefined, undefined, ["Every named character wears different clothes."]);
    assert.match(p, /- Caesar: toga #f3f3f3 with #b8283a, headwear "laurel a"/);
    assert.match(p, /- Pompey: toga #f3f3f3 with #b8283a, cloak #b3262e/);
    assert.match(p, /told apart from every one of them at a glance by the clothes too/);
    assert.match(p, /LESSONS FROM EARLIER EPISODES \(follow them\):\n- Every named character wears different clothes\./);
    assert.match(p, /"pelerin": the colour #RRGGBB of the cloak/);
    assert.deepEqual(castLooks(romans, "caesar").length, 2);
  });

  console.log(`V3 likeness smoke: PASS (${scenarios} scenarios)`);
}

main();
