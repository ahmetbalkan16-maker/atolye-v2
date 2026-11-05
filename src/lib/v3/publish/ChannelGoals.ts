import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isShorts } from "../render/Format";

/**
 * Crowns & Doodles' video goals (owner, 5 Nov 2026, from the channel's real YouTube Studio numbers): ONE source,
 * `content/v3/kanal-hedefleri.json`, read here — the writer's Short beat map, the pipeline's QC note, the
 * performance report and the pilot plan all take their numbers from it, never a copy.
 *
 * The goals are this channel's own experiment targets, not thresholds YouTube guarantees. A metric nobody measured is
 * OLCULMEDI, never a pass; a long video has no target until a long video has been measured (no invented numbers).
 * Watch time is judged as a share of the video's own length, so a 30 s and a 60 s Short are not held to one figure.
 * Pure apart from reading the JSON file.
 */

export type VideoKind = "short" | "uzun";
export interface Band { readonly min: number; readonly max: number; readonly baslangic?: number; readonly not?: string }
export interface ShortBeat { readonly id: string; readonly basSn: number; readonly bitSn: number; readonly tr: string; readonly en: string }
export interface PilotVideo { readonly no: number; readonly dizi: string; readonly tur: string; readonly konu: string; readonly donem: string; readonly saat: string; readonly dogruluk?: string }
export interface SeriesGoal { readonly id: string; readonly ad: string; readonly oncelik: number; readonly konular: string; readonly anlatim?: string }

export interface ChannelGoals {
  readonly schemaVersion: 1;
  readonly kanal: { readonly ad: string; readonly kanalId: string; readonly adres: string; readonly dil: string };
  readonly baslangic: {
    readonly kaynak: string;
    readonly kanal: Readonly<Record<string, unknown>>;
    readonly video: { readonly videoId: string; readonly baslik: string; readonly tur: VideoKind; readonly sureSn: number; readonly ortIzlemeSn: number; readonly izlemeyiSecenler: number } & Readonly<Record<string, unknown>>;
  };
  readonly hedefler: {
    readonly short: { readonly durum: string; readonly izlemeyiSecenler: Band; readonly ortIzlenmeOrani: Band; readonly izlenmeye?: readonly string[] };
    readonly uzun: { readonly durum: "HEDEF_TANIMLANMADI" | string; readonly not?: string; readonly izlemeyiSecenler?: Band; readonly ortIzlenmeOrani?: Band };
  };
  readonly diziler: readonly SeriesGoal[];
  readonly shortsYapisi: {
    readonly referansSureSn: number;
    readonly bolumler: readonly ShortBeat[];
    readonly ilkUcSaniye: { readonly kancaSn: number; readonly ilkSatirEnFazlaKelime: number; readonly gorselOlayIlkSn: number; readonly kartYok: boolean };
  };
  readonly olcumAnlari: readonly string[];
  readonly pilot: { readonly ad: string; readonly saatDilimi: string; readonly hedefSureSn: number; readonly videolar: readonly PilotVideo[] };
}

export const CHANNEL_GOALS_FILE = "kanal-hedefleri.json";

function fail(why: string): never {
  throw new Error(`CHANNEL_GOALS_INVALID: ${why}`);
}

const isBand = (b: unknown): b is Band => typeof b === "object" && b !== null && typeof (b as Band).min === "number" && typeof (b as Band).max === "number" && (b as Band).min >= 0 && (b as Band).max >= (b as Band).min;

