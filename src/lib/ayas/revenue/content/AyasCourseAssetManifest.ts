/** Course artifacts and owner upload handoff. References only: this module never opens files or publishes. */
import { digestAyasRevenueData } from "../AyasRevenueDigest";
import { isAyasRevenueDataArray, isAyasRevenueDigest } from "../AyasRevenueOpportunity";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenuePlainRecord, isAyasRevenueTimestamp } from "../AyasRevenueRedaction";
import { buildAyasCourseProductionPlan, courseInteger, courseProof, snapshotAyasCourseValue } from "./AyasCourseProductionPlan";

export type AyasCourseReadiness = "DRAFT" | "CONTENT_READY" | "MEDIA_READY" | "QUALITY_REVIEW_REQUIRED" | "OWNER_UPLOAD_READY" | "OWNER_PUBLISHED_CONFIRMED";
/** Reviewed 2026-10-03 against official quality checklist/video standards. Recheck before owner upload. */
export const AYAS_COURSE_UDEMY_MINIMUM_POLICY = Object.freeze({ version: "udemy-video-2026-10-03", lectures: 5, videoSeconds: 1800, height: 720, audioChannels: 2 });
const ref = (v: unknown, root: string, stem: string, extension: string): v is { readonly pathRef: string; readonly digest: string } => isAyasRevenuePlainRecord(v)
  && hasExactAyasRevenueKeys(v, ["pathRef", "digest"]) && v.pathRef === `${root}/${stem}.${extension}` && isAyasRevenueDigest(v.digest);
