import {
  type ChannelGoals, evaluatePerformance, latestPerVideo, momentHours, PERFORMANCE_METRICS, type PerformanceMetric, recordViewRatio,
  type RetentionPoint, type VideoPerformanceRecord, videoKind,
} from "./ChannelGoals";

/**
 * The YouTube Analytics reader's pure half (owner, 19 Nov 2026: "AYAS'ı ve sistemi YouTube hesabıma bağlamak
 * istiyorum; performansları incelesin, ona göre önlem alsın, kendini geliştirsin"): which measuring moments are due,
 * API rows → the same `VideoPerformanceRecord` the owner's Studio reading makes, where the audience retention curve
 * falls fastest and which scene and line of the production that is, and the channel's summary. No network, no model,
 * no files: the network half is `YoutubeAnalytics.ts`, the memory half `ChannelLearning.ts`.
 *
 * Nothing is estimated: a number the API does not give (Studio's "chose to view" / "swiped away" share, unique viewers,
 * impressions and their click rate) stays null and is reported as not measured.
 */

/** Analytics numbers settle a few days after the day they count: a moment is read this long after it has passed. */
export const ANALYTICS_LAG_H = 72;
/** Videos older than this are not read again (quota-light); a moment not yet read is still read. */
export const RECENT_DAYS = 60;
/** The opening judged as the hook ("first 3 seconds", the owner's Shorts standard). */
export const HOOK_S = 3;

const DAY_MS = 86_400_000;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface DueMoment {
  readonly olcumAni: string;
  /** The Analytics window, publish day … publish + moment (inclusive dates). */
  readonly startDate: string;
  readonly endDate: string;
}

/**
 * The moments of one video to read now: those whose time (plus ANALYTICS_LAG_H) has passed and that no API reading
 * holds yet. A free label (not "48s"/"7g"/"28g") is never read by the API.
 */
export function dueMoments(publishedAt: string, moments: readonly string[], measured: ReadonlySet<string>, now: Date): DueMoment[] {
  const pub = Date.parse(publishedAt);
  if (!Number.isFinite(pub)) return [];
  return moments.flatMap((olcumAni) => {
    const h = momentHours(olcumAni);
    if (h === undefined || measured.has(olcumAni) || now.getTime() < pub + (h + ANALYTICS_LAG_H) * 3_600_000) return [];
    return [{ olcumAni, startDate: isoDate(pub), endDate: isoDate(pub + h * 3_600_000) }];
  });
}

/** Whether a video is read at all on a daily pass: published in the last RECENT_DAYS days. */
export function isRecent(publishedAt: string, now: Date): boolean {
  const pub = Date.parse(publishedAt);
  return Number.isFinite(pub) && now.getTime() - pub <= RECENT_DAYS * DAY_MS;
}

/** YouTube's ISO 8601 length ("PT1M5S", "PT2H", "P0D") in seconds; undefined when unreadable. */
export function isoDurationS(iso: string | undefined): number | undefined {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso ?? "");
  if (!m) return undefined;
  const s = Number(m[1] ?? 0) * 86_400 + Number(m[2] ?? 0) * 3_600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
  return s > 0 ? s : undefined;
}

export type ReportRow = Readonly<Record<string, string | number | null>>;

/** An Analytics v2 report (`columnHeaders` + `rows`) as one object per row, keyed by the column names. */
export function reportRows(json: unknown): ReportRow[] {
  const j = json as { columnHeaders?: { name?: unknown }[]; rows?: unknown[][] };
  const names = (j?.columnHeaders ?? []).map((h) => (typeof h?.name === "string" ? h.name : ""));
  return (j?.rows ?? []).filter(Array.isArray).map((row) => Object.fromEntries(names.map((n, i) => [n, (typeof row[i] === "number" || typeof row[i] === "string" ? row[i] : null) as string | number | null])));
}

export interface ApiVideo {
  readonly videoId: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly durationS: number;
  /** The file the owner uploaded (`fileDetails.fileName`, the owner's token only): links the video to its production. */
  readonly fileName?: string;
  /** Lifetime views from the Data API (shown, never stored as a moment's number). */
  readonly viewCount?: number;
}

