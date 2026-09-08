"use client";

/**
 * Atölye Brain Core — interactive console (Sprint 184).
 *
 * The client shell around {@link BrainConsoleView}. It owns three pieces of
 * transient UI state — the active panel, the chat transcript, the input draft —
 * and layers transient core states (`active` while typing, `thinking` while a
 * refresh runs) on top of the snapshot-derived resting state.
 *
 * It calls a single Server Action to re-read the snapshot. There is NO client
 * `fetch`, no polling loop, no timer. Chat replies are deterministic and local
 * (the LLM roles are a separate, approved phase).
 */

import { useMemo, useState, useTransition } from "react";

import { BrainConsoleView } from "./BrainConsoleView";
import {
  brainDeterministicReply,
  brainWelcomeMessage,
  deriveBrainCoreState,
  type BrainChatMessage,
  type BrainCoreState,
  type BrainPanelId,
} from "./brainCore";
import type { BrainConsoleSnapshot } from "@/lib/brain/ui/BrainConsoleSnapshot";

export interface BrainCoreConsoleProps {
  readonly initialSnapshot: BrainConsoleSnapshot;
  /** Server Action that re-reads the snapshot (read-only). */
  readonly refresh?: () => Promise<BrainConsoleSnapshot>;
}

export function BrainCoreConsole({ initialSnapshot, refresh }: BrainCoreConsoleProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [activePanel, setActivePanel] = useState<BrainPanelId>("chat");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<readonly BrainChatMessage[]>(() => [
    brainWelcomeMessage(initialSnapshot),
  ]);
  const [pending, startTransition] = useTransition();

  const restingState = useMemo(() => deriveBrainCoreState(snapshot), [snapshot]);
  const coreState: BrainCoreState = pending
    ? "thinking"
    : draft.trim().length > 0
      ? "active"
      : restingState;

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const seq = messages.length;
    const userMessage: BrainChatMessage = { id: `user-${seq}`, role: "user", text };
    const reply = brainDeterministicReply(text, snapshot, seq + 1);
    setMessages((current) => [...current, userMessage, reply]);
    setDraft("");
  };

  const doRefresh = () => {
    if (!refresh) return;
    startTransition(async () => {
      try {
        const next = await refresh();
        setSnapshot(next);
      } catch {
        /* keep the last good snapshot; the view still shows prior errors */
      }
    });
  };

  return (
    <BrainConsoleView
      snapshot={snapshot}
      coreState={coreState}
      activePanel={activePanel}
      messages={messages}
      draft={draft}
      refreshing={pending}
      onSelectPanel={setActivePanel}
      onDraftChange={setDraft}
      onSend={send}
      onRefresh={refresh ? doRefresh : undefined}
    />
  );
}

export default BrainCoreConsole;
