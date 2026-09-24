/**
 * Bounded, advisory capability matching. This module never invokes a tool,
 * loads a skill, calls a model, delegates an agent, or grants approval.
 * Availability must be supplied from an actual runtime registration/probe.
 */
import { AYAS_EXECUTION_ALLOWLIST } from "../execution/AyasExecutionPolicy";
import {
  CHECKPOINT_MENTION, ROADMAP_MENTION, CHANGELOG_MENTION,
  extractAyasFilePathMention, hasMultipleAyasFilePathMentions,
  resolveAyasProjectCatalogFilterKind, isAyasDevelopmentStatusQuery,
} from "../model/AyasComplexityRouter";
import { classifyAyasComplexity } from "../model/AyasComplexityRouter";

export type AyasTaskClass = "conversation" | "memory" | "research" | "file" | "repository" | "coding" | "project";
export type AyasToolNeed = "REQUIRED" | "BENEFICIAL" | "NOT_NEEDED" | "UNAVAILABLE" | "UNSAFE_NOT_AUTHORIZED";
export type AyasCapabilityType = "tool" | "skill" | "model" | "agent";
export type AyasCapability = {
  readonly id: string;
  readonly type: AyasCapabilityType;
  readonly taskClasses: readonly AyasTaskClass[];
  readonly available: boolean;
  readonly source: "execution-allowlist" | "descriptive-only" | "project-local-unregistered" | "installed-unregistered" | "runtime-probe" | "runtime-registration" | "local";
  readonly costClass: "zero" | "unknown";
  readonly latencyClass: "low" | "variable";
  readonly locality: "local" | "external";
  readonly deterministic: boolean;
  readonly mutates: boolean;
  readonly requiresApproval: boolean;
  readonly fallbackEligible: boolean;
};

const SKILLS = Object.freeze([
  { id: "ayas-tests", taskClasses: ["coding"] as const },
  { id: "ayas-conversational-intelligence", taskClasses: ["conversation", "memory", "research"] as const },
  { id: "ayas-router", taskClasses: ["repository", "coding"] as const },
  { id: "graphify", taskClasses: ["repository"] as const },
]);
const TOOL_CLASS: Partial<Record<keyof typeof AYAS_EXECUTION_ALLOWLIST, readonly AyasTaskClass[]>> = {
  "inspect-project": ["project"],
  "pipeline-recovery-plan": ["project"],
  "read-project-document": ["file", "repository"],
  "inspect-source-file": ["file", "repository"],
  "search-project-source": ["repository"],
  "inspect-repository-status": ["repository"],
  "inspect-repository-diff": ["repository"],
  "inspect-git-history": ["repository"],
  "inspect-source-range": ["file", "repository"],
  "query-graphify": ["repository"],
  "run-developer-validation": ["coding", "repository"],
  "list-production-projects": ["project"],
  "ayas-development-status": ["project"],
};

export interface AyasAvailabilityEvidence {
  /** Only IDs confirmed by a current provider probe may appear here. */
  readonly availableModelIds: readonly string[];
  /** Project-local files alone do not register a runtime skill. */
  readonly availableSkillIds?: readonly string[];
  /** Only agents with a real caller-owned adapter may appear here. */
  readonly availableAgentIds?: readonly string[];
  readonly unavailableToolIds?: readonly string[];
  /** Verified prior result for this same request; never supplied from user text. */
  readonly verifiedToolResultIds?: readonly string[];
  /** Optional deterministic evidence, 0–5. A tie yields no delegation. */
  readonly agentEvidence?: Readonly<Record<string, number>>;
}

