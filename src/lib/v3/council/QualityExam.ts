import { FRAME_KINDS, type FrameKind } from "./QualityBrain";

/**
 * The quality brain's frame-fault exam, its pure part: the questions' shape and checks, the moment a measured fault
 * covers, and the scores. Owner, 9 Nov 2026: "Kalite sınavını 8 sorudan 30'un üzerine çıkarmak. Kendi ayarlarının
 * gerçekten işe yarayıp yaramadığını ancak o zaman ölçebilir." With 8 counted questions one flip moved the score ~12
 * points and the same settings gave 90 % and 73 % minutes apart, so no tuning of the brain could ever be confirmed.
 * The settings it tunes (examples shown, the steady judge, prompt additions) change only the vision model's verdict,
 * so the score the self-improvement loop compares is the eye's own (`goz`): the frames the vision model decides —
 * eye faults and clean frames — not the layout and pixel faults code measures the same way every run.
 */

/** Which check catches a faulty frame in production: the render's boxes, the pixel check, or the eye (vision model). */
export type FrameMeasure = "yerlesim" | "piksel" | "goz";

/** One exam question (`content/v3/kalite-sinavi.json`); paths are relative to the V3 work root. */
export interface FrameQuestion {
  readonly id: string;
  readonly kaynak: string;
  readonly saniye: number;
  readonly donem: string;
  readonly tur: FrameKind;
  readonly kusurlu: boolean;
  readonly kusur?: string;
  readonly ne?: string;
  readonly olcum?: FrameMeasure;
  /**
   * The render's own boxes (`yerlesim.json`) and plan (`plan.json`) written with the source video: with them a layout
   * question is measured as the production measures it, and the plan's designed moments are skipped by the pixel check.
   * Only the episode's latest render matches them (`video-sessiz.mp4`), not an older round's mp4.
   */
  readonly yerlesim?: string;
  readonly plan?: string;
  /**
   * A fault laid onto a clean frame on purpose: an ffmpeg filter applied after the frame is scaled to 960 px wide (a
   * face boxed over, a glitched band, speech blurred unreadable). The videos gave too few eye faults for a fair exam;
   * a laid-on fault is named as one (`yapay`) in the report.
   */
  readonly bozma?: string;
}

/** The eye's score needs at least this many questions: one flip then moves it ~3 points, under MIN_GAIN. */
export const MIN_EYE_QUESTIONS = 30;

/** A question the vision model's verdict decides: an eye fault, or a clean frame it must pass. */
export const eyeQuestion = (q: Pick<FrameQuestion, "kusurlu" | "olcum">): boolean => !q.kusurlu || q.olcum === "goz";

/** The faults a measured check found that cover second `t` (a frame's time either way). */
export function faultsAt<T extends { readonly from: number; readonly to: number }>(faults: readonly T[], t: number, pad = 0.05): T[] {
  return faults.filter((f) => f.from <= t + pad && f.to >= t - pad);
}

export interface ExamScore {
  readonly dogru: number;
  readonly toplam: number;
  readonly kusurlu: number;
  /** Faulty frames reported. */
  readonly bulunan: number;
  /** Clean frames passed. */
  readonly gecen: number;
  /** The mean of the two hit rates (any judge that answers the same for every frame gets 50); undefined without both. */
  readonly dengeli?: number;
  /** The same verdict for every frame: no judgement, its score is to be ignored. */
  readonly hepAyni: boolean;
}

/** Scores answers (each: was the frame faulty, was the verdict right). */
export function examScore(answers: readonly { readonly kusurlu: boolean; readonly dogru: boolean }[]): ExamScore {
  const kusurlu = answers.filter((a) => a.kusurlu).length;
  const bulunan = answers.filter((a) => a.kusurlu && a.dogru).length;
  const gecen = answers.filter((a) => !a.kusurlu && a.dogru).length;
  const temiz = answers.length - kusurlu;
  const dengeli = kusurlu && temiz ? Math.round(((bulunan / kusurlu + gecen / temiz) / 2) * 100) : undefined;
  // Every frame called faulty (all faulty found, no clean passed) or every frame called clean.
  const hepAyni = answers.length > 1 && ((bulunan === kusurlu && gecen === 0) || (bulunan === 0 && gecen === temiz));
  return { dogru: bulunan + gecen, toplam: answers.length, kusurlu, bulunan, gecen, ...(dengeli !== undefined ? { dengeli } : {}), hepAyni };
}

/** The question file's problems (Turkish lines); empty when it is fit to sit. */
export function questionProblems(questions: readonly FrameQuestion[]): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const q of questions) {
    const at = `${q.id || "(adsız)"}:`;
    if (!/^[a-z0-9-]+$/.test(q.id)) out.push(`${at} kimlik yalnız küçük harf, rakam ve tire olmalı (kare dosyasının adı)`);
    if (ids.has(q.id)) out.push(`${at} aynı kimlik iki kez`);
    ids.add(q.id);
    if (!FRAME_KINDS.includes(q.tur)) out.push(`${at} bilinmeyen kare türü ${q.tur}`);
    if (!Number.isFinite(q.saniye) || q.saniye < 0) out.push(`${at} saniye geçersiz`);
    if (!q.kaynak || /^[a-z]:|^[\\/]/i.test(q.kaynak)) out.push(`${at} kaynak çalışma köküne göre olmalı`);
    if (q.kusurlu ? !q.kusur?.trim() : !q.ne?.trim()) out.push(`${at} ${q.kusurlu ? "kusur" : "ne"} metni yok`);
    if (q.kusurlu && !q.olcum) out.push(`${at} kusurlu sorunun ölçümü (olcum) yok`);
    if (q.bozma && !q.kusurlu) out.push(`${at} bozma yalnız kusurlu soruda olur`);
    if (q.bozma && q.olcum !== "goz") out.push(`${at} bozulmuş kare göz sorusudur (olcum: goz)`);
    if (q.olcum === "yerlesim" && q.plan && !q.yerlesim) out.push(`${at} plan var ama yerlesim yok`);
  }
  return out;
}
