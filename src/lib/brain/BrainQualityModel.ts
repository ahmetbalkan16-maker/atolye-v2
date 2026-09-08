/**
 * Atölye Brain — Quality Judge (sections 6 + 11 of the emir).
 *
 * "Video oluşturulduktan sonra Brain işi bitmiş kabul etmesin." This module
 * scores a finished render across the dimensions the emir lists (a/v sync,
 * silence, loudness, scene durations, visual↔script relation, repeated visuals,
 * dark frames, resolution, fps, codec, duration, missing assets, subtitle sync,
 * narrative flow, container integrity) and — crucially — maps each failure to
 * the **smallest** regeneration that fixes it, never "the video failed".
 *
 * **Pure.** It takes a structured `BrainFinalRenderReport` (a Phase 6 adapter
 * fills that from `ffprobe` + `ProjectManager`); it runs no binaries itself.
 */

import {
  brainSchemaVersion,
  type BrainFinalRenderReport,
  type BrainQualityDimension,
  type BrainQualityObservation,
  type BrainQualityOutcome,
  type BrainQualityStatus,
  type BrainQualityVerdict,
  type BrainRepairTarget,
} from "@/types/brain";

/**
 * Per-dimension weight in the overall score. `not-evaluated` observations are
 * dropped from the weighted mean entirely (weight 0 at runtime).
 */
const DIMENSION_WEIGHT: Readonly<Record<BrainQualityDimension, number>> = Object.freeze({
  "container-integrity": 5,
  "video-stream": 5,
  "audio-stream": 5,
  "av-sync": 4,
  "duration-band": 3,
  resolution: 2,
  framerate: 2,
  "leading-trailing-silence": 2,
  loudness: 2,
  "scene-duration-fidelity": 3,
  "visual-script-alignment": 4,
  "repeated-visuals": 3,
  "black-or-dark-frames": 4,
  "asset-completeness": 4,
  "subtitle-sync": 1,
  "narrative-flow": 2,
});

/** Broken here → the render is not repairable piece-by-piece; it is a reject. */
const HARD_DIMENSIONS: readonly BrainQualityDimension[] = Object.freeze([
  "container-integrity",
  "video-stream",
  "audio-stream",
]);

const AV_SYNC_WARN_SECONDS = 1.5;
const AV_SYNC_FAIL_SECONDS = 3.5;
const LEADING_SILENCE_WARN = 0.8;
const LEADING_SILENCE_FAIL = 2.0;
const TRAILING_SILENCE_WARN = 2.0;
const TRAILING_SILENCE_FAIL = 4.0;
const DEFAULT_TARGET_LUFS = -14;
const LUFS_WARN = 2.0;
const LUFS_FAIL = 4.0;
const SCENE_DURATION_WARN_RATIO = 0.35;
const SCENE_DURATION_FAIL_RATIO = 0.7;
const DARK_LUMA_FAIL = 16;
const DARK_LUMA_WARN = 32;

const VIDEO_CODECS_OK = new Set(["h264", "avc", "hevc", "h265", "vp9", "av1"]);
const AUDIO_CODECS_OK = new Set(["aac", "mp3", "opus", "vorbis", "pcm_s16le"]);

function obs(
  dimension: BrainQualityDimension,
  status: BrainQualityStatus,
  score: number,
  detail: string,
  evidence: readonly string[] = [],
): BrainQualityObservation {
  return {
    dimension,
    status,
    score: Math.min(1, Math.max(0, score)),
    detail,
    evidence: [...evidence],
  };
}

