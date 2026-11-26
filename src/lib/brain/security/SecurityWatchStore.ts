/**
 * Atölye security brain ("Bekçi") — its records on disk, under `data/brain/security/` of the canonical repo (the live
 * server's and the observer's working directory, like every other `data/brain` store; Git-ignored).
 *
 *   report.json        the latest report (findings, when each fact was measured, the latest exam)
 *   watch-state.json   when each periodic check last ran, and the cached facts of the slower ones
 *   login-state.json   recent passcode failures and the brute-force lock (written by the login route)
 *   cases.jsonl        the case library: every finding when first seen and when it went away (append-only)
 *
 * fs only (no process, no network), so the login route and the Brain console may import it.
 */

import fs from "node:fs";
import path from "node:path";

import { LOGIN_LOCK_FAILURES_PER_HOUR, LOGIN_LOCK_MINUTES, type LoginFacts, type SecurityFinding, type SecurityWatchReport } from "./SecurityWatchModel";

export const SECURITY_WATCH_DIR = path.join("data", "brain", "security");

export function securityWatchDir(root: string = process.cwd()): string {
  return path.join(root, SECURITY_WATCH_DIR);
}

/** Writes a file atomically (temp file + rename), creating the folder. */
export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** The latest report, `null` when the watcher has never run. Throws on an unreadable file (fail closed upstream). */
export function readSecurityWatchReport(root: string = process.cwd()): SecurityWatchReport | null {
  const report = readJson<SecurityWatchReport>(path.join(securityWatchDir(root), "report.json"));
  if (report && (report.schemaVersion !== 1 || !Array.isArray(report.findings))) throw new Error("SECURITY_REPORT_INVALID");
  return report;
}

export function writeSecurityWatchReport(report: SecurityWatchReport, root: string = process.cwd()): void {
  writeJsonAtomic(path.join(securityWatchDir(root), "report.json"), report);
}

export function readWatchState<T extends object>(root: string = process.cwd()): T | null {
  return readJson<T>(path.join(securityWatchDir(root), "watch-state.json"));
}

export function writeWatchState(state: object, root: string = process.cwd()): void {
  writeJsonAtomic(path.join(securityWatchDir(root), "watch-state.json"), state);
}

export interface SecurityCase {
  readonly at: string;
  readonly event: "goruldu" | "gitti";
  readonly id: string;
  readonly severity: SecurityFinding["severity"];
  readonly title: string;
  readonly evidence: string;
  readonly advice: string;
}

/**
 * Appends the case library entries for this run: a finding seen for the first time, and one that went away (with how
 * long it lasted). Self-improvement starts here: the library is what the watcher, the owner and the developer brain
 * read when the same problem shows up again.
 */
