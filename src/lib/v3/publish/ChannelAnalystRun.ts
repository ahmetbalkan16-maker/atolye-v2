import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { say } from "../council/DevBrain";
import { listProposals, proposalDir, updateProposal } from "../council/SelfImprovement";
import { listOrders } from "../orders/ProductionOrders";
import type { EpisodeTimeline } from "./ChannelAnalyticsMap";
import { analystReport, analyzeChannel, type ChannelAnalysis, planAnalystProposals, type ProposalPlan } from "./ChannelAnalyst";
import { latestPerVideo, type VideoPerformanceRecord } from "./ChannelGoals";
import { loadTimeline } from "./ChannelLearning";
import { listPerformance } from "./VideoPerformanceStore";

/**
 * The channel analyst's file half (owner, 27 Nov 2026, "videolarımız daha iyi olsun"): reads the performance records
 * and the productions' timelines, runs the pure ChannelAnalyst, files its code findings as proposals in the one
 * proposal store the Gelişim Merkezi shows (SelfImprovement's `oneriler/`, "AYAS ÖNERİYOR · Kanal analisti"), writes
 * the owner's report under `_kutuphane/kanal/` and tells AYAS (its inbox and the brains' talk, as YoutubeAnalytics
 * tells a dead connection). Weekly from the idle cycle (`gelisim.ts`, the "karsilastir" task), on demand from
 * `kanal.ts analiz`. Files only: no network, no model. Not imported by the live AYAS server (ChannelLearning brings
 * ExperienceMemory).
 */

/** The weekly step runs at most once in this many days. */
export const ANALYST_EVERY_DAYS = 7;

const kanalDir = (workRoot: string) => path.join(workRoot, "_kutuphane", "kanal");
export const analystStateFile = (workRoot: string) => path.join(kanalDir(workRoot), "analist.json");
export const analystReportFile = (workRoot: string) => path.join(kanalDir(workRoot), "analiz-raporu.md");

async function writeAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, text);
  await fs.rename(`${file}.tmp`, file);
}

/** The timeline of each video's production (by the record's order), when its plan is still on disk. */
export async function analystTimelines(workRoot: string, records: readonly VideoPerformanceRecord[]): Promise<Map<string, EpisodeTimeline>> {
  const out = new Map<string, EpisodeTimeline>();
  const latest = latestPerVideo(records).filter((r) => r.siparisId);
  if (!latest.length) return out;
  const orders = new Map((await listOrders(workRoot)).map((x) => [x.order.id, x.order]));
  for (const r of latest) {
    const t = await loadTimeline(orders.get(r.siparisId!)?.cikti, r.sureSn).catch(() => undefined);
    if (t) out.set(r.videoId, t);
  }
  return out;
}

/** The analysis of the work root's records and the proposals it would make (nothing written). */
export async function analyseChannel(workRoot: string, now = new Date()): Promise<{ readonly analiz: ChannelAnalysis; readonly plan: ProposalPlan }> {
  const records = await listPerformance(workRoot);
  const analiz = analyzeChannel(records, { timelines: await analystTimelines(workRoot, records) });
  const plan = planAnalystProposals(analiz.bulgular, (await listProposals(workRoot)).map((x) => x.proposal), now);
  return { analiz, plan };
}

/** Writes the plan's proposals (new ones atomically in the store, changed evidence into the waiting one). */
export async function fileAnalystProposals(workRoot: string, plan: ProposalPlan): Promise<void> {
  for (const p of plan.yeni) await writeAtomic(path.join(proposalDir(workRoot), `${p.id}.json`), `${JSON.stringify(p, null, 2)}\n`);
  for (const p of plan.guncel) await updateProposal(workRoot, p.id, (old) => (old.durum === "bekliyor" ? p : old));
}

/** Tells AYAS: one line in its inbox (with the report's path) and one in the brains' talk addressed to AYAS. */
async function tellOwner(workRoot: string, text: string, report: string, now: Date): Promise<void> {
  await say(workRoot, text, "AYAS", now);
  const inbox = path.join(workRoot, "_kutuphane", "ayas-gelen-kutusu.jsonl");
  await fs.mkdir(path.dirname(inbox), { recursive: true });
  await fs.appendFile(inbox, `${JSON.stringify({ tarih: now.toISOString(), kaynak: "atolye-v3-kanal-analisti", ozet: text, rapor: report })}\n`);
}

export type AnalystTickState = "erken" | "veri-yok" | "tamam" | "hata";

/**
 * The weekly step, safe to call every cycle: nothing within ANALYST_EVERY_DAYS of the last run (unless `force`),
 * nothing without records (the state is not stamped, so it runs as soon as there are some), never throws. Files the
 * proposals, writes the report, and tells AYAS when anything was new or changed.
 */
export async function channelAnalystTick(d: { readonly workRoot: string; readonly now?: Date; readonly force?: boolean }): Promise<{ readonly durum: AnalystTickState; readonly satir: string }> {
  const now = d.now ?? new Date();
  try {
    const file = analystStateFile(d.workRoot);
    const state = existsSync(file) ? (JSON.parse(await fs.readFile(file, "utf8")) as { sonAnaliz?: string }) : {};
    if (!d.force && state.sonAnaliz && now.getTime() - Date.parse(state.sonAnaliz) < ANALYST_EVERY_DAYS * 86_400_000) return { durum: "erken", satir: `kanal analisti bu hafta çalıştı (${state.sonAnaliz.slice(0, 10)})` };
    const { analiz, plan } = await analyseChannel(d.workRoot, now);
    if (!analiz.videolar) return { durum: "veri-yok", satir: "kanal analisti: ölçülmüş video yok" };
    await fileAnalystProposals(d.workRoot, plan);
    const report = analystReportFile(d.workRoot);
    await writeAtomic(report, analystReport(analiz, plan, now));
    await writeAtomic(file, `${JSON.stringify({ ...state, sonAnaliz: now.toISOString() }, null, 2)}\n`);
    const satir = `kanal analisti: ${analiz.videolar} video, ${analiz.bulgular.length} bulgu; ${plan.yeni.length} yeni öneri, ${plan.guncel.length} öneri güncellendi${plan.sahip.length ? `, ${plan.sahip.length} sahip kararı` : ""}`;
    if (plan.yeni.length || plan.guncel.length || plan.sahip.length) {
      const owner = plan.sahip.map((f) => f.baslik).join("; ");
      await tellOwner(d.workRoot, `${satir} (Gelişim Merkezi: AYAS ÖNERİYOR · Kanal analisti)${owner ? `. Senin kararın: ${owner}` : ""}. Rapor: ${report}`, report, now);
    }
    return { durum: "tamam", satir };
  } catch (e) {
    return { durum: "hata", satir: `kanal analisti: ${(e as Error).message.slice(0, 200)}` };
  }
}
