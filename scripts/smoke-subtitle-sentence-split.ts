/**
 * Documentary pipeline V2 (Faz 1): sentence-level subtitle cue splitting.
 *
 * Covers SubtitleGenerator.splitTurkishSentences (Turkish-aware segmentation
 * with abbreviation / Roman-numeral / ordinal guards) and the new
 * buildChapterSubtitles behaviour: a long multi-sentence chapter is split into
 * per-sentence cues distributed by character length, while short or
 * single-sentence chapters keep exactly one cue (unchanged from before).
 * Invariants checked: contiguous cue boundaries, per-chapter windows unchanged,
 * totalDurationSeconds unchanged.
 */
import assert from "node:assert/strict";
import type { AudioData } from "../src/types/audio";
import {
  buildChapterSubtitles,
  splitTurkishSentences,
} from "../src/lib/export/SubtitleGenerator";

let count = 0;
function scenario(name: string, test: () => void) {
  test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function section(chapterId: number, sourceText: string): AudioData["sections"][number] {
  return {
    chapterId,
    title: `Bölüm ${chapterId}`,
    duration: "00:20",
    emotion: "serious",
    emphasis: [],
    narrationNotes: "",
    pacing: "medium",
    sourceText,
    outputAssetId: `asset-${chapterId}`,
    status: "generated",
    provider: "openai",
    model: "mock-tts",
    audioFileUrl: `/api/assets/audio/x/${chapterId}.wav`,
    byteLength: 1000,
    durationSeconds: 20,
  };
}

function audioWith(sections: AudioData["sections"]): AudioData {
  return {
    narrator: { style: "documentary", tone: "serious", language: "tr" },
    sections,
    music: { mood: "cinematic", suggestion: "orchestral", intensity: "medium" },
    production: {
      targetFormat: "wav",
      sampleRate: 24000,
      estimatedTotalDuration: "00:40",
      generationStatus: "generated",
    },
    createdAt: "2026-08-29T00:00:00.000Z",
  };
}

function run() {
  scenario("splitTurkishSentences splits plain sentences", () => {
    const parts = splitTurkishSentences(
      "Şehir kuşatıldı. Toplar ateşlendi. Surlar düştü.",
    );
    assert.deepEqual(parts, [
      "Şehir kuşatıldı.",
      "Toplar ateşlendi.",
      "Surlar düştü.",
    ]);
  });

  scenario("splitTurkishSentences keeps 'II. Murad' as one sentence", () => {
    const parts = splitTurkishSentences(
      "Babası II. Murad 1451'de öldü. Genç padişah tahta çıktı.",
    );
    assert.equal(parts.length, 2);
    assert.equal(parts[0], "Babası II. Murad 1451'de öldü.");
  });

  scenario("splitTurkishSentences keeps digit ordinal '2. Mehmed' joined", () => {
    const parts = splitTurkishSentences("Fatih 2. Mehmed bunu emretti. Ordu hazırlandı.");
    assert.equal(parts.length, 2);
    assert.equal(parts[0], "Fatih 2. Mehmed bunu emretti.");
  });

  scenario("splitTurkishSentences does not split on abbreviation 'vb.'", () => {
    const parts = splitTurkishSentences("Toplar, kuşatma kuleleri vb. hazırlandı. Saldırı başladı.");
    assert.equal(parts.length, 2);
    assert.equal(parts[0], "Toplar, kuşatma kuleleri vb. hazırlandı.");
  });

  scenario("splitTurkishSentences returns single element when no boundary", () => {
    assert.deepEqual(splitTurkishSentences("tek bir cümle burada"), [
      "tek bir cümle burada",
    ]);
  });

  scenario("splitTurkishSentences handles '?!' and '...' runs", () => {
    const parts = splitTurkishSentences("Şehir düşecek mi?! Kimse bilmiyordu... Sonra sabah geldi.");
    assert.equal(parts.length, 3);
    assert.equal(parts[1], "Kimse bilmiyordu...");
  });

  scenario("long multi-sentence chapter splits into per-sentence cues by char length", () => {
    const s1 =
      "Fatih Sultan Mehmet 1451 yılında Osmanlı tahtına çıktığında henüz on dokuz yaşındaydı ancak kararlıydı.";
    const s2 =
      "İstanbul'un fethi için devasa toplar döktürdü, donanmasını güçlendirdi ve ordusunu aylarca eğitti.";
    const result = buildChapterSubtitles(
      audioWith([section(1, `${s1} ${s2}`)]),
      new Map([[1, 30]]),
    );
    assert.equal(result.cues.length, 2);
    assert.equal(result.cues[0].text, s1);
    assert.equal(result.cues[1].text, s2);
    assert.equal(result.cues[0].startSeconds, 0);
    // boundary is contiguous and proportional to s1's share of characters
    assert.equal(result.cues[0].endSeconds, result.cues[1].startSeconds);
    assert.equal(result.cues[1].endSeconds, 30);
    const expectedBoundary = (s1.length / (s1.length + s2.length)) * 30;
    assert.ok(Math.abs(result.cues[0].endSeconds - expectedBoundary) < 1e-9);
    assert.equal(result.totalDurationSeconds, 30);
  });

  scenario("short chapter stays a single cue (unreadably short slices rejected)", () => {
    const result = buildChapterSubtitles(
      audioWith([section(1, "Kısa cümle bir. Kısa cümle iki.")]),
      new Map([[1, 2]]),
    );
    assert.equal(result.cues.length, 1);
    assert.equal(result.cues[0].startSeconds, 0);
    assert.equal(result.cues[0].endSeconds, 2);
  });

  scenario("multi-chapter: cue indices are global and chapter windows are preserved", () => {
    const long =
      "Birinci uzun cümle burada yeterince karakter içeriyor ki okunabilir olsun diye yazıldı. " +
      "İkinci uzun cümle de aynı şekilde yeterince uzun ve okunabilir bir süre kaplayacak kadar karakter taşıyor.";
    const result = buildChapterSubtitles(
      audioWith([section(1, long), section(2, "Tek cümlelik ikinci bölüm burada.")]),
      new Map([
        [1, 30],
        [2, 12],
      ]),
    );
    // chapter 1 -> 2 cues, chapter 2 -> 1 cue
    assert.equal(result.cues.length, 3);
    assert.deepEqual(
      result.cues.map((c) => c.index),
      [1, 2, 3],
    );
    assert.equal(result.cues[0].startSeconds, 0);
    assert.equal(result.cues[1].endSeconds, 30); // chapter 1 window ends at 30
    assert.equal(result.cues[2].startSeconds, 30); // chapter 2 starts at 30
    assert.equal(result.cues[2].endSeconds, 42);
    assert.equal(result.totalDurationSeconds, 42);
    // SRT cue numbering is sequential
    assert.match(result.srt, /^1\r\n00:00:00,000 -->/);
    assert.match(result.srt, /\r\n3\r\n00:00:30,000 --> 00:00:42,000\r\n/);
  });

  console.log(`Subtitle sentence-split smoke: PASS (${count} scenarios)`);
  console.log(
    JSON.stringify({ status: "PASS", suite: "subtitle-sentence-split", scenarios: count }),
  );
}

try {
  run();
} catch (error) {
  console.error("Subtitle sentence-split smoke FAILED:", error);
  process.exitCode = 1;
}
