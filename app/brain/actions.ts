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
