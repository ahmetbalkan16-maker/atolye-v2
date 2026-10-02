/**
 * Stage 15R — the global SAFE_READ_ONLY mode, read side.
 *
 * The mode is the last event of one append-only, hash-chained event log
 * under this checkout's ignored `data/brain/execution/safe-mode`. An ENTER
 * turns the mode on, an EXIT turns it off, and nothing else is a state.
 * The files survive a restart; no process holds the mode in memory.
 *
 * Public verification only: this module imports no session, no writer and
 * no approval authority. It fails closed — a log that cannot be read or
 * does not verify is UNAVAILABLE, and every consumer treats UNAVAILABLE
 * exactly like SAFE_READ_ONLY. Only a log that is verifiably absent, or
 * whose last verified event is an owner EXIT, reads NORMAL.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const AYAS_SAFE_MODE_MAX_EVENTS = 10_000;
export type AyasSafeModeActor = "OWNER_SESSION" | "LOCAL_OPERATOR";
export interface AyasSafeModeHealthCheck { readonly id: string; readonly ok: boolean; readonly code: string }
export interface AyasSafeModeEvent {
  readonly schemaVersion: "1"; readonly sequence: number; readonly event: "ENTER" | "EXIT"; readonly at: string;
  readonly actor: AyasSafeModeActor; readonly previousDigest: string | null;
  /** EXIT only: the health checks that all passed when the owner left the mode. */
  readonly healthChecks: readonly AyasSafeModeHealthCheck[] | null;
}
export type AyasSafeModeState =
  | { readonly state: "NORMAL"; readonly sequence: number; readonly lastDigest: string | null; readonly exitedAt: string | null }
  | { readonly state: "SAFE_READ_ONLY"; readonly sequence: number; readonly lastDigest: string; readonly enteredAt: string; readonly actor: AyasSafeModeActor }
  | { readonly state: "UNAVAILABLE"; readonly reason: string };

/** Same convention as the other gate roots. A TEMP clone resolves its own root. */
export function resolveAyasSafeModeRoot(repoRoot: string = process.cwd()): string {
  return path.join(path.resolve(repoRoot), "data", "brain", "execution", "safe-mode");
}
export const ayasSafeModeEventFile = (sequence: number): string => `${String(sequence).padStart(6, "0")}.json`;
export const ayasSafeModeDigest = (bytes: string): string => crypto.createHash("sha256").update(bytes, "utf8").digest("hex");

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const CODE = /^[A-Za-z0-9_.:-]{1,80}$/;
export function isAyasSafeModeEvent(raw: unknown): raw is AyasSafeModeEvent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const v = raw as Record<string, unknown>;
  if (!exactKeys(v, ["schemaVersion", "sequence", "event", "at", "actor", "previousDigest", "healthChecks"]) || v.schemaVersion !== "1"
    || !Number.isSafeInteger(v.sequence) || (v.sequence as number) < 1 || (v.sequence as number) > AYAS_SAFE_MODE_MAX_EVENTS
    || (v.event !== "ENTER" && v.event !== "EXIT") || typeof v.at !== "string" || !Number.isFinite(Date.parse(v.at))
    || (v.actor !== "OWNER_SESSION" && v.actor !== "LOCAL_OPERATOR")
    || (v.sequence === 1 ? v.previousDigest !== null : typeof v.previousDigest !== "string" || !/^[a-f0-9]{64}$/.test(v.previousDigest))) return false;
  if (v.event === "ENTER") return v.healthChecks === null;
  // Only the owner leaves the mode, and only with every current health check passing.
  const checks = v.healthChecks;
  return v.actor === "OWNER_SESSION" && Array.isArray(checks) && checks.length >= 1 && checks.length <= 16
    && checks.every((check: unknown) => !!check && typeof check === "object" && !Array.isArray(check) && exactKeys(check as Record<string, unknown>, ["id", "ok", "code"])
      && typeof (check as AyasSafeModeHealthCheck).id === "string" && CODE.test((check as AyasSafeModeHealthCheck).id)
      && (check as AyasSafeModeHealthCheck).ok === true && typeof (check as AyasSafeModeHealthCheck).code === "string" && CODE.test((check as AyasSafeModeHealthCheck).code));
}

const unavailable = (reason: string): AyasSafeModeState => Object.freeze({ state: "UNAVAILABLE", reason });

