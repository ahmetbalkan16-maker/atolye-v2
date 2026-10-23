import type { PackCatalogEntry } from "../costumes/CostumePackLoader";
import {
  EFFECTS,
  EMOTIONS,
  EPISODE_TONES,
  GARMENTS,
  HAIR_STYLES,
  GESTURES,
  MOVES,
  PROP_KINDS,
  SCENE_MOODS,
  SFX_IDS,
  TRANSITIONS,
  type EpisodeSource,
  type EpisodeTone,
} from "../episode/EpisodeTypes";
import { type SeriesBrief, seriesText } from "./Series";

/**
 * Prompt templates for the V3 script writer and its fact-check pass. Allowed values are read from the episode
 * contract, so the prompt can never drift from what the validator accepts. Narration language is a setting:
 * Turkish first, American English as a second output of the same production.
 */
export type ScriptLanguage = "tr" | "en";

/**
 * Verified sources for a topic and the facts each supports (`content/v3/kaynaklar/<konu>.json`). With a bank the
 * writer may cite nothing else, which is what keeps it from inventing books.
 */
export interface SourceBank {
  readonly kaynaklar: readonly EpisodeSource[];
  readonly olgular: readonly { readonly metin: string; readonly kaynak: string }[];
}

export interface ScriptBrief {
  readonly konu: string;
  readonly donem: string;
  readonly hedefSureSn: number;
  readonly ton: EpisodeTone;
  readonly dil: ScriptLanguage;
  readonly kaynakBankasi?: SourceBank;
  /** Voices the writer picks from for this language (`ses_id`), by what they sound like. */
  readonly sesler?: readonly { readonly id: string; readonly tarif: string }[];
  /** The script brain's lessons from earlier episodes and the chief's measures (experience memory). */
  readonly dersler?: readonly string[];
  /** Real historical borders available near the episode's year (HistoricalBorders): snapshot year → polity names. */
  readonly tarihiSinirlar?: readonly { readonly yil: number; readonly adlar: readonly string[] }[];
  /** The series this episode belongs to, with what its earlier episodes told (Series). */
  readonly dizi?: SeriesBrief;
}

/**
 * Spoken words per second of finished video (pauses between lines and scenes included). Turkish is measured: the
 * second pilot had 135 words in 76.0 s (speech alone 1.93 words/s); English (Kokoro voices, 20 Oct 2026): 226 words in
 * 96.0 s (speech alone 2.53 words/s).
 */
export const WORDS_PER_SECOND: Readonly<Record<ScriptLanguage, number>> = { tr: 1.8, en: 2.35 };

/** What each body garment looks like, so the writer can dress any period with them. */
const GARMENT_NOTES: Readonly<Record<(typeof GARMENTS)[number], string>> = {
  kaftan: "Ottoman/Persian long robe with belt",
  cubbe: "long scholar's or official's gown",
  bizans: "Byzantine imperial robe with jewelled band and cape — emperors only",
  zirh: "plate or scale armour over a short skirt",
  onluk: "worker's shirt with apron",
  yeniceri: "janissary long coat with sash",
  sade: "plain long shirt with a rope belt (peasants, monks)",
  tunik: "knee-length tunic with belt (ancient, medieval, early modern commoners and soldiers)",
  toga: "Roman toga draped over a tunic (senators, citizens)",
  ceket: "long tailored coat with lapels, waistcoat and cravat (1650–1900 gentlemen, officers off duty)",
  uniforma: "military uniform tunic with belt, buttons and epaulettes (1800–1960)",
  takim: "modern suit with shirt and tie (1900–today)",
  elbise: "long dress with sash (women of any era)",
};

export const SHOES = ["kahve-cizme", "kahve-mest", "kirmizi-cizme", "kirmizi-mest", "sari-cizme", "sari-mest", "siyah-cizme"] as const;

export function wordBudget(brief: ScriptBrief): number {
  return Math.round(brief.hedefSureSn * WORDS_PER_SECOND[brief.dil]);
}

function catalogText(catalog: readonly PackCatalogEntry[]): string {
  return catalog
    .map((c) => {
      const item = (id: string) => (c.notes?.[id] ? `${id} (${c.notes[id]})` : id);
      return `- paket ${c.pack} (${c.title}): ${Object.entries(c.items).map(([slot, ids]) => `${slot}=${(ids ?? []).map(item).join(", ")}`).join(" | ")}`;
    })
    .join("\n");
}

