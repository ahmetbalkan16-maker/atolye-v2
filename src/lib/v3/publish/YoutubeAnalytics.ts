import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { say } from "../council/DevBrain";
import { type ApiVideo, analyticsRecord, dueMoments, isRecent, parseVideos, RECENT_DAYS, type ReportRow, reportRows } from "./ChannelAnalyticsMap";
import { type ChannelGoals, type VideoPerformanceRecord } from "./ChannelGoals";
import { judgeAndTeach, linkOrder, loadTimeline, ordersWithPackages, teachRetention } from "./ChannelLearning";
import { type Fetcher, hasAnalyticsScope, isReconnectError, loadClient, loadToken, myChannel, refreshAccessToken, type YoutubeSettings } from "./YoutubeAuth";
import { listPerformance, savePerformance } from "./VideoPerformanceStore";

/**
 * The channel's numbers from YouTube itself (owner, 19 Nov 2026: "AYAS'ı ve sistemi YouTube hesabıma bağlamak
 * istiyorum; performansları incelesin, ona göre önlem alsın, kendini geliştirsin"). The owner uploads by hand; once a
 * day the order watcher's idle cycle (the "karsilastir" task of `gelisim.ts`) and on demand `kanal.ts cek` read, for
 * the videos of the last RECENT_DAYS days, each measuring moment that has passed and is not read yet: the Data API's
 * uploads list and video details, and per video and moment three YouTube Analytics v2 reports (basic numbers, the
 * audience retention curve, traffic sources). Each reading is saved as a performance record, judged against the goals
 * and turned into lessons (ChannelLearning). Read-only scopes; free (API quota only); no model.
 *
 * Network: only the injected fetcher, only from the watcher's processes and the CLIs — never imported by anything the
 * live AYAS server imports. A dead refresh token (`invalid_grant`, every 7 days while the Google app is in "Testing")
 * or a consent without the Analytics scope is told to the owner in AYAS at most once a day, and never stops the cycle.
 */

const DATA_API = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";
/** The basic per-video report (YouTube Analytics v2 metric names, checked against the official list 19 Nov 2026). */
export const BASIC_METRICS = ["views", "engagedViews", "estimatedMinutesWatched", "averageViewDuration", "averageViewPercentage", "likes", "comments", "shares", "subscribersGained"] as const;
/** Pages of 50 uploads read at most on one pass (the list is newest first; the pass stops at RECENT_DAYS). */
const MAX_UPLOAD_PAGES = 4;
/** A daily pass is tried once in this many hours (the idle cycle runs every 4 h). */
export const PULL_EVERY_H = 20;
/** The owner hears about a dead connection at most once in this many hours. */
export const NOTICE_EVERY_H = 24;

export const RECONNECT_NOTICE = "YouTube bağlantısının süresi doldu — `npx tsx scripts/v3/youtube.ts baglan`";
export const SCOPE_NOTICE = "YouTube bağlantısında Analytics izni yok — performansı okumak için yeniden bağlan: `npx tsx scripts/v3/youtube.ts baglan`";

class AnalyticsScopeError extends Error {}

/** The owner's reading of an Analytics refusal: a missing scope is "reconnect", anything else names its reason. */
async function readOrThrow(r: Response, what: string): Promise<unknown> {
  if (r.ok) return r.json();
  let reason = "";
  try {
    const j = JSON.parse((await r.text()).slice(0, 65_536)) as { error?: { errors?: { reason?: unknown }[]; message?: unknown; status?: unknown } };
    const x = j.error?.errors?.[0]?.reason ?? j.error?.status ?? j.error?.message;
    reason = typeof x === "string" ? x.slice(0, 160) : "";
  } catch {
    // An unreadable body keeps the status alone.
  }
  if (r.status === 403 && /insufficient|scope|ACCESS_TOKEN_SCOPE/i.test(reason)) throw new AnalyticsScopeError(`YOUTUBE_ANALYTICS_SCOPE: ${SCOPE_NOTICE}`);
  throw new Error(`${what}: http ${r.status}${reason ? ` ${reason}` : ""}`);
}

const get = (fetcher: Fetcher, token: string, url: string) => fetcher(url, { headers: { Authorization: `Bearer ${token}` } });

