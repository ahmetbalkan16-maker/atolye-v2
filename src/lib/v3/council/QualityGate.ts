/**
 * The Video Quality Gate (owner, 27 Nov 2026, "ATÖLYE – KALICI VİDEO ÜRETİM KALİTESİ STANDARDI": score every new video
 * out of 10 on ten areas, target at least 8/10, below 8.5 find the faults, improve and check again; never give a score at
 * random — every score rests on a scene, a time code or a measured finding; a historical error or a technical publishing
 * error keeps the video from "ready to publish" however good the total is).
 *
 * The gate adds no second check: it files the checks the production already makes (QC.md's rows, the quality brain's
 * frames, the layout and pixel measures, the director council) under the stage that owns them and the area they score,
 * and turns them into the scorecard. Pure: no file, no model, no network — the live server may read its verdict.
 */

/** The production stages a check belongs to (the standard's "kalite kontrollerini tek bir aşamaya sıkıştırma"). */
export type GateStage = "senaryo" | "sahneler" | "gorseller" | "animasyon" | "kurgu" | "ses" | "altyazi" | "export";

/** The ten scored areas of the standard, in its order. */
export type GateArea = "kanca" | "hikaye" | "dogruluk" | "gorsel" | "harita" | "tempo" | "ses" | "altyazi" | "tutma" | "final";

export const GATE_AREAS: readonly GateArea[] = ["kanca", "hikaye", "dogruluk", "gorsel", "harita", "tempo", "ses", "altyazi", "tutma", "final"];

export const AREA_TR: Readonly<Record<GateArea, string>> = {
  kanca: "Hook gücü",
  hikaye: "Hikâye kalitesi",
  dogruluk: "Tarihsel doğruluk",
  gorsel: "Görsel kalite",
  harita: "Harita ve animasyon",
  tempo: "Kurgu ve tempo",
  ses: "Ses kalitesi",
  altyazi: "Altyazı kalitesi",
  tutma: "İzleyici tutma potansiyeli",
  final: "Final kalitesi",
};

export const STAGE_TR: Readonly<Record<GateStage, string>> = {
  senaryo: "Senaryo",
  sahneler: "Sahneler",
  gorseller: "Görseller",
  animasyon: "Animasyon",
  kurgu: "Kurgu (Assembly)",
  ses: "Ses",
  altyazi: "Altyazı",
  export: "Export / yayın",
};

/** The standard's numbers: the total aimed at, and the line under which faults are fixed and checked again. */
export const GATE_MIN_TOTAL = 8;
export const GATE_TARGET = 8.5;

/**
 * What a blocking check stops: "tarih" a historical error, "teknik" a publishing error (format, length, licence, broken
 * sound, a description YouTube refuses). Either keeps the video from "yayina_hazir".
 */
export type GateBlock = "tarih" | "teknik";

/** One measured check. `weight` is the points it costs its area when it fails (default 2). */
export interface GateCheck {
  readonly stage: GateStage;
  readonly area: GateArea;
  readonly ok: boolean;
  /** The finding in the owner's words, with its scene or time code. */
  readonly text: string;
  readonly weight?: number;
  readonly block?: GateBlock;
  /** A measure with no reading (an older run, a step skipped): it scores nothing either way and is listed as such. */
  readonly unmeasured?: boolean;
}

export interface GateAreaScore {
  readonly area: GateArea;
  /** 0–10, one decimal; undefined when no check of the area was measured. */
  readonly score?: number;
  readonly passed: number;
  readonly failed: readonly string[];
  readonly evidence: readonly string[];
}

export type GateVerdict = "yayina_hazir" | "iyilestirme_gerekli" | "engelli";

export interface GateResult {
  readonly areas: readonly GateAreaScore[];
  /** Mean of the measured areas, one decimal. */
  readonly total: number;
  readonly verdict: GateVerdict;
  /** The failed blocking checks, each prefixed with its kind. */
  readonly blockers: readonly string[];
  /** Areas under GATE_TARGET: what the next round must improve. */
  readonly weak: readonly GateArea[];
  readonly stages: readonly { readonly stage: GateStage; readonly ok: number; readonly failed: readonly string[] }[];
}

