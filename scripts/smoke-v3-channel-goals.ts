/**
 * V3 smoke: Crowns & Doodles' video goals (owner, 5 Nov 2026) — the one goals file, length-normalised targets, the
 * Short beat map handed to the writer, the first-3-seconds and scene-plan QC, post-publish records that never count
 * an unmeasured number as reached, targets that only ever rise, and the pilot's balanced plan; since 19 Nov 2026 the
 * YouTube Analytics reader (J–P): API rows → records with null for what the API lacks, due moments, retention drops →
 * the right brain's lesson on the right scene and line, one owner message a day for a dead connection, no pull
 * without a token, and `kaydet`'s judge shared unchanged; Q (19 Nov 2026): a mostly paid video is read and taught on its
 * organic viewers (traffic without ADVERTISING, the ORGANIC retention curve), and `--yeniden` reads it again; R: a video
 * is linked to the production it came from by a renamed file in its folder, by the take whose plan fits its length, and
 * by the delivered round's own plan.
 * No network (a fake fetcher), no model, no production data (records go to a TEMP work root).
 * Run: npx tsx scripts/smoke-v3-channel-goals.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { recentTalk } from "../src/lib/v3/council/DevBrain";
import { allLessons } from "../src/lib/v3/council/ExperienceMemory";
import { AFTER_HOOK_S, analyticsRecord, channelSummary, dueMoments, episodeTimeline, feedCurve, holdAfterHook, isoDurationS, organicViews, retentionDrops, retentionLessons } from "../src/lib/v3/publish/ChannelAnalyticsMap";
import {
  channelGoalNote, evaluatePerformance, latestPerVideo, loadChannelGoals, nextShortTargets, openingChecks, parseChannelGoals,
  PERFORMANCE_METRICS, performanceLessons, pilotTrends, recordViewRatio, scenePlanCheck, shortBeatRule, shortBeats, type VideoPerformanceRecord, viewTargetSeconds,
} from "../src/lib/v3/publish/ChannelGoals";
import { keepRound, restoreRound } from "../src/lib/v3/council/RetouchBrain";
import { judgeAndTeach, linkCandidates, linkOrder, loadTimeline, ordersWithPackages } from "../src/lib/v3/publish/ChannelLearning";
import { BASIC_METRICS, RECONNECT_NOTICE, youtubeAnalyticsTick } from "../src/lib/v3/publish/YoutubeAnalytics";
import { connectionLines, type Fetcher, hasAnalyticsScope, YOUTUBE_SCOPES } from "../src/lib/v3/publish/YoutubeAuth";
import { listPerformance, parsePerformanceInput, savePerformance } from "../src/lib/v3/publish/VideoPerformanceStore";
import { writingPrompt } from "../src/lib/v3/script/ScriptPrompts";

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

const contentRoot = path.join(process.cwd(), "content", "v3");
const goals = loadChannelGoals(contentRoot)!;
const empty = Object.fromEntries(PERFORMANCE_METRICS.map((k) => [k, null])) as VideoPerformanceRecord["metrikler"];
const rec = (videoId: string, metrics: Partial<VideoPerformanceRecord["metrikler"]>, extra: Partial<VideoPerformanceRecord> = {}): VideoPerformanceRecord =>
  ({ schemaVersion: 1, videoId, sureSn: 45, olcumTarihi: "2026-11-12", olcumAni: "7g", kaynak: "studio-elle", metrikler: { ...empty, ...metrics }, ...extra });

/* ---- the YouTube Analytics fixtures: one 45 s Short, its production (plan + episode), a fake Google ---- */
const CHANNEL = "UC3u0Kx_T49g9qdLFOagsN8A";
const NOW = new Date("2026-11-19T12:00:00Z");
const VIDEO = "shortVid001";
const BASIC_ROW = { views: 1000, engagedViews: 600, estimatedMinutesWatched: 450, averageViewDuration: 27, averageViewPercentage: 60, likes: 40, comments: 5, shares: 3, subscribersGained: 2 };
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
/** 100 points of a 45 s Short: a weak hook, then a map-scene drop at ~10 s and a joke-scene drop at ~22 s; everyone leaves at the very end. */
const CURVE_ROWS = Array.from({ length: 100 }, (_, j) => {
  const i = j + 1, t = i * 0.45;
  let w = t <= 3 ? 1 - 0.1 * t : 0.7 - (0.002 * (t - 3)) / 0.45;
  if (t > 10) w -= 0.08;
  if (t > 22) w -= 0.12;
  if (i > 96) w -= 0.3;
  return [i / 100, r4(w), i === 7 ? 0.3 : 0.5];
});
const TRAFFIC_ROWS = [["SHORTS", 900], ["YT_SEARCH", 50], ["SUBSCRIBER", 30], ["ADVERTISING", 20]];
/** A promoted Short (the Cannae Short of 9 Nov 2026 had 2,369 of its 2,657 views from ads): 80 % paid. */
const PAID_TRAFFIC_ROWS = [["ADVERTISING", 800, 36], ["SHORTS", 180, 20], ["YT_SEARCH", 20, 15]];
/** The organic viewers of that Short: the hook holds, then half of them leave between 4 and 10 s (the narrator's date line). */
const ORGANIC_ROWS = Array.from({ length: 100 }, (_, j) => {
  const i = j + 1, t = i * 0.45;
  const w = t <= 4 ? 1.2 - 0.02 * t : t <= 10 ? 1.12 - (0.56 * (t - 4)) / 6 : 0.56 - 0.004 * (t - 10);
  return [i / 100, r4(w), 0.5];
});
const PLAN = {
  plan: {
    fps: 30, durationInFrames: 1350,
    shots: [{ sceneId: "s1-hook", start: 0, duration: 150 }, { sceneId: "s2-map", start: 150, duration: 300 }, { sceneId: "s2-map", start: 450, duration: 150 }, { sceneId: "s3-joke", start: 600, duration: 450 }, { sceneId: "s4-end", start: 1050, duration: 300 }],
    captions: [
      { start: 6, end: 60, speaker: "caesar", words: [{ text: "You" }, { text: "kidnapped" }, { text: "me?" }] },
      { start: 270, end: 330, speaker: "narrator", words: [{ text: "Rhodes" }, { text: "was" }, { text: "close." }] },
      { start: 620, end: 700, speaker: "pirate", words: [{ text: "Ransom" }, { text: "is" }, { text: "twenty" }, { text: "talents." }] },
    ],
  },
};
const EPISODE = { sahneler: [{ id: "s1-hook", duygu: "merak" }, { id: "s2-map", duygu: "gerilim", harita: { tur: "yakin" } }, { id: "s3-joke", duygu: "komik" }, { id: "s4-end", duygu: "zafer" }] };

