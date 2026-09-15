import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * A crash-recoverable record of one execution attempt's progress. Written
 * by the orchestrator at every phase boundary; read back on restart to
 * classify what, if anything, may have happened before a crash. This
 * module has no dependency on the approval store, the daemon, or the
 * execution gate — it only knows about phases and timestamps, and it
 * never invokes a mutation callback or touches the gate itself.
 */
export const ayasExecutionJournalSchemaVersion = "1" as const;

export type AyasExecutionJournalPhase =
  | "APPROVED_NOT_STARTED"
  | "AUTHORIZATION_RESERVED"
  | "GATE_ARMED"
  | "GATE_READY"
  | "GATE_OPEN"
  | "EXECUTING"
  | "MUTATION_COMPLETED"
  | "GATE_COMPLETED"
  | "GATE_SETTLED"
  | "GATE_CLOSED"
  | "RESULT_RECORDED"
  | "FAILED"
  | "PARTIAL_UNKNOWN"
  | "RECOVERY_REQUIRED";

export interface AyasExecutionJournalEntry {
  readonly schemaVersion: typeof ayasExecutionJournalSchemaVersion;
  readonly executionId: string;
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly authorizationId?: string;
  readonly reservationId?: string;
  readonly baseHead: string;
  readonly exactFiles: readonly string[];
  readonly gateSequence?: number;
  readonly phase: AyasExecutionJournalPhase;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly mutationFingerprint?: string;
  readonly lastError?: string;
}

export type AyasExecutionJournalErrorCode = "AYAS_JOURNAL_CORRUPT" | "AYAS_JOURNAL_SCHEMA_MISMATCH" | "AYAS_JOURNAL_IO" | "AYAS_JOURNAL_INVALID";

export class AyasExecutionJournalError extends Error {
  constructor(readonly code: AyasExecutionJournalErrorCode, message: string) {
    super(message);
    this.name = "AyasExecutionJournalError";
    this.stack = undefined;
  }
}

const PHASES: readonly AyasExecutionJournalPhase[] = [
  "APPROVED_NOT_STARTED", "AUTHORIZATION_RESERVED", "GATE_ARMED", "GATE_READY", "GATE_OPEN",
  "EXECUTING", "MUTATION_COMPLETED", "GATE_COMPLETED", "GATE_SETTLED", "GATE_CLOSED",
  "RESULT_RECORDED", "FAILED", "PARTIAL_UNKNOWN", "RECOVERY_REQUIRED",
];

export interface AyasExecutionJournalOptions { readonly rootDir?: string; }

export interface AyasExecutionJournalHandle {
  readonly dir: string;
  /** Atomic full-record replace — a crash mid-write leaves the previous phase intact, never a torn record. */
  record(entry: AyasExecutionJournalEntry): void;
  /** `undefined` if this executionId was never journaled. Throws on a corrupt entry — never silently reinterpreted. */
  read(executionId: string): AyasExecutionJournalEntry | undefined;
  /** All journaled entries. Throws (fails closed) if any entry is corrupt, rather than silently skipping it. */
  list(): readonly AyasExecutionJournalEntry[];
}

function validate(raw: unknown, executionId: string): AyasExecutionJournalEntry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AyasExecutionJournalError("AYAS_JOURNAL_CORRUPT", `journal entry ${executionId} has an invalid shape`);
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== ayasExecutionJournalSchemaVersion) {
    throw new AyasExecutionJournalError("AYAS_JOURNAL_SCHEMA_MISMATCH", `journal entry ${executionId} schema is unsupported`);
  }
  if (typeof record.phase !== "string" || !PHASES.includes(record.phase as AyasExecutionJournalPhase)) {
    throw new AyasExecutionJournalError("AYAS_JOURNAL_CORRUPT", `journal entry ${executionId} has an invalid phase`);
  }
  if (typeof record.executionId !== "string" || typeof record.proposalId !== "string" || typeof record.proposalHash !== "string" ||
    typeof record.baseHead !== "string" || !Array.isArray(record.exactFiles) || typeof record.startedAt !== "string" || typeof record.updatedAt !== "string") {
    throw new AyasExecutionJournalError("AYAS_JOURNAL_CORRUPT", `journal entry ${executionId} is structurally invalid`);
  }
  return record as unknown as AyasExecutionJournalEntry;
}

