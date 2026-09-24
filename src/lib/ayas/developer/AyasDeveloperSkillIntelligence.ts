/**
 * Stage 10 minimum-skill selection for developer handoffs. Pure and advisory:
 * a skill is guidance for the receiving agent, never an authority grant, and
 * this module never loads, invokes or registers one. Registration is a fact
 * about a specific host (Claude Code, Codex, AYAS runtime) and must be
 * supplied as evidence; a SKILL.md on disk is only "installed".
 */
import type { AyasDeveloperGate } from "./AyasRepositoryRecovery";
import type { AyasDeveloperTask } from "./AyasDeveloperTaskModel";

export type AyasSkillHost = "claude" | "codex" | "ayas-runtime";
export type AyasSkillRelevance = "REQUIRED" | "HELPFUL" | "NOT_NEEDED";
export type AyasSkillStatus = "REQUIRED" | "HELPFUL" | "NOT_NEEDED" | "UNAVAILABLE" | "INSTALLED_BUT_NOT_REGISTERED";

interface CatalogEntry {
  readonly id: string;
  /** Hosts where this skill can exist as a registered skill at all. */
  readonly hosts: readonly AyasSkillHost[];
  readonly localPath: string | null;
  readonly relevance: (task: AyasDeveloperTask, gate: AyasDeveloperGate | null) => AyasSkillRelevance;
}

const has = (task: AyasDeveloperTask, ...areas: string[]) => task.areas.some((area) => areas.includes(area));
const codeChange = (task: AyasDeveloperTask) => task.mutating && task.requiresTests;
const DOMAIN_AREAS = ["authority", "execution-gate", "security", "storage", "production-pipeline", "video-audio", "router", "memory", "conversational", "trace", "developer", "frontend"];
const PUBLICATION_GATES: ReadonlySet<AyasDeveloperGate> = new Set(["STAGE", "COMMIT", "PUSH", "CLOSURE", "REMOTE_VERIFICATION"]);
const local = (name: string) => `.claude/skills/ayas/${name}/SKILL.md`;

export const AYAS_DEVELOPER_SKILL_CATALOG: readonly CatalogEntry[] = Object.freeze([
  { id: "graphify", hosts: ["claude", "codex"], localPath: null, relevance: (t) => (t.requiresGraphify ? "REQUIRED" : "NOT_NEEDED") },
  { id: "ayas:tests", hosts: ["claude", "codex"], localPath: local("tests"), relevance: (t) => (t.requiresTests ? "REQUIRED" : "NOT_NEEDED") },
  { id: "ayas:authority", hosts: ["claude", "codex"], localPath: local("authority"),
    relevance: (t, gate) => (has(t, "authority", "execution-gate") ? "REQUIRED" : t.mutating && gate && PUBLICATION_GATES.has(gate) ? "HELPFUL" : "NOT_NEEDED") },
  { id: "ayas:execution-gate", hosts: ["claude", "codex"], localPath: local("execution-gate"), relevance: (t) => (has(t, "authority", "execution-gate") ? "REQUIRED" : "NOT_NEEDED") },
  { id: "ayas:storage", hosts: ["claude", "codex"], localPath: local("storage"), relevance: (t) => (has(t, "storage", "data") ? "REQUIRED" : "NOT_NEEDED") },
  { id: "ayas:frontend", hosts: ["claude", "codex"], localPath: local("frontend"), relevance: (t) => (has(t, "frontend") ? "REQUIRED" : "NOT_NEEDED") },
  { id: "ayas:production-pipeline", hosts: ["claude", "codex"], localPath: local("production-pipeline"), relevance: (t) => (has(t, "production-pipeline") ? "REQUIRED" : "NOT_NEEDED") },
  { id: "ayas:video-audio", hosts: ["claude", "codex"], localPath: local("video-audio"), relevance: (t) => (has(t, "video-audio") ? "REQUIRED" : "NOT_NEEDED") },
  { id: "ayas:conversational-intelligence", hosts: ["claude", "codex"], localPath: local("conversational-intelligence"),
    relevance: (t) => (has(t, "conversational") ? "REQUIRED" : has(t, "memory") ? "HELPFUL" : "NOT_NEEDED") },
  { id: "ayas:deployment", hosts: ["claude", "codex"], localPath: local("deployment"), relevance: (t) => (t.requiresRuntimeValidation ? "REQUIRED" : "NOT_NEEDED") },
  { id: "ayas:router", hosts: ["claude", "codex"], localPath: local("router"),
    relevance: (t) => (codeChange(t) && !t.areas.some((area) => DOMAIN_AREAS.includes(area)) ? "HELPFUL" : "NOT_NEEDED") },
  { id: "code-review", hosts: ["claude"], localPath: null, relevance: (t) => (t.kind === "code-review" ? "REQUIRED" : codeChange(t) ? "HELPFUL" : "NOT_NEEDED") },
  { id: "review-agent", hosts: ["codex"], localPath: null, relevance: (t) => (t.kind === "code-review" ? "REQUIRED" : codeChange(t) ? "HELPFUL" : "NOT_NEEDED") },
  { id: "security-review", hosts: ["claude"], localPath: null, relevance: (t) => (t.kind === "security-fix" ? "REQUIRED" : t.securitySensitive && t.mutating ? "HELPFUL" : "NOT_NEEDED") },
  { id: "karpathy-guidelines", hosts: ["claude"], localPath: null, relevance: (t) => (t.kind === "refactor" ? "HELPFUL" : "NOT_NEEDED") },
  { id: "ui-ux-pro-max", hosts: ["claude"], localPath: null, relevance: (t) => (has(t, "frontend") && t.mutating ? "HELPFUL" : "NOT_NEEDED") },
]);

