import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { V3Emotion } from "../render/RenderPlanTypes";
import { runChecked, runProcess } from "../util/Proc";
import type { V3Paths } from "../V3Paths";
import { normalizeEnglishForSpeech } from "./EnglishText";
import { type Lexicon, normalizeForSpeech } from "./TurkishText";

export type TtsProviderId = "chatterbox" | "piper";

export interface VoiceProfile {
  readonly saglayici: TtsProviderId;
  /** Reference clip id (`<voiceRefRoot>/<id>.wav`) for cloning engines. */
  readonly referans?: string;
  /** Semitones applied after synthesis. */
  readonly perde: number;
  /** Tempo factor applied after synthesis (1 = unchanged). */
  readonly hiz: number;
  readonly exaggeration: number;
  readonly cfg: number;
  readonly sicaklik: number;
  /** Light vibrato for an older voice. */
  readonly titreme?: boolean;
  readonly not?: string;
}

export interface VoiceMap {
  readonly varsayilan_saglayici: TtsProviderId;
  readonly yedek_saglayici: TtsProviderId;
  readonly sesler: Readonly<Record<string, VoiceProfile>>;
  readonly duygu_ayari: Readonly<Partial<Record<V3Emotion, number>>>;
}

export interface TtsLineRequest {
  readonly text: string;
  readonly voiceId: string;
  readonly emotion: V3Emotion;
  /** Extra tempo on top of the profile (e.g. 0.95 for a dramatic beat). */
  readonly speed?: number;
  /** Force an engine (e.g. Piper for a quick preview). */
  readonly provider?: TtsProviderId;
  /** Narration language; Turkish number/name normalisation applies only to `tr`. Default `tr`. */
  readonly language?: TtsLanguage;
}

export type TtsLanguage = "tr" | "en";

export interface TtsLineResult {
  /** 48 kHz mono 16-bit WAV, trimmed and level-matched. */
  readonly file: string;
  readonly duration: number;
  readonly provider: TtsProviderId;
  readonly cached: boolean;
  readonly speechText: string;
}

/** Engine-level synthesis into a raw WAV; post-processing is shared. */
interface TtsEngine {
  readonly id: TtsProviderId;
  readonly model: string;
  synthesizeRaw(text: string, voice: VoiceProfile, emotionBoost: number, out: string, seed: number, language: TtsLanguage): Promise<void>;
  close(): Promise<void>;
}

export class TtsError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
  }
}

/** GPU temperature in °C, or undefined when it cannot be read (an unreadable sensor never blocks). */
export async function gpuTemperature(): Promise<number | undefined> {
  try {
    const r = await runProcess("nvidia-smi", ["--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"], { timeoutMs: 10_000 });
    const t = Number(r.stdout.trim().split(/\r?\n/)[0]);
    return Number.isFinite(t) ? t : undefined;
  } catch {
    return undefined;
  }
}

