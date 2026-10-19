import fs from "node:fs";
import path from "node:path";

/**
 * Owner decision 2026-10-19 ("bir görev bitince otomatik olarak canlıya aktarılsın"): a finished task, i.e. a commit
 * pushed to the branch's upstream on a clean tree, goes live without the owner running scripts/ayas-publish-live.ps1.
 * The update executor decides here and then runs the established publish (AyasUpdateApplyRunner), which builds the
 * commit in its own snapshot, refuses while the live app has a running job, and rolls itself back when the new
 * snapshot is not healthy. This module only decides and keeps the attempt record; it runs nothing.
 *
 * Never published: an unpushed or older commit, a commit that does not descend from the live one, a commit without an
 * application change, a commit that was already rolled back or tried AYAS_AUTO_LIVE_MAX_ATTEMPTS times, or anything
 * while the owner chatted within the last AYAS_AUTO_LIVE_OWNER_QUIET_MS. AYAS_AUTO_LIVE_PUBLISH=0 turns it off.
 */
export const AYAS_AUTO_LIVE_MAX_ATTEMPTS = 2;
export const AYAS_AUTO_LIVE_OWNER_QUIET_MS = 5 * 60_000;
export const AYAS_AUTO_LIVE_STATE_FILE = "auto-live-publish.json";
const MAX_KEPT_ATTEMPTS = 50;

/** The same list as $appPaths in scripts/ayas-publish-live.ps1 (smoke-ayas-auto-live-publish keeps them equal). */
export const AYAS_LIVE_APP_PATHS: readonly string[] = Object.freeze([
  "app", "src", "public", "package.json", "package-lock.json", "next.config.ts", "middleware.ts", "instrumentation.ts", "postcss.config.mjs", "tsconfig.json",
]);

export type AyasAutoLiveStatus = "RUNNING" | "PUBLISHED" | "ROLLED_BACK" | "FAILED";

export interface AyasAutoLiveAttempt {
  readonly commitSha: string;
  readonly status: AyasAutoLiveStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly summary?: string;
}

export type AyasAutoLiveSkipReason =
  | "DISABLED" | "LIVE_UNKNOWN" | "CURRENT" | "NOT_PUSHED" | "NOT_DESCENDANT" | "NO_APP_CHANGE" | "ROLLED_BACK_BEFORE" | "ATTEMPTS_EXHAUSTED" | "OWNER_ACTIVE";

export type AyasAutoLiveDecision =
  | { readonly kind: "PUBLISH"; readonly commitSha: string; readonly liveHead: string }
  | { readonly kind: "NONE"; readonly reason: AyasAutoLiveSkipReason };

export interface AyasAutoLiveFacts {
  readonly enabled: boolean;
  readonly head: string;
  /** The upstream's commit as this repository last saw it; undefined when the branch has no upstream. */
  readonly upstreamHead?: string;
  /** The live snapshot's build commit; undefined when there is no readable live publication on this machine. */
  readonly liveHead?: string;
  /** Read lazily, only once the cheaper facts allow a publish. */
  readonly liveIsAncestor: () => boolean;
  readonly appChanged: () => boolean;
  readonly ownerChatAt?: string;
  readonly nowMs: number;
  readonly attempts: readonly AyasAutoLiveAttempt[];
}

const none = (reason: AyasAutoLiveSkipReason): AyasAutoLiveDecision => Object.freeze({ kind: "NONE", reason });

export function decideAyasAutoLivePublish(facts: AyasAutoLiveFacts): AyasAutoLiveDecision {
  if (!facts.enabled) return none("DISABLED");
  if (!facts.liveHead) return none("LIVE_UNKNOWN");
  if (facts.liveHead === facts.head) return none("CURRENT");
  if (facts.upstreamHead !== facts.head) return none("NOT_PUSHED");
  const tried = facts.attempts.filter((attempt) => attempt.commitSha === facts.head);
  if (tried.some((attempt) => attempt.status === "ROLLED_BACK")) return none("ROLLED_BACK_BEFORE");
  // An interrupted attempt (RUNNING left by a dead executor) counts too, so a publish that kills its caller stops.
  if (tried.length >= AYAS_AUTO_LIVE_MAX_ATTEMPTS) return none("ATTEMPTS_EXHAUSTED");
  if (!facts.liveIsAncestor()) return none("NOT_DESCENDANT");
  if (!facts.appChanged()) return none("NO_APP_CHANGE");
  const chatMs = facts.ownerChatAt ? Date.parse(facts.ownerChatAt) : Number.NaN;
  if (Number.isFinite(chatMs) && facts.nowMs - chatMs < AYAS_AUTO_LIVE_OWNER_QUIET_MS) return none("OWNER_ACTIVE");
  return Object.freeze({ kind: "PUBLISH", commitSha: facts.head, liveHead: facts.liveHead });
}

/* ------------------------------------------------------------------ state --- */

function isAttempt(value: unknown): value is AyasAutoLiveAttempt {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.commitSha === "string" && /^[0-9a-f]{40}$/.test(entry.commitSha) && typeof entry.startedAt === "string"
    && ["RUNNING", "PUBLISHED", "ROLLED_BACK", "FAILED"].includes(entry.status as string);
}

/** The attempt record in the update-trials store root; an unreadable record reads as no attempts. */
export function readAyasAutoLiveAttempts(rootDir: string): AyasAutoLiveAttempt[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(rootDir, AYAS_AUTO_LIVE_STATE_FILE), "utf8")) as { readonly attempts?: unknown };
    return Array.isArray(parsed.attempts) ? parsed.attempts.filter(isAttempt) : [];
  } catch { return []; }
}

/** Adds an attempt, or replaces the same commit's attempt started at the same time. */
export function recordAyasAutoLiveAttempt(rootDir: string, attempt: AyasAutoLiveAttempt): void {
  const others = readAyasAutoLiveAttempts(rootDir).filter((entry) => !(entry.commitSha === attempt.commitSha && entry.startedAt === attempt.startedAt));
  const attempts = [...others, attempt].slice(-MAX_KEPT_ATTEMPTS);
  fs.mkdirSync(rootDir, { recursive: true });
  const file = path.join(rootDir, AYAS_AUTO_LIVE_STATE_FILE);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, attempts }, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}
