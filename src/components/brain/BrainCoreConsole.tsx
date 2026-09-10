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

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { BrainConsoleView } from "./BrainConsoleView";
import {
  AYAS_HISTORY_TURNS,
  brainDeterministicReply,
  brainWelcomeMessage,
  deriveBrainCoreState,
  type BrainChatMessage,
  type BrainCoreState,
  type BrainPanelId,
} from "./brainCore";
import { ayasVoiceHoldsScreenAwake, shouldAutoSpeakAyasReply } from "./ayasVoice";
import { useAyasVoice } from "./useAyasVoice";
import { useBrainLifecycle } from "./useBrainLifecycle";
import { useScreenWakeLock } from "./useScreenWakeLock";
import { runAyasChatStream } from "./ayasChatStreamClient";
import {
  BRAIN_CONVERSATION_KEY,
  conversationHistoryForModel,
  newConversationId,
  parsePersistedConversation,
  serializeConversation,
  shouldSeedWelcome,
} from "@/lib/brain/ui/brainConversation";
import type { BrainConsoleSnapshot } from "@/lib/brain/ui/BrainConsoleSnapshot";
import type { AyasAutonomousView } from "@/lib/brain/autonomy/AyasAutonomousView";
import type { BrainSelfHealSnapshot } from "@/lib/brain/selfheal/BrainSelfHealSnapshot";

/** `useSyncExternalStore` subscribe: the browser's own connectivity signal. */
function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}
/** `useSyncExternalStore` subscribe for a value that never changes after load. */
const noopSubscribe = (): (() => void) => () => {};

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
  /** Read-only self-healing state for the Self-Healing panel. */
  readonly initialSelfHeal?: (BrainSelfHealSnapshot & { readonly error?: string | null }) | null;
  readonly modelConfigured?: boolean;
  /** Server Action that re-reads the snapshot (read-only). */
  readonly refresh?: () => Promise<BrainConsoleSnapshot>;
  /** Server Action that asks the local model (falls back to deterministic). */
  readonly askAyas?: AskAyasFn;
  /**
   * Try `/api/ayas/chat/stream` (token streaming) before the `askAyas` Server
   * Action. Any transport / stream failure falls back to `askAyas`. Default on.
   */
  readonly streaming?: boolean;
}

