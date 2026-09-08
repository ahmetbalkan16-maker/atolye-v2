"use client";

/**
 * AYAS / Brain Core — interactive console (Sprint 186, voice experience Sprint 187).
 *
 * The client shell around {@link BrainConsoleView}. It owns the transient UI
 * state (active panel, chat transcript, input draft), calls the `askAyas`
 * Server Action for a real reply from the local model (falling back to the
 * deterministic reply on any failure), and drives the voice engine.
 *
 * Voice: every successful reply — typed OR spoken — is read aloud automatically
 * when voice output is available and not muted. The flow is THINKING → (reply)
 * → SPEAKING → IDLE, mirrored on the orb. A blocked auto-speech degrades to a
 * manual replay button; the text reply is always shown regardless.
 *
 * There is NO client `fetch`, no polling loop, and no animation timer. The
 * execution gate stays closed — chat and voice are text/audio in, text/audio
 * out; nothing here runs a task, a pipeline, or the GPU. A voice command is
 * delivered to the exact same `runAyas` path as a typed one.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { BrainConsoleView } from "./BrainConsoleView";
import {
  brainDeterministicReply,
  brainWelcomeMessage,
  deriveBrainCoreState,
  type BrainChatMessage,
  type BrainCoreState,
  type BrainPanelId,
} from "./brainCore";
import { shouldAutoSpeakAyasReply } from "./ayasVoice";
import { useAyasVoice } from "./useAyasVoice";
import type { BrainConsoleSnapshot } from "@/lib/brain/ui/BrainConsoleSnapshot";
import type { AyasAutonomousView } from "@/lib/brain/autonomy/AyasAutonomousView";

export interface AskAyasFn {
  (input: {
    text: string;
    history: readonly { role: BrainChatMessage["role"]; text: string }[];
    seq: number;
  }): Promise<{ message: BrainChatMessage; source: "llm" | "fallback" }>;
}

export interface BrainCoreConsoleProps {
  readonly initialSnapshot: BrainConsoleSnapshot;
  readonly initialAutonomous?: AyasAutonomousView;
  readonly modelConfigured?: boolean;
  /** Server Action that re-reads the snapshot (read-only). */
  readonly refresh?: () => Promise<BrainConsoleSnapshot>;
  /** Server Action that asks the local model (falls back to deterministic). */
  readonly askAyas?: AskAyasFn;
}

export function BrainCoreConsole({
  initialSnapshot,
  initialAutonomous,
  modelConfigured,
  refresh,
  askAyas,
}: BrainCoreConsoleProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [activePanel, setActivePanel] = useState<BrainPanelId>("chat");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<readonly BrainChatMessage[]>(() => [
    brainWelcomeMessage(initialSnapshot),
  ]);
  const [lastReplySource, setLastReplySource] = useState<"llm" | "fallback" | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const [chatPending, startChat] = useTransition();

  // A stable indirection so `useAyasVoice` never re-subscribes when the chat
  // runner's identity changes. A voice command and a typed message run the
  // exact same path — text in, text (and speech) out.
  const runAyasRef = useRef<(text: string) => void>(() => {});
  const handleVoiceCommand = useCallback((text: string) => runAyasRef.current(text), []);
  const voice = useAyasVoice({ onCommand: handleVoiceCommand });

  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  const runAyas = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      const activeVoice = voiceRef.current;
      const seq = messages.length;
      const userMessage: BrainChatMessage = { id: `user-${seq}`, role: "user", text };
      setMessages((current) => [...current, userMessage]);
      setDraft("");

      const history = messages.slice(-6).map((message) => ({ role: message.role, text: message.text }));

      const deliverReply = (reply: BrainChatMessage) => {
        setMessages((current) => [...current, reply]);
        // Read voice state at delivery time — the user may have muted / unmuted
        // while the model was thinking.
        const v = voiceRef.current;
        const autoSpeak = shouldAutoSpeakAyasReply({
          ttsAvailable: v.capability.tts,
          muted: v.muted,
        });
        if (autoSpeak) v.speak(reply.text);
        else v.markIdle();
      };

      activeVoice.markThinking();

      if (!askAyas) {
        const reply = brainDeterministicReply(text, snapshot, seq + 1);
        setLastReplySource("fallback");
        deliverReply(reply);
        return;
      }

      startChat(async () => {
        let result: { message: BrainChatMessage; source: "llm" | "fallback" };
        try {
          result = await askAyas({ text, history, seq: seq + 1 });
        } catch {
          result = { message: brainDeterministicReply(text, snapshot, seq + 1), source: "fallback" };
        }
        setLastReplySource(result.source);
        deliverReply(result.message);
      });
    },
    [askAyas, messages, snapshot, startChat],
  );

  useEffect(() => {
    runAyasRef.current = runAyas;
  }, [runAyas]);

  const send = () => runAyas(draft);

  const doRefresh = () => {
    if (!refresh) return;
    startTransition(async () => {
      try {
        setSnapshot(await refresh());
      } catch {
        /* keep the last good snapshot */
      }
    });
  };

  const restingState = useMemo(() => deriveBrainCoreState(snapshot), [snapshot]);
  const autonomousWaiting = (initialAutonomous?.awaitingApprovalCount ?? 0) > 0;
  const coreState: BrainCoreState =
    restingState === "error"
      ? "error"
      : voice.state === "speaking"
        ? "speaking"
        : voice.state === "listening"
          ? "listening"
          : voice.state === "thinking" || chatPending || pending
            ? "thinking"
            : restingState === "warning"
              ? "warning"
              : voice.state === "error"
                ? "warning"
                : draft.trim().length > 0
                  ? "active"
                  : autonomousWaiting && restingState === "idle"
                    ? "autonomous"
                    : restingState;

  return (
    <BrainConsoleView
      snapshot={snapshot}
      coreState={coreState}
      activePanel={activePanel}
      messages={messages}
      draft={draft}
      refreshing={pending}
      chatPending={chatPending}
      modelConfigured={modelConfigured}
      lastReplySource={lastReplySource}
      autonomous={initialAutonomous}
      voice={{
        state: voice.state,
        capability: voice.capability,
        listening: voice.listening,
        muted: voice.muted,
        disclosureAccepted: voice.disclosureAccepted,
        errorMessage: voice.errorMessage,
        pendingSpeech: voice.pendingSpeech,
        voiceName: voice.voiceName,
        voiceTier: voice.voiceTier,
        onToggleListening: voice.toggleListening,
        onToggleMute: voice.toggleMute,
        onAcceptDisclosure: voice.acceptDisclosure,
        onReplayPendingSpeech: voice.replayPendingSpeech,
      }}
      onSelectPanel={setActivePanel}
      onDraftChange={setDraft}
      onSend={send}
      onRefresh={refresh ? doRefresh : undefined}
    />
  );
}

export default BrainCoreConsole;