export function evaluateBrainQuality(
  report: BrainFinalRenderReport,
): BrainQualityVerdict {
  const observations: BrainQualityObservation[] = [];
  const repairs: BrainRepairTarget[] = [];

  /* ---- container ---- */
  const containerOk =
    Boolean(report.container.format) &&
    report.container.durationSeconds > 0 &&
    report.container.sizeBytes > 0;
  observations.push(
    containerOk
      ? obs("container-integrity", "pass", 1, `${report.container.format}, ${report.container.durationSeconds.toFixed(1)} s, ${report.container.sizeBytes} B`)
      : obs("container-integrity", "fail", 0, "container missing format / zero duration / zero size", [
          `format:${report.container.format || "?"}`,
          `duration:${report.container.durationSeconds}`,
        ]),
  );

  /* ---- video stream ---- */
  if (!report.video) {
    observations.push(obs("video-stream", "fail", 0, "no video stream in the container"));
  } else {
    const codecOk = VIDEO_CODECS_OK.has(report.video.codec.toLowerCase());
    const dimsOk = report.video.width > 0 && report.video.height > 0;
    observations.push(
      codecOk && dimsOk
        ? obs("video-stream", "pass", 1, `${report.video.codec} ${report.video.width}×${report.video.height}`)
        : obs("video-stream", codecOk ? "warn" : "fail", codecOk ? 0.6 : 0, `video codec/size problem: ${report.video.codec} ${report.video.width}×${report.video.height}`),
    );
  }

  /* ---- audio stream ---- */
  if (!report.audio) {
    observations.push(obs("audio-stream", "fail", 0, "no audio stream in the container"));
  } else {
    const codecOk = AUDIO_CODECS_OK.has(report.audio.codec.toLowerCase());
    const rateOk = report.audio.sampleRate >= 16_000 && report.audio.channels >= 1;
    observations.push(
      codecOk && rateOk
        ? obs("audio-stream", "pass", 1, `${report.audio.codec} ${report.audio.sampleRate} Hz ×${report.audio.channels}`)
        : obs("audio-stream", codecOk ? "warn" : "fail", codecOk ? 0.6 : 0, `audio codec/rate problem: ${report.audio.codec} ${report.audio.sampleRate} Hz`),
    );
  }

  /* ---- a/v sync (container vs narration) ---- */
  if (typeof report.narrationDurationSeconds === "number" && report.narrationDurationSeconds > 0) {
    const drift = Math.abs(report.container.durationSeconds - report.narrationDurationSeconds);
    const status: BrainQualityStatus =
      drift >= AV_SYNC_FAIL_SECONDS ? "fail" : drift >= AV_SYNC_WARN_SECONDS ? "warn" : "pass";
    observations.push(
      obs("av-sync", status, status === "pass" ? 1 : status === "warn" ? 0.6 : 0.2,
        `video ${report.container.durationSeconds.toFixed(1)} s vs narration ${report.narrationDurationSeconds.toFixed(1)} s (drift ${drift.toFixed(2)} s)`),
    );
    if (status === "fail") {
      repairs.push({
        stage: "assembly",
        scope: "stage",
        reason: `a/v drift ${drift.toFixed(2)} s — video length and narration length disagree`,
        minimalAction: "re-run assembly only (audio-authoritative timeline); do not regenerate scenes/audio",
      });
    }
  } else {
    observations.push(obs("av-sync", "not-evaluated", 1, "narration duration not supplied"));
  }

  /* ---- duration band ---- */
  {
    const { minSeconds, maxSeconds } = report.targetDurationBand;
    const d = report.container.durationSeconds;
    const inBand = d >= minSeconds && d <= maxSeconds;
    observations.push(
      inBand
        ? obs("duration-band", "pass", 1, `${d.toFixed(1)} s in [${minSeconds}, ${maxSeconds}] s`)
        : obs("duration-band", "warn", 0.5, `${d.toFixed(1)} s outside [${minSeconds}, ${maxSeconds}] s`),
    );
    if (!inBand) {
      repairs.push({
        stage: d < minSeconds ? "script" : "assembly",
        scope: "stage",
        reason: `finished duration ${d.toFixed(1)} s is outside the target band`,
        minimalAction:
          d < minSeconds
            ? "regenerate script with a larger narration budget, then resume from scenes"
            : "re-run assembly with tighter per-scene trims; keep existing audio/visuals",
      });
    }
  }

  /* ---- resolution ---- */
  if (report.video) {
    const okRes =
      report.video.width >= report.targetResolution.width &&
      report.video.height >= report.targetResolution.height;
    observations.push(
      okRes
        ? obs("resolution", "pass", 1, `${report.video.width}×${report.video.height} ≥ target`)
        : obs("resolution", "warn", 0.4, `${report.video.width}×${report.video.height} below target ${report.targetResolution.width}×${report.targetResolution.height}`),
    );
    if (!okRes) {
      repairs.push({
        stage: "assembly",
        scope: "stage",
        reason: "final resolution below the quality preset",
        minimalAction: "re-run assembly with the preset resolution; source assets are unchanged",
      });
    }
  } else {
    observations.push(obs("resolution", "not-evaluated", 1, "no video stream"));
  }

  /* ---- framerate ---- */
  if (report.video) {
    const drift = Math.abs(report.video.frameRate - report.targetFrameRate);
    observations.push(
      drift <= 1
        ? obs("framerate", "pass", 1, `${report.video.frameRate} fps ≈ target ${report.targetFrameRate}`)
        : obs("framerate", "warn", 0.5, `${report.video.frameRate} fps vs target ${report.targetFrameRate}`),
    );
  } else {
    observations.push(obs("framerate", "not-evaluated", 1, "no video stream"));
  }

  /* ---- leading / trailing silence ---- */
  {
    const lead = report.leadingSilenceSeconds;
    const trail = report.trailingSilenceSeconds;
    if (typeof lead === "number" || typeof trail === "number") {
      const leadStatus: BrainQualityStatus =
        (lead ?? 0) >= LEADING_SILENCE_FAIL ? "fail" : (lead ?? 0) >= LEADING_SILENCE_WARN ? "warn" : "pass";
      const trailStatus: BrainQualityStatus =
        (trail ?? 0) >= TRAILING_SILENCE_FAIL ? "fail" : (trail ?? 0) >= TRAILING_SILENCE_WARN ? "warn" : "pass";
      const worst = rankStatus(leadStatus) >= rankStatus(trailStatus) ? leadStatus : trailStatus;
      observations.push(
        obs("leading-trailing-silence", worst, worst === "pass" ? 1 : worst === "warn" ? 0.6 : 0.3,
          `leading ${(lead ?? 0).toFixed(2)} s / trailing ${(trail ?? 0).toFixed(2)} s`),
      );
      if (worst === "fail") {
        repairs.push({
          stage: "assembly",
          scope: "stage",
          reason: "excessive leading/trailing silence",
          minimalAction: "re-run assembly with silence trim; audio + visuals unchanged",
        });
      }
    } else {
      observations.push(obs("leading-trailing-silence", "not-evaluated", 1, "silence not measured"));
    }
  }

  /* ---- loudness ---- */
  if (typeof report.integratedLoudnessLufs === "number") {
    const target = report.targetLoudnessLufs ?? DEFAULT_TARGET_LUFS;
    const off = Math.abs(report.integratedLoudnessLufs - target);
    const status: BrainQualityStatus = off >= LUFS_FAIL ? "fail" : off >= LUFS_WARN ? "warn" : "pass";
    observations.push(
      obs("loudness", status, status === "pass" ? 1 : status === "warn" ? 0.6 : 0.3,
        `${report.integratedLoudnessLufs.toFixed(1)} LUFS vs target ${target} LUFS`),
    );
    if (status === "fail") {
      repairs.push({
        stage: "assembly",
        scope: "stage",
        reason: `integrated loudness ${report.integratedLoudnessLufs.toFixed(1)} LUFS far from target`,
        minimalAction: "re-run assembly loudness normalisation only",
      });
    }
  } else {
    observations.push(obs("loudness", "not-evaluated", 1, "loudness not measured"));
  }

  /* ---- scene duration fidelity ---- */
  if (report.scenes.length > 0) {
    let worst: { sceneId: number; ratio: number } | undefined;
    for (const scene of report.scenes) {
      if (scene.plannedDurationSeconds <= 0) continue;
      const ratio = Math.abs(scene.renderedDurationSeconds - scene.plannedDurationSeconds) / scene.plannedDurationSeconds;
      if (!worst || ratio > worst.ratio) worst = { sceneId: scene.sceneId, ratio };
    }
    if (!worst) {
      observations.push(obs("scene-duration-fidelity", "not-evaluated", 1, "no planned scene durations"));
    } else {
      const status: BrainQualityStatus =
        worst.ratio >= SCENE_DURATION_FAIL_RATIO ? "fail" : worst.ratio >= SCENE_DURATION_WARN_RATIO ? "warn" : "pass";
      observations.push(
        obs("scene-duration-fidelity", status, status === "pass" ? 1 : status === "warn" ? 0.65 : 0.35,
          `worst deviation: scene ${worst.sceneId} at ${(worst.ratio * 100).toFixed(0)}%`),
      );
      if (status === "fail") {
        repairs.push({
          stage: "video",
          scope: "scene",
          sceneId: worst.sceneId,
          reason: `scene ${worst.sceneId} rendered ${(worst.ratio * 100).toFixed(0)}% off its planned duration`,
          minimalAction: `re-render scene ${worst.sceneId} clip to its planned duration; other scenes untouched`,
        });
      }
    }
  } else {
    observations.push(obs("scene-duration-fidelity", "not-evaluated", 1, "no scene report"));
  }

  /* ---- visual ↔ script alignment (proxy: every narrated scene has a visual) ---- */
  {
    const orphanScenes = report.scenes.filter(
      (scene) => (scene.narrationCharacters ?? 0) > 0 && !scene.visualAssetId,
    );
    if (report.scenes.length === 0) {
      observations.push(obs("visual-script-alignment", "not-evaluated", 1, "no scene report"));
    } else if (orphanScenes.length === 0) {
      observations.push(obs("visual-script-alignment", "pass", 1, "every narrated scene has a bound visual"));
    } else {
      observations.push(
        obs("visual-script-alignment", "fail", 0.2,
          `${orphanScenes.length} narrated scene(s) have no visual asset`,
          orphanScenes.slice(0, 5).map((scene) => `scene:${scene.sceneId}`)),
      );
      for (const scene of orphanScenes) {
        repairs.push({
          stage: "visuals",
          scope: "scene",
          sceneId: scene.sceneId,
          reason: `scene ${scene.sceneId} has narration but no visual`,
          minimalAction: `regenerate the visual for scene ${scene.sceneId} only`,
        });
      }
    }
  }

  /* ---- repeated visuals ---- */
  {
    const byDigest = new Map<string, number[]>();
    for (const scene of report.scenes) {
      const key = scene.visualDigest ?? scene.visualAssetId;
      if (!key) continue;
      byDigest.set(key, [...(byDigest.get(key) ?? []), scene.sceneId]);
    }
    const dupes = [...byDigest.values()].filter((ids) => ids.length > 1);
    if (report.scenes.length === 0 || byDigest.size === 0) {
      observations.push(obs("repeated-visuals", "not-evaluated", 1, "no visual digests to compare"));
    } else if (dupes.length === 0) {
      observations.push(obs("repeated-visuals", "pass", 1, "all scene visuals distinct"));
    } else {
      const reused = dupes.reduce((sum, ids) => sum + ids.length - 1, 0);
      const status: BrainQualityStatus = reused >= 3 ? "fail" : "warn";
      observations.push(
        obs("repeated-visuals", status, status === "fail" ? 0.3 : 0.6,
          `${reused} scene(s) reuse an earlier visual`,
          dupes.slice(0, 4).map((ids) => `scenes:${ids.join("+")}`)),
      );
      for (const ids of dupes) {
        for (const sceneId of ids.slice(1)) {
          repairs.push({
            stage: "visuals",
            scope: "scene",
            sceneId,
            reason: `scene ${sceneId} reuses the visual first used in scene ${ids[0]}`,
            minimalAction: `regenerate a distinct visual for scene ${sceneId} only`,
          });
        }
      }
    }
  }

  /* ---- black / dark frames ---- */
  {
    const measured = report.scenes.filter((scene) => typeof scene.meanLuma === "number");
    if (measured.length === 0) {
      observations.push(obs("black-or-dark-frames", "not-evaluated", 1, "no luma measurements"));
    } else {
      const dark = measured.filter((scene) => (scene.meanLuma ?? 255) < DARK_LUMA_FAIL);
      const dim = measured.filter(
        (scene) => (scene.meanLuma ?? 255) >= DARK_LUMA_FAIL && (scene.meanLuma ?? 255) < DARK_LUMA_WARN,
      );
      if (dark.length > 0) {
        observations.push(
          obs("black-or-dark-frames", "fail", 0.2, `${dark.length} near-black scene(s)`, dark.map((s) => `scene:${s.sceneId}`)),
        );
        for (const scene of dark) {
          repairs.push({
            stage: "visuals",
            scope: "scene",
            sceneId: scene.sceneId,
            reason: `scene ${scene.sceneId} mean luma ${scene.meanLuma} — effectively black`,
            minimalAction: `regenerate the visual for scene ${scene.sceneId} only`,
          });
        }
      } else if (dim.length > 0) {
        observations.push(
          obs("black-or-dark-frames", "warn", 0.65, `${dim.length} very dark scene(s)`, dim.map((s) => `scene:${s.sceneId}`)),
        );
      } else {
        observations.push(obs("black-or-dark-frames", "pass", 1, "no dark scenes"));
      }
    }
  }

  /* ---- asset completeness ---- */
  {
    const missing = report.expectedAssetKinds.filter(
      (kind) => !report.presentAssetKinds.includes(kind),
    );
    if (report.expectedAssetKinds.length === 0) {
      observations.push(obs("asset-completeness", "not-evaluated", 1, "no expected-asset manifest"));
    } else if (missing.length === 0) {
      observations.push(obs("asset-completeness", "pass", 1, `${report.expectedAssetKinds.length} expected asset kinds all present`));
    } else {
      observations.push(
        obs("asset-completeness", "fail", 0.3, `missing asset kinds: ${missing.join(", ")}`),
      );
      for (const kind of missing) {
        repairs.push({
          stage: assetKindToStage(kind),
          scope: "stage",
          reason: `expected ${kind} asset is missing`,
          minimalAction: `re-run the ${assetKindToStage(kind)} stage only`,
        });
      }
    }
  }

  /* ---- subtitle sync ---- */
  if (typeof report.subtitleCueCount === "number" && report.subtitleCueCount > 0) {
    const ratio = report.scenes.length > 0 ? report.subtitleCueCount / report.scenes.length : 0;
    observations.push(
      ratio >= 0.5
        ? obs("subtitle-sync", "pass", 1, `${report.subtitleCueCount} cues for ${report.scenes.length} scenes`)
        : obs("subtitle-sync", "warn", 0.6, `${report.subtitleCueCount} cues seems low for ${report.scenes.length} scenes`),
    );
  } else {
    observations.push(obs("subtitle-sync", "not-evaluated", 1, "no subtitle track"));
  }

  /* ---- narrative flow (proxy: contiguous, ordered, enough scenes) ---- */
  {
    const ids = report.scenes.map((scene) => scene.sceneId);
    const ordered = ids.every((id, index) => index === 0 || id > ids[index - 1]);
    const contiguous = ids.every((id, index) => index === 0 || id === ids[index - 1] + 1);
    if (ids.length === 0) {
      observations.push(obs("narrative-flow", "not-evaluated", 1, "no scene report"));
    } else if (ids.length >= 3 && ordered && contiguous) {
      observations.push(obs("narrative-flow", "pass", 1, `${ids.length} scenes, contiguous and ordered`));
    } else {
      observations.push(
        obs("narrative-flow", "warn", 0.6, `scene sequence irregular (n=${ids.length}, ordered=${ordered}, contiguous=${contiguous})`),
      );
    }
  }

  return finalizeVerdict(report.observedAt, observations, repairs);
}

