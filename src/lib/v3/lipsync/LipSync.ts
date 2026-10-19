import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { V3Viseme } from "../render/RenderPlanTypes";
import type { LineAudio } from "../timeline/Timeline";
import { runChecked } from "../util/Proc";
import type { V3Paths } from "../V3Paths";

/**
 * Mouth shapes and word timings for spoken lines. Mouths come from Rhubarb Lip Sync (phonetic recogniser for
 * Turkish, PocketSphinx with the known text for English) and fall back to an RMS loudness envelope; word timings
 * come from whisper.cpp and are mapped onto the script's own words, so a mis-heard word never reaches a caption.
 * Rhubarb and whisper.cpp cannot open non-ASCII paths on Windows, so audio is staged in the ASCII temp folder.
 */
export type LipSyncLanguage = "tr" | "en";

export interface LineToAnalyze {
  /** 16-bit PCM WAV (the TTS output). */
  readonly wav: string;
  readonly text: string;
  readonly language: LipSyncLanguage;
}

export type LineSync = Pick<LineAudio, "visemes" | "words" | "lipSync">;

type Cue = { readonly t: number; readonly v: V3Viseme };
type Word = { readonly text: string; readonly start: number; readonly end: number };

const VISEMES = new Set<V3Viseme>(["A", "B", "C", "D", "E", "F", "G", "H", "X"]);

/** Rhubarb JSON (`-f json`) → cues. */
export function parseRhubarb(json: unknown): Cue[] {
  const cues = (json as { mouthCues?: { start?: unknown; value?: unknown }[] })?.mouthCues;
  if (!Array.isArray(cues)) throw new Error("LIPSYNC_RHUBARB_SHAPE: mouthCues yok");
  return cues.filter((c) => typeof c.start === "number" && VISEMES.has(c.value as V3Viseme)).map((c) => ({ t: c.start as number, v: c.value as V3Viseme }));
}

/** Mono samples (-1..1) and rate from a 16-bit PCM WAV; multi-channel input is mixed down. */
export function readWavPcm16(buf: Buffer): { samples: Float32Array; sampleRate: number } {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("LIPSYNC_WAV: RIFF/WAVE değil");
  let off = 12, channels = 1, sampleRate = 0, bits = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (bits !== 16) throw new Error(`LIPSYNC_WAV: 16 bit bekleniyor (${bits})`);
      const frames = Math.floor(Math.min(size, buf.length - body) / (2 * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) s += buf.readInt16LE(body + (i * channels + c) * 2);
        samples[i] = s / channels / 32768;
      }
      return { samples, sampleRate };
    }
    off = body + size + (size % 2);
  }
  throw new Error("LIPSYNC_WAV: data bölümü yok");
}

/**
 * Loudness → mouth: 1/30 s windows, levels relative to the line's loud parts, and every shape held at least two
 * windows so the mouth never flickers. Used when Rhubarb fails.
 */
export function rmsVisemes(samples: Float32Array, sampleRate: number): Cue[] {
  const win = Math.max(1, Math.round(sampleRate / 30));
  const levels: number[] = [];
  for (let i = 0; i < samples.length; i += win) {
    let sum = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) sum += samples[j]! * samples[j]!;
    levels.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const shape = (l: number): V3Viseme => (loud <= 1e-4 || l < loud * 0.08 ? "X" : l < loud * 0.25 ? "B" : l < loud * 0.5 ? "C" : "D");
  const cues: Cue[] = [];
  let held = 0;
  levels.forEach((l, i) => {
    const v = shape(l);
    const last = cues[cues.length - 1];
    if (!last || (last.v !== v && held >= 2)) {
      cues.push({ t: (i * win) / sampleRate, v });
      held = 1;
    } else held++;
  });
  return cues;
}

/** whisper.cpp `-ml 1 -sow -oj` output → words with seconds. */
export function parseWhisperWords(json: unknown): Word[] {
  const segs = (json as { transcription?: { offsets?: { from?: number; to?: number }; text?: string }[] })?.transcription;
  if (!Array.isArray(segs)) return [];
  return segs
    .map((s) => ({ text: (s.text ?? "").trim(), start: (s.offsets?.from ?? 0) / 1000, end: (s.offsets?.to ?? 0) / 1000 }))
    .filter((w) => /[\p{L}\p{N}]/u.test(w.text));
}

/**
 * The script's words timed by what whisper heard: one-to-one when the counts agree, otherwise spread over the
 * heard speech span in proportion to word length. Captions always show the script's text.
 */
