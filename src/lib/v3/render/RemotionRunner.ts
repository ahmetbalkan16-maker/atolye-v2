import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { runChecked } from "../util/Proc";
import type { V3Paths } from "../V3Paths";

export interface RemotionRenderOptions {
  /** JSON file holding the composition props: `{ "plan": V3RenderPlan }`. */
  readonly planFile: string;
  readonly publicDir: string;
  readonly out: string;
  /** `still` renders one frame as PNG. */
  readonly kind: "video" | "still";
  readonly frame?: number;
  /** Output scale; 0.4447 turns 1080p into 480p for previews. */
  readonly scale?: number;
  readonly concurrency?: number;
  readonly crf?: number;
  /** Render without the plan's audio track (the mixer muxes the final soundtrack). */
  readonly muted?: boolean;
  readonly frameRange?: readonly [number, number];
  readonly onLine?: (line: string) => void;
}

/** Remotion's own headless Chrome (downloaded on the first render into `remotion-v3/node_modules/.remotion`). */
export function remotionBrowser(paths: Pick<V3Paths, "remotionRoot">): string {
  return path.join(paths.remotionRoot, "node_modules", ".remotion", "chrome-headless-shell", "win64", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
}

/**
 * Starts Remotion's Chrome once and closes it as soon as it listens. Remotion gives Chrome a fixed 25 s to start
 * (Launcher.js, not configurable); right after the judge model left memory the first start sometimes took longer, so
 * the render died at once and the repair brain had to rerun it (Rome, 21 Oct 2026: 2 of 4 renders). Here Chrome may
 * take up to `maxMs`; the render's own start is then quick. Returns the seconds it took, or undefined if there was
 * nothing to warm or it did not start (the render then tries as before).
 */
export async function warmRemotionBrowser(paths: Pick<V3Paths, "remotionRoot" | "asciiTemp">, maxMs = 120_000): Promise<number | undefined> {
  const exe = remotionBrowser(paths);
  if (process.platform !== "win32" || !existsSync(exe)) return undefined;
  mkdirSync(paths.asciiTemp, { recursive: true });
  const profile = mkdtempSync(path.join(paths.asciiTemp, "chrome-isinma-"));
  const started = Date.now();
  try {
    return await new Promise<number | undefined>((resolve) => {
      const child = spawn(exe, ["--headless", "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let out = "";
      const done = (v: number | undefined) => {
        clearTimeout(timer);
        child.kill();
        resolve(v);
      };
      const timer = setTimeout(() => done(undefined), maxMs);
      const onData = (d: Buffer) => {
        out += d.toString("utf8");
        if (/DevTools listening on ws:/.test(out)) done(Math.round((Date.now() - started) / 100) / 10);
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", () => done(undefined));
      child.on("exit", () => done(undefined));
    });
  } finally {
    await new Promise((r) => setTimeout(r, 500));
    rmSync(profile, { recursive: true, force: true });
  }
}

/** Calls the Remotion CLI of `remotion-v3/` through Node directly (no `.cmd` shim, no shell). */
export async function renderWithRemotion(paths: V3Paths, o: RemotionRenderOptions): Promise<void> {
  const warm = await warmRemotionBrowser(paths).catch(() => undefined);
  if (warm !== undefined && warm > 10) o.onLine?.(`render tarayıcısı geç açıldı (${warm} sn; ısınma turu sayesinde render beklemedi)`);
  const cli = path.join(paths.remotionRoot, "node_modules", "@remotion", "cli", "remotion-cli.js");
  const args = [cli, o.kind === "still" ? "still" : "render", "src/index.ts", "Episode", o.out, `--props=${o.planFile}`, `--public-dir=${o.publicDir}`, "--log=info"];
  if (o.kind === "still") args.push(`--frame=${o.frame ?? 0}`, "--image-format=png");
  else {
    args.push("--codec=h264", `--crf=${o.crf ?? 18}`, "--pixel-format=yuv420p");
    if (o.concurrency) args.push(`--concurrency=${o.concurrency}`);
    if (o.muted) args.push("--muted");
    if (o.frameRange) args.push(`--frames=${o.frameRange[0]}-${o.frameRange[1]}`);
  }
  if (o.scale && o.scale !== 1) args.push(`--scale=${o.scale}`);
  await runChecked(process.execPath, args, { cwd: paths.remotionRoot, onLine: o.onLine, timeoutMs: 6 * 60 * 60 * 1000 });
}
