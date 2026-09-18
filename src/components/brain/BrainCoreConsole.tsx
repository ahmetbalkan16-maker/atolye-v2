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
import { runAyasChatStreamWithPhoneFallback } from "./ayasChatStreamClient";
import { bootstrapAyasPhoneKeyFromUrl } from "./ayasPhoneFallback";
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
import type { AyasApprovalInboxView } from "@/lib/brain/autonomy/AyasApprovalInboxView";
import type { AyasMicroBatchDevelopmentView } from "@/lib/brain/autonomy/AyasMicroBatchDevelopmentView";
import type { AyasOwnerRecommendationsView } from "@/lib/brain/autonomy/AyasOwnerRecommendationsView";
import type { AyasApprovalBindingSnapshot } from "@/lib/brain/autonomy/AyasApprovalBinding";
import type { AyasGoalDevelopmentView } from "@/lib/brain/autonomy/AyasGoalDevelopmentView";
import type { AyasResearchEngineStatusView } from "@/lib/brain/autonomy/AyasResearchEngineStatusView";
import type { BrainSelfHealConsoleSnapshot } from "@/lib/brain/ui/BrainSelfHealConsoleSnapshot";
import type { BrainReportStatusFilter } from "@/lib/brain/selfheal/BrainReportCenter";
import type { BrainSelfHealDecisionKind } from "@/lib/brain/selfheal/BrainSelfHealDecision";

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

export interface RecordSelfHealDecisionFn {
  (input: {
    incidentId: string;
    decision: BrainSelfHealDecisionKind;
    note?: string;
  }): Promise<BrainSelfHealConsoleSnapshot>;
}

