/** Stage16.7: immutable course work specifications. No jobs, providers, file writes or publication. */
import { digestAyasRevenueData } from "../AyasRevenueDigest";
import { isAyasRevenueDataArray, isAyasRevenueDigest } from "../AyasRevenueOpportunity";
import { containsAyasRevenueSensitiveData, deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenueBoundedJson,
  isAyasRevenuePlainRecord, isAyasRevenueSensitiveText, snapshotAyasRevenueValue } from "../AyasRevenueRedaction";

export const courseInteger = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && !Object.is(v, -0) && (v as number) >= min && (v as number) <= max;
export const courseText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max
  && !isAyasRevenueSensitiveText(v) && !/[\u0000-\u0008\u000b-\u001f]|[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|app|link)\b/i.test(v);
export const courseId = (v: unknown, prefix: string): v is string => typeof v === "string" && new RegExp(`^${prefix}_[a-z][a-z0-9_-]{2,31}$`).test(v);
export const courseProof = (v: unknown): v is string | null => v === null || isAyasRevenueDigest(v);
export function snapshotAyasCourseValue(raw: unknown): unknown | null {
  try {
    if (!isAyasRevenueBoundedJson(raw, 65_536) || containsAyasRevenueSensitiveData(raw)) return null;
    const s = snapshotAyasRevenueValue(raw);
    return s.ok && isAyasRevenueBoundedJson(s.value, 65_536) && !containsAyasRevenueSensitiveData(s.value) ? deepFreezeAyasRevenueValue(s.value) : null;
  } catch { return null; }
}
const texts = (v: unknown, n: number, chars: number, minimum = 0): v is string[] => isAyasRevenueDataArray(v, n) && v.length >= minimum
  && v.every(x => courseText(x, chars)) && new Set(v).size === v.length;