/** Owner rule: no GPU work at or above 73 °C; wait in 15 s steps for up to 10 minutes, then refuse. */
export async function waitForCoolGpu(log: (s: string) => void, limit = 73, maxWaitMs = 10 * 60_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const t = await gpuTemperature();
    if (t === undefined || t < limit) return;
    if (Date.now() > deadline) throw new TtsError("V3_GPU_TOO_HOT", `GPU ${t} °C ≥ ${limit} °C, ${maxWaitMs / 60000} dk beklendi`);
    log(`GPU ${t} °C — soğuması bekleniyor (sınır ${limit} °C)`);
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

class ChatterboxEngine implements TtsEngine {
  readonly id = "chatterbox" as const;
  readonly model = "chatterbox-tts-0.1.7-multilingual";
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private waiting = new Map<string, (msg: { ok: boolean; error?: string }) => void>();
  private counter = 0;

  constructor(private readonly paths: V3Paths, private readonly log: (s: string) => void) {}

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      await waitForCoolGpu(this.log);
      if (!existsSync(this.paths.ttsPython)) throw new TtsError("V3_TTS_PYTHON_MISSING", this.paths.ttsPython);
      const script = path.join(this.paths.repoRoot, "scripts", "v3", "tts_server.py");
      const env = {
        ...process.env,
        HF_HOME: path.join(this.paths.toolsRoot, "hf-cache"),
        HF_HUB_DISABLE_TELEMETRY: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        TEMP: this.paths.asciiTemp,
        TMP: this.paths.asciiTemp,
      };
      await fs.mkdir(this.paths.asciiTemp, { recursive: true });
      const child = spawn(this.paths.ttsPython, ["-u", script], { env, windowsHide: true });
      this.child = child;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      let buffer = "";
      let resolveReady!: () => void, rejectReady!: (e: Error) => void;
      const readyPromise = new Promise<void>((res, rej) => ((resolveReady = res), (rejectReady = rej)));
      child.stdout.on("data", (d: string) => {
        buffer += d;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim().startsWith("{")) continue;
          const msg = JSON.parse(line) as { ready?: boolean; id?: string; ok?: boolean; error?: string; device?: string; load_seconds?: number };
          if (msg.ready) {
            this.log(`Chatterbox hazır (${msg.device}, ${msg.load_seconds} sn)`);
            resolveReady();
          } else if (msg.id && this.waiting.has(msg.id)) {
            this.waiting.get(msg.id)!({ ok: !!msg.ok, ...(msg.error ? { error: msg.error } : {}) });
            this.waiting.delete(msg.id);
          }
        }
      });
      let stderrTail = "";
      child.stderr.on("data", (d: string) => {
        stderrTail = (stderrTail + d).slice(-4000);
      });
      child.on("exit", (code) => {
        rejectReady(new TtsError("V3_TTS_EXIT", `Chatterbox süreci kapandı (${code}): ${stderrTail.slice(-800)}`));
        for (const [, cb] of this.waiting) cb({ ok: false, error: `süreç kapandı (${code})` });
        this.waiting.clear();
        this.child = undefined;
        this.ready = undefined;
      });
      const timer = setTimeout(() => rejectReady(new TtsError("V3_TTS_START_TIMEOUT", "model 15 dk içinde yüklenmedi")), 15 * 60_000);
      await readyPromise.finally(() => clearTimeout(timer));
    })();
    return this.ready;
  }

  async synthesizeRaw(text: string, voice: VoiceProfile, boost: number, out: string, seed: number, language: TtsLanguage): Promise<void> {
    await this.start();
    const ref = voice.referans ? path.join(this.paths.voiceRefRoot, `${voice.referans}.wav`) : undefined;
    if (ref && !existsSync(ref)) throw new TtsError("V3_VOICE_REF_MISSING", ref);
    const id = `r${++this.counter}`;
    const reply = new Promise<{ ok: boolean; error?: string }>((resolve) => this.waiting.set(id, resolve));
    const req = { id, text, ref, out, lang: language, exaggeration: Math.min(1.5, Math.max(0.25, voice.exaggeration + boost)), cfg: voice.cfg, temperature: voice.sicaklik, seed };
    this.child!.stdin.write(JSON.stringify(req) + "\n", "utf8");
    const timeout = new Promise<{ ok: boolean; error: string }>((resolve) => setTimeout(() => resolve({ ok: false, error: "satır 180 sn içinde bitmedi" }), 180_000));
    const r = await Promise.race([reply, timeout]);
    if (!r.ok) throw new TtsError("V3_TTS_LINE", r.error ?? "bilinmeyen hata");
  }

  async close(): Promise<void> {
    if (!this.child) return;
    this.child.stdin.write(JSON.stringify({ cmd: "quit" }) + "\n");
    await new Promise((r) => setTimeout(r, 300));
    this.child?.kill();
  }
}

class PiperEngine implements TtsEngine {
  readonly id = "piper" as const;
  readonly model = "piper-tr_TR-dfki-medium";
  constructor(private readonly paths: V3Paths) {}
  async synthesizeRaw(text: string, _voice: VoiceProfile, _boost: number, out: string, _seed: number, language: TtsLanguage): Promise<void> {
    // The only installed Piper voice is Turkish; reading English with it would be wrong, not just worse.
    if (language !== "tr") throw new TtsError("V3_PIPER_LANGUAGE", `Piper sesi yalnız Türkçe: ${language}`);
    if (!existsSync(this.paths.piperExe)) throw new TtsError("V3_PIPER_MISSING", this.paths.piperExe);
    await runChecked(this.paths.piperExe, ["--model", this.paths.piperVoice, "--output_file", out], { input: text, timeoutMs: 120_000 });
  }
  async close(): Promise<void> {}
}

