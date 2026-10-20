/**
 * V3 smoke: music bed planning, effect cues and sample placement for the mix. Pure (no FFmpeg run).
 * Run: npx tsx scripts/smoke-v3-mix.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { MusicMood, MusicTrack } from "../src/lib/audio/music/MusicLibrary";
import { type Episode, SFX_IDS } from "../src/lib/v3/episode/EpisodeTypes";
import { MAX_SCENES_PER_TRACK, placeSamples, planMusic, SAMPLE_RATE, SFX_CATEGORY, sceneMusicMood, sfxCues, sfxLibraryFile } from "../src/lib/v3/mix/Mixer";
import type { EpisodeTimeline } from "../src/lib/v3/timeline/Timeline";

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

const track = (mood: MusicMood, name: string, priority = 20): MusicTrack => ({ mood, absolutePath: `/m/${mood}/${name}.mp3`, fileName: `${name}.mp3`, title: name, source: null, sourceUrl: null, license: "CC-BY-4.0", attribution: `"${name}" Kevin MacLeod`, priority });
const LIB: Record<string, MusicTrack[]> = {
  comedic: [track("comedic", "duck"), track("comedic", "monkeys"), track("comedic", "snitch")],
  tense: [track("tense", "hitman"), track("tense", "atolye-bed", 10)],
  epic: [track("epic", "armies")],
};
const tracksFor = (m: MusicMood) => LIB[m] ?? [];

async function main() {
  await scenario("A same-mood scenes share one bed; a mood change starts another", () => {
    const scenes = [
      { start: 0, end: 10, mood: "comedic" as const },
      { start: 10, end: 20, mood: "comedic" as const },
      { start: 20, end: 35, mood: "tense" as const },
      { start: 35, end: 50, mood: "epic" as const },
    ];
    const plan = planMusic(scenes, tracksFor, "fatih");
    assert.deepEqual(plan.map((p) => [p.mood, p.start, p.end, p.scenes.length]), [["comedic", 0, 20, 2], ["tense", 20, 35, 1], ["epic", 35, 50, 1]]);
    // Curated priority wins: the library's own lower-priority bed is not picked while a higher one exists.
    assert.equal(plan[1]!.track.fileName, "hitman.mp3");
  });

  await scenario("B a long run of one mood hands over to another track, never the same one twice in a row", () => {
    const scenes = Array.from({ length: 7 }, (_, i) => ({ start: i * 10, end: i * 10 + 10, mood: "comedic" as const }));
    const plan = planMusic(scenes, tracksFor, "x");
    assert.deepEqual(plan.map((p) => p.scenes.length), [MAX_SCENES_PER_TRACK, MAX_SCENES_PER_TRACK, 1]);
    for (let i = 1; i < plan.length; i++) assert.notEqual(plan[i]!.track.absolutePath, plan[i - 1]!.track.absolutePath);
  });

  await scenario("C a mood with no track gets no bed (silence beats a wrong mood)", () => {
    assert.equal(planMusic([{ start: 0, end: 10, mood: "calm" }], tracksFor).length, 0);
  });

  await scenario("D scene moods map onto library moods; a free text falls back through MusicLibrary", () => {
    assert.equal(sceneMusicMood("komik"), "comedic");
    assert.equal(sceneMusicMood("zafer"), "epic");
    assert.equal(sceneMusicMood(undefined, "gergin bir an"), "tense");
  });

  await scenario("E effects: the script's own at the line start, a whoosh into non-cut scenes, a pop on a surprise jump", () => {
    const ep = {
      sahneler: [
        { id: "s1", gecis: "kes", satirlar: [{ karakter: "a", metin: "x", duygu: "notr", sfx: "davul" }] },
        { id: "s2", gecis: "murekkep", satirlar: [{ karakter: "a", metin: "y", duygu: "saskin", jest: "sasir" }, { karakter: "a", metin: "z", duygu: "notr" }] },
      ],
    } as unknown as Episode;
    const tl = {
      duration: 10,
      scenes: [{ sceneIndex: 0, start: 0, end: 4 }, { sceneIndex: 1, start: 4, end: 10 }],
      lines: [
        { sceneIndex: 0, lineIndex: 0, start: 0.3, end: 2 },
        { sceneIndex: 1, lineIndex: 0, start: 4.3, end: 6 },
        { sceneIndex: 1, lineIndex: 1, start: 6.3, end: 8 },
      ],
    } as unknown as EpisodeTimeline;
    assert.deepEqual(sfxCues(ep, tl).map((c) => [c.id, Math.round(c.t * 100) / 100]), [["davul", 0.3], ["whoosh", 3.88], ["pop", 4.3], ["basari", 6.3]]);
  });

  await scenario("E2 automatic effects: a thud under a word card, steps on an entrance, a whoosh on a run, a boing on a question", () => {
    const ep = {
      sahneler: [
        {
          id: "s1",
          gecis: "kes",
          yazi_karti: [{ metin: "WRONG", stil: "kelime", satir: 1 }, { metin: "Rome, 49 BC", stil: "yer_tarih" }],
          satirlar: [
            { karakter: "a", metin: "x", duygu: "notr", hareket: "gir" },
            { karakter: "a", metin: "y", duygu: "notr", hareket: "kos", sfx: "para" },
            { karakter: "b", metin: "z?", duygu: "saskin", efekt: "soru" },
          ],
        },
        { id: "s2", gecis: "kes", satirlar: [{ karakter: "a", metin: "w", duygu: "notr", hareket: "kos" }, { karakter: "anlatici", metin: "Subscribe!", duygu: "mutlu" }] },
      ],
    } as unknown as Episode;
    const tl = {
      duration: 12,
      scenes: [{ sceneIndex: 0, start: 0, end: 6 }, { sceneIndex: 1, start: 6, end: 12 }],
      lines: [
        { sceneIndex: 0, lineIndex: 0, start: 0.2, end: 1.5 },
        { sceneIndex: 0, lineIndex: 1, start: 2, end: 3.5 },
        { sceneIndex: 0, lineIndex: 2, start: 4, end: 5.5 },
        { sceneIndex: 1, lineIndex: 0, start: 6.2, end: 8 },
        { sceneIndex: 1, lineIndex: 1, start: 8.5, end: 11 },
      ],
    } as unknown as EpisodeTimeline;
    assert.deepEqual(sfxCues(ep, tl).map((c) => [c.id, c.t]), [["adim", 0.2], ["dusus", 2], ["para", 2], ["boing", 4], ["whoosh", 6.2], ["basari", 8.5]]);
  });

  await scenario("F samples land on the exact sample and anything past the end is dropped", () => {
    const dst = new Float32Array(SAMPLE_RATE);
    placeSamples(dst, new Float32Array([1, 1, 1]), 0.5, 0.5);
    const at = SAMPLE_RATE / 2;
    assert.deepEqual([dst[at - 1], dst[at], dst[at + 2], dst[at + 3]], [0, 0.5, 0.5, 0]);
    placeSamples(dst, new Float32Array(10).fill(1), (SAMPLE_RATE - 2) / SAMPLE_RATE);
    assert.equal(dst[SAMPLE_RATE - 1], 1);
  });

  await scenario("G every effect id has a library file: a Kenney recording when there is one, else the synthesis, with a CC0 sidecar", () => {
    const sfxDir = path.join(__dirname, "..", "public", "sfx");
    for (const id of SFX_IDS) {
      const file = sfxLibraryFile(sfxDir, id);
      assert.ok(file, `${id}: no file in public/sfx/${SFX_CATEGORY[id]}`);
      const sidecar = JSON.parse(readFileSync(`${file}.license.json`, "utf8")) as { license: string };
      assert.equal(sidecar.license, "CC0", id);
    }
    assert.match(sfxLibraryFile(sfxDir, "kilic")!, /kilic-kenney.wav$/, "the recording wins over the synthesis");
    assert.match(sfxLibraryFile(sfxDir, "whoosh")!, /whoosh-01.wav$/);
  });

  console.log(`V3 mix smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
