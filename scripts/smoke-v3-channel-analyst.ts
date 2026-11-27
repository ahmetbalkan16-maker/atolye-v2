/**
 * V3 smoke: the channel analyst (owner, 27 Nov 2026: "eksikleri yap hallet videolarımız daha iyi olsun neredeyse hiç
 * takip gelmiyor kanalımıza") — cross-video findings from the latest record of each video, each resting on at least two
 * videos (or a clear zero), mapped to a Turkish proposal; code findings filed once in the Gelişim Merkezi's one proposal
 * store ("AYAS ÖNERİYOR · Kanal analisti"), updated in place when their evidence changes, never reopened once decided;
 * the ads are the owner's decision and only reported; the weekly step runs once in 7 days and tells AYAS.
 * No network, no model, no production data (a TEMP work root; fixtures shaped like the real performance records).
 * Run: npx tsx scripts/smoke-v3-channel-analyst.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { decideProposal, listProposals, needsOwner } from "../src/lib/v3/council/SelfImprovement";
import type { EpisodeTimeline } from "../src/lib/v3/publish/ChannelAnalyticsMap";
import { ANALYST_KEY_PREFIX, ANALYST_SOURCE, analystReport, analyzeChannel, findingKeyOf, planAnalystProposals } from "../src/lib/v3/publish/ChannelAnalyst";
import { analystReportFile, analystStateFile, channelAnalystTick } from "../src/lib/v3/publish/ChannelAnalystRun";
import { PERFORMANCE_METRICS, type PerformanceMetric, type RetentionPoint, type VideoPerformanceRecord } from "../src/lib/v3/publish/ChannelGoals";
import { savePerformance } from "../src/lib/v3/publish/VideoPerformanceStore";

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

/** A 100-point curve: a gentle slope, and a sharp loss of `drop` between `from` and `to` seconds. */
function curve(durationS: number, opts: { readonly drop?: { from: number; to: number; size: number }; readonly goreli?: number; readonly start?: number } = {}): RetentionPoint[] {
  const start = opts.start ?? 1.2;
  return Array.from({ length: 100 }, (_, i) => {
    const oran = (i + 1) / 100;
    const t = oran * durationS;
    const d = opts.drop;
    const lost = d ? (t <= d.from ? 0 : t >= d.to ? d.size : (d.size * (t - d.from)) / (d.to - d.from)) : 0;
    return { oran, izlenme: Math.round((start - 0.004 * t - lost) * 10_000) / 10_000, ...(opts.goreli !== undefined ? { goreli: opts.goreli } : {}) };
  });
}

function record(o: {
  readonly id: string; readonly sure: number; readonly views: number; readonly subs?: number; readonly likes?: number; readonly comments?: number; readonly shares?: number;
  readonly ad?: number; readonly feed?: number; readonly published: string; readonly tutma?: RetentionPoint[]; readonly organicCurve?: RetentionPoint[]; readonly avg?: number; readonly organicAvg?: number;
}): VideoPerformanceRecord {
  const m: Partial<Record<PerformanceMetric, number | null>> = {
    goruntuleme: o.views, ortIzlemeSn: o.avg ?? Math.round(o.sure * 0.5), ortGoruntulenenYuzde: 0.5, aboneKazanimi: o.subs ?? 0, begeni: o.likes ?? 10, yorum: o.comments ?? 0, paylasim: o.shares ?? 0,
  };
  const ad = o.ad ?? 0;
  const feed = o.feed ?? 1 - ad;
  const organicViews = Math.round(o.views * (1 - ad));
  return {
    schemaVersion: 1, videoId: o.id, baslik: `Video ${o.id}`, sureSn: o.sure, olcumTarihi: o.published.slice(0, 10), olcumAni: "7g", kaynak: "youtube-analytics-api", yayinZamani: o.published,
    metrikler: Object.fromEntries(PERFORMANCE_METRICS.map((k) => [k, m[k] ?? null])) as Record<PerformanceMetric, number | null>,
    trafik: { ...(ad ? { reklam: ad } : {}), shortsAkisi: feed, ...(1 - ad - feed > 0 ? { youtubeArama: Math.round((1 - ad - feed) * 10_000) / 10_000 } : {}) },
    ...(o.tutma ? { tutma: o.tutma } : {}),
    ...(o.organicCurve ? { tutmaOrganik: o.organicCurve } : {}),
    ...(ad ? { organik: { goruntuleme: organicViews, ortIzlemeSn: o.organicAvg ?? Math.round(o.sure * 0.7), reklamPayi: ad } } : {}),
  };
}