export async function audioDuration(paths: V3Paths, file: string): Promise<number> {
  const r = await runChecked(paths.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(r.stdout.trim());
}

/**
 * Trim leading/trailing silence, apply the character's pitch/tempo (+vibrato), level-match to −18 LUFS
 * and write 48 kHz mono 16-bit PCM with 40 ms of air at both ends.
 */
export function postProcessFilter(voice: VoiceProfile, speed: number): string {
  const ratio = Math.pow(2, voice.perde / 12);
  const tempo = voice.hiz * speed;
  const parts = [
    "silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.04",
    "areverse",
    "silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.06",
    "areverse",
  ];
  if (Math.abs(voice.perde) > 0.01 || Math.abs(tempo - 1) > 0.005) parts.push(`rubberband=pitch=${ratio.toFixed(5)}:tempo=${tempo.toFixed(4)}`);
  if (voice.titreme) parts.push("vibrato=f=5.5:d=0.06");
  parts.push("loudnorm=I=-18:TP=-2:LRA=9", "aresample=48000", "adelay=40", "apad=pad_dur=0.04");
  return parts.join(",");
}

export class TtsService {
  private engines = new Map<TtsProviderId, TtsEngine>();
  private readonly cacheDir: string;

  constructor(
    private readonly paths: V3Paths,
    private readonly voices: VoiceMap,
    private readonly lexicon: Lexicon,
    private readonly log: (s: string) => void = () => {},
  ) {
    this.cacheDir = path.join(paths.workRoot, "_onbellek", "tts");
  }

  static async load(paths: V3Paths, log?: (s: string) => void): Promise<TtsService> {
    const voices = JSON.parse(await fs.readFile(path.join(paths.contentRoot, "voices.json"), "utf8")) as VoiceMap;
    const lexicon = JSON.parse(await fs.readFile(path.join(paths.contentRoot, "lexicon_tr.json"), "utf8")) as Lexicon;
    return new TtsService(paths, voices, lexicon, log);
  }

  private engine(id: TtsProviderId): TtsEngine {
    let e = this.engines.get(id);
    if (!e) {
      e = id === "chatterbox" ? new ChatterboxEngine(this.paths, this.log) : new PiperEngine(this.paths);
      this.engines.set(id, e);
    }
    return e;
  }

  voice(voiceId: string): VoiceProfile {
    const v = this.voices.sesler[voiceId];
    if (!v) throw new TtsError("V3_VOICE_UNKNOWN", voiceId);
    return v;
  }

  speechText(text: string): string {
    return normalizeForSpeech(text, this.lexicon);
  }

  async synthesize(req: TtsLineRequest): Promise<TtsLineResult> {
    const voice = this.voice(req.voiceId);
    const provider = req.provider ?? voice.saglayici;
    const engine = this.engine(provider);
    const language = req.language ?? "tr";
    const speech = language === "tr" ? this.speechText(req.text) : normalizeEnglishForSpeech(req.text);
    const boost = this.voices.duygu_ayari[req.emotion] ?? 0;
    const speed = req.speed ?? 1;
    const refHash = voice.referans && provider === "chatterbox" ? await fileHash(path.join(this.paths.voiceRefRoot, `${voice.referans}.wav`)) : "";
    const key = createHash("sha256")
      .update(JSON.stringify({ v: 1, model: engine.model, speech, voice, provider, boost, speed, refHash, filter: postProcessFilter(voice, speed), ...(language !== "tr" ? { language } : {}) }))
      .digest("hex")
      .slice(0, 32);
    const file = path.join(this.cacheDir, `${key}.wav`);
    if (existsSync(file)) return { file, duration: await audioDuration(this.paths, file), provider, cached: true, speechText: speech };

    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.mkdir(this.paths.asciiTemp, { recursive: true });
    const raw = path.join(this.paths.asciiTemp, `tts-${key}-raw.wav`);
    const seed = parseInt(key.slice(0, 8), 16) % 1_000_000;
    await this.engine(provider).synthesizeRaw(speech, voice, boost, raw, seed, language);
    const tmp = `${file}.tmp.wav`;
    await runChecked(this.paths.ffmpeg, ["-v", "error", "-y", "-i", raw, "-af", postProcessFilter(voice, speed), "-ac", "1", "-c:a", "pcm_s16le", tmp]);
    await fs.rename(tmp, file);
    await fs.rm(raw, { force: true });
    return { file, duration: await audioDuration(this.paths, file), provider, cached: false, speechText: speech };
  }

  async close(): Promise<void> {
    for (const e of this.engines.values()) await e.close();
  }
}

async function fileHash(file: string): Promise<string> {
  if (!existsSync(file)) return "missing";
  return createHash("sha256").update(await fs.readFile(file)).digest("hex").slice(0, 16);
}

/** Cuts the owner's recording into the two reference clips the voice map uses. */
export async function prepareOwnerReferences(paths: V3Paths, source: string): Promise<string[]> {
  await fs.mkdir(paths.voiceRefRoot, { recursive: true });
  const clips: [string, number, number][] = [
    ["owner-a", 0.9, 12.4],
    ["owner-b", 13.1, 22.1],
  ];
  const out: string[] = [];
  for (const [id, from, to] of clips) {
    const file = path.join(paths.voiceRefRoot, `${id}.wav`);
    await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-ss", String(from), "-to", String(to), "-i", source, "-ac", "1", "-ar", "24000", "-af", "highpass=f=70,loudnorm=I=-20:TP=-2", "-c:a", "pcm_s16le", file]);
    out.push(file);
  }
  return out;
}
