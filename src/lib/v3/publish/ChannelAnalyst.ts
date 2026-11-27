import type { DevProposal } from "../council/SelfImprovement";
import { AFTER_HOOK_HOLD_OK, AFTER_HOOK_S, type EpisodeTimeline, feedCurve, holdAfterHook, HOOK_S, placeAt, retentionDrops, type SceneKind, TIMELINE_TOLERANCE_S, TRAFFIC_KEYS, viewSplit } from "./ChannelAnalyticsMap";
import { AD_SHARE_SPLIT, latestPerVideo, recordViewRatio, type RetentionPoint, type VideoPerformanceRecord, videoKind } from "./ChannelGoals";

/**
 * The channel analyst (owner, 27 Nov 2026: "eksikleri yap hallet videolarımız daha iyi olsun neredeyse hiç takip
 * gelmiyor kanalımıza"): the daily YouTube Analytics reader teaches the brains video by video, but nothing looked ACROSS
 * the videos and nothing reached the owner as a proposal. This reads the latest record of every video (and, when the
 * caller has them, the productions' timelines) and finds what repeats: subscriber conversion, paid vs organic views,
 * the hook, drops at the same seconds in several Shorts, length vs retention, likes/comments/shares. Each finding
 * carries its numbers and the videos it rests on, and a proposal in Turkish for the owner; the weekly step
 * (ChannelAnalystRun) files the code ones in the Gelişim Merkezi as "AYAS ÖNERİYOR · Kanal analisti".
 *
 * Pure: no network, no model, no files. Nothing is estimated: a number the records lack is "ölçülmedi", and a finding
 * is made only when it rests on at least MIN_VIDEOS videos (the one exception: a clear zero, no subscriber at all from
 * at least ZERO_SUBS_MIN_VIEWS views).
 */

/** A pattern is a pattern only when this many videos show it. */
export const MIN_VIDEOS = 2;
/** No subscriber from this many views is a finding even on one video. */
export const ZERO_SUBS_MIN_VIEWS = 1_000;
/**
 * The channel's working floor for subscribers per 1,000 views (not YouTube's figure): below it the ending is proposed
 * to change. The first 11 videos gave 1 subscriber from about 13,000 views.
 */
export const SUBS_PER_1000_FLOOR = 1;
/** The channel's working floor for comments per 1,000 views (the same 11 videos: 3 comments). */
export const COMMENTS_PER_1000_FLOOR = 1;
/** Drops whose middles lie within this many seconds of the first one's are read as one window. */
export const DROP_BAND_S = 4;
/** Where the length comparison reads the curve: this share of the video (the same moment of each story). */
export const LENGTH_SHARE = 0.15;
/** A Short this long or shorter is "short" in the length comparison. */
export const SHORT_BUCKET_S = 60;
/** The two length groups must differ at least this much (retention at LENGTH_SHARE) to propose a length. */
export const LENGTH_GAP_MIN = 0.1;
/** A Short's organic feed views below this (median) is a thin feed, a finding even when it does not fall. */
export const FEED_THIN_VIEWS = 1_000;
/** The paid share from which the ads are a finding for the owner. */
export const AD_FINDING_SHARE = 0.5;
/** What a proposal's `kaynaklar` carries first: its finding's stable key (one proposal per finding, ever). */
export const ANALYST_KEY_PREFIX = "kanal-analisti:";
/** The Gelişim Merkezi label ("AYAS ÖNERİYOR · Kanal analisti"). */
export const ANALYST_SOURCE = "Kanal analisti";

export type FindingTopic = "abone" | "reklam" | "akis" | "kanca" | "dusus" | "sure" | "etkilesim";
export type FindingBrain = "kurgu" | "mizah" | "kalite" | "sef";

export interface AnalystFinding {
  /** Stable across weeks: the same finding updates its proposal instead of making a second one. */
  readonly key: string;
  readonly konu: FindingTopic;
  /** Turkish title (the proposal's title). */
  readonly baslik: string;
  /** Turkish: what was measured, with its numbers. */
  readonly bulgu: string;
  /** The evidence numbers (null = ölçülmedi). */
  readonly kanit: Readonly<Record<string, number | string | null>>;
  /** The videos it rests on. */
  readonly videolar: readonly string[];
  /** Turkish: what to change in production, for the owner. */
  readonly oneri: string;
  /**
   * kod: a change the studio's developer can build (filed in the Gelişim Merkezi); sahip: the owner's own decision
   * (the ads, the channel), told in the report and AYAS's inbox only — an approved proposal goes to the developer's
   * queue, which cannot change the owner's promotion.
   */
  readonly hedef: "kod" | "sahip";
  readonly beyin: FindingBrain;
  /** The developer's task (English), for a `kod` finding. */
  readonly gorev?: string;
}

export interface ChannelAnalysis {
  readonly videolar: number;
  readonly bulgular: readonly AnalystFinding[];
  /** What the records cannot tell (Turkish lines). */
  readonly olculmedi: readonly string[];
  /** Video id → title, for the report. */
  readonly basliklar: Readonly<Record<string, string>>;
}

const median = (xs: readonly number[]): number | undefined => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r2 = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "ölçülmedi" : `%${Math.round(x * 100)}`);
const per1000 = (n: number, views: number) => (views > 0 ? r2((n / views) * 1000) : null);
const fmt = (x: number | null | undefined) => (x === null || x === undefined ? "ölçülmedi" : String(x).replace(".", ","));
const isShort = (r: VideoPerformanceRecord) => videoKind(r.sureSn) === "short";
const paid = (r: VideoPerformanceRecord) => !!r.organik && r.organik.reklamPayi >= AD_SHARE_SPLIT;
const range = (xs: readonly number[], f: (x: number) => string) => (xs.length ? `${f(Math.min(...xs))}–${f(Math.max(...xs))}` : "ölçülmedi");