export function recordSecurityCases(previous: readonly SecurityFinding[], current: readonly SecurityFinding[], nowIso: string, root: string = process.cwd()): readonly SecurityCase[] {
  const before = new Map(previous.map((f) => [f.id, f]));
  const after = new Map(current.map((f) => [f.id, f]));
  const cases: SecurityCase[] = [];
  for (const f of current) if (!before.has(f.id)) cases.push({ at: nowIso, event: "goruldu", id: f.id, severity: f.severity, title: f.title, evidence: f.evidence, advice: f.advice });
  for (const f of previous) if (!after.has(f.id)) cases.push({ at: nowIso, event: "gitti", id: f.id, severity: f.severity, title: f.title, evidence: f.evidence, advice: f.advice });
  if (cases.length > 0) {
    fs.mkdirSync(securityWatchDir(root), { recursive: true });
    fs.appendFileSync(path.join(securityWatchDir(root), "cases.jsonl"), cases.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf8");
  }
  return cases;
}

/** The newest `limit` cases, newest first (for the panel). */
export function readSecurityCases(limit: number, root: string = process.cwd()): readonly SecurityCase[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(securityWatchDir(root), "cases.jsonl"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return text.trim().split(/\r?\n/).filter(Boolean).slice(-limit).reverse().map((line) => JSON.parse(line) as SecurityCase);
}

// ---------------------------------------------------------------------------------------------------------------
// The brute-force lock (owner 2026-11-26: "yalnız bunu kendi yapsın, kilit geri alınabilir olsun").
// ---------------------------------------------------------------------------------------------------------------

interface LoginState {
  readonly schemaVersion: 1;
  /** Failure times (ISO) of the last 24 hours, oldest first. */
  readonly failures: readonly string[];
  readonly lockedUntil: string | null;
  /** Lock start times of the last 24 hours. */
  readonly locks: readonly string[];
  readonly liftedAt?: string;
}

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
const MAX_FAILURES_KEPT = 2000;

function loginStateFile(root: string): string {
  return path.join(securityWatchDir(root), "login-state.json");
}

function emptyLoginState(): LoginState {
  return { schemaVersion: 1, failures: [], lockedUntil: null, locks: [] };
}

function readLoginState(root: string): LoginState {
  const state = readJson<LoginState>(loginStateFile(root));
  return state && state.schemaVersion === 1 && Array.isArray(state.failures) ? state : emptyLoginState();
}

/**
 * Whether the passcode login is locked now. An unreadable state counts as NOT locked on purpose: a broken disk must
 * not lock the owner out (the brake in accessGate still slows guessing); the watcher reports the unreadable file.
 */
export function loginLockedUntil(nowMs: number, root: string = process.cwd()): string | null {
  let state: LoginState;
  try { state = readLoginState(root); } catch { return null; }
  return state.lockedUntil && Date.parse(state.lockedUntil) > nowMs ? state.lockedUntil : null;
}

/**
 * Records one passcode check. A failure that brings the last hour's failures to LOGIN_LOCK_FAILURES_PER_HOUR locks the
 * login for LOGIN_LOCK_MINUTES (existing sessions keep working). A success records nothing (no tracking of the owner).
 * Never throws: a write problem must not break the login itself.
 */
export function recordLoginOutcome(ok: boolean, nowMs: number, root: string = process.cwd()): { readonly lockedNow: boolean } {
  if (ok) return { lockedNow: false };
  try {
    const state = readLoginState(root);
    const nowIso = new Date(nowMs).toISOString();
    const failures = [...state.failures.filter((t) => nowMs - Date.parse(t) < DAY_MS), nowIso].slice(-MAX_FAILURES_KEPT);
    const lastHour = failures.filter((t) => nowMs - Date.parse(t) < HOUR_MS).length;
    const alreadyLocked = state.lockedUntil !== null && Date.parse(state.lockedUntil) > nowMs;
    const liftedRecently = state.liftedAt !== undefined && nowMs - Date.parse(state.liftedAt) < HOUR_MS;
    // After the owner lifts a lock, only failures after the lift count toward a new one.
    const counted = liftedRecently ? failures.filter((t) => Date.parse(t) > Date.parse(state.liftedAt as string)).filter((t) => nowMs - Date.parse(t) < HOUR_MS).length : lastHour;
    const lockNow = !alreadyLocked && counted >= LOGIN_LOCK_FAILURES_PER_HOUR;
    const locks = [...state.locks.filter((t) => nowMs - Date.parse(t) < DAY_MS), ...(lockNow ? [nowIso] : [])];
    writeJsonAtomic(loginStateFile(root), {
      schemaVersion: 1, failures, locks,
      lockedUntil: lockNow ? new Date(nowMs + LOGIN_LOCK_MINUTES * 60_000).toISOString() : state.lockedUntil,
      ...(state.liftedAt ? { liftedAt: state.liftedAt } : {}),
    } satisfies LoginState);
    return { lockedNow: lockNow };
  } catch {
    return { lockedNow: false };
  }
}

/** The owner lifts the lock (Güvenlik panel). Returns whether a lock was active. */
export function liftLoginLock(nowMs: number, root: string = process.cwd()): boolean {
  const state = readLoginState(root);
  const active = state.lockedUntil !== null && Date.parse(state.lockedUntil) > nowMs;
  writeJsonAtomic(loginStateFile(root), { ...state, lockedUntil: null, liftedAt: new Date(nowMs).toISOString() } satisfies LoginState);
  return active;
}

/** What the watcher reports about the login (counts only). */
export function readLoginFacts(nowMs: number, root: string = process.cwd()): LoginFacts {
  const state = readLoginState(root);
  const recent = state.failures.filter((t) => nowMs - Date.parse(t) < DAY_MS);
  return {
    failuresLastHour: recent.filter((t) => nowMs - Date.parse(t) < HOUR_MS).length,
    failuresLastDay: recent.length,
    lastFailureAt: recent.at(-1) ?? null,
    lockedUntil: state.lockedUntil && Date.parse(state.lockedUntil) > nowMs ? state.lockedUntil : null,
    locksLastDay: state.locks.filter((t) => nowMs - Date.parse(t) < DAY_MS).length,
  };
}

export interface SecurityWatchView {
  readonly report: SecurityWatchReport | null;
  /** Set when the report could not be read (shown as such, never as clean). */
  readonly error?: string;
  readonly cases: readonly SecurityCase[];
  readonly lockedUntil: string | null;
}

/** What the Güvenlik panel shows: the latest report, the newest cases and the login lock. Read-only. */
export function loadSecurityWatchView(nowMs: number, root: string = process.cwd()): SecurityWatchView {
  let report: SecurityWatchReport | null = null;
  let error: string | undefined;
  try { report = readSecurityWatchReport(root); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  let cases: readonly SecurityCase[] = [];
  try { cases = readSecurityCases(12, root); } catch (e) { error = error ?? (e instanceof Error ? e.message : String(e)); }
  return { report, ...(error ? { error } : {}), cases, lockedUntil: loginLockedUntil(nowMs, root) };
}
