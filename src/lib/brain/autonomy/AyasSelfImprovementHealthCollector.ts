import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { processIsAlive, readProcessStartEpochMs } from "./AyasProcessLiveness";
import {
  evaluateAyasSelfImprovementHealth,
  type AyasHealthFact,
  type AyasHealthFileFact,
  type AyasHealthObserverState,
  type AyasHealthOwnerStatus,
  type AyasHealthResearchLockFacts,
  type AyasHealthResearchState,
  type AyasSelfImprovementHealth,
  type AyasSelfImprovementHealthInput,
} from "./AyasSelfImprovementHealth";

/**
 * AYAS M26 (Phase 1) — the read-only I/O side of Self-Improvement Health: it
 * gathers the durable facts `evaluateAyasSelfImprovementHealth` judges. It
 * only ever READS — daemon state, the observer and research lock owners, the
 * research cadence, `git rev-parse` / `git status --porcelain`, and Graphify's
 * branch metadata. It never writes, locks, signals or restarts anything, and
 * (like `AyasPublicationActivity`) it imports no write-capable service: every
 * path below is a plain join of the locations those services already use.
 *
 * Every read is fail-soft. A missing file is `absent`, a present-but-invalid
 * one is `unreadable`, and neither is ever guessed into a healthy value.
 */

/** Same default as `scripts/ayas-autonomy-daemon.ts` (`5 * 60_000`). */
export const AYAS_HEALTH_DEFAULT_OBSERVER_INTERVAL_MS = 5 * 60_000;
/** Mirror `AyasResearchScheduler`'s cadence; a test pins them equal so the two cannot drift. Not imported, to keep the scheduler's module graph out of this read-only path. */
export const AYAS_HEALTH_DEFAULT_LIGHT_INTERVAL_MS = 6 * 60 * 60_000;
export const AYAS_HEALTH_DEFAULT_DEEP_INTERVAL_MS = 24 * 60 * 60_000;

export interface AyasHealthCollectorDeps {
  readonly repoRoot?: string;
  readonly now?: () => string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly observerIntervalMs?: number;
  /** Test seam for deterministic Git read failures; production uses the read-only `git` executable calls below. */
  readonly readGit?: (repoRoot: string, args: readonly string[]) => string;
  /** Read-only seams used to prove filesystem failures without changing host permissions. */
  readonly readTextFile?: (file: string) => string;
  readonly statPath?: (target: string) => { readonly mtimeMs: number; isFile(): boolean; isDirectory(): boolean };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultReadTextFile(file: string): string { return fs.readFileSync(file, "utf8"); }
function defaultStatPath(target: string): { readonly mtimeMs: number; isFile(): boolean; isDirectory(): boolean } { return fs.statSync(target); }

function readJsonFact(file: string, readTextFile: NonNullable<AyasHealthCollectorDeps["readTextFile"]>): AyasHealthFileFact<unknown> {
  let text: string;
  try {
    text = readTextFile(file);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "absent" } : { kind: "unreadable" };
  }
  try {
    return { kind: "ok", value: JSON.parse(text) as unknown };
  } catch {
    return { kind: "unreadable" };
  }
}

/** Same three-way identity decision `AyasObserverSingletonLock` makes: a dead PID or a reused PID (start time no longer matches) is `dead`; an unreadable start time is `unknown`, never proof of anything. */
async function classifyOwner(pid: number, processStartEpochMs: number | undefined): Promise<AyasHealthOwnerStatus> {
  if (!processIsAlive(pid)) return "dead";
  if (processStartEpochMs === undefined) return "alive";
  try {
    const currentStart = await readProcessStartEpochMs(pid);
    return Math.abs(currentStart - processStartEpochMs) <= 1_000 ? "alive" : "dead";
  } catch {
    return "unknown";
  }
}

function toObserverState(value: unknown): AyasHealthObserverState | undefined {
  if (!isRecord(value)) return undefined;
  const { schemaVersion, phase, updatedAt, heartbeatCount } = value;
  if (schemaVersion !== "1" || typeof phase !== "string" || typeof updatedAt !== "string" || !Number.isSafeInteger(heartbeatCount) || (heartbeatCount as number) < 0) return undefined;
  return { schemaVersion, phase, updatedAt, heartbeatCount: heartbeatCount as number };
}

