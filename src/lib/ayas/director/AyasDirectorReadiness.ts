import {
  classifyMediaRightsStatus,
  isProductionAdmissibleRightsStatus,
} from "../../assets/MediaRightsPolicy";
import type { MediaRightsStatus } from "../../../types/asset";

/**
 * Stage 12 is advisory. These values describe evidence supplied by existing
 * project artifacts or an owner; they never authorize a render or a download.
 */
export type DirectorFormat = "DOCUMENTARY" | "GENERAL";
export type DirectorMediaClass =
  | "REAL_PHOTO" | "ARCHIVAL_PHOTO" | "REAL_VIDEO" | "ARCHIVAL_VIDEO"
  | "MAP" | "DOCUMENT" | "ILLUSTRATION" | "GENERATED_IMAGE"
  | "ANIMATION" | "DIAGRAM" | "TEXT_CARD" | "B_ROLL" | "TRANSITION";
export type DirectorMediaOrigin = "REAL" | "GENERATED" | "UNKNOWN";
export type DirectorBeat =
  | "HOOK" | "CONTEXT" | "SETUP" | "CONFLICT" | "PROGRESSION"
  | "CLIMAX" | "RESOLUTION" | "AFTERMATH" | "CONCLUSION" | "OTHER";
export type DirectorMotion =
  | "STATIC_HOLD" | "SLOW_PUSH" | "PAN" | "REVEAL" | "CROP_SHIFT"
  | "PARALLAX" | "DOCUMENT_SCAN" | "MAP_MOVEMENT" | "SOURCE_VIDEO";
export type DirectorSourceQuality =
  | "PRIMARY_INSTITUTION" | "ESTABLISHED_SOURCE" | "OWNER_SOURCE" | "UNKNOWN";
export type DirectorRights =
  | "PUBLIC_DOMAIN" | "OPEN_LICENSE" | "OWNER_VERIFIED"
  | "GENERATED" | "RESEARCH_REFERENCE_ONLY" | "RIGHTS_UNKNOWN" | "DO_NOT_USE";
export type DirectorReadiness =
  | "NOT_READY" | "MEDIA_INCOMPLETE" | "RIGHTS_BLOCKED" | "AUDIO_INCOMPLETE"
  | "VISUAL_REVIEW_REQUIRED" | "ASSEMBLY_READY" | "OWNER_REVIEW_READY";
export type DirectorDependencyState =
  | "CODE_READY" | "HOST_BLOCKED" | "PROVIDER_BLOCKED" | "DATA_BLOCKED"
  | "UNVERIFIED";
export type DirectorGate = "PASS" | "REVIEW_REQUIRED" | "BLOCKED";
export type DirectorDimension =
  | "NARRATIVE_COHERENCE" | "SCENE_PURPOSE" | "MEDIA_RELEVANCE"
  | "FACTUAL_ALIGNMENT" | "MEDIA_PROVENANCE" | "VISUAL_VARIETY"
  | "MOTION_APPROPRIATENESS" | "AUDIO_ALIGNMENT" | "PACING"
  | "CONTINUITY" | "SOURCE_QUALITY" | "RIGHTS_READINESS"
  | "ASSEMBLY_READINESS";
export type DirectorFindingCode =
  | "INPUT_LIMIT_EXCEEDED" | "DUPLICATE_ID"
  | "SCENE_PURPOSE_MISSING" | "CHRONOLOGY_BREAK" | "TRANSITION_MISSING"
  | "BEAT_ORDER_BREAK" | "NARRATIVE_REPETITION"
  | "MEDIA_INCOMPLETE" | "MEDIA_MISMATCH" | "WRONG_TIME_PERIOD"
  | "WRONG_LOCATION" | "RIGHTS_UNKNOWN" | "RIGHTS_RESTRICTED"
  | "SOURCE_UNVERIFIED" | "FACTUAL_SOURCE_MISSING" | "SYNTHETIC_UNLABELED"
  | "MEDIA_ORIGIN_CONFLICT"
  | "LOW_RESOLUTION" | "VISUAL_REPETITION" | "SCENE_TOO_LONG"
  | "SCENE_TOO_SHORT" | "MOTION_UNSUITABLE" | "CLIP_UNSUITABLE"
  | "NARRATION_VISUAL_MISMATCH" | "AUDIO_DURATION_MISMATCH"
  | "AUDIO_INCOMPLETE" | "AUDIO_UNVERIFIED" | "HOST_DEPENDENCY_MISSING"
  | "PROVIDER_UNAVAILABLE" | "ASSEMBLY_BLOCKED";