const RULES: Readonly<Record<ScriptLanguage, (b: ScriptBrief, words: number) => string>> = {
  tr: (b, words) => `Sen Atölye'nin baş senaristisin: kukla/çöp adam karakterlerle anlatılan, mizahi ama tarihsel olarak doğru Türkçe YouTube belgeselleri yazıyorsun.

GÖREV: Aşağıdaki konu için bölüm senaryosunu TEK bir JSON nesnesi olarak yaz. JSON dışında hiçbir şey yazma.

KONU: ${b.konu}
DÖNEM: ${b.donem}
HEDEF SÜRE: ${b.hedefSureSn} saniye (toplam yaklaşık ${words} konuşulan kelime; sahnelerin sure_hedef toplamı hedef süreye eşit)
TON: ${b.ton}

ANLATIM KURALLARI
1. Kanca: ilk 10 saniyede bir soru, çatışma ya da şaşırtıcı bilgi; ilk 30 saniyede "bu videoda ne öğreneceksin" vaadi.
2. Anlatıcı ile karakter diyaloğu karışık; sahnelerin en az %30'unda en az iki satır görünür karakterlere aittir.
3. Her 20–40 saniyede bir espri ya da ters köşe. Mizah zekice ve saygılı; argo, küfür ve hakaret yok.
4. Kısa cümleler: satır başına ortalama en fazla 14 kelime, hiçbir satır 22 kelimeyi geçmez; konuşma dili.
5. Tarihsel doğruluk: anlatıcının her olgusal iddiası "kaynak" alanıyla kaynaklar listesine bağlanır. Tartışmalı bilgi
   "rivayet": true alır ve metinde "rivayete göre", "anlatılır" gibi bir ifade geçer. Karakterlerin uydurma diyalogları
   "kurgu": true alır. Uydurma kaynak, uydurma sayfa numarası ya da uydurma alıntı YOK: emin olmadığın künyeyi yazma.
6. Yaşayan kişiler saygılı bir karikatürdür; doğrulanmamış suçlama yok.
7. Son sahnede bir sonraki videoya köprü cümlesi; EN SON satır anlatıcının izleyiciyi kanala abone olmaya (beğeni ve
   yoruma) davet ettiği, konuya bağlı esprili bir cümle (en fazla 25 kelime).`,
  en: (b, words) => `You are Atölye's head writer: funny but historically accurate American-English YouTube documentaries told with puppet/stick-figure characters.

TASK: Write the episode script for the topic below as ONE JSON object. Output nothing but the JSON. JSON keys stay exactly as in the shape below (they are Turkish); all text the viewer hears or sees ("metin", "balon", "baslik", card texts, the cast's "ad" and "rol") is natural American English, written for an American audience (explain who and where in a few words; no Turkish words they would not know, except names). Character names in their usual English form ("Mehmed II", "Constantine XI", "Halil Pasha").

TOPIC: ${b.konu}
PERIOD: ${b.donem}
TARGET LENGTH: ${b.hedefSureSn} seconds (about ${words} spoken words in total; the scenes' sure_hedef add up to the target)
TONE: ${b.ton}

STORYTELLING RULES
1. Hook: a question, a conflict or a surprising fact within the first 10 seconds; a clear "what you'll learn" promise within 30 seconds.
2. Mix narrator and character dialogue; in at least 40% of scenes at least two lines belong to visible characters.
   Show, don't only tell: most narrator lines are acted out by the characters on screen (a gesture, a face, a sound
   effect), and a character often answers the narrator's line with a short quip right after; now and then a character
   talks back to the narrator.
3. Comedy in the spirit of the best animated history channels (write your own jokes, never borrow theirs): a deadpan
   narrator with dry asides ("Now that's embarrassing."), historical figures who talk like modern people (casual,
   petty, overconfident, bickering), absurd comparisons, understatement, running gags and callbacks — a punchline every
   10–15 seconds, and the facts still exact. Clever and respectful; no slurs, no profanity, no insults.
   Keep it moving: scenes of 8–15 seconds, a new place, framing or visual gag every few seconds.
4. Short sentences: at most 14 words per line on average, never more than 22; conversational.
5. Accuracy: every factual narrator claim links to the source list through "kaynak". Disputed accounts get "rivayet": true
   and the line says so ("legend has it", "according to some sources"). Invented character dialogue gets "kurgu": true.
   NO invented sources, page numbers or quotations: leave out any citation you are not sure exists.
6. Living people are drawn as respectful caricatures; no unverified accusations.
7. The last scene bridges to the next video, and the VERY LAST line is the narrator inviting viewers to subscribe (and
   like or comment) — witty and tied to the topic, at most 25 words.
8. Sound: every scene has at least one "sfx" on a gag, a hit, an entrance or a punchline (see the allowed values).`,
};

function bankText(bank: SourceBank | undefined): string {
  if (!bank) return "";
  return `

SOURCE BANK — cite ONLY these ids in "kaynaklar" and "kaynak", copy their "kunye" exactly, add no other source:
${bank.kaynaklar.map((k) => `- ${k.id}: ${k.kunye}`).join("\n")}

VERIFIED FACTS — every factual narrator claim must come from this list and cite its source id. Anything else is
dramatisation ("kurgu": true) or carries a hedge; never present it as fact:
${bank.olgular.map((o) => `- [${o.kaynak}] ${o.metin}`).join("\n")}`;
}

const SFX_NOTES: Readonly<Record<(typeof SFX_IDS)[number], string>> = {
  whoosh: "swish, fast move",
  pop: "comic pop",
  boing: "cartoon boing",
  kilic: "sword drawn",
  top_atisi: "cannon shot",
  davul: "war drum",
  kalabalik: "crowd murmur",
  cekic: "hammer on metal",
  dalga: "sea waves on a shore",
  su: "splashing through shallow water (wading, fording a river)",
  zil: "bell",
  yumruk: "punch",
  dusus: "body falls, thud",
  adim: "footsteps",
  kapi: "door opens",
  para: "coins",
  kagit: "paper, book, scroll",
  basari: "comic success sting",
  hata: "comic failure sting (wah-wah)",
};

/** The historical atlas's polities near the episode's year, as an option for the map territories. */
function bordersText(snapshots: ScriptBrief["tarihiSinirlar"]): string {
  if (!snapshots?.length) return "";
  const year = (y: number) => (y < 0 ? `${-y} BC` : `AD ${y}`);
  return `
  REAL HISTORICAL BORDERS (an atlas of the period) — for a state in these lists write "tarihi": {"ad": "<exact name>", "yil": <its year>}
  instead of rough "noktalar" (the map draws its real outline; choose the year closer to what the scene shows, add
  "noktalar" only for land it lacks): ${snapshots.map((x) => `${year(x.yil)} (yil ${x.yil}): ${x.adlar.slice(0, 120).join(", ")}`).join(" | ")}`;
}