/** The curve's value at the first point at or after `share` of the video (YouTube's audienceWatchRatio). */
export function retentionAt(curve: readonly RetentionPoint[], share: number): number | undefined {
  return curve.find((p) => p.oran >= share - 1e-9)?.izlenme;
}

/** The timeline when it fits the upload's length (as retentionLessons asks). */
const fitting = (r: VideoPerformanceRecord, timelines?: ReadonlyMap<string, EpisodeTimeline>) => {
  const t = timelines?.get(r.videoId);
  return t && Math.abs(t.sureSn - r.sureSn) <= TIMELINE_TOLERANCE_S ? t : undefined;
};

function subscriberFinding(latest: readonly VideoPerformanceRecord[]): AnalystFinding | undefined {
  const rows = latest.filter((r) => r.metrikler.aboneKazanimi !== null && (r.metrikler.goruntuleme ?? 0) > 0);
  const subs = rows.reduce((a, r) => a + r.metrikler.aboneKazanimi!, 0);
  const views = rows.reduce((a, r) => a + r.metrikler.goruntuleme!, 0);
  const clearZero = subs === 0 && views >= ZERO_SUBS_MIN_VIEWS;
  if (rows.length < MIN_VIDEOS && !clearZero) return undefined;
  const rate = per1000(subs, views)!;
  if (rate >= SUBS_PER_1000_FLOOR) return undefined;
  const group = (xs: readonly VideoPerformanceRecord[]) => ({ n: xs.length, subs: xs.reduce((a, r) => a + r.metrikler.aboneKazanimi!, 0), views: xs.reduce((a, r) => a + r.metrikler.goruntuleme!, 0) });
  const ad = group(rows.filter(paid)), own = group(rows.filter((r) => !paid(r)));
  // Organic views of the paid videos too: the subscribers cannot be split by source, so this is the best case for organic.
  const organicViews = own.views + rows.filter(paid).reduce((a, r) => a + (viewSplit(r)?.organik ?? 0), 0);
  const kanit = {
    abone: subs, goruntuleme: views, abone1000: rate,
    reklamliVideo: ad.n, reklamliAbone: ad.subs, reklamliGoruntuleme: ad.views, reklamliAbone1000: per1000(ad.subs, ad.views),
    reklamsizVideo: own.n, reklamsizAbone: own.subs, reklamsizGoruntuleme: own.views, reklamsizAbone1000: per1000(own.subs, own.views),
    organikGoruntuleme: organicViews,
  };
  const split = ad.n && own.n
    ? ` Reklamlı ${ad.n} video: ${ad.views} görüntülemede ${ad.subs} abone (1000'de ${fmt(kanit.reklamliAbone1000)}); reklamsız ${own.n} video: ${own.views} görüntülemede ${own.subs} abone (1000'de ${fmt(kanit.reklamsizAbone1000)}).`
    : "";
  return {
    key: "abone", konu: "abone", beyin: "kurgu", hedef: "kod",
    baslik: "Short'lar izleyiciyi aboneye çevirmiyor: bitişe abone çağrısı",
    bulgu: `${rows.length} videoda ${views} görüntüleme, ${subs} yeni abone (1000 görüntülemede ${fmt(rate)}; kanalın alt sınırı ${SUBS_PER_1000_FLOOR}).${split} Abonenin hangi kaynaktan geldiğini API vermiyor (ölçülmedi).`,
    kanit, videolar: rows.map((r) => r.videoId),
    oneri: "Her Short'un son 3–4 saniyesinde anlatıcı ya da karakter tek cümleyle sıradaki hikâyeyi vaat edip takip etmeyi istesin (örn. \"Takip et: yarın Hannibal'ın fillerini Alpler'den geçiriyoruz\"); son karede kanalın adı ve abone düğmesine bakan bir hareket olsun.",
    gorev: `Channel data: ${rows.length} videos, ${views} views, ${subs} new subscriber${subs === 1 ? "" : "s"} (${rate} per 1,000 views). Make every Short end on a one-sentence follow invitation that promises the next story (e.g. "Follow — tomorrow Hannibal takes elephants over the Alps"), said in the last 3–4 seconds by the narrator or a character, after the payoff and the closing question if there is one; the last frame shows the channel name. First check what the writer brief (ScriptPrompts, the Short beat map in content/v3/kanal-hedefleri.json) and the closing already do and extend that; add a smoke scenario that proves the ending line is asked for and kept.`,
  };
}

