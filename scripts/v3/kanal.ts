/**
 * Crowns & Doodles — video goals and the post-publish learning loop (owner, 5 Nov 2026).
 *
 *   npx tsx scripts/v3/kanal.ts hedefler [--sure 60,120,180]   goals from content/v3/kanal-hedefleri.json, per length
 *   npx tsx scripts/v3/kanal.ts ornek > olcum.json           an empty measurement to fill from YouTube Studio
 *   npx tsx scripts/v3/kanal.ts kaydet --dosya olcum.json    record it, judge it against the goals, teach the brains
 *   npx tsx scripts/v3/kanal.ts rapor                        every measured video, the next Short's targets, the pilot
 *   npx tsx scripts/v3/kanal.ts pilot                        the 6-Short pilot plan and what is measured of it
 *
 * Reads and writes only the V3 work root's `_kutuphane/kanal/performans/` and the brains' lesson memory; it calls no
 * YouTube API, uploads nothing and spends nothing. A number not in the file is "ölçülmedi", never a pass.
 */
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { forgetSource, remember } from "../../src/lib/v3/council/ExperienceMemory";
import { listOrders } from "../../src/lib/v3/orders/ProductionOrders";
import {
  type ChannelGoals, evaluatePerformance, latestPerVideo, loadChannelGoals, nextShortTargets, PERFORMANCE_METRICS, type PerformanceEvaluation,
  performanceLessons, pilotTrends, recordViewRatio, shortBeats, type VideoPerformanceRecord, viewTargetSeconds,
} from "../../src/lib/v3/publish/ChannelGoals";
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
  if (e.eksikMetrikler.length) lines.push(`  Ölçülmeyen: ${e.eksikMetrikler.join(", ")}`);
  return lines;
}

/** The production's own opening check (its QC row), when the record names its order. */
async function productionFacts(workRoot: string, record: VideoPerformanceRecord): Promise<{ konu?: string; kanca?: string } | undefined> {
  if (!record.siparisId) return undefined;
  const order = (await listOrders(workRoot)).map((x) => x.order).find((o) => o.id === record.siparisId);
  if (!order?.cikti) return order ? { konu: order.konu } : undefined;
  const qc = path.join(order.cikti, "QC.md");
  const hook = existsSync(qc) ? (await fs.readFile(qc, "utf8")).split(/\r?\n/).find((l) => /^- \[[x ]\] Kanca:/.test(l)) : undefined;
  return { konu: order.konu, ...(hook ? { kanca: hook.replace(/^- \[[x ]\] Kanca:\s*/, "").replace(/\s*\(Short:.*$/, "") } : {}) };
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
    const targets = nextShortTargets(goals, others);
    const evaluation = evaluatePerformance(record, goals, record.sureSn <= 60 ? targets : undefined);
    console.log(`kaydedildi: ${saved}`);
    for (const line of evaluationLines(record, evaluation)) console.log(line);
    // The brains learn from the latest reading of a video only: an older lesson of the same video is replaced.
    const source = `performans ${record.videoId}`;
    const lessons = performanceLessons(record, evaluation, await productionFacts(paths.workRoot, record));
    for (const b of ["kurgu", "mizah"] as const) await forgetSource(paths.workRoot, b, source);
    for (const l of lessons) await remember(paths.workRoot, { bolum: source, beyin: l.beyin, tur: "ders", konu: `kanal performansı: ${record.baslik ?? record.videoId}`.slice(0, 90), metin: l.metin });
    console.log(lessons.length ? `beyinlere ders: ${lessons.length} (kurgu beyni bir sonraki senaryoda okur)` : "ders yazılmadı: hedef metrikleri ölçülmemiş ya da hedef tanımlı değil");
    return;
  }

  if (command === "rapor" || command === "pilot") {
    const records = await listPerformance(paths.workRoot);
    if (command === "rapor") {
      if (!records.length) console.log("Henüz kayıtlı ölçüm yok (kanal.ts kaydet --dosya …).");
      for (const r of latestPerVideo(records).sort((a, b) => a.olcumTarihi.localeCompare(b.olcumTarihi))) for (const line of evaluationLines(r, evaluatePerformance(r, goals))) console.log(line);
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
  throw new Error(`bilinmeyen komut: ${command} (hedefler | ornek | kaydet | rapor | pilot)`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
