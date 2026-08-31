/**
 * Sprint 173 regression: the final assembled video must actually carry an
 * audible background-music bed under the narration — with fades and ducking —
 * and a run with no music must render narration-only (never a silent "success"
 * that pretends music is present).
 *
 * Root cause of the 302ce03f "no background music" incident: that run's audio
 * stage completed before `stageProjectBackgroundMusic` existed, so no `bgm`
 * asset was ever registered; `resolveBackgroundMusic` found nothing and the
 * render stayed narration-only. The fix stages the licence-cleared bed from the
 * assembly stage too (idempotent, $0), and `appendBgmFilterGraph` now bounds
 * the looped bed to the render length and applies fade-in / fade-out.
 *
 * These scenarios drive the REAL local FFmpeg assembly provider (no API cost)
 * and use `volumedetect` on the output — and on time-windows of it — to prove
 * the music is really in the mix, that the fades attenuate the head and tail,
 * and that the no-music path is genuinely silent in the narration gaps.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  withCanonicalSmokeRuntime,
  type CanonicalSmokeRuntime,
} from "./lib/CanonicalSmokeRuntime";
import { emitSmokeResult } from "./lib/SmokeResult";
import {
  FFmpegVideoAssemblyProvider,
  SpawnRunner,
  type ProcessRunOptions,
  type ProcessRunResult,
  type VideoAssemblyProcessRunner,
} from "../src/lib/assembly/providers/FFmpegVideoAssemblyProvider";
import { stageProjectBackgroundMusic } from "../src/lib/audio/music/AudioMusicSelection";
import { resolveBackgroundMusic } from "../src/lib/assembly/VideoAssemblyManager";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import type { VideoAssemblyInput } from "../src/types/videoAssembly";
import type { AudioData } from "../src/types/audio";

let count = 0;
const NOW = "2026-08-30T12:00:00.000Z";

async function scenario(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (error) {
    console.error(`background-music-mix scenario FAILED: ${name}`);
    throw error;
  }
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function bin(name: string): string {
  try {
    const out = execFileSync("where.exe", [name], { encoding: "utf8" });
    const first = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
    if (first) return first;
  } catch {
    /* ignore */
  }
  return name;
}

/** Mono 16-bit PCM WAV: a tone for `toneUntil` seconds, then digital silence. */
function wav(totalSeconds: number, hz: number, amp: number, toneUntil = totalSeconds): Buffer {
  const rate = 48000;
  const n = Math.max(1, Math.round(rate * totalSeconds));
  const toneSamples = Math.round(rate * Math.min(toneUntil, totalSeconds));
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i += 1) {
    const s = i < toneSamples ? Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * amp) : 0;
    data.writeInt16LE(s, i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function samplePng(): Buffer {
  const committed = path.join(
    process.cwd(), "data", "projects",
    "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5",
    "assets", "images", "3206e749-5cc3-4dfb-b4d6-4d4476bf31ce.png",
  );
  if (fs.existsSync(committed)) return fs.readFileSync(committed);
  return Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de" +
      "0000000c4944415408d763f8cfc00000030001000001000100000000",
    "hex",
  );
}

class CapturingRunner implements VideoAssemblyProcessRunner {
  readonly calls: string[][] = [];
  private readonly inner = new SpawnRunner();
  run(executable: string, args: readonly string[], options: ProcessRunOptions): Promise<ProcessRunResult> {
    this.calls.push([...args]);
    return this.inner.run(executable, args, options);
  }
  /** The ffmpeg render call (the one that builds a filter graph). */
  renderArgs(): string[] {
    return this.calls.find((a) => a.includes("-filter_complex")) ?? [];
  }
}

let ffmpeg = "";
let ffprobe = "";

/** `volumedetect` mean/max dBFS over an optional [start, dur] window. */
function volumeOf(file: string, start?: number, dur?: number): { mean: number; max: number } {
  const args = ["-hide_banner", "-nostats"];
  if (start !== undefined) args.push("-ss", String(start));
  if (dur !== undefined) args.push("-t", String(dur));
  args.push("-i", file, "-map", "0:a", "-af", "volumedetect", "-f", "null", "-");
  // volumedetect prints to stderr on success too, so spawnSync (not execFileSync).
  const stderr = spawnSync(ffmpeg, args, { encoding: "utf8" }).stderr ?? "";
  const mean = /mean_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(stderr)?.[1];
  const max = /max_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(stderr)?.[1];
  return {
    mean: mean ? Number(mean) : Number.NEGATIVE_INFINITY,
    max: max ? Number(max) : Number.NEGATIVE_INFINITY,
  };
}

