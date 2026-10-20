import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { sideProcessEnv } from "../tts/Tts";
import { PythonLineServer } from "../util/PythonLineServer";
import type { V3Paths } from "../V3Paths";

/**
 * CLIP pre-ranking (owner approval 20 Oct 2026; the idea from OpenMontage's CLIP-searchable corpus): before the vision
 * judge looks at period-image candidates, a small local CLIP (LAION ViT-B/32, MIT, on the CPU) orders up to
 * CLIP_POOL of them by how well each matches the scene's query, so the judge's MAX_JUDGED looks go to the likeliest
 * pictures instead of the first ones a search returned. It only reorders: nothing is thrown away, and without CLIP
 * the search order stands.
 */
export const CLIP_POOL = 16;

/**
 * Candidates ordered by score, best first; candidates without a score keep their search order after the scored ones
 * (stable), and those beyond the pool follow unchanged.
 */
export function orderByClip<T>(candidates: readonly T[], scores: readonly (number | null | undefined)[]): T[] {
  const pool = candidates.slice(0, scores.length).map((c, i) => ({ c, i, s: scores[i] }));
  const scored = pool.filter((x) => typeof x.s === "number").sort((a, b) => (b.s as number) - (a.s as number) || a.i - b.i);
  const unscored = pool.filter((x) => typeof x.s !== "number");
  return [...scored.map((x) => x.c), ...unscored.map((x) => x.c), ...candidates.slice(scores.length)];
}

/** The text CLIP matches the pictures against: what is wanted, and where (CLIP reads at most 77 tokens). */
export function clipQuery(scene: { readonly en: string; readonly mekan: string }): string {
  return `${scene.en}. ${scene.mekan}.`.replace(/\s+/g, " ").slice(0, 200);
}

export class ClipRanker {
  private server?: PythonLineServer;
  private broken = false;

  constructor(private readonly paths: V3Paths, private readonly log: (s: string) => void = () => {}) {}

  private modelDir(): string {
    return path.join(this.paths.clipRoot, "CLIP-ViT-B-32-laion2B");
  }

  available(): boolean {
    return !this.broken && existsSync(this.paths.genPython) && existsSync(path.join(this.modelDir(), "atolye-manifest.json"));
  }

  /**
   * The candidates in CLIP order, or in their own order when CLIP is missing or fails (said once in the log).
   * `preview` gives a candidate's preview image bytes (the judge's own cached preview).
   */
  async order<T>(candidates: readonly T[], query: string, preview: (c: T) => Promise<Buffer>): Promise<T[]> {
    if (!this.available() || candidates.length < 2) return [...candidates];
    const pool = candidates.slice(0, CLIP_POOL);
    const dir = path.join(this.paths.asciiTemp, `clip-${Date.now()}`);
    try {
      await fs.mkdir(dir, { recursive: true });
      const files: string[] = [];
      for (const [i, c] of pool.entries()) {
        const file = path.join(dir, `${i}.jpg`);
        const bytes = await preview(c).catch(() => undefined);
        if (bytes) await fs.writeFile(file, bytes);
        files.push(file);
      }
      this.server ??= new PythonLineServer({
        python: this.paths.genPython,
        script: path.join(this.paths.repoRoot, "scripts", "v3", "clip_server.py"),
        env: { ...sideProcessEnv(this.paths), ATOLYE_V3_CLIP_MODEL: this.modelDir(), CUDA_VISIBLE_DEVICES: "" },
        label: "CLIP",
        cwd: this.paths.clipRoot,
        startTimeoutMs: 5 * 60_000,
        requestTimeoutMs: 120_000,
        log: this.log,
      });
      const r = await this.server.request({ text: query, images: files });
      if (!r.ok || !Array.isArray(r.scores)) throw new Error(String(r.error ?? "yanıt okunamadı"));
      return orderByClip(candidates, r.scores as (number | null)[]);
    } catch (e) {
      this.broken = true;
      this.log(`  CLIP ön eleme kullanılamadı (${(e as Error).message.slice(0, 120)}); arama sırası kullanılıyor`);
      await this.close();
      return [...candidates];
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  async close(): Promise<void> {
    await this.server?.close();
    this.server = undefined;
  }
}
