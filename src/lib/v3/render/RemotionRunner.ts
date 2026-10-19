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

/** Calls the Remotion CLI of `remotion-v3/` through Node directly (no `.cmd` shim, no shell). */
export async function renderWithRemotion(paths: V3Paths, o: RemotionRenderOptions): Promise<void> {
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
