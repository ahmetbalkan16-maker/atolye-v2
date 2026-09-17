import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Approval-race UX hardening (AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint,
 * Part A). Two independent, correctly fail-closed authority lanes (the
 * MICRO_SAFE batch lane and the individual PRIORITY_SAFE proposal lane) can
 * both look "ready to execute" in Gelişim Merkezi at the same moment even
 * though at most one of them can actually publish against a given HEAD —
 * whichever commits first silently makes the other's `baseHead` stale. The
 * underlying authority/staleness machinery (`AyasExecutionGate`,
 * `reconcileAyasStaleProposals`, `reconcileAyasMicroBatchStaleness`) was
 * already fail-closed and lost no work; what was missing was ANY signal in
 * the read-only views that would let a human understand, in the moment,
 * that a second HEAD-bound action might be about to go stale instead of
 * silently discovering it after the fact. This module supplies that signal.
 *
 * Deliberately reads only two cheap, already-durable facts — it does not
 * reserve, lock, or mutate anything, and it never blocks a real decision;
 * a stale/unreadable read here only ever downgrades the UI to its
 * pre-existing behavior (no live signal shown), never to a false one.
 */
export interface AyasPublicationActivitySnapshot {
  /** `undefined` when the live HEAD could not be determined (e.g. not a git worktree) — callers must treat this as "unknown", never as "stale". */
  readonly liveCurrentHead?: string;
  /** `true` only when the isolated Package C gate is confirmed open/mid-transition right now. Any read failure resolves to `false` (the safe default — never blocks or warns based on an assumption). */
  readonly publicationActive: boolean;
}

/** The exact gateRoot Package C's approval services already use in production (`AyasMicroBatchApprovalService.ts` / `AyasProposalApprovalService.ts`) — duplicated here as a plain path join, not imported, so this read-only module has zero dependency on the write-capable execution services. */
export function resolveAyasProductionSelfImprovementGateRoot(repoRoot: string = process.cwd()): string {
  return path.join(repoRoot, "data", "brain", "self-improvement");
}

function readGateState(gateRoot: string): string | undefined {
  try {
    const raw = fs.readFileSync(path.join(gateRoot, "execution", "gate.json"), "utf8");
    const parsed = JSON.parse(raw) as { readonly state?: unknown };
    return typeof parsed.state === "string" ? parsed.state : undefined;
  } catch {
    return undefined;
  }
}

function readLiveHead(repoRoot: string): string | undefined {
  try {
    // `stdio` pins stderr to "ignore" — execFileSync's sync stderr otherwise
    // inherits straight to this process's stderr by default, so a caller
    // whose cwd is not a git worktree at all (every existing test fixture
    // root that predates this module) would print a raw "fatal: not a git
    // repository" line on every read despite this being a normal, caught,
    // fail-soft outcome.
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

/** The safe, side-effect-free default for pure builder functions and every pre-existing test call site: no live signal, equivalent to "nothing is known to be active." */
export const AYAS_PUBLICATION_ACTIVITY_UNKNOWN: AyasPublicationActivitySnapshot = { liveCurrentHead: undefined, publicationActive: false };

export function readAyasPublicationActivity(repoRoot: string = process.cwd(), gateRoot: string = resolveAyasProductionSelfImprovementGateRoot(repoRoot)): AyasPublicationActivitySnapshot {
  const state = readGateState(gateRoot);
  return {
    liveCurrentHead: readLiveHead(repoRoot),
    publicationActive: state !== undefined && state !== "CLOSED",
  };
}
