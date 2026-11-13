import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { AIProvider } from "../../ai/providers/AIProvider";
import { type CouncilLog, type DebateEntry, readJsonAnswer } from "../council/Council";
import { recall } from "../council/ExperienceMemory";
import { LIKENESS_OK } from "../council/RetouchBrain";
import { toLook, toRenderCast } from "../costumes/CastMapper";
import { loadAccessories, packCatalog } from "../costumes/CostumePackLoader";
import { costumeRootsFor, NEW_PART, type PartRecord, type PartSlot, partKey, puppetStills } from "../costumes/PartDesigner";
import { AGES, type CastCostume, type CastEntry, type Episode, FACE_SHAPES, GARMENTS, HAIR_STYLES, NOSES } from "../episode/EpisodeTypes";
import { PART_FIELDS, validateEpisode } from "../episode/EpisodeValidator";
import type { V3Look } from "../render/RenderPlanTypes";
import { fetchArticle } from "../research/SourceResearch";
import type { V3Budget, V3ModelChoice } from "../script/V3Budget";
import { runChecked } from "../util/Proc";
import type { V3Paths } from "../V3Paths";
import type { PartReference } from "../wardrobe/WardrobeBrain";
import { faceMeasurer, findPortrait, type PortraitResult } from "./PortraitFaces";

/**
 * The likeness designer of the costume brain (owner direction, 20 Oct 2026): the important real people of an episode
 * are drawn the way the reference channel draws Henry VIII — our flat puppet, but with the person's own face shape,
 * skin, nose, hair, beard, headwear and clothes, taken from their portrait and corrected to how they looked IN the
 * episode's period (Henry at 17 in 1509 is not the bearded Henry of Holbein's 1537 portrait).
 *
 * For each cast member with `portre.wiki`: the historian reads the appearance sentences of the person's Wikipedia
 * article and writes how they looked and dressed in the period; the picture researcher finds a portrait (the judge
 * prefers one near that age); the designer looks at the portrait with the historian's note and writes a likeness
 * sheet — face fields and a costume whose missing parts are ordered ("yeni:Henry VIII's …") from the wardrobe, which
 * draws them with the portrait as its reference. After the parts are made, the cartoon and the portrait are judged
 * side by side. A finished likeness is kept per person and period, so a later episode reuses it for free.
 * Crowds and invented characters are not touched (soldiers in a crowd may share one look).
 */
export interface LikenessDeps {
  readonly paths: V3Paths;
  /** Commons cache (portraits) and Wikipedia cache (articles). */
  readonly commonsCache: string;
  readonly wikiCache: string;
  /** The free vision judge that picks the portrait. */
  readonly judge: AIProvider;
  readonly budget: V3Budget;
  /** Writes the likeness sheet and judges the likeness (needs image input). */
  readonly designer: V3ModelChoice;
  /** The historian's period note (text only). */
  readonly critic: V3ModelChoice;
  readonly council?: CouncilLog;
  readonly log: (s: string) => void;
  /** Cast id → the art director's differences: redesign these people (the retouch brain's order). */
  readonly redo?: ReadonlyMap<string, readonly string[]>;
}

export interface PeriodNote {
  readonly yas?: number;
  readonly gorunus: string;
  readonly giyim: string;
  readonly simge: string;
  readonly fark: string;
}

export interface LikenessRecord {
  readonly castId: string;
  readonly kisi: string;
  readonly donem: string;
  readonly kaynak: "kutuphane" | "tasarim" | "degismedi";
  readonly not?: PeriodNote;
  readonly portre?: { readonly baslik: string; readonly url: string; readonly puan: number; readonly donemPuani?: number };
  readonly tarif?: string;
  /** Part descriptions this likeness ordered from the wardrobe. */
  readonly siparisler: readonly string[];
  readonly sorunlar: readonly string[];
  /** Side-by-side check after the parts were made (0–10), and what still differs. */
  readonly benzerlik?: number;
  readonly farklar?: readonly string[];
  /** What the code changed in the designer's sheet and why (a portrait's beard put back, a writer's order kept). */
  readonly duzeltmeler?: readonly string[];
}

export interface LikenessOutcome {
  readonly episode: Episode;
  readonly records: LikenessRecord[];
  /**
   * Part key → the person's portrait and face, for the wardrobe (see designParts). `redraw`: the person was redesigned
   * with the art director's differences, so the part is drawn anew rather than taken from a similar library part.
   */
  readonly references: Map<string, { ref?: PartReference; look?: V3Look; redraw?: boolean }>;
  /** Portrait previews by cast id, for the side-by-side check. */
  readonly portraits: Map<string, PortraitResult>;
}

const LOOK_WORDS =
  /\b(appearance|appeared|beard(ed)?|moustache|mustache|hair(ed|line)?|bald(ing|ness)?|tall|height|stout|obese|corpulent|overweight|portly|fat|thin|slim|wore|wearing|dressed|cloth(es|ing)|garments?|robes?|toga|crown(ed)?|wreath|hat|helmet|armou?r|uniform|wig|portraits?|depicted|likeness|complexion|eyes|red-haired|blond(e)?|scar)\b/i;

/** Sentences of an article that say how the person looked or dressed (the historian's evidence). */
export function appearanceSentences(text: string, max = 14): string[] {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"“(])/);
  return sentences.filter((s) => s.length >= 30 && s.length <= 400 && LOOK_WORDS.test(s)).slice(0, max);
}

/**
 * The historian's note on how a person looked in the episode's year. `lessons`: the costume brain's lessons about this
 * person (checked against portraits). Until 11 Nov 2026 the note was written without them: for the Gallipoli video it
 * called Mustafa Kemal "clean-shaven" in 1915 (he wore a moustache; his writer had ordered one), aged 37 (he was 34),
 * and the designer drew him without it — likeness 6/10 in both rounds.
 */