function adFinding(latest: readonly VideoPerformanceRecord[]): AnalystFinding | undefined {
  const rows = latest.flatMap((r) => ((s) => (s ? [{ r, s }] : []))(viewSplit(r)));
  if (rows.length < MIN_VIDEOS) return undefined;
  const total = rows.reduce((a, x) => a + x.s.toplam, 0);
  const ads = rows.reduce((a, x) => a + x.s.reklam, 0);
  const share = total ? ads / total : 0;
  const adVideos = rows.filter((x) => x.s.reklam > 0);
  if (share < AD_FINDING_SHARE || adVideos.length < MIN_VIDEOS) return undefined;
  // The paid viewers' own average view, from the total and the organic one (only where both were read).
  const watched = adVideos.flatMap(({ r }) => {
    const o = r.organik, all = r.metrikler.goruntuleme, avg = r.metrikler.ortIzlemeSn;
    if (!o || o.ortIzlemeSn === null || all === null || avg === null || !(all - o.goruntuleme > 0)) return [];
    return [{ organik: o.ortIzlemeSn / r.sureSn, reklam: Math.max(0, (all * avg - o.goruntuleme * o.ortIzlemeSn) / (all - o.goruntuleme)) / r.sureSn }];
  });
  const kanit = {
    reklamPayi: r3(share), reklamGoruntuleme: ads, toplamGoruntuleme: total, organikGoruntuleme: total - ads,
    reklamliVideo: adVideos.length, organikIzlenmeOrani: watched.length ? r3(median(watched.map((w) => w.organik))!) : null,
    reklamIzlenmeOrani: watched.length ? r3(median(watched.map((w) => w.reklam))!) : null,
  };
  return {
    key: "reklam", konu: "reklam", beyin: "sef", hedef: "sahip",
    baslik: "Görüntülemelerin çoğu reklamdan: reklam kanalı büyütmüyor",
    bulgu: `${rows.length} videoda ${total} görüntüleme var, ${ads} tanesi (${pct(share)}) reklamdan; ${adVideos.length} videoda reklam var. ${watched.length ? `Reklamlı videolarda ortanca izlenen pay: organik izleyicide ${pct(kanit.organikIzlenmeOrani)}, reklam izleyicisinde ${pct(kanit.reklamIzlenmeOrani)} (${watched.length} video).` : "Reklam izleyicisinin ayrı izlenme süresi ölçülmedi."}`,
    kanit, videolar: adVideos.map((x) => x.r.videoId),
    oneri: "Reklamı Short başına küçük bir bütçeyle yalnız organik akışta tutunan Short'lara (ilk 48 saatte akıştan izlenmesi en yüksek olanlara) ver; reklam görüntülemesi neredeyse hiç abone getirmiyor ve reklam izleyicisi videoyu organik izleyiciden kısa izliyor. Sonuçları reklam payını ayırarak oku (kanal.ts rapor).",
  };
}

function feedFinding(latest: readonly VideoPerformanceRecord[]): AnalystFinding | undefined {
  const rows = latest
    .filter(isShort)
    .flatMap((r) => ((s) => (s && r.yayinZamani ? [{ r, s }] : []))(viewSplit(r)))
    .sort((a, b) => a.r.yayinZamani!.localeCompare(b.r.yayinZamani!));
  if (rows.length < MIN_VIDEOS) return undefined;
  const half = Math.floor(rows.length / 2);
  const early = median(rows.slice(0, half).map((x) => x.s.akis))!, late = median(rows.slice(rows.length - half).map((x) => x.s.akis))!;
  const organic = rows.reduce((a, x) => a + x.s.organik, 0);
  const search = rows.reduce((a, x) => a + Math.round(x.s.toplam * (x.r.trafik?.[TRAFFIC_KEYS.YT_SEARCH!] ?? 0)), 0);
  const feed = rows.reduce((a, x) => a + x.s.akis, 0);
  // Only a falling or a thin feed is a finding: the feed's own reach is what grows a channel of Shorts.
  if (!(late < early) && median(rows.map((x) => x.s.akis))! >= FEED_THIN_VIEWS) return undefined;
  const best = [...rows].sort((a, b) => b.s.akis - a.s.akis)[0]!;
  const kanit = { short: rows.length, akisIlkYariOrtanca: early, akisSonYariOrtanca: late, akisToplam: feed, organikToplam: organic, aramaToplam: search, enIyiAkis: best.s.akis, enIyiVideo: best.r.videoId };
  return {
    key: "akis", konu: "akis", beyin: "kurgu", hedef: "kod",
    baslik: "Organik Shorts akışı küçük ve düşüyor: başlık ve ilk kare akışta durdurmalı",
    bulgu: `${rows.length} Short yayın sırasıyla: Shorts akışından gelen görüntüleme ilk yarıda ortanca ${early}, son yarıda ${late} (toplam ${feed}; reklamsız görüntülemenin tamamı ${organic}, aramadan ${search}). En çok akış görüntülemesi: ${best.r.videoId} (${best.s.akis}).`,
    kanit, videolar: rows.map((x) => x.r.videoId),
    oneri: `Akış Short'u ilk saniyelerde kalan izleyiciye göre dağıtır: önce kanca önerisi. Başlıkta ve ilk karede bilinen bir ad ve bir sayı öne alınsın (en iyi akış alan Short: ${best.r.baslik ?? best.r.videoId}); aramadan gelen ${search} görüntüleme başlıktaki adla geldi.`,
    gorev: `Channel data: organic Shorts-feed views per Short fell from a median of ${early} (earlier half) to ${late} (later half) over ${rows.length} Shorts; the best feed reach was "${(best.r.baslik ?? best.r.videoId).slice(0, 80)}" (${best.s.akis}). Make the YouTube package's Short title and the Short's first frame lead with the best-known name and one number of the story (the question title rule, QuestionTitle), and check that the title builder never opens on a date. First find what the title and first-frame rules already do; change only what is missing, with a smoke scenario.`,
  };
}

