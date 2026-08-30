/**
 * Documentary media effort — Faz 4: licence-cleared background music + SFX/
 * ambience abstraction wired into the audio stage.
 *
 * NO real network / paid API. WAV fixtures are generated in-process; the one
 * transcode scenario uses the local ffmpeg only when FFMPEG_PATH is set.
 *
 * Scenarios:
 *   A empty library                 -> skip "no-track-in-library", deterministic
 *   B unknown-licence track         -> skip "rights-not-admissible", no bgm asset
 *   C restricted-licence track      -> skip "rights-not-admissible"
 *   D admissible WAV track          -> staged bgm asset + full provenance
 *   E staging is deterministic + idempotent (same track, same asset id)
 *   F resolveBackgroundMusic handshake: ducking on, volume in range, deterministic
 *   G SfxLibrary optional path: empty -> null; admissible ambience -> selected;
 *     unknown-licence sfx -> not admissible / not selected
 *   H compressed track transcodes to WAV when ffmpeg is available (else skip)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emitSmokeResult } from "./lib/SmokeResult";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { AssetManager } from "../src/lib/assets/AssetManager";
import {
  stageProjectBackgroundMusic,
  BACKGROUND_MUSIC_ASSET_ID,
} from "../src/lib/audio/music/AudioMusicSelection";
import { resolveBackgroundMusic } from "../src/lib/assembly/VideoAssemblyManager";
import {
  listSfxForCategory,
  normalizeSfxCategory,
  selectAmbienceBed,
  selectSfxClip,
} from "../src/lib/audio/sfx/SfxLibrary";
import type { AudioData } from "../src/types/audio";
import type { RuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";

const NOW = "2026-08-29T00:00:00.000Z";
let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function minimalWav(durationSeconds: number, frequency = 220): Buffer {
  const sampleRate = 48000;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate;
    buffer.writeInt16LE(Math.floor(Math.sin(2 * Math.PI * frequency * t) * 12000), 44 + i * 2);
  }
  return buffer;
}

function audioData(): AudioData {
  return {
    narrator: { style: "deep documentary", tone: "serious", language: "tr" },
    sections: [
      { chapterId: 1, title: "Bölüm 1", duration: "00:30", emotion: "serious", emphasis: [], narrationNotes: "n", pacing: "medium", sourceText: "metin" },
    ],
    music: { mood: "historical dramatic siege", suggestion: "dark orchestral documentary bed", intensity: "medium" },
    production: { targetFormat: "wav", sampleRate: 44100, estimatedTotalDuration: "00:30", generationStatus: "generated" },
    createdAt: NOW,
  };
}

let musicRoot = "";
let sfxRoot = "";
let libEnv: NodeJS.ProcessEnv;
let ctx: RuntimeStorageContext;

function clearLibrary(root: string) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
}

function writeTrack(root: string, mood: string, name: string, data: Buffer, license?: Record<string, unknown>) {
  const dir = path.join(root, mood);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), data);
  if (license) fs.writeFileSync(path.join(dir, `${name}.license.json`), JSON.stringify(license));
}

function ffmpegConfig() {
  const ffmpegPath = process.env.FAZ4_FFMPEG_PATH;
  const ffprobePath = process.env.FAZ4_FFPROBE_PATH;
  if (!ffmpegPath || !ffprobePath) return undefined;
  return () => ({
    ffmpegPath, ffprobePath,
    timeoutMs: 30_000, maxOutputBytes: 64 * 1024 * 1024, maxStdioBytes: 1024 * 1024,
  });
}

async function stage(projectId: string, projectSlug: string, over: Partial<Parameters<typeof stageProjectBackgroundMusic>[0]> = {}) {
  return stageProjectBackgroundMusic({
    projectId,
    projectSlug,
    audio: audioData(),
    musicStyleHint: "historical siege march",
    storageContext: ctx,
    now: () => NOW,
    env: libEnv,
    ...over,
  });
}

async function newProject(topic: string) {
  const p = await ProjectManager.createProject(topic);
  return { id: p.id, slug: p.slug };
}

async function run() {
  // A -------------------------------------------------------------------
  await scenario("A: empty library -> skip 'no-track-in-library', deterministic", async () => {
    clearLibrary(musicRoot);
    const p = await newProject(`faz4 empty ${Date.now()}`);
    const first = await stage(p.id, p.slug);
    const second = await stage(p.id, p.slug);
    assert.equal(first.staged, false);
    assert.equal(second.staged, false);
    if (!first.staged) assert.equal(first.reason, "no-track-in-library");
    const assets = AssetManager.getProjectAssets(p.slug, p.id, ctx);
    assert.equal(assets.assets.some((a) => a.id === BACKGROUND_MUSIC_ASSET_ID), false);
    assert.equal(first.audio.music.selected, undefined);
  });

  // B -------------------------------------------------------------------
  await scenario("B: unknown-licence track -> rights-not-admissible, no bgm asset", async () => {
    clearLibrary(musicRoot);
    writeTrack(musicRoot, "historical", "unknown.wav", minimalWav(1.2), {
      title: "Unmarked", source: "somewhere",
    });
    const p = await newProject(`faz4 unknown ${Date.now()}`);
    const outcome = await stage(p.id, p.slug);
    assert.equal(outcome.staged, false);
    if (!outcome.staged) assert.equal(outcome.reason, "rights-not-admissible");
    const assets = AssetManager.getProjectAssets(p.slug, p.id, ctx);
    assert.equal(assets.assets.some((a) => a.id === BACKGROUND_MUSIC_ASSET_ID), false);
  });

  // C -------------------------------------------------------------------
  await scenario("C: restricted-licence track -> rights-not-admissible", async () => {
    clearLibrary(musicRoot);
    writeTrack(musicRoot, "historical", "arr.wav", minimalWav(1.2), {
      title: "Copyrighted Score", license: "All Rights Reserved",
    });
    const p = await newProject(`faz4 restricted ${Date.now()}`);
    const outcome = await stage(p.id, p.slug);
    assert.equal(outcome.staged, false);
    if (!outcome.staged) assert.equal(outcome.reason, "rights-not-admissible");
  });

  // D -------------------------------------------------------------------
  await scenario("D: admissible WAV track -> staged bgm asset + provenance", async () => {
    clearLibrary(musicRoot);
    writeTrack(musicRoot, "historical", "siege-bed.wav", minimalWav(2.0), {
      title: "Siege Bed", source: "Free Music Archive",
      sourceUrl: "https://freemusicarchive.org/x", license: "CC BY 4.0",
      attribution: "Composer / FMA",
    });
    const p = await newProject(`faz4 admissible ${Date.now()}`);
    const outcome = await stage(p.id, p.slug);
    assert.equal(outcome.staged, true, outcome.staged ? "" : outcome.reason);
    if (!outcome.staged) return;
    assert.equal(outcome.asset.id, BACKGROUND_MUSIC_ASSET_ID);
    assert.equal(outcome.asset.type, "audio");
    assert.equal(outcome.asset.mediaOrigin, "real");
    assert.equal(outcome.asset.mediaType, "music");
    assert.equal(outcome.asset.rightsStatus, "open-license");
    assert.equal(outcome.asset.provider, "music-library");
    assert.equal(outcome.asset.sourceUrl, "https://freemusicarchive.org/x");
    assert.equal(outcome.asset.license, "CC BY 4.0");
    assert.equal(outcome.asset.attribution, "Composer / FMA");
    assert.equal(typeof outcome.asset.checksum, "string");
    assert.ok((outcome.asset.durationSeconds ?? 0) > 0);
    assert.equal(outcome.audio.music.selected?.assetId, BACKGROUND_MUSIC_ASSET_ID);
    assert.equal(outcome.audio.music.selected?.rightsStatus, "open-license");
    assert.equal(outcome.audio.music.selected?.mood, "historical");
    // physically on disk under the project audio dir
    const stored = AssetManager.getProjectAssets(p.slug, p.id, ctx).assets.find((a) => a.id === BACKGROUND_MUSIC_ASSET_ID);
    assert.ok(stored?.filePath?.endsWith("/bgm.wav"));
  });

  // E -------------------------------------------------------------------
  await scenario("E: staging is deterministic + idempotent", async () => {
    clearLibrary(musicRoot);
    writeTrack(musicRoot, "historical", "a-bed.wav", minimalWav(1.5), { title: "A", license: "CC0 1.0" });
    writeTrack(musicRoot, "historical", "b-bed.wav", minimalWav(1.5), { title: "B", license: "CC0 1.0" });
    const p = await newProject(`faz4 deterministic ${Date.now()}`);
    const first = await stage(p.id, p.slug);
    const second = await stage(p.id, p.slug);
    assert.equal(first.staged && second.staged, true);
    if (!first.staged || !second.staged) return;
    assert.ok(first.track && second.track);
    assert.equal(first.track?.fileName, second.track?.fileName);
    assert.equal(first.asset.id, second.asset.id);
    const bgmAssets = AssetManager.getProjectAssets(p.slug, p.id, ctx).assets.filter((a) => a.id === BACKGROUND_MUSIC_ASSET_ID);
    assert.equal(bgmAssets.length, 1, "idempotent staging must not duplicate the bgm asset");
  });

  // F -------------------------------------------------------------------
  await scenario("F: resolveBackgroundMusic handshake - ducking on, volume in range, deterministic", async () => {
    clearLibrary(musicRoot);
    writeTrack(musicRoot, "historical", "bed.wav", minimalWav(2.0), { title: "Bed", license: "Public Domain" });
    const p = await newProject(`faz4 handshake ${Date.now()}`);
    const outcome = await stage(p.id, p.slug);
    assert.equal(outcome.staged, true);
    const assets = AssetManager.getProjectAssets(p.slug, p.id, ctx).assets;
    const first = resolveBackgroundMusic(p.slug, assets);
    const again = resolveBackgroundMusic(p.slug, assets);
    assert.ok(first);
    assert.deepEqual(first, again);
    assert.equal(first?.ducking, true);
    assert.ok((first?.volume ?? 0) > 0 && (first?.volume ?? 0) <= 2.0);
    assert.ok(first?.filePath.endsWith("/bgm.wav"));
  });

  // G -------------------------------------------------------------------
  await scenario("G: SfxLibrary optional path (empty -> null; admissible -> selected; unknown -> not admissible)", () => {
    clearLibrary(sfxRoot);
    assert.equal(normalizeSfxCategory("battle cannon siege"), "battle");
    assert.equal(normalizeSfxCategory("room tone atmosfer"), "ambience");
    assert.equal(normalizeSfxCategory("nothing relevant"), null);
    assert.equal(selectSfxClip("battle cannon", "seed", libEnv), null);
    assert.equal(selectAmbienceBed(["distant crowd", "wind ambience"], "seed", libEnv), null);

    fs.mkdirSync(path.join(sfxRoot, "ambience"), { recursive: true });
    fs.writeFileSync(path.join(sfxRoot, "ambience", "wind.wav"), minimalWav(0.5));
    fs.writeFileSync(
      path.join(sfxRoot, "ambience", "wind.wav.license.json"),
      JSON.stringify({ title: "Wind", license: "CC0" }),
    );
    fs.writeFileSync(path.join(sfxRoot, "ambience", "market.wav"), minimalWav(0.5));
    fs.writeFileSync(
      path.join(sfxRoot, "ambience", "market.wav.license.json"),
      JSON.stringify({ title: "Market", license: "All Rights Reserved" }),
    );
    const clips = listSfxForCategory("ambience", libEnv);
    assert.equal(clips.length, 2);
    assert.equal(clips.find((c) => c.fileName === "wind.wav")?.admissible, true);
    assert.equal(clips.find((c) => c.fileName === "market.wav")?.admissible, false);
    const picked = selectAmbienceBed(["wind ambience over the walls"], "seed", libEnv);
    assert.equal(picked?.fileName, "wind.wav");
    assert.equal(picked?.admissible, true);
  });

  // H -------------------------------------------------------------------
  await scenario("H: compressed track transcodes to WAV when ffmpeg is available", async () => {
    const ffmpegPath = process.env.FAZ4_FFMPEG_PATH;
    const ffprobePath = process.env.FAZ4_FFPROBE_PATH;
    clearLibrary(musicRoot);
    // Non-wav bytes: without a real transcoder the staging must fail closed.
    writeTrack(musicRoot, "historical", "compressed.mp3", Buffer.from("ID3   fake mp3 payload"), {
      title: "Compressed", license: "CC0 1.0",
    });
    const p = await newProject(`faz4 transcode ${Date.now()}`);

    if (!ffmpegPath || !ffprobePath) {
      const outcome = await stage(p.id, p.slug, {
        loadFFmpegConfig: () => {
          throw new Error("ffmpeg not configured");
        },
      });
      assert.equal(outcome.staged, false);
      if (!outcome.staged) assert.equal(outcome.reason, "transcode-unavailable");
      return;
    }

    // real ffmpeg present: generate a real mp3 fixture and transcode it
    const { spawnSync } = await import("node:child_process");
    const realMp3 = path.join(musicRoot, "historical", "real.mp3");
    const gen = spawnSync(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-f", "lavfi", "-i", "sine=frequency=220:duration=1.5",
      "-c:a", "libmp3lame", "-b:a", "96k", realMp3,
    ], { timeout: 30_000, windowsHide: true });
    assert.equal(gen.status, 0, gen.stderr?.toString());
    fs.rmSync(path.join(musicRoot, "historical", "compressed.mp3"), { force: true });
    fs.rmSync(path.join(musicRoot, "historical", "compressed.mp3.license.json"), { force: true });
    fs.writeFileSync(`${realMp3}.license.json`, JSON.stringify({ title: "Real", license: "CC0 1.0" }));

    const outcome = await stage(p.id, p.slug, {
      loadFFmpegConfig: () => ({
        ffmpegPath,
        ffprobePath,
        timeoutMs: 30_000,
        maxOutputBytes: 64 * 1024 * 1024,
        maxStdioBytes: 1024 * 1024,
      }),
    });
    assert.equal(outcome.staged, true, outcome.staged ? "" : outcome.reason);
    if (!outcome.staged) return;
    assert.ok(outcome.asset.filePath?.endsWith("/bgm.wav"));
    assert.ok((outcome.asset.durationSeconds ?? 0) > 0);
  });

  // I ---------------------------------------------------------------------
  await scenario("I: music + admissible ambience -> mixed bed (or graceful music-only)", async () => {
    clearLibrary(musicRoot);
    clearLibrary(sfxRoot);
    writeTrack(musicRoot, "historical", "bed.wav", minimalWav(2.0, 220), { title: "Bed", license: "CC0 1.0" });
    fs.mkdirSync(path.join(sfxRoot, "ambience"), { recursive: true });
    fs.writeFileSync(path.join(sfxRoot, "ambience", "wind.wav"), minimalWav(2.0, 90));
    fs.writeFileSync(path.join(sfxRoot, "ambience", "wind.wav.license.json"), JSON.stringify({ title: "Wind", source: "FreeSound", sourceUrl: "https://freesound.org/x", license: "CC0" }));
    const p = await newProject(`faz4 mixed ${Date.now()}`);
    const outcome = await stage(p.id, p.slug, {
      ambienceHints: ["wind ambience over the walls", "distant sea"],
      loadFFmpegConfig: ffmpegConfig(),
    });
    assert.equal(outcome.staged, true, outcome.staged ? "" : outcome.reason);
    if (!outcome.staged) return;
    assert.equal(outcome.asset.id, BACKGROUND_MUSIC_ASSET_ID);
    assert.ok(outcome.asset.filePath?.endsWith("/bgm.wav"));
    if (ffmpegConfig()) {
      // real ffmpeg present -> ambience is actually mixed in
      assert.ok(outcome.ambience, "ambience info present when mixed");
      assert.equal(outcome.ambience?.category, "ambience");
      assert.equal(outcome.asset.selectionReason, "library-mood-match+ambience");
      assert.match(outcome.asset.attribution ?? "", /Wind/);
    }
    // still a valid single bgm asset the assembly can consume
    const bgm = resolveBackgroundMusic(p.slug, AssetManager.getProjectAssets(p.slug, p.id, ctx).assets);
    assert.ok(bgm?.filePath.endsWith("/bgm.wav"));
    assert.equal(bgm?.ducking, true);
  });

  // J ---------------------------------------------------------------------
  await scenario("J: ambience only (no music track) -> ambience bed staged", async () => {
    clearLibrary(musicRoot);
    clearLibrary(sfxRoot);
    fs.mkdirSync(path.join(sfxRoot, "ambience"), { recursive: true });
    fs.writeFileSync(path.join(sfxRoot, "ambience", "room.wav"), minimalWav(1.5, 110));
    fs.writeFileSync(path.join(sfxRoot, "ambience", "room.wav.license.json"), JSON.stringify({ title: "Room Tone", license: "Public Domain" }));
    const p = await newProject(`faz4 ambience-only ${Date.now()}`);
    const outcome = await stage(p.id, p.slug, { ambienceHints: ["palace room ambience"] });
    assert.equal(outcome.staged, true, outcome.staged ? "" : outcome.reason);
    if (!outcome.staged) return;
    assert.equal(outcome.track, null);
    assert.equal(outcome.asset.mediaType, "ambience");
    assert.equal(outcome.asset.selectionReason, "library-ambience-match");
    assert.equal(outcome.ambience?.title, "Room Tone");
  });

  // K ---------------------------------------------------------------------
  await scenario("K: inadmissible ambience is dropped, music-only bed stays", async () => {
    clearLibrary(musicRoot);
    clearLibrary(sfxRoot);
    writeTrack(musicRoot, "historical", "bed.wav", minimalWav(1.5), { title: "Bed", license: "CC0 1.0" });
    fs.mkdirSync(path.join(sfxRoot, "ambience"), { recursive: true });
    fs.writeFileSync(path.join(sfxRoot, "ambience", "crowd.wav"), minimalWav(1.5, 100));
    fs.writeFileSync(path.join(sfxRoot, "ambience", "crowd.wav.license.json"), JSON.stringify({ title: "Crowd", license: "All Rights Reserved" }));
    const p = await newProject(`faz4 inadmissible-ambience ${Date.now()}`);
    const outcome = await stage(p.id, p.slug, { ambienceHints: ["crowd ambience atmosphere"] });
    assert.equal(outcome.staged, true);
    if (!outcome.staged) return;
    assert.ok(outcome.track, "music track still staged");
    assert.equal(outcome.ambience, undefined, "inadmissible ambience must not be attached");
    assert.equal(outcome.asset.selectionReason, "library-mood-match");
  });

  console.log(`Faz 4 audio music/SFX smoke: PASS (${count} scenarios)`);
  emitSmokeResult("faz4-audio-music-sfx", count);
}

async function main() {
  musicRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-faz4-music-"));
  sfxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-faz4-sfx-"));
  const ffmpegPath = process.env.FFMPEG_EXECUTABLE?.trim() || process.env.FFMPEG_PATH;
  const ffprobePath = process.env.FFPROBE_EXECUTABLE?.trim() || process.env.FFPROBE_PATH;
  try {
    await withCanonicalSmokeRuntime(
      {
        name: "faz4-audio-music-sfx",
        operationType: "faz4-audio-smoke",
        environment: {
          ATOLYE_MUSIC_LIBRARY_ROOT: musicRoot,
          ATOLYE_SFX_LIBRARY_ROOT: sfxRoot,
          FAZ4_FFMPEG_PATH: ffmpegPath,
          FAZ4_FFPROBE_PATH: ffprobePath,
        },
      },
      async (runtime) => {
        ctx = runtime.runtimeStorageContext;
        libEnv = { ...process.env } as NodeJS.ProcessEnv;
        await run();
      },
    );
  } finally {
    fs.rmSync(musicRoot, { recursive: true, force: true });
    fs.rmSync(sfxRoot, { recursive: true, force: true });
  }
}

void main();
