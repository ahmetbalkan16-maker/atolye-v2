/**
 * Stage 15E — model and strategy lifecycle, the contract.
 *
 *   DISCOVERED → PINNED → QUALIFIED → SHADOW → CANARY → ACTIVE → DEGRADED → RETIRED
 *
 * It applies to language models, coding models, speech models, media
 * helpers, prompts, improvement strategies and evaluator versions. An entry
 * records an immutable identity, the evidence behind its state and where to
 * roll back to. Newer is not better: nothing moves forward without evidence,
 * and nothing replaces an incumbent without a comparison against it.
 *
 * Pure: no filesystem, no network, no clock. Nothing here promotes, demotes,
 * installs or selects anything. `evaluateAyasLifecyclePromotion` answers
 * whether a move would be allowed; `decideAyasLifecycleRegression` drafts
 * what to propose. Changing the registry of record is a reviewed source
 * change through the existing owner approval path.
 */
export const AYAS_LIFECYCLE_STATES = Object.freeze(["DISCOVERED", "PINNED", "QUALIFIED", "SHADOW", "CANARY", "ACTIVE", "DEGRADED", "RETIRED"] as const);
export type AyasLifecycleState = (typeof AYAS_LIFECYCLE_STATES)[number];

export const AYAS_LIFECYCLE_KINDS = Object.freeze(["llm", "coding-model", "speech-model", "media-helper", "prompt", "improvement-strategy", "evaluator"] as const);
export type AyasLifecycleKind = (typeof AYAS_LIFECYCLE_KINDS)[number];

/**
 * Legal moves. Forward goes one step at a time. A pinned or later entry can be
 * degraded (a qualification that failed, or a regression in service), and a
 * degraded one returns only through a new qualification. Anything can be retired.
 */
const TRANSITIONS: Readonly<Record<AyasLifecycleState, readonly AyasLifecycleState[]>> = Object.freeze({
  DISCOVERED: ["PINNED", "RETIRED"],
  PINNED: ["QUALIFIED", "DEGRADED", "RETIRED"],
  QUALIFIED: ["SHADOW", "DEGRADED", "RETIRED"],
  SHADOW: ["CANARY", "DEGRADED", "RETIRED"],
  CANARY: ["ACTIVE", "DEGRADED", "RETIRED"],
  ACTIVE: ["DEGRADED", "RETIRED"],
  DEGRADED: ["QUALIFIED", "RETIRED"],
  RETIRED: [],
});
export function isAyasLifecycleTransitionLegal(from: AyasLifecycleState, to: AyasLifecycleState): boolean {
  return Object.hasOwn(TRANSITIONS, from) && TRANSITIONS[from].includes(to);
}

/** What makes an entry this exact thing. A tag or a name is a label, never an identity. */
export type AyasLifecycleIdentity =
  | { readonly type: "sha256-file"; readonly sha256: string; readonly sizeBytes: number; readonly locator: string }
  | { readonly type: "ollama-digest"; readonly digest: string; readonly tag: string }
  | { readonly type: "hf-revision"; readonly repository: string; readonly revision: string; readonly file: string; readonly sha256: string }
  /** SHA-256 over the listed repository files, in order, each with line endings normalized to LF. */
  | { readonly type: "source-digest"; readonly files: readonly string[]; readonly sha256: string }
  | { readonly type: "UNPINNED"; readonly reason: string };

export type AyasLifecycleEvidenceResult = "PASS" | "PARTIAL" | "FAIL" | "NOT_MEASURED";
export interface AyasLifecycleEvidence {
  readonly result: AyasLifecycleEvidenceResult;
  /** Repository path of the record this rests on. Empty only when nothing was measured. */
  readonly ref: string;
  readonly summary: string;
  /** For `regression`: the incumbent this entry was compared against. */
  readonly comparedTo?: string;
  /** The benchmark version: the evaluator entry that produced this result. */
  readonly measuredBy?: string;
}
/** The six promotion checks of the canonical spec, plus what running it costs. */
export interface AyasLifecycleRecord {
  readonly capability: AyasLifecycleEvidence;
  readonly regression: AyasLifecycleEvidence;
  readonly security: AyasLifecycleEvidence;
  readonly hardwareFit: AyasLifecycleEvidence;
  readonly consistency: AyasLifecycleEvidence;
  readonly heldOut: AyasLifecycleEvidence;
  readonly resourceUse: AyasLifecycleEvidence;
}
export const AYAS_LIFECYCLE_PROMOTION_CHECKS = Object.freeze(["capability", "regression", "security", "hardwareFit", "consistency", "heldOut"] as const);

