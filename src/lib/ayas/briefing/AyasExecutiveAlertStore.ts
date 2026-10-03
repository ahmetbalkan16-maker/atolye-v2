/**
 * Stage 15T — owner alert metadata, durable side.
 *
 * Append-only, hash-chained records under the ignored
 * `data/brain/execution/owner-alerts`, written with exclusive create and
 * re-read after the write. Each record holds the whole alert state, so a read
 * verifies a bounded window: the last AYAS_EXECUTIVE_ALERT_WINDOW records,
 * chained to the self-verifying record just before them. File numbering is
 * checked for the whole history on every read; `verifyAyasExecutiveAlertHistory`
 * replays every record (operator use).
 *
 * Diagnostic metadata only: no proposal decision, execution or external
 * transport. Writes respect SAFE_READ_ONLY; owner operations need a verified
 * owner session. Anything unverifiable reads UNAVAILABLE, never empty.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureSafeContainedDirectory, requireContainedRealDirectory } from "../../runtime/RuntimeStoragePaths";
import { resolveAccessGate, verifySession } from "../../auth/accessGate";
import { assertAyasSafeModeAllowsMutation } from "../safety/AyasSafeModeReader";
import { canonicalAyasJson } from "../provenance/AyasReleaseProvenance";
import { alertDigest, assertAyasExecutiveAlertState, emptyAyasExecutiveAlerts, observeAyasExecutiveSignals, updateAyasExecutiveAlert, AYAS_EXECUTIVE_COOLDOWN_MS,
  type AyasExecutiveAlertState, type AyasExecutiveSignal, type AyasBriefingDomain } from "./AyasExecutiveAlerts";
export type AyasExecutiveAlertRead = { readonly status: "MISSING" | "VERIFIED"; readonly sequence: number; readonly digest: string | null; readonly state: AyasExecutiveAlertState }
  | { readonly status: "UNAVAILABLE"; readonly reason: "ALERT_HISTORY_UNVERIFIABLE" };
export const AYAS_EXECUTIVE_ALERT_WINDOW = 64;
export const AYAS_EXECUTIVE_ALERT_MAX_RECORDS = 100_000;
const FILE = /^[0-9]{6}\.json$/, PENDING = /^\.pending-[a-f0-9-]+$/;
const RECORD_KEYS = ["schemaVersion","sequence","operation","actor","at","previousDigest","state","stateDigest","digest"].sort().join("|");
const recordName = (sequence: number) => String(sequence).padStart(6,"0") + ".json";
const rootPath = (root: string) => path.join(root, "data", "brain", "execution", "owner-alerts");
type StoredRecord = { readonly sequence: number; readonly at: string; readonly previousDigest: string | null; readonly state: AyasExecutiveAlertState; readonly digest: string };
function invalid(): never { throw new Error("INVALID"); }
/** One record checked on its own: shape, sequence, actor, state, state digest and record digest. The chain link is the caller's. */
function loadRecord(dir: string, sequence: number): StoredRecord & { readonly size: number } {
  const file = path.join(dir, recordName(sequence)), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024*1024) invalid();
  const e: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!e || typeof e !== "object" || Array.isArray(e)) invalid();
  const v = e as Record<string, unknown>;
  if (Object.keys(v).sort().join("|") !== RECORD_KEYS || v.schemaVersion !== "1" || v.sequence !== sequence
    || !["OBSERVE","ACKNOWLEDGE","DELIVERED"].includes(String(v.operation)) || v.actor !== (v.operation === "OBSERVE" ? "LOCAL_DIAGNOSTIC" : "OWNER_SESSION")
    || typeof v.at !== "string" || !Number.isFinite(Date.parse(v.at)) || new Date(v.at).toISOString() !== v.at) invalid();
  assertAyasExecutiveAlertState(v.state);
  const { digest, ...body } = v;
  if (v.stateDigest !== alertDigest(v.state) || digest !== alertDigest(body) || v.state.changedAt !== v.at) invalid();
  return { sequence, at: v.at, previousDigest: v.previousDigest as string | null, state: v.state, digest: digest as string, size: stat.size };
}
function readHistory(repoRoot: string, full: boolean): AyasExecutiveAlertRead {
  try {
    const root = fs.realpathSync.native(repoRoot), dir = rootPath(root);
    for (const part of ["data", "data/brain", "data/brain/execution", "data/brain/execution/owner-alerts"]) {
      const target = path.join(root, part);
      try { fs.lstatSync(target); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { status: "MISSING", sequence: 0, digest: null, state: emptyAyasExecutiveAlerts() }; throw e; }
      requireContainedRealDirectory(root, target);
    }
    const names = fs.readdirSync(dir).filter(n => !PENDING.test(n)).sort();
    // n distinct six-digit names whose lowest is 1 and highest is n are exactly 1..n:
    // a record outside the verified window can be neither removed nor replaced.
    if (names.length > AYAS_EXECUTIVE_ALERT_MAX_RECORDS || names.some(n => !FILE.test(n))
      || (names.length > 0 && (names[0] !== recordName(1) || names[names.length - 1] !== recordName(names.length)))) invalid();
    if (!names.length) return { status: "MISSING", sequence: 0, digest: null, state: emptyAyasExecutiveAlerts() };
    const first = full ? 1 : Math.max(1, names.length - AYAS_EXECUTIVE_ALERT_WINDOW + 1), deadline = full ? Infinity : Date.now() + 1500;
    let state = emptyAyasExecutiveAlerts(), previous: string | null = null, floor: string | null = null, bytes = 0;
    if (first > 1) { const anchor = loadRecord(dir, first - 1); previous = anchor.digest; floor = anchor.at; state = anchor.state; }
    for (let sequence = first; sequence <= names.length; sequence++) {
      if (Date.now() >= deadline) invalid();
      const r = loadRecord(dir, sequence);
      if ((bytes += r.size) > 16*1024*1024 && !full) invalid();
      if (r.previousDigest !== previous || (floor !== null && r.at < floor)) invalid();
      state = r.state; previous = r.digest; floor = r.at;
    }
    return { status: "VERIFIED", sequence: names.length, digest: previous, state };
  } catch { return { status: "UNAVAILABLE", reason: "ALERT_HISTORY_UNVERIFIABLE" }; }
}
/** Bounded read used by the briefing, the operator status and every write. */
export function readAyasExecutiveAlerts(repoRoot: string): AyasExecutiveAlertRead { return readHistory(repoRoot, false); }
/** Operator check: replays the whole chain. Not used on the request path. */
export function verifyAyasExecutiveAlertHistory(repoRoot: string): AyasExecutiveAlertRead { return readHistory(repoRoot, true); }
function append(repoRoot: string, current: Exclude<AyasExecutiveAlertRead, { status: "UNAVAILABLE" }>, state: AyasExecutiveAlertState, operation: "OBSERVE" | "ACKNOWLEDGE" | "DELIVERED", at: string) {
  if (canonicalAyasJson(state) === canonicalAyasJson(current.state)) return current;
  assertAyasSafeModeAllowsMutation(repoRoot); assertAyasExecutiveAlertState(state);
  const latest = readAyasExecutiveAlerts(repoRoot);
  if (latest.status === "UNAVAILABLE" || latest.digest !== current.digest || latest.sequence !== current.sequence) throw new Error("AYAS_BRIEFING_CONTENDED");
  const dir = ensureSafeContainedDirectory(fs.realpathSync.native(repoRoot), rootPath(fs.realpathSync.native(repoRoot)));
  const sequence = current.sequence+1;
  if (sequence > AYAS_EXECUTIVE_ALERT_MAX_RECORDS) throw new Error("AYAS_BRIEFING_HISTORY_FULL");
  const body = { schemaVersion: "1", sequence, operation, actor: operation === "OBSERVE" ? "LOCAL_DIAGNOSTIC" : "OWNER_SESSION",
    at, previousDigest: current.digest, state, stateDigest: alertDigest(state) };
  const record = { ...body, digest: alertDigest(body) }, text = canonicalAyasJson(record);
  if (Buffer.byteLength(text) > 1024*1024) throw new Error("AYAS_BRIEFING_HISTORY_FULL");
  const pending = path.join(dir, ".pending-" + randomUUID()); let fd: number | undefined;
  try {
    fd = fs.openSync(pending, "wx", 0o600); fs.writeFileSync(fd, text); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    assertAyasSafeModeAllowsMutation(repoRoot); fs.linkSync(pending, path.join(dir, recordName(sequence)));
  } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(pending)) fs.unlinkSync(pending); }
  const after = readAyasExecutiveAlerts(repoRoot);
  if (after.status !== "VERIFIED" || after.digest !== record.digest) throw new Error("AYAS_BRIEFING_PERSISTENCE_UNVERIFIED");
  return after;
}
export function observeDurableAyasExecutiveSignals(input: { readonly repoRoot: string; readonly signals: readonly AyasExecutiveSignal[]; readonly covered: readonly AyasBriefingDomain[]; readonly at: string }) {
  const current = readAyasExecutiveAlerts(input.repoRoot);
  if (current.status === "UNAVAILABLE") throw new Error("AYAS_BRIEFING_HISTORY_UNVERIFIABLE");
  return append(input.repoRoot, current, observeAyasExecutiveSignals(current.state,input.signals,input.covered,input.at), "OBSERVE", input.at);
}
export async function recordOwnerAyasExecutiveAlert(input: { readonly repoRoot: string; readonly operation: "ACKNOWLEDGE" | "DELIVERED"; readonly alertId: string; readonly fingerprint: string;
  readonly ownerSession: string | undefined; readonly env?: Readonly<Record<string,string|undefined>>; readonly nowMs?: () => number; readonly cooldownMs?: number }) {
  const env = input.env ?? process.env, now = input.nowMs ?? Date.now;
  const owner = async () => { const g = resolveAccessGate(env); if (g.mode !== "enforced" || !g.key || !await verifySession(input.ownerSession,g.key,now())) throw new Error("AYAS_BRIEFING_OWNER_SESSION_REQUIRED"); };
  await owner();
  const current = readAyasExecutiveAlerts(input.repoRoot);
  if (current.status === "UNAVAILABLE") throw new Error("AYAS_BRIEFING_HISTORY_UNVERIFIABLE");
  const at = new Date(now()).toISOString(), state = updateAyasExecutiveAlert(current.state,{ operation: input.operation, alertId: input.alertId, fingerprint: input.fingerprint, at, cooldownMs: input.cooldownMs ?? AYAS_EXECUTIVE_COOLDOWN_MS.default });
  await owner(); return append(input.repoRoot,current,state,input.operation,at);
}