/** `videos.list` items → ApiVideo; an item without an id, a date or a readable length is left out. */
export function parseVideos(json: unknown): ApiVideo[] {
  const items = ((json as { items?: Record<string, unknown>[] })?.items ?? []);
  return items.flatMap((it) => {
    const sn = (it.snippet ?? {}) as Record<string, unknown>;
    const cd = (it.contentDetails ?? {}) as Record<string, unknown>;
    const st = (it.statistics ?? {}) as Record<string, unknown>;
    const fd = (it.fileDetails ?? {}) as Record<string, unknown>;
    const durationS = isoDurationS(typeof cd.duration === "string" ? cd.duration : undefined);
    if (typeof it.id !== "string" || typeof sn.publishedAt !== "string" || durationS === undefined) return [];
    const views = Number(st.viewCount);
    return [{
      videoId: it.id, title: typeof sn.title === "string" ? sn.title : "", publishedAt: sn.publishedAt, durationS,
      ...(typeof fd.fileName === "string" && fd.fileName ? { fileName: fd.fileName } : {}),
      ...(st.viewCount !== undefined && Number.isFinite(views) ? { viewCount: views } : {}),
    }];
  });
}

/** API traffic source types → the record's Turkish keys (the Studio template's four first); the rest add up in "diger". */
export const TRAFFIC_KEYS: Readonly<Record<string, string>> = {
  SHORTS: "shortsAkisi", YT_SEARCH: "youtubeArama", YT_CHANNEL: "kanalSayfasi", EXT_URL: "harici",
  SUBSCRIBER: "anaSayfaAbonelik", RELATED_VIDEO: "onerilenVideo", NO_LINK_OTHER: "dogrudan", PLAYLIST: "oynatmaListesi",
  NOTIFICATION: "bildirim", HASHTAGS: "etiketSayfasi", END_SCREEN: "bitisEkrani", YT_OTHER_PAGE: "digerYoutube",
  // Paid views (19 Nov 2026): five Shorts' "diger" 82–93 % was ADVERTISING — the owner's promotion, not the feed.
  ADVERTISING: "reklam", SHORTS_CONTENT_LINKS: "shortsBaglantisi", YT_PLAYLIST_PAGE: "oynatmaListesiSayfasi",
  CAMPAIGN_CARD: "kampanyaKarti", SOUND_PAGE: "sesSayfasi", VIDEO_REMIXES: "remiks",
};

/** The API's traffic type of paid views. */
export const AD_TRAFFIC = "ADVERTISING";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;

/**
 * Views and average view without the paid ones, from the traffic report (views and averageViewDuration per source).
 * Undefined when no view came from an ad (the video's own numbers are then its organic ones).
 */
export function organicViews(rows: readonly ReportRow[]): { readonly goruntuleme: number; readonly ortIzlemeSn: number | null; readonly reklamPayi: number } | undefined {
  let ads = 0, views = 0, seconds = 0, timed = 0;
  for (const r of rows) {
    const v = num(r.views);
    if (v === null || v <= 0) continue;
    if (r.insightTrafficSourceType === AD_TRAFFIC) {
      ads += v;
      continue;
    }
    views += v;
    const d = num(r.averageViewDuration);
    if (d !== null) {
      seconds += d * v;
      timed += v;
    }
  }
  if (!ads) return undefined;
  return { goruntuleme: views, ortIzlemeSn: timed ? Math.round((seconds / timed) * 10) / 10 : null, reklamPayi: r4(ads / (ads + views)) };
}

/**
 * A video's views split by who brought them (owner, 23 Nov 2026, "bütün planları uygula": "never compare a Short's views
 * without splitting the ads" — Cannae's 2,659 views were 2,369 paid and only 263 from the Shorts feed): the total, the
 * paid ones (ADVERTISING), the rest, and those of the rest that came from the Shorts feed — the organic reach a Short is
 * judged by. From the record's total and its traffic shares; undefined without either.
 */
export function viewSplit(record: Pick<VideoPerformanceRecord, "metrikler" | "trafik">): { readonly toplam: number; readonly reklam: number; readonly organik: number; readonly akis: number } | undefined {
  const total = record.metrikler.goruntuleme;
  if (total === null || !(total > 0) || !record.trafik) return undefined;
  const paid = Math.round(total * (record.trafik[TRAFFIC_KEYS[AD_TRAFFIC]!] ?? 0));
  const feed = Math.round(total * (record.trafik[TRAFFIC_KEYS.SHORTS!] ?? 0));
  return { toplam: total, reklam: paid, organik: total - paid, akis: feed };
}