/**
 * How an entry comes to be used.
 *  - NONE: not used.
 *  - OWNER_SELECTED: the owner's configuration or a reviewed commit selects it. This predates the lifecycle and is
 *    the owner's own decision; it is not a promotion and gives no autonomous or external-write use.
 *  - PROMOTED: its lifecycle state is what admits it.
 */
export type AyasLifecycleAdmission = "NONE" | "OWNER_SELECTED" | "PROMOTED";

export interface AyasLifecycleHistoryStep { readonly state: AyasLifecycleState; readonly on: string; readonly basis: string; }

export interface AyasLifecycleEntry {
  readonly id: string;
  readonly kind: AyasLifecycleKind;
  /** What it is for. At most one promoted ACTIVE entry exists per kind and role. */
  readonly role: string;
  readonly label: string;
  readonly identity: AyasLifecycleIdentity;
  readonly state: AyasLifecycleState;
  readonly admission: AyasLifecycleAdmission;
  /** What it runs with or depends on. */
  readonly compatibility: string;
  readonly record: AyasLifecycleRecord;
  /** The entry to return to, by id. Null when there is none. */
  readonly rollbackTarget: string | null;
  /** Append-only. It starts at DISCOVERED and its last state is the entry's state. */
  readonly history: readonly AyasLifecycleHistoryStep[];
  readonly notes: string;
}

export type AyasLifecycleViolationCode =
  | "ENTRY_SHAPE_INVALID" | "DUPLICATE_ID" | "HISTORY_INVALID" | "TRANSITION_ILLEGAL" | "STATE_HISTORY_MISMATCH"
  | "IDENTITY_REQUIRED" | "IDENTITY_INVALID" | "EVIDENCE_REQUIRED" | "EVIDENCE_REF_REQUIRED" | "ROLLBACK_TARGET_REQUIRED" | "ROLLBACK_TARGET_INVALID"
  | "EVALUATOR_UNKNOWN" | "DEGRADED_WITHOUT_CAUSE" | "PROMOTED_BELOW_SHADOW" | "RETIRED_STILL_ADMITTED" | "MULTIPLE_ACTIVE_FOR_ROLE" | "INCUMBENT_NOT_COMPARED";
export interface AyasLifecycleViolation { readonly id: string; readonly code: AyasLifecycleViolationCode; readonly detail: string; }
/** True but not wrong: what the owner should know about entries in use below ACTIVE. */
export type AyasLifecycleFindingCode = "OWNER_SELECTED_UNPINNED" | "OWNER_SELECTED_NOT_QUALIFIED" | "OWNER_SELECTED_DEGRADED";
export interface AyasLifecycleFinding { readonly id: string; readonly code: AyasLifecycleFindingCode; }

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._-]{2,119}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RESULTS: readonly string[] = ["PASS", "PARTIAL", "FAIL", "NOT_MEASURED"];
const QUALIFIED_OR_LATER: readonly AyasLifecycleState[] = ["QUALIFIED", "SHADOW", "CANARY", "ACTIVE"];
const SERVING_BY_PROMOTION: readonly AyasLifecycleState[] = ["SHADOW", "CANARY", "ACTIVE"];
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const repoPath = (value: unknown): boolean => typeof value === "string" && value.length > 0 && value.length <= 300 && !value.includes("\0") && !value.includes("\\") &&
  !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && !value.split("/").includes("..");

function identityValid(identity: AyasLifecycleIdentity): boolean {
  if (!identity || typeof identity !== "object") return false;
  switch (identity.type) {
    case "sha256-file": return HASH.test(identity.sha256) && Number.isSafeInteger(identity.sizeBytes) && identity.sizeBytes > 0 && text(identity.locator, 400);
    case "ollama-digest": return HASH.test(identity.digest) && text(identity.tag, 200);
    case "hf-revision": return text(identity.repository, 200) && /^[a-f0-9]{40}$/.test(identity.revision) && text(identity.file, 300) && HASH.test(identity.sha256);
    case "source-digest": return Array.isArray(identity.files) && identity.files.length > 0 && identity.files.length <= 20 && identity.files.every(repoPath) &&
      new Set(identity.files).size === identity.files.length && HASH.test(identity.sha256);
    case "UNPINNED": return text(identity.reason, 400);
    default: return false;
  }
}
function evidenceValid(evidence: AyasLifecycleEvidence | undefined): evidence is AyasLifecycleEvidence {
  return !!evidence && typeof evidence === "object" && RESULTS.includes(evidence.result) && typeof evidence.ref === "string" && evidence.ref.length <= 300 &&
    (evidence.ref === "" || repoPath(evidence.ref)) && text(evidence.summary, 600) && (evidence.comparedTo === undefined || ID.test(evidence.comparedTo)) && (evidence.measuredBy === undefined || ID.test(evidence.measuredBy));
}

