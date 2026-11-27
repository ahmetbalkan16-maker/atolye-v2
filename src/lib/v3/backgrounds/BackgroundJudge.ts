import type { AIProvider } from "../../ai/providers/AIProvider";
import { MODERN_SHIPS_FROM } from "../episode/Period";
import { periodEndYear } from "./HistorySources";

/**
 * Picks a scene's image by looking at it: a local vision model (gemma4 through Ollama) scores each candidate's
 * preview twice — does it show the scene's subject, and does it show it as it was in the episode's period.
 * Owner rule (20 Oct 2026): the background must belong to the period; an unrelated image is never used, and a
 * photo of the place as it stands today (cars, modern houses, ferries) is not a period image. Two modes:
 * - `arsiv`: a real image found online (artwork, engraving, map, period photo) for the narrator's cutaway;
 * - `set`: a drawn background (designed or from the library) the characters act in front of.
 * No judge, no answer or nothing passing → nothing is picked; the caller says so and designs the set.
 */
export const MIN_FIT_SCORE = 7;
/** Candidates judged per scene, in search order (each costs one local vision call). */
export const MAX_JUDGED = 8;

export type JudgeMode = "arsiv" | "konu" | "set" | "portre" | "parca" | "referans" | "kapak" | "an";

export interface SceneForJudge {
  readonly konu: string;
  readonly donem: string;
  readonly mekan: string;
  readonly tr: string;
  readonly en: string;
  /** What is said while the image is on screen (the narrator's lines for a cutaway), so the judge knows what it must show. */
  readonly anlatim: string;
  /** The drawn set as described by the script (set mode). */
  readonly tasarim?: string;
  /** The episode's cast names, so a picture of a person the episode tells about is not refused (namedSubjectCheck). */
  readonly kisiler?: string;
}

/** What the judge needs to know about a candidate besides its pixels. */
export interface JudgeCandidate {
  readonly title: string;
  readonly description?: string;
  readonly source?: string;
  readonly year?: number;
  /** The artist, so a name in the title that is only the artist's is not taken for the picture's subject. */
  readonly credit?: { readonly author?: string };
}

export interface CandidateVerdict {
  readonly title: string;
  /** Subject: shows the scene's place, person, object or event (0–10). */
  readonly puan: number;
  /** Period: shows it as it was in the episode's period (0–10). Missing in verdicts from before the rule. */
  readonly donem?: number;
  /** Anything modern is visible. */
  readonly modern?: boolean;
  /** eser (artwork), harita, fotograf, cizim, diger. */
  readonly tur?: string;
  readonly gosterilen: string;
  readonly sorun: string;
  /** Set mode: what to avoid when a set like this is drawn again (English, for the image model; the setting brain's lesson). */
  readonly kacin?: string;
  /** The judge gave no readable answer even after a second try: scored 0, but a fault of the judge, not of the image. */
  readonly okunamadi?: boolean;
  /** A building or symbol of a later era was found (the plain question or the judge's own words): never a fallback set. */
  readonly sonrakiCag?: string;
}

export interface BackgroundPick<T> {
  readonly chosen?: T;
  readonly verdict?: CandidateVerdict;
  readonly verdicts: readonly CandidateVerdict[];
}

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    puan: { type: "integer", minimum: 0, maximum: 10 },
    donem: { type: "integer", minimum: 0, maximum: 10 },
    modern: { type: "boolean" },
    tur: { type: "string", enum: ["eser", "harita", "fotograf", "cizim", "diger"] },
    gosterilen: { type: "string" },
    sorun: { type: "string" },
    kacin: { type: "string" },
  },
  required: ["puan", "donem", "modern", "tur", "gosterilen", "sorun"],
};

const SOURCE_NAME: Readonly<Record<string, string>> = { wikipedia: "the Wikipedia article about the subject", met: "The Metropolitan Museum of Art", commons: "Wikimedia Commons", openverse: "Openverse (openly licensed collections)", aic: "the Art Institute of Chicago", cleveland: "the Cleveland Museum of Art" };

/**
 * A story of our own times (owner's 2026 Iran war Short, 27 Nov 2026): the period IS the modern world, so an archive
 * judge that scores "modern elements" 0–3 threw out the US military's own Operation Epic Fury photo (period 0/10) and a
 * Khamenei photo (subject 9, period 3) — every real picture was lost. From this year on, a photo taken in the period is a
 * period picture, its equipment and clothes are not "modern", and the modern flag alone fails nothing.
 */
export const PRESENT_DAY_FROM = 1990;

export function presentDay(donem: string): boolean {
  const year = periodEndYear(donem);
  return year !== undefined && year >= PRESENT_DAY_FROM;
}

const PRESENT_DAY_NOTE = (donem: string) => `THIS STORY HAPPENS IN OUR OWN TIMES (${donem}): a photograph taken in ${donem} of the person, place or event named IS a period picture and scores 9–10 on "donem"; the aircraft, ships, weapons, cars, buildings and clothes of ${donem} are NOT modern elements here. Score "donem" low only for an image clearly from a different time (an old archive photo from decades earlier, a historical painting) and set "modern" true only for things newer than ${donem}.`;

/** The "modern" rule of a drawn moment, set or thumbnail; in our own times the period note follows it. */
const modernRule = (donem: string) => `- "modern": true if anything modern is visible.${presentDay(donem) ? `
${PRESENT_DAY_NOTE(donem)}` : ""}`;