/** A snapshot, built from real allowlist IDs and explicit availability evidence. */
export function inventoryAyasCapabilities(evidence: AyasAvailabilityEvidence): readonly AyasCapability[] {
  const unavailableTools = new Set(evidence.unavailableToolIds ?? []);
  const tools: AyasCapability[] = Object.values(AYAS_EXECUTION_ALLOWLIST).map((spec) => ({
    id: spec.id, type: "tool", taskClasses: TOOL_CLASS[spec.id] ?? [],
    available: !unavailableTools.has(spec.id), source: "execution-allowlist",
    costClass: "zero", latencyClass: "low", locality: "local", deterministic: true,
    mutates: spec.write, requiresApproval: spec.write, fallbackEligible: !spec.write,
  }));
  return Object.freeze([
    ...tools,
    { id: "web-research-lookup", type: "tool", taskClasses: ["research"], available: false,
      source: "descriptive-only", costClass: "unknown", latencyClass: "variable", locality: "external",
      deterministic: false, mutates: false, requiresApproval: false, fallbackEligible: false },
    ...SKILLS.map((skill): AyasCapability => ({
      id: skill.id, type: "skill", taskClasses: skill.taskClasses,
      available: Boolean(evidence.availableSkillIds?.includes(skill.id)),
      source: evidence.availableSkillIds?.includes(skill.id) ? "runtime-registration" : skill.id === "graphify" ? "installed-unregistered" : "project-local-unregistered",
      costClass: "zero", latencyClass: "low", locality: "local", deterministic: true,
      mutates: false, requiresApproval: false, fallbackEligible: false,
    })),
    { id: "ollama", type: "model", taskClasses: ["conversation", "memory", "research", "file", "repository", "coding", "project"],
      available: evidence.availableModelIds.includes("ollama"), source: "runtime-probe", costClass: "zero",
      latencyClass: "variable", locality: "local", deterministic: false, mutates: false,
      requiresApproval: false, fallbackEligible: false },
    { id: "cloud", type: "model", taskClasses: ["conversation", "memory", "research", "file", "repository", "coding", "project"],
      available: false, source: "descriptive-only", costClass: "unknown", latencyClass: "variable",
      locality: "external", deterministic: false, mutates: false, requiresApproval: false, fallbackEligible: false },
    { id: "local-ayas", type: "agent", taskClasses: ["conversation", "memory", "research", "file", "repository", "coding", "project"],
      available: true, source: "local", costClass: "zero", latencyClass: "low", locality: "local",
      deterministic: false, mutates: false, requiresApproval: false, fallbackEligible: true },
    ...(["claude", "codex"] as const).map((id): AyasCapability => ({
      id, type: "agent", taskClasses: ["coding", "repository"],
      available: Boolean(evidence.availableAgentIds?.includes(id)), source: "runtime-registration",
      costClass: "unknown", latencyClass: "variable", locality: "external", deterministic: false,
      mutates: true, requiresApproval: true, fallbackEligible: false,
    })),
  ] as AyasCapability[]);
}

export interface AyasTaskRequirement {
  readonly taskClass: AyasTaskClass;
  readonly action: boolean;
  readonly mutation: boolean;
  readonly requiresFreshExternalEvidence: boolean;
  readonly privateLocal: boolean;
  readonly complex: boolean;
  readonly ambiguous: boolean;
  readonly requiredToolId: string | null;
  readonly beneficialToolId: string | null;
  readonly relevantSkillId: string | null;
}

function fold(text: string): string {
  return text.toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ç/g, "c")
    .replace(/ö/g, "o").replace(/ü/g, "u");
}