export interface DirectorScene {
  readonly id: number;
  readonly title: string;
  readonly purpose?: string;
  readonly beat?: DirectorBeat;
  readonly narration?: string;
  readonly visualObjective?: string;
  readonly subject?: string;
  readonly location?: string;
  readonly period?: string;
  readonly chronologyIndex?: number;
  readonly transitionFromPrevious?: string;
  readonly targetDurationSeconds?: number;
  readonly audioDurationSeconds?: number;
  readonly audioStatus?: "READY" | "MISSING" | "UNKNOWN";
  readonly requiredEvidence?: boolean;
  readonly sourceReferences?: readonly string[];
  readonly preferredMedia?: readonly DirectorMediaClass[];
  readonly selectedCandidateId?: string;
  readonly motion?: DirectorMotion;
  readonly reconstructionLabeled?: boolean;
}

export interface DirectorMediaCandidate {
  readonly id: string;
  readonly mediaClass: DirectorMediaClass;
  readonly origin: DirectorMediaOrigin;
  readonly title: string;
  readonly subjects?: readonly string[];
  readonly location?: string;
  readonly period?: string;
  readonly sourceUrl?: string;
  readonly sourceOrganization?: string;
  readonly sourceQuality?: DirectorSourceQuality;
  readonly sourceQualityEvidence?: string;
  readonly creator?: string;
  readonly license?: string;
  /** Only an explicit owner/out-of-band record can assert this. */
  readonly ownerRightsVerified?: boolean;
  readonly ownerRightsEvidence?: string;
  readonly attribution?: string;
  readonly width?: number;
  readonly height?: number;
  readonly durationSeconds?: number;
  readonly segmentStartSeconds?: number;
  readonly segmentEndSeconds?: number;
  readonly availableForProduction?: boolean;
}

export interface DirectorTask {
  readonly projectId: string;
  readonly topic: string;
  readonly format: DirectorFormat;
  readonly audience?: string;
  readonly objective?: string;
  readonly tone?: string;
  readonly targetDurationSeconds?: number;
  readonly pacingProfile?: "CONTEMPLATIVE" | "BALANCED" | "BRISK";
  readonly scenes: readonly DirectorScene[];
  readonly candidates: readonly DirectorMediaCandidate[];
  readonly host: {
    readonly ffmpeg: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
    readonly ffprobe: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  };
  readonly provider: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  readonly assembly?: {
    readonly sceneOrder?: readonly number[];
    readonly durationSeconds?: number;
    readonly hasAudioTrack?: boolean;
    readonly width?: number;
    readonly height?: number;
  };
}

export interface DirectorFinding {
  readonly code: DirectorFindingCode;
  readonly dimension: DirectorDimension;
  readonly severity: "BLOCKER" | "MAJOR" | "REVIEW";
  readonly sceneId: number | null;
  readonly evidence: string;
  readonly recommendation: string;
}

export interface DirectorRecommendation {
  readonly sceneId: number;
  readonly candidateId: string | null;
  readonly mediaClass: DirectorMediaClass | null;
  readonly reason: string;
  readonly action: "KEEP" | "REPLACE" | "SOURCE" | "OWNER_REVIEW";
}

export interface DirectorReview {
  readonly projectId: string;
  readonly dimensions: readonly DirectorDimension[];
  readonly findings: readonly DirectorFinding[];
  readonly recommendations: readonly DirectorRecommendation[];
  readonly readiness: DirectorReadiness;
  readonly dependencyState: DirectorDependencyState;
  readonly preAssemblyGate: DirectorGate;
  readonly postAssemblyGate: DirectorGate | "NOT_EVALUATED";
  readonly scenesReviewed: number;
  readonly selectedMediaCount: number;
  readonly authority: "ADVISORY_ONLY";
}

