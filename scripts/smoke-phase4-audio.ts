/**
 * Phase 4 — audio / music / SFX (integration).
 *
 * NO real API. Throwaway on-disk music + SFX libraries under temp roots.
 * Complements the unit-level `smoke-faz4-audio-music-sfx` with the narration-
 * state matrix and backward compatibility.
 *
 *   A  narration only (empty libraries)      -> no bed, narration-only
 *   B  narration + music                      -> music bed staged
 *   C  narration + ambience (no music)        -> ambience bed staged
 *   D  narration + music + ambience           -> mixed bed (or graceful music-only)
 *   E  ducking: resolveBackgroundMusic -> ducking on, volume in range
 *   F  rights rejection: restricted music / restricted ambience -> not staged
 *   G  deterministic: same project + library  -> same track
 *   H  duplicate avoidance: re-run -> single bgm asset (idempotent)
 *   I  backward compatibility: an old bgm asset with no provenance still resolves
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emitSmokeResult } from "./lib/SmokeResult";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { AssetManager } from "../src/lib/assets/AssetManager";
import { AudioStorage } from "../src/lib/assets/storage/AudioStorage";
import {
  stageProjectBackgroundMusic,
  BACKGROUND_MUSIC_ASSET_ID,
} from "../src/lib/audio/music/AudioMusicSelection";
import { resolveBackgroundMusic } from "../src/lib/assembly/VideoAssemblyManager";
import type { AudioData } from "../src/types/audio";
import type { RuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";

const NOW = "2026-08-30T00:00:00.000Z";
let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function wav(seconds: number, freq = 220): Buffer {
  const sr = 48000;
  const n = Math.floor(sr * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) b.writeInt16LE(Math.floor(Math.sin(2 * Math.PI * freq * (i / sr)) * 10000), 44 + i * 2);
  return b;
}

function audioData(): AudioData {
  return {
    narrator: { style: "deep documentary", tone: "serious", language: "tr" },
    sections: [{ chapterId: 1, title: "B1", duration: "00:30", emotion: "serious", emphasis: [], narrationNotes: "n", pacing: "medium", sourceText: "metin" }],
    music: { mood: "historical dramatic siege", suggestion: "dark orchestral bed", intensity: "medium" },
    production: { targetFormat: "wav", sampleRate: 44100, estimatedTotalDuration: "00:30", generationStatus: "generated" },
    createdAt: NOW,
  };
}

let musicRoot = "", sfxRoot = "", libEnv: NodeJS.ProcessEnv, ctx: RuntimeStorageContext;

function reset() {
  for (const r of [musicRoot, sfxRoot]) { fs.rmSync(r, { recursive: true, force: true }); fs.mkdirSync(r, { recursive: true }); }
}
function addMusic(name: string, license?: string) {
  const d = path.join(musicRoot, "historical"); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, name), wav(1.5));
  if (license) fs.writeFileSync(path.join(d, `${name}.license.json`), JSON.stringify({ title: name, license }));
}
function addAmbience(name: string, license?: string) {
  const d = path.join(sfxRoot, "ambience"); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, name), wav(1.5, 90));
  if (license) fs.writeFileSync(path.join(d, `${name}.license.json`), JSON.stringify({ title: name, license }));
}
async function proj(topic: string) { const p = await ProjectManager.createProject(topic); return { id: p.id, slug: p.slug }; }
async function stage(id: string, slug: string, ambienceHints?: string[]) {
  return stageProjectBackgroundMusic({
    projectId: id, projectSlug: slug, audio: audioData(), musicStyleHint: "historical siege march",
    ambienceHints, storageContext: ctx, now: () => NOW, env: libEnv,
  });
}

async function run() {
  await scenario("A: narration only (empty libraries) -> no bed", async () => {
    reset();
    const p = await proj(`p4 A ${Date.now()}`);
    const o = await stage(p.id, p.slug, ["battle cannon"]);
    assert.equal(o.staged, false);
    if (!o.staged) assert.equal(o.reason, "no-track-in-library");
    assert.equal(AssetManager.getProjectAssets(p.slug, p.id, ctx).assets.some((a) => a.id === BACKGROUND_MUSIC_ASSET_ID), false);
  });

  await scenario("B: narration + music -> music bed staged", async () => {
    reset(); addMusic("bed.wav", "CC0 1.0");
    const p = await proj(`p4 B ${Date.now()}`);
    const o = await stage(p.id, p.slug);
    assert.equal(o.staged, true);
    if (!o.staged) return;
    assert.equal(o.asset.mediaType, "music");
    assert.equal(o.asset.rightsStatus, "public-domain");
  });

  await scenario("C: narration + ambience only -> ambience bed staged", async () => {
    reset(); addAmbience("wind.wav", "Public Domain");
    const p = await proj(`p4 C ${Date.now()}`);
    const o = await stage(p.id, p.slug, ["wind ambience over the walls"]);
    assert.equal(o.staged, true);
    if (!o.staged) return;
    assert.equal(o.track, null);
    assert.equal(o.asset.mediaType, "ambience");
  });

  await scenario("D: narration + music + ambience -> bed staged (mixed or music-only)", async () => {
    reset(); addMusic("bed.wav", "CC0 1.0"); addAmbience("wind.wav", "CC0");
    const p = await proj(`p4 D ${Date.now()}`);
    const o = await stage(p.id, p.slug, ["wind ambience", "distant sea"]);
    assert.equal(o.staged, true);
    if (!o.staged) return;
    assert.ok(o.asset.filePath?.endsWith("/bgm.wav"));
  });

  await scenario("E: ducking - resolveBackgroundMusic returns ducking on, volume in range", async () => {
    reset(); addMusic("bed.wav", "CC0 1.0");
    const p = await proj(`p4 E ${Date.now()}`);
    await stage(p.id, p.slug);
    const bgm = resolveBackgroundMusic(p.slug, AssetManager.getProjectAssets(p.slug, p.id, ctx).assets);
    assert.equal(bgm?.ducking, true);
    assert.ok((bgm?.volume ?? 0) > 0 && (bgm?.volume ?? 0) <= 2.0);
  });

  await scenario("F: rights rejection - restricted music + restricted ambience -> nothing staged", async () => {
    reset(); addMusic("arr.wav", "All Rights Reserved"); addAmbience("crowd.wav", "Copyrighted");
    const p = await proj(`p4 F ${Date.now()}`);
    const o = await stage(p.id, p.slug, ["crowd ambience"]);
    assert.equal(o.staged, false);
    if (!o.staged) assert.equal(o.reason, "rights-not-admissible");
  });

  await scenario("G: deterministic - same project + library -> same track", async () => {
    reset(); addMusic("a-bed.wav", "CC0 1.0"); addMusic("b-bed.wav", "CC0 1.0");
    const p = await proj(`p4 G ${Date.now()}`);
    const first = await stage(p.id, p.slug);
    const second = await stage(p.id, p.slug);
    assert.ok(first.staged && second.staged);
    if (!first.staged || !second.staged) return;
    assert.equal(first.track?.fileName, second.track?.fileName);
  });

  await scenario("H: duplicate avoidance - re-run keeps a single bgm asset", async () => {
    reset(); addMusic("bed.wav", "CC0 1.0");
    const p = await proj(`p4 H ${Date.now()}`);
    await stage(p.id, p.slug);
    await stage(p.id, p.slug);
    const bgm = AssetManager.getProjectAssets(p.slug, p.id, ctx).assets.filter((a) => a.id === BACKGROUND_MUSIC_ASSET_ID);
    assert.equal(bgm.length, 1);
  });

  await scenario("I: backward compat - a legacy bgm asset with no provenance still resolves", async () => {
    const p = await proj(`p4 I ${Date.now()}`);
    const saved = AudioStorage.saveAudio({ projectSlug: p.slug, data: wav(1.0), fileName: "bgm.wav" }, ctx);
    AssetManager.addAssetAtomically(p.slug, p.id, AssetManager.createAsset({
      id: BACKGROUND_MUSIC_ASSET_ID, projectId: p.id, projectSlug: p.slug, type: "audio",
      status: "generated", provider: "music-library", prompt: "legacy bed",
      filePath: saved.filePath, url: saved.url, mimeType: saved.mimeType,
      byteLength: saved.byteLength, durationSeconds: saved.durationSeconds, createdAt: NOW,
    }), ctx);
    const bgm = resolveBackgroundMusic(p.slug, AssetManager.getProjectAssets(p.slug, p.id, ctx).assets);
    assert.ok(bgm?.filePath.endsWith("/bgm.wav"));
    assert.equal(bgm?.ducking, true);
  });

  console.log(`Phase 4 audio/music/SFX smoke: PASS (${count} scenarios)`);
  emitSmokeResult("phase4-audio", count);
}

async function main() {
  musicRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-p4-music-"));
  sfxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-p4-sfx-"));
  try {
    await withCanonicalSmokeRuntime(
      { name: "phase4-audio", operationType: "phase4-audio-smoke", environment: { ATOLYE_MUSIC_LIBRARY_ROOT: musicRoot, ATOLYE_SFX_LIBRARY_ROOT: sfxRoot } },
      async (runtime) => { ctx = runtime.runtimeStorageContext; libEnv = { ...process.env } as NodeJS.ProcessEnv; await run(); },
    );
  } finally {
    fs.rmSync(musicRoot, { recursive: true, force: true });
    fs.rmSync(sfxRoot, { recursive: true, force: true });
  }
}

void main();
