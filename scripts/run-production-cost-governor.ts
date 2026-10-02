/**
 * Stage 15K — the production cost governor, for the operator.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/run-production-cost-governor.ts --project <slug> [options]
 *
 *   --approved-cap <usd>        the cap the owner approved for this project. Without it a paid estimate pauses.
 *   --allowance <usd>           the allowance the project may draw on.
 *   --allowance-basis <b>       declared | revalidated. Required with --allowance.
 *   --ledger <dir>              a cost reservation ledger to read: what it already holds counts against the allowance.
 *
 * Read-only and $0. It builds the pipeline's own pre-run estimate, reads what the project has already spent, and
 * prints the governor's decision: continue, pause and ask the owner the exact question, or block. It makes no paid
 * call, reserves nothing and raises no cap.
 *
 * Exit code 0 for CONTINUE, 2 for PAUSE_ASK_OWNER, 3 for BLOCK, 1 for an error.
 */
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { costComponentsFromEstimate, governProductionCost, PRODUCTION_COST_POLICY, type CostAllowanceBasis } from "../src/lib/production/ProductionCostGovernor";
import { buildProductionCostPreflight } from "../src/lib/production/ProductionCostPreflight";
import { committedCostUsd } from "../src/lib/production/ProductionCostReservationLedger";
import { readCostLedger } from "../src/lib/production/ProductionCostReservationStore";
import { shutdownProductionProcessRuntime } from "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import type { SceneData } from "../src/types/scene";
import type { ScriptData } from "../src/types/script";

const VALUE_FLAGS = new Set(["--project", "--approved-cap", "--allowance", "--allowance-basis", "--ledger"]);
const usd = (text: string | undefined): number | null => {
  if (text === undefined) return null;
  const value = Number(text);
  if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(value) || value > 1000) throw new Error("COST_GOVERNOR_ARGUMENTS_INVALID");
  return value;
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (VALUE_FLAGS.has(arg) && args[i + 1] !== undefined && !args[i + 1]!.startsWith("--") && !values.has(arg)) values.set(arg, args[++i]!);
    else throw new Error("COST_GOVERNOR_ARGUMENTS_INVALID");
  }
  const projectSlug = values.get("--project");
  const basisText = values.get("--allowance-basis");
  const allowanceUsd = usd(values.get("--allowance"));
  if (!projectSlug || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(projectSlug) || (allowanceUsd === null) !== (basisText === undefined) || (basisText !== undefined && basisText !== "declared" && basisText !== "revalidated")) throw new Error("COST_GOVERNOR_ARGUMENTS_INVALID");
  const approvedProjectCapUsd = usd(values.get("--approved-cap"));
  const basis: CostAllowanceBasis = allowanceUsd === null ? "NOT_DECLARED" : basisText === "revalidated" ? "REVALIDATED" : "OWNER_DECLARED_AT_PLANNING";

  try {
    const script = await ProjectReader.readJSON<ScriptData>(projectSlug, "script.json");
    const scenes = await ProjectReader.readJSON<SceneData>(projectSlug, "scenes.json");
    const preflight = await buildProductionCostPreflight({ projectSlug, script, scenes });
    const ledgerDir = values.get("--ledger");
    const ledger = ledgerDir ? readCostLedger(ledgerDir) : null;
    if (ledger && ledger.summary.problems.length > 0) throw new Error(`COST_LEDGER_UNTRUSTED: ${ledger.summary.problems.slice(0, 5).join(", ")}`);
    // This project's own reservation is not counted against it twice.
    const others = ledger ? { ...ledger.summary, active: ledger.summary.active.filter((item) => item.projectId !== projectSlug) } : null;
    const committedUsd = others ? committedCostUsd({ ...others, reservedUsd: others.active.reduce((sum, item) => sum + item.capUsd, 0) }) : 0;
    const { components, remainingPricing } = costComponentsFromEstimate(preflight.remainingEstimate);
    const report = governProductionCost({
      components, remainingPricing, observedUsd: preflight.observedUsd, observedPricing: preflight.observedHasUnknownPricing ? "UNKNOWN" : "KNOWN", approvedProjectCapUsd,
      policy: { preferredTargetUsd: PRODUCTION_COST_POLICY.preferredTargetUsd, technicalCeilingUsd: preflight.budgetUsd },
      allowance: { basis, totalUsd: allowanceUsd, committedUsd },
    });
    process.stdout.write(`${JSON.stringify({ projectSlug, providers: preflight.providers, inputs: preflight.inputs, components, ledger: ledger ? { events: ledger.summary.events, active: ledger.summary.active.length, settledUsd: ledger.summary.settledUsd, reservedUsd: ledger.summary.reservedUsd } : null, report }, null, 2)}\n`);
    process.exitCode = report.decision === "CONTINUE" ? 0 : report.decision === "PAUSE_ASK_OWNER" ? 2 : 3;
  } finally {
    await shutdownProductionProcessRuntime();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ error: "COST_GOVERNOR_FAILED", detail: (error instanceof Error ? error.message : String(error)).slice(0, 200) })}\n`);
  process.exitCode = 1;
});
