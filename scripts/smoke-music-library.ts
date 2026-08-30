/**
 * Documentary pipeline V2 (Faz 1): mood-based background-music selection.
 *
 * Covers src/lib/audio/music/MusicLibrary.ts. No audio is produced or played;
 * the suite builds a throwaway on-disk library under a temp
 * ATOLYE_MUSIC_LIBRARY_ROOT and checks mood normalization, deterministic
 * selection, license sidecar parsing, and - most importantly - that an empty
 * library returns null so the assembly stage keeps its current
 * narration-only behaviour.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MUSIC_MOODS,
  listTracksForMood,
  normalizeMusicMood,
  selectMusicTrack,
} from "../src/lib/audio/music/MusicLibrary";

let count = 0;
function scenario(name: string, test: () => void) {
  test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-music-"));
const env = { ...process.env, ATOLYE_MUSIC_LIBRARY_ROOT: root } as NodeJS.ProcessEnv;

function run() {
  scenario("normalizeMusicMood maps exact and hinted moods, defaults to dramatic", () => {
    assert.equal(normalizeMusicMood("epik ve görkemli"), "epic");
    assert.equal(normalizeMusicMood("Dark, tense battle score"), "tense");
    assert.equal(normalizeMusicMood("sakin ve huzurlu ambient"), "calm");
    assert.equal(normalizeMusicMood("ortaçağ folk"), "historical");
    assert.equal(normalizeMusicMood(""), "dramatic");
    assert.equal(normalizeMusicMood(undefined), "dramatic");
    assert.equal(normalizeMusicMood("nothing recognizable here"), "dramatic");
  });

  scenario("empty library: every mood lists nothing and selection returns null", () => {
    for (const mood of MUSIC_MOODS) {
      assert.deepEqual(listTracksForMood(mood, env), []);
    }
    assert.equal(selectMusicTrack("epik", "some-project-slug", env), null);
  });

  scenario("populated library: lists audio files, ignores non-audio, sorts by name", () => {
    fs.mkdirSync(path.join(root, "dramatic"), { recursive: true });
    fs.writeFileSync(path.join(root, "dramatic", "b-track.mp3"), "ID3");
    fs.writeFileSync(path.join(root, "dramatic", "a-track.mp3"), "ID3");
    fs.writeFileSync(path.join(root, "dramatic", "notes.txt"), "ignore me");
    const tracks = listTracksForMood("dramatic", env);
    assert.equal(tracks.length, 2);
    assert.deepEqual(
      tracks.map((t) => t.fileName),
      ["a-track.mp3", "b-track.mp3"],
    );
    assert.equal(tracks[0].title, "a-track");
  });

  scenario("license sidecar is parsed when present", () => {
    fs.writeFileSync(
      path.join(root, "dramatic", "a-track.mp3.license.json"),
      JSON.stringify({
        title: "Siege March",
        source: "Pixabay",
        sourceUrl: "https://pixabay.com/music/xyz",
        license: "Pixabay Content License",
        attribution: "n/a",
      }),
    );
    const track = listTracksForMood("dramatic", env).find((t) => t.fileName === "a-track.mp3");
    assert.ok(track);
    assert.equal(track?.title, "Siege March");
    assert.equal(track?.license, "Pixabay Content License");
  });

  scenario("selectMusicTrack is deterministic per seed and falls back across moods", () => {
    // "epic" bucket empty -> falls back to the only populated bucket, "dramatic"
    const first = selectMusicTrack("epik görkemli", "istanbul-1453", env);
    const again = selectMusicTrack("epik görkemli", "istanbul-1453", env);
    assert.ok(first);
    assert.equal(first?.mood, "dramatic");
    assert.deepEqual(first, again);
  });

  console.log(`Music library smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "music-library", scenarios: count }));
}

try {
  run();
} catch (error) {
  console.error("Music library smoke FAILED:", error);
  process.exitCode = 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