const ID = (n: number) => `vid${String(n).padStart(8, "0")}`;
const dropAt5 = { from: 4.5, to: 5.5, size: 0.15 };

async function main(): Promise<void> {
  const now = new Date("2026-11-27T10:00:00Z");

  await scenario("A no subscriber from thousands of views is a finding with its numbers (and a clear zero even on one video)", () => {
    const recs = [
      record({ id: ID(1), sure: 50, views: 1_200, subs: 0, published: "2026-11-03T10:00:00Z" }),
      record({ id: ID(2), sure: 150, views: 2_000, subs: 0, ad: 0.9, published: "2026-11-05T10:00:00Z" }),
    ];
    const a = analyzeChannel(recs);
    const f = a.bulgular.find((x) => x.konu === "abone");
    assert.ok(f, "abone bulgusu var");
    assert.equal(f.kanit.abone, 0);
    assert.equal(f.kanit.goruntuleme, 3_200);
    assert.equal(f.kanit.abone1000, 0);
    assert.equal(f.kanit.reklamliVideo, 1);
    assert.equal(f.kanit.reklamsizVideo, 1);
    assert.deepEqual([...f.videolar].sort(), [ID(1), ID(2)]);
    assert.equal(f.hedef, "kod");
    assert.match(f.oneri, /takip/i);
    assert.match(f.bulgu, /ölçülmedi/);
    // One video, 1,500 views, no subscriber: a clear zero.
    assert.ok(analyzeChannel([record({ id: ID(3), sure: 50, views: 1_500, subs: 0, published: "2026-11-03T10:00:00Z" })]).bulgular.some((x) => x.konu === "abone"));
    // Subscribers above the floor: no finding.
    assert.ok(!analyzeChannel([record({ id: ID(4), sure: 50, views: 1_000, subs: 5, published: "2026-11-03T10:00:00Z" }), record({ id: ID(5), sure: 50, views: 1_000, subs: 3, published: "2026-11-04T10:00:00Z" })]).bulgular.some((x) => x.konu === "abone"));
  });

  await scenario("B mostly paid views are the owner's decision: reported with the paid vs organic watch, never filed", () => {
    const recs = [
      record({ id: ID(1), sure: 150, views: 2_000, ad: 0.9, avg: 60, organicAvg: 110, published: "2026-11-03T10:00:00Z" }),
      record({ id: ID(2), sure: 110, views: 1_500, ad: 0.85, avg: 50, organicAvg: 90, published: "2026-11-05T10:00:00Z" }),
      record({ id: ID(3), sure: 45, views: 1_000, published: "2026-11-07T10:00:00Z" }),
    ];
    const a = analyzeChannel(recs);
    const f = a.bulgular.find((x) => x.konu === "reklam");
    assert.ok(f, "reklam bulgusu var");
    assert.equal(f.hedef, "sahip");
    assert.equal(f.kanit.reklamGoruntuleme, 1_800 + 1_275);
    assert.equal(f.kanit.toplamGoruntuleme, 4_500);
    assert.ok((f.kanit.organikIzlenmeOrani as number) > (f.kanit.reklamIzlenmeOrani as number), "reklam izleyicisi daha kısa izledi");
    assert.deepEqual([...f.videolar].sort(), [ID(1), ID(2)]);
    const plan = planAnalystProposals(a.bulgular, [], now);
    assert.ok(!plan.yeni.some((p) => findingKeyOf(p) === "reklam"), "reklam kuyruğa yazılmaz");
    assert.ok(plan.sahip.some((x) => x.key === "reklam"));
    assert.match(analystReport(a, plan, now), /senin kararın/);
    // Little paid traffic: no ad finding.
    assert.ok(!analyzeChannel([record({ id: ID(1), sure: 50, views: 1_000, ad: 0.2, published: "2026-11-03T10:00:00Z" }), record({ id: ID(2), sure: 50, views: 1_000, published: "2026-11-04T10:00:00Z" })]).bulgular.some((x) => x.konu === "reklam"));
  });

  await scenario("C a drop at the same seconds in two Shorts is one finding, placed on the scene and line on screen", () => {
    const recs = [
      record({ id: ID(1), sure: 50, views: 900, subs: 1, published: "2026-11-03T10:00:00Z", tutma: curve(50, { drop: dropAt5 }) }),
      record({ id: ID(2), sure: 56, views: 800, subs: 1, published: "2026-11-05T10:00:00Z", tutma: curve(56, { drop: { from: 5, to: 6, size: 0.12 } }) }),
      record({ id: ID(3), sure: 47, views: 700, subs: 1, published: "2026-11-07T10:00:00Z", tutma: curve(47) }),
    ];
    const map = (sure: number, line: string): EpisodeTimeline => ({ sureSn: sure, sahneler: [{ id: "s1", basSn: 0, bitSn: 4, tur: "diger" }, { id: "s2", basSn: 4, bitSn: 20, tur: "harita" }, { id: "s3", basSn: 20, bitSn: sure, tur: "diger" }], satirlar: [{ basSn: 0, bitSn: 3.8, metin: "Rome is about to lose everything." }, { basSn: 4, bitSn: 8, metin: line }] });
    const timelines = new Map([[ID(1), map(50, "In 216 BC, at Cannae, eighty thousand Romans march.")], [ID(2), map(56, "June 1815, Belgium, the fields of Waterloo.")]]);
    const a = analyzeChannel(recs, { timelines });
    const drops = a.bulgular.filter((x) => x.konu === "dusus");
    assert.equal(drops.length, 1, "tek ortak düşüş");
    const d = drops[0]!;
    assert.deepEqual([...d.videolar].sort(), [ID(1), ID(2)]);
    assert.equal(d.kanit.short, 2);
    assert.equal(d.kanit.harita, 2);
    assert.equal(d.beyin, "kalite", "harita sahnesi kalite beynine");
    assert.match(d.bulgu, /216 BC/);
    assert.match(d.gorev!, /map scene/);
    assert.match(d.key, /^dusus-\d+s$/);
    // Without timelines the window stands by time only, and the report says what was not measured.
    const bare = analyzeChannel(recs);
    const b = bare.bulgular.find((x) => x.konu === "dusus")!;
    assert.equal(b.beyin, "kurgu");
    assert.match(b.bulgu, /ölçülmedi/);
    assert.ok(bare.olculmedi.some((l) => /zaman çizelgesi/.test(l)));
    // A drop in one Short only is not a pattern.
    assert.ok(!analyzeChannel([recs[0]!, recs[2]!]).bulgular.some((x) => x.konu === "dusus"));
  });

  await scenario("D one video's data makes no finding; nothing is invented from it", () => {
    const one = record({ id: ID(1), sure: 50, views: 400, subs: 0, ad: 0.9, comments: 0, published: "2026-11-03T10:00:00Z", tutma: curve(50, { drop: dropAt5, goreli: 0.3 }) });
    const a = analyzeChannel([one]);
    assert.deepEqual(a.bulgular, []);
    assert.equal(a.videolar, 1);
    assert.match(analystReport(a, planAnalystProposals(a.bulgular, [], now), now), /yeni bulgu yok/);
    // Two readings of the same video are still one video (the latest one counts).
    assert.deepEqual(analyzeChannel([one, { ...one, olcumAni: "48s", olcumTarihi: "2026-11-01" }]).bulgular, []);
  });

  await scenario("E hook, length and engagement: weak hooks in two Shorts, short vs long on the feed's curve, few comments", () => {
    const recs = [
      record({ id: ID(1), sure: 45, views: 1_000, subs: 1, published: "2026-11-03T10:00:00Z", tutma: curve(45, { goreli: 0.3 }) }),
      record({ id: ID(2), sure: 50, views: 1_000, subs: 1, published: "2026-11-04T10:00:00Z", tutma: curve(50, { goreli: 0.4 }) }),
      // Long Shorts, mostly paid: judged on their organic curve (start 0.6 → low at 15 %), not the blended one.
      record({ id: ID(3), sure: 150, views: 1_000, subs: 1, ad: 0.9, published: "2026-11-05T10:00:00Z", tutma: curve(150, { start: 1.3 }), organicCurve: curve(150, { start: 0.6 }) }),
      record({ id: ID(4), sure: 160, views: 1_000, subs: 1, ad: 0.9, published: "2026-11-06T10:00:00Z", tutma: curve(160, { start: 1.3 }), organicCurve: curve(160, { start: 0.6 }) }),
    ];
    const a = analyzeChannel(recs);
    const hook = a.bulgular.find((x) => x.konu === "kanca");
    assert.ok(hook, "kanca bulgusu");
    assert.equal(hook.kanit.goreliAlti, 2);
    const len = a.bulgular.find((x) => x.konu === "sure");
    assert.ok(len, "süre bulgusu");
    assert.equal(len.kanit.kisaShort, 2);
    assert.equal(len.kanit.uzunShort, 2);
    assert.ok((len.kanit.kisaTutma15 as number) > (len.kanit.uzunTutma15 as number));
    assert.match(len.oneri, /60 sn'ye insin/);
    const eng = a.bulgular.find((x) => x.konu === "etkilesim");
    assert.ok(eng, "etkileşim bulgusu");
    assert.equal(eng.kanit.yorum, 0);
    // The same long Shorts read on their blended curve would look as good as the short ones: no length finding then.
    const blended = recs.map((r) => ({ ...r, tutmaOrganik: undefined, tutma: curve(r.sureSn) }));
    assert.ok(!analyzeChannel(blended).bulgular.some((x) => x.konu === "sure"));
  });

  await scenario("F the weekly step files each code finding once in the Gelişim Merkezi, updates its evidence, never reopens a decided one", async () => {
    const workRoot = mkdtempSync(path.join(os.tmpdir(), "v3-kanal-analist-"));
    const recs = [
      record({ id: ID(1), sure: 50, views: 1_200, subs: 0, comments: 0, published: "2026-11-03T10:00:00Z", tutma: curve(50, { drop: dropAt5 }) }),
      record({ id: ID(2), sure: 56, views: 1_100, subs: 0, comments: 0, ad: 0.9, published: "2026-11-05T10:00:00Z", tutma: curve(56, { drop: { from: 5, to: 6, size: 0.12 } }) }),
    ];
    for (const r of recs) await savePerformance(workRoot, r);
    const first = await channelAnalystTick({ workRoot, now });
    assert.equal(first.durum, "tamam", first.satir);
    const filed = (await listProposals(workRoot)).map((x) => x.proposal);
    assert.ok(filed.length >= 2, "öneriler yazıldı");
    for (const p of filed) {
      assert.equal(p.ayasOneriyor?.kaynak, ANALYST_SOURCE);
      assert.equal(p.ayasOneriyor?.otomatikOnay, "kapalı", "sahip karar verir");
      assert.ok(p.kaynaklar[0]!.startsWith(ANALYST_KEY_PREFIX));
      assert.ok(needsOwner(p), "Gelişim Merkezi'nde görünür");
      assert.match(p.ayasOneriyor!.yarar, /^Öneri: .* Kanıt: /);
    }
    assert.ok(filed.some((p) => findingKeyOf(p) === "abone"));
    assert.ok(!filed.some((p) => findingKeyOf(p) === "reklam"));
    assert.ok(existsSync(analystReportFile(workRoot)));
    const inbox = readFileSync(path.join(workRoot, "_kutuphane", "ayas-gelen-kutusu.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { kaynak: string; ozet: string });
    assert.equal(inbox.at(-1)!.kaynak, "atolye-v3-kanal-analisti");
    // Within the week: nothing runs.
    assert.equal((await channelAnalystTick({ workRoot, now: new Date(now.getTime() + 3 * 86_400_000) })).durum, "erken");
    // Forced again on the same data: nothing new, nothing changed (dedupe).
    const again = await channelAnalystTick({ workRoot, now: new Date(now.getTime() + 86_400_000), force: true });
    assert.match(again.satir, /0 yeni öneri, 0 öneri güncellendi/);
    assert.equal((await listProposals(workRoot)).length, filed.length);
    // New numbers a week later: the same proposal (same id) carries the new evidence; a rejected one stays rejected.
    const abone = filed.find((p) => findingKeyOf(p) === "abone")!;
    const other = filed.find((p) => findingKeyOf(p) !== "abone")!;
    await decideProposal(workRoot, other.id, "reddedildi", "istemiyorum");
    await savePerformance(workRoot, { ...recs[0]!, olcumAni: "28g", olcumTarihi: "2026-12-01", metrikler: { ...recs[0]!.metrikler, goruntuleme: 2_400 } });
    const later = new Date(now.getTime() + 8 * 86_400_000);
    const third = await channelAnalystTick({ workRoot, now: later });
    assert.equal(third.durum, "tamam", third.satir);
    const after = (await listProposals(workRoot)).map((x) => x.proposal);
    assert.equal(after.length, filed.length, "ikinci öneri açılmadı");
    const abone2 = after.find((p) => p.id === abone.id)!;
    assert.equal(abone2.tarih, abone.tarih);
    assert.match(abone2.ayasOneriyor!.yarar, /3500 görüntüleme/);
    assert.notEqual(abone2.ayasOneriyor!.yarar, abone.ayasOneriyor!.yarar);
    assert.equal(after.find((p) => p.id === other.id)!.durum, "reddedildi");
    assert.equal(JSON.parse(readFileSync(analystStateFile(workRoot), "utf8")).sonAnaliz, later.toISOString());
  });

  await scenario("G a drop window that moved a second since last week updates its own proposal instead of making a second", () => {
    const make = (shift: number) => analyzeChannel([
      record({ id: ID(1), sure: 50, views: 900, subs: 1, published: "2026-11-03T10:00:00Z", tutma: curve(50, { drop: { from: 4.5 + shift, to: 5.5 + shift, size: 0.15 } }) }),
      record({ id: ID(2), sure: 56, views: 800, subs: 1, published: "2026-11-05T10:00:00Z", tutma: curve(56, { drop: { from: 5 + shift, to: 6 + shift, size: 0.12 } }) }),
    ]).bulgular.filter((x) => x.konu === "dusus");
    const before = make(0), moved = make(2);
    assert.notEqual(before[0]!.key, moved[0]!.key);
    const first = planAnalystProposals(before, [], now);
    assert.equal(first.yeni.length, 1);
    const second = planAnalystProposals(moved, first.yeni, new Date(now.getTime() + 7 * 86_400_000));
    assert.equal(second.yeni.length, 0);
    assert.equal(second.guncel.length, 1);
    assert.equal(second.guncel[0]!.id, first.yeni[0]!.id);
    assert.equal(findingKeyOf(second.guncel[0]!), moved[0]!.key);
  });

  console.log(`PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
