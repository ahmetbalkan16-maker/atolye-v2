import type { AIProvider } from "../../ai/providers/AIProvider";

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

export type JudgeMode = "arsiv" | "set";

export interface SceneForJudge {
  readonly konu: string;
  readonly donem: string;
  readonly mekan: string;
  readonly tr: string;
  readonly en: string;
  /** What is said in the scene (first lines), so the judge knows what the image should show. */
  readonly anlatim: string;
  /** The drawn set as described by the script (set mode). */
  readonly tasarim?: string;
}

/** What the judge needs to know about a candidate besides its pixels. */
export interface JudgeCandidate {
  readonly title: string;
  readonly description?: string;
  readonly source?: string;
  readonly year?: number;
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
  },
  required: ["puan", "donem", "modern", "tur", "gosterilen", "sorun"],
};

const SOURCE_NAME: Readonly<Record<string, string>> = { wikipedia: "the Wikipedia article about the subject", met: "The Metropolitan Museum of Art", commons: "Wikimedia Commons" };

/** Both scores at or above the bar and nothing modern in the picture. */
export function passes(v: CandidateVerdict): boolean {
  return v.puan >= MIN_FIT_SCORE && (v.donem ?? v.puan) >= MIN_FIT_SCORE && v.modern !== true;
}

/** Ranking score: the weaker of the two scores. */
export function fitScore(v: CandidateVerdict): number {
  return Math.min(v.puan, v.donem ?? v.puan);
}

export function judgePrompt(scene: SceneForJudge, c: JudgeCandidate, mode: JudgeMode = "arsiv"): string {
  const answer = `Answer only JSON: {"puan": <0-10>, "donem": <0-10>, "modern": <true|false>, "tur": "eser|harita|fotograf|cizim|diger", "gosterilen": "<what the image shows, Turkish, at most 12 words>", "sorun": "<why it fits or not, Turkish, at most 15 words>"}`;
  if (mode === "set") {
    return `You are the art director of an animated history documentary for an American YouTube channel. This is a candidate drawn background (a set); cartoon characters will be drawn standing in front of it.

EPISODE: ${scene.konu}
PERIOD: ${scene.donem}
SCENE PLACE: ${scene.mekan}
SET WANTED: ${scene.tasarim ?? `${scene.tr} / ${scene.en}`}
SAID IN THE SCENE: "${scene.anlatim.slice(0, 300)}"

Score 0–10:
- "puan" (place): does it show this place as wanted (landscape, buildings, what the scene needs)? 0–3 if it shows a different kind of place, or if people, faces, characters, text, letters or a watermark are visible, or the foreground is cluttered (the characters need open ground).
- "donem" (period): would every visible thing pass for ${scene.donem}? 0–3 if anything belongs to another era or region (modern buildings, cars, asphalt, power lines, modern ships, a European town for an Ottoman scene, wrong architecture).
- "modern": true if anything modern is visible.
- "tur": "cizim" for a drawn image.
${answer}`;
  }
  return `You are the picture researcher of a history documentary for an American YouTube channel. While the narrator speaks, a real image from or of the period is shown full screen.

EPISODE: ${scene.konu}
PERIOD: ${scene.donem}
SCENE PLACE: ${scene.mekan}
IMAGE WANTED: ${scene.tr} / ${scene.en}
SAID IN THE SCENE: "${scene.anlatim.slice(0, 400)}"
FILE (from ${SOURCE_NAME[c.source ?? "commons"] ?? "Wikimedia Commons"}, may be wrong): ${c.title.replace(/^File:/, "")}${c.description ? ` — ${c.description.slice(0, 300)}` : ""}
MADE IN (metadata, may be missing or wrong): ${c.year ?? "unknown"}

Look at the image and score 0–10:
- "puan" (subject): does it show this scene's place, person, object or event? 9–10 exactly this; 7–8 clearly right but generic; 4–6 loosely related (same region or era, wrong subject); 0–3 unrelated, or unusable full screen (a close-up of text, a plain diagram, mostly empty).
- "donem" (period): does it show the subject as it was in ${scene.donem}? 9–10 an artwork, manuscript, map, engraving or photograph made in that period; 7–8 a later painting or engraving of that period with nothing modern in it; 4–6 a later depiction that mixes in later things; 0–3 a photo taken long after the period (the place as it stands today), or anything with modern elements (cars, asphalt, power lines, modern buildings, ferries or boats with engines, people in modern clothes, signs, logos), a reconstruction for tourists, a watermark.
- "modern": true if anything modern is visible at all.
- "tur": eser (painting, miniature, engraving, mosaic, manuscript), harita, fotograf, cizim (plan, diagram), diger.
Judge the image, not the file name.
${answer}`;
}

/** A verdict from a model answer, or undefined when it is not a readable score. */
export function parseVerdict(content: string): Omit<CandidateVerdict, "title"> | undefined {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const v = JSON.parse(content.slice(start, end + 1)) as { puan?: unknown; donem?: unknown; modern?: unknown; tur?: unknown; gosterilen?: unknown; sorun?: unknown };
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
    };
  } catch {
    return undefined;
  }
}

/**
 * Judges up to `max` candidates and returns the best one that passes (both scores ≥ MIN_FIT_SCORE, nothing
 * modern; ties: earlier in search order). A preview or judge call that fails scores nothing for that candidate.
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
      const out = await judge.generate(judgePrompt(scene, c, opts.mode), { images: [image], jsonSchema: VERDICT_SCHEMA, maxTokens: 220 });
      const parsed = parseVerdict(typeof out === "string" ? out : out.content);
      v = parsed ? { title: c.title, ...parsed } : { title: c.title, puan: 0, gosterilen: "", sorun: "okunamayan yanıt" };
    } catch (e) {
      log(`aday değerlendirilemedi (${c.title.slice(0, 60)}): ${(e as Error).message.slice(0, 120)}`);
      v = { title: c.title, puan: 0, gosterilen: "", sorun: "değerlendirilemedi" };
    }
    verdicts.push(v);
    if (passes(v) && (!best || fitScore(v) > fitScore(best.v))) best = { c, v };
  }
  return best ? { chosen: best.c, verdict: best.v, verdicts } : { verdicts };
}

/** One line for logs and QC: "7/9 eser · Rumeli Hisarı gravürü · …". */
export function verdictLine(v: CandidateVerdict): string {
  return `konu ${v.puan}/10, dönem ${v.donem ?? "?"}/10${v.modern ? ", MODERN" : ""}${v.tur ? `, ${v.tur}` : ""} · ${v.title.replace(/^File:/, "").slice(0, 60)} · ${v.gosterilen}`;
}
