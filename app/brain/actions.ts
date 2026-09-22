"use server";

/**
 * Atölye Brain Core — server actions (Sprint 186).
 *
 * `refreshBrainConsole` re-reads the Brain's durable state (read-only).
 *
 * `askAyas` wires the chat panel to the same governed `streamAyasChat` pipeline
 * used by the streaming route. That pipeline uses the AYAS model profile and
 * never resolves from `AI_PROVIDER`, so a stray `AI_PROVIDER=openai` cannot
 * route AYAS chat to a paid API. The optional `AYAS_OLLAMA_MODEL` override still
 * applies only to AYAS chat (spec §3).
 *
 * It deliberately does NOT go through `runObservedAIRequest`: that path writes
 * `data/projects/<slug>/ai-usage.json` (`unknown` slug when context-less — a
 * file the operator asked us not to touch), and its cost guard is a no-op for
 * the free `ollama` provider anyway. `askAyas` writes no telemetry.
 *
 * The execution gate stays CLOSED: chat is prompt → text. It enqueues nothing,
 * runs no task/pipeline/GPU, approves nothing.
 */

import { execFileSync } from "node:child_process";

import { cookies } from "next/headers";

import {
  loadBrainConsoleSnapshot,
  type BrainConsoleSnapshot,
} from "@/lib/brain/ui/BrainConsoleSnapshot";
import {
  loadBrainSelfHealSnapshot,
  type BrainSelfHealConsoleSnapshot,
} from "@/lib/brain/ui/BrainSelfHealConsoleSnapshot";
import { loadAyasStudioContext } from "@/lib/ayas/AyasStudioContext";
import { resolveAyasChatModelProfile, AYAS_MODEL_ENV } from "@/lib/ayas/AyasModelProfile";
import { loadAyasProductBrainContext } from "@/lib/ayas/AyasProductBrain";
import { streamAyasChat, type AyasChatStreamEvent } from "@/lib/ayas/AyasChatStream";
import { createBrainSelfHealStore } from "@/lib/brain/selfheal/BrainSelfHealStore";
import { createAyasApprovalInboxStore, type AyasInboxDecision } from "@/lib/brain/autonomy/AyasApprovalInboxStore";
import { loadAyasApprovalInboxView, type AyasApprovalInboxView } from "@/lib/brain/autonomy/AyasApprovalInboxView";
import { loadAyasGoalDevelopmentView } from "@/lib/brain/autonomy/AyasGoalDevelopmentView";
import { loadAyasResearchEngineStatusView } from "@/lib/brain/autonomy/AyasResearchEngineStatusView";
import { detectAyasResearchStatusIntent, buildAyasResearchStatusSpokenAnswer } from "@/lib/brain/autonomy/AyasResearchStatusIntent";
import { executeAyasApprovedProposalWith, defaultAyasProposalExecutionDeps, AyasProposalExecutionError } from "@/lib/brain/autonomy/AyasProposalExecutionService";
import { approveAndExecuteAyasMicroBatch, defaultAyasMicroBatchApprovalDeps, AyasMicroBatchApprovalError } from "@/lib/brain/autonomy/AyasMicroBatchApprovalService";
import { approveAndExecuteAyasProposal, defaultAyasProposalApprovalDeps, AyasProposalApprovalError } from "@/lib/brain/autonomy/AyasProposalApprovalService";
import { decideAyasOwnerApproval, type AyasOwnerDecision } from "@/lib/brain/autonomy/AyasAutonomousExecutionGate";
import type { AyasApprovalBindingSnapshot } from "@/lib/brain/autonomy/AyasApprovalBinding";
import { loadAyasOwnerRecommendationsView, type AyasOwnerRecommendationsView } from "@/lib/brain/autonomy/AyasOwnerRecommendationsView";
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
  ayasReplyMessage,
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

  // AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint — "Son internette ne
  // araştırdın?" / "Sonraki araştırma ne zaman?" / "CapCut tarafında yeni ne
  // buldun?" — same deterministic, pre-model-call posture as the report
  // intent above: answered directly from the real durable goal/research and
  // scheduler state, never invented, never a model call.
  const researchStatusIntent = detectAyasResearchStatusIntent(input.text ?? "");
  if (researchStatusIntent) {
    const [goalDevelopment, researchEngineStatus] = [loadAyasGoalDevelopmentView(), loadAyasResearchEngineStatusView()];
    return {
      message: ayasReplyMessage(buildAyasResearchStatusSpokenAnswer(goalDevelopment, researchEngineStatus, researchStatusIntent), input.seq),
      source: "fallback",
    };
  }

  const [snapshot, studio] = await Promise.all([
    loadBrainConsoleSnapshot(),
    // Read-only: the active runtime authority path + real project inventory,
    // so AYAS answers "kaç proje var" / "runtime authority neresi" from fact.
    loadAyasStudioContext(),
  ]);
  // Streaming transport is optional for the UI, but Phase 2 context/memory
  // semantics are not. The Server Action fallback therefore consumes the
  // SAME governed stream pipeline to its terminal event instead of retaining
  // a second, older chat implementation with divergent memory behavior.
  const productBrain = await loadAyasProductBrainContext(snapshot);
  let terminal: Extract<AyasChatStreamEvent, { type: "done" }> | undefined;
  for await (const event of streamAyasChat({
    text: input.text,
    snapshot,
    studio,
    productBrainLines: productBrain.lines,
    history: input.history ?? [],
    seq: input.seq,
  })) {
    if (event.type === "done") terminal = event;
  }
  const text = terminal?.text ?? "AYAS şu an yanıt veremiyor; metin sohbeti çalışıyor.";
  return { message: ayasReplyMessage(text, input.seq), source: terminal?.source ?? "fallback" };
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

