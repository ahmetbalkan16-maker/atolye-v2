import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { forgetSource, remember } from "../council/ExperienceMemory";
import { listOrders, type ProductionOrder } from "../orders/ProductionOrders";
import { type EpisodeTimeline, episodeTimeline, retentionLessons } from "./ChannelAnalyticsMap";
import { type ChannelGoals, evaluatePerformance, nextShortTargets, type PerformanceEvaluation, performanceLessons, type VideoPerformanceRecord } from "./ChannelGoals";
import { sameTitle } from "./YoutubeUpload";

/**
 * What a measured video teaches the brains, one path for both sources (owner, 19 Nov 2026): the owner's Studio
 * reading (`kanal.ts kaydet`) and the daily YouTube Analytics reader. It judges the record against the channel goals
 * (a Short against the next Short's targets, which only ever rise), writes the goal lesson into the writer's memory
 * (replacing the video's earlier one), and the retention lessons (hook and steepest drops, placed in the production's
 * scenes) into kurgu, mizah or kalite. Files and lesson memory only: no network, no model. Used by the CLIs and the
 * order watcher's idle cycle, never by the live AYAS server (ExperienceMemory stays off its import closure).
 */

/** The production's own opening check (its QC row) and topic, when the record names its order. */
export async function productionFacts(workRoot: string, record: Pick<VideoPerformanceRecord, "siparisId">): Promise<{ konu?: string; kanca?: string } | undefined> {
  if (!record.siparisId) return undefined;
  const order = (await listOrders(workRoot)).map((x) => x.order).find((o) => o.id === record.siparisId);
  if (!order?.cikti) return order ? { konu: order.konu } : undefined;
  const qc = path.join(order.cikti, "QC.md");
  const hook = existsSync(qc) ? (await fs.readFile(qc, "utf8")).split(/\r?\n/).find((l) => /^- \[[x ]\] Kanca:/.test(l)) : undefined;
  return { konu: order.konu, ...(hook ? { kanca: hook.replace(/^- \[[x ]\] Kanca:\s*/, "").replace(/\s*\(Short:.*$/, "") } : {}) };
}

/**
 * Judges a record against the goals and teaches the writer — exactly what `kaydet` did before 19 Nov 2026: a Short is
 * held to `nextShortTargets` of the other videos, the brains learn from the latest reading of a video only (kurgu and
 * mizah lessons of `performans <videoId>` are replaced). `kismi` (the API reader) also teaches from the view ratio
 * alone, as the API has no "chose to view" share.
 */
export async function judgeAndTeach(o: {
  readonly workRoot: string;
  readonly goals: ChannelGoals;
  readonly record: VideoPerformanceRecord;
  /** The other videos' records (targets are raised from these). */
  readonly others: readonly VideoPerformanceRecord[];
  readonly kismi?: boolean;
}): Promise<{ readonly evaluation: PerformanceEvaluation; readonly lessons: readonly { readonly beyin: "kurgu" | "mizah"; readonly metin: string }[] }> {
  const { record } = o;
  const targets = nextShortTargets(o.goals, o.others);
  const evaluation = evaluatePerformance(record, o.goals, record.sureSn <= 60 ? targets : undefined);
  const source = `performans ${record.videoId}`;
  const lessons = performanceLessons(record, evaluation, await productionFacts(o.workRoot, record), o.kismi ? { kismi: true } : {});
  for (const b of ["kurgu", "mizah"] as const) await forgetSource(o.workRoot, b, source);
  for (const l of lessons) await remember(o.workRoot, { bolum: source, beyin: l.beyin, tur: "ders", konu: `kanal performansı: ${record.baslik ?? record.videoId}`.slice(0, 90), metin: l.metin });
  return { evaluation, lessons };
}

/**
 * The audience retention lessons of a video's latest reading (`tutma <videoId>`, replaced on every new reading).
 * Returns every finding with its Turkish report line; only the placed ones (with `metin`) go into memory.
 */
export async function teachRetention(workRoot: string, record: VideoPerformanceRecord, timeline?: EpisodeTimeline): Promise<ReturnType<typeof retentionLessons>> {
  const found = retentionLessons(record, timeline);
  const source = `tutma ${record.videoId}`;
  for (const b of ["kurgu", "mizah", "kalite"] as const) await forgetSource(workRoot, b, source);
  for (const l of found) if (l.metin) await remember(workRoot, { bolum: source, beyin: l.beyin, tur: "ders", konu: `izleyici tutma: ${record.baslik ?? record.videoId}`.slice(0, 90), metin: l.metin });
  return found;
}

/** A video on the channel as the linker sees it. */
export interface LinkableVideo {
  readonly videoId: string;
  readonly title: string;
  readonly fileName?: string;
}

/**
 * The production a video on the channel came from, with what exists: the order AYAS uploaded it for
 * (`yayin.videoId`), else the file name the owner uploaded (youtube.json's `dosya`, e.g. `1638-animated-history.mp4`),
 * else one of the package's titles. Undefined when nothing matches (the video is then reported by time only).
 */
export function linkOrder(video: LinkableVideo, orders: readonly { readonly order: ProductionOrder; readonly paket?: { readonly dosya?: string; readonly basliklar: readonly string[] } }[]): ProductionOrder | undefined {
  const withOutput = orders.filter((x) => x.order.cikti);
  const byId = withOutput.find((x) => x.order.yayin?.videoId === video.videoId);
  if (byId) return byId.order;
  const file = video.fileName ? path.basename(video.fileName.replace(/\\/g, "/")) : undefined;
  const byFile = file ? withOutput.find((x) => x.paket?.dosya && path.basename(x.paket.dosya) === file) : undefined;
  if (byFile) return byFile.order;
  return withOutput.find((x) => x.paket?.basliklar.some((t) => sameTitle(t, video.title)))?.order;
}

/** Every delivered order with its YouTube package (youtube.json), read once per pull. */
export async function ordersWithPackages(workRoot: string): Promise<{ readonly order: ProductionOrder; readonly paket?: { readonly dosya?: string; readonly basliklar: readonly string[] } }[]> {
  const out: { order: ProductionOrder; paket?: { dosya?: string; basliklar: readonly string[] } }[] = [];
  for (const { order } of await listOrders(workRoot)) {
    const file = order.cikti ? path.join(order.cikti, "youtube.json") : "";
    if (!file || !existsSync(file)) {
      out.push({ order });
      continue;
    }
    try {
      const yt = JSON.parse(await fs.readFile(file, "utf8")) as { dosya?: unknown; paket?: { basliklar?: unknown } };
      const basliklar = Array.isArray(yt.paket?.basliklar) ? yt.paket.basliklar.filter((t): t is string => typeof t === "string") : [];
      out.push({ order, paket: { ...(typeof yt.dosya === "string" ? { dosya: yt.dosya } : {}), basliklar } });
    } catch {
      out.push({ order });
    }
  }
  return out;
}

/** The production's timeline (plan.json + episode.json in its output folder), or undefined. */
export async function loadTimeline(cikti: string | undefined): Promise<EpisodeTimeline | undefined> {
  if (!cikti) return undefined;
  const plan = path.join(cikti, "plan.json");
  if (!existsSync(plan)) return undefined;
  try {
    const episodeFile = path.join(cikti, "episode.json");
    const episode = existsSync(episodeFile) ? JSON.parse(await fs.readFile(episodeFile, "utf8")) : undefined;
    return episodeTimeline(JSON.parse(await fs.readFile(plan, "utf8")), episode);
  } catch {
    return undefined;
  }
}
