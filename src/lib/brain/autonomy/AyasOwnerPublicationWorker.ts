import { spawn } from "node:child_process";
import path from "node:path";

import { createAyasApprovalInboxStore } from "./AyasApprovalInboxStore";
import type { AyasApprovalBindingSnapshot } from "./AyasApprovalBinding";
import { decideAyasOwnerApproval, type AyasAutonomousGateOutcome } from "./AyasAutonomousExecutionGate";
import { createAyasMicroBatchStore } from "./AyasMicroBatch";
import { approveAndExecuteAyasMicroBatch, defaultAyasMicroBatchApprovalDeps, AyasMicroBatchApprovalError, type AyasMicroBatchApprovalOutcome } from "./AyasMicroBatchApprovalService";
import type { AyasOwnerAdmission } from "./AyasOwnerApprovalAdmission";
import { withAyasOwnerPublicationExclusive } from "./AyasOwnerPublicationQueue";
import { approveAndExecuteAyasProposal, defaultAyasProposalApprovalDeps, AyasProposalApprovalError, type AyasProposalApprovalOutcome } from "./AyasProposalApprovalService";

/**
 * Runs a one-click owner publication in a worker process instead of on the
 * Next.js server's event loop.
 *
 * ONAYLA VE UYGULA, BATCH ONAYLA VE UYGULA and an executing owner APPROVE
 * each run Package C, Graphify, TypeScript, commit, push and the
 * post-publication closure through synchronous child processes for about
 * 2.5 minutes. Run inside the server, that froze every request for the whole
 * run: chat, the phone, and the Access daemon's 5 s health probe, which then
 * reported AYAS offline to the phone status file.
 *
 * Nothing about the publication itself changes. The worker calls the same
 * canonical services with the same deps the server actions built. The server
 * still verifies the session and mints both sealed owner admissions before
 * anything is sent, and the worker's stores re-verify them (strict
 * owner-admission mode), exactly as in-process. The worker can therefore do
 * nothing a fresh, sealed, single-use admission for this exact subject does
 * not already authorize. Its result, or the service error it threw, comes
 * back unchanged, so each server action maps it exactly as before.
 *
 * Runs are queued (`AyasOwnerPublicationQueue`), so this server still
 * performs one owner publication at a time and never writes a ledger while a
 * worker is writing it. The worker is never killed: a run stopped half-way
 * through a commit is worse than one that takes long, and every stage keeps
 * its own timeout.
 */

export type AyasOwnerPublicationRequest =
  | { readonly lane: "proposal"; readonly proposalId: string; readonly proposalHash: string; readonly ownerAdmission: AyasOwnerAdmission; readonly executionOwnerAdmission: AyasOwnerAdmission }
  | { readonly lane: "micro-batch"; readonly batchId: string; readonly batchHash: string; readonly ownerAdmission: AyasOwnerAdmission; readonly executionOwnerAdmission: AyasOwnerAdmission }
  | { readonly lane: "owner-approve"; readonly binding: AyasApprovalBindingSnapshot; readonly ownerAdmission: AyasOwnerAdmission; readonly executionOwnerAdmission: AyasOwnerAdmission };

export type AyasOwnerPublicationOutcome<R extends AyasOwnerPublicationRequest> =
  R extends { readonly lane: "proposal" } ? AyasProposalApprovalOutcome
    : R extends { readonly lane: "micro-batch" } ? AyasMicroBatchApprovalOutcome
      : AyasAutonomousGateOutcome;

/** What the worker prints, as one line after `AYAS_OWNER_PUBLICATION_REPLY_PREFIX`. */
export type AyasOwnerPublicationReply =
  | { readonly kind: "result"; readonly value: unknown }
  | { readonly kind: "error"; readonly errorClass: "AyasProposalApprovalError" | "AyasMicroBatchApprovalError" | "Error"; readonly code?: string; readonly message: string };

