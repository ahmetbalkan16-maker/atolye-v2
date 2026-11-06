import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { runProcess } from "../util/Proc";
import type { V3Paths } from "../V3Paths";
import type { V3RenderPlan } from "./RenderPlanTypes";

/**
 * The period pictures' 2.5D move (owner, 6 Nov 2026, after the Wan 2.2 video model took 20 minutes and 10-14 GB of RAM
 * for three seconds: "bu kadar yüke gerek yok … bizim sistemimizde yok mu böyle birşey, ona entegre edelim"): every
 * archival background and cut-in still gets a displacement map from Depth Anything V2 Small, on the processor, a few
 * seconds each and once per picture (the map stays beside it in the public folder); the renderer moves the picture by it
 * along its Ken Burns drift, so near things travel further than far ones (remotion-v3 DepthFilter). The card is never
 * used. A picture whose map cannot be made keeps the flat drift; nothing here stops a production.
 * `ATOLYE_V3_DERINLIK=0` turns it off.
 */

/** The map's size: a background's is cut to the stage's shape at this width, a still's longer side is this long. */
export const DEPTH_MAP_PX = 960;

/** The pinned local snapshot (Apache-2.0, 99 MB; revision of the 5 Nov 2026 trial). `ATOLYE_V3_DEPTH_MODEL` overrides. */
export function depthModelDir(paths: Pick<V3Paths, "toolsRoot">, env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.ATOLYE_V3_DEPTH_MODEL || path.join(paths.toolsRoot, "hf-cache", "hub", "models--depth-anything--Depth-Anything-V2-Small-hf", "snapshots", "5426e4f0f36572d16453bbda7a8389317b1bef99");
}

/** kapla: cut to the stage like a cover background; sigdir: the whole picture like a contained cut-in. */
export type DepthFit = "kapla" | "sigdir";

/** Where a picture's map goes, beside it (public-relative, forward slashes). */
export const depthFileFor = (src: string, fit: DepthFit) => `${src.replace(/\\/g, "/").replace(/\.[^./]+$/, "")}-derinlik-${fit}.png`;

const key = (src: string, fit: DepthFit) => `${fit}|${src}`;

/**
 * The pictures that get a map: archival backgrounds drawn as pictures (not a map shot, not a drawn or character set —
 * people stand on those) and the cut-in stills (not archive film). A Short's cut-ins fill its tall frame by a pan the
 * map cannot follow, so they keep the flat drift.
 */
type PlanPart = Pick<V3RenderPlan, "shots" | "width" | "height" | "stage">;

export function depthTargets(plan: PlanPart): { src: string; fit: DepthFit }[] {
  const tall = plan.height > plan.width;
  const out = new Map<string, { src: string; fit: DepthFit }>();
  for (const s of plan.shots) {
    if (s.background.kind === "archival" && !s.geoMap && s.background.src) out.set(key(s.background.src, "kapla"), { src: s.background.src, fit: "kapla" });
    if (!tall) for (const i of s.inserts ?? []) if (!i.video) out.set(key(i.src, "sigdir"), { src: i.src, fit: "sigdir" });
  }
  return [...out.values()];
}

/** The plan with each picture's map named, for the maps that exist (`made`: their public-relative paths). */
export function withDepth<P extends Pick<V3RenderPlan, "shots">>(plan: P, made: ReadonlySet<string>): P {
  return {
    ...plan,
    shots: plan.shots.map((s) => {
      const bg = s.background.kind === "archival" && !s.geoMap && made.has(depthFileFor(s.background.src, "kapla")) ? { ...s.background, depth: depthFileFor(s.background.src, "kapla") } : s.background;
      const inserts = s.inserts?.map((i) => (!i.video && made.has(depthFileFor(i.src, "sigdir")) ? { ...i, depth: depthFileFor(i.src, "sigdir") } : i));
      return { ...s, background: bg, ...(inserts ? { inserts } : {}) };
    }),
  };
}

