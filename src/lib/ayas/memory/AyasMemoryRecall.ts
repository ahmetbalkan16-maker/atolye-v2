/**
 * Atölye Brain — AYAS memory recall (Phase 2 · Phase C.2).
 *
 *   query → recall → top-K relevant → prompt lines
 *
 * Deterministic hybrid relevance (no embedding/network dependency): BM25-style
 * lexical rank and Turkish-aware concept rank are fused, then reranked by
 * source trust, freshness, importance and active-project continuity. Conflicts
 * and suspicious timestamps are quarantined before prompt assembly. Only the
 * top few, capped by characters, ever reach the prompt — the whole memory is
 * never dumped. Pure aside from the one `AyasMemoryStore.load()` read.
 *
 * `persistAyasMemoryFromTurn` is the write side — fire-and-forget from the chat
 * path AFTER the reply: extract candidates, gate them, store the survivors. It
 * never throws into the caller and never blocks the response.
 */

import { buildBrainMemoryRecord } from "@/lib/brain/BrainMemoryModel";
import type { BrainMemoryRecord } from "@/types/brainMemory";
import { AyasMemoryStoreError, createAyasMemoryStore, type AyasMemoryStoreOptions } from "./AyasMemoryStore";
import { extractAyasMemoryCandidates } from "./AyasMemoryCandidate";
import { scoreAyasMemoryCandidate } from "./AyasMemoryGovernance";
import {
  retrieveAyasMemory,
  type AyasMemoryFreshness,
  type AyasMemoryRetrievalDecision,
  type AyasMemoryTrustClass,
} from "./AyasMemoryRetrieval";
import {
  buildAyasMemoryTemporalInput,
  type AyasMemoryTemporalQuery,
  type AyasMemoryTemporalState,
} from "./AyasMemoryTemporal";

const TOP_K = 4;
const MAX_LINE_CHARS = 160;
/** Budget for memory CONTENT; a temporal annotation (dates + state, ≤ ~120 chars) is not counted. */
const MAX_BLOCK_CHARS = 700;
/** Async back-off before each retry of a write that met another process's lock. */
const PERSIST_BACKOFF_MS = [25, 100] as const;

const ANNOTATION = /^(\s*·\s*\([^)]*\)\s*)\[[^\]]*\]\s*/;

/** A context line without its temporal annotation — relevance must be judged on content, not on dates or labels. */
export function stripAyasMemoryLineAnnotation(line: string): string {
  return line.replace(ANNOTATION, "$1");
}

export interface RecallAyasMemoryOptions {
  readonly activeProject?: string;
  readonly nowIso?: string;
  readonly store?: AyasMemoryStoreOptions;
  /** Omitted = current recall. `as-of` / `includeHistory` reach older versions explicitly. */
  readonly temporal?: AyasMemoryTemporalQuery;
}

/** Score + rank records against the query; deterministic. */
export function rankAyasMemory(
  records: readonly BrainMemoryRecord[],
  query: string,
  options: { activeProject?: string; nowIso?: string } = {},
): BrainMemoryRecord[] {
  return retrieveAyasMemory(records, query, { ...options, limit: TOP_K }).selected.map((decision) => decision.record);
}

function toLine(decision: AyasMemoryRetrievalDecision): string {
  const r = decision.record;
  const body = r.body.replace(/\s+/g, " ").trim();
  const text = body.length <= MAX_LINE_CHARS ? body : `${body.slice(0, MAX_LINE_CHARS - 1)}…`;
  return decision.temporalAnnotation
    ? `  · (${r.kind}) [${decision.temporalAnnotation}] ${text}`
    : `  · (${r.kind}) ${text}`;
}

/** Body-free temporal counts for the observability trace. */
export interface AyasMemoryTemporalCounts {
  readonly mode: "current" | "as-of";
  readonly includeHistory: boolean;
  /** Candidates believed true now. */
  readonly currentCount: number;
  /** Candidates that are older versions, past facts or unconfirmed plans. */
  readonly historicalCount: number;
  /** Older versions of an exclusive fact kept out of current recall. */
  readonly supersededCount: number;
  /** Selected facts whose hold on the as-of window is possible, not certain. */
  readonly uncertainCount: number;
  readonly invalidQuery: boolean;
}

