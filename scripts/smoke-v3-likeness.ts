/**
 * V3 smoke: likenesses of real people (portrait + period note → drawn face and costume) and distinct looks for every
 * named character. Pure functions only (no network, no spend, no render).
 * Run: npx tsx scripts/smoke-v3-likeness.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toRenderCast } from "../src/lib/v3/costumes/CastMapper";
import { clothesClashes, distinctLooks } from "../src/lib/v3/costumes/LookVariety";
import { designParts, failedPartFinding, hatShapeNotes, type OwnedPart, partAlternatives, type PartRecord, partKey, partOrders, partProblems, partPrompt, SAME_PART_SHARE, similarOwnPart } from "../src/lib/v3/costumes/PartDesigner";
import { familyPart } from "../src/lib/v3/costumes/PartFamilies";
import { erasFor, periodDressBlock, readAtlas } from "../src/lib/v3/costumes/PeriodAtlas";
import { writingPrompt } from "../src/lib/v3/script/ScriptPrompts";
import { costumeProblems, ensureEra, eraPrompt, readEraAnswer, withArchive } from "../src/lib/v3/costumes/PeriodArchivist";
import { AGES, type CastCostume, type Episode, EYE_STYLES, FACE_SHAPES, HAIR_STYLES, NOSES } from "../src/lib/v3/episode/EpisodeTypes";
import { validateEpisode } from "../src/lib/v3/episode/EpisodeValidator";
import { appearanceSentences, applySheet, bestVersion, castLooks, cloakFromNote, partWords, historyLines, keepLikenesses, type LikenessRecord, likenessHistory, likenessOrders, likenessPlateau, noteColours, OLD_COMPLEXION, PORTRAIT_OVER_NOTE, peopleDir, periodNotePrompt, personVersions, readPeriodNote, sheetPrompt, withNoteCloak } from "../src/lib/v3/faces/LikenessDesigner";
import { bestRound, deliverAfterFailedRound, finalDelivery, keepRound, keptRounds, LIKENESS_OK, likenessLessons, MAX_RETOUCH_ROUNDS, planRetouch, restoreRound, retouchDebate, roundImproved, roundLine, roundScore, roundShortfall } from "../src/lib/v3/council/RetouchBrain";
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

async function main() {
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
    assert.ok(!/LESSONS/.test(p), "no lessons: no block");
    // Gallipoli, 10 Nov 2026: the note called Mustafa Kemal "clean-shaven" in 1915; the lesson that corrects it reaches the historian.
    const taught = periodNotePrompt(ep.oyuncu_kadrosu[1]!, ep, "Julius Caesar", [], ["In 49 BC he was balding and combed his hair forward."]);
    assert.match(taught, /THE COSTUME TEAM'S LESSONS[\s\S]*balding and combed his hair forward/);
    assert.match(taught, /they win over your own memory/);
    assert.match(taught, /never a guess/);
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
    // The benchmark clip (22 Oct 2026): a named soldier in the legion's very uniform is lost in it — he gets a cloak, in
    // his own colour unless it is too close to the tunic's.
    assert.equal(k("legionary").pelerin, "#e8b23a", "Marcus's dark red is too close to the red tunic: the gold trim colour");
    assert.equal(k("legionary2").pelerin, undefined, "Lucius already looks different (his tunic's colour changed)");
    assert.ok(fixes.some((f) => f.startsWith("legionary: kalabalıkla aynı kıyafeti giyiyordu")));
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

  scenario("I2: Waterloo (6 Nov 2026) — a bicorne is drawn as a low crescent, not a dome; the period portrait beats the note; old 'brown' complexions stay light", () => {
    assert.match(partPrompt({ slot: "head", tarif: "Napoleon's black bicorne hat with tricolor cockade" }, "1815", "<svg/>"), /SHAPE: A BICORNE is a wide, LOW crescent/);
    assert.match(hatShapeNotes({ slot: "head", tarif: "Wellington's black cocked hat" }), /BICORNE/);
    assert.match(hatShapeNotes({ slot: "head", tarif: "Washington's three-cornered hat" }), /TRICORNE/);
    assert.equal(hatShapeNotes({ slot: "head", tarif: "Roman legionary helmet red crest" }), "");
    assert.equal(hatShapeNotes({ slot: "chest", tarif: "bicorne-shaped brooch" }), "", "only headwear");
    assert.doesNotMatch(partPrompt({ slot: "head", tarif: "laurel wreath" }, "49 BC", "<svg/>"), /SHAPE:/);
    const ep = episode();
    const withPortrait = sheetPrompt(ep.oyuncu_kadrosu[1]!, ep, "Julius Caesar", undefined, "File:Bust.jpg");
    assert.ok(withPortrait.includes(PORTRAIT_OVER_NOTE), "the portrait wins on face, hair and facial hair");
    assert.ok(withPortrait.includes(OLD_COMPLEXION));
    assert.ok(!sheetPrompt(ep.oyuncu_kadrosu[1]!, ep, "Julius Caesar", undefined, undefined).includes(PORTRAIT_OVER_NOTE), "no portrait, nothing to prefer");
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

  scenario("L2 retouch stops by itself: a round no better than the best opens no other; a stuck likeness opens none", () => {
    const r = (tur: number, puan: number, kurul?: number) => ({ tur, kisiler: [{ castId: "caesar", puan }], setler: [], ...(kurul ? { kurul } : {}) });
    assert.equal(roundImproved([], r(0, 7)), true, "the first cut has nothing to beat");
    assert.equal(roundImproved([r(0, 7)], r(1, 6)), false, "worse: stop (Caesar 7 → 6 → 4)");
    assert.equal(roundImproved([r(0, 7)], r(1, 7)), false, "a tie keeps the earlier round and stops");
    assert.equal(roundImproved([r(0, 6)], r(1, 7)), true);
    assert.equal(roundImproved([r(0, 7, 6)], r(1, 7, 8)), true, "the council's better mean counts at equal likeness");
    const plan = { kisiler: [{ castId: "caesar", kisi: "Julius Caesar", puan: 7, farklar: ["hair should be thicker"] }] };
    const [worse] = likenessLessons(plan, r(1, 6), "75 BC", () => "Full short hair, purple-striped toga");
    assert.equal(worse!.sonuc, "ise_yaramadi");
    assert.match(worse!.metin, /Julius Caesar \(75 BC\): redesigning from the notes "hair should be thicker" lowered the likeness 7 → 6\/10 — do not repeat that change/);
    assert.match(worse!.konu, /Julius Caesar 75 BC/, "the designer recalls lessons by the person's name and period");
    assert.equal(likenessLessons(plan, r(1, 8), "75 BC", () => undefined)[0]!.sonuc, "ise_yaradi");
    assert.match(likenessLessons(plan, r(1, 7), "75 BC", () => undefined)[0]!.metin, /did not help/);
    assert.deepEqual(likenessLessons(plan, { tur: 1, kisiler: [], setler: [] }, "75 BC", () => undefined), [], "not measured, nothing learned");
    const v = (benzerlik?: number, tarif = "t", farklar: string[] = []) => ({ file: `f${benzerlik}`, tarif, farklar, ...(benzerlik !== undefined ? { benzerlik } : {}) });
    // Caesar 75 BC as it stood on 3 Nov 2026: seven designs, 7 7 7 7 6 7 6.
    const caesar = [7, 7, 7, 7, 6, 7, 6].map((s, i) => v(s, `design ${i + 1}`));
    assert.equal(likenessPlateau(caesar), true);
    assert.equal(likenessPlateau(caesar.slice(0, 2)), false, "two tries are not enough to call it stuck");
    assert.equal(likenessPlateau([v(5), v(6), v(7)]), false, "still improving");
    assert.equal(likenessPlateau([v(8), v(6), v(6)]), false, "one reached the bar: not stuck");
    assert.equal(likenessPlateau([v(), v(), v(6)]), false, "unchecked designs do not count");
    assert.equal(bestVersion(caesar)!.tarif, "design 6", "the best score, the newest of equal ones — not the newest file");
    assert.equal(bestVersion([v(undefined, "a"), v(undefined, "b")])!.tarif, "b", "nothing checked: the newest");
    assert.equal(bestVersion([]), undefined);
    const lines = historyLines([v(6, "round face", ["hair too full"]), v(7, "oval face"), v(4, "combover")]);
    assert.deepEqual(lines, ['7/10: "oval face"', '6/10: "round face" — art director: hair too full', '4/10: "combover"']);
    const ep = episode();
    const p = sheetPrompt(ep.oyuncu_kadrosu[1]!, ep, "Pompey", undefined, undefined, ["hair"], [], lines);
    assert.match(p, /EARLIER DESIGNS OF Pompey FOR 49 BC, SCORED NEXT TO THE PORTRAIT \(best first\):\n- 7\/10: "oval face"/);
    assert.match(p, /Never undo a feature a better-scored design had/);
    assert.doesNotMatch(sheetPrompt(ep.oyuncu_kadrosu[1]!, ep, "Pompey", undefined, undefined), /EARLIER DESIGNS/);
    const likenesses = [{ castId: "caesar", kisi: "Julius Caesar", kaynak: "tasarim", benzerlik: 7, farklar: ["hair"] }];
    assert.ok(planRetouch({ round: 0, likenesses, sets: [] }));
    assert.equal(planRetouch({ round: 0, likenesses, sets: [], plateau: new Set(["caesar"]) }), undefined, "a stuck likeness opens no round");
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

  scenario("N2 a part named by its id becomes words without the id's hash (Cannae, 9 Nov 2026: \"c72c59\" was read as a colour)", () => {
    assert.equal(partWords("gardirop/hannibal-s-bronze-helmet-with-engraved-b-c72c59", "Hannibal"), "bronze helmet with engraved");
    assert.equal(partWords("gardirop/maharbal-s-bronze-helmet-with-tall-black-0c7b74", "Hannibal"), "maharbal s bronze helmet with tall black", "another person's name stays");
    assert.equal(partWords("gardirop/bicorne-hat-1a2b3c", "Napoleon Bonaparte"), "bicorne hat");
    assert.equal(partWords("yeni:Roman legionary helmet with a red crest"), "Roman legionary helmet with a red crest", "a description keeps its words");
    assert.equal(partWords("gardirop/laurel-a"), "laurel a", "no hash, no cut-off: as before");
    assert.equal(partWords("gardirop/painted-facade"), "painted facade", "a plain word of six hex letters is no hash");
    assert.ok(!/[0-9a-f]{6}/i.test(`yeni:Hannibal's ${partWords("gardirop/hannibal-s-bronze-helmet-with-engraved-b-c72c59", "Hannibal")}`));
  });

  // K2 (files, so outside the synchronous scenarios).
  try {
    // Caesar and the pirates (2 Nov 2026): the likeness went 6 → 7 → 6 and the last round was delivered.
    const at = (tur: number, benzerlik: number, set = 8) => roundScore(tur, { likenesses: [{ castId: "caesar", kisi: "Julius Caesar", kaynak: "tasarim", benzerlik }, { castId: "cato", kisi: "Cato", kaynak: "kutuphane" }], sets: [{ sahne: "s1", ...(set < 7 ? { esikAlti: true } : {}), secim: { puan: set, donem: 9 } }, { sahne: "s2" }] });
    const rounds = [at(0, 6), at(1, 7), at(2, 6)];
    assert.deepEqual(rounds[1], { tur: 1, kisiler: [{ castId: "caesar", puan: 7 }], setler: [{ sahne: "s1", puan: 8, gecti: true }] });
    assert.deepEqual(rounds.map(roundShortfall), [2, 1, 2]);
    assert.equal(bestRound(rounds)!.tur, 1, "the best-scored round");
    assert.equal(bestRound([at(0, 6), at(1, 6)])!.tur, 0, "a retouch replaces a round only when it scored better");
    assert.equal(bestRound([at(0, 9, 5), at(1, 9, 8)])!.tur, 1, "a set redrawn over the bar");
    assert.match(roundLine(at(2, 6, 5)), /^tur 2: caesar 6\/10, s1 seti 5\/10 \(eşik altı 4 puan\)$/);
    // Each round's cut and package are kept; the last round puts the best one back.
    const work = mkdtempSync(path.join(os.tmpdir(), "v3-rotus-"));
    const put = (tur: number) => {
      writeFileSync(path.join(work, "final.mp4"), `video ${tur}`);
      writeFileSync(path.join(work, "QC.md"), `QC ${tur}`);
      writeFileSync(path.join(work, "youtube.json"), `{"tur":${tur}}`);
    };
    put(0);
    writeFileSync(path.join(work, "kapak.jpg"), "kapak 0");
    await keepRound(work, "final.mp4", rounds[0]!);
    put(1);
    rmSync(path.join(work, "kapak.jpg"));
    await keepRound(work, "final.mp4", rounds[1]!);
    put(2);
    assert.deepEqual((await keptRounds(work, "final.mp4", 2)).map((r) => r.tur), [0, 1]);
    await keepRound(work, "final.mp4", rounds[2]!);
    await restoreRound(work, "final.mp4", 1);
    assert.deepEqual(["final.mp4", "QC.md", "youtube.json", "final-tur2.mp4", "tur0/kapak.jpg"].map((n) => readFileSync(path.join(work, n), "utf8")), ["video 1", "QC 1", '{"tur":1}', "video 2", "kapak 0"]);
    assert.equal(existsSync(path.join(work, "kapak.jpg")), false, "the round had no cover");
    // Still under the bar after the last round: the kept round is delivered with a warning, a round over it as it was.
    assert.match(finalDelivery("- Bulgular: 0 eksik\n- Teslim: teslim edildi\n", rounds[0]!), /^- Teslim: UYARIYLA teslim — rötuş turlarından sonra eşik altında kaldı \(tur 0: caesar 6\/10/m);
    assert.equal(finalDelivery("- Teslim: teslim edildi\n", at(1, 9)), "- Teslim: teslim edildi\n");
    scenarios++;
  } catch (e) {
    console.error("FAIL K2 retouch delivers the best-scored round");
    throw e;
  }

  try {
    // The people library's history: every version with its check, oldest first; a missing check counts as unchecked.
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-kisiler-gecmis-"));
    const paths = { workRoot: root } as unknown as V3Paths;
    mkdirSync(peopleDir(paths), { recursive: true });
    const put = (name: string, tarif: string, check?: { benzerlik: number; farklar: string[] }) => {
      writeFileSync(path.join(peopleDir(paths), name), JSON.stringify({ kisi: "Julius Caesar", tarif }));
      if (check) writeFileSync(path.join(peopleDir(paths), `${name}.kontrol.json`), JSON.stringify(check));
    };
    put("julius-caesar--75-bc.json", "oval face", { benzerlik: 7, farklar: ["hair thicker"] });
    put("julius-caesar--75-bc--v2.json", "full hair", { benzerlik: 6, farklar: ["hair too full"] });
    put("julius-caesar--75-bc--v3.json", "no check yet");
    const h = await likenessHistory(paths, "Julius Caesar", "75 BC");
    assert.deepEqual(h.map((x) => [x.tarif, x.benzerlik]), [["oval face", 7], ["full hair", 6], ["no check yet", undefined]]);
    assert.equal(bestVersion(h)!.tarif, "oval face", "a worse retouch is not the look the next episode reuses");
    assert.deepEqual(await likenessHistory(paths, "Pompey", "75 BC"), []);
    scenarios++;
  } catch (e) {
    console.error("FAIL L3 people library history");
    throw e;
  }

  try {
    // The third Caesar Short (3 Nov 2026): round 2 died on OpenAI 429s with rounds 0 (7/10) and 1 (6/10) kept.
    const work = mkdtempSync(path.join(os.tmpdir(), "v3-rotus-hata-"));
    const score = (tur: number, puan: number) => ({ tur, kisiler: [{ castId: "caesar", puan }], setler: [] });
    for (const [tur, puan] of [[0, 7], [1, 6]] as const) {
      writeFileSync(path.join(work, "final.mp4"), `video ${tur}`);
      writeFileSync(path.join(work, "QC.md"), `- Teslim: teslim edildi\n`);
      writeFileSync(path.join(work, "KURUL.md"), `kurul ${tur}\n`);
      await keepRound(work, "final.mp4", score(tur, puan));
    }
    writeFileSync(path.join(work, "final.mp4"), "video 2, half made");
    const best = await deliverAfterFailedRound(work, "final.mp4", 2, "çıkış 1; ayrıntı uret.log");
    assert.equal(best?.tur, 0);
    assert.equal(readFileSync(path.join(work, "final.mp4"), "utf8"), "video 0");
    const qc = readFileSync(path.join(work, "QC.md"), "utf8");
    assert.match(qc, /^- Teslim: UYARIYLA teslim — rötuş turlarından sonra eşik altında kaldı/m);
    assert.match(qc, /tur 0: caesar 7\/10 .* — \*\*teslim edilen\*\*\n- tur 1: caesar 6\/10.*\n- Tur 2 başarısız oldu \(çıkış 1; ayrıntı uret\.log\); teslim: tur 0 \(final-tur0\.mp4\)/);
    assert.match(readFileSync(path.join(work, "KURUL.md"), "utf8"), /^kurul 0\n\n## Rötuş turları/);
    // Nothing kept: the failure stands.
    assert.equal(await deliverAfterFailedRound(mkdtempSync(path.join(os.tmpdir(), "v3-rotus-bos-")), "final.mp4", 1, "çıkış 1"), undefined);
    scenarios++;
  } catch (e) {
    console.error("FAIL K3 a failed retouch round delivers the best kept round");
    throw e;
  }

  try {
    // Owner, 6 Nov 2026: "kendimiz ücretsiz çizebilecek bir şey yok mu" — the Waterloo parts by family, no model at all.
    const orders: [string, string, string][] = [
      ["head", "Napoleon's black bicorne hat with tricolor cockade", "bicorne"],
      ["head", "Wellington's black cocked hat with gold trim and white plume", "bicorne"],
      ["head", "French infantry shako hat", "shako"],
      ["head", "British grenadier bearskin with red plume", "bearskin"],
      ["head", "George Washington's black tricorne with gold trim", "tricorne"],
      ["head", "Lincoln's black top hat", "silindir"],
      ["beard", "Blücher's short white sideburns and moustache", "favori"],
      ["mustache", "Blücher's bushy white moustache", "biyik-gur"],
      ["beard", "Murad I's full white beard", "sakal-uzun"],
      ["chest", "Blücher's orange sash and Prussian medals", "kusak+nisan"],
      ["chest", "gold epaulettes", "apolet"],
      ["hand", "Napoleon's sword at his left side", "kilic-duz"],
      ["hand", "hussar sabre", "kilic-egri"],
      ["hand", "Blücher's marshal's baton", "asa"],
    ];
    for (const [slot, tarif, family] of orders) {
      const f = familyPart({ slot, tarif }, "oval");
      assert.equal(f?.family, family, tarif);
      assert.deepEqual(partProblems(f!.svg, slot as never), [], `${tarif}: in the part frame`);
    }
    assert.equal(familyPart({ slot: "head", tarif: "British grenadier bearskin with red plume" })!.params.renk, "#2a2420", "the plume's red is not the fur's");
    assert.equal(familyPart({ slot: "head", tarif: "British grenadier bearskin with red plume" })!.params.tuy, "#c62839");
    assert.equal(familyPart({ slot: "mustache", tarif: "Blücher's bushy white moustache" })!.params.renk, "#f4f1ea", "a white moustache is hair-white");
    assert.match(familyPart({ slot: "head", tarif: "Napoleon's black bicorne hat with tricolor cockade" })!.params.kokart!, /#2f6fb0,#fffdf6,#c62839/);
    assert.equal(familyPart({ slot: "head", tarif: "Roman legionary helmet with a red crest" }), undefined, "no family: the designer draws it");
    assert.equal(familyPart({ slot: "hand", tarif: "rolled parchment scroll" }), undefined);
    // In the wardrobe: family orders never reach the model, are kept in the library and found there next time.
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-aile-"));
    const paths = { workRoot: root, repoRoot: process.cwd() } as V3Paths;
    const noModel = { generate: async () => { throw new Error("the model was called"); } };
    const run = () => designParts({ paths, orders: orders.slice(0, 3).map(([slot, tarif]) => ({ slot: slot as never, tarif })), donem: "1815", budget: noModel as never, model: { provider: "mock" } as never, judge: noModel as never, workDir: path.join(root, "is"), log: () => undefined });
    const first = await run();
    assert.deepEqual(first.records.map((r) => r.kaynak), ["aile", "aile", "aile"]);
    const pack = JSON.parse(readFileSync(path.join(root, "_kutuphane", "kostum", "gardirop", "pack.json"), "utf8")) as { items: Record<string, { not: string }> };
    assert.equal(Object.keys(pack.items).length, 3);
    assert.ok(Object.keys(pack.items).every((id) => existsSync(path.join(root, "_kutuphane", "kostum", "gardirop", `${id}.svg`))));
    assert.deepEqual((await run()).records.map((r) => r.kaynak), ["kutuphane", "kutuphane", "kutuphane"]);
    rmSync(root, { recursive: true, force: true });
    scenarios++;
  } catch (e) {
    console.error("FAIL L1 parametric families draw the Waterloo parts for free");
    throw e;
  }

  try {
    // Waterloo, 6 Nov 2026: Blücher's "Prussian and allied medals and orange sash" failed three rounds while the library
    // held his 10/10 "orange sash and Prussian medals" — the same person's part said in other words is that part.
    const sash = "Gebhard Leberecht von Blücher's orange sash and Prussian medals";
    const lib: OwnedPart[] = [
      { id: "sash", slot: "chest", tarif: sash, donem: "1815" },
      { id: "orders", slot: "chest", tarif: "Gebhard Leberecht von Blücher's Prussian orders and medals", donem: "1815" },
      { id: "baton", slot: "hand", tarif: "Gebhard Leberecht von Blücher's marshal's baton", donem: "1815" },
      { id: "beard", slot: "beard", tarif: "Miloš Obilić's short-trimmed dark brown beard", donem: "1389" },
      { id: "helmet", slot: "head", tarif: "Roman legionary helmet with red crest", donem: "49 BC" },
    ];
    const order = { slot: "chest" as const, tarif: "Gebhard Leberecht von Blücher's Prussian and allied medals and orange sash" };
    assert.equal(similarOwnPart(order, "1815", lib)?.id, "sash", "the closest of the person's chest parts");
    assert.ok(similarOwnPart(order, "1815", lib)!.share >= SAME_PART_SHARE);
    assert.equal(similarOwnPart(order, "1813", lib), undefined, "another period: drawn for that year");
    assert.equal(similarOwnPart({ ...order, tarif: "Arthur Wellesley's Prussian and allied medals and orange sash" }, "1815", lib), undefined, "another person's part is never theirs");
    assert.equal(similarOwnPart({ ...order, slot: "back" }, "1815", lib), undefined, "another slot");
    assert.equal(similarOwnPart({ slot: "hand", tarif: "Gebhard Leberecht von Blücher's gold marshal's baton" }, "1815", lib), undefined, "a real difference (gold) is drawn");
    assert.equal(similarOwnPart({ slot: "beard", tarif: "Milos Obilic's short, trimmed dark brown beard" }, "1389", lib)?.id, "beard", "punctuation and diacritics do not make another part");
    assert.equal(similarOwnPart({ slot: "head", tarif: "Roman legionary helmet with a red crest" }, "49 BC", lib), undefined, "an ownerless order keeps the exact match only");
    // In the wardrobe: found in the library without a model; a redesign the art director asked for is drawn anew.
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-benzer-parca-"));
    const dir = path.join(root, "_kutuphane", "kostum", "gardirop");
    mkdirSync(dir, { recursive: true });
    const cap = "Harry Rawson's white Royal Navy peaked cap with gold trim and badge";
    writeFileSync(path.join(dir, "pack.json"), JSON.stringify({ schema: 1, id: "gardirop", title: "t", items: { "harry-rawson-cap-1a2b3c": { slot: "head", not: cap } } }));
    writeFileSync(path.join(dir, "harry-rawson-cap-1a2b3c.json"), JSON.stringify({ tarif: cap, slot: "head", donem: "1896" }));
    writeFileSync(path.join(dir, "harry-rawson-cap-1a2b3c.svg"), "<svg/>\n");
    const asked = { slot: "head" as const, tarif: "Harry Rawson's white Royal Navy officer's peaked cap with gold trim" };
    assert.equal(familyPart(asked), undefined, "no family draws it: only the library or the designer");
    const paths = { workRoot: root, repoRoot: process.cwd() } as V3Paths;
    const noModel = { generate: async () => { throw new Error("the model was called"); } };
    const run = (redraw: boolean) => designParts({ paths, orders: [asked], donem: "1896", budget: noModel as never, model: { provider: "mock" } as never, judge: noModel as never, workDir: path.join(root, "is"), log: () => undefined, ...(redraw ? { likeness: new Map([[partKey(asked), { redraw: true }]]) } : {}) });
    const r = await run(false);
    assert.deepEqual(r.records.map((x) => [x.kaynak, x.id]), [["kutuphane", "harry-rawson-cap-1a2b3c"]]);
    assert.equal(r.made.get(partKey(asked)), "harry-rawson-cap-1a2b3c");
    await assert.rejects(run(true), /the model was called/, "a retouch's redesign is not taken from the library");
    rmSync(root, { recursive: true, force: true });
    scenarios++;
  } catch (e) {
    console.error("FAIL L1b the same person's part said in other words comes from the library");
    throw e;
  }

  scenario("L2 period atlas: every costume is valid, the uniforms' hats and moustaches are free family parts, the writer gets its era", () => {
    const atlas = readAtlas(process.cwd());
    assert.ok(atlas.donemler.length >= 6, `${atlas.donemler.length} eras`);
    for (const era of atlas.donemler)
      for (const side of era.taraflar)
        for (const role of side.roller) {
          const ep = episode();
          const dressed = { ...ep, oyuncu_kadrosu: ep.oyuncu_kadrosu.map((c) => (c.id === "caesar" ? { ...c, kostum: role.kostum } : c)) };
          assert.ok(validateEpisode(dressed).ok, `${era.id} / ${side.ad} / ${role.rol}: ${JSON.stringify(validateEpisode(dressed).errors.slice(0, 2))}`);
          // The eras with a family for every part order: nothing goes to the paid designer.
          if (era.id === "napolyon" || era.id === "amerikan-devrimi")
            for (const [field, slot] of [["bas", "head"], ["sakal", "beard"], ["biyik", "mustache"], ["gogus", "chest"]] as const) {
              const v = (role.kostum as unknown as Record<string, string | undefined>)[field];
              const m = v ? /^yeni:\s*(.+)$/.exec(v) : null;
              if (m) assert.ok(familyPart({ slot, tarif: m[1]! }), `${era.id} / ${side.ad} / ${role.rol}: "${m[1]}" has no family`);
            }
        }
    assert.deepEqual(erasFor(atlas, "1815").map((e) => e.id), ["napolyon"]);
    assert.deepEqual(erasFor(atlas, "49 BC").map((e) => e.id), ["roma"]);
    assert.deepEqual(erasFor(atlas, "1453").map((e) => e.id), ["osmanli-yukselis"]);
    assert.deepEqual(erasFor(atlas, "1600").map((e) => e.id), [], "no era: nothing");
    const block = periodDressBlock(atlas, "1815")!;
    assert.match(block, /^PERIOD DRESS — Napoleonic Wars \(1792–1815\)/);
    assert.match(block, /- Prussia: officer \{"giysi":"uniforma","renkler":\{"ana":"#1f2d55"/, "Blücher's side is dark blue, not green");
    assert.equal(periodDressBlock(atlas, "1600"), undefined);
    const prompt = writingPrompt({ konu: "Waterloo", donem: "1815", hedefSureSn: 60, ton: "mizahi", dil: "en", donemKiyafetleri: block }, []);
    assert.ok(prompt.indexOf("PERIOD DRESS") > prompt.indexOf("COSTUME CATALOG") && prompt.indexOf("PERIOD DRESS") < prompt.indexOf("ALLOWED VALUES"));
    assert.ok(!writingPrompt({ konu: "Waterloo", donem: "1815", hedefSureSn: 60, ton: "mizahi", dil: "en" }, []).includes("PERIOD DRESS"));
  });

  try {
    // Waterloo, 6 Nov 2026: Blücher's checked face was dropped because his medals failed. A failed medal, sash or sword
    // keeps the likeness; a failed moustache, beard, hair or hat does not (the face is incomplete).
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-kisi-sakla-"));
    const paths = { workRoot: root } as unknown as V3Paths;
    const ep = episode();
    const rec = (castId: string, kisi: string, siparisler: string[]): LikenessRecord => ({ castId, kisi, donem: "1815", kaynak: "tasarim", tarif: "t", siparisler, sorunlar: [] });
    const records = [rec("caesar", "Gebhard Leberecht von Blücher", ["Blücher's medals and orange sash", "Blücher's white moustache"]), rec("senator", "Arthur Wellesley", ["Wellington's bicorne"])];
    const parts: PartRecord[] = [
      { tarif: "Blücher's medals and orange sash", slot: "chest", kaynak: "basarisiz", denemeler: 3 },
      { tarif: "Blücher's white moustache", slot: "mustache", kaynak: "tasarim", denemeler: 2 },
      { tarif: "Wellington's bicorne", slot: "head", kaynak: "basarisiz", denemeler: 3 },
    ];
    const kept = await keepLikenesses(paths, ep, records, parts);
    assert.deepEqual([...kept.keys()], ["caesar"], "a failed medal keeps the face; a failed hat does not");
    assert.deepEqual(personVersions(paths, "Gebhard Leberecht von Blücher", "1815").map((x) => path.basename(x)), ["gebhard-leberecht-von-blucher--1815.json"]);
    assert.ok(!existsSync(path.join(peopleDir(paths), "arthur-wellesley--1815.json")));
    const failedMoustache = parts.map((p) => (p.slot === "mustache" ? { ...p, kaynak: "basarisiz" as const } : p));
    assert.equal((await keepLikenesses(paths, ep, [rec("legionary", "Someone Else", ["Blücher's white moustache"])], failedMoustache)).size, 0, "a failed moustache: not kept");
    rmSync(root, { recursive: true, force: true });
    scenarios++;
  } catch (e) {
    console.error("FAIL L4 the people library keeps a likeness whose only failed part is an accessory");
    throw e;
  }

  try {
    // Approved Kostüm beyni proposal (Caesar and the pirates): a failed part tells its last rejection beside the parts the
    // studio already has that could replace it; another person's face part is never offered.
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-alternatif-"));
    const lib = path.join(root, "_kutuphane", "kostum", "gardirop");
    mkdirSync(lib, { recursive: true });
    const items = {
      "roman-legionary-helmet-0a0b0c": { slot: "head", not: "Roman legionary helmet with a red crest" },
      "golden-laurel-wreath-a1b2c3": { slot: "head", not: "golden laurel wreath" },
      "laurel-wreath-crown-d4e5f6": { slot: "head", not: "Augustus's laurel wreath crown" },
      "golden-laurel-sceptre-777777": { slot: "hand", not: "golden laurel sceptre" },
      "pompey-s-short-brown-hair-111111": { slot: "hair", not: "Pompey's short brown hair" },
      "short-brown-hair-222222": { slot: "hair", not: "short brown hair" },
    };
    writeFileSync(path.join(lib, "pack.json"), JSON.stringify({ schema: 1, id: "gardirop", title: "gardırop", items }));
    const paths = { workRoot: root, repoRoot: process.cwd() } as V3Paths;
    let calls = 0;
    const noSvg = { generate: async () => (calls++, { result: { content: "I cannot draw that.", finishReason: "stop", refused: false, complete: true, truncated: false }, used: { provider: "mock" } }) };
    const lines: string[] = [];
    const wreath = { slot: "head" as const, tarif: "Caesar's golden laurel wreath" };
    const hair = { slot: "hair" as const, tarif: "Caesar's short brown hair" };
    const out = await designParts({ paths, orders: [wreath, hair], donem: "75 BC", budget: noSvg as never, model: { provider: "mock" } as never, judge: noSvg as never, workDir: path.join(root, "is"), log: (s) => lines.push(s) });
    assert.equal(calls, 6, "three rounds each");
    assert.deepEqual(out.records.map((r) => r.kaynak), ["basarisiz", "basarisiz"]);
    assert.deepEqual(out.records[0]!.alternatifler, ["gardirop/golden-laurel-wreath-a1b2c3", "gardirop/laurel-wreath-crown-d4e5f6"], "most shared words first; the helmet and the sceptre are not a wreath");
    assert.deepEqual(out.records[1]!.alternatifler, ["gardirop/short-brown-hair-222222", "ortak/sac-kisa-yan"], "the hand-drawn haircut too; never Pompey's hair");
    assert.ok(lines.some((l) => l.includes(`"Caesar's golden laurel wreath" 3 turda kabul edilmedi; bu parça kostümden çıkarıldı — yerine geçebilecek: gardirop/golden-laurel-wreath-a1b2c3, gardirop/laurel-wreath-crown-d4e5f6`)), lines.join("\n"));
    // The finding: the reason and the replacements in one line, the generic advice only when nothing is similar.
    const shelf = Object.entries(items).map(([id, it]) => ({ ref: `gardirop/${id}`, slot: it.slot as never, not: it.not }));
    const finding = failedPartFinding(wreath, out.records[0]!.sorunlar!, partAlternatives(wreath, shelf));
    assert.match(finding.ayrinti, /^"Caesar's golden laurel wreath" 3 turda kabul edilmedi, kostümden çıkarıldı; son ret — tur 3: no svg in the answer$/);
    assert.equal(finding.oneri, "kütüphanede yerine geçebilecek: gardirop/golden-laurel-wreath-a1b2c3 (golden laurel wreath); gardirop/laurel-wreath-crown-d4e5f6 (Augustus's laurel wreath crown) — senaryoda bu parça yazılabilir");
    assert.equal(failedPartFinding({ slot: "back", tarif: "pirate's red cloak" }, [], partAlternatives({ slot: "back", tarif: "pirate's red cloak" }, shelf)).oneri, "tarifi sadeleştir ya da benzer bir kütüphane parçası kullan");
    assert.deepEqual(partAlternatives({ slot: "hand", tarif: "sceptre" }, shelf).map((a) => a.ref), ["gardirop/golden-laurel-sceptre-777777"], "a one-word order needs one shared word");
    assert.deepEqual(partAlternatives({ slot: "head", tarif: "Roman laurel" }, shelf).map((a) => a.ref), [], "two words: one in common is not enough");
    rmSync(root, { recursive: true, force: true });
    scenarios++;
  } catch (e) {
    console.error("FAIL L5 a failed part reports its last rejection and the library parts that could replace it");
    throw e;
  }

  try {
    // The archivist: a known era costs nothing; a missing one is written once, checked, kept and found next time.
    const atlas = readAtlas(process.cwd());
    assert.deepEqual(costumeProblems(atlas.donemler[0]!.taraflar[0]!.roller[0]!.kostum), []);
    assert.ok(costumeProblems({ giysi: "spacesuit", renkler: { ana: "red" }, ayakkabi: "flip-flops" }).length >= 2);
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-arsivci-"));
    const noCall = { generate: async () => { throw new Error("the model was called"); } };
    assert.equal((await ensureEra({ atlas, donem: "1815", konu: "Waterloo", workRoot: root, budget: noCall as never, model: { provider: "mock" }, log: () => undefined }))?.id, "napolyon");
    const answer = { id: "ispanyol-veraset", ad: "War of the Spanish Succession", yillar: [1701, 1714], not: "Long wigs, clean-shaven.", taraflar: [
      { ad: "France", roller: [{ rol: "musketeer", kostum: { giysi: "ceket", renkler: { ana: "#d8d8cc", ikincil: "#2b3f7a", ic: "#fffdf6", sus: "#2b3f7a" }, bas: "yeni:black tricorne with gold trim", ayakkabi: "siyah-cizme" } }, { rol: "spaceman", kostum: { giysi: "spacesuit" } }] },
      { ad: "Britain", roller: [{ rol: "redcoat", kostum: { giysi: "ceket", renkler: { ana: "#c62839", ikincil: "#fffdf6", ic: "#fffdf6", sus: "#fffdf6" }, bas: "yeni:black tricorne", ayakkabi: "siyah-cizme" } }] },
    ] };
    let calls = 0;
    const fake = { generate: async () => (calls++, { result: { content: `Here:\n${JSON.stringify(answer)}`, finishReason: "stop", refused: false, complete: true, truncated: false }, used: { provider: "mock" } }) };
    const lines: string[] = [];
    const era = await ensureEra({ atlas, donem: "1704", konu: "Battle of Blenheim", workRoot: root, budget: fake as never, model: { provider: "mock" }, log: (s) => lines.push(s) });
    assert.equal(era?.id, "ispanyol-veraset");
    assert.deepEqual(era!.taraflar.map((s) => `${s.ad}:${s.roller.length}`), ["France:1", "Britain:1"], "the invalid role is dropped");
    assert.ok(lines.some((l) => l.includes("1 geçersiz rol atıldı")));
    assert.equal((await ensureEra({ atlas: withArchive(atlas, root), donem: "1709", konu: "Malplaquet", workRoot: root, budget: noCall as never, model: { provider: "mock" }, log: () => undefined }))?.id, "ispanyol-veraset", "kept: no second call");
    assert.equal(calls, 1);
    assert.equal(readEraAnswer(JSON.stringify({ ...answer, yillar: [1600, 1650] }), "1704").era, undefined, "years that miss the period are refused");
    assert.match(eraPrompt("1704", "Blenheim", atlas.donemler[0]), /"ad":"France"/);
    rmSync(root, { recursive: true, force: true });
    scenarios++;
  } catch (e) {
    console.error("FAIL L3 the period archivist writes a missing era once");
    throw e;
  }

  console.log(`V3 likeness smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
