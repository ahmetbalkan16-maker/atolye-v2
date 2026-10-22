import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { periodEndYear } from "../backgrounds/HistorySources";
import type { Episode, EpisodeScene, SceneSetting, SfxId } from "../episode/EpisodeTypes";
import type { EpisodeTimeline } from "../timeline/Timeline";
import { sideProcessEnv } from "../tts/Tts";
import { GPU_PAUSE_C, GPU_START_C, unloadOllama, waitForCoolGpu } from "../util/Gpu";
import { runChecked } from "../util/Proc";
import { PythonLineServer } from "../util/PythonLineServer";
import type { V3Paths } from "../V3Paths";
import { measurePiece, type PieceStats } from "./MusicComposer";

/**
 * The sound designer (Efektçi; owner approval 20 Oct 2026, "integrated, usable without Claude or Codex, reliable"),
 * with MOSS-SoundEffect v2 (Apache-2.0, local): the effects that tell the period are made for it (a bronze hand bell
 * in 49 BC, not a church bell; a papyrus scroll, not paper; leather sandals on stone), and every scene gets a quiet
 * ambience bed of its place (a river in winter wind, the murmur of a marble hall). Cartoon effects (whoosh, pop,
 * boing) stay the Kenney CC0 recordings. Every sound is kept in an append-only library
 * (`<workRoot>/_kutuphane/efekt/<hash>.wav` + `.json`) and checked; a sound that fails, or a designer that is not
 * installed or breaks, leaves the Kenney effect (or no ambience) — the video is always finished.
 */
export const MOSS_SFX_MODEL_ID = "OpenMOSS-Team/MOSS-SoundEffect-v2.0";

export type Era = "antik" | "orta" | "erken-modern" | "modern";

export function eraOf(donem: string): Era {
  const year = periodEndYear(donem);
  if (year === undefined || year >= 1800) return "modern";
  if (year < 500) return "antik";
  if (year < 1450) return "orta";
  return "erken-modern";
}

/**
 * What each period-telling effect sounds like in each era (English for the model). Effects not listed here are the
 * same in every period and keep their library recording.
 */
/** Wading is the same in every age: people splashing on foot through a shallow river (the Rubicon crossing). */
const WADING = "several people wading on foot through a shallow river, water splashing around their legs, a few steps";

const PERIOD_SFX: Readonly<Partial<Record<SfxId, Readonly<Record<Era, string>>>>> = {
  su: { antik: WADING, orta: WADING, "erken-modern": WADING, modern: WADING },
  kilic: {
    antik: "two short bronze and iron swords clashing twice, sharp metallic clang",
    orta: "two heavy steel longswords clashing, ringing metallic clang",
    "erken-modern": "two steel sabres clashing quickly, bright metallic ring",
    modern: "a bayonet striking a steel helmet, short metallic clank",
  },
  kalabalik: {
    antik: "a crowd of ancient Romans in a stone forum murmuring and gasping together",
    orta: "a medieval market crowd murmuring and calling out",
    "erken-modern": "a crowd in a town square murmuring and gasping",
    modern: "a crowd murmuring and gasping in surprise",
  },
  davul: {
    antik: "ancient war drums and a bronze horn call, marching rhythm",
    orta: "medieval war drums beating a slow marching rhythm",
    "erken-modern": "military drums and fifes beating a marching rhythm",
    modern: "a snare drum roll of a military band",
  },
  adim: {
    antik: "footsteps of leather sandals on stone pavement, a few steps",
    orta: "footsteps of leather boots on a wooden floor, a few steps",
    "erken-modern": "footsteps of heeled boots on cobblestones, a few steps",
    modern: "footsteps of shoes on a hard floor, a few steps",
  },
  kapi: {
    antik: "a heavy wooden door with bronze fittings creaking open",
    orta: "a heavy oak door with iron hinges creaking open",
    "erken-modern": "an old wooden door creaking open and a latch clicking",
    modern: "a wooden door opening and closing",
  },
  zil: {
    antik: "a small bronze hand bell ringing twice",
    orta: "a small iron hand bell ringing twice",
    "erken-modern": "a brass hand bell ringing twice",
    modern: "a small desk bell ringing twice",
  },
  para: {
    antik: "a few ancient silver coins clinking into a leather pouch",
    orta: "medieval silver coins clinking on a wooden table",
    "erken-modern": "gold coins clinking on a wooden table",
    modern: "coins clinking on a counter",
  },
  kagit: {
    antik: "a papyrus scroll being unrolled and rustling",
    orta: "a parchment scroll being unrolled and rustling",
    "erken-modern": "a sheet of thick paper being unfolded and rustling",
    modern: "a sheet of paper being unfolded and rustling",
  },
  cekic: {
    antik: "a hammer and chisel striking stone, three blows",
    orta: "a blacksmith hammer striking an anvil, three blows",
    "erken-modern": "a hammer striking an anvil, three blows",
    modern: "a hammer hitting a nail into wood, three blows",
  },
};

