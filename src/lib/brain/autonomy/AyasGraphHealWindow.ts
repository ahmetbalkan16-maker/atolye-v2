import fs from "node:fs";
import path from "node:path";

/**
 * The timing shared by the Graphify self-heal (`AyasPublicationSelfHeal`, run by the update executor) and the control
 * center that reports it. Pure: file reads only, no Git, no push, no refresh — so the server read model can import it.
 *
 * 9 Nov 2026: a session pulled two commits into the canonical repo and refreshed Graphify a few minutes later; in
 * between, the control center called the graph "ESKİ (GRAPH_STALE)" and the self-improvement loop "KISMEN BOZUK",
 * while nothing was broken and the self-heal would not even look before 15 minutes after the commit time. Now the
 * heal counts from when HEAD arrived in this repository, and until the window below has passed the control center
 * says the graph is being refreshed. A heal that failed for that HEAD, or a graph still behind after the window, is a
 * real warning again.
 */

/** A publication's closure or a session's own refresh runs within minutes of HEAD arriving; only then does AYAS refresh it itself. */
export const AYAS_GRAPH_HEAL_GRACE_MS = 5 * 60_000;

/**
 * How long after HEAD arrived a graph that is merely behind it reads as "being refreshed": the grace, an observer
 * tick that can be busy for ~7 minutes before the update executor runs, the 5-minute pause, and a refresh of a few
 * minutes on this machine's disk.
 */
export const AYAS_GRAPH_REFRESH_PENDING_WINDOW_MS = 30 * 60_000;

export interface AyasGraphHealAttempt { readonly head: string; readonly at: string; readonly ok: boolean; readonly detail: string }

/** The update executor's store root, where `graph-heal.json` lives. */
export function resolveAyasGraphHealStoreRoot(repoRoot: string): string {
  return path.join(repoRoot, "data", "brain", "self-improvement", "update-trials");
}

export function ayasGraphHealFile(storeRoot: string): string { return path.join(storeRoot, "graph-heal.json"); }

export function readAyasGraphHealAttempts(storeRoot: string): readonly AyasGraphHealAttempt[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(ayasGraphHealFile(storeRoot), "utf8")) as { readonly attempts?: unknown };
    return Array.isArray(parsed.attempts)
      ? parsed.attempts.filter((a): a is AyasGraphHealAttempt => typeof a?.head === "string" && typeof a?.at === "string" && typeof a?.ok === "boolean" && typeof a?.detail === "string")
      : [];
  } catch { return []; }
}

/** The Git arguments whose output `parseAyasHeadArrivalMs` reads: the newest reflog entry of HEAD, `HEAD@{<unix seconds>}`. */
export const AYAS_HEAD_ARRIVAL_GIT_ARGS: readonly string[] = ["log", "-g", "-1", "--date=unix", "--format=%gd", "HEAD"];

/** When HEAD last moved in this repository (commit, pull, merge, reset), from the reflog; undefined when unreadable. */
export function parseAyasHeadArrivalMs(reflogLine: string | undefined | null): number | undefined {
  const match = /^HEAD@\{(\d{9,11})\}$/.exec((reflogLine ?? "").trim());
  if (!match) return undefined;
  const ms = Number(match[1]) * 1000;
  return Number.isSafeInteger(ms) && ms > 0 ? ms : undefined;
}

/** True while the latest heal attempt for exactly `head` failed: the graph is then not "being refreshed" any more. */
export function ayasGraphHealFailedFor(head: string | null | undefined, attempts: readonly AyasGraphHealAttempt[]): boolean {
  if (!head) return false;
  const latest = attempts.filter((attempt) => attempt.head === head).at(-1);
  return latest !== undefined && latest.ok === false;
}