function toResearchState(value: unknown): AyasHealthResearchState | undefined {
  if (!isRecord(value)) return undefined;
  const { consecutiveFailures, nextLightAt, nextDeepAt, currentRunId } = value;
  if (value.schemaVersion !== "1" || !Number.isSafeInteger(consecutiveFailures) || (consecutiveFailures as number) < 0) return undefined;
  const validOptionalTimestamp = (entry: unknown): entry is string | undefined => entry === undefined || (typeof entry === "string" && Number.isFinite(Date.parse(entry)));
  if (!validOptionalTimestamp(nextLightAt) || !validOptionalTimestamp(nextDeepAt)) return undefined;
  if (currentRunId !== undefined && (typeof currentRunId !== "string" || currentRunId.trim().length === 0)) return undefined;
  return {
    schemaVersion: "1",
    consecutiveFailures: consecutiveFailures as number,
    ...(typeof nextLightAt === "string" ? { nextLightAt } : {}),
    ...(typeof nextDeepAt === "string" ? { nextDeepAt } : {}),
    ...(typeof currentRunId === "string" ? { currentRunId } : {}),
  };
}

/** The observer lock is either `{pid, processStartEpochMs?}` JSON or (legacy) a bare integer — exactly the two shapes `AyasObserverSingletonLock` reads. */
function parseObserverLockOwner(text: string): { readonly pid: number; readonly processStartEpochMs?: number } | undefined {
  const trimmed = text.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isRecord(parsed)) {
      const { pid, processStartEpochMs } = parsed;
      if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return undefined;
      if (processStartEpochMs !== undefined && (typeof processStartEpochMs !== "number" || !Number.isSafeInteger(processStartEpochMs) || processStartEpochMs <= 0)) return undefined;
      return { pid, ...(typeof processStartEpochMs === "number" ? { processStartEpochMs } : {}) };
    }
  } catch {
    /* not JSON — fall through to the legacy bare-integer form */
  }
  const pid = Number(trimmed);
  return Number.isSafeInteger(pid) && pid > 0 ? { pid } : undefined;
}

async function readObserverLock(lockFile: string, readTextFile: NonNullable<AyasHealthCollectorDeps["readTextFile"]>): Promise<AyasSelfImprovementHealthInput["observer"]["lock"]> {
  let text: string;
  try {
    text = readTextFile(lockFile);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "absent" } : { kind: "unreadable" };
  }
  const owner = parseObserverLockOwner(text);
  if (!owner) return { kind: "unreadable" };
  return { kind: "ok", value: { ownerStatus: await classifyOwner(owner.pid, owner.processStartEpochMs) } };
}

/** Mirrors `AyasExecutionAuthorityLock`'s own `parseOwner` field-for-field, so "invalid" here means "the lock's reclaim path would refuse this record too". */
function isValidExecutionLockOwner(value: unknown): value is { readonly pid: number; readonly processStartEpochMs: number } {
  if (!isRecord(value)) return false;
  return value.schemaVersion === "1" && typeof value.gateRoot === "string" && typeof value.ownerNonce === "string" && value.ownerNonce.length > 0
    && Number.isSafeInteger(value.pid) && (value.pid as number) > 0 && Number.isSafeInteger(value.processStartEpochMs) && (value.processStartEpochMs as number) > 0
    && typeof value.acquiredAt === "string" && Number.isFinite(Date.parse(value.acquiredAt));
}

async function readResearchLock(lockDir: string, nowMs: number, readTextFile: NonNullable<AyasHealthCollectorDeps["readTextFile"]>, statPath: NonNullable<AyasHealthCollectorDeps["statPath"]>): Promise<AyasHealthFileFact<AyasHealthResearchLockFacts>> {
  let mtimeMs: number;
  try {
    mtimeMs = statPath(lockDir).mtimeMs;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "absent" } : { kind: "unreadable" };
  }
  // `now` is serialized to whole milliseconds while filesystem mtimes may retain fractions and the host clock can tick between fixture/write and collection; tolerate only a sub-second edge.
  if (!Number.isFinite(mtimeMs) || mtimeMs - nowMs > 1_000) return { kind: "unreadable" };
  const ageMs = Math.max(0, nowMs - mtimeMs);
  let ownerBytes: string;
  try {
    ownerBytes = readTextFile(path.join(lockDir, "owner.json"));
  } catch (error) {
    const ownerStatus = (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" as const : "unreadable" as const;
    return { kind: "ok", value: { ownerStatus, ageMs } };
  }
  let owner: unknown;
  try {
    owner = JSON.parse(ownerBytes) as unknown;
  } catch {
    return { kind: "ok", value: { ownerStatus: "invalid", ageMs } };
  }
  if (!isValidExecutionLockOwner(owner)) return { kind: "ok", value: { ownerStatus: "invalid", ageMs } };
  return { kind: "ok", value: { ownerStatus: await classifyOwner(owner.pid, owner.processStartEpochMs), ageMs } };
}

function defaultGitReader(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
}