export function periodNotePrompt(c: CastEntry, episode: Episode, wiki: string, sentences: readonly string[], lessons: readonly string[] = []): string {
  return `You are the historian on the costume team of an animated history show. Before the illustrator draws ${wiki}, say how this person looked and dressed IN ${episode.donem}, during the events of the episode ("${episode.konu}") — not at another time of their life.
ROLE IN THE EPISODE: ${c.rol}
FROM THEIR WIKIPEDIA ARTICLE (sentences about appearance and dress; may be empty):
${sentences.map((s) => `- ${s}`).join("\n") || "- (none found)"}${lessons.length ? `\nTHE COSTUME TEAM'S LESSONS (checked against portraits and sources on earlier videos; they win over your own memory):\n${lessons.map((l) => `- ${l}`).join("\n")}` : ""}
Use these sentences and well-established history; do not invent details. When the famous portraits show them at a different age than in ${episode.donem}, say what differs (younger or older, beard or none, weight, hair) — only what you know, never a guess.
Return ONLY JSON: {"yas": <their age in ${episode.donem} as a number, or null>, "gorunus": "<face, build, hair and beard in ${episode.donem}, at most 45 words>", "giyim": "<what they wore then, with colours and headwear, at most 45 words>", "simge": "<an object they carried then (sword, sceptre, scroll), or empty>", "fark": "<how the famous portraits differ from how they looked in ${episode.donem}, or empty>"}`;
}

export function readPeriodNote(text: string): PeriodNote | undefined {
  const v = readJsonAnswer<Record<string, unknown>>(text);
  if (!v) return undefined;
  const s = (x: unknown, n: number) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, n) : "");
  const yas = typeof v.yas === "number" && v.yas > 0 && v.yas < 120 ? Math.round(v.yas) : undefined;
  return { ...(yas !== undefined ? { yas } : {}), gorunus: s(v.gorunus, 400), giyim: s(v.giyim, 400), simge: s(v.simge, 120), fark: s(v.fark, 300) };
}

/** Flat cartoon colours for the colour words a historian's note uses, in the order the words are tried. */
const COLOUR_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\b(scarlet|crimson|red)\b/i, "#b3262e"],
  [/\b(purple|violet|tyrian)\b/i, "#6b2d7b"],
  [/\b(blue|azure|navy)\b/i, "#2f5fa0"],
  [/\bgreen\b/i, "#3e7b3a"],
  [/\b(gold(en)?|yellow|saffron)\b/i, "#d9a521"],
  [/\bbrown\b/i, "#7a4b2a"],
  [/\b(grey|gray)\b/i, "#8a8a8a"],
  [/\bblack\b/i, "#2a2630"],
  [/\bwhite\b/i, "#f3f3f3"],
];

/** The colours a text names, in the order they appear (each once). */
export function noteColours(text: string): string[] {
  return COLOUR_WORDS.map(([re, hex]) => ({ hex, at: text.search(re) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.hex);
}

const CLOAK = /\b(cloak|cape|mantle|paludamentum|sagum|chlamys|lacerna|pelisse)\b/i;

/**
 * The cloak the historian's note says the person wore ("a red military cloak (paludamentum)"), as a colour: the colour
 * named in the same clause, else crimson. Undefined when the note names no cloak.
 */
export function cloakFromNote(giyim: string): string | undefined {
  const clause = giyim.split(/[,;]|\band\b/i).find((p) => CLOAK.test(p));
  if (!clause) return undefined;
  return noteColours(clause).find((hex) => hex !== "#f3f3f3") ?? "#b3262e";
}

/** A costume with the note's cloak when the designer left it off (a cloak drawn since 21 Oct 2026; older sheets lack it). */
export function withNoteCloak(k: CastCostume, note: PeriodNote | undefined): CastCostume {
  if (k.pelerin || !note) return k;
  const cape = cloakFromNote(note.giyim);
  return cape ? { ...k, pelerin: cape } : k;
}

/** Uniform colours a historian's note names, in its own order: lower-case "navy" is a colour, "U.S. Navy" a service. */
const UNIFORM_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\bnavy\b(?! blue)|\bnavy blue\b/, "#232a36"],
  [/\b(khaki|tan)\b/i, "#b8a575"],
  [/\b(olive|field grey|field gray|feldgrau)\b/i, "#5f5f34"],
  [/\b(scarlet|crimson|red)\b/i, "#b3262e"],
  [/\b(blue|azure)\b/i, "#2f5fa0"],
  [/\bgreen\b/i, "#3e7b3a"],
  [/\bbrown\b/i, "#7a4b2a"],
  [/\b(grey|gray)\b/i, "#8a8a8a"],
  [/\bblack\b/i, "#2a2630"],
  [/\bwhite\b/i, "#f3f3f3"],
];

/** A colour's family (hue bucket; greys and near-blacks one family), so "dark navy" and "#2f5fa0" agree. */
export function colourFamily(hex: string): "grey" | "red" | "brown" | "olive" | "green" | "blue" | "purple" {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  if (s < 0.12 || l < 0.08 || l > 0.94) return "grey";
  const d = max - min;
  const h = (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return h < 15 || h >= 340 ? "red" : h < 45 ? "brown" : h < 75 ? "olive" : h < 165 ? "green" : h < 260 ? "blue" : "purple";
}

/**
 * The uniform's main colour the note names (the clause that names the uniform, before "with"), undefined when it names
 * none or only white (a cap, a shirt).
 */
export function uniformColourFromNote(giyim: string): string | undefined {
  const clause = giyim.split(/[;.]/).find((p) => /\buniform\b/i.test(p))?.split(/\bwith\b/i)[0];
  if (!clause) return undefined;
  const hit = UNIFORM_WORDS.map(([re, hex]) => ({ hex, at: clause.search(re) })).filter((x) => x.at >= 0 && x.hex !== "#f3f3f3").sort((a, b) => a.at - b.at)[0];
  return hit?.hex;
}

/**
 * A uniform in the colour the historian's note gives it. The Guadalcanal Short (12 Nov 2026): the note said "U.S. Navy
 * rear admiral's uniform in dark navy blue", the designer kept the script's olive drab for Willis Lee alone (the other
 * three admirals were turned navy) and the side-by-side judge marked it down to 6/10. Only a uniform, and only when the
 * colour families differ: a shade the designer chose within the right family stays.
 */
export function withNoteUniform(k: CastCostume, note: PeriodNote | undefined): CastCostume {
  if (!note || k.giysi !== "uniforma") return k;
  const want = uniformColourFromNote(note.giyim);
  return want && colourFamily(want) !== colourFamily(k.renkler.ana) ? { ...k, renkler: { ...k.renkler, ana: want } } : k;
}

/**
 * A part reference as plain words (Cannae, 9 Nov 2026: the sheet named "gardirop/hannibal-s-bronze-helmet-with-engraved-b-c72c59",
 * which became the order "Hannibal's hannibal s bronze helmet with engraved b c72c59"; the chief read the id's hash as a
 * colour, asked to drop "the c72c59 hue", the designer painted the helmet red-brown and the art director refused it
 * 1/10 three times, so Hannibal went bareheaded). The pack, the id's hash, the letter a cut-off slug ends with and the
 * person's own name in front ("hannibal s") are dropped.
 */
export function partWords(ref: string, person?: string): string {
  const slug = ref.replace(/^yeni:/, "").replace(/^.*\//, "");
  // A designed part's id is its cut description and a hash; the cut may leave one letter ("engraved-b-c72c59").
  // A hash holds a digit, so a word that ends a plain id ("facade", "beaded") is not taken for one.
  const HASH = /-(?=[a-f]*\d)[0-9a-f]{6}$/i;
  const words = (HASH.test(slug) ? slug.replace(HASH, "").replace(/-[a-z]$/i, "") : slug).replace(/[-_]+/g, " ").trim();
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const names = new Set((person ?? "").split(/\s+/).filter((w) => w.length > 1).map(fold));
  const own = /^(\S+) s (.+)$/.exec(words);
  return own && names.has(fold(own[1]!)) ? own[2]! : words;
}

/** One line per other named character: what they already wear, so the designer makes this person look different. */
export function castLooks(episode: Episode, exceptId: string): string[] {
  const name = (ref: string) => partWords(ref);
  return episode.oyuncu_kadrosu
    .filter((o) => o.id !== exceptId && o.gorunur && o.kostum)
    .map((o) => {
      const k = o.kostum!;
      return `${o.ad}: ${k.giysi} ${k.renkler.ana} with ${k.renkler.ikincil}${k.pelerin ? `, cloak ${k.pelerin}` : ""}${k.bas ? `, headwear "${name(k.bas)}"` : ""}`;
    });
}

/**
 * The portrait is evidence, the historian's note a model's recollection (Waterloo, 6 Nov 2026: the note called Blücher
 * "clean-shaven" beside a portrait with his famous moustache; the cartoon lost it and the check asked to keep it off).
 */
export const PORTRAIT_OVER_NOTE = "Where the portrait and the note disagree about the face, hair, beard or moustache, the portrait is right (the note may say what they wore that year).";
/**
 * Old words for a weathered face (Waterloo, 6 Nov 2026: the note's "very brown complexion" from a contemporary of
 * Wellington, and Lawrence's varnished portrait, gave him a brown skin #b98c6a; the check then asked for "much browner").
 */
export const OLD_COMPLEXION = "in an old description of a European, a \"brown\", \"tanned\", \"swarthy\", \"sallow\" or \"yellowish\" complexion means light skin weathered by sun, war or illness — a slightly warmer light tone such as #efd0b0, never a dark skin";

/**
 * The name a new part's order starts with: the article title before its first comma or bracket. The Taranto Short's
 * "Andrew Cunningham, 1st Viscount Cunningham of Hyndhope's row of WWII British" (11 Nov 2026) lost "medal ribbons"
 * to the 80-character order limit; three paid rounds drew an unknown object and the part was dropped, while the
 * free chest family would have drawn it at once.
 */
export function partOwner(wiki: string): string {
  return wiki.split(/[,(]/)[0]!.trim() || wiki;
}

export function sheetPrompt(c: CastEntry, episode: Episode, wiki: string, note: PeriodNote | undefined, portraitTitle: string | undefined, fixes?: readonly string[], lessons: readonly string[] = [], history: readonly string[] = []): string {
  const owner = partOwner(wiki);
  const retouch = fixes?.length ? `\nA PREVIOUS CARTOON OF ${wiki} WAS SET NEXT TO THE PORTRAIT AND FELL SHORT. The art director's differences: ${fixes.join("; ")}. Fix exactly these (order new parts where needed); keep what was right.\n` : "";
  const historyBlock = history.length
    ? `\nEARLIER DESIGNS OF ${wiki} FOR ${episode.donem}, SCORED NEXT TO THE PORTRAIT (best first):\n${history.map((h) => `- ${h}`).join("\n")}\nStart from the best-scored design and change only what its notes name. Never undo a feature a better-scored design had: a note that contradicts an earlier design's notes is the judge's noise, not an instruction.\n`
    : "";
  const others = castLooks(episode, c.id);
  const othersBlock = others.length
    ? `\nTHE OTHER NAMED CHARACTERS OF THE EPISODE ALREADY LOOK LIKE THIS:\n${others.map((o) => `- ${o}`).join("\n")}\n${wiki} must be told apart from every one of them at a glance by the clothes too, not only the face: where history allows, a different garment, colours, cloak or headwear (the reference channel colour-codes its characters).\n`
    : "";
  const lessonBlock = lessons.length ? `\nLESSONS FROM EARLIER EPISODES (follow them):\n${lessons.map((l) => `- ${l}`).join("\n")}\n` : "";
  return `You design the cartoon of a real historical person for an animated history show in the style of OverSimplified: flat colours, bold dark outlines, a simple puppet body — the person recognisable from their headwear, hair, beard, face shape and clothes, the way OverSimplified draws Henry VIII after Holbein's portrait.
PERSON: ${wiki} — ${c.rol}
THE EPISODE: "${episode.konu}", set in ${episode.donem}. Draw them as they looked THEN.
HISTORIAN'S NOTE for ${episode.donem}: ${note ? `age ${note.yas ?? "unknown"}; looks: ${note.gorunus}; dress: ${note.giyim}${note.simge ? `; carries: ${note.simge}` : ""}${note.fark ? `; differs from the famous portraits: ${note.fark}` : ""}` : "none"}
${portraitTitle ? `PORTRAIT (attached): ${portraitTitle.replace(/^File:/, "")} — take their features and dress from it, corrected by the historian's note for ${episode.donem}. ${PORTRAIT_OVER_NOTE}` : "No portrait was found: work from the historian's note."}
THE SCRIPT'S COSTUME (keep what already fits): ${JSON.stringify(c.kostum ?? {})}
${othersBlock}${lessonBlock}${historyBlock}${retouch}
Choose:
- "yuz": {"sekil": yuvarlak (round) | oval | uzun (long) | genis (wide, heavy jowls) | kare (square jaw); "ten": skin colour #RRGGBB for a flat cartoon (light skin is a pale warm white like #f6e7d8; darker skins true to the person — judged from who they were and the historian's notes, never from the paint of an old fresco, icon, miniature or varnished painting, which age darkens and browns; ${OLD_COMPLEXION}); "burun": kucuk (small) | duz (straight) | iri (big, round) | kemerli (aquiline, Roman) | kalkik (upturned); "kas_renk": eyebrow colour #RRGGBB (their hair colour; grey or white when old); "yas": genc (under 35) | orta (35–55) | yasli (over 55)}
- "sac": parametric hair {"stil": kisa (short) | dalgali (wavy) | yan_ayrik (side part) | uzun (to the shoulders) | topuz (bun) | orgu (braids) | kel (bald) | kivircik (curly) | kakul (fringe) | geriye (combed back) | seyrek (receding: bald crown, hair at the back and sides); "renk": #RRGGBB}, or null when a drawn haircut is ordered or the headwear hides all the hair.
- "sac_parca": "yeni:${owner}'s <haircut>" only when their haircut is distinctive and no parametric style fits; else null.
- "bas": the headwear they wore in ${episode.donem} ("yeni:${owner}'s <description>"), the script's item to keep, or null for a bare head.
- "sakal", "biyik": beard and moustache ("yeni:${owner}'s <description>"), or null if clean-shaven in ${episode.donem}.${portraitTitle ? ` Draw the beard and moustache the attached portrait shows: a note's "clean-shaven" is the historian's memory and never takes away what the portrait shows.` : ""}
${portraitTitle ? `- "portre_kil": the facial hair the attached portrait itself shows, whatever the note says: "sakal_biyik" (beard and moustache) | "sakal" (beard only) | "biyik" (moustache only) | "yok" (clean-shaven) | "gorunmuyor" (face too small or hidden).
` : ""}- "giysi": kaftan | cubbe (robe) | zirh (armour) | onluk (apron) | bizans | yeniceri | sade (plain tunic) | tunik | toga | ceket (long coat, 1600s on) | uniforma | takim (modern suit) | elbise (long dress).
- "renkler": {"ana": main, "ikincil": second, "ic": undergarment, "sus": trim}, each #RRGGBB, true to the portrait and the period.
- "yaka": "kurk" (fur collar and fur front bands) or "yok".
- "pelerin": the colour #RRGGBB of the cloak or cape they wore over the shoulders in ${episode.donem} (a Roman general's paludamentum, a royal mantle), or null when they wore none.
- "gogus": what they wore on the chest (chain of office, order sash, medals, pendant): "yeni:${owner}'s <description>", or null.
- "el_on": an object they held ("yeni:${owner}'s <description>"), the script's item to keep, or null.
- "tarif": one sentence: what makes this cartoon recognisably ${wiki} in ${episode.donem}.
Every "yeni:" description starts with "${owner}'s " and is at most 70 characters, concrete (shape, colour, decoration). Order only what they really wore.
Return ONLY JSON with exactly these keys.`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const REF = /^(([a-z0-9-]+\/)?[a-z0-9-]+|yeni:.{3,80})$/;
const SHEET_PARTS = ["bas", "sakal", "biyik", "sac_parca", "gogus", "el_on"] as const;

/** A part value from the sheet: a catalog ref or an order cut to the validator's 80 characters; null removes it. */
function partValue(v: unknown): string | null | undefined {
  if (v === null || (typeof v === "string" && /^(none|null|yok|-)?$/i.test(v.trim()))) return null;
  if (typeof v !== "string") return undefined;
  let t = v.trim();
  if (t.startsWith("yeni:")) {
    const body = t.slice(5).trim().replace(/\s+/g, " ");
    t = `yeni:${body.length > 80 ? body.slice(0, 80).replace(/\s+\S*$/, "") : body}`;
  }
  return REF.test(t) ? t : undefined;
}

/**
 * The likeness sheet applied to the script's costume (pure): every valid field replaces the script's, null removes a
 * part, anything unreadable keeps the script's value and is reported. Likeness faces get the detailed eyes.
 */
export function applySheet(costume: CastCostume, raw: unknown): { kostum: CastCostume; sorunlar: string[]; tarif: string } {
  const sorunlar: string[] = [];
  const sheet = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const k: Record<string, unknown> = { ...costume };
  const y = (typeof sheet.yuz === "object" && sheet.yuz !== null ? sheet.yuz : {}) as Record<string, unknown>;
  const yuz: Record<string, unknown> = { goz: "detayli" };
  if (FACE_SHAPES.includes(y.sekil as never)) yuz.sekil = y.sekil;
  if (NOSES.includes(y.burun as never)) yuz.burun = y.burun;
  if (AGES.includes(y.yas as never)) yuz.yas = y.yas;
  if (typeof y.ten === "string" && HEX.test(y.ten)) yuz.ten = y.ten;
  if (typeof y.kas_renk === "string" && HEX.test(y.kas_renk)) yuz.kas_renk = y.kas_renk;
  if (Object.keys(yuz).length < 4) sorunlar.push("yüz alanları eksik okundu");
  k.yuz = yuz;
  if (GARMENTS.includes(sheet.giysi as never)) k.giysi = sheet.giysi;
  else if (sheet.giysi !== undefined) sorunlar.push(`giysi okunamadı: ${String(sheet.giysi)}`);
  const r = sheet.renkler as Record<string, unknown> | undefined;
  if (r && ["ana", "ikincil", "ic", "sus"].every((key) => typeof r[key] === "string" && HEX.test(r[key] as string))) k.renkler = { ana: r.ana, ikincil: r.ikincil, ic: r.ic, sus: r.sus };
  else sorunlar.push("renkler okunamadı; senaryonun renkleri kaldı");
  if (sheet.yaka === "kurk" || sheet.yaka === "yok") k.yaka = sheet.yaka;
  if (typeof sheet.pelerin === "string" && HEX.test(sheet.pelerin)) k.pelerin = sheet.pelerin;
  else if (sheet.pelerin === null || (typeof sheet.pelerin === "string" && /^(none|null|yok|-)?$/i.test(sheet.pelerin.trim()))) delete k.pelerin;
  else if (sheet.pelerin !== undefined) sorunlar.push(`pelerin okunamadı: ${String(sheet.pelerin)}`);
  for (const field of SHEET_PARTS) {
    if (!(field in sheet)) continue;
    const v = partValue(sheet[field]);
    if (v === null) delete k[field];
    else if (v !== undefined) k[field] = v;
    else sorunlar.push(`${field} okunamadı`);
  }
  const sac = sheet.sac as Record<string, unknown> | null | undefined;
  if (sac === null || typeof k.sac_parca === "string") delete k.sac;
  else if (sac && HAIR_STYLES.includes(sac.stil as never) && typeof sac.renk === "string" && HEX.test(sac.renk)) k.sac = { stil: sac.stil, renk: sac.renk };
  else if (sac !== undefined) sorunlar.push("saç okunamadı");
  return { kostum: k as unknown as CastCostume, sorunlar, tarif: typeof sheet.tarif === "string" ? sheet.tarif.slice(0, 300) : "" };
}

const SLOT_OF: Readonly<Record<(typeof SHEET_PARTS)[number], PartSlot>> = { bas: "head", sakal: "beard", biyik: "mustache", sac_parca: "hair", gogus: "chest", el_on: "hand" };

/** The orders a likeness costume makes, with their slots. */
export function likenessOrders(k: CastCostume): { slot: PartSlot; tarif: string }[] {
  const rec = k as unknown as Record<string, unknown>;
  return SHEET_PARTS.flatMap((f) => {
    const m = NEW_PART.exec(String(rec[f] ?? ""));
    return m ? [{ slot: SLOT_OF[f], tarif: m[1]!.trim() }] : [];
  });
}

/** Beard and moustache as evidence says them: true = they have it, false = they have none, absent = not said. */
export interface FacialHair {
  readonly beard?: boolean;
  readonly moustache?: boolean;
}

const BEARD_WORD = /\b(beard(ed|s)?|sakal\w*)/i;
const MOUSTACHE_WORD = /\b(moustach\w*|mustach\w*|b[ıi]y[ıi]k\w*)/i;
const SHAVEN = /\b(clean[- ]?shaven|beardless|shaven|shaved|facial hair\b[^.;]*\b(none|absent))|sakals[ıi]z|b[ıi]y[ıi]ks[ıi]z|t[ıi]ra[sş]l[ıi]/i;
const NEGATED = /\b(no|without|lacks?|lacking|missing|absent|not|never|none)\b/i;
const PORTRAIT_SIDE = /\b(portrait|painting|miniature|original|reference|engraving|portre\w*)\b/i;
const ASKS_FOR = /\b(add|give|needs?|should (have|show|get|wear)|missing|lacks?|lacking|is absent)\b/i;

/** What a clause says of one kind of facial hair: true when it is there, false when it is denied. */
function saysHair(clause: string, word: RegExp): boolean | undefined {
  if (!word.test(clause)) return SHAVEN.test(clause) && !BEARD_WORD.test(clause) && !MOUSTACHE_WORD.test(clause) ? false : undefined;
  return !(NEGATED.test(clause) || SHAVEN.test(clause));
}

const clauses = (text: string) => text.split(/[.;—]|\b(?:but|while|whereas|however)\b/i).map((s) => s.trim()).filter(Boolean);

/**
 * Facial hair a describing text affirms (the portrait judge's "Sultan shown with a full beard", the designer's look):
 * true when a clause names it without a denial, false when a clause says clean-shaven or "no beard".
 */
export function facialHairSaid(text: string): FacialHair {
  const out: { beard?: boolean; moustache?: boolean } = {};
  for (const c of clauses(text)) {
    const b = saysHair(c, BEARD_WORD);
    const m = saysHair(c, MOUSTACHE_WORD);
    if (b !== undefined && out.beard === undefined) out.beard = b;
    if (m !== undefined && out.moustache === undefined) out.moustache = m;
  }
  return out;
}

/** The designer's "portre_kil" answer (what the attached portrait shows), else what the portrait judge wrote. */
export function portraitFacialHair(answer: unknown, judgeText = ""): FacialHair {
  const a = typeof answer === "string" ? answer.toLowerCase().replace(/[\s-]+/g, "_") : "";
  const designer: FacialHair = /^(sakal_biyik|beard_and_moustache|both)$/.test(a)
    ? { beard: true, moustache: true }
    : /^(sakal|beard)$/.test(a)
      ? { beard: true, moustache: false }
      : /^(biyik|moustache|mustache)$/.test(a)
        ? { beard: false, moustache: true }
        : /^(yok|none|clean_shaven)$/.test(a)
          ? { beard: false, moustache: false }
          : {};
  const judge = facialHairSaid(judgeText);
  // A beard either of them saw is there: the designer's "none" never hides what the judge described.
  const pick = (d?: boolean, j?: boolean) => (d === true || j === true ? true : d ?? j);
  const beard = pick(designer.beard, judge.beard);
  const moustache = pick(designer.moustache, judge.moustache);
  return { ...(beard !== undefined ? { beard } : {}), ...(moustache !== undefined ? { moustache } : {}) };
}

/**
 * What the side-by-side check's differences ask for facial hair (Siege of Baghdad Short, 13 Nov 2026: "Cartoon shows no
 * beard or moustache, but the portrait has a full beard and moustache" for Murad IV at 3/10, and nothing added them).
 * The portrait's side of a sentence decides; else "add a beard", "missing moustache" or "the cartoon has no beard".
 * true = add, false = the portrait has none.
 */
export function facialHairFixes(farklar: readonly string[]): FacialHair {
  const out: { beard?: boolean; moustache?: boolean } = {};
  for (const [kind, word] of [["beard", BEARD_WORD], ["moustache", MOUSTACHE_WORD]] as const) {
    for (const line of farklar) {
      const parts = clauses(line).filter((c) => word.test(c));
      const portrait = parts.find((c) => PORTRAIT_SIDE.test(c));
      const verdict = portrait !== undefined ? !NEGATED.test(portrait) && !SHAVEN.test(portrait) : parts.some((c) => ASKS_FOR.test(c) || (/\b(cartoon|drawing|ours)\b/i.test(c) && NEGATED.test(c))) ? true : undefined;
      if (verdict !== undefined) {
        out[kind] = verdict;
        break;
      }
    }
  }
  return out;
}

/** A hair colour as the word the part families read ("black", "grey"…), from #RRGGBB. */
export function hairWord(hex: string | undefined): string {
  if (!hex || !HEX.test(hex)) return "dark";
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [number, number, number];
  const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
  const fam = colourFamily(hex);
  if (l > 0.85) return "white";
  if (fam === "grey") return l > 0.45 ? "grey" : "black";
  if (l < 0.22) return "black";
  if (fam === "red" && l < 0.6) return "red";
  if ((fam === "olive" || fam === "brown") && l > 0.55) return "blond";
  return "brown";
}

/**
 * A note's text without its "clean-shaven" claim, for a likeness that wears the beard or moustache its portrait shows:
 * the wardrobe and the side-by-side check get the portrait's face, not the historian's memory of it.
 */
export function withoutShavenClaims(text: string): string {
  return text
    .replace(/(,\s*|;\s*|\band\s+)?\b(clean[- ]?shaven|beardless)\b(\s+and\s+(younger|young)[- ]looking)?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
}

/** A period portrait counts as evidence of the face from this period score on (the judge's 0–10 "dönem"). */
export const PORTRAIT_PERIOD_FIT = 7;

/**
 * The beard and moustache a likeness keeps, decided after the designer's sheet (pure). Evidence beats the historian's
 * note: the art director's side-by-side differences first, then what the portrait shows (the designer's "portre_kil",
 * the judge's description). A beard the evidence shows and the sheet left off is put back — the writer's own order when
 * they asked for one, else a free family part in the person's hair colour ("yeni:Murad IV's full black beard"). A
 * writer's order the sheet removed is kept unless the portrait shows none (`keepWriter`; until 13 Nov 2026 a sheet's
 * null dropped it silently: Tayyar Mehmed Pasha's "thick black moustache", Siege of Baghdad). Every change is said.
 */
export function settleFacialHair(input: {
  readonly writer: CastCostume;
  readonly designed: CastCostume;
  readonly owner: string;
  readonly portrait?: FacialHair;
  readonly artDirector?: FacialHair;
  readonly keepWriter: boolean;
  readonly evidence?: string;
}): { kostum: CastCostume; notlar: string[] } {
  const k: Record<string, unknown> = { ...input.designed };
  const notlar: string[] = [];
  const colour = hairWord(input.designed.yuz?.kas_renk ?? input.designed.sac?.renk);
  const said = input.evidence ?? "";
  for (const [field, kind, name] of [["sakal", "beard", "sakal"], ["biyik", "moustache", "bıyık"]] as const) {
    const director = input.artDirector?.[kind];
    const want = director ?? input.portrait?.[kind];
    const from = director !== undefined ? "sanat yönetmeni portrede gördü" : "portre gösteriyor";
    const writer = input.writer[field];
    if (k[field]) continue;
    if (want === true) {
      const shape = kind === "beard" ? (/\b(short|trimmed|kısa|kisa)\b[^.;]*beard|beard[^.;]*\b(short|trimmed)\b/i.test(said) ? "short trimmed" : "full") : /\b(thin|pencil|ince)\b/i.test(said) ? "thin" : /\b(handlebar|curled|upturned|pala)\b/i.test(said) ? "handlebar" : "thick";
      k[field] = writer ?? `yeni:${input.owner}'s ${shape} ${colour} ${kind}`.slice(0, 85);
      notlar.push(`${name} eklendi (${from}; tasarım kartı ${name}sızdı): ${String(k[field])}`);
    } else if (writer && input.keepWriter) {
      if (want === false) notlar.push(`yazarın ${name} siparişi (${writer}) çıkarıldı: portrede ${name} yok`);
      else {
        k[field] = writer;
        notlar.push(`yazarın ${name} siparişi (${writer}) korundu: tasarım kartı kaldırmıştı, portre kanıtı yok`);
      }
    }
  }
  return { kostum: k as unknown as CastCostume, notlar };
}

