import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { waitForCoolGpu } from "../util/Gpu";
import { runChecked } from "../util/Proc";
import type { V3Paths } from "../V3Paths";
import { type RemotionRenderOptions, renderWithRemotion } from "./RemotionRunner";

/**
 * A long episode is rendered in pieces (owner, 21 Oct 2026: 15–20 minute videos). One render of 18 minutes is about
 * 32,000 frames and ~45 minutes of work (Rome: 3,155 frames in 270 s); a crash near its end lost all of it, and a
 * render killed while writing left a half file that the next run took for a finished one. Here every piece of about
 * CHUNK_TARGET_S is written under a temporary name and keeps its own name only once its frame count is checked; a
 * rerun of the step (the repair brain, an interrupted order) renders only the pieces that are missing. The pieces are
 * joined without re-encoding. Pieces belong to one render key — the plan, the Remotion code and the output settings —
 * so a changed plan or composition never reuses an old piece. The images in the public dir are not part of the key:
 * the plan names them by content hash (sets, portraits), and within one production they do not change.
 */
export const CHUNK_TARGET_S = 180;

export interface RenderChunk {
  /** First and last frame, both rendered (Remotion's `--frames=from-to`). */
  readonly from: number;
  readonly to: number;
}

/**
 * Pieces of about `targetS`, each cut at the shot start nearest its ideal end (within half a piece), else at the
 * ideal frame; a remainder under 1.5 pieces stays with the last one, so a short episode is a single piece.
 */
export function planChunks(durationInFrames: number, cuts: readonly number[], fps: number, targetS = CHUNK_TARGET_S): RenderChunk[] {
  const target = Math.max(1, Math.round(targetS * fps));
  const out: RenderChunk[] = [];
  let start = 0;
  while (start < durationInFrames) {
    if (durationInFrames - start <= target * 1.5) {
      out.push({ from: start, to: durationInFrames - 1 });
      break;
    }
    const ideal = start + target;
    const near = cuts.filter((c) => c >= start + target / 2 && c <= start + target * 1.5).sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0];
    const end = near ?? ideal;
    out.push({ from: start, to: end - 1 });
    start = end;
  }
  return out;
}

/** Every file of the Remotion composition (its source and package.json): a changed component renders anew. */
export async function remotionSourceHash(remotionRoot: string): Promise<string> {
  const h = createHash("sha256");
  const walk = async (dir: string): Promise<string[]> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : Promise.resolve(e.isFile() ? [path.join(dir, e.name)] : []))));
    return nested.flat();
  };
  const files = [...(await walk(path.join(remotionRoot, "src"))), path.join(remotionRoot, "package.json")].sort();
  for (const file of files) h.update(path.relative(remotionRoot, file).replace(/\\/g, "/")).update("\0").update(await fs.readFile(file)).update("\0");
  return h.digest("hex");
}

export function renderKey(planText: string, sourceHash: string, settings: { readonly scale?: number; readonly crf?: number; readonly muted?: boolean }): string {
  return createHash("sha256").update(planText).update("\0").update(sourceHash).update("\0").update(JSON.stringify({ scale: settings.scale ?? 1, crf: settings.crf ?? 18, muted: !!settings.muted })).digest("hex").slice(0, 16);
}

export interface ChunkedRenderOptions extends Pick<RemotionRenderOptions, "planFile" | "publicDir" | "out" | "scale" | "concurrency" | "crf" | "muted"> {
  readonly durationInFrames: number;
  readonly fps: number;
  /** Shot starts (frames): preferred places to cut. */
  readonly cuts: readonly number[];
  /** Folder of the pieces; removed once the video is joined. */
  readonly chunkDir: string;
  readonly targetS?: number;
  readonly log: (s: string) => void;
}

/** What the chunked render runs; the smoke test replaces it. */
export interface ChunkedRenderDeps {
  readonly render: (o: RemotionRenderOptions) => Promise<void>;
  readonly frameCount: (file: string) => Promise<number>;
  readonly join: (listFile: string, out: string) => Promise<void>;
  readonly cool: (log: (s: string) => void) => Promise<void>;
  readonly sourceHash: () => Promise<string>;
}

