import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { buildProductionCostPreflight } from "../src/lib/production/ProductionCostPreflight";
import { shutdownProductionProcessRuntime } from "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import type { ScriptData } from "../src/types/script";
import type { SceneData } from "../src/types/scene";

/**
 * Faz 6: $0, read-only pre-run AI cost preflight for a controlled production
 * render. Prints the projected total against the $1 budget and a pass/block
 * decision. Runs no paid call and touches no state.
 *
 *   npm run production:cost-preflight -- --project-slug=<slug>
 */
async function main() {
  const slugArg = process.argv.slice(2).find((arg) => arg.startsWith("--project-slug="));
  const projectSlug = slugArg?.split("=")[1]?.trim();
  if (!projectSlug) {
    process.stderr.write('{"error":"MISSING_PROJECT_SLUG","usage":"--project-slug=<slug>"}\n');
    process.exitCode = 1;
    return;
  }

  try {
    const script = await ProjectReader.readJSON<ScriptData>(projectSlug, "script.json");
    const scenes = await ProjectReader.readJSON<SceneData>(projectSlug, "scenes.json");
    const report = await buildProductionCostPreflight({ projectSlug, script, scenes });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.decision === "pass" ? 0 : 2;
  } finally {
    await shutdownProductionProcessRuntime();
  }
}

void main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ error: "COST_PREFLIGHT_FAILED", detail: String(error).slice(0, 200) })}\n`,
  );
  process.exitCode = 1;
});
