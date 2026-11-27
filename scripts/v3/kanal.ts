/**
 * Crowns & Doodles — video goals and the post-publish learning loop (owner, 5 Nov 2026).
 *
 *   npx tsx scripts/v3/kanal.ts hedefler [--sure 60,120,180]   goals from content/v3/kanal-hedefleri.json, per length
 *   npx tsx scripts/v3/kanal.ts ornek > olcum.json           an empty measurement to fill from YouTube Studio
 *   npx tsx scripts/v3/kanal.ts kaydet --dosya olcum.json    record it, judge it against the goals, teach the brains
 *   npx tsx scripts/v3/kanal.ts cek [--video <id>] [--yeniden] read YouTube Analytics now, record and teach (owner, 19 Nov 2026);
 *                                                            --yeniden reads the moments already read again (organic numbers)
 *   npx tsx scripts/v3/kanal.ts rapor                        every measured video (Studio and API), the channel summary,
 *                                                            the next Short's targets, the pilot
 *   npx tsx scripts/v3/kanal.ts pilot                        the 6-Short pilot plan and what is measured of it
 *   npx tsx scripts/v3/kanal.ts analiz [--yaz]               the channel analyst (owner, 27 Nov 2026): what repeats across the
 *                                                            videos and the proposals it would make; --yaz files them in the
 *                                                            Gelişim Merkezi and writes _kutuphane/kanal/analiz-raporu.md
 *                                                            (the idle cycle does it once a week by itself)
 *
 * Reads and writes only the V3 work root's `_kutuphane/kanal/` and the brains' lesson memory (`analiz --yaz` also the
 * Gelişim Merkezi's proposals and AYAS's inbox). Only `cek`
 * reaches YouTube (read-only Data and Analytics APIs with the owner's token; the idle cycle does the same once a day);
 * nothing uploads and nothing spends. A number not in the file is "ölçülmedi", never a pass.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { AFTER_HOOK_S, channelSummary, feedCurve, holdAfterHook, retentionDrops, viewSplit } from "../../src/lib/v3/publish/ChannelAnalyticsMap";
import {
  type ChannelGoals, evaluatePerformance, latestPerVideo, loadChannelGoals, nextShortTargets, PERFORMANCE_METRICS, type PerformanceEvaluation,
  pilotTrends, recordViewRatio, shortBeats, type VideoPerformanceRecord, viewTargetSeconds,
} from "../../src/lib/v3/publish/ChannelGoals";
import { analystReport } from "../../src/lib/v3/publish/ChannelAnalyst";
import { analyseChannel, channelAnalystTick } from "../../src/lib/v3/publish/ChannelAnalystRun";
import { judgeAndTeach } from "../../src/lib/v3/publish/ChannelLearning";
import { youtubeAnalyticsTick } from "../../src/lib/v3/publish/YoutubeAnalytics";
import { youtubeSettings } from "../../src/lib/v3/publish/YoutubeAuth";
import { listPerformance, parsePerformanceInput, savePerformance } from "../../src/lib/v3/publish/VideoPerformanceStore";
import { loadV3Settings, resolveV3Paths } from "../../src/lib/v3/V3Paths";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "ölçülmedi" : `%${(x * 100).toFixed(1).replace(/\.0$/, "")}`);
const STATUS: Record<string, string> = { OLCULMEDI: "ÖLÇÜLMEDİ", HEDEF_YOK: "hedef yok", HEDEF_ALTI: "hedefin ALTINDA", HEDEFTE: "hedefte", HEDEF_USTU: "hedefin üstünde", VERI_EKSIK: "VERİ EKSİK — değerlendirilemedi" };

function goalsOrExit(contentRoot: string): ChannelGoals {
  const goals = loadChannelGoals(contentRoot);
  if (!goals) throw new Error(`hedef dosyası yok: ${path.join(contentRoot, "kanal-hedefleri.json")}`);
  return goals;
}

function evaluationLines(record: VideoPerformanceRecord, e: PerformanceEvaluation): string[] {
  const lines = [`${record.videoId} "${record.baslik ?? "?"}" (${record.sureSn} sn, ${e.tur}, ${record.olcumAni} · ${record.olcumTarihi}, ${record.kaynak}): ${STATUS[e.sonuc]}`];
  for (const c of e.kontroller) {
    const name = c.metrik === "izlemeyiSecenler" ? "İzlemeyi seçenler" : "Ort. izlenme oranı";
    const target = c.hedef ? ` (hedef ${pct(c.hedef.min)}–${pct(c.hedef.max)}${c.baslangicFarki !== undefined ? `, başlangıca göre ${c.baslangicFarki >= 0 ? "+" : ""}${(c.baslangicFarki * 100).toFixed(1)} puan` : ""})` : "";
    lines.push(`  ${name}: ${pct(c.deger)} → ${STATUS[c.durum]}${target}`);
  }
  if (record.metrikler.ortIzlemeSn !== null) lines.push(`  Ort. görüntüleme süresi: ${record.metrikler.ortIzlemeSn} sn / ${record.sureSn} sn`);
  if (record.organik) lines.push(`  Reklamsız (organik): ${record.organik.goruntuleme} görüntüleme, ort. ${record.organik.ortIzlemeSn ?? "?"} sn; reklam payı ${pct(record.organik.reklamPayi)}`);
  const feed = feedCurve(record);
  if (feed.curve.length) {
    // The API's retention curve — a mostly paid video's organic one — the hook, what is left after it, the steepest
    // drops (`cek` names their scenes when it links a production).
    const r = retentionDrops(feed.curve, record.sureSn);
    const hold = holdAfterHook(feed.curve, record.sureSn);
    const parts = [
      ...(r.kanca ? [`ilk ${r.kanca.sn} sn'de %${Math.round(r.kanca.kayip * 100)} gitti${r.kanca.goreli !== undefined ? ` (göreli ${r.kanca.goreli.toFixed(2)})` : ""}`] : []),
      ...(hold !== undefined ? [`kanca sonrası 3→${AFTER_HOOK_S} sn kalan %${Math.round(hold * 100)}`] : []),
      ...r.dususler.map((x) => `${x.basSn}–${x.bitSn} sn'de %${Math.round(x.kayip * 100)}`),
    ];
    lines.push(`  İzleyici tutma${feed.organik ? " (organik)" : ""}: ${parts.length ? parts.join("; ") : "belirgin düşüş yok"}`);
  }
  if (record.trafik) lines.push(`  Trafik: ${Object.entries(record.trafik).map(([k, v]) => `${k} ${pct(v)}`).join(", ")}`);
  // Paid and organic apart (owner, 23 Nov 2026): a Short is judged by its organic feed views, never by the ads' total.
  const split = viewSplit(record);
  if (split) lines.push(`  Görüntüleme ayrımı: toplam ${split.toplam} — reklam ${split.reklam}, organik ${split.organik} (Shorts akışı ${split.akis})`);
  if (e.eksikMetrikler.length) lines.push(`  Ölçülmeyen: ${e.eksikMetrikler.join(", ")}`);
  return lines;
}



async function main(): Promise<void> {
  loadV3Settings();
  const paths = resolveV3Paths();
  const goals = goalsOrExit(paths.contentRoot);
  const command = process.argv[2] ?? "rapor";

  if (command === "hedefler") {
    const s = goals.hedefler.short;
    console.log(`${goals.kanal.ad} (${goals.kanal.dil}) — kaynak: ${goals.baslangic.kaynak}`);
    console.log(`Başlangıç (video ${goals.baslangic.video.videoId}, ${goals.baslangic.video.sureSn} sn): izlemeyi seçenler ${pct(goals.baslangic.video.izlemeyiSecenler)}, ort. ${goals.baslangic.video.ortIzlemeSn} sn`);
    console.log(`Short hedefi (${s.durum}): izlemeyi seçenler ${pct(s.izlemeyiSecenler.min)}–${pct(s.izlemeyiSecenler.max)}, ort. izlenme videonun ${pct(s.ortIzlenmeOrani.min)}–${pct(s.ortIzlenmeOrani.max)}'i`);
    for (const sure of (arg("--sure") ?? "60,120,180").split(",").map(Number).filter((n) => n > 0)) {
      const t = viewTargetSeconds(goals, sure);
      console.log(`  ${sure} sn: ort. izlenme hedefi ${t ? `${t.min}–${t.max} sn` : "tanımlı değil"}; bölümler ${sure <= 60 ? shortBeats(goals, sure).map((b) => `${b.id} ${b.basSn}–${b.bitSn}`).join(", ") : "(uzun video)"}`);
    }
    console.log(`Uzun video: ${goals.hedefler.uzun.durum}${goals.hedefler.uzun.not ? ` — ${goals.hedefler.uzun.not}` : ""}`);
    console.log(`Diziler: ${goals.diziler.map((d) => `${d.oncelik}. ${d.ad}`).join(" · ")}`);
    // The question shapes that drew most on the studied channel (owner, 23 Nov 2026), for choosing the next topics.
    const shapes = [...(goals.shortsYapisi.soruKaliplari ?? [])].sort((a, b) => b.medyanIzlenme - a.medyanIzlenme);
    if (shapes.length) console.log(`Soru kalıpları (Knowledgia medyan izlenmesine göre): ${shapes.map((k) => `${k.kalip} — ör. "${k.ornek}" (${(k.medyanIzlenme / 1e6).toFixed(1)} M)`).join(" · ")}`);
    return;
  }

  if (command === "ornek") {
    console.log(JSON.stringify({
      videoId: "q8JW_i5Gt0M", baslik: "Never Kidnap a Future Emperor", sureSn: 44, olcumAni: "7g", olcumTarihi: new Date().toISOString().slice(0, 10), kaynak: "studio-elle",
      yayinZamani: null, siparisId: null, pilotNo: null,
      metrikler: Object.fromEntries(PERFORMANCE_METRICS.map((k) => [k, null])),
      ulkeler: [{ ulke: "US", pay: null, goruntuleme: null, ortIzlemeSn: null }],
      trafik: { shortsAkisi: null, youtubeArama: null, kanalSayfasi: null, harici: null },
      not: "Studio'da görünmeyen sayıyı null bırak; tahmin yazma. Oranlar 0.52 ya da \"52%\" yazılabilir.",
    }, null, 2));
    return;
  }

  if (command === "kaydet") {
    const file = arg("--dosya");
    if (!file) throw new Error("--dosya <ölçüm.json> gerekli (şablon: kanal.ts ornek)");
    const record = parsePerformanceInput(JSON.parse(await fs.readFile(file, "utf8")));
    const saved = await savePerformance(paths.workRoot, record);
    const others = (await listPerformance(paths.workRoot)).filter((r) => r.videoId !== record.videoId);
    // One path with the API reader (ChannelLearning.judgeAndTeach): judged against the next Short's targets, and the
    // latest reading's lesson replaces the video's older one.
    const { evaluation, lessons } = await judgeAndTeach({ workRoot: paths.workRoot, goals, record, others });
    console.log(`kaydedildi: ${saved}`);
    for (const line of evaluationLines(record, evaluation)) console.log(line);
    console.log(lessons.length ? `beyinlere ders: ${lessons.length} (kurgu beyni bir sonraki senaryoda okur)` : "ders yazılmadı: hedef metrikleri ölçülmemiş ya da hedef tanımlı değil");
    return;
  }

  if (command === "cek") {
    // Owner, 19 Nov 2026: the channel's numbers straight from YouTube (the idle cycle does this once a day by itself).
    const videoId = arg("--video");
    const r = await youtubeAnalyticsTick({ workRoot: paths.workRoot, goals, settings: youtubeSettings(paths.repoRoot), fetcher: fetch, force: true, ...(videoId ? { videoId } : {}), ...(process.argv.includes("--yeniden") ? { yeniden: true } : {}), log: (l) => console.log(l) });
    if (r.durum === "token-yok") throw new Error("YouTube bağlı değil — önce: npx tsx scripts/v3/youtube.ts baglan");
    if (!r.sonuc) {
      console.log(r.satir);
      process.exitCode = 1;
      return;
    }
    for (const line of r.sonuc.satirlar) console.log(line);
    console.log(`${r.sonuc.kayitlar.length} yeni ölçüm kaydedildi, beyinlere ${r.sonuc.ders} ders yazıldı (kanal.ts rapor)`);
    return;
  }

  if (command === "analiz") {
    // The channel analyst (owner, 27 Nov 2026): read-only unless --yaz; the idle cycle runs the same once a week.
    if (process.argv.includes("--yaz")) {
      const r = await channelAnalystTick({ workRoot: paths.workRoot, force: true, oneriYaz: true });
      console.log(r.satir);
      if (r.durum === "hata") process.exitCode = 1;
      return;
    }
    const now = new Date();
    const { analiz, plan } = await analyseChannel(paths.workRoot, now);
    console.log(analystReport(analiz, plan, now));
    console.log("Yazılacak öneriler (--yaz ile Gelişim Merkezi'ne):");
    for (const p of plan.yeni) console.log(`  YENİ ${p.id} [${p.beyin}] ${p.baslik}\n      geliştiriciye görev: ${p.neden.slice(0, 400)}`);
    for (const p of plan.guncel) console.log(`  KANITI GÜNCELLENİR ${p.id} [${p.beyin}] ${p.baslik}`);
    for (const x of plan.ayni) console.log(`  DEĞİŞMEZ ${x.key} (${x.durum})`);
    for (const f of plan.sahip) console.log(`  SAHİP KARARI, kuyruğa yazılmaz (${f.key}): ${f.oneri}`);
    if (!plan.yeni.length && !plan.guncel.length && !plan.ayni.length && !plan.sahip.length) console.log("  yok");
    return;
  }

  if (command === "rapor" || command === "pilot") {
    const records = await listPerformance(paths.workRoot);
    if (command === "rapor") {
      if (!records.length) console.log("Henüz kayıtlı ölçüm yok (kanal.ts kaydet --dosya … ya da kanal.ts cek).");
      for (const r of latestPerVideo(records).sort((a, b) => a.olcumTarihi.localeCompare(b.olcumTarihi))) for (const line of evaluationLines(r, evaluatePerformance(r, goals))) console.log(line);
      const sum = channelSummary(records, goals);
      if (sum.olculen) {
        const v = (x: NonNullable<typeof sum.enIyi>) => `${x.videoId} "${x.baslik ?? "?"}" ort. izlenme ${pct(x.oran)} (${STATUS[x.sonuc] ?? x.sonuc})`;
        console.log(`\nKanal özeti: ${sum.olculen} video ölçüldü (${sum.api} YouTube API'den); ${Object.entries(sum.sonuclar).map(([k, n]) => `${STATUS[k] ?? k}: ${n}`).join(", ")}`);
        if (sum.enIyi) console.log(`  En iyi: ${v(sum.enIyi)}`);
        if (sum.enKotu) console.log(`  En zayıf: ${v(sum.enKotu)}`);
        if (sum.trafik.length) console.log(`  Trafik (görüntülemeye göre): ${sum.trafik.slice(0, 6).map((t) => `${t.kaynak} ${pct(t.pay)}`).join(", ")}`);
        // Every video by its organic Shorts-feed views (owner, 23 Nov 2026: reklamla gelen izlenme ayrı ölçülür).
        const split = latestPerVideo(records).flatMap((r) => ((x) => (x ? [{ r, x }] : []))(viewSplit(r))).sort((a, b) => b.x.akis - a.x.akis);
        if (split.length) {
          console.log("  Organik Shorts akışına göre (reklam ayrı):");
          for (const { r, x } of split) console.log(`    ${r.videoId} "${(r.baslik ?? "?").slice(0, 50)}": akış ${x.akis}, organik ${x.organik}, reklam ${x.reklam} / toplam ${x.toplam}`);
        }
      }
      const next = nextShortTargets(goals, records);
      console.log(`\nSonraki Short hedefi: izlemeyi seçenler ${pct(next.izlemeyiSecenler.min)}–${pct(next.izlemeyiSecenler.max)}, ort. izlenme ${pct(next.ortIzlenmeOrani.min)}–${pct(next.ortIzlenmeOrani.max)} (${next.neden})`);
      const ratios = latestPerVideo(records).map(recordViewRatio).filter((x): x is number => x !== null);
      if (ratios.length) console.log(`Ölçülen ${ratios.length} videonun ortalama izlenme oranı: ${pct(ratios.reduce((a, b) => a + b, 0) / ratios.length)}`);
    }
    const trends = pilotTrends(goals, records);
    console.log(`\n${goals.pilot.ad} — ${trends.uyari}`);
    for (const v of goals.pilot.videolar) {
      const r = latestPerVideo(records).find((x) => x.pilotNo === v.no);
      console.log(`  ${v.no}. [${v.saat} TR] ${goals.diziler.find((d) => d.id === v.dizi)?.ad}: ${v.konu} (${v.donem}) — ${r ? `${r.videoId}, izlemeyi seçenler ${pct(r.metrikler.izlemeyiSecenler)}` : "ölçülmedi"}`);
    }
    for (const s of trends.saatler) console.log(`  saat ${s.saat}: ${s.n} video${s.diziyeGoreFark !== undefined ? `, dizisine göre ${s.diziyeGoreFark >= 0 ? "+" : ""}${(s.diziyeGoreFark * 100).toFixed(1)} puan` : ""}`);
    return;
  }
  throw new Error(`bilinmeyen komut: ${command} (hedefler | ornek | kaydet | cek | rapor | pilot | analiz)`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