/** The period version of an effect, or undefined when the library recording fits every period. */
export function periodSfxPrompt(id: SfxId, era: Era): string | undefined {
  const text = PERIOD_SFX[id]?.[era];
  return text ? `${text}. Clean single sound effect, no music, no speech.` : undefined;
}

/** What a living set sounds like (owner, 22 Oct 2026: no meaningless sound — the place's own sound, the hour's). */
const TIME_SOUND: Readonly<Record<SceneSetting["zaman"], string>> = { gun: "daytime, birdsong", aksam: "dusk, a few evening birds", gece: "night, crickets chirping, a distant owl", safak: "dawn, first birds" };
const PLACE_SOUND: Readonly<Record<SceneSetting["manzara"], string>> = {
  nehir_kiyisi: "a shallow river flowing over stones nearby",
  nehir_gecidi: "a shallow river flowing over stones nearby",
  ova: "open plain, wind over grass",
  tepeler: "open hills, wind over grass",
  orman: "wind in the trees, rustling leaves",
  sahil: "waves breaking on a shore",
  sokak: "a busy old town street, distant voices, footsteps",
  meydan: "a town square, many distant voices",
  saray_ici: "a large stone hall, quiet room tone with soft echo",
  meclis: "a large hall, a crowd of men murmuring",
  ordugah: "an army camp, distant voices, metal clinking, a horse snorting",
  sur_onu: "outside high city walls, wind, distant voices",
};
const WEATHER_SOUND: Readonly<Record<NonNullable<SceneSetting["hava"]>, string>> = { acik: "", bulutlu: "a light wind", sis: "still misty air", yagmur: "steady rain falling", kar: "muffled snowy quiet, soft wind" };
const LIGHT_SOUND: Readonly<Record<NonNullable<SceneSetting["isik"]>, string>> = { yok: "", mesale: "torches crackling", kamp_atesi: "a campfire crackling" };

/** A scene's ambience: from its living set when it has one, else its place as the script described it. */
export function ambiencePrompt(scene: Pick<EpisodeScene, "mekan" | "arka_plan_sorgusu"> & Partial<Pick<EpisodeScene, "ortam" | "kalabalik">>, donem: string): string {
  if (scene.ortam) {
    const o = scene.ortam;
    const army = (scene.kalabalik ?? []).some((g) => g.duzen === "ordu") ? "a large army waiting quietly, armour and weapons clinking" : "";
    const parts = [PLACE_SOUND[o.manzara], TIME_SOUND[o.zaman], o.hava ? WEATHER_SOUND[o.hava] : "", o.isik ? LIGHT_SOUND[o.isik] : "", army].filter(Boolean);
    return `Quiet ambient background sound in ${donem}: ${parts.join(", ")}. Soft and steady, natural outdoor or room tone, no music, no speech, no singing.`;
  }
  const place = (scene.arka_plan_sorgusu.tasarim ?? scene.arka_plan_sorgusu.en)
    .split(/[;.]/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(no|without|not)\b/i.test(s))
    .join(", ");
  return `Quiet ambient background sound of ${scene.mekan} in ${donem}: ${place}. Soft and steady, natural room or outdoor tone, no music, no speech, no singing.`;
}

export interface SoundRequest {
  readonly prompt: string;
  readonly seconds: number;
  readonly seed: number;
  /** Effects start at once (leading silence trimmed, tail faded); ambience is a bed. */
  readonly kind: "efekt" | "ortam";
}

export function soundKey(req: SoundRequest): string {
  return createHash("sha256").update(JSON.stringify({ v: 1, model: MOSS_SFX_MODEL_ID, ...req, seconds: Math.round(req.seconds * 10) / 10 })).digest("hex").slice(0, 24);
}