/** Checks the fields the code relies on; anything else in the file is the owner's notes. */
export function parseChannelGoals(raw: unknown): ChannelGoals {
  const g = raw as ChannelGoals;
  if (!g || g.schemaVersion !== 1) fail("schemaVersion 1 bekleniyor");
  if (!g.kanal?.ad || !g.kanal.dil) fail("kanal adı ve dili yok");
  if (!isBand(g.hedefler?.short?.izlemeyiSecenler) || !isBand(g.hedefler.short.ortIzlenmeOrani)) fail("Short hedef bantları (min ≤ max) yok");
  if (g.hedefler.short.izlemeyiSecenler.max > 1 || g.hedefler.short.ortIzlenmeOrani.max > 3) fail("oranlar 0..1 (izlenme oranı Short'ta döngüyle 1'i aşabilir, en çok 3)");
  if (!g.hedefler.uzun?.durum) fail("uzun video hedef durumu yok");
  const beats = g.shortsYapisi?.bolumler;
  if (!Array.isArray(beats) || beats.length < 3) fail("Short bölümleri yok");
  beats.forEach((b, i) => {
    if (!(b.bitSn > b.basSn) || (i > 0 && b.basSn !== beats[i - 1]!.bitSn) || (i === 0 && b.basSn !== 0)) fail(`Short bölümü ${b.id ?? i}: süreler ardışık değil`);
  });
  if (beats.at(-1)!.bitSn !== g.shortsYapisi.referansSureSn) fail("son bölüm referans sürede bitmiyor");
  if (!g.shortsYapisi.ilkUcSaniye) fail("ilk 3 saniye kuralları yok");
  if (!Array.isArray(g.diziler) || !g.diziler.length) fail("dizi yok");
  const series = new Set(g.diziler.map((d) => d.id));
  for (const v of g.pilot?.videolar ?? []) {
    if (!series.has(v.dizi)) fail(`pilot ${v.no}: bilinmeyen dizi ${v.dizi}`);
    if (!/^\d{2}:\d{2}$/.test(v.saat)) fail(`pilot ${v.no}: saat SS:DD olmalı`);
  }
  return g;
}

export function channelGoalsPath(contentRoot: string): string {
  return path.join(contentRoot, CHANNEL_GOALS_FILE);
}

/** The goals, or undefined when the file does not exist (a checkout without them); a broken file throws. */
export function loadChannelGoals(contentRoot: string): ChannelGoals | undefined {
  const file = channelGoalsPath(contentRoot);
  if (!existsSync(file)) return undefined;
  return parseChannelGoals(JSON.parse(readFileSync(file, "utf8")));
}

export const videoKind = (durationS: number): VideoKind => (isShorts(durationS) ? "short" : "uzun");

/** Average view duration as a share of the video's length (a Short can pass 1 on loops). */
export function viewRatio(averageViewS: number, durationS: number): number {
  if (!(durationS > 0) || !(averageViewS >= 0)) throw new Error("CHANNEL_GOALS_RATIO_INVALID: süre > 0 ve izleme ≥ 0 olmalı");
  return averageViewS / durationS;
}

/** The average-view target in seconds for a video of `durationS` (Short goals only; undefined for a long video). */
export function viewTargetSeconds(goals: ChannelGoals, durationS: number): { readonly min: number; readonly max: number } | undefined {
  if (videoKind(durationS) !== "short") return goals.hedefler.uzun.ortIzlenmeOrani ? scale(goals.hedefler.uzun.ortIzlenmeOrani, durationS) : undefined;
  return scale(goals.hedefler.short.ortIzlenmeOrani, durationS);
}

const scale = (band: Band, durationS: number) => ({ min: Math.round(band.min * durationS * 10) / 10, max: Math.round(band.max * durationS * 10) / 10 });

/**
 * The Short's beat map for a target length: the hook stays 0–HOOK s (a hook does not get longer with the video), the
 * other beats keep their share of the reference length.
 */
export function shortBeats(goals: ChannelGoals, targetS: number): ShortBeat[] {
  const { bolumler, referansSureSn } = goals.shortsYapisi;
  const hook = bolumler[0]!.bitSn;
  const at = (s: number) => (s <= hook ? s : Math.round(hook + ((s - hook) / (referansSureSn - hook)) * (targetS - hook)));
  return bolumler.map((b) => ({ ...b, basSn: at(b.basSn), bitSn: at(b.bitSn) }));
}

/** One writer-prompt bullet: the beat map in seconds for this Short (flexible, never at the cost of the story). */
export function shortBeatRule(goals: ChannelGoals, targetS: number, lang: "tr" | "en"): string {
  const beats = shortBeats(goals, targetS).map((b) => `${b.basSn}–${b.bitSn} s ${lang === "tr" ? b.tr : b.en}`).join("; ");
  return lang === "tr"
    ? `- ZAMAN HARİTASI (yaklaşık, hikâyenin akışı önce gelir): ${beats}.\n`
    : `- BEAT MAP (approximate; the story's own flow comes first): ${beats}.\n`;
}

/* ------------------------------------------------------- production QC --- */

export interface QcCheck { readonly ok: boolean; readonly text: string }

/**
 * The first three seconds of a Short, beyond the hook row the pipeline already has (a character within HOOK_S): the
 * first spoken line is a character's and short, something moves on screen early, and no full-screen card opens it.
 * Each is measured from the plan and the timeline; nothing here is a guess about viewers.
 */
