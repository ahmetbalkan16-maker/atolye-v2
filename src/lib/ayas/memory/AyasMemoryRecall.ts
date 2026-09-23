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
import { createAyasMemoryStore, type AyasMemoryStoreOptions } from "./AyasMemoryStore";
import { extractAyasMemoryCandidates } from "./AyasMemoryCandidate";
import { scoreAyasMemoryCandidate } from "./AyasMemoryGovernance";
import {
  retrieveAyasMemory,
  type AyasMemoryFreshness,
  type AyasMemoryTrustClass,
} from "./AyasMemoryRetrieval";

const TOP_K = 4;
const MAX_LINE_CHARS = 160;
const MAX_BLOCK_CHARS = 700;

export interface RecallAyasMemoryOptions {
  readonly activeProject?: string;
  readonly nowIso?: string;
  readonly store?: AyasMemoryStoreOptions;
}

/** Score + rank records against the query; deterministic. */
export function rankAyasMemory(
  records: readonly BrainMemoryRecord[],
  query: string,
  options: { activeProject?: string; nowIso?: string } = {},
): BrainMemoryRecord[] {
  return retrieveAyasMemory(records, query, { ...options, limit: TOP_K }).selected.map((decision) => decision.record);
}

function toLine(r: BrainMemoryRecord): string {
  const body = r.body.replace(/\s+/g, " ").trim();
  const text = body.length <= MAX_LINE_CHARS ? body : `${body.slice(0, MAX_LINE_CHARS - 1)}…`;
  return `  · (${r.kind}) ${text}`;
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
  }[];
  /** How many records actually made it into `lines` (post char-budget cutoff). */
  readonly recallCount: number;
  /** Of those, how many carry the "kimlik" (identity) tag. */
  readonly identityRecallCount: number;
  readonly quarantinedCount: number;
  readonly conflictCount: number;
  readonly staleCount: number;
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
      return { status: "ok", candidateCount: 0, lines: [], entries: [], recallCount: 0, identityRecallCount: 0, quarantinedCount: 0, conflictCount: 0, staleCount: 0 };
    }
    const retrieval = retrieveAyasMemory(records, query, {
      ...(options.activeProject ? { activeProject: options.activeProject } : {}),
      ...(options.nowIso ? { nowIso: options.nowIso } : {}),
      limit: TOP_K,
    });
    if (retrieval.selected.length === 0) {
      return {
        status: "ok",
        candidateCount: records.length,
        lines: [],
        entries: [],
        recallCount: 0,
        identityRecallCount: 0,
        quarantinedCount: retrieval.quarantined.length,
        conflictCount: retrieval.quarantined.filter((decision) => decision.conflictState === "conflicting").length,
        staleCount: retrieval.quarantined.filter((decision) => decision.quarantineReason === "stale-fact").length,
      };
    }
    const lines: string[] = [];
    const entries: { line: string; identity: boolean; trustClass: AyasMemoryTrustClass; freshness: AyasMemoryFreshness }[] = [];
    let identityRecallCount = 0;
    let chars = 0;
    for (const decision of retrieval.selected) {
      const r = decision.record;
      const line = toLine(r);
      if (chars + line.length > MAX_BLOCK_CHARS) break;
      lines.push(line);
      entries.push({ line, identity: r.tags.includes("kimlik"), trustClass: decision.trustClass, freshness: decision.freshness });
      chars += line.length;
      if (r.tags.includes("kimlik")) identityRecallCount += 1;
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
    };
  } catch {
    return { status: "unreadable", candidateCount: 0, lines: [], entries: [], recallCount: 0, identityRecallCount: 0, quarantinedCount: 0, conflictCount: 0, staleCount: 0 };
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

/**
 * Write side. Fire-and-forget from the chat path after the reply. Extracts
 * candidates from the turn, gates each, stores the survivors. Returns a small
 * summary (for the observability trace) and NEVER throws.
 */
export async function persistAyasMemoryFromTurn(input: {
  readonly userText: string;
  readonly ayasReply: string;
  readonly tags?: readonly string[];
  readonly nowIso?: string;
  readonly store?: AyasMemoryStoreOptions;
}): Promise<{ candidates: number; stored: number; rejected: number }> {
  try {
    const candidates = extractAyasMemoryCandidates({
      userText: input.userText,
      ayasReply: input.ayasReply,
      ...(input.tags ? { tags: input.tags } : {}),
    });
    if (candidates.length === 0) return { candidates: 0, stored: 0, rejected: 0 };

    const store = createAyasMemoryStore(input.store);
    const now = input.nowIso ?? new Date().toISOString();
    let stored = 0;
    let rejected = 0;

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
      });
      const result = store.append(record);
      if (result === "stored") stored += 1;
      else if (result === "rejected") rejected += 1;
    }
    return { candidates: candidates.length, stored, rejected };
  } catch {
    return { candidates: 0, stored: 0, rejected: 0 };
  }
}