/** Conservative structural features; an unknown wording remains conversational. */
export function describeAyasTask(text: string): AyasTaskRequirement {
  const t = fold(String(text ?? "").slice(0, 4_000));
  const filePath = extractAyasFilePathMention(text);
  const artifactContext = Boolean(filePath) || /\b(dosya\w*|file\w*|kod\w*|repo\w*|depo\w*|script\w*)\b/.test(t);
  const mutation = /\b(degistir\w*|degisik\w*(?:\s+\w+){0,3}\s+(?:yap|uygula)|duzenle\w*|guncelle\w*|uygula\w*|sil\w*|kaydet\w*|commit|push)\b/.test(t)
    || (artifactContext && /\b(yaz|olustur\w*)\b/.test(t));
  const privateLocal = /\b(ozel|gizli|private|hassas|yerel dosyam)\b/.test(t);
  const fresh = /\b(bugun\w*|su anki|guncel|en son|son dakika|latest|today|current|now)\b/.test(t)
    && /\b(dis|haber\w*|dunya|external|web|internet|kaynaklar|hava|weather|borsa|hisse|stock|fiyat\w*|price|kur\w*|exchange|secim\w*|election)\b/.test(t);
  const multipleFiles = hasMultipleAyasFilePathMentions(text);
  // A filename like ROADMAP.md is one target, not a second document mention.
  const withoutPath = filePath ? text.replace(filePath, "") : text;
  const docCount = [CHECKPOINT_MENTION, ROADMAP_MENTION, CHANGELOG_MENTION].filter((re) => re.test(withoutPath)).length;
  const doc = docCount === 1;
  const repoStatus = /\bgit (durum\w*|status)\b/.test(t);
  const repoAnalysis = /\b(depo\w*|repo\w*|kod taban\w*)\b/.test(t) && /\b(mimari\w*|bagimlilik\w*|graphify)\b/.test(t);
  const code = /\b(kod|typescript|code|refactor|kod taban)\b/.test(t) && mutation;
  const smokePlan = /\b(smoke|test)\b/.test(t) && /\b(plan\w*|dogrulama\w*)\b/.test(t);
  const memory = /\b(adim neydi|hatirliyor musun|remember|benim adim)\b/.test(t);
  const project = resolveAyasProjectCatalogFilterKind(text) !== null || isAyasDevelopmentStatusQuery(text);
  const ambiguous = multipleFiles || docCount > 1 || Boolean(filePath && doc);
  let taskClass: AyasTaskClass = "conversation";
  if (fresh) taskClass = "research";
  else if (code || smokePlan) taskClass = "coding";
  else if (filePath || doc) taskClass = "file";
  else if (repoStatus || repoAnalysis) taskClass = "repository";
  else if (project) taskClass = "project";
  else if (memory) taskClass = "memory";
  let requiredToolId: string | null = null;
  if (fresh) requiredToolId = "web-research-lookup";
  else if (!mutation && !ambiguous) {
    if (filePath) requiredToolId = "inspect-source-file";
    else if (doc) requiredToolId = "read-project-document";
    else if (repoStatus) requiredToolId = "inspect-repository-status";
    else if (project) requiredToolId = isAyasDevelopmentStatusQuery(text) ? "ayas-development-status" : "list-production-projects";
  }
  const relevantSkillId = smokePlan ? "ayas-tests"
    : repoAnalysis ? "graphify"
    : taskClass === "memory" ? "ayas-conversational-intelligence" : null;
  return {
    taskClass, action: mutation, mutation, requiresFreshExternalEvidence: fresh, privateLocal,
    complex: code || classifyAyasComplexity(text) === "COMPLEX", ambiguous,
    requiredToolId, beneficialToolId: repoAnalysis ? "query-graphify" : null, relevantSkillId,
  };
}

export interface AyasAgenticSelection {
  readonly requirement: AyasTaskRequirement;
  readonly toolNeed: AyasToolNeed;
  readonly selectedToolId: string | null;
  readonly selectedSkillId: string | null;
  readonly selectedModelId: "ollama" | null;
  readonly selectedAgentId: string;
  /** True means a missing requirement or an external approval is still needed. */
  readonly blocked: boolean;
  readonly reasonCodes: readonly string[];
  readonly candidateCounts: Readonly<Record<AyasCapabilityType, number>>;
}

