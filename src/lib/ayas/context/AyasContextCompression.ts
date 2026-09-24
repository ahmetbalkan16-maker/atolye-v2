/**
 * Atölye Brain — AYAS context compression (Phase 2 · Phase B.1).
 *
 * The chat history is not unbounded. Instead of a vector DB (deliberately not
 * this phase), a DETERMINISTIC split:
 *
 *   [ compact summary of the older turns ]  +  [ the last N turns verbatim ]
 *
 * The summary is extractive, not generative — it lists which topics/projects/
 * questions came up, never invents. Pure.
 */

import type { BrainChatMessage } from "@/components/brain/brainCore";

export interface CompressAyasHistoryOptions {
  /** Turns kept verbatim (default 12 — matches `AYAS_HISTORY_TURNS`). */
  readonly recentTurns?: number;
  /** Max characters of the extractive summary (default 600). */
  readonly maxSummaryChars?: number;
  /** Soft verbatim budget. The last two turns remain intact even when they exceed it. */
  readonly maxRecentChars?: number;
}

export interface CompressedAyasHistory {
  /** Older turns, folded into 1–5 extractive bullet lines. Empty when nothing was dropped. */
  readonly summary: readonly string[];
  /** The last N turns, verbatim, oldest-first — feed these to the model as-is. */
  readonly recent: readonly { readonly role: BrainChatMessage["role"]; readonly text: string }[];
  readonly droppedTurns: number;
}

const DEFAULT_RECENT = 12;
const DEFAULT_SUMMARY_CHARS = 600;

export function compressAyasHistory(
  history: readonly { readonly role: BrainChatMessage["role"]; readonly text: string }[],
  options: CompressAyasHistoryOptions = {},
): CompressedAyasHistory {
  const recentTurns = Math.max(2, options.recentTurns ?? DEFAULT_RECENT);
  const maxChars = Math.max(120, options.maxSummaryChars ?? DEFAULT_SUMMARY_CHARS);
  const maxRecentChars = options.maxRecentChars === undefined ? Infinity : Math.max(0, options.maxRecentChars);

  const turns = history.filter((t) => t.role !== "system" && typeof t.text === "string" && t.text.trim());
  let recentStart = Math.max(0, turns.length - recentTurns);
  let recentChars = turns.slice(recentStart).reduce((sum, turn) => sum + turn.text.length, 0);
  while (recentStart < turns.length - 2 && recentChars > maxRecentChars) {
    recentChars -= turns[recentStart].text.length;
    recentStart += 1;
  }
  if (recentStart === 0) return { summary: [], recent: turns, droppedTurns: 0 };

  const older = turns.slice(0, recentStart);
  const recent = turns.slice(recentStart);

  // A bounded summary must retain the newest correction/constraint before
  // older, possibly superseded requests consume its character budget.
  const userAsks = older.filter((t) => t.role === "user").reverse().map((t) => firstSentence(t.text));
  const ayasQuestions = older
    .filter((t) => t.role !== "user" && t.text.trim().endsWith("?"))
    .reverse()
    .map((t) => lastSentence(t.text));

  const lines: string[] = [];
  if (userAsks.length) {
    lines.push(`Daha önce konuşulan konular (en yenisi önce): ${dedupeJoin(userAsks, maxChars)}`);
  }
  if (ayasQuestions.length) {
    lines.push(`AYAS'ın daha önce sorduğu: ${dedupeJoin(ayasQuestions, Math.floor(maxChars / 2))}`);
  }
  if (lines.length === 0) {
    lines.push(`${older.length} eski tur özetlendi (belirgin bir konu çıkmadı).`);
  }

  let remaining = maxChars;
  const boundedLines = lines.flatMap((line) => {
    if (remaining <= 0) return [];
    const bounded = line.length <= remaining ? line : `${line.slice(0, Math.max(0, remaining - 1))}…`;
    remaining -= bounded.length;
    return [bounded];
  });
  return { summary: boundedLines, recent, droppedTurns: older.length };
}

function firstSentence(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  const m = t.split(/(?<=[.!?])\s+/)[0] ?? t;
  return m.length <= 90 ? m : `${m.slice(0, 89)}…`;
}

function lastSentence(text: string): string {
  const parts = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const m = parts[parts.length - 1] ?? text;
  return m.length <= 90 ? m : `${m.slice(0, 89)}…`;
}

function dedupeJoin(items: readonly string[], maxChars: number): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLocaleLowerCase("tr");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.join("; ").length > maxChars) break;
  }
  const joined = out.join("; ");
  return joined.length <= maxChars ? joined : `${joined.slice(0, maxChars - 1)}…`;
}