/** The uploads playlist newest first, up to the first item older than `sinceMs` (1 quota unit a page). */
export async function uploadsSince(fetcher: Fetcher, token: string, playlistId: string, sinceMs: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_UPLOAD_PAGES; page++) {
    const q = new URLSearchParams({ part: "contentDetails", maxResults: "50", playlistId, ...(pageToken ? { pageToken } : {}) });
    const j = (await readOrThrow(await get(fetcher, token, `${DATA_API}/playlistItems?${q.toString()}`), "YOUTUBE_UPLOADS")) as { items?: { contentDetails?: { videoId?: unknown; videoPublishedAt?: unknown } }[]; nextPageToken?: unknown };
    let older = false;
    for (const it of j.items ?? []) {
      const id = it.contentDetails?.videoId;
      const at = typeof it.contentDetails?.videoPublishedAt === "string" ? Date.parse(it.contentDetails.videoPublishedAt) : NaN;
      if (typeof id !== "string") continue;
      // A scheduled or private upload has no publish time yet: it is not measured.
      if (!Number.isFinite(at)) continue;
      if (at < sinceMs) older = true;
      else ids.push(id);
    }
    pageToken = typeof j.nextPageToken === "string" ? j.nextPageToken : undefined;
    if (older || !pageToken) break;
  }
  return ids;
}

/** Title, publish time, length, lifetime views and the uploaded file's name (1 quota unit per 50 videos). */
export async function videoDetails(fetcher: Fetcher, token: string, ids: readonly string[]): Promise<ApiVideo[]> {
  const out: ApiVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const id = ids.slice(i, i + 50).join(",");
    const url = (part: string) => `${DATA_API}/videos?${new URLSearchParams({ part, id, maxResults: "50" }).toString()}`;
    let r = await get(fetcher, token, url("snippet,contentDetails,statistics,fileDetails"));
    // fileDetails is the owner's only; a refusal of it never costs the reading (the file name only links productions).
    if (r.status === 400 || r.status === 403) r = await get(fetcher, token, url("snippet,contentDetails,statistics"));
    out.push(...parseVideos(await readOrThrow(r, "YOUTUBE_VIDEOS")));
  }
  return out;
}

/** One YouTube Analytics v2 report for the token's own channel. */
export async function analyticsReport(fetcher: Fetcher, token: string, q: { readonly metrics: string; readonly startDate: string; readonly endDate: string; readonly filters: string; readonly dimensions?: string; readonly sort?: string }): Promise<ReportRow[]> {
  const params = new URLSearchParams({ ids: "channel==MINE", startDate: q.startDate, endDate: q.endDate, metrics: q.metrics, filters: q.filters, ...(q.dimensions ? { dimensions: q.dimensions } : {}), ...(q.sort ? { sort: q.sort } : {}) });
  return reportRows(await readOrThrow(await get(fetcher, token, `${ANALYTICS_API}?${params.toString()}`), "YOUTUBE_ANALYTICS"));
}

/** One moment of one video: the basic numbers, the retention curve (one video per call) and the traffic sources. */
export async function readMoment(fetcher: Fetcher, token: string, video: ApiVideo, moment: { readonly startDate: string; readonly endDate: string }): Promise<{ basic?: ReportRow; retention: ReportRow[]; traffic: ReportRow[] }> {
  const base = { startDate: moment.startDate, endDate: moment.endDate, filters: `video==${video.videoId}` };
  const basic = (await analyticsReport(fetcher, token, { ...base, metrics: BASIC_METRICS.join(",") }))[0];
  const retention = await analyticsReport(fetcher, token, { ...base, metrics: "audienceWatchRatio,relativeRetentionPerformance", dimensions: "elapsedVideoTimeRatio" });
  const traffic = await analyticsReport(fetcher, token, { ...base, metrics: "views", dimensions: "insightTrafficSourceType", sort: "-views" });
  return { ...(basic ? { basic } : {}), retention, traffic };
}

export interface PullResult {
  readonly kayitlar: readonly VideoPerformanceRecord[];
  /** Turkish lines for the CLI and the cycle's summary. */
  readonly satirlar: readonly string[];
  /** Lessons written into the brains' memory. */
  readonly ders: number;
}

/**
 * Reads every due moment (dueMoments) of the channel's recent videos — or of `videoId` alone, whatever its age — saves
 * each as a record, then judges and teaches from each video's newest reading. Throws on a dead token or a missing
 * scope (the caller tells the owner); a video that fails is reported and the others go on.
 */