function probe(file: string) {
  const out = execFileSync(ffprobe, [
    "-v", "error", "-show_entries",
    "format=duration:stream=codec_type,codec_name,duration", "-of", "json", file,
  ], { encoding: "utf8" });
  const p = JSON.parse(out) as {
    format: { duration: string };
    streams: Array<{ codec_type: string; codec_name: string; duration?: string }>;
  };
  const v = p.streams.find((s) => s.codec_type === "video");
  const a = p.streams.find((s) => s.codec_type === "audio");
  return {
    container: Number(p.format.duration),
    videoDur: Number(v?.duration),
    audioDur: Number(a?.duration),
    videoCodec: v?.codec_name,
    audioCodec: a?.codec_name,
  };
}

function decodeClean(file: string): boolean {
  const r = spawnSync(ffmpeg, ["-v", "error", "-xerror", "-i", file, "-f", "null", "-"],
    { encoding: "utf8" });
  return r.status === 0 && !(r.stderr ?? "").trim();
}

function minimalAudioData(): AudioData {
  return {
    narrator: { style: "documentary", tone: "serious", language: "tr" },
    sections: [{
      chapterId: 1, title: "Bölüm 1", duration: "00:03", emotion: "serious",
      emphasis: [], narrationNotes: "n", pacing: "medium", sourceText: "metin",
    }],
    music: { mood: "epic historical siege", suggestion: "dark orchestral bed", intensity: "medium" },
    production: { targetFormat: "wav", sampleRate: 44100, estimatedTotalDuration: "00:03", generationStatus: "generated" },
    createdAt: NOW,
  };
}

