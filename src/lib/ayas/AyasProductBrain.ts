import type { BrainConsoleSnapshot } from "@/lib/brain/ui/BrainConsoleSnapshot";
import { loadBrainSelfHealSnapshot } from "@/lib/brain/ui/BrainSelfHealConsoleSnapshot";
import { runAyasReadOnlyAction } from "./execution/AyasActionRuntime";
import { AYAS_CONTROLLED_SELF_IMPROVEMENT_CHAIN } from "./execution/AyasControlledSelfImprovement";
import { loadAyasProjectCatalog, summarizeAyasProductionProjects } from "./AyasProjectCatalog";

export type AyasProductBrainName = "Repo Brain" | "Decision Brain" | "Failure Brain" | "Sprint Brain" | "Project Brain";
export interface AyasProductBrainContext { readonly reachable: Readonly<Record<AyasProductBrainName, true>>; readonly lines: readonly string[]; }

/** Product composition only: reuses existing authorities and performs reads. */
export async function loadAyasProductBrainContext(snapshot: BrainConsoleSnapshot): Promise<AyasProductBrainContext> {
  const request = (action: "inspect-repository-status" | "read-project-document", plan: Record<string, unknown>) => runAyasReadOnlyAction({ rawRequest: { schemaVersion: "1", action, requestedBy: "ayas-product-brain", intent: "bounded product context", plan } });
  const [repo, sprint, catalog] = await Promise.all([
    request("inspect-repository-status", {}),
    request("read-project-document", { documentId: "checkpoint" }),
    loadAyasProjectCatalog().catch(() => ({ available: false, projects: [], notes: ["catalog unavailable"], runtimeClassification: "unavailable" as const, external: false })),
  ]);
  let failure = "failure snapshot unavailable";
  try { const view = loadBrainSelfHealSnapshot(); failure = `${view.health.summary}; open=${view.health.openIncidents}; human=${view.health.needsHuman}`; } catch { /* fail-soft read context */ }
  const projects = summarizeAyasProductionProjects(catalog.projects);
  const safeSummary = (value: typeof repo) => value.executed ? value.result.summary.slice(0, 300) : `unavailable:${String(value.reason)}`;
  return Object.freeze({
    reachable: Object.freeze({ "Repo Brain": true, "Decision Brain": true, "Failure Brain": true, "Sprint Brain": true, "Project Brain": true }),
    lines: Object.freeze([
      `Repo Brain: ${safeSummary(repo)}`,
      `Decision Brain: safety=${snapshot.safety.decision}; next=${snapshot.lastCycle?.nextSingleStep ?? "no recorded cycle"}`,
      `Failure Brain: ${failure}`,
      `Sprint Brain: ${safeSummary(sprint)}`,
      `Project Brain: total=${projects.totalProjects}; completed=${projects.completedCount}; incomplete=${projects.incompleteCount}; resumable=${projects.resumableCount}`,
      `Controlled improvement: ${AYAS_CONTROLLED_SELF_IMPROVEMENT_CHAIN.join(" → ")}`,
    ]),
  });
}