/** Contract violations of one entry on its own. An empty list means the entry's state is backed by what it records. */
export function auditAyasLifecycleEntry(entry: AyasLifecycleEntry): readonly AyasLifecycleViolation[] {
  const out: AyasLifecycleViolation[] = [];
  const add = (code: AyasLifecycleViolationCode, detail: string): void => { out.push({ id: typeof entry?.id === "string" ? entry.id : "(invalid)", code, detail }); };
  if (!entry || typeof entry !== "object" || !ID.test(String(entry.id)) || !(AYAS_LIFECYCLE_KINDS as readonly string[]).includes(entry.kind) || !text(entry.role, 80) || !text(entry.label, 200) ||
      !(AYAS_LIFECYCLE_STATES as readonly string[]).includes(entry.state) || !["NONE", "OWNER_SELECTED", "PROMOTED"].includes(entry.admission) || !text(entry.compatibility, 600) ||
      !text(entry.notes, 1200) || !entry.record || typeof entry.record !== "object" || !Array.isArray(entry.history) ||
      !(entry.rollbackTarget === null || ID.test(String(entry.rollbackTarget)))) { add("ENTRY_SHAPE_INVALID", "a required field is missing or malformed"); return out; }
  if (!identityValid(entry.identity)) add("IDENTITY_INVALID", "identity is not a well-formed pin");
  const checks = [...AYAS_LIFECYCLE_PROMOTION_CHECKS, "resourceUse"] as const;
  for (const key of checks) {
    const evidence = entry.record[key];
    if (!evidenceValid(evidence)) { add("ENTRY_SHAPE_INVALID", `record.${key} is malformed`); return out; }
    if (evidence.result !== "NOT_MEASURED" && evidence.ref === "") add("EVIDENCE_REF_REQUIRED", `record.${key} claims ${evidence.result} without a record`);
  }

  const history = entry.history;
  if (history.length === 0 || history[0]!.state !== "DISCOVERED" || !history.every((step) => step && (AYAS_LIFECYCLE_STATES as readonly string[]).includes(step.state) && DAY.test(String(step.on)) &&
      Number.isFinite(Date.parse(String(step.on))) && text(step.basis, 400)) || history.some((step, index) => index > 0 && step.on < history[index - 1]!.on)) {
    add("HISTORY_INVALID", "history must start at DISCOVERED with dated, ordered, explained steps");
  } else {
    history.forEach((step, index) => { if (index > 0 && !isAyasLifecycleTransitionLegal(history[index - 1]!.state, step.state)) add("TRANSITION_ILLEGAL", `${history[index - 1]!.state} -> ${step.state}`); });
    if (history[history.length - 1]!.state !== entry.state) add("STATE_HISTORY_MISMATCH", `state ${entry.state} is not the last history step`);
  }

  if (entry.identity?.type === "UNPINNED" && entry.state !== "DISCOVERED" && !(entry.state === "RETIRED" && history.length === 2)) add("IDENTITY_REQUIRED", `${entry.state} needs an immutable identity`);
  if (QUALIFIED_OR_LATER.includes(entry.state)) {
    for (const key of AYAS_LIFECYCLE_PROMOTION_CHECKS) if (entry.record[key].result !== "PASS") add("EVIDENCE_REQUIRED", `${entry.state} needs ${key} PASS, found ${entry.record[key].result}`);
  }
  if (entry.state === "DEGRADED" && !AYAS_LIFECYCLE_PROMOTION_CHECKS.some((key) => entry.record[key].result === "FAIL" || entry.record[key].result === "PARTIAL")) {
    add("DEGRADED_WITHOUT_CAUSE", "DEGRADED needs at least one failed or partial check on record");
  }
  if (entry.admission === "PROMOTED" && !SERVING_BY_PROMOTION.includes(entry.state)) add("PROMOTED_BELOW_SHADOW", `${entry.state} cannot be admitted by promotion`);
  if (entry.state === "RETIRED" && entry.admission !== "NONE") add("RETIRED_STILL_ADMITTED", "a retired entry is not used");
  return out;
}

