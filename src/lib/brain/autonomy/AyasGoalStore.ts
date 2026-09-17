import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { redactBrainText } from "../BrainRedaction";

/**
 * M22.2 — durable goal state. A goal is how a human turns a high-level
 * intent ("improve video quality", "reduce video pipeline failures") into
 * something AYAS can work: scope + allowed/excluded domains bound what it
 * may even look at; success criteria and evidence are read-only records of
 * what was found and done, never authority. A goal can NEVER itself
 * authorize execution — every candidate/work item a goal accumulates still
 * flows through the SAME existing safety/value classification and
 * MICRO_SAFE/PRIORITY_SAFE/REVIEW_REQUIRED/FORBIDDEN_AUTONOMOUS gates as any
 * other discovery, and still needs the same human approval
 * (BATCH ONAYLA VE UYGULA / ONAYLA VE UYGULA / explicit review) before
 * anything executes. This store only remembers INTENT and PROGRESS.
 */
export const ayasGoalSchemaVersion = "1" as const;

export type AyasGoalStatus = "NEW" | "ANALYZING" | "ACTIVE" | "WAITING_FOR_AUTHORITY" | "BLOCKED" | "COMPLETED" | "CANCELLED";

export interface AyasGoalCandidate {
  readonly candidateId: string;
  /** A stable reference into an existing discovery/proposal mechanism — never free-form content the goal engine invents itself. E.g. a proposalId, a micro-batch item semanticKey, or a research finding id (see AyasExternalResearchStore). */
  readonly reference: string;
  readonly note: string;
  readonly addedAt: string;
}

export interface AyasGoal {
  readonly schemaVersion: typeof ayasGoalSchemaVersion;
  readonly goalId: string;
  readonly createdAt: string;
  readonly lastUpdatedAt: string;
  readonly userIntent: string;
  readonly status: AyasGoalStatus;
  /** Human-facing scope description — never itself an authority grant. */
  readonly scope: string;
  /** Path-prefix domains this goal is allowed to look at (e.g. "src/lib/video/", "src/lib/assembly/"). Still filtered through BrainPatchSafety/AyasMicroClassifier exactly as before — this is a further, goal-specific narrowing, never a widening. */
  readonly allowedDomains: readonly string[];
  /** Path-prefix domains explicitly excluded even if allowedDomains would otherwise include them. */
  readonly excludedDomains: readonly string[];
  readonly successCriteria: readonly string[];
  readonly evidence: readonly string[];
  readonly candidates: readonly AyasGoalCandidate[];
  readonly progress: readonly string[];
  readonly blockers: readonly string[];
  readonly completionEvidence: readonly string[];
}

export class AyasGoalStoreError extends Error {
  constructor(readonly code: "AYAS_GOAL_NOT_FOUND" | "AYAS_GOAL_CORRUPT" | "AYAS_GOAL_INVALID_TRANSITION" | "AYAS_GOAL_IO", message: string) {
    super(message);
    this.name = "AyasGoalStoreError";
    this.stack = undefined;
  }
}

const TERMINAL: ReadonlySet<AyasGoalStatus> = new Set(["COMPLETED", "CANCELLED"]);