export const AYAS_OWNER_PUBLICATION_REPLY_PREFIX = "AYAS_OWNER_PUBLICATION_REPLY ";
/** The worker entry, repo-relative. */
export const AYAS_OWNER_PUBLICATION_WORKER_SCRIPT = "scripts/ayas-owner-publication-worker.ts";
/** Shown to the owner when the worker could not be started or ended without a reply. */
export const AYAS_OWNER_PUBLICATION_WORKER_FAILED = "AYAS_OWNER_PUBLICATION_WORKER_FAILED";
/** Thrown by the worker for a request that does not parse. */
export const AYAS_OWNER_PUBLICATION_INVALID_REQUEST = "AYAS_OWNER_PUBLICATION_INVALID_REQUEST";

const MAX_STDOUT_BYTES = 1024 * 1024;
const STDERR_TAIL_BYTES = 2048;

export interface AyasOwnerPublicationWorkerOptions {
  /** Test seam. Production uses the server's working directory, the repository root. */
  readonly repoRoot?: string;
  /** Test seam. Production starts `AYAS_OWNER_PUBLICATION_WORKER_SCRIPT` through the repository's own tsx. */
  readonly command?: { readonly executable: string; readonly args: readonly string[] };
  /** Test seam. Production passes the server's own environment unchanged. */
  readonly env?: NodeJS.ProcessEnv;
}

function workerCommand(repoRoot: string): { readonly executable: string; readonly args: readonly string[] } {
  // The same launch the post-publication health check already uses.
  return { executable: process.execPath, args: [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repoRoot, AYAS_OWNER_PUBLICATION_WORKER_SCRIPT)] };
}

/** Parses the worker's stdout: the last reply line wins; anything else is ignored. */
export function readAyasOwnerPublicationReply(stdout: string): AyasOwnerPublicationReply | undefined {
  const line = stdout.split(/\r?\n/).reverse().find((entry) => entry.startsWith(AYAS_OWNER_PUBLICATION_REPLY_PREFIX));
  if (!line) return undefined;
  try {
    const reply = JSON.parse(line.slice(AYAS_OWNER_PUBLICATION_REPLY_PREFIX.length)) as AyasOwnerPublicationReply;
    if (reply?.kind === "result" && "value" in reply) return reply;
    if (reply?.kind === "error" && typeof reply.message === "string") return reply;
  } catch {
    // fall through: an unreadable reply is no reply
  }
  return undefined;
}

/** Turns a reply back into what the in-process call returned or threw. */
export function settleAyasOwnerPublicationReply<R extends AyasOwnerPublicationRequest>(reply: AyasOwnerPublicationReply): AyasOwnerPublicationOutcome<R> {
  if (reply.kind === "result") return reply.value as AyasOwnerPublicationOutcome<R>;
  if (reply.errorClass === "AyasProposalApprovalError") throw new AyasProposalApprovalError(reply.code ?? "APPROVAL_FAILED", reply.message);
  if (reply.errorClass === "AyasMicroBatchApprovalError") throw new AyasMicroBatchApprovalError(reply.code ?? "APPROVAL_FAILED", reply.message);
  throw new Error(reply.message);
}

/** Server side: queues the request, runs it in the worker and returns its result or rethrows its error. */
export function runAyasOwnerPublicationInWorker<R extends AyasOwnerPublicationRequest>(request: R, options: AyasOwnerPublicationWorkerOptions = {}): Promise<AyasOwnerPublicationOutcome<R>> {
  return withAyasOwnerPublicationExclusive(async () => settleAyasOwnerPublicationReply<R>(await runWorker(request, options)));
}