const dimensions: readonly DirectorDimension[] = [
  "NARRATIVE_COHERENCE", "SCENE_PURPOSE", "MEDIA_RELEVANCE",
  "FACTUAL_ALIGNMENT", "MEDIA_PROVENANCE", "VISUAL_VARIETY",
  "MOTION_APPROPRIATENESS", "AUDIO_ALIGNMENT", "PACING", "CONTINUITY",
  "SOURCE_QUALITY", "RIGHTS_READINESS", "ASSEMBLY_READINESS",
];
const videoClasses = new Set<DirectorMediaClass>(["REAL_VIDEO", "ARCHIVAL_VIDEO", "B_ROLL"]);
const stillClasses = new Set<DirectorMediaClass>([
  "REAL_PHOTO", "ARCHIVAL_PHOTO", "MAP", "DOCUMENT", "ILLUSTRATION",
  "GENERATED_IMAGE", "DIAGRAM", "TEXT_CARD",
]);
/** Classes that assert a real capture; a generated item cannot claim them. */
const evidenceClasses = new Set<DirectorMediaClass>([
  "REAL_PHOTO", "ARCHIVAL_PHOTO", "REAL_VIDEO", "ARCHIVAL_VIDEO", "DOCUMENT", "B_ROLL",
]);
/** Explanatory graphics that cannot pass as a depiction of the past. */
const nonDepictiveClasses = new Set<DirectorMediaClass>(["DIAGRAM", "TEXT_CARD", "TRANSITION"]);
const stopWords = new Set([
  "the", "and", "for", "with", "from", "this", "that", "into", "was", "were",
  "bir", "ve", "ile", "için", "icin", "olan", "olarak", "bu", "şu", "su",
  "scene", "sahne", "image", "görsel", "gorsel", "photo", "fotoğraf", "fotograf",
]);

export function classifyDirectorRights(candidate: DirectorMediaCandidate): {
  readonly status: DirectorRights;
  readonly policyStatus: MediaRightsStatus | null;
} {
  if (candidate.origin === "GENERATED") return { status: "GENERATED", policyStatus: null };
  if (candidate.mediaClass === "GENERATED_IMAGE" && candidate.origin === "REAL") {
    return { status: "RIGHTS_UNKNOWN", policyStatus: null };
  }
  if (candidate.origin !== "REAL") return { status: "RIGHTS_UNKNOWN", policyStatus: null };
  if (candidate.ownerRightsVerified && candidate.sourceUrl && candidate.ownerRightsEvidence?.trim()) {
    return { status: "OWNER_VERIFIED", policyStatus: "verified" };
  }
  const policyStatus = classifyMediaRightsStatus(candidate.license);
  if (!candidate.sourceUrl) return { status: "RIGHTS_UNKNOWN", policyStatus };
  if (policyStatus === "public-domain") return { status: "PUBLIC_DOMAIN", policyStatus };
  if (policyStatus === "open-license") return { status: "OPEN_LICENSE", policyStatus };
  if (policyStatus === "restricted") return { status: "DO_NOT_USE", policyStatus };
  return { status: "RIGHTS_UNKNOWN", policyStatus };
}

