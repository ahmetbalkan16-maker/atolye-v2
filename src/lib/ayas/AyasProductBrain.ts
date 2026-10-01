import type { BrainConsoleSnapshot } from "@/lib/brain/ui/BrainConsoleSnapshot";
import { loadBrainSelfHealSnapshot } from "@/lib/brain/ui/BrainSelfHealConsoleSnapshot";
import { runAyasReadOnlyAction } from "./execution/AyasActionRuntime";
import { AYAS_CONTROLLED_SELF_IMPROVEMENT_CHAIN } from "./execution/AyasControlledSelfImprovement";

export type AyasProductBrainName = "Repo Brain" | "Decision Brain" | "Failure Brain" | "Sprint Brain" | "Project Brain";
export interface AyasProductBrainContext { readonly reachable: Readonly<Record<AyasProductBrainName, true>>; readonly lines: readonly string[]; }

/**
 * Product composition only: reuses existing authorities and performs reads.
 * The repository, checkpoint and production catalogue reads go through the
 * guarded read tools (one exact-scope lease each). The self-heal summary and
 * the console snapshot are fixed server context: this code names their
 * source, no request field does.
 */
export async function loadAyasProductBrainContext(snapshot: BrainConsoleSnapshot): Promise<AyasProductBrainContext> {
  const request = (action: "inspect-repository-status" | "read-project-document" | "list-production-projects", plan: Record<string, unknown>) => runAyasReadOnlyAction({ rawRequest: { schemaVersion: "1", action, requestedBy: "ayas-product-brain", intent: "bounded product context", plan } });
  const [repo, sprint, catalog] = await Promise.all([
    request("inspect-repository-status", {}),
    request("read-project-document", { documentId: "checkpoint" }),
    request("list-production-projects", { mode: "summary" }),
  ]);
  let failure = "failure snapshot unavailable";
  try { const view = loadBrainSelfHealSnapshot(); failure = `${view.health.summary}; open=${view.health.openIncidents}; human=${view.health.needsHuman}`; } catch { /* fail-soft read context */ }
  const safeSummary = (value: typeof repo) => value.executed ? value.result.summary.slice(0, 300) : `unavailable:${String(value.reason)}`;
  const projectSummary = (value: typeof catalog): string => {
    if (!value.executed) return `unavailable:${String(value.reason)}`;
    const summary = value.result.data.summary as Record<string, unknown> | undefined;
    const count = (key: string): number | null => Number.isSafeInteger(summary?.[key]) ? Number(summary![key]) : null;
    const [total, completed, incomplete, resumable] = [count("totalProjects"), count("completedCount"), count("incompleteCount"), count("resumableCount")];
    if (total === null || completed === null || incomplete === null || resumable === null) return "unavailable:catalog-summary-invalid";
    return `total=${total}; completed=${completed}; incomplete=${incomplete}; resumable=${resumable}`;
  };
  return Object.freeze({
    reachable: Object.freeze({ "Repo Brain": true, "Decision Brain": true, "Failure Brain": true, "Sprint Brain": true, "Project Brain": true }),
    lines: Object.freeze([
      `Repo Brain: ${safeSummary(repo)}`,
      `Decision Brain: safety=${snapshot.safety.decision}; next=${snapshot.lastCycle?.nextSingleStep ?? "no recorded cycle"}`,
      `Failure Brain: ${failure}`,
      `Sprint Brain: ${safeSummary(sprint)}`,
      `Project Brain: ${projectSummary(catalog)}`,
      `Controlled improvement: ${AYAS_CONTROLLED_SELF_IMPROVEMENT_CHAIN.join(" → ")}`,
    ]),
  });
}