function slug(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "kisi";
}

/** Finished likenesses, one file per person and period (outside git, next to the wardrobe). */
export function peopleDir(paths: V3Paths): string {
  return path.join(paths.workRoot, "_kutuphane", "kisiler");
}

/**
 * Versions of a person's likeness for a period, oldest first: `<kisi>--<donem>.json`, then `…--v2.json`, `…--v3.json`
 * (a redesign never overwrites the earlier one). A version may carry the side-by-side check in `<file>.kontrol.json`.
 */
export function personVersions(paths: V3Paths, wiki: string, donem: string): string[] {
  const base = path.join(peopleDir(paths), `${slug(wiki)}--${slug(donem)}`);
  const out: string[] = [];
  for (let v = 1; v < 100; v++) {
    const file = v === 1 ? `${base}.json` : `${base}--v${v}.json`;
    if (!existsSync(file)) break;
    out.push(file);
  }
  return out;
}

/** One kept design of a person for a period, with its side-by-side check (no score when it was never checked). */
export interface LikenessVersion {
  readonly file: string;
  readonly tarif: string;
  readonly benzerlik?: number;
  readonly farklar: readonly string[];
}

/** Every kept design of a person for a period with its check, oldest first. */
export async function likenessHistory(paths: V3Paths, wiki: string, donem: string): Promise<LikenessVersion[]> {
  const out: LikenessVersion[] = [];
  for (const file of personVersions(paths, wiki, donem)) {
    try {
      const stored = JSON.parse(await fs.readFile(file, "utf8")) as { tarif?: unknown };
      const check = await readCheck(file).catch(() => undefined);
      out.push({ file, tarif: typeof stored.tarif === "string" ? stored.tarif : "", ...(typeof check?.benzerlik === "number" ? { benzerlik: check.benzerlik } : {}), farklar: check?.farklar ?? [] });
    } catch {
      // An unreadable version is skipped; the others still count.
    }
  }
  return out;
}

