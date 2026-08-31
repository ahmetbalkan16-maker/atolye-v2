import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { AIUsageManager } from "../src/lib/ai/AIUsageManager";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import {
  buildProductionCostReport,
  persistProductionCostReport,
  renderProductionCostReportText,
} from "../src/lib/production/ProductionCostReport";
import { shutdownProductionProcessRuntime } from "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import type { ScriptData } from "../src/types/script";
import type { SceneData } from "../src/types/scene";
import type { AssemblyPlanData } from "../src/types/assembly";
import type { ProjectAssets } from "../src/types/asset";

/**
 * P1: $0, read-only production cost report for a completed / in-progress render.
 * Folds `ai-usage.json` + the script / scenes / assembly / jobs facts into the
 * `=== ATÖLYE DOCUMENTARY PRODUCTION COST ===` block and the per-preset
 * comparison, and (unless --no-write) refreshes `production-cost-report.json`.
 * Runs no paid call.
 *
 *   npm run production:cost-report -- --project-slug=<slug> [--json] [--no-write]
 */
async function main() {
  const args = process.argv.slice(2);
  const projectSlug = args.find((a) => a.startsWith("--project-slug="))?.split("=")[1]?.trim();
  const asJson = args.includes("--json");
  const write = !args.includes("--no-write");
  if (!projectSlug) {
    process.stderr.write('{"error":"MISSING_PROJECT_SLUG","usage":"--project-slug=<slug> [--json] [--no-write]"}\n');
    process.exitCode = 1;
    return;
  }

  try {
    const [usage, script, scenes, assembly, jobs] = await Promise.all([
      AIUsageManager.getUsageLog(projectSlug),
      ProjectReader.readJSON<ScriptData>(projectSlug, "script.json"),
      ProjectReader.readJSON<SceneData>(projectSlug, "scenes.json"),
      ProjectReader.readJSON<AssemblyPlanData>(projectSlug, "assembly.json"),
      PipelineJobManager.listJobsReadOnly(projectSlug).catch(() => ({ jobs: [] as { attempts: number }[] })),
    ]);
    const assets = await ProjectReader.readJSON<ProjectAssets>(projectSlug, "assets/assets.json")
      .catch(() => null);

    const generatedImages = (assets?.assets ?? []).filter(
      (asset) => asset.type === "image" && asset.status === "generated",
    );
    const aiImageCount = generatedImages.some((asset) => asset.mediaOrigin !== undefined)
      ? generatedImages.filter((asset) => asset.mediaOrigin === "ai").length
      : generatedImages.filter((asset) => asset.provider === "openai").length;
    const chapters = script?.chapters ?? [];

    const report = buildProductionCostReport({
      projectSlug,
      usage,
      facts: {
        durationSeconds: assembly?.render?.durationSeconds ?? script?.estimatedDuration ?? 0,
        sceneCount: scenes?.scenes?.length ?? 0,
        chapterCount: chapters.length,
        narrationCharacters: chapters.reduce(
          (total, chapter) =>
            total + (typeof chapter.narration === "string" ? chapter.narration.length : 0),
          0,
        ),
        aiImageCount,
        aiVideoCount: 0,
        cachedAssetCount: 0,
        retryCount: (jobs.jobs as { attempts: number }[]).reduce(
          (total, job) => total + Math.max(0, (job.attempts ?? 0) - 1),
          0,
        ),
      },
    });

    if (write) {
      try {
        persistProductionCostReport(report);
      } catch {
        /* read-only environments: skip the write, still print */
      }
    }
    process.stdout.write(
      asJson ? `${JSON.stringify(report, null, 2)}\n` : renderProductionCostReportText(report),
    );
    process.exitCode = report.status === "within-budget" ? 0 : 2;
  } finally {
    await shutdownProductionProcessRuntime();
  }
}

void main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ error: "COST_REPORT_FAILED", detail: String(error).slice(0, 200) })}\n`,
  );
  process.exitCode = 1;
});