export interface AyasMemoryRecallTrace {
  readonly status: "ok" | "unreadable";
  /** Bounded, body-free count of records considered by this read. */
  readonly candidateCount: number;
  readonly lines: readonly string[];
  /** Per-line identity metadata used by the chat relevance gate. */
  readonly entries: readonly {
    readonly line: string;
    readonly identity: boolean;
    readonly trustClass: AyasMemoryTrustClass;
    readonly freshness: AyasMemoryFreshness;
    readonly temporalState: AyasMemoryTemporalState;
    /** The resolver's current name for this line (folded), so no caller re-parses names from free text. */
    readonly identityValue?: string;
  }[];
  /** How many records actually made it into `lines` (post char-budget cutoff). */
  readonly recallCount: number;
  /** Of those, how many carry the "kimlik" (identity) tag. */
  readonly identityRecallCount: number;
  readonly quarantinedCount: number;
  readonly conflictCount: number;
  readonly staleCount: number;
  readonly temporal: AyasMemoryTemporalCounts;
}

function emptyTemporalCounts(query: AyasMemoryTemporalQuery | undefined): AyasMemoryTemporalCounts {
  return {
    mode: query?.mode === "as-of" ? "as-of" : "current",
    includeHistory: query?.mode === "current" && query.includeHistory === true,
    currentCount: 0,
    historicalCount: 0,
    supersededCount: 0,
    uncertainCount: 0,
    invalidQuery: false,
  };
}

/**
 * The trace-carrying implementation. `recallAyasMemoryLines` below is a thin,
 * BACKWARD-COMPATIBLE wrapper over this for every existing caller/test that
 * only ever needed the formatted lines — its signature and return type are
 * unchanged. `AyasChatStream.ts` calls THIS function instead so it can report
 * safe, secret-free recall metadata (`recallCount`/`identityRecallCount`) on
 * the turn's own observability trace, without duplicating the ranking logic.
 */
export async function recallAyasMemoryWithTrace(
  query: string,
  options: RecallAyasMemoryOptions = {},
): Promise<AyasMemoryRecallTrace> {
  try {
    const store = createAyasMemoryStore(options.store);
    const records = store.load();
    if (records.length === 0) {
      return { status: "ok", candidateCount: 0, lines: [], entries: [], recallCount: 0, identityRecallCount: 0, quarantinedCount: 0, conflictCount: 0, staleCount: 0, temporal: emptyTemporalCounts(options.temporal) };
    }
    const retrieval = retrieveAyasMemory(records, query, {
      ...(options.activeProject ? { activeProject: options.activeProject } : {}),
      ...(options.nowIso ? { nowIso: options.nowIso } : {}),
      ...(options.temporal ? { temporal: options.temporal } : {}),
      limit: TOP_K,
    });
    const all = [...retrieval.selected, ...retrieval.quarantined];
    const lines: string[] = [];
    const entries: { line: string; identity: boolean; trustClass: AyasMemoryTrustClass; freshness: AyasMemoryFreshness; temporalState: AyasMemoryTemporalState; identityValue?: string }[] = [];
    let identityRecallCount = 0;
    let uncertainCount = 0;
    let chars = 0;
    // The resolver's name is exposed only when it is unambiguous: a newer (or
    // simultaneous) identity statement it could not read ("adım Ali değil",
    // "eskiden adım Ali'ydi") leaves the current name uncertain, and no caller
    // may force one. Quarantined statements count too — a withdrawal read as
    // history is still a withdrawal.
    const isName = (decision: AyasMemoryRetrievalDecision) =>
      decision.temporal.state === "current" && decision.temporal.fact?.key === "user.identity.name";
    const newestNameMs = Math.max(-Infinity, ...retrieval.selected.filter(isName).map((decision) => Date.parse(decision.record.observedAt)));
    const nameUncertain = all.some((decision) =>
      decision.record.tags.includes("kimlik") && decision.temporal.fact === null && Date.parse(decision.record.observedAt) >= newestNameMs);
    for (const decision of retrieval.selected) {
      const r = decision.record;
      const line = toLine(decision);
      const contentLength = stripAyasMemoryLineAnnotation(line).length;
      if (chars + contentLength > MAX_BLOCK_CHARS) break;
      lines.push(line);
      entries.push({
        line,
        identity: r.tags.includes("kimlik"),
        trustClass: decision.trustClass,
        freshness: decision.freshness,
        temporalState: decision.temporal.state,
        ...(!nameUncertain && isName(decision) ? { identityValue: decision.temporal.fact!.value } : {}),
      });
      chars += contentLength;
      if (r.tags.includes("kimlik")) identityRecallCount += 1;
      if (decision.temporal.asOf === "possible") uncertainCount += 1;
    }
    return {
      status: "ok",
      candidateCount: records.length,
      lines,
      entries,
      recallCount: lines.length,
      identityRecallCount,
      quarantinedCount: retrieval.quarantined.length,
      conflictCount: retrieval.quarantined.filter((decision) => decision.conflictState === "conflicting").length,
      staleCount: retrieval.quarantined.filter((decision) => decision.quarantineReason === "stale-fact").length,
      temporal: {
        ...emptyTemporalCounts(options.temporal),
        currentCount: all.filter((decision) => decision.temporal.state === "current").length,
        historicalCount: all.filter((decision) => ["superseded", "historical", "future"].includes(decision.temporal.state)).length,
        supersededCount: all.filter((decision) => decision.temporal.state === "superseded").length,
        uncertainCount,
        invalidQuery: retrieval.invalidTemporalQuery,
      },
    };
  } catch {
    return { status: "unreadable", candidateCount: 0, lines: [], entries: [], recallCount: 0, identityRecallCount: 0, quarantinedCount: 0, conflictCount: 0, staleCount: 0, temporal: emptyTemporalCounts(options.temporal) };
  }
}

