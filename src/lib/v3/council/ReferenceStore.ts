import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { type BrainId, readJsonAnswer } from "./Council";

/**
 * Learning from similar videos (owner approval, 2 Nov 2026: "the brains watch similar videos online and gain
 * experience"; reference Sancaray's "IV. Murad"). The owner gives a link, or the idle loop searches for videos on a
 * topic the studio made; the brains read the video's captions and a few chosen frames, measure its pace and narration,
 * and write what they learned into their own memory as lessons, and the measures as targets. A video is studied only to
 * learn: nothing of it — no line, joke, character, picture or sound — is used, and its downloaded files are deleted as
 * soon as it has been measured. Only the measures, the frames' one-line descriptions and the lessons are kept.
 *
 * This file holds the measures, the records and the request store — no child process and no network module, so the
 * live server (AYAS's chat, the Gelişim Merkezi) can read it; the download and the study itself are ReferenceStudy.ts.
 */
export interface Caption {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** The captions mark a new speaker here (YouTube's speech recognition writes ">>"). */
  readonly turn: boolean;
}

/** YouTube's json3 captions as timed lines; the recogniser's "[müzik]"/"[music]" notes are left out of the words. */
export function parseJson3(json: unknown): Caption[] {
  const events = (json as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];
  const out: Caption[] = [];
  for (const e of events as { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[]) {
    if (!Array.isArray(e.segs) || typeof e.tStartMs !== "number") continue;
    const raw = e.segs.map((s) => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    if (!raw) continue;
    const turn = raw.includes(">>");
    const text = raw.replace(/>>/g, " ").replace(/\[[^\]]{1,20}\]/g, " ").replace(/\s+/g, " ").trim();
    if (!text && !turn) continue;
    out.push({ start: e.tStartMs / 1000, end: (e.tStartMs + (e.dDurationMs ?? 0)) / 1000, text, turn });
  }
  return out;
}

/**
 * A video's pace and narration in numbers. The same measures are taken of our own videos (the picture cuts by the
 * same ffmpeg scene filter, the speech from the timeline), so a reference and an episode are compared like for like.
 */
export interface VideoMeasures {
  readonly sureSn: number;
  /** Spoken words per minute of the whole video. */
  readonly kelimeDk?: number;
  /** Share of the video during which someone speaks (0..1). */
  readonly konusmaPayi?: number;
  /** When the first word is said. */
  readonly ilkSozSn?: number;
  /** Speaker changes per minute; absent when the captions do not mark speakers. */
  readonly sozDegisimiDk?: number;
  /** Share of the sentences that are questions (0..1). */
  readonly soruPayi?: number;
  /** Picture cuts per minute and the average shot length. */
  readonly kesmeDk: number;
  readonly ortCekimSn: number;
  /** What the sampled frames show, as shares (0..1). */
  readonly kareler?: Readonly<Partial<Record<FrameKindRef, number>>>;
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const wordCount = (s: string) => s.split(/\s+/).filter((w) => /\p{L}|\d/u.test(w)).length;

/** The length of the union of [start, end) spans (overlapping captions are counted once). */
export function coveredSeconds(spans: readonly { readonly start: number; readonly end: number }[]): number {
  const sorted = [...spans].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  let total = 0, from = -Infinity, to = -Infinity;
  for (const s of sorted) {
    if (s.start > to) {
      if (to > from) total += to - from;
      from = s.start;
      to = s.end;
    } else to = Math.max(to, s.end);
  }
  if (to > from) total += to - from;
  return total;
}

/**
 * Speech measures from timed lines. `turns`: the speaker changes when they are known (our own lines know every
 * speaker; recognised captions only where ">>" was written — none at all means unknown, never zero).
 */
export function speechMeasures(lines: readonly Caption[], durationS: number, turns?: number): Pick<VideoMeasures, "kelimeDk" | "konusmaPayi" | "ilkSozSn" | "sozDegisimiDk" | "soruPayi"> {
  const spoken = lines.filter((l) => l.text);
  if (!spoken.length || durationS <= 0) return {};
  const minutes = durationS / 60;
  const words = spoken.reduce((a, l) => a + wordCount(l.text), 0);
  const sentences = spoken.map((l) => l.text).join(" ").split(/(?<=[.!?…])\s+/).filter((s) => wordCount(s) > 0);
  const marked = turns ?? lines.filter((l) => l.turn).length;
  return {
    kelimeDk: round(words / minutes, 1),
    konusmaPayi: round(Math.min(1, coveredSeconds(spoken) / durationS)),
    ilkSozSn: round(spoken[0]!.start, 1),
    ...(marked > 0 ? { sozDegisimiDk: round(marked / minutes, 1) } : {}),
    ...(sentences.length ? { soruPayi: round(sentences.filter((s) => /\?\s*$/.test(s)).length / sentences.length) } : {}),
  };
}

export function cutMeasures(cuts: readonly number[], durationS: number): Pick<VideoMeasures, "kesmeDk" | "ortCekimSn"> {
  const minutes = Math.max(durationS, 1) / 60;
  return { kesmeDk: round(cuts.length / minutes, 1), ortCekimSn: round(durationS / (cuts.length + 1), 1) };
}

/** What a sampled frame of a reference shows. */
export type FrameKindRef = "harita" | "karakter" | "resim" | "yazi" | "diger";
export const FRAME_KINDS_REF: readonly FrameKindRef[] = ["harita", "karakter", "resim", "yazi", "diger"];

export interface FrameNote {
  readonly t: number;
  readonly tur: FrameKindRef;
  /** How many drawn characters are on screen. */
  readonly kisi: number;
  readonly tarif: string;
}

export const FRAME_NOTE_PROMPT = `You are looking at one frame of an animated history video, to learn how such videos are made. Answer ONLY JSON:
{"tur": "harita|karakter|resim|yazi|diger", "kisi": <number of drawn characters on screen>, "tarif": "<at most 20 English words: what the frame shows and what is happening>"}
tur: harita = a map; karakter = drawn characters acting in a set; resim = a painting, photo or archive picture; yazi = mostly text (a title or card); diger = anything else.`;

export function parseFrameNote(t: number, text: string): FrameNote | undefined {
  const v = readJsonAnswer<{ tur?: unknown; kisi?: unknown; tarif?: unknown }>(text);
  if (!v || !FRAME_KINDS_REF.includes(v.tur as FrameKindRef)) return undefined;
  return { t: round(t, 1), tur: v.tur as FrameKindRef, kisi: Math.max(0, Math.min(50, Math.round(Number(v.kisi) || 0))), tarif: typeof v.tarif === "string" ? v.tarif.replace(/\s+/g, " ").trim().slice(0, 160) : "" };
}

export function frameShares(notes: readonly FrameNote[]): Partial<Record<FrameKindRef, number>> {
  if (!notes.length) return {};
  return Object.fromEntries(FRAME_KINDS_REF.flatMap((k) => {
    const n = notes.filter((x) => x.tur === k).length;
    return n ? [[k, round(n / notes.length)]] : [];
  }));
}

/** Evenly spread sample times, away from the first and last 4% (intro and end cards). */
export function sampleTimes(durationS: number, n: number): number[] {
  const from = durationS * 0.04, to = durationS * 0.96;
  return Array.from({ length: n }, (_, i) => round(from + ((to - from) * (i + 0.5)) / n, 1));
}

/** The brains that learn from a reference (owner's plan: script writer, historian, humourist, quality). */
export const STUDY_BRAINS = ["kurgu", "arastirma", "mizah", "kalite"] as const satisfies readonly BrainId[];
export type StudyBrain = (typeof STUDY_BRAINS)[number];

export interface StudyLesson {
  readonly beyin: StudyBrain;
  /** The lesson as it goes into the brain's prompt (English, a technique for any topic). */
  readonly metin: string;
  /** One Turkish line for the owner's report. */
  readonly tr: string;
}

export const MAX_STUDY_LESSONS_PER_BRAIN = 3;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * The transcript as the study prompt takes it: a [m:ss] mark every 30 s (so a lesson can say where a device is used),
 * the opening in full, then the middle and the end, at most `maxWords`.
 */
export function transcriptExcerpt(captions: readonly Caption[], maxWords = 3_500): string {
  let marked = -Infinity;
  const lines = captions
    .map((c) => {
      const mark = c.start - marked >= 30 ? `[${clock(c.start)}] ` : "";
      if (mark) marked = c.start;
      return `${mark}${c.turn ? ">> " : ""}${c.text}`;
    })
    .filter((s) => s.trim());
  const all = lines.join(" ").split(/\s+/);
  if (all.length <= maxWords) return lines.join("\n");
  const head = all.slice(0, Math.round(maxWords * 0.6)).join(" ");
  const midAt = Math.floor(all.length / 2);
  const mid = all.slice(midAt, midAt + Math.round(maxWords * 0.25)).join(" ");
  const tail = all.slice(-Math.round(maxWords * 0.15)).join(" ");
  return `${head}\n[…]\n${mid}\n[…]\n${tail}`;
}

export function measuresLine(m: VideoMeasures): string {
  const pct = (x?: number) => (x === undefined ? "?" : `${Math.round(x * 100)}%`);
  const frames = m.kareler ? Object.entries(m.kareler).map(([k, v]) => `${k} ${pct(v)}`).join(", ") : "";
  return [
    `${Math.round(m.sureSn)} s`,
    m.kelimeDk !== undefined ? `${m.kelimeDk} words/min` : "",
    m.konusmaPayi !== undefined ? `speech ${pct(m.konusmaPayi)} of the time` : "",
    m.ilkSozSn !== undefined ? `first words at ${m.ilkSozSn} s` : "",
    m.sozDegisimiDk !== undefined ? `${m.sozDegisimiDk} speaker changes/min` : "",
    m.soruPayi !== undefined ? `questions ${pct(m.soruPayi)} of sentences` : "",
    `${m.kesmeDk} picture cuts/min (a shot every ${m.ortCekimSn} s)`,
    frames ? `frames: ${frames}` : "",
  ].filter(Boolean).join("; ");
}

export function studyPrompt(input: { readonly baslik: string; readonly kanal: string; readonly dil: string; readonly measures: VideoMeasures; readonly frames: readonly FrameNote[]; readonly transcript: string }): string {
  return `You run the writers' room of a studio that makes animated history videos (drawn characters, maps, period pictures, narrator plus character dialogue, humour). You are studying another channel's video ONLY to learn techniques. Never copy its lines, jokes, characters, story or pictures: every lesson must be a general technique that works for ANY period or topic.

VIDEO: "${input.baslik}" by ${input.kanal} (language: ${input.dil || "?"})
MEASURES: ${measuresLine(input.measures)}

WHAT THE SCREEN SHOWS (sampled frames):
${input.frames.map((f) => `- ${f.t} s: ${f.tur}, ${f.kisi} characters — ${f.tarif}`).join("\n") || "- (no frames)"}

TRANSCRIPT (automatic captions; ">>" marks a new speaker; recognition errors are possible):
${input.transcript || "(no captions)"}

Write what our brains should learn, at most ${MAX_STUDY_LESSONS_PER_BRAIN} lessons per brain, each one technique in English (at most 220 characters) with a one-line Turkish summary. Every lesson must be SPECIFIC to what this video does and checkable in our script: name the device, where or how often the video uses it (a time like 2:30, or "every scene"), and how to do the same for any topic. Generic advice ("use dialogue to keep the pace", "integrate facts seamlessly", "keep the viewer engaged") is worthless: never write it. Quote at most five words of the video, never a whole line.
- kurgu (script writer): the hook, the structure, how scenes turn, how dialogue carries the story, the pace
- mizah (humour writer): how the humour is built and timed — the mechanism, never the joke itself
- arastirma (historian): how facts, dates and stakes are delivered without slowing the story
- kalite (picture critic): what the screen shows while a thing is told, how often the picture changes, what keeps it alive
Return ONLY JSON: {"ozet": "<two Turkish sentences: what this video does well>", "dersler": [{"beyin": "kurgu|mizah|arastirma|kalite", "metin": "<English lesson>", "tr": "<Turkish summary>"}]}`;
}

/** Nothing of a reference is reused: a quotation in a lesson keeps at most its first five words. */
export const MAX_QUOTE_WORDS = 5;

export function shortenQuotes(text: string): string {
  // A quote opens after a space or a bracket and closes before one, so a Turkish apostrophe ("Kanuni'nin") is no quote.
  return text.replace(/(^|[\s(])(["'“‘])(.{3,300}?)(["'”’])(?=[\s,.;:)!?]|$)/g, (all, before: string, open: string, inner: string, close: string) => {
    const w = inner.trim().split(/\s+/);
    return w.length > MAX_QUOTE_WORDS ? `${before}${open}${w.slice(0, MAX_QUOTE_WORDS).join(" ")}…${close}` : all;
  });
}

export function parseStudy(text: string): { readonly ozet: string; readonly dersler: StudyLesson[] } | undefined {
  const v = readJsonAnswer<{ ozet?: unknown; dersler?: unknown }>(text);
  if (!v || !Array.isArray(v.dersler)) return undefined;
  const count = new Map<string, number>();
  const dersler = (v.dersler as Record<string, unknown>[]).flatMap((d): StudyLesson[] => {
    const beyin = d?.beyin as StudyBrain;
    const metin = typeof d?.metin === "string" ? shortenQuotes(d.metin.replace(/\s+/g, " ").trim()).slice(0, 300) : "";
    if (!STUDY_BRAINS.includes(beyin) || metin.length < 12) return [];
    const n = (count.get(beyin) ?? 0) + 1;
    if (n > MAX_STUDY_LESSONS_PER_BRAIN) return [];
    count.set(beyin, n);
    return [{ beyin, metin, tr: typeof d.tr === "string" ? d.tr.replace(/\s+/g, " ").trim().slice(0, 200) : "" }];
  });
  return { ozet: typeof v.ozet === "string" ? v.ozet.trim().slice(0, 500) : "", dersler };
}

/** A studied reference as kept in `<workRoot>/_kutuphane/referanslar/<id>.json` (no media, no transcript). */
export interface ReferenceRecord {
  readonly id: string;
  readonly url: string;
  readonly baslik: string;
  readonly kanal: string;
  readonly dil: string;
  readonly tarih: string;
  /** Why it was studied: the owner's link, AYAS's request, or the idle loop's search for a topic. */
  readonly neden: string;
  readonly olcum: VideoMeasures;
  readonly kareler: readonly FrameNote[];
  readonly ozet: string;
  readonly dersler: readonly StudyLesson[];
  /** What could not be done (no captions, the eye unavailable…). */
  readonly eksik: readonly string[];
}

export function referenceDir(workRoot: string): string {
  return path.join(workRoot, "_kutuphane", "referanslar");
}

export async function listReferences(workRoot: string): Promise<ReferenceRecord[]> {
  const dir = referenceDir(workRoot);
  if (!existsSync(dir)) return [];
  const out: ReferenceRecord[] = [];
  for (const n of (await fs.readdir(dir)).filter((x) => x.endsWith(".json")).sort()) {
    try {
      const r = JSON.parse(await fs.readFile(path.join(dir, n), "utf8")) as ReferenceRecord;
      if (r?.id && r.olcum) out.push(r);
    } catch {
      // A half-written record is read next time.
    }
  }
  return out;
}

/** Shorts and long videos are paced differently: targets come from references of the same kind. */
export type VideoKind = "short" | "uzun";
export const kindOf = (durationS: number): VideoKind => (durationS <= 75 ? "short" : "uzun");

export interface ReferenceTargets {
  readonly tur: VideoKind;
  /** How many references the medians come from. */
  readonly kaynak: number;
  readonly kelimeDk?: number;
  readonly sozDegisimiDk?: number;
  readonly ilkSozSn?: number;
  readonly kesmeDk?: number;
  readonly konusmaPayi?: number;
}

const median = (xs: readonly number[]): number | undefined => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The medians of the studied references of a kind (all references when none is of that kind). */
export function referenceTargets(records: readonly ReferenceRecord[], tur: VideoKind): ReferenceTargets | undefined {
  const same = records.filter((r) => kindOf(r.olcum.sureSn) === tur);
  const use = same.length ? same : records;
  if (!use.length) return undefined;
  const pick = (k: "kelimeDk" | "sozDegisimiDk" | "ilkSozSn" | "kesmeDk" | "konusmaPayi") => median(use.flatMap((r) => (r.olcum[k] !== undefined ? [r.olcum[k]!] : [])));
  const out: Record<string, number> = {};
  for (const k of ["kelimeDk", "sozDegisimiDk", "ilkSozSn", "kesmeDk", "konusmaPayi"] as const) {
    const v = pick(k);
    if (v !== undefined) out[k] = round(v, k === "konusmaPayi" ? 2 : 1);
  }
  return { tur, kaynak: use.length, ...out };
}

/** The targets as one line for the writer's prompt (English, like its other lessons). */
export function targetsLine(t: ReferenceTargets): string {
  const parts = [
    t.kelimeDk !== undefined ? `about ${Math.round(t.kelimeDk)} spoken words per minute` : "",
    t.sozDegisimiDk !== undefined ? `a new speaker about every ${Math.round(60 / Math.max(t.sozDegisimiDk, 0.1))} s` : "",
    t.ilkSozSn !== undefined ? `first words within ${Math.max(1, Math.round(t.ilkSozSn))} s` : "",
    t.kesmeDk !== undefined ? `a picture change about every ${Math.round(60 / Math.max(t.kesmeDk, 0.1))} s` : "",
  ].filter(Boolean);
  return parts.length ? `Target pace measured on ${t.kaynak} studied reference video${t.kaynak === 1 ? "" : "s"}: ${parts.join(", ")}.` : "";
}

export interface MeasureGap {
  readonly olcu: "kelimeDk" | "sozDegisimiDk" | "ilkSozSn" | "kesmeDk";
  readonly biz: number;
  readonly hedef: number;
  /** Positive: we are over the target by this share; negative: under. */
  readonly fark: number;
}

/** How far is "too far" from a target: a quarter (pace measures are noisy; a few seconds of first words are fine). */
export const GAP_SHARE = 0.25;

/** Where an episode is clearly off the references' pace. */
export function measureGaps(ours: VideoMeasures, t: ReferenceTargets): MeasureGap[] {
  const out: MeasureGap[] = [];
  for (const olcu of ["kelimeDk", "sozDegisimiDk", "kesmeDk"] as const) {
    const biz = ours[olcu], hedef = t[olcu];
    if (biz === undefined || hedef === undefined || hedef <= 0) continue;
    const fark = (biz - hedef) / hedef;
    if (Math.abs(fark) >= GAP_SHARE) out.push({ olcu, biz, hedef, fark: round(fark) });
  }
  if (ours.ilkSozSn !== undefined && t.ilkSozSn !== undefined && ours.ilkSozSn > Math.max(t.ilkSozSn * 2, t.ilkSozSn + 3)) out.push({ olcu: "ilkSozSn", biz: ours.ilkSozSn, hedef: t.ilkSozSn, fark: round((ours.ilkSozSn - t.ilkSozSn) / Math.max(t.ilkSozSn, 1)) });
  return out;
}

/** A gap as a lesson for the brain that can close it (English for its prompt) and a Turkish line for the report. */
export function gapLesson(g: MeasureGap): { readonly beyin: BrainId; readonly metin: string; readonly tr: string } {
  const over = g.fark > 0;
  switch (g.olcu) {
    case "kelimeDk":
      return { beyin: "kurgu", metin: `Our episode spoke ${Math.round(g.biz)} words/min against the references' ${Math.round(g.hedef)}: ${over ? "leave room — fewer words per line, more pauses for gags and action" : "tell more per scene — denser lines, fewer empty seconds between them"}.`, tr: `Konuşma hızı ${Math.round(g.biz)} kelime/dk, referanslar ${Math.round(g.hedef)}` };
    case "sozDegisimiDk":
      return { beyin: "kurgu", metin: `Speakers changed ${g.biz} times/min against the references' ${g.hedef}: ${over ? "let a speaker finish a thought before the next one cuts in" : "break long narrator stretches with short character replies"}.`, tr: `Konuşmacı değişimi dakikada ${g.biz}, referanslar ${g.hedef}` };
    case "kesmeDk":
      return { beyin: "kalite", metin: `The picture changed ${g.biz} times/min against the references' ${g.hedef}: ${over ? "hold shots longer so the viewer can read them" : "change the picture more often — cut to a close map, a picture or another set as the story moves"}.`, tr: `Görüntü değişimi dakikada ${g.biz}, referanslar ${g.hedef}` };
    case "ilkSozSn":
      return { beyin: "kurgu", metin: `The first words came at ${g.biz} s against the references' ${g.hedef} s: open with a voice at once, the title can wait.`, tr: `İlk söz ${g.biz} sn'de, referanslar ${g.hedef} sn` };
  }
}

/**
 * A study request (the owner's link through AYAS's chat): the live server only writes it, the order watcher's idle
 * loop studies it (`<workRoot>/_kutuphane/referanslar/istekler/<stamp>-<id>.json`), like a production order.
 */
export interface StudyRequest {
  readonly id: string;
  readonly url: string;
  readonly kaynak: string;
  readonly tarih: string;
  durum: "bekliyor" | "tamam" | "hata";
  sonuc?: string;
}

export function studyRequestDir(workRoot: string): string {
  return path.join(referenceDir(workRoot), "istekler");
}

export async function placeStudyRequest(workRoot: string, url: string, kaynak: string, now = new Date()): Promise<StudyRequest> {
  const id = youtubeId(url);
  if (!id) throw new Error("REFERENCE_NOT_YOUTUBE: yalnız YouTube bağlantıları incelenir");
  const dir = studyRequestDir(workRoot);
  await fs.mkdir(dir, { recursive: true });
  const request: StudyRequest = { id, url: `https://www.youtube.com/watch?v=${id}`, kaynak, tarih: now.toISOString(), durum: "bekliyor" };
  await fs.writeFile(path.join(dir, `${now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "")}-${id}.json`), `${JSON.stringify(request, null, 2)}\n`);
  return request;
}

export async function listStudyRequests(workRoot: string): Promise<{ file: string; request: StudyRequest }[]> {
  const dir = studyRequestDir(workRoot);
  if (!existsSync(dir)) return [];
  const out: { file: string; request: StudyRequest }[] = [];
  for (const n of (await fs.readdir(dir)).filter((x) => x.endsWith(".json")).sort()) {
    try {
      out.push({ file: path.join(dir, n), request: JSON.parse(await fs.readFile(path.join(dir, n), "utf8")) as StudyRequest });
    } catch {
      // Read on the next pass.
    }
  }
  return out;
}

export async function saveStudyRequest(file: string, request: StudyRequest): Promise<void> {
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(request, null, 2)}\n`);
  await fs.rename(`${file}.tmp`, file);
}

/** A YouTube watch/shorts/youtu.be link's video id, or undefined (only YouTube is studied). */
export function youtubeId(url: string): string | undefined {
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url.trim());
  return m?.[1] ?? (/^[A-Za-z0-9_-]{11}$/.test(url.trim()) ? url.trim() : undefined);
}

export interface SearchHit {
  readonly id: string;
  readonly baslik: string;
  readonly kanal: string;
  readonly kanalId: string;
  readonly sureSn: number;
  readonly izlenme: number;
}

/**
 * The best search hit to study for a production of `targetS` seconds: of the same kind (Short or long), not our own
 * channel, not studied before, the most watched.
 */
export function pickSimilar(hits: readonly SearchHit[], targetS: number, opts: { readonly ownChannelId?: string; readonly studied: ReadonlySet<string> }): SearchHit | undefined {
  const kind = kindOf(targetS);
  return hits
    .filter((h) => h.sureSn > 0 && kindOf(h.sureSn) === kind && h.sureSn <= 45 * 60 && !opts.studied.has(h.id) && (!opts.ownChannelId || h.kanalId !== opts.ownChannelId))
    .sort((a, b) => b.izlenme - a.izlenme)[0];
}
