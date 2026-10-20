/**
 * V3 smoke: music bed planning, effect cues and sample placement for the mix. Pure (no FFmpeg run).
 * Run: npx tsx scripts/smoke-v3-mix.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { MusicMood, MusicTrack } from "../src/lib/audio/music/MusicLibrary";
import { type Episode, SFX_IDS } from "../src/lib/v3/episode/EpisodeTypes";
import { AMBIENCE_LUFS, ambienceChain, MAX_SCENES_PER_TRACK, placeSamples, planMusic, SAMPLE_RATE, SFX_CATEGORY, sceneMusicMood, sfxCues, sfxLibraryFile } from "../src/lib/v3/mix/Mixer";
import { composeBeds, compositionCaption, compositionKey, periodInstruments, pieceProblems } from "../src/lib/v3/mix/MusicComposer";
import { ambiencePrompt, designSounds, eraOf, periodSfxPrompt, soundKey, soundProblems } from "../src/lib/v3/mix/SfxDesigner";
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

  await scenario("composer: period and mood in the caption, stable keys, checked pieces, a failing bed keeps its library track", async () => {
    const rome = { id: "rubicon", donem: "49 BC", konu: "Julius Caesar crosses the Rubicon" };
    assert.match(periodInstruments(rome), /ancient Mediterranean/);
    assert.match(periodInstruments({ donem: "1453", konu: "Fatih Sultan Mehmed takes Constantinople" }), /Ottoman instruments/);
    assert.match(periodInstruments({ donem: "1066", konu: "Battle of Hastings" }), /medieval/);
    assert.match(periodInstruments({ donem: "1940", konu: "Battle of Britain" }), /modern cinematic/);
    const cap = compositionCaption(rome, "comedic");
    assert.match(cap, /^Instrumental underscore for an animated history cartoon set in 49 BC\. playful and comedic/);
    assert.match(cap, /No vocals, no singing, no lyrics/);
    const req = { mood: "comedic" as const, seconds: 31.4, caption: cap, seed: 7 };
    assert.equal(compositionKey(req), compositionKey({ ...req, seconds: 31.2 }), "the length counts to the second");
    assert.notEqual(compositionKey(req), compositionKey({ ...req, seed: 8 }));
    const ok = { durationS: 31, meanDb: -18, peakDb: -1.2, longestSilenceS: 0.4 };
    assert.deepEqual(pieceProblems(ok, 31.4), []);
    assert.equal(pieceProblems({ ...ok, durationS: 20 }, 31.4).length, 1, "too short");
    assert.ok(pieceProblems({ ...ok, meanDb: -52 }, 31.4)[0]!.startsWith("çok sessiz"));
    assert.ok(pieceProblems({ ...ok, longestSilenceS: 5 }, 31.4)[0]!.includes("sessizlik"));
    assert.ok(pieceProblems({ ...ok, peakDb: 0 }, 31.4)[0]!.startsWith("tepe"));
    const lib = (mood: MusicMood): MusicTrack => track(mood, `lib-${mood}`);
    const segs = [
      { start: 0, end: 30, mood: "historical" as const, track: lib("historical"), scenes: [0, 1] },
      { start: 30, end: 50, mood: "tense" as const, track: lib("tense"), scenes: [2] },
      { start: 50, end: 70, mood: "comedic" as const, track: lib("comedic"), scenes: [3] },
    ];
    const asked: number[] = [];
    const fake = {
      compose: async (r: { mood: MusicMood; seconds: number; seed: number }) => {
        asked.push(r.seed);
        if (r.mood === "tense") return { problems: ["4.0 sn sessizlik"] };
        if (r.mood === "comedic") throw new Error("CUDA out of memory");
        return { file: `D:/muzik/${r.mood}.wav`, cached: false };
      },
    };
    const out = await composeBeds(segs, rome, fake, () => undefined);
    assert.equal(out.segments[0]!.track.absolutePath, "D:/muzik/historical.wav");
    assert.match(out.segments[0]!.track.attribution!, /ACE-Step 1\.5 \(MIT\)/);
    assert.equal(out.segments[1]!.track.title, "lib-tense", "a failed check keeps the library track");
    assert.equal(out.segments[2]!.track.title, "lib-comedic", "a crash keeps the library track");
    assert.ok(out.report[2]!.includes("CUDA out of memory"));
    assert.deepEqual([out.segments[0]!.start, out.segments[0]!.end], [0, 30], "bed timing unchanged");
    const again: number[] = [];
    await composeBeds(segs, rome, { compose: async (r) => (again.push(r.seed), { file: "x", cached: true }) }, () => undefined);
    assert.deepEqual(again, asked, "the same episode asks for the same seeds (rerun = library)");
  });

  await scenario("sound designer: period effects by era, ambience from the place, a failing sound keeps Kenney or silence", async () => {
    assert.deepEqual([eraOf("49 BC"), eraOf("1066"), eraOf("1453"), eraOf("1940"), eraOf("bilinmiyor")], ["antik", "orta", "erken-modern", "modern", "modern"]);
    assert.match(periodSfxPrompt("zil", "antik")!, /^a small bronze hand bell ringing twice\. Clean single sound effect, no music, no speech\.$/);
    assert.match(periodSfxPrompt("kagit", "antik")!, /papyrus/);
    assert.equal(periodSfxPrompt("whoosh", "antik"), undefined, "cartoon effects keep their recording");
    assert.equal(periodSfxPrompt("pop", "modern"), undefined);
    const scene = { mekan: "Corfinium, Italy", arka_plan_sorgusu: { tr: "", en: "Corfinium", tasarim: "A walled hilltop town with stone towers, Roman banners; smoke rising from campfires; no modern buildings, no cars." } };
    const amb = ambiencePrompt(scene, "49 BC");
    assert.match(amb, /^Quiet ambient background sound of Corfinium, Italy in 49 BC: A walled hilltop town with stone towers, Roman banners, smoke rising from campfires\. /);
    assert.doesNotMatch(amb, /modern buildings|cars/, "negations never reach the model");
    assert.notEqual(soundKey({ prompt: "x", seconds: 3, seed: 1, kind: "efekt" }), soundKey({ prompt: "x", seconds: 3, seed: 1, kind: "ortam" }));
    const ok = { durationS: 1.2, meanDb: -22, peakDb: -2, longestSilenceS: 0 };
    assert.deepEqual(soundProblems(ok, { prompt: "", seconds: 3, seed: 0, kind: "efekt" }), []);
    assert.ok(soundProblems({ ...ok, durationS: 9 }, { prompt: "", seconds: 20, seed: 0, kind: "ortam" })[0]!.startsWith("süre"), "an ambience bed must be nearly as long as asked");
    assert.ok(soundProblems({ ...ok, meanDb: -60 }, { prompt: "", seconds: 3, seed: 0, kind: "efekt" })[0]!.startsWith("çok sessiz"));
    const ep = { id: "rubicon", donem: "49 BC", sahneler: [{ ...scene, id: "s1" }, { ...scene, id: "s2-harita", mekan: "Map of Italy", harita: { merkez: [12, 43] as [number, number], genislik_km: 700 } }, { ...scene, id: "s3", mekan: "Roman Senate" }] } as unknown as Pick<Episode, "id" | "donem" | "sahneler">;
    const tl = { scenes: [{ sceneIndex: 0, start: 3, end: 15 }, { sceneIndex: 1, start: 15, end: 25 }, { sceneIndex: 2, start: 25, end: 40 }] } as unknown as Pick<EpisodeTimeline, "scenes">;
    const made: string[] = [];
    const fake = {
      make: async (r: { prompt: string; kind: string }) => {
        made.push(r.kind);
        if (r.prompt.includes("Roman Senate")) return { problems: ["4.5 sn sessizlik"] };
        if (r.prompt.includes("papyrus")) throw new Error("CUDA out of memory");
        return { file: `D:/efekt/${made.length}.wav`, cached: false };
      },
    };
    const out = await designSounds(ep, tl, ["zil", "whoosh", "zil", "kagit"], fake);
    assert.deepEqual([...out.effects.keys()], ["zil"], "zil made once, whoosh kept, papyrus crash keeps Kenney");
    assert.deepEqual(out.ambience.map((a) => [a.start, a.end]), [[3, 15]], "the map scene gets none, the failed Senate bed stays silent");
    assert.ok(out.report.some((l) => l.startsWith("efekt kagit: kütüphane kaydı kaldı — efektçi çalışmadı: CUDA out of memory")));
    assert.ok(out.report.some((l) => l.startsWith("ortam s3: ortam sesi yok")));
    const chain = ambienceChain(5, "o0", 3, 15);
    assert.match(chain, /^\[5:a\]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-38:TP=-9:LRA=11,afade=t=in:d=0\.6,afade=t=out:st=11\.400:d=0\.6,adelay=3000\|3000\[o0\]$/);
    assert.ok(AMBIENCE_LUFS < -26, "ambience sits under the music");
  });

  console.log(`V3 mix smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