export interface BrainCoreConsoleProps {
  readonly initialSnapshot: BrainConsoleSnapshot;
  readonly initialAutonomous?: AyasAutonomousView;
  readonly initialApprovalInbox?: AyasApprovalInboxView;
  /** M18 — read-only initial snapshot of the Lane A (MICRO_SAFE) accumulating batch, for the "Küçük Geliştirme Paketi" section. */
  readonly initialMicroBatch?: AyasMicroBatchDevelopmentView;
  readonly initialGoalDevelopment?: AyasGoalDevelopmentView;
  /** AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint — read-only initial snapshot of the research scheduler + source registry status, for the "Araştırma Motoru" section. */
  readonly initialResearchEngineStatus?: AyasResearchEngineStatusView;
  /** Read-only self-healing / Report Center state for the "AYAS Raporları" panel. */
  readonly initialSelfHeal?: BrainSelfHealConsoleSnapshot | null;
  /** Owner-approval model — read-only initial snapshot of AYAS's own filtered recommendations (RECOMMEND_FOR_APPROVAL + executable only). */
  readonly initialOwnerRecommendations?: AyasOwnerRecommendationsView;
  readonly modelConfigured?: boolean;
  /** Server Action that re-reads the snapshot (read-only). */
  readonly refresh?: () => Promise<BrainConsoleSnapshot>;
  /** Server Action that re-reads the self-heal / Report Center snapshot (read-only). */
  readonly refreshSelfHeal?: () => Promise<BrainSelfHealConsoleSnapshot>;
  /** Server Action that records an operator ONAYLA / REDDET / DAHA SONRA decision (no git, no apply). */
  readonly recordSelfHealDecision?: RecordSelfHealDecisionFn;
  readonly refreshApprovalInbox?: () => Promise<AyasApprovalInboxView>;
  /** M18 — Server Action that re-reads the micro-batch (read-only). */
  readonly refreshMicroBatch?: () => Promise<AyasMicroBatchDevelopmentView>;
  /** M22.14 — Server Action that re-reads the goal + external-research state (read-only). */
  readonly refreshGoalDevelopment?: () => Promise<AyasGoalDevelopmentView>;
  /** AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint — Server Action that re-reads the research scheduler + source registry status (read-only). */
  readonly refreshResearchEngineStatus?: () => Promise<AyasResearchEngineStatusView>;
  /** Server Action that records an operator ONAYLA / REDDET / DAHA SONRA approval decision. Session-gated; the safety-classification policy is enforced server-side (Store boundary), not by this prop's presence. */
  readonly decideApproval?: (input: { proposalId: string; decision: "APPROVE" | "REJECT" | "LATER" }) => Promise<AyasApprovalInboxView>;
  /** Server Action that runs an already-APPROVED proposal through Package C's execution authority chain. Session-gated, separate from `decideApproval` — approving never calls this. */
  readonly executeProposal?: (input: { proposalId: string }) => Promise<{ readonly ok: boolean; readonly code?: string; readonly inbox: AyasApprovalInboxView }>;
  /** M18.1 — "BATCH ONAYLA VE UYGULA": Server Action that decides, executes through Package C, Graphify-verifies, and (only if every check passes) commits+pushes the exact reviewed batch — one call, one human authorization. */
  readonly batchOnaylaVeUygula?: (input: { batchId: string; batchHash: string }) => Promise<{ readonly ok: boolean; readonly code?: string; readonly commitSha?: string; readonly microBatch: AyasMicroBatchDevelopmentView }>;
  /** M20.7 — "ONAYLA VE UYGULA": Server Action that does the same for one individual, patch-artifact-backed PRIORITY_SAFE proposal. */
  readonly proposalOnaylaVeUygula?: (input: { proposalId: string; proposalHash: string }) => Promise<{ readonly ok: boolean; readonly code?: string; readonly commitSha?: string; readonly inbox: AyasApprovalInboxView }>;
  /** Owner-approval model — Server Action that re-reads AYAS's own filtered recommendations (read-only). */
  readonly refreshOwnerRecommendations?: () => Promise<AyasOwnerRecommendationsView>;
  /** Owner-approval model — Server Action for the owner's one APPROVE/REJECT on an exact recommendation binding. Session-gated; live execution stays off unless the server's own AYAS_AUTONOMOUS_EXECUTION_ENABLED flag is set. */
  readonly ownerApprovalDecision?: (input: { binding: AyasApprovalBindingSnapshot; decision: "APPROVE" | "REJECT" }) => Promise<{ readonly ok: boolean; readonly code?: string; readonly commitSha?: string; readonly recommendations: AyasOwnerRecommendationsView }>;
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
  initialApprovalInbox,
  initialMicroBatch,
  initialGoalDevelopment,
  initialResearchEngineStatus,
  initialSelfHeal,
  initialOwnerRecommendations,
  modelConfigured,
  refresh,
  refreshSelfHeal,
  refreshApprovalInbox,
  refreshMicroBatch,
  refreshGoalDevelopment,
  refreshResearchEngineStatus,
  recordSelfHealDecision,
  decideApproval,
  executeProposal,
  batchOnaylaVeUygula,
  proposalOnaylaVeUygula,
  refreshOwnerRecommendations,
  ownerApprovalDecision,
  askAyas,
  streaming = true,
}: BrainCoreConsoleProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [activePanel, setActivePanel] = useState<BrainPanelId>("chat");
  const [draft, setDraft] = useState("");

  // AYAS Report Center: the self-heal / report snapshot + the operator's
  // filter / expand / decision interaction state. A decision RECORDS the
  // operator's choice (server action) — it never runs git or the apply.
  const [selfHeal, setSelfHeal] = useState(initialSelfHeal ?? null);
  const [approvalInbox, setApprovalInbox] = useState(initialApprovalInbox ?? { connected: false, pending: [], today: [], history: [] });
  const [ownerRecommendations, setOwnerRecommendations] = useState(initialOwnerRecommendations ?? { connected: false, recommendations: [], pendingExecution: [] });
  const [ownerDecisionPendingId, setOwnerDecisionPendingId] = useState<string | null>(null);
  const [ownerDecisionError, setOwnerDecisionError] = useState<{ proposalId: string; code: string } | null>(null);
  const [microBatch, setMicroBatch] = useState(initialMicroBatch ?? { connected: false, active: null, history: [] });
  const [goalDevelopment, setGoalDevelopment] = useState(initialGoalDevelopment ?? { connected: false, goals: [], research: [] });
  const [researchEngineStatus, setResearchEngineStatus] = useState(initialResearchEngineStatus ?? { connected: false, consecutiveFailures: 0, sources: [], digest: { sourcesRegistered: 0, sourcesChangedLast24h: 0, sourcesFailingNow: 0, findingsLast24h: 0 } });
  const [reportFilter, setReportFilter] = useState<{ status: BrainReportStatusFilter; category: string }>({
    status: "all",
    category: "all",
  });
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [decisionPending, setDecisionPending] = useState<string | null>(null);
  const [approvalPending, setApprovalPending] = useState<string | null>(null);
  const [executionPending, setExecutionPending] = useState<string | null>(null);
  const [executionError, setExecutionError] = useState<{ readonly proposalId: string; readonly code: string } | null>(null);
  const [batchOnaylaPendingId, setBatchOnaylaPendingId] = useState<string | null>(null);
  const [batchOnaylaError, setBatchOnaylaError] = useState<{ readonly batchId: string; readonly code: string } | null>(null);
  const [proposalOnaylaPendingId, setProposalOnaylaPendingId] = useState<string | null>(null);
  const [proposalOnaylaError, setProposalOnaylaError] = useState<{ readonly proposalId: string; readonly code: string } | null>(null);
  const [, startSelfHeal] = useTransition();

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

  // One-time, per-device capture of the phone-gateway auth key from
  // `?ayasPhoneKey=…` (Phase 2 · P0-A.4) — stores to localStorage, strips the
  // param immediately. No-op when absent. See ayasPhoneFallback.ts.
  useEffect(() => {
    bootstrapAyasPhoneKeyFromUrl(window);
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
      conversationActive: h.conversationActive,
      conversationArmed: h.conversationArmed,
      conversationClosedReason: h.conversationClosedReason,
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

  // ChatGPT-style "stop generating" (§3 of the PC-brain upgrade): the
  // streaming route/client already accept an `AbortSignal` end-to-end
  // (`route.ts` passes `request.signal` into `streamAyasChat`, which passes
  // it into the provider's own `AbortController` — see `OllamaAyasProvider`)
  // and `runAyasChatStream` already resolves `{ok:false, reason:"aborted"}`
  // on exactly this signal (smoke-tested) — this was PURELY a missing UI
  // trigger, never wired to any control. One controller per in-flight turn;
  // cleared once that turn settles so a later abort can't affect a new one.
  const chatAbortRef = useRef<AbortController | null>(null);
  const stopGenerating = useCallback(() => {
    chatAbortRef.current?.abort();
  }, []);

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
          const controller = new AbortController();
          chatAbortRef.current = controller;
          const streamResult = await runAyasChatStreamWithPhoneFallback({
            text,
            history,
            seq: seq + 1,
            signal: controller.signal,
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
          if (chatAbortRef.current === controller) chatAbortRef.current = null;
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
          // A DELIBERATE user stop is not a transport failure — never fall
          // back to a fresh (non-cancellable) askAyas call, which would just
          // produce an answer anyway and defeat the whole point of stopping.
          // Keep whatever partial text had already streamed in as the final
          // message (ChatGPT's own behavior on Stop); drop the placeholder
          // entirely if nothing had arrived yet. Never auto-speak a reply the
          // user explicitly cut off.
          if (streamResult.reason === "aborted") {
            if (opened && streamText.trim()) {
              setMessages((current) => current.map((m) => (m.id === replyId ? { ...m, text: streamText } : m)));
              setLastReplySource("llm");
            } else if (opened) {
              setMessages((current) => current.filter((m) => m.id !== replyId));
            }
            voiceRef.current.markIdle();
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
    if (refreshSelfHeal) {
      startSelfHeal(async () => {
        try {
          setSelfHeal(await refreshSelfHeal());
        } catch {
          /* keep the last good self-heal snapshot */
        }
      });
    }
    if (refreshApprovalInbox) {
      startSelfHeal(async () => {
        try { setApprovalInbox(await refreshApprovalInbox()); } catch { /* keep the last durable inbox view */ }
      });
    }
    if (refreshOwnerRecommendations) {
      startSelfHeal(async () => {
        try { setOwnerRecommendations(await refreshOwnerRecommendations()); } catch { /* keep the last durable recommendations view */ }
      });
    }
    if (refreshMicroBatch) {
      startSelfHeal(async () => {
        try { setMicroBatch(await refreshMicroBatch()); } catch { /* keep the last durable micro-batch view */ }
      });
    }
    if (refreshGoalDevelopment) {
      startSelfHeal(async () => {
        try { setGoalDevelopment(await refreshGoalDevelopment()); } catch { /* keep the last durable goal/research view */ }
      });
    }
    if (refreshResearchEngineStatus) {
      startSelfHeal(async () => {
        try { setResearchEngineStatus(await refreshResearchEngineStatus()); } catch { /* keep the last durable research-engine status view */ }
      });
    }
  };

  // Record an operator ONAYLA / REDDET / DAHA SONRA decision. This writes a
  // small decision record server-side (auth-gated) — it does NOT run git, stage
  // a patch, or open the execution gate. The staged apply still happens through
  // `npm run selfheal -- apply <id>`.
  const onReportDecision = useCallback(
    (input: { incidentId: string; decision: BrainSelfHealDecisionKind }) => {
      if (!recordSelfHealDecision || decisionPending) return;
      setDecisionPending(input.incidentId);
      startSelfHeal(async () => {
        try {
          const next = await recordSelfHealDecision(input);
          setSelfHeal(next);
        } catch {
          /* leave the report as-is; the operator can retry */
        } finally {
          setDecisionPending(null);
        }
      });
    },
    [recordSelfHealDecision, decisionPending],
  );

  // Record an operator ONAYLA / REDDET / DAHA SONRA approval decision via
  // `decideAyasApproval`. The safety-classification policy (only a SAFE
  // proposal may be approved) is enforced server-side, in
  // `AyasApprovalInboxStore.decide()` — this handler cannot bypass it.
  const onApprovalDecision = useCallback((input: { proposalId: string; decision: "APPROVE" | "REJECT" | "LATER" }) => {
    if (!decideApproval || approvalPending) return;
    setApprovalPending(input.proposalId);
    startSelfHeal(async () => {
      try { setApprovalInbox(await decideApproval(input)); } catch { /* retain last durable view */ } finally { setApprovalPending(null); }
    });
  }, [approvalPending, decideApproval]);

  // Run an already-APPROVED proposal through Package C via `executeProposal`
  // (`executeAyasApprovedProposal`). A separate, explicit action from
  // `onApprovalDecision` above — approving a proposal never calls this.
  // The action returns `{ ok, code }` rather than throwing (Next.js redacts
  // a thrown Server Action error's message in production, which would make
  // every failure look identical and invisible) — a genuine transport/
  // network failure is the only case that still reaches `catch`, and it is
  // surfaced with its own explicit code rather than silently discarded.
  const onExecuteProposal = useCallback((input: { proposalId: string }) => {
    if (!executeProposal || executionPending) return;
    setExecutionPending(input.proposalId);
    setExecutionError(null);
    startSelfHeal(async () => {
      try {
        const result = await executeProposal(input);
        setApprovalInbox(result.inbox);
        setExecutionError(result.ok ? null : { proposalId: input.proposalId, code: result.code ?? "EXECUTION_FAILED" });
      } catch {
        setExecutionError({ proposalId: input.proposalId, code: "NETWORK_ERROR" });
      } finally {
        setExecutionPending(null);
      }
    });
  }, [executionPending, executeProposal]);

  // "BATCH ONAYLA VE UYGULA" (M18.1) — the single human authorization for a
  // READY_FOR_REVIEW micro batch. One call: decide → Package C execution →
  // per-item + final Graphify verification → post-execution validation →
  // exact-scope Git commit → push. No second YÜRÜT, no second Git-publish
  // confirmation. Same `{ ok, code }`-over-throw posture as `onExecuteProposal`
  // above, for the same reason (a thrown Server Action error is redacted in
  // production).
  const onBatchOnaylaVeUygula = useCallback((input: { batchId: string; batchHash: string }) => {
    if (!batchOnaylaVeUygula || batchOnaylaPendingId) return;
    setBatchOnaylaPendingId(input.batchId);
    setBatchOnaylaError(null);
    startSelfHeal(async () => {
      try {
        const result = await batchOnaylaVeUygula(input);
        setMicroBatch(result.microBatch);
        setBatchOnaylaError(result.ok ? null : { batchId: input.batchId, code: result.code ?? "APPROVAL_FAILED" });
      } catch {
        setBatchOnaylaError({ batchId: input.batchId, code: "NETWORK_ERROR" });
      } finally {
        setBatchOnaylaPendingId(null);
      }
    });
  }, [batchOnaylaPendingId, batchOnaylaVeUygula]);

  // "ONAYLA VE UYGULA" (M20.7) — the individual-proposal equivalent of
  // `onBatchOnaylaVeUygula` above: one call, one human authorization,
  // decide → Package C execution → Graphify verification → Git publication.
  const onProposalOnaylaVeUygula = useCallback((input: { proposalId: string; proposalHash: string }) => {
    if (!proposalOnaylaVeUygula || proposalOnaylaPendingId) return;
    setProposalOnaylaPendingId(input.proposalId);
    setProposalOnaylaError(null);
    startSelfHeal(async () => {
      try {
        const result = await proposalOnaylaVeUygula(input);
        setApprovalInbox(result.inbox);
        setProposalOnaylaError(result.ok ? null : { proposalId: input.proposalId, code: result.code ?? "APPROVAL_FAILED" });
      } catch {
        setProposalOnaylaError({ proposalId: input.proposalId, code: "NETWORK_ERROR" });
      } finally {
        setProposalOnaylaPendingId(null);
      }
    });
  }, [proposalOnaylaPendingId, proposalOnaylaVeUygula]);

  // Owner-approval model — the owner's one APPROVE/REJECT on an exact
  // recommendation binding. REJECT durably records the decision with no
  // mutation; APPROVE re-validates everything fresh server-side and, only if
  // still valid AND the server's own live-execution flag is set, delegates
  // to the same canonical execution path as `onProposalOnaylaVeUygula` above.
  const onOwnerApprovalDecision = useCallback((input: { binding: AyasApprovalBindingSnapshot; decision: "APPROVE" | "REJECT" }) => {
    if (!ownerApprovalDecision || ownerDecisionPendingId) return;
    setOwnerDecisionPendingId(input.binding.proposalId);
    setOwnerDecisionError(null);
    startSelfHeal(async () => {
      try {
        const result = await ownerApprovalDecision(input);
        setOwnerRecommendations(result.recommendations);
        setOwnerDecisionError(result.ok ? null : { proposalId: input.binding.proposalId, code: result.code ?? "APPROVAL_FAILED" });
      } catch {
        setOwnerDecisionError({ proposalId: input.binding.proposalId, code: "NETWORK_ERROR" });
      } finally {
        setOwnerDecisionPendingId(null);
      }
    });
  }, [ownerDecisionPendingId, ownerApprovalDecision]);

  // The AYAS presence-card CTA: drop into the EXISTING chat/voice experience —
  // select the chat panel and, when this device can hear, start listening
  // inside this click's user gesture (iOS needs that). No new path.
  const dismissInterrupted = lifecycle.dismissInterrupted;
  const setVoiceIntent = lifecycle.setVoiceIntent;
  const startConversation = useCallback(() => {
    setActivePanel("chat");
    dismissInterrupted();
    const v = voiceRef.current;
    // Browser-provider STT keeps its existing explicit disclosure gate. The
    // first tap opens Chat; after acceptance, the mic control starts capture.
    if (v.capability.sttCloudBacked && !v.disclosureAccepted) return;
    // A paused wake pipeline: this click is the gesture that lets iOS hand the
    // mic back — retry now rather than waiting for the next backoff interval.
    if (v.voicePaused) {
      v.retryVoice();
      return;
    }
    if (v.capability.stt && !v.listening) v.toggleListening();
  }, [dismissInterrupted]);

  // The "🧠 AYAS Raporları" home card. On mobile `.bc-panel` (the command center)
  // stacks far below the orb + presence card + status cards, so switching the
  // active tab alone looks like nothing happened. Select the panel AND scroll it
  // into view. NOT an execution / gate action — a read-only panel switch.
  const openReports = useCallback(() => {
    setActivePanel("selfheal");
    if (typeof document === "undefined") return;
    // The command-center <section id="bc-command-center"> is always mounted (only
    // its inner tab panel swaps), so we can scroll to it synchronously — no
    // timer / rAF. On mobile this is the whole point: the panel is far below the
    // orb + presence card + status cards.
    const el = document.getElementById("bc-command-center");
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      el.scrollIntoView(); // old engine — no options object
    }
  }, []);

  const openDevelopment = useCallback(() => {
    setActivePanel("development");
    if (typeof document === "undefined") return;
    const el = document.getElementById("bc-command-center");
    if (!el) return;
    try { el.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { el.scrollIntoView(); }
  }, []);

  // Explicit "turn voice off" — forget the persisted intent so a later reload
  // does not re-offer to resume a session the user deliberately ended.
  const stopListening = useCallback(() => {
    setVoiceIntent(false);
    dismissInterrupted();
    voiceRef.current.stopListening();
  }, [setVoiceIntent, dismissInterrupted]);

  const restingState = useMemo(() => deriveBrainCoreState(snapshot), [snapshot]);
  const autonomousWaiting = (initialAutonomous?.awaitingApprovalCount ?? 0) > 0;
  const coreState: BrainCoreState =
    // Premium 3D Brain Orb sprint — the browser itself is offline overrides
    // everything else (voice/chat state is moot with no network at all); this
    // consumes the EXISTING `connectivity` signal computed above, no new
    // detection logic. "degraded" (a refresh failed while still online) maps
    // onto the existing "warning" treatment, same as every other soft-attention
    // case below.
    connectivity === "offline"
      ? "offline"
      : restingState === "error"
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
                  : connectivity === "degraded"
                    ? "warning"
                    : draft.trim().length > 0
                      ? "active"
                      : autonomousWaiting && restingState === "idle"
                        ? "autonomous"
                        : restingState;

  return (
    <>
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
      approvalInbox={approvalInbox}
      ownerRecommendations={ownerRecommendations.recommendations}
      ownerDecisionPendingId={ownerDecisionPendingId}
      ownerDecisionError={ownerDecisionError}
      onOwnerApprovalDecision={onOwnerApprovalDecision}
      ownerApprovalPendingExecution={ownerRecommendations.pendingExecution}
      microBatch={microBatch}
      goalDevelopment={goalDevelopment}
      researchEngineStatus={researchEngineStatus}
      approvalPendingId={approvalPending}
      onApprovalDecision={onApprovalDecision}
      executionPendingId={executionPending}
      executionError={executionError}
      onExecuteProposal={onExecuteProposal}
      batchOnaylaPending={batchOnaylaPendingId !== null}
      batchOnaylaError={batchOnaylaError}
      onBatchOnaylaVeUygula={onBatchOnaylaVeUygula}
      proposalOnaylaPendingId={proposalOnaylaPendingId}
      proposalOnaylaError={proposalOnaylaError}
      onProposalOnaylaVeUygula={onProposalOnaylaVeUygula}
      selfHeal={selfHeal}
      reportCenter={selfHeal?.reportCenter ?? null}
      reportHandlers={{
        filter: reportFilter,
        onFilter: setReportFilter,
        expandedReportId,
        onToggleReport: setExpandedReportId,
        onDecision: recordSelfHealDecision ? onReportDecision : undefined,
        decisionPending,
      }}
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
        conversationActive: voice.conversationActive,
        conversationClosedReason: voice.conversationClosedReason,
        initializing: voice.initializing,
        readiness: voice.readiness,
        micPermission: voice.micPermission,
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
      onOpenReports={openReports}
      onOpenDevelopment={openDevelopment}
      onDraftChange={setDraft}
      onSend={send}
      onStopGenerating={chatPending ? stopGenerating : undefined}
      onRefresh={refresh ? doRefresh : undefined}
      onStartConversation={startConversation}
      />
    </>
  );
}

export default BrainCoreConsole;
