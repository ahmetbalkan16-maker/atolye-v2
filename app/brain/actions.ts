"use server";

/**
 * Atölye Brain Core — server actions (Sprint 186).
 *
 * `refreshBrainConsole` re-reads the Brain's durable state (read-only).
 *
 * `askAyas` wires the chat panel to the project's EXISTING local model. It builds
 * a deterministic AYAS prompt (see `buildAyasChatPrompt`) and calls the EXISTING
 * `OllamaProvider` directly — via `createAyasChatProvider`, which is the same
 * `OllamaProvider` class the `AIRouter` uses, never resolved from `AI_PROVIDER`,
 * so a stray `AI_PROVIDER=openai` can never route AYAS chat to a paid API. The
 * only difference from the pipeline provider is an OPTIONAL `AYAS_OLLAMA_MODEL`
 * override that applies to AYAS chat alone (spec §3).
 *
 * It deliberately does NOT go through `runObservedAIRequest`: that path writes
 * `data/projects/<slug>/ai-usage.json` (`unknown` slug when context-less — a
 * file the operator asked us not to touch), and its cost guard is a no-op for
 * the free `ollama` provider anyway. So `askAyas` calls the provider directly
 * and writes no telemetry.
 *
 * The execution gate stays CLOSED: chat is prompt → text. It enqueues nothing,
 * runs no task/pipeline/GPU, approves nothing.
 */

import { execFileSync } from "node:child_process";

import { cookies } from "next/headers";

import type { AIProviderOutput } from "@/lib/ai/providers/AIProvider";
import {
  loadBrainConsoleSnapshot,
  type BrainConsoleSnapshot,
} from "@/lib/brain/ui/BrainConsoleSnapshot";
import {
  loadBrainSelfHealSnapshot,
  type BrainSelfHealConsoleSnapshot,
} from "@/lib/brain/ui/BrainSelfHealConsoleSnapshot";
import { loadAyasStudioContext } from "@/lib/ayas/AyasStudioContext";
import { createAyasChatProvider, resolveAyasChatModelProfile, AYAS_MODEL_ENV } from "@/lib/ayas/AyasModelProfile";
import { createBrainSelfHealStore } from "@/lib/brain/selfheal/BrainSelfHealStore";
import { createAyasApprovalInboxStore, type AyasInboxDecision } from "@/lib/brain/autonomy/AyasApprovalInboxStore";
import { loadAyasApprovalInboxView, type AyasApprovalInboxView } from "@/lib/brain/autonomy/AyasApprovalInboxView";
import { executeAyasApprovedProposalWith, defaultAyasProposalExecutionDeps, AyasProposalExecutionError } from "@/lib/brain/autonomy/AyasProposalExecutionService";
import { approveAndExecuteAyasMicroBatch, defaultAyasMicroBatchApprovalDeps, AyasMicroBatchApprovalError } from "@/lib/brain/autonomy/AyasMicroBatchApprovalService";
import { loadAyasMicroBatchDevelopmentView, type AyasMicroBatchDevelopmentView } from "@/lib/brain/autonomy/AyasMicroBatchDevelopmentView";
import { reconcileAyasStaleProposals } from "@/lib/brain/autonomy/AyasProposalStaleness";
import { buildSelfHealDecision, type BrainSelfHealDecisionKind } from "@/lib/brain/selfheal/BrainSelfHealDecision";
import { classifyPatchSet } from "@/lib/brain/selfheal/BrainPatchSafety";
import {
  buildAyasReportSpokenAnswer,
  detectAyasReportIntent,
} from "@/lib/brain/selfheal/BrainReportCenter";
import { AYAS_SESSION_COOKIE, resolveAccessGate, verifySession } from "@/lib/auth/accessGate";
import {
  AYAS_CHAT_JSON_SCHEMA,
  AYAS_MAX_REPLY_TOKENS,
  ayasReplyMessage,
  extractAyasReplyText,
  resolveAyasReply,
  type AyasReplyOutcome,
  type BrainChatMessage,
} from "@/components/brain/brainCore";

export async function refreshBrainConsole(): Promise<BrainConsoleSnapshot> {
  return loadBrainConsoleSnapshot();
}

export interface AskAyasInput {
  readonly text: string;
  readonly history: readonly { readonly role: BrainChatMessage["role"]; readonly text: string }[];
  readonly seq: number;
}

function textOf(output: AIProviderOutput): string {
  if (typeof output === "string") return output;
  return output.refused ? "" : output.content ?? "";
}

