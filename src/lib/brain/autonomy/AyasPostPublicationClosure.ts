import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * The post-publication boundary is deliberately separate from discovery and
 * approval.  It proves that a commit which is already published has a graph
 * and health view for that *new* HEAD before its publication lane reports a
 * clean closure.  It never stages, commits, pushes, approves, or retries.
 */
export class AyasPostPublicationClosureError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AyasPostPublicationClosureError";
    this.stack = undefined;
  }
}

export interface AyasGraphIntegrity {
  readonly duplicateIds: number;
  readonly danglingEdges: number;
  readonly selfLoops: number;
}

export interface AyasPostPublicationClosureResult {
  readonly head: string;
  readonly integrity: AyasGraphIntegrity;
}

export interface AyasPostPublicationClosureDeps {
  readonly repoRoot: string;
  readonly remoteName?: string;
  /** Test seam only. Production uses the established `npx graphify update` command. */
  readonly refreshGraphify?: () => void;
  /** Test seam only. Production reads `.graphify/branch.json`. */
  readonly readGraphifyBranch?: () => { readonly lastAnalyzedHead?: unknown; readonly stale?: unknown };
  /** Test seam only. Production checks the generated graph. */
  readonly readIntegrity?: () => AyasGraphIntegrity;
  /** Test seam only. Production invokes the existing health CLI. */
  readonly runHealth?: () => { readonly verdict?: unknown; readonly ownerActionRecommended?: unknown };
  readonly nowMs?: () => number;
  readonly sleepMs?: (milliseconds: number) => void;
}
const GRAPHIFY_METADATA_CONVERGENCE_TIMEOUT_MS = 30_000;
const GRAPHIFY_METADATA_POLL_MS = 250;
function defaultSleep(milliseconds: number): void { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds); }

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true }).trim();
}

function defaultRefreshGraphify(repoRoot: string): void {
  try {
    const graphifyArgs = ["graphify", "update", "--scope", "all", "--no-description", "--no-label", "."];
    // Node cannot directly spawn a Windows .cmd shim (spawnSync npx.cmd EINVAL).
    // Use the explicit command processor with a fixed command line; this is not
    // shell:true and neither the executable nor its arguments are user-controlled.
    const command = process.platform === "win32"
      ? [process.env.ComSpec ?? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"), ["/d", "/s", "/c", "npx.cmd graphify update --scope all --no-description --no-label ."]] as const
      : ["npx", graphifyArgs] as const;
    execFileSync(command[0], command[1], {
      cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 300_000,
    });
  } catch (error) {
    throw new AyasPostPublicationClosureError("AYAS_POST_PUBLICATION_GRAPHIFY_REFRESH_FAILED", error instanceof Error ? error.message : String(error));
  }
}

function defaultGraphifyBranch(repoRoot: string): { readonly lastAnalyzedHead?: unknown; readonly stale?: unknown } {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, ".graphify", "branch.json"), "utf8")) as { readonly lastAnalyzedHead?: unknown; readonly stale?: unknown };
  } catch (error) {
    throw new AyasPostPublicationClosureError("AYAS_POST_PUBLICATION_GRAPHIFY_METADATA_INVALID", error instanceof Error ? error.message : String(error));
  }
}

function defaultIntegrity(repoRoot: string): AyasGraphIntegrity {
  try {
    const graph = JSON.parse(fs.readFileSync(path.join(repoRoot, ".graphify", "graph.json"), "utf8")) as { readonly nodes?: readonly { readonly id?: unknown }[]; readonly links?: readonly { readonly source?: unknown; readonly target?: unknown }[] };
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) throw new Error("graph nodes or links are missing");
    const ids = new Set<string>(); let duplicateIds = 0;
    for (const node of graph.nodes) { const id = String(node.id); if (ids.has(id)) duplicateIds += 1; else ids.add(id); }
    let danglingEdges = 0; let selfLoops = 0;
    for (const link of graph.links) {
      const source = String(link.source); const target = String(link.target);
      if (source === target) selfLoops += 1;
      if (!ids.has(source) || !ids.has(target)) danglingEdges += 1;
    }
    return { duplicateIds, danglingEdges, selfLoops };
  } catch (error) {
    throw new AyasPostPublicationClosureError("AYAS_POST_PUBLICATION_GRAPHIFY_INTEGRITY_UNAVAILABLE", error instanceof Error ? error.message : String(error));
  }
}

