import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

import { createAyasApprovalInboxStore, type AyasApprovalInboxHandle, type AyasInboxProposalStatus } from "./AyasApprovalInboxStore";
import { isAyasAutonomousExecutionEnabled } from "./AyasAutonomousExecutionGate";
import { createAyasResearchSchedulerStateStore, type AyasResearchSchedulerStateStore } from "./AyasResearchSchedulerStateStore";

/**
 * AYAS RUNTIME STABILITY GUARD — Part A: the pre-change snapshot.
 *
 * The problem this exists for: until now, a "small" operational change (set
 * an env var, restart :3000, apply a SAFE proposal) had no single place that
 * recorded what the rest of the system looked like immediately before it. So
 * "did this change break something unrelated?" could only ever be answered by
 * hand, after the fact, from memory. This module answers it mechanically: one
 * cheap, read-only capture of every invariant a controlled operation is
 * expected to leave alone, taken before and after, and diffed
 * (`AyasRuntimeStabilityScope.ts`).
 *
 * Deliberately a pure reader. It never starts, stops, decides, approves,
 * reserves, or executes anything, and it reuses the existing authoritative
 * readers (`AyasApprovalInboxStore`, `AyasResearchSchedulerStateStore`,
 * `isAyasAutonomousExecutionEnabled`) rather than re-deriving their state —
 * a second, drifting view of "is the gate on" is exactly the class of bug
 * this sprint exists to prevent.
 *
 * Secret discipline: this snapshot is durably persisted inside transaction
 * records, so it must never carry a raw credential. Environment variables are
 * recorded as NAME + set/unset + a salted fingerprint of the value, never the
 * value itself. The one exception is a variable in `SAFE_LITERAL_ENV_VARS`,
 * whose entire domain is a non-secret boolean-ish flag (e.g. "1"/unset) and
 * whose literal value is what makes the snapshot diagnostically useful.
 */
export const ayasRuntimeStabilitySnapshotSchemaVersion = "1" as const;

/** Env vars whose values are non-secret by construction and safe to record literally. */
const SAFE_LITERAL_ENV_VARS = new Set(["AYAS_AUTONOMOUS_EXECUTION_ENABLED", "AYAS_RESEARCH_SCHEDULER_ENABLED", "NODE_ENV"]);

/** Per-capture random salt: fingerprints are comparable WITHIN one guard run (before vs after), never across runs, so a persisted transaction record can never become an offline dictionary target for a short secret. */
export type AyasEnvFingerprintSalt = string;

export interface AyasEnvVarSnapshot {
  readonly name: string;
  readonly set: boolean;
  /** Present only for `SAFE_LITERAL_ENV_VARS`. */
  readonly literalValue?: string;
  /** `sha256(salt + value)`, truncated. Absent when unset. */
  readonly valueFingerprint?: string;
}

export interface AyasRepoSnapshot {
  readonly branch: string;
  readonly head: string;
  readonly clean: boolean;
  /** Count only — file names can leak in-flight work, and the count is all an invariant check needs. */
  readonly dirtyEntryCount: number;
}

export interface AyasServiceSnapshot {
  readonly port: number;
  readonly listening: boolean;
  readonly pid?: number;
  /** sha256 of the owning process's command line, truncated — proves "same process identity" without persisting a filesystem layout. */
  readonly commandFingerprint?: string;
}

export interface AyasGateSnapshot {
  readonly autonomousExecutionEnabled: boolean;
  /** Always true in this architecture — recorded so a regression that silently removed the owner step is visible as a diff, not as silence. */
  readonly ownerApprovalRequired: boolean;
}

export interface AyasSchedulerSnapshot {
  readonly nextLightAt?: string;
  readonly nextDeepAt?: string;
  readonly lastSuccessfulResearchAt?: string;
  readonly consecutiveFailures: number;
  readonly runInFlight: boolean;
  readonly stateFilePresent: boolean;
}

export interface AyasProposalStateSnapshot {
  readonly statusCounts: Readonly<Partial<Record<AyasInboxProposalStatus, number>>>;
  readonly pendingProposalIds: readonly string[];
  readonly approvedProposalIds: readonly string[];
  readonly decisionCount: number;
  readonly resultCount: number;
}

