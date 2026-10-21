import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { Episode, EpisodeScene } from "../episode/EpisodeTypes";
import { sideProcessEnv } from "../tts/Tts";
import { periodEndYear } from "./HistorySources";
import { freeGpuMemory, GPU_PAUSE_C, GPU_START_C, waitForCoolGpu } from "../util/Gpu";
import { PythonLineServer } from "../util/PythonLineServer";
import type { V3Paths } from "../V3Paths";

/**
 * Designs a scene's set when no period image exists: the script's description of the place as it looked in the
 * period (`arka_plan_sorgusu.tasarim`) goes to local SDXL in the house cartoon style. Every image is kept in an
 * append-only library (`<workRoot>/_kutuphane/setler/<hash>.png` + `.json`): the same design is never drawn twice
 * and an earlier image is never overwritten. Judging is the caller's job (the same vision judge, set mode).
 */
export const SDXL_MODEL_ID = "stabilityai/stable-diffusion-xl-base-1.0@462165984030";

/**
 * The house style, first in the prompt (CLIP reads 77 tokens; the place description goes to the second encoder in
 * full). The reference channel's look (owner, 20 Oct 2026): flat bright colours, clean dark outlines, simple shapes,
 * a plain sky — not a painting.
 */
const SET_STYLE = "flat 2D vector cartoon background, bold clean dark outlines, flat bright saturated colors, cel shading, simple geometric shapes, daytime, plain light blue sky, minimal detail, wide establishing shot, eye level, flat empty ground across the foreground, no people";

/** Things a period set must never show; the judge checks the picture as well. */
export const SET_NEGATIVE =
  "people, person, human, crowd, character, face, hands, text, letters, words, caption, signature, watermark, logo, frame, border, photograph, photorealistic, 3d render, sketch, pencil drawing, line art only, grayscale, monochrome, sepia, parchment, engraving, hatching, paper texture, painterly, brush strokes, oil painting, watercolor, impressionism, soft focus, bokeh, volumetric light, realistic lighting, anime, sunset, sunrise, dusk, twilight, night, orange sky, red sky, blurry, low quality, deformed, distorted perspective, cluttered foreground, objects in the foreground, modern buildings, skyscraper, apartment block, car, truck, road markings, asphalt, power lines, electric pole, street lamp, antenna, airplane, motorboat, ferry, steamship, plastic, neon";

export interface SetDesign {
  /** Style + place, for the first text encoder. */
  readonly prompt: string;
  /** The full place description with its period, for the second text encoder. */
  readonly prompt2: string;
  readonly negative: string;
}

/**
 * Buildings a set of this period must not show although models like to draw them into any "old town" (the Rubicon
 * pilot's 49 BC street had church towers): religious buildings of later eras.
 */
export function periodNegatives(donem: string): string[] {
  const year = periodEndYear(donem);
  if (year === undefined) return [];
  const out: string[] = [];
  if (year < 400) out.push("church, bell tower, steeple, cross, gothic cathedral, medieval town, castle, castle keep, turrets, conical tower roofs, medieval fortress");
  if (year < 630) out.push("minaret, mosque, onion dome");
  return out;
}

/**
 * What the buildings of an ancient period look like, for the second encoder: SDXL draws any "walled hilltop town with
 * stone towers" as a medieval castle town (the Rubicon's Corfinium, 49 BC: five drawings, five castles, crosses on two,
 * 21 Oct 2026). Undefined from 400 AD on.
 */
export function periodLook(donem: string): string | undefined {
  const year = periodEndYear(donem);
  if (year === undefined || year >= 400) return undefined;
  return `Ancient-world buildings as they were in ${donem}: low houses with flat or terracotta-tiled roofs, plain square stone walls and gates.`;
}

/** Words that make an image model draw a later era (castle towns, churches) into a set. */
const LATER_ERA_WORDS = /\b(towers?|castles?|fortress(?:es)?|keeps?|battlements?|turrets?|churche?s?|spires?|steeples?|cathedrals?|medieval)\b/i;

/**
 * The setting brain rewrites a set description whose drawings came out from a later era. SDXL drew the Rubicon's
 * "walled hilltop town with stone towers" (49 BC) as a medieval castle town nine times out of nine; "a small ancient
 * Italic hill town: whitewashed stone houses with terracotta tile roofs, a low wall of large fitted stones with a simple
 * arched gate…" gave ancient villages, while only dropping "towers" did not (21 Oct 2026).
 */
export function periodRewritePrompt(place: string, mekan: string, donem: string, reasons: readonly string[]): string {
  return `An image model draws flat cartoon backgrounds for a history show. It must draw this place as it looked in ${donem}: "${place}" (${mekan}).
Its drawings came out from a later era: ${reasons.slice(0, 4).join("; ") || "later-era buildings"}.
Rewrite the description in English, at most 45 words: name concrete things of ${donem} at this place (the typical houses, roofs, walls and gates, public buildings, landscape, season) and keep what the scene needs. Do not use words that make image models draw later eras: tower, castle, fortress, keep, battlements, turret, church, spire, steeple, cathedral, medieval.
Return ONLY JSON: {"tasarim": "<the new description>"}`;
}