export function reviewAtolyeDirectorTask(task: DirectorTask): DirectorReview {
  const findings: DirectorFinding[] = [];
  const recommendations: DirectorRecommendation[] = [];
  if (task.scenes.length > 200 || task.candidates.length > 1_000) {
    return {
      projectId: task.projectId, dimensions,
      findings: [{
        code: "INPUT_LIMIT_EXCEEDED", dimension: "ASSEMBLY_READINESS",
        severity: "BLOCKER", sceneId: null,
        evidence: `${task.scenes.length} scenes and ${task.candidates.length} candidates exceed the bounded review input`,
        recommendation: "Split the review into bounded project sections.",
      }],
      recommendations, readiness: "NOT_READY", dependencyState: "DATA_BLOCKED",
      preAssemblyGate: "BLOCKED", postAssemblyGate: "NOT_EVALUATED",
      scenesReviewed: 0, selectedMediaCount: 0, authority: "ADVISORY_ONLY",
    };
  }
  const candidateById = new Map(task.candidates.map((candidate) => [candidate.id, candidate]));
  const used = new Map<string, number>();
  const add = (
    code: DirectorFindingCode, dimension: DirectorDimension,
    severity: DirectorFinding["severity"], sceneId: number | null,
    evidence: string, recommendation: string,
  ) => findings.push({ code, dimension, severity, sceneId, evidence, recommendation });

  if (candidateById.size !== task.candidates.length
    || new Set(task.scenes.map((scene) => scene.id)).size !== task.scenes.length) {
    add("DUPLICATE_ID", "ASSEMBLY_READINESS", "BLOCKER", null,
      "Duplicate scene or candidate identity", "Resolve duplicate IDs before review.");
  }

  if (task.host.ffmpeg === "UNAVAILABLE" || task.host.ffprobe === "UNAVAILABLE") {
    add("HOST_DEPENDENCY_MISSING", "ASSEMBLY_READINESS", "BLOCKER", null,
      "ffmpeg or ffprobe is unavailable", "Install or select an available host before production.");
  }
  if (task.provider === "UNAVAILABLE") {
    add("PROVIDER_UNAVAILABLE", "ASSEMBLY_READINESS", "BLOCKER", null,
      "Required production provider is unavailable", "Use the existing provider configuration and owner approval path.");
  }

  let previous: DirectorScene | undefined;
  for (const scene of task.scenes) {
    if (!scene.purpose?.trim()) {
      add("SCENE_PURPOSE_MISSING", "SCENE_PURPOSE", "REVIEW", scene.id,
        "No explicit narrative purpose", "Record why this scene belongs in the story.");
    }
    if (previous) {
      if (number(previous.chronologyIndex) && number(scene.chronologyIndex)
        && scene.chronologyIndex! < previous.chronologyIndex!) {
        add("CHRONOLOGY_BREAK", "NARRATIVE_COHERENCE", "MAJOR", scene.id,
          `Chronology index ${previous.chronologyIndex} → ${scene.chronologyIndex}`,
          "Confirm an intentional flashback or restore chronology.");
      }
      if (previous.location && scene.location && !sameText(previous.location, scene.location)
        && !scene.transitionFromPrevious?.trim()) {
        add("TRANSITION_MISSING", "CONTINUITY", "REVIEW", scene.id,
          `Location ${bounded(previous.location)} → ${bounded(scene.location)} without transition`,
          "Add a location transition or explain the cut.");
      }
      if (task.format === "DOCUMENTARY" && previous.beat && scene.beat
        && beatOrder(previous.beat) > beatOrder(scene.beat)
        && !scene.transitionFromPrevious?.trim()) {
        add("BEAT_ORDER_BREAK", "NARRATIVE_COHERENCE", "REVIEW", scene.id,
          `Narrative beat ${previous.beat} → ${scene.beat} without transition`,
          "Explain the flashback or restore narrative progression.");
      }
      const previousTerms = tokens(previous.narration ?? "").join(" ");
      if (previousTerms && previousTerms === tokens(scene.narration ?? "").join(" ")) {
        add("NARRATIVE_REPETITION", "NARRATIVE_COHERENCE", "REVIEW", scene.id,
          "Adjacent scenes repeat the same narration terms",
          "Remove repetition or state the new information in this scene.");
      }
    }
    previous = scene;

    const selected = scene.selectedCandidateId
      ? candidateById.get(scene.selectedCandidateId) : undefined;
    const recommended = recommendCandidate(scene, task);
    recommendations.push({
      sceneId: scene.id,
      candidateId: recommended?.id ?? null,
      mediaClass: recommended?.mediaClass ?? null,
      reason: recommended ? recommendationReason(scene, recommended, task.format) : "No evidenced suitable candidate",
      action: !selected ? (recommended ? "SOURCE" : "OWNER_REVIEW")
        : recommended?.id === selected.id ? "KEEP" : recommended ? "REPLACE" : "OWNER_REVIEW",
    });
    if (!selected || selected.availableForProduction === false) {
      add("MEDIA_INCOMPLETE", "ASSEMBLY_READINESS", "BLOCKER", scene.id,
        !selected
          ? scene.selectedCandidateId ? "Selected asset id is absent from evidence" : "No selected production asset"
          : "Selected item is research-only or not a generated production asset",
        "Bind a verified asset through the existing production path.");
    } else {
      used.set(selected.id, (used.get(selected.id) ?? 0) + 1);
      if (originConflict(selected)) {
        add("MEDIA_ORIGIN_CONFLICT", "MEDIA_PROVENANCE", "BLOCKER", scene.id,
          `Asset ${bounded(selected.id)} origin and media class disagree`,
          "Correct the source classification from the producing artifact.");
      }
      const rights = classifyDirectorRights(selected);
      if (rights.status === "RIGHTS_UNKNOWN") {
        add("RIGHTS_UNKNOWN", "RIGHTS_READINESS", "BLOCKER", scene.id,
          `Asset ${bounded(selected.id)} lacks usable source/licence evidence`,
          "Keep as research reference until provenance and rights are established.");
      } else if (rights.status === "DO_NOT_USE") {
        add("RIGHTS_RESTRICTED", "RIGHTS_READINESS", "BLOCKER", scene.id,
          `Asset ${bounded(selected.id)} has a restricted licence`,
          "Replace the asset or obtain explicit rights evidence.");
      }
      if (needsReconstructionLabel(selected, task.format) && !scene.reconstructionLabeled) {
        add("SYNTHETIC_UNLABELED", "FACTUAL_ALIGNMENT", "MAJOR", scene.id,
          `Generated asset ${bounded(selected.id)} lacks reconstruction labeling`,
          "Label the image as a reconstruction where documentary evidence could be inferred.");
      }
      if (selected.origin === "REAL"
        && (!selected.sourceUrl || !selected.sourceQualityEvidence?.trim()
          || selected.sourceQuality === "UNKNOWN")) {
        add("SOURCE_UNVERIFIED", "SOURCE_QUALITY", "REVIEW", scene.id,
          `Asset ${bounded(selected.id)} source quality cannot be established`,
          "Review the source page and organization before use.");
      }
      if (scene.period && selected.period && !sameText(scene.period, selected.period)) {
        add("WRONG_TIME_PERIOD", "FACTUAL_ALIGNMENT", "MAJOR", scene.id,
          `Scene period ${bounded(scene.period)} ≠ asset period ${bounded(selected.period)}`,
          "Replace the media or document why the different period is intentional.");
      }
      if (scene.location && selected.location && !sameText(scene.location, selected.location)) {
        add("WRONG_LOCATION", "FACTUAL_ALIGNMENT", "MAJOR", scene.id,
          `Scene location ${bounded(scene.location)} ≠ asset location ${bounded(selected.location)}`,
          "Select media from the correct location or label the contextual use.");
      }
      const match = subjectOverlap(scene, selected);
      if (match === 0 && hasSpecificSubject(scene)) {
        add("MEDIA_MISMATCH", "MEDIA_RELEVANCE", "MAJOR", scene.id,
          `No subject terms shared with asset ${bounded(selected.id)}`,
          "Review a candidate matching the scene's named subject.");
      }
      if (scene.narration && scene.visualObjective
        && overlap(scene.narration, [selected.title, ...(selected.subjects ?? [])].join(" ")) === 0
        && match === 0) {
        add("NARRATION_VISUAL_MISMATCH", "AUDIO_ALIGNMENT", "REVIEW", scene.id,
          `Narration and asset ${bounded(selected.id)} share no specific terms`,
          "Check the image against the spoken segment.");
      }
      if (stillClasses.has(selected.mediaClass)
        && number(selected.width) && number(selected.height)
        && (selected.width! < 1280 || selected.height! < 720)) {
        add("LOW_RESOLUTION", "ASSEMBLY_READINESS", "MAJOR", scene.id,
          `Asset ${bounded(selected.id)} is ${selected.width}×${selected.height}`,
          "Use a higher-resolution source or a smaller crop.");
      }
      if (videoClasses.has(selected.mediaClass)) {
        const clipDuration = segmentDuration(selected);
        if (!clipDuration || clipDuration < 2 || clipDuration > 45
          || (number(scene.targetDurationSeconds) && clipDuration > scene.targetDurationSeconds! * 2)) {
          add("CLIP_UNSUITABLE", "MEDIA_RELEVANCE", "REVIEW", scene.id,
            `Asset ${bounded(selected.id)} usable clip duration is ${clipDuration ?? "unknown"} s`,
            "Choose a bounded segment aligned to this scene.");
        }
      }
      if (scene.motion && !motionFits(scene.motion, selected.mediaClass)) {
        add("MOTION_UNSUITABLE", "MOTION_APPROPRIATENESS", "MAJOR", scene.id,
          `${scene.motion} does not fit ${selected.mediaClass}`,
          "Use a static hold or a motion appropriate to the media and composition.");
      }
      if (number(scene.targetDurationSeconds) && stillClasses.has(selected.mediaClass)
        && scene.targetDurationSeconds! > 25 && scene.motion === "STATIC_HOLD") {
        add("SCENE_TOO_LONG", "PACING", "REVIEW", scene.id,
          `${scene.targetDurationSeconds} s on one static still`,
          "Add a meaningful visual change or shorten the scene.");
      }
      if (number(scene.targetDurationSeconds) && ["MAP", "DOCUMENT"].includes(selected.mediaClass)
        && scene.targetDurationSeconds! < 6) {
        add("SCENE_TOO_SHORT", "PACING", "REVIEW", scene.id,
          `${scene.targetDurationSeconds} s for ${selected.mediaClass}`,
          "Allow enough reading time for the map or document.");
      }
    }
    if (scene.requiredEvidence && !(scene.sourceReferences?.some((ref) => ref.trim()))) {
      add("FACTUAL_SOURCE_MISSING", "FACTUAL_ALIGNMENT", "MAJOR", scene.id,
        "Factual scene has no cited source reference", "Attach the factual source before owner review.");
    }
    if (scene.audioStatus === "MISSING") {
      add("AUDIO_INCOMPLETE", "AUDIO_ALIGNMENT", "BLOCKER", scene.id,
        "Narration audio is missing", "Complete the existing audio stage.");
    } else if (scene.audioStatus !== "READY") {
      add("AUDIO_UNVERIFIED", "AUDIO_ALIGNMENT", "REVIEW", scene.id,
        "No evidence that this scene's narration audio is complete",
        "Confirm the scene audio through the existing audio stage.");
    }
    if (number(scene.audioDurationSeconds) && number(scene.targetDurationSeconds)
      && Math.abs(scene.audioDurationSeconds! - scene.targetDurationSeconds!)
        > Math.max(3, scene.targetDurationSeconds! * 0.2)) {
      add("AUDIO_DURATION_MISMATCH", "AUDIO_ALIGNMENT", "MAJOR", scene.id,
        `Audio ${scene.audioDurationSeconds} s vs scene ${scene.targetDurationSeconds} s`,
        "Review narration pacing and scene timing.");
    }
  }
  for (const [id, count] of used) {
    if (count >= 3) add("VISUAL_REPETITION", "VISUAL_VARIETY", "REVIEW", null,
      `Asset ${bounded(id)} used in ${count} scenes`,
      "Review visual repetition and use distinct evidenced media where useful.");
  }
  const selectedMediaCount = task.scenes.filter((scene) =>
    scene.selectedCandidateId
      && candidateById.has(scene.selectedCandidateId)
      && candidateById.get(scene.selectedCandidateId)?.availableForProduction !== false).length;
  const dependencyState: DirectorDependencyState =
    findings.some((f) => f.code === "HOST_DEPENDENCY_MISSING") ? "HOST_BLOCKED"
      : findings.some((f) => f.code === "PROVIDER_UNAVAILABLE") ? "PROVIDER_BLOCKED"
        : selectedMediaCount !== task.scenes.length ? "DATA_BLOCKED"
          : task.host.ffmpeg === "UNKNOWN" || task.host.ffprobe === "UNKNOWN"
            || task.provider === "UNKNOWN" ? "UNVERIFIED" : "CODE_READY";
  const postAssemblyGate = reviewAssembly(task, add);
  const readiness: DirectorReadiness =
    task.scenes.length === 0 ? "NOT_READY"
      : findings.some((f) => f.code === "RIGHTS_UNKNOWN" || f.code === "RIGHTS_RESTRICTED")
        ? "RIGHTS_BLOCKED"
        : selectedMediaCount !== task.scenes.length ? "MEDIA_INCOMPLETE"
          : findings.some((f) => f.code === "AUDIO_INCOMPLETE") ? "AUDIO_INCOMPLETE"
            : findings.some((f) => f.severity !== "REVIEW") || postAssemblyGate === "BLOCKED"
              ? "VISUAL_REVIEW_REQUIRED"
              : findings.length || task.host.ffmpeg !== "AVAILABLE"
                || task.host.ffprobe !== "AVAILABLE" || task.provider !== "AVAILABLE"
                ? "VISUAL_REVIEW_REQUIRED"
                : postAssemblyGate === "PASS" ? "OWNER_REVIEW_READY" : "ASSEMBLY_READY";
  const preAssemblyGate: DirectorGate =
    readiness === "ASSEMBLY_READY" || readiness === "OWNER_REVIEW_READY" ? "PASS"
      : findings.some((f) => f.severity === "BLOCKER") || task.scenes.length === 0
        ? "BLOCKED" : "REVIEW_REQUIRED";
  return {
    projectId: task.projectId,
    dimensions, findings, recommendations, readiness, dependencyState,
    preAssemblyGate, postAssemblyGate, scenesReviewed: task.scenes.length,
    selectedMediaCount, authority: "ADVISORY_ONLY",
  };
}