export interface AyasRuntimeStabilitySnapshot {
  readonly schemaVersion: typeof ayasRuntimeStabilitySnapshotSchemaVersion;
  readonly capturedAt: string;
  readonly repo: AyasRepoSnapshot;
  readonly services: readonly AyasServiceSnapshot[];
  readonly gate: AyasGateSnapshot;
  readonly scheduler: AyasSchedulerSnapshot;
  readonly proposals: AyasProposalStateSnapshot;
  readonly env: readonly AyasEnvVarSnapshot[];
  /** sha256 of the resolved runtime storage root, truncated — compared for equality, never rendered as a path. */
  readonly runtimeRootFingerprint?: string;
  /** Non-fatal capture problems (e.g. port probe unavailable). A health check treats an incomplete snapshot as fail-closed rather than "fine". */
  readonly gaps: readonly string[];
}

export interface AyasServicePortProbe {
  /** Returns the PID currently listening on `port`, or undefined when nothing is. */
  (port: number): number | undefined;
}

export interface AyasProcessCommandProbe {
  /** Returns the command line of `pid`, or undefined when the process is gone/unreadable. */
  (pid: number): string | undefined;
}

export interface AyasRuntimeStabilitySnapshotDeps {
  readonly repoRoot?: string;
  readonly now?: () => string;
  readonly env?: Record<string, string | undefined>;
  readonly inbox?: AyasApprovalInboxHandle;
  readonly schedulerStore?: AyasResearchSchedulerStateStore;
  readonly ports?: readonly number[];
  readonly portProbe?: AyasServicePortProbe;
  readonly commandProbe?: AyasProcessCommandProbe;
  readonly salt?: AyasEnvFingerprintSalt;
  /** Env var names to record (name + set/unset + fingerprint). */
  readonly trackedEnvVars?: readonly string[];
  /**
   * When false, the owning process's command line is NOT read, no
   * `commandFingerprint` is recorded — and, deliberately, no gap is recorded
   * either. Reserved for an operation whose declared impact class can never
   * restart or re-identify a service (see `AyasProposalRuntimeImpact`),
   * where port+pid continuity is the required proof and process-identity
   * fingerprinting is explicitly not applicable. Recording a gap for a check
   * that was correctly skipped would fail-close every such operation for no
   * safety gain, since `gaps` is itself a health failure. Defaults to true,
   * so the prove-everything posture stays the default and a caller has to
   * ask for the lighter one.
   */
  readonly probeCommandLine?: boolean;
}

const DEFAULT_TRACKED_ENV_VARS = ["AYAS_AUTONOMOUS_EXECUTION_ENABLED", "AYAS_RESEARCH_SCHEDULER_ENABLED", "ATOLYE_RUNTIME_ROOT", "NODE_ENV"] as const;

export function fingerprintAyasValue(value: string, salt: AyasEnvFingerprintSalt): string {
  return crypto.createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 16);
}

/**
 * Windows-first port→PID probe (this is a Windows-hosted studio), with a
 * POSIX fallback. Both are read-only and both fail soft: an unavailable
 * probe yields `undefined`, which the caller records as a gap and treats as
 * unproven ownership — never as "nothing is running there".
 */
export function defaultAyasPortProbe(port: number): number | undefined {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
      for (const line of out.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5 || parts[3] !== "LISTENING") continue;
        if (!localAddressMatchesPort(parts[1] ?? "", port)) continue;
        const pid = Number(parts[4]);
        if (Number.isInteger(pid) && pid > 0) return pid;
      }
      return undefined;
    }
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8", timeout: 15_000 });
    const pid = Number(out.split(/\r?\n/).find((line) => line.trim().length > 0));
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** `0.0.0.0:3000`, `[::]:3000` and `127.0.0.1:3000` all own port 3000; `[::]:31000` does not. */
function localAddressMatchesPort(localAddress: string, port: number): boolean {
  const separator = localAddress.lastIndexOf(":");
  return separator > 0 && localAddress.slice(separator + 1) === String(port);
}

export function defaultAyasCommandProbe(pid: number): string | undefined {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
      const line = out.trim();
      return line.length > 0 ? line : undefined;
    }
    const out = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", timeout: 15_000 });
    const line = out.trim();
    return line.length > 0 ? line : undefined;
  } catch {
    return undefined;
  }
}

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 30_000 }).trim();
}

