import type { AIProvider } from "../../ai/providers/AIProvider";
import type { CommonsCandidate } from "./CommonsProvider";

/**
 * Picks a Commons image for a scene by looking at it: a local vision model (gemma4 through Ollama) scores each
 * candidate's preview against the scene. A real photo is welcome when it shows what the scene talks about (the
 * fortress as it stands today); an unrelated or modern-looking image (the first pilot got a crane, then a Swiss
 * street) is never used. No judge, no answer or no candidate above the bar → nothing is picked and the caller
 * uses a local set.
 */
export const MIN_FIT_SCORE = 7;
/** Candidates judged per scene, in search order (each costs one local vision call). */
export const MAX_JUDGED = 6;

export interface SceneForJudge {
  readonly konu: string;
  readonly donem: string;
  readonly mekan: string;
  readonly tr: string;
  readonly en: string;
  /** What is said in the scene (first lines), so the judge knows what the image should show. */
  readonly anlatim: string;
}

export interface CandidateVerdict {
  readonly title: string;
  readonly puan: number;
  readonly gosterilen: string;
  readonly sorun: string;
}

export interface BackgroundPick {
  readonly chosen?: CommonsCandidate;
  readonly verdict?: CandidateVerdict;
  readonly verdicts: readonly CandidateVerdict[];
}

const VERDICT_SCHEMA = {
  type: "object",
  properties: { puan: { type: "integer", minimum: 0, maximum: 10 }, gosterilen: { type: "string" }, sorun: { type: "string" } },
  required: ["puan", "gosterilen", "sorun"],
};

export function judgePrompt(scene: SceneForJudge, c: CommonsCandidate): string {
  return `You are the picture editor of a history documentary. Cartoon characters stand in front of the background and talk, so the image must show the place or subject of this scene.

EPISODE: ${scene.konu} (${scene.donem})
SCENE PLACE: ${scene.mekan}
BACKGROUND WANTED: ${scene.tr} / ${scene.en}
SAID IN THE SCENE: "${scene.anlatim.slice(0, 400)}"
FILE (from Wikimedia Commons, may be wrong): ${c.title.replace(/^File:/, "")}${c.description ? ` — ${c.description.slice(0, 300)}` : ""}

Look at the image and score 0–10 how well it works as this scene's background:
- 9–10: shows exactly this place or subject — a period artwork, map or engraving, or a real photo of the same historical place or object as it survives today.
- 7–8: clearly the right place, period or subject, a little generic.
- 4–6: loosely related (same region or era, wrong subject).
- 0–3: unrelated; or dominated by things that do not belong (cranes, cars, modern buildings or streets, people in modern clothes, logos, large text, watermarks); or unusable behind characters (a close-up of a page, a plain diagram, mostly empty).
A real photo is fine; what matters is that it shows what the scene talks about. Judge the image, not the file name.
Answer only JSON: {"puan": <integer 0-10>, "gosterilen": "<what the image shows, Turkish, at most 12 words>", "sorun": "<why it fits or not, Turkish, at most 15 words>"}`;
}

/** A verdict from a model answer, or undefined when it is not a readable score. */
export function parseVerdict(content: string): Omit<CandidateVerdict, "title"> | undefined {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const v = JSON.parse(content.slice(start, end + 1)) as { puan?: unknown; gosterilen?: unknown; sorun?: unknown };
    const puan = typeof v.puan === "number" ? v.puan : typeof v.puan === "string" ? Number(v.puan) : NaN;
    if (!Number.isFinite(puan) || puan < 0 || puan > 10) return undefined;
    return { puan: Math.round(puan), gosterilen: String(v.gosterilen ?? "").slice(0, 120), sorun: String(v.sorun ?? "").slice(0, 160) };
  } catch {
    return undefined;
  }
}

/**
 * Judges up to MAX_JUDGED candidates and returns the best one at or above MIN_FIT_SCORE (ties: earlier in search
 * order). A preview or judge call that fails scores nothing for that candidate.
 */
export async function pickBackground(
  candidates: readonly CommonsCandidate[],
  scene: SceneForJudge,
  judge: AIProvider,
  preview: (c: CommonsCandidate) => Promise<Buffer>,
  log: (s: string) => void = () => {},
): Promise<BackgroundPick> {
  const verdicts: CandidateVerdict[] = [];
  let best: { c: CommonsCandidate; v: CandidateVerdict } | undefined;
  for (const c of candidates.slice(0, MAX_JUDGED)) {
    let v: CandidateVerdict;
    try {
      const image = (await preview(c)).toString("base64");
      const out = await judge.generate(judgePrompt(scene, c), { images: [image], jsonSchema: VERDICT_SCHEMA, maxTokens: 200 });
      const parsed = parseVerdict(typeof out === "string" ? out : out.content);
      v = parsed ? { title: c.title, ...parsed } : { title: c.title, puan: 0, gosterilen: "", sorun: "okunamayan yanıt" };
    } catch (e) {
      log(`aday değerlendirilemedi (${c.title.slice(0, 60)}): ${(e as Error).message.slice(0, 120)}`);
      v = { title: c.title, puan: 0, gosterilen: "", sorun: "değerlendirilemedi" };
    }
    verdicts.push(v);
    if (v.puan >= MIN_FIT_SCORE && (!best || v.puan > best.v.puan)) best = { c, v };
  }
  return best ? { chosen: best.c, verdict: best.v, verdicts } : { verdicts };
}
