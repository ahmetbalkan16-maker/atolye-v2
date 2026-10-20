import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { Episode, EpisodeScene } from "../episode/EpisodeTypes";
import { sideProcessEnv } from "../tts/Tts";
import { periodEndYear } from "./HistorySources";
import { freeGpuMemory, waitForCoolGpu } from "../util/Gpu";
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
  if (year < 400) out.push("church, bell tower, steeple, cross, gothic cathedral, medieval town");
  if (year < 630) out.push("minaret, mosque, onion dome");
  return out;
}

/**
 * The scene's set description (script-written, else built from the place fields) as an SDXL prompt pair. `avoid`:
 * why the judge rejected similar sets before (the setting brain's experience memory), told to the second encoder.
 */
export function designFor(scene: EpisodeScene, episode: Pick<Episode, "donem">, extraNegative: readonly string[] = [], avoid: readonly string[] = []): SetDesign {
  const q = scene.arka_plan_sorgusu;
  const place = (q.tasarim?.trim() || `${scene.mekan}; ${q.en}`).replace(/\s+/g, " ");
  return {
    prompt: `${SET_STYLE}, ${place}`,
    prompt2: `${place}. Historically accurate for ${episode.donem}. Flat cartoon background illustration with clean outlines and bright flat colors, in daylight under a plain light blue sky (unless the place is indoors or the scene is at night), without people.${avoid.length ? ` Avoid what failed before: ${avoid.join("; ")}.` : ""}`,
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
    const r = await this.server.request({ prompt: design.prompt, prompt_2: design.prompt2, negative: design.negative, seed, out: tmp, steps: 30, width: 1344, height: 768, final_width: 1920, final_height: 1080, pace: 0.2, max_temp: 73 });
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