/** The rewritten description, or undefined when the answer is unreadable, too short or long, or names a later era again. */
export function readPeriodRewrite(content: string): string | undefined {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const text = String((JSON.parse(content.slice(start, end + 1)) as { tasarim?: unknown }).tasarim ?? "").replace(/\s+/g, " ").trim();
    return text.length >= 20 && text.length <= 400 && !LATER_ERA_WORDS.test(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The ancient wording that worked when the setting brain's rewrite is refused twice (it repeats a castle word): the
 * Corfinium trial's "small ancient Italic hill town: whitewashed stone houses with terracotta tile roofs, a low wall of
 * large fitted stones with a simple arched gate" gave ancient villages. Undefined from 400 AD on.
 */
export function ancientPlace(mekan: string, donem: string): string | undefined {
  return periodLook(donem) ? `A small ancient town at ${mekan} in ${donem}: low stone houses with terracotta tile roofs, a low wall of large fitted stones with a simple arched gate.` : undefined;
}

/** The last resort when every drawing of a place showed a later era: its countryside, with no buildings to get wrong. */
export function landscapeOnly(mekan: string, donem: string): string {
  return `The open countryside near ${mekan} in ${donem}: green hills, a dirt road, a few trees, distant mountains.`;
}

/** What the landscape-only set must not show (SDXL reads "no buildings" as buildings, so they go to the negative). */
export const LANDSCAPE_NEGATIVE = ["buildings, houses, town, village, castle, tower, walls"];

/**
 * The scene's set description (script-written, else built from the place fields) as an SDXL prompt pair. `avoid`:
 * why the judge rejected similar sets before (the setting brain's experience memory), told to the second encoder.
 */
export function designFor(scene: EpisodeScene, episode: Pick<Episode, "donem">, extraNegative: readonly string[] = [], avoid: readonly string[] = []): SetDesign {
  const q = scene.arka_plan_sorgusu;
  const place = (q.tasarim?.trim() || `${scene.mekan}; ${q.en}`).replace(/\s+/g, " ");
  return {
    prompt: `${SET_STYLE}, ${place}`,
    prompt2: `${place}. Historically accurate for ${episode.donem}.${periodLook(episode.donem) ? ` ${periodLook(episode.donem)}` : ""} Flat cartoon background illustration with clean outlines and bright flat colors, in daylight under a plain light blue sky (unless the place is indoors or the scene is at night), without people.${avoid.length ? ` Avoid what failed before: ${avoid.join("; ")}.` : ""}`,
    negative: [SET_NEGATIVE, ...periodNegatives(episode.donem), ...extraNegative].join(", "),
  };
}

export interface DesignedSet {
  readonly file: string;
  readonly seed: number;
  readonly design: SetDesign;
  readonly cached: boolean;
}

export class BackgroundDesigner {
  private server?: PythonLineServer;
  readonly libraryDir: string;

  constructor(private readonly paths: V3Paths, private readonly log: (s: string) => void = () => {}) {
    this.libraryDir = path.join(paths.workRoot, "_kutuphane", "setler");
  }

  /** Library file of a design + seed (exists only once drawn). */
  fileFor(design: SetDesign, seed: number): string {
    const key = createHash("sha256").update(JSON.stringify({ v: 1, model: SDXL_MODEL_ID, ...design, seed, steps: 30, size: [1344, 768, 1920, 1080] })).digest("hex").slice(0, 24);
    return path.join(this.libraryDir, `${key}.png`);
  }

  async draw(design: SetDesign, seed: number, tags: Readonly<Record<string, string>> = {}): Promise<DesignedSet> {
    const file = this.fileFor(design, seed);
    if (existsSync(file)) return { file, seed, design, cached: true };
    if (!existsSync(this.paths.sdxlModel)) throw new Error(`V3_SDXL_MODEL_MISSING: ${this.paths.sdxlModel}`);
    await fs.mkdir(this.libraryDir, { recursive: true });
    await fs.mkdir(this.paths.asciiTemp, { recursive: true });
    if (!this.server) {
      // The 12 GB card holds one big model: Ollama (the judge, AYAS chat) is unloaded first.
      await freeGpuMemory(10_500, this.log);
      this.server = new PythonLineServer({
        python: this.paths.genPython,
        script: path.join(this.paths.repoRoot, "scripts", "v3", "sdxl_server.py"),
        env: { ...sideProcessEnv(this.paths), ATOLYE_V3_SDXL_MODEL: this.paths.sdxlModel, PYTORCH_CUDA_ALLOC_CONF: "expandable_segments:True" },
        label: "SDXL",
        startTimeoutMs: 15 * 60_000,
        // The card rests between steps while it is hot (owner rule), so one drawing may take long.
        requestTimeoutMs: 30 * 60_000,
        log: this.log,
      });
    }
    await waitForCoolGpu(this.log);
    const tmp = path.join(this.paths.asciiTemp, `set-${path.basename(file)}`);
    const r = await this.server.request({ prompt: design.prompt, prompt_2: design.prompt2, negative: design.negative, seed, out: tmp, steps: 30, width: 1344, height: 768, final_width: 1920, final_height: 1080, pace: 0.2, max_temp: GPU_PAUSE_C, resume_below: GPU_START_C });
    if (!r.ok) throw new Error(`V3_SDXL_FAILED: ${r.error ?? "bilinmeyen hata"}`);
    // Append-only: copy, never overwrite (another run may have drawn the same design meanwhile).
    if (!existsSync(file)) await fs.copyFile(tmp, file);
    await fs.rm(tmp, { force: true });
    const meta = { model: SDXL_MODEL_ID, seed, ...design, tags, seconds: r.seconds, peakVramGb: r.peak_vram_gb, created: new Date().toISOString(), license: "CreativeML Open RAIL++-M (generated image)", paidCalls: 0 };
    const metaFile = file.replace(/\.png$/, ".json");
    if (!existsSync(metaFile)) await fs.writeFile(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
    this.log(`  set çizildi (${r.seconds} sn, tohum ${seed}): ${path.basename(file)}`);
    return { file, seed, design, cached: false };
  }

  /** Ends the SDXL process so the vision judge gets the card back. */
  async close(): Promise<void> {
    await this.server?.close();
    this.server = undefined;
  }
}