export function captureAyasRuntimeStabilitySnapshot(deps: AyasRuntimeStabilitySnapshotDeps = {}): AyasRuntimeStabilitySnapshot {
  const repoRoot = deps.repoRoot ?? process.cwd();
  const env = deps.env ?? process.env;
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const salt = deps.salt ?? crypto.randomUUID();
  const gaps: string[] = [];

  let repo: AyasRepoSnapshot;
  try {
    const porcelain = git(repoRoot, ["status", "--porcelain"]);
    repo = {
      branch: git(repoRoot, ["branch", "--show-current"]),
      head: git(repoRoot, ["rev-parse", "HEAD"]),
      clean: porcelain.length === 0,
      dirtyEntryCount: porcelain.length === 0 ? 0 : porcelain.split(/\r?\n/).filter((line) => line.trim().length > 0).length,
    };
  } catch (error) {
    gaps.push(`repo snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
    repo = { branch: "", head: "", clean: false, dirtyEntryCount: -1 };
  }

  const portProbe = deps.portProbe ?? defaultAyasPortProbe;
  const commandProbe = deps.commandProbe ?? defaultAyasCommandProbe;
  const services: AyasServiceSnapshot[] = [];
  for (const port of deps.ports ?? []) {
    const pid = portProbe(port);
    if (pid === undefined) {
      services.push({ port, listening: false });
      continue;
    }
    const commandLine = deps.probeCommandLine === false ? undefined : commandProbe(pid);
    if (commandLine === undefined && deps.probeCommandLine !== false) gaps.push(`command line unreadable for pid ${pid} on port ${port}`);
    services.push({ port, listening: true, pid, ...(commandLine === undefined ? {} : { commandFingerprint: fingerprintAyasValue(commandLine, salt) }) });
  }

  let scheduler: AyasSchedulerSnapshot;
  try {
    const store = deps.schedulerStore ?? createAyasResearchSchedulerStateStore({ rootDir: undefined });
    const state = store.read();
    scheduler = {
      ...(state.nextLightAt === undefined ? {} : { nextLightAt: state.nextLightAt }),
      ...(state.nextDeepAt === undefined ? {} : { nextDeepAt: state.nextDeepAt }),
      ...(state.lastSuccessfulResearchAt === undefined ? {} : { lastSuccessfulResearchAt: state.lastSuccessfulResearchAt }),
      consecutiveFailures: state.consecutiveFailures,
      runInFlight: state.currentRunId !== undefined,
      stateFilePresent: state.nextLightAt !== undefined || state.nextDeepAt !== undefined || state.lastSuccessfulResearchAt !== undefined,
    };
  } catch (error) {
    gaps.push(`scheduler snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
    scheduler = { consecutiveFailures: -1, runInFlight: false, stateFilePresent: false };
  }

  let proposals: AyasProposalStateSnapshot;
  try {
    const inbox = deps.inbox ?? createAyasApprovalInboxStore();
    const state = inbox.load();
    const statusCounts: Partial<Record<AyasInboxProposalStatus, number>> = {};
    for (const proposal of state.proposals) statusCounts[proposal.status] = (statusCounts[proposal.status] ?? 0) + 1;
    proposals = {
      statusCounts,
      pendingProposalIds: state.proposals.filter((p) => p.status === "PENDING").map((p) => p.proposalId).sort(),
      approvedProposalIds: state.proposals.filter((p) => p.status === "APPROVED").map((p) => p.proposalId).sort(),
      decisionCount: state.decisions.length,
      resultCount: state.results.length,
    };
  } catch (error) {
    gaps.push(`proposal snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
    proposals = { statusCounts: {}, pendingProposalIds: [], approvedProposalIds: [], decisionCount: -1, resultCount: -1 };
  }

  const envSnapshot: AyasEnvVarSnapshot[] = [];
  for (const name of deps.trackedEnvVars ?? DEFAULT_TRACKED_ENV_VARS) {
    const value = env[name];
    if (value === undefined) {
      envSnapshot.push({ name, set: false });
      continue;
    }
    envSnapshot.push({
      name,
      set: true,
      ...(SAFE_LITERAL_ENV_VARS.has(name) ? { literalValue: value } : {}),
      valueFingerprint: fingerprintAyasValue(value, salt),
    });
  }

  const runtimeRoot = env.ATOLYE_RUNTIME_ROOT;

  return Object.freeze({
    schemaVersion: ayasRuntimeStabilitySnapshotSchemaVersion,
    capturedAt: now,
    repo,
    services,
    gate: { autonomousExecutionEnabled: isAyasAutonomousExecutionEnabled(env), ownerApprovalRequired: true },
    scheduler,
    proposals,
    env: envSnapshot,
    ...(runtimeRoot === undefined ? {} : { runtimeRootFingerprint: fingerprintAyasValue(runtimeRoot, salt) }),
    gaps,
  });
}
