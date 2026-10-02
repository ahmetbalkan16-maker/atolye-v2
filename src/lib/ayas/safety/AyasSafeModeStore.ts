/**
 * Stage 15R — the global SAFE_READ_ONLY mode, write side.
 *
 * Entering only tightens, so the owner page and an operator at the machine
 * may both enter. Leaving is the owner's alone: the session is taken from
 * the trusted cookie by the server action, verified here before anything
 * is interpreted, and verified again before the EXIT is written; every
 * current health check has to pass. No tool, model or discovery capability
 * reaches this module — its two importers are the owner action and the
 * operator CLI, and the CLI has no exit.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveAccessGate, verifySession } from "../../auth/accessGate";
import { AyasExecutionGateStore } from "../execution/AyasExecutionGateStore";
import { readAyasOwnerConstitution } from "../governance/AyasOwnerConstitutionReader";
import { guardAyasHeavyWorkload } from "../machine/AyasMachineHealthGuard";
import { readAyasResourceOccupancy, resolveAyasHostCapacityRoot } from "../machine/AyasResourceOccupancy";
import { ayasSafeModeEventFile, isAyasSafeModeEvent, readAyasSafeMode, resolveAyasSafeModeRoot, type AyasSafeModeActor, type AyasSafeModeEvent, type AyasSafeModeHealthCheck, type AyasSafeModeState } from "./AyasSafeModeReader";

type Env = Readonly<Record<string, string | undefined>>;
export class AyasSafeModeExitRefusedError extends Error {
  constructor(readonly code: "AYAS_SAFE_MODE_HEALTH_CHECK_FAILED", readonly healthChecks: readonly AyasSafeModeHealthCheck[]) { super(code); this.name = "AyasSafeModeExitRefusedError"; this.stack = undefined; }
}

/** Exclusive, durable publication: temp file, fsync, hard link. A second writer of the same sequence loses. */
function appendEvent(root: string, event: AyasSafeModeEvent): void {
  if (!isAyasSafeModeEvent(event)) throw new Error("AYAS_SAFE_MODE_EVENT_INVALID");
  fs.mkdirSync(root, { recursive: true });
  const temp = path.join(root, `.pending-${crypto.randomUUID()}`);
  const fd = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(event, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.linkSync(temp, path.join(root, ayasSafeModeEventFile(event.sequence))); }
  catch { throw new Error("AYAS_SAFE_MODE_CONCURRENT_CHANGE"); }
  finally { fs.rmSync(temp, { force: true }); }
}

async function ownerSessionValid(ownerSession: string | undefined, env: Env, nowMs: number): Promise<boolean> {
  const gate = resolveAccessGate(env);
  // disabled-dev is not owner authority.
  return gate.mode === "enforced" && !!gate.key && await verifySession(ownerSession, gate.key, nowMs);
}

/**
 * Turns the mode on. Idempotent: an active or unreadable mode already holds and nothing is written.
 * The actor is derived here from the verified session, never taken from the caller.
 */
export async function enterAyasSafeMode(input: { readonly repoRoot: string; readonly ownerSession?: string; readonly env?: Env; readonly nowMs?: () => number }): Promise<AyasSafeModeState> {
  const now = input.nowMs ?? Date.now;
  const actor: AyasSafeModeActor = await ownerSessionValid(input.ownerSession, input.env ?? process.env, now()) ? "OWNER_SESSION" : "LOCAL_OPERATOR";
  const current = readAyasSafeMode(input.repoRoot);
  if (current.state !== "NORMAL") return current;
  try {
    appendEvent(resolveAyasSafeModeRoot(input.repoRoot), { schemaVersion: "1", sequence: current.sequence + 1, event: "ENTER", at: new Date(now()).toISOString(), actor, previousDigest: current.lastDigest, healthChecks: null });
  } catch (error) {
    // Someone else entered at the same moment: the mode holds either way. Anything else is a real failure.
    if (!(error instanceof Error) || error.message !== "AYAS_SAFE_MODE_CONCURRENT_CHANGE") throw error;
  }
  const after = readAyasSafeMode(input.repoRoot);
  if (after.state === "NORMAL") throw new Error("AYAS_SAFE_MODE_ENTER_UNVERIFIED");
  return after;
}

