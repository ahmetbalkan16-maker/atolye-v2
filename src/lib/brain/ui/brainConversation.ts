/**
 * Atölye Brain — conversation persistence (pure).
 *
 * The Brain chat transcript is in-memory only. On iPhone the page is reloaded
 * from `start_url` every few minutes (screen Auto-Lock → WebKit eviction, or a
 * memory kill) — and each reload wiped the transcript and re-seeded the welcome
 * message, so AYAS "re-introduced itself" and lost every earlier turn's context.
 *
 * This module is the deterministic core of a `sessionStorage`-backed transcript
 * that survives a reload within the same tab:
 *   - a stable `conversationId` + a monotonic `turnSeq` (message ids no longer
 *     derive from `messages.length`, which resets on reload);
 *   - a bounded, TTL'd serialisation (a stale tab must not resurrect an ancient
 *     chat);
 *   - `conversationHistoryForModel` — the last N turns WITHOUT the `system`
 *     welcome line, so the model is never prompted to re-introduce AYAS.
 *
 * No DOM, no storage here — `BrainCoreConsole` wires `sessionStorage`.
 */

export const BRAIN_CONVERSATION_KEY = "ayas.brain.conversation.v1";
/** Keep at most this many messages in storage (newest kept). */
export const BRAIN_CONVERSATION_MAX_MESSAGES = 60;
/** A saved transcript older than this is dropped — a fresh session starts clean. */
export const BRAIN_CONVERSATION_TTL_MS = 6 * 60 * 60 * 1000;

export interface BrainConversationMessage {
  readonly id: string;
  readonly role: "user" | "brain" | "system";
  readonly text: string;
}

export interface PersistedBrainConversation {
  readonly conversationId: string;
  /** Next turn ordinal — a user turn takes `turnSeq`, its reply `turnSeq + 1`. */
  readonly turnSeq: number;
  readonly savedAt: number;
  readonly messages: readonly BrainConversationMessage[];
}

function isMessage(v: unknown): v is BrainConversationMessage {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    (m.role === "user" || m.role === "brain" || m.role === "system") &&
    typeof m.text === "string"
  );
}

/** Parse a stored transcript, tolerating any corruption; `null` past the TTL. */
export function parsePersistedConversation(
  raw: string | null,
  nowMs: number,
): PersistedBrainConversation | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PersistedBrainConversation>;
    if (typeof v.conversationId !== "string" || !Array.isArray(v.messages)) return null;
    const savedAt = typeof v.savedAt === "number" ? v.savedAt : 0;
    if (nowMs - savedAt > BRAIN_CONVERSATION_TTL_MS) return null;
    const messages = v.messages.filter(isMessage);
    if (messages.length === 0) return null;
    const turnSeq =
      typeof v.turnSeq === "number" && v.turnSeq >= 0 ? Math.floor(v.turnSeq) : messages.length;
    return { conversationId: v.conversationId, turnSeq, savedAt, messages };
  } catch {
    return null;
  }
}

/** Serialise, capping to the newest `BRAIN_CONVERSATION_MAX_MESSAGES`. */
export function serializeConversation(input: {
  readonly conversationId: string;
  readonly turnSeq: number;
  readonly messages: readonly BrainConversationMessage[];
  readonly nowMs: number;
}): string {
  const trimmed = input.messages.slice(-BRAIN_CONVERSATION_MAX_MESSAGES);
  const record: PersistedBrainConversation = {
    conversationId: input.conversationId,
    turnSeq: input.turnSeq,
    savedAt: input.nowMs,
    messages: trimmed,
  };
  return JSON.stringify(record);
}

/** A fresh conversation id — short, random, not derived from anything sensitive. */
export function newConversationId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return "c" + crypto.randomUUID().slice(0, 12).replace(/-/g, "");
    }
  } catch {
    /* fall through */
  }
  return "c" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
}

/**
 * The history fed to the model: the last `turns` NON-system messages. The
 * `system` welcome line is dropped so the model never treats "Ben AYAS…" as
 * conversational context and echoes an introduction.
 */
export function conversationHistoryForModel(
  messages: readonly BrainConversationMessage[],
  turns: number,
): { readonly role: "user" | "brain"; readonly text: string }[] {
  return messages
    .filter((m): m is BrainConversationMessage & { role: "user" | "brain" } => m.role !== "system")
    .slice(-Math.max(0, turns))
    .map((m) => ({ role: m.role, text: m.text }));
}

/** Should the welcome message be shown? Only for a genuinely new conversation. */
export function shouldSeedWelcome(restored: PersistedBrainConversation | null): boolean {
  return restored === null || restored.messages.length === 0;
}