export interface AyasCourseLesson {
  readonly lessonId: string; readonly order: number; readonly title: string; readonly durationSeconds: number;
  readonly outcomeIds: readonly string[]; readonly script: string | null; readonly visualPlan: readonly string[];
  readonly mediaPolicy: "REAL_ONLY" | "GENERATED_ALLOWED"; readonly generatedPolicyDigest: string | null;
  readonly exercise: string | null; readonly downloads: readonly { readonly resourceId: string; readonly description: string }[];
  readonly rightsEvidenceDigest: string | null; readonly captionLanguage: string;
  readonly claimClass: "GENERAL" | "MEDICAL" | "LEGAL" | "FINANCIAL"; readonly qualifiedClaimReviewDigest: string | null;
}
export interface AyasCoursePlanInput {
  readonly schemaVersion: "1"; readonly courseId: string; readonly version: number; readonly title: string;
  readonly targetLearner: string; readonly prerequisites: readonly string[]; readonly sourceEvidenceDigests: readonly string[];
  readonly outcomes: readonly { readonly outcomeId: string; readonly description: string }[];
  readonly sections: readonly { readonly sectionId: string; readonly order: number; readonly title: string; readonly lessons: readonly AyasCourseLesson[] }[];
}
export interface AyasCourseProductionPlan {
  readonly plan: AyasCoursePlanInput; readonly planDigest: string; readonly state: "DRAFT" | "CONTENT_READY";
  readonly issues: readonly string[]; readonly publication: "CLOSED"; readonly authority: "NONE";
}
/** Structural errors refuse the plan; missing content/proofs remain explicit work, never inferred completion. */
export function buildAyasCourseProductionPlan(raw: unknown): AyasCourseProductionPlan | null {
  const p = snapshotAyasCourseValue(raw);
  if (!isAyasRevenuePlainRecord(p) || !hasExactAyasRevenueKeys(p, ["schemaVersion", "courseId", "version", "title", "targetLearner", "prerequisites", "sourceEvidenceDigests", "outcomes", "sections"])
    || p.schemaVersion !== "1" || !courseId(p.courseId, "crs") || !courseInteger(p.version, 1, 10_000) || !courseText(p.title, 120) || !courseText(p.targetLearner, 500)
    || !texts(p.prerequisites, 12, 250) || !isAyasRevenueDataArray(p.sourceEvidenceDigests, 16) || p.sourceEvidenceDigests.length === 0
    || !p.sourceEvidenceDigests.every(isAyasRevenueDigest) || new Set(p.sourceEvidenceDigests).size !== p.sourceEvidenceDigests.length
    || !isAyasRevenueDataArray(p.outcomes, 16) || p.outcomes.length === 0 || !p.outcomes.every(o => isAyasRevenuePlainRecord(o)
      && hasExactAyasRevenueKeys(o, ["outcomeId", "description"]) && courseId(o.outcomeId, "out") && courseText(o.description, 300))
    || !isAyasRevenueDataArray(p.sections, 12) || p.sections.length === 0) return null;
  const outcomes = new Set(p.outcomes.map(o => (o as Record<string, unknown>).outcomeId)); if (outcomes.size !== p.outcomes.length) return null;
  const sections = new Set<string>(), lessons = new Set<string>(), mapped = new Set<string>(), resources = new Set<string>(), issues: string[] = [];
  for (const [i, s] of p.sections.entries()) {
    if (!isAyasRevenuePlainRecord(s) || !hasExactAyasRevenueKeys(s, ["sectionId", "order", "title", "lessons"]) || !courseId(s.sectionId, "sec") || sections.has(s.sectionId)
      || s.order !== i + 1 || !courseText(s.title, 120) || !isAyasRevenueDataArray(s.lessons, 25) || s.lessons.length === 0) return null;
    sections.add(s.sectionId);
    for (const [j, l] of s.lessons.entries()) {
      if (!isAyasRevenuePlainRecord(l) || !hasExactAyasRevenueKeys(l, ["lessonId", "order", "title", "durationSeconds", "outcomeIds", "script", "visualPlan", "mediaPolicy", "generatedPolicyDigest", "exercise", "downloads", "rightsEvidenceDigest", "captionLanguage", "claimClass", "qualifiedClaimReviewDigest"])
        || !courseId(l.lessonId, "lsn") || lessons.has(l.lessonId) || lessons.size >= 100 || l.order !== j + 1 || !courseText(l.title, 120)
        || !courseInteger(l.durationSeconds, 30, 3600) || !isAyasRevenueDataArray(l.outcomeIds, 16) || l.outcomeIds.length === 0 || new Set(l.outcomeIds).size !== l.outcomeIds.length
        || !l.outcomeIds.every(o => outcomes.has(o)) || !(l.script === null || courseText(l.script, 6000)) || !texts(l.visualPlan, 12, 250)
        || !["REAL_ONLY", "GENERATED_ALLOWED"].includes(l.mediaPolicy as string) || !courseProof(l.generatedPolicyDigest) || !(l.exercise === null || courseText(l.exercise, 1500))
        || !isAyasRevenueDataArray(l.downloads, 8) || !courseProof(l.rightsEvidenceDigest) || typeof l.captionLanguage !== "string" || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(l.captionLanguage)
        || !["GENERAL", "MEDICAL", "LEGAL", "FINANCIAL"].includes(l.claimClass as string) || !courseProof(l.qualifiedClaimReviewDigest)) return null;
      for (const r of l.downloads) {
        if (!isAyasRevenuePlainRecord(r) || !hasExactAyasRevenueKeys(r, ["resourceId", "description"]) || !courseId(r.resourceId, "res") || resources.has(r.resourceId) || !courseText(r.description, 250)) return null;
        resources.add(r.resourceId);
      }
      lessons.add(l.lessonId); for (const o of l.outcomeIds) mapped.add(o as string);
      if (l.script === null) issues.push(`SCRIPT_MISSING:${l.lessonId}`);
      if (l.visualPlan.length === 0) issues.push(`VISUAL_PLAN_MISSING:${l.lessonId}`);
      if (l.exercise === null) issues.push(`EXERCISE_MISSING:${l.lessonId}`);
      if (l.rightsEvidenceDigest === null) issues.push(`RIGHTS_UNRESOLVED:${l.lessonId}`);
      if (l.mediaPolicy === "GENERATED_ALLOWED" && l.generatedPolicyDigest === null) issues.push(`GENERATED_POLICY_UNREVIEWED:${l.lessonId}`);
      if (l.claimClass !== "GENERAL" && l.qualifiedClaimReviewDigest === null) issues.push(`CLAIM_UNREVIEWED:${l.lessonId}`);
    }
  }
  for (const o of outcomes) if (!mapped.has(o as string)) issues.push(`OUTCOME_UNMAPPED:${o}`);
  const planDigest = digestAyasRevenueData(p); if (planDigest === null) return null;
  const contentMissing = issues.some(x => /^(SCRIPT|VISUAL_PLAN|EXERCISE|OUTCOME)_/.test(x));
  return deepFreezeAyasRevenueValue({ plan: p as unknown as AyasCoursePlanInput, planDigest, state: contentMissing ? "DRAFT" : "CONTENT_READY", issues, publication: "CLOSED", authority: "NONE" });
}