export interface AyasCourseReadinessResult {
  readonly state: AyasCourseReadiness; readonly planDigest: string; readonly manifestDigest: string; readonly issues: readonly string[];
  readonly handoff: { readonly planDigest: string; readonly manifestDigest: string; readonly ownerMustUpload: true; readonly checklist: readonly string[] } | null;
  readonly publicationEvidence: unknown | null; readonly publication: "CLOSED"; readonly authority: "NONE"; readonly opensFiles: false;
}
/** Rebuild the plan from raw source so a caller cannot forge CONTENT_READY or edit its digest. */
export function evaluateAyasCourseAssetManifest(rawPlan: unknown, rawManifest: unknown, now: string): AyasCourseReadinessResult | null {
  const plan = buildAyasCourseProductionPlan(rawPlan), m = snapshotAyasCourseValue(rawManifest);
  if (plan === null || !isAyasRevenueTimestamp(now) || !isAyasRevenuePlainRecord(m) || !hasExactAyasRevenueKeys(m, ["schemaVersion", "planDigest", "version", "lessons", "ownerQualityReview"])
    || m.schemaVersion !== "1" || m.planDigest !== plan.planDigest || !courseInteger(m.version, 1, 10_000) || !isAyasRevenueDataArray(m.lessons, 100)) return null;
  const wanted = plan.plan.sections.flatMap(s => s.lessons), byId = new Map(wanted.map(l => [l.lessonId, l])), seen = new Set<string>(), paths = new Set<string>(), issues = [...plan.issues];
  let missingMedia = false, qualityMissing = false, latestMediaReview = "", measuredVideoSeconds = 0;
  if (wanted.length < AYAS_COURSE_UDEMY_MINIMUM_POLICY.lectures) issues.push("UDEMY_MINIMUM_LECTURES_NOT_MET");
  for (const row of m.lessons) {
    if (!isAyasRevenuePlainRecord(row) || !hasExactAyasRevenueKeys(row, ["lessonId", "sourceScriptDigest", "video", "audio", "caption", "downloads", "rightsEvidenceDigest", "validation"])
      || typeof row.lessonId !== "string" || seen.has(row.lessonId) || !byId.has(row.lessonId) || !courseProof(row.sourceScriptDigest) || !courseProof(row.rightsEvidenceDigest)
      || !isAyasRevenueDataArray(row.downloads, 8)) return null;
    const l = byId.get(row.lessonId)!, root = `courses/${plan.plan.courseId}/${l.lessonId}`;
    const scriptDigest = l.script === null ? null : digestAyasRevenueData({ script: l.script });
    if (row.sourceScriptDigest !== scriptDigest) return null;
    for (const [key, stem, extension] of [["video", "video", "mp4"], ["audio", "audio", "wav"], ["caption", `captions-${l.captionLanguage}`, "vtt"]] as const) {
      const asset = row[key]; if (asset === null) { missingMedia = true; issues.push(`ASSET_MISSING:${l.lessonId}:${key}`); }
      else { if (!ref(asset, root, stem, extension) || paths.has(asset.pathRef)) return null; paths.add(asset.pathRef); }
    }
    const downloads = new Set<string>();
    for (const d of row.downloads) {
      if (!isAyasRevenuePlainRecord(d) || !hasExactAyasRevenueKeys(d, ["resourceId", "asset"]) || typeof d.resourceId !== "string" || downloads.has(d.resourceId)
        || !l.downloads.some(r => r.resourceId === d.resourceId) || !ref(d.asset, root, d.resourceId, "pdf") || paths.has(d.asset.pathRef)) return null;
      downloads.add(d.resourceId); paths.add(d.asset.pathRef);
    }
    if (downloads.size !== l.downloads.length) { missingMedia = true; issues.push(`DOWNLOAD_MISSING:${l.lessonId}`); }
    if (row.rightsEvidenceDigest === null || row.rightsEvidenceDigest !== l.rightsEvidenceDigest) issues.push(`ASSET_RIGHTS_UNRESOLVED:${l.lessonId}`);
    const v = row.validation;
    if (v === null) qualityMissing = true;
    else {
      if (!isAyasRevenuePlainRecord(v) || !hasExactAyasRevenueKeys(v, ["source", "reviewedAt", "receiptDigest", "videoDigest", "audioDigest", "captionDigest", "scriptDigest", "audioIntelligible", "captionsComplete", "visualQuality", "rightsPass", "videoSeconds", "videoWidth", "videoHeight", "audioChannels", "audioVideoSync", "dynamicVisuals"])
        || !["OWNER_REVIEW", "MEDIA_COLLECTOR"].includes(v.source as string) || !isAyasRevenueTimestamp(v.reviewedAt) || v.reviewedAt > now || !isAyasRevenueDigest(v.receiptDigest)
        || !isAyasRevenuePlainRecord(row.video) || !isAyasRevenuePlainRecord(row.audio) || !isAyasRevenuePlainRecord(row.caption)
        || v.videoDigest !== row.video.digest || v.audioDigest !== row.audio.digest || v.captionDigest !== row.caption.digest || v.scriptDigest !== scriptDigest
        || ![v.audioIntelligible, v.captionsComplete, v.visualQuality, v.rightsPass, v.audioVideoSync, v.dynamicVisuals].every(x => typeof x === "boolean")
        || !courseInteger(v.videoSeconds, 1, 7200) || !courseInteger(v.videoWidth, 1, 7680) || !courseInteger(v.videoHeight, 1, 4320) || !courseInteger(v.audioChannels, 1, 8)) return null;
      if (v.audioIntelligible !== true || v.captionsComplete !== true || v.visualQuality !== true || v.rightsPass !== true) issues.push(`QUALITY_FAILED:${l.lessonId}`);
      if (v.videoHeight < AYAS_COURSE_UDEMY_MINIMUM_POLICY.height || v.videoWidth * 9 !== v.videoHeight * 16 || v.audioChannels !== AYAS_COURSE_UDEMY_MINIMUM_POLICY.audioChannels
        || v.audioVideoSync !== true || v.dynamicVisuals !== true) issues.push(`UDEMY_MEDIA_MINIMUM_FAILED:${l.lessonId}`);
      measuredVideoSeconds += v.videoSeconds;
      if (v.reviewedAt > latestMediaReview) latestMediaReview = v.reviewedAt;
    }
    seen.add(l.lessonId);
  }
  for (const l of wanted) if (!seen.has(l.lessonId)) { missingMedia = true; issues.push(`LESSON_ASSETS_MISSING:${l.lessonId}`); }
  if (!missingMedia && !qualityMissing && measuredVideoSeconds < AYAS_COURSE_UDEMY_MINIMUM_POLICY.videoSeconds) issues.push("UDEMY_MINIMUM_VIDEO_DURATION_NOT_MET");
  const review = m.ownerQualityReview;
  if (review !== null && (!isAyasRevenuePlainRecord(review) || !hasExactAyasRevenueKeys(review, ["source", "planDigest", "assetRowsDigest", "policyChecklistDigest", "reviewedAt", "pass"])
    || review.source !== "OWNER_INPUT" || review.planDigest !== plan.planDigest || review.assetRowsDigest !== digestAyasRevenueData(m.lessons) || !isAyasRevenueDigest(review.policyChecklistDigest)
    || !isAyasRevenueTimestamp(review.reviewedAt) || review.reviewedAt > now || review.reviewedAt < latestMediaReview || typeof review.pass !== "boolean")) return null;
  if (qualityMissing) issues.push("MEDIA_VALIDATION_MISSING");
  if (review === null || review.pass !== true) issues.push("OWNER_POLICY_REVIEW_REQUIRED");
  const state: AyasCourseReadiness = plan.state === "DRAFT" ? "DRAFT" : missingMedia ? "CONTENT_READY" : qualityMissing ? "MEDIA_READY"
    : issues.length > 0 ? "QUALITY_REVIEW_REQUIRED" : "OWNER_UPLOAD_READY";
  const manifestDigest = digestAyasRevenueData(m); if (manifestDigest === null) return null;
  return deepFreezeAyasRevenueValue({ state, planDigest: plan.planDigest, manifestDigest, issues,
    handoff: state === "OWNER_UPLOAD_READY" ? { planDigest: plan.planDigest, manifestDigest, ownerMustUpload: true,
      checklist: ["VERIFY_EXACT_ASSET_BYTES", "VERIFY_RIGHTS_AND_GENERATED_MEDIA", "CURRENT_UDEMY_POLICY_AND_LANDING_PAGE", "OWNER_UPLOAD_AND_PUBLISH", "SEPARATE_PUBLICATION_OBSERVATION"] } : null,
    publicationEvidence: null, publication: "CLOSED", authority: "NONE", opensFiles: false });
}
/** Owner observation is unverified evidence, not an authenticated platform certification. No direct state setter. */
export function observeAyasCoursePublication(rawPlan: unknown, rawManifest: unknown, rawEvidence: unknown, now: string): AyasCourseReadinessResult | null {
  const manifest = snapshotAyasCourseValue(rawManifest), readiness = evaluateAyasCourseAssetManifest(rawPlan, manifest, now), e = snapshotAyasCourseValue(rawEvidence);
  if (readiness?.state !== "OWNER_UPLOAD_READY" || !isAyasRevenuePlainRecord(e) || !hasExactAyasRevenueKeys(e, ["source", "planDigest", "manifestDigest", "courseRefDigest", "observedAt", "evidenceDigest"])
    || e.source !== "OWNER_INPUT" || e.planDigest !== readiness.planDigest || e.manifestDigest !== readiness.manifestDigest || !isAyasRevenueDigest(e.courseRefDigest)
    || !isAyasRevenueDigest(e.evidenceDigest) || !isAyasRevenueTimestamp(e.observedAt) || e.observedAt > now
    || !isAyasRevenuePlainRecord(manifest) || !isAyasRevenuePlainRecord(manifest.ownerQualityReview) || e.observedAt < (manifest.ownerQualityReview.reviewedAt as string)) return null;
  return deepFreezeAyasRevenueValue({ ...readiness, state: "OWNER_PUBLISHED_CONFIRMED", publicationEvidence: { ...e, verification: "OWNER_REPORTED_UNVERIFIED" } });
}
