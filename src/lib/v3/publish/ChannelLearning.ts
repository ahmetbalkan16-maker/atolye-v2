import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { forgetSource, remember } from "../council/ExperienceMemory";
import { listOrders, type ProductionOrder } from "../orders/ProductionOrders";
import { type EpisodeTimeline, episodeTimeline, retentionLessons, TIMELINE_TOLERANCE_S } from "./ChannelAnalyticsMap";
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

/** A delivered order with its YouTube package and the video files in its folder (ordersWithPackages). */
export interface PackagedOrder {
  readonly order: ProductionOrder;
  readonly paket?: { readonly dosya?: string; readonly basliklar: readonly string[] };
  readonly dosyalar?: readonly string[];
}

/**
 * The production a video on the channel came from, with what exists: the order AYAS uploaded it for
 * (`yayin.videoId`), else the file name the owner uploaded (youtube.json's `dosya`, e.g. `1638-animated-history.mp4`,
 * or a video file of that name in the order's folder — the owner renames before uploading: "Taranto Raid 1940 21
 * Biplanes vs İtalian Battleships.mp4", 19 Nov 2026), else one of the package's titles. Undefined when nothing matches
 * (the video is then reported by time only).
 */
export function linkOrder(video: LinkableVideo, orders: readonly PackagedOrder[]): ProductionOrder | undefined {
  return linkCandidates(video, orders)[0];
}

/**
 * Every order the video may have come from, best first (linkOrder's rules). Several orders can share an upload's file
 * name — the Zanzibar Short was produced twice and both folders hold "38-minute-war-1896-animated-history.mp4" — so the
 * puller takes the first whose timeline fits the upload's length.
 */
export function linkCandidates(video: LinkableVideo, orders: readonly PackagedOrder[]): ProductionOrder[] {
  const withOutput = orders.filter((x) => x.order.cikti);
  const file = video.fileName ? path.basename(video.fileName.replace(/\\/g, "/")) : undefined;
  const ranked = [
    ...withOutput.filter((x) => x.order.yayin?.videoId === video.videoId),
    ...(file ? withOutput.filter((x) => (x.paket?.dosya && path.basename(x.paket.dosya) === file) || x.dosyalar?.includes(file)) : []),
    ...withOutput.filter((x) => x.paket?.basliklar.some((t) => sameTitle(t, video.title))),
  ].map((x) => x.order);
  return ranked.filter((o, i) => ranked.findIndex((x) => x.id === o.id) === i);
}

/** Every delivered order with its YouTube package (youtube.json), read once per pull. */
export async function ordersWithPackages(workRoot: string): Promise<PackagedOrder[]> {
  const out: PackagedOrder[] = [];
  for (const { order } of await listOrders(workRoot)) {
    const file = order.cikti ? path.join(order.cikti, "youtube.json") : "";
    // The video files in the folder (the owner's renamed upload copy among them).
    const dosyalar = order.cikti && existsSync(order.cikti) ? (await fs.readdir(order.cikti)).filter((n) => /\.mp4$/i.test(n)) : [];
    if (!file || !existsSync(file)) {
      out.push({ order, dosyalar });
      continue;
    }
    try {
      const yt = JSON.parse(await fs.readFile(file, "utf8")) as { dosya?: unknown; paket?: { basliklar?: unknown } };
      const basliklar = Array.isArray(yt.paket?.basliklar) ? yt.paket.basliklar.filter((t): t is string => typeof t === "string") : [];
      out.push({ order, paket: { ...(typeof yt.dosya === "string" ? { dosya: yt.dosya } : {}), basliklar }, dosyalar });
    } catch {
      out.push({ order, dosyalar });
    }
  }
  return out;
}

/**
 * The production's timeline (plan.json + episode.json in its output folder), or undefined. With `durationS` (the
 * upload's length) the delivered round's is looked for too: a kept round's `tur<N>/plan.json` (RetouchBrain.keepRound)
 * whose length fits within TIMELINE_TOLERANCE_S, with that round's episode; the folder's own when none fits.
 */
export async function loadTimeline(cikti: string | undefined, durationS?: number): Promise<EpisodeTimeline | undefined> {
  if (!cikti) return undefined;
  const read = async (dir: string): Promise<EpisodeTimeline | undefined> => {
    const plan = path.join(dir, "plan.json");
    if (!existsSync(plan)) return undefined;
    try {
      const episodeFile = [path.join(dir, "episode.json"), path.join(cikti, "episode.json")].find((f) => existsSync(f));
      const episode = episodeFile ? JSON.parse(await fs.readFile(episodeFile, "utf8")) : undefined;
      return episodeTimeline(JSON.parse(await fs.readFile(plan, "utf8")), episode);
    } catch {
      return undefined;
    }
  };
  const own = await read(cikti);
  const fits = (t?: EpisodeTimeline) => !!t && durationS !== undefined && Math.abs(t.sureSn - durationS) <= TIMELINE_TOLERANCE_S;
  if (durationS === undefined || fits(own)) return own;
  const rounds = existsSync(cikti) ? (await fs.readdir(cikti)).filter((n) => /^tur\d+$/.test(n)).sort() : [];
  for (const r of rounds) {
    const t = await read(path.join(cikti, r));
    if (fits(t)) return t;
  }
  return own;
}