/** The script brain's lessons from earlier episodes and the chief's measures, as a block of the writer's prompt. */
function lessonsText(lessons: readonly string[] | undefined): string {
  if (!lessons?.length) return "";
  return `\n\nLESSONS FROM EARLIER EPISODES (the studio's own experience — do not repeat these faults):\n${lessons.map((d) => `- ${d}`).join("\n")}`;
}

/** The writer's prompt: rules in the narration language, then one shared contract section. */
export function writingPrompt(brief: ScriptBrief, catalog: readonly PackCatalogEntry[]): string {
  const words = wordBudget(brief);
  return `${RULES[brief.dil](brief, words)}${seriesText(brief.dizi)}${bankText(brief.kaynakBankasi)}${lessonsText(brief.dersler)}

CAST / KADRO
- One narrator: id "anlatici", "gorunur": false, "kostum_paketi": "" and no "kostum".
- 3–6 visible characters, each with a distinct "renk" (#RRGGBB), a distinct "konusma_tarzi", ${voiceRule(brief)}
- "rol": a short role line shown under the name the first time they speak (at most 5 words, e.g. "Ottoman Sultan, age 20").
- "portre": {"wiki": "<exact English Wikipedia article title>"} for EVERY visible character who is a real, named
  historical person: Atölye's costume team reads their article, looks at their portrait and draws their own face shape,
  hair, beard, headwear and clothes as they were in this episode's period (like OverSimplified's Henry VIII after
  Holbein). Still give them a full "kostum" as your best guess; the team corrects it. Leave "portre" out for invented
  or anonymous characters (a legionary, a messenger) and crowds.
- Everyone looks different: no two visible characters share the same headwear-or-hair AND garment colours. A
  character without headwear gets "sac" ({"stil": kisa|dalgali|yan_ayrik|uzun|topuz|orgu|kel|kivircik|kakul|geriye|
  seyrek, "renk": "#RRGGBB"}). Crowds may share one look.
- Costumes: "giysi" is one of the body garments below, in period colours. Parts ("bas", "sakal", "biyik", "el_on",
  "el_arka", "sirt", "gogus" on the chest, "sac_parca" a drawn haircut) come from the catalog when an item fits the period and the character's rank (the notes in brackets
  say who may wear it; an item from another pack is written "pack/item"). When nothing in the catalog fits, ORDER the
  part instead: "bas": "yeni:<English description, 3–12 words>", e.g. "yeni:Roman legionary helmet with a red crest",
  "yeni:WWI British Brodie helmet", "yeni:Napoleon's black bicorne hat" — Atölye draws it once, checks it and keeps it
  in the wardrobe (the "gardirop" pack) for every later episode. Order only what the story needs (at most 8 per episode).

SCREEN TEXT — there are NO subtitles. The only words on screen are title cards and the characters' floating speech:
- "balon": on lines spoken by visible characters only — the words floating over the speaker's head: the punchline or
  the key phrase of the line, 2–8 words, same language as the line, quoting or condensing it (end a shout with "!").
  Give it to most character lines, always to the funny ones; never to the narrator.
- A "kelime" title card (one big word on black, e.g. "CRISIS", "BETRAYAL", "WRONG") two to four times per episode for an
  emphasis beat or a punchline.

SCENE KIND BY SCALE — choose each scene's kind by the scale of what it tells (the studio's two ways of telling, combined):
  - In ONE place (a city, a palace, a camp, a council, a street, a battle seen up close, a conversation): a CHARACTER
    scene — the cast on a set, speaking and acting.
  - BETWEEN places (cities, countries, regions, continents: campaigns, marches, alliances, conquests, borders, trade
    routes, migrations, who rules where): a MAP scene — the narrator over the living map; a character may speak from
    his badge on it for a quip.
  Alternate them as the story moves: zoom out to the map when it travels or the balance of power changes, cut into a
  character scene when it arrives somewhere. A topic about states and wars needs map scenes all through it; a topic in
  one city needs a map only to show where that city is and what surrounds it. Every voyage, crossing, march or invasion
  between places is shown on a map with its route drawn (oklar, or a rozet with "yol" + "yol_satir") before the scene
  where it lands — never only on a beach or a ship. A scene whose "mekan" is a map has a "harita".
  SHARES OF A LONG VIDEO (the owner's, for 20–30 minutes, like the history-with-maps documentaries): about 75–80% of the
  running time on the map — wide and close, campaigns and battles told at length, step by step; about 15% character
  scenes — councils, quarrels, reactions, the stick figures exaggerated, angry, emotional; 6–10% period pictures cut in
  over the map ("ara_goruntu_satir", PERIOD IMAGES below).

MAPS — wherever the story moves (campaigns, borders, empires, routes) show a drawn map scene, at least one per episode:
  "harita": {"merkez": [lon, lat], "genislik_km": 150–30000,
    "bolgeler": [{"ad": "Ottoman Empire", "renk": "#3fae3a", "tarihi": {"ad": "Ottoman Empire", "yil": 1400}, "satir": 0},
                 {"ad": "France", "renk": "#2f6fb0", "ulkeler": ["FRA"]}],   // modern countries by ISO alpha-3 code${bordersText(brief.tarihiSinirlar)}
    "sehirler": [{"ad": "Rome", "konum": [12.5, 41.9]}],
    "ordular": [{"ad": "Caesar", "konum": [lon, lat], "renk": "#…", "satir": 1}],
    "oklar": [{"noktalar": [[lon, lat], [lon, lat], …], "renk": "#…", "etiket": "Caesar", "satir": 2}]}
  Real coordinates. States come from the atlas ("tarihi") whenever it has them: the map then colours every other state
  of that year by itself, so name only the states the story needs, with the name the viewer knows ("ad" is the label;
  "tarihi.ad" the atlas's exact name, which may differ). A rough "noktalar" outline (clipped to the coast) only for a
  small region the atlas lacks — hand-drawn outlines look crude next to real borders. Strong, distinct colours
  (e.g. #3fae3a green, #3a9e9a teal, #e07b24 orange, #9a6a34 brown, #7a64b8 purple). "satir" = the line of the scene
  that mentions it, so it appears then. A map scene is mostly narrator lines; a character may speak on it for a quip —
  from his portrait badge ("rozetler", below), never standing over the map.
  MAP NARRATION (drawn on a terrain relief map, like the history-with-maps channels): tell geography, politics and war on
  ONE map that follows the story instead of cutting away —
    "kamera": [{"satir": 2, "merkez": [lon, lat], "genislik_km": 900–6000}]   // the camera glides there with that line
    "rozetler": [{"karakter": "<visible cast id>", "konum": [lon, lat], "satir": 1, "yol": [[lon, lat], …], "yol_satir": 3}]
        // a ruler's portrait badge at his capital or army from line "satir"; with "yol_satir" he sets off on that line
        // and the badge travels "yol" (a campaign: real waypoints — passes, river crossings, towns — 3–8 points),
        // leaving a dotted trail. A ruler shown only on the map is still a visible cast member with "portre", so the
        // costume team draws his likeness and the badge shows it. End a route just beside a battle (~70 km), not on
        // it, so the battle's name stays readable. A character who SPEAKS on a map speaks from his badge: the
        // portrait talks and his line's "balon" rises from it, the map stays in view — give every character who
        // speaks in a map scene a rozet there (where he stands from his first line) and a "balon" on each line.
    "savaslar": [{"ad": "Battle of Bapheus", "konum": [lon, lat], "satir": 3}]   // crossed swords where a battle happens
    "bitis_satir" on a territory: the line it disappears with — give the new, larger or smaller outline from that same line,
        so a border visibly grows or shrinks (a state that appears during the scene spreads out over the map).
    "ordular": [{"ad": "Caesar", "konum": [lon, lat], "renk": "#…", "satir": 0, "yol": [[lon, lat], …], "yol_satir": 2}]
        // an army that MARCHES its route (3–8 real waypoints) from line "yol_satir", leaving a dotted trail; the camera
        // follows it by itself
    "bolgeler": [… {"ad": "Caesar", "renk": "#…", "noktalar": […] or "tarihi": {…}, "yayilma": {"satir": 2, "kaynak": [lon, lat]}}]
        // a CONQUEST: from that line the conqueror's colour sweeps over the land province by province from "kaynak" (where
        // the army came from), at the pace of an army marching on the same line; the old owner's name fades as the
        // front passes. Use the conqueror's own "ad" again (a second region under the same name shows no second label).
    "cizgiler": [{"ad": "Rubicon", "noktalar": [[lon, lat], …], "renk": "#ffd166", "satir": 0}]
        // a line the story is about (a border river, a wall, a frontier): it glows with its name
  MARKS OVER THE MAP (the documentary map channels' marks):
    "tarih": [{"satir": 0, "metin": "Spring 1453"}, {"satir": 4, "metin": "29 May 1453"}]
        // the date stamp in the corner — on EVERY map scene, a new entry when the story's date moves on
    "guc": [{"satir": 1, "taraflar": [{"ad": "Ottomans", "renk": "#…", "sayi": "80,000"}, {"ad": "Byzantines", "renk": "#…", "sayi": "7,000"}]}]
        // the two sides' strength bar at the top of the screen when the narrator gives the numbers ("sayi": the number or
        // range only, "15,000–25,000"); a later entry with the same two sides updates it after the losses
    "vurgular": [{"bolge": "<a name in this map's bolgeler>", "satir": 2}, {"konum": [lon, lat], "km": 60, "satir": 3}]
        // while that line is told, the state the narrator names glows along its border, or a white ring circles the place
    "yanginlar": [{"konum": [lon, lat], "satir": 3, "km": 20}]   // flames over a raided, sacked or burning place
    "teslim": [{"konum": [lon, lat], "satir": 5, "ad": "Belgrade surrenders"}]   // a white flag raised where a side gives up
    "rozetler": [… "x_satir": 6]   // a red X struck over a ruler's badge from that line: beaten, captured or dead
  INFO CARDS — while the narrator explains politics, reasons or a striking number, the picture dims and a card comes up
  ("bilgi_kartlari" on the scene, map or character scene; one or two per chapter of a long video, one at a time):
    {"tur": "sema", "baslik": "Rome's two camps", "satir": 1, "dugumler": [{"ad": "Roman Senate"},
      {"ad": "Optimates", "ust": 0, "renk": "#3f6fb5", "karakterler": ["pompey"]}, {"ad": "Populares", "ust": 0, "renk": "#c0392b", "karakterler": ["caesar"], "satir": 2}]}
        // a political chart: who belongs to whom (2–8 boxes; "ust" = the earlier box it hangs from; portraits of visible cast)
    {"tur": "liste", "baslik": "Caesar's advantages", "satir": 3, "maddeler": [{"metin": "Veteran legions", "satir": 3}, {"metin": "Speed", "satir": 4}]}
        // a titled list, each item coming in with the line that says it (2–6 items, at most 6 words each)
    {"tur": "sayac", "satir": 2, "deger": 1000000, "etiket": "Gauls killed in eight years"}   // a number counting up
  Tell events ON the map as they happen, line by line, the way the history-with-maps channels do: an army marches, a
  conquest sweeps over the land behind it, the old border fades, a battle flashes, a ruler flees, the camera follows.
  Never show a whole war's result at once — let the viewer watch it happen. Prefer this living map narration to a still
  map with everything shown at once.
  Keep "genislik_km" at 800 or more on a wide map (1500–4000 suits a country or a war) — the CLOSE BATTLE MAP below is
  the one exception.
  UNITS AND VEHICLES on any map (like the WW2-on-maps channels):
    "birlikler": [{"taraf": "Ottomans", "renk": "#c0392b", "amblem": "hilal" | "kartal" | "hac" | "yildiz" | "aslan" | "tac" |
        "kalkan" | "kilic" | "gunes" | "orak_cekic" | "harf" (then "harf": 1–3 letters), "sayi": 4–12,
        "yerler": [{"satir": 0, "cephe": [[lon, lat], …]}, {"satir": 2, "kume": [lon, lat], "km": 1.5},
                   {"satir": 4, "kusatma": [lon, lat], "km": 2, "kayip": 2}]}]
        // each side's round emblem tokens along a front, in a cluster or ringing a besieged place, sliding to the next
        // formation with its line. "kayip": tokens lost on that line — the sides rush at each other and the losses fall
        // one by one, swords heard. On a fight line give BOTH sides a formation, side by side (on a close map a few
        // hundred metres apart; across a wall: attackers just outside, defenders just inside), never far apart.
        // On a battlefield give each body of troops its kind and strength (the battle maps' blocks): "tur": "piyade" |
        // "suvari" | "okcu" | "topcu" (one kind per entry — a side's cavalry is a second entry in the same colour), "etiket":
        // "11 legions – 47,000 men"; a front "hatlar": 2–3 lines deep (Caesar's triplex acies); "vurgu": [line indexes] —
        // while the narrator speaks of this unit it is framed in light; "bozgun": true on the formation where a side breaks
        // and runs (its tokens turn and scatter to the place given there).
    "oklar": [… {"noktalar": [[lon, lat], …], "stil": "plan", "renk": "#3fae3a", "etiket": "Cavalry", "satir": 2, "bitis_satir": 3}]
        // a battle plan's dashed arrow BEFORE the move it announces (the cavalry's sweep round the flank), gone when it starts
    "kusatma_hatlari": [{"ad": "Caesar's siege line", "noktalar": [[lon, lat], …], "satir": 1, "sure_sn": 6}]
        // a palisade and ditch drawn step by step, its length in km written by itself; later entries build it stage by stage
    "araclar": [{"tur": "gemi" | "kadirga" | "yelkenli" | "suvari" | "fil" | "top" | "tank" | "ucak" | "denizalti",
        "renk": "#…", "sayi": 1–6, "konum": [lon, lat], "satir": 1, "yol": [[lon, lat], …], "yol_satir": 2,
        "hedef": [lon, lat], "ates_satir": 3, "kayip": 2, "kayip_satir": 4}]
        // ships, cavalry, guns, tanks, planes travel their route and fire at "hedef" — only what the period had ("gemi"
        // is drawn as the period's ship). A ship whose route crosses land is HAULED over it on rollers by its crew (the
        // 1453 fleet over the hill behind Galata): give the real land route and the camera follows. "kayip" of them are
        // lost on line "kayip_satir", one by one: ships sink, guns and riders are blown up — a fleet battle is told with
        // both fleets sailing at each other, firing, and the beaten side's ships lost (not with land tokens).
CLOSE BATTLE MAP — when the story arrives at ONE battlefield, siege or city's fall, cut from the wide map to a close map of
  that place: "genislik_km" 4–60, "kamera" keys 3–30 km (the painted battle maps of the history channels). The usual flow:
  wide map (the march there) → close map (the field or the walls, the armies, the guns, the ships) → a character scene
  (the war council in the commander's tent, "ortam" "ordugah") → the close map again (the assault, the breach, the fall).
  The battle's CLIMAX is seen ON the close map, line by line: the assault (attackers' tokens at the walls or the enemy
  front, "kayip" on that line so the losses fall one by one), the breach ("gedik" on its line), the counter-attack or the
  rout (the beaten side's tokens fall back, more "kayip"), the fleet battle (ships at each other, firing). A character
  scene may come before it (the council) or after it (the leaders' reaction), never instead of it. On the close map the
  leaders speak from their badges (a "rozet" at their army, their tent or the walls), so the fight stays in view.
  A SIEGE OR BATTLE STORY has these scenes in this order: (1) wide map: the march there; (2) close map: the armies
  arrive, the guns pound the walls, the fleets close the river or the sea; (3) character scene: the council in the tent
  or inside the walls; (4) THE ASSAULT, a second close map of the same place (same "merkez" and "genislik_km", with the
  walls), every line of the fight moving the tokens; (5) character scene: the leaders' reaction; then the wide map for
  what it changed. Each fight of the story (a fleet battle, the assault on the walls, a sortie) is its own close-map
  scene or lines. The storming of the walls, the breach and the rout are never told only in a character scene.
  The assault scene, in short:
    {"id": "s6-assault", "mekan": "Close map: the walls of <city>", "harita": {"merkez": [lon, lat], "genislik_km": 10,
      "surlar": [{"ad": "<the walls' name>", "noktalar": [[lon, lat], …], "gedik": {"konum": [lon, lat], "satir": 1}}],
      "araclar": [{"tur": "top", "renk": "#…", "sayi": 3, "konum": [lon, lat], "satir": 0, "hedef": [a point on the wall], "ates_satir": 0}],
      "birlikler": [
        {"taraf": "<attackers>", …, "yerler": [{"satir": 0, "cephe": [[their lines], …]}, {"satir": 1, "cephe": [[just outside the wall], …], "kayip": 3},
                                               {"satir": 3, "kume": [back at their camp], "kayip": 2}]},
        {"taraf": "<defenders>", …, "yerler": [{"satir": 0, "kume": [inside the walls]}, {"satir": 1, "cephe": [[just inside the wall], …], "kayip": 2},
                                               {"satir": 3, "cephe": [[out through the breach], …]}]}],
      "rozetler": [{"karakter": "<the attacking leader>", "konum": [his camp], "satir": 2}]},
     "satirlar": [narrator: the attackers storm the walls; narrator: the wall breaks, they pour in; the attacking leader
      from his badge (a quip, with "balon"); narrator: the counter-attack throws them back]}
  The close map draws the place's real coast and hills by itself; on it give what the story needs, anywhere on Earth:
    "surlar": [{"ad": "Theodosian Walls", "noktalar": [[lon, lat], … 3–10 points along the wall], "osm_ad": "Walls of
               Constantinople", "kapilar": [[lon, lat]], "gedik": {"konum": [lon, lat], "satir": 4}}]
        // a city wall: the studio takes its real trace from OpenStreetMap ("osm_ad": the name OSM or Wikipedia gives it);
        // your line must follow it all the same. A CASTLE or a walled town as a ring instead: {"ad": "Belgrade Fortress",
        // "kale": {"merkez": [lon, lat], "km": 0.3–3, "bicim": "halka" | "kare" | "yildiz"}} — its real outline where it
        // is mapped, else drawn as a medieval ring (before 1500) or a bastioned star fort (1500–1870). "gedik": where the
        // wall breaks open on that line; the attackers' tokens then pour in through it.
    "yerlesimler": [{"tur": "sehir" | "koy" | "ordugah", "ad": "…", "konum": [lon, lat], "km": 0.5–6, "sur_ici": true,
                     "satir": 0, "yanma_satir": 5}]
        // a town's roofs ("sur_ici": only inside its walls), a village, an army camp's tents; with "yanma_satir" it
        // burns from that line, the fire spreading from the breach
    "yapilar": [{"tur": "kale" | "saray" | "kilise" | "cami" | "kule" | "otag", "ad": "Hagia Sophia", "konum": [lon, lat]}]
        // the story's single buildings (the commander's tent "otag", a great church, a tower), by their real names —
        // the studio checks each on Wikipedia
    "yollar": [{"ad": "Road to Edirne", "noktalar": [[lon, lat], …]}]   // the roads to the gates, named along their way
    "arazi": [{"tur": "tepe" | "orman" | "tarla", "konum": [lon, lat], "km": 1}]   // a hill, a wood or fields of the story
    "cizgiler": [… {"ad": "The chain", "noktalar": [[lon, lat], [lon, lat]], "stil": "zincir", "satir": 2}]   // a boom chain
  with "birlikler" (both sides), "araclar" (guns before the gate firing at it, ships, a haul over land) and "savaslar"
  (the fight's name at its place). A field battle has no walls: the armies' fronts, the river, the hills, the camps — told
  step by step like the battle documentaries: the two orders of battle in blocks by kind with their strength (infantry
  in lines, cavalry on the wings), the commander's plan as dashed arrows, the unit the narrator names framed, the clash
  with losses, the flank turned, the beaten side's blocks breaking ("bozgun") and the camp taken.

CROWDS — scenes feel big when the story has many people: give such scenes "kalabalik" (extras who never speak):
  [{"ad": "Ottoman workers", "kostum_paketi": "…", "kostum": {same shape as a cast costume}, "sayi": 6–30,
    "duzen": "sira" (a row or two) | "meclis" (council benches) | "ordu" (a block of soldiers),
    "taraf": "sol" | "sag" | "tum", "ruh_hali": "notr" | "coskulu" (cheering) | "korkmus" (scared),
    "hareket": {"tur": "yuru" | "kos" | "hucum" | "kac", "satir": 3, "hedef": 0..1 (optional stage x)}}]
  A crowd is always PEOPLE: never name a crowd after animals. A named character can RIDE a horse in a scene:
  "sahne_duzeni": [{"karakter": "caesar", "x": 0.42, "binek": "at"}] — a general leading his army, a messenger, a
  cavalryman, a king arriving; the horse walks when the rider moves ("hareket"). Other animals (elephants, camels) are not
  drawn yet: tell them through the narrator and the period images.
  An army scene can have two groups, one per side. Their costumes follow the same catalog and rank rules. A crowd ACTS
  with the story: "hareket" makes the whole formation march, run, charge (cheering) or flee (scared) with that line,
  rank after rank — a legion wading across a river, a mob storming a gate, a broken army running away. The camera stays
  wide while they move.

LIVING SETS / ORTAM — the viewer must live the moment (owner): every character scene gets an "ortam", the drawn living set
  the renderer composes and animates (flowing water, flickering torches, stars, drifting mist, rain or snow):
  "ortam": {"zaman": "gun" | "aksam" | "gece" | "safak", "manzara": "nehir_kiyisi" | "nehir_gecidi" | "ova" | "tepeler" |
    "orman" | "sahil" | "sokak" | "meydan" | "saray_ici" | "meclis" | "ordugah" | "sur_onu", "uslup": "roma" | "yunan" |
    "misir" | "pers" | "bizans" | "osmanli" | "ortacag" | "cin" | "japon" | "erken_modern" | "modern",
    "hava": "acik" | "bulutlu" | "sis" | "yagmur" | "kar", "isik": "yok" | "mesale" | "kamp_atesi",
    "nehir": [left bank, right bank] (0..1, for "nehir_gecidi": the river runs across the stage there)}
  Choose them from the sources: the hour it happened (Caesar reached the Rubicon at night), the place, the period's
  buildings, the weather. Someone who walks ("hareket": "yuru", "hedef" between the banks) into a "nehir_gecidi" wades
  in it. Write each scene so that what the narrator or a character says is SEEN happening on screen in that line —
  who moves where, who arrives, who runs, what changes — never two figures standing still while the story is only told.

PERIOD IMAGES AND SETS / ARKA PLAN
- Every scene has a drawn set the characters act in; while the narrator speaks, the film cuts away to a real image of the
  period found online (painting, miniature, engraving, manuscript, period map; from the 1850s on also a period photograph).
  Open most scenes with a narrator line — that is when the period image is on screen. A photo of the place as it stands
  today is NOT a period image and is never used.
- "arka_plan_sorgusu.wiki": the exact English Wikipedia article title of the scene's main place, person or event
  ("Rumelihisarı", "Mehmed II", "Fall of Constantinople").
- "arka_plan_sorgusu.en": a search for a PERIOD image: proper name + medium ("Rumelihisarı engraving", "Mehmed II portrait
  Bellini", "Constantinople map Buondelmonti", "Ottoman miniature siege"); never a generic word such as "Palace".
- "arka_plan_sorgusu.ara": 1–3 more searches with the historical names and spellings that old books, travellers and
  artists used ("Roumeli Hissar", "Castle of Europe Bosphorus", "Constantinople 1453 siege painting").
- "arka_plan_sorgusu.tasarim": the drawn set in English, 25–50 words: the place as it looked then — landscape, period
  architecture, ships or vehicles, objects, light and weather — then "no …" for the anachronisms to avoid. An empty place with
  open ground in front, never people (characters are drawn separately). Example: "Wooded hills on the European shore of the
  Bosphorus in spring 1452, a half-built stone fortress with round towers and wooden scaffolding, Ottoman galleys on calm
  water, morning light; no modern houses, no roads, no ferries".
- "arka_plan_sorgusu.tr": the same place in Turkish (for the owner's notes); "tur": "set" (default), or "archival" when the
  scene is mainly about a surviving artwork, map or document.
- On a MAP scene, mark the one line whose moment deserves a picture: "ara_goruntu_satir": <line index>. The period
  picture of THAT moment (the painting of the battle, the engraving of the besieged city, the miniature of the council)
  is cut in over that line, then the map comes back; the scene's "arka_plan_sorgusu" searches for it. Mark about one
  map scene in three, so pictures fill 6–10% of a long video.
- "arka_plan_sorgusu.an": the moment itself in English, 20–45 words, for a painter — who, doing what, where, with the
  period's clothes, arms, buildings, ships and weather ("Ottoman soldiers drag galleys on greased logs over a wooded hill
  at night, torches, the Golden Horn below, 1453"). When no real period picture exists (myths, little-documented events)
  the studio paints this moment and labels it as designed. Give it on every scene with a picture moment. The painter
  is a local image model: name ONE clear main subject first, then one action and the setting — never a chain of actions
  ("a giant wooden horse on wheels inside the city walls at night, soldiers around it with torches", not "the Greeks climb
  out, open the gates and the army pours in").
- "gorseller": more pictures of the moment on a scene, each cut in over its line:
  [{"satir": 2, "en": "<a search for a period image of that moment>", "wiki": "…", "ara": ["…"], "an": "<the moment for a
  painter>", "film": true}]   // "film": true for the 20th century — free archive film (newsreels) is looked for first
  Use them to show what the narrator tells at its key moments (2–4 per chapter of a long video, mostly on map scenes).
- PHOTO DOCUMENTARY (modern topics, the age of photographs and newsreels): a scene with "kip": "fotograf" has no stage —
  its own picture, then its "gorseller", fill the screen one after another, drifting slowly, while the narrator speaks;
  give its lines a "serit": the headline strip at the bottom of the screen ("Kuwait's waters are heating up", at most 70
  characters). Only narrator lines there (characters speak in character scenes or from map badges). Use it for the
  modern era's events; never for a period before photography unless its pictures are paintings of the moment ("an").

COSTUME CATALOG
giysi (body garment, coloured by "renkler"): ${GARMENTS.map((g) => `${g} (${GARMENT_NOTES[g]})`).join(", ")}
ayakkabi: ${SHOES.join(", ")}
sac (hair, optional; shows under or without headwear — give it to everyone without a full head covering): {"stil": one of ${HAIR_STYLES.join(", ")}, "renk": "#RRGGBB"}
${catalogText(catalog)}

ALLOWED VALUES
ton: ${EPISODE_TONES.join(", ")}
sahne duygu: ${SCENE_MOODS.join(", ")}
satir duygu: ${EMOTIONS.join(", ")}
jest: ${GESTURES.join(", ")}
hareket: ${MOVES.join(", ")}
sfx (a sound at the start of the line — use them generously on gags, hits, entrances and punchlines, like the reference channel): ${SFX_IDS.map((id) => `${id} (${SFX_NOTES[id]})`).join(", ")}
efekt: ${EFFECTS.join(", ")}
gecis: ${TRANSITIONS.join(", ")}
dekor tur: ${PROP_KINDS.join(", ")}
yazi_karti stil: yer_tarih, bolum, bilgi, kelime
ids: lowercase kebab-case (a-z, 0-9, -). x and derinlik: 0..1. metin: at most 240 characters.

JSON SHAPE (an example — fill every value for this topic):
{"id":"konu-kimligi","baslik":"…","konu":"…","donem":"…","hedef_sure_sn":${brief.hedefSureSn},"ton":"${brief.ton}",
 "kaynaklar":[{"id":"yazar-yil","kunye":"Author, Title, Publisher, Year"}],
 "oyuncu_kadrosu":[
  {"id":"anlatici","ad":"…","rol":"…","kostum_paketi":"","renk":"#333333","ses_id":"${brief.dil === "en" ? "en-anlatici" : "anlatici"}","konusma_tarzi":"…","gorunur":false},
  {"id":"karakter-1","ad":"…","rol":"…","kostum_paketi":"ottoman-1453","renk":"#b3263a","ses_id":"${brief.sesler?.[0]?.id ?? "karakter-1"}","konusma_tarzi":"…","gorunur":true,
   "kostum":{"giysi":"kaftan","renkler":{"ana":"#b3263a","ikincil":"#e8b23a","ic":"#f3d27a","sus":"#e8b23a"},"bas":"padisah-kavugu","sakal":"sakal-genc","ayakkabi":"sari-mest"}}],
 "sahneler":[
  {"id":"s1-kanca","sure_hedef":12,"mekan":"…","arka_plan_sorgusu":{"tr":"…","en":"…","wiki":"…","ara":["…"],"tasarim":"…","tur":"set"},"ortam":{"zaman":"gece","manzara":"nehir_kiyisi","uslup":"roma","hava":"sis","isik":"mesale"},"duygu":"merak","muzik_ruh_hali":"gizemli","gecis":"kes",
   "yazi_karti":[{"metin":"…","alt_metin":"…","stil":"yer_tarih"}],
   "sahne_duzeni":[{"karakter":"karakter-1","x":0.35,"yon":"sag"}],
   "satirlar":[
    {"karakter":"anlatici","metin":"…","duygu":"notr","kaynak":["yazar-yil"]},
    {"karakter":"karakter-1","metin":"…","duygu":"kararli","jest":"isaret_et","kurgu":true,"balon":"…"}]}]}`;
}