function readGit(repoRoot: string, args: readonly string[], reader: NonNullable<AyasHealthCollectorDeps["readGit"]>): AyasHealthFact<string> {
  try {
    // stderr is pinned to "ignore": a non-repo cwd is a normal, caught outcome here and must not print a raw "fatal:" line.
    return { kind: "ok", value: reader(repoRoot, args) };
  } catch {
    return { kind: "unreadable" };
  }
}

function readGraphAnalyzedHead(repoRoot: string, readTextFile: NonNullable<AyasHealthCollectorDeps["readTextFile"]>, statPath: NonNullable<AyasHealthCollectorDeps["statPath"]>): AyasHealthFileFact<string> {
  try {
    if (!statPath(path.join(repoRoot, ".graphify", "graph.json")).isFile()) return { kind: "unreadable" };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "absent" } : { kind: "unreadable" };
  }
  const branch = readJsonFact(path.join(repoRoot, ".graphify", "branch.json"), readTextFile);
  if (branch.kind !== "ok") return branch;
  if (!isRecord(branch.value)) return { kind: "unreadable" };
  const head = branch.value.lastAnalyzedHead;
  return typeof head === "string" && head.length > 0 ? { kind: "ok", value: head } : { kind: "unreadable" };
}

export async function collectAyasSelfImprovementHealthInput(deps: AyasHealthCollectorDeps = {}): Promise<AyasSelfImprovementHealthInput> {
  const repoRoot = path.resolve(deps.repoRoot ?? process.cwd());
  const now = deps.now ? deps.now() : new Date().toISOString();
  const nowMs = Date.parse(now);
  const env = deps.env ?? process.env;
  const gitReader = deps.readGit ?? defaultGitReader;
  const readTextFile = deps.readTextFile ?? defaultReadTextFile;
  const statPath = deps.statPath ?? defaultStatPath;
  const autonomyDir = path.join(repoRoot, "data", "brain", "autonomy");
  const researchDir = path.join(repoRoot, "data", "brain", "self-improvement", "research");

  const observerState = readJsonFact(path.join(autonomyDir, "daemon-state.json"), readTextFile);
  const observerValue = observerState.kind === "ok" ? toObserverState(observerState.value) : undefined;
  const researchState = readJsonFact(path.join(researchDir, "scheduler-state.json"), readTextFile);
  const researchValue = researchState.kind === "ok" ? toResearchState(researchState.value) : undefined;

  const headRead = readGit(repoRoot, ["rev-parse", "HEAD"], gitReader);
  const statusRead = readGit(repoRoot, ["status", "--porcelain"], gitReader);
  const head = headRead.kind === "ok" && headRead.value.trim().length > 0 ? { kind: "ok" as const, value: headRead.value.trim() } : { kind: "unreadable" as const };
  const clean = statusRead.kind === "ok" ? { kind: "ok" as const, value: statusRead.value.trim().length === 0 } : { kind: "unreadable" as const };
  const lock = Number.isFinite(nowMs)
    ? await readResearchLock(path.join(researchDir, "execution", ".authority-lock"), nowMs, readTextFile, statPath)
    : { kind: "unreadable" as const };

  return {
    now,
    observer: {
      intervalMs: deps.observerIntervalMs ?? AYAS_HEALTH_DEFAULT_OBSERVER_INTERVAL_MS,
      // A file that parsed as JSON but lacks the state shape is `unreadable`, never a guessed default.
      state: observerState.kind === "ok" ? (observerValue ? { kind: "ok", value: observerValue } : { kind: "unreadable" }) : observerState,
      lock: await readObserverLock(path.join(autonomyDir, "daemon.lock"), readTextFile),
    },
    research: {
      enabled: env.AYAS_RESEARCH_SCHEDULER_ENABLED !== "0",
      lightIntervalMs: AYAS_HEALTH_DEFAULT_LIGHT_INTERVAL_MS,
      deepIntervalMs: AYAS_HEALTH_DEFAULT_DEEP_INTERVAL_MS,
      state: researchState.kind === "ok" ? (researchValue ? { kind: "ok", value: researchValue } : { kind: "unreadable" }) : researchState,
      lock,
    },
    repo: {
      head,
      clean,
      graph: readGraphAnalyzedHead(repoRoot, readTextFile, statPath),
    },
  };
}

/** Collect + evaluate in one call. Read-only end to end. */
export async function readAyasSelfImprovementHealth(deps: AyasHealthCollectorDeps = {}): Promise<AyasSelfImprovementHealth> {
  return evaluateAyasSelfImprovementHealth(await collectAyasSelfImprovementHealthInput(deps));
}