export function createAyasExecutionJournal(options: AyasExecutionJournalOptions = {}): AyasExecutionJournalHandle {
  const root = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain"));
  const dir = path.join(root, "execution", "journal");

  const fileFor = (executionId: string): string => path.join(dir, `${executionId}.json`);

  const readFile = (file: string, executionId: string): AyasExecutionJournalEntry | undefined => {
    if (!fs.existsSync(file)) return undefined;
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { throw new AyasExecutionJournalError("AYAS_JOURNAL_CORRUPT", `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
    return validate(raw, executionId);
  };

  return {
    dir,
    record(entry) {
      fs.mkdirSync(dir, { recursive: true });
      const file = fileFor(entry.executionId);
      const tmp = path.join(dir, `.${entry.executionId}.${process.pid}.${crypto.randomUUID()}.tmp`);
      try {
        const fd = fs.openSync(tmp, "w");
        try { fs.writeFileSync(fd, `${JSON.stringify(entry, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, file);
      } catch (error) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* fail closed */ }
        throw new AyasExecutionJournalError("AYAS_JOURNAL_IO", error instanceof Error ? error.message : String(error));
      }
    },
    read(executionId) {
      return readFile(fileFor(executionId), executionId);
    },
    list() {
      if (!fs.existsSync(dir)) return [];
      const names = fs.readdirSync(dir).filter((name) => /^ayas-exec-[^.]+\.json$/.test(name));
      return names.map((name) => {
        const executionId = name.slice(0, -".json".length);
        const entry = readFile(path.join(dir, name), executionId);
        if (!entry) throw new AyasExecutionJournalError("AYAS_JOURNAL_INVALID", `journal entry ${executionId} disappeared during listing`);
        return entry;
      });
    },
  };
}

/**
 * Pure classification of a journal entry's phase into the crash-window
 * model (Stage 7C.1's Windows A-E). This function never mutates anything,
 * never touches the gate or the approval store, and never triggers any
 * form of automatic replay — it only tells a caller (a human, or a future
 * bounded recovery routine) what the phase implies and what to do next.
 */
export type AyasExecutionRecoveryWindow = "NONE" | "A" | "B" | "C" | "D" | "E";
export type AyasExecutionRecoveryRecommendation = "NO_ACTION_NEEDED" | "SAFE_TO_ABANDON_PENDING_HUMAN_CONFIRMATION" | "HUMAN_REVIEW_REQUIRED";

export interface AyasExecutionRecoveryClassification {
  readonly window: AyasExecutionRecoveryWindow;
  readonly mutationPossible: boolean;
  readonly recommendation: AyasExecutionRecoveryRecommendation;
}

export function classifyExecutionRecovery(entry: AyasExecutionJournalEntry): AyasExecutionRecoveryClassification {
  switch (entry.phase) {
    case "RESULT_RECORDED":
      return { window: "NONE", mutationPossible: false, recommendation: "NO_ACTION_NEEDED" };
    case "APPROVED_NOT_STARTED":
    case "AUTHORIZATION_RESERVED":
      // Window A: authorization reserved (or not yet), crash before any gate
      // transition was attempted — no mutation could have occurred.
      return { window: "A", mutationPossible: false, recommendation: "SAFE_TO_ABANDON_PENDING_HUMAN_CONFIRMATION" };
    case "GATE_ARMED":
    case "GATE_READY":
      // Window B: gate armed/confirmed, crash before OPEN — still no mutation possible.
      return { window: "B", mutationPossible: false, recommendation: "SAFE_TO_ABANDON_PENDING_HUMAN_CONFIRMATION" };
    case "GATE_OPEN":
      // Window C: gate open, crash before begin-execution — still no mutation possible.
      return { window: "C", mutationPossible: false, recommendation: "SAFE_TO_ABANDON_PENDING_HUMAN_CONFIRMATION" };
    case "EXECUTING":
      // Window D: mutation callback was invoked — outcome unknown.
      return { window: "D", mutationPossible: true, recommendation: "HUMAN_REVIEW_REQUIRED" };
    case "MUTATION_COMPLETED":
    case "GATE_COMPLETED":
    case "GATE_SETTLED":
    case "GATE_CLOSED":
      // Window E: mutation callback returned successfully, crash before the
      // result was durably recorded — the real-world change likely happened.
      return { window: "E", mutationPossible: true, recommendation: "HUMAN_REVIEW_REQUIRED" };
    case "FAILED":
    case "PARTIAL_UNKNOWN":
    case "RECOVERY_REQUIRED":
      return { window: "D", mutationPossible: true, recommendation: "HUMAN_REVIEW_REQUIRED" };
    default:
      // Fail closed on any phase this function does not recognize.
      return { window: "D", mutationPossible: true, recommendation: "HUMAN_REVIEW_REQUIRED" };
  }
}