/** Both scores at or above the bar and nothing modern in the picture. */
/**
 * Both scores at the bar and nothing modern. `allowModern`: a subject photo of today (ruins, a site) always shows a
 * little of today — a fence, a house far off, a plaque — and its period score already weighs that (Corfinium's Roman
 * ruins scored 10/9 but "modern"), so the flag alone does not fail it.
 */
export function passes(v: CandidateVerdict, allowModern = false): boolean {
  return v.puan >= MIN_FIT_SCORE && (v.donem ?? v.puan) >= MIN_FIT_SCORE && (allowModern || v.modern !== true);
}

/** The lowest subject score of a drawn set that may stand in when none passes: still the kind of place. */
export const MIN_FALLBACK_SUBJECT = 4;

/**
 * A drawn set that missed only the subject bar and may stand in for the scene: of the episode's period, nothing modern,
 * no building of a later era, and still the kind of place (the Rubicon's Senate got "a tall marble hall with columns",
 * subject 4, period 10). Owner, 22 Oct 2026: such a drawing, never a photo or a painting, is the set behind the puppets.
 */
export function periodFallback(v: CandidateVerdict | undefined): v is CandidateVerdict {
  return !!v && !v.okunamadi && !v.sonrakiCag && v.modern !== true && (v.donem ?? 0) >= MIN_FIT_SCORE && v.puan >= MIN_FALLBACK_SUBJECT;
}

/** Ranking score: the weaker of the two scores. */
export function fitScore(v: CandidateVerdict): number {
  return Math.min(v.puan, v.donem ?? v.puan);
}

