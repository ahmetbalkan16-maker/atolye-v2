import type { CandidateVerdict, JudgeMode, SceneForJudge } from "../backgrounds/BackgroundJudge";
import { passes } from "../backgrounds/BackgroundJudge";

/**
 * The brains' exam (Beyin sınavı, owner approval 20 Oct 2026; idea from promptfoo): pictures whose right verdict is
 * known — a 49 BC street with a church tower must fail on period, an unwanted sunset sky must not pass, a good flat
 * set must pass. Whenever a model changes (an update, a new local "eye"), the exam measures whether the judging
 * brains (setting, costume, quality, retouch all share this eye) got better or worse, and two models can be
 * compared on the same questions. Questions live in `content/v3/beyin-sinavi.json`; their pictures outside git.
 */
export interface ExamExpectation {
  /** Both scores at or above the bar and nothing modern (the production's own pass rule). */
  readonly gecmeli?: boolean;
  readonly puanMax?: number;
  readonly puanMin?: number;
  readonly donemMax?: number;
  readonly donemMin?: number;
}

export interface ExamQuestion {
  readonly id: string;
  readonly mod: JudgeMode;
  /** Picture file name in the exam folder. */
  readonly gorsel: string;
  /** Where the picture came from (relative to the work root), for setting the exam up. */
  readonly kaynak: string;
  readonly sahne: SceneForJudge;
  readonly beklenen: ExamExpectation;
  /** Why this is the right answer (Turkish, for the owner). */
  readonly neden: string;
}

export interface ExamManifest {
  readonly surum: number;
  readonly sorular: readonly ExamQuestion[];
}

/** Whether a verdict is the expected answer, and if not, why. */
export function gradeAnswer(q: ExamQuestion, v: CandidateVerdict | undefined): { readonly dogru: boolean; readonly neden: string } {
  if (!v) return { dogru: false, neden: "cevap yok" };
  // An empty answer scores 0 and would "pass" every must-fail question (Qwen3-VL's first exam: 1/6 out of blanks).
  if (v.okunamadi) return { dogru: false, neden: "okunamayan yanıt" };
  const e = q.beklenen;
  const fails: string[] = [];
  if (e.gecmeli !== undefined && passes(v) !== e.gecmeli) fails.push(e.gecmeli ? "geçmesi gerekirdi" : "geçmemesi gerekirdi");
  if (e.puanMax !== undefined && v.puan > e.puanMax) fails.push(`puan ${v.puan} > ${e.puanMax}`);
  if (e.puanMin !== undefined && v.puan < e.puanMin) fails.push(`puan ${v.puan} < ${e.puanMin}`);
  if (e.donemMax !== undefined && (v.donem ?? 10) > e.donemMax) fails.push(`dönem ${v.donem ?? "?"} > ${e.donemMax}`);
  if (e.donemMin !== undefined && (v.donem ?? 0) < e.donemMin) fails.push(`dönem ${v.donem ?? "?"} < ${e.donemMin}`);
  return fails.length ? { dogru: false, neden: fails.join("; ") } : { dogru: true, neden: "beklenen cevap" };
}