/** The curve the feed's viewers drew: the organic one when it was read (a mostly paid video), else the whole one. */
export function feedCurve(record: Pick<VideoPerformanceRecord, "tutma" | "tutmaOrganik">): { readonly curve: readonly RetentionPoint[]; readonly organik: boolean } {
  return record.tutmaOrganik?.length ? { curve: record.tutmaOrganik, organik: true } : { curve: record.tutma ?? [], organik: false };
}

/** Views per traffic source as shares of the video's views (0..1); undefined when no view came at all. */
export function trafficShares(rows: readonly ReportRow[]): Record<string, number> | undefined {
  const by = new Map<string, number>();
  for (const r of rows) {
    const views = num(r.views);
    if (views === null || views <= 0 || typeof r.insightTrafficSourceType !== "string") continue;
    const key = TRAFFIC_KEYS[r.insightTrafficSourceType] ?? "diger";
    by.set(key, (by.get(key) ?? 0) + views);
  }
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  if (!total) return undefined;
  return Object.fromEntries([...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r4(v / total)]));
}

/** The retention report's rows → the curve, sorted by elapsed share; unreadable rows are dropped. */
export function retentionCurve(rows: readonly ReportRow[]): RetentionPoint[] {
  return rows
    .flatMap((r) => {
      const oran = num(r.elapsedVideoTimeRatio), izlenme = num(r.audienceWatchRatio), goreli = num(r.relativeRetentionPerformance);
      return oran === null || izlenme === null ? [] : [{ oran: r4(oran), izlenme: r4(izlenme), ...(goreli !== null ? { goreli: r4(goreli) } : {}) }];
    })
    .sort((a, b) => a.oran - b.oran);
}

/**
 * One moment's API reading as a performance record. The basic report's numbers map one to one; API-only gaps stay
 * null: `izlemeyiSecenler`/`kaydiranlar` (Studio's viewed vs swiped away) and `benzersizIzleyici` have no API metric.
 * `aktifIzlenme` is `engagedViews` (Studio's engaged views); `ortGoruntulenenYuzde` comes as a percent and is kept 0..1.
 */
export function analyticsRecord(input: {
  readonly video: ApiVideo;
  readonly moment: Pick<DueMoment, "olcumAni" | "endDate">;
  readonly basic?: ReportRow;
  readonly traffic?: readonly ReportRow[];
  readonly retention?: readonly ReportRow[];
  /** The organic viewers' curve, read only for a mostly paid video (YoutubeAnalytics.readMoment). */
  readonly organicRetention?: readonly ReportRow[];
  readonly siparisId?: string;
}): VideoPerformanceRecord {
  const b = input.basic ?? {};
  const minutes = num(b.estimatedMinutesWatched);
  const percent = num(b.averageViewPercentage);
  const fromApi: Partial<Record<PerformanceMetric, number | null>> = {
    goruntuleme: num(b.views),
    aktifIzlenme: num(b.engagedViews),
    ortIzlemeSn: num(b.averageViewDuration),
    ortGoruntulenenYuzde: percent === null ? null : r4(percent / 100),
    izlenmeSaat: minutes === null ? null : Math.round((minutes / 60) * 100) / 100,
    aboneKazanimi: num(b.subscribersGained),
    begeni: num(b.likes),
    yorum: num(b.comments),
    paylasim: num(b.shares),
  };
  const metrikler = Object.fromEntries(PERFORMANCE_METRICS.map((k) => [k, fromApi[k] ?? null])) as Record<PerformanceMetric, number | null>;
  const trafik = input.traffic ? trafficShares(input.traffic) : undefined;
  const tutma = input.retention ? retentionCurve(input.retention) : [];
  const tutmaOrganik = input.organicRetention ? retentionCurve(input.organicRetention) : [];
  const organik = input.traffic ? organicViews(input.traffic) : undefined;
  return {
    schemaVersion: 1,
    videoId: input.video.videoId,
    ...(input.video.title ? { baslik: input.video.title } : {}),
    sureSn: input.video.durationS,
    olcumTarihi: input.moment.endDate,
    olcumAni: input.moment.olcumAni,
    kaynak: "youtube-analytics-api",
    yayinZamani: input.video.publishedAt,
    ...(input.siparisId ? { siparisId: input.siparisId } : {}),
    metrikler,
    ...(trafik ? { trafik } : {}),
    ...(tutma.length ? { tutma } : {}),
    ...(tutmaOrganik.length ? { tutmaOrganik } : {}),
    ...(organik ? { organik } : {}),
    not: "YouTube Analytics API; izlemeyi seçenler/kaydıranlar ve benzersiz izleyici API'de yok (ölçülmedi).",
  };
}