/**
 * The design to reuse: the best-checked one (the newest of equal scores), else the newest. The newest alone was
 * reused until 3 Nov 2026, so a retouch that made a likeness worse became the person's look for the next episode.
 */
export function bestVersion(versions: readonly LikenessVersion[]): LikenessVersion | undefined {
  const checked = versions.filter((v) => v.benzerlik !== undefined);
  if (!checked.length) return versions.at(-1);
  return checked.reduce((best, v) => (v.benzerlik! >= best.benzerlik! ? v : best));
}

/**
 * Whether a kept design is reused only after another portrait search comes back empty: it was drawn from the
 * historian's note alone (no portrait, so never checked side by side). A search that failed once — Waterloo, 6 Nov
 * 2026: Napoleon's portraits refused by the face rule and lost to 429s — would otherwise fix a guessed look for good.
 */
export function portraitRetry(stored: { readonly portre?: unknown }, best: Pick<LikenessVersion, "benzerlik">): boolean {
  return !stored.portre && best.benzerlik === undefined;
}

/** Checked designs it takes before a likeness that stays under the bar counts as stuck. */
export const PLATEAU_DESIGNS = 3;

/**
 * Whether another redesign is futile: at least PLATEAU_DESIGNS checked designs, none at LIKENESS_OK, and the last two
 * no better than the best before them (Caesar in 75 BC, 2–3 Nov 2026: seven designs, all 6–7/10, the judge's notes
 * flipping from "hair fuller" to "hair too full"). A stuck person keeps the best design and opens no retouch round.
 */
