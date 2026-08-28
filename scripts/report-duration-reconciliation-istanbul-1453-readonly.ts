/**
 * READ-ONLY §9 report: which stages of the real, protected
 * i-stanbul-un-fethi-1453 project WOULD be regenerated if the F-08/F-02
 * duration-authority fix were applied to it.
 *
 * Reads data/projects/i-stanbul-un-fethi-1453/script.json and audio.json
 * directly via fs (no ProjectManager/ProjectWriter mutation path is ever
 * invoked) and writes nothing. Companion evidence to
 * scripts/diagnose-istanbul-1453-assembly-render-readonly.ts, which proves
 * (against a temp copy) that the new assembly quality gate would reject
 * this project's current assembly render.
 */
import fs from "node:fs";
import path from "node:path";
import { computeDurationReconciliationReport } from "../src/lib/audio/AudioDurationReconciliation";
import type { ScriptData } from "../src/types/script";
import type { AudioData } from "../src/types/audio";

const PROJECT_DIR = path.join(__dirname, "..", "data", "projects", "i-stanbul-un-fethi-1453");

function main() {
  const script = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "script.json"), "utf-8")) as ScriptData;
  const audio = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, "audio.json"), "utf-8")) as AudioData;

  const report = computeDurationReconciliationReport(script, audio);

  console.log("=== i-stanbul-un-fethi-1453: duration reconciliation report (READ-ONLY) ===\n");
  console.log("chapterId | estimatedSeconds (used to build video/animation) | measuredSeconds (real TTS) | divergenceRatio");
  for (const chapter of report.chapters) {
    console.log(
      `${chapter.chapterId}         | ${chapter.estimatedSeconds.toFixed(2).padStart(6)}` +
        ` | ${chapter.measuredSeconds?.toFixed(3).padStart(8) ?? "n/a"}` +
        ` | ${chapter.divergenceRatio !== null ? `${(chapter.divergenceRatio * 100).toFixed(1)}%` : "n/a"}`,
    );
  }
  console.log(
    `\nTOTAL     | ${report.totalEstimatedSeconds.toFixed(2)} | ${report.totalMeasuredSeconds?.toFixed(3) ?? "n/a"}` +
      ` | ${report.totalDivergenceRatio !== null ? `${(report.totalDivergenceRatio * 100).toFixed(1)}%` : "n/a"}`,
  );

  console.log("\n=== §9: stages that would be regenerated under the new system ===");
  console.log(
    "- script:    NOT regenerated. Its chapter durations were LLM-picked, disconnected\n" +
      "             from the narration text; under the new system (AIManager.runScript)\n" +
      "             those durations would instead be computed from the (unchanged)\n" +
      "             narration text via NarrationDurationEstimator -- but since this\n" +
      "             project's script.json already exists, this stage is not touched.",
  );
  console.log(
    "- scenes/animation/video: WOULD need regeneration. Their durations were built\n" +
      "             from the stale script chapter durations above; the new system's\n" +
      "             VideoDurationCoverageGuard rejects assembly for exactly the\n" +
      "             per-chapter divergence ratios shown above (confirmed empirically\n" +
      "             by diagnose-istanbul-1453-assembly-render-readonly.ts against a\n" +
      "             temp copy of this project: both the on-disk assembly.json and a\n" +
      "             freshly computed plan now fail with VIDEO_DURATION_COVERAGE_FAILED).\n" +
      "             Regenerating video/animation at durations matching the REAL\n" +
      "             audio.json durations above (already known -- no new TTS call\n" +
      "             needed) would let assembly pass the new gate.",
  );
  console.log(
    "- audio:     NOT regenerated. audio.json's measured durations are already\n" +
      "             correct and become the reconciliation target for the above.",
  );
  console.log(
    "- assembly:  Currently BLOCKED under the new gate (not silently accepted as\n" +
      "             before) until video/animation are regenerated as described above.",
  );
  console.log(
    "\nNo files under data/projects/i-stanbul-un-fethi-1453/ were written by this script.",
  );
}

main();