function runWorker(request: AyasOwnerPublicationRequest, options: AyasOwnerPublicationWorkerOptions): Promise<AyasOwnerPublicationReply> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const command = options.command ?? workerCommand(repoRoot);
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (detail: string): void => {
      if (settled) return;
      settled = true;
      console.error(`[ayas-owner-publication-worker] ${request.lane}: ${detail}`);
      reject(new Error(AYAS_OWNER_PUBLICATION_WORKER_FAILED));
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command.executable, [...command.args], { cwd: repoRoot, env: options.env ?? process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      fail(`could not start: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    let stdout = "";
    let stderrTail = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { if (stdout.length < MAX_STDOUT_BYTES) stdout += chunk; });
    child.stderr?.on("data", (chunk: string) => { stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES); });
    child.stdin?.on("error", () => { /* an early exit closes the pipe; the exit below reports it */ });
    child.once("error", (error) => fail(`could not start: ${error.message}`));
    child.once("close", (code, signal) => {
      const reply = readAyasOwnerPublicationReply(stdout);
      if (!reply) { fail(`ended without a reply (exit ${code ?? "none"}, signal ${signal ?? "none"}): ${stderrTail.trim()}`); return; }
      if (settled) return;
      settled = true;
      resolve(reply);
    });
    child.stdin?.end(JSON.stringify(request));
  });
}

/* ------------------------------------------------------------ worker side --- */

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Worker side: the shape check only. Every value is re-verified by the services themselves. */
export function parseAyasOwnerPublicationRequest(text: string): AyasOwnerPublicationRequest {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { raw = undefined; }
  if (!isRecord(raw) || !isRecord(raw.ownerAdmission) || !isRecord(raw.executionOwnerAdmission)) throw new Error(AYAS_OWNER_PUBLICATION_INVALID_REQUEST);
  if (raw.lane === "proposal" && isText(raw.proposalId) && isText(raw.proposalHash)) return raw as unknown as AyasOwnerPublicationRequest;
  if (raw.lane === "micro-batch" && isText(raw.batchId) && isText(raw.batchHash)) return raw as unknown as AyasOwnerPublicationRequest;
  if (raw.lane === "owner-approve" && isRecord(raw.binding)) return raw as unknown as AyasOwnerPublicationRequest;
  throw new Error(AYAS_OWNER_PUBLICATION_INVALID_REQUEST);
}

/** Worker side: the same service calls, with the same deps, the server actions made in-process. */
export async function performAyasOwnerPublication(request: AyasOwnerPublicationRequest): Promise<unknown> {
  switch (request.lane) {
    case "proposal":
      return approveAndExecuteAyasProposal(request.proposalId, request.proposalHash, {
        ...defaultAyasProposalApprovalDeps(),
        inbox: createAyasApprovalInboxStore({ requireOwnerAdmission: true }),
        ownerAdmission: request.ownerAdmission,
        executionOwnerAdmission: request.executionOwnerAdmission,
      });
    case "micro-batch":
      return approveAndExecuteAyasMicroBatch(request.batchId, request.batchHash, {
        ...defaultAyasMicroBatchApprovalDeps(),
        batchStore: createAyasMicroBatchStore({ requireOwnerAdmission: true }),
        ownerAdmission: request.ownerAdmission,
        executionOwnerAdmission: request.executionOwnerAdmission,
      });
    case "owner-approve":
      return decideAyasOwnerApproval(request.binding, "APPROVE", {
        ...defaultAyasProposalApprovalDeps(),
        inbox: createAyasApprovalInboxStore({ requireOwnerAdmission: true }),
        ownerAdmission: request.ownerAdmission,
        executionOwnerAdmission: request.executionOwnerAdmission,
      });
  }
}

/** Worker side: the reply for a thrown error, keeping the service's own class and code. */
export function ayasOwnerPublicationErrorReply(error: unknown): AyasOwnerPublicationReply {
  if (error instanceof AyasProposalApprovalError) return { kind: "error", errorClass: "AyasProposalApprovalError", code: error.code, message: error.message };
  if (error instanceof AyasMicroBatchApprovalError) return { kind: "error", errorClass: "AyasMicroBatchApprovalError", code: error.code, message: error.message };
  return { kind: "error", errorClass: "Error", message: error instanceof Error ? error.message : String(error) };
}
