import { defaultAyasCommandProbe, defaultAyasPortProbe, type AyasProcessCommandProbe, type AyasServicePortProbe } from "./AyasRuntimeStabilitySnapshot";

/**
 * AYAS RUNTIME STABILITY GUARD — Part F: single-service restart discipline.
 *
 * "Restart the dev server" is the single most dangerous routine operation in
 * this studio, because the obvious implementations are all wrong in the same
 * way: `taskkill /IM node.exe` kills every Node process on the machine,
 * killing "the pid I remember" kills whatever inherited that pid, and killing
 * "whatever is on the port" kills a colleague's unrelated listener that
 * happens to have bound it. Each of those has the same shape — terminating a
 * process whose identity was assumed rather than proven.
 *
 * So this module will not terminate anything until BOTH hold:
 *   1. the pid is, right now, the listener on the declared port, and
 *   2. its command line matches the caller's declared expectation.
 * If either cannot be established, it refuses and returns a reason. Refusing
 * to restart is always recoverable; killing the wrong process is not.
 */
export type AyasServiceRestartRefusalCode =
  | "PORT_NOT_LISTENING"
  | "PID_MISMATCH"
  | "COMMAND_UNREADABLE"
  | "COMMAND_FINGERPRINT_MISMATCH"
  | "TERMINATION_FAILED"
  | "RESTART_FAILED"
  | "PORT_NOT_RECLAIMED"
  | "COLLATERAL_PROCESS_LOST";

export interface AyasServiceOwnership {
  readonly port: number;
  readonly pid: number;
  readonly commandLine: string;
}

export interface AyasServiceRestartRequest {
  readonly port: number;
  /** When given, the listener must be exactly this pid — a cheap guard against the port having changed hands since the caller looked. */
  readonly expectedPid?: number;
  /** Substring the owning process's command line must contain (e.g. "next" + the repo path). Proves process identity without pinning a full command line that legitimately varies. */
  readonly expectedCommandContains: readonly string[];
  /** Pids that must still be alive afterwards — the unrelated-process invariant, checked rather than assumed. */
  readonly protectedPids?: readonly number[];
}

export interface AyasServiceRestartDeps {
  readonly portProbe?: AyasServicePortProbe;
  readonly commandProbe?: AyasProcessCommandProbe;
  readonly terminate?: (pid: number) => void;
  readonly start?: () => void;
  readonly isProcessAlive?: (pid: number) => boolean;
  /** Bounded wait for the port to come back. Injected so tests never sleep. */
  readonly waitForPort?: (port: number) => number | undefined;
}

export type AyasServiceRestartResult =
  | { readonly ok: true; readonly previous: AyasServiceOwnership; readonly newPid: number }
  | { readonly ok: false; readonly reasonCode: AyasServiceRestartRefusalCode; readonly detail: string; readonly terminated: boolean };

/**
 * Proves who owns a port before anyone is allowed to act on it. Returns
 * undefined rather than throwing when nothing is listening — "not running" is
 * a legitimate answer, not an error.
 */
export function resolveAyasServiceOwnership(port: number, deps: AyasServiceRestartDeps = {}): AyasServiceOwnership | undefined {
  const pid = (deps.portProbe ?? defaultAyasPortProbe)(port);
  if (pid === undefined) return undefined;
  const commandLine = (deps.commandProbe ?? defaultAyasCommandProbe)(pid);
  if (commandLine === undefined) return undefined;
  return Object.freeze({ port, pid, commandLine });
}

export function restartAyasOwnedService(request: AyasServiceRestartRequest, deps: AyasServiceRestartDeps = {}): AyasServiceRestartResult {
  const portProbe = deps.portProbe ?? defaultAyasPortProbe;
  const commandProbe = deps.commandProbe ?? defaultAyasCommandProbe;
  const isProcessAlive = deps.isProcessAlive ?? defaultIsProcessAlive;

  const pid = portProbe(request.port);
  if (pid === undefined) return refuse("PORT_NOT_LISTENING", `nothing is listening on port ${request.port}`);
  if (request.expectedPid !== undefined && request.expectedPid !== pid) {
    return refuse("PID_MISMATCH", `port ${request.port} is owned by pid ${pid}, expected ${request.expectedPid}`);
  }

  const commandLine = commandProbe(pid);
  if (commandLine === undefined) return refuse("COMMAND_UNREADABLE", `cannot read command line of pid ${pid}; ownership unproven`);
  const missing = request.expectedCommandContains.filter((needle) => !commandLine.includes(needle));
  if (missing.length > 0) {
    // Deliberately does not echo the command line: it can contain absolute
    // paths, and the needle list is enough to explain the refusal.
    return refuse("COMMAND_FINGERPRINT_MISMATCH", `pid ${pid} on port ${request.port} does not match expected identity (${missing.length} marker(s) absent)`);
  }

  const previous: AyasServiceOwnership = { port: request.port, pid, commandLine };

  try {
    (deps.terminate ?? defaultTerminate)(pid);
  } catch (error) {
    return refuse("TERMINATION_FAILED", error instanceof Error ? error.message : String(error));
  }

  try {
    (deps.start ?? (() => { throw new Error("no start function supplied"); }))();
  } catch (error) {
    return { ok: false, reasonCode: "RESTART_FAILED", detail: error instanceof Error ? error.message : String(error), terminated: true };
  }

  const newPid = (deps.waitForPort ?? ((port: number) => portProbe(port)))(request.port);
  if (newPid === undefined) return { ok: false, reasonCode: "PORT_NOT_RECLAIMED", detail: `port ${request.port} did not come back up`, terminated: true };

  for (const protectedPid of request.protectedPids ?? []) {
    if (!isProcessAlive(protectedPid)) {
      return { ok: false, reasonCode: "COLLATERAL_PROCESS_LOST", detail: `protected pid ${protectedPid} is no longer alive after restarting port ${request.port}`, terminated: true };
    }
  }

  return Object.freeze({ ok: true as const, previous, newPid });

  function refuse(reasonCode: AyasServiceRestartRefusalCode, detail: string): AyasServiceRestartResult {
    return { ok: false, reasonCode, detail, terminated: false };
  }
}

function defaultTerminate(pid: number): void {
  process.kill(pid, "SIGTERM");
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
}