function hookFinding(shorts: readonly VideoPerformanceRecord[]): AnalystFinding | undefined {
  const rows = shorts.flatMap((r) => {
    const feed = feedCurve(r);
    const k = feed.curve.length ? retentionDrops(feed.curve, r.sureSn).kanca : undefined;
    return k ? [{ r, k, hold: holdAfterHook(feed.curve, r.sureSn), organik: feed.organik }] : [];
  });
  if (rows.length < MIN_VIDEOS) return undefined;
  const rated = rows.filter((x) => x.k.goreli !== undefined);
  const weakHook = rated.filter((x) => x.k.goreli! < 0.5);
  const held = rows.filter((x) => x.hold !== undefined);
  const weakHold = held.filter((x) => x.hold! < AFTER_HOOK_HOLD_OK);
  if (weakHook.length < MIN_VIDEOS && weakHold.length < MIN_VIDEOS) return undefined;
  const loss = median(rows.map((x) => x.k.kayip))!;
  const kanit = {
    short: rows.length, kancaKaybiOrtanca: r3(loss), kancaKaybiEnAz: r3(Math.min(...rows.map((x) => x.k.kayip))), kancaKaybiEnCok: r3(Math.max(...rows.map((x) => x.k.kayip))),
    goreliOlculen: rated.length, goreliAlti: weakHook.length, goreliOrtanca: rated.length ? r3(median(rated.map((x) => x.k.goreli!))!) : null,
    tutmaOlculen: held.length, tutmaZayif: weakHold.length, tutmaOrtanca: held.length ? r3(median(held.map((x) => x.hold!))!) : null,
  };
  return {
    key: "kanca", konu: "kanca", beyin: "kurgu", hedef: "kod",
    baslik: "İlk 3 saniye ve hemen sonrası izleyiciyi kaçırıyor",
    bulgu: `${rows.length} Short'ta ilk ~${HOOK_S} sn'deki kayıp: ortanca ${pct(loss)} (${range(rows.map((x) => x.k.kayip), pct)}). Göreli tutma (0,5 = benzer videoların ortancası) ${rated.length} Short'ta ölçüldü: ${weakHook.length}/${rated.length} Short 0,5'in altında${rated.length ? `, ortanca ${fmt(kanit.goreliOrtanca)}` : ""}. ${held.length ? `${HOOK_S}. sn'de kalanlardan ${AFTER_HOOK_S}. sn'ye ulaşan: ortanca ${pct(kanit.tutmaOrtanca)}; ${weakHold.length}/${held.length} Short kanalın ${pct(AFTER_HOOK_HOLD_OK)} çizgisinin altında.` : `${AFTER_HOOK_S}. sn tutması ölçülmedi.`} (Reklamlı videolarda organik izleyicinin eğrisi.)`,
    kanit, videolar: rows.map((x) => x.r.videoId),
    oneri: "Short ilk karede hareketle ve somut bir iddiayla açılsın (ad, sayı ya da ne kaybedileceği), kanca satırı en çok 8 kelime; kancadan sonraki satır tarih ya da yer okumasın, en çok 12 kelimeyle neyin tehlikede olduğunu söylesin. Açılış sahnesinde 1. saniyede kamera ya da karakter hareketi olsun.",
    gorev: `Channel data over ${rows.length} Shorts: a median ${Math.round(loss * 100)}% of the feed's viewers left in the first ~${HOOK_S} s; ${weakHook.length}/${rated.length} were below YouTube's relative median at the hook${held.length ? `, and only a median ${Math.round((kanit.tutmaOrtanca ?? 0) * 100)}% of those still there at ${HOOK_S} s were there at ${AFTER_HOOK_S} s (${weakHold.length}/${held.length} under the channel's ${Math.round(AFTER_HOOK_HOLD_OK * 100)}% line)` : ""}. Tighten the Short opening rules the writer and the QC already have (ChannelGoals.openingChecks, HookFollow, the beat map): something must move on screen within the first second, and the line after the hook must state the stakes in at most 12 words. Find which of these is not enforced yet (a fault that sends the episode to a retouch round, not a warning) and enforce it, with a smoke scenario.`,
  };
}

const KIND_BRAIN: Readonly<Record<SceneKind, FindingBrain>> = { komik: "mizah", harita: "kalite", diger: "kurgu" };

function dropFindings(shorts: readonly VideoPerformanceRecord[], timelines?: ReadonlyMap<string, EpisodeTimeline>): AnalystFinding[] {
  const drops = shorts.flatMap((r) => {
    const feed = feedCurve(r);
    if (!feed.curve.length) return [];
    const t = fitting(r, timelines);
    return retentionDrops(feed.curve, r.sureSn).dususler.map((d) => {
      const mid = (d.basSn + d.bitSn) / 2;
      const place = t ? placeAt(t, mid) : undefined;
      return { r, d, mid, placed: !!t, ...(place?.sahne ? { tur: place.sahne.tur, sahne: place.sahne.id } : {}), ...(place?.satir ? { satir: place.satir.metin } : {}) };
    });
  }).sort((a, b) => a.mid - b.mid);
  const bands: (typeof drops)[] = [];
  for (const x of drops) {
    const band = bands.at(-1);
    if (band && x.mid - band[0]!.mid <= DROP_BAND_S) band.push(x);
    else bands.push([x]);
  }
  return bands.flatMap((band) => {
    // One video counts once in a window (its larger drop).
    const byVideo = new Map<string, (typeof band)[number]>();
    for (const x of band) if (!byVideo.has(x.r.videoId) || byVideo.get(x.r.videoId)!.d.kayip < x.d.kayip) byVideo.set(x.r.videoId, x);
    const xs = [...byVideo.values()];
    if (xs.length < MIN_VIDEOS) return [];
    const from = Math.min(...xs.map((x) => x.d.basSn)), to = Math.max(...xs.map((x) => x.d.bitSn));
    const at = Math.round(median(xs.map((x) => x.mid))!);
    const win = `${fmt(from)}–${fmt(to)}`;
    const placed = xs.filter((x) => x.tur);
    const kinds = (["komik", "harita", "diger"] as const).map((k) => ({ k, n: placed.filter((x) => x.tur === k).length })).sort((a, b) => b.n - a.n);
    const kind = placed.length ? kinds[0]!.k : undefined;
    const lines = [...new Set(placed.flatMap((x) => (x.satir ? [x.satir.length > 70 ? `${x.satir.slice(0, 69)}…` : x.satir] : [])))].slice(0, 2);
    const loss = median(xs.map((x) => x.d.kayip))!;
    const what = kind === "komik" ? "espri sahnesi" : kind === "harita" ? "harita sahnesi" : kind === "diger" ? "hikâye sahnesi" : undefined;
    const screen = placed.length
      ? `Ekranda: ${kinds.filter((k) => k.n).map((k) => `${k.n} ${k.k === "komik" ? "espri" : k.k === "harita" ? "harita" : "hikâye"} sahnesi`).join(", ")}${lines.length ? `; söylenen: ${lines.map((l) => `"${l}"`).join(" · ")}` : ""}.`
      : "Ekranda ne olduğu ölçülmedi (yapımla eşleşen zaman çizelgesi yok).";
    const kanit = { short: xs.length, basSn: from, bitSn: to, kayipOrtanca: r3(loss), yerlesen: placed.length, espri: kinds.find((k) => k.k === "komik")!.n, harita: kinds.find((k) => k.k === "harita")!.n, hikaye: kinds.find((k) => k.k === "diger")!.n };
    const oneri = kind === "komik"
      ? `${win}. sn'deki espri izleyici kaybettiriyor: Short'ta espriyi kısalt ya da daha sona al; kurulum tek satır, vuruş hemen gelsin.`
      : kind === "harita"
        ? `${win}. sn'deki harita izleyici kaybettiriyor: harita ilk bakışta okunmalı ve anlatılırken üstünde bir şey hareket etmeli; Short'ta haritayı bu saniyelerden sonraya al.`
        : `${win}. sn'de birkaç Short aynı yerde izleyici kaybediyor: bu saniyelerde hikâyeyi ilerleten bir olay olsun (yavaş satır kesilsin, tarih/yer okuması karta insin).`;
    return [{
      key: `dusus-${at}s`, konu: "dusus" as const, beyin: kind ? KIND_BRAIN[kind] : "kurgu", hedef: "kod" as const,
      baslik: `${xs.length} Short aynı yerde izleyici kaybediyor: ${win}. sn`,
      bulgu: `${xs.length} Short'ta ${win}. sn arasında belirgin düşüş (ortanca kayıp ${pct(loss)}; ${xs.map((x) => `${x.r.videoId} ${fmt(x.d.basSn)}–${fmt(x.d.bitSn)} sn ${pct(x.d.kayip)}`).join(", ")}). ${screen}`,
      kanit, videolar: xs.map((x) => x.r.videoId),
      oneri,
      gorev: `Channel data: ${xs.length} Shorts lose a clear share of their feed viewers in the same window, ${from}–${to} s (median ${Math.round(loss * 100)}% of the opening audience)${what ? `; on screen there was mostly a ${what === "espri sahnesi" ? "joke scene" : what === "harita sahnesi" ? "map scene" : "story scene"}${lines.length ? `, while lines like ${lines.map((l) => `"${l}"`).join(" and ")} were said` : ""}` : "; what was on screen is not known (no production timeline matched)"}. Find what the Short beat map and the writer put in this window (content/v3/kanal-hedefleri.json shortsYapisi, ScriptPrompts' Short brief, the Director's Short cuts) and change the rule so this window always carries a visible event that moves the story${kind === "komik" ? " (a joke here gets one setup line and an immediate punchline, or moves later)" : kind === "harita" ? " (a map here must read at a glance with something moving on it, or move later)" : ""}. Smallest change in the existing modules, with a smoke scenario.`,
    }];
  });
}

function lengthFinding(shorts: readonly VideoPerformanceRecord[]): AnalystFinding | undefined {
  const rows = shorts.flatMap((r) => {
    const feed = feedCurve(r);
    const at = retentionAt(feed.curve, LENGTH_SHARE);
    return at === undefined ? [] : [{ r, at, ratio: recordViewRatio(r), seconds: (r.organik && r.organik.reklamPayi >= AD_SHARE_SPLIT ? r.organik.ortIzlemeSn : r.metrikler.ortIzlemeSn) ?? null }];
  });
  const short = rows.filter((x) => x.r.sureSn <= SHORT_BUCKET_S), long = rows.filter((x) => x.r.sureSn > SHORT_BUCKET_S);
  if (short.length < MIN_VIDEOS || long.length < MIN_VIDEOS) return undefined;
  const a = median(short.map((x) => x.at))!, b = median(long.map((x) => x.at))!;
  if (Math.abs(a - b) < LENGTH_GAP_MIN) return undefined;
  const ratios = (xs: typeof rows) => xs.flatMap((x) => (x.ratio === null ? [] : [x.ratio]));
  const secs = (xs: typeof rows) => xs.flatMap((x) => (x.seconds === null ? [] : [x.seconds]));
  const kanit = {
    kisaShort: short.length, uzunShort: long.length, kisaTutma15: r3(a), uzunTutma15: r3(b),
    kisaIzlenmeOrani: ratios(short).length ? r3(median(ratios(short))!) : null, uzunIzlenmeOrani: ratios(long).length ? r3(median(ratios(long))!) : null,
    kisaOrtSn: secs(short).length ? r2(median(secs(short))!) : null, uzunOrtSn: secs(long).length ? r2(median(secs(long))!) : null,
  };
  const shorter = a > b;
  return {
    key: "sure", konu: "sure", beyin: "kurgu", hedef: "kod",
    baslik: shorter ? `Kısa Short'lar (≤${SHORT_BUCKET_S} sn) izleyiciyi daha iyi tutuyor` : `Uzun Short'lar (>${SHORT_BUCKET_S} sn) izleyiciyi daha iyi tutuyor`,
    bulgu: `Videonun %${Math.round(LENGTH_SHARE * 100)}'inde kalan izleyici: ≤${SHORT_BUCKET_S} sn ${short.length} Short'ta ortanca ${fmt(r2(a))} (${range(short.map((x) => x.at), (v) => fmt(r2(v)))}), daha uzun ${long.length} Short'ta ${fmt(r2(b))} (${range(long.map((x) => x.at), (v) => fmt(r2(v)))}). Ortalama izlenme oranı ${pct(kanit.kisaIzlenmeOrani)} / ${pct(kanit.uzunIzlenmeOrani)}; ortalama izlenen saniye ${fmt(kanit.kisaOrtSn)} / ${fmt(kanit.uzunOrtSn)} sn. (Reklamlı videolarda organik izleyici.)`,
    kanit, videolar: rows.map((x) => x.r.videoId),
    oneri: shorter
      ? `Short hedef süresi ${SHORT_BUCKET_S} sn'ye insin; hikâye bir olay, bir dönüm noktası ve sonuçla sınırlansın.`
      : `Short'lar ${SHORT_BUCKET_S} sn'nin üstünde tutulsun; kısa Short'larda izleyici daha erken gidiyor.`,
    gorev: `Channel data: at ${Math.round(LENGTH_SHARE * 100)}% of the video, Shorts of at most ${SHORT_BUCKET_S} s kept a median ${r2(a)} of their feed viewers (${short.length} Shorts) and longer Shorts ${r2(b)} (${long.length}). ${shorter ? `Bring the default Short target length down to about ${SHORT_BUCKET_S} s` : `Keep the default Short target length above ${SHORT_BUCKET_S} s`} where the studio sets it (find the default target length of a Short order and the beat map's reference length; the owner's own length on an order always wins). Smallest change, with a smoke scenario.`,
  };
}

function engagementFinding(latest: readonly VideoPerformanceRecord[]): AnalystFinding | undefined {
  const rows = latest.filter((r) => (r.metrikler.goruntuleme ?? 0) > 0 && r.metrikler.begeni !== null);
  if (rows.length < MIN_VIDEOS) return undefined;
  const sum = (k: "begeni" | "yorum" | "paylasim", xs = rows) => xs.reduce((a, r) => a + (r.metrikler[k] ?? 0), 0);
  const measured = (k: "yorum" | "paylasim") => rows.filter((r) => r.metrikler[k] !== null);
  const views = rows.reduce((a, r) => a + r.metrikler.goruntuleme!, 0);
  const comments = measured("yorum"), shares = measured("paylasim");
  const commentViews = comments.reduce((a, r) => a + r.metrikler.goruntuleme!, 0);
  const commentRate = comments.length >= MIN_VIDEOS ? per1000(sum("yorum", comments), commentViews) : null;
  if (commentRate === null || commentRate >= COMMENTS_PER_1000_FLOOR) return undefined;
  const shareViews = shares.reduce((a, r) => a + r.metrikler.goruntuleme!, 0);
  const likeRates = rows.map((r) => per1000(r.metrikler.begeni!, r.metrikler.goruntuleme!)!);
  const ad = rows.filter(paid), own = rows.filter((r) => !paid(r));
  const viewsOf = (xs: readonly VideoPerformanceRecord[]) => xs.reduce((a, r) => a + r.metrikler.goruntuleme!, 0);
  const kanit = {
    video: rows.length, goruntuleme: views, begeni: sum("begeni"), begeni1000: per1000(sum("begeni"), views), yorum: sum("yorum", comments), yorum1000: commentRate,
    paylasim: shares.length >= MIN_VIDEOS ? sum("paylasim", shares) : null, paylasim1000: shares.length >= MIN_VIDEOS ? per1000(sum("paylasim", shares), shareViews) : null,
    reklamliBegeni1000: ad.length ? per1000(sum("begeni", ad), viewsOf(ad)) : null, reklamsizBegeni1000: own.length ? per1000(sum("begeni", own), viewsOf(own)) : null,
  };
  return {
    key: "etkilesim", konu: "etkilesim", beyin: "kurgu", hedef: "kod",
    baslik: "İzleyici yorum yazmıyor, paylaşmıyor: sona tek bir soru",
    bulgu: `${rows.length} videoda ${views} görüntülemeye ${kanit.begeni} beğeni (1000'de ${fmt(kanit.begeni1000)}; video başına ${range(likeRates, fmt)}), ${kanit.yorum} yorum (1000'de ${fmt(commentRate)}), ${kanit.paylasim ?? "ölçülmedi"} paylaşım (1000'de ${fmt(kanit.paylasim1000)}).${ad.length && own.length ? ` Beğeni 1000'de: reklamlı videolarda ${fmt(kanit.reklamliBegeni1000)}, reklamsızlarda ${fmt(kanit.reklamsizBegeni1000)}.` : ""}`,
    kanit, videolar: rows.map((r) => r.videoId),
    oneri: "Short'un son satırı izleyiciye cevabı tek kelime olan, taraf tutturan bir soru sorsun (\"Sen olsan fidyeyi öder miydin?\") ve bu soru açıklamanın ilk satırında ve sabit yorumda da yer alsın.",
    gorev: `Channel data: ${rows.length} videos, ${views} views, ${kanit.yorum} comments (${commentRate} per 1,000 views), ${kanit.paylasim ?? "unmeasured"} shares. Make the Short's last spoken line a question that takes a side and can be answered in one word ("Would you have paid the ransom?"), and put the same question as the first line of the YouTube package's description and as a suggested pinned comment. First check what the closing question rule already does (a Short now closes on a question) and the package builder; add only what is missing, with a smoke scenario.`,
  };
}

/**
 * Every cross-video finding of the channel, from the latest reading of each video (latestPerVideo). `timelines`
 * (video id → the production's timeline, ChannelLearning.loadTimeline) place the drops on what was on screen; a
 * timeline whose length does not fit the upload is not used.
 */
export function analyzeChannel(records: readonly VideoPerformanceRecord[], opts: { readonly timelines?: ReadonlyMap<string, EpisodeTimeline> } = {}): ChannelAnalysis {
  const latest = latestPerVideo(records).filter((r) => r.metrikler.goruntuleme !== null);
  const shorts = latest.filter(isShort);
  const seen = new Set<string>();
  const bulgular = [
    subscriberFinding(latest), adFinding(latest), feedFinding(latest), hookFinding(shorts), ...dropFindings(shorts, opts.timelines), lengthFinding(shorts), engagementFinding(latest),
  ].filter((f): f is AnalystFinding => !!f).map((f) => {
    // Two drop windows whose middles round to the same second keep two keys.
    let key = f.key;
    for (let i = 2; seen.has(key); i++) key = `${f.key}-${i}`;
    seen.add(key);
    return key === f.key ? f : { ...f, key };
  });
  const olculmedi = [
    ...(latest.some((r) => r.metrikler.izlemeyiSecenler !== null) ? [] : ["İzlemeyi seçenler / kaydıranlar: API vermiyor, Studio'dan elle okunmadı (ölçülmedi)."]),
    ...(latest.length ? ["Abonenin hangi trafik kaynağından geldiği: API videoya göre vermiyor (ölçülmedi)."] : []),
    ...(shorts.some((r) => fitting(r, opts.timelines)) ? [] : shorts.length ? ["Düşüş anlarında ekranda ne olduğu: hiçbir Short yapım zaman çizelgesiyle eşleşmedi (ölçülmedi)."] : []),
    ...(latest.some((r) => paid(r) && !r.tutmaOrganik?.length) ? [`Organik tutma eğrisi okunmamış reklamlı video(lar): ${latest.filter((r) => paid(r) && !r.tutmaOrganik?.length).map((r) => r.videoId).join(", ")} — tutma bulguları bunlarda karışık eğriyle.`] : []),
  ];
  const basliklar = Object.fromEntries(latest.map((r) => [r.videoId, (r.baslik ?? r.videoId).replace(/\s*#shorts\b/gi, "").trim()]));
  return { videolar: latest.length, bulgular, olculmedi, basliklar };
}

/* ----------------------------------------------------------- proposals --- */

/** The proposal the Gelişim Merkezi shows for a code finding ("AYAS ÖNERİYOR · Kanal analisti"; the owner decides). */
export function analystProposal(f: AnalystFinding, id: string, now: Date): DevProposal {
  return {
    id,
    tarih: now.toISOString(),
    beyin: f.beyin,
    baslik: f.baslik.slice(0, 200),
    neden: (f.gorev ?? f.oneri).slice(0, 1800),
    kaynaklar: [`${ANALYST_KEY_PREFIX}${f.key}`, ...f.videolar].slice(0, 10),
    sayi: 1,
    kaynakTuru: "olcum",
    kapsam: "v3",
    durum: "bekliyor",
    ayasOneriyor: {
      kaynak: ANALYST_SOURCE,
      yarar: `Öneri: ${f.oneri} Kanıt: ${f.bulgu}`.slice(0, 900),
      zarar: "Yalnız V3 stüdyosunun senaryo/kurgu kuralları değişir; yayınlanmış videolara ve kanala dokunulmaz. Geliştirici önce bunun zaten yapılıp yapılmadığına bakar, yapılmışsa hiçbir şey değiştirmez; testler geçmezse hiçbir şey uygulanmaz.",
      otomatikOnay: "kapalı",
    },
  };
}

export const findingKeyOf = (p: Pick<DevProposal, "kaynaklar">): string | undefined => p.kaynaklar.find((k) => k.startsWith(ANALYST_KEY_PREFIX))?.slice(ANALYST_KEY_PREFIX.length);

export interface ProposalPlan {
  /** New proposals to write. */
  readonly yeni: readonly DevProposal[];
  /** Waiting proposals whose evidence changed (same id, new numbers). */
  readonly guncel: readonly DevProposal[];
  /** Findings whose proposal is unchanged or already decided (never reopened). */
  readonly ayni: readonly { readonly key: string; readonly durum: DevProposal["durum"] }[];
  /** Owner-only findings: told in the report, not filed. */
  readonly sahip: readonly AnalystFinding[];
}

/**
 * Which proposals the findings make: one per finding key, ever. A waiting one gets the new evidence (its id, date and
 * the owner's view stay); a decided one (approved, rejected, built, merged) is left as it is — a rejection is final.
 */
export function planAnalystProposals(findings: readonly AnalystFinding[], existing: readonly DevProposal[], now: Date): ProposalPlan {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  const yeni: DevProposal[] = [], guncel: DevProposal[] = [], ayni: { key: string; durum: DevProposal["durum"] }[] = [], sahip: AnalystFinding[] = [];
  let n = existing.length;
  const used = new Set<string>();
  const dropAt = (key: string | undefined) => (key && /^dusus-\d+s(?:-\d+)?$/.test(key) ? Number(/^dusus-(\d+)s/.exec(key)![1]) : undefined);
  // Exact keys first, so a drifting drop window never takes another window's own proposal.
  const exact = new Map(findings.flatMap((f) => ((p) => (p ? [[f.key, p] as const] : []))(existing.find((p) => findingKeyOf(p) === f.key))));
  for (const p of exact.values()) used.add(p.id);
  for (const f of findings) {
    if (f.hedef === "sahip") {
      sahip.push(f);
      continue;
    }
    // A drop window whose middle moved a little since last week is the same window (within DROP_BAND_S).
    const at = dropAt(f.key);
    const near = at === undefined ? undefined : existing
      .filter((p) => !used.has(p.id) && dropAt(findingKeyOf(p)) !== undefined && Math.abs(dropAt(findingKeyOf(p))! - at) <= DROP_BAND_S)
      .sort((a, b) => Math.abs(dropAt(findingKeyOf(a))! - at) - Math.abs(dropAt(findingKeyOf(b))! - at))[0];
    const old = exact.get(f.key) ?? near;
    if (old) used.add(old.id);
    if (!old) {
      yeni.push(analystProposal(f, `${stamp}-kanal-${++n}`, now));
      continue;
    }
    const fresh = analystProposal(f, old.id, new Date(old.tarih));
    const same = old.neden === fresh.neden && old.ayasOneriyor?.yarar === fresh.ayasOneriyor?.yarar && old.baslik === fresh.baslik && old.kaynaklar.join() === fresh.kaynaklar.join();
    if (old.durum !== "bekliyor" || same) ayni.push({ key: f.key, durum: old.durum });
    else guncel.push({ ...old, baslik: fresh.baslik, neden: fresh.neden, kaynaklar: fresh.kaynaklar, beyin: fresh.beyin, ayasOneriyor: { ...fresh.ayasOneriyor!, otomatikOnay: old.ayasOneriyor?.otomatikOnay ?? "kapalı" } });
  }
  return { yeni, guncel, ayni, sahip };
}

/* -------------------------------------------------------------- report --- */

const TOPIC_TR: Readonly<Record<FindingTopic, string>> = { abone: "Abone", reklam: "Reklam", akis: "Organik akış", kanca: "Kanca", dusus: "Ortak düşüş", sure: "Süre", etkilesim: "Etkileşim" };

/** The owner's weekly report (Turkish markdown): every finding, its proposal, where it went, and what is not measured. */
export function analystReport(a: ChannelAnalysis, plan: ProposalPlan | undefined, now: Date): string {
  const where = (f: AnalystFinding) => {
    if (f.hedef === "sahip") return "senin kararın (geliştirme kuyruğuna yazılmaz)";
    if (!plan) return "Gelişim Merkezi'ne yazılacak (deneme: --yaz yok)";
    if (plan.yeni.some((p) => findingKeyOf(p) === f.key)) return "Gelişim Merkezi'ne yeni öneri (AYAS ÖNERİYOR · Kanal analisti)";
    if (plan.guncel.some((p) => findingKeyOf(p) === f.key)) return "Gelişim Merkezi'ndeki önerinin kanıtı güncellendi";
    const d = plan.ayni.find((x) => x.key === f.key);
    return d ? (d.durum === "bekliyor" ? "Gelişim Merkezi'nde bekliyor (değişmedi)" : `daha önce karar verildi: ${d.durum} (yeniden açılmaz)`) : "—";
  };
  const lines = [
    `# Kanal analisti — ${now.toISOString().slice(0, 10)}`,
    "",
    `${a.videolar} videonun son ölçümü okundu; ${a.bulgular.length} bulgu (her biri en az ${MIN_VIDEOS} videoya dayanır).`,
    "",
    ...a.bulgular.flatMap((f, i) => [
      `## ${i + 1}. ${TOPIC_TR[f.konu]}: ${f.baslik}`,
      "",
      `- Bulgu: ${f.bulgu}`,
      `- Öneri: ${f.oneri}`,
      `- Dayandığı videolar: ${f.videolar.map((v) => `${v} (${(a.basliklar[v] ?? v).slice(0, 50)})`).join(", ")}`,
      `- Nereye: ${where(f)}`,
      "",
    ]),
    ...(a.bulgular.length ? [] : ["Bu hafta yeni bulgu yok (ya da veriler en az iki videoya dayanmıyor).", ""]),
    ...(a.olculmedi.length ? ["## Ölçülmeyenler", "", ...a.olculmedi.map((l) => `- ${l}`), ""] : []),
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}