/** Why a sound cannot be used (empty when it can). */
export function soundProblems(s: PieceStats, req: SoundRequest): string[] {
  const out: string[] = [];
  if (s.durationS < (req.kind === "efekt" ? 0.2 : req.seconds * 0.8)) out.push(`süre ${s.durationS.toFixed(1)} sn`);
  if (s.meanDb < (req.kind === "efekt" ? -45 : -55)) out.push(`çok sessiz (ortalama ${s.meanDb.toFixed(1)} dB)`);
  if (s.peakDb > -0.1) out.push(`tepe ${s.peakDb.toFixed(1)} dB`);
  if (req.kind === "ortam" && s.longestSilenceS > 4) out.push(`${s.longestSilenceS.toFixed(1)} sn sessizlik`);
  return out;
}

export class SfxDesigner {
  private server?: PythonLineServer;
  private broken?: string;
  private failures = 0;
  readonly libraryDir: string;

  constructor(private readonly paths: V3Paths, private readonly log: (s: string) => void = () => {}) {
    this.libraryDir = path.join(paths.workRoot, "_kutuphane", "efekt");
  }

  private root(): string {
    return this.paths.mossRoot;
  }

  /** Installed: its environment and the model folder are on disk. */
  available(): boolean {
    return existsSync(path.join(this.root(), ".venv", "Scripts", "python.exe")) && existsSync(path.join(this.root(), "checkpoints", "MOSS-SoundEffect-v2.0", "atolye-manifest.json"));
  }

  fileFor(req: SoundRequest): string {
    return path.join(this.libraryDir, `${soundKey(req)}.wav`);
  }

  async make(req: SoundRequest): Promise<{ file: string; cached: boolean } | { problems: string[] }> {
    const file = this.fileFor(req);
    if (existsSync(file)) return { file, cached: true };
    if (this.broken) return { problems: [this.broken] };
    await fs.mkdir(this.libraryDir, { recursive: true });
    await fs.mkdir(this.paths.asciiTemp, { recursive: true });
    if (!this.server) {
      // Ollama's runner can hold ~19 GB of RAM (21 Oct 2026) and this model needs ~15 GB of RAM while it loads.
      await unloadOllama(this.log, "efektçi için RAM ve ekran kartı");
      this.server = new PythonLineServer({
        python: path.join(this.root(), ".venv", "Scripts", "python.exe"),
        script: path.join(this.paths.repoRoot, "scripts", "v3", "moss_sfx_server.py"),
        env: { ...sideProcessEnv(this.paths), ATOLYE_V3_MOSS_ROOT: this.root(), TORCHDYNAMO_DISABLE: "1", PYTORCH_CUDA_ALLOC_CONF: "expandable_segments:True" },
        label: "MOSS-SoundEffect",
        cwd: this.root(),
        startTimeoutMs: 15 * 60_000,
        requestTimeoutMs: 20 * 60_000,
        log: this.log,
      });
    }
    await waitForCoolGpu(this.log);
    const raw = path.join(this.paths.asciiTemp, `efekt-ham-${path.basename(file)}`);
    const tmp = path.join(this.paths.asciiTemp, `efekt-${path.basename(file)}`);
    let r: Awaited<ReturnType<PythonLineServer["request"]>>;
    try {
      // The model works on a fixed window (30 s by default); a 3 s effect gets a window just longer than itself (less
      // heat and time).
      r = await this.server.request({ prompt: req.prompt, seconds: req.seconds, seed: req.seed, out: raw, max_temp: GPU_PAUSE_C, resume_below: GPU_START_C, window: Math.min(30, Math.max(4, Math.ceil(req.seconds) + 1)) });
    } catch (e) {
      this.broken = `efektçi başlatılamadı: ${(e as Error).message.slice(0, 160)}`;
      await this.close();
      return { problems: [this.broken] };
    }
    if (!r.ok) {
      const why = `efektçi hata verdi: ${String(r.error ?? "bilinmeyen").slice(0, 160)}`;
      if (++this.failures >= 2) {
        this.broken = why;
        await this.close();
      }
      return { problems: [why] };
    }
    this.failures = 0;
    // An effect lands on its beat: leading silence off, a short fade at its end. Ambience fades in and out.
    // The model renders at full scale (the first bell peaked at 0 dB): every sound is brought to one level, peaks under −2.
    const shape = `${req.kind === "efekt" ? "silenceremove=start_periods=1:start_threshold=-40dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,afade=t=in:d=0.15,areverse" : "afade=t=in:d=0.5"},loudnorm=I=-20:TP=-2:LRA=11`;
    await runChecked(this.paths.ffmpeg, ["-v", "error", "-y", "-i", raw, "-af", `${shape},aresample=48000`, "-ac", "1", tmp]);
    await fs.rm(raw, { force: true });
    const stats = await measurePiece(this.paths, tmp);
    const problems = soundProblems(stats, req);
    if (problems.length) {
      await fs.rm(tmp, { force: true });
      return { problems };
    }
    if (!existsSync(file)) await fs.copyFile(tmp, file);
    await fs.rm(tmp, { force: true });
    await fs.writeFile(file.replace(/\.wav$/, ".json"), `${JSON.stringify({ model: MOSS_SFX_MODEL_ID, ...req, stats, seconds_taken: r.seconds, created: new Date().toISOString(), license: "Apache-2.0 (MOSS-SoundEffect v2); the sound is Atölye's own local generation", paidCalls: 0 }, null, 2)}\n`);
    this.log(`  ses üretildi (${r.seconds} sn, ${req.kind}): ${req.prompt.slice(0, 60)}`);
    return { file, cached: false };
  }