function reviewAssembly(
  task: DirectorTask,
  add: (code: DirectorFindingCode, dimension: DirectorDimension,
    severity: DirectorFinding["severity"], sceneId: number | null,
    evidence: string, recommendation: string) => void,
): DirectorReview["postAssemblyGate"] {
  if (!task.assembly) return "NOT_EVALUATED";
  const expected = task.scenes.map((scene) => scene.id);
  if (!task.assembly.sceneOrder || task.assembly.sceneOrder.join(",") !== expected.join(",")
    || task.assembly.hasAudioTrack !== true || !number(task.assembly.durationSeconds)
    || !number(task.assembly.width) || !number(task.assembly.height)) {
    add("ASSEMBLY_BLOCKED", "ASSEMBLY_READINESS", "BLOCKER", null,
      "Assembly metadata lacks ordered scenes, audio, duration or dimensions",
      "Inspect the completed assembly artifact before owner review.");
    return "BLOCKED";
  }
  return "PASS";
}

function recommendCandidate(
  scene: DirectorScene,
  task: DirectorTask,
): DirectorMediaCandidate | undefined {
  return task.candidates
    .filter((candidate) => {
      if (candidate.availableForProduction === false) return false;
      if (originConflict(candidate)) return false;
      const rights = classifyDirectorRights(candidate);
      if (candidate.origin === "REAL"
        && (!rights.policyStatus || !isProductionAdmissibleRightsStatus(rights.policyStatus))) return false;
      if (candidate.origin === "REAL" && (!candidate.sourceUrl
        || !candidate.sourceQualityEvidence?.trim())) return false;
      if (candidate.origin === "UNKNOWN") return false;
      if (scene.period && candidate.period && !sameText(scene.period, candidate.period)) return false;
      if (scene.location && candidate.location && !sameText(scene.location, candidate.location)) return false;
      if (hasSpecificSubject(scene) && subjectOverlap(scene, candidate) === 0) return false;
      if (needsReconstructionLabel(candidate, task.format) && !scene.reconstructionLabeled) return false;
      return true;
    })
    .sort((a, b) => candidateRank(scene, b, task.format) - candidateRank(scene, a, task.format)
      || a.id.localeCompare(b.id))[0];
}