/** How the writer fills `ses_id`: from the voice list when there is one (English), else the character's own id. */
function voiceRule(brief: ScriptBrief): string {
  if (!brief.sesler?.length) return `"ses_id" equal to its id.`;
  return `and a "ses_id" from this voice list chosen by the character's age, temperament and origin — a different voice for every
  character:
${brief.sesler.map((v) => `  - ${v.id}: ${v.tarif}`).join("\n")}`;
}

/** One validation repair round: same content, fixed shape. */
export function repairPrompt(previousJson: string, problems: readonly string[]): string {
  return `The JSON episode below failed validation. Fix ONLY these problems, keep all content, and return the complete corrected JSON object and nothing else.

PROBLEMS:
${problems.map((p) => `- ${p}`).join("\n")}

JSON:
${previousJson}`;
}

/**
 * One revision round: a script far from its spoken-word budget would not fill (or would overrun) the target;
 * `extra` carries further requirements the script missed (e.g. too little dialogue).
 */
export function lengthPrompt(previousJson: string, words: number, target: number, extra: readonly string[] = []): string {
  const verb = words < target ? "Expand" : words > target ? "Shorten" : "Keep";
  return `The JSON episode below has ${words} spoken words; the target is about ${target}. ${verb} it to about ${target} words by ${
    words < target ? "adding lines (more dialogue between visible characters, one more joke) and, if needed, one scene" : "cutting or merging lines"
  }. Keep every rule, id, source and the cast; keep the scenes' sure_hedef adding up to hedef_sure_sn.${extra.length ? `\nAlso fix:\n${extra.map((e) => `- ${e}`).join("\n")}` : ""}
Return the complete JSON object and nothing else.

JSON:
${previousJson}`;
}