export function likenessPlateau(versions: readonly LikenessVersion[]): boolean {
  const scores = versions.flatMap((v) => (v.benzerlik !== undefined ? [v.benzerlik] : []));
  if (scores.length < PLATEAU_DESIGNS || scores.some((s) => s >= LIKENESS_OK)) return false;
  return Math.max(...scores.slice(-2)) <= Math.max(...scores.slice(0, -2));
}

/** The earlier designs as the designer's memory: best first, with what the art director said of each. */
export function historyLines(versions: readonly LikenessVersion[], limit = 4): string[] {
  return versions
    .filter((v) => v.benzerlik !== undefined && v.tarif)
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v.benzerlik! - a.v.benzerlik! || b.i - a.i)
    .slice(0, limit)
    .map(({ v }) => `${v.benzerlik}/10: "${v.tarif}"${v.farklar.length ? ` — art director: ${v.farklar.join("; ")}` : ""}`);
}

function nextPersonFile(paths: V3Paths, wiki: string, donem: string): string {
  const n = personVersions(paths, wiki, donem).length + 1;
  const base = path.join(peopleDir(paths), `${slug(wiki)}--${slug(donem)}`);
  return n === 1 ? `${base}.json` : `${base}--v${n}.json`;
}

interface LikenessCheck {
  readonly benzerlik: number;
  readonly farklar: readonly string[];
}