export interface AyasSkillEvidence {
  /** Receiving host; null when the packet is for any developer agent. */
  readonly host: AyasSkillHost | null;
  /** Skills the receiving host has actually registered (reported by that host or its own skill home). */
  readonly registeredSkillIds: readonly string[];
  /** Project-local SKILL.md skills found on disk. */
  readonly localSkillIds: readonly string[];
}

export interface AyasSkillDecision {
  readonly skillId: string;
  readonly relevance: AyasSkillRelevance;
  readonly status: AyasSkillStatus;
  readonly delivery: "INVOKE" | "READ_FILE" | "NONE";
  readonly localPath: string | null;
  readonly reasonCode: string;
}

export interface AyasSkillSelection {
  readonly host: AyasSkillHost | null;
  readonly decisions: readonly AyasSkillDecision[];
  /** Only the skills the receiving agent should actually use. */
  readonly selected: readonly AyasSkillDecision[];
  readonly missingRequired: readonly string[];
}

export function selectAyasDeveloperSkills(task: AyasDeveloperTask, evidence: AyasSkillEvidence, gate: AyasDeveloperGate | null = null): AyasSkillSelection {
  const registered = new Set(evidence.registeredSkillIds);
  const installed = new Set(evidence.localSkillIds);
  const decisions: AyasSkillDecision[] = [];
  for (const entry of AYAS_DEVELOPER_SKILL_CATALOG) {
    // A host-specific skill (Claude built-in, Codex system) is not a candidate for another host.
    if (evidence.host !== null && !entry.hosts.includes(evidence.host) && entry.localPath === null) continue;
    const relevance = entry.relevance(task, gate);
    let status: AyasSkillStatus; let delivery: AyasSkillDecision["delivery"]; let reasonCode: string;
    if (relevance === "NOT_NEEDED") { status = "NOT_NEEDED"; delivery = "NONE"; reasonCode = "NOT_RELEVANT_TO_TASK"; }
    else if (evidence.host !== null && registered.has(entry.id) && entry.hosts.includes(evidence.host)) { status = relevance; delivery = "INVOKE"; reasonCode = "REGISTERED_ON_HOST"; }
    else if (entry.localPath !== null && installed.has(entry.id)) { status = "INSTALLED_BUT_NOT_REGISTERED"; delivery = "READ_FILE"; reasonCode = "READ_LOCAL_GUIDANCE_DIRECTLY"; }
    else { status = "UNAVAILABLE"; delivery = "NONE"; reasonCode = relevance === "REQUIRED" ? "REQUIRED_SKILL_UNAVAILABLE_FOLLOW_REPO_RULES" : "HELPFUL_SKILL_UNAVAILABLE"; }
    decisions.push({ skillId: entry.id, relevance, status, delivery, localPath: entry.localPath, reasonCode });
  }
  const selected = decisions.filter((decision) => decision.delivery !== "NONE");
  const missingRequired = decisions.filter((decision) => decision.relevance === "REQUIRED" && decision.delivery === "NONE").map((decision) => decision.skillId);
  return Object.freeze({ host: evidence.host, decisions, selected, missingRequired });
}

export interface AyasSkillUseClaim {
  readonly skillId: string;
  readonly delivery: "INVOKED" | "READ_FILE";
  /** What the skill concretely guided; empty evidence is rejected. */
  readonly evidence: string;
}
export type AyasSkillUseVerdict = "USED" | "SELECTED_NOT_USED" | "CLAIM_REJECTED_NO_EVIDENCE" | "CLAIM_REJECTED_NOT_REGISTERED" | "CLAIM_REJECTED_NOT_SELECTED";

/** Reports actual skill use: presence of a file or selection alone is never "used". */
export function reportAyasSkillUsage(selection: AyasSkillSelection, claims: readonly AyasSkillUseClaim[]): readonly { readonly skillId: string; readonly verdict: AyasSkillUseVerdict; readonly evidence: string | null }[] {
  const rows: { skillId: string; verdict: AyasSkillUseVerdict; evidence: string | null }[] = [];
  const bySkill = new Map(selection.decisions.map((decision) => [decision.skillId, decision]));
  for (const claim of claims) {
    const decision = bySkill.get(claim.skillId);
    const evidence = String(claim.evidence ?? "").trim().slice(0, 300);
    let verdict: AyasSkillUseVerdict;
    if (!decision || decision.delivery === "NONE") verdict = "CLAIM_REJECTED_NOT_SELECTED";
    else if (claim.delivery === "INVOKED" && decision.delivery !== "INVOKE") verdict = "CLAIM_REJECTED_NOT_REGISTERED";
    else if (evidence.length < 12) verdict = "CLAIM_REJECTED_NO_EVIDENCE";
    else verdict = "USED";
    rows.push({ skillId: claim.skillId, verdict, evidence: verdict === "USED" ? evidence : null });
  }
  for (const decision of selection.selected) {
    if (!claims.some((claim) => claim.skillId === decision.skillId)) rows.push({ skillId: decision.skillId, verdict: "SELECTED_NOT_USED", evidence: null });
  }
  return Object.freeze(rows);
}