/** Server-owned state machine — mirrors the same "throw rather than silently no-op" discipline every other AYAS durable store in this module uses. */
const ALLOWED_TRANSITIONS: Readonly<Record<AyasGoalStatus, readonly AyasGoalStatus[]>> = {
  NEW: ["ANALYZING", "CANCELLED"],
  ANALYZING: ["ACTIVE", "BLOCKED", "CANCELLED"],
  ACTIVE: ["WAITING_FOR_AUTHORITY", "BLOCKED", "COMPLETED", "CANCELLED"],
  WAITING_FOR_AUTHORITY: ["ACTIVE", "BLOCKED", "CANCELLED"],
  BLOCKED: ["ACTIVE", "ANALYZING", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const MAX_LIST_LENGTH = 100;
const MAX_TEXT_CHARS = 500;

const scrub = (value: string, max = MAX_TEXT_CHARS): string => redactBrainText(String(value ?? "")).text.slice(0, max);
const scrubList = (values: readonly string[], max = MAX_TEXT_CHARS): readonly string[] => values.map((v) => scrub(v, max)).filter(Boolean).slice(0, MAX_LIST_LENGTH);

export interface AyasGoalCreateInput {
  readonly userIntent: string;
  readonly scope: string;
  readonly allowedDomains: readonly string[];
  readonly excludedDomains?: readonly string[];
  readonly successCriteria: readonly string[];
}

export interface AyasGoalStoreOptions { readonly rootDir?: string }

export interface AyasGoalStore {
  readonly dir: string;
  create(input: AyasGoalCreateInput): AyasGoal;
  load(goalId: string): AyasGoal;
  list(): readonly AyasGoal[];
  transition(goalId: string, next: AyasGoalStatus, now: string): AyasGoal;
  addEvidence(goalId: string, evidence: string, now: string): AyasGoal;
  addCandidate(goalId: string, candidate: Omit<AyasGoalCandidate, "candidateId" | "addedAt">, now: string): AyasGoal;
  addProgress(goalId: string, note: string, now: string): AyasGoal;
  addBlocker(goalId: string, blocker: string, now: string): AyasGoal;
  complete(goalId: string, completionEvidence: readonly string[], now: string): AyasGoal;
}

export function createAyasGoalStore(options: AyasGoalStoreOptions = {}): AyasGoalStore {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "self-improvement", "goals"));
  const fileFor = (id: string) => path.join(dir, `${id}.json`);

  const writeAtomic = (goal: AyasGoal): void => {
    fs.mkdirSync(dir, { recursive: true });
    const target = fileFor(goal.goalId);
    const tmp = path.join(dir, `.${goal.goalId}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      const fd = fs.openSync(tmp, "w");
      try { fs.writeFileSync(fd, `${JSON.stringify(goal, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, target);
    } catch (error) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* fail closed */ }
      throw new AyasGoalStoreError("AYAS_GOAL_IO", error instanceof Error ? error.message : String(error));
    }
  };

  const loadRaw = (goalId: string): AyasGoal => {
    const target = fileFor(goalId);
    if (!fs.existsSync(target)) throw new AyasGoalStoreError("AYAS_GOAL_NOT_FOUND", `goal not found: ${goalId}`);
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(target, "utf8")); } catch (error) { throw new AyasGoalStoreError("AYAS_GOAL_CORRUPT", error instanceof Error ? error.message : String(error)); }
    if (!parsed || typeof parsed !== "object" || (parsed as { schemaVersion?: string }).schemaVersion !== ayasGoalSchemaVersion) {
      throw new AyasGoalStoreError("AYAS_GOAL_CORRUPT", "goal has an invalid or unsupported shape");
    }
    return parsed as AyasGoal;
  };

  const listRaw = (): readonly AyasGoal[] => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith(".")).map((f) => loadRaw(f.replace(/\.json$/, "")));
  };

  const requireTransition = (goal: AyasGoal, next: AyasGoalStatus): void => {
    if (TERMINAL.has(goal.status) || !ALLOWED_TRANSITIONS[goal.status].includes(next)) {
      throw new AyasGoalStoreError("AYAS_GOAL_INVALID_TRANSITION", `cannot transition goal from ${goal.status} to ${next}`);
    }
  };

  return {
    dir,
    create(input) {
      const now = new Date().toISOString();
      const goal: AyasGoal = {
        schemaVersion: ayasGoalSchemaVersion,
        goalId: `ayas-goal-${crypto.randomUUID()}`,
        createdAt: now,
        lastUpdatedAt: now,
        userIntent: scrub(input.userIntent, 300),
        status: "NEW",
        scope: scrub(input.scope, 300),
        allowedDomains: scrubList(input.allowedDomains, 200),
        excludedDomains: scrubList(input.excludedDomains ?? [], 200),
        successCriteria: scrubList(input.successCriteria),
        evidence: [],
        candidates: [],
        progress: [],
        blockers: [],
        completionEvidence: [],
      };
      writeAtomic(goal);
      return goal;
    },
    load(goalId) { return loadRaw(goalId); },
    list() { return listRaw(); },
    transition(goalId, next, now) {
      const goal = loadRaw(goalId);
      requireTransition(goal, next);
      const updated: AyasGoal = { ...goal, status: next, lastUpdatedAt: now };
      writeAtomic(updated);
      return updated;
    },
    addEvidence(goalId, evidence, now) {
      const goal = loadRaw(goalId);
      const updated: AyasGoal = { ...goal, evidence: [...goal.evidence, scrub(evidence)].slice(-MAX_LIST_LENGTH), lastUpdatedAt: now };
      writeAtomic(updated);
      return updated;
    },
    addCandidate(goalId, candidate, now) {
      const goal = loadRaw(goalId);
      const entry: AyasGoalCandidate = { candidateId: `ayas-goal-candidate-${crypto.randomUUID()}`, reference: scrub(candidate.reference, 200), note: scrub(candidate.note), addedAt: now };
      const updated: AyasGoal = { ...goal, candidates: [...goal.candidates, entry].slice(-MAX_LIST_LENGTH), lastUpdatedAt: now };
      writeAtomic(updated);
      return updated;
    },
    addProgress(goalId, note, now) {
      const goal = loadRaw(goalId);
      const updated: AyasGoal = { ...goal, progress: [...goal.progress, scrub(note)].slice(-MAX_LIST_LENGTH), lastUpdatedAt: now };
      writeAtomic(updated);
      return updated;
    },
    addBlocker(goalId, blocker, now) {
      const goal = loadRaw(goalId);
      const updated: AyasGoal = { ...goal, blockers: [...goal.blockers, scrub(blocker)].slice(-MAX_LIST_LENGTH), lastUpdatedAt: now };
      writeAtomic(updated);
      return updated;
    },
    complete(goalId, completionEvidence, now) {
      const goal = loadRaw(goalId);
      requireTransition(goal, "COMPLETED");
      const updated: AyasGoal = { ...goal, status: "COMPLETED", completionEvidence: scrubList(completionEvidence), lastUpdatedAt: now };
      writeAtomic(updated);
      return updated;
    },
  };
}