/** What "current health" means at exit. Read-only; each line is a fact of this moment, not a stored verdict. */
export async function collectAyasSafeModeExitHealth(repoRoot: string): Promise<readonly AyasSafeModeHealthCheck[]> {
  const check = async (id: string, read: () => Promise<{ readonly ok: boolean; readonly code: string }> | { readonly ok: boolean; readonly code: string }): Promise<AyasSafeModeHealthCheck> => {
    try { const result = await read(); return { id, ok: result.ok === true, code: result.code }; } catch { return { id, ok: false, code: "CHECK_FAILED" }; }
  };
  const gate = (rootDir: string) => { const read = new AyasExecutionGateStore({ rootDir }).readStateFailClosed(); return { ok: !read.degraded && read.state === "CLOSED", code: read.degraded ? "GATE_UNREADABLE" : `GATE_${read.state}` }; };
  return [
    await check("owner-constitution", () => { const state = readAyasOwnerConstitution(repoRoot).state; return { ok: state !== "UNAVAILABLE", code: `CONSTITUTION_${state}` }; }),
    await check("execution-gate", () => gate(path.join(repoRoot, "data", "brain"))),
    await check("self-improvement-gate", () => gate(path.join(repoRoot, "data", "brain", "self-improvement"))),
    await check("machine-health", async () => { const health = await guardAyasHeavyWorkload({ stage: "script", ownedActive: false }); return { ok: health.mayStart, code: health.reasonCode }; }),
    await check("resource-occupancy", async () => { const occupancy = await readAyasResourceOccupancy(resolveAyasHostCapacityRoot(repoRoot)); return { ok: occupancy !== null, code: occupancy ? "INVENTORY_READ" : "INVENTORY_UNREADABLE" }; }),
  ];
}

/**
 * Leaves the mode. Owner server action only: `ownerSession` comes from the trusted cookie, never from a
 * model, tool, form field or request body. Refused unless the mode is verifiably active and every health
 * check passes now.
 */
export async function exitAyasSafeMode(input: {
  readonly repoRoot: string; readonly ownerSession: string | undefined; readonly env?: Env; readonly nowMs?: () => number;
  /** Trusted server/test code only. */
  readonly health?: (repoRoot: string) => Promise<readonly AyasSafeModeHealthCheck[]>;
}): Promise<AyasSafeModeState> {
  const env = input.env ?? process.env; const now = input.nowMs ?? Date.now;
  const requireOwner = async (): Promise<void> => { if (!await ownerSessionValid(input.ownerSession, env, now())) throw new Error("AYAS_SAFE_MODE_OWNER_SESSION_REQUIRED"); };
  await requireOwner(); // before the store is read or anything is interpreted
  const current = readAyasSafeMode(input.repoRoot);
  if (current.state === "NORMAL") throw new Error("AYAS_SAFE_MODE_NOT_ACTIVE");
  if (current.state === "UNAVAILABLE") throw new Error("AYAS_SAFE_MODE_STORE_UNAVAILABLE"); // a log that does not verify is inspected by the owner, not appended to
  const healthChecks = (await (input.health ?? collectAyasSafeModeExitHealth)(input.repoRoot)).map((check) => ({ id: check.id, ok: check.ok === true, code: check.code }));
  if (healthChecks.length === 0 || healthChecks.some((check) => !check.ok)) throw new AyasSafeModeExitRefusedError("AYAS_SAFE_MODE_HEALTH_CHECK_FAILED", Object.freeze(healthChecks));
  await requireOwner(); // the checks awaited; the session may have expired meanwhile
  const latest = readAyasSafeMode(input.repoRoot);
  if (latest.state !== "SAFE_READ_ONLY" || latest.sequence !== current.sequence || latest.lastDigest !== current.lastDigest) throw new Error("AYAS_SAFE_MODE_CONCURRENT_CHANGE");
  appendEvent(resolveAyasSafeModeRoot(input.repoRoot), { schemaVersion: "1", sequence: latest.sequence + 1, event: "EXIT", at: new Date(now()).toISOString(), actor: "OWNER_SESSION", previousDigest: latest.lastDigest, healthChecks });
  const after = readAyasSafeMode(input.repoRoot);
  if (after.state !== "NORMAL" || after.sequence !== latest.sequence + 1) throw new Error("AYAS_SAFE_MODE_EXIT_UNVERIFIED");
  return after;
}