export function openingChecks(goals: ChannelGoals, input: {
  readonly firstLine?: { readonly text: string; readonly byCharacter: boolean; readonly startS: number };
  readonly firstVisualEventS?: number;
  readonly firstSceneCards: readonly string[];
}): QcCheck[] {
  const rules = goals.shortsYapisi.ilkUcSaniye;
  const words = input.firstLine ? input.firstLine.text.split(/\s+/).filter((w) => /\p{L}|\d/u.test(w)).length : 0;
  const fullScreen = input.firstSceneCards.filter((c) => c === "kelime" || c === "bolum");
  return [
    {
      ok: !!input.firstLine && input.firstLine.byCharacter && words > 0 && words <= rules.ilkSatirEnFazlaKelime && input.firstLine.startS <= rules.kancaSn,
      text: `İlk 3 sn — ilk söz: ${input.firstLine ? `${input.firstLine.startS.toFixed(1)} sn'de ${input.firstLine.byCharacter ? "karakter" : "ANLATICI"}, ${words} kelime` : "konuşma yok"} (hedef: ${rules.kancaSn} sn içinde karakterin en çok ${rules.ilkSatirEnFazlaKelime} kelimelik repliği)`,
    },
    {
      ok: input.firstVisualEventS !== undefined && input.firstVisualEventS <= rules.gorselOlayIlkSn,
      text: `İlk 3 sn — ilk görsel olay ${input.firstVisualEventS === undefined ? "yok" : `${input.firstVisualEventS.toFixed(1)} sn'de`} (hedef ≤ ${rules.gorselOlayIlkSn} sn: hareket, jest ya da kamera)`,
    },
    { ok: !rules.kartYok || !fullScreen.length, text: `İlk 3 sn — tam ekran kart: ${fullScreen.length ? `VAR (${fullScreen.join(", ")})` : "yok"} (akışta kaydırtır)` },
  ];
}

/**
 * What the writer planned per scene of a Short (owner, 5 Nov 2026: visual, character move, camera, words, sound
 * effect, music and transition for every scene). Words, the set request and the music mood are required by the episode
 * schema; this counts the optional ones a scene left out. A map scene's moves are its armies, arrows and camera.
 */
export function scenePlanGaps(scenes: readonly {
  readonly id: string;
  readonly kamera?: readonly unknown[];
  readonly gecis?: unknown;
  readonly muzik_ruh_hali?: string;
  readonly harita?: { readonly kamera?: readonly unknown[]; readonly ordular?: readonly unknown[]; readonly oklar?: readonly unknown[] };
  readonly satirlar: readonly { readonly jest?: unknown; readonly hareket?: unknown; readonly sfx?: unknown; readonly efekt?: unknown; readonly oyun?: readonly unknown[] }[];
}[]): { readonly kamera: string[]; readonly efekt: string[]; readonly hareket: string[]; readonly gecis: string[]; readonly muzik: string[] } {
  const gaps = { kamera: [] as string[], efekt: [] as string[], hareket: [] as string[], gecis: [] as string[], muzik: [] as string[] };
  scenes.forEach((s, i) => {
    if (!s.kamera?.length && !s.harita?.kamera?.length) gaps.kamera.push(s.id);
    if (!s.satirlar.some((l) => l.sfx || l.efekt)) gaps.efekt.push(s.id);
    if (!s.satirlar.some((l) => l.jest || l.hareket || l.oyun?.length) && !s.harita?.ordular?.length && !s.harita?.oklar?.length) gaps.hareket.push(s.id);
    if (i > 0 && !s.gecis) gaps.gecis.push(s.id);
    if (!s.muzik_ruh_hali?.trim()) gaps.muzik.push(s.id);
  });
  return gaps;
}

export function scenePlanCheck(scenes: Parameters<typeof scenePlanGaps>[0]): QcCheck {
  const g = scenePlanGaps(scenes);
  const parts = ([["kamera", "kamera"], ["efekt", "efekt"], ["hareket", "karakter hareketi"], ["gecis", "geçiş"], ["muzik", "müzik"]] as const).filter(([k]) => g[k].length).map(([k, name]) => `${name}: ${g[k].join(", ")}`);
  return { ok: !parts.length, text: `Sahne planı (${scenes.length} sahne): ${parts.length ? `eksik — ${parts.join("; ")}` : "her sahnede kamera, efekt, hareket, müzik ve geçiş var"}` };
}