async function readCheck(file: string): Promise<LikenessCheck | undefined> {
  const f = `${file}.kontrol.json`;
  return existsSync(f) ? (JSON.parse(await fs.readFile(f, "utf8")) as LikenessCheck) : undefined;
}

async function knownRefs(paths: V3Paths): Promise<Set<string>> {
  const known = new Set<string>();
  for (const p of await packCatalog(costumeRootsFor(paths))) for (const ids of Object.values(p.items)) for (const id of ids ?? []) known.add(`${p.pack}/${id}`);
  return known;
}

function withCostume(episode: Episode, castId: string, kostum: CastCostume): Episode {
  return { ...episode, oyuncu_kadrosu: episode.oyuncu_kadrosu.map((c) => (c.id === castId ? { ...c, kostum } : c)) };
}

/** Designs the likeness of every visible real person of the episode (before the wardrobe step draws the parts). */
export async function designLikenesses(episode: Episode, deps: LikenessDeps): Promise<LikenessOutcome> {
  const { paths, log } = deps;
  const records: LikenessRecord[] = [];
  const references = new Map<string, { ref?: PartReference; look?: V3Look; redraw?: boolean }>();
  const portraits = new Map<string, PortraitResult>();
  const known = await knownRefs(paths);
  let current = episode;
  for (const c of episode.oyuncu_kadrosu.filter((x) => x.gorunur && x.kostum && x.portre?.wiki)) {
    const wiki = c.portre!.wiki;
    const talk: DebateEntry[] = [];
    // A likeness finished for this person and period in an earlier episode: reused while all its parts still exist,
    // unless the retouch brain asked for a redesign or its side-by-side check fell short (then its differences are
    // the designer's instruction).
    const history = await likenessHistory(paths, wiki, episode.donem);
    const best = bestVersion(history);
    // A stuck likeness keeps its best design: one more redesign from the same notes only repeats the earlier tries.
    const stuck = likenessPlateau(history);
    const fixes = deps.redo?.get(c.id) ?? (!stuck && best?.benzerlik !== undefined && best.benzerlik < LIKENESS_OK ? best.farklar : undefined);
    const search = () => findPortrait({ cacheDir: deps.commonsCache, judge: deps.judge, person: { id: c.id, ad: c.ad, rol: c.rol, wiki }, donem: episode.donem, log, faces: faceMeasurer(deps.paths) }).catch(() => undefined);
    let found: PortraitResult | undefined;
    let searched = false;
    if (best && !fixes) {
      const stored = JSON.parse(await fs.readFile(best.file, "utf8")) as { kostum: CastCostume; tarif?: string; not?: PeriodNote; portre?: unknown };
      if (portraitRetry(stored, best)) {
        found = await search();
        searched = true;
        if (found) log(`  benzerlik: ${c.ad} — kütüphanedeki tasarım portresiz çizilmişti; portre bulundu, yeniden tasarlanıyor`);
      }
      const parts = PART_FIELDS.map((f) => (stored.kostum as unknown as Record<string, unknown>)[f]).filter((v): v is string => typeof v === "string");
      const resolvable = parts.every((ref) => known.has(ref.includes("/") ? ref : `${c.kostum_paketi}/${ref}`));
      // A kept design whose check said the portrait's beard or moustache is missing gets it here, free (a part family
      // draws it): a stuck likeness is not redesigned, so nothing else would add it.
      const storedPeriod = (stored.portre as { donemPuani?: unknown } | undefined)?.donemPuani;
      const hair = settleFacialHair({
        writer: c.kostum!,
        designed: withNoteUniform(withNoteCloak(stored.kostum, stored.not), stored.not),
        owner: partOwner(wiki),
        ...(typeof storedPeriod !== "number" || storedPeriod >= PORTRAIT_PERIOD_FIT ? { artDirector: facialHairFixes(best.farklar) } : {}),
        keepWriter: false,
        evidence: best.farklar.join(". "),
      });
      const next = withCostume(current, c.id, { ...hair.kostum, ...(c.kostum!.el_arka ? { el_arka: c.kostum!.el_arka } : {}) });
      if (!found && resolvable && validateEpisode(next).ok) {
        current = next;
        const look = hair.kostum.yuz ? toLook(hair.kostum.yuz) : undefined;
        for (const o of likenessOrders(hair.kostum)) if (!references.has(partKey(o)) && look) references.set(partKey(o), { look });
        for (const n of hair.notlar) log(`  benzerlik: ${c.ad} — ${n}`);
        records.push({ castId: c.id, kisi: wiki, donem: episode.donem, kaynak: "kutuphane", ...(stored.not ? { not: stored.not } : {}), ...(stored.tarif ? { tarif: stored.tarif } : {}), ...(stuck && best.benzerlik !== undefined ? { benzerlik: best.benzerlik, farklar: best.farklar } : {}), siparisler: [], sorunlar: [], ...(hair.notlar.length ? { duzeltmeler: hair.notlar } : {}) });
        if (stuck) {
          const tries = history.filter((v) => v.benzerlik !== undefined).length;
          log(`  benzerlik: ${c.ad} — ${tries} tasarım ${LIKENESS_OK}/10'a ulaşamadı; en iyisi (${best.benzerlik}/10) kullanılıyor, yeniden çizilmiyor`);
          deps.council?.find({ beyin: "kostum", onem: "uyari", baslik: "benzerlik tıkandı", ayrinti: `${c.ad} (${episode.donem}): ${tries} tasarım ${LIKENESS_OK}/10 altında kaldı; en iyisi ${best.benzerlik}/10 — "${best.tarif}"`, tur: "veri", yer: c.id });
        } else log(`  benzerlik: ${c.ad} — ${episode.donem} için kişi kütüphanesinde`);
        continue;
      }
    }
    const article = await fetchArticle(deps.wikiCache, wiki).catch(() => undefined);
    const sentences = article ? appearanceSentences(article.text) : [];
    talk.push({ rol: "Araştırmacı", metin: article ? `"${article.title}" makalesinde görünüş/giyim üzerine ${sentences.length} cümle` : `"${wiki}" makalesi okunamadı` });
    // What the costume brain learned about this person before (a wrong "clean-shaven" or age is not repeated).
    const personLessons = (await recall(paths.workRoot, "kostum", { konu: `${wiki} ${episode.donem} benzerlik`, tur: "ders", limit: 3 }).catch(() => [])).map((l) => l.metin);
    const noteOut = await deps.budget.generate("benzerlik-tarihci", deps.critic, periodNotePrompt(c, episode, wiki, sentences, personLessons), { maxTokens: 450 }).catch((e: Error) => (log(`  benzerlik: ${c.ad} tarihçi notu alınamadı (${e.message.slice(0, 100)})`), undefined));
    const note = noteOut ? readPeriodNote(noteOut.result.content) : undefined;
    talk.push({ rol: "Tarihçi", metin: note ? `${episode.donem}: ${note.yas !== undefined ? `${note.yas} yaşında; ` : ""}${note.gorunus} | giyim: ${note.giyim}${note.fark ? ` | portrelerden farkı: ${note.fark}` : ""}` : "not yazılamadı" });
    const portrait = found ?? (searched ? undefined : await search());
    if (portrait) portraits.set(c.id, portrait);
    talk.push({ rol: "Resim araştırmacısı", metin: portrait ? `portre: ${portrait.candidate.title.replace(/^File:/, "")} (kişi ${portrait.secim.puan}/10, dönem ${portrait.secim.donem ?? "?"}/10)` : "uygun portre yok; tarihçinin notundan çizilecek" });
    // The costume brain's memory: the owner's standing rules and lessons about this person or their dress.
    const lessons = (await recall(paths.workRoot, "kostum", { konu: `${wiki} ${c.rol} ${episode.donem} ${note?.giyim ?? ""}`, limit: 3 }).catch(() => [])).map((l) => l.metin);
    const sheetOut = await deps.budget
      .generate("benzerlik-tasarim", deps.designer, sheetPrompt(c, current, wiki, note, portrait?.candidate.title, fixes, lessons, historyLines(history)), { maxTokens: 900, ...(portrait ? { images: [portrait.preview.toString("base64")] } : {}) })
      .catch((e: Error) => (log(`  benzerlik: ${c.ad} kart yazılamadı (${e.message.slice(0, 100)})`), undefined));
    const sheet = sheetOut ? readJsonAnswer<Record<string, unknown>>(sheetOut.result.content) : undefined;
    if (!sheet) {
      records.push({ castId: c.id, kisi: wiki, donem: episode.donem, kaynak: "degismedi", ...(note ? { not: note } : {}), siparisler: [], sorunlar: ["benzerlik kartı okunamadı; senaryonun kostümü kaldı"] });
      deps.council?.find({ beyin: "kostum", onem: "uyari", baslik: "benzerlik kartı yazılamadı", ayrinti: `${c.ad}: senaryonun kostümü kullanıldı`, tur: "veri", yer: c.id });
      continue;
    }
    const sheetApplied = applySheet(c.kostum!, sheet);
    // The portrait's beard beats the note's "clean-shaven"; a portrait of another age (period score under the fit) is
    // not evidence of the face in this year (Holbein's bearded Henry for the young Henry of 1509).
    const fit = !portrait || portrait.secim.donem === undefined || portrait.secim.donem >= PORTRAIT_PERIOD_FIT;
    const hair = settleFacialHair({
      writer: c.kostum!,
      designed: withNoteUniform(withNoteCloak(sheetApplied.kostum, note), note),
      owner: partOwner(wiki),
      ...(portrait && fit ? { portrait: portraitFacialHair(sheet.portre_kil, portrait.secim.gosterilen) } : {}),
      ...(fixes && fit ? { artDirector: facialHairFixes(fixes) } : {}),
      keepWriter: true,
      evidence: [...(fixes ?? []), portrait?.secim.gosterilen ?? ""].join(". "),
    });
    const applied = { ...sheetApplied, kostum: hair.kostum };
    for (const n of hair.notlar) {
      log(`  benzerlik: ${c.ad} — ${n}`);
      talk.push({ rol: "Kostüm beyni", metin: n });
    }
    // Catalog refs the sheet named but the wardrobe lacks become orders, like the script normalizer does.
    const rec = applied.kostum as unknown as Record<string, unknown>;
    for (const f of SHEET_PARTS) {
      const v = rec[f];
      if (typeof v === "string" && !v.startsWith("yeni:") && !known.has(v.includes("/") ? v : `${c.kostum_paketi}/${v}`)) rec[f] = `yeni:${partOwner(wiki)}'s ${partWords(v, wiki)}`.slice(0, 85);
    }
    const next = withCostume(current, c.id, applied.kostum);
    const check = validateEpisode(next);
    if (!check.ok) {
      const why = check.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join("; ");
      records.push({ castId: c.id, kisi: wiki, donem: episode.donem, kaynak: "degismedi", ...(note ? { not: note } : {}), siparisler: [], sorunlar: [...applied.sorunlar, `kart bölümü bozuyordu (${why}); senaryonun kostümü kaldı`] });
      continue;
    }
    current = next;
    const orders = likenessOrders(applied.kostum);
    const look = applied.kostum.yuz ? toLook(applied.kostum.yuz) : undefined;
    const gorunus = applied.kostum.sakal || applied.kostum.biyik ? withoutShavenClaims(note?.gorunus ?? "") : (note?.gorunus ?? "");
    for (const o of orders) {
      // The portrait is the reference for what is on the person (head, hair, beard, chest); a held object is looked
      // up among real museum pieces by the wardrobe as usual.
      const ref: PartReference | undefined =
        portrait && o.slot !== "hand"
          ? { title: portrait.candidate.title, url: portrait.candidate.descriptionUrl, credit: portrait.candidate.credit, description: `${wiki} as in this portrait, drawn as they looked in ${episode.donem}. ${gorunus} ${note?.giyim ?? ""}`.replace(/\s+/g, " ").trim().slice(0, 400), imageB64: portrait.preview.toString("base64") }
          : undefined;
      references.set(partKey(o), { ...(ref ? { ref } : {}), ...(look ? { look } : {}), ...(fixes ? { redraw: true } : {}) });
    }
    talk.push({ rol: "Tasarımcı", metin: `${applied.tarif || "kart yazıldı"}${orders.length ? ` | gardıroptan: ${orders.map((o) => o.tarif).join("; ")}` : ""}` });
    records.push({
      castId: c.id,
      kisi: wiki,
      donem: episode.donem,
      kaynak: "tasarim",
      ...(note ? { not: note } : {}),
      ...(portrait ? { portre: { baslik: portrait.candidate.title, url: portrait.candidate.descriptionUrl, puan: portrait.secim.puan, ...(portrait.secim.donem !== undefined ? { donemPuani: portrait.secim.donem } : {}) } } : {}),
      tarif: applied.tarif,
      siparisler: orders.map((o) => o.tarif),
      sorunlar: applied.sorunlar,
      ...(hair.notlar.length ? { duzeltmeler: hair.notlar } : {}),
    });
    log(`  benzerlik: ${c.ad} — ${applied.tarif || "kart yazıldı"}${orders.length ? ` (${orders.length} parça sipariş)` : ""}`);
    deps.council?.debate("kostum", `benzerlik: ${c.ad} (${episode.donem})`, talk);
  }
  return { episode: current, records, references, portraits };
}