function rankStatus(status: BrainQualityStatus): number {
  return { pass: 0, "not-evaluated": 0, warn: 1, fail: 2 }[status];
}

function assetKindToStage(kind: string): BrainRepairTarget["stage"] {
  const map: Record<string, BrainRepairTarget["stage"]> = {
    research: "research",
    script: "script",
    scenes: "scenes",
    visual: "visuals",
    visuals: "visuals",
    image: "visuals",
    animation: "animation",
    video: "video",
    audio: "audio",
    narration: "audio",
    music: "audio",
    assembly: "assembly",
    thumbnail: "thumbnail",
    seo: "seo",
    youtube: "youtube",
    export: "export",
  };
  return map[kind.toLowerCase()] ?? "assembly";
}

function finalizeVerdict(
  observedAt: string,
  observations: readonly BrainQualityObservation[],
  repairs: readonly BrainRepairTarget[],
): BrainQualityVerdict {
  let weightSum = 0;
  let scoreSum = 0;
  for (const observation of observations) {
    if (observation.status === "not-evaluated") continue;
    const weight = DIMENSION_WEIGHT[observation.dimension];
    weightSum += weight;
    scoreSum += weight * observation.score;
  }
  const score = weightSum === 0 ? 1 : Number((scoreSum / weightSum).toFixed(4));

  const hardFail = observations.some(
    (observation) =>
      observation.status === "fail" && HARD_DIMENSIONS.includes(observation.dimension),
  );
  const anyFail = observations.some((observation) => observation.status === "fail");

  let outcome: BrainQualityOutcome;
  if (hardFail) {
    outcome = "reject";
  } else if (anyFail || score < 0.6) {
    outcome = "repair";
  } else {
    outcome = "release";
  }

  // Dedupe repair targets (same stage+scope+scene).
  const seen = new Set<string>();
  const dedupedRepairs = repairs.filter((target) => {
    const key = `${target.stage}|${target.scope}|${target.sceneId ?? ""}|${target.assetId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    schemaVersion: brainSchemaVersion,
    observedAt,
    outcome,
    score,
    observations: [...observations].sort(
      (left, right) => rankStatus(right.status) - rankStatus(left.status) || left.dimension.localeCompare(right.dimension),
    ),
    repairTargets: dedupedRepairs,
  };
}

/** Human-readable summary. */
export function describeBrainQualityVerdict(verdict: BrainQualityVerdict): string {
  const lines = [
    `Quality: ${verdict.outcome.toUpperCase()} (score ${(verdict.score * 100).toFixed(0)}%)`,
    ...verdict.observations
      .filter((observation) => observation.status === "fail" || observation.status === "warn")
      .map((observation) => `  [${observation.status}] ${observation.dimension}: ${observation.detail}`),
  ];
  if (verdict.repairTargets.length) {
    lines.push("  minimal repairs:");
    for (const target of verdict.repairTargets) {
      lines.push(`    - ${target.minimalAction}`);
    }
  }
  return lines.join("\n");
}
