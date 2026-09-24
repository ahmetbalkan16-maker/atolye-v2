/**
 * Stage 10 review planning and finding classification. Pure and advisory: a
 * review result is evidence for the owner; it never approves, merges or
 * publishes anything. Severity must be earned by reachability and impact.
 */
import { collectAyasChangeAreas, type AyasChangeArea, type AyasDeveloperTask } from "./AyasDeveloperTaskModel";

export type AyasReviewDimension =
  | "correctness" | "scope" | "injection" | "authority" | "path-containment" | "secrets" | "replay" | "durability"
  | "migration" | "write-authority" | "false-positive" | "false-negative" | "fallback" | "tool-agent-authority"
  | "stale-data" | "temporal-correctness" | "privacy" | "approval-binding" | "lock-safety" | "server-client-boundary"
  | "test-isolation" | "factual-claims" | "git-safety" | "hardcoding";

const AREA_DIMENSIONS: Readonly<Partial<Record<AyasChangeArea, readonly AyasReviewDimension[]>>> = {
  security: ["injection", "authority", "path-containment", "secrets", "replay"],
  storage: ["path-containment", "durability", "migration", "write-authority"],
  data: ["durability", "write-authority"],
  router: ["false-positive", "false-negative", "fallback", "tool-agent-authority"],
  memory: ["stale-data", "temporal-correctness", "privacy"],
  authority: ["approval-binding", "replay", "lock-safety", "authority"],
  "execution-gate": ["approval-binding", "replay", "lock-safety", "authority"],
  "production-pipeline": ["durability", "replay"],
  frontend: ["server-client-boundary"],
  trace: ["privacy", "secrets"],
  conversational: ["false-positive", "fallback", "privacy"],
  developer: ["git-safety", "tool-agent-authority", "hardcoding"],
  tests: ["test-isolation"],
  documentation: ["factual-claims"],
  config: ["secrets", "scope"],
};

const CHECK: Readonly<Record<AyasReviewDimension, string>> = {
  correctness: "Changed logic produces the intended result on the evaluated cases.",
  scope: "Diff stays inside the declared file scope; no config/generated drift.",
  injection: "Untrusted text stays data; no command/prompt/path injection reaches an executor.",
  authority: "No new path grants approval, execution or publication authority.",
  "path-containment": "Paths are normalized, contained and reject links/traversal.",
  secrets: "No key, token or credential file content is read, logged or emitted.",
  replay: "Approvals/operations cannot be replayed or applied twice.",
  durability: "Writes are atomic and crash-safe; partial failure is recoverable.",
  migration: "Existing data is read compatibly; no silent format break.",
  "write-authority": "Writes target the explicit root/context, never an ambient default.",
  "false-positive": "Routing does not trigger on unrelated wording.",
  "false-negative": "Routing still triggers on paraphrases and Turkish variants.",
  fallback: "Fallbacks are honest and never silently switch to paid/unsafe paths.",
  "tool-agent-authority": "Recommended tools/agents stay advisory; nothing dispatches itself.",
  "stale-data": "Superseded facts cannot override newer ones.",
  "temporal-correctness": "Current vs historical state is resolved by time, not order of arrival.",
  privacy: "No raw prompt, memory or source is persisted or traced.",
  "approval-binding": "Approval stays bound to exact ID + hash; drift invalidates it.",
  "lock-safety": "Locks are never blindly deleted; stale reclaim is verified.",
  "server-client-boundary": "Server-only authority is not imported into client/read-only actions.",
  "test-isolation": "Tests use TEMP runtime/authority/legacy/brain roots; no live data writes.",
  "factual-claims": "Every documented claim is backed by observed evidence.",
  "git-safety": "Guidance never implies reset/clean/stash/force/git add -A.",
  hardcoding: "No fixture IDs, benchmark phrases or test hashes in production logic.",
};

export interface AyasReviewPlan {
  readonly dimensions: readonly AyasReviewDimension[];
  readonly checklist: readonly string[];
  readonly passes: number;
}

export function planAyasReview(task: AyasDeveloperTask, changedFiles: readonly string[]): AyasReviewPlan {
  const areas = new Set<AyasChangeArea>([...task.areas, ...collectAyasChangeAreas(changedFiles)]);
  const dims = new Set<AyasReviewDimension>(["correctness", "scope"]);
  for (const area of areas) for (const dim of AREA_DIMENSIONS[area] ?? []) dims.add(dim);
  if (task.securitySensitive) for (const dim of AREA_DIMENSIONS.security!) dims.add(dim);
  if (areas.size > 0 && [...areas].every((area) => area === "documentation")) { dims.clear(); dims.add("factual-claims"); dims.add("scope"); }
  const dimensions = [...dims];
  return Object.freeze({ dimensions, checklist: dimensions.map((dim) => `${dim}: ${CHECK[dim]}`), passes: task.mutating ? 2 : 1 });
}

export type AyasFindingClass = "BLOCKER" | "MAJOR" | "MINOR" | "PRE_EXISTING" | "OUT_OF_SCOPE" | "FALSE_POSITIVE";
export interface AyasReviewFindingInput {
  readonly claimedSeverity: "BLOCKER" | "MAJOR" | "MINOR";
  readonly disproven: boolean;
  readonly reachable: boolean | null;
  readonly impactEvidence: boolean;
  readonly presentOnBaseline: boolean | null;
  readonly introducedByChange: boolean | null;
  readonly inTaskScope: boolean;
  readonly impactKind?: "authority" | "data-integrity" | "security" | "build" | "correctness" | "quality";
}

export function classifyAyasReviewFinding(finding: AyasReviewFindingInput): { readonly findingClass: AyasFindingClass; readonly reasonCode: string } {
  const out = (findingClass: AyasFindingClass, reasonCode: string) => Object.freeze({ findingClass, reasonCode });
  if (finding.disproven) return out("FALSE_POSITIVE", "DISPROVEN_BY_EVIDENCE");
  if (finding.presentOnBaseline === true && finding.introducedByChange !== true) return out("PRE_EXISTING", "PRESENT_ON_TRUSTED_BASELINE");
  if (!finding.inTaskScope && finding.introducedByChange !== true) return out("OUT_OF_SCOPE", "OUTSIDE_TASK_SCOPE");
  if (finding.claimedSeverity !== "MINOR" && !(finding.reachable === true && finding.impactEvidence)) return out("MINOR", "SEVERITY_UNSUPPORTED_BY_REACHABILITY_OR_IMPACT");
  if (finding.claimedSeverity === "BLOCKER" && !["authority", "data-integrity", "security", "build"].includes(finding.impactKind ?? "")) return out("MAJOR", "BLOCKER_REQUIRES_AUTHORITY_DATA_SECURITY_OR_BUILD_IMPACT");
  return out(finding.claimedSeverity, "EVIDENCED");
}
