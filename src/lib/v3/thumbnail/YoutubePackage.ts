import { readJsonAnswer } from "../council/Council";
import type { Episode } from "../episode/EpisodeTypes";

/**
 * The YouTube package of an episode (owner approval 20 Oct 2026; knowledge from the higgsfield-youtube-thumbnail and
 * kostja94 YouTube skills, used without their paid services): title options under 60 characters with the main
 * keyword early, thumbnail headlines of 2–4 true words that open a question, chapter titles, tags and hashtags, and a
 * description whose first 160 characters carry the keyword and the hook. Chapters follow YouTube's rules (start at
 * 0:00, at least three, each at least 10 seconds).
 */
export interface YoutubePackage {
  readonly basliklar: readonly string[];
  readonly kapakBasliklari: readonly string[];
  /** One title per scene, in scene order. */
  readonly bolumler: readonly string[];
  readonly etiketler: readonly string[];
  readonly hashtagler: readonly string[];
  readonly aciklamaGiris: string;
}

/**
 * Long episodes open every chapter with a "bolum" card (LongForm): those scenes and titles are the video's chapters,
 * for YouTube and for the package prompt (a list of 80 scenes would ask for 80 chapter titles).
 */
export function chapterScenes(episode: Pick<Episode, "sahneler">): { index: number; baslik: string }[] {
  return episode.sahneler.flatMap((s, i) => {
    const card = (s.yazi_karti ?? []).find((k) => k.stil === "bolum");
    return card ? [{ index: i, baslik: card.metin.slice(0, 40) }] : [];
  });
}

export function packagePrompt(episode: Episode): string {
  const marked = chapterScenes(episode);
  const long = marked.length >= 3;
  const chapterWords = (from: number, to: number) => episode.sahneler.slice(from, to).flatMap((s) => s.satirlar.map((l) => l.metin)).join(" ").slice(0, 220);
  const scenes = long
    ? marked.map((m, i) => `${i + 1}. ${m.baslik}: ${chapterWords(m.index, marked[i + 1]?.index ?? episode.sahneler.length)}`).join("\n")
    : episode.sahneler.map((s, i) => `${i + 1}. ${s.mekan}: ${s.satirlar.map((l) => l.metin).join(" ").slice(0, 220)}`).join("\n");
  return `You publish an animated history video on YouTube for an American audience (in the style of OverSimplified).
VIDEO: "${episode.baslik}" — ${episode.konu} (${episode.donem})
${long ? "CHAPTERS" : "SCENES"}:
${scenes}

Write, in American English:
- "basliklar": 3 video titles, each under 60 characters, the main keyword (the person or event) in the first words, an emotional or curious hook, no clickbait lies.
- "kapak_basliklari": 3 thumbnail headlines, 2–4 words each, true to the video, opening a question the video answers (e.g. "POINT OF NO RETURN", "HE DID WHAT?"), never repeating the title word for word.
${long ? "" : `- "bolumler": ${episode.sahneler.length} chapter titles, one per scene in order, 2–5 words each.\n`}- "etiketler": 12 relevant search tags (people, places, events, era, "history animation").
- "hashtagler": 3 hashtags without spaces, starting with "#".
- "aciklama_giris": the description's first two sentences, under 160 characters together, with the main keyword and the hook.
Return ONLY JSON with exactly these keys.`;
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown, max: number, len: number) => (Array.isArray(v) ? v.map((x) => clean(x, len)).filter(Boolean).slice(0, max) : []);

/** A package from a model answer; anything unreadable falls back to the episode's own title and words. */
export function readPackage(text: string, episode: Episode): YoutubePackage {
  const v = readJsonAnswer<Record<string, unknown>>(text) ?? {};
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const headlines = list(v.kapak_basliklari, 3, 40).filter((h) => words(h) >= 1 && words(h) <= 4).map((h) => h.toLocaleUpperCase("en-US"));
  const fallbackHeadline = (episode.sahneler.flatMap((s) => (s.yazi_karti ?? []).filter((c) => c.stil === "kelime").map((c) => c.metin))[0] ?? episode.baslik.split(/[:—-]/)[0]!).split(/\s+/).slice(0, 4).join(" ").toLocaleUpperCase("en-US");
  const titles = list(v.basliklar, 3, 100).filter((t) => t.length <= 70);
  const chapters = list(v.bolumler, episode.sahneler.length, 40);
  return {
    basliklar: titles.length ? titles : [episode.baslik.slice(0, 70)],
    kapakBasliklari: headlines.length ? headlines : [fallbackHeadline],
    bolumler: episode.sahneler.map((s, i) => chapters[i] || s.mekan.slice(0, 40)),
    etiketler: list(v.etiketler, 15, 40),
    hashtagler: list(v.hashtagler, 3, 30).filter((h) => /^#\S+$/.test(h)),
    aciklamaGiris: clean(v.aciklama_giris, 200),
  };
}

export interface Chapter {
  readonly t: number;
  readonly baslik: string;
}

/**
 * YouTube chapters from the scene starts: the first at 0:00 (it takes in the opening cover), scenes shorter than 10 s
 * merged into the chapter before, and none at all when fewer than three remain (YouTube would ignore them).
 */
export function chapters(sceneStarts: readonly number[], titles: readonly string[], duration: number): Chapter[] {
  const out: Chapter[] = [];
  sceneStarts.forEach((start, i) => {
    const t = i === 0 ? 0 : start;
    const last = out[out.length - 1];
    if (last && t - last.t < 10) return;
    out.push({ t, baslik: titles[i] ?? `Part ${i + 1}` });
  });
  while (out.length > 1 && duration - out[out.length - 1]!.t < 10) out.pop();
  return out.length >= 3 ? out : [];
}

export function chapterText(chs: readonly Chapter[]): string {
  const stamp = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  return chs.map((c) => `${stamp(c.t)} ${c.baslik}`).join("\n");
}
