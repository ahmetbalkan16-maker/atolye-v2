import { AYAS_GENERATOR_SOURCES, runAyasDiscoveryFindings, type AyasDiscoveryFinding } from "./AyasPatchDetectors";
import { classifyAyasFindingValue, type AyasFindingValueClass } from "./AyasFindingValueClass";
import { classifyPatchSet } from "../selfheal/BrainPatchSafety";
import type { AyasGoal, AyasGoalStatus } from "./AyasGoalStore";
import { createAyasExternalResearchStore, type AyasExternalResearchFinding, type AyasExternalResearchStore } from "./AyasExternalResearchStore";
import { AYAS_CAPABILITY_CATEGORY_RELATED_PATHS } from "./AyasCapabilityTaxonomy";

/**
 * M22.1/M22.5 — the real goal analysis engine. Deliberately NOT a new
 * planning/AI layer: it is a deterministic aggregation-and-filter pass over
 * mechanisms that already exist and are already independently governed —
 * AYAS_GENERATOR_SOURCES (M19's real discovery), runAyasDiscoveryFindings
 * (the informational scanners), and AyasExternalResearchStore (M22.3's
 * durable research record). A goal's `allowedDomains`/`excludedDomains`
 * only ever NARROW what this engine surfaces from those existing sources;
 * it never invents a new candidate, never runs a sandbox itself, and never
 * authorizes anything. Every matched discovery candidate still carries its
 * own real safety classification (BrainPatchSafety, unchanged) and value
 * classification (M20.1, unchanged) — a goal cannot make a REVIEW_REQUIRED
 * file SAFE, or a TEST_QUALITY finding suddenly count as PRODUCT_BEHAVIOR.
 *
 * This function is pure and read-only: it never mutates the goal store
 * itself. The caller (a script, or a future UI action) decides what to do
 * with the result — record evidence, add candidates, transition status —
 * through the goal store's own explicit API, exactly the same separation
 * of "what was found" from "what happens next" every other AYAS discovery
 * mechanism already uses.
 */
export interface AyasGoalDiscoveryMatch {
  readonly candidateId: string;
  readonly discoveryClass: string;
  readonly exactFiles: readonly string[];
  readonly objective: string;
  readonly valueClass: AyasFindingValueClass;
  readonly safetyClassification: "SAFE" | "REVIEW_REQUIRED" | "FORBIDDEN_AUTONOMOUS";
}

export interface AyasGoalFindingMatch {
  readonly detectorClass: string;
  readonly summary: string;
}

export interface AyasGoalAnalysisResult {
  readonly matchedDiscoveryCandidates: readonly AyasGoalDiscoveryMatch[];
  readonly matchedInformationalFindings: readonly AyasGoalFindingMatch[];
  readonly matchedResearchFindings: readonly AyasExternalResearchFinding[];
  readonly evidence: readonly string[];
  readonly suggestedStatus: AyasGoalStatus;
}

function normPath(p: string): string { return p.replace(/\\/g, "/").replace(/^\.\//, ""); }

function withinScope(exactFiles: readonly string[], allowedDomains: readonly string[], excludedDomains: readonly string[]): boolean {
  const files = exactFiles.map(normPath);
  if (files.some((f) => excludedDomains.some((ex) => f.startsWith(normPath(ex))))) return false;
  if (allowedDomains.length === 0) return true; // no restriction declared — matches BrainPatchSafety's own "no rule matched" fail-open-to-broader-scan posture, narrowed only by excludedDomains
  return files.every((f) => allowedDomains.some((allow) => f.startsWith(normPath(allow))));
}

function goalMentions(goal: Pick<AyasGoal, "userIntent" | "scope">, text: string): boolean {
  const haystack = `${goal.userIntent} ${goal.scope}`.toLowerCase();
  return text.toLowerCase().split(/\s+/).filter((w) => w.length > 3).some((word) => haystack.includes(word));
}

export interface AyasGoalAnalysisDeps {
  readonly repoRoot: string;
  readonly researchStore?: AyasExternalResearchStore;
}

export function analyzeAyasGoal(goal: AyasGoal, deps: AyasGoalAnalysisDeps): AyasGoalAnalysisResult {
  const researchStore = deps.researchStore ?? createAyasExternalResearchStore();
  const evidence: string[] = [];

  // --- real, generator-backed discovery candidates, filtered to the goal's scope ---
  const matchedDiscoveryCandidates: AyasGoalDiscoveryMatch[] = [];
  for (const source of AYAS_GENERATOR_SOURCES) {
    let generated;
    try { generated = source.discover(deps.repoRoot); } catch { continue; } // a source failing to scan never blocks the rest of analysis
    for (const candidate of generated) {
      if (!withinScope(candidate.exactFiles, goal.allowedDomains, goal.excludedDomains)) continue;
      const safety = classifyPatchSet(candidate.exactFiles);
      matchedDiscoveryCandidates.push({
        candidateId: candidate.candidateId,
        discoveryClass: source.discoveryClass,
        exactFiles: candidate.exactFiles,
        objective: candidate.objective,
        valueClass: classifyAyasFindingValue(candidate.exactFiles),
        safetyClassification: safety.level,
      });
    }
  }
  if (matchedDiscoveryCandidates.length > 0) {
    evidence.push(`${matchedDiscoveryCandidates.length} real discovery candidate(s) fall within this goal's scope (${matchedDiscoveryCandidates.map((c) => c.discoveryClass).join(", ")})`);
  }

  // --- informational findings (detect-only classes), filtered the same way ---
  let allFindings: readonly AyasDiscoveryFinding[] = [];
  try { allFindings = runAyasDiscoveryFindings(deps.repoRoot); } catch { /* never blocks the rest of analysis */ }
  const matchedInformationalFindings: AyasGoalFindingMatch[] = allFindings
    .filter((f) => withinScope(f.evidence, goal.allowedDomains, goal.excludedDomains))
    .map((f) => ({ detectorClass: f.detectorClass, summary: f.summary }));
  if (matchedInformationalFindings.length > 0) {
    evidence.push(`${matchedInformationalFindings.length} informational finding(s) fall within this goal's scope`);
  }

  // --- durable external research findings relevant to this goal ---
  let matchedResearchFindings: readonly AyasExternalResearchFinding[] = [];
  try {
    matchedResearchFindings = researchStore.list().filter((finding) => {
      if (finding.atolyeGapStatus === "already-supported") return false; // nothing to do if Atölye already has it
      const categoryPaths = finding.category ? AYAS_CAPABILITY_CATEGORY_RELATED_PATHS[finding.category] : [];
      const categoryInScope = categoryPaths.length > 0 && withinScope(categoryPaths, goal.allowedDomains, goal.excludedDomains);
      const textMatch = goalMentions(goal, `${finding.capability} ${finding.problemSolved}`);
      return categoryInScope || textMatch;
    });
  } catch { /* never blocks the rest of analysis */ }
  if (matchedResearchFindings.length > 0) {
    evidence.push(`${matchedResearchFindings.length} external research finding(s) relevant to this goal's intent/scope, not yet fully supported by Atölye`);
  }

  const hasAnything = matchedDiscoveryCandidates.length > 0 || matchedResearchFindings.length > 0;
  const suggestedStatus: AyasGoalStatus = hasAnything ? "ACTIVE" : "BLOCKED";
  if (!hasAnything) evidence.push("no real discovery candidate or research finding currently falls within this goal's declared scope");

  return { matchedDiscoveryCandidates, matchedInformationalFindings, matchedResearchFindings, evidence, suggestedStatus };
}