/** The fact-check pass: only problem lines come back, so the answer stays short. */
export function factCheckPrompt(episodeJson: string, dil: ScriptLanguage, bank?: SourceBank): string {
  const lang = dil === "tr" ? "Turkish" : "American English";
  const truth = bank
    ? `\nVERIFIED FACTS (ground truth, checked against the cited works): a line that agrees with one of these is "dogru" — never rewrite it or hedge it.\n${bank.olgular.map((o) => `- [${o.kaynak}] ${o.metin}`).join("\n")}\n`
    : "";
  return `You are a meticulous history editor. Check the factual claims in this episode script (spoken text is ${lang}).${truth}
For each line that states a fact, decide: "dogru" (correct), "tartismali" (disputed / traditional account), "yanlis" (wrong) or "kaynaksiz" (plausible but its cited source does not support it or none is cited).
- yanlis: give "yeni_metin", the corrected line in the same language, length and style.
- tartismali: give "yeni_metin" with a hedge ("${dil === "tr" ? "rivayete göre" : "legend has it"}" or similar) added.
- kaynaksiz: give "kaynak_onerisi" only for a work you are certain exists; otherwise leave it out.
- Character lines with "kurgu": true are flagged only when they contradict the period.
- Also flag anachronisms in costumes or settings in "genel_not".
List ONLY problem lines (never "dogru" ones). "sahne" is the scene id, "satir" the 0-based line index.
Return ONLY this JSON:
{"iddialar":[{"sahne":"s1-kanca","satir":0,"karar":"yanlis","gerekce":"…","yeni_metin":"…","kaynak_onerisi":"…"}],"genel_not":"…"}

EPISODE:
${episodeJson}`;
}
