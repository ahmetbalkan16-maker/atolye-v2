/** Durable diagnostic metadata only. Append-only; no proposal decision, execution or external transport. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureSafeContainedDirectory, requireContainedRealDirectory } from "../../runtime/RuntimeStoragePaths";
import { resolveAccessGate, verifySession } from "../../auth/accessGate";
import { assertAyasSafeModeAllowsMutation } from "../safety/AyasSafeModeReader";
import { canonicalAyasJson } from "../provenance/AyasReleaseProvenance";
import { alertDigest, assertAyasExecutiveAlertState, emptyAyasExecutiveAlerts, observeAyasExecutiveSignals, updateAyasExecutiveAlert,
  type AyasExecutiveAlertState, type AyasExecutiveSignal, type AyasBriefingDomain } from "./AyasExecutiveAlerts";
export type AyasExecutiveAlertRead = { readonly status: "MISSING" | "VERIFIED"; readonly sequence: number; readonly digest: string | null; readonly state: AyasExecutiveAlertState }
  | { readonly status: "UNAVAILABLE"; readonly reason: "ALERT_HISTORY_UNVERIFIABLE" };
const FILE = /^[0-9]{6}\.json$/;
const rootPath = (root: string) => path.join(root, "data", "brain", "execution", "owner-alerts");
export function readAyasExecutiveAlerts(repoRoot: string): AyasExecutiveAlertRead {
  try {
    const root = fs.realpathSync.native(repoRoot), dir = rootPath(root);
    for (const part of ["data", "data/brain", "data/brain/execution", "data/brain/execution/owner-alerts"]) {
      const target = path.join(root, part);
      try { fs.lstatSync(target); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { status: "MISSING", sequence: 0, digest: null, state: emptyAyasExecutiveAlerts() }; throw e; }
      requireContainedRealDirectory(root, target);
    }
    const names = fs.readdirSync(dir).filter(n => !/^\.pending-[a-f0-9-]+$/.test(n)).sort();
    if (names.length > 10_000 || names.some(n => !FILE.test(n))) throw new Error("INVALID");
    let state = emptyAyasExecutiveAlerts(), previous: string | null = null, bytes = 0; const deadline = Date.now() + 1500;
    for (const [i, name] of names.entries()) {
      if (name !== String(i+1).padStart(6,"0") + ".json" || Date.now() >= deadline) throw new Error("INVALID");
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024*1024 || (bytes += stat.size) > 16*1024*1024) throw new Error("INVALID");
      const e: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!e || typeof e !== "object" || Array.isArray(e)) throw new Error("INVALID");
      const v = e as Record<string, unknown>;
      if (Object.keys(v).sort().join("|") !== ["schemaVersion","sequence","operation","actor","at","previousDigest","state","stateDigest","digest"].sort().join("|")
        || v.schemaVersion !== "1" || v.sequence !== i+1 || !["OBSERVE","ACKNOWLEDGE","DELIVERED"].includes(String(v.operation))
        || v.actor !== (v.operation === "OBSERVE" ? "LOCAL_DIAGNOSTIC" : "OWNER_SESSION") || v.previousDigest !== previous
        || typeof v.at !== "string" || !Number.isFinite(Date.parse(v.at)) || new Date(v.at).toISOString() !== v.at
        || (state.changedAt !== null && v.at < state.changedAt)) throw new Error("INVALID");
      assertAyasExecutiveAlertState(v.state);
      const { digest, ...body } = v;
      if (v.stateDigest !== alertDigest(v.state) || digest !== alertDigest(body) || v.state.changedAt !== v.at) throw new Error("INVALID");
      state = v.state; previous = digest as string;
    }
    return { status: names.length ? "VERIFIED" : "MISSING", sequence: names.length, digest: previous, state };
  } catch { return { status: "UNAVAILABLE", reason: "ALERT_HISTORY_UNVERIFIABLE" }; }
}
function append(repoRoot: string, current: Exclude<AyasExecutiveAlertRead, { status: "UNAVAILABLE" }>, state: AyasExecutiveAlertState, operation: "OBSERVE" | "ACKNOWLEDGE" | "DELIVERED", at: string) {
  if (canonicalAyasJson(state) === canonicalAyasJson(current.state)) return current;
  assertAyasSafeModeAllowsMutation(repoRoot); assertAyasExecutiveAlertState(state);
  const latest = readAyasExecutiveAlerts(repoRoot);
  if (latest.status === "UNAVAILABLE" || latest.digest !== current.digest || latest.sequence !== current.sequence) throw new Error("AYAS_BRIEFING_CONTENDED");
  const dir = ensureSafeContainedDirectory(fs.realpathSync.native(repoRoot), rootPath(fs.realpathSync.native(repoRoot)));
  const sequence = current.sequence+1;
  if (sequence > 10_000) throw new Error("AYAS_BRIEFING_HISTORY_FULL");
  const body = { schemaVersion: "1", sequence, operation, actor: operation === "OBSERVE" ? "LOCAL_DIAGNOSTIC" : "OWNER_SESSION",
    at, previousDigest: current.digest, state, stateDigest: alertDigest(state) };
  const record = { ...body, digest: alertDigest(body) }, text = canonicalAyasJson(record);
  if (Buffer.byteLength(text) > 1024*1024) throw new Error("AYAS_BRIEFING_HISTORY_FULL");
  const pending = path.join(dir, ".pending-" + randomUUID()); let fd: number | undefined;
  try {
    fd = fs.openSync(pending, "wx", 0o600); fs.writeFileSync(fd, text); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    assertAyasSafeModeAllowsMutation(repoRoot); fs.linkSync(pending, path.join(dir, String(sequence).padStart(6,"0") + ".json"));
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
  const at = new Date(now()).toISOString(), state = updateAyasExecutiveAlert(current.state,{ operation: input.operation, alertId: input.alertId, fingerprint: input.fingerprint, at, cooldownMs: input.cooldownMs ?? 3_600_000 });
  await owner(); return append(input.repoRoot,current,state,input.operation,at);
}
