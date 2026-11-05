import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { AIProvider } from "../../ai/providers/AIProvider";
import type { V3Budget, V3ModelChoice } from "../script/V3Budget";
import { runChecked, runProcess } from "../util/Proc";
import type { V3Paths } from "../V3Paths";
import { forgetSource, hasSimilarLesson, remember } from "./ExperienceMemory";
import { type Caption, cutMeasures, FRAME_KINDS_REF, FRAME_NOTE_PROMPT, type FrameNote, frameShares, measuresLine, parseFrameNote, parseJson3, parseStudy, pickCaptionTrack, type ReferenceRecord, referenceDir, sampleTimes, type SearchHit, speechMeasures, STUDY_BRAINS, studyPrompt, transcriptExcerpt, type VideoMeasures } from "./ReferenceStore";

/**
 * Learning from similar videos — the download and the study (yt-dlp, ffmpeg, the eye, the text model). The measures,
 * records and requests are ReferenceStore.ts, re-exported here for the scripts.
 */
export * from "./ReferenceStore";

/** The ffmpeg scene-change threshold (Sancaray's 17 minutes: 0.15 → 117 cuts, 0.25 → 63, 0.3 → 52; 0.25 drops pans). */
export const CUT_THRESHOLD = 0.25;

/** The times of the picture cuts of a video (ffmpeg's scene score on a 320 px copy; a few seconds per minute of video). */
export async function detectCuts(ffmpeg: string, video: string): Promise<number[]> {
  const r = await runProcess(ffmpeg, ["-hide_banner", "-nostats", "-i", video, "-an", "-vf", `scale=320:-2,select='gt(scene,${CUT_THRESHOLD})',showinfo`, "-f", "null", "-"], { timeoutMs: 30 * 60_000 });
  if (r.code !== 0) throw new Error(`REFERENCE_CUTS_FAILED: ${r.stderr.slice(-300)}`);
  return [...r.stderr.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1]));
}

/** The python of the tools' own yt-dlp environment (outside git; `ATOLYE_V3_YTDLP_PYTHON` overrides). */
export function ytDlpPython(paths: Pick<V3Paths, "toolsRoot">): string {
  return process.env.ATOLYE_V3_YTDLP_PYTHON?.trim() || path.join(paths.toolsRoot, "yt-venv", "Scripts", "python.exe");
}

const YTDLP_BASE = ["-m", "yt_dlp", "--js-runtimes", "node", "--no-progress", "--no-warnings", "--no-playlist"];

/**
 * yt-dlp's `--dump-single-json` lists every automatic-caption translation URL: 10.4 MB for a 2-minute Short on
 * 2026-11-05 ("RECAP: First Punic War", 9.8 MB of it captions). Under the process helper's default 2 MB cap the JSON
 * was cut and every such link the owner sent failed as "Unterminated string in JSON at position 2097152".
 */
export const YTDLP_JSON_MAX_BYTES = 64 * 1024 * 1024;

/** Runs a yt-dlp command whose stdout is one JSON document and parses it; a cut document is a clear error, not a JSON one. */
async function ytDlpJson<T>(py: string, args: readonly string[], timeoutMs: number): Promise<T> {
  const r = await runChecked(py, args, { timeoutMs, maxOutputBytes: YTDLP_JSON_MAX_BYTES });
  if (r.truncated) throw new Error(`REFERENCE_INFO_TOO_LARGE: yt-dlp bilgisi ${Math.round(YTDLP_JSON_MAX_BYTES / 1024 / 1024)} MB sınırını aştı`);
  return JSON.parse(r.stdout) as T;
}