const one = (n: number) => Math.round(n * 10) / 10;

/**
 * The scorecard. Each area starts at 10 and loses each failed check's weight (never below 0); its evidence is every
 * check behind it, passed or failed, so a score can be traced to what was measured. The verdict: any failed blocking
 * check → "engelli"; total under GATE_TARGET or any area under GATE_MIN_TOTAL → "iyilestirme_gerekli"; else ready.
 */
export function scoreGate(checks: readonly GateCheck[]): GateResult {
  const areas = GATE_AREAS.map((area): GateAreaScore => {
    const mine = checks.filter((c) => c.area === area && !c.unmeasured);
    const failed = mine.filter((c) => !c.ok);
    const lost = failed.reduce((a, c) => a + (c.weight ?? 2), 0);
    return {
      area,
      ...(mine.length ? { score: one(Math.max(0, 10 - lost)) } : {}),
      passed: mine.length - failed.length,
      failed: failed.map((c) => c.text),
      evidence: checks.filter((c) => c.area === area).map((c) => `${c.unmeasured ? "–" : c.ok ? "✓" : "✗"} ${c.text}`),
    };
  });
  const measured = areas.filter((a) => a.score !== undefined);
  const total = measured.length ? one(measured.reduce((s, a) => s + a.score!, 0) / measured.length) : 0;
  const blockers = checks.filter((c) => c.block && !c.ok && !c.unmeasured).map((c) => `${c.block === "tarih" ? "TARİH" : "TEKNİK"}: ${c.text}`);
  const weak = measured.filter((a) => a.score! < GATE_TARGET).map((a) => a.area);
  const verdict: GateVerdict = blockers.length ? "engelli" : !measured.length || total < GATE_TARGET || measured.some((a) => a.score! < GATE_MIN_TOTAL) ? "iyilestirme_gerekli" : "yayina_hazir";
  const stages = (Object.keys(STAGE_TR) as GateStage[]).flatMap((stage) => {
    const mine = checks.filter((c) => c.stage === stage && !c.unmeasured);
    return mine.length ? [{ stage, ok: mine.filter((c) => c.ok).length, failed: mine.filter((c) => !c.ok).map((c) => c.text) }] : [];
  });
  return { areas, total, verdict, blockers, weak, stages };
}

export const VERDICT_TR: Readonly<Record<GateVerdict, string>> = {
  yayina_hazir: "YAYINA HAZIR",
  iyilestirme_gerekli: "İYİLEŞTİRME GEREKLİ",
  engelli: "YAYIN ENGELLİ",
};

/** KALITE_KAPISI.md: the scorecard, the blockers, each stage's open checks and each area's evidence. */
export function gateMarkdown(title: string, r: GateResult): string {
  const table = r.areas.map((a, i) => `| ${i + 1} | ${AREA_TR[a.area]} | ${a.score === undefined ? "ölçülmedi" : `${a.score.toFixed(1)}/10`} | ${a.failed.length ? a.failed.length + " sorun" : "—"} |`).join("\n");
  const stages = r.stages.map((s) => `- **${STAGE_TR[s.stage]}:** ${s.ok} kontrol geçti${s.failed.length ? `; açık: ${s.failed.join(" · ")}` : ""}`).join("\n");
  const evidence = r.areas.map((a) => `### ${AREA_TR[a.area]} — ${a.score === undefined ? "ölçülmedi" : `${a.score.toFixed(1)}/10`}\n\n${a.evidence.map((e) => `- ${e}`).join("\n") || "- ölçüm yok"}`).join("\n\n");
  return `# Kalite kapısı — ${title}\n\n**Karar: ${VERDICT_TR[r.verdict]}** · toplam ${r.total.toFixed(1)}/10 (hedef ≥ ${GATE_TARGET}, her alan ≥ ${GATE_MIN_TOTAL})\n\n${r.blockers.length ? `## Yayını durduran hatalar\n\n${r.blockers.map((b) => `- ${b}`).join("\n")}\n\n` : ""}| # | Alan | Puan | Durum |\n|---|---|---|---|\n${table}\n\n## Aşama aşama\n\n${stages || "- kontrol yok"}\n\n## Gerekçeler (ölçülen her kontrol)\n\n${evidence}\n\nPuanlar ölçümden: her alan 10'dan başlar, açık kalan her kontrol ağırlığı kadar düşürür. Son karar yönetmenin (owner).\n`;
}