/** The prompt block. `[]` when nothing relevant / the store is empty / any error. */
export async function recallAyasMemoryLines(
  query: string,
  options: RecallAyasMemoryOptions = {},
): Promise<string[]> {
  const trace = await recallAyasMemoryWithTrace(query, options);
  return [...trace.lines];
}

export interface AyasMemoryPersistOutcome {
  readonly candidates: number;
  readonly stored: number;
  readonly rejected: number;
  /** Candidates that passed governance but could not be written. */
  readonly failed?: number;
  /** Stable store error code of the last failure — never a message or path. */
  readonly errorCode?: string;
}

/**
 * Write side. Awaited by the chat path before the terminal event. Extracts
 * candidates from the turn, gates each, stores the survivors as Memory
 * Temporal v2 records. Returns a small summary (for the observability trace)
 * and NEVER throws. A write that loses a revision race is retried once; a
 * write that still fails is counted in `failed` instead of looking like "0 stored".
 */
export async function persistAyasMemoryFromTurn(input: {
  readonly userText: string;
  readonly ayasReply: string;
  readonly tags?: readonly string[];
  readonly nowIso?: string;
  readonly store?: AyasMemoryStoreOptions;
}): Promise<AyasMemoryPersistOutcome> {
  let candidateCount = 0;
  let stored = 0;
  let rejected = 0;
  let failed = 0;
  let errorCode: string | undefined;
  try {
    const candidates = extractAyasMemoryCandidates({
      userText: input.userText,
      ayasReply: input.ayasReply,
      ...(input.tags ? { tags: input.tags } : {}),
    });
    candidateCount = candidates.length;
    if (candidates.length === 0) return { candidates: 0, stored: 0, rejected: 0 };

    const store = createAyasMemoryStore(input.store);
    const now = input.nowIso ?? new Date().toISOString();

    for (const candidate of candidates) {
      const decision = scoreAyasMemoryCandidate(candidate);
      if (!decision.store) {
        rejected += 1;
        continue;
      }
      const record = buildBrainMemoryRecord({
        kind: candidate.kind,
        title: candidate.title,
        body: candidate.body,
        importance: decision.importance,
        confidence: decision.confidence,
        tags: [...candidate.tags],
        observedAt: now,
        links: [],
        ...(decision.expiresInDays !== null
          ? { expiresAt: new Date(Date.parse(now) + decision.expiresInDays * 86_400_000).toISOString() }
          : {}),
        temporal: buildAyasMemoryTemporalInput({
          kind: candidate.kind,
          body: candidate.body,
          tags: candidate.tags,
          source: candidate.source,
          userText: input.userText,
          nowIso: now,
        }),
      });
      let result: "stored" | "duplicate" | "rejected" | null = null;
      for (let attempt = 0; attempt < PERSIST_BACKOFF_MS.length + 1 && result === null; attempt += 1) {
        try {
          result = store.append(record);
        } catch (error) {
          const code = error instanceof AyasMemoryStoreError ? error.code : "AYAS_MEMORY_STORE_WRITE_FAILED";
          if (code !== "AYAS_MEMORY_STORE_CONFLICT" || attempt === PERSIST_BACKOFF_MS.length) {
            failed += 1;
            errorCode = code;
            break;
          }
          // Another process holds the writer lock: back off without blocking the event loop, then re-read.
          await new Promise((resolve) => setTimeout(resolve, PERSIST_BACKOFF_MS[attempt]));
        }
      }
      if (result === "stored") stored += 1;
      else if (result === "rejected") rejected += 1;
    }
    return { candidates: candidates.length, stored, rejected, ...(failed ? { failed, errorCode } : {}) };
  } catch {
    return { candidates: candidateCount, stored, rejected, failed: failed + 1, errorCode: "AYAS_MEMORY_PERSIST_FAILED" };
  }
}