/**
 * The part slots a person is recognised by. When one of them failed, the likeness is incomplete and is not kept, so the
 * next episode designs it again (Blücher without his moustache, Waterloo, 6 Nov 2026). A failed medal, sash or sword
 * was only left off the costume and the face is whole. That same day Blücher's 7/10 face was thrown away because his
 * medals failed, and his next episode would have started from nothing.
 */
export const IDENTITY_SLOTS: ReadonlySet<PartSlot> = new Set<PartSlot>(["beard", "mustache", "hair", "head"]);

/**
 * After the wardrobe made the parts: likenesses whose identity parts (IDENTITY_SLOTS) all came out are kept in the
 * people library (append-only: an existing file is never overwritten), so the next episode with this person in this
 * period reuses them.
 */
export async function keepLikenesses(paths: V3Paths, episode: Episode, records: readonly LikenessRecord[], parts: readonly PartRecord[]): Promise<Map<string, string>> {
  const kept = new Map<string, string>();
  await fs.mkdir(peopleDir(paths), { recursive: true });
  for (const r of records.filter((x) => x.kaynak === "tasarim")) {
    if (parts.some((p) => p.kaynak === "basarisiz" && IDENTITY_SLOTS.has(p.slot) && r.siparisler.includes(p.tarif))) continue;
    const c = episode.oyuncu_kadrosu.find((x) => x.id === r.castId);
    const file = nextPersonFile(paths, r.kisi, r.donem);
    if (!c?.kostum || existsSync(file)) continue;
    // The second hand's object belongs to the scene, not to the person.
    const kostum: Record<string, unknown> = { ...c.kostum };
    delete kostum.el_arka;
    await fs.writeFile(file, `${JSON.stringify({ kisi: r.kisi, donem: r.donem, kostum, tarif: r.tarif, not: r.not, portre: r.portre, olusturuldu: new Date().toISOString() }, null, 2)}\n`);
    kept.set(r.castId, file);
  }
  return kept;
}