/** The QC.md section that states the channel goal this video will be measured against after publishing (never a pass now). */
export function channelGoalNote(goals: ChannelGoals, durationS: number): string {
  if (videoKind(durationS) !== "short") return `## Kanal hedefi\n\n- Uzun video: ${goals.hedefler.uzun.durum}${goals.hedefler.uzun.not ? ` — ${goals.hedefler.uzun.not}` : ""}\n`;
  const s = goals.hedefler.short;
  const t = viewTargetSeconds(goals, durationS)!;
  const p = (x: number) => `%${Math.round(x * 1000) / 10}`;
  return `## Kanal hedefi (yayından sonra ölçülür — şimdi geçti sayılmaz)\n\n- İzlemeyi seçenler: hedef ${p(s.izlemeyiSecenler.min)}–${p(s.izlemeyiSecenler.max)} (başlangıç ${p(goals.baslangic.video.izlemeyiSecenler)})\n- Ortalama izlenme: hedef ${t.min}–${t.max} sn / ${durationS.toFixed(0)} sn (videonun %${Math.round(s.ortIzlenmeOrani.min * 100)}–${Math.round(s.ortIzlenmeOrani.max * 100)}'i)\n- Ölçüm: yayından 48 saat ve 7 gün sonra Studio'dan \`npx tsx scripts/v3/kanal.ts kaydet --dosya <ölçüm.json>\`\n`;
}

/* ---------------------------------------------------------- performance --- */

/** The metrics the owner (or a future Analytics API reader) reports per video; null = not measured. */
export const PERFORMANCE_METRICS = [
  "goruntuleme", "aktifIzlenme", "izlemeyiSecenler", "kaydiranlar", "ortIzlemeSn", "ortGoruntulenenYuzde",
  "izlenmeSaat", "aboneKazanimi", "begeni", "yorum", "benzersizIzleyici",
] as const;
export type PerformanceMetric = (typeof PERFORMANCE_METRICS)[number];
/** Shares written as 0..1 (ortGoruntulenenYuzde too: 1 = 100 %, above 1 on loops). */
export const SHARE_METRICS: ReadonlySet<PerformanceMetric> = new Set(["izlemeyiSecenler", "kaydiranlar", "ortGoruntulenenYuzde"]);

export interface VideoPerformanceRecord {
  readonly schemaVersion: 1;
  readonly videoId: string;
  readonly baslik?: string;
  readonly sureSn: number;
  /** When the numbers were read and how long after publishing (48s = 48 hours, 7g = 7 days). */
  readonly olcumTarihi: string;
  readonly olcumAni: string;
  /** studio-elle: the owner read YouTube Studio; youtube-analytics-api: a future API reader. */
  readonly kaynak: "studio-elle" | "youtube-analytics-api";
  readonly yayinZamani?: string;
  readonly siparisId?: string;
  readonly pilotNo?: number;
  readonly dizi?: string;
  readonly metrikler: Readonly<Record<PerformanceMetric, number | null>>;
  readonly ulkeler?: readonly { readonly ulke: string; readonly pay?: number; readonly goruntuleme?: number; readonly ortIzlemeSn?: number }[];
  readonly trafik?: Readonly<Record<string, number>>;
  readonly not?: string;
}

export type GoalStatus = "OLCULMEDI" | "HEDEF_YOK" | "HEDEF_ALTI" | "HEDEFTE" | "HEDEF_USTU";
export interface GoalCheck { readonly metrik: "izlemeyiSecenler" | "ortIzlenmeOrani"; readonly durum: GoalStatus; readonly deger?: number; readonly hedef?: Band; readonly baslangicFarki?: number }
export interface PerformanceEvaluation {
  readonly videoId: string;
  readonly tur: VideoKind;
  readonly kontroller: readonly GoalCheck[];
  /** VERI_EKSIK when a goal metric was not measured: a missing number is never read as reached. */
  readonly sonuc: "VERI_EKSIK" | "HEDEF_YOK" | "HEDEF_ALTI" | "HEDEFTE" | "HEDEF_USTU";
  readonly eksikMetrikler: readonly PerformanceMetric[];
}

function check(metrik: GoalCheck["metrik"], value: number | null | undefined, band: Band | undefined): GoalCheck {
  if (value === null || value === undefined || !Number.isFinite(value)) return { metrik, durum: "OLCULMEDI", ...(band ? { hedef: band } : {}) };
  if (!band) return { metrik, durum: "HEDEF_YOK", deger: value };
  const durum: GoalStatus = value < band.min ? "HEDEF_ALTI" : value > band.max ? "HEDEF_USTU" : "HEDEFTE";
  return { metrik, durum, deger: value, hedef: band, ...(band.baslangic !== undefined ? { baslangicFarki: Math.round((value - band.baslangic) * 1000) / 1000 } : {}) };
}