/** The short form kept on the order (and read by the publish approval). */
export interface GateSummary {
  readonly karar: GateVerdict;
  readonly puan: number;
  readonly engeller: readonly string[];
  readonly zayif: readonly GateArea[];
}

export const gateSummary = (r: GateResult): GateSummary => ({ karar: r.verdict, puan: r.total, engeller: r.blockers, zayif: r.weak });

/** One line for the log, QC.md and AYAS. */
export const gateLine = (r: Pick<GateResult, "verdict" | "total" | "blockers" | "weak">): string =>
  `Kalite kapısı: ${VERDICT_TR[r.verdict]} — ${r.total.toFixed(1)}/10${r.blockers.length ? `; ${r.blockers.length} engel` : ""}${r.weak.length ? `; hedef altı: ${r.weak.map((a) => AREA_TR[a]).join(", ")}` : ""}`;

/** Seconds as the standard's time codes ("0:07.4"). */
export const tc = (s: number): string => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/**
 * The longest stretch with no new picture event inside a window of the video (the standard's "videonun ortasında ilgi
 * kaybı yaratabilecek bölümler": the middle 30–70 % by default). `events` are the plan's visual event times.
 */
export function longestGapIn(events: readonly number[], durationS: number, from = 0.3, to = 0.7): { from: number; to: number; lengthS: number } {
  const a = durationS * from;
  const b = durationS * to;
  const inside = [a, ...events.filter((t) => t > a && t < b), b].sort((x, y) => x - y);
  let best = { from: a, to: a, lengthS: 0 };
  for (let i = 1; i < inside.length; i++) if (inside[i]! - inside[i - 1]! > best.lengthS) best = { from: inside[i - 1]!, to: inside[i]!, lengthS: inside[i]! - inside[i - 1]! };
  return best;
}

/** The closing hold: from the last picture event to the end (the Iran Short of 27 Nov 2026 stood still ~12 s at its end). */
export const closingHoldS = (events: readonly number[], durationS: number): number => Math.max(0, durationS - (events.length ? Math.max(...events) : 0));

/** A subtitle cue as written in altyazi.srt. */
export interface SrtCue {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const srtSeconds = (t: string) => {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000 : NaN;
};

export function parseSrt(srt: string): SrtCue[] {
  return srt.split(/\r?\n\r?\n/).flatMap((block) => {
    const lines = block.trim().split(/\r?\n/);
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) return [];
    const [s, e] = lines[at]!.split("-->").map((x) => srtSeconds(x.trim()));
    const text = lines.slice(at + 1).join(" ").trim();
    return Number.isFinite(s) && Number.isFinite(e) && text ? [{ start: s!, end: e!, text }] : [];
  });
}

/** A cue a phone reads at a glance: at most this many characters (two short lines) and this many characters a second. */
export const CUE_MAX_CHARS = 84;
export const CUE_MAX_CPS = 22;
export const CUE_MIN_S = 0.6;