export function alignWords(text: string, heard: readonly Word[], duration: number): Word[] {
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) return [];
  if (heard.length === words.length) return words.map((w, i) => ({ text: w, start: heard[i]!.start, end: heard[i]!.end }));
  const from = heard[0]?.start ?? 0;
  const to = heard[heard.length - 1]?.end ?? duration;
  const span = Math.max(0.1, to - from);
  const total = words.reduce((s, w) => s + w.length + 1, 0);
  let acc = 0;
  return words.map((w) => {
    const start = from + (acc / total) * span;
    acc += w.length + 1;
    return { text: w, start, end: from + (acc / total) * span };
  });
}

async function sha(file: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(file)).digest("hex").slice(0, 24);
}

/** Analyses lines in one batch (whisper loads its model once); results are cached by audio hash and text. */
export async function analyzeLines(paths: V3Paths, lines: readonly LineToAnalyze[], log: (s: string) => void = () => {}): Promise<LineSync[]> {
  const cacheDir = path.join(paths.workRoot, "_onbellek", "lipsync");
  const stage = path.join(paths.asciiTemp, "lipsync");
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(stage, { recursive: true });
  const keys = await Promise.all(lines.map(async (l) => createHash("sha256").update(JSON.stringify({ v: 1, a: await sha(l.wav), t: l.text, l: l.language })).digest("hex").slice(0, 32)));
  const out: (LineSync | undefined)[] = await Promise.all(keys.map(async (k) => (existsSync(path.join(cacheDir, `${k}.json`)) ? (JSON.parse(await fs.readFile(path.join(cacheDir, `${k}.json`), "utf8")) as LineSync) : undefined)));
  const todo = lines.map((l, i) => ({ l, i, k: keys[i]! })).filter((x) => !out[x.i]);
  if (todo.length === 0) return out as LineSync[];

  // Stage: 16 kHz mono for whisper, the original WAV for Rhubarb, the text for its dialog hint.
  for (const { l, k } of todo) {
    await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-i", l.wav, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", path.join(stage, `${k}-16k.wav`)]);
    await fs.copyFile(l.wav, path.join(stage, `${k}.wav`));
    await fs.writeFile(path.join(stage, `${k}.txt`), l.text, "utf8");
  }

  // Word timings: one whisper run per language.
  const heard = new Map<string, Word[]>();
  for (const language of ["tr", "en"] as const) {
    const batch = todo.filter((x) => x.l.language === language);
    if (batch.length === 0) continue;
    const args = ["-m", paths.whisperModel, "-l", language, "-ml", "1", "-sow", "-oj", "-np", ...batch.flatMap((x) => ["-f", path.join(stage, `${x.k}-16k.wav`)])];
    try {
      await runChecked(paths.whisperExe, args, { timeoutMs: 15 * 60_000 });
      for (const x of batch) {
        const file = path.join(stage, `${x.k}-16k.wav.json`);
        heard.set(x.k, existsSync(file) ? parseWhisperWords(JSON.parse(await fs.readFile(file, "utf8"))) : []);
      }
    } catch (e) {
      log(`whisper başarısız, kelimeler orantılı dağıtılacak: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  for (const { l, i, k } of todo) {
    const wav = readWavPcm16(await fs.readFile(l.wav));
    const duration = wav.samples.length / wav.sampleRate;
    let visemes: Cue[];
    let lipSync: LineSync["lipSync"] = "rhubarb";
    try {
      const json = path.join(stage, `${k}-rhubarb.json`);
      const recognizer = l.language === "en" ? ["-r", "pocketSphinx", "-d", path.join(stage, `${k}.txt`)] : ["-r", "phonetic"];
      await runChecked(paths.rhubarbExe, [...recognizer, "-f", "json", "--extendedShapes", "GHX", "-q", "-o", json, path.join(stage, `${k}.wav`)], { timeoutMs: 5 * 60_000 });
      visemes = parseRhubarb(JSON.parse(await fs.readFile(json, "utf8")));
      if (visemes.length === 0) throw new Error("boş");
    } catch (e) {
      log(`Rhubarb başarısız (${path.basename(l.wav)}), RMS yedeği: ${(e as Error).message.slice(0, 160)}`);
      visemes = rmsVisemes(wav.samples, wav.sampleRate);
      lipSync = "rms";
    }
    const sync: LineSync = { visemes, words: alignWords(l.text, heard.get(k) ?? [], duration), lipSync };
    await fs.writeFile(path.join(cacheDir, `${k}.json`), JSON.stringify(sync));
    out[i] = sync;
  }
  await fs.rm(stage, { recursive: true, force: true });
  return out as LineSync[];
}

/** First moment the mouth opens (any shape but closed/rest), in seconds; for drift checks against loudness. */
export function firstOpen(cues: readonly Cue[]): number | undefined {
  return cues.find((c) => c.v !== "X" && c.v !== "A")?.t;
}