function defaultHealth(repoRoot: string): { readonly verdict?: unknown; readonly ownerActionRecommended?: unknown } {
  try {
    const tsx = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
    const stdout = execFileSync(process.execPath, [tsx, path.join(repoRoot, "scripts", "ayas-self-improvement-health.ts")], {
      cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 60_000,
    });
    return JSON.parse(stdout) as { readonly verdict?: unknown; readonly ownerActionRecommended?: unknown };
  } catch (error) {
    throw new AyasPostPublicationClosureError("AYAS_POST_PUBLICATION_HEALTH_CHECK_FAILED", error instanceof Error ? error.message : String(error));
  }
}

/** Runs exactly once after a successful push. Any failure is intentionally surfaced to the existing guarded-publication recovery path. */
export function closeAyasPostPublication(expectedHead: string, deps: AyasPostPublicationClosureDeps): AyasPostPublicationClosureResult {
  const remoteName = deps.remoteName ?? "origin";
  const branch = git(deps.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const localHead = git(deps.repoRoot, ["rev-parse", "HEAD"]);
  const remoteHead = git(deps.repoRoot, ["rev-parse", `${remoteName}/${branch}`]);
  if (localHead !== expectedHead || remoteHead !== expectedHead) {
    throw new AyasPostPublicationClosureError("AYAS_POST_PUBLICATION_HEAD_UNVERIFIED", `published HEAD mismatch: expected ${expectedHead}, local ${localHead}, remote ${remoteHead}`);
  }
  (deps.refreshGraphify ?? (() => defaultRefreshGraphify(deps.repoRoot)))();
  const readGraph = deps.readGraphifyBranch ?? (() => defaultGraphifyBranch(deps.repoRoot));
  const nowMs = deps.nowMs ?? Date.now;
  const sleepMs = deps.sleepMs ?? defaultSleep;
  const deadline = nowMs() + GRAPHIFY_METADATA_CONVERGENCE_TIMEOUT_MS;
  let graph = readGraph();
  while ((graph.lastAnalyzedHead !== expectedHead || graph.stale !== false) && nowMs() < deadline) {
    sleepMs(GRAPHIFY_METADATA_POLL_MS);
    graph = readGraph();
  }
  if (graph.lastAnalyzedHead !== expectedHead || graph.stale !== false) {
    throw new AyasPostPublicationClosureError("AYAS_POST_PUBLICATION_GRAPHIFY_STALE", "Graphify did not become fresh for the published HEAD");
  }
  const integrity = (deps.readIntegrity ?? (() => defaultIntegrity(deps.repoRoot)))();
  if (integrity.duplicateIds !== 0 || integrity.danglingEdges !== 0 || integrity.selfLoops !== 0) {
    throw new AyasPostPublicationClosureError("AYAS_POST_PUBLICATION_GRAPHIFY_INTEGRITY_FAILED", "Graphify integrity checks did not pass");
  }
  const health = (deps.runHealth ?? (() => defaultHealth(deps.repoRoot)))();
  if (health.verdict !== "HEALTHY" || health.ownerActionRecommended !== false) {
    throw new AyasPostPublicationClosureError("AYAS_POST_PUBLICATION_HEALTH_UNHEALTHY", "AYAS self-improvement health did not certify the published HEAD");
  }
  if (git(deps.repoRoot, ["status", "--porcelain"]) !== "") {
    throw new AyasPostPublicationClosureError("AYAS_POST_PUBLICATION_REPO_DIRTY", "post-publication closure dirtied the repository");
  }
  return { head: expectedHead, integrity };
}