export interface DepthDeps {
  readonly publicDir: string;
  readonly python: string;
  readonly script: string;
  readonly model: string;
  readonly log: (s: string) => void;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  /** Runs the map maker on a jobs file (tests inject a fake; default: the script through gen-venv's Python). */
  readonly run?: (jobFile: string) => Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>;
}

/** The production's deps from its paths (gen-venv's Python, the repo's script). */
export function depthDeps(paths: Pick<V3Paths, "repoRoot" | "toolsRoot" | "genPython">, publicDir: string, log: (s: string) => void): DepthDeps {
  return { publicDir, python: paths.genPython, script: path.join(paths.repoRoot, "scripts", "v3", "derinlik_parallax.py"), model: depthModelDir(paths), log };
}

/**
 * Makes the maps the plan's pictures still lack (one Python run, the model loaded once) and returns the plan with every
 * existing map named. A map already beside its picture (and newer) is reused.
 */
export async function addDepthMaps<P extends PlanPart>(plan: P, d: DepthDeps): Promise<{ plan: P; yeni: number; hazir: number; hata: number }> {
  const env = d.env ?? process.env;
  if (/^(0|kapali|off)$/i.test(env.ATOLYE_V3_DERINLIK ?? "")) return { plan, yeni: 0, hazir: 0, hata: 0 };
  const targets = depthTargets(plan);
  if (!targets.length) return { plan, yeni: 0, hazir: 0, hata: 0 };
  const full = (rel: string) => path.join(d.publicDir, ...rel.split("/"));
  const fresh = async (t: { src: string; fit: DepthFit }) => {
    const map = full(depthFileFor(t.src, t.fit));
    if (!existsSync(map) || !existsSync(full(t.src))) return false;
    return (await fs.stat(map)).mtimeMs >= (await fs.stat(full(t.src))).mtimeMs;
  };
  const missing: typeof targets = [];
  for (const t of targets) if (existsSync(full(t.src)) && !(await fresh(t))) missing.push(t);
  let yeni = 0, hata = 0;
  if (missing.length) {
    if (!d.run && (!existsSync(d.python) || !existsSync(d.script) || !existsSync(d.model))) {
      d.log(`  derinlik: model ya da Python yok (${[d.python, d.script, d.model].filter((p) => !existsSync(p)).join(", ")}); resimler düz kayar`);
    } else {
      // A background is cut to the stage's shape (a Short's stage is still 16:9; its frame is the window over it).
      const stage = plan.stage ?? { width: plan.width, height: plan.height };
      const [w, h] = [DEPTH_MAP_PX, Math.round((DEPTH_MAP_PX * stage.height) / stage.width)];
      const jobs = missing.map((t) => ({ kaynak: full(t.src), cikti: full(depthFileFor(t.src, t.fit)), mod: t.fit, en: w, boy: t.fit === "kapla" ? h : w }));
      const jobFile = path.join(d.publicDir, ".derinlik-isleri.json");
      await fs.writeFile(jobFile, JSON.stringify(jobs), "utf8");
      const r = d.run ? await d.run(jobFile) : await runProcess(d.python, ["-I", d.script, "--model", d.model, "--harita", jobFile], { cwd: path.dirname(d.script), timeoutMs: d.timeoutMs ?? 20 * 60_000 });
      for (const line of r.stdout.split(/\r?\n/)) {
        try {
          const x = JSON.parse(line) as { ok?: boolean; hata?: string; cikti?: string };
          if (x.ok) yeni++;
          else if (x.cikti) {
            hata++;
            d.log(`  derinlik: ${path.basename(x.cikti)} çıkarılamadı (${(x.hata ?? "").slice(0, 120)})`);
          }
        } catch {
          // Not a result line (a library warning).
        }
      }
      if (r.code !== 0) d.log(`  derinlik: Python çıkış ${r.code} — ${(r.stderr || r.stdout).trim().slice(-200)}`);
      await fs.rm(jobFile, { force: true });
    }
  }
  const made = new Set<string>();
  for (const t of targets) if (await fresh(t)) made.add(depthFileFor(t.src, t.fit));
  return { plan: withDepth(plan, made), yeni, hazir: made.size - yeni, hata };
}
