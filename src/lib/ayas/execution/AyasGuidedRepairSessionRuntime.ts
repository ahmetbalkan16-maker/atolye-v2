import { AyasGuidedRepairConversation, type AyasGuidedRepairConversationDeps, type AyasRepairConversationResult } from "./AyasGuidedRepairConversation";

export interface AyasGuidedRepairProductTurn { readonly sessionId: string; readonly text: string; readonly turnId: string; readonly workspaceId: string; }

/** Bounded request-to-request session owner used by the real chat route. */
export class AyasGuidedRepairSessionRuntime {
  private readonly sessions = new Map<string, { conversation: AyasGuidedRepairConversation; touchedAt: number }>();
  constructor(private readonly makeDeps: () => AyasGuidedRepairConversationDeps, private readonly maxSessions = 100, private readonly sessionTtlMs = 30 * 60 * 1000, private readonly now = () => Date.now()) {}

  async handle(turn: AyasGuidedRepairProductTurn): Promise<AyasRepairConversationResult> {
    this.prune();
    let entry = this.sessions.get(turn.sessionId);
    if (!entry) {
      entry = { conversation: new AyasGuidedRepairConversation(this.makeDeps()), touchedAt: this.now() };
      this.sessions.set(turn.sessionId, entry);
    }
    entry.touchedAt = this.now();
    return entry.conversation.handleUserTurn(turn.text, turn.turnId, turn.workspaceId);
  }

  pending(sessionId: string) { return this.sessions.get(sessionId)?.conversation.getPendingProposal(); }
  clear(sessionId: string): void { this.sessions.delete(sessionId); }

  private prune(): void {
    const cutoff = this.now() - this.sessionTtlMs;
    for (const [key, entry] of this.sessions) if (entry.touchedAt <= cutoff) this.sessions.delete(key);
    while (this.sessions.size >= this.maxSessions) this.sessions.delete(this.sessions.keys().next().value as string);
  }
}
