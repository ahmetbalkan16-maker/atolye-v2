import { AyasGuidedRepairConversation, type AyasGuidedRepairConversationDeps, type AyasRepairConversationResult } from "./AyasGuidedRepairConversation";
import { AyasGuidedRepairSessionStore } from "./AyasGuidedRepairSessionStore";
import { AyasDeveloperWorkflowStore } from "./AyasDeveloperWorkflowStore";
import type { AyasDeveloperWorkflow } from "./AyasDeveloperWorkflow";
import { classifyAyasWorkflowRecovery } from "./AyasWorkflowRecovery";

export interface AyasGuidedRepairProductTurn { readonly sessionId: string; readonly text: string; readonly turnId: string; readonly workspaceId: string; }

/**
 * Durable Workflow Persistence sprint — OPTIONAL durability wiring. Omitting
 * this (the 5th constructor argument) is byte-for-byte the pre-existing
 * in-memory-only behaviour; every existing caller is unaffected.
 */
export interface AyasGuidedRepairDurability {
  readonly sessionStore: AyasGuidedRepairSessionStore;
  readonly workflowStore: AyasDeveloperWorkflowStore;
  /** For staleness re-check on recovery — see `AyasWorkflowRecovery.ts`. */
  readonly workspaceRoot: string;
}

/** Bounded request-to-request session owner used by the real chat route. */
export class AyasGuidedRepairSessionRuntime {
  private readonly sessions = new Map<string, { conversation: AyasGuidedRepairConversation; touchedAt: number }>();
  constructor(
    private readonly makeDeps: () => AyasGuidedRepairConversationDeps,
    private readonly maxSessions = 100,
    private readonly sessionTtlMs = 30 * 60 * 1000,
    private readonly now = () => Date.now(),
    private readonly durability?: AyasGuidedRepairDurability,
  ) {}

  async handle(turn: AyasGuidedRepairProductTurn): Promise<AyasRepairConversationResult> {
    this.prune();
    let entry = this.sessions.get(turn.sessionId);
    if (!entry) {
      entry = { conversation: this.createConversation(turn.sessionId, turn.workspaceId), touchedAt: this.now() };
      this.sessions.set(turn.sessionId, entry);
      this.recoverInto(entry.conversation, turn.sessionId, turn.workspaceId);
    }
    entry.touchedAt = this.now();
    return entry.conversation.handleUserTurn(turn.text, turn.turnId, turn.workspaceId);
  }

  pending(sessionId: string) { return this.sessions.get(sessionId)?.conversation.getPendingProposal(); }
  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
    try { this.durability?.sessionStore.clear(sessionId); } catch { /* a persistence failure never blocks an explicit clear */ }
  }

  /* ------------------------------------------------------------- internals --- */

  private createConversation(sessionId: string, workspaceId: string): AyasGuidedRepairConversation {
    const baseDeps = this.makeDeps();
    if (!this.durability) return new AyasGuidedRepairConversation(baseDeps);
    const { sessionStore, workflowStore } = this.durability;
    return new AyasGuidedRepairConversation({
      ...baseDeps,
      onPendingChange: (pending) => {
        try {
          sessionStore.save(
            sessionId,
            workspaceId,
            pending
              ? { proposal: pending.proposal, patches: pending.patches, ...(pending.remediationPatches ? { remediationPatches: pending.remediationPatches } : {}), ...(pending.workflow ? { workflowId: pending.workflow.workflowId } : {}), createdAtMs: pending.createdAtMs }
              : undefined,
          );
        } catch { /* a persistence failure never blocks or fails the conversation turn itself */ }
      },
      onWorkflowCheckpoint: (workflow) => {
        try { workflowStore.save(workflow); } catch { /* same */ }
      },
    });
  }

  /**
   * Restart-safe recovery: called once, right after a session's conversation
   * is created (never mid-turn otherwise). A corrupt session record, a
   * missing/corrupt referenced workflow, a workspace-id mismatch, or a
   * workflow that recovery classifies as anything other than `recoverable`
   * / `awaiting-authorization` (terminal, stale, corrupt, unsupported
   * -schema, blocked) all result in starting the session FRESH rather than
   * restoring a possibly-unsafe pending state — never throws into the turn.
   */
  private recoverInto(conversation: AyasGuidedRepairConversation, sessionId: string, workspaceId: string): void {
    if (!this.durability) return;
    const { sessionStore, workflowStore, workspaceRoot } = this.durability;
    let record: ReturnType<typeof sessionStore.tryLoad>;
    try { record = sessionStore.tryLoad(sessionId); } catch { return; }
    if (!record?.pending || record.workspaceId !== workspaceId) return;
    let workflow: AyasDeveloperWorkflow | undefined;
    if (record.pending.workflowId) {
      let loaded: ReturnType<typeof workflowStore.tryLoad>;
      try { loaded = workflowStore.tryLoad(record.pending.workflowId); } catch { return; }
      if (!loaded) return;
      const classification = classifyAyasWorkflowRecovery({ workflow: loaded.workflow, workspaceRoot });
      if (classification.classification !== "awaiting-authorization" && classification.classification !== "recoverable") return;
      workflow = classification.workflow;
    }
    conversation.restorePending({
      proposal: record.pending.proposal,
      patches: record.pending.patches,
      ...(record.pending.remediationPatches ? { remediationPatches: record.pending.remediationPatches } : {}),
      ...(workflow ? { workflow } : {}),
      createdAtMs: record.pending.createdAtMs,
    });
  }

  private prune(): void {
    const cutoff = this.now() - this.sessionTtlMs;
    for (const [key, entry] of this.sessions) if (entry.touchedAt <= cutoff) this.sessions.delete(key);
    while (this.sessions.size >= this.maxSessions) this.sessions.delete(this.sessions.keys().next().value as string);
  }
}