/** A work root with one delivered order whose upload file name the channel's video carries, and a secrets folder. */
function fixture(o: { readonly token?: boolean; readonly scope?: string } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "v3-yt-analitik-"));
  const workRoot = path.join(root, "work");
  const cikti = path.join(workRoot, "bolumler", "o-caesar");
  mkdirSync(cikti, { recursive: true });
  writeFileSync(path.join(cikti, "youtube.json"), JSON.stringify({ paket: { basliklar: ["Never Kidnap a Future Emperor #Shorts"] }, dosya: "caesar-animated-history.mp4" }));
  writeFileSync(path.join(cikti, "plan.json"), JSON.stringify(PLAN));
  writeFileSync(path.join(cikti, "episode.json"), JSON.stringify(EPISODE));
  mkdirSync(path.join(workRoot, "_kutuphane", "siparisler"), { recursive: true });
  writeFileSync(path.join(workRoot, "_kutuphane", "siparisler", "o-caesar.json"), JSON.stringify({ id: "o-caesar", konu: "Caesar and the pirates", donem: "75 BC", sure: "45sn", dil: "en", ton: "mizahi", kaynak: "owner", olusturuldu: "2026-11-01T00:00:00Z", durum: "teslim", cikti }));
  const dir = path.join(root, "secrets");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "client.json"), JSON.stringify({ installed: { client_id: "cid", client_secret: "sec" } }));
  if (o.token !== false) writeFileSync(path.join(dir, "token.json"), JSON.stringify({ refreshToken: "rt", channelId: CHANNEL, channelTitle: "Crowns & Doodles", scope: o.scope ?? YOUTUBE_SCOPES.join(" "), baglandi: "2026-11-15T00:00:00.000Z" }));
  return { workRoot, settings: { dir } };
}

/** Google, faked: the token endpoint, the Data API and the Analytics reports; every URL called is kept. */
function fakeGoogle(o: { readonly tokenError?: string; readonly analytics403?: boolean; readonly paid?: boolean } = {}) {
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (url.startsWith("https://oauth2.googleapis.com/token")) return o.tokenError ? Response.json({ error: o.tokenError }, { status: 400 }) : Response.json({ access_token: "at", expires_in: 3600 });
    if (u.pathname.endsWith("/youtube/v3/channels")) return Response.json({ items: [{ id: CHANNEL, snippet: { title: "Crowns & Doodles" }, status: {}, brandingSettings: {}, contentDetails: { relatedPlaylists: { uploads: "UU3u0Kx_T49g9qdLFOagsN8A" } } }] });
    if (u.pathname.endsWith("/youtube/v3/playlistItems")) {
      return Response.json({ items: [
        { contentDetails: { videoId: VIDEO, videoPublishedAt: "2026-11-08T10:00:00Z" } },
        { contentDetails: { videoId: "oldVideo001", videoPublishedAt: "2026-08-01T10:00:00Z" } },
      ], nextPageToken: "more" });
    }
    if (u.pathname.endsWith("/youtube/v3/videos")) {
      assert.equal(u.searchParams.get("id"), VIDEO, "only the recent video's details are asked for");
      return Response.json({ items: [{ id: VIDEO, snippet: { title: "A title that matches no package", publishedAt: "2026-11-08T10:00:00Z" }, contentDetails: { duration: "PT45S" }, statistics: { viewCount: "1500" }, fileDetails: { fileName: "caesar-animated-history.mp4" } }] });
    }
    if (u.origin === "https://youtubeanalytics.googleapis.com") {
      if (o.analytics403) return Response.json({ error: { code: 403, message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] } }, { status: 403 });
      assert.equal(u.searchParams.get("ids"), "channel==MINE");
      const filters = u.searchParams.get("filters");
      assert.ok(filters === `video==${VIDEO}` || (o.paid && filters === `video==${VIDEO};audienceType==ORGANIC`), `filters ${filters}`);
      const dims = u.searchParams.get("dimensions");
      if (!dims) {
        assert.equal(u.searchParams.get("metrics"), BASIC_METRICS.join(","));
        return Response.json({ columnHeaders: BASIC_METRICS.map((name) => ({ name })), rows: [BASIC_METRICS.map((m) => BASIC_ROW[m])] });
      }
      if (dims === "elapsedVideoTimeRatio") return Response.json({ columnHeaders: [{ name: "elapsedVideoTimeRatio" }, { name: "audienceWatchRatio" }, { name: "relativeRetentionPerformance" }], rows: filters!.endsWith("ORGANIC") ? ORGANIC_ROWS : CURVE_ROWS });
      if (dims === "insightTrafficSourceType") {
        assert.equal(u.searchParams.get("metrics"), "views,averageViewDuration", "each source's average view, so the paid ones can be taken out");
        return o.paid ? Response.json({ columnHeaders: [{ name: "insightTrafficSourceType" }, { name: "views" }, { name: "averageViewDuration" }], rows: PAID_TRAFFIC_ROWS }) : Response.json({ columnHeaders: [{ name: "insightTrafficSourceType" }, { name: "views" }], rows: TRAFFIC_ROWS });
      }
    }
    throw new Error(`unexpected request ${url}`);
  };
  return { fetcher, calls };
}
const apiRecord = () => analyticsRecord({ video: { videoId: VIDEO, title: "Never Kidnap a Future Emperor #Shorts", publishedAt: "2026-11-08T10:00:00Z", durationS: 45 }, moment: { olcumAni: "7g", endDate: "2026-11-15" }, basic: BASIC_ROW, retention: CURVE_ROWS.map(([a, b, c]) => ({ elapsedVideoTimeRatio: a!, audienceWatchRatio: b!, relativeRetentionPerformance: c! })), traffic: TRAFFIC_ROWS.map(([k, v]) => ({ insightTrafficSourceType: k!, views: v! })) });