export interface AyasProposalOnaylaVeUygulaResult {
  readonly ok: boolean;
  /** Present only when `ok` is false — one of `AyasProposalApprovalService`'s own short, non-secret codes. */
  readonly code?: string;
  /** Present only when `ok` is true — the pushed commit's SHA. */
  readonly commitSha?: string;
  readonly inbox: AyasApprovalInboxView;
}

/**
 * "ONAYLA VE UYGULA" (M20.7) — the individual-proposal single human
 * authorization, mirroring `batchOnaylaVeUygula` above for the batch lane.
 * This ONE click authorizes the exact reviewed proposal to be decided,
 * executed through Package C, Graphify-verified, exact-staged, committed as
 * ONE commit, and pushed — with no second "YÜRÜT" and no second
 * Git-publication approval. The real orchestration lives in the fully
 * testable `AyasProposalApprovalService`; this action is a thin,
 * session-gated wrapper that accepts only a `proposalId` and the exact
 * `proposalHash` the human reviewed — never a callback, filesystem path,
 * gateRoot, or mutation content from the client. `decideAyasApproval` /
 * `executeAyasApprovedProposal` above remain unchanged for every other
 * proposal (REVIEW_REQUIRED, or a non-patch-artifact mutationKind).
 */
export async function proposalOnaylaVeUygula(input: { proposalId: string; proposalHash: string }): Promise<AyasProposalOnaylaVeUygulaResult> {
  await requireBrainSession();
  try {
    const result = await approveAndExecuteAyasProposal(input.proposalId, input.proposalHash, defaultAyasProposalApprovalDeps());
    return result.ok
      ? { ok: true, commitSha: result.commitSha, inbox: loadAyasApprovalInboxView() }
      : { ok: false, code: result.code, inbox: loadAyasApprovalInboxView() };
  } catch (error) {
    const code = error instanceof AyasProposalApprovalError ? error.code : error instanceof Error ? error.message : "APPROVAL_FAILED";
    return { ok: false, code, inbox: loadAyasApprovalInboxView() };
  }
}