export function judgePrompt(scene: SceneForJudge, c: JudgeCandidate, mode: JudgeMode = "arsiv"): string {
  const answer = `Answer only JSON: {"puan": <0-10>, "donem": <0-10>, "modern": <true|false>, "tur": "eser|harita|fotograf|cizim|diger", "gosterilen": "<what the image shows, Turkish, at most 12 words>", "sorun": "<why it fits or not, Turkish, at most 15 words>"${mode === "set" ? `, "kacin": "<if a score is under 7: what to avoid when this set is drawn again, English, at most 10 words; else empty>"` : ""}}`;
  if (mode === "konu") {
    // Owner (21 Oct 2026): when no good set can be drawn, a real photo of the period or the subject — never an unrelated one.
    return `You are the picture researcher of a history documentary for an American YouTube channel. No picture made in ${scene.donem} exists for this scene and the drawn set failed, so a real photo of the place or the subject is shown instead: its ruins or site as they stand today, or an object of the period in a museum.

EPISODE: ${scene.konu}
PERIOD: ${scene.donem}
SCENE PLACE: ${scene.mekan}
WANTED: ${scene.tr} / ${scene.en}
SAID IN THE SCENE: "${scene.anlatim.slice(0, 300)}"
FILE (from ${SOURCE_NAME[c.source ?? "commons"] ?? "Wikimedia Commons"}, may be wrong): ${c.title.replace(/^File:/, "")}${c.description ? ` — ${c.description.slice(0, 300)}` : ""}

Look at the image and score 0–10:
- "puan" (subject): does it show exactly this place, its ruins or site, or an object of this story — the one named? 9–10 exactly it; 7–8 clearly it in a minor view; 0–3 another place or another town's ruins, a generic landscape, or anything unrelated (an unrelated photo is never shown).
- "donem" (remains of the period): are remains or objects of ${scene.donem} what the photo shows? 9–10 ancient remains or a period object fill the picture; 7–8 remains with a little of today's surroundings; 0–3 mostly modern buildings, streets, cars or people, or nothing of the period at all.
- "modern": true if modern things (cars, signs, modern buildings, people in modern clothes) take a notable part of the picture.
- "tur": fotograf, eser, harita, diger.
Judge the image, not the file name.
${answer}`;
  }
  if (mode === "referans") {
    return `You are the costume researcher of an animated history show. Before a costume part is drawn, a real historical example is looked up.

PART: ${scene.konu}
PERIOD: ${scene.donem}
FILE (from ${SOURCE_NAME[c.source ?? "commons"] ?? "Wikimedia Commons"}, may be wrong): ${c.title.replace(/^File:/, "")}${c.description ? ` — ${c.description.slice(0, 300)}` : ""}
MADE IN (metadata, may be missing or wrong): ${c.year ?? "unknown"}

Score 0–10:
- "puan": does the image clearly show this kind of object (a surviving artefact, a museum piece, a period artwork or a faithful reconstruction drawing), large enough to see its shape and decoration?
- "donem": is it the form used in ${scene.donem} (not a much earlier or later type)?
- "modern": true for a modern replica in a shop, a costume, a toy or a film prop.
- "tur": "eser" for an artefact or artwork, "fotograf" for a photo of one, "cizim" for a drawing.
${answer}`;
  }
  if (mode === "kapak") {
    return `You judge YouTube thumbnails for an animated history channel in the style of OverSimplified. The picture is shown SMALL, the way it appears in a feed.

VIDEO: ${scene.konu}
PERIOD: ${scene.donem}
HEADLINE ON IT: ${scene.tr}

Score 0–10:
- "puan": would a viewer scrolling past click? One clear focal character, large; a readable headline at this small size; an emotion on the face; curiosity (the picture raises a question the video answers); no clutter. 0–3 if the headline cannot be read, nothing stands out, or it is a mess.
- "donem": does it honestly show this video (its period and people)? 0–3 if it promises something the video is not.
${modernRule(scene.donem)}
- "tur": "cizim".
${answer}`;
  }
  if (mode === "parca") {
    return `You are the art director of an animated history show. This picture shows a cartoon puppet (white round head, simple body) wearing or holding a costume part drawn for it.

PART: ${scene.konu} (${scene.mekan})
PERIOD: ${scene.donem}

Look at the puppet's ${scene.mekan === "held object" ? "hand" : scene.mekan === "worn on the back" ? "back" : scene.mekan === "worn on the chest" ? "chest" : "head and face"} and score 0–10:
- "puan": at first glance, is what it wears or holds clearly this part, sitting where it belongs (headwear on the head, hair on the skull around the face, a beard on the chin, a held object in the hand, a cape or shield on the back, a chain or sash on the chest) at a sensible size, in the same clean flat style with dark outlines as the puppet? 0–3 if it is unrecognisable, floating off the body, covering the eyes, far too big or too small, or made of broken, stray or messy shapes.${scene.mekan === "beard" || /beard/i.test(scene.konu) ? " A beard grows ON the face: it covers the jaw and chin from the cheeks down and the face reads bearded at a glance; at most 3 if it hangs below the chin like a bib, a scarf or a collar while the jaw stays bare." : ""}
- "donem": does its shape fit ${scene.donem}?
- "modern": true if it looks like a modern object when it should not.
- "tur": "cizim".
${answer}`;
  }
  if (mode === "portre") {
    return `You are the picture researcher of a history documentary for an American YouTube channel. The cartoon of a real historical person will be drawn after this portrait: their face shape, hair, beard, headwear and clothes.

PERSON: ${scene.konu} — ${scene.mekan}
WIKIPEDIA ARTICLE: ${scene.en}
THE EPISODE IS SET IN: ${scene.donem} (draw them as they looked then)
FILE (from ${SOURCE_NAME[c.source ?? "commons"] ?? "Wikimedia Commons"}, may be wrong): ${c.title.replace(/^File:/, "")}${c.description ? ` — ${c.description.slice(0, 300)}` : ""}
MADE IN (metadata, may be missing or wrong): ${c.year ?? "unknown"}

Score 0–10:
- "puan": is this a portrait of this very person with ONE face clearly visible, large and uncovered (frontal, three-quarter or profile), and enough of the head and clothes to draw from? 0–3 for another person, a group where the face is tiny, a coin or seal too small to read, a signature, a building, a map.
- "donem": is it a historical likeness — painted, drawn, sculpted or photographed in or near their lifetime, or a well-known later portrait of them — showing them at about the age they had in ${scene.donem}? Score lower when it shows them much younger or older than then. For someone who lived before about 1500 no likeness from their lifetime usually exists: then a well-known traditional portrait made later (a 16th-century Ottoman sultans' miniature series, a Renaissance or 19th-century portrait series, an icon or fresco) is THE likeness people know and scores 7–8. 0–3 for a modern illustration, a film still, an actor or a reenactor.
- "modern": true for a modern actor, reenactor, wax figure or a recent reconstruction.
- "tur": "eser" for a painting, miniature, engraving or drawing; "fotograf" for a photograph; else "diger".
${answer}`;
  }
  if (mode === "an") {
    // A designed painting of the moment (owner, 23 Oct 2026): shown only when no period image exists, labelled as designed.
    return `You are the picture editor of a history documentary for an American YouTube channel. No real image of this moment exists, so a painting of it was made; it is shown full screen while the narrator speaks, labelled as a designed picture.

EPISODE: ${scene.konu}
PERIOD: ${scene.donem}
SCENE PLACE: ${scene.mekan}
MOMENT TO SHOW: ${scene.tasarim ?? scene.en}
SAID WHILE IT IS ON SCREEN: "${scene.anlatim.slice(0, 400)}"

Look at the painting and score 0–10:
- "puan" (moment): does it show this moment — the place, the people and what they are doing? 9–10 clearly this moment; 7–8 the right scene in a general view; 4–6 the right era but not this moment; 0–3 something else, or unusable: text or letters, a watermark, a frame, garbled or melted faces and hands, a mess of shapes.
- "donem" (period): would every visible thing pass for ${scene.donem}? clothes, armour, weapons, flags, buildings, ships. 0–3 if anything belongs to another era or region (modern things, later uniforms or guns, the wrong architecture).
${modernRule(scene.donem)}
- "tur": "eser" for a painting.
${answer}`;
  }
  if (mode === "set") {
    return `You are the art director of an animated history documentary for an American YouTube channel. This is a candidate drawn background (a set); cartoon characters will be drawn standing in front of it.

EPISODE: ${scene.konu}
PERIOD: ${scene.donem}
SCENE PLACE: ${scene.mekan}
SET WANTED: ${scene.tasarim ?? `${scene.tr} / ${scene.en}`}
SAID IN THE SCENE: "${scene.anlatim.slice(0, 300)}"

Score 0–10:
- "puan" (place and style): does it show this place as wanted (landscape, buildings, what the scene needs), drawn in the show's style — a flat cartoon with clean dark outlines, flat bright colours and simple shapes? 0–3 if it shows a different kind of place, if people, faces, characters, text, letters or a watermark are visible, or the foreground is cluttered (the characters need open ground). At most 5 if it looks like a painting, a photo or a textured, soft-focused illustration instead of a flat cartoon, or if the sky is a sunset, dusk or night sky although the set wanted is not set at evening or night.
- "donem" (period): would every visible thing pass for ${scene.donem}? 0–3 if anything belongs to another era or region (modern buildings, cars, asphalt, power lines, modern ships, a European town for an Ottoman scene, wrong architecture, religious buildings of a later era: church towers, steeples or crosses in antiquity before the 4th century AD, minarets before Islam).
${modernRule(scene.donem)}
- "tur": "cizim" for a drawn image.
${answer}`;
  }
  return `You are the picture researcher of a history documentary for an American YouTube channel. While the narrator speaks, a real image from or of the period is shown full screen.

EPISODE: ${scene.konu}
PERIOD: ${scene.donem}
SCENE PLACE: ${scene.mekan}
IMAGE WANTED: ${scene.tr} / ${scene.en}
SAID WHILE THE IMAGE IS ON SCREEN: "${scene.anlatim.slice(0, 400)}"
FILE (from ${SOURCE_NAME[c.source ?? "commons"] ?? "Wikimedia Commons"}, may be wrong): ${c.title.replace(/^File:/, "")}${c.description ? ` — ${c.description.slice(0, 300)}` : ""}
MADE IN (metadata, may be missing or wrong): ${c.year ?? "unknown"}

Look at the image and score 0–10:
- "puan" (subject): does it show what is being said at that moment — the person, place, object or event named? A portrait
  of a different person than the one named, or another place, scores 0–3 even if it belongs to the same story. 9–10 exactly this; 7–8 clearly right but generic; 4–6 loosely related (same region or era, wrong subject); 0–3 unrelated, or unusable full screen (a close-up of text, a plain diagram, mostly empty).
- "donem" (period): does it show the subject as it was in ${scene.donem}? 9–10 an artwork, manuscript, map, engraving or photograph made in that period; 7–8 a later painting or engraving of that period with nothing modern in it; 4–6 a later depiction that mixes in later things; 0–3 a photo taken long after the period (the place as it stands today), or anything with modern elements (cars, asphalt, power lines, modern buildings, ferries or boats with engines, people in modern clothes, signs, logos), a reconstruction for tourists, a watermark.
- "modern": true if anything modern is visible at all.
- "tur": eser (painting, miniature, engraving, mosaic, manuscript), harita, fotograf, cizim (plan, diagram), diger.
${presentDay(scene.donem) ? `${PRESENT_DAY_NOTE(scene.donem)}\n` : ""}Judge the image, not the file name.
${answer}`;
}

