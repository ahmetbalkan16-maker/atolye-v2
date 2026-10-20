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
   like or comment) — witty and tied to the topic, at most 25 words.`,
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
  dalga: "waves",
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

/** The writer's prompt: rules in the narration language, then one shared contract section. */
export function writingPrompt(brief: ScriptBrief, catalog: readonly PackCatalogEntry[]): string {
  const words = wordBudget(brief);
  return `${RULES[brief.dil](brief, words)}${bankText(brief.kaynakBankasi)}

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

MAPS — wherever the story moves (campaigns, borders, empires, routes) show a drawn map scene, at least one per episode:
  "harita": {"merkez": [lon, lat], "genislik_km": 150–30000,
    "bolgeler": [{"ad": "Roman Republic", "renk": "#b8283a", "noktalar": [[lon, lat], …rough outline, 6–14 points…], "satir": 0},
                 {"ad": "France", "renk": "#2f6fb0", "ulkeler": ["FRA"]}],   // modern countries by ISO alpha-3 code
    "sehirler": [{"ad": "Rome", "konum": [12.5, 41.9]}],
    "ordular": [{"ad": "Caesar", "konum": [lon, lat], "renk": "#…", "satir": 1}],
    "oklar": [{"noktalar": [[lon, lat], [lon, lat], …], "renk": "#…", "etiket": "Caesar", "satir": 2}]}
  Real coordinates; outlines may be rough (they are clipped to the real coast). "satir" = the line of the scene that
  mentions it, so it appears then. A map scene is mostly narrator lines; characters may stand on it for a quip.

CROWDS — scenes feel big when the story has many people: give such scenes "kalabalik" (extras who never speak):
  [{"ad": "Ottoman workers", "kostum_paketi": "…", "kostum": {same shape as a cast costume}, "sayi": 6–30,
    "duzen": "sira" (a row or two) | "meclis" (council benches) | "ordu" (a block of soldiers),
    "taraf": "sol" | "sag" | "tum", "ruh_hali": "notr" | "coskulu" (cheering) | "korkmus" (scared)}]
  An army scene can have two groups, one per side. Their costumes follow the same catalog and rank rules.

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
  {"id":"s1-kanca","sure_hedef":12,"mekan":"…","arka_plan_sorgusu":{"tr":"…","en":"…","wiki":"…","ara":["…"],"tasarim":"…","tur":"set"},"duygu":"merak","muzik_ruh_hali":"gizemli","gecis":"kes",
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
