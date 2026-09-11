/**
 * Atölye Brain — AYAS conversation state (Phase 2 · Phase B).
 *
 * A small, DETERMINISTIC projection of "where we are in this conversation",
 * derived purely from the turn history + (optionally) the read-only studio
 * context. It is NOT a second chat log — the raw turns stay authoritative. This
 * gives the reference resolver and the prompt a compact "what is `bu` / `o
 * proje` / `devam et` about" without asking a model.
 *
 * Pure: no fs, no network, no model, no clock beyond an injected `now`.
 */

import type { AyasStudioContextView } from "@/components/brain/brainCore";
import type { BrainChatMessage } from "@/components/brain/brainCore";

export interface AyasConversationEntity {
  /** Canonical form (a project slug / title, a stage key, a runtime path…). */
  readonly value: string;
  /** `project` | `stage` | `path` | `topic`. */
  readonly kind: "project" | "stage" | "path" | "topic";
  /** 1-based turn index it was last seen in (higher = more recent). */
  readonly lastTurn: number;
}

export interface AyasConversationStateView {
  readonly conversationId: string;
  /** Most recently referenced project (slug or title), or `null`. */
  readonly activeProject: string | null;
  /** A short label for what AYAS is currently helping with, or `null`. */
  readonly activeTopic: string | null;
  /** The pipeline stage last discussed, or `null`. */
  readonly activeStage: string | null;
  /** The user's last message, trimmed — the thing `devam et` / `bunu da` extends. */
  readonly lastUserText: string | null;
  /** AYAS's last reply, trimmed — the thing `bir önceki` / `onu` may point at. */
  readonly lastAssistantText: string | null;
  /** Questions AYAS asked that the user has not answered yet. */
  readonly unresolvedQuestions: readonly string[];
  /** Entities seen in the conversation, most-recent first, capped. */
  readonly recentEntities: readonly AyasConversationEntity[];
  /** Turn count fed in (post-system-filter). */
  readonly turnCount: number;
}

export const EMPTY_AYAS_CONVERSATION_STATE: AyasConversationStateView = Object.freeze({
  conversationId: "c0",
  activeProject: null,
  activeTopic: null,
  activeStage: null,
  lastUserText: null,
  lastAssistantText: null,
  unresolvedQuestions: [],
  recentEntities: [],
  turnCount: 0,
});

const MAX_ENTITIES = 8;
const MAX_UNRESOLVED = 3;

const STAGE_WORDS = [
  "research",
  "script",
  "scenes",
  "visuals",
  "animation",
  "audio",
  "video",
  "assembly",
  "thumbnail",
  "seo",
  "youtube",
  "export",
];

function fold(text: string): string {
  return String(text ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[İıI]/g, "i")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g");
}

/** A trailing "?" clause AYAS emitted that reads as a question to the user. */
function pendingQuestion(assistantText: string): string | null {
  const trimmed = assistantText.trim();
  if (!trimmed.endsWith("?")) return null;
  // the last sentence ending in "?"
  const parts = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  const last = parts[parts.length - 1] ?? trimmed;
  return last.length <= 200 ? last : null;
}

/**
 * Deterministically derive the conversation state. `history` is the same
 * `{role,text}[]` the chat route already has; system/welcome turns are filtered.
 */
export function deriveAyasConversationState(
  history: readonly { readonly role: BrainChatMessage["role"]; readonly text: string }[],
  options: {
    readonly conversationId?: string;
    readonly studio?: AyasStudioContextView;
  } = {},
): AyasConversationStateView {
  const turns = history.filter((t) => t.role !== "system" && typeof t.text === "string" && t.text.trim());
  if (turns.length === 0) {
    return { ...EMPTY_AYAS_CONVERSATION_STATE, conversationId: options.conversationId ?? "c0" };
  }

  const knownProjects: { slugFold: string; titleFold: string; display: string }[] = (options.studio?.available
    ? options.studio.projects.sample
    : []
  ).map((p) => ({
    slugFold: fold(p.slug),
    titleFold: fold(p.title || p.slug),
    display: (p.title || p.slug).trim(),
  }));

  const entities = new Map<string, AyasConversationEntity>();
  const note = (value: string, kind: AyasConversationEntity["kind"], turn: number) => {
    const key = `${kind}:${value}`;
    const prev = entities.get(key);
    if (!prev || turn > prev.lastTurn) entities.set(key, { value, kind, lastTurn: turn });
  };

  let activeProject: string | null = null;
  let activeStage: string | null = null;
  let lastUserText: string | null = null;
  let lastAssistantText: string | null = null;
  const unresolved: string[] = [];

  turns.forEach((turn, i) => {
    const idx = i + 1;
    const folded = fold(turn.text);

    for (const p of knownProjects) {
      if (
        (p.slugFold && folded.includes(p.slugFold)) ||
        (p.titleFold && p.titleFold.length > 3 && folded.includes(p.titleFold))
      ) {
        note(p.display, "project", idx);
        activeProject = p.display;
      }
    }
    for (const stage of STAGE_WORDS) {
      if (new RegExp(`\\b${stage}\\b`).test(folded)) {
        note(stage, "stage", idx);
        activeStage = stage;
      }
    }
    for (const m of turn.text.matchAll(/(?:[A-Za-z]:\\|\/)[\w.\\/-]{2,}/g)) {
      note(m[0], "path", idx);
    }

    if (turn.role === "user") {
      lastUserText = turn.text.trim();
      // answering clears the most recent pending question
      if (unresolved.length && turn.text.trim().length > 0) unresolved.length = 0;
    } else {
      lastAssistantText = turn.text.trim();
      const q = pendingQuestion(turn.text);
      if (q) {
        unresolved.length = 0;
        unresolved.push(q);
      }
    }
  });

  const recentEntities = [...entities.values()]
    .sort((a, b) => b.lastTurn - a.lastTurn || a.value.localeCompare(b.value))
    .slice(0, MAX_ENTITIES);

  const activeTopic =
    activeProject ??
    recentEntities.find((e) => e.kind === "topic")?.value ??
    (activeStage ? `${activeStage} aşaması` : null);

  return {
    conversationId: options.conversationId ?? "c0",
    activeProject,
    activeTopic,
    activeStage,
    lastUserText,
    lastAssistantText,
    unresolvedQuestions: unresolved.slice(0, MAX_UNRESOLVED),
    recentEntities,
    turnCount: turns.length,
  };
}
