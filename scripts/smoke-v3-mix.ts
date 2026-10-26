/**
 * V3 smoke: music bed planning, effect cues and sample placement for the mix. Pure (no FFmpeg run).
 * Run: npx tsx scripts/smoke-v3-mix.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { MusicMood, MusicTrack } from "../src/lib/audio/music/MusicLibrary";
import { type Episode, SFX_IDS } from "../src/lib/v3/episode/EpisodeTypes";
import { CLEAN_LOWPASS_HZ, cleanupFilter, LINE_PROMINENCE_DB, MAX_NOTCHES, whineLine, whineLines } from "../src/lib/v3/mix/AudioQuality";
import { AMBIENCE_LUFS, ambienceChain, DUCK_ATTACK_MS, EFFECT_LINE_MIN_HZ, MAX_SCENES_PER_TRACK, placeSamples, planMusic, SAMPLE_RATE, SFX_CATEGORY, sceneMusicMood, sfxCues, sfxLibraryFile } from "../src/lib/v3/mix/Mixer";
import { composeBeds, compositionCaption, compositionKey, periodInstruments, pieceProblems, TURBO_SHIFT } from "../src/lib/v3/mix/MusicComposer";
import { ambiencePrompt, designSounds, eraOf, MAX_AMBIENCE_PLACES, MIN_ONSET_CONTRAST_DB, onsetContrastDb, PERCUSSIVE, periodSfxPrompt, soundKey, soundProblems } from "../src/lib/v3/mix/SfxDesigner";
import { splitDirections } from "../src/lib/v3/tts/StageDirections";
import { voiceCredit } from "../src/lib/v3/tts/Tts";
import { chooseEngine, REFERENCE_TEXT, voxcpmDescription, voxcpmLanguages, voxcpmText } from "../src/lib/v3/tts/Voxcpm";
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

  await scenario("B2 a chapter card opens a new bed even when the mood stays the same", () => {
    const scenes = [
      { start: 0, end: 10, mood: "comedic" as const, chapter: 1 },
      { start: 10, end: 20, mood: "comedic" as const, chapter: 1 },
      { start: 20, end: 30, mood: "comedic" as const, chapter: 2 },
      { start: 30, end: 40, mood: "comedic" as const, chapter: 2 },
    ];
    const plan = planMusic(scenes, tracksFor, "x");
    assert.deepEqual(plan.map((p) => [p.start, p.end]), [[0, 20], [20, 40]]);
    assert.notEqual(plan[1]!.track.absolutePath, plan[0]!.track.absolutePath, "the new chapter gets another track");
    assert.deepEqual(planMusic(scenes.map((s) => ({ start: s.start, end: s.end, mood: s.mood })), tracksFor, "x").map((p) => p.scenes.length), [MAX_SCENES_PER_TRACK, 1], "no chapters: as before");
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
    // Owner, 22 Oct 2026 (no meaningless sound): what happens is heard — the legion's march and the water as it wades
    // in, Caesar's splash into the Rubicon, a drum as an army sets off on the map, swords where a battle flashes.
    const rubicon = {
      donem: "49 BC",
      sahneler: [
        { id: "m", satirlar: [{ karakter: "anlatici", metin: "x", duygu: "notr" }, { karakter: "anlatici", metin: "y", duygu: "notr" }], harita: { merkez: [12, 43], genislik_km: 900, ordular: [{ ad: "Caesar", konum: [12, 44], renk: "#c0392b", yol: [[12, 42]], yol_satir: 1 }], savaslar: [{ ad: "Corfinium", konum: [13.8, 42.1], satir: 1 }] } },
        { id: "k", ortam: { zaman: "gece", manzara: "nehir_gecidi", uslup: "roma", nehir: [0.46, 0.9] }, kalabalik: [{ ad: "Legio", duzen: "ordu", hareket: { tur: "yuru", satir: 1 } }], satirlar: [{ karakter: "a", metin: "Forward!", duygu: "kararli", hareket: "yuru", hedef: 0.72 }, { karakter: "b", metin: "Right behind you!", duygu: "korkmus" }, { karakter: "anlatici", metin: "z", duygu: "notr" }] },
      ],
    } as unknown as Episode;
    const tl2 = {
      duration: 12,
      scenes: [{ sceneIndex: 0, start: 0, end: 4 }, { sceneIndex: 1, start: 4, end: 12 }],
      lines: [
        { sceneIndex: 0, lineIndex: 0, start: 0, end: 2 },
        { sceneIndex: 0, lineIndex: 1, start: 2, end: 4 },
        { sceneIndex: 1, lineIndex: 0, start: 4, end: 6 },
        { sceneIndex: 1, lineIndex: 1, start: 6, end: 8 },
        { sceneIndex: 1, lineIndex: 2, start: 8, end: 11 },
      ],
    } as unknown as EpisodeTimeline;
    assert.deepEqual(sfxCues(rubicon, tl2).map((c) => [c.id, Math.round(c.t * 10) / 10]), [["davul", 2.1], ["kilic", 2.2], ["adim", 4], ["su", 4.9], ["adim", 6.2], ["su", 7.6], ["basari", 8]]);
    // 1453 on the map: the battle has cannon fire too, the fleet sets out with the sea, the guns are heard as they
    // pound; the tokens' fight is swords as they meet and with every token that falls (owner: "swords in the back").
    const siege = {
      donem: "1453",
      sahneler: [
        {
          ...rubicon.sahneler[0]!,
          harita: {
            merkez: [28.9, 41],
            genislik_km: 520,
            savaslar: [{ ad: "Walls", konum: [28.92, 41.02], satir: 1 }],
            birlikler: [{ taraf: "B", renk: "#7a3fa0", amblem: "kartal", sayi: 3, yerler: [{ satir: 0, kume: [28.94, 41.02] }, { satir: 1, kume: [28.94, 41.02], kayip: 1 }] }],
            araclar: [
              { tur: "gemi", renk: "#c0392b", konum: [28.5, 40.8], satir: 0, yol: [[28.8, 40.9]] },
              { tur: "top", renk: "#c0392b", konum: [28.86, 41.05], satir: 1, hedef: [28.92, 41.02] },
            ],
          },
        },
      ],
    } as unknown as Episode;
    const tlSiege = { duration: 4, scenes: [{ sceneIndex: 0, start: 0, end: 4 }], lines: [{ sceneIndex: 0, lineIndex: 0, start: 0, end: 2 }, { sceneIndex: 0, lineIndex: 1, start: 2, end: 4 }] } as unknown as EpisodeTimeline;
    assert.deepEqual(sfxCues(siege, tlSiege).map((c) => [c.id, Math.round(c.t * 10) / 10]), [["dalga", 0.2], ["basari", 2], ["kilic", 2.2], ["top_atisi", 2.4], ["kilic", 3.4], ["kilic", 4.4], ["top_atisi", 4.6]]);
    assert.ok(!sfxCues({ ...siege, donem: "MÖ 49" } as Episode, tlSiege).some((c) => c.id === "top_atisi"), "no cannon before gunpowder");
    // A fleet broken (the Belgrade trial): each ship lost splashes down at the tokens' pace; a lost gun is a blast.
    const sunk = { ...siege, sahneler: [{ ...siege.sahneler[0]!, harita: { merkez: [20.45, 44.82], genislik_km: 20, araclar: [{ tur: "gemi", renk: "#c0392b", sayi: 4, konum: [20.44, 44.83], satir: 0, kayip: 2, kayip_satir: 1 }, { tur: "top", renk: "#c0392b", konum: [20.43, 44.81], satir: 0, kayip: 1, kayip_satir: 1 }] } }] } as unknown as Episode;
    assert.deepEqual(sfxCues(sunk, tlSiege).filter((c) => c.id === "su" || c.id === "top_atisi").map((c) => [c.id, Math.round(c.t * 10) / 10]), [["su", 4.4], ["top_atisi", 4.4], ["su", 5.4]]);
    // In a living set a run is feet, not a cartoon whoosh; the same effect twice within a second is one.
    const run = { sahneler: [{ ...rubicon.sahneler[1]!, kalabalik: [], satirlar: [{ karakter: "a", metin: "Run!", duygu: "korkmus", hareket: "kos" }, { karakter: "b", metin: "Wait!", duygu: "korkmus", hareket: "yuru" }, { karakter: "anlatici", metin: "z", duygu: "notr" }] }] } as unknown as Episode;
    const tl3 = { ...tl2, scenes: [{ sceneIndex: 0, start: 0, end: 8 }], lines: [{ sceneIndex: 0, lineIndex: 0, start: 0, end: 0.6 }, { sceneIndex: 0, lineIndex: 1, start: 0.5, end: 3 }, { sceneIndex: 0, lineIndex: 2, start: 3, end: 6 }] } as unknown as EpisodeTimeline;
    assert.deepEqual(sfxCues(run, tl3).map((c) => c.id), ["adim", "basari"], "running feet, and the walk 0.5 s later does not double them");
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
    assert.equal(pieceProblems({ ...ok, durationS: 12 }, 31.4).length, 1, "too short even to loop");
    assert.deepEqual(pieceProblems({ ...ok, durationS: 20 }, 31.4), [], "a shorter piece loops in the mixer");
    assert.equal(pieceProblems({ ...ok, durationS: 60 }, 31.4).length, 1, "far too long");
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
    // A living set sounds like its own place and hour (owner, 22 Oct 2026: no meaningless sound).
    const night = ambiencePrompt({ ...scene, ortam: { zaman: "gece", manzara: "nehir_gecidi", uslup: "roma", hava: "sis", isik: "mesale" }, kalabalik: [{ duzen: "ordu" } as never] }, "49 BC");
    assert.equal(night, "Quiet ambient background sound in 49 BC: a shallow river flowing over stones nearby, night, crickets chirping, a distant owl, still misty air, torches crackling, a large army waiting quietly, armour and weapons clinking. Soft and steady, natural outdoor or room tone, no music, no speech, no singing.");
    assert.notEqual(soundKey({ prompt: "x", seconds: 3, seed: 1, kind: "efekt" }), soundKey({ prompt: "x", seconds: 3, seed: 1, kind: "ortam" }));
    const ok = { durationS: 1.2, meanDb: -22, peakDb: -2, longestSilenceS: 0 };
    assert.deepEqual(soundProblems(ok, { prompt: "", seconds: 3, seed: 0, kind: "efekt" }), []);
    assert.ok(soundProblems({ ...ok, durationS: 9 }, { prompt: "", seconds: 20, seed: 0, kind: "ortam" })[0]!.startsWith("süre"), "an ambience bed must be nearly as long as asked");
    assert.ok(soundProblems({ ...ok, meanDb: -60 }, { prompt: "", seconds: 3, seed: 0, kind: "efekt" })[0]!.startsWith("çok sessiz"));
    // A drum must have hits (benchmark, 22 Oct 2026: "drums and a bronze horn call" came out a 3 s buzzing drone).
    const rate = 8000;
    const drone = Float32Array.from({ length: rate * 3 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / rate) + 0.1 * Math.sin((2 * Math.PI * 440 * i) / rate));
    const hits = Float32Array.from({ length: rate * 3 }, (_, i) => {
      const t = (i % (rate * 0.75)) / rate;
      return Math.exp(-30 * t) * Math.sin((2 * Math.PI * 70 * i) / rate);
    });
    assert.ok(onsetContrastDb(drone, rate) < 3, `a drone: ${onsetContrastDb(drone, rate).toFixed(1)} dB`);
    assert.ok(onsetContrastDb(hits, rate) > MIN_ONSET_CONTRAST_DB, `four hits: ${onsetContrastDb(hits, rate).toFixed(1)} dB`);
    const drum = { prompt: "", seconds: 3, seed: 0, kind: "efekt" as const, percussive: true as const };
    assert.ok(soundProblems(ok, drum, onsetContrastDb(drone, rate))[0]!.startsWith("vuruş yok"));
    assert.deepEqual(soundProblems(ok, drum, onsetContrastDb(hits, rate)), []);
    assert.ok(PERCUSSIVE.has("davul") && PERCUSSIVE.has("adim") && !PERCUSSIVE.has("su"));
    assert.doesNotMatch(periodSfxPrompt("davul", "antik")!, /horn/, "hits only");
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
    // A long episode: 14 places, beds only for the 10 on screen the longest (each takes the designer ~2 minutes).
    const many = { ...ep, sahneler: Array.from({ length: 14 }, (_, i) => ({ ...ep.sahneler[0]!, id: `p${i}`, mekan: `Place ${i}`, harita: undefined })) } as typeof ep;
    const manyTl = { scenes: Array.from({ length: 14 }, (_, i) => ({ sceneIndex: i, start: i * 100, end: i * 100 + 10 + i })) } as unknown as Pick<EpisodeTimeline, "scenes">;
    const beds: string[] = [];
    const bedMaker = { make: async (r: { prompt: string; kind: string }) => (r.kind === "ortam" ? (beds.push(r.prompt), { file: `D:/ortam/${beds.length}.wav`, cached: false }) : { problems: ["-"] }) };
    const long = await designSounds(many, manyTl, [], bedMaker);
    assert.equal(long.ambience.length, MAX_AMBIENCE_PLACES);
    assert.equal(long.ambience[0]!.start, 400, "the shortest four places (0–3) carry music only");
    assert.ok(long.report.some((l) => l.startsWith("ortam p0: yalnız müzik")));
    const chain = ambienceChain(5, "o0", 3, 15);
    assert.match(chain, /^\[5:a\]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-38:TP=-9:LRA=11,afade=t=in:d=0\.6,afade=t=out:st=11\.400:d=0\.6,adelay=3000\|3000\[o0\]$/);
    assert.ok(AMBIENCE_LUFS < -26, "ambience sits under the music");
  });

  await scenario("sound brain: a fixed whine is found and cut; changing notes, a held note and inaudible peaks are not", () => {
    const rate = 48_000;
    let seed = 1;
    const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    // Sixteen different notes over sixteen half seconds (a tune seldom repeats one note in every quarter).
    const notes = [0, 7, 3, 10, 5, 12, 1, 8, 15, 4, 11, 6, 13, 2, 9, 14].map((k) => 196 * 2 ** (k / 12));
    // Eight seconds of "music": a new note every half second, played a little off and with vibrato like a real player,
    // harmonics up to 12 kHz, over a quiet noise floor.
    const detune = Array.from({ length: 16 }, () => 1 + 0.01 * noise());
    const music = (whineHz?: number, held?: { hz: number; untilS: number }) =>
      Float32Array.from({ length: rate * 8 }, (_, i) => {
        const t = i / rate;
        const seg = Math.floor(t * 2);
        const f0 = notes[seg]! * detune[seg]!;
        const along = t - (0.004 / (2 * Math.PI * 5.5)) * Math.cos(2 * Math.PI * 5.5 * t);
        let v = 0.001 * noise();
        for (let h = 1; h * f0 < 12_000; h++) v += (0.3 / h ** 1.5) * Math.sin(2 * Math.PI * h * f0 * along);
        if (whineHz) v += 0.004 * Math.sin(2 * Math.PI * whineHz * t);
        if (held && t < held.untilS) v += 0.02 * Math.sin(2 * Math.PI * held.hz * t);
        return v;
      });
    assert.deepEqual(whineLines(music(), rate), [], "changing notes leave a smooth long-term spectrum");
    const found = whineLines(music(7930), rate);
    assert.equal(found.length, 1, `one whine: ${JSON.stringify(found)}`);
    assert.ok(Math.abs(found[0]!.hz - 7930) < 15 && found[0]!.db > LINE_PROMINENCE_DB);
    // A tone held through the first quarter only stands out in the whole file but is music, not an artifact.
    assert.deepEqual(whineLines(music(undefined, { hz: 6100, untilS: 1.9 }), rate), [], "a held note moves on");
    // Far under the loudest band nobody hears it (a synthesised drum showed "lines" at −90 dB).
    const faint = Float32Array.from({ length: rate * 8 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / rate) + 1e-5 * Math.sin((2 * Math.PI * 7930 * i) / rate));
    assert.deepEqual(whineLines(faint, rate), [], "90 dB under the tone");
    assert.deepEqual(whineLines(music(15_996), rate, { minHz: 12_000 }).map((l) => Math.round(l.hz / 100)), [160], "an effect is searched from 12 kHz");
    assert.deepEqual(whineLines(music(7930), rate, { minHz: 12_000 }), [], "a bell's partial under 12 kHz stays");
    const chain = cleanupFilter([{ hz: 7930, db: 13 }, { hz: 16_000, db: 23 }]);
    assert.equal(chain, `equalizer=f=7930:t=h:w=60:g=-15,equalizer=f=16000:t=h:w=60:g=-25,lowpass=f=${CLEAN_LOWPASS_HZ}:p=2,lowpass=f=${CLEAN_LOWPASS_HZ}:p=2`);
    assert.equal(cleanupFilter(Array.from({ length: 80 }, (_, i) => ({ hz: 5000 + i * 100, db: 9 }))).split("equalizer").length - 1, MAX_NOTCHES);
    assert.equal(cleanupFilter([], { lowpass: false }), "");
    assert.match(whineLine([{ hz: 15_996, db: 22.9 }]), /^1 sabit tiz çizgi \(16,0 kHz \+23 dB\)$/);
    assert.equal(whineLine([]), "sabit tiz çizgi yok");
    assert.ok(EFFECT_LINE_MIN_HZ >= 12_000 && DUCK_ATTACK_MS >= 20, "effects keep their ring; ducking no longer clicks on low horns");
    // The composer asks turbo for shift 3.0, and a piece made at 1.0 is never taken from the library again.
    assert.equal(TURBO_SHIFT, 3);
    const req = { mood: "epic" as const, seconds: 25, caption: "c", seed: 470877 };
    const oldKey = createHash("sha256").update(JSON.stringify({ v: 1, model: "ACE-Step/Ace-Step1.5@acestep-v15-turbo", caption: "c", seconds: 25, seed: 470877 })).digest("hex").slice(0, 24);
    assert.notEqual(compositionKey(req), oldKey);
  });

  await scenario("VoxCPM voices: style per emotion, description with accent, engine choice and the off switch", async () => {
    assert.equal(voxcpmText("Retreat!", "korkmus"), "(scared, trembling voice)Retreat!");
    assert.equal(voxcpmText("The die is cast.", "notr"), "The die is cast.", "a neutral line has no instruction");
    const general = { saglayici: "kokoro" as const, perde: 0, hiz: 1, exaggeration: 0, cfg: 0, sicaklik: 0, dil: "en" as const, kokoro_ses: "am_fenrir", tarif: "booming, gruff man: a general, a soldier, a pasha who loves a fight" };
    assert.equal(voxcpmDescription(general), "booming, gruff man, American English accent, clear studio recording");
    assert.equal(voxcpmDescription({ ...general, kokoro_ses: "bm_george", tarif: "older British-accented man: an emperor" }), "older man, British English accent, clear studio recording");
    assert.equal(voxcpmDescription({ ...general, voxcpm_tarif: "a raspy old Roman senator" }), "a raspy old Roman senator", "an explicit description wins");
    const owner = { saglayici: "chatterbox" as const, referans: "owner-a", perde: -2.5, hiz: 0.92, exaggeration: 0.45, cfg: 0.5, sicaklik: 0.7 };
    assert.deepEqual([...voxcpmLanguages({})], [], "off unless the owner turns it on");
    assert.deepEqual([...voxcpmLanguages({ ATOLYE_V3_TTS_EN: "voxcpm", ATOLYE_V3_TTS_TR: "kokoro" })], ["en"]);
    const on = new Set(["en", "tr"] as const);
    assert.equal(chooseEngine(general, "en", on, false), "voxcpm");
    assert.equal(chooseEngine(owner, "tr", on, false), "voxcpm", "the owner's recording is cloned");
    assert.equal(chooseEngine(general, "en", new Set(), false), "kokoro", "not turned on: the voice's own engine");
    assert.equal(chooseEngine(general, "en", on, true), "kokoro", "after a failure: the voice's own engine for the whole run");
    assert.equal(chooseEngine({ ...general, tarif: undefined }, "en", on, false), "kokoro", "nothing to clone or design from");
    assert.ok(REFERENCE_TEXT.en.length > 40 && REFERENCE_TEXT.tr.length > 40);
    // The credits name the engines that voiced the lines, not the language's old default.
    assert.equal(voiceCredit(["voxcpm", "voxcpm"], "en"), "VoxCPM2 (OpenBMB, Apache-2.0), synthesized locally");
    assert.equal(voiceCredit(["voxcpm", "kokoro"], "en"), "Kokoro-82M (hexgrad, Apache-2.0), VoxCPM2 (OpenBMB, Apache-2.0), synthesized locally", "after a failure both engines are named");
    assert.match(voiceCredit(["chatterbox"], "tr"), /^Chatterbox Multilingual 0\.1\.7 \(Resemble AI, MIT\); karakter sesleri owner'ın kendi sesinden yerelde klonlandı\. .*Perth filigranı/);
    assert.doesNotMatch(voiceCredit(["voxcpm"], "tr"), /Perth/);
  });

  await scenario("stage directions are never spoken; VoxCPM gets them as its acting instruction", () => {
    assert.deepEqual(splitDirections("(steps up to the river, dramatic pause) If I cross, there's no turning back."), { speech: "If I cross, there's no turning back.", directions: ["steps up to the river, dramatic pause"] });
    assert.deepEqual(splitDirections("He should listen to the Senate! (puffing up) Or at least, to me."), { speech: "He should listen to the Senate! Or at least, to me.", directions: ["puffing up"] });
    assert.deepEqual(splitDirections("[aside] Very bold."), { speech: "Very bold.", directions: ["aside"] });
    assert.deepEqual(splitDirections("No directions here."), { speech: "No directions here.", directions: [] });
    assert.equal(splitDirections("(sighs) ").speech, "", "a line of only a direction says nothing");
    assert.equal(voxcpmText("Retreat is a bold strategy!", "korkmus", ["off map, panicked"]), "(scared, trembling voice, off map, panicked)Retreat is a bold strategy!");
    assert.equal(voxcpmText("The die is cast.", "notr", ["raising hand"]), "(raising hand)The die is cast.");
  });

  console.log(`V3 mix smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
