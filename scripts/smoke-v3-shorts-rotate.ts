/**
 * A Short shows every scene whole (owner, 12 Nov 2026: "bütün sahnelerin gözüktüğünden emin ol, çok yakın duruyor
 * video; yatay videoyu sadece döndürülmüş gibi shorts videoyu ayarla"): by default it is laid out like a 16:9 video
 * (no vertical window) and only its upload file is turned a quarter clockwise into 1080×1920. The turn is proven with
 * the studio's own FFmpeg on a tiny test clip whose top edge is marked: after the turn the mark is on the right edge.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { outputFrame, rotatedShortArgs, SHORTS_SIZE, shortsLayout } from "../src/lib/v3/render/Format";
import { runProcess } from "../src/lib/v3/util/Proc";
import { resolveV3Paths } from "../src/lib/v3/V3Paths";

let scenarios = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    scenarios++;
  } catch (e) {
    console.error(`FAIL: ${name}`);
    throw e;
  }
}

async function run() {
  await scenario("A a Short is laid out whole (no vertical window) unless the old layout is asked for", () => {
    assert.equal(shortsLayout({}), "dondur");
    assert.equal(shortsLayout({ ATOLYE_V3_SHORTS_BICIM: "dikey" }), "dikey");
    assert.equal(shortsLayout({ ATOLYE_V3_SHORTS_BICIM: "baska" }), "dondur");
    assert.equal(outputFrame(true, "dondur"), undefined, "the director lays a rotated Short out like a 16:9 video");
    assert.deepEqual(outputFrame(true, "dikey"), SHORTS_SIZE);
    assert.equal(outputFrame(false, "dikey"), undefined, "a long video never gets the window");
    const a = rotatedShortArgs("in.mp4", "out.mp4");
    assert.equal(a[a.indexOf("-vf") + 1], "transpose=clock");
    assert.equal(a[a.indexOf("-c:a") + 1], "copy", "the sound is not encoded again");
    assert.deepEqual([a[a.indexOf("-i") + 1], a[a.length - 1]], ["in.mp4", "out.mp4"]);
  });

  await scenario("B the studio's FFmpeg turns a 16:9 clip into 9:16, its top edge to the right, sound kept", async () => {
    const paths = resolveV3Paths();
    const dir = mkdtempSync(path.join(os.tmpdir(), "v3-short-dondur-"));
    const src = path.join(dir, "yatay.mp4");
    const out = path.join(dir, "short.mp4");
    // 320×180 grey with a red band along the top edge, 1 s, with a tone.
    const make = await runProcess(paths.ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=320x180:d=1:r=25", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-vf", "drawbox=x=0:y=0:w=320:h=30:color=red:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src], { timeoutMs: 60_000 });
    assert.equal(make.code, 0, make.stderr);
    const turn = await runProcess(paths.ffmpeg, rotatedShortArgs(src, out), { timeoutMs: 60_000 });
    assert.equal(turn.code, 0, turn.stderr);
    const probe = await runProcess(paths.ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", out], { timeoutMs: 30_000 });
    const streams = (JSON.parse(probe.stdout) as { streams: { codec_type: string; width?: number; height?: number }[] }).streams;
    const v = streams.find((s) => s.codec_type === "video")!;
    assert.deepEqual([v.width, v.height], [180, 320], "portrait");
    assert.ok(streams.some((s) => s.codec_type === "audio"), "sound kept");
    // One frame as raw RGB: the right edge's middle is red, the left edge's middle grey.
    const rawFile = path.join(dir, "kare.rgb");
    const raw = await runProcess(paths.ffmpeg, ["-v", "error", "-y", "-i", out, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", rawFile], { timeoutMs: 30_000 });
    assert.equal(raw.code, 0, raw.stderr);
    const buf = readFileSync(rawFile);
    assert.equal(buf.length, 180 * 320 * 3);
    const px = (x: number, y: number) => [buf[(y * 180 + x) * 3]!, buf[(y * 180 + x) * 3 + 1]!, buf[(y * 180 + x) * 3 + 2]!];
    const [rR, rG] = px(170, 160);
    const [lR, lG] = px(10, 160);
    assert.ok(rR > 180 && rG < 80, `right edge red (${px(170, 160)})`);
    assert.ok(Math.abs(lR - lG) < 30, `left edge grey (${px(10, 160)})`);
  });

  console.log(`V3 Shorts rotate smoke: PASS (${scenarios} scenarios)`);
}

run().catch((e) => {
  console.error("V3 Shorts rotate smoke FAILED:", e);
  process.exit(1);
});