/** A verdict from a model answer, or undefined when it is not a readable score. */
export function parseVerdict(content: string): Omit<CandidateVerdict, "title"> | undefined {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const v = JSON.parse(content.slice(start, end + 1)) as { puan?: unknown; donem?: unknown; modern?: unknown; tur?: unknown; gosterilen?: unknown; sorun?: unknown; kacin?: unknown };
    const score = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" && x.trim() ? Number(x) : NaN);
    const puan = score(v.puan);
    if (!Number.isFinite(puan) || puan < 0 || puan > 10) return undefined;
    const donem = score(v.donem);
    return {
      puan: Math.round(puan),
      ...(Number.isFinite(donem) && donem >= 0 && donem <= 10 ? { donem: Math.round(donem) } : {}),
      ...(typeof v.modern === "boolean" ? { modern: v.modern } : v.modern === "true" ? { modern: true } : {}),
      ...(typeof v.tur === "string" && v.tur ? { tur: v.tur.slice(0, 20) } : {}),
      gosterilen: String(v.gosterilen ?? "").slice(0, 120),
      sorun: String(v.sorun ?? "").slice(0, 160),
      ...(typeof v.kacin === "string" && v.kacin.trim() ? { kacin: v.kacin.trim().slice(0, 120) } : {}),
    };
  } catch {
    return undefined;
  }
}

/** Words for buildings and symbols of a later era: before 400 AD (churches, crosses, the Middle Ages) and before Islam. */
const LATER_THAN_ANTIQUITY = /orta\s*ça[gğ]|medieval|(?<!\p{L})kilise|church|(?<!\p{L})haç|\bcross(es)?\b|çan kulesi|bell[- ]?tower|steeple|katedral|cathedral|gotik|gothic/iu;
const LATER_THAN_ISLAM = /minare|minaret|(?<!\p{L})cami(?!\p{L})|mosque/iu;
const NEGATED_AFTER = /^.{0,24}?(yok|bulunmu|görünmü|içermi|none|absent)/iu;
const NEGATED_BEFORE = /(\bno|\bwithout|\bnot)\s+(any\s+)?$/iu;

/**
 * The judge's own description against its period score. On 21 Oct 2026 it described the Rubicon's Corfinium set (49 BC)
 * as "a Medieval/Antique settlement" — a cross on a bell tower — and still scored the period 10/10; a verdict whose
 * words name a later era for the episode's period gets the period score 3. Drawn sets only: an archival picture may
 * rightly be a later artwork (a medieval miniature of Caesar), which the quality brain watches in the video.
 */
export function periodWordsCheck(v: CandidateVerdict, donem: string): CandidateVerdict {
  const year = periodEndYear(donem);
  if (year === undefined || v.okunamadi || (v.donem ?? 10) <= 3) return v;
  const text = `${v.gosterilen} ${v.sorun}`;
  for (const rule of [year < 400 ? LATER_THAN_ANTIQUITY : undefined, year < 650 ? LATER_THAN_ISLAM : undefined]) {
    if (!rule) continue;
    const m = rule.exec(text);
    if (!m || NEGATED_AFTER.test(text.slice(m.index + m[0].length)) || NEGATED_BEFORE.test(text.slice(0, m.index))) continue;
    return { ...v, donem: 3, sonrakiCag: m[0], sorun: `${v.sorun ? `${v.sorun}; ` : ""}hakemin kendi tarifi ${donem} için sonraki bir çağ: "${m[0]}"`.slice(0, 220) };
  }
  return v;
}