export async function askAyas(input: AskAyasInput): Promise<AyasReplyOutcome> {
  // "AYAS, rapor ver" / "onay bekleyen ne" (§11) — answered deterministically
  // from the Report Center snapshot BEFORE any model call. Runs nothing.
  const reportIntent = detectAyasReportIntent(input.text ?? "");
  if (reportIntent) {
    const rc = loadBrainSelfHealSnapshot().reportCenter;
    return {
      message: ayasReplyMessage(buildAyasReportSpokenAnswer(rc, reportIntent), input.seq),
      source: "fallback",
    };
  }

  const [snapshot, studio] = await Promise.all([
    loadBrainConsoleSnapshot(),
    // Read-only: the active runtime authority path + real project inventory,
    // so AYAS answers "kaç proje var" / "runtime authority neresi" from fact.
    loadAyasStudioContext(),
  ]);
  return resolveAyasReply({
    text: input.text,
    snapshot,
    studio,
    history: input.history ?? [],
    seq: input.seq,
    // The local `OllamaProvider`, hard-pinned — never resolved from `AI_PROVIDER`,
    // so a stray `AI_PROVIDER=openai` cannot bill AYAS chat. The backend runs
    // `format: "json"`, so we pass the existing `jsonSchema` option (a
    // `{ reply: string }` envelope) and unwrap the natural-language answer.
    generate: async (prompt) =>
      extractAyasReplyText(
        textOf(
          await createAyasChatProvider().generate(prompt, {
            maxTokens: AYAS_MAX_REPLY_TOKENS,
            jsonSchema: AYAS_CHAT_JSON_SCHEMA,
          }),
        ),
      ),
  });
}

/* --------------------------------------------- AYAS Report Center (§7–§15) --- */

async function requireBrainSession(): Promise<void> {
  const gate = resolveAccessGate(process.env);
  if (gate.mode === "disabled-dev") return;
  if (gate.mode !== "enforced") {
    throw new Error("brain_report_decision_unavailable");
  }
  const token = (await cookies()).get(AYAS_SESSION_COOKIE)?.value;
  if (!verifySession(token, gate.key as string)) {
    throw new Error("authentication_required");
  }
}

/** Re-read the self-heal / AYAS Report Center snapshot (read-only). */
export async function refreshBrainSelfHeal(): Promise<BrainSelfHealConsoleSnapshot> {
  return loadBrainSelfHealSnapshot();
}

// Stage 7A's read-only refresh (`refreshAyasApprovalInbox`) lives in
// `./observerActions.ts` instead — it must not depend on this file, which
// carries the Package B decision authority below.
export async function decideAyasApproval(input: { proposalId: string; decision: AyasInboxDecision; reason?: string }): Promise<AyasApprovalInboxView> {
  await requireBrainSession();
  if (input.decision !== "APPROVE" && input.decision !== "REJECT" && input.decision !== "LATER") throw new Error("invalid_decision");
  const store = createAyasApprovalInboxStore();
  // M16: reconcile staleness before honoring any decision — a PENDING or
  // APPROVED proposal whose baseHead no longer matches HEAD is durably
  // marked STALE here rather than being approved (or re-approved) into a
  // dead end. Read-only w.r.t. execution: never reserves, executes, or
  // opens a gate.
  const currentHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8", windowsHide: true }).trim();
  reconcileAyasStaleProposals(store, currentHead, new Date().toISOString());
  const proposal = store.load().proposals.find((entry) => entry.proposalId === input.proposalId);
  if (!proposal) throw new Error("proposal_not_found");
  if (proposal.status === "STALE") throw new Error("proposal_stale");
  if (input.decision === "APPROVE" && proposal.safetyClassification !== "SAFE") throw new Error("forbidden_area_needs_human");
  store.decide(input.proposalId, input.decision, new Date().toISOString(), input.reason);
  return loadAyasApprovalInboxView();
}

export interface AyasExecuteProposalResult {
  readonly ok: boolean;
  /** Present only when `ok` is false — always one of this module's own short, non-secret codes (never a raw internal error message). */
  readonly code?: string;
  readonly inbox: AyasApprovalInboxView;
}

/**
 * The one real Package C execution entrypoint (M15). Accepts only a
 * proposalId — never a callback, filesystem path, gateRoot, or mutation
 * content from the client. This action is a thin, session-gated wrapper:
 * all the real logic (proposal lookup, re-derivation of hash/baseHead/
 * exactFiles, mutation resolution, and delegation to
 * `AyasAutonomyDaemon.executeApproved()`) lives in the fully testable
 * `AyasProposalExecutionService`, so it can be exercised against isolated
 * fixtures instead of real production state. This is a separate, explicit
 * action from `decideAyasApproval` above: approving a proposal never calls
 * this.
 *
 * Returns a result object rather than throwing across the Server Action
 * boundary: Next.js redacts a thrown error's message in production, so a
 * client-side `catch` would only ever see a generic, useless string — the
 * caller could never distinguish "proposal already executed" from "machine
 * health blocked" from an actual bug. Returning `{ ok: false, code }`
 * carries the real (already safe, non-secret) reason through intact.
 */
export async function executeAyasApprovedProposal(input: { proposalId: string }): Promise<AyasExecuteProposalResult> {
  await requireBrainSession();
  try {
    await executeAyasApprovedProposalWith(input.proposalId, defaultAyasProposalExecutionDeps());
    return { ok: true, inbox: loadAyasApprovalInboxView() };
  } catch (error) {
    const code = error instanceof AyasProposalExecutionError ? error.code : error instanceof Error ? error.message : "EXECUTION_FAILED";
    return { ok: false, code, inbox: loadAyasApprovalInboxView() };
  }
}