/* ---------------------------------------------------- retention analysis --- */

export interface HookLoss {
  /** Seconds the hook point stands at (the first point at or after HOOK_S). */
  readonly sn: number;
  /** Share of the opening audience gone by then (0..1). */
  readonly kayip: number;
  /** YouTube's relative retention there (0.5 = the median of similar-length videos). */
  readonly goreli?: number;
}

export interface RetentionDrop {
  readonly basSn: number;
  readonly bitSn: number;
  /** Share of the opening audience lost in this window (0..1). */
  readonly kayip: number;
}

/** A later drop must lose at least this share of the opening audience to be named. */
export const MIN_DROP = 0.02;
/** …and at least this many times the curve's typical (median) loss over a window of the same length. */
export const DROP_OVER_MEDIAN = 2;
/** The last slice of a video, where everyone leaves anyway, is not read as a drop. */
const END_SHARE = 0.95;

/**
 * Where the curve falls fastest. The hook: the opening audience's loss by HOOK_S (only when the curve has a point
 * that early — a video longer than 300 s has its first point later and no hook reading). The drops: windows of about a
 * second after the hook and before the last 5 %, at most `n`, each a clear outlier (MIN_DROP and DROP_OVER_MEDIAN),
 * the largest first and never two in the same place.
 */
export function retentionDrops(curve: readonly RetentionPoint[], durationS: number, n = 2): { readonly kanca?: HookLoss; readonly dususler: readonly RetentionDrop[] } {
  if (curve.length < 3 || !(durationS > 0)) return { dususler: [] };
  const start = curve[0]!.izlenme;
  if (!(start > 0)) return { dususler: [] };
  const t = (p: RetentionPoint) => p.oran * durationS;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  let kanca: HookLoss | undefined;
  if (t(curve[0]!) < HOOK_S) {
    const at = curve.find((p) => t(p) >= HOOK_S);
    if (at) kanca = { sn: r1(t(at)), kayip: r3(Math.max(0, (start - at.izlenme) / start)), ...(at.goreli !== undefined ? { goreli: at.goreli } : {}) };
  }
  const step = durationS / curve.length;
  const k = Math.max(1, Math.ceil(1 / step));
  const windows: { i: number; d: number }[] = [];
  for (let i = k; i < curve.length; i++) {
    if (t(curve[i - k]!) < HOOK_S || curve[i]!.oran > END_SHARE) continue;
    windows.push({ i, d: (curve[i - k]!.izlenme - curve[i]!.izlenme) / start });
  }
  const falling = windows.map((w) => w.d).filter((d) => d > 0).sort((a, b) => a - b);
  const median = falling.length ? falling[Math.floor(falling.length / 2)]! : 0;
  const picked: { i: number; d: number }[] = [];
  for (const w of [...windows].sort((a, b) => b.d - a.d)) {
    if (picked.length >= n || w.d < MIN_DROP || w.d < DROP_OVER_MEDIAN * median) break;
    if (picked.some((p) => Math.abs(p.i - w.i) < 2 * k)) continue;
    picked.push(w);
  }
  return { ...(kanca ? { kanca } : {}), dususler: picked.map((w) => ({ basSn: r1(t(curve[w.i - k]!)), bitSn: r1(t(curve[w.i]!)), kayip: r3(w.d) })) };
}

/** Where the line after the hook is judged: the hook scene's narration has run its course by then in every Short so far. */
export const AFTER_HOOK_S = 12;
/**
 * A hold after the hook below this is weak: between the channel's two groups of 19 Nov 2026 (organic 0.44–0.57 on the
 * four 45–56 s Shorts, 0.68–0.78 on the four 108–164 s ones). The channel's own yardstick, not YouTube's.
 */
export const AFTER_HOOK_HOLD_OK = 0.65;

/**
 * The share of the audience still there at HOOK_S that is still there at AFTER_HOOK_S (19 Nov 2026). The organic curves
 * of the four 45–56 s Shorts kept their hook (relative 0.43–0.53 at 3 s), then lost 43–56 % of it by 12 s while the
 * narrator read a 14–18-word date-and-place line: the number the next Shorts are compared by. Undefined when the curve
 * has no point before HOOK_S or the video is not longer than AFTER_HOOK_S.
 */