/** The current mode. Never throws and never writes. */
export function readAyasSafeMode(repoRoot: string = process.cwd()): AyasSafeModeState {
  try {
    const root = resolveAyasSafeModeRoot(repoRoot);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(root); }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? Object.freeze({ state: "NORMAL", sequence: 0, lastDigest: null, exitedAt: null }) : unavailable("SAFE_MODE_STORE_UNREADABLE"); }
    if (stat.isSymbolicLink() || !stat.isDirectory()) return unavailable("SAFE_MODE_STORE_NOT_A_DIRECTORY");
    // A dot-prefixed name is a writer's unpublished temp file. Anything else in this directory must be an event.
    const names = fs.readdirSync(root).filter((name) => !name.startsWith(".")).sort();
    if (names.length > AYAS_SAFE_MODE_MAX_EVENTS) return unavailable("SAFE_MODE_STORE_TOO_LARGE");
    let previousDigest: string | null = null, last: AyasSafeModeEvent | undefined;
    for (const [index, name] of names.entries()) {
      if (name !== ayasSafeModeEventFile(index + 1)) return unavailable("SAFE_MODE_CHAIN_GAP_OR_UNEXPECTED_ENTRY");
      const bytes = fs.readFileSync(path.join(root, name), "utf8");
      let event: unknown;
      try { event = JSON.parse(bytes); } catch { return unavailable("SAFE_MODE_EVENT_MALFORMED"); }
      if (!isAyasSafeModeEvent(event) || event.sequence !== index + 1) return unavailable("SAFE_MODE_EVENT_INVALID");
      if (event.previousDigest !== previousDigest) return unavailable("SAFE_MODE_CHAIN_BROKEN");
      // The log alternates: only ENTER follows NORMAL, only EXIT follows SAFE_READ_ONLY.
      if (event.event !== (last === undefined || last.event === "EXIT" ? "ENTER" : "EXIT")) return unavailable("SAFE_MODE_CHAIN_ORDER_INVALID");
      previousDigest = ayasSafeModeDigest(bytes); last = event;
    }
    if (!last) return Object.freeze({ state: "NORMAL", sequence: 0, lastDigest: null, exitedAt: null });
    return last.event === "ENTER"
      ? Object.freeze({ state: "SAFE_READ_ONLY", sequence: last.sequence, lastDigest: previousDigest!, enteredAt: last.at, actor: last.actor })
      : Object.freeze({ state: "NORMAL", sequence: last.sequence, lastDigest: previousDigest, exitedAt: last.at });
  } catch { return unavailable("SAFE_MODE_STORE_UNREADABLE"); }
}

/**
 * The reason a non-read effect is refused now, or undefined in NORMAL. Chat, status and read-only work never ask:
 * they stay allowed in every state.
 */
export function ayasSafeModeRefusal(state: AyasSafeModeState): "AYAS_SAFE_READ_ONLY" | "AYAS_SAFE_MODE_UNAVAILABLE" | undefined {
  return state.state === "NORMAL" ? undefined : state.state === "SAFE_READ_ONLY" ? "AYAS_SAFE_READ_ONLY" : "AYAS_SAFE_MODE_UNAVAILABLE";
}

/** The refusal for this checkout right now: what a caller that is about to do more than read asks first. */
export function ayasSafeModeHold(repoRoot: string = process.cwd()): "AYAS_SAFE_READ_ONLY" | "AYAS_SAFE_MODE_UNAVAILABLE" | undefined {
  return ayasSafeModeRefusal(readAyasSafeMode(repoRoot));
}

/** The message is the code, like the other gates' errors, so a caller that reports `error.message` reports the reason. */
export class AyasSafeModeBlockedError extends Error {
  constructor(readonly code: "AYAS_SAFE_READ_ONLY" | "AYAS_SAFE_MODE_UNAVAILABLE") { super(code); this.name = "AyasSafeModeBlockedError"; this.stack = undefined; }
}
/** Throws for anything that is not a read while the mode holds. Call it before the first effect. */
export function assertAyasSafeModeAllowsMutation(repoRoot: string = process.cwd()): void {
  const refusal = ayasSafeModeHold(repoRoot);
  if (refusal) throw new AyasSafeModeBlockedError(refusal);
}