/**
 * The art director's last look: each drawn person next to their portrait, scored for how recognisable the cartoon
 * is. Low scores go to AYAS as a finding; nothing is redrawn here.
 */
export async function checkLikenesses(input: {
  readonly paths: V3Paths;
  readonly episode: Episode;
  readonly outcome: LikenessOutcome;
  readonly budget: V3Budget;
  readonly designer: V3ModelChoice;
  readonly workDir: string;
  readonly council?: CouncilLog;
  readonly log: (s: string) => void;
  /** People library files written this run (keepLikenesses): each gets its check next to it. */
  readonly kept?: ReadonlyMap<string, string>;
  /** No retouch round is left: a likeness still under the bar is reported as missing, not as a warning. */
  readonly lastRound?: boolean;
}): Promise<LikenessRecord[]> {
  const { paths, outcome, log } = input;
  const ids = outcome.records.filter((r) => r.kaynak === "tasarim" && outcome.portraits.has(r.castId)).map((r) => r.castId);
  if (!ids.length) return outcome.records;
  const members = toRenderCast(input.episode.oyuncu_kadrosu.filter((c) => ids.includes(c.id)), "kukla");
  const accessories = await loadAccessories(costumeRootsFor(paths), members);
  const crops = await puppetStills(paths, members.map((member) => ({ member, gesture: "konus", crop: "figure" })), accessories, input.workDir);
  const out = [...outcome.records];
  for (const [i, member] of members.entries()) {
    const r = out.findIndex((x) => x.castId === member.id);
    const portrait = outcome.portraits.get(member.id)!;
    const left = path.join(input.workDir, `portre-${member.id}.jpg`);
    const pair = path.join(input.workDir, `benzerlik-${member.id}.jpg`);
    await fs.writeFile(left, portrait.preview);
    await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", left, "-i", crops[i]!, "-filter_complex", "[0]scale=-2:640[a];[1]scale=-2:640[b];[a][b]hstack=inputs=2", "-q:v", "3", pair]);
    const note = outcome.records[r]!.not;
    const worn = input.episode.oyuncu_kadrosu.find((c) => c.id === member.id)?.kostum;
    const looks = note ? (worn?.sakal || worn?.biyik ? withoutShavenClaims(note.gorunus) : note.gorunus) : "";
    const prompt = `LEFT: a portrait of ${outcome.records[r]!.kisi}. RIGHT: our flat cartoon of them as they looked in ${input.episode.donem}, in the style of OverSimplified (simple puppet body, flat colours, bold outlines; a different age than the portrait may be intended).
${note ? `HISTORIAN'S NOTE for ${input.episode.donem}: ${looks} Dress: ${note.giyim}\n` : ""}Would a viewer who knows this person's portraits recognise the cartoon (headwear, hair, beard, face shape, clothes, colours)? "benzerlik" 0–10.
Judge only what a caricature should carry. Never count against it: the flat cartoon style itself (simple shapes, flat colours, no wrinkles, texture or realistic shading), the puppet body, headwear and clothes the person wore in ${input.episode.donem} (see the note) that a bust or a head-only portrait cannot show, or a light skin where the portrait's old varnish or paint looks brown or yellow (${OLD_COMPLEXION}). ${PORTRAIT_OVER_NOTE} Name only what you see in the cartoon on the right.
List at most 3 concrete, fixable differences that matter most (e.g. "hair too dark", "the face should be longer", "no beard in the portrait").
Return ONLY JSON: {"benzerlik": <0-10>, "farklar": ["…"]}`;
    const res = await input.budget.generate("benzerlik-kontrol", input.designer, prompt, { maxTokens: 250, images: [(await fs.readFile(pair)).toString("base64")] }).catch(() => undefined);
    const v = res ? readJsonAnswer<{ benzerlik?: unknown; farklar?: unknown }>(res.result.content) : undefined;
    const score = typeof v?.benzerlik === "number" ? Math.max(0, Math.min(10, Math.round(v.benzerlik))) : undefined;
    const farklar = Array.isArray(v?.farklar) ? v!.farklar.map(String).slice(0, 3) : [];
    if (score === undefined) continue;
    out[r] = { ...out[r]!, benzerlik: score, farklar };
    log(`  benzerlik: ${member.name} portreyle yan yana ${score}/10${farklar.length ? ` — ${farklar.join("; ")}` : ""}`);
    const keptFile = input.kept?.get(member.id);
    if (keptFile && !existsSync(`${keptFile}.kontrol.json`)) await fs.writeFile(`${keptFile}.kontrol.json`, `${JSON.stringify({ benzerlik: score, farklar, tarih: new Date().toISOString() }, null, 2)}
`);
    if (score < LIKENESS_OK) input.council?.find({ beyin: "kostum", onem: input.lastRound ? "eksik" : "uyari", baslik: `benzerlik ${LIKENESS_OK}/10 altında`, ayrinti: `${member.name}: ${score}/10 — ${farklar.join("; ")}`, oneri: input.lastRound ? "rötuş turları bitti; portreyi ya da kişinin makale adını kontrol et" : "rötuş beyni bu farklarla yeniden tasarlatır; kişi kütüphanesi bu sürümü yeniden kullanmaz", tur: "veri", yer: member.id });
  }
  return out;
}