function candidateRank(scene: DirectorScene, candidate: DirectorMediaCandidate, format: DirectorFormat): number {
  const preferred = scene.preferredMedia?.indexOf(candidate.mediaClass) ?? -1;
  const relevance = subjectOverlap(scene, candidate);
  const source = !candidate.sourceQualityEvidence?.trim() ? 0
    : candidate.sourceQuality === "PRIMARY_INSTITUTION" ? 3
      : candidate.sourceQuality === "ESTABLISHED_SOURCE" ? 2 : 0;
  const real = format === "DOCUMENTARY" && candidate.origin === "REAL" ? 2 : 0;
  return (preferred >= 0 ? 30 - preferred * 5 : 0) + relevance * 4 + source + real;
}

function recommendationReason(
  scene: DirectorScene, candidate: DirectorMediaCandidate, format: DirectorFormat,
): string {
  const preference = scene.preferredMedia?.includes(candidate.mediaClass) ? "requested class" : "contextual class";
  return `${candidate.mediaClass}: ${preference}; ${format.toLowerCase()} evidence and rights checked`;
}

function originConflict(candidate: DirectorMediaCandidate): boolean {
  return (candidate.origin === "GENERATED" && evidenceClasses.has(candidate.mediaClass))
    || (candidate.origin === "REAL" && candidate.mediaClass === "GENERATED_IMAGE");
}