/** YouTube search results (metadata only, nothing downloaded). */
export async function searchVideos(paths: Pick<V3Paths, "toolsRoot">, query: string, n = 8): Promise<SearchHit[]> {
  const entries = (await ytDlpJson<{ entries?: Record<string, unknown>[] }>(ytDlpPython(paths), [...YTDLP_BASE, "--flat-playlist", "--dump-single-json", `ytsearch${n}:${query}`], 120_000)).entries ?? [];
  return entries.flatMap((e) => (typeof e.id === "string" ? [{ id: e.id, baslik: String(e.title ?? ""), kanal: String(e.channel ?? e.uploader ?? ""), kanalId: String(e.channel_id ?? ""), sureSn: Number(e.duration) || 0, izlenme: Number(e.view_count) || 0 }] : []));
}

export interface FetchedReference {
  readonly id: string;
  readonly baslik: string;
  readonly kanal: string;
  readonly dil: string;
  readonly sureSn: number;
  readonly video?: string;
  readonly captions: readonly Caption[];
}

/**
 * Downloads what a study needs into `dir`: the metadata, the captions in the video's own language (manual first, else
 * automatic; a translated track is never asked for — YouTube answers 429), and a 360p picture without sound.
 */
export async function fetchReference(paths: Pick<V3Paths, "toolsRoot">, id: string, dir: string, log: (s: string) => void = () => {}): Promise<FetchedReference> {
  await fs.mkdir(dir, { recursive: true });
  const py = ytDlpPython(paths);
  if (!existsSync(py)) throw new Error(`REFERENCE_YTDLP_MISSING: ${py}`);
  const url = `https://www.youtube.com/watch?v=${id}`;
  const info = await ytDlpJson<Record<string, unknown>>(py, [...YTDLP_BASE, "--skip-download", "--dump-single-json", url], 180_000);
  const lang = typeof info.language === "string" && info.language ? info.language : "";
  const picked = pickCaptionTrack(info);
  const track = picked?.track;
  const manual = picked?.manual ? picked.track : undefined;
  let captions: Caption[] = [];
  if (track) {
    await runProcess(py, [...YTDLP_BASE, "--skip-download", manual ? "--write-subs" : "--write-auto-subs", "--sub-langs", track, "--sub-format", "json3", "-o", path.join(dir, "ref.%(ext)s"), url], { timeoutMs: 180_000 });
    const file = (await fs.readdir(dir)).find((n) => n.endsWith(".json3"));
    if (file) captions = parseJson3(JSON.parse(await fs.readFile(path.join(dir, file), "utf8")));
    log(`  altyazı: ${track} (${manual ? "elle yazılmış" : "otomatik"}), ${captions.length} satır`);
  } else log("  altyazı yok");
  const v = await runProcess(py, [...YTDLP_BASE, "-f", "bv*[height<=360][ext=mp4]/bv*[height<=360]/wv*", "-o", path.join(dir, "ref.video.%(ext)s"), url], { timeoutMs: 20 * 60_000 });
  const video = (await fs.readdir(dir)).find((n) => n.startsWith("ref.video."));
  if (!video) log(`  görüntü indirilemedi: ${v.stderr.slice(-200)}`);
  return { id, baslik: String(info.title ?? id), kanal: String(info.channel ?? info.uploader ?? ""), dil: (manual ?? track ?? lang).replace(/-orig$/, ""), sureSn: Number(info.duration) || 0, ...(video ? { video: path.join(dir, video) } : {}), captions };
}

/**
 * Studies one reference end to end and keeps only what was learned: measures, frame notes, lessons (written into each
 * brain's memory as "ders" lessons). The downloaded files are deleted whatever happens.
 */
