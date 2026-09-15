import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { guardAyasHeavyWorkload, type AyasMachineHealthDecision, type AyasMachineWorkload } from "../../ayas/machine/AyasMachineHealthGuard";
import type { AyasApprovalInboxHandle } from "./AyasApprovalInboxStore";
import { canonicalizeAyasExactFiles } from "./AyasMutationScope";

const execFileAsync = promisify(execFile);

export type AyasExecutionRevalidationCode = "HEAD_MISMATCH" | "REPOSITORY_DIRTY" | "MACHINE_HEALTH_BLOCKED" | "PROPOSAL_BINDING_MISMATCH" | "EXACT_FILES_MISMATCH" | "RESERVATION_INVALID" | "REPOSITORY_UNAVAILABLE";

export class AyasExecutionRevalidationError extends Error {
  constructor(readonly code: AyasExecutionRevalidationCode, message: string) { super(message); this.name = "AyasExecutionRevalidationError"; this.stack = undefined; }
}

export interface AyasExecutionBinding {
  readonly proposalId: string; readonly proposalHash: string; readonly baseHead: string;
  readonly exactFiles: readonly string[]; readonly reservationId: string; readonly authorizationId: string;
}

export interface AyasExecutionRevalidationDeps {
  readonly repoRoot: string; readonly inbox: AyasApprovalInboxHandle;
  readonly workload?: AyasMachineWorkload;
  readonly readMachineHealth?: () => Promise<AyasMachineHealthDecision>;
  readonly readRepository?: () => Promise<{ readonly head: string; readonly clean: boolean }>;
}

async function readGit(repoRoot: string): Promise<{ head: string; clean: boolean }> {
  try {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" };
    const [head, status] = await Promise.all([
      execFileAsync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { timeout: 5_000, windowsHide: true, env }),
      execFileAsync("git", ["-C", repoRoot, "status", "--porcelain=v1", "--untracked-files=all"], { timeout: 10_000, windowsHide: true, env }),
    ]);
    return { head: head.stdout.trim(), clean: status.stdout.length === 0 };
  } catch { throw new AyasExecutionRevalidationError("REPOSITORY_UNAVAILABLE", "authoritative repository state is unavailable"); }
}

/** Re-reads every authority source. Call once before gate authority and again immediately before begin-execution. */
export async function revalidateAyasExecution(binding: AyasExecutionBinding, deps: AyasExecutionRevalidationDeps): Promise<void> {
  const exactFiles = canonicalizeAyasExactFiles(deps.repoRoot, binding.exactFiles);
  const [repository, health] = await Promise.all([
    (deps.readRepository ?? (() => readGit(deps.repoRoot)))(),
    (deps.readMachineHealth ?? (() => guardAyasHeavyWorkload(deps.workload ?? { stage: "script", ownedActive: false })))(),
  ]);
  if (!health.mayStart) throw new AyasExecutionRevalidationError("MACHINE_HEALTH_BLOCKED", `Machine Health blocked execution: ${health.action}`);
  if (!repository.clean) throw new AyasExecutionRevalidationError("REPOSITORY_DIRTY", "repository is not clean at execution time");
  if (repository.head !== binding.baseHead) throw new AyasExecutionRevalidationError("HEAD_MISMATCH", "authorized base HEAD no longer matches the repository");

  const state = deps.inbox.load();
  const proposal = state.proposals.find((item) => item.proposalId === binding.proposalId);
  const decision = state.decisions.find((item) => item.reservationId === binding.reservationId);
  if (!proposal || proposal.status !== "RESERVED" || proposal.proposalHash !== binding.proposalHash || proposal.baseHead !== binding.baseHead) {
    throw new AyasExecutionRevalidationError("PROPOSAL_BINDING_MISMATCH", "durable proposal binding is stale or invalid");
  }
  const proposalFiles = canonicalizeAyasExactFiles(deps.repoRoot, proposal.exactFiles);
  if (JSON.stringify(proposalFiles) !== JSON.stringify(exactFiles)) throw new AyasExecutionRevalidationError("EXACT_FILES_MISMATCH", "durable exact-file scope no longer matches authorization");
  if (!decision || decision.proposalId !== binding.proposalId || decision.authorizationId !== binding.authorizationId || decision.finalizedAt || !decision.reservedAt) {
    throw new AyasExecutionRevalidationError("RESERVATION_INVALID", "authorization reservation is missing, finalized, or mismatched");
  }
}