/** The view ratio of a record: its own average-viewed share if Studio gave it, else average view seconds / length. */
export function recordViewRatio(record: VideoPerformanceRecord): number | null {
  const m = record.metrikler;
  if (m.ortGoruntulenenYuzde !== null && Number.isFinite(m.ortGoruntulenenYuzde)) return m.ortGoruntulenenYuzde;
  return m.ortIzlemeSn !== null && record.sureSn > 0 ? viewRatio(m.ortIzlemeSn, record.sureSn) : null;
}

export function evaluatePerformance(record: VideoPerformanceRecord, goals: ChannelGoals, targets?: { readonly izlemeyiSecenler: Band; readonly ortIzlenmeOrani: Band }): PerformanceEvaluation {
  const tur = videoKind(record.sureSn);
  const t = targets ?? (tur === "short" ? goals.hedefler.short : goals.hedefler.uzun);
  const kontroller = [check("izlemeyiSecenler", record.metrikler.izlemeyiSecenler, t.izlemeyiSecenler), check("ortIzlenmeOrani", recordViewRatio(record), t.ortIzlenmeOrani)];
  const eksikMetrikler = PERFORMANCE_METRICS.filter((k) => record.metrikler[k] === null || record.metrikler[k] === undefined);
  const states = kontroller.map((c) => c.durum);
  const sonuc = states.includes("OLCULMEDI") ? "VERI_EKSIK" : states.includes("HEDEF_YOK") ? "HEDEF_YOK" : states.includes("HEDEF_ALTI") ? "HEDEF_ALTI" : states.every((s) => s === "HEDEF_USTU") ? "HEDEF_USTU" : "HEDEFTE";
  return { videoId: record.videoId, tur, kontroller, sonuc, eksikMetrikler };
}

/**
 * The next Short's targets: the owner's band, raised (never lowered) once the channel does better. When the median of
 * the last three measured Shorts passes the band's top, the band moves up to start there, same width. One good video
 * does not move it; a bad one never lowers it.
 */
