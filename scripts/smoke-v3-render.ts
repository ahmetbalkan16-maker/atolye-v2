/**
 * V3 smoke: the long episode's render in pieces — where it cuts, what makes a piece reusable, and that a rerun renders
 * only the missing pieces. The renderer, the frame counter and the join are fakes (no Remotion, no FFmpeg).
 * Run: npx tsx scripts/smoke-v3-render.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHUNK_TARGET_S, type ChunkedRenderDeps, planChunks, renderInChunks, renderKey } from "../src/lib/v3/render/ChunkedRender";
import { PREVIEW_SCALE } from "../src/lib/v3/render/RemotionRunner";

let scenarios = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
  scenarios++;
}

/** A fake renderer: a "video" is a text file holding its frame count. */
function fakeDeps(opts: { failAt?: number; shortAt?: number; source?: string } = {}) {
  const rendered: [number, number][] = [];
  let joinedList = "";
  const deps: ChunkedRenderDeps = {
    render: async (o) => {
      const [from, to] = o.frameRange!;
      if (opts.failAt === from) throw new Error("Chrome crashed");
      rendered.push([from, to]);
      await fs.writeFile(o.out, String(to - from + 1 - (opts.shortAt === from ? 1 : 0)));
    },
    frameCount: async (file) => Number(await fs.readFile(file, "utf8")),
    join: async (list, out) => {
      joinedList = await fs.readFile(list, "utf8");
      const names = joinedList.trim().split("\n").map((l) => /^file '(.+)'$/.exec(l)![1]!);
      let n = 0;
      for (const name of names) n += Number(await fs.readFile(path.join(path.dirname(list), name), "utf8"));
      await fs.writeFile(out, String(n));
    },
    cool: async () => undefined,
    sourceHash: async () => opts.source ?? "src-1",
  };
  return { deps, rendered, list: () => joinedList };
}

async function main() {
  await scenario("A a short episode is one piece; a long one is cut near every 3 minutes, at a shot start when one is close", () => {
    assert.deepEqual(planChunks(3155, [0, 105, 494], 30), [{ from: 0, to: 3154 }], "Rome (105 s): one render, as before");
    const total = 18 * 60 * 30;
    const shots = Array.from({ length: 80 }, (_, i) => i * 405);
    const chunks = planChunks(total, shots, 30);
    assert.equal(chunks[0]!.from, 0);
    assert.equal(chunks[chunks.length - 1]!.to, total - 1);
    for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i]!.from, chunks[i - 1]!.to + 1, "no gap, no overlap");
    for (const c of chunks.slice(1)) assert.ok(shots.includes(c.from), `piece starts on a shot (${c.from})`);
    assert.ok(chunks.length >= 5 && chunks.length <= 7, `${chunks.length} pieces of ~${CHUNK_TARGET_S} s`);
    // No shot start near the ideal cut: the cut falls on the ideal frame.
    assert.deepEqual(planChunks(600, [0], 1, 200).map((c) => c.from), [0, 200, 400]);
    // A remainder under 1.5 pieces stays with the last one.
    assert.deepEqual(planChunks(250, [], 1, 100).map((c) => [c.from, c.to]), [[0, 99], [100, 249]]);
  });

  await scenario("B the render key follows the plan, the Remotion code and the output settings", () => {
    const k = renderKey("{plan}", "src", { muted: true });
    assert.equal(k, renderKey("{plan}", "src", { muted: true, crf: 18, scale: 1 }), "defaults are the same render");
    assert.notEqual(k, renderKey("{plan2}", "src", { muted: true }));
    assert.notEqual(k, renderKey("{plan}", "src2", { muted: true }), "a changed component renders anew");
    assert.notEqual(k, renderKey("{plan}", "src", { muted: true, scale: PREVIEW_SCALE }), "a preview never reuses full pieces");
  });

  const tmp = mkdtempSync(path.join(os.tmpdir(), "v3-render-"));
  const planFile = path.join(tmp, "plan.json");
  await fs.writeFile(planFile, '{"plan":1}');
  const base = { planFile, publicDir: tmp, out: path.join(tmp, "video-sessiz.mp4"), chunkDir: path.join(tmp, "render-parcalar"), durationInFrames: 1000, fps: 1, cuts: [], targetS: 300, muted: true, log: () => undefined };

  await scenario("C a crash keeps the finished pieces; the rerun renders only the missing ones and joins them in order", async () => {
    const first = fakeDeps({ failAt: 600 });
    await assert.rejects(renderInChunks(base, first.deps), /Chrome crashed/);
    assert.deepEqual(first.rendered, [[0, 299], [300, 599]]);
    assert.ok(!existsSync(base.out), "no half video for the next run to take as finished");
    const second = fakeDeps();
    const r = await renderInChunks(base, second.deps);
    assert.deepEqual(second.rendered, [[600, 999]], "only the missing piece");
    assert.deepEqual(r, { chunks: 3, reused: 2 });
    assert.deepEqual(second.list().trim().split("\n"), ["file '01-0-299.mp4'", "file '02-300-599.mp4'", "file '03-600-999.mp4'"]);
    assert.equal(await fs.readFile(base.out, "utf8"), "1000");
    assert.ok(!existsSync(base.chunkDir), "pieces are removed once joined");
  });

  await scenario("D a piece with the wrong frame count is never kept; a changed plan or code drops the old pieces", async () => {
    const short = fakeDeps({ shortAt: 300 });
    await assert.rejects(renderInChunks(base, short.deps), /V3_RENDER_CHUNK: parça 2 299 kare \(beklenen 300\)/);
    const [keyDir] = await fs.readdir(base.chunkDir);
    assert.deepEqual((await fs.readdir(path.join(base.chunkDir, keyDir!))).sort(), ["01-0-299.mp4", "02-300-599.yaziliyor.mp4"], "the short piece stays a temporary file");
    const changed = fakeDeps({ source: "src-2" });
    await renderInChunks(base, changed.deps);
    assert.deepEqual(changed.rendered, [[0, 299], [300, 599], [600, 999]], "new Remotion code: every piece again");
  });

  await scenario("E one piece: no join, the video is the piece", async () => {
    const one = fakeDeps();
    const r = await renderInChunks({ ...base, durationInFrames: 120 }, one.deps);
    assert.deepEqual(r, { chunks: 1, reused: 0 });
    assert.equal(one.list(), "", "no concat for a single piece");
    assert.equal(await fs.readFile(base.out, "utf8"), "120");
  });

  await fs.rm(tmp, { recursive: true, force: true });
  console.log(`V3 render smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