async function main() {
  await scenario("A the goals file holds the owner's real Studio numbers and is the only source", () => {
    assert.ok(goals, "content/v3/kanal-hedefleri.json is read");
    assert.equal(goals.kanal.ad, "Crowns & Doodles", "assert.equal(goals.kanal.ad, \"Crowns & Doodles\")");
    assert.equal(goals.kanal.dil, "en-US", "assert.equal(goals.kanal.dil, \"en-US\")");
    const v = goals.baslangic.video;
    assert.deepEqual([v.videoId, v.izlemeyiSecenler, v.ortIzlemeSn, v.goruntuleme], ["q8JW_i5Gt0M", 0.52, 23, 1190], "video numbers, not the channel's");
    assert.equal((goals.baslangic.kanal as { izlemeyiSecenler: number }).izlemeyiSecenler, 0.519, "assert.equal((goals.baslangic.kanal as { izlemeyiSecenler: number }).izlemeyiSecenler, 0.519)");
    assert.deepEqual([goals.hedefler.short.izlemeyiSecenler.min, goals.hedefler.short.izlemeyiSecenler.max], [0.58, 0.6], "assert.deepEqual([goals.hedefler.short.izlemeyiSecenler.min, goals.hedefler.short.izlemeyiSecenler.max], [0.58, 0.6])");
    assert.equal(goals.hedefler.uzun.durum, "HEDEF_TANIMLANMADI", "no invented long-video target");
    assert.deepEqual(goals.diziler.map((d) => [d.oncelik, d.ad]), [[1, "History's Most Insane Moments"], [2, "Wars That Changed Everything"], [3, "Rise and Fall of Empires"]], "assert.deepEqual(goals.diziler.map((d) => [d.oncelik, d.ad]), [[1, \"History's Most Insane Moments\"], [2, \"Wars That Changed Everything\"], [3, \"Rise and Fall of Empires\"]])");
    // The numbers live in the JSON only: the code that uses them does not repeat them.
    for (const file of ["src/lib/v3/publish/ChannelGoals.ts", "src/lib/v3/script/ScriptPrompts.ts", "scripts/atolye-v3.ts"]) {
      assert.doesNotMatch(readFileSync(path.join(process.cwd(), file), "utf8"), /0\.58\b|0\.622\b|26–28 s/, `${file} copies a goal number`);
    }
  });

  await scenario("B watch time is judged by the video's own length: 45 s → 26–28 s, 30 s and 60 s scale; a long video has no target", () => {
    assert.deepEqual(viewTargetSeconds(goals, 45), { min: 26, max: 28 }, "assert.deepEqual(viewTargetSeconds(goals, 45), { min: 26, max: 28 })");
    assert.deepEqual(viewTargetSeconds(goals, 30), { min: 17.3, max: 18.7 }, "assert.deepEqual(viewTargetSeconds(goals, 30), { min: 17.3, max: 18.7 })");
    assert.deepEqual(viewTargetSeconds(goals, 60), { min: 34.7, max: 37.3 }, "assert.deepEqual(viewTargetSeconds(goals, 60), { min: 34.7, max: 37.3 })");
    assert.equal(viewTargetSeconds(goals, 600), undefined, "assert.equal(viewTargetSeconds(goals, 600), undefined)");
  });

  await scenario("C the Short beat map: 0–2 s hook stays, the rest keeps its share; the writer gets it for a Short only", () => {
    assert.deepEqual(shortBeats(goals, 45).map((b) => [b.id, b.basSn, b.bitSn]), [["kanca", 0, 2], ["baglam", 2, 8], ["ilk_hamle", 8, 12], ["catisma", 12, 24], ["doruk", 24, 38], ["final", 38, 45]]);
    // The 90 s default (owner, 23 Nov 2026): the hook, the stakes and the first action keep their seconds — scaled as
    // before, the stakes ran 2–16 s and the first action came at ~23 s, in the window where half the viewers swipe away.
    assert.deepEqual(shortBeats(goals, 90).map((b) => [b.id, b.basSn, b.bitSn]), [["kanca", 0, 2], ["baglam", 2, 8], ["ilk_hamle", 8, 12], ["catisma", 12, 40], ["doruk", 40, 73], ["final", 73, 90]]);
    for (const t of [60, 90, 120, 180]) assert.deepEqual(shortBeats(goals, t).slice(0, 3).map((b) => b.bitSn), [2, 8, 12], `${t} s`);
    assert.match(shortBeatRule(goals, 90, "en"), /8–12 s the first action on screen[^;]*no backstory before it/);
    const b30 = shortBeats(goals, 30);
    assert.deepEqual([b30[0]!.basSn, b30[0]!.bitSn, b30.at(-1)!.bitSn], [0, 2, 30], "assert.deepEqual([b30[0]!.basSn, b30[0]!.bitSn, b30.at(-1)!.bitSn], [0, 2, 30])");
    assert.ok(b30.every((b, i) => b.bitSn > b.basSn && (i === 0 || b.basSn === b30[i - 1]!.bitSn)), "assert.ok(b30.every((b, i) => b.bitSn > b.basSn && (i === 0 || b.basSn === b30[i - 1]!.bitSn)))");
    assert.equal(shortBeats(goals, 60).at(-1)!.bitSn, 60, "assert.equal(shortBeats(goals, 60).at(-1)!.bitSn, 60)");
    const rule = shortBeatRule(goals, 45, "en");
    assert.match(rule, /^- BEAT MAP \(approximate; the story's own flow comes first\): 0–2 s the hook/);
    assert.match(rule, /38–45 s a memorable closing quip .*never "subscribe"/);
    const brief = { konu: "Caesar and the pirates", donem: "75 BC", ton: "mizahi" as const, dil: "en" as const };
    assert.ok(writingPrompt({ ...brief, hedefSureSn: 45, kisaZamanHaritasi: rule }, []).includes(rule), "assert.ok(writingPrompt({ ...brief, hedefSureSn: 45, kisaZamanHaritasi: rule }, []).includes(rule))");
    assert.ok(!writingPrompt({ ...brief, hedefSureSn: 45 }, []).includes("BEAT MAP"), "without goals the prompt is as before");
    assert.match(shortBeatRule(goals, 45, "tr"), /^- ZAMAN HARİTASI/);
  });

  await scenario("D a missing number is never a pass: VERI_EKSIK; the Caesar baseline is below the new targets; a long video has none", () => {
    const caesar = rec("q8JW_i5Gt0M", { izlemeyiSecenler: 0.52, ortIzlemeSn: 23 }, { sureSn: 44 });
    const e = evaluatePerformance(caesar, goals);
    assert.equal(e.sonuc, "HEDEF_ALTI", "assert.equal(e.sonuc, \"HEDEF_ALTI\")");
    assert.deepEqual(e.kontroller.map((c) => c.durum), ["HEDEF_ALTI", "HEDEF_ALTI"], "assert.deepEqual(e.kontroller.map((c) => c.durum), [\"HEDEF_ALTI\", \"HEDEF_ALTI\"])");
    assert.equal(e.kontroller[0]!.baslangicFarki, 0, "assert.equal(e.kontroller[0]!.baslangicFarki, 0)");
    assert.equal(evaluatePerformance(rec("x0000000001", { ortIzlemeSn: 30 }), goals).sonuc, "VERI_EKSIK", "assert.equal(evaluatePerformance(rec(\"x0000000001\", { ortIzlemeSn: 30 }), goals).sonuc, \"VERI_EKSIK\")");
    assert.equal(evaluatePerformance(rec("x0000000002", {}), goals).kontroller[1]!.durum, "OLCULMEDI", "assert.equal(evaluatePerformance(rec(\"x0000000002\", {}), goals).kontroller[1]!.durum, \"OLCULMEDI\")");
    assert.equal(evaluatePerformance(rec("x0000000003", { izlemeyiSecenler: 0.59, ortIzlemeSn: 27 }), goals).sonuc, "HEDEFTE", "assert.equal(evaluatePerformance(rec(\"x0000000003\", { izlemeyiSecenler: 0.59, ortIzlemeSn: 27 }), goals).sonuc, \"HEDEFTE\")");
    assert.equal(evaluatePerformance(rec("x0000000004", { izlemeyiSecenler: 0.7, ortGoruntulenenYuzde: 1.1 }), goals).sonuc, "HEDEF_USTU", "Studio's own viewed share is preferred (a loop passes 100%)");
    assert.equal(evaluatePerformance(rec("x0000000005", { izlemeyiSecenler: 0.7, ortIzlemeSn: 300 }, { sureSn: 900 }), goals).sonuc, "HEDEF_YOK", "assert.equal(evaluatePerformance(rec(\"x0000000005\", { izlemeyiSecenler: 0.7, ortIzlemeSn: 300 }, { sureSn: 900 }), goals).sonuc, \"HEDEF_YOK\")");
    assert.deepEqual(performanceLessons(rec("x0000000006", {}), evaluatePerformance(rec("x0000000006", {}), goals)), [], "no lesson from numbers nobody measured");
    const lessons = performanceLessons(caesar, e, { kanca: "0.0 sn'de Caesar konuşuyor" });
    assert.equal(lessons.length, 1, "assert.equal(lessons.length, 1)");
    assert.match(lessons[0]!.metin, /52% of the feed chose to view it \(target 58%–60%\).*Its opening: 0\.0 sn'de Caesar konuşuyor\. Below target — the first 2 seconds/);
  });

  await scenario("E the owner's Studio reading parses as written (Turkish numbers, percents); bad input fails loudly", () => {
    const r = parsePerformanceInput({ videoId: "q8JW_i5Gt0M", sureSn: 44, olcumAni: "7g", olcumTarihi: "2026-11-05", metrikler: { izlemeyiSecenler: "52%", kaydiranlar: 48, goruntuleme: "1.190", izlenmeSaat: "3,8", ortIzlemeSn: 23, ortGoruntulenenYuzde: "104%" }, ulkeler: [{ ulke: "us", pay: "25,5%", goruntuleme: 307, ortIzlemeSn: 30 }], trafik: { shortsAkisi: "96,8%", youtubeArama: 0.008 } });
    assert.deepEqual([r.metrikler.izlemeyiSecenler, r.metrikler.kaydiranlar, r.metrikler.goruntuleme, r.metrikler.izlenmeSaat, r.metrikler.ortGoruntulenenYuzde], [0.52, 0.48, 1190, 3.8, 1.04], "assert.deepEqual([r.metrikler.izlemeyiSecenler, r.metrikler.kaydiranlar, r.metrikler.goruntuleme, r.metrikler.izlenmeSaat, r.metrikler.ortGoruntulenenYuzde], [0.52, 0.48, 1190, 3.8, 1.04])");
    assert.equal(parsePerformanceInput({ videoId: "q8JW_i5Gt0M", sureSn: 44, olcumAni: "48s", metrikler: { izlenmeSaat: "3.9" } }).metrikler.izlenmeSaat, 3.9, "a plain decimal point stays a decimal");
    assert.equal(r.metrikler.aboneKazanimi, null, "not in the file → null, never 0");
    assert.deepEqual(r.ulkeler, [{ ulke: "US", pay: 0.255, goruntuleme: 307, ortIzlemeSn: 30 }], "assert.deepEqual(r.ulkeler, [{ ulke: \"US\", pay: 0.255, goruntuleme: 307, ortIzlemeSn: 30 }])");
    assert.deepEqual(r.trafik, { shortsAkisi: 0.968, youtubeArama: 0.008 }, "assert.deepEqual(r.trafik, { shortsAkisi: 0.968, youtubeArama: 0.008 })");
    assert.throws(() => parsePerformanceInput({ videoId: "q8JW_i5Gt0", sureSn: 44, olcumAni: "7g" }), /videoId 11 karakterlik/);
    assert.throws(() => parsePerformanceInput({ videoId: "q8JW_i5Gt0M", olcumAni: "7g" }), /sureSn/);
    assert.throws(() => parsePerformanceInput({ videoId: "q8JW_i5Gt0M", sureSn: 44, olcumAni: "7g", metrikler: { ctr: 0.1 } }), /bilinmeyen metrik: ctr/);
    assert.throws(() => parsePerformanceInput({ videoId: "q8JW_i5Gt0M", sureSn: 44, olcumAni: "7g", metrikler: { izlemeyiSecenler: "150%" } }), /çok büyük/);
  });

  await scenario("F the next Short's target only rises: three measured Shorts above the band move it up; fewer or worse never lower it", () => {
    const owner = goals.hedefler.short.izlemeyiSecenler;
    assert.deepEqual(nextShortTargets(goals, [rec("a0000000001", { izlemeyiSecenler: 0.9, ortIzlemeSn: 40 })]).izlemeyiSecenler, owner, "one great video does not move it");
    const good = ["2026-11-10", "2026-11-11", "2026-11-12"].map((d, i) => rec(`g000000000${i}`, { izlemeyiSecenler: [0.64, 0.66, 0.7][i]!, ortIzlemeSn: 27 }, { olcumTarihi: d }));
    const raised = nextShortTargets(goals, good);
    assert.deepEqual([raised.izlemeyiSecenler.min, raised.izlemeyiSecenler.max], [0.66, 0.68], "assert.deepEqual([raised.izlemeyiSecenler.min, raised.izlemeyiSecenler.max], [0.66, 0.68])");
    assert.deepEqual(raised.ortIzlenmeOrani, goals.hedefler.short.ortIzlenmeOrani, "a metric still inside its band keeps it");
    const bad = good.map((r) => ({ ...r, metrikler: { ...r.metrikler, izlemeyiSecenler: 0.4 } }));
    assert.deepEqual(nextShortTargets(goals, bad).izlemeyiSecenler, owner, "never lowered");
    assert.equal(latestPerVideo([rec("v0000000001", { izlemeyiSecenler: 0.5 }, { olcumAni: "7g", olcumTarihi: "2026-11-12" }), rec("v0000000001", { izlemeyiSecenler: 0.6 }, { olcumAni: "48s", olcumTarihi: "2026-11-13" })])[0]!.metrikler.izlemeyiSecenler, 0.5, "the 7-day reading wins");
  });

  await scenario("G the pilot: 2+2+2 Shorts, each series at two hours and each hour two series; tendencies are series-adjusted and labelled as such", () => {
    const plan = goals.pilot.videolar;
    assert.equal(plan.length, 6, "assert.equal(plan.length, 6)");
    assert.deepEqual(goals.diziler.map((d) => plan.filter((v) => v.dizi === d.id).length), [2, 2, 2], "assert.deepEqual(goals.diziler.map((d) => plan.filter((v) => v.dizi === d.id).length), [2, 2, 2])");
    for (const d of goals.diziler) assert.equal(new Set(plan.filter((v) => v.dizi === d.id).map((v) => v.saat)).size, 2, `${d.id} at two hours`);
    for (const h of ["19:00", "20:00", "21:00"]) assert.equal(new Set(plan.filter((v) => v.saat === h).map((v) => v.dizi)).size, 2, `${h} carries two series`);
    assert.ok(plan.every((v) => v.dogruluk), "every pilot topic carries its accuracy note");
    const records = plan.map((v) => rec(`p00000000${String(v.no).padStart(2, "0")}`, { izlemeyiSecenler: 0.5 + (v.saat === "21:00" ? 0.04 : 0) + (v.dizi === "insane-moments" ? 0.05 : 0) }, { pilotNo: v.no }));
    const t = pilotTrends(goals, records);
    assert.equal(t.olculen, 6, "assert.equal(t.olculen, 6)");
    const at = (h: string) => t.saatler.find((s) => s.saat === h)!.diziyeGoreFark!;
    assert.ok(at("21:00") > at("19:00") && at("21:00") > at("20:00"), "the hour effect shows after taking out the series");
    assert.match(t.uyari, /kesin sonuç değildir/);
    assert.equal(pilotTrends(goals, []).olculen, 0, "assert.equal(pilotTrends(goals, []).olculen, 0)");
  });

  await scenario("H the first three seconds and the scene plan are measured from the plan; the goal note never claims a pass", () => {
    const good = openingChecks(goals, { firstLine: { text: "You kidnapped the wrong Roman.", byCharacter: true, startS: 0.3 }, firstVisualEventS: 0.5, firstSceneCards: ["yer_tarih"] });
    // Rows: first line, the hook's anchor (23 Nov 2026), first visual event, full-screen card[, the line after the hook].
    assert.deepEqual(good.map((c) => c.ok), [true, true, true, true]);
    const bad = openingChecks(goals, { firstLine: { text: "In the year 75 BC, a young Roman nobleman sailed to Rhodes to study.", byCharacter: false, startS: 2.5 }, firstSceneCards: ["kelime"] });
    assert.deepEqual(bad.map((c) => c.ok), [false, true, false, false], "a number is an anchor even in a bad opening");
    assert.match(bad[0]!.text, /ANLATICI, 14 kelime/);
    // The line after the hook (19 Nov 2026): a last row only when the pipeline gives it; the narrator's date line fails.
    const base = { firstLine: { text: "Twenty? I'm worth more!", byCharacter: true, startS: 0.3 }, firstVisualEventS: 0.5, firstSceneCards: ["yer_tarih"] };
    const dated = openingChecks(goals, { ...base, followUp: { text: "Around 75 BC, Julius Caesar was kidnapped by Cilician pirates along the southern coast of Asia Minor.", byCharacter: false } });
    assert.deepEqual(dated.map((c) => c.ok), [true, true, true, true, false]);
    assert.match(dated[4]!.text, /^Kanca ardı: anlatıcı, 17 kelime, TARİHLE açılıyor \("75 bc"\)/);
    assert.deepEqual(openingChecks(goals, { ...base, followUp: { text: "He told them to ask for fifty.", byCharacter: false } }).map((c) => c.ok), [true, true, true, true, true]);
    assert.match(openingChecks(goals, { ...base, followUp: { text: "On August 2nd, 216 BC, nobody listens to me!", byCharacter: true } })[4]!.text, /karakter cevap veriyor/);
    // The beat map no longer asks for a "who, where and when" set-up line after the hook.
    assert.doesNotMatch(shortBeatRule(goals, 45, "en"), /set up who, where and when/);
    assert.match(shortBeatRule(goals, 45, "en"), /2–8 s the stakes in one short line \(at most 12 words/);
    const scene = (id: string, extra: Record<string, unknown> = {}) => ({ id, muzik_ruh_hali: "playful", satirlar: [{ jest: "point", sfx: "pop" }], kamera: [{ tip: "zoom", t: 0 }], gecis: "wipe", ...extra });
    assert.equal(scenePlanCheck([scene("s1"), scene("s2")]).ok, true, "assert.equal(scenePlanCheck([scene(\"s1\"), scene(\"s2\")]).ok, true)");
    const gaps = scenePlanCheck([scene("s1"), scene("s2", { kamera: undefined, gecis: undefined, satirlar: [{}] }), scene("s3", { kamera: undefined, satirlar: [{}], harita: { kamera: [{}], ordular: [{}] } })]);
    assert.equal(gaps.ok, false, "assert.equal(gaps.ok, false)");
    assert.match(gaps.text, /kamera: s2; efekt: s2, s3; karakter hareketi: s2; geçiş: s2/);
    assert.match(channelGoalNote(goals, 45), /yayından sonra ölçülür — şimdi geçti sayılmaz[^]*\n- İzlemeyi seçenler: hedef %58–%60 \(başlangıç %52\)\n- Ortalama izlenme: hedef 26–28 sn \/ 45 sn/);
    assert.match(channelGoalNote(goals, 900), /HEDEF_TANIMLANMADI/);
  });

  await scenario("H2 the Lake Trasimene Short's opening (owner, 23 Nov 2026: 73 views in 35 h): the joke hook has no anchor and the 15-word line after it fails; a concrete hook passes", () => {
    const names = ["Hannibal", "Flaminius", "Maharbal", "Rome", "Romans", "Lake", "Trasimene"];
    const trasimene = openingChecks(goals, {
      firstLine: { text: "Who needs fog machines when you have nature?", byCharacter: true, startS: 0.4 },
      firstVisualEventS: 0,
      firstSceneCards: [],
      followUp: { text: "Hannibal is about to spring history’s biggest ambush. The Romans are walking right into it.", byCharacter: false },
      names,
    });
    assert.deepEqual(trasimene.map((c) => c.ok), [true, false, true, true, false], trasimene.map((c) => c.text).join("\n"));
    assert.match(trasimene[1]!.text, /^Kanca dayanağı: YOK — "Who needs fog machines when you have nature\?" espri ya da laf, somut değil/);
    assert.match(trasimene[4]!.text, /^Kanca ardı: anlatıcı, 15 kelime/);
    const concrete = openingChecks(goals, { firstLine: { text: "Thirty thousand Romans walk into this fog.", byCharacter: true, startS: 0.4 }, firstVisualEventS: 0, firstSceneCards: [], names });
    assert.equal(concrete[1]!.ok, true);
    assert.match(concrete[1]!.text, /^Kanca dayanağı: sayı \("Thirty"\)/);
    // A name opening the hook counts once the episode knows it; a stake word counts as well.
    assert.match(openingChecks(goals, { firstLine: { text: "Hannibal never loses.", byCharacter: true, startS: 0.4 }, firstSceneCards: [], names })[1]!.text, /ad \("Hannibal"\)/);
    assert.match(openingChecks(goals, { firstLine: { text: "Nobody walks out of this fog.", byCharacter: true, startS: 0.4 }, firstSceneCards: [] })[1]!.text, /tehlike\/sonuç \("nobody"\)/);
  });

  await scenario("I records are kept per video, moment and day in the work root; a broken goals file is refused", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-kanal-"));
    const r = parsePerformanceInput({ videoId: "q8JW_i5Gt0M", sureSn: 44, olcumAni: "7g", olcumTarihi: "2026-11-05", metrikler: { izlemeyiSecenler: 0.52 } });
    const file = await savePerformance(root, r);
    assert.match(file, /_kutuphane[\\/]kanal[\\/]performans[\\/]q8JW_i5Gt0M-7g-2026-11-05\.json$/);
    await savePerformance(root, { ...r, metrikler: { ...r.metrikler, izlemeyiSecenler: 0.53 } });
    await savePerformance(root, { ...r, olcumAni: "48s", olcumTarihi: "2026-11-04" });
    const all = await listPerformance(root);
    assert.equal(all.length, 2, "the same video, moment and day is replaced, not duplicated");
    assert.equal(latestPerVideo(all)[0]!.metrikler.izlemeyiSecenler, 0.53, "assert.equal(latestPerVideo(all)[0]!.metrikler.izlemeyiSecenler, 0.53)");
    const raw = JSON.parse(readFileSync(path.join(contentRoot, "kanal-hedefleri.json"), "utf8"));
    assert.throws(() => parseChannelGoals({ ...raw, shortsYapisi: { ...raw.shortsYapisi, bolumler: [{ id: "a", basSn: 0, bitSn: 2 }, { id: "b", basSn: 3, bitSn: 45 }, { id: "c", basSn: 45, bitSn: 46 }] } }), /ardışık değil/);
    assert.throws(() => parseChannelGoals({ ...raw, hedefler: { ...raw.hedefler, short: { ...raw.hedefler.short, izlemeyiSecenler: { min: 0.6, max: 0.5 } } } }), /min ≤ max/);
    assert.throws(() => parseChannelGoals({ ...raw, pilot: { ...raw.pilot, videolar: [{ ...raw.pilot.videolar[0], dizi: "yok" }] } }), /bilinmeyen dizi/);
  });

  await scenario("J API rows map to the Studio record's shape; what the API lacks stays null; moments are read once, after they pass", () => {
    const r = apiRecord();
    assert.equal(r.kaynak, "youtube-analytics-api");
    assert.deepEqual([r.olcumAni, r.olcumTarihi, r.sureSn], ["7g", "2026-11-15", 45]);
    const m = r.metrikler;
    assert.deepEqual([m.goruntuleme, m.aktifIzlenme, m.ortIzlemeSn, m.ortGoruntulenenYuzde, m.izlenmeSaat, m.aboneKazanimi, m.begeni, m.yorum, m.paylasim], [1000, 600, 27, 0.6, 7.5, 2, 40, 5, 3]);
    assert.deepEqual([m.izlemeyiSecenler, m.kaydiranlar, m.benzersizIzleyici], [null, null, null], "Studio-only numbers are never estimated");
    assert.deepEqual(r.trafik, { shortsAkisi: 0.9, youtubeArama: 0.05, anaSayfaAbonelik: 0.03, reklam: 0.02 }, "paid views are named, not \"diger\"");
    assert.equal(r.organik?.reklamPayi, 0.02);
    assert.equal(recordViewRatio(r), 0.6, "2 % paid: the video's own numbers stand");
    assert.equal(r.tutmaOrganik, undefined, "no organic curve asked for a video barely promoted");
    assert.equal(r.tutma?.length, 100);
    assert.equal(analyticsRecord({ video: { videoId: VIDEO, title: "", publishedAt: "2026-11-08T10:00:00Z", durationS: 45 }, moment: { olcumAni: "48s", endDate: "2026-11-10" } }).metrikler.goruntuleme, null, "no row → not measured, not 0");
    // The evaluation sees the view ratio but no "chose to view": VERI_EKSIK, never a pass.
    const e = evaluatePerformance(r, goals);
    assert.deepEqual([e.sonuc, e.kontroller[0]!.durum, e.kontroller[1]!.durum], ["VERI_EKSIK", "OLCULMEDI", "HEDEFTE"]);
    assert.deepEqual([isoDurationS("PT45S"), isoDurationS("PT1M5S"), isoDurationS("PT1H2M"), isoDurationS("P0D"), isoDurationS("bad")], [45, 65, 3720, undefined, undefined]);
    const due = dueMoments("2026-11-08T10:00:00Z", ["48s", "7g", "28g", "elle"], new Set(), NOW);
    assert.deepEqual(due, [{ olcumAni: "48s", startDate: "2026-11-08", endDate: "2026-11-10" }, { olcumAni: "7g", startDate: "2026-11-08", endDate: "2026-11-15" }], "28g has not passed; a free label is never read");
    assert.deepEqual(dueMoments("2026-11-08T10:00:00Z", ["48s", "7g"], new Set(["48s"]), NOW).map((x) => x.olcumAni), ["7g"], "a moment already read is not read again");
    assert.deepEqual(dueMoments("2026-11-17T10:00:00Z", ["48s"], new Set(), NOW), [], "48 h passed but the numbers have not settled (lag)");
    assert.equal(latestPerVideo([{ ...r, olcumAni: "28g", olcumTarihi: "2026-12-06" }, r, { ...r, olcumAni: "48s", olcumTarihi: "2026-12-07" }])[0]!.olcumAni, "28g", "the later moment wins");
    // Channel summary: best/worst by view ratio, traffic weighted by views.
    const sum = channelSummary([r, rec("q8JW_i5Gt0M", { izlemeyiSecenler: 0.52, ortIzlemeSn: 23, goruntuleme: 1000 }, { sureSn: 44, trafik: { shortsAkisi: 0.5, youtubeArama: 0.5 } })], goals);
    assert.deepEqual([sum.olculen, sum.api, sum.enIyi?.videoId, sum.enKotu?.videoId], [2, 1, VIDEO, "q8JW_i5Gt0M"]);
    assert.deepEqual(sum.trafik.slice(0, 2), [{ kaynak: "shortsAkisi", pay: 0.7 }, { kaynak: "youtubeArama", pay: 0.275 }]);
  });

  await scenario("K the retention curve: a weak hook to kurgu, a joke-scene drop to mizah, a map-scene drop to kalite, each with its line", () => {
    const r = apiRecord();
    const d = retentionDrops(r.tutma!, 45);
    assert.equal(d.kanca!.sn, 3.2);
    assert.ok(d.kanca!.kayip > 0.25 && d.kanca!.kayip < 0.29, `hook loss ${d.kanca!.kayip}`);
    assert.equal(d.kanca!.goreli, 0.3);
    assert.equal(d.dususler.length, 2, "two clear drops; the gentle slope and the last 5 % are not drops");
    assert.ok(d.dususler[0]!.basSn >= 20 && d.dususler[0]!.bitSn <= 23, `joke drop at ${d.dususler[0]!.basSn}–${d.dususler[0]!.bitSn}`);
    assert.ok(d.dususler[1]!.basSn >= 8 && d.dususler[1]!.bitSn <= 11.5, `map drop at ${d.dususler[1]!.basSn}–${d.dususler[1]!.bitSn}`);
    const timeline = episodeTimeline(PLAN, EPISODE)!;
    assert.deepEqual(timeline.sahneler.map((s) => [s.id, s.basSn, s.bitSn, s.tur]), [["s1-hook", 0, 5, "diger"], ["s2-map", 5, 20, "harita"], ["s3-joke", 20, 35, "komik"], ["s4-end", 35, 45, "diger"]], "a scene cut into shots is one scene");
    const lessons = retentionLessons(r, timeline);
    assert.deepEqual(lessons.map((l) => l.beyin), ["kurgu", "mizah", "kalite"]);
    assert.match(lessons[0]!.metin!, /^Short "Never Kidnap a Future Emperor": 2\d% of viewers left in the first 3\.2 s — worse than similar videos \(relative 0\.30\)\. Opening line: "You kidnapped me\?"\./);
    assert.match(lessons[1]!.metin!, /joke scene s3-joke while "Ransom is twenty talents\." is said\. This joke lost viewers/);
    assert.match(lessons[2]!.metin!, /map scene s2-map while "Rhodes was close\." is said\. Viewers left here: the map must read at a glance/);
    assert.ok(lessons.every((l) => !l.metin || l.metin.length <= 300), "within the memory's 300 characters");
    // Not linked (or a plan of another length): the drops are reported by time only and teach nothing; the hook still does.
    for (const t of [undefined, { ...timeline, sureSn: 60 }]) {
      const un = retentionLessons(r, t);
      assert.deepEqual(un.map((l) => [l.beyin, Boolean(l.metin)]), [["kurgu", true], ["kurgu", false], ["kurgu", false]]);
      assert.match(un[1]!.tr, /yapımla eşleşmedi: yalnız zaman/);
    }
  });

  await scenario("L the daily pull: recent uploads only, due moments only, linked to its production by the uploaded file name, recorded and taught; a second pass that day does nothing", async () => {
    const { workRoot, settings } = fixture();
    const g = fakeGoogle();
    const r = await youtubeAnalyticsTick({ workRoot, goals, settings, fetcher: g.fetcher, now: NOW });
    assert.equal(r.durum, "tamam", r.satir);
    assert.deepEqual(r.sonuc!.kayitlar.map((x) => [x.olcumAni, x.siparisId, x.kaynak]), [["48s", "o-caesar", "youtube-analytics-api"], ["7g", "o-caesar", "youtube-analytics-api"]]);
    assert.equal(g.calls.filter((u) => u.includes("youtubeanalytics")).length, 6, "three reports per moment (2 % paid: no organic curve)");
    assert.equal(g.calls.filter((u) => u.includes("playlistItems")).length, 1, "the older upload ends the listing (no second page)");
    assert.deepEqual((await listPerformance(workRoot)).map((x) => `${x.videoId}-${x.olcumAni}-${x.olcumTarihi}`).sort(), [`${VIDEO}-48s-2026-11-10`, `${VIDEO}-7g-2026-11-15`]);
    const mizah = await allLessons(workRoot, "mizah");
    assert.equal(mizah.length, 1);
    assert.deepEqual([mizah[0]!.bolum, mizah[0]!.tur], [`tutma ${VIDEO}`, "ders"]);
    assert.match(mizah[0]!.metin, /Ransom is twenty talents/);
    assert.match((await allLessons(workRoot, "kalite"))[0]!.metin, /map scene s2-map/);
    const kurgu = await allLessons(workRoot, "kurgu");
    assert.deepEqual(kurgu.map((l) => l.bolum).sort(), [`performans ${VIDEO}`, `tutma ${VIDEO}`], "the goal lesson (view ratio only, chose-to-view unmeasured) and the hook lesson");
    assert.match(kurgu.find((l) => l.bolum.startsWith("performans"))!.metin, /average view was 60% of its length \(target 58%–62%; chose-to-view not measured\)/);
    assert.match(r.satir, /yapım o-caesar/);
    const again = await youtubeAnalyticsTick({ workRoot, goals, settings, fetcher: g.fetcher, now: new Date(NOW.getTime() + 4 * 3_600_000) });
    assert.equal(again.durum, "erken");
    assert.equal(g.calls.length, 4 + 6, "nothing was asked again (token, channel, uploads, videos + 6 reports)");
    // `cek` forces a pass: the moments read are not read again, the lessons are not doubled.
    const forced = await youtubeAnalyticsTick({ workRoot, goals, settings, fetcher: g.fetcher, now: new Date(NOW.getTime() + 4 * 3_600_000), force: true });
    assert.equal(forced.sonuc!.kayitlar.length, 0);
    assert.match(forced.satir, /okunacak yeni ölçüm anı yok/);
    assert.equal((await allLessons(workRoot, "mizah")).length, 1);
  });

  await scenario("M a dead refresh token (invalid_grant) is told to the owner in AYAS once a day and never stops the cycle", async () => {
    const { workRoot, settings } = fixture();
    const g = fakeGoogle({ tokenError: "invalid_grant" });
    const inbox = path.join(workRoot, "_kutuphane", "ayas-gelen-kutusu.jsonl");
    const first = await youtubeAnalyticsTick({ workRoot, goals, settings, fetcher: g.fetcher, now: NOW });
    assert.equal(first.durum, "baglanti-doldu");
    assert.match(first.satir, /owner'a bildirildi/);
    const talk = await recentTalk(workRoot);
    assert.deepEqual(talk.map((t) => [t.metin, t.kime]), [[RECONNECT_NOTICE, "AYAS"]]);
    assert.match(RECONNECT_NOTICE, /^YouTube bağlantısının süresi doldu — `npx tsx scripts\/v3\/youtube\.ts baglan`$/);
    assert.equal(JSON.parse(readFileSync(inbox, "utf8").trim()).kaynak, "atolye-v3-youtube");
    // `kanal.ts cek` an hour later: still dead, but the owner is not told twice the same day.
    const second = await youtubeAnalyticsTick({ workRoot, goals, settings, fetcher: g.fetcher, now: new Date(NOW.getTime() + 3_600_000), force: true });
    assert.equal(second.durum, "baglanti-doldu");
    assert.equal((await recentTalk(workRoot)).length, 1);
    assert.equal(readFileSync(inbox, "utf8").trim().split("\n").length, 1);
    const nextDay = await youtubeAnalyticsTick({ workRoot, goals, settings, fetcher: g.fetcher, now: new Date(NOW.getTime() + 25 * 3_600_000) });
    assert.equal(nextDay.durum, "baglanti-doldu");
    assert.equal((await recentTalk(workRoot)).length, 2, "the next day it is said again");
    assert.equal((await listPerformance(workRoot)).length, 0);
  });

  await scenario("N a consent without the Analytics scope asks to reconnect (before any request, or on Google's 403)", async () => {
    const old = fixture({ scope: YOUTUBE_SCOPES.slice(0, 2).join(" ") });
    assert.equal(hasAnalyticsScope(YOUTUBE_SCOPES.slice(0, 2).join(" ")), false);
    const g = fakeGoogle();
    const r = await youtubeAnalyticsTick({ workRoot: old.workRoot, goals, settings: old.settings, fetcher: g.fetcher, now: NOW });
    assert.equal(r.durum, "izin-eksik");
    assert.match(r.satir, /Analytics izni yok — performansı okumak için yeniden bağlan: `npx tsx scripts\/v3\/youtube\.ts baglan`/);
    assert.equal(g.calls.length, 0, "no request with a token that cannot read Analytics");
    assert.match((await recentTalk(old.workRoot))[0]!.metin, /yeniden bağlan/);
    const refused = fixture();
    const g403 = fakeGoogle({ analytics403: true });
    const r403 = await youtubeAnalyticsTick({ workRoot: refused.workRoot, goals, settings: refused.settings, fetcher: g403.fetcher, now: NOW });
    assert.equal(r403.durum, "izin-eksik", r403.satir);
    assert.equal((await listPerformance(refused.workRoot)).length, 0);
    assert.ok(connectionLines({ baglandi: "2026-11-15T00:00:00.000Z", scope: YOUTUBE_SCOPES.slice(0, 2).join(" ") }, NOW).some((l) => /Analytics izni YOK/.test(l)));
    assert.deepEqual(connectionLines({ baglandi: "2026-11-15T00:00:00.000Z", scope: YOUTUBE_SCOPES.join(" ") }, NOW), [
      "Bağlandı: 2026-11-15 (4 gün önce).",
      "Analytics izni: var (kanal performansı okunabilir).",
      "Google uygulaması \"Testing\" durumundaysa izin 2026-11-22 civarında düşer (7 gün); düşünce AYAS günde bir kez haber verir. Uygulama yayınlanırsa (In production) bu sınır kalkar.",
    ]);
    assert.match(connectionLines({ baglandi: "2026-11-01T00:00:00.000Z", scope: "" }, NOW)[2]!, /7 günden eski/);
  });

  await scenario("O no token, no pull: nothing is asked of Google and nothing is written", async () => {
    const { workRoot, settings } = fixture({ token: false });
    const g = fakeGoogle();
    const r = await youtubeAnalyticsTick({ workRoot, goals, settings, fetcher: g.fetcher, now: NOW, force: true });
    assert.equal(r.durum, "token-yok");
    assert.equal(g.calls.length, 0);
    assert.equal(existsSync(path.join(workRoot, "_kutuphane", "kanal")), false);
    assert.equal((await recentTalk(workRoot)).length, 0, "a channel never connected is not nagged about");
  });

  await scenario("P kaydet's judge is the shared one, unchanged: same evaluation and lesson, the video's older lesson replaced", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-kanal-ders-"));
    const caesar = rec("q8JW_i5Gt0M", { izlemeyiSecenler: 0.52, ortIzlemeSn: 23 }, { sureSn: 44 });
    const before = performanceLessons(caesar, evaluatePerformance(caesar, goals, nextShortTargets(goals, [])));
    const a = await judgeAndTeach({ workRoot: root, goals, record: caesar, others: [] });
    assert.equal(a.evaluation.sonuc, "HEDEF_ALTI");
    assert.deepEqual(a.lessons, before);
    await judgeAndTeach({ workRoot: root, goals, record: caesar, others: [] });
    const kurgu = await allLessons(root, "kurgu");
    assert.deepEqual(kurgu.map((l) => [l.bolum, l.metin]), [["performans q8JW_i5Gt0M", before[0]!.metin]], "replaced, not doubled");
    // Without `kismi` (the Studio path) an unmeasured chose-to-view still teaches nothing, as before.
    const partial = rec("x0000000007", { ortIzlemeSn: 27 });
    assert.deepEqual((await judgeAndTeach({ workRoot: root, goals, record: partial, others: [] })).lessons, []);
    assert.equal((await judgeAndTeach({ workRoot: root, goals, record: partial, others: [], kismi: true })).lessons.length, 1);
  });

  await scenario("Q a mostly paid Short is read and taught on its organic viewers; --yeniden reads a moment again", async () => {
    // Pure: the traffic report without ADVERTISING, the organic curve as the feed's.
    const paid = organicViews(PAID_TRAFFIC_ROWS.map(([k, v, d]) => ({ insightTrafficSourceType: k!, views: v!, averageViewDuration: d! })));
    assert.deepEqual(paid, { goruntuleme: 200, ortIzlemeSn: 19.5, reklamPayi: 0.8 });
    assert.equal(organicViews(TRAFFIC_ROWS.filter(([k]) => k !== "ADVERTISING").map(([k, v]) => ({ insightTrafficSourceType: k!, views: v! }))), undefined, "no ad: nothing to split");
    const { workRoot, settings } = fixture();
    const g = fakeGoogle({ paid: true });
    const r = await youtubeAnalyticsTick({ workRoot, goals, settings, fetcher: g.fetcher, now: NOW });
    assert.equal(r.durum, "tamam", r.satir);
    assert.equal(g.calls.filter((u) => u.includes("audienceType%3D%3DORGANIC")).length, 2, "one organic curve per moment");
    const seven = r.sonuc!.kayitlar.find((x) => x.olcumAni === "7g")!;
    assert.deepEqual([seven.trafik?.reklam, seven.organik?.goruntuleme, seven.tutmaOrganik?.length, feedCurve(seven).organik], [0.8, 200, 100, true]);
    // The goal is judged on the 200 organic views (19.5 s of 45 s), not on the blended 60 %.
    assert.equal(recordViewRatio(seven)!.toFixed(3), "0.433");
    assert.equal(recordViewRatio({ ...seven, organik: { ...seven.organik!, goruntuleme: 20 } }), null, "too few organic views: not measured, never the ad viewers' ratio");
    // The hook lesson is the organic one, with what was left after the hook and the line said then.
    const hold = holdAfterHook(seven.tutmaOrganik!, 45)!;
    assert.ok(hold > 0.45 && hold < 0.55, `hold ${hold}`);
    assert.equal(holdAfterHook(seven.tutma!, 45)! > 0.75, true, "the blended curve would have hidden it");
    const kurgu = await allLessons(workRoot, "kurgu");
    const hook = kurgu.find((l) => l.bolum === `tutma ${VIDEO}`)!;
    assert.ok(hook.metin.includes("of organic viewers left in the first 3.2 s"), hook.metin);
    assert.ok(hook.metin.includes(`${Math.round(hold * 100)}% of them were still there at ${AFTER_HOOK_S} s, after "Rhodes was close."`), hook.metin);
    // The hook held but the line after it lost half of them: the advice is about that line, not "keep this opening".
    assert.ok(hook.metin.includes("never a date or place line") && !hook.metin.includes("Keep this kind of opening"), hook.metin);
    assert.ok(retentionLessons(seven, episodeTimeline(PLAN, EPISODE)).every((l) => !l.metin || l.metin.includes("organic viewers")));
    // --yeniden: the moments already read are read again (an older reading had no organic numbers), lessons not doubled.
    const again = await youtubeAnalyticsTick({ workRoot, goals, settings, fetcher: g.fetcher, now: NOW, force: true, yeniden: true });
    assert.equal(again.sonuc!.kayitlar.length, 2);
    assert.equal((await listPerformance(workRoot)).length, 2, "the same files, overwritten");
    assert.equal((await allLessons(workRoot, "kurgu")).filter((l) => l.bolum === `tutma ${VIDEO}`).length, 1);
  });

  await scenario("R linking: a renamed upload found in the folder, the take whose plan fits among two of the same file name, the delivered round's plan", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "v3-yt-bag-"));
    const workRoot = path.join(root, "work");
    const order = (id: string, files: string[], planS?: number) => {
      const cikti = path.join(workRoot, "bolumler", id);
      mkdirSync(cikti, { recursive: true });
      for (const n of files) writeFileSync(path.join(cikti, n), "");
      if (planS !== undefined) writeFileSync(path.join(cikti, "plan.json"), JSON.stringify({ plan: { ...PLAN.plan, durationInFrames: planS * 30 } }));
      writeFileSync(path.join(cikti, "episode.json"), JSON.stringify(EPISODE));
      mkdirSync(path.join(workRoot, "_kutuphane", "siparisler"), { recursive: true });
      writeFileSync(path.join(workRoot, "_kutuphane", "siparisler", `${id}.json`), JSON.stringify({ id, konu: id, donem: "1896", sure: "45sn", dil: "en", ton: "mizahi", kaynak: "owner", olusturuldu: "2026-11-01T00:00:00Z", durum: "teslim", cikti }));
      return cikti;
    };
    // The owner renamed the Taranto upload; the copy sits in the order's folder (no youtube.json names it).
    order("o-taranto", ["final.mp4", "Taranto Raid 1940 21 Biplanes vs İtalian Battleships.mp4"], 113.5);
    // The Zanzibar Short was produced twice: both folders hold the same file name, the second take is the uploaded one.
    order("o-zanzibar-1", ["38-minute-war-1896-animated-history.mp4"], 56);
    order("o-zanzibar-2", ["38-minute-war-1896-animated-history.mp4"], 48.9);
    const orders = await ordersWithPackages(workRoot);
    assert.equal(linkOrder({ videoId: "4Tb0rpczWAQ", title: "21 Biplanes vs. Italy's Battleships", fileName: "Taranto Raid 1940 21 Biplanes vs İtalian Battleships.mp4" }, orders)?.id, "o-taranto");
    const zanzibar = { videoId: "K-sDKh24Lgs", title: "THE SHORTEST WAR IN HISTORY!", fileName: "38-minute-war-1896-animated-history.mp4" };
    assert.deepEqual(linkCandidates(zanzibar, orders).map((o) => o.id), ["o-zanzibar-1", "o-zanzibar-2"]);
    // Through the puller: the take whose plan fits the 49 s upload teaches; its drops are placed in scenes.
    const g = fakeGoogle();
    const settingsRoot = fixture();
    const cikti2 = path.join(workRoot, "bolumler", "o-zanzibar-2");
    const fetcher: Fetcher = async (url, init) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/youtube/v3/videos")) return Response.json({ items: [{ id: VIDEO, snippet: { title: "THE SHORTEST WAR IN HISTORY!", publishedAt: "2026-11-08T10:00:00Z" }, contentDetails: { duration: "PT49S" }, fileDetails: { fileName: zanzibar.fileName } }] });
      return g.fetcher(url, init);
    };
    const r = await youtubeAnalyticsTick({ workRoot, goals, settings: settingsRoot.settings, fetcher, now: NOW });
    assert.equal(r.durum, "tamam", r.satir);
    assert.deepEqual(r.sonuc!.kayitlar.map((x) => x.siparisId), ["o-zanzibar-2", "o-zanzibar-2"], "the second take, whose 48.9 s plan fits the 49 s upload");
    assert.match(r.satir, /yapım o-zanzibar-2/);
    // The delivered round's plan: round 0 delivered (45 s), plan.json left from round 1 (42.3 s); keepRound keeps each
    // round's plan and loadTimeline finds the one that fits; restoreRound never puts a plan back.
    const caesar = order("o-caesar-2", ["final.mp4"], 45);
    await keepRound(caesar, "final.mp4", { tur: 0, kisiler: [], setler: [] });
    writeFileSync(path.join(caesar, "plan.json"), JSON.stringify({ plan: { ...PLAN.plan, durationInFrames: 1269 } }));
    await keepRound(caesar, "final.mp4", { tur: 1, kisiler: [], setler: [] });
    await restoreRound(caesar, "final.mp4", 0);
    assert.equal(JSON.parse(readFileSync(path.join(caesar, "plan.json"), "utf8")).plan.durationInFrames, 1269, "the plan is not restored");
    assert.deepEqual([(await loadTimeline(caesar))!.sureSn, (await loadTimeline(caesar, 45))!.sureSn, (await loadTimeline(caesar, 42))!.sureSn], [42.3, 45, 42.3]);
    assert.ok(existsSync(path.join(cikti2, "plan.json")));
  });

  console.log(`PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