/** The subtitle faults the gate scores: an empty file, cues a phone cannot read in time, overlapping or out-of-video cues. */
export function subtitleFaults(cues: readonly SrtCue[], durationS: number): string[] {
  if (!cues.length) return ["altyazı dosyası boş"];
  const out: string[] = [];
  const long = cues.filter((c) => c.text.length > CUE_MAX_CHARS);
  if (long.length) out.push(`${long.length} altyazı ${CUE_MAX_CHARS} karakterden uzun (ilki ${tc(long[0]!.start)})`);
  const fast = cues.filter((c) => c.end - c.start > 0 && c.text.length / Math.max(CUE_MIN_S, c.end - c.start) > CUE_MAX_CPS);
  if (fast.length) out.push(`${fast.length} altyazı saniyede ${CUE_MAX_CPS} karakterden hızlı (ilki ${tc(fast[0]!.start)})`);
  const overlap = cues.filter((c, i) => i > 0 && c.start < cues[i - 1]!.end - 0.05);
  if (overlap.length) out.push(`${overlap.length} altyazı bir öncekinin üstüne biniyor (ilki ${tc(overlap[0]!.start)})`);
  const after = cues.filter((c) => c.end > durationS + 0.5);
  if (after.length) out.push(`${after.length} altyazı videonun bitişinden sonra (${tc(after[0]!.end)})`);
  return out;
}

interface RowRule {
  readonly test: RegExp;
  readonly stage: GateStage;
  readonly area: GateArea;
  readonly weight?: number;
  readonly block?: GateBlock;
  /** Blocks only in a Short (a Short over its ceiling is no Short on YouTube). */
  readonly blockShort?: GateBlock;
}

/**
 * QC.md's rows by their label (scripts/atolye-v3.ts and ChannelGoals.openingChecks write them): which stage made the
 * check and which area it scores. Weight 0 scores nothing and only lists (a technical publishing check still blocks).
 * A label not here falls to tempo/kurgu with weight 1 and is named in `unknownRows`, so a new row is never lost.
 */
const ROW_RULES: readonly RowRule[] = [
  { test: /^Açılış sorusu:/, stage: "senaryo", area: "kanca", weight: 3 },
  { test: /^Kanca:/, stage: "senaryo", area: "kanca", weight: 3 },
  { test: /^Kanca dayanağı:/, stage: "senaryo", area: "kanca" },
  { test: /^Kanca ardı:/, stage: "senaryo", area: "tutma" },
  { test: /^İlk 3 sn — soru:/, stage: "senaryo", area: "kanca" },
  { test: /^İlk 3 sn — ilk söz:/, stage: "senaryo", area: "kanca" },
  { test: /^İlk 3 sn — ilk görsel olay/, stage: "animasyon", area: "kanca" },
  { test: /^İlk 3 sn — tam ekran kart:/, stage: "sahneler", area: "kanca", weight: 1 },
  { test: /^İlk kare:/, stage: "kurgu", area: "kanca", weight: 3 },
  // The opening on the screen itself (owner, 27 Nov 2026, the Gaugamela Short scored 10/10 here with its armies first on
  // screen at 16 s): weighted like the question, so a hook that shows nothing cannot score as a strong one.
  { test: /^Açılışta ilk hamle:/, stage: "sahneler", area: "kanca", weight: 3 },
  { test: /^Açılış resmi:/, stage: "kurgu", area: "kanca", weight: 2 },
  { test: /^Soru başlık:/, stage: "senaryo", area: "tutma" },
  { test: /^Sahne planı/, stage: "sahneler", area: "hikaye" },
  { test: /^Short açılışı/, stage: "animasyon", area: "kanca" },
  { test: /^İlk konuşma/, stage: "senaryo", area: "kanca", weight: 3 },
  { test: /^Ortalama görsel olay aralığı/, stage: "kurgu", area: "tempo" },
  { test: /^En uzun olaysız aralık/, stage: "kurgu", area: "tutma" },
  { test: /^Karaktersiz en uzun süre/, stage: "sahneler", area: "tempo", weight: 1 },
  { test: /^Kısa çekim/, stage: "kurgu", area: "tempo", weight: 1 },
  { test: /^Adlı karakterlerin kıyafeti:/, stage: "gorseller", area: "gorsel", weight: 1 },
  { test: /^\d+ görünür karakter, \d+ farklı ses/, stage: "ses", area: "ses", weight: 1 },
  { test: /^Diyaloglu sahne oranı/, stage: "senaryo", area: "hikaye", weight: 1 },
  { test: /^Ağız senkronu:/, stage: "animasyon", area: "harita", weight: 1 },
  { test: /^Görsel lisansları:/, stage: "gorseller", area: "gorsel", weight: 2, block: "teknik" },
  { test: /^Dönem görselleri:/, stage: "gorseller", area: "gorsel", weight: 1 },
  { test: /^Gardırop:/, stage: "gorseller", area: "gorsel", weight: 1 },
  { test: /^Gerçek kişiler:/, stage: "gorseller", area: "dogruluk", weight: 1 },
  { test: /^Kapak:/, stage: "export", area: "gorsel", weight: 1 },
  { test: /^Setler:/, stage: "gorseller", area: "gorsel", weight: 1 },
  { test: /^Ses seviyesi/, stage: "ses", area: "ses" },
  { test: /^Ses temizliği:/, stage: "ses", area: "ses", weight: 1 },
  { test: /^Ses bozukluğu:/, stage: "ses", area: "ses", weight: 4, block: "teknik" },
  { test: /^Ses tıkırtısı:/, stage: "ses", area: "ses", weight: 1 },
  { test: /^Tarih doğrulaması:/, stage: "senaryo", area: "dogruluk", weight: 4, block: "tarih" },
  { test: /^CREDITS\.md/, stage: "export", area: "dogruluk", weight: 2, block: "teknik" },
  { test: /^YouTube açıklaması:/, stage: "export", area: "final", weight: 0, block: "teknik" },
  // Over its own target is a pacing fault; only the upload file over SHORTS_MAX_S (checked from ffprobe) blocks.
  { test: /^Süre /, stage: "export", area: "tempo", weight: 2 },
  { test: /^Görüntü payları:/, stage: "sahneler", area: "harita", weight: 1 },
  { test: /^Gerçek görseller:/, stage: "gorseller", area: "gorsel", weight: 2 },
  { test: /^Harita görünüşleri:/, stage: "animasyon", area: "harita", weight: 1 },
];

