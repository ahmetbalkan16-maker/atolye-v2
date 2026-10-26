import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { MusicMood, MusicTrack } from "../../audio/music/MusicLibrary";
import { periodEndYear } from "../backgrounds/HistorySources";
import type { Episode } from "../episode/EpisodeTypes";
import { sideProcessEnv } from "../tts/Tts";
import { GPU_PAUSE_C, GPU_START_C, unloadOllama, waitForCoolGpu } from "../util/Gpu";
import { runChecked } from "../util/Proc";
import { PythonLineServer } from "../util/PythonLineServer";
import type { V3Paths } from "../V3Paths";
import type { MusicSegment } from "./Mixer";

/**
 * The composer (Besteci; owner approval 20 Oct 2026, "integrated, usable without Claude or Codex, reliable"): every
 * music bed of an episode is an original instrumental piece made locally with ACE-Step 1.5 (MIT, 2B turbo, on the
 * 12 GB card) for the episode's period and the scene's mood, exactly as long as its scenes. A piece is kept in an
 * append-only library (`<workRoot>/_kutuphane/muzik/<hash>.wav` + `.json`), so the same request is never composed
 * twice. Each piece is checked (length, silence, level); a piece that fails, or a composer that is not installed or
 * breaks, leaves that bed to the CC BY library track it had — the video is always finished.
 */
export const ACESTEP_MODEL_ID = "ACE-Step/Ace-Step1.5@acestep-v15-turbo";

/**
 * Timestep shift for the turbo model: ACE-Step's docs ask for 3.0 ("the only parameter you need to set manually for
 * turbo"); the default 1.0 composed every bed until 26 Oct 2026. Same Kosovo caption and seed: 40 fixed whine lines
 * at 1.0, 13 at 3.0 (the Heun sampler made it 25).
 */
export const TURBO_SHIFT = 3;

/** What the bed should sound like, by music bucket (the reference channel's playful, cinematic underscore). */
const MOOD_WORDS: Readonly<Record<MusicMood, string>> = {
  epic: "heroic and triumphant, bold brass fanfare, big war drums, full orchestra",
  dramatic: "dramatic and building, sweeping strings, timpani rolls",
  tense: "tense and suspenseful, low ostinato strings, ticking percussion, ominous horns",
  calm: "calm and reflective, slow, warm soft strings, gentle harp",
  historical: "stately and curious documentary underscore, light strings and woodwinds, steady pace",
  comedic: "playful and comedic, bouncy pizzicato strings, bassoon and clarinet, light percussion, cartoon timing",
};

/** Instruments a listener hears as the period (by the episode's end year; the place refines it). */
export function periodInstruments(episode: Pick<Episode, "donem" | "konu">): string {
  const year = periodEndYear(episode.donem);
  const text = episode.konu.toLowerCase();
  if (/ottoman|osmanl|sultan|istanbul|constantinople|janissar|yeniçeri/.test(text)) return "Ottoman instruments: ney flute, oud, kanun, zurna and davul drums";
  if (year === undefined) return "orchestral instruments";
  if (year < 500) return /egypt|pharaoh|mısır/.test(text) ? "ancient Egyptian colour: harp, frame drums, reed flute" : "ancient Mediterranean colour: lyre, aulos reed pipe, frame drums, horns";
  if (year < 1450) return "medieval colour: lute, recorder, hurdy-gurdy, tabor drum, plainchant-like melody";
  if (year < 1750) return "renaissance and baroque colour: harpsichord, viols, recorder, natural trumpets";
  if (year < 1900) return "nineteenth-century orchestra with brass band colour";
  return "modern cinematic orchestra";
}

export interface CompositionRequest {
  readonly mood: MusicMood;
  /** Length of the piece, in seconds (the bed's scenes plus the crossfade). */
  readonly seconds: number;
  readonly caption: string;
  readonly seed: number;
}

/** The text the composer gets: instrumental underscore, period colour, mood; never vocals. */
export function compositionCaption(episode: Pick<Episode, "donem" | "konu">, mood: MusicMood): string {
  return `Instrumental underscore for an animated history cartoon set in ${episode.donem}. ${MOOD_WORDS[mood]}; ${periodInstruments(episode)}. No vocals, no singing, no lyrics, clean mix, loopable.`;
}

/** Library key of a request (model, shift, caption, length to the second, seed): a shift-1.0 piece is never reused. */
export function compositionKey(req: CompositionRequest): string {
  return createHash("sha256").update(JSON.stringify({ v: 2, model: ACESTEP_MODEL_ID, shift: TURBO_SHIFT, caption: req.caption, seconds: Math.round(req.seconds), seed: req.seed })).digest("hex").slice(0, 24);
}

