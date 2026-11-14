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
import { isShorts } from "../render/Format";
import { type SeriesBrief, seriesText } from "./Series";
import { SHORT_SHARES_FROM_S } from "./MapRules";

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
  /**
   * A researched bank's facts with the source's own words that prove each (SourceResearch, ≤300 chars). Shown beside
   * the facts as evidence only; a hand-made bank has none.
   */
  readonly alintilar?: readonly { readonly metin: string; readonly kaynak: string; readonly alinti: string }[];
}

/** Characters of evidence quotes the writer and the fact checker see (a 45-fact Short's quotes ≈ 9,000). */
export const EVIDENCE_CHARS = { writer: 14_000, checker: 12_000 } as const;
/** Longest quote shown; a longer one is cut (what is shown is still the source's text, for `dayanak`). */
const EVIDENCE_QUOTE_CHARS = 240;

/**
 * The bank's facts as prompt lines, each with its evidence quote while `evidenceChars` lasts (then the fact alone).
 * `shown` tells whether any quote was given.
 */
export function bankFactLines(bank: SourceBank, evidenceChars: number): { text: string; shown: boolean } {
  const quotes = new Map((bank.alintilar ?? []).map((a) => [`${a.kaynak}\u0000${a.metin}`, a.alinti]));
  let left = evidenceChars;
  let shown = false;
  const text = bank.olgular
    .map((o) => {
      const line = `- [${o.kaynak}] ${o.metin}`;
      const q = quotes.get(`${o.kaynak}\u0000${o.metin}`)?.replace(/\s+/g, " ").replace(/"/g, "'").trim();
      if (!q) return line;
      const quote = q.length > EVIDENCE_QUOTE_CHARS ? `${q.slice(0, EVIDENCE_QUOTE_CHARS).replace(/\s+\S*$/, "")}…` : q;
      if (quote.length > left) return line;
      left -= quote.length;
      shown = true;
      return `${line}\n  evidence: "${quote}"`;
    })
    .join("\n");
  return { text, shown };
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
  /**
   * The period atlas's dress for the episode's era (PeriodAtlas.periodDressBlock): each side's costume by rank, written
   * after the costume catalog (owner, 6 Nov 2026).
   */
  readonly donemKiyafetleri?: string;
  /** The script brain's lessons from earlier episodes and the chief's measures (experience memory). */
  readonly dersler?: readonly string[];
  /**
   * The history editor's (fact check's) own lessons and past research cases (BrainBriefing.factCheckBriefing; 13 Nov
   * 2026: the research brain's lessons were written but never read before the render).
   */
  readonly denetciDersleri?: readonly string[];
  /** Real historical borders available near the episode's year (HistoricalBorders): snapshot year → polity names. */
  readonly tarihiSinirlar?: readonly { readonly yil: number; readonly adlar: readonly string[] }[];
  /** The series this episode belongs to, with what its earlier episodes told (Series). */
  readonly dizi?: SeriesBrief;
  /**
   * A Short's beat map in seconds (owner, 5 Nov 2026, from the Caesar Short's numbers): one bullet built by
   * ChannelGoals.shortBeatRule from content/v3/kanal-hedefleri.json — the single source, never written here.
   */
  readonly kisaZamanHaritasi?: string;
  /**
   * The whole video's length when this brief is one chapter of a long episode (LongForm.chapterBrief). A two-minute
   * chapter is under the 3-minute Shorts line (Format.SHORTS_MAX_S since 11 Nov 2026), so by its own length every chapter
   * of a 20-minute video was written under the Shorts rules and fill; whether it is a Short goes by this (`isShortBrief`).
   */
  readonly butunSureSn?: number;
}

/** Whether a brief is a Short's: by the whole video's length, never a long episode's chapter (`butunSureSn`). */
export const isShortBrief = (brief: Pick<ScriptBrief, "hedefSureSn" | "butunSureSn">): boolean => isShorts(brief.butunSureSn ?? brief.hedefSureSn);

/**
 * Spoken words per second of finished video (pauses between lines and scenes included). Turkish is measured: the
 * second pilot had 135 words in 76.0 s (speech alone 1.93 words/s); English (Kokoro voices, 20 Oct 2026): 226 words in
 * 96.0 s (speech alone 2.53 words/s).
 */
export const WORDS_PER_SECOND: Readonly<Record<ScriptLanguage, number>> = { tr: 1.8, en: 2.35 };

/** What each body garment looks like, so the writer can dress any period with them. */
export const GARMENT_NOTES: Readonly<Record<(typeof GARMENTS)[number], string>> = {
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

/**
 * A Short's length is a ceiling, not a target (Format.lengthOk): its words aim at this share of it, so the spoken video
 * with its pauses and the length band's top stays under (the second Caesar Short: 155 words for 60 s ran 66 s). 0.92
 * since 13 Nov 2026 (owner: "neden 2:30 dakikanın altında kalıyor, en fazla 3 dakika olsun ama 2:30'un altına fazla
 * inmesin"): 0.85 with a band down to 65% let the Taranto and Guadalcanal Shorts through at ~254 words (107–112 s); now
 * 389 words for 180 s, ~165 s at the measured 2.26–2.52 words/s.
 */
export const SHORTS_FILL = 0.92;

export function wordBudget(brief: ScriptBrief): number {
  return Math.round(brief.hedefSureSn * (isShortBrief(brief) ? SHORTS_FILL : 1) * WORDS_PER_SECOND[brief.dil]);
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
7. Son sahnede bir sonraki videoya köprü cümlesi; EN SON satırı ANA KARAKTER (en çok konuşan görünür karakter, son
   sahnede sahnede) kendi üslubuyla söyler: izleyiciyi kanalımız Crowns & Doodles'a abone olmaya davet eden, konuya bağlı,
   sıcak ve esprili bir cümle (en fazla 16 kelime).`,
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
7. The last scene bridges to the next video, and the VERY LAST line is spoken by the MAIN CHARACTER (the visible character
   with the most lines, on stage in the last scene), in their own voice: a warm, witty invitation to subscribe to our
   channel Crowns & Doodles, tied to the topic, at most 16 words.
8. Sound: every scene has at least one "sfx" on a gag, a hit, an entrance or a punchline (see the allowed values).`,
};

/**
 * Real period pictures in a Short (owner, 11 Nov 2026: "önceki 3 dakikalık kısa videoda gerçek fotoğraflar da
 * kullanılıyordu … video daha güzel çıkmıştı, bu shorts videolarında da kullanılsın"). The Gallipoli video showed them
 * 22% of its running time because every map scene marked its picture line; the Shorts before marked none or one, and an
 * unmarked map scene is never searched. Cut in over narrator lines, never over a character's own line.
 */
const SHORT_PICTURES: Readonly<Record<ScriptLanguage, string>> = {
  tr: `- GERÇEK DÖNEM GÖRSELLERİ (Gelibolu videosundaki gibi): sürenin yaklaşık %20'sinde ekranda o anın gerçek fotoğrafı,
  tablosu ya da gravürü. HER harita sahnesi "ara_goruntu_satir" ile bir ANLATICI satırını işaretler ve
  "arka_plan_sorgusu" o anın resmini arar; anlatıcının 1–3 önemli satırına da "gorseller" ekle (20. yüzyılda "film": true,
  önce arşiv filmi aranır). Resim hiçbir zaman bir karakterin kendi satırının üstüne gelmez.
`,
  en: `- REAL PERIOD PICTURES (like the Gallipoli video): about 20% of the running time shows the moment's real photograph,
  painting or engraving. EVERY map scene marks one NARRATOR line with "ara_goruntu_satir" and its "arka_plan_sorgusu"
  searches for that moment's picture; give 1–3 more key narrator lines "gorseller" ("film": true in the 20th century,
  archive film is looked for first). A picture never covers a character's own line.
`,
};

/**
 * A Short's shares (owner, 3 Nov 2026, after DFT Tarih's Shorts — MapRules.SHORT_MAP_SHARE): the moment told on the map
 * between a character hook and a character payoff. Not asked of one under half a minute.
 */
const SHORT_SHARES: Readonly<Record<ScriptLanguage, string>> = {
  tr: `- SHORT PAYLARI (en çok izlenen tarih Short'ları harita hikâyesidir): sürenin yaklaşık %70'i haritada, %30'u çöp
  adamlarla. Karakterli kanca sahnesinden (6–10 sn) sonra an haritada anlatılır — birkaç saniye geniş harita (nerede,
  ne zaman), sonra olayın geçtiği yakın harita ("genislik_km" ≤ 120): gemiler yol alır, pullar yaklaşır ve teker teker
  düşer, oklar satırla vurur; oradaki bir karakter tek cümlesini rozetinden söyler (o harita sahnesinde kendi satırı).
  Sonuç ya da son espri kısa bir karakter sahnesinde (ya da yakın haritada) oynanır.
${SHORT_PICTURES.tr}`,
  en: `- SHARES OF A SHORT (the most-watched history Shorts are map stories): about 70% of the running time on the map, about
  30% with the stick figures. After the character hook scene (6–10 s) tell the moment on the map — a few seconds of the
  wider map for where and when, then the close map where it happens ("genislik_km" ≤ 120): ships sail, tokens close in
  and fall one by one, arrows strike with the lines; a character there says a one-liner from their badge (their own
  line in that map scene). Play the payoff or the last quip in a short character scene (or on the close map).
${SHORT_PICTURES.en}`,
};

/**
 * How many scenes and visible characters a Short gets. A 60 s Short was 3–5 scenes with three characters; the owner's
 * 3-minute Shorts (11 Nov 2026) would stretch that to 40–60 s scenes, so the count grows with the length and keeps
 * the long rules' pace of a new picture every 15–25 s.
 */
export function shortsShape(targetS: number): { readonly min: number; readonly max: number; readonly karakter: string } {
  return {
    min: Math.max(3, Math.round(targetS / 25)),
    max: Math.max(5, Math.round(targetS / 15)),
    karakter: targetS > 90 ? "3–5" : "3",
  };
}

/**
 * A Short's recipe (owner, 2 Nov 2026): a hook in the first 2 seconds, one moment, ~150 words, no cover or subscribe
 * line, the last line leading back into the first. It overrides the long rules where they differ. Since 11 Nov 2026 a
 * Short runs up to 3 minutes: the moment then gets its build-up and outcome (still one event, never a whole war).
 */
const SHORTS_RULES: Readonly<Record<ScriptLanguage, (b: ScriptBrief, words: number) => string>> = {
  tr: (b, words) => `

YOUTUBE SHORTS — bu, telefonda akışta izlenen ${b.hedefSureSn} saniye ya da daha kısa bir YouTube Short; her sahne 16:9 resmin tamamıyla gösterilir (dar dikey pencere yok). Bu kurallar yukarıdakilerle ya da aşağıdakilerle çeliştiğinde bunlar geçerlidir:
- İlk satır (ilk 2 saniye) kancadır: kaydıranı durduran tek, somut, şaşırtıcı cümle. Selam, başlık, "bu videoda" yok.
  Bu satırı anlatıcı DEĞİL, sahnedeki görünür bir karakter söyler — olayın ortasında, kısa (en fazla 8 kelime), bir "jest"
  ya da "efekt" ile; anlatıcı ondan sonra gelir. İlk sahne harita değil, karakterli bir sahnedir.
- Bütün bir savaş ya da hayat değil, TEK bir an: bir karar, bir gaf, bir hile ya da bir dönüm, sonucuyla.${b.hedefSureSn > 90 ? " Süre uzun olduğu için o anın hazırlığını, kendisini ve sonucunu anlat — yine tek olay, başka olaya geçme." : ""}
${b.kisaZamanHaritasi ?? ""}${b.hedefSureSn >= SHORT_SHARES_FROM_S ? SHORT_SHARES.tr : ""}- ${shortsShape(b.hedefSureSn).min}–${shortsShape(b.hedefSureSn).max} sahne, yaklaşık ${words} konuşulan kelime. ${shortsShape(b.hedefSureSn).karakter} görünür karakter; bir sahnede en fazla ikisi konuşur, yan yana durur ve birlikte görünür.
- Sonucu GÖSTER, yalnız anlatma: anlatıcının bir sahnede adını andığı karakterler o sahnenin "sahne_duzeni"nde durur ve
  anlatıcı satırı onları "oyun" ile oynatır (kovalama, yakalama, gülme) — anlatıcı başkalarının yaptığını anlatırken baş
  karakter boş bir sette tek başına durmaz. Final anı da böyle oynanır. Harita sahnesinde bunu haritadaki rozetleri,
  pulları ve gemileri oynar.
- "kelime" ve "bolum" yazı kartı YOK (tam ekran siyah kart akışta kaydırtır); en fazla ilk sahnede bir "yer_tarih".
- "Ne öğreneceksin" vaadi ve sonraki videoya köprü YOK.
- EN SON satırı ANA KARAKTER (en çok konuşan görünür karakter, son sahnede) kendi üslubuyla söyler: izleyiciyi kanalımız
  Crowns & Doodles'a abone olmaya davet eden, konuya bağlı, sıcak ve esprili bir cümle (en fazla 14 kelime).`,
  en: (b, words) => `

YOUTUBE SHORT — this is a YouTube Short of ${b.hedefSureSn} seconds or less, watched on a phone in a feed and shown as the whole 16:9 picture (no narrow vertical window). Where these rules differ from the rules above or below, these win:
- The very first line (within 2 seconds) is the hook: one concrete, surprising sentence that stops a scroller. No greeting, no title, no "in this video".
  A visible character on stage says it — NOT the narrator — in the middle of the action, short (8 words at most), with a
  "jest" or an "efekt"; the narrator comes after it. The first scene is a character scene, not a map.
- Tell ONE moment, not a whole war or a whole life: a single decision, blunder, trick or turn, with its outcome.${b.hedefSureSn > 90 ? " With this length, tell that moment's build-up, the moment itself and its outcome — still one event, never a second one." : ""}
${b.kisaZamanHaritasi ?? ""}${b.hedefSureSn >= SHORT_SHARES_FROM_S ? SHORT_SHARES.en : ""}- ${shortsShape(b.hedefSureSn).min}–${shortsShape(b.hedefSureSn).max} scenes, about ${words} spoken words. ${shortsShape(b.hedefSureSn).karakter} visible characters; at most two of them speak in a scene, standing side by side and seen together.
- SHOW the outcome, never only tell it: the characters the narrator names in a scene stand in that scene's "sahne_duzeni"
  and the narrator line acts them out with "oyun" (a chase, a capture, a laugh) — never the lead alone on an empty set
  while the narration tells what others did. The payoff moment is acted the same way. In a map scene they act as their
  badges, tokens and ships on the map.
- NO "kelime" or "bolum" title card (a full-screen black card makes a feed viewer swipe); at most one "yer_tarih" card on the first scene.
- NO "what you'll learn" promise and NO bridge to the next video.
- The VERY LAST line is spoken by the MAIN CHARACTER (the visible character with the most lines, on stage in the last
  scene), in their own voice: a warm, witty invitation to subscribe to our channel Crowns & Doodles, tied to the topic,
  at most 14 words.`,
};

function bankText(bank: SourceBank | undefined): string {
  if (!bank) return "";
  const facts = bankFactLines(bank, EVIDENCE_CHARS.writer);
  return `

SOURCE BANK — cite ONLY these ids in "kaynaklar" and "kaynak", copy their "kunye" exactly, add no other source:
${bank.kaynaklar.map((k) => `- ${k.id}: ${k.kunye}`).join("\n")}

VERIFIED FACTS — every factual narrator claim must come from this list and cite its source id. Anything else is
dramatisation ("kurgu": true) or carries a hedge; never present it as fact:
${facts.text}${
    facts.shown
      ? `
A fact's "evidence" is the source's own sentence, shown only so you know exactly what the fact rests on (names, ranks,
ships, dates, numbers). Tell every fact in YOUR OWN words: never copy an evidence sentence, or a run of more than eight
of its words, into a line — the sources are other authors' writing. A real person's short famous saying may be quoted.`
      : ""
  }`;
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
  return `${RULES[brief.dil](brief, words)}${isShortBrief(brief) ? SHORTS_RULES[brief.dil](brief, words) : ""}${seriesText(brief.dizi)}${bankText(brief.kaynakBankasi)}${lessonsText(brief.dersler)}

CAST / KADRO
- One narrator: id "anlatici", "gorunur": false, "kostum_paketi": "" and no "kostum".
- 3–6 visible characters, each with a distinct "renk" (#RRGGBB), a distinct "konusma_tarzi", ${voiceRule(brief)}
- "rol": a short role line shown under the name the first time they speak (at most 5 words, e.g. "Ottoman Sultan, age 20").
- "portre": {"wiki": "<exact English Wikipedia article title>"} for EVERY visible character who is a real, named
  historical person: Atölye's costume team reads their article, looks at their portrait and draws their own face shape,
  hair, beard, headwear and clothes as they were in this episode's period (like OverSimplified's Henry VIII after
  Holbein). Still give them a full "kostum" as your best guess; the team corrects it. Leave "portre" out for invented
  or anonymous characters (a legionary, a messenger) and crowds.
- NEVER invent a real-sounding person: a commander, admiral, pilot or minister you cannot name from the sources is an
  unnamed role ("Italian Admiral", "Swordfish Pilot"), and an invented character gets a role or a first name only,
  never a rank and a full name. Every "portre" article is checked; a made-up one stops the script (the Taranto Short's
  "Admiral Luigi de Pignati" — the fleet's real commander was Inigo Campioni).
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
  the key phrase of the line, 2–8 words, same language as the line, cut from its own words — never a new sentence or
  another meaning: the viewer hears the line while reading it (end a shout with "!").
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
  small region the atlas lacks — hand-drawn outlines look crude next to real borders. An atlas year AFTER your story's
  moment may already show its outcome (the 1400 atlas paints Serbia Ottoman; before Kosovo 1389 it was not): then give
  the other side's state as it was then as its own region with "noktalar" — it takes its provinces over the atlas. Strong, distinct colours
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
    "zaman": "gece"   // on the "harita" itself, when the map's events happen at night (a night raid, a night crossing,
        // an attack in the dark): the map darkens, searchlights sweep it and an air raid drops flares. Leave it out
        // for a daytime map — a night attack told on a daylight map looks wrong.
    "gorunus": "dikey" | "egik" | "ikisi"   // usually leave it out: the studio opens a map straight down and tilts it into
        // 2.5D when armies, ships or battles start moving. "dikey" keeps it straight down (a map that only reads borders or
        // a whole region); "egik" tilted from the start; "ikisi" straight down first, then tilted.
  INFO CARDS — while the narrator explains politics, reasons or a striking number, the picture dims and a card comes up
  ("bilgi_kartlari" on the scene, map or character scene; one or two per chapter of a long video, one at a time):
    {"tur": "sema", "baslik": "Rome's two camps", "satir": 1, "dugumler": [{"ad": "Roman Senate"},
      {"ad": "Optimates", "ust": 0, "renk": "#3f6fb5", "karakterler": ["pompey"]}, {"ad": "Populares", "ust": 0, "renk": "#c0392b", "karakterler": ["caesar"], "satir": 2}]}
        // a political chart: who belongs to whom (2–8 boxes; "ust" = the earlier box it hangs from; portraits of visible cast)
    {"tur": "liste", "baslik": "Caesar's advantages", "satir": 3, "maddeler": [{"metin": "Veteran legions", "satir": 3}, {"metin": "Speed", "satir": 4}]}
        // a titled list, each item coming in with the line that says it (2–6 items, at most 6 words each)
    {"tur": "sayac", "satir": 2, "deger": 1000000, "etiket": "Gauls killed in eight years"}   // a number counting up
    {"tur": "guc", "satir": 1, "taraflar": [{"ad": "Romans", "renk": "#c0392b", "sayi": "86,000"}, {"ad": "Carthaginians", "renk": "#2c3e50", "sayi": "50,000"}]}
        // the two sides' armies, each bar growing to its number: whenever the narrator of a scene without a map gives
        // both sides' numbers ("Rome fields 86,000 men. Hannibal? Only 50,000.") — numbers over standing puppets show nothing
  On a close battle map a card darkens the battle: give it before the first unit moves or after the last one, never
  on the lines where units move, fight or flee.
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
        // an emblem the side really bore in that year: no "hac" (cross) before 312 AD, when Constantine's army first
        // marched under a Christian sign, and no "orak_cekic" before 1917.
        // each side's round emblem tokens along a front, in a cluster or ringing a besieged place, sliding to the next
        // formation with its line. "kayip": tokens lost on that line — the sides rush at each other and the losses fall
        // one by one, swords heard. On a fight line give BOTH sides a formation, side by side (on a close map a few
        // hundred metres apart; across a wall: attackers just outside, defenders just inside), never far apart.
        // On a battlefield SPLIT EACH SIDE INTO ITS BODIES OF TROOPS, ONE KIND EACH, as its real order of battle was —
        // the viewer must see who is who and how the battle was fought: "tur": "piyade" (any foot) | "kilicli"
        // (swordsmen) | "mizrakci" (spearmen, pikemen) | "okcu" (archers) | "tufekci" (musketeers, riflemen) | "suvari"
        // (cavalry) | "topcu" (guns); never two kinds in one entry. A side's units share its "taraf", colour and emblem.
        // Each unit has "ad" (its own name: "Janissaries", "Bayezid's right wing") and "kanat": "merkez" | "sol" | "sag" |
        // "on" | "arka" (as the side faces the enemy: its left/right wing, "on" the screen in front, "arka" the reserve).
        // Give ONLY each side's "merkez" unit a formation on its first line; the studio sets the others round it. On a
        // later line a unit does what the narration tells, with NO coordinates: "hareket": "ilerle" (advance) | "hucum"
        // (charge into "hedef": the enemy unit's "ad"; a wing faces the enemy's opposite wing — your left wing meets
        // their right wing) | "kusat" (sweep round "hedef"'s flank) | "geri" (fall back) |
        // "tut" (hold); "kayip" on the fight lines, "bozgun": true where a unit breaks and runs. "etiket" (the side's
        // strength, "11 legions – 47,000 men") on its merkez unit only; a front "hatlar": 2–3 lines deep (Caesar's
        // triplex acies); "vurgu": [line indexes] — while the narrator speaks of the unit it is framed in light.
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
  leaders speak from their badges (a "rozet" at their army, their tent or the walls), so the fight stays in view. Each
  commander's badge stands with his own troops — a wing commander at the end of his wing (facing the enemy, a side's
  right wing is on its right hand), the leader behind his center — and appears with the line that first names him; a
  leader killed or captured in the fight keeps his badge there with "x_satir" on that line.
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
  with losses, the flank turned, the beaten side's blocks breaking ("bozgun") and the camp taken. TELL THE BATTLE STEP
  BY STEP: each tactical step is its own NARRATOR line (the charge; the hold; the sweep round the flank; the rout), and
  that unit's "hareket" is on that very line — never the whole battle in one sentence, never a move carried by a
  character's quip (a quip may follow a step). Guns ("topcu") before 1900 stand in FRONT of the infantry they cover
  ("kanat": "on"; the Ottoman guns chained before the Janissaries at Chaldiran and Mohács). A field battle, in short
  (3–5 units a side, coordinates only for each side's merkez):
    "birlikler": [
      {"taraf": "Normans", "ad": "Norman archers", "tur": "okcu", "kanat": "on", "renk": "#2e6fd1", "amblem": "aslan", "sayi": 3,
       "yerler": [{"satir": 0}, {"satir": 1, "hareket": "ilerle"}, {"satir": 2, "hareket": "geri"}]},
      {"taraf": "Normans", "ad": "Norman foot", "tur": "mizrakci", "kanat": "merkez", "renk": "#2e6fd1", "amblem": "aslan", "sayi": 4,
       "etiket": "7,000 men", "yerler": [{"satir": 0, "cephe": [[lon, lat], [lon, lat]]}, {"satir": 2, "hareket": "hucum", "hedef": "Shield wall", "kayip": 1}]},
      {"taraf": "Normans", "ad": "Breton horse", "tur": "suvari", "kanat": "sol", …, "yerler": [{"satir": 0}, {"satir": 3, "hareket": "geri"}, {"satir": 4, "hareket": "hucum", "hedef": "Fyrd", "kayip": 1}]},
      {"taraf": "Normans", "ad": "Norman knights", "tur": "suvari", "kanat": "sag", …, "yerler": [{"satir": 0}, {"satir": 4, "hareket": "kusat", "hedef": "Shield wall"}]},
      {"taraf": "English", "ad": "Shield wall", "tur": "kilicli", "kanat": "merkez", "renk": "#c0392b", "amblem": "kartal", "sayi": 5,
       "etiket": "7,000 men", "yerler": [{"satir": 0, "cephe": [[lon, lat], [lon, lat]], "hatlar": 2}, {"satir": 2, "kayip": 1}, {"satir": 5, "bozgun": true, "kayip": 2}]},
      {"taraf": "English", "ad": "Fyrd", "tur": "piyade", "kanat": "sag", …, "yerler": [{"satir": 0}, {"satir": 3, "hareket": "hucum", "hedef": "Breton horse"}, {"satir": 4, "kayip": 2}]}]
    "satirlar": [{"karakter": "anlatici", "metin": "<the two armies face each other on the hill>"},
                 {"karakter": "anlatici", "metin": "<the Norman archers loose their arrows; the shield wall holds>"},
                 {"karakter": "anlatici", "metin": "<the Norman foot charges up into the wall>"},
                 {"karakter": "anlatici", "metin": "<the Bretons break; the fyrd chases them down the hill>"},
                 {"karakter": "anlatici", "metin": "<the knights cut the fyrd down and sweep round the wall's flank>"},
                 {"karakter": "anlatici", "metin": "<the wall breaks>"},
                 {"karakter": "<the winning commander>", "metin": "<a quip, after the steps>"}]
    — each move on the narrator line that tells it, seen as it is told, with its arrow; a gunpowder battle the same way
    with "tufekci" lines and "topcu" batteries in front. One move per line, the line naming the unit by the words of its
    "ad" ("the Gauls and Spaniards bulge forward"): the unit sets off on that word, and a unit the line does not tell of
    stands still — while the narrator tells one move, nothing else moves on the map.
    Every battle, anywhere on Earth, is drawn from what you give: each unit's real kind ("okcu" archers loose volleys
    and "topcu"/"tufekci" fire while the fight is on — no other kind shoots), each side's strength with its number of
    men in "etiket" ("50,000 men": the blocks are drawn as dense regiments by it), and the field as it was — "arazi"
    woods, fields and hills at their places, the river by its course. Losses fall on their narrator line and need the
    seconds after it: put at least one more line after a fight's losses, never the losses on a scene's last line.

CROWDS — a group the narrator tells is SEEN as a group (owner): a scene whose lines tell of soldiers, troops, an army,
  pirates, guards, sailors, rebels or a mob carries a "kalabalik" of them — several figures, never one character standing
  in for many ("Caesar came back with troops and captured the pirates" shows Roman soldiers AND a band of pirates).
  Scenes feel big when the story has many people: give such scenes "kalabalik" (extras who never speak):
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
    "orman" | "sahil" | "sokak" | "meydan" | "saray_ici" | "meclis" | "ordugah" | "sur_onu" | "cadir_ici" (inside a commander's tent or pavilion: the war council, the sultan's otağ) | "gemi_guvertesi" (on a ship's deck at sea: a voyage, pirates aboard, a sea fight seen from the ship) | "gemi_kamarasi" (inside a ship's cabin or below deck), "uslup": "roma" | "yunan" |
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
${brief.donemKiyafetleri ? `\n${brief.donemKiyafetleri}\n` : ""}
ALLOWED VALUES
ton: ${EPISODE_TONES.join(", ")}
sahne duygu: ${SCENE_MOODS.join(", ")}
satir duygu: ${EMOTIONS.join(", ")}
jest: ${GESTURES.join(", ")}
hareket: ${MOVES.join(", ")}
sfx (a sound at the start of the line — use them generously on gags, hits, entrances and punchlines, like the reference channel): ${SFX_IDS.map((id) => `${id} (${SFX_NOTES[id]})`).join(", ")}
efekt: ${EFFECTS.join(", ")}
oyun (on a narrator line in a character scene — SHOW what it tells: who on stage acts it out while it is said): [{"karakter": a visible cast id, "jest": …, "duygu": …, "efekt": …}], e.g. "The pirates laughed. Caesar laughed louder." → [{"karakter":"pirate","jest":"kutla","duygu":"mutlu"},{"karakter":"caesar","jest":"kutla","duygu":"mutlu","efekt":"parilti"}]
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
    {"karakter":"anlatici","metin":"…","duygu":"notr","kaynak":["yazar-yil"],"oyun":[{"karakter":"karakter-1","jest":"dusun","duygu":"sinsi"}]},
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

/** What the order-fidelity check reads of an episode: the cast's names and the spoken lines. */
export interface FidelityEpisode {
  readonly oyuncu_kadrosu: readonly { readonly id: string; readonly ad: string }[];
  readonly sahneler: readonly { readonly id: string; readonly satirlar: readonly { readonly karakter: string; readonly metin: string; readonly kurgu?: boolean }[] }[];
}

/**
 * The narrow check after the fact check: does the script tell its order's history right — WHO did and said WHAT, and
 * which way? The general fact check, given the Cannae Short's script and its order (9 Nov 2026), twice found none of
 * the three swaps the order itself contradicted (Maharbal given Hasdrubal's cavalry, Hannibal asking to march on Rome,
 * the centre bent back); asked to list only problems it skipped the comparison, so every fact of the order must get
 * an answer (ScriptEngine.readOrderFidelity turns a "celisir" into a "yanlis" claim for `applyFactCheck`).
 */
export function orderFidelityPrompt(episode: FidelityEpisode, order: string, dil: ScriptLanguage): string {
  const lang = dil === "tr" ? "Turkish" : "American English";
  const names = new Map(episode.oyuncu_kadrosu.map((c) => [c.id, c.ad] as const));
  const lines = episode.sahneler.flatMap((s) => s.satirlar.map((l, i) => `${s.id} #${i} ${names.get(l.karakter) ?? l.karakter}${l.kurgu ? " [invented wording]" : ""}: "${l.metin}"`));
  return `You check one thing: whether this script tells the history of its order right — WHO did and said WHAT, and which way. The owner wrote the order from the sources.

ORDER:
${order.trim()}

CAST (id: name): ${episode.oyuncu_kadrosu.map((c) => `${c.id}: ${c.ad}`).join("; ")}

SCRIPT LINES (scene id, line index, speaker):
${lines.join("\n")}

Split the order into its facts (one deed, troop movement, decision or saying each) and give EVERY fact one entry:
- "olgu": the fact in the order's words; "sahne"/"satir": the line that tells it (the closest one), or none;
- "karar": "ayni" (the line tells it as the order does), "celisir" (it tells it otherwise) or "yok" (no line tells it);
- compare the PERSON (is the deed, the troops, the words or the decision given to the person the order gives it to?) and
  the DIRECTION (forward or back, attack or retreat, urging or refusing, winning or losing, which side) — a line that
  differs in either is "celisir", also an [invented wording] line: its words are free, its history is not;
- for "celisir" give "gerekce" and "yeni_metin": the corrected line in ${lang}, about the same length, keeping the
  joke where it can — for the same speaker (who may refuse or answer instead of urging), or, when history gives the
  words to another character, "karakter": that character's id from the CAST and the line as they say it.
Then add one entry ("olgu": the known fact) for each other line that gives a real person a deed, words or decision
well-known history gives to someone else or the other way round. Never judge numbers, wording or style.
Return ONLY this JSON:
{"olgular":[{"olgu":"…","sahne":"…","satir":0,"karar":"ayni|celisir|yok","gerekce":"…","yeni_metin":"…","karakter":"<only when another character says it>"}]}`;
}

/**
 * The fact-check pass: only problem lines come back, so the answer stays short. `order` is the owner's order text —
 * the facts the owner asked to be told. The Cannae Short (9 Nov 2026) showed what the check had missed: its order said
 * Hasdrubal's cavalry hit the Roman rear and Maharbal told Hannibal he knew how to win but not how to use a victory;
 * the script gave the cavalry to Maharbal, had Hannibal ask "Rome in a week?" (Maharbal urged the march, Hannibal
 * refused) and bent Hannibal's centre back instead of forward. The check passed all three (character lines were
 * flagged "only when they contradict the period") and spent its answer on army sizes — once "correcting" Polybius'
 * 86,000 to 70,000. The owner had the video stopped ("evet durdur ve bu durdurmayı sonraki videolar için sisteme ekle").
 */
/**
 * One correction's fact asked whether it really rules the written line out. The editor's `dayanak` is a real bank fact
 * but not always a contradiction: measured on 11 Nov 2026, "The British sank the royal yacht HHS Glasgow" was given,
 * twice of two, to rewrite the true "the Glasgow fires back" as "did not return fire". Answered by ScriptEngine.
 */
export function supportCheckPrompt(line: string, correction: string, fact: string): string {
  return `A history editor wants to rewrite a line of a documentary because of a verified fact. Decide only whether the fact proves the line wrong.
LINE: ${line}
PROPOSED REWRITE: ${correction}
VERIFIED FACT: ${fact}
Say how the fact relates to what the line states:
- "celisir": the fact states the opposite of something the line says (another person, another order of events, another date, place or number) — both cannot be true;
- "sessiz": the fact does not mention what the line says, even if the rewrite drops it (a fact that a ship was sunk says nothing on whether it fired first);
- "ekler": the fact adds a detail the line leaves out, without ruling the line out;
- "uyumlu": the fact agrees with the line.
Return ONLY JSON: {"iliski":"celisir|sessiz|ekler|uyumlu","neden":"one short sentence"}`;
}

/** At most this many of the history editor's lessons and cases go into one fact check, each at most this long. */
export const FACT_CHECK_LESSONS = 8;
export const FACT_CHECK_LESSON_CHARS = 400;

/**
 * `lessons`: the research brain's lessons and past cases (ScriptBrief.denetciDersleri) — what earlier fact checks
 * missed or got wrong — shown before the episode, bounded.
 */
export function factCheckPrompt(episodeJson: string, dil: ScriptLanguage, bank?: SourceBank, order?: string, lessons?: readonly string[]): string {
  const lang = dil === "tr" ? "Turkish" : "American English";
  const learned = lessons?.length
    ? `\nYOUR LESSONS AND PAST CASES (what earlier checks missed or got wrong — a guide to where to look; never a source of facts):\n${lessons
        .slice(0, FACT_CHECK_LESSONS)
        .map((l) => `- ${l.length > FACT_CHECK_LESSON_CHARS ? `${l.slice(0, FACT_CHECK_LESSON_CHARS - 1)}…` : l}`)
        .join("\n")}\n`
    : "";
  const facts = bank ? bankFactLines(bank, EVIDENCE_CHARS.checker) : undefined;
  const truth = bank
    ? `\nVERIFIED FACTS (ground truth, checked against the cited works): a line that agrees with one of these is "dogru" — never rewrite it or hedge it.\n${facts!.text}\n${facts!.shown ? `A fact's "evidence" is the source's own sentence: judge exact names, ranks, ships, dates and numbers by it; "dayanak" may copy the fact or its evidence.\n` : ""}`
    : "";
  const ordered = order?.trim()
    ? `\nTHE OWNER'S ORDER (written from the sources): a line that contradicts it is "yanlis" unless the verified facts say otherwise.\n${order.trim()}\n`
    : "";
  return `You are a meticulous history editor. Check this episode script (spoken text is ${lang}) for history a viewer would take away wrong.${truth}${ordered}
Look hardest at the errors that matter most, in this order:
1. People swapped or deeds turned around: who commanded which troops, who struck where, who won, who said a famous line, who urged an action and who refused it. A real person's line that gives them another person's words, decision or deed, or turns their known position around, is "yanlis" — also when the line is "kurgu": true (the general who refused to march must not be the one saying "let's march").
2. Manoeuvres told the wrong way: advancing or falling back, which wing, what happened first.
3. Anachronisms: objects, words, titles or places from another age.
4. Numbers, dates and places: a figure inside the range the main ancient or modern sources give is "dogru" — never replace one source's figure with another's; only a figure no source gives is "yanlis".
For each problem line decide: "tartismali" (disputed / traditional account), "yanlis" (wrong) or "kaynaksiz" (plausible but its cited source does not support it or none is cited).
- yanlis: give "yeni_metin", the corrected line in the same language, length and style; a joke stays a joke where it can. When history gives the words to another character, also give "karakter": that character's id from oyuncu_kadrosu (the line as they say it).
- yanlis: also give "dayanak": the VERIFIED FACT or the sentence of THE OWNER'S ORDER the line contradicts, copied exactly. A correction without one is not applied — your memory of a date, place or detail is not proof (one moved a famous order to the wrong month). A date, place, number or detail nothing listed contradicts is "kaynaksiz" (say why in "gerekce"); a swapped person or deed (rule 1) stays "yanlis".
- tartismali: give "yeni_metin" with a hedge ("${dil === "tr" ? "rivayete göre" : "legend has it"}" or similar) added.
- kaynaksiz: give "kaynak_onerisi" only for a work you are certain exists; otherwise leave it out.
- Character lines with "kurgu": true are invented wording: their exact words need no source, but rules 1–3 apply to them.
- Costumes and settings: a visible real person dressed as they would not be in that scene (a civilian toga on the battlefield, armour of another age) and other anachronisms of costume or setting go in "genel_not".
List ONLY problem lines (never correct ones). "sahne" is the scene id, "satir" the 0-based line index.
Return ONLY this JSON:
{"iddialar":[{"sahne":"s1-kanca","satir":0,"karar":"yanlis","gerekce":"…","yeni_metin":"…","karakter":"<only when another character says it>","dayanak":"<the verified fact or order sentence, copied>","kaynak_onerisi":"…"}],"genel_not":"…"}
${learned}
EPISODE:
${episodeJson}`;
}
