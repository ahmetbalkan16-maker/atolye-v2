/**
 * TEMP-only Stage 12 evaluator. Run unchanged in a clean 5da7aa2 archive, where
 * the director module does not exist, it reports every scenario as MISSING.
 * No live project, runtime, provider or network access.
 */
import assert from "node:assert/strict";
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type {
  DirectorMediaCandidate, DirectorScene, DirectorTask, DirectorFindingCode,
  DirectorReview,
} from "../src/lib/ayas/director/AyasDirectorReadiness";
import type { DirectorProjectArtifacts } from "../src/lib/ayas/director/AyasDirectorProjectAdapter";

const modulePath = path.resolve(__dirname, "../src/lib/ayas/director/AyasDirectorReadiness.ts");
const primaryTotal = 53;
const heldOutTotal = 8;
if (!existsSync(modulePath)) {
  const result = {
    status: "MISSING", suite: "ayas-atolye-director-readiness",
    primary: { pass: 0, fail: 0, missing: primaryTotal },
    heldOut: { pass: 0, fail: 0, missing: heldOutTotal },
  };
  console.log(JSON.stringify(result));
  process.exit(0);
}

async function main(): Promise<void> {
const { reviewAtolyeDirectorTask, classifyDirectorRights } =
  await import("../src/lib/ayas/director/AyasDirectorReadiness");
const { directorTaskFromProjectArtifacts } =
  await import("../src/lib/ayas/director/AyasDirectorProjectAdapter");
type Check = { name: string; group: "primary" | "heldOut"; run: () => void };
const checks: Check[] = [];
function check(name: string, run: () => void, group: Check["group"] = "primary"): void {
  checks.push({ name, run, group });
}
function candidate(patch: Partial<DirectorMediaCandidate> = {}): DirectorMediaCandidate {
  return {
    id: "map-1", mediaClass: "MAP", origin: "REAL",
    title: "Istanbul siege map", subjects: ["Istanbul siege"],
    location: "Istanbul", period: "1453",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Siege_map",
    sourceOrganization: "Museum", sourceQuality: "PRIMARY_INSTITUTION",
    sourceQualityEvidence: "Museum catalog record",
    license: "CC BY-SA 4.0", width: 1920, height: 1080,
    availableForProduction: true,
    ...patch,
  };
}
function scene(patch: Partial<DirectorScene> = {}): DirectorScene {
  return {
    id: 1, title: "Istanbul siege", purpose: "Explain the siege",
    beat: "CONTEXT", narration: "The Istanbul siege map shows the city.",
    visualObjective: "Istanbul siege map", subject: "Istanbul siege",
    location: "Istanbul", period: "1453", chronologyIndex: 1,
    targetDurationSeconds: 12, audioDurationSeconds: 12,
    audioStatus: "READY", requiredEvidence: true,
    sourceReferences: ["primary-source-1"], preferredMedia: ["MAP"],
    selectedCandidateId: "map-1", motion: "MAP_MOVEMENT",
    ...patch,
  };
}
function task(patch: Partial<DirectorTask> = {}): DirectorTask {
  return {
    projectId: "project-1", topic: "Istanbul siege",
    format: "DOCUMENTARY", audience: "Adults", objective: "Explain 1453",
    tone: "Measured", targetDurationSeconds: 12, pacingProfile: "BALANCED",
    scenes: [scene()], candidates: [candidate()],
    host: { ffmpeg: "AVAILABLE", ffprobe: "AVAILABLE" },
    provider: "AVAILABLE", ...patch,
  };
}
function review(patch: Partial<DirectorTask> = {}): DirectorReview {
  return reviewAtolyeDirectorTask(task(patch));
}
function has(result: DirectorReview, code: DirectorFindingCode): boolean {
  return result.findings.some((finding) => finding.code === code);
}
function withScene(patch: Partial<DirectorScene>, extra?: Partial<DirectorTask>): DirectorReview {
  return review({ scenes: [scene(patch)], ...extra });
}

check("healthy selected map", () => {
  const result = review();
  assert.equal(result.readiness, "ASSEMBLY_READY");
  assert.equal(result.preAssemblyGate, "PASS");
  assert.equal(result.findings.length, 0);
});
check("wrong subject", () => assert(has(review({
  candidates: [candidate({ title: "Edirne bridge", subjects: ["Edirne bridge"] })],
}), "MEDIA_MISMATCH")));
check("wrong historical period", () => assert(has(review({
  candidates: [candidate({ period: "2024" })],
}), "WRONG_TIME_PERIOD")));
check("wrong location", () => assert(has(review({
  candidates: [candidate({ location: "Ankara" })],
}), "WRONG_LOCATION")));
check("verified real photo provenance", () => {
  const item = candidate({ mediaClass: "REAL_PHOTO", ownerRightsVerified: true,
    ownerRightsEvidence: "Owner license receipt", license: undefined });
  assert.equal(classifyDirectorRights(item).status, "OWNER_VERIFIED");
});
check("real photo unknown rights", () => assert.equal(review({
  candidates: [candidate({ license: undefined })],
}).readiness, "RIGHTS_BLOCKED"));
check("generated reconstruction labeled", () => {
  const result = withScene({ reconstructionLabeled: true, selectedCandidateId: "gen-1",
    motion: "STATIC_HOLD" }, { candidates: [candidate({ id: "gen-1",
      mediaClass: "GENERATED_IMAGE", origin: "GENERATED", sourceUrl: undefined,
      license: undefined })] });
  assert(!has(result, "SYNTHETIC_UNLABELED"));
});
check("image reused three times", () => assert(has(review({
  scenes: [scene(), scene({ id: 2, chronologyIndex: 2 }),
    scene({ id: 3, chronologyIndex: 3 })],
}), "VISUAL_REPETITION")));
check("insufficient resolution", () => assert(has(review({
  candidates: [candidate({ width: 640 })],
}), "LOW_RESOLUTION")));
check("narration image mismatch", () => assert(has(withScene({
  narration: "Ankara industry changed rapidly.", visualObjective: "Istanbul siege map",
}, { candidates: [candidate({ title: "Unrelated castle", subjects: ["castle"] })] }),
  "NARRATION_VISUAL_MISMATCH")));
check("relevant short video", () => {
  const result = review({ candidates: [candidate({ mediaClass: "REAL_VIDEO", durationSeconds: 8 })] });
  assert(!has(result, "CLIP_UNSUITABLE"));
});
check("irrelevant long clip", () => {
  const result = review({ candidates: [candidate({ mediaClass: "REAL_VIDEO",
    title: "Modern airport", subjects: ["airport"], durationSeconds: 180 })] });
  assert(has(result, "CLIP_UNSUITABLE") && has(result, "MEDIA_MISMATCH"));
});
check("map needed scene", () => assert.equal(review().recommendations[0].mediaClass, "MAP"));
check("document needed scene", () => {
  const result = withScene({ preferredMedia: ["DOCUMENT"], motion: "DOCUMENT_SCAN" },
    { candidates: [candidate({ mediaClass: "DOCUMENT" })] });
  assert.equal(result.recommendations[0].mediaClass, "DOCUMENT");
});
check("long static still", () => assert(has(withScene({
  targetDurationSeconds: 40, audioDurationSeconds: 40, motion: "STATIC_HOLD",
}), "SCENE_TOO_LONG")));
check("excessive text card motion", () => assert(has(withScene({
  motion: "PAN",
}, { candidates: [candidate({ mediaClass: "TEXT_CARD" })] }), "MOTION_UNSUITABLE")));
check("appropriate static hold", () => assert(!has(withScene({
  motion: "STATIC_HOLD",
}, { candidates: [candidate({ mediaClass: "TEXT_CARD" })] }), "MOTION_UNSUITABLE")));
check("audio pacing mismatch", () => assert(has(withScene({
  audioDurationSeconds: 25,
}), "AUDIO_DURATION_MISMATCH")));
check("continuity location break", () => assert(has(review({
  scenes: [scene(), scene({ id: 2, chronologyIndex: 2,
    location: "Ankara", transitionFromPrevious: undefined })],
}), "TRANSITION_MISSING")));
check("post assembly metadata ready", () => {
  const result = review({ assembly: { sceneOrder: [1], hasAudioTrack: true,
    durationSeconds: 12, width: 1920, height: 1080 } });
  assert.equal(result.postAssemblyGate, "PASS");
  assert.equal(result.readiness, "OWNER_REVIEW_READY");
});
check("media incomplete", () => assert.equal(withScene({
  selectedCandidateId: undefined,
}).readiness, "MEDIA_INCOMPLETE"));
check("rights blocked", () => assert.equal(review({
  candidates: [candidate({ license: "All rights reserved" })],
}).readiness, "RIGHTS_BLOCKED"));
check("host dependency missing", () => assert.equal(review({
  host: { ffmpeg: "UNAVAILABLE", ffprobe: "AVAILABLE" },
}).dependencyState, "HOST_BLOCKED"));
check("provider unavailable", () => assert.equal(review({
  provider: "UNAVAILABLE",
}).dependencyState, "PROVIDER_BLOCKED"));
check("safe generated fallback for abstract general scene", () => {
  const result = withScene({ subject: undefined, visualObjective: "Abstract change",
    selectedCandidateId: "gen", preferredMedia: ["GENERATED_IMAGE"],
    requiredEvidence: false, motion: "STATIC_HOLD" },
  { format: "GENERAL", candidates: [candidate({ id: "gen",
    mediaClass: "GENERATED_IMAGE", origin: "GENERATED",
    title: "Abstract change", subjects: ["Abstract change"] })] });
  assert.equal(result.recommendations[0].candidateId, "gen");
});
check("no fake provenance", () => {
  const rights = classifyDirectorRights(candidate({
    license: undefined, ownerRightsVerified: true, ownerRightsEvidence: undefined,
  }));
  assert.equal(rights.status, "RIGHTS_UNKNOWN");
});
check("no production authority", () => assert.equal(review().authority, "ADVISORY_ONLY"));
check("artifact adapter preserves input and has no resume mutation", () => {
  const artifacts = {
    project: { id: "p", slug: "p", title: "Test", status: "draft" as const,
      createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    scenes: { scenes: [{ id: 1, title: "Scene", description: "Description", duration: 10 }],
      createdAt: "2026-01-01" },
  };
  const before = structuredClone(artifacts);
  const projected = directorTaskFromProjectArtifacts(artifacts, { format: "GENERAL" });
  assert.deepEqual(artifacts, before);
  assert.equal(projected.scenes[0].purpose, undefined);
});
check("real media preference when relevant", () => {
  const result = review({ candidates: [candidate(), candidate({
    id: "gen", origin: "GENERATED", mediaClass: "GENERATED_IMAGE",
    sourceUrl: undefined, license: undefined,
  })] });
  assert.equal(result.recommendations[0].candidateId, "map-1");
});
check("generated preference when real media is wrong period", () => {
  const result = withScene({ selectedCandidateId: "gen", reconstructionLabeled: true },
    { candidates: [candidate({ period: "2024" }), candidate({
      id: "gen", origin: "GENERATED", mediaClass: "GENERATED_IMAGE",
      title: "Istanbul siege reconstruction", subjects: ["Istanbul siege"],
      period: "1453", sourceUrl: undefined, license: undefined,
    })] });
  assert.equal(result.recommendations[0].candidateId, "gen");
});
check("factual source missing", () => assert(has(withScene({
  sourceReferences: [],
}), "FACTUAL_SOURCE_MISSING")));
check("chronology break", () => assert(has(review({
  scenes: [scene({ chronologyIndex: 2 }), scene({ id: 2, chronologyIndex: 1 })],
}), "CHRONOLOGY_BREAK")));
check("explicit scene purpose", () => assert(has(withScene({
  purpose: undefined,
}), "SCENE_PURPOSE_MISSING")));
check("invalid clip segment", () => assert(has(review({
  candidates: [candidate({ mediaClass: "ARCHIVAL_VIDEO",
    durationSeconds: 10, segmentStartSeconds: 8, segmentEndSeconds: 20 })],
}), "CLIP_UNSUITABLE")));
check("unknown host cannot pass", () => assert.notEqual(review({
  host: { ffmpeg: "UNKNOWN", ffprobe: "AVAILABLE" },
}).preAssemblyGate, "PASS"));
check("unknown provider cannot pass", () => assert.notEqual(review({
  provider: "UNKNOWN",
}).preAssemblyGate, "PASS"));
check("malformed assembly is blocked", () => assert.equal(review({
  assembly: { sceneOrder: [2], hasAudioTrack: false },
}).postAssemblyGate, "BLOCKED"));
check("research hit cannot count as selected asset", () => assert.equal(review({
  candidates: [candidate({ availableForProduction: false })],
}).readiness, "MEDIA_INCOMPLETE"));
check("source URL without license stays unknown", () => assert.equal(
  classifyDirectorRights(candidate({ license: undefined })).status, "RIGHTS_UNKNOWN"));
check("documentary beat reversal needs explanation", () => assert(has(review({
  scenes: [scene({ beat: "CLIMAX" }), scene({ id: 2, chronologyIndex: 2,
    beat: "SETUP", transitionFromPrevious: undefined })],
}), "BEAT_ORDER_BREAK")));
check("repeated adjacent narration is visible", () => assert(has(review({
  scenes: [scene(), scene({ id: 2, chronologyIndex: 2 })],
}), "NARRATIVE_REPETITION")));
check("generated media cannot masquerade as real video", () => assert(has(review({
  candidates: [candidate({ origin: "GENERATED", mediaClass: "REAL_VIDEO" })],
}), "MEDIA_ORIGIN_CONFLICT")));
check("unknown dependencies stay unverified", () => assert.equal(review({
  host: { ffmpeg: "UNKNOWN", ffprobe: "UNKNOWN" }, provider: "UNKNOWN",
}).dependencyState, "UNVERIFIED"));
check("duplicate candidate identity fails closed", () => assert(has(review({
  candidates: [candidate(), candidate({ title: "Different source" })],
}), "DUPLICATE_ID")));
check("oversized input is bounded", () => assert.equal(review({
  scenes: Array.from({ length: 201 }, (_, index) =>
    scene({ id: index + 1, chronologyIndex: index + 1 })),
}).preAssemblyGate, "BLOCKED"));
check("Turkish dotted İ matches English Istanbul metadata", () => {
  const result = withScene({ title: "İstanbul kuşatması", subject: "İstanbul kuşatması",
    visualObjective: "İstanbul kuşatma haritası", location: "İSTANBUL",
    narration: "İstanbul kuşatması haritada görülüyor." });
  assert(!has(result, "MEDIA_MISMATCH") && !has(result, "WRONG_LOCATION"));
  assert.equal(result.recommendations[0].candidateId, "map-1");
});
check("unknown scene audio cannot pass", () => {
  for (const audioStatus of ["UNKNOWN", undefined] as const) {
    const result = withScene({ audioStatus });
    assert.equal(result.preAssemblyGate, "REVIEW_REQUIRED");
    assert(has(result, "AUDIO_UNVERIFIED"));
  }
});
check("adapter keeps chapter narration scene-bounded and maps zoom-out", () => {
  const artifacts = {
    project: { id: "p", slug: "p", title: "Test", status: "draft" as const,
      createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    script: { chapters: [
      { id: 1, narration: "Shared chapter narration about walls" },
      { id: 2, narration: "Single scene chapter narration" },
    ] } as unknown as DirectorProjectArtifacts["script"],
    scenes: { scenes: [
      { id: 1, chapterId: 1, title: "A", description: "A", duration: 10 },
      { id: 2, chapterId: 1, title: "B", description: "B", duration: 10 },
      { id: 3, chapterId: 2, title: "C", description: "C", duration: 10 },
    ], createdAt: "2026-01-01" },
    animation: { projectId: "p", createdAt: "2026-01-01", scenes: [
      { sceneId: 3, animationPrompt: "", motionType: "zoom-out" },
    ] } as unknown as DirectorProjectArtifacts["animation"],
  };
  const projected = directorTaskFromProjectArtifacts(artifacts, { format: "GENERAL" });
  assert.deepEqual(projected.scenes.map((item) => item.narration),
    [undefined, undefined, "Single scene chapter narration"]);
  assert.equal(projected.scenes[2].motion, "REVEAL");
  assert(!has(reviewAtolyeDirectorTask(projected), "NARRATIVE_REPETITION"));
  assert(!has(withScene({ motion: "REVEAL" }), "MOTION_UNSUITABLE"));
});
check("generated explanatory diagram is not an origin conflict", () => {
  const result = withScene({ selectedCandidateId: "diagram", motion: "STATIC_HOLD",
    reconstructionLabeled: false }, { candidates: [candidate({ id: "diagram",
    origin: "GENERATED", mediaClass: "DIAGRAM", sourceUrl: undefined,
    license: undefined })] });
  assert(!has(result, "MEDIA_ORIGIN_CONFLICT") && !has(result, "SYNTHETIC_UNLABELED"));
  assert.equal(result.recommendations[0].candidateId, "diagram");
});
check("generated animation may play as source video", () => assert(!has(withScene({
  selectedCandidateId: "anim", motion: "SOURCE_VIDEO", reconstructionLabeled: true,
}, { candidates: [candidate({ id: "anim", origin: "GENERATED",
  mediaClass: "ANIMATION", sourceUrl: undefined, license: undefined,
  durationSeconds: 8 })] }), "MOTION_UNSUITABLE")));
check("narration without comparable terms is not repetition", () => assert(!has(review({
  scenes: [scene({ narration: "Bu." }), scene({ id: 2, chronologyIndex: 2, narration: "Ve o." })],
}), "NARRATIVE_REPETITION")));
check("TEMP CLI reads without mutation", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ayas-director-fixture-"));
  const fixtureRoot = path.join(root, "projects", "fixture-project");
  const assetsRoot = path.join(fixtureRoot, "assets");
  try {
    mkdirSync(assetsRoot, { recursive: true });
    const projectFile = path.join(fixtureRoot, "project.json");
    const scenesFile = path.join(fixtureRoot, "scenes.json");
    const assetsFile = path.join(assetsRoot, "assets.json");
    writeFileSync(projectFile, JSON.stringify({
      id: "fixture-project", slug: "fixture-project", title: "Fixture",
      status: "draft", createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }));
    writeFileSync(scenesFile, JSON.stringify({
      scenes: [{ id: 1, title: "Map", description: "Map scene", duration: 10 }],
      createdAt: "2026-01-01",
    }));
    writeFileSync(assetsFile, JSON.stringify({
      projectId: "fixture-project", projectSlug: "fixture-project",
      assets: [], createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }));
    const before = [projectFile, scenesFile, assetsFile].map((file) => readFileSync(file, "utf8"));
    const runner = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");
    const cli = path.resolve(__dirname, "ayas-atolye-director-readiness.ts");
    const child = spawnSync(process.execPath, [runner, cli, "--slug", "fixture-project",
      "--format", "documentary", "--json"], {
      cwd: path.resolve(__dirname, ".."), encoding: "utf8", timeout: 8_000,
      env: { ...process.env, ATOLYE_RUNTIME_ROOT: root,
        ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(root, "authority"),
        FFMPEG_EXECUTABLE: path.join(root, "missing-ffmpeg"),
        FFPROBE_EXECUTABLE: path.join(root, "missing-ffprobe") },
    });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout) as DirectorReview & {
      storage: { classification: string; rootSelection: string };
    };
    assert.equal(result.authority, "ADVISORY_ONLY");
    assert.equal(result.readiness, "MEDIA_INCOMPLETE");
    assert.deepEqual(result.storage,
      { classification: "explicit-external", rootSelection: "explicit" });
    assert.deepEqual([projectFile, scenesFile, assetsFile].map((file) =>
      readFileSync(file, "utf8")), before);
  } finally {
    const resolved = path.resolve(root);
    const prefix = path.resolve(os.tmpdir()) + path.sep;
    assert(resolved.startsWith(prefix) && path.basename(resolved).startsWith("ayas-director-fixture-"));
    rmSync(resolved, { recursive: true, force: true });
  }
});
check("TEMP CLI rejects traversal slug", () => {
  const runner = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");
  const cli = path.resolve(__dirname, "ayas-atolye-director-readiness.ts");
  const child = spawnSync(process.execPath, [runner, cli, "--slug", "../escape",
    "--format", "documentary"], {
    cwd: path.resolve(__dirname, ".."), encoding: "utf8", timeout: 8_000,
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /safe project slug/);
});

check("paraphrased scene retains explicit subject", () => assert.equal(withScene({
  visualObjective: "A city under siege", subject: "Istanbul siege",
}).recommendations[0].candidateId, "map-1"), "heldOut");
check("ambiguous historical photo is not chosen without subject", () => assert.equal(withScene({
  visualObjective: "Istanbul siege", selectedCandidateId: undefined,
}, { candidates: [candidate({ id: "ambiguous", title: "Old photograph",
  subjects: ["old photograph"] })] }).recommendations[0].candidateId, null), "heldOut");
check("misleading caption with wrong period is rejected", () => assert.equal(withScene({
  selectedCandidateId: undefined,
}, { candidates: [candidate({ title: "Istanbul siege map", period: "1980" })] })
  .recommendations[0].candidateId, null), "heldOut");
check("visually strong but wrong location remains a finding", () => assert(
  has(review({ candidates: [candidate({ width: 4096, height: 2160,
    location: "London" })] }), "WRONG_LOCATION")), "heldOut");
check("low quality but relevant source needs review", () => assert(
  has(review({ candidates: [candidate({ width: 320, height: 240 })] }),
    "LOW_RESOLUTION")), "heldOut");
check("synthetic archival pretense gets label finding", () => assert(
  has(withScene({ selectedCandidateId: "synthetic", reconstructionLabeled: false },
    { candidates: [candidate({ id: "synthetic", origin: "GENERATED",
      mediaClass: "GENERATED_IMAGE", title: "Istanbul siege archival photo" })] }),
    "SYNTHETIC_UNLABELED")), "heldOut");
check("map shown too briefly is detected", () => assert(
  has(withScene({ targetDurationSeconds: 3, audioDurationSeconds: 3 }), "SCENE_TOO_SHORT")),
  "heldOut");
check("three scene continuity remains bounded", () => assert(
  has(review({ scenes: [scene(), scene({ id: 2, chronologyIndex: 2,
    location: "Ankara", transitionFromPrevious: "Travel" }),
    scene({ id: 3, chronologyIndex: 3, location: "Edirne" })] }),
    "TRANSITION_MISSING")), "heldOut");

let primaryPass = 0;
let heldOutPass = 0;
let primaryFail = 0;
let heldOutFail = 0;
for (const item of checks) {
  try {
    item.run();
    if (item.group === "primary") primaryPass += 1;
    else heldOutPass += 1;
  } catch (error) {
    if (item.group === "primary") primaryFail += 1;
    else heldOutFail += 1;
    console.error(`FAIL ${item.group} ${item.name}:`, error);
  }
}
assert.equal(checks.filter((item) => item.group === "primary").length, primaryTotal);
assert.equal(checks.filter((item) => item.group === "heldOut").length, heldOutTotal);
const status = primaryFail + heldOutFail === 0 ? "PASS" : "FAIL";
console.log(JSON.stringify({
  status, suite: "ayas-atolye-director-readiness",
  primary: { pass: primaryPass, fail: primaryFail, missing: 0 },
  heldOut: { pass: heldOutPass, fail: heldOutFail, missing: 0 },
}));
if (status === "FAIL") process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
