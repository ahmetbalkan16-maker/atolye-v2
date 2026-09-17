import fs from "node:fs";
import path from "node:path";

import { createAyasMicroItemStore, type AyasMicroItem } from "./AyasMicroItem";

/**
 * M21.3 — durable storage hygiene for AYAS's self-improvement subtrees.
 *
 * Scope, deliberately narrow and conservative: this module only ever
 * touches independently-keyed, one-file-per-record subtrees
 * (`micro-items/`, `patch-artifacts/`, `patch-artifacts/rejected/`,
 * `graphify-evidence/`) — never the array-based governance records
 * themselves (the micro-batch inbox, the approval inbox, and their
 * decision/result history), which stay exactly what M21.3's own MUST
 * RETAIN category calls "immutable human decision history." Pruning those
 * would mean in-place surgery on the single authoritative JSON array that
 * durably records every batch/proposal decision ever made — a categorically
 * higher-risk operation than deleting a terminal, independently-keyed
 * record file, and out of scope here by design, not by oversight.
 *
 * Retention rules (deterministic, never influenced by proposal/candidate
 * text):
 *   - a micro-item is eligible for cleanup only if its state is SUPERSEDED
 *     or REJECTED (both terminal, both mean "this opportunity is no longer
 *     live") AND it is at least `minAgeMs` old. DISCOVERED/SANDBOX_VALIDATED/
 *     BATCHED (still in play) and EXECUTED (the actual audit record of what
 *     was applied to the real repo) are NEVER eligible, at any age.
 *   - a patch artifact is eligible for cleanup only if NO currently-RETAINED
 *     micro-item references its artifactId, AND it is at least `minAgeMs`
 *     old. "Retained" means an item this same pass is NOT itself cleaning
 *     up (still active, or terminal-but-too-young) — a sibling item being
 *     cleaned up in the SAME pass does not, by itself, protect the
 *     artifact it pointed to. This is coordinated cleanup (an old,
 *     terminal item and its now-orphaned artifact are cleaned up
 *     together), while still guaranteeing "referenced patch artifact never
 *     deleted" for every artifact any RETAINED record still points to.
 *   - a rejection log or a Graphify-evidence record is eligible once it is
 *     at least `minAgeMs` old, keeping at least the most recent `keepLastN`
 *     regardless of age (never delete literally everything, even if it's
 *     all old — the most recent handful stay as a rolling audit sample).
 *
 * `auditAyasStorageHygiene` is pure/read-only (dry-run): it computes and
 * returns exactly what would be deleted and why, touching no file at all.
 * `applyAyasStorageHygiene` calls it internally and then deletes exactly
 * that set — idempotent (a file already gone is simply absent from the
 * next audit, never an error) and crash-safe (every deletion is an
 * independent `fs.rmSync` on its own file; an interruption mid-run leaves
 * some eligible files not yet deleted, never a corrupt or partial record,
 * since nothing here is a multi-step transaction over shared state).
 */
export interface AyasStorageHygieneOptions {
  readonly itemsDir: string;
  readonly artifactsDir: string;
  readonly rejectedDir: string;
  readonly evidenceDir: string;
  readonly now: string;
  /** Default 24h — nothing younger than this is ever touched, regardless of state. */
  readonly minAgeMs?: number;
  /** Default 20 — the most recent N rejection logs / evidence records are always kept regardless of age. */
  readonly keepLastN?: number;
}

export interface AyasStorageHygieneEligible {
  readonly path: string;
  readonly kind: "micro-item" | "patch-artifact" | "rejection-log" | "graphify-evidence";
  readonly reason: string;
  readonly ageMs: number;
}

export interface AyasStorageHygieneReport {
  readonly scanned: number;
  readonly eligible: readonly AyasStorageHygieneEligible[];
  readonly retainedCount: number;
}

const DEFAULT_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_KEEP_LAST_N = 20;

function ageOf(now: string, iso: string): number {
  const nowMs = Date.parse(now);
  const then = Date.parse(iso);
  if (!Number.isFinite(nowMs) || !Number.isFinite(then)) return 0;
  return Math.max(0, nowMs - then);
}

function listJsonFiles(dir: string): readonly string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("."));
}

function readJsonSafe<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; }
}

const TERMINAL_CLEANUP_ELIGIBLE_STATES: ReadonlySet<AyasMicroItem["state"]> = new Set(["SUPERSEDED", "REJECTED"]);