/** Violations of the whole registry, including the checks that need more than one entry. */
export function auditAyasLifecycleRegistry(registry: readonly AyasLifecycleEntry[]): readonly AyasLifecycleViolation[] {
  const out: AyasLifecycleViolation[] = registry.flatMap((entry) => [...auditAyasLifecycleEntry(entry)]);
  const byId = new Map<string, AyasLifecycleEntry>();
  for (const entry of registry) {
    if (typeof entry?.id !== "string") continue;
    if (byId.has(entry.id)) out.push({ id: entry.id, code: "DUPLICATE_ID", detail: "two entries share this id" });
    byId.set(entry.id, entry);
  }
  const active = new Map<string, string[]>();
  for (const entry of byId.values()) {
    // Serving by promotion needs somewhere to go back to: an entry of its role that was ACTIVE before this one began to
    // serve. When no such last known good exists, the entry is the first of its role and its rollback is the role switched off.
    const eligible = (other: AyasLifecycleEntry): boolean => other.id !== entry.id && other.kind === entry.kind && other.role === entry.role && other.state !== "RETIRED" && other.identity?.type !== "UNPINNED";
    const servingSince = Array.isArray(entry.history) ? entry.history.find((step) => SERVING_BY_PROMOTION.includes(step?.state))?.on : undefined;
    const lastKnownGood = (other: AyasLifecycleEntry): boolean => eligible(other) && servingSince !== undefined && Array.isArray(other.history) &&
      other.history.some((step) => step?.state === "ACTIVE" && typeof step.on === "string" && step.on < servingSince);
    if (SERVING_BY_PROMOTION.includes(entry.state) && entry.rollbackTarget === null && [...byId.values()].some(lastKnownGood)) {
      out.push({ id: entry.id, code: "ROLLBACK_TARGET_REQUIRED", detail: `${entry.state} needs a rollback target while a last known good entry of its role exists` });
    }
    if (entry.rollbackTarget !== null) {
      const target = byId.get(entry.rollbackTarget);
      if (!target || !eligible(target)) {
        out.push({ id: entry.id, code: "ROLLBACK_TARGET_INVALID", detail: "the rollback target must be another pinned, unretired entry of the same kind and role" });
      }
    }
    // A result that names its benchmark names an evaluator this registry holds.
    for (const evidence of Object.values(entry.record ?? {})) {
      const evaluator = typeof evidence?.measuredBy === "string" ? byId.get(evidence.measuredBy) : undefined;
      if (evidence?.measuredBy !== undefined && (!evaluator || evaluator.kind !== "evaluator" || evaluator.state === "RETIRED")) {
        out.push({ id: entry.id, code: "EVALUATOR_UNKNOWN", detail: `${String(evidence.measuredBy)} is not an unretired evaluator entry` });
      }
    }
    if (entry.state === "ACTIVE" && entry.admission === "PROMOTED") active.set(`${entry.kind}\n${entry.role}`, [...(active.get(`${entry.kind}\n${entry.role}`) ?? []), entry.id]);
    // Newer is not better: an entry that serves by promotion was compared against the one it would replace.
    if (SERVING_BY_PROMOTION.includes(entry.state) && entry.rollbackTarget !== null && entry.record?.regression?.comparedTo !== entry.rollbackTarget) {
      out.push({ id: entry.id, code: "INCUMBENT_NOT_COMPARED", detail: "regression evidence must name the rollback target it was compared against" });
    }
  }
  for (const ids of active.values()) if (ids.length > 1) for (const id of ids) out.push({ id, code: "MULTIPLE_ACTIVE_FOR_ROLE", detail: ids.join(", ") });
  return out;
}

/** Entries the owner uses below ACTIVE. Facts for the owner, not errors. */
export function findAyasLifecycleFindings(registry: readonly AyasLifecycleEntry[]): readonly AyasLifecycleFinding[] {
  const out: AyasLifecycleFinding[] = [];
  for (const entry of registry) {
    if (entry.admission !== "OWNER_SELECTED") continue;
    if (entry.identity.type === "UNPINNED") out.push({ id: entry.id, code: "OWNER_SELECTED_UNPINNED" });
    else if (entry.state === "DEGRADED") out.push({ id: entry.id, code: "OWNER_SELECTED_DEGRADED" });
    else if (!QUALIFIED_OR_LATER.includes(entry.state)) out.push({ id: entry.id, code: "OWNER_SELECTED_NOT_QUALIFIED" });
  }
  return out;
}

export type AyasLifecyclePromotionDecision =
  | { readonly allowed: true; readonly from: AyasLifecycleState; readonly to: AyasLifecycleState }
  | { readonly allowed: false; readonly reasons: readonly string[] };

/**
 * Would moving `entryId` to `to` be allowed, given the entry as it would then stand? Returns a decision and changes
 * nothing. A caller that wants the move writes a reviewed registry change; this function is its precondition.
 */