export interface AyasBatchOnaylaVeUygulaResult {
  readonly ok: boolean;
  /** Present only when `ok` is false — one of `AyasMicroBatchApprovalService`'s own short, non-secret codes. */
  readonly code?: string;
  /** Present only when `ok` is true — the pushed commit's SHA. */
  readonly commitSha?: string;
  readonly microBatch: AyasMicroBatchDevelopmentView;
}

/**
 * "BATCH ONAYLA VE UYGULA" — the M18.1 single human authorization. Unlike
 * every other decision/execution action in this file, this ONE click
 * authorizes the exact reviewed batch to be decided, executed through
 * Package C, Graphify-verified per item and once more for the whole batch,
 * exact-staged, committed as ONE commit, and pushed — with no second
 * "YÜRÜT" and no second Git-publication approval. The real orchestration
 * (and every one of its fail-closed guards) lives in the fully testable
 * `AyasMicroBatchApprovalService`; this action is a thin, session-gated
 * wrapper that accepts only a `batchId` and the exact `batchHash` the human
 * reviewed — never a callback, filesystem path, gateRoot, or mutation
 * content from the client.
 */
export async function batchOnaylaVeUygula(input: { batchId: string; batchHash: string }): Promise<AyasBatchOnaylaVeUygulaResult> {
  await requireBrainSession();
  try {
    const result = await approveAndExecuteAyasMicroBatch(input.batchId, input.batchHash, defaultAyasMicroBatchApprovalDeps());
    return result.ok
      ? { ok: true, commitSha: result.commitSha, microBatch: loadAyasMicroBatchDevelopmentView() }
      : { ok: false, code: result.code, microBatch: loadAyasMicroBatchDevelopmentView() };
  } catch (error) {
    const code = error instanceof AyasMicroBatchApprovalError ? error.code : error instanceof Error ? error.message : "APPROVAL_FAILED";
    return { ok: false, code, microBatch: loadAyasMicroBatchDevelopmentView() };
  }
}

export interface RecordSelfHealDecisionInput {
  readonly incidentId: string;
  readonly decision: BrainSelfHealDecisionKind;
  readonly note?: string;
}

/**
 * Record an operator ÇÖZÜMÜ ONAYLA / REDDET / DAHA SONRA decision (§10 / §11).
 *
 * This writes a small decision record only. It NEVER runs git, stages a patch,
 * opens the execution gate, or touches production authority. The staged apply
 * still happens through the Node operator CLI (`npm run selfheal -- apply <id>`),
 * which reads this record and requires it to be an APPROVE.
 */
export async function recordSelfHealDecision(
  input: RecordSelfHealDecisionInput,
): Promise<BrainSelfHealConsoleSnapshot> {
  await requireBrainSession();

  const decision = input.decision;
  if (decision !== "APPROVE" && decision !== "REJECT" && decision !== "LATER") {
    throw new Error("invalid_decision");
  }

  const store = createBrainSelfHealStore();
  const incident = store.loadIncident(input.incidentId);
  if (!incident) throw new Error("incident_not_found");

  if (incident.status !== "VERIFIED" && incident.status !== "AWAITING_APPROVAL") {
    throw new Error(`incident_not_decidable:${incident.status}`);
  }
  if (incident.needsHumanReason) {
    throw new Error("incident_needs_human");
  }
  // A FORBIDDEN-area fix can never be approved through this button — a human
  // handles it directly.
  const forbidden =
    incident.patch?.safetyLevel === "FORBIDDEN_AUTONOMOUS" ||
    classifyPatchSet(incident.patch?.changedFiles ?? incident.hypotheses[0]?.suspectFiles ?? []).forbidden.length > 0;
  if (decision === "APPROVE" && forbidden) {
    throw new Error("forbidden_area_needs_human");
  }
  if (decision === "APPROVE" && !incident.patch) {
    throw new Error("no_patch_to_approve");
  }

  store.recordSelfHealDecision(
    buildSelfHealDecision({
      incidentId: incident.id,
      decision,
      note: input.note,
      now: new Date().toISOString(),
      incidentStatusAtDecision: incident.status,
    }),
  );

  return loadBrainSelfHealSnapshot();
}

/**
 * Whether the local model backend is *configured* (a cheap env check — no
 * network call). Lets the UI drop the "not connected" note when AYAS is
 * expected to answer via the model. A configured-but-unreachable model still
 * falls back gracefully per `askAyas`.
 */
export async function ayasModelConfigured(): Promise<boolean> {
  return Boolean(process.env.OLLAMA_HOST || process.env.OLLAMA_MODEL || process.env[AYAS_MODEL_ENV]);
}

/**
 * The model AYAS chat will use + whether `AYAS_OLLAMA_MODEL` overrode the
 * pipeline default (spec §3 — surfaced in the activation report, not the UI).
 */
export async function ayasChatModel(): Promise<{ model: string; overridden: boolean }> {
  const profile = resolveAyasChatModelProfile();
  return { model: profile.model, overridden: profile.overridden };
}