export interface PieceStats {
  readonly durationS: number;
  readonly meanDb: number;
  readonly peakDb: number;
  /** Longest stretch quieter than −50 dB. */
  readonly longestSilenceS: number;
}

/**
 * Why a composed piece cannot be used (empty when it can). Measured after its silent head and tail are cut; a bed
 * loops in the mixer, so a piece down to 60% of the bed (at least 8 s) is fine.
 */
export function pieceProblems(s: PieceStats, wantS: number): string[] {
  const out: string[] = [];
  if (s.durationS < Math.max(8, wantS * 0.6) || s.durationS > wantS * 1.2 + 2) out.push(`süre ${s.durationS.toFixed(1)} sn (istenen ${wantS.toFixed(1)})`);
  if (s.meanDb < -40) out.push(`çok sessiz (ortalama ${s.meanDb.toFixed(1)} dB)`);
  if (s.peakDb > -0.1) out.push(`tepe ${s.peakDb.toFixed(1)} dB (kırpılmış olabilir)`);
  if (s.longestSilenceS > 3) out.push(`${s.longestSilenceS.toFixed(1)} sn sessizlik`);
  return out;
}

/** Length, loudness and the longest silence of an audio file, measured with FFmpeg. */
export async function measurePiece(paths: V3Paths, file: string): Promise<PieceStats> {
  const r = await runChecked(paths.ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-af", "volumedetect,silencedetect=noise=-50dB:d=0.5", "-f", "null", "-"]);
  const log = `${r.stdout}\n${r.stderr}`;
  const num = (re: RegExp) => Number(re.exec(log)?.[1] ?? NaN);
  const silences = [...log.matchAll(/silence_duration:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const probe = await runChecked(paths.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return { durationS: Number(probe.stdout.trim()), meanDb: num(/mean_volume:\s*(-?[\d.]+) dB/), peakDb: num(/max_volume:\s*(-?[\d.]+) dB/), longestSilenceS: Math.max(0, ...silences) };
}

export class MusicComposer {
  private server?: PythonLineServer;
  /** Set when the side process could not start: every later bed goes straight to the library (no retry loop). */
  private broken?: string;
  private failures = 0;
  readonly libraryDir: string;

  constructor(private readonly paths: V3Paths, private readonly log: (s: string) => void = () => {}) {
    this.libraryDir = path.join(paths.workRoot, "_kutuphane", "muzik");
  }

  /** The composer is installed: its environment and the turbo checkpoint are on disk. */
  available(): boolean {
    return existsSync(this.python()) && existsSync(path.join(this.paths.acestepRoot, "checkpoints", "atolye-manifest.json"));
  }

  private python(): string {
    return path.join(this.paths.acestepRoot, ".venv", "Scripts", "python.exe");
  }

  fileFor(req: CompositionRequest): string {
    return path.join(this.libraryDir, `${compositionKey(req)}.wav`);
  }

  /** A checked piece for the request (from the library when made before), or the reasons it could not be made. */
  async compose(req: CompositionRequest): Promise<{ file: string; cached: boolean } | { problems: string[] }> {
    const file = this.fileFor(req);
    if (existsSync(file)) return { file, cached: true };
    if (this.broken) return { problems: [this.broken] };
    await fs.mkdir(this.libraryDir, { recursive: true });
    await fs.mkdir(this.paths.asciiTemp, { recursive: true });
    if (!this.server) {
      // The 12 GB card holds one big model: Ollama (the judge, AYAS chat) is unloaded first.
      await unloadOllama(this.log, "besteci için RAM ve ekran kartı");
      this.server = new PythonLineServer({
        python: this.python(),
        script: path.join(this.paths.repoRoot, "scripts", "v3", "acestep_server.py"),
        env: { ...sideProcessEnv(this.paths), ATOLYE_V3_ACESTEP_ROOT: this.paths.acestepRoot, PYTORCH_CUDA_ALLOC_CONF: "expandable_segments:True" },
        label: "ACE-Step",
        cwd: this.paths.acestepRoot,
        startTimeoutMs: 15 * 60_000,
        requestTimeoutMs: 30 * 60_000,
        log: this.log,
      });
    }
    await waitForCoolGpu(this.log);
    const tmp = path.join(this.paths.asciiTemp, `muzik-${path.basename(file)}`);
    let r: Awaited<ReturnType<PythonLineServer["request"]>>;
    try {
      r = await this.server.request({ caption: req.caption, duration: Math.round(req.seconds), seed: req.seed, shift: TURBO_SHIFT, out: tmp, max_temp: GPU_PAUSE_C, resume_below: GPU_START_C });
    } catch (e) {
      this.broken = `besteci başlatılamadı: ${(e as Error).message.slice(0, 160)}`;
      await this.close();
      return { problems: [this.broken] };
    }
    if (!r.ok) {
      const why = `besteci hata verdi: ${String(r.error ?? "bilinmeyen").slice(0, 160)}`;
      // Two failed pieces in a row: the rest of the episode keeps its library tracks rather than retrying each bed.
      if (++this.failures >= 2) {
        this.broken = why;
        await this.close();
      }
      return { problems: [why] };
    }
    this.failures = 0;
    // The composer may open or close on silence (the first Rubicon test piece had 3.8 s of it): head and tail are cut,
    // so only a silence inside the piece counts and the mixer's loop has no gap.
    const raw = `${tmp}.ham.wav`;
    await fs.rename(tmp, raw);
    const edge = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.1";
    await runChecked(this.paths.ffmpeg, ["-v", "error", "-y", "-i", raw, "-af", `${edge},areverse,${edge},areverse`, tmp]);
    const stats = await measurePiece(this.paths, tmp);
    const problems = pieceProblems(stats, req.seconds);
    if (problems.length) {
      // Kept for a look (append-only), never used.
      const rejected = path.join(this.libraryDir, "reddedilen", path.basename(file));
      await fs.mkdir(path.dirname(rejected), { recursive: true });
      if (!existsSync(rejected)) await fs.copyFile(raw, rejected);
      await fs.writeFile(rejected.replace(/\.wav$/, ".json"), `${JSON.stringify({ ...req, stats, problems, created: new Date().toISOString() }, null, 2)}\n`);
      await fs.rm(tmp, { force: true });
      await fs.rm(raw, { force: true });
      return { problems };
    }
    await fs.rm(raw, { force: true });
    // Append-only: copy, never overwrite.
    if (!existsSync(file)) await fs.copyFile(tmp, file);
    await fs.rm(tmp, { force: true });
    const meta = { model: ACESTEP_MODEL_ID, shift: TURBO_SHIFT, ...req, stats, seconds_taken: r.seconds, created: new Date().toISOString(), license: "MIT (ACE-Step 1.5); the piece is Atölye's own local composition", paidCalls: 0 };
    await fs.writeFile(file.replace(/\.wav$/, ".json"), `${JSON.stringify(meta, null, 2)}\n`);
    this.log(`  müzik bestelendi (${r.seconds} sn, ${req.mood}, ${Math.round(req.seconds)} sn): ${path.basename(file)}`);
    return { file, cached: false };
  }

  /** Ends the ACE-Step process so the vision judge gets the card back. */
  async close(): Promise<void> {
    await this.server?.close();
    this.server = undefined;
  }
}

/** The library track an original piece stands in for. */
export function composedTrack(file: string, mood: MusicMood): MusicTrack {
  return {
    mood,
    absolutePath: file,
    fileName: path.basename(file),
    title: `Atölye V3 özgün müzik (${mood})`,
    source: "ACE-Step 1.5, yerel üretim",
    sourceUrl: "https://github.com/ace-step/ACE-Step-1.5",
    license: "MIT (model); parça Atölye'nin kendi üretimi",
    attribution: "Original music composed locally with ACE-Step 1.5 (MIT)",
  };
}

/**
 * Composes every bed of the plan; a bed whose piece fails keeps its library track. Seeds follow the episode and the
 * bed, so a rerun asks for the same pieces (and gets them from the library).
 */
export async function composeBeds(
  segments: readonly MusicSegment[],
  episode: Pick<Episode, "id" | "donem" | "konu">,
  composer: Pick<MusicComposer, "compose">,
  log: (s: string) => void,
): Promise<{ segments: MusicSegment[]; report: string[] }> {
  const report: string[] = [];
  const out: MusicSegment[] = [];
  for (const [i, seg] of segments.entries()) {
    const seed = parseInt(createHash("sha256").update(`${episode.id}#${i}#${seg.mood}`).digest("hex").slice(0, 8), 16) % 1_000_000;
    const req: CompositionRequest = { mood: seg.mood, seconds: seg.end - seg.start + 2, caption: compositionCaption(episode, seg.mood), seed };
    const got = await composer.compose(req).catch((e: Error) => ({ problems: [`besteci çalışmadı: ${e.message.slice(0, 160)}`] }));
    if ("file" in got) {
      out.push({ ...seg, track: composedTrack(got.file, seg.mood) });
      report.push(`yatak ${i + 1} (${seg.mood}): özgün müzik${got.cached ? " (kütüphaneden)" : ""}`);
    } else {
      out.push(seg);
      report.push(`yatak ${i + 1} (${seg.mood}): kütüphane parçası kaldı — ${got.problems.join("; ")}`);
      log(`  ⚠ müzik yatağı ${i + 1}: ${got.problems.join("; ")} — kütüphane parçası kullanılıyor`);
    }
  }
  return { segments: out, report };
}
