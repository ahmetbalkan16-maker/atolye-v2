/** Synthetic plans, asset references and receipts only. No files, learners or platform account. */
import { digestAyasRevenueData } from "../../src/lib/ayas/revenue/AyasRevenueDigest";
import { buildAyasCourseProductionPlan } from "../../src/lib/ayas/revenue/content/AyasCourseProductionPlan";
export const COURSE_NOW = "2026-10-03T12:00:00.000Z";
export const courseDigest = (label: string) => digestAyasRevenueData({ synthetic: label })!;
export function coursePlan() {
  return { schemaVersion: "1", courseId: "crs_workshop", version: 1, title: "Organize a visual story", targetLearner: "Beginner visual storytellers", prerequisites: ["Basic file organization"],
    sourceEvidenceDigests: [courseDigest("source")], outcomes: [{ outcomeId: "out_structure", description: "Build a clear sequence" }],
    sections: [{ sectionId: "sec_foundation", order: 1, title: "Story foundations", lessons: ["lsn_intro", "lsn_practice", "lsn_sequence", "lsn_apply", "lsn_recap"].map((lessonId, i) => ({ lessonId, order: i + 1,
      title: i === 0 ? "Sequence basics" : "Apply a sequence", durationSeconds: 360, outcomeIds: ["out_structure"], script: "Explain the sequence and demonstrate a worked example.",
      visualPlan: ["Show the sequence diagram"], mediaPolicy: "REAL_ONLY", generatedPolicyDigest: null, exercise: "Arrange the supplied frames in a clear order.",
      downloads: [{ resourceId: ["res_notes", "res_exercise", "res_sequence", "res_apply", "res_recap"][i]!, description: "Workshop notes" }], rightsEvidenceDigest: courseDigest("rights-" + lessonId),
      captionLanguage: "en", claimClass: "GENERAL", qualifiedClaimReviewDigest: null })) }] };
}
export function courseManifest(p = coursePlan()) {
  const plan = buildAyasCourseProductionPlan(p)!;
  const rows = p.sections.flatMap(s => s.lessons).map(l => {
    const root = `courses/${p.courseId}/${l.lessonId}`, script = digestAyasRevenueData({ script: l.script });
    const video = { pathRef: root + "/video.mp4", digest: courseDigest(l.lessonId + "-video") }, audio = { pathRef: root + "/audio.wav", digest: courseDigest(l.lessonId + "-audio") },
      caption = { pathRef: root + "/captions-en.vtt", digest: courseDigest(l.lessonId + "-caption") };
    return { lessonId: l.lessonId, sourceScriptDigest: script, video, audio, caption,
      downloads: l.downloads.map(r => ({ resourceId: r.resourceId, asset: { pathRef: root + "/" + r.resourceId + ".pdf", digest: courseDigest(r.resourceId) } })),
      rightsEvidenceDigest: l.rightsEvidenceDigest, validation: { source: "MEDIA_COLLECTOR", reviewedAt: COURSE_NOW, receiptDigest: courseDigest(l.lessonId + "-qa"),
        videoDigest: video.digest, audioDigest: audio.digest, captionDigest: caption.digest, scriptDigest: script, audioIntelligible: true, captionsComplete: true, visualQuality: true, rightsPass: true,
        videoSeconds: 360, videoWidth: 1280, videoHeight: 720, audioChannels: 2, audioVideoSync: true, dynamicVisuals: true } };
  });
  return { schemaVersion: "1", planDigest: plan.planDigest, version: 1, lessons: rows,
    ownerQualityReview: { source: "OWNER_INPUT", planDigest: plan.planDigest, assetRowsDigest: digestAyasRevenueData(rows), policyChecklistDigest: courseDigest("platform-policy"), reviewedAt: COURSE_NOW, pass: true } };
}