export function BrainCoreConsole({
  initialSnapshot,
  initialAutonomous,
  initialSelfHeal,
  modelConfigured,
  refresh,
  askAyas,
  streaming = true,
}: BrainCoreConsoleProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [activePanel, setActivePanel] = useState<BrainPanelId>("chat");
  const [draft, setDraft] = useState("");

  // Restore the transcript from sessionStorage so an iPhone reload (screen
  // Auto-Lock eviction / memory kill) does NOT wipe the conversation and make
  // AYAS re-introduce itself. A stable conversationId + monotonic turnSeq drive
  // message ids — never `messages.length`, which resets on reload. The restore
  // runs post-mount (a microtask, to keep SSR clean and the lint happy): the
  // server + first client paint show the welcome line, then the transcript
  // swaps in — one extra render, no hydration mismatch.
  const conversationIdRef = useRef<string | null>(null);
  if (conversationIdRef.current === null) conversationIdRef.current = newConversationId();
  const turnSeqRef = useRef(1);
  const [messages, setMessages] = useState<readonly BrainChatMessage[]>(() => [
    brainWelcomeMessage(initialSnapshot),
  ]);
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    queueMicrotask(() => {
      let prev: ReturnType<typeof parsePersistedConversation> = null;
      try {
        prev = parsePersistedConversation(window.sessionStorage.getItem(BRAIN_CONVERSATION_KEY), Date.now());
      } catch {
        prev = null;
      }
      if (prev && !shouldSeedWelcome(prev)) {
        conversationIdRef.current = prev.conversationId;
        turnSeqRef.current = prev.turnSeq;
        setMessages(prev.messages as readonly BrainChatMessage[]);
      }
    });
  }, []);

  // Persist the transcript on every change + on the way out (a reload can land
  // before an effect flushes). Bounded + TTL'd in `serializeConversation`.
  const persistConversation = useCallback((msgs: readonly BrainChatMessage[]) => {
    try {
      window.sessionStorage.setItem(
        BRAIN_CONVERSATION_KEY,
        serializeConversation({
          conversationId: conversationIdRef.current ?? "c0",
          turnSeq: turnSeqRef.current,
          messages: msgs,
          nowMs: Date.now(),
        }),
      );
    } catch {
      /* private mode / quota — transcript persistence is best-effort */
    }
  }, []);
  useEffect(() => {
    persistConversation(messages);
  }, [messages, persistConversation]);
  useEffect(() => {
    const flush = () => persistConversation(messages);
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [messages, persistConversation]);
  const [lastReplySource, setLastReplySource] = useState<"llm" | "fallback" | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const [chatPending, startChat] = useTransition();

  // Coarse client reachability for the AYAS presence card — the browser's own
  // `online`/`offline` signal + whether the last read-only refresh threw. NO
  // polling, NO heartbeat, no new network call of any kind. `useSyncExternalStore`
  // keeps it SSR-safe (server snapshot: online + secure).
  const [refreshFailed, setRefreshFailed] = useState(false);
  const browserOnline = useSyncExternalStore(
    subscribeOnline,
    () => window.navigator.onLine !== false,
    () => true,
  );
  const secureContext = useSyncExternalStore(
    noopSubscribe,
    () => window.isSecureContext !== false,
    () => true,
  );

  const connectivity: "online" | "degraded" | "offline" = !browserOnline
    ? "offline"
    : refreshFailed
      ? "degraded"
      : "online";

  // A stable indirection so `useAyasVoice` never re-subscribes when the chat
  // runner's identity changes. A voice command and a typed message run the
  // exact same path — text in, text (and speech) out.
  const runAyasRef = useRef<(text: string) => void>(() => {});
  const handleVoiceCommand = useCallback((text: string) => runAyasRef.current(text), []);
  const voice = useAyasVoice({ onCommand: handleVoiceCommand });

  // Detect an unexpected reload (iOS eviction / SW update) that interrupted a
  // voice session, so the UI can offer to resume it. Records secret-free
  // lifecycle telemetry in sessionStorage for the Voice Lab.
  const lifecycle = useBrainLifecycle();

  // Keep the phone from auto-locking (and then evicting + reloading this page)
  // mid-conversation — while hands-free is armed or AYAS is speaking/thinking.
  // The held/lost status feeds the lifecycle heartbeat: "the screen lock was NOT
  // holding right before the reload" is the tell of a background eviction.
  const noteWakeLock = lifecycle.noteWakeLock;
  useScreenWakeLock(ayasVoiceHoldsScreenAwake(voice.state, voice.listening), noteWakeLock);
  useEffect(() => {
    lifecycle.markVoiceActive(voice.listening);
  }, [voice.listening, lifecycle]);
  useEffect(() => {
    if (voice.recovering) lifecycle.noteRecovery();
  }, [voice.recovering, lifecycle]);
  const prevCyclesRef = useRef(0);
  useEffect(() => {
    if (voice.wakeCycles > prevCyclesRef.current) {
      prevCyclesRef.current = voice.wakeCycles;
      lifecycle.noteVoiceCycle();
    }
  }, [voice.wakeCycles, lifecycle]);
  useEffect(() => {
    lifecycle.notePhase(voice.state);
  }, [voice.state, lifecycle]);
  // Fold the wake-adapter's back-pressure / context numbers into the lifecycle
  // heartbeat — this is what the NEXT boot reads to say where the page died.
  useEffect(() => {
    const h = voice.voiceHealth;
    if (!h) return;
    lifecycle.noteVoiceHealth({
      phase: h.phase,
      droppedFrames: h.droppedFrames,
      audioContextState: h.audioContextState,
      lastCaptureMs: h.lastCaptureMs,
      lastSttMs: h.lastSttMs,
      lastWakeToCaptureMs: h.lastWakeToCaptureMs,
      lastError: h.lastError,
    });
  }, [voice.voiceHealth, lifecycle]);
  // Persist "the user wants hands-free voice" across reloads so the resume
  // prompt survives repeated browser kills.
  useEffect(() => {
    if (voice.listening) lifecycle.setVoiceIntent(true);
  }, [voice.listening, lifecycle]);

  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  const runAyas = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      const activeVoice = voiceRef.current;
      // Stable ids from a persisted monotonic ordinal — a user turn takes `seq`,
      // its reply `seq + 1`. Survives a reload (unlike `messages.length`).
      const seq = turnSeqRef.current;
      turnSeqRef.current = seq + 2;
      const cid = conversationIdRef.current ?? "c0";
      const userMessage: BrainChatMessage = { id: `${cid}-u${seq}`, role: "user", text };
      setMessages((current) => [...current, userMessage]);
      setDraft("");

      // History for the model: last N NON-system turns (the welcome line is
      // dropped so the model is never cued to re-introduce AYAS).
      const history = conversationHistoryForModel([...messages, userMessage], AYAS_HISTORY_TURNS);

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

      const replyId = `${cid}-b${seq + 1}`;
      const finalizeSpeech = (finalText: string) => {
        const v = voiceRef.current;
        if (shouldAutoSpeakAyasReply({ ttsAvailable: v.capability.tts, muted: v.muted })) v.speak(finalText);
        else v.markIdle();
      };

      startChat(async () => {
        // 1 — try token streaming.
        if (streaming) {
          let streamText = "";
          let opened = false;
          const streamResult = await runAyasChatStream({
            text,
            history,
            seq: seq + 1,
            onDelta: (delta) => {
              streamText += delta;
              setMessages((current) => {
                if (!opened) {
                  opened = true;
                  return [...current, { id: replyId, role: "brain", text: streamText }];
                }
                return current.map((m) => (m.id === replyId ? { ...m, text: streamText } : m));
              });
            },
          });
          if (streamResult.ok) {
            setLastReplySource(streamResult.source);
            setMessages((current) => {
              const exists = current.some((m) => m.id === replyId);
              const msg: BrainChatMessage = { id: replyId, role: "brain", text: streamResult.text };
              return exists ? current.map((m) => (m.id === replyId ? msg : m)) : [...current, msg];
            });
            finalizeSpeech(streamResult.text);
            return;
          }
          // stream failed before/after opening — drop any partial and fall back.
          if (opened) setMessages((current) => current.filter((m) => m.id !== replyId));
        }

        // 2 — fall back to the Server Action.
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
    [askAyas, messages, snapshot, startChat, streaming],
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
        setRefreshFailed(false);
      } catch {
        /* keep the last good snapshot; mark the link as degraded */
        setRefreshFailed(true);
      }
    });
  };

  // The AYAS presence-card CTA: drop into the EXISTING chat/voice experience —
  // select the chat panel and, when this device can hear, start listening
  // inside this click's user gesture (iOS needs that). No new path.
  const dismissInterrupted = lifecycle.dismissInterrupted;
  const setVoiceIntent = lifecycle.setVoiceIntent;
  const startConversation = useCallback(() => {
    setActivePanel("chat");
    dismissInterrupted();
    const v = voiceRef.current;
    // A paused wake pipeline: this click is the gesture that lets iOS hand the
    // mic back — retry now rather than toggling listening.
    if (v.voicePaused) {
      v.retryVoice();
      return;
    }
    if (v.capability.stt && !v.listening) v.toggleListening();
  }, [dismissInterrupted]);

  // Explicit "turn voice off" — forget the persisted intent so a later reload
  // does not re-offer to resume a session the user deliberately ended.
  const stopListening = useCallback(() => {
    setVoiceIntent(false);
    dismissInterrupted();
    voiceRef.current.stopListening();
  }, [setVoiceIntent, dismissInterrupted]);

  // After a reload interrupted a voice session, the FIRST touch anywhere on the
  // page is the user activation iOS needs — resume from it, so the operator
  // never has to hunt for the CTA. (One-shot; the CTA still works too.)
  useEffect(() => {
    if (!lifecycle.voiceSessionInterrupted) return;
    const resume = () => startConversation();
    window.addEventListener("pointerdown", resume, { once: true, capture: true });
    return () => window.removeEventListener("pointerdown", resume, { capture: true } as EventListenerOptions);
  }, [lifecycle.voiceSessionInterrupted, startConversation]);

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
      selfHeal={initialSelfHeal ?? null}
      voice={{
        state: voice.state,
        capability: voice.capability,
        listening: voice.listening,
        recognitionMode: voice.recognitionMode,
        muted: voice.muted,
        disclosureAccepted: voice.disclosureAccepted,
        errorMessage: voice.errorMessage,
        pendingSpeech: voice.pendingSpeech,
        voiceName: voice.voiceName,
        voiceTier: voice.voiceTier,
        recovering: voice.recovering,
        paused: voice.voicePaused,
        onToggleListening: voice.toggleListening,
        onStopListening: stopListening,
        onToggleMute: voice.toggleMute,
        onAcceptDisclosure: voice.acceptDisclosure,
        onReplayPendingSpeech: voice.replayPendingSpeech,
      }}
      connectivity={connectivity}
      secureContext={secureContext}
      voiceSessionInterrupted={lifecycle.voiceSessionInterrupted}
      onSelectPanel={setActivePanel}
      onDraftChange={setDraft}
      onSend={send}
      onRefresh={refresh ? doRefresh : undefined}
      onStartConversation={startConversation}
    />
  );
}

export default BrainCoreConsole;
