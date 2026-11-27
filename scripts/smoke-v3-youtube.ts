/**
 * V3 smoke: the YouTube package (titles, thumbnail headlines, chapters, tags) and the thumbnail variants. Pure (no
 * model, no render). Run: npx tsx scripts/smoke-v3-youtube.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { choosePackagePair, contentWords, headlineLines, lintDescriptionLead, lintPair, lintTitle } from "../src/lib/v3/thumbnail/PackageLint";
import { judgePrompt } from "../src/lib/v3/backgrounds/BackgroundJudge";
import type { Episode } from "../src/lib/v3/episode/EpisodeTypes";
import { mainCharacters, thumbnailPlans } from "../src/lib/v3/thumbnail/ThumbnailDesigner";
import { chapters, chapterText, descriptionLead, packagePrompt, readPackage, uploadFileName } from "../src/lib/v3/thumbnail/YoutubePackage";

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
    assert.deepEqual(p.basliklar, ["Caesar Crosses the Rubicon: Rome's Point of No Return"], "assert.deepEqual(p.basliklar, [\"Caesar Crosses the Rubicon: Rome's Point of No Return\"])");
    assert.deepEqual(p.kapakBasliklari, ["HE DID WHAT?"], "the headline repeating the title's words is not drawn (PackageLint)");
    assert.equal(p.denetim?.yenidenSiralandi, true, "assert.equal(p.denetim?.yenidenSiralandi, true)");
    assert.deepEqual(p.bolumler, ["The Border", "Panic in Rome", "the road to Rome"], "a missing chapter title falls back to the place");
    assert.deepEqual(p.hashtagler, ["#history", "#Rome"], "assert.deepEqual(p.hashtagler, [\"#history\", \"#Rome\"])");
    assert.match(packagePrompt(episode), /under 60 characters[\s\S]*2–4 words/);
  });

  scenario("S a Short: #Shorts in every title and first among the hashtags, no chapter titles asked", () => {
    const answer = JSON.stringify({ basliklar: ["Caesar Crosses the Rubicon", "Rome Panics #shorts"], kapak_basliklari: ["NO RETURN"], hashtagler: ["#history", "#Shorts", "#Rome"] });
    const p = readPackage(answer, episode, true);
    assert.deepEqual(p.basliklar, ["Caesar Crosses the Rubicon #Shorts", "Rome Panics #shorts"], "assert.deepEqual(p.basliklar, [\"Caesar Crosses the Rubicon #Shorts\", \"Rome Panics #shorts\"])");
    assert.deepEqual(p.hashtagler, ["#Shorts", "#history", "#Rome"], "assert.deepEqual(p.hashtagler, [\"#Shorts\", \"#history\", \"#Rome\"])");
    assert.ok(!packagePrompt(episode, true).includes('"bolumler"') && packagePrompt(episode, true).includes("under 50 characters") && packagePrompt(episode).includes('"bolumler"'), "assert.ok(!packagePrompt(episode, true).includes('\"bolumler\"') && packagePrompt(episode, true).includes(\"under 50 characters\") && packagePrompt(episode).includes('\"bolumler\"'))");
    assert.deepEqual(readPackage(answer, episode).basliklar, ["Caesar Crosses the Rubicon", "Rome Panics #shorts"], "a normal video is left as written");
  });

  scenario("Q a question Short (owner, 23 Nov 2026, after Knowledgia's Shorts): the question is the title, its search wordings lead the tags, the prompt asks for more of them", () => {
    const asking = { ...episode, soru: "Why Did Caesar Cross the Rubicon?" } as Episode;
    const answer = JSON.stringify({ basliklar: ["Caesar Crosses the Rubicon", "Rome Panics"], kapak_basliklari: ["NO RETURN"], hashtagler: ["#history"], etiketler: ["why did caesar cross the rubicon", "julius caesar", "Rubicon"] });
    const p = readPackage(answer, asking, true);
    assert.deepEqual(p.basliklar, ["Why Did Caesar Cross the Rubicon? #Shorts", "Caesar Crosses the Rubicon #Shorts", "Rome Panics #Shorts"], "assert.deepEqual(p.basliklar, [\"Why Did Caesar Cross the Rubicon? #Shorts\", \"Caesar Crosses the Rubicon #Shorts\", \"Rome Panics #Shorts\"])");
    assert.equal(p.denetim?.baslik, "Why Did Caesar Cross the Rubicon? #Shorts", "the gate judges the title that goes out");
    assert.deepEqual(p.etiketler, ["why did caesar cross the rubicon", "why did caesar cross rubicon", "julius caesar", "Rubicon"], "the question's wordings first, the model's after, no repeat");
    const prompt = packagePrompt(asking, true);
    assert.ok(prompt.includes(`THE VIDEO'S QUESTION (its title, read out first): "Why Did Caesar Cross the Rubicon?"`) && prompt.includes("at least 5 of them are the question as viewers type it") && prompt.includes("answers the question in short"), prompt);
    // A long video, or a malformed question, keeps the package as before.
    assert.deepEqual(readPackage(answer, asking).basliklar, ["Caesar Crosses the Rubicon", "Rome Panics"], "assert.deepEqual(readPackage(answer, asking).basliklar, [\"Caesar Crosses the Rubicon\", \"Rome Panics\"])");
    assert.deepEqual(readPackage(answer, { ...asking, soru: "The Rubicon" } as Episode, true).basliklar[0], "Caesar Crosses the Rubicon #Shorts", "assert.deepEqual(readPackage(answer, { ...asking, soru: \"The Rubicon\" } as Episode, true).basliklar[0], \"Caesar Crosses the Rubicon #Shorts\")");
    assert.ok(!packagePrompt(episode, true).includes("THE VIDEO'S QUESTION"), "assert.ok(!packagePrompt(episode, true).includes(\"THE VIDEO'S QUESTION\"))");
  });

  scenario("B an unreadable answer still gives a title and a headline from the episode's own words", () => {
    const p = readPackage("no json", episode);
    assert.deepEqual(p.basliklar, [episode.baslik], "assert.deepEqual(p.basliklar, [episode.baslik])");
    assert.deepEqual(p.kapakBasliklari, ["DECISION"], "assert.deepEqual(p.kapakBasliklari, [\"DECISION\"])");
  });

  scenario("G title–thumbnail gate: on the studio's 14 real packages no chosen pair repeats a title word", () => {
    const rows = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "v3-paket-dokuz.json"), "utf8")) as { id: string; basliklar: string[]; kapakBasliklari: string[] }[];
    assert.equal(rows.length, 14, "assert.equal(rows.length, 14)");
    const repeatedFirst = rows.filter((r) => lintPair(r.basliklar[0]!, r.kapakBasliklari[0]!).some((i) => i.kod === "tekrar"));
    assert.equal(repeatedFirst.length, 9, "nine of the model's first pairs repeated a title word");
    for (const r of rows) {
      const c = choosePackagePair(r.basliklar, r.kapakBasliklari)!;
      assert.ok(!c.denetim.sorunlar.some((i) => i.kod === "tekrar"), `${r.id}: ${c.denetim.baslik} / ${c.denetim.kapak}`);
      assert.deepEqual([...c.basliklar].sort(), [...r.basliklar].sort(), "titles are only re-ordered, none lost or invented");
      assert.ok(c.kapakBasliklari.every((h) => r.kapakBasliklari.includes(h)), "assert.ok(c.kapakBasliklari.every((h) => r.kapakBasliklari.includes(h)))");
      assert.ok(c.kapakBasliklari.slice(1).every((h) => !lintPair(c.basliklar[0]!, h).some((i) => i.kod === "tekrar")), "no other variant repeats the chosen title");
    }
    const kosovo = choosePackagePair(["Battle of Kosovo: When Leaders Die in Battle", "Battle of Kosovo 1389: Betrayal and Bloodshed"], ["ONLY SULTAN KILLED?"])!;
    assert.equal(kosovo.basliklar[0], "Battle of Kosovo 1389: Betrayal and Bloodshed", "a soft issue (no year) decides between hard-clean titles");
    const tie = choosePackagePair(["Rome 49 BC: Caesar Crosses", "Rome 49 BC: Caesar Marches"], ["DIE IS CAST", "NO WAY BACK"])!;
    assert.equal(tie.denetim.yenidenSiralandi, false, "a tie keeps the model's order");
  });

  scenario("G2 title rules: length, shouting, phone cut, empty adjectives, AI phrasing and dashes (youtube-skills)", () => {
    const codes = (t: string) => lintTitle(t).map((i) => i.kod);
    assert.ok(codes("Hannibal's Elephants Cross the Alps in 218 BC and Rome Cannot Believe It").includes("uzunluk"), "assert.ok(codes(\"Hannibal's Elephants Cross the Alps in 218 BC and Rome Cannot Believe It\").includes(\"uzunluk\"))");
    assert.ok(codes("Hannibal CRUSHES ROME at CANNAE 216 BC").includes("bagirma"), "assert.ok(codes(\"Hannibal CRUSHES ROME at CANNAE 216 BC\").includes(\"bagirma\"))");
    assert.ok(!codes("Murad IV Storms Baghdad: The 1638 Siege #Shorts").includes("bagirma"), "a Roman numeral is not shouting");
    assert.ok(codes("The Epic Story of Cannae 216 BC").includes("bos-sifat"), "assert.ok(codes(\"The Epic Story of Cannae 216 BC\").includes(\"bos-sifat\"))");
    assert.ok(codes("A Deep Dive Into Cannae 216 BC").includes("yapay-dil"), "assert.ok(codes(\"A Deep Dive Into Cannae 216 BC\").includes(\"yapay-dil\"))");
    assert.ok(codes("Here’s What Nobody Tells You About Waterloo 1815").includes("yapay-dil"), "assert.ok(codes(\"Here’s What Nobody Tells You About Waterloo 1815\").includes(\"yapay-dil\"))");
    assert.ok(codes("Cannae — Rome — Hannibal 216 BC").includes("tire") && codes("Cannae – 216 BC").includes("tire"), "assert.ok(codes(\"Cannae — Rome — Hannibal 216 BC\").includes(\"tire\") && codes(\"Cannae – 216 BC\").includes(\"tire\"))");
    assert.deepEqual(codes("Cannae 216 BC — Hannibal’s Trap"), [], "one em dash, a year, the subject first: clean");
    assert.ok(codes("Anglo-Zanzibar War: The 38-Minute Clash").every((c) => c !== "tire"), "hyphens are not dashes");
    assert.ok(lintPair("Rubicon 49 BC: Caesar Gambles", "THE DIE IS CAST TODAY").some((i) => i.kod === "kapak-kalabalik"), "assert.ok(lintPair(\"Rubicon 49 BC: Caesar Gambles\", \"THE DIE IS CAST TODAY\").some((i) => i.kod === \"kapak-kalabalik\"))");
    assert.deepEqual([...contentWords("Julius Caesar’s Pirates #Shorts")].sort(), [...contentWords("PIRATE CAESAR JULIUS")].sort(), "possessive, plural and #Shorts fold to the same stems");
    assert.equal(contentWords("The Pirates of the Sea #Shorts").has("shorts"), false, "assert.equal(contentWords(\"The Pirates of the Sea #Shorts\").has(\"shorts\"), false)");
  });

  scenario("G3 description lead and headline lines (youtube-skills description-template, thumbnail-principles)", () => {
    const codes = (lead: string, title = "Anglo-Zanzibar War: The 38-Minute Clash #Shorts") => lintDescriptionLead(lead, title).map((i) => i.kod);
    assert.deepEqual(codes("The Anglo-Zanzibar War was the shortest war in history, lasting just 38 minutes. Watch the palace burn."), [], "assert.deepEqual(codes(\"The Anglo-Zanzibar War was the shortest war in history, lasting just 38 minutes. Watch the palace burn.\"), [])");
    assert.deepEqual(codes("Discover the Anglo-Zanzibar War, the shortest war in history. Watch how a 38-minute clash changed Zanzibar."), ["giris-yapay"], "assert.deepEqual(codes(\"Discover the Anglo-Zanzibar War, the shortest war in history. Watch how a 38-minute clash changed Zanzibar.\"), [\"giris-yapay\"])");
    assert.deepEqual(codes("A sultan, a palace and five British ships: the shortest fight ever lasted 38 minutes."), ["giris-anahtar"], "the title's subject (Anglo-Zanzibar War) is missing");
    assert.deepEqual(codes(""), ["giris-yok"], "assert.deepEqual(codes(\"\"), [\"giris-yok\"])");
    assert.ok(codes(`The Anglo-Zanzibar War ${"was very short and ".repeat(8)}ended.`).includes("giris-uzun"), "assert.ok(codes(`The Anglo-Zanzibar War ${\"was very short and \".repeat(8)}ended.`).includes(\"giris-uzun\"))");
    const p = readPackage(JSON.stringify({ basliklar: ["Caesar Crosses the Rubicon 49 BC"], kapak_basliklari: ["DIE IS CAST"], aciklama_giris: "Explore how Caesar crossed the Rubicon." }), episode);
    assert.deepEqual(p.aciklamaDenetim?.map((i) => i.kod), ["giris-yapay"], "the package carries the description's verdict");
    assert.match(packagePrompt(episode), /within 150 characters[\s\S]*never open with "Discover"/);
    assert.equal(headlineLines("WHO ASSASSINATED MURAD?"), 2, "measured on the Kosovo thumbnail: 16 capitals fill one line");
    assert.equal(headlineLines("TRAPPED!"), 1, "assert.equal(headlineLines(\"TRAPPED!\"), 1)");
    assert.equal(headlineLines("THE GREATEST BETRAYAL IN ALL OF HISTORY"), 3, "assert.equal(headlineLines(\"THE GREATEST BETRAYAL IN ALL OF HISTORY\"), 3)");
    assert.ok(lintPair("Waterloo 1815: Napoleon Falls", "THE GREATEST BETRAYAL IN ALL OF HISTORY").some((i) => i.kod === "kapak-satir"), "assert.ok(lintPair(\"Waterloo 1815: Napoleon Falls\", \"THE GREATEST BETRAYAL IN ALL OF HISTORY\").some((i) => i.kod === \"kapak-satir\"))");
    assert.ok(!lintPair("Waterloo 1815: Napoleon Falls", "WHO ASSASSINATED MURAD?").some((i) => i.kod === "kapak-satir"), "assert.ok(!lintPair(\"Waterloo 1815: Napoleon Falls\", \"WHO ASSASSINATED MURAD?\").some((i) => i.kod === \"kapak-satir\"))");
  });

  scenario("C chapters: from 0:00, short scenes merged, none when fewer than three remain", () => {
    const chs = chapters([3.5, 20, 25, 40, 80], ["Hook", "Senate", "Panic", "March", "Coda"], 95);
    assert.deepEqual(chs.map((c) => [c.t, c.baslik]), [[0, "Hook"], [20, "Senate"], [40, "March"], [80, "Coda"]], "assert.deepEqual(chs.map((c) => [c.t, c.baslik]), [[0, \"Hook\"], [20, \"Senate\"], [40, \"March\"], [80, \"Coda\"]])");
    assert.equal(chapterText(chs).split("\n")[0], "0:00 Hook", "assert.equal(chapterText(chs).split(\"\\n\")[0], \"0:00 Hook\")");
    assert.equal(chapterText([{ t: 75, baslik: "x" }]), "1:15 x", "assert.equal(chapterText([{ t: 75, baslik: \"x\" }]), \"1:15 x\")");
    assert.deepEqual(chapters([3.5, 12], ["a", "b"], 30), [], "YouTube needs at least three chapters");
  });

  scenario("C2 upload file name: the title's main part, the year, what the video is (owner's Kosovo name)", () => {
    const en = (baslik: string, donem: string) => uploadFileName({ baslik, donem }, "en");
    assert.equal(en("The Battle of Kosovo (1389): Sultan Murad I vs. Prince Lazar", "1389"), "battle-of-kosovo-1389-animated-history.mp4", "assert.equal(en(\"The Battle of Kosovo (1389): Sultan Murad I vs. Prince Lazar\", \"1389\"), \"battle-of-kosovo-1389-animated-history.mp4\")");
    assert.equal(en("Caesar Crosses the Rubicon: Rome’s Point of No Return", "49 BC"), "caesar-crosses-the-rubicon-49-bc-animated-history.mp4", "assert.equal(en(\"Caesar Crosses the Rubicon: Rome’s Point of No Return\", \"49 BC\"), \"caesar-crosses-the-rubicon-49-bc-animated-history.mp4\")");
    assert.equal(en("Hannibal Crosses the Alps: Elephants vs. Mountains", "218 BC"), "hannibal-crosses-the-alps-218-bc-animated-history.mp4", "assert.equal(en(\"Hannibal Crosses the Alps: Elephants vs. Mountains\", \"218 BC\"), \"hannibal-crosses-the-alps-218-bc-animated-history.mp4\")");
    assert.equal(uploadFileName({ baslik: "İstanbul'un Fethi — Bir Çağın Sonu", donem: "1453" }, "tr"), "istanbulun-fethi-1453-animasyonlu-tarih.mp4", "assert.equal(uploadFileName({ baslik: \"İstanbul'un Fethi — Bir Çağın Sonu\", donem: \"1453\" }, \"tr\"), \"istanbulun-fethi-1453-animasyonlu-tarih.mp4\")");
    assert.equal(en("Miloš Obilić", "1389"), "milos-obilic-1389-animated-history.mp4", "assert.equal(en(\"Miloš Obilić\", \"1389\"), \"milos-obilic-1389-animated-history.mp4\")");
    const long = en("Very Long Words ".repeat(8), "1066");
    assert.match(long, /^((very|long|words)-)+1066-animated-history\.mp4$/, long);
    assert.ok(long.length <= 70 + "-animated-history.mp4".length, "cut at a whole word, the year kept");
    assert.equal(en("???", "?"), "video-animated-history.mp4", "assert.equal(en(\"???\", \"?\"), \"video-animated-history.mp4\")");
  });

  scenario("D thumbnail: the lead by lines, a portrait, the rivals face to face, the second lead; judged at feed size", () => {
    const leads = mainCharacters(episode, new Set(["caesar", "pompey"]));
    assert.deepEqual(leads, ["caesar", "pompey"], "assert.deepEqual(leads, [\"caesar\", \"pompey\"])");
    const sets = [{ src: "bg/s1.png", kind: "set" as const }, { src: "bg/s2.png", kind: "set" as const }, { src: "bg/s3.png", kind: "set" as const }];
    const plans = thumbnailPlans(episode, leads, sets, ["POINT OF NO RETURN", "HE DID WHAT?"]);
    assert.deepEqual(plans.map((p) => [p.ad, p.baslik, p.background.src, p.poses.length]), [["portre", "POINT OF NO RETURN", "bg/s1.png", 1], ["catisma", "HE DID WHAT?", "bg/s2.png", 2], ["portre-2", "POINT OF NO RETURN", "bg/s2.png", 1]], "assert.deepEqual(plans.map((p) => [p.ad, p.baslik, p.background.src, p.poses.length]), [[\"portre\", \"POINT OF NO RETURN\", \"bg/s1.png\", 1], [\"catisma\", \"HE DID WHAT?\", \"bg/s2.png\", 2], [\"portre-2\", \"POINT OF NO RETURN\", \"bg/s2.png\", 1]])");
    assert.equal(thumbnailPlans(episode, [], sets, []).length, 0, "assert.equal(thumbnailPlans(episode, [], sets, []).length, 0)");
    assert.match(judgePrompt({ konu: "x", donem: "49 BC", mekan: "thumbnail", tr: "HE DID WHAT?", en: "", anlatim: "" }, { title: "k" }, "kapak"), /shown SMALL[\s\S]*HE DID WHAT\?/);
  });

  scenario("E a Short's description lead (owner, 27 Nov 2026, 1 subscriber from ~14,900 views): the short answer first, the channel's promise right under it; without one, as before", () => {
    const answer = "Pizarro's 168 Spaniards captured Atahualpa by surprise at Cajamarca in 1532.";
    const promise = "Crowns & Doodles: history's most insane moments, told on a map in about a minute. A new one every Tue, Thu & Sat — subscribe so you don't miss the next.";
    assert.equal(descriptionLead(answer, promise), `${answer}

${promise}

`);
    assert.equal(descriptionLead(answer), `${answer}

`, "a long video or a goals file without the block: unchanged");
    assert.equal(descriptionLead("", promise), `${promise}

`);
    assert.equal(descriptionLead(undefined, undefined), "");
  });

  console.log(`V3 youtube smoke: PASS (${scenarios} scenarios)`);
}

main();