function needsReconstructionLabel(candidate: DirectorMediaCandidate, format: DirectorFormat): boolean {
  return candidate.origin === "GENERATED" && format === "DOCUMENTARY"
    && !nonDepictiveClasses.has(candidate.mediaClass);
}

function motionFits(motion: DirectorMotion, kind: DirectorMediaClass): boolean {
  if (videoClasses.has(kind)) return motion === "SOURCE_VIDEO" || motion === "STATIC_HOLD";
  if (motion === "SOURCE_VIDEO") return kind === "ANIMATION" || kind === "TRANSITION";
  if (kind === "DOCUMENT") return motion === "DOCUMENT_SCAN" || motion === "STATIC_HOLD";
  if (kind === "MAP") {
    return motion === "MAP_MOVEMENT" || motion === "STATIC_HOLD"
      || motion === "SLOW_PUSH" || motion === "REVEAL";
  }
  if (kind === "TEXT_CARD") return motion === "STATIC_HOLD";
  return true;
}

function beatOrder(beat: DirectorBeat): number {
  switch (beat) {
    case "HOOK": return 0;
    case "CONTEXT": return 1;
    case "SETUP": return 2;
    case "CONFLICT": return 3;
    case "PROGRESSION": return 4;
    case "CLIMAX": return 5;
    case "RESOLUTION": return 6;
    case "AFTERMATH": return 7;
    case "CONCLUSION": return 8;
    default: return 4;
  }
}