/** A commissioned ship named in a file title by its navy's prefix: "USS Washington (BB-56) firing during …" → Washington. */
const NAMED_SHIP = /\b(?:USS|USNS|HMS|HMAS|HMCS|HMNZS|IJN|SMS|KMS|RMS|SS)\s+([A-Z][A-Za-z'’-]+)/g;

/** The ships a file title names (their first name word), e.g. ["Washington"]. */
export function namedShips(title: string): string[] {
  return [...new Set([...title.replace(/^File:/, "").replace(/_/g, " ").matchAll(NAMED_SHIP)].map((m) => m[1]!))];
}

/**
 * A period photo of a named ship that the scene never names is another ship's picture (Guadalcanal, 12 Nov 2026: "USS
 * Washington (BB-56) firing during the Second Naval Battle" stood over the first night's melee, where Washington never
 * was — the judge gave it the subject score of a battleship at night). Subject score 2; a ship the scene names passes.
 */
export function namedShipCheck(v: CandidateVerdict, scene: Pick<SceneForJudge, "anlatim" | "tr" | "en" | "mekan">): CandidateVerdict {
  if (v.okunamadi || v.puan <= 3) return v;
  const said = `${scene.anlatim} ${scene.tr} ${scene.en} ${scene.mekan}`.toLocaleLowerCase("en-US");
  const missing = namedShips(v.title).filter((s) => !new RegExp(`\\b${s.toLocaleLowerCase("en-US").replace(/[’'-]/g, ".")}\\b`, "u").test(said));
  if (!missing.length) return v;
  return { ...v, puan: 2, sorun: `${v.sorun ? `${v.sorun}; ` : ""}dosyadaki gemi sahnede yok: ${missing.join(", ")}`.slice(0, 220) };
}

/** Function and battle words of the languages the wide search reads (Italian, French, German, Spanish, Dutch, Portuguese). */
const NOT_ENGLISH = /\b(der|die|das|und|schlacht|see|von|zum|zur|le|la|les|des|du|et|au|aux|bataille|il|lo|gli|di|del|della|dei|degli|battaglia|lago|el|los|las|y|batalla|do|da|dos|het|een|van)\b/i;

/** Whether a file or work title already reads as English (no foreign function word, no accented letter). */
export function looksEnglish(title: string): boolean {
  return !NOT_ENGLISH.test(title) && !/[àâäçéèêëîïôöùûüñßøåæœ]/i.test(title);
}

/**
 * A chosen picture's title in English for its on-screen credit, from the local model (no paid call), or undefined when it
 * already reads as English or the model gives nothing usable. The wide search (owner, 21 Nov 2026: "ingilizce dışında bile
 * varsa çeviri yapsın İngilizceye") brings French, Italian and German titles ("Sylvestre Ducar decapite Flaminius").
 */
export async function englishTitle(model: Pick<AIProvider, "generate">, title: string, description = ""): Promise<string | undefined> {
  const clean = title.replace(/^(File|Europeana):\s*/, "").replace(/\.(jpe?g|png|tiff?)$/i, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  // Only a title that reads as English and has an English function word is left alone: a German compound ("Alfred
  // Rethel Hannibalszug 6", Lake Trasimene Short 21 Nov 2026) has no foreign function word and no accent either.
  if (!clean || (looksEnglish(clean) && ENGLISH_WORD.test(clean))) return undefined;
  const prompt = `Translate this artwork or picture-file title into short, natural English for an on-screen picture credit in a history video. Keep the names of people, places and buildings, in the form English readers know (Trasimeno or Trasimène → Trasimene). Drop file numbers and archive codes. Answer only JSON: {"en": "..."}.
TITLE: ${clean}${description ? `\nDESCRIPTION: ${description.slice(0, 300)}` : ""}`;
  const out = await model.generate(prompt, { jsonSchema: TITLE_SCHEMA, maxTokens: 80 }).catch(() => undefined);
  const text = out === undefined ? "" : typeof out === "string" ? out : out.content;
  try {
    const en = (JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? "{}") as { en?: unknown }).en;
    // The same words back mean it already was English (or the model could not do better).
    return typeof en === "string" && en.trim() && en.trim().length <= 90 && en.trim().toLowerCase() !== clean.toLowerCase() ? en.trim() : undefined;
  } catch {
    return undefined;
  }
}
const TITLE_SCHEMA = { type: "object", properties: { en: { type: "string" } }, required: ["en"] } as const;
/** English function words: a title with one of them (and nothing foreign) is taken as English already. */
const ENGLISH_WORD = /\b(the|of|and|in|at|by|with|from|on|to|after|before|near)\b/i;

/** A named lake, mountain, river, bay or island in a title: "Lake George, Free Study" → George. */
const NAMED_PLACE = /\b(?:Lake|Lago|Lac|Loch|Mount|Mont|Monte|River|Rio|Bay|Gulf|Isle|Island|Cape)\s+(?:of\s+)?([A-Z][\p{L}'’-]+)/gu;

/** The places a file title names by their kind word (their first name word), e.g. ["George"]. */
export function namedPlaces(title: string): string[] {
  return [...new Set([...title.replace(/^File:/, "").replace(/_/g, " ").matchAll(NAMED_PLACE)].map((m) => m[1]!))];
}

/**
 * A painting of a named place the scene never names is another place's picture (Lake Trasimene Short, 21 Nov 2026:
 * Kensett's "Lake George, Free Study" (1872, New York) opened the 217 BC video — the judge saw "a misty lake and
 * mountains" and gave it subject 8/10, never reading the title). Subject score 2, like namedShipCheck.
 */
export function namedPlaceCheck(v: CandidateVerdict, scene: Pick<SceneForJudge, "anlatim" | "tr" | "en" | "mekan" | "konu">): CandidateVerdict {
  if (v.okunamadi || v.puan <= 3) return v;
  const said = `${scene.anlatim} ${scene.tr} ${scene.en} ${scene.mekan} ${scene.konu}`.toLocaleLowerCase("en-US");
  const missing = namedPlaces(v.title).filter((s) => !new RegExp(`\\b${s.toLocaleLowerCase("en-US").replace(/[’'-]/g, ".")}`, "u").test(said));
  if (!missing.length) return v;
  return { ...v, puan: 2, sorun: `${v.sorun ? `${v.sorun}; ` : ""}eserdeki yer sahnede yok: ${missing.join(", ")}`.slice(0, 220) };
}

/** A word list as a regex group that ignores the case of the words only (a name slot must still start upper case). */
function anyCase(words: string): string {
  // Letters only in the lists: each letter becomes [xX].
  return `(?:${words.split("|").map((w) => [...w].map((ch) => `[${ch.toLowerCase()}${ch.toUpperCase()}]`).join("")).join("|")})`;
}
/** A name slot: one to three words starting upper case. */
const NAME_SLOT = String.raw`((?:[A-ZÀ-Þ][\p{L}'’-]+\s*){1,3})`;
/** Nouns whose "of <Name>" names the person or event a picture is about ("Death of Julius Caesar", "Morte di Flaminio", "Battle of Zama"). */
const OF_NAME = new RegExp(String.raw`\b${anyCase("death|murder|assassination|suicide|funeral|burial|triumph|coronation|abdication|execution|trial|arrest|capture|surrender|clemency|continence|apotheosis|oath|wedding|marriage|birth|vision|dream|return|flight|farewell|speech|senate|court|tent|head|body|portrait|bust|statue|battle|siege|sack|fall|morte|mort|trionfo|giuramento|battaglia|assedio|tod|schlacht|belagerung|muerte|batalla|triomphe|serment|bataille|siège")}\s+(?:of|di|de|du|des|del|della|dello|von|der|d['’])\s*(?:the\s+|il\s+|la\s+|le\s+)?${NAME_SLOT}`, "gu");
/** "<Name> denounces …": a person a picture shows doing something ("Cicero Denounces Catiline", "Vespasian brings Senate money"). */
const NAME_DOES = new RegExp(String.raw`((?:[A-ZÀ-Þ][\p{L}'’-]+\s+){1,3})${anyCase("denounces|denouncing|accused|accuses|accusing|brings|bringing|addresses|addressing|harangues|haranguing|receives|receiving|meets|meeting|crosses|crossing|enters|entering|leaves|leaving|refuses|refusing|visits|visiting|kills|killing|killed|slain|crowned|mourns|mourning|swears|swearing|condemned|banished|returns|returning|leads|leading|orders|ordering")}\b`, "gu");
/** "<Name>'s …": "Caesar's Last Senate". */
// Not a place named after someone ("Walker's Ridge", Çanakkale video, 10 Nov 2026).
const NAME_OWNS = /\b([A-ZÀ-Þ][\p{L}-]+)['’]s\b(?!\s+(?:Ridge|Hill|Hills|Point|Bay|Creek|Cove|Gate|Wall|Tower|Bridge|Island|Isle|Farm|Wood|Woods|Field|Ford|Gap|Pass|Post|Crossing|Landing|Station|Fort|Mill|Hole|Head|Rock|Plateau)\b)/gu;
/** A name word: upper case first, then lower case (not an archive code like "BnF MS Fr 9087"). */
const NAME_WORD = /^\p{Lu}[\p{Ll}'’-]{2,}$/u;
/** Words in a name slot that name no one in particular (kind of place, rank, people). */
const GENERIC_NAME_WORD = /^(?:the|lake|lago|lac|loch|mount|mont|monte|river|rio|bay|gulf|isle|island|cape|consul|consuls|king|queen|emperor|empress|general|lord|sir|saint|st|san|santa|pope|prince|princess|duke|count|tribune|dictator|senator|senate|roman|romans|romani|greek|greeks|great|elder|younger|old|young|last|first|army|city|camp|battle|death|people|son|daughter|wife|father|mother)$/i;

/** Letters to change, add or drop to turn one word into the other. */
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next.push(Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    row = next;
  }
  return row[b.length]!;
}

/** Text folded for name comparison: lower case, no accents ("Flaminiò" = "flaminio"). Never used on a path. */
function foldName(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US");
}

/**
 * The people and events a picture title names in a clear slot (after "Death of", "Senate of", "Battle of"; before
 * "denounces", "brings"; a possessive), each as its name words without rank or kind ("Julius Caesar", "Vespasian").
 * The artist is not a subject: a leading "Lodovico Pogliaghi - ", a trailing "by Cesare Maccari" and the credit's author
 * are dropped first.
 */
export function namedSubjects(title: string, author = ""): string[] {
  let t = title.replace(/^(File|Europeana):\s*/, "").replace(/\.(jpe?g|png|tiff?|webm|ogv)$/i, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^(?:[A-ZÀ-Þ][\p{L}.'’-]*\s+){1,3}[A-ZÀ-Þ][\p{L}.'’-]*\s+[-–—]\s+/u, "").replace(/\s+by\s+[A-ZÀ-Þ][^,()]*$/u, "");
  const artist = new Set(foldName(author).split(/[^\p{L}]+/u).filter((w) => w.length >= 3));
  const names: string[] = [];
  for (const re of [OF_NAME, NAME_DOES, NAME_OWNS]) {
    for (const m of t.matchAll(re)) {
      const words = m[1]!.trim().split(/\s+/).map((w) => w.replace(/['’]s$/, "")).filter((w) => NAME_WORD.test(w) && !GENERIC_NAME_WORD.test(w) && !artist.has(foldName(w)));
      if (words.length) names.push(words.join(" "));
    }
  }
  return [...new Set(names)];
}

/**
 * A picture of another person or event is not this scene's picture (owner, 21 Nov 2026, after the Lake Trasimene Short:
 * the panicking Senate of 217 BC got "The Last Senate of Julius Caesar" at subject 9/10 — the judge even described it as
 * "after Hannibal's defeat" — with Vespasian's, Spurius Cassius's and Cicero's Senate paintings behind it, all of other
 * events). A name is the scene's when the scene, the topic or the episode's cast says any of its words (a shared stem:
 * "Morte di Flaminio" for Flaminius; one letter off: "Konstantinople"). One name of the scene's is enough: "The Death of
 * Paulus Aemilius at the Battle of Cannae" is the Cannae scene's picture though the consul is never named. Subject score
 * 2, like namedPlaceCheck.
 */
export function namedSubjectCheck(v: CandidateVerdict, scene: Pick<SceneForJudge, "anlatim" | "tr" | "en" | "mekan" | "konu" | "kisiler">, author = ""): CandidateVerdict {
  if (v.okunamadi || v.puan <= 3) return v;
  const said = foldName(`${scene.anlatim} ${scene.tr} ${scene.en} ${scene.mekan} ${scene.konu} ${scene.kisiler ?? ""}`).split(/[^\p{L}]+/u).filter((w) => w.length >= 3);
  const known = (word: string) => {
    const w = foldName(word);
    const stem = w.slice(0, Math.max(4, w.length - 3));
    // A spelling of another language is the same name ("Konstantinople" for Constantinople): one letter off in six.
    return said.some((s) => (s.length >= 4 && w.startsWith(s)) || s.startsWith(stem) || (w.length >= 6 && Math.abs(s.length - w.length) <= 2 && editDistance(w, s) <= (w.length >= 10 ? 2 : 1)));
  };
  const names = namedSubjects(v.title, author);
  const missing = names.filter((name) => !name.split(" ").some(known));
  if (!missing.length || missing.length < names.length) return v;
  return { ...v, puan: 2, sorun: `${v.sorun ? `${v.sorun}; ` : ""}eserdeki kişi/olay sahnede yok: ${missing.join(", ")}`.slice(0, 220) };
}

/**
 * One plain question about later-era buildings and symbols, for a drawn set of an early period (undefined when the
 * period needs none). The scoring answer misses small things: the Rubicon's Corfinium set (49 BC) had a cross on a
 * bell tower and passed with period 10/10 three times, but asked only this, the judge found "a cross on a tower and a
 * medieval castle keep" twice out of two and nothing in two clean Roman sets (21 Oct 2026).
 */
export function laterEraQuestion(donem: string): string | undefined {
  const year = periodEndYear(donem);
  if (year === undefined || year >= 650) return undefined;
  const things = year < 400 ? "a cross (on a roof, a tower, a spire or a wall), a church, a bell tower or steeple, a minaret, or a medieval castle keep with battlements" : "a minaret or a mosque dome";
  return `Look carefully at the whole picture, including small details on rooftops and tower tops.
Is there anywhere in it: ${things}?
Answer ONLY JSON: {"var": true or false, "ne": "<what and where, at most 10 words>"}`;
}

/**
 * The same plain question the other way round, for a period of steel ships (from MODERN_SHIPS_FROM): a sailing ship in
 * a picture of 1900 or later. The Guadalcanal Short (12 Nov 2026) showed a designed "moment" of Hiei's end with three
 * burning square-riggers that the judge passed with period 10/10 — the scoring answer had rejected three such drawings
 * just before, so asked plainly the judge sees them. Undefined before 1900.
 */
export function earlierShipQuestion(donem: string): string | undefined {
  const year = periodEndYear(donem);
  if (year === undefined || year < MODERN_SHIPS_FROM) return undefined;
  return `Look carefully at every ship and boat in the picture, if there are any.
Does any of them have sails, tall wooden masts with crossing yards, or rope rigging — a sailing ship or an old wooden warship?
Answer ONLY JSON: {"var": true or false, "ne": "<what and where, at most 10 words>"}`;
}

const LATER_ERA_SCHEMA = { type: "object", properties: { var: { type: "boolean" }, ne: { type: "string" } }, required: ["var", "ne"] } as const;

/** The answer to laterEraQuestion: what was seen, or undefined for "nothing" and for an unreadable answer (no penalty). */
export function parseLaterEra(content: string): string | undefined {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const v = JSON.parse(content.slice(start, end + 1)) as { var?: unknown; ne?: unknown };
    return v.var === true || v.var === "true" ? String(v.ne ?? "").trim().slice(0, 80) || "sonraki çağdan bir yapı" : undefined;
  } catch {
    return undefined;
  }
}

/** Token budget of a verdict, and of the one retry after an unreadable answer (a model that thinks first needs room). */
export const VERDICT_TOKENS = 220;
export const VERDICT_RETRY_TOKENS = 1_200;

let unreadableAnswers = 0;

/** Verdicts this process got no readable answer for (a judge fault the production reports to the council). */
export function unreadableVerdicts(): number {
  return unreadableAnswers;
}

/**
 * Judges up to `max` candidates and returns the best one that passes (both scores ≥ MIN_FIT_SCORE, nothing
 * modern; ties: earlier in search order). A preview or judge call that fails scores nothing for that candidate. An
 * unreadable answer is asked once more with a larger budget (the brains' exam found Qwen3-VL's thinking eat the 220
 * tokens and leave an empty answer); still unreadable, it is marked `okunamadi` so the caller can report a judge
 * fault instead of silently rejecting every image.
 */
export async function pickBackground<T extends JudgeCandidate>(
  candidates: readonly T[],
  scene: SceneForJudge,
  judge: AIProvider,
  preview: (c: T) => Promise<Buffer>,
  log: (s: string) => void = () => {},
  opts: { readonly mode?: JudgeMode; readonly max?: number } = {},
): Promise<BackgroundPick<T>> {
  const verdicts: CandidateVerdict[] = [];
  let best: { c: T; v: CandidateVerdict } | undefined;
  for (const c of candidates.slice(0, opts.max ?? MAX_JUDGED)) {
    let v: CandidateVerdict;
    try {
      const image = (await preview(c)).toString("base64");
      const ask = async (maxTokens: number) => {
        const out = await judge.generate(judgePrompt(scene, c, opts.mode), { images: [image], jsonSchema: VERDICT_SCHEMA, maxTokens });
        return parseVerdict(typeof out === "string" ? out : out.content);
      };
      const parsed = (await ask(VERDICT_TOKENS)) ?? (await ask(VERDICT_RETRY_TOKENS));
      v = parsed ? (opts.mode === "set" ? periodWordsCheck({ title: c.title, ...parsed }, scene.donem) : (opts.mode ?? "arsiv") === "arsiv" ? namedSubjectCheck(namedPlaceCheck(namedShipCheck({ title: c.title, ...parsed }, scene), scene), scene, c.credit?.author) : { title: c.title, ...parsed }) : { title: c.title, puan: 0, gosterilen: "", sorun: "okunamayan yanıt", okunamadi: true };
      if (!parsed) {
        unreadableAnswers++;
        log(`hakem okunabilir yanıt vermedi (${c.title.slice(0, 60)})`);
      }
      // Every readable set, not only those that pass: when none passes, the best attempt is used (Rome, 21 Oct 2026).
      // A period image that passes is asked too (owner, 21 Oct 2026: Canaletto's 1742 Forum with its bell tower closed the
      // 49 BC Rubicon video — related to the subject, but not of the period). Subject photos of today are not.
      const question = (opts.mode === "set" && !v.okunamadi) || ((opts.mode ?? "arsiv") === "arsiv" && passes(v)) ? laterEraQuestion(scene.donem) : undefined;
      if (question) {
        const out = await judge.generate(question, { images: [image], jsonSchema: LATER_ERA_SCHEMA, maxTokens: 120 }).catch(() => undefined);
        const seen = out ? parseLaterEra(typeof out === "string" ? out : out.content) : undefined;
        if (seen) v = { ...v, donem: 3, sonrakiCag: seen, sorun: `${v.sorun ? `${v.sorun}; ` : ""}sonraki çağ: ${seen}`.slice(0, 220) };
      }
      // A designed moment or set of a steel-ship period, and a period image that passes: no sailing ship in it.
      const ships = ((opts.mode === "an" || opts.mode === "set") && !v.okunamadi) || ((opts.mode ?? "arsiv") === "arsiv" && passes(v)) ? earlierShipQuestion(scene.donem) : undefined;
      if (ships) {
        const out = await judge.generate(ships, { images: [image], jsonSchema: LATER_ERA_SCHEMA, maxTokens: 120 }).catch(() => undefined);
        const seen = out ? parseLaterEra(typeof out === "string" ? out : out.content) : undefined;
        if (seen) v = { ...v, donem: Math.min(v.donem ?? 10, 2), sorun: `${v.sorun ? `${v.sorun}; ` : ""}önceki çağın gemisi: ${seen}`.slice(0, 220) };
      }
    } catch (e) {
      log(`aday değerlendirilemedi (${c.title.slice(0, 60)}): ${(e as Error).message.slice(0, 120)}`);
      v = { title: c.title, puan: 0, gosterilen: "", sorun: "değerlendirilemedi" };
    }
    verdicts.push(v);
    if (passes(v, opts.mode === "konu" || (["arsiv", "an", "set"].includes(opts.mode ?? "arsiv") && presentDay(scene.donem))) && (!best || fitScore(v) > fitScore(best.v))) best = { c, v };
  }
  return best ? { chosen: best.c, verdict: best.v, verdicts } : { verdicts };
}

/** One line for logs and QC: "7/9 eser · Rumeli Hisarı gravürü · …". */
export function verdictLine(v: CandidateVerdict): string {
  return `konu ${v.puan}/10, dönem ${v.donem ?? "?"}/10${v.modern ? ", MODERN" : ""}${v.tur ? `, ${v.tur}` : ""} · ${v.title.replace(/^File:/, "").slice(0, 60)} · ${v.gosterilen}`;
}
