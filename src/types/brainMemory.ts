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

/**
 * Memory Temporal v2 — optional, versioned block. A record without it is a v1
 * (legacy) record: still valid, read with "effective time unknown" semantics.
 * The block is deliberately NOT part of `recordId`/`contentFingerprint`, so a
 * v1 reader keeps accepting v2 records; its own `fingerprint` binds it.
 */
export const brainMemoryTemporalVersion = 2 as const;

/** How the statement relates to time at the moment it was made. */
export type BrainMemoryTemporalAssertion = "current" | "historical" | "future";

/** Granularity of `effectiveFrom`/`effectiveUntil` — never read them more precisely than this. */
export type BrainMemoryTemporalPrecision = "instant" | "day" | "month" | "year";

/** Safe provenance class — a category, never the source text. */
export type BrainMemoryProvenance =
  | "direct-user-statement"
  | "explicit-correction"
  | "conversation-derived"
  | "system-observation"
  | "imported-history";

export interface BrainMemoryTemporalInput {
  readonly assertion: BrainMemoryTemporalAssertion;
  readonly provenance: BrainMemoryProvenance;
  /** ISO instant — when the durable record was written. */
  readonly recordedAt: string;
  /** ISO instant — start of the period in which the fact became true. Absent = unknown, never invented. */
  readonly effectiveFrom?: string;
  /** ISO instant, exclusive — end of the period in which it stopped being true. Absent = unknown / open. */
  readonly effectiveUntil?: string;
  /**
   * ISO instants [heldFrom, heldUntil) — a period the statement names as one in
   * which the fact held at some point ("2024'te İzmir'de yaşıyordum"). It says
   * nothing about when the fact began or ended; both-or-neither.
   */
  readonly heldFrom?: string;
  readonly heldUntil?: string;
  /** Required whenever any of `effectiveFrom`, `effectiveUntil`, `heldFrom`, `heldUntil` is present. */
  readonly effectivePrecision?: BrainMemoryTemporalPrecision;
  /** Exclusive fact slot (closed registry, validated by the AYAS store). Absent = independent fact. */
  readonly factKey?: string;
  /** Normalised value token for `factKey`; present exactly when `factKey` is. */
  readonly factValue?: string;
}

export interface BrainMemoryTemporal extends BrainMemoryTemporalInput {
  readonly version: typeof brainMemoryTemporalVersion;
  readonly fingerprint: string;
}

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
  /** Optional Memory Temporal v2 metadata. */
  readonly temporal?: BrainMemoryTemporalInput;
}

export interface BrainMemoryRecord extends Omit<BrainMemoryRecordInput, "temporal"> {
  readonly schemaVersion: typeof brainMemorySchemaVersion;
  readonly recordId: string;
  /** `true` when the scrubber changed `title`/`body`/`links` before storing. */
  readonly redacted: boolean;
  readonly contentFingerprint: string;
  readonly temporal?: BrainMemoryTemporal;
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
  | "BRAIN_MEMORY_BODY_TOO_LARGE"
  | "BRAIN_MEMORY_TEMPORAL_INVALID";

export interface BrainMemoryValidation {
  readonly valid: boolean;
  readonly reasonCode: BrainMemoryValidationReasonCode;
}