export function holdAfterHook(curve: readonly RetentionPoint[], durationS: number): number | undefined {
  if (curve.length < 3 || !(durationS > AFTER_HOOK_S)) return undefined;
  const t = (p: RetentionPoint) => p.oran * durationS;
  if (t(curve[0]!) >= HOOK_S) return undefined;
  const last = (s: number) => [...curve].reverse().find((p) => t(p) <= s + 1e-9);
  const a = last(HOOK_S), b = last(AFTER_HOOK_S);
  if (!a || !b || !(a.izlenme > 0)) return undefined;
  return Math.round(Math.min(1, b.izlenme / a.izlenme) * 1000) / 1000;
}

/* ------------------------------------------------- production timeline --- */

/** What a scene is for the brains: a joke scene (mood "komik") → mizah, a map scene → kalite, else the story → kurgu. */
export type SceneKind = "komik" | "harita" | "diger";

export interface EpisodeTimeline {
  readonly sureSn: number;
  readonly sahneler: readonly { readonly id: string; readonly basSn: number; readonly bitSn: number; readonly tur: SceneKind }[];
  readonly satirlar: readonly { readonly basSn: number; readonly bitSn: number; readonly konusan?: string; readonly metin: string }[];
}

/**
 * The production's own timeline from its render plan (`plan.json`: shots with scene ids and frames, captions with
 * words) and its episode (scene moods, maps). Undefined when the plan cannot be read.
 */
export function episodeTimeline(planJson: unknown, episodeJson: unknown): EpisodeTimeline | undefined {
  const plan = ((planJson as { plan?: unknown })?.plan ?? planJson) as {
    fps?: number; durationInFrames?: number;
    shots?: { sceneId?: string; id?: string; start?: number; duration?: number }[];
    captions?: { start?: number; end?: number; speaker?: string; words?: { text?: string }[] }[];
  };
  const fps = plan?.fps;
  if (!fps || !(fps > 0) || !Array.isArray(plan.shots) || !(Number(plan.durationInFrames) > 0)) return undefined;
  const scenes = ((episodeJson as { sahneler?: { id?: string; duygu?: string; harita?: unknown }[] })?.sahneler ?? []);
  const kindOf = (id: string): SceneKind => {
    const s = scenes.find((x) => x.id === id);
    return s?.duygu === "komik" ? "komik" : s?.harita ? "harita" : "diger";
  };
  const sec = (f: number) => Math.round((f / fps) * 10) / 10;
  const sahneler: { id: string; basSn: number; bitSn: number; tur: SceneKind }[] = [];
  for (const sh of plan.shots) {
    const id = sh.sceneId ?? sh.id;
    if (!id || typeof sh.start !== "number" || typeof sh.duration !== "number") continue;
    const last = sahneler.at(-1);
    // A scene cut into several shots is one scene.
    if (last && last.id === id) last.bitSn = sec(sh.start + sh.duration);
    else sahneler.push({ id, basSn: sec(sh.start), bitSn: sec(sh.start + sh.duration), tur: kindOf(id) });
  }
  const satirlar = (plan.captions ?? []).flatMap((c) => {
    const metin = (c.words ?? []).map((w) => w.text ?? "").join(" ").replace(/\s+/g, " ").trim();
    return typeof c.start === "number" && typeof c.end === "number" && metin ? [{ basSn: sec(c.start), bitSn: sec(c.end), ...(c.speaker ? { konusan: c.speaker } : {}), metin }] : [];
  });
  return { sureSn: sec(Number(plan.durationInFrames)), sahneler, satirlar };
}

/** The timeline fits the uploaded video only when their lengths agree within this many seconds. */
export const TIMELINE_TOLERANCE_S = 2;

/** The scene and the line on screen at second `s` (the line said last before it, when none is being said). */
export function placeAt(timeline: EpisodeTimeline, s: number): { readonly sahne?: EpisodeTimeline["sahneler"][number]; readonly satir?: EpisodeTimeline["satirlar"][number] } {
  const sahne = timeline.sahneler.find((x) => s >= x.basSn && s < x.bitSn) ?? (s >= (timeline.sahneler.at(-1)?.bitSn ?? Infinity) ? timeline.sahneler.at(-1) : undefined);
  const satir = timeline.satirlar.find((x) => s >= x.basSn && s <= x.bitSn) ?? [...timeline.satirlar].reverse().find((x) => x.basSn <= s);
  return { ...(sahne ? { sahne } : {}), ...(satir ? { satir } : {}) };
}