export function auditAyasStorageHygiene(options: AyasStorageHygieneOptions): AyasStorageHygieneReport {
  const minAgeMs = options.minAgeMs ?? DEFAULT_MIN_AGE_MS;
  const keepLastN = options.keepLastN ?? DEFAULT_KEEP_LAST_N;
  const eligible: AyasStorageHygieneEligible[] = [];
  let scanned = 0;
  let retainedCount = 0;

  // --- micro-items ---
  const itemStore = createAyasMicroItemStore({ rootDir: options.itemsDir });
  const allItems = itemStore.list();
  const referencedArtifactIds = new Set<string>();
  for (const item of allItems) {
    scanned += 1;
    const age = ageOf(options.now, item.lastUpdatedAt);
    const eligibleForCleanup = TERMINAL_CLEANUP_ELIGIBLE_STATES.has(item.state) && age >= minAgeMs;
    if (eligibleForCleanup) {
      const file = path.join(options.itemsDir, `${item.microItemId}.json`);
      eligible.push({ path: file, kind: "micro-item", reason: `state ${item.state}, age ${Math.round(age / 1000)}s >= min ${Math.round(minAgeMs / 1000)}s`, ageMs: age });
    } else {
      retainedCount += 1;
      referencedArtifactIds.add(item.patchArtifactId); // kept alive as long as ANY still-RETAINED item points to it — a SIBLING item being cleaned up in this same pass does not, by itself, protect an artifact
    }
  }

  // --- patch artifacts ---
  for (const file of listJsonFiles(options.artifactsDir)) {
    scanned += 1;
    const abs = path.join(options.artifactsDir, file);
    const artifact = readJsonSafe<{ artifactId: string; generatedAt: string }>(abs);
    if (!artifact) { retainedCount += 1; continue; } // never touch something we can't parse — fail closed to retention
    const age = ageOf(options.now, artifact.generatedAt);
    if (!referencedArtifactIds.has(artifact.artifactId) && age >= minAgeMs) {
      eligible.push({ path: abs, kind: "patch-artifact", reason: `unreferenced by any existing micro-item, age ${Math.round(age / 1000)}s >= min ${Math.round(minAgeMs / 1000)}s`, ageMs: age });
    } else {
      retainedCount += 1;
    }
  }

  // --- rejection logs (keep-last-N by recordedAt, then age-bound the rest) ---
  const rejectionEntries = listJsonFiles(options.rejectedDir)
    .map((f) => { const abs = path.join(options.rejectedDir, f); const parsed = readJsonSafe<{ at?: string }>(abs); return { abs, at: parsed?.at ?? "" }; })
    .filter((e) => e.at)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)); // newest first
  scanned += rejectionEntries.length;
  rejectionEntries.slice(keepLastN).forEach((entry) => {
    const age = ageOf(options.now, entry.at);
    if (age >= minAgeMs) eligible.push({ path: entry.abs, kind: "rejection-log", reason: `outside the most recent ${keepLastN}, age ${Math.round(age / 1000)}s >= min ${Math.round(minAgeMs / 1000)}s`, ageMs: age });
    else retainedCount += 1;
  });
  retainedCount += Math.min(keepLastN, rejectionEntries.length);

  // --- Graphify evidence (keep-last-N by completedAt, then age-bound the rest) ---
  const evidenceEntries = listJsonFiles(options.evidenceDir)
    .map((f) => { const abs = path.join(options.evidenceDir, f); const parsed = readJsonSafe<{ completedAt?: string }>(abs); return { abs, at: parsed?.completedAt ?? "" }; })
    .filter((e) => e.at)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  scanned += evidenceEntries.length;
  evidenceEntries.slice(keepLastN).forEach((entry) => {
    const age = ageOf(options.now, entry.at);
    if (age >= minAgeMs) eligible.push({ path: entry.abs, kind: "graphify-evidence", reason: `outside the most recent ${keepLastN}, age ${Math.round(age / 1000)}s >= min ${Math.round(minAgeMs / 1000)}s`, ageMs: age });
    else retainedCount += 1;
  });
  retainedCount += Math.min(keepLastN, evidenceEntries.length);

  return { scanned, eligible, retainedCount };
}

export interface AyasStorageHygieneOutcome extends AyasStorageHygieneReport {
  readonly deleted: readonly string[];
  readonly failedToDelete: readonly { readonly path: string; readonly error: string }[];
}

/** Applies exactly what `auditAyasStorageHygiene` reports as eligible. Idempotent (a missing file is not an error) and crash-safe (each deletion is independent). */
export function applyAyasStorageHygiene(options: AyasStorageHygieneOptions): AyasStorageHygieneOutcome {
  const report = auditAyasStorageHygiene(options);
  const deleted: string[] = [];
  const failedToDelete: { path: string; error: string }[] = [];
  for (const item of report.eligible) {
    try {
      if (fs.existsSync(item.path)) fs.rmSync(item.path, { force: true });
      deleted.push(item.path);
    } catch (error) {
      failedToDelete.push({ path: item.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ...report, deleted, failedToDelete };
}
