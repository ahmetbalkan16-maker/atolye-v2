/**
 * Atölye V3 — learning from similar videos (owner approval, 2 Nov 2026). The brains read a reference video's captions
 * and a few frames, measure its pace and narration, and write lessons into their own memory; the measures become
 * targets. Studied only to learn: nothing of the video is used, its downloaded files are deleted after the measure.
 *
 *   npx tsx scripts/v3/referans.ts incele <youtube bağlantısı | id> [--neden "…"] [--kare 12]
 *   npx tsx scripts/v3/referans.ts ara --konu "…" [--sure 60] [--incele]   # searches; --incele studies the best hit
 *   npx tsx scripts/v3/referans.ts istekler                                  # studies the requests AYAS wrote
 *   npx tsx scripts/v3/referans.ts liste                                     # studied references and the targets
 *
 * Needs the tools' yt-dlp environment (`<toolsRoot>/yt-venv`). The eye (gemma4) waits for a cool GPU before every
 * frame; the text model is gpt-4.1 under a $0.06 cap per video (gemma4 when OpenAI is not chosen).
 */
import { brainBudget, brainVision } from "../../src/lib/v3/council/BrainModels";
import { BRAIN_NAMES } from "../../src/lib/v3/council/Council";
import { listReferences, listStudyRequests, measuresLine, pickSimilar, type ReferenceRecord, referenceTargets, saveStudyRequest, searchVideos, studyReference, targetsLine, youtubeId } from "../../src/lib/v3/council/ReferenceStudy";
import { youtubeSettings } from "../../src/lib/v3/publish/YoutubeAuth";
import { loadV3Settings, resolveV3Paths, type V3Paths } from "../../src/lib/v3/V3Paths";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Spend ceiling of one study: the transcript excerpt is ~6k tokens, gpt-4.1 spends about 3 cents (gpt-4.1-mini's
 * lessons on Sancaray, 2 Nov 2026, were generic advice — "use dialogue to keep the pace" — so the stronger model reads).
 */
const STUDY_CAP_USD = 0.06;

async function study(paths: V3Paths, id: string, neden: string, log: (s: string) => void = console.log): Promise<ReferenceRecord> {
  const { budget, director } = brainBudget(paths, STUDY_CAP_USD);
  log(`referans inceleniyor: ${id} (${neden})`);
  const r = await studyReference({ paths, id, neden, eye: brainVision(), budget, model: director, frames: Number(arg("--kare") ?? 12), log });
  log(`✓ "${r.baslik}" — ${r.kanal}: ${measuresLine(r.olcum)}`);
  if (r.ozet) log(`  özet: ${r.ozet}`);
  for (const d of r.dersler) log(`  [${BRAIN_NAMES[d.beyin]}] ${d.tr || d.metin}`);
  for (const e of r.eksik) log(`  eksik: ${e}`);
  log(`  maliyet: $${budget.spentUsd.toFixed(4)}`);
  return r;
}

async function main() {
  loadV3Settings();
  const paths = resolveV3Paths();
  const cmd = process.argv[2];
  if (cmd === "incele") {
    const id = youtubeId(process.argv[3] ?? "");
    if (!id) throw new Error("Kullanım: referans.ts incele <youtube bağlantısı | id>");
    await study(paths, id, arg("--neden") ?? "owner bağlantısı");
    return;
  }
  if (cmd === "ara") {
    const konu = arg("--konu");
    if (!konu) throw new Error('Kullanım: referans.ts ara --konu "…" [--sure 60] [--incele]');
    const hits = await searchVideos(paths, konu);
    for (const h of hits) console.log(`${h.id}  ${String(Math.round(h.sureSn)).padStart(5)} sn  ${String(h.izlenme).padStart(10)} izlenme  ${h.kanal} — ${h.baslik}`);
    const studied = new Set((await listReferences(paths.workRoot)).map((r) => r.id));
    const best = pickSimilar(hits, Number(arg("--sure") ?? 600), { studied, ...(youtubeSettings(paths.repoRoot).channelId ? { ownChannelId: youtubeSettings(paths.repoRoot).channelId! } : {}) });
    console.log(best ? `en uygun: ${best.id} — ${best.baslik}` : "uygun (aynı türden, incelenmemiş) video yok");
    if (best && process.argv.includes("--incele")) await study(paths, best.id, `benzer arama: ${konu}`);
    return;
  }
  if (cmd === "istekler") {
    for (const { file, request } of await listStudyRequests(paths.workRoot)) {
      if (request.durum !== "bekliyor") continue;
      try {
        const r = await study(paths, request.id, `${request.kaynak} isteği`);
        Object.assign(request, { durum: "tamam", sonuc: `${r.dersler.length} ders: ${r.ozet}`.slice(0, 400) });
      } catch (e) {
        Object.assign(request, { durum: "hata", sonuc: (e as Error).message.slice(0, 300) });
        console.error(`✗ ${request.id}: ${(e as Error).message.slice(0, 300)}`);
      }
      await saveStudyRequest(file, request);
    }
    return;
  }
  if (cmd === "liste") {
    const refs = await listReferences(paths.workRoot);
    for (const r of refs) console.log(`${r.id}  ${r.tarih.slice(0, 10)}  "${r.baslik}" — ${r.kanal}\n    ${measuresLine(r.olcum)}\n    ${r.dersler.length} ders${r.eksik.length ? `; eksik: ${r.eksik.join("; ")}` : ""}`);
    for (const kind of ["short", "uzun"] as const) {
      const t = referenceTargets(refs, kind);
      if (t) console.log(`hedef (${kind}): ${targetsLine(t)}`);
    }
    if (!refs.length) console.log("henüz incelenmiş referans yok");
    return;
  }
  throw new Error("Kullanım: referans.ts incele <bağlantı> | ara --konu … [--incele] | istekler | liste");
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