export async function pullChannelAnalytics(d: {
  readonly workRoot: string;
  readonly goals: ChannelGoals;
  readonly settings: YoutubeSettings;
  readonly fetcher: Fetcher;
  readonly now?: Date;
  readonly videoId?: string;
  readonly log?: (line: string) => void;
}): Promise<PullResult> {
  const now = d.now ?? new Date();
  const token = await loadToken(d.settings);
  if (!token) throw new Error(`YOUTUBE_NOT_CONNECTED: YouTube bağlı değil — \`npx tsx scripts/v3/youtube.ts baglan\``);
  if (!hasAnalyticsScope(token.scope)) throw new AnalyticsScopeError(`YOUTUBE_ANALYTICS_SCOPE: ${SCOPE_NOTICE}`);
  const { accessToken } = await refreshAccessToken(d.fetcher, await loadClient(d.settings), token);
  const channel = await myChannel(d.fetcher, accessToken);
  if (!channel.uploadsPlaylist) throw new Error("YOUTUBE_UPLOADS: kanalın yüklemeler listesi okunamadı");
  const ids = d.videoId ? [d.videoId] : await uploadsSince(d.fetcher, accessToken, channel.uploadsPlaylist, now.getTime() - RECENT_DAYS * 86_400_000);
  const videos = (await videoDetails(d.fetcher, accessToken, ids)).filter((v) => d.videoId || isRecent(v.publishedAt, now));
  const existing = await listPerformance(d.workRoot);
  const moments = [...new Set([...d.goals.olcumAnlari])];
  const orders = videos.length ? await ordersWithPackages(d.workRoot) : [];
  const kayitlar: VideoPerformanceRecord[] = [];
  const satirlar: string[] = [];
  let ders = 0;
  for (const video of videos) {
    const measured = new Set(existing.filter((r) => r.videoId === video.videoId && r.kaynak === "youtube-analytics-api").map((r) => r.olcumAni));
    const due = dueMoments(video.publishedAt, moments, measured, now);
    if (!due.length) continue;
    const order = linkOrder(video, orders);
    const fresh: VideoPerformanceRecord[] = [];
    try {
      for (const m of due) {
        const read = await readMoment(d.fetcher, accessToken, video, m);
        const record = analyticsRecord({ video, moment: m, ...(read.basic ? { basic: read.basic } : {}), retention: read.retention, traffic: read.traffic, ...(order ? { siparisId: order.id } : {}) });
        await savePerformance(d.workRoot, record);
        fresh.push(record);
        d.log?.(`  ${video.videoId} ${m.olcumAni} (${m.startDate} … ${m.endDate}) okundu`);
      }
    } catch (e) {
      if (e instanceof AnalyticsScopeError || isReconnectError(e)) throw e;
      satirlar.push(`${video.videoId} "${video.title.slice(0, 50)}": okunamadı (${(e as Error).message.slice(0, 120)})`);
    }
    kayitlar.push(...fresh);
    // The brains learn from the newest moment read now (the later moment, as latestPerVideo ranks them).
    const newest = fresh.at(-1);
    if (!newest) continue;
    const all = await listPerformance(d.workRoot);
    const judged = await judgeAndTeach({ workRoot: d.workRoot, goals: d.goals, record: newest, others: all.filter((r) => r.videoId !== newest.videoId), kismi: true });
    const found = await teachRetention(d.workRoot, newest, order ? await loadTimeline(order.cikti) : undefined);
    const taught = judged.lessons.length + found.filter((l) => l.metin).length;
    ders += taught;
    const ratio = judged.evaluation.kontroller.find((c) => c.metrik === "ortIzlenmeOrani");
    satirlar.push(
      `${video.videoId} "${video.title.slice(0, 50)}" ${fresh.map((r) => r.olcumAni).join("+")}: ${newest.metrikler.goruntuleme ?? "?"} görüntüleme, ort. ${newest.metrikler.ortIzlemeSn ?? "?"} sn${ratio?.deger !== undefined ? ` (videonun %${Math.round(ratio.deger * 100)}'i)` : ""}${order ? `, yapım ${order.id}` : ", yapımla eşleşmedi"}${found.length ? `; ${found.map((l) => l.tr).join("; ")}` : ""}; ${taught} ders`,
    );
  }
  if (!satirlar.length) satirlar.push(videos.length ? "okunacak yeni ölçüm anı yok" : `son ${RECENT_DAYS} günde yayınlanmış video yok`);
  return { kayitlar, satirlar, ders };
}

/* ------------------------------------------------------------- the daily pass --- */

interface PullState {
  sonDeneme?: string;
  sonCekim?: string;
  sonUyari?: string;
}

const stateFile = (workRoot: string) => path.join(workRoot, "_kutuphane", "kanal", "youtube-cekim.json");

async function readState(workRoot: string): Promise<PullState> {
  try {
    return existsSync(stateFile(workRoot)) ? (JSON.parse(await fs.readFile(stateFile(workRoot), "utf8")) as PullState) : {};
  } catch {
    return {};
  }
}

async function writeState(workRoot: string, s: PullState): Promise<void> {
  const file = stateFile(workRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(s, null, 2)}\n`);
  await fs.rename(`${file}.tmp`, file);
}

/**
 * Tells the owner in AYAS (the brains' talk on the console, addressed to AYAS, and AYAS's inbox), at most once in
 * NOTICE_EVERY_H hours whatever runs the pull. Returns whether it spoke.
 */
async function noticeOwner(workRoot: string, state: PullState, text: string, now: Date): Promise<boolean> {
  if (state.sonUyari && now.getTime() - Date.parse(state.sonUyari) < NOTICE_EVERY_H * 3_600_000) return false;
  await say(workRoot, text, "AYAS", now);
  const inbox = path.join(workRoot, "_kutuphane", "ayas-gelen-kutusu.jsonl");
  await fs.mkdir(path.dirname(inbox), { recursive: true });
  await fs.appendFile(inbox, `${JSON.stringify({ tarih: now.toISOString(), kaynak: "atolye-v3-youtube", ozet: text })}\n`);
  state.sonUyari = now.toISOString();
  return true;
}

export type TickState = "token-yok" | "erken" | "tamam" | "baglanti-doldu" | "izin-eksik" | "hata";

/**
 * The daily pass, safe to call every cycle: nothing without a token file (silently), nothing within PULL_EVERY_H of
 * the last try (unless `force`), and it never throws — a dead connection or a missing scope becomes one owner message
 * a day, any other failure a line in the cycle's summary.
 */
export async function youtubeAnalyticsTick(d: {
  readonly workRoot: string;
  readonly goals: ChannelGoals | undefined;
  readonly settings: YoutubeSettings;
  readonly fetcher: Fetcher;
  readonly now?: Date;
  readonly force?: boolean;
  readonly videoId?: string;
  readonly log?: (line: string) => void;
}): Promise<{ readonly durum: TickState; readonly satir: string; readonly sonuc?: PullResult }> {
  const now = d.now ?? new Date();
  if (!existsSync(path.join(d.settings.dir, "token.json"))) return { durum: "token-yok", satir: "YouTube bağlı değil" };
  if (!d.goals) return { durum: "hata", satir: "kanal hedefleri dosyası yok" };
  try {
    const state = await readState(d.workRoot);
    if (!d.force && state.sonDeneme && now.getTime() - Date.parse(state.sonDeneme) < PULL_EVERY_H * 3_600_000) return { durum: "erken", satir: `YouTube analitiği bugün okundu (${state.sonDeneme.slice(0, 16)})` };
    state.sonDeneme = now.toISOString();
    await writeState(d.workRoot, state);
    try {
      const sonuc = await pullChannelAnalytics({ workRoot: d.workRoot, goals: d.goals, settings: d.settings, fetcher: d.fetcher, now, ...(d.videoId ? { videoId: d.videoId } : {}), ...(d.log ? { log: d.log } : {}) });
      state.sonCekim = now.toISOString();
      await writeState(d.workRoot, state);
      return { durum: "tamam", satir: `YouTube analitiği: ${sonuc.kayitlar.length} yeni ölçüm, ${sonuc.ders} ders — ${sonuc.satirlar.join(" · ")}`, sonuc };
    } catch (e) {
      const dead = isReconnectError(e);
      const scope = e instanceof AnalyticsScopeError;
      if (!dead && !scope) return { durum: "hata", satir: `YouTube analitiği okunamadı: ${(e as Error).message.slice(0, 200)}` };
      const told = await noticeOwner(d.workRoot, state, dead ? RECONNECT_NOTICE : SCOPE_NOTICE, now);
      await writeState(d.workRoot, state);
      return { durum: dead ? "baglanti-doldu" : "izin-eksik", satir: `${dead ? RECONNECT_NOTICE : SCOPE_NOTICE}${told ? " (owner'a bildirildi)" : ""}` };
    }
  } catch (e) {
    return { durum: "hata", satir: `YouTube analitiği: ${(e as Error).message.slice(0, 200)}` };
  }
}