export async function studyReference(input: {
  readonly paths: Pick<V3Paths, "toolsRoot" | "workRoot" | "ffmpeg" | "asciiTemp">;
  readonly id: string;
  readonly neden: string;
  readonly eye?: AIProvider;
  readonly budget: V3Budget;
  readonly model: V3ModelChoice;
  readonly frames?: number;
  readonly log?: (s: string) => void;
}): Promise<ReferenceRecord> {
  const log = input.log ?? (() => {});
  const dir = path.join(input.paths.asciiTemp, `referans-${input.id}-${Date.now()}`);
  const eksik: string[] = [];
  try {
    const ref = await fetchReference(input.paths, input.id, dir, log);
    const durationS = ref.sureSn;
    if (!durationS) throw new Error("REFERENCE_NO_DURATION");
    let cuts: number[] = [];
    if (ref.video) cuts = await detectCuts(input.paths.ffmpeg, ref.video);
    else eksik.push("görüntü indirilemedi: kesme ölçülmedi, kare yok");
    if (!ref.captions.length) eksik.push("altyazı yok: konuşma ölçülmedi");
    const notes: FrameNote[] = [];
    if (ref.video && input.eye) {
      for (const t of sampleTimes(durationS, input.frames ?? 12)) {
        const jpg = path.join(dir, `kare-${Math.round(t * 10)}.jpg`);
        await runChecked(input.paths.ffmpeg, ["-v", "error", "-y", "-ss", t.toFixed(2), "-i", ref.video, "-frames:v", "1", "-q:v", "4", jpg]);
        const out = await input.eye.generate(FRAME_NOTE_PROMPT, { images: [(await fs.readFile(jpg)).toString("base64")], maxTokens: 160, jsonSchema: { type: "object", properties: { tur: { type: "string", enum: [...FRAME_KINDS_REF] }, kisi: { type: "integer" }, tarif: { type: "string" } }, required: ["tur", "kisi", "tarif"] } }).catch((e: Error) => (log(`  kare ${t} sn okunamadı: ${e.message.slice(0, 100)}`), undefined));
        const note = out ? parseFrameNote(t, typeof out === "string" ? out : out.content) : undefined;
        if (note) notes.push(note);
      }
      log(`  kareler: ${notes.length} kare incelendi`);
    } else if (ref.video) eksik.push("göz (görüntü modeli) yok: kareler incelenmedi");
    const olcum: VideoMeasures = { sureSn: durationS, ...speechMeasures(ref.captions, durationS), ...cutMeasures(cuts, durationS), ...(notes.length ? { kareler: frameShares(notes) } : {}) };
    log(`  ölçüm: ${measuresLine(olcum)}`);
    const prompt = studyPrompt({ baslik: ref.baslik, kanal: ref.kanal, dil: ref.dil, measures: olcum, frames: notes, transcript: transcriptExcerpt(ref.captions) });
    const out = await input.budget.generate("referans-inceleme", input.model, prompt, { maxTokens: 1_800 });
    const study = parseStudy(out.result.content);
    if (!study) eksik.push("ders çıkarılamadı (okunamayan yanıt)");
    const record: ReferenceRecord = { id: ref.id, url: `https://www.youtube.com/watch?v=${ref.id}`, baslik: ref.baslik, kanal: ref.kanal, dil: ref.dil, tarih: new Date().toISOString(), neden: input.neden, olcum, kareler: notes, ozet: study?.ozet ?? "", dersler: study?.dersler ?? [], eksik };
    // A video studied again replaces what it taught before.
    if (record.dersler.length) for (const b of STUDY_BRAINS) await forgetSource(input.paths.workRoot, b, `referans ${ref.id}`);
    // A technique another single video already taught is kept in the record but not written twice; one found only in
    // a consolidated summary is written, so the next consolidation counts one more video for it.
    for (const d of record.dersler) {
      if (await hasSimilarLesson(input.paths.workRoot, d.beyin, d.metin, 0.6, (l) => l.bolum.startsWith("referans "))) continue;
      await remember(input.paths.workRoot, { bolum: `referans ${ref.id}`, beyin: d.beyin, tur: "ders", konu: `referans: ${ref.baslik.slice(0, 80)}`, metin: d.metin });
    }
    const store = referenceDir(input.paths.workRoot);
    await fs.mkdir(store, { recursive: true });
    await fs.writeFile(path.join(store, `${ref.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