export function nextShortTargets(goals: ChannelGoals, records: readonly VideoPerformanceRecord[]): { readonly izlemeyiSecenler: Band; readonly ortIzlenmeOrani: Band; readonly neden: string } {
  const shorts = latestPerVideo(records).filter((r) => videoKind(r.sureSn) === "short").sort((a, b) => a.olcumTarihi.localeCompare(b.olcumTarihi)).slice(-3);
  const median = (xs: number[]) => (xs.length === 3 ? [...xs].sort((a, b) => a - b)[1]! : undefined);
  const raise = (band: Band, values: (number | null)[]): { band: Band; raised: boolean } => {
    const m = median(values.filter((v): v is number => v !== null));
    if (m === undefined || m <= band.max) return { band, raised: false };
    const width = band.max - band.min;
    return { band: { ...band, min: round3(m), max: round3(m + width), not: `son 3 Short'un ortancası ${round3(m)} — hedef yükseldi` }, raised: true };
  };
  const a = raise(goals.hedefler.short.izlemeyiSecenler, shorts.map((r) => r.metrikler.izlemeyiSecenler));
  const b = raise(goals.hedefler.short.ortIzlenmeOrani, shorts.map(recordViewRatio));
  const neden = a.raised || b.raised ? "son 3 ölçülen Short hedefin üstünde — hedef yükseltildi" : shorts.length < 3 ? `ölçülmüş Short sayısı ${shorts.length}/3 — owner'ın ilk deney hedefi geçerli` : "owner'ın deney hedefi geçerli";
  return { izlemeyiSecenler: a.band, ortIzlenmeOrani: b.band, neden };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** The 7-day reading beats the 48-hour one for the same video; otherwise the latest reading wins. */
export function latestPerVideo(records: readonly VideoPerformanceRecord[]): VideoPerformanceRecord[] {
  const rank = (r: VideoPerformanceRecord) => (r.olcumAni === "7g" ? 2 : r.olcumAni === "48s" ? 1 : 0);
  const best = new Map<string, VideoPerformanceRecord>();
  for (const r of records) {
    const prev = best.get(r.videoId);
    if (!prev || rank(r) > rank(prev) || (rank(r) === rank(prev) && r.olcumTarihi > prev.olcumTarihi)) best.set(r.videoId, r);
  }
  return [...best.values()];
}

/**
 * What a measured video teaches the brains (written to their memory as "ders" lessons, replacing the video's earlier
 * ones). Only measured numbers are named; the production's own facts (its opening check) come from the caller.
 */
export function performanceLessons(record: VideoPerformanceRecord, evaluation: PerformanceEvaluation, production?: { readonly konu?: string; readonly kanca?: string }): { readonly beyin: "kurgu" | "mizah"; readonly metin: string }[] {
  if (evaluation.sonuc === "VERI_EKSIK" || evaluation.sonuc === "HEDEF_YOK") return [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const viewed = evaluation.kontroller.find((c) => c.metrik === "izlemeyiSecenler")!;
  const ratio = evaluation.kontroller.find((c) => c.metrik === "ortIzlenmeOrani")!;
  const subject = `The Short "${record.baslik ?? production?.konu ?? record.videoId}" (${record.sureSn} s)`;
  const numbers = `${pct(viewed.deger!)} of the feed chose to view it (target ${pct(viewed.hedef!.min)}–${pct(viewed.hedef!.max)}) and the average view was ${pct(ratio.deger!)} of its length (target ${pct(ratio.hedef!.min)}–${pct(ratio.hedef!.max)})`;
  const opening = production?.kanca ? ` Its opening: ${production.kanca}.` : "";
  if (evaluation.sonuc === "HEDEF_ALTI") {
    const weak = viewed.durum === "HEDEF_ALTI" ? "the first 2 seconds did not stop the scroll: open on a stranger, more concrete line said by a character in mid-action" : "viewers left before the payoff: tighten the middle beats and show the threat paying off sooner";
    return [{ beyin: "kurgu", metin: `${subject}: ${numbers}.${opening} Below target — ${weak}.` }];
  }
  return [{ beyin: "kurgu", metin: `${subject}: ${numbers}.${opening} At or above target — keep this kind of opening and pacing.` }];
}

/**
 * The pilot's first tendencies (never a verdict from six videos): per publishing hour the mean "chose to view" share
 * after taking out its series' mean (so a strong topic does not make its hour look strong), and per series the mean.
 */
export function pilotTrends(goals: ChannelGoals, records: readonly VideoPerformanceRecord[]): {
  readonly olculen: number; readonly toplam: number;
  readonly saatler: readonly { readonly saat: string; readonly n: number; readonly diziyeGoreFark?: number }[];
  readonly diziler: readonly { readonly dizi: string; readonly n: number; readonly ortalama?: number }[];
  readonly uyari: string;
} {
  const plan = goals.pilot.videolar;
  const latest = latestPerVideo(records).filter((r) => r.pilotNo !== undefined && r.metrikler.izlemeyiSecenler !== null);
  const measured = latest.map((r) => ({ r, v: plan.find((p) => p.no === r.pilotNo) })).filter((x): x is { r: VideoPerformanceRecord; v: PilotVideo } => !!x.v);
  const seriesMean = new Map<string, number>();
  for (const s of new Set(measured.map((x) => x.v.dizi))) {
    const xs = measured.filter((x) => x.v.dizi === s).map((x) => x.r.metrikler.izlemeyiSecenler!);
    seriesMean.set(s, xs.reduce((a, b) => a + b, 0) / xs.length);
  }
  const hours = [...new Set(plan.map((p) => p.saat))].sort();
  const saatler = hours.map((saat) => {
    const xs = measured.filter((x) => x.v.saat === saat).map((x) => x.r.metrikler.izlemeyiSecenler! - seriesMean.get(x.v.dizi)!);
    return { saat, n: xs.length, ...(xs.length ? { diziyeGoreFark: round3(xs.reduce((a, b) => a + b, 0) / xs.length) } : {}) };
  });
  const diziler = goals.diziler.map((d) => {
    const n = measured.filter((x) => x.v.dizi === d.id).length;
    return { dizi: d.id, n, ...(n ? { ortalama: round3(seriesMean.get(d.id)!) } : {}) };
  });
  return { olculen: measured.length, toplam: plan.length, saatler, diziler, uyari: `${measured.length}/${plan.length} pilot video ölçüldü; bu yalnız ilk eğilimdir, kesin sonuç değildir (her hücrede en çok 2 video).` };
}
