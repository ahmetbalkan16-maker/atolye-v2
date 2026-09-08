/**
 * Atölye Brain — memory model.
 *
 * The Brain remembers, in a controlled way:
 *  - the project structure,
 *  - prior decisions,
 *  - test results,
 *  - known bugs,
 *  - user preferences,
 *  - security policies,
 *  - success / failure history.
 *
 * It must NEVER remember secrets, API keys or passwords. `redactBrainMemoryText`
 * (in `BrainMemoryModel.ts`) is a deterministic, code-level scrubber applied to
 * every record before it is stored — the model is never trusted to "know not to
 * write the key down".
 *
 * Persistence is a JSON-file store (sibling of `AIUsageManager`), added in a
 * later phase. This file is types only.
 */

import type { ProductionStepKey } from "./project";

export const brainMemorySchemaVersion = "1" as const;

export type BrainMemoryKind =
  | "project-structure"
  | "decision"
  | "test-result"
  | "known-bug"
  | "user-preference"
  | "security-policy"
  | "outcome-history"
  | "graphify-state"
  | "environment-note";

/** Higher = keep longer / surface more readily. */
export type BrainMemoryImportance = "transient" | "normal" | "durable" | "pinned";

export type BrainMemoryConfidence = "observed" | "inferred" | "reported";

export interface BrainMemoryRecordInput {
  readonly kind: BrainMemoryKind;
  readonly title: string;
  readonly body: string;
  readonly importance: BrainMemoryImportance;
  readonly confidence: BrainMemoryConfidence;
  /** Free-form tags for recall (`audio`, `ollama`, `thermal`, a project slug…). */
  readonly tags: readonly string[];
  readonly stage?: ProductionStepKey;
  /** ISO instant. */
  readonly observedAt: string;
  /** Sanitised cross-references (`[[decision-id]]`, a checkpoint sprint number…). */
  readonly links: readonly string[];
  /** Optional expiry — a `transient` note the Brain should forget after this. */
  readonly expiresAt?: string;
}

export interface BrainMemoryRecord extends BrainMemoryRecordInput {
  readonly schemaVersion: typeof brainMemorySchemaVersion;
  readonly recordId: string;
  /** `true` when the scrubber changed `title`/`body`/`links` before storing. */
  readonly redacted: boolean;
  readonly contentFingerprint: string;
}

export interface BrainMemoryQuery {
  readonly kinds?: readonly BrainMemoryKind[];
  readonly tags?: readonly string[];
  readonly stage?: ProductionStepKey;
  readonly minImportance?: BrainMemoryImportance;
  /** ISO instant — records older than this are excluded unless `pinned`. */
  readonly since?: string;
  readonly limit?: number;
}

export interface BrainMemoryRecall {
  readonly records: readonly BrainMemoryRecord[];
  readonly totalMatched: number;
  readonly droppedExpired: number;
}

export type BrainMemoryValidationReasonCode =
  | "BRAIN_MEMORY_VALID"
  | "BRAIN_MEMORY_EMPTY_BODY"
  | "BRAIN_MEMORY_TIMESTAMP_INVALID"
  | "BRAIN_MEMORY_SECRET_LEAK"
  | "BRAIN_MEMORY_BODY_TOO_LARGE";

export interface BrainMemoryValidation {
  readonly valid: boolean;
  readonly reasonCode: BrainMemoryValidationReasonCode;
}