export type RetentionBrain = "kurgu" | "mizah" | "kalite";

/**
 * What a retention curve teaches (English, each under the memory's 300 characters): the hook to the writer (kurgu);
 * each named drop to the brain of the scene it falls in — a joke scene to mizah, a map scene to kalite, any other to
 * kurgu — with the line being said. A drop is taught only when the video is linked to its production and the plan's
 * length matches the upload (TIMELINE_TOLERANCE_S); otherwise it is reported by time only. A mostly paid video is read
 * on its organic viewers' curve (feedCurve): an ad viewer's leaving says nothing about the feed (19 Nov 2026).
 */
export function retentionLessons(record: VideoPerformanceRecord, timeline?: EpisodeTimeline): { readonly beyin: RetentionBrain; readonly metin?: string; readonly tr: string }[] {
  const feed = feedCurve(record);
  if (!feed.curve.length) return [];
  const { kanca, dususler } = retentionDrops(feed.curve, record.sureSn);
  const hold = holdAfterHook(feed.curve, record.sureSn);
  const who = feed.organik ? "organic viewers" : "viewers";
  const trWho = feed.organik ? "organik izleyicinin" : "izleyicinin";
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const kind = videoKind(record.sureSn) === "short" ? "Short" : "video";
  const title = (record.baslik ?? record.videoId).replace(/\s*#shorts\b/gi, "").slice(0, 60);
  const fits = timeline && Math.abs(timeline.sureSn - record.sureSn) <= TIMELINE_TOLERANCE_S ? timeline : undefined;
  const quote = (s?: string) => (s ? `"${s.length > 70 ? `${s.slice(0, 69)}…` : s}"` : "");
  // `metin` is the lesson; a drop not placed in the production has only its Turkish report line (`tr`).
  const out: { beyin: RetentionBrain; metin?: string; tr: string }[] = [];
  if (kanca) {
    const verdict = kanca.goreli === undefined ? "" : kanca.goreli < 0.5 ? ` — worse than similar videos (relative ${kanca.goreli.toFixed(2)})` : ` — as good as or better than similar videos (relative ${kanca.goreli.toFixed(2)})`;
    const open = fits?.satirlar.find((l) => l.basSn < HOOK_S);
    // The line said after the hook (the first one starting at or after the hook line ends).
    const follow = open ? fits?.satirlar.find((l) => l.basSn >= open.bitSn && l.basSn < AFTER_HOOK_S) : undefined;
    const weakHook = !(kanca.goreli !== undefined && kanca.goreli >= 0.5);
    const weakHold = hold !== undefined && hold < AFTER_HOOK_HOLD_OK;
    const advice = weakHold
      ? `${weakHook ? "Open on a stranger line by a character in mid-action, then s" : "The hook held; then s"}ay the stakes in at most 12 words, never a date or place line.`
      : weakHook ? "Open on a stranger, more concrete line said by a character in mid-action, with something moving at once." : "Keep this kind of opening.";
    out.push({
      beyin: "kurgu",
      // A weak hold teaches the line after the hook (quoted instead of the opening line: the lesson stays under 300 characters).
      metin: `${kind} "${title}": ${pct(kanca.kayip)} of ${who} left in the first ${kanca.sn} s${verdict}.${open && !weakHold ? ` Opening line: ${quote(open.metin)}.` : ""}${hold !== undefined ? ` ${pct(hold)} of them were still there at ${AFTER_HOOK_S} s${follow && weakHold ? `, after ${quote(follow.metin)}` : ""}.` : ""} ${advice}`,
      tr: `ilk ${kanca.sn} sn'de ${trWho} %${Math.round(kanca.kayip * 100)}'i gitti${kanca.goreli !== undefined ? ` (göreli ${kanca.goreli.toFixed(2)}; 0,5 = benzer videoların ortancası)` : ""}${hold !== undefined ? `; ${HOOK_S}. sn'dekilerin %${Math.round(hold * 100)}'i ${AFTER_HOOK_S}. sn'de hâlâ izliyordu` : ""}`,
    });
  }
  for (const d of dususler) {
    const where = `${d.basSn}–${d.bitSn} s`;
    const place = fits ? placeAt(fits, (d.basSn + d.bitSn) / 2) : undefined;
    const tr = `${d.basSn}–${d.bitSn} sn'de ${trWho} %${Math.round(d.kayip * 100)}'i gitti${place?.sahne ? ` (sahne ${place.sahne.id}${place.satir ? `, "${place.satir.metin.slice(0, 50)}"` : ""})` : fits ? "" : " (yapımla eşleşmedi: yalnız zaman)"}`;
    if (!place?.sahne) {
      out.push({ beyin: "kurgu", tr });
      continue;
    }
    const line = place.satir ? ` while ${quote(place.satir.metin)} is said` : "";
    const head = `${kind} "${title}": the steepest drop was at ${where} (${pct(d.kayip)} of ${who})`;
    const s = place.sahne;
    const lesson = s.tur === "komik"
      ? { beyin: "mizah" as const, metin: `${head}, in the joke scene ${s.id}${line}. This joke lost viewers: give it a clearer setup and a quicker, sharper punchline, or cut it shorter.` }
      : s.tur === "harita"
        ? { beyin: "kalite" as const, metin: `${head}, in the map scene ${s.id}${line}. Viewers left here: the map must read at a glance and something on it must move while it is told.` }
        : { beyin: "kurgu" as const, metin: `${head}, in scene ${s.id}${line}. Tighten this beat: cut or move the slow line so the story keeps moving.` };
    out.push({ ...lesson, tr });
  }
  return out.map((l) => (l.metin && l.metin.length > 300 ? { ...l, metin: `${l.metin.slice(0, 299)}…` } : l));
}

/* ------------------------------------------------------- channel summary --- */

export interface ChannelSummary {
  readonly olculen: number;
  readonly api: number;
  readonly sonuclar: Readonly<Record<string, number>>;
  /** Best and worst measured video by view ratio (average view / length), with its goal verdict. */
  readonly enIyi?: { readonly videoId: string; readonly baslik?: string; readonly oran: number; readonly sonuc: string };
  readonly enKotu?: { readonly videoId: string; readonly baslik?: string; readonly oran: number; readonly sonuc: string };
  /** Traffic sources over all videos, weighted by each video's views (0..1, largest first). */
  readonly trafik: readonly { readonly kaynak: string; readonly pay: number }[];
}

/** The channel at a glance for `kanal.ts rapor`: the latest reading of every video, judged as `kaydet` judges. */
export function channelSummary(records: readonly VideoPerformanceRecord[], goals: ChannelGoals): ChannelSummary {
  const latest = latestPerVideo(records);
  const sonuclar: Record<string, number> = {};
  const rated: { r: VideoPerformanceRecord; oran: number; sonuc: string }[] = [];
  for (const r of latest) {
    const e = evaluatePerformance(r, goals);
    sonuclar[e.sonuc] = (sonuclar[e.sonuc] ?? 0) + 1;
    const oran = recordViewRatio(r);
    if (oran !== null) rated.push({ r, oran, sonuc: e.sonuc });
  }
  rated.sort((a, b) => b.oran - a.oran);
  const pick = (x?: (typeof rated)[number]) => (x ? { videoId: x.r.videoId, ...(x.r.baslik ? { baslik: x.r.baslik } : {}), oran: r4(x.oran), sonuc: x.sonuc } : undefined);
  const by = new Map<string, number>();
  let total = 0;
  for (const r of latest) {
    const views = r.metrikler.goruntuleme;
    if (!r.trafik || views === null || !(views > 0)) continue;
    total += views;
    for (const [k, v] of Object.entries(r.trafik)) by.set(k, (by.get(k) ?? 0) + v * views);
  }
  const trafik = total ? [...by.entries()].map(([kaynak, v]) => ({ kaynak, pay: r4(v / total) })).sort((a, b) => b.pay - a.pay) : [];
  const best = pick(rated[0]);
  const worst = rated.length > 1 ? pick(rated.at(-1)) : undefined;
  return { olculen: latest.length, api: latest.filter((r) => r.kaynak === "youtube-analytics-api").length, sonuclar, ...(best ? { enIyi: best } : {}), ...(worst ? { enKotu: worst } : {}), trafik };
}