function segmentDuration(candidate: DirectorMediaCandidate): number | null {
  if (candidate.segmentStartSeconds !== undefined && candidate.segmentStartSeconds >= 0
    && number(candidate.segmentEndSeconds)) {
    const length = candidate.segmentEndSeconds! - candidate.segmentStartSeconds!;
    return length > 0 && (!number(candidate.durationSeconds)
      || candidate.segmentEndSeconds! <= candidate.durationSeconds!) ? length : null;
  }
  return number(candidate.durationSeconds) ? candidate.durationSeconds! : null;
}

function hasSpecificSubject(scene: DirectorScene): boolean {
  return Boolean(scene.subject?.trim()) || tokens(scene.visualObjective ?? "").length >= 2;
}
function subjectOverlap(scene: DirectorScene, candidate: DirectorMediaCandidate): number {
  return overlap(
    [scene.subject, scene.visualObjective, scene.title].filter(Boolean).join(" "),
    [candidate.title, ...(candidate.subjects ?? [])].join(" "),
  );
}
function overlap(left: string, right: string): number {
  const terms = new Set(tokens(left));
  return tokens(right).filter((word) => terms.has(word)).length;
}
function tokens(value: string): string[] {
  return [...new Set(fold(value.slice(0, 2_000)).match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((word) => word.length >= 3 && !stopWords.has(word));
}
function sameText(left: string, right: string): boolean {
  return fold(left.trim()) === fold(right.trim());
}
/** Turkish sources and English archive metadata must agree: İ/I/ı/i and ş/s etc. fold together. */
function fold(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ı/g, "i");
}
function number(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function bounded(value: string): string {
  return value.replace(/[\r\n\t]/g, " ").slice(0, 120);
}