export interface AyasOwnerApprovalDecisionResult {
  readonly ok: boolean;
  /** Present only when `ok` is false — one of `AyasAutonomousExecutionGate`'s own short, non-secret reasons (e.g. `AUTONOMOUS_EXECUTION_DISABLED`, `BASE_HEAD_CHANGED`, `NOT_EXECUTABLE_CLASSIFICATION`), or `AyasProposalApprovalService`'s own code when execution itself failed. */
  readonly code?: string;
  /** Present only when `ok` is true — the pushed commit's SHA. */
  readonly commitSha?: string;
  readonly recommendations: AyasOwnerRecommendationsView;
}

/**
 * Owner-approval model — the ONE action an owner's APPROVE/REJECT click
 * calls. Accepts only the exact binding the owner was shown (never a raw
 * proposalId alone) so every field the owner saw — baseHead, scope, patch-
 * artifact identity, risk classification — gets re-validated fresh
 * (`AyasApprovalBinding.reevaluateAyasApprovalBinding`, inside the gate)
 * before anything else happens. REJECT durably records the decision with no
 * mutation. APPROVE is ALWAYS durably recorded (`AyasInboxProposalStatus =
 * "APPROVED"`) once valid — that's what makes it survive a hard reload or a
 * server restart, unlike a client-only "already approved" flag ever could.
 * If `AYAS_AUTONOMOUS_EXECUTION_ENABLED` is also set, this delegates to the
 * exact same canonical execution primitive `proposalOnaylaVeUygula` uses
 * (`AyasProposalApprovalService.approveAndExecuteAyasProposal`) — no
 * parallel mutation engine. If it is not set, nothing executes yet;
 * `AyasOwnerApprovalResume.ts` is what later resumes it automatically, with
 * no second owner click. The live env var is read for real here (no
 * override), so this can never execute anything unless that flag is
 * explicitly set in the real deployment environment.
 */
export async function ayasOwnerApprovalDecision(input: { binding: AyasApprovalBindingSnapshot; decision: AyasOwnerDecision }): Promise<AyasOwnerApprovalDecisionResult> {
  await requireBrainSession();
  try {
    const outcome = await decideAyasOwnerApproval(input.binding, input.decision, {
      ...defaultAyasProposalApprovalDeps(),
      inbox: createAyasApprovalInboxStore(),
    });
    if (outcome.executed) {
      return { ok: true, commitSha: outcome.result.commitSha, recommendations: loadAyasOwnerRecommendationsView() };
    }
    // Neither of the next two is an error — both are an owner decision that
    // was accepted and durably recorded, with no mutation performed:
    //
    // - APPROVED_PENDING_EXECUTION: the APPROVE was valid and is now durable
    //   (`AyasInboxProposalStatus = "APPROVED"`); live execution is simply off
    //   right now. The card moves out of "AYAS'ın Önerileri" and into the
    //   durable "ONAYLANDI" list on this same refreshed view — no
    //   client-side flag involved.
    // - OWNER_REJECTED: recording a rejection is never a mutation, so it
    //   always succeeds regardless of the live-execution flag. Reporting it
    //   as `ok: false` would light up the caller's error surface for what is
    //   actually the owner getting exactly what they asked for.
    //
    // In both cases the refreshed view is what communicates the new state;
    // there is nothing for the caller to report as a failure.
    if (outcome.reason === "APPROVED_PENDING_EXECUTION" || outcome.reason === "OWNER_REJECTED") {
      return { ok: true, recommendations: loadAyasOwnerRecommendationsView() };
    }
    const code = outcome.reason === "EXECUTION_FAILED" ? outcome.result.code : outcome.reason;
    return { ok: false, code, recommendations: loadAyasOwnerRecommendationsView() };
  } catch (error) {
    // Same precedence as `proposalOnaylaVeUygula` above: prefer the service's
    // own stable, short error CODE over its English prose, so the owner-facing
    // label lookup in `AyasDevelopmentCenter` can actually match it instead of
    // falling through and rendering a raw internal message.
    const code = error instanceof AyasProposalApprovalError ? error.code : error instanceof Error ? error.message : "APPROVAL_FAILED";
    return { ok: false, code, recommendations: loadAyasOwnerRecommendationsView() };
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