/** A QC.md row ("- [x] text" / "- [ ] text") as a gate check; undefined for a line that is no row. */
export function qcRowCheck(line: string, shorts: boolean): (GateCheck & { readonly known: boolean }) | undefined {
  const m = /^- \[( |x)\] (.+)$/.exec(line.trim());
  if (!m) return undefined;
  const text = m[2]!;
  const rule = ROW_RULES.find((r) => r.test.test(text));
  const block = rule?.block ?? (shorts ? rule?.blockShort : undefined);
  return { stage: rule?.stage ?? "kurgu", area: rule?.area ?? "tempo", ok: m[1] === "x", text, weight: rule?.weight ?? (rule ? 2 : 1), ...(block ? { block } : {}), known: Boolean(rule) };
}

/** Every row of a QC.md text as gate checks (the scorecard's base), and the labels no rule knows. */
export function qcChecks(qc: string, shorts: boolean): { readonly checks: GateCheck[]; readonly unknownRows: string[] } {
  const rows = qc.split(/\r?\n/).flatMap((l) => qcRowCheck(l, shorts) ?? []);
  return { checks: rows.map((r): GateCheck => ({ stage: r.stage, area: r.area, ok: r.ok, text: r.text, ...(r.weight !== undefined ? { weight: r.weight } : {}), ...(r.block ? { block: r.block } : {}) })), unknownRows: rows.filter((r) => !r.known).map((r) => r.text.slice(0, 60)) };
}

/**
 * Still stretches of the finished video, from ffmpeg's freezedetect log (stderr): what the viewer sees as "nothing moves"
 * whatever the plan counted as an event — the Iran war Short of 27 Nov 2026 stood ~12 s on its closing scene while lines
 * and lip sync still counted as events. A freeze still open at the end of the log runs to `durationS`.
 */
export function parseFreezes(log: string, durationS: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let open: number | undefined;
  for (const m of log.matchAll(/freeze_(start|end):\s*([\d.]+)/g)) {
    const t = Number(m[2]);
    if (m[1] === "start") open = t;
    else if (open !== undefined) {
      out.push({ start: open, end: t });
      open = undefined;
    }
  }
  if (open !== undefined) out.push({ start: open, end: durationS });
  return out;
}

