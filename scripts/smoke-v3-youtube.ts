/**
 * V3 smoke: the YouTube package (titles, thumbnail headlines, chapters, tags) and the thumbnail variants. Pure (no
 * model, no render). Run: npx tsx scripts/smoke-v3-youtube.ts
 */
import assert from "node:assert/strict";
import { judgePrompt } from "../src/lib/v3/backgrounds/BackgroundJudge";
import type { Episode } from "../src/lib/v3/episode/EpisodeTypes";
import { mainCharacters, thumbnailPlans } from "../src/lib/v3/thumbnail/ThumbnailDesigner";
import { chapters, chapterText, packagePrompt, readPackage } from "../src/lib/v3/thumbnail/YoutubePackage";

let scenarios = 0;
function scenario(name: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
  scenarios++;
}

const episode = {
  id: "rubicon",
  baslik: "Julius Caesar Crosses the Rubicon",
  konu: "Caesar crosses the Rubicon",
  donem: "49 BC",
  sahneler: [
    { id: "s1", mekan: "the Rubicon", yazi_karti: [{ metin: "DECISION", stil: "kelime" }], satirlar: [{ karakter: "caesar", metin: "The die is cast." }, { karakter: "anlatici", metin: "In 49 BC…" }] },
    { id: "s2", mekan: "the Senate", satirlar: [{ karakter: "pompey", metin: "He did what?" }, { karakter: "caesar", metin: "I did." }] },
    { id: "s3", mekan: "the road to Rome", satirlar: [{ karakter: "caesar", metin: "Onward." }] },
  ],
} as unknown as Episode;

function main() {
  scenario("A package: titles under 70 chars, 2–4 word headlines in capitals, a chapter title per scene, hashtags only", () => {
    const p = readPackage(
      JSON.stringify({
        basliklar: ["Caesar Crosses the Rubicon: Rome's Point of No Return", "x".repeat(90)],
        kapak_basliklari: ["point of no return", "this headline has far too many words in it", "HE DID WHAT?"],
        bolumler: ["The Border", "Panic in Rome"],
        etiketler: ["Julius Caesar", "Rubicon", "history animation"],
        hashtagler: ["#history", "not a tag", "#Rome"],
        aciklama_giris: "Julius Caesar crosses the Rubicon in 49 BC and Rome panics.",
      }),
      episode,
    );
    assert.deepEqual(p.basliklar, ["Caesar Crosses the Rubicon: Rome's Point of No Return"]);
    assert.deepEqual(p.kapakBasliklari, ["POINT OF NO RETURN", "HE DID WHAT?"]);
    assert.deepEqual(p.bolumler, ["The Border", "Panic in Rome", "the road to Rome"], "a missing chapter title falls back to the place");
    assert.deepEqual(p.hashtagler, ["#history", "#Rome"]);
    assert.match(packagePrompt(episode), /under 60 characters[\s\S]*2–4 words/);
  });

  scenario("B an unreadable answer still gives a title and a headline from the episode's own words", () => {
    const p = readPackage("no json", episode);
    assert.deepEqual(p.basliklar, [episode.baslik]);
    assert.deepEqual(p.kapakBasliklari, ["DECISION"]);
  });

  scenario("C chapters: from 0:00, short scenes merged, none when fewer than three remain", () => {
    const chs = chapters([3.5, 20, 25, 40, 80], ["Hook", "Senate", "Panic", "March", "Coda"], 95);
    assert.deepEqual(chs.map((c) => [c.t, c.baslik]), [[0, "Hook"], [20, "Senate"], [40, "March"], [80, "Coda"]]);
    assert.equal(chapterText(chs).split("\n")[0], "0:00 Hook");
    assert.equal(chapterText([{ t: 75, baslik: "x" }]), "1:15 x");
    assert.deepEqual(chapters([3.5, 12], ["a", "b"], 30), [], "YouTube needs at least three chapters");
  });

  scenario("D thumbnail: the lead by lines, a portrait, the rivals face to face, the second lead; judged at feed size", () => {
    const leads = mainCharacters(episode, new Set(["caesar", "pompey"]));
    assert.deepEqual(leads, ["caesar", "pompey"]);
    const sets = [{ src: "bg/s1.png", kind: "set" as const }, { src: "bg/s2.png", kind: "set" as const }, { src: "bg/s3.png", kind: "set" as const }];
    const plans = thumbnailPlans(episode, leads, sets, ["POINT OF NO RETURN", "HE DID WHAT?"]);
    assert.deepEqual(plans.map((p) => [p.ad, p.baslik, p.background.src, p.poses.length]), [["portre", "POINT OF NO RETURN", "bg/s1.png", 1], ["catisma", "HE DID WHAT?", "bg/s2.png", 2], ["portre-2", "POINT OF NO RETURN", "bg/s2.png", 1]]);
    assert.equal(thumbnailPlans(episode, [], sets, []).length, 0);
    assert.match(judgePrompt({ konu: "x", donem: "49 BC", mekan: "thumbnail", tr: "HE DID WHAT?", en: "", anlatim: "" }, { title: "k" }, "kapak"), /shown SMALL[\s\S]*HE DID WHAT\?/);
  });

  console.log(`V3 youtube smoke: PASS (${scenarios} scenarios)`);
}

main();