  async close(): Promise<void> {
    await this.server?.close();
    this.server = undefined;
  }
}

export interface AmbienceBed {
  readonly start: number;
  readonly end: number;
  readonly file: string;
}

const seedOf = (text: string) => parseInt(createHash("sha256").update(text).digest("hex").slice(0, 8), 16) % 1_000_000;

/** Places an episode gets an ambience bed for (the ones on screen the longest). */
export const MAX_AMBIENCE_PLACES = 10;

/**
 * Period versions of the episode's effects (id → file) and an ambience bed per scene (map scenes and the opening
 * cover have none). Whatever fails is reported and left to the library or to silence.
 */
export async function designSounds(
  episode: Pick<Episode, "id" | "donem" | "sahneler">,
  timeline: Pick<EpisodeTimeline, "scenes">,
  ids: readonly SfxId[],
  designer: Pick<SfxDesigner, "make">,
): Promise<{ effects: Map<SfxId, string>; ambience: AmbienceBed[]; report: string[] }> {
  const era = eraOf(episode.donem);
  const effects = new Map<SfxId, string>();
  const ambience: AmbienceBed[] = [];
  const report: string[] = [];
  for (const id of [...new Set(ids)]) {
    const prompt = periodSfxPrompt(id, era);
    if (!prompt) continue;
    const got = await designer.make({ prompt, seconds: 3, seed: seedOf(`${id}#${era}`), kind: "efekt" }).catch((e: Error) => ({ problems: [`efektçi çalışmadı: ${e.message.slice(0, 160)}`] }));
    if ("file" in got) {
      effects.set(id, got.file);
      report.push(`efekt ${id}: ${era} dönemi sesi${got.cached ? " (kütüphaneden)" : ""}`);
    } else report.push(`efekt ${id}: kütüphane kaydı kaldı — ${got.problems.join("; ")}`);
  }
  // A bed takes the designer about two minutes: a long episode (30–40 places) gets beds for the places on screen the
  // longest; the others carry music only.
  const onScreen = new Map<string, number>();
  for (const st of timeline.scenes) {
    const scene = episode.sahneler[st.sceneIndex];
    if (scene && !scene.harita?.merkez) onScreen.set(scene.mekan, (onScreen.get(scene.mekan) ?? 0) + (st.end - st.start));
  }
  const places = new Set([...onScreen.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_AMBIENCE_PLACES).map(([mekan]) => mekan));
  for (const st of timeline.scenes) {
    const scene = episode.sahneler[st.sceneIndex];
    if (!scene || scene.harita?.merkez) continue;
    if (!places.has(scene.mekan)) {
      report.push(`ortam ${scene.id}: yalnız müzik (en uzun ${MAX_AMBIENCE_PLACES} yerin dışında)`);
      continue;
    }
    const prompt = ambiencePrompt(scene, episode.donem);
    // One bed per place (and per hour and weather when the set is drawn); long scenes loop it (at most 30 s at a time).
    const key = scene.ortam ? `${scene.mekan}#${scene.ortam.zaman}#${scene.ortam.hava ?? ""}` : scene.mekan;
    const got = await designer.make({ prompt, seconds: 20, seed: seedOf(`${episode.id}#${key}`), kind: "ortam" }).catch((e: Error) => ({ problems: [`efektçi çalışmadı: ${e.message.slice(0, 160)}`] }));
    if ("file" in got) {
      ambience.push({ start: st.start, end: st.end, file: got.file });
      report.push(`ortam ${scene.id}: ${scene.mekan}${got.cached ? " (kütüphaneden)" : ""}`);
    } else report.push(`ortam ${scene.id}: ortam sesi yok — ${got.problems.join("; ")}`);
  }
  return { effects, ambience, report };
}
