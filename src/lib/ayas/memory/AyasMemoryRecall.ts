/**
 * Atölye Brain — AYAS memory recall (Phase 2 · Phase C.2).
 *
 *   query → recall → top-K relevant → prompt lines
 *
 * Deterministic relevance (no embeddings this phase): a record scores on
 * importance + tag/word overlap with the query + the active project. Only the
 * top few, capped by characters, ever reach the prompt — the whole memory is
 * never dumped. Pure aside from the one `AyasMemoryStore.load()` read.
 *
 * `persistAyasMemoryFromTurn` is the write side — fire-and-forget from the chat
 * path AFTER the reply: extract candidates, gate them, store the survivors. It
 * never throws into the caller and never blocks the response.
 */

import { buildBrainMemoryRecord, recallBrainMemory } from "@/lib/brain/BrainMemoryModel";
import type { BrainMemoryRecord } from "@/types/brainMemory";
import { createAyasMemoryStore, type AyasMemoryStoreOptions } from "./AyasMemoryStore";
import { extractAyasMemoryCandidates } from "./AyasMemoryCandidate";
import { scoreAyasMemoryCandidate } from "./AyasMemoryGovernance";

const TOP_K = 4;
const MAX_LINE_CHARS = 160;
const MAX_BLOCK_CHARS = 700;

function fold(text: string): string {
  return String(text ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[İıI]/g, "i")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");
}

const IMPORTANCE_WEIGHT: Record<BrainMemoryRecord["importance"], number> = {
  transient: 0,
  normal: 2,
  durable: 4,
  pinned: 6,
};

const STOPWORDS = new Set([
  "bir", "bu", "su", "o", "ve", "ile", "icin", "ne", "mi", "mu", "var", "yok",
  "the", "a", "an", "is", "to", "of",
]);

function tokens(text: string): Set<string> {
  return new Set(
    fold(text)
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

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
  const recalled = recallBrainMemory(records, {}, options.nowIso).records;
  const qTokens = tokens(query);
  const projectTokens = options.activeProject ? tokens(options.activeProject) : new Set<string>();

  const scored = recalled.map((r) => {
    const rText = tokens(`${r.title} ${r.body} ${r.tags.join(" ")}`);
    let overlap = 0;
    for (const t of qTokens) if (rText.has(t)) overlap += 2;
    for (const t of projectTokens) if (rText.has(t)) overlap += 3;
    const score = IMPORTANCE_WEIGHT[r.importance] + overlap;
    return { r, score };
  });

  return scored
    .filter((s) => s.score > 0 && (s.r.importance === "pinned" || s.score >= 2))
    .sort((a, b) => b.score - a.score || Date.parse(b.r.observedAt) - Date.parse(a.r.observedAt))
    .slice(0, TOP_K)
    .map((s) => s.r);
}

function toLine(r: BrainMemoryRecord): string {
  const body = r.body.replace(/\s+/g, " ").trim();
  const text = body.length <= MAX_LINE_CHARS ? body : `${body.slice(0, MAX_LINE_CHARS - 1)}…`;
  return `  · (${r.kind}) ${text}`;
}

/** The prompt block. `[]` when nothing relevant / the store is empty / any error. */
export async function recallAyasMemoryLines(
  query: string,
  options: RecallAyasMemoryOptions = {},
): Promise<string[]> {
  try {
    const store = createAyasMemoryStore(options.store);
    const records = store.load();
    if (records.length === 0) return [];
    const top = rankAyasMemory(records, query, {
      ...(options.activeProject ? { activeProject: options.activeProject } : {}),
      ...(options.nowIso ? { nowIso: options.nowIso } : {}),
    });
    if (top.length === 0) return [];
    const lines: string[] = [];
    let chars = 0;
    for (const r of top) {
      const line = toLine(r);
      if (chars + line.length > MAX_BLOCK_CHARS) break;
      lines.push(line);
      chars += line.length;
    }
    return lines;
  } catch {
    return [];
  }
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
