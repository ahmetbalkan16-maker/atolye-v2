/**
 * Atölye Brain — AYAS context assembly (Phase 2 · Phase B).
 *
 * The one place the chat path calls to turn `(history, studio)` into the
 * deterministic prompt blocks + the compressed verbatim window. Pure — it just
 * composes `AyasConversationState` + `AyasReferenceResolver` +
 * `AyasContextCompression`.
 */

import type { AyasConversationPromptBlock, AyasStudioContextView, BrainChatMessage } from "@/components/brain/brainCore";
import { deriveAyasConversationState } from "./AyasConversationState";
import { resolveAyasReferences } from "./AyasReferenceResolver";
import { compressAyasHistory } from "./AyasContextCompression";

export interface AssembledAyasContext {
  readonly block: AyasConversationPromptBlock;
  /** The turns to feed the model verbatim (older ones are in `block.historySummary`). */
  readonly recentHistory: readonly { readonly role: BrainChatMessage["role"]; readonly text: string }[];
  /** Non-null when a short follow-up cannot be resolved without guessing. */
  readonly clarification: string | null;
  /** Explicit referents selected by the deterministic resolver, for post-call quality checks. */
  readonly resolvedReferents: readonly string[];
  /** Machine-readable trace for observability (Phase K). */
  readonly trace: {
    readonly activeProject: string | null;
    /** The real slug behind `activeProject` — see `AyasConversationStateView.activeProjectSlug`. */
    readonly activeProjectSlug: string | null;
    readonly activeStage: string | null;
    readonly activeTopic: string | null;
    readonly resolvedReferences: number;
    readonly unresolvedReferences: number;
    readonly droppedTurns: number;
    readonly selectedOption: string | null;
    readonly temporaryConstraintCount: number;
  };
}

export function assembleAyasContext(input: {
  readonly userText: string;
  readonly history: readonly { readonly role: BrainChatMessage["role"]; readonly text: string }[];
  readonly studio?: AyasStudioContextView;
  readonly conversationId?: string;
  readonly recentTurns?: number;
}): AssembledAyasContext {
  const state = deriveAyasConversationState(input.history, {
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.studio ? { studio: input.studio } : {}),
  });
  const refs = resolveAyasReferences(input.userText, state, input.history);
  const compressed = compressAyasHistory(input.history, {
    ...(input.recentTurns ? { recentTurns: input.recentTurns } : {}),
  });

  const stateLines: string[] = [];
  if (state.activeProject) stateLines.push(`- aktif proje: ${state.activeProject}`);
  if (state.activeStage) stateLines.push(`- aktif pipeline aşaması: ${state.activeStage}`);
  if (state.activeTopic && state.activeTopic !== state.activeProject) {
    stateLines.push(`- konuşulan konu: ${state.activeTopic}`);
  }
  if (state.options.length) stateLines.push(`- konuşmadaki seçenekler: ${state.options.join(" | ")}`);
  if (state.selectedOption) stateLines.push(`- kullanıcının seçtiği seçenek: ${state.selectedOption}`);
  if (state.temporaryConstraints.length) {
    stateLines.push(`- geçici konuşma kısıtları: ${state.temporaryConstraints.join(" | ")}`);
  }
  if (state.unresolvedQuestions.length) {
    stateLines.push(`- kullanıcının yanıtlamadığı soru(lar): ${state.unresolvedQuestions.join(" | ")}`);
  }
  if (state.recentEntities.length) {
    stateLines.push(
      `- yakın geçmişte geçen: ${state.recentEntities.slice(0, 5).map((e) => e.value).join(", ")}`,
    );
  }

  return {
    block: {
      ...(stateLines.length ? { stateLines } : {}),
      ...(refs.promptLines.length ? { referenceLines: [...refs.promptLines] } : {}),
      ...(compressed.summary.length ? { historySummary: [...compressed.summary] } : {}),
    },
    recentHistory: compressed.recent,
    clarification: refs.clarification,
    resolvedReferents: refs.resolutions.map((resolution) => resolution.referent),
    trace: {
      activeProject: state.activeProject,
      activeProjectSlug: state.activeProjectSlug,
      activeStage: state.activeStage,
      activeTopic: state.activeTopic,
      resolvedReferences: refs.resolutions.length,
      unresolvedReferences: refs.unresolved.length,
      droppedTurns: compressed.droppedTurns,
      selectedOption: state.selectedOption,
      temporaryConstraintCount: state.temporaryConstraints.length,
    },
  };
}