export function evaluateAyasLifecyclePromotion(registry: readonly AyasLifecycleEntry[], entryId: string, to: AyasLifecycleState, on: string, basis: string): AyasLifecyclePromotionDecision {
  const entry = registry.find((item) => item.id === entryId);
  if (!entry) return { allowed: false, reasons: ["UNKNOWN_ENTRY"] };
  if (!(AYAS_LIFECYCLE_STATES as readonly string[]).includes(to)) return { allowed: false, reasons: ["UNKNOWN_STATE"] };
  if (!isAyasLifecycleTransitionLegal(entry.state, to)) return { allowed: false, reasons: [`TRANSITION_ILLEGAL: ${entry.state} -> ${to}`] };
  const moved: AyasLifecycleEntry = {
    ...entry, state: to, history: [...entry.history, { state: to, on, basis }],
    admission: to === "RETIRED" ? "NONE" : SERVING_BY_PROMOTION.includes(to) ? "PROMOTED" : entry.admission === "PROMOTED" ? "NONE" : entry.admission,
  };
  const reasons = auditAyasLifecycleRegistry(registry.map((item) => (item.id === entryId ? moved : item))).filter((violation) => violation.id === entryId || violation.code === "MULTIPLE_ACTIVE_FOR_ROLE")
    .map((violation) => `${violation.code}: ${violation.detail}`);
  return reasons.length ? { allowed: false, reasons: [...new Set(reasons)] } : { allowed: true, from: entry.state, to };
}

export type AyasLifecycleRegressionDecision =
  | { readonly action: "PROPOSE_ROLLBACK"; readonly degrade: string; readonly restore: string }
  | { readonly action: "PROPOSE_DEGRADE_NO_TARGET"; readonly degrade: string }
  | { readonly action: "NONE"; readonly reason: string };

/** A regression in service: what to propose. A draft for the owner, never an applied change. */
export function decideAyasLifecycleRegression(registry: readonly AyasLifecycleEntry[], entryId: string): AyasLifecycleRegressionDecision {
  const entry = registry.find((item) => item.id === entryId);
  if (!entry) return { action: "NONE", reason: "UNKNOWN_ENTRY" };
  if (!isAyasLifecycleTransitionLegal(entry.state, "DEGRADED")) return { action: "NONE", reason: `${entry.state} cannot be degraded` };
  const target = entry.rollbackTarget === null ? undefined : registry.find((item) => item.id === entry.rollbackTarget);
  if (!target || target.kind !== entry.kind || target.role !== entry.role || target.state === "RETIRED" || target.identity.type === "UNPINNED") return { action: "PROPOSE_DEGRADE_NO_TARGET", degrade: entry.id };
  return { action: "PROPOSE_ROLLBACK", degrade: entry.id, restore: target.id };
}

export const AYAS_LIFECYCLE_TASK_CLASSES = Object.freeze(["OWNER_INTERACTIVE", "INTERNAL_BOUNDED", "SHADOW_COMPARE", "AUTONOMOUS_CODING", "PRODUCTION_EXTERNAL_WRITE", "REVENUE_EXTERNAL_WRITE"] as const);
export type AyasLifecycleTaskClass = (typeof AYAS_LIFECYCLE_TASK_CLASSES)[number];

/**
 * What an entry may be used for. This is necessary, not sufficient: the action firewall still decides every
 * dispatch, and an external write still needs the owner.
 *  - promoted ACTIVE: everything of its kind;
 *  - promoted CANARY: bounded internal tasks only, never an external write;
 *  - promoted SHADOW: comparison only, its output is not used;
 *  - owner-selected (not retired, not degraded): the owner's own interactive use and bounded internal tasks;
 *  - owner-selected and degraded: the owner's own interactive use only;
 *  - everything else: nothing.
 */
export function ayasLifecycleMayServe(entry: AyasLifecycleEntry, task: AyasLifecycleTaskClass): boolean {
  if (auditAyasLifecycleEntry(entry).length > 0 || entry.state === "RETIRED" || !(AYAS_LIFECYCLE_TASK_CLASSES as readonly string[]).includes(task)) return false;
  if (task === "AUTONOMOUS_CODING" && entry.kind !== "coding-model") return false;
  if (entry.admission === "PROMOTED") {
    if (entry.state === "ACTIVE") return task !== "SHADOW_COMPARE";
    if (entry.state === "CANARY") return task === "INTERNAL_BOUNDED";
    if (entry.state === "SHADOW") return task === "SHADOW_COMPARE";
    return false;
  }
  if (entry.admission === "OWNER_SELECTED") return task === "OWNER_INTERACTIVE" || (task === "INTERNAL_BOUNDED" && entry.state !== "DEGRADED");
  return false;
}