export function remotionDeps(paths: V3Paths): ChunkedRenderDeps {
  return {
    render: (o) => renderWithRemotion(paths, o),
    // Packets, not decoded frames: fast for a 30,000-frame piece (h264 from Remotion: one packet per frame). The csv
    // writer ends the line with a comma ("60,"), so the bare value is asked for.
    frameCount: async (file) => parseInt((await runChecked(paths.ffprobe, ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "default=nw=1:nk=1", file])).stdout.trim(), 10),
    // The list names the pieces relative to itself (ASCII names; the work dir may be D:\ÜRETİM).
    join: async (listFile, out) => void (await runChecked(paths.ffmpeg, ["-v", "error", "-y", "-f", "concat", "-i", listFile, "-c", "copy", "-movflags", "+faststart", out], { timeoutMs: 30 * 60_000 })),
    // Remotion's Chrome may draw on the card: every piece starts under the owner's temperature rule like other GPU work.
    cool: (log) => waitForCoolGpu(log),
    sourceHash: () => remotionSourceHash(paths.remotionRoot),
  };
}

/** Renders the plan into `out` piece by piece, reusing the pieces a previous attempt of the same render finished. */
export async function renderInChunks(o: ChunkedRenderOptions, deps: ChunkedRenderDeps): Promise<{ chunks: number; reused: number }> {
  const key = renderKey(await fs.readFile(o.planFile, "utf8"), await deps.sourceHash(), o);
  const chunks = planChunks(o.durationInFrames, o.cuts, o.fps, o.targetS);
  const dir = path.join(o.chunkDir, key);
  await fs.mkdir(dir, { recursive: true });
  // Pieces of another plan or code are never joined into this one.
  for (const other of await fs.readdir(o.chunkDir)) if (other !== key) await fs.rm(path.join(o.chunkDir, other), { recursive: true, force: true });
  const files: string[] = [];
  let reused = 0;
  for (const [i, c] of chunks.entries()) {
    const name = `${String(i + 1).padStart(2, "0")}-${c.from}-${c.to}.mp4`;
    const file = path.join(dir, name);
    const frames = c.to - c.from + 1;
    files.push(name);
    if (existsSync(file) && (await deps.frameCount(file).catch(() => -1)) === frames) {
      reused++;
      if (chunks.length > 1) o.log(`  render parça ${i + 1}/${chunks.length} önceki denemeden hazır (${c.from}–${c.to})`);
      continue;
    }
    await fs.rm(file, { force: true });
    await deps.cool(o.log);
    const part = path.join(dir, name.replace(/\.mp4$/, ".yaziliyor.mp4"));
    await fs.rm(part, { force: true });
    let last = "";
    await deps.render({
      planFile: o.planFile,
      publicDir: o.publicDir,
      out: part,
      kind: "video",
      frameRange: [c.from, c.to],
      ...(o.muted ? { muted: true } : {}),
      ...(o.scale ? { scale: o.scale } : {}),
      ...(o.crf ? { crf: o.crf } : {}),
      ...(o.concurrency ? { concurrency: o.concurrency } : {}),
      onLine: (l) => {
        const m = /Rendered (\d+)\/(\d+)/.exec(l);
        if (m && m[1] !== last && Number(m[1]) % 300 === 0) o.log(`  render ${c.from + Number(m[1])}/${o.durationInFrames}${chunks.length > 1 ? ` (parça ${i + 1}/${chunks.length})` : ""}`);
        if (m) last = m[1]!;
        else if (/geç açıldı/.test(l)) o.log(`  ${l}`);
      },
    });
    const got = await deps.frameCount(part);
    if (got !== frames) throw new Error(`V3_RENDER_CHUNK: parça ${i + 1} ${got} kare (beklenen ${frames})`);
    await fs.rename(part, file);
  }
  const joined = o.out.replace(/\.mp4$/, ".yaziliyor.mp4");
  if (files.length === 1) await fs.rename(path.join(dir, files[0]!), joined);
  else {
    const list = path.join(dir, "parcalar.txt");
    await fs.writeFile(list, files.map((n) => `file '${n}'`).join("\n") + "\n");
    await deps.join(list, joined);
  }
  const total = await deps.frameCount(joined);
  if (total !== o.durationInFrames) throw new Error(`V3_RENDER_JOIN: birleşen video ${total} kare (beklenen ${o.durationInFrames})`);
  await fs.rename(joined, o.out);
  await fs.rm(o.chunkDir, { recursive: true, force: true });
  return { chunks: chunks.length, reused };
}