export function selectAyasAgenticRoute(input: { readonly text: string } & AyasAvailabilityEvidence): AyasAgenticSelection {
  const requirement = describeAyasTask(input.text);
  const inventory = inventoryAyasCapabilities(input);
  const byId = (id: string) => inventory.find((candidate) => candidate.id === id);
  const reasons: string[] = [];
  let selectedToolId: string | null = null;
  let toolNeed: AyasToolNeed = "NOT_NEEDED";
  if (requirement.mutation) {
    toolNeed = "UNSAFE_NOT_AUTHORIZED";
    reasons.push("MUTATION_REQUIRES_EXTERNAL_APPROVAL");
  } else if (requirement.ambiguous) {
    toolNeed = "UNAVAILABLE";
    reasons.push("AMBIGUOUS_TARGET");
  } else if (requirement.requiredToolId) {
    const candidate = byId(requirement.requiredToolId);
    if (!requirement.requiresFreshExternalEvidence && input.verifiedToolResultIds?.includes(requirement.requiredToolId)) {
      toolNeed = "NOT_NEEDED";
      reasons.push("VERIFIED_TOOL_RESULT_PRESENT");
    } else if (candidate?.available && !candidate.mutates) {
      selectedToolId = candidate.id;
      toolNeed = "REQUIRED";
      reasons.push("REQUIRED_TOOL_AVAILABLE");
    } else {
      toolNeed = "UNAVAILABLE";
      reasons.push("REQUIRED_TOOL_UNAVAILABLE");
    }
  } else if (requirement.beneficialToolId && byId(requirement.beneficialToolId)?.available) {
    // Graphify query needs a validated symbol. Recommend it but do not invent
    // a target or turn a helpful lookup into an ungrounded dispatch.
    toolNeed = "BENEFICIAL";
    reasons.push("BENEFICIAL_TOOL_REQUIRES_TARGET");
  }
  const skill = requirement.relevantSkillId ? byId(requirement.relevantSkillId) : undefined;
  const selectedSkillId = skill?.available ? skill.id : null;
  if (requirement.relevantSkillId) reasons.push(selectedSkillId ? "RELEVANT_SKILL_REGISTERED" : "RELEVANT_SKILL_UNREGISTERED");
  const selectedModelId = byId("ollama")?.available ? "ollama" : null;
  if (!selectedModelId) reasons.push("LOCAL_MODEL_UNAVAILABLE_NO_PAID_FALLBACK");
  let selectedAgentId = "local-ayas";
  if (requirement.taskClass === "coding" && requirement.mutation && !requirement.privateLocal) {
    const agents = inventory.filter((candidate) => candidate.type === "agent" && candidate.id !== "local-ayas" && candidate.available);
    if (agents.length === 1) selectedAgentId = agents[0]!.id;
    else if (agents.length > 1) {
      const scored = agents.map((candidate) => ({ id: candidate.id, score: input.agentEvidence?.[candidate.id] }));
      const valid = scored.filter((item) => Number.isFinite(item.score) && item.score! >= 0 && item.score! <= 5);
      if (valid.length === agents.length) {
        valid.sort((a, b) => b.score! - a.score!);
        if (valid[0]!.score! > valid[1]!.score!) selectedAgentId = valid[0]!.id;
      }
    }
    reasons.push(selectedAgentId === "local-ayas" ? "NO_EVIDENCED_AGENT_ROUTE" : "REGISTERED_AGENT_RECOMMENDED");
  }
  const blocked = requirement.mutation || requirement.ambiguous ||
    (requirement.requiredToolId !== null && selectedToolId === null && toolNeed !== "NOT_NEEDED") || selectedModelId === null;
  const candidateCounts = {
    tool: inventory.filter((candidate) => candidate.type === "tool" && candidate.available).length,
    skill: inventory.filter((candidate) => candidate.type === "skill" && candidate.available).length,
    model: inventory.filter((candidate) => candidate.type === "model" && candidate.available).length,
    agent: inventory.filter((candidate) => candidate.type === "agent" && candidate.available).length,
  };
  return { requirement, toolNeed, selectedToolId, selectedSkillId, selectedModelId,
    selectedAgentId, blocked, reasonCodes: Object.freeze(reasons), candidateCounts };
}