/** freezedetect's settings: a picture changing less than this share for at least FREEZE_MIN_S is still. */
export const FREEZE_NOISE = 0.003;
export const FREEZE_MIN_S = 3;

/** ffmpeg ebur128's momentary loudness log (one "t: … M: …" line every 0.1 s) as points. */
export function parseMomentary(log: string): { t: number; m: number }[] {
  return [...log.matchAll(/t:\s*([\d.]+)\s+TARGET:[^\n]*?M:\s*(-?[\d.]+|-inf)/g)].flatMap((x) => (x[2] === "-inf" ? [] : [{ t: Number(x[1]), m: Number(x[2]) }]));
}

/** Music/ambience shows on its own at least this long in all, or the balance is not measured. */
export const BALANCE_MIN_GAP_S = 1.5;
/** Speech moments must stand at least this much louder than the music-only moments (LU). */
export const BALANCE_MIN_LU = 4;

/**
 * Music against the narrator, from the final mix alone (owner, 27 Nov 2026, the quality standard: "Müzik anlatıcıyı
 * bastırmamalı"; the mix keeps no separate stems): the median momentary loudness while someone speaks against the median
 * where nobody speaks (music and ambience only, 0.3 s off each line's edge). A mix whose music-only moments are nearly as
 * loud as its speech covers the voice. Undefined when the music-only moments are under BALANCE_MIN_GAP_S in all.
 */
export function speechMusicBalance(points: readonly { t: number; m: number }[], speech: readonly { start: number; end: number }[]): { speech: number; music: number; diff: number; musicS: number } | undefined {
  const talking = (t: number, pad: number) => speech.some((s) => t >= s.start - pad && t <= s.end + pad);
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const sp = points.filter((p) => talking(p.t, 0) && p.m > -60).map((p) => p.m);
  const mu = points.filter((p) => !talking(p.t, 0.3) && p.m > -60).map((p) => p.m);
  if (!sp.length || mu.length * 0.1 < BALANCE_MIN_GAP_S) return undefined;
  const a = median(sp)!, b = median(mu)!;
  return { speech: Math.round(a * 10) / 10, music: Math.round(b * 10) / 10, diff: Math.round((a - b) * 10) / 10, musicS: Math.round(mu.length) / 10 };
}

/** The voices against the bed under them, from the mixer's own stems (Mixer.renderMix). */
export interface VoiceOverBed {
  /** Median of voice minus bed (LU) over the moments someone speaks. */
  readonly farkLu: number;
  /** The share of speaking moments where the bed comes within BED_CLOSE_LU of the voice. */
  readonly yakinPay: number;
  readonly konusmaSn: number;
}

/** A voice this much over its bed reads clearly on a phone speaker; less is music covering the narrator. */
export const VOICE_OVER_BED_MIN_LU = 8;
/** A speaking moment with the bed this close to the voice is a moment the words may be lost. */
export const BED_CLOSE_LU = 4;

/**
 * Music against the narrator, scored (owner, 27 Nov 2026, the quality standard: "Müzik anlatıcıyı bastırmamalı"): the
 * dialogue stem and the bed stem (the same mix with the voices silenced after they keyed every duck), moment by moment
 * (ebur128, 0.4 s windows) where the voice is above -45 LUFS. Undefined with under a second of speech.
 */
export function voiceOverBed(voice: readonly { t: number; m: number }[], bed: readonly { t: number; m: number }[]): VoiceOverBed | undefined {
  const at = new Map(bed.map((p) => [Math.round(p.t * 10), p.m]));
  const diffs = voice.filter((p) => p.m > -45).map((p) => p.m - (at.get(Math.round(p.t * 10)) ?? -70));
  if (diffs.length < 10) return undefined;
  const sorted = [...diffs].sort((a, b) => a - b);
  return { farkLu: Math.round(sorted[Math.floor(sorted.length / 2)]! * 10) / 10, yakinPay: Math.round((diffs.filter((d) => d < BED_CLOSE_LU).length / diffs.length) * 100) / 100, konusmaSn: diffs.length / 10 };
}