async function run(runtime: CanonicalSmokeRuntime, musicRoot: string) {
  const slug = runtime.projectSlug;
  const ctx = runtime.runtimeStorageContext;
  const projDir = path.join(ctx.projectsRoot, slug);
  const imagesDir = path.join(projDir, "assets", "images");
  const audioDir = path.join(projDir, "assets", "audio");
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });

  fs.writeFileSync(path.join(imagesDir, "s1.png"), samplePng());
  // narration: 1.0s of speech-band tone, then a 2.0s gap.
  fs.writeFileSync(path.join(audioDir, "narr.wav"), wav(3.0, 300, 10000, 1.0));
  // narration: 4.0s of pure silence (for the fade test).
  fs.writeFileSync(path.join(audioDir, "silent.wav"), wav(4.0, 300, 0, 0));
  // music bed: loud, longer than any render so the loop/atrim path is exercised.
  const bgmPath = path.join(audioDir, "bgm.wav");
  fs.writeFileSync(bgmPath, wav(6.5, 660, 20000));

  const relImg = `data/projects/${slug}/assets/images/s1.png`;
  const relNarr = `data/projects/${slug}/assets/audio/narr.wav`;
  const relSilent = `data/projects/${slug}/assets/audio/silent.wav`;
  const relBgm = `data/projects/${slug}/assets/audio/bgm.wav`;
  const absOut = (filePath: string) => path.join(projDir, "assets", "videos", path.basename(filePath));

  const sceneWith = (audioFilePath: string, durationSeconds: number): VideoAssemblyInput["scenes"] => [
    { inputType: "image", sceneId: 1, imageFilePath: relImg, audioFilePath, durationSeconds },
  ];

  // 1 — the bgm filter graph carries loop bound + fades + ducking + low volume.
  await scenario("bgm filter graph: -stream_loop + atrim + afade in/out + sidechaincompress + volume=0.15", async () => {
    const capturing = new CapturingRunner();
    const provider = new FFmpegVideoAssemblyProvider(capturing, ctx);
    const result = await provider.assemble({
      projectSlug: slug,
      scenes: sceneWith(relNarr, 3.0),
      backgroundMusic: { filePath: relBgm, volume: 0.15, ducking: true },
    });
    assert.equal(result.success, true, JSON.stringify(result));
    const args = capturing.renderArgs().join(" ");
    assert.match(args, /-stream_loop -1/);
    assert.match(args, /atrim=duration=/);
    assert.match(args, /afade=t=in:st=0:d=/);
    assert.match(args, /afade=t=out:st=/);
    assert.match(args, /sidechaincompress=/);
    assert.match(args, /volume=0\.15/);
  });

  // 2 — the music is audible in the final mix, including in the narration gap.
  await scenario("final mix carries audible music, filling the narration gap", async () => {
    const provider = new FFmpegVideoAssemblyProvider(undefined, ctx);
    const result = await provider.assemble({
      projectSlug: slug,
      scenes: sceneWith(relNarr, 3.0),
      backgroundMusic: { filePath: relBgm, volume: 0.15, ducking: true },
    });
    assert.equal(result.success, true, JSON.stringify(result));
    const out = absOut(result.filePath);
    const p = probe(out);
    assert.equal(p.audioCodec, "aac");
    assert.ok(Math.abs(p.videoDur - 3.0) < 0.4, `video ${p.videoDur}s`);
    assert.ok(Math.abs(p.audioDur - 3.0) < 0.4, `audio ${p.audioDur}s`);
    assert.ok(Math.abs(p.videoDur - p.audioDur) <= 1.0, `A/V skew ${Math.abs(p.videoDur - p.audioDur)}s`);
    // Whole clip: something loud is present.
    assert.ok(volumeOf(out).max > -25, `full max_volume ${volumeOf(out).max}dB`);
    // The 2s narration gap (after the ducking release) must NOT be silent —
    // the music bed fills it.
    const gap = volumeOf(out, 1.6, 1.2);
    assert.ok(gap.max > -45, `narration-gap max_volume ${gap.max}dB — music not audible in the gap`);
    assert.ok(decodeClean(out), "output must decode clean");
  });

  // 3 — with no music, the narration gap is genuinely silent (no fake success).
  await scenario("no music: narration gap is silent (not a silent 'success' pretending music)", async () => {
    const provider = new FFmpegVideoAssemblyProvider(undefined, ctx);
    const result = await provider.assemble({ projectSlug: slug, scenes: sceneWith(relNarr, 3.0) });
    assert.equal(result.success, true, JSON.stringify(result));
    const out = absOut(result.filePath);
    const gap = volumeOf(out, 1.6, 1.2);
    assert.ok(
      gap.max < -80,
      `without music the narration gap must be digital silence, got ${gap.max}dB`,
    );
  });

  // 4 — fade-in attenuates the head, fade-out attenuates the tail.
  await scenario("music bed fades in at the head and out at the tail", async () => {
    const provider = new FFmpegVideoAssemblyProvider(undefined, ctx);
    const result = await provider.assemble({
      projectSlug: slug,
      scenes: sceneWith(relSilent, 4.0),
      backgroundMusic: { filePath: relBgm, volume: 0.4, ducking: false },
    });
    assert.equal(result.success, true, JSON.stringify(result));
    const out = absOut(result.filePath);
    const head = volumeOf(out, 0.0, 0.35).mean;
    const mid = volumeOf(out, 1.8, 0.6).mean;
    const tail = volumeOf(out, 3.75, 0.2).mean;
    assert.ok(mid - head > 6, `expected fade-in (mid ${mid}dB >> head ${head}dB)`);
    assert.ok(mid - tail > 6, `expected fade-out (mid ${mid}dB >> tail ${tail}dB)`);
    assert.ok(volumeOf(out).max <= 0, `combined mix must not clip (max ${volumeOf(out).max}dB)`);
    assert.ok(decodeClean(out), "output must decode clean");
  });

  // 5 — staging → registry → resolve handshake, idempotent (no duplicate on re-run).
  await scenario("stageProjectBackgroundMusic: stages one 'bgm' asset, idempotent, resolvable", async () => {
    fs.mkdirSync(path.join(musicRoot, "epic"), { recursive: true });
    fs.writeFileSync(path.join(musicRoot, "epic", "bed.wav"), wav(5.0, 440, 18000));
    fs.writeFileSync(path.join(musicRoot, "epic", "bed.wav.license.json"), JSON.stringify({
      title: "Epic Bed", source: "Local library", sourceUrl: null,
      license: "CC0", attribution: "Atolye",
    }));
    const project = await ProjectManager.createProject(`bgm-staging ${Date.now()}`);
    const env = { ...process.env, ATOLYE_MUSIC_LIBRARY_ROOT: musicRoot } as NodeJS.ProcessEnv;

    const first = await stageProjectBackgroundMusic({
      projectId: project.id, projectSlug: project.slug, audio: minimalAudioData(),
      musicStyleHint: "epic historical siege", storageContext: ctx, now: () => NOW, env,
    });
    assert.equal(first.staged, true, JSON.stringify(first));
    if (!first.staged) throw new Error("not staged");
    assert.equal(first.asset.id, "bgm");
    assert.equal(first.asset.provider, "music-library");
    assert.equal(first.asset.projectSlug, project.slug);
    assert.equal(first.audio.music.selected?.assetId, "bgm");
    assert.ok(first.rightsStatus === "public-domain" || first.rightsStatus === "open-license" || first.rightsStatus === "verified");

    const again = await stageProjectBackgroundMusic({
      projectId: project.id, projectSlug: project.slug, audio: minimalAudioData(),
      musicStyleHint: "epic historical siege", storageContext: ctx, now: () => NOW, env,
    });
    assert.equal(again.staged, true);
    const registry = AssetManager.getProjectAssets(project.slug, project.id, ctx);
    const bgmAssets = registry.assets.filter((a) => a.id === "bgm");
    assert.equal(bgmAssets.length, 1, "re-staging must not create a duplicate 'bgm' asset");

    const resolved = resolveBackgroundMusic(project.slug, registry.assets);
    assert.ok(resolved, "resolveBackgroundMusic must find the staged bed");
    assert.equal(resolved?.filePath, bgmAssets[0].filePath);
    assert.equal(resolved?.volume, 0.15);
    assert.equal(resolved?.ducking, true);
  });

  // 6 — a resolved staged bed flows through a real render and is audible.
  await scenario("staged bed → resolveBackgroundMusic → real render carries the music", async () => {
    const project = await ProjectManager.createProject(`bgm-render ${Date.now()}`);
    const env = { ...process.env, ATOLYE_MUSIC_LIBRARY_ROOT: musicRoot } as NodeJS.ProcessEnv;
    const staged = await stageProjectBackgroundMusic({
      projectId: project.id, projectSlug: project.slug, audio: minimalAudioData(),
      musicStyleHint: "epic historical siege", storageContext: ctx, now: () => NOW, env,
    });
    assert.equal(staged.staged, true);
    if (!staged.staged) throw new Error("not staged");
    const resolved = resolveBackgroundMusic(
      project.slug,
      AssetManager.getProjectAssets(project.slug, project.id, ctx).assets,
    );
    assert.ok(resolved);

    const pImagesDir = path.join(ctx.projectsRoot, project.slug, "assets", "images");
    const pAudioDir = path.join(ctx.projectsRoot, project.slug, "assets", "audio");
    fs.mkdirSync(pImagesDir, { recursive: true });
    fs.mkdirSync(pAudioDir, { recursive: true });
    fs.writeFileSync(path.join(pImagesDir, "s1.png"), samplePng());
    fs.writeFileSync(path.join(pAudioDir, "narr.wav"), wav(2.5, 300, 9000, 0.8));

    const provider = new FFmpegVideoAssemblyProvider(undefined, ctx);
    const result = await provider.assemble({
      projectSlug: project.slug,
      scenes: [{
        inputType: "image", sceneId: 1,
        imageFilePath: `data/projects/${project.slug}/assets/images/s1.png`,
        audioFilePath: `data/projects/${project.slug}/assets/audio/narr.wav`,
        durationSeconds: 2.5,
      }],
      backgroundMusic: resolved,
    });
    assert.equal(result.success, true, JSON.stringify(result));
    const out = path.join(ctx.projectsRoot, project.slug, "assets", "videos", path.basename(result.filePath));
    const gap = volumeOf(out, 1.4, 0.9);
    assert.ok(gap.max > -45, `staged bed not audible in the narration gap (${gap.max}dB)`);
    assert.ok(decodeClean(out));
  });

  emitSmokeResult("assembly-background-music-mix", count);
  console.log(`Assembly background-music mix smoke: PASS (${count} scenarios)`);
}

async function main() {
  ffmpeg = process.env.FFMPEG_EXECUTABLE?.trim() || process.env.FFMPEG_PATH || bin("ffmpeg");
  ffprobe = process.env.FFPROBE_EXECUTABLE?.trim() || process.env.FFPROBE_PATH || bin("ffprobe");
  const musicRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-bgm-mix-music-"));
  try {
    await withCanonicalSmokeRuntime(
      {
        name: "assembly-background-music-mix",
        configureProductionExecution: true,
        environment: { VIDEO_ASSEMBLY_PROVIDER: "ffmpeg", FFMPEG_PATH: ffmpeg, FFPROBE_PATH: ffprobe },
      },
      async (runtime) => { await run(runtime, musicRoot); },
    );
  } finally {
    fs.rmSync(musicRoot, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("Assembly background-music mix smoke FAILED:", error);
  process.exitCode = 1;
});
