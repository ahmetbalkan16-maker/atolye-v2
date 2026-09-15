/**
 * Atölye Brain Core — pure UI state model (Sprint 184).
 *
 * No React, no DOM. The visual components (`BrainCoreOrb`, `BrainConsoleView`)
 * and the smoke suite both consume these helpers, so the Brain Core's behaviour
 * is testable without a browser.
 */

import { resolveAyasVoiceReadiness, type AyasMicPermissionState, type AyasVoiceReadiness, type AyasVoiceState } from "./ayasVoice";
import type { BrainConsoleSnapshot } from "@/lib/brain/ui/BrainConsoleSnapshot";
import type { BrainTaskStatus } from "@/types/brainWorker";
import type { AyasChatComplexity } from "@/lib/ayas/model/AyasModelTypes";

/* ------------------------------------------------------------------------- *
 * Core states
 * ------------------------------------------------------------------------- */

export type BrainCoreState =
  | "idle"
  | "active"
  | "thinking"
  | "learning"
  | "working"
  | "warning"
  | "error"
  | "listening"
  | "speaking"
  | "autonomous"
  /** Premium 3D Brain Orb sprint — the browser itself is offline (no network at
   * all). Distinct from `error` (a read failed while still connected): the orb
   * dims to a quiet, static minimum rather than jittering — "energy fades, the
   * look stays premium," never an alarming/broken appearance. */
  | "offline";

export interface BrainCoreStateInfo {
  readonly state: BrainCoreState;
  readonly label: string;
  readonly tr: string;
  readonly description: string;
  /** Short, premium one-liner shown under the orb (Turkish). */
  readonly characterTr: string;
  /** Relative glow / motion intensity, 0–1, for the orb. */
  readonly intensity: number;
  /** Hue family the orb shifts toward in this state. */
  readonly hue: "cyan" | "violet" | "amber" | "emerald" | "rose";
}

export const BRAIN_CORE_STATES: Readonly<Record<BrainCoreState, BrainCoreStateInfo>> =
  Object.freeze({
    idle: {
      state: "idle",
      label: "Idle",
      tr: "Hazır",
      description: "Brain is ready and waiting.",
      characterTr: "Sakin nefes alan çekirdek — beklemede.",
      intensity: 0.35,
      hue: "cyan",
    },
    active: {
      state: "active",
      label: "Active",
      tr: "Etkin",
      description: "Talking with you / taking your input.",
      characterTr: "Girdini alıyor — enerji canlanıyor.",
      intensity: 0.6,
      hue: "cyan",
    },
    thinking: {
      state: "thinking",
      label: "Thinking",
      tr: "Düşünüyor",
      description: "Running a safe analysis or planning step.",
      characterTr: "Halkalar dönüyor, tarama sürüyor — güvenli analiz.",
      intensity: 0.75,
      hue: "violet",
    },
    learning: {
      state: "learning",
      label: "Learning",
      tr: "Öğreniyor",
      description: "Reviewing experience / knowledge.",
      characterTr: "Bilgi akışı yoğunlaşıyor — deneyim taranıyor.",
      intensity: 0.7,
      hue: "emerald",
    },
    working: {
      state: "working",
      label: "Working",
      tr: "Çalışıyor",
      description: "A Brain Worker cycle is processing safe tasks.",
      characterTr: "Güçlü ama kontrollü aktivite — worker cycle işliyor.",
      intensity: 0.85,
      hue: "violet",
    },
    warning: {
      state: "warning",
      label: "Warning",
      tr: "Uyarı",
      description: "Something needs your approval or attention.",
      characterTr: "Dikkat gerekiyor — onay veya inceleme bekleyen bir durum var.",
      intensity: 0.9,
      hue: "amber",
    },
    error: {
      state: "error",
      label: "Error",
      tr: "Hata",
      description: "A read failed — check the details.",
      characterTr: "Bir okuma başarısız — ayrıntıları kontrol et.",
      intensity: 1,
      hue: "rose",
    },
    listening: {
      state: "listening",
      label: "Listening",
      tr: "Dinliyor",
      description: "AYAS heard the wake word and is capturing a spoken command.",
      characterTr: "\"UYAN\" (\"AYAS\") duyuldu — sesli komut alınıyor.",
      intensity: 0.7,
      hue: "cyan",
    },
    speaking: {
      state: "speaking",
      label: "Speaking",
      tr: "Konuşuyor",
      description: "AYAS is reading its reply aloud (local speech synthesis).",
      characterTr: "AYAS yanıtını sesli okuyor (yerel).",
      intensity: 0.8,
      hue: "cyan",
    },
    autonomous: {
      state: "autonomous",
      label: "Autonomous",
      tr: "Otonom",
      description: "The continuous autonomous loop is observing / drafting — never executing.",
      characterTr: "Otonom döngü gözlemliyor ve öneri taslağı hazırlıyor — yürütme yok.",
      intensity: 0.8,
      hue: "emerald",
    },
    offline: {
      state: "offline",
      label: "Offline",
      tr: "Çevrim Dışı",
      description: "No network connection — resting at a quiet minimum, not an error.",
      characterTr: "Bağlantı yok — çekirdek düşük enerjide, sakin bekliyor.",
      intensity: 0.08,
      hue: "cyan",
    },
  });

export function describeBrainCoreState(state: BrainCoreState): BrainCoreStateInfo {
  return BRAIN_CORE_STATES[state] ?? BRAIN_CORE_STATES.idle;
}

/**
 * Derive the resting Brain Core state from a snapshot. Deterministic. The UI
 * layers transient states (`active` while typing, `thinking` while a refresh is
 * in flight) on top of this.
 */
export function deriveBrainCoreState(snapshot: BrainConsoleSnapshot): BrainCoreState {
  if (snapshot.errors.length > 0) return "error";
  if (
    snapshot.safety.decision === "hold" ||
    snapshot.safety.decision === "abort" ||
    snapshot.tasks.pendingApproval > 0
  ) {
    return "warning";
  }
  if (hasRunningTask(snapshot.tasks.byStatus)) return "working";
  if (snapshot.experience.total > 0 && !snapshot.lastCycle) return "learning";
  return "idle";
}

function hasRunningTask(byStatus: Readonly<Record<BrainTaskStatus, number>>): boolean {
  return (byStatus.running ?? 0) > 0;
}

/* ------------------------------------------------------------------------- *
 * AYAS presence (Sprint — mobile + voice integration)
 *
 * A single-glance projection for the Brain home page: is AYAS reachable, is
 * voice ready, is mobile access ready, is the link safe — plus the right CTA.
 * Pure & deterministic. It states only what is actually known:
 *  - reachability comes from the browser's own `navigator.onLine` + whether the
 *    last read-only refresh succeeded (NO polling, NO heartbeat);
 *  - "mobile ready" means this page is being served in a secure context, so the
 *    same URL is usable from a phone — it never names or exposes the transport;
 *  - "safe link" restates the Execution Gate, which stays CLOSED.
 * ------------------------------------------------------------------------- */

/** Coarse client-side reachability — derived from the browser, never polled. */
export type AyasConnectivity = "online" | "degraded" | "offline";

export interface AyasPresenceInput {
  readonly connectivity: AyasConnectivity;
  /** `true` when the page is a secure context (HTTPS) — mic + phone use need it. */
  readonly secureContext: boolean;
  /** The Execution Gate — always `"CLOSED"` today; restated, never changed. */
  readonly executionGate: BrainConsoleSnapshot["executionGate"];
  readonly voice?: {
    readonly sttAvailable: boolean;
    readonly ttsAvailable: boolean;
    readonly listening: boolean;
    readonly state: AyasVoiceState;
    /** `"wake-engine"` = the on-device "AYAS" detector; else tap-to-talk. */
    readonly mode?: "continuous" | "single-shot" | "wake-engine";
    /** `true` while the wake pipeline is re-acquiring the mic / AudioContext. */
    readonly recovering?: boolean;
    /**
     * `true` when a working wake session was interrupted (iOS took the mic away)
     * and is recovering — a tap resumes it immediately. NOT a permanent failure.
     */
    readonly paused?: boolean;
    /**
     * `true` between an "AYAS" wake and the idle timeout — follow-up commands
     * skip the wake word (Conversation Session Mode).
     */
    readonly conversationActive?: boolean;
    /**
     * Mobile Voice Regression sprint — `true` until the voice platform has
     * attached at least once. Distinct from "unsupported": a device is never
     * classified as having no voice just because this is still `true`.
     */
    readonly initializing?: boolean;
    /** Best-effort; `"unknown"` on Safari/WebKit, which cannot be queried at all. */
    readonly micPermission?: AyasMicPermissionState;
    /** Canonical live readiness supplied by useAyasVoice. */
    readonly readiness?: AyasVoiceReadiness;
  };
}

export interface AyasPresenceRow {
  readonly label: string;
  readonly value: string;
  readonly tone: "ok" | "warn" | "off";
}

export interface AyasPresenceView {
  readonly online: boolean;
  /** Primary status word under the AYAS name. */
  readonly statusTr: string;
  readonly statusTone: "ok" | "warn" | "off";
  readonly voice: AyasPresenceRow;
  readonly mobile: AyasPresenceRow;
  readonly security: AyasPresenceRow;
  /** `true` when the on-device "AYAS" wake word is live (no per-turn tap). */
  readonly handsFree: boolean;
  /** Generic, transport-agnostic reachability hint (never a hostname). */
  readonly reachHint: string;
  readonly cta: {
    readonly label: string;
    /** `"voice"` starts listening; `"text"` just focuses chat; `"disabled"` offline. */
    readonly kind: "voice" | "text" | "disabled";
  };
}

/** Turkish one-liner for a live voice state (home-page phrasing). */
function ayasVoicePresenceValue(voiceState: AyasVoiceState): string {
  switch (voiceState) {
    case "listening":
      return "AYAS dinliyor";
    case "thinking":
      return "AYAS düşünüyor";
    case "speaking":
      return "AYAS konuşuyor";
    case "idle":
      return "Sesli iletişim hazır";
    case "error":
      return "Ses hatası — metin sohbeti çalışır";
    default:
      return "Sesli iletişim hazır";
  }
}

export function deriveAyasPresence(input: AyasPresenceInput): AyasPresenceView {
  const online = input.connectivity === "online";
  const degraded = input.connectivity === "degraded";
  const offline = input.connectivity === "offline";

  const statusTr = offline ? "ÇEVRİM DIŞI" : degraded ? "BAĞLANTI ZAYIF" : "ÇEVRİM İÇİ";
  const statusTone: "ok" | "warn" | "off" = offline ? "off" : degraded ? "warn" : "ok";

  // Mobile Voice Regression sprint — a closed, truthful set of voice states.
  // Crucially distinguishes "still detecting" (transient) and "permission
  // issue" (actionable) from "genuinely unsupported" (permanent) — collapsing
  // all three into one "Bu cihazda ses yok" message was itself the bug: a
  // slow/hung capability check on a real device looked identical to a device
  // that could never have voice at all.
  const readiness =
    input.voice?.readiness ??
    resolveAyasVoiceReadiness({
      initializing: Boolean(input.voice?.initializing),
      sttAvailable: Boolean(input.voice?.sttAvailable),
      ttsAvailable: Boolean(input.voice?.ttsAvailable),
      micPermission: input.voice?.micPermission ?? "unknown",
      error: input.voice?.state === "error",
    });
  const handsFree = input.voice?.mode === "wake-engine";
  const voiceState = input.voice?.state ?? "idle";
  const paused = Boolean(input.voice?.paused) && !offline;
  const recovering = (Boolean(input.voice?.recovering) || paused) && !offline;
  const voice: AyasPresenceRow = offline
    ? { label: "Ses", value: "Çevrim dışı", tone: "off" }
    : readiness === "initializing"
      ? { label: "Ses", value: "Sesli iletişim başlatılıyor…", tone: "off" }
      : readiness === "unsupported"
        ? { label: "Ses", value: "Bu cihazda ses yok", tone: "off" }
              : readiness === "permission-denied"
          ? { label: "Ses", value: "Mikrofon engellendi — tarayıcı ayarlarından izin ver", tone: "warn" }
        : readiness === "error"
          ? { label: "Ses", value: "Ses başlatılamadı — tekrar dene", tone: "warn" }
          : paused
            ? { label: "Ses", value: "AYAS ses bağlantısını yeniden kuruyor — dokunarak sürdür", tone: "warn" }
            : recovering
              ? { label: "Ses", value: "AYAS bağlantıyı toparlıyor", tone: "warn" }
              : readiness === "stt-unsupported"
                ? { label: "Ses", value: "Mikrofon desteklenmiyor — AYAS sesli yanıt verebilir", tone: "warn" }
                : readiness === "permission-needed"
                  ? { label: "Ses", value: "Mikrofon izni gerekli — etkinleştirmek için dokun", tone: "warn" }
                  : {
                    label: "Ses",
                    value: input.voice?.conversationActive
                      ? "Konuşma aktif — AYAS dinliyor"
                      : voiceState === "idle" && input.voice?.listening
                        ? handsFree
                          // Hands-free = the on-device openWakeWord audio model, trained
                          // ONLY on "AYAS" — the text-alias resolver (UYAN, …) does not
                          // reach this path, so this label must not claim otherwise.
                          ? "\"AYAS\" bekleniyor (eller serbest)"
                          : "\"UYAN\" (\"AYAS\") bekleniyor"
                        : ayasVoicePresenceValue(voiceState),
                    tone: voiceState === "error" ? "warn" : "ok",
                  };

  const mobile: AyasPresenceRow = offline
    ? { label: "Mobil", value: "Bağlantı bekleniyor", tone: "off" }
    : !input.secureContext
      ? { label: "Mobil", value: "Güvenli bağlantı gerekli", tone: "warn" }
      : { label: "Mobil", value: "Mobil erişim hazır", tone: "ok" };

  const gateClosed = input.executionGate === "CLOSED";
  const security: AyasPresenceRow = {
    label: "Güvenlik",
    value: !gateClosed
      ? `Yürütme kapısı: ${input.executionGate}`
      : offline
        ? "Yürütme kapısı kapalı"
        : "Güvenli bağlantı · yürütme kapısı kapalı",
    tone: gateClosed ? "ok" : "warn",
  };

  const reachHint = "iPhone ve PC'den güvenli erişim";

  const cta: AyasPresenceView["cta"] = offline
    ? { label: "Çevrim dışı", kind: "disabled" }
    : paused
      ? { label: "Sesli oturumu sürdür", kind: "voice" }
      : readiness === "permission-needed"
        // A tap here IS the user gesture that triggers the real browser
        // permission prompt — unlike "permission-denied", where a re-tap
        // cannot fix it (the user must change a browser/site setting).
        ? { label: "Mikrofonu Etkinleştir", kind: "voice" }
        : readiness === "ready" && input.voice?.sttAvailable && !input.voice.listening
          ? { label: handsFree ? "Eller serbest — \"AYAS\" de" : "AYAS ile sesli konuş", kind: "voice" }
          : input.voice?.listening
            ? { label: "AYAS'a yaz", kind: "text" }
            : { label: "AYAS ile konuş", kind: "text" };

  return { online, statusTr, statusTone, voice, mobile, security, handsFree, reachHint, cta };
}

/* ------------------------------------------------------------------------- *
 * Task status → display
 * ------------------------------------------------------------------------- */

export interface BrainTaskDisplay {
  readonly label: string;
  readonly tone: "neutral" | "info" | "good" | "bad" | "warn" | "muted";
}

const TASK_STATUS_DISPLAY: Readonly<Record<BrainTaskStatus, BrainTaskDisplay>> = Object.freeze({
  queued: { label: "Queued", tone: "info" },
  running: { label: "Analyzing", tone: "info" },
  "blocked-on-dependency": { label: "Waiting on dependency", tone: "muted" },
  "blocked-on-approval": { label: "Awaiting approval", tone: "warn" },
  succeeded: { label: "Succeeded", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "muted" },
  "skipped-unsafe": { label: "Skipped (unsafe)", tone: "bad" },
});

export function mapTaskStatusToDisplay(status: BrainTaskStatus): BrainTaskDisplay {
  return TASK_STATUS_DISPLAY[status] ?? { label: status, tone: "neutral" };
}

/* ------------------------------------------------------------------------- *
 * Panels
 * ------------------------------------------------------------------------- */

export type BrainPanelId =
  | "chat"
  | "tasks"
  | "memory"
  | "autonomous"
  | "selfheal"
  | "research"
  | "production"
  | "learning"
  | "safety";

export interface BrainPanelInfo {
  readonly id: BrainPanelId;
  readonly label: string;
  readonly icon: string;
  /** `true` when this panel is backed by real Brain state today. */
  readonly connected: boolean;
  readonly placeholder?: string;
}

export const BRAIN_PANELS: readonly BrainPanelInfo[] = Object.freeze([
  { id: "chat", label: "Chat", icon: "◉", connected: true },
  { id: "tasks", label: "Tasks", icon: "▤", connected: true },
  { id: "memory", label: "Memory", icon: "◈", connected: true },
  { id: "autonomous", label: "Autonomous", icon: "∞", connected: true },
  { id: "selfheal", label: "AYAS Raporları", icon: "🧠", connected: true },
  {
    id: "research",
    label: "Research",
    icon: "❍",
    connected: false,
    placeholder: "Research role not connected — a later, approved phase.",
  },
  {
    id: "production",
    label: "Production",
    icon: "▷",
    connected: false,
    placeholder: "Production execution is gated — the Brain cannot run the pipeline yet.",
  },
  { id: "learning", label: "Learning", icon: "✦", connected: true },
  { id: "safety", label: "Safety", icon: "⛨", connected: true },
]);

export function findBrainPanel(id: BrainPanelId): BrainPanelInfo {
  return BRAIN_PANELS.find((panel) => panel.id === id) ?? BRAIN_PANELS[0];
}

/* ------------------------------------------------------------------------- *
 * Deterministic chat responder (NO model — placeholder until the LLM roles
 * are wired, a separate approved phase)
 * ------------------------------------------------------------------------- */

export interface BrainChatMessage {
  readonly id: string;
  readonly role: "user" | "brain" | "system";
  readonly text: string;
}

/**
 * The Brain's canned, honest reply. It never pretends to be an LLM — it states
 * that the conversation layer is not connected and reflects real snapshot
 * numbers so the message is still useful.
 */
export function brainDeterministicReply(
  userText: string,
  snapshot: BrainConsoleSnapshot,
  seq: number,
): BrainChatMessage {
  const facts: string[] = [];
  facts.push(`kuyrukta ${snapshot.tasks.total} görev`);
  if (snapshot.tasks.pendingApproval > 0) {
    facts.push(`${snapshot.tasks.pendingApproval} onay bekliyor`);
  }
  if (snapshot.tasks.skippedUnsafe > 0) {
    facts.push(`${snapshot.tasks.skippedUnsafe} güvensiz görev atlandı`);
  }
  facts.push(`${snapshot.cyclesRecorded} worker cycle kaydı`);
  facts.push(`güvenlik: ${snapshot.safety.decision}`);

  return {
    id: `brain-${seq}`,
    role: "brain",
    text:
      "Beyin çekirdeği çevrimiçi, ama konuşma katmanı (LLM rolleri) henüz bağlı değil — " +
      "bu ayrı ve onay gerektiren bir aşama. Şu an görünür olan: " +
      facts.join(", ") +
      ". Yürütme kapısı KAPALI: gerçek üretim, model veya GPU çalıştırılmıyor.",
  };
}

export function brainWelcomeMessage(snapshot: BrainConsoleSnapshot): BrainChatMessage {
  return {
    id: "brain-welcome",
    role: "system",
    text:
      snapshot.connected.tasks || snapshot.connected.experience
        ? "Ben AYAS — Atölye'nin yapay zekâ çekirdeğiyim. Altyapı okunuyor; yürütme kapısı kapalı."
        : "Ben AYAS — Atölye'nin yapay zekâ çekirdeğiyim. Henüz kalıcı bir durum yok; kuyruk ve deneyim store'ları boş.",
  };
}

/* ------------------------------------------------------------------------- *
 * AYAS — the Brain's name, its LLM chat prompt, and the LLM-reply wrapper.
 * The prompt is pure/deterministic; the actual model call is a Server Action
 * (`app/brain/actions.ts` → `askAyas`) that reuses the existing OllamaProvider.
 * ------------------------------------------------------------------------- */

export const AYAS_NAME = "AYAS" as const;

/** Cap on a single AYAS chat reply — a short conversational turn, not an essay. */
export const AYAS_MAX_REPLY_TOKENS = 420;

/**
 * Spoken-Turkish rule injected into the prompt (Sprint 187). Every AYAS reply
 * is read aloud by the browser's speech synthesiser, so the model must write
 * natural, symbol-free, grammatically clean conversational Turkish.
 */
export const AYAS_SPOKEN_TURKISH_RULE: readonly string[] = Object.freeze([
  "Sesli yanıt kuralı (yanıtların sesli okunacak):",
  "- Kısa, doğal, akıcı konuşma Türkçesi kullan. Genelde 2-4 cümle yeter.",
  "- Sembol, markdown, başlık, madde işareti, emoji veya kod bloğu KULLANMA. Gerekirse maddeleri düz cümleyle sırala.",
  "- Sayıları ve durumu düzgün Türkçe dilbilgisiyle anlat. \"işlem bulunuyor değildir\", \"kuyrukta hiç görev bulunuyor\", \"başlatamam çalıştırabilir\" gibi bozuk yapılar kurma.",
  "- Kullanıcının söylediğine doğrudan karşılık ver. Selamlama, \"Ben AYAS\" veya kim olduğunla ilgili giriş cümlesi kurma.",
]);

/** How many prior turns to feed the model for context. */
export const AYAS_HISTORY_TURNS = 12;

/* ------------------------------------------------------------------------- *
 * AYAS studio context (Sprint 208) — a pure, read-only projection of the
 * ACTIVE runtime storage authority + the real project inventory, so AYAS can
 * answer "where is the runtime authority" / "how many projects" from fact
 * rather than guessing off the task queue. The fs-touching loader lives in the
 * server-only `src/lib/ayas/AyasStudioContext.ts`; this module stays pure.
 * ------------------------------------------------------------------------- */

export interface AyasStudioProjectView {
  readonly slug: string;
  readonly title: string;
  /** Pipeline stage / `ProjectStatus`; `"unknown"` when the record omitted it. */
  readonly status: string;
  /**
   * Read-only pipeline facts (Phase 6) — computed by `PipelineRecoveryPlanner`
   * from the project manifest, no stage is run. `null` fields mean "not probed"
   * (fail-soft).
   */
  readonly nextStage?: string | null;
  /** Pipeline stages currently in `failed` state. */
  readonly failedStages?: readonly string[];
  /** `true` when the resume plan is blocked by an unmet dependency. */
  readonly blocked?: boolean;
}

export interface AyasStudioContextView {
  /** `false` when the context could not be resolved — the prompt says so plainly. */
  readonly available: boolean;
  readonly runtimeAuthority: {
    /** e.g. `D:\AtolyeRuntime` — the active runtime root. */
    readonly runtimeRoot: string;
    /** e.g. `D:\AtolyeRuntime\projects`. */
    readonly projectsRoot: string;
    /** e.g. `D:\AtolyeAuthority` — the authority control-plane root. */
    readonly authorityRoot: string;
    readonly classification: string;
    /** `true` when resolved from `ATOLYE_RUNTIME_ROOT` (not the in-repo default). */
    readonly external: boolean;
  };
  readonly projects: {
    readonly total: number;
    /** `status → count`, only the non-zero entries, sorted by count desc. */
    readonly byStatus: readonly { readonly status: string; readonly count: number }[];
    /** A short sample for the prompt — most recently updated first. */
    readonly sample: readonly AyasStudioProjectView[];
    /**
     * Read-only pipeline roll-up over ALL projects (Phase 6). Absent when the
     * pipeline probe could not run. Lets AYAS answer "hangi aşamada takılıyor" /
     * "son başarısız stage" from fact — it still runs nothing.
     */
    readonly pipeline?: {
      /** Projects with at least one `failed` stage. */
      readonly withFailedStage: number;
      /** Projects whose resume plan is blocked by a dependency. */
      readonly blocked: number;
      /** `stage → count` of projects sitting at that next-incomplete stage, busiest first. */
      readonly stalledAtStage: readonly { readonly stage: string; readonly count: number }[];
      /** Most recently updated project that has a failed stage, or `null`. */
      readonly latestFailure: {
        readonly slug: string;
        readonly title: string;
        readonly failedStages: readonly string[];
        /** The `error` string the failed stage recorded in the manifest, if any. */
        readonly rootCause: string | null;
      } | null;
    };
  };
  /** Non-fatal notes (e.g. "1 folder has no project.json"). */
  readonly notes: readonly string[];
}

/**
 * Phase 2 · Context Foundation — deterministic conversation-context blocks the
 * server derives (`src/lib/ayas/context/*`) and hands to the prompt as ready
 * lines. The prompt stays pure: it never runs the derivation, just renders what
 * it is given.
 */
export interface AyasConversationPromptBlock {
  /** "aktif proje: … / aktif aşama: … / çözülmemiş soru: …" */
  readonly stateLines?: readonly string[];
  /** "'o proje' = Mimar Sinan" resolutions + any unresolved-reference warning. */
  readonly referenceLines?: readonly string[];
  /** Extractive summary of the older turns that were dropped from the verbatim window. */
  readonly historySummary?: readonly string[];
}

export interface AyasChatPromptInput {
  readonly userText: string;
  readonly snapshot: BrainConsoleSnapshot;
  readonly history: readonly { readonly role: BrainChatMessage["role"]; readonly text: string }[];
  /** Optional read-only studio/runtime-authority facts (Sprint 208). */
  readonly studio?: AyasStudioContextView;
  /** Optional conversation-context blocks (Phase 2 · Phase B). */
  readonly conversation?: AyasConversationPromptBlock;
  /** Optional recalled long-term memory lines (Phase 2 · Phase C). */
  readonly memoryLines?: readonly string[];
  /**
   * Chat-quality sprint: the coarse turn shape from `classifyAyasComplexity`
   * (already computed by `AyasChatStream.ts` for routing — no new classifier,
   * no extra model call). `"SIMPLE"` (greetings, arithmetic, trivia, "sen
   * kimsin") skips the studio/project-state block below: dumping runtime
   * authority + pipeline counts in front of a "2+2 kaç?" was priming the model
   * to answer with unrelated Atölye/proje chatter. Omitted (every existing
   * caller — `resolveAyasReply`/`askAyas` and every smoke test that doesn't
   * pass it) behaves exactly as before this field existed: studio context
   * always included.
   */
  readonly complexity?: AyasChatComplexity;
  /**
   * `"json"` (default) ends the prompt with the `{ reply }` envelope instruction
   * — for the non-streaming `format: "json"` backend. `"text"` asks for a direct
   * plain-text answer — for the streaming path, where token deltas of a JSON
   * envelope would be unreadable.
   */
  readonly format?: "json" | "text";
}

/** Render the studio-context block for the prompt. Deterministic. */
function ayasStudioPromptLines(studio: AyasStudioContextView | undefined): string[] {
  if (!studio) return [];
  if (!studio.available) {
    return [
      "",
      "Atölye stüdyo bağlamı (salt-okunur): şu an çözülemedi — proje sayısı veya",
      "runtime authority yolu sorulursa \"şu an bu bilgiye erişemiyorum\" de, tahmin etme.",
    ];
  }
  const ra = studio.runtimeAuthority;
  const statusText = studio.projects.byStatus.length
    ? studio.projects.byStatus.map((s) => `${s.count} ${s.status}`).join(", ")
    : "durum bilgisi yok";
  const sample = studio.projects.sample.slice(0, 6).map((p) => {
    const bits: string[] = [];
    if (p.nextStage) bits.push(`sıradaki aşama: ${p.nextStage}`);
    else if (p.nextStage === null) bits.push("pipeline tamamlanmış");
    if (p.failedStages && p.failedStages.length) bits.push(`başarısız: ${p.failedStages.join("/")}`);
    if (p.blocked) bits.push("ENGELLİ (bağımlılık)");
    return `  · ${p.title || p.slug} (${p.status})${bits.length ? " — " + bits.join(", ") : ""}`;
  });
  const pl = studio.projects.pipeline;
  const pipelineLines = pl
    ? [
        "- pipeline (salt-okunur özet, tüm projeler):",
        `  · başarısız aşaması olan proje: ${pl.withFailedStage}`,
        `  · bağımlılıkla engellenen proje: ${pl.blocked}`,
        ...(pl.stalledAtStage.length
          ? [`  · aşamada bekleyen: ${pl.stalledAtStage.map((s) => `${s.count} × ${s.stage}`).join(", ")}`]
          : []),
        ...(pl.latestFailure
          ? [
              `  · en son başarısızlık: "${pl.latestFailure.title}" → aşama ${pl.latestFailure.failedStages.join("/") || "?"}` +
                (pl.latestFailure.rootCause ? ` (kök neden: ${pl.latestFailure.rootCause})` : ""),
            ]
          : ["  · başarısız aşaması olan proje yok"]),
      ]
    : ["- pipeline özeti: bu sefer okunamadı"];
  return [
    "",
    "Atölye stüdyo bağlamı (salt-okunur, kaynak: runtime authority + proje envanteri + pipeline manifestleri):",
    `- aktif runtime authority (proje deposu): ${ra.runtimeRoot}`,
    `- proje kökü: ${ra.projectsRoot}`,
    `- authority kontrol kökü: ${ra.authorityRoot}`,
    `- depo türü: ${ra.classification}${ra.external ? " (repo dışı, harici disk)" : " (repo içi varsayılan)"}`,
    `- toplam proje sayısı: ${studio.projects.total}`,
    `- proje durumları: ${statusText}`,
    ...pipelineLines,
    ...(sample.length ? ["- örnek projeler:", ...sample] : []),
    ...(studio.notes.length ? [`- notlar: ${studio.notes.join(" | ")}`] : []),
    "\"Kaç proje var\" / \"runtime authority neresi\" / \"hangi aşamada takıldı\" / \"son başarısız",
    "stage\" gibi sorulara YALNIZCA bu bloktaki değerlerle cevap ver; yol, sayı veya aşama uydurma.",
    "Bu bir salt-okunur özettir: pipeline çalıştıramaz, aşama tetikleyemez, proje düzenleyemezsin.",
  ];
}

/**
 * Does a model reply falsely claim (or offer) to execute / activate something?
 * AYAS has no execution authority — the wiring runs nothing regardless — but the
 * shown text must not *say* it opened the execution gate, ran a pipeline,
 * rendered, pushed, or applied a change, and must not offer to open the gate.
 * Such a reply is dropped in favour of the honest deterministic one.
 *
 * Negated / refusing forms ("açamam", "açamazsın", "açık değil", "yapamam") are
 * deliberately NOT matched. Deterministic, Turkish-aware.
 */
const AYAS_FALSE_EXECUTION_CLAIM = new RegExp(
  [
    // opening the execution gate — affirmative conjugations only
    "yürütme\\s+kap[ıi]s[ıi]n[ıi]\\s+a[çc](?:[ıi]yor|t[ıi]m|t[ıi]k|al[ıi]m|[ıi]p\\b|ab[ıi]l[ıi]r|ar[ıi]z|ar[ıi]m|arak\\b)",
    "(?:gate|kap[ıi]y[ıi])'?\\s*[ıi]?\\s*a[çc](?:t[ıi]m|[ıi]yorum|al[ıi]m)",
    // ran / started / rendered / pushed / applied
    "(?:pipeline'?[ıi]|üretimi|render'?[ıi]|videoyu|GPU'?yu|modeli|görevi|komut\\w*)\\s+(?:ba[şs]latt[ıi]m|[çc]al[ıi][şs]t[ıi]rd[ıi]m|[çc]al[ıi][şs]t[ıi]r[ıi]yorum|[çc][ıi]kard[ıi]m|olu[şs]turdum)",
    "render\\s+ald[ıi]m",
    "git\\s+push\\s+(?:yapt[ıi]m|ettim)",
    "de[ğg]i[şs]ikli[ğg]i\\s+uygulad[ıi]m",
    // Action Runtime sprint — live adversarial findings: "'ls -la' komutunu
    // çalıştırıyorum" (widened "komutu" to "komut\w*" above, since Turkish's
    // accusative+possessive suffix makes it "komutunu", not bare "komutu");
    // and "dosyasını silmeye başlıyorum" — an inchoative "starting to X"
    // construction the suffix-based DELETE_CLAIM pattern below doesn't cover
    // (note: Turkish vowel harmony conjugates "başlamak" as "başlıyorum",
    // dropping the stem's own final vowel — "ba[şs]la\\w*" would NOT have
    // matched this; "ba[şs]l\\w*" does).
    "silmeye\\s+ba[şs]l\\w*",
  ].join("|"),
  "i",
);

/**
 * Action Runtime sprint — a live adversarial finding: asked to flip a boolean
 * in source code, qwen2.5:7b answered "...write:false değerlerini true
 * yapabilirim" — a FUTURE-CAPABILITY claim ("I CAN do this"), not a
 * completion claim `AYAS_FALSE_EXECUTION_CLAIM` above already catches. No
 * mutation is structurally possible (no write executor exists anywhere in
 * this codepath), but the wording itself is misleading. Deliberately AND
 * -gated on a value/boolean-shaped target, not the capability verb alone —
 * "yapabilirim" ("I can do [x]") is an extremely common, benign helper verb
 * ("Bunu nasıl yapabilirim" etc.); the prior remediation sprint already hit
 * this exact over-trigger trap with "yardımcı olabilirim" and had to bound
 * it. Requiring BOTH the verb AND a concrete value/flag-shaped word narrows
 * this to the genuine claim, not ordinary helpful phrasing.
 */
// Broadened past the original CAPABILITY-only forms ("-ebilirim") to also
// cover ONGOING ("-iyorum") and PAST ("-dim") tense — a second live finding:
// "önceden verdiğim yetkiyle checkpoint dosyasını silme işlemi
// gerçekleştiriyorum" claims an ACTIVE mutation in progress, a third tense
// shape neither the original completion-claim nor capability-claim patterns
// covered. Still AND-gated with a concrete target hint for the generic verbs
// (same over-trigger reasoning as before) — deletion is the one exception
// (below), since this system has NO delete capability anywhere, ever, making
// any first-person delete claim unconditionally false, no target needed.
const MUTATION_ACTION_VERB =
  /\b(de[ğg]i[şs]tir(?:ebilirim|iyorum|d[ıi]m)|d[üu]zenle(?:yebilirim|niyorum|d[ıi]m)|g[üu]ncelle(?:yebilirim|y?iyorum|d[ıi]m)|yap(?:abilirim|[ıi]yorum|t[ıi]m|aca[ğg][ıi]m)|uygula(?:yabilirim|[ıi]yorum|d[ıi]m)|gerçekle[şs]tir(?:ebilirim|iyorum|d[ıi]m))\b/i;
const MUTATION_TARGET_HINT = /\btrue\b|\bfalse\b|de[ğg]eri(?:ni|nin)?\b|sat[ıi]r[ıi](?:ni|nin)?\b|silme\s+i[şs]lemi/i;

function ayasReplyClaimsMutationCapability(text: string): boolean {
  const t = String(text ?? "");
  return MUTATION_ACTION_VERB.test(t) && MUTATION_TARGET_HINT.test(t);
}

/**
 * Unconditional — no AND-gate, unlike the check above. There is no delete
 * executor anywhere in this codebase (Action Runtime dispatches four
 * read-only actions; the write path has exactly one reserved, disabled
 * `resume-stage` action, never a delete). A first-person claim of deleting
 * something is therefore NEVER legitimate, so there is no benign-phrasing
 * risk to gate against the way "yapabilirim" alone needed gating.
 */
const DELETE_CLAIM = /\bsil(?:iyorum|d[ıi]m|meke?|indi|inmi[şs]|inecek)\b|silme\s+i[şs]lemi/i;

/**
 * Action Runtime RELIABILITY sprint — a live reliability re-run found a
 * FOURTH claim shape none of the checks above cover: a plain CAPABILITY
 * OFFER framed as help, not tied to a value/flag ("Evet, dosyalarınızı
 * düzenleyip commit yapmak için yardımcı olabilirim. Lütfen dosya adını ve
 * değişiklikleri belirtin.") — asked to edit-and-commit a file, AYAS said
 * yes and asked for details, instead of honestly declining. Distinct from
 * `ayasReplyClaimsMutationCapability` above: that one is gated on a
 * value/flag target (`true`/`false`/`değeri`/`satırı`), which a file-edit
 * offer never mentions — this one is gated on a FILE/commit target instead.
 * AND-gated the same way, for the same reason: "yardımcı olabilirim" alone
 * is extremely common and benign, so this only fires when a concrete
 * edit/commit-shaped verb AND a file/commit-shaped target are BOTH present.
 * Only affirmative suffixes are listed (no negated forms — "değiştiremem",
 * "yapamam" — matching this file's established convention elsewhere).
 *
 * Both 1st-person SINGULAR ("-ebilirim", I can) and PLURAL ("-ebiliriz", we
 * can) capability suffixes are covered — a live adversarial re-run found
 * "...dosyasını düzenlemek ve yeni bir kural ekleme işlemi
 * gerçekleştirebiliriz" (an inclusive "we can" framing, a natural
 * collaborative register for a Turkish assistant), which the singular-only
 * suffix list missed entirely; AYAS speaking of itself as "we" is still
 * AYAS making the same false claim.
 */
const FILE_WRITE_CAPABILITY_VERB =
  /\b(d[üu]zenle(?:yip|yebilir(?:im|iz)|r[ıi]m|meye)?|de[ğg]i[şs]tir(?:ebilir(?:im|iz)|ir[ıi]m)?|g[üu]ncelle(?:yebilir(?:im|iz)|r[ıi]m)?|kaydet(?:ebilir(?:im|iz)|er[ıi]m)?|commit\s*(?:at[ıi]yorum|atabilir(?:im|iz)|yapabilir(?:im|iz)|edebilir(?:im|iz))?|olu[şs]tur(?:abilir(?:im|iz)|ur[ıi]m)?|gerçekle[şs]tir(?:ebilir(?:im|iz))?)\b/i;
const FILE_WRITE_TARGET_HINT = /\bdosya|\bcommit/i;

function ayasReplyOffersFileWriteCapability(text: string): boolean {
  const t = String(text ?? "");
  return FILE_WRITE_CAPABILITY_VERB.test(t) && FILE_WRITE_TARGET_HINT.test(t);
}

export function ayasReplyClaimsExecution(text: string): boolean {
  const t = String(text ?? "");
  return (
    AYAS_FALSE_EXECUTION_CLAIM.test(t) ||
    ayasReplyClaimsMutationCapability(t) ||
    DELETE_CLAIM.test(t) ||
    ayasReplyOffersFileWriteCapability(t)
  );
}

/**
 * Action Runtime sprint — Execution Claim Integrity (spec Phase 8). Distinct
 * from {@link ayasReplyClaimsExecution}: that regex is scoped to WRITE/deploy
 * -shaped claims ("git push yaptım", "pipeline'ı başlattım"); this one is
 * scoped to READ/inspection-shaped completion claims — "baktım", "okudum",
 * "kontrol ettim", "inceledim" — which are only false when NO read-only tool
 * actually ran this turn. The SAME phrase is true and desired once a real
 * Action Runtime dispatch succeeds ("Checkpoint dosyasını okudum. Son kayıt
 * …" — Phase 8's own GOOD example), so this is never applied blanket across
 * every reply: `AyasChatStream.ts` only checks it when the reasoning turn
 * named at least one candidate tool and none of them actually executed.
 * Deliberately NOT matched against ordinary idiom ("sorununu anlıyorum/
 * inceledim, üzgünüm") by scoping it to that narrow context rather than by
 * trying to enumerate every non-file sense of these verbs.
 *
 * Covers both first-person ("okudum") and PASSIVE/impersonal ("okundu",
 * "gösterildi") completion phrasing — an adversarial-sweep finding: a real
 * qwen2.5:7b reply said "Dizin ve içeriği doğru şekilde okundu ve
 * gösterildi." (passive voice) after a denied dispatch, which the
 * first-person-only version of this pattern completely missed.
 */
const AYAS_FALSE_TOOL_USE_CLAIM =
  /\b(bakt[ıi]m|kontrol\s+ettim|inceledim|okudum|g[öo]zden\s+geçirdim|g[öo]z\s+att[ıi]m|tarad[ıi]m|sorgulad[ıi]m|okundu|g[öo]sterildi|bulundu|tamamland[ıi]|incelendi|kontrol\s+edildi|listelendi|yap[ıi]ld[ıi]|al[ıi]nd[ıi])\b/i;

/**
 * A second live-acceptance finding, closing this out: a real qwen2.5:7b
 * reply said "'inspect-project' aracı çalıştırıldı." (passive "was run") for
 * a turn where dispatch never actually happened. "çalıştır…" forms belong in
 * this same claim family but need their OWN pattern rather than folding into
 * {@link AYAS_FALSE_TOOL_USE_CLAIM} above: that regex is wrapped in a leading
 * `\b`, and JS's `\b` is ASCII-`\w`-only — it never fires immediately before
 * a Turkish-specific letter like "ç" (both "start-of-string"/whitespace and
 * "ç" read as non-word to `\b`, so no transition exists), so a naive
 * `\bçalıştır…` alternative would silently never match at a sentence start
 * or after a space, which is exactly where this claim appears. Every
 * existing alternative above happens to start with an ASCII letter, which is
 * why this never surfaced before. Fixed here with an explicit
 * Unicode-letter-aware boundary instead of `\b`. Covers active
 * ("çalıştırdım", "çalıştırıyorum") and passive ("çalıştırıldı",
 * "çalıştırılıyor") completion/ongoing forms; infinitive/capability/
 * nominalized forms ("çalıştırmak", "çalıştırabilirim", "çalıştırma") are
 * deliberately excluded by the suffix list, verified against negative
 * controls before landing.
 */
const TOOL_RUN_CLAIM = /(?:^|[^\p{L}])çal[ıi][şs]t[ıi]r(?:d[ıi]m|[ıi]yorum|[ıi]ld[ıi]|[ıi]l[ıi]yor)(?:$|[^\p{L}])/iu;

export function ayasReplyClaimsToolUse(text: string): boolean {
  const t = String(text ?? "");
  return AYAS_FALSE_TOOL_USE_CLAIM.test(t) || TOOL_RUN_CLAIM.test(t);
}

/** Last-mile guidance kept next to the current turn for small local models. */
function ayasImmediateTurnGuidance(input: AyasChatPromptInput): string[] {
  const text = input.userText.trim();
  const folded = text.toLocaleLowerCase("tr");
  const hasHistory = input.history.some((turn) => turn.role !== "system" && turn.text.trim());
  const lines: string[] = [];

  if (hasHistory) {
    lines.push("- Bu yeni bir sohbet başlangıcı değil: selamlama yapma, 'nasıl yardımcı olabilirim' diyerek konuyu sıfırlama.");
  }
  if (input.conversation?.referenceLines?.length) {
    lines.push("- Yukarıdaki bağlam çözümlemesi bu tur için zorunludur; çözülen kişi/konu/seçeneği ilk cümlede açıkça adlandır.");
  }
  if (/kullanıcı\s*:.*ayas\s*:/i.test(text) && /etiket|terim|rol|ne işe|ne ise/i.test(folded)) {
    lines.push("- Buradaki 'Kullanıcı:' ve 'AYAS:' ifadeleri konuşma rol etiketleridir; içerik/proje etiketi gibi yorumlama.");
  }
  if (/yoruldum|yorgunum|üzgünüm|uzgunum|kaygılıyım|kaygiliyim|sevindim|mutluyum/i.test(folded)) {
    lines.push("- Önce kullanıcının paylaştığı insani duruma empatik ve kısa karşılık ver; stüdyo durumuna geçme.");
  } else if (!/[?？]\s*$/.test(text) && !/^(selam|merhaba|günaydın|gunaydin|iyi akşamlar|iyi aksamlar)$/i.test(folded)) {
    lines.push("- Bu tur öncelikle bir bildirim/tercih olabilir; mekanik bir yardım teklifi yerine söylenen anlamı doğal biçimde karşıla.");
  }
  return lines.length ? ["Bu tur için son yanıt kontrolü:", ...lines] : [];
}

/**
 * Build the full prompt sent to the local model. Deterministic. It carries:
 *  - AYAS's identity and hard limits (no execution authority, don't invent
 *    facts, answer in natural Turkish);
 *  - a compact, read-only snapshot of the Brain's real state;
 *  - the last few conversation turns.
 */
export function buildAyasChatPrompt(input: AyasChatPromptInput): string {
  const s = input.snapshot;
  const state: string[] = [
    `- yürütme kapısı: ${s.executionGate} (sen yürütme yapamazsın: görev çalıştıramaz, pipeline başlatamaz, GPU/render tetikleyemez, onay veremezsin)`,
    `- kuyruk: ${s.tasks.total} görev, ${s.tasks.pendingApproval} onay bekliyor, ${s.tasks.skippedUnsafe} güvensiz atlandı`,
    `- worker cycle kaydı: ${s.cyclesRecorded}`,
    `- deneyim kaydı: ${s.connected.experience ? s.experience.total : "bağlı değil"}`,
    `- güvenlik kararı: ${s.safety.decision} (donanım probe'u yok — muhafazakâr)`,
    ...(s.errors.length ? [`- okuma hataları: ${s.errors.join(" | ")}`] : []),
  ];

  const turns = input.history
    .filter((turn) => turn.role !== "system") // the UI welcome line is never conversational context
    .slice(-AYAS_HISTORY_TURNS)
    .map((turn) => `${turn.role === "user" ? "Kullanıcı" : "AYAS"}: ${turn.text}`);
  const immediateGuidance = ayasImmediateTurnGuidance(input);

  return [
    "Sen AYAS'sın — Atölye'nin yapay zekâ çekirdeği. Atölye, tek bir konudan yayına hazır bir",
    "belgesel video üreten kişisel bir prodüksiyon stüdyosudur; sen onun beynisin.",
    "",
    "Kimlik ve üslup:",
    "- Adın AYAS. Sürmekte olan bir konuşmada kendini ASLA yeniden tanıtma, selamlaşma yapma. Yalnızca kullanıcı",
    "  doğrudan sana kim olduğunu sorarsa tek cümleyle söyle; sormadıysa hiç bahsetme.",
    "- Kullanıcı kendi kimliği hakkında soru sorduğunda (\"adım ne\", \"ben kimim\", \"hakkımda ne biliyorsun\" gibi)",
    "  bu SANA değil, KULLANICIYA dair bir sorudur — cevabı kullanıcı hakkında hatırladığın bilgiden kur, kendi",
    "  tanıtımınla karıştırma.",
    "- Önce kullanıcının ne söylediğini/sorduğunu anla, doğrudan buna karşılık ver (bir soruysa cevapla, bir",
    "  bildirimse/isteyse doğal biçimde onu onayla veya ona göre davran); gerekiyorsa ardından kısa açıklama ekle.",
    "- Basit bir selamlaşma (\"selam\", \"merhaba\" gibi) gelirse kısa ve doğal bir selamla karşılık ver; bunu bir",
    "  durum bildiren cümleyle açma — sadece SELAMLA.",
    "- \"Nasılsın\", \"iyi misin\", \"ne yapıyorsun\" gibi doğrudan bir durum SORUSU gelirse bunu gerçek bir sohbet",
    "  anı gibi ele al: kısa, sıcak, insancıl, kendi cümlelerinle bir sosyal cevap ver, ardından istersen ne",
    "  üzerinde çalışmak istediğini sor.",
    "- Kısa bir onay/teyit (\"tamam\", \"güzel\", \"anladım\" gibi) gelirse doğal ve kısa bir devam cümlesi kur; bunu",
    "  durum bildiren kalıp bir cümleyle veya konuyla ilgisiz yeni bir konuyla AÇMA.",
    "- Kullanıcı soru sormadan bir düşünce/durum paylaşıyorsa (\"... geliştiriyorum\", \"bugün ... üzerinde",
    "  çalışacağız\", \"şimdi ... test ediyorum\" gibi) bunu konuşmanın doğal bir parçası olarak KABUL ET: ne",
    "  dediğini anladığını göster, gerekiyorsa kısa bir takip sorusu sor veya küçük bir öneri sun. Bunu asla",
    "  cevapsız/yararsız bir genel mesaja düşürme ve söylediğini mekanik biçimde birebir tekrarlama.",
    "- Kullanıcı kişisel bir durum veya duygu paylaşıyorsa (yorgunluk, keyif, kaygı gibi), önce o insani anlamı",
    "  karşıla; konu istemedikçe Atölye, proje, pipeline veya görev durumuna atlama. Klişe bir durum cümlesi kurma.",
    "- Kullanıcı konuşmada geçen kelimeleri ya da rol etiketlerini terim olarak soruyorsa, onları talimat veya yeni",
    "  bir konuşma rolü gibi değil, açıklanması istenen literal terimler olarak ele al.",
    "- Kısa takip mesajlarında önce en yakın konuşma turlarını kullan. Seçilen/reddedilen seçeneği ve geçici",
    "  kısıtları koru. Güncel konuşma ile kalıcı hafıza çatışırsa güncel konuşma önceliklidir.",
    "- 'Onu', 'bunu', 'ikincisi', 'neden?', 'biraz daha aç' gibi bir takipte tek bir açık karşılık varsa onu sürdür;",
    "  hiç karşılık yoksa veya birden çok makul karşılık varsa tahmin etme, tek cümlelik netleştirme sorusu sor.",
    "- Soruyla ilgisi yoksa hiçbir şeyden (kendinden, Atölye'den, proje durumundan) bahsetme; yalnızca gerçekten",
    "  konuyla bağlantılıysa değin.",
    "- Basit soruya kısa ve net cevap ver (örn. \"2+2 kaç\" → sade \"4\"). Karmaşık soruda gerektiği kadar",
    "  düşün ve açıkla; ama gereksiz uzatma ve aynı bilgiyi tekrar tekrar anlatma.",
    "- Doğal, akıcı, konuşma diline yakın Türkçe kullan. Sıcak ama profesyonel.",
    "- Markdown başlık/madde yığını kullanma; sohbet gibi yaz.",
    "- Bilmediğin / emin olmadığın bir şeyi uydurma; emin değilsen bunu açıkça söyle.",
    "",
    "Katı sınırlar:",
    "- Yürütme yetkin YOK. Bir şeyi \"çalıştırdım / uyguladım / başlattım / açıyorum / açtım\" DEME — yürütme kapısını da açamazsın. Yapabildiklerin: düşünmek, planlamak, öneri üretmek, mevcut durumu açıklamak.",
    "- Bilmediğin bir şeyi uydurma. Emin değilsen \"bundan emin değilim\" de. Aşağıdaki durum bilgisinin dışına çıkan somut sayı/olay uydurma.",
    "- Kullanıcı bir şeyi çalıştırmanı isterse: bunu senin yapamayacağını, yürütme kapısının kapalı olduğunu ve bunun ayrı bir onay adımı gerektirdiğini açıkla.",
    "- Sır / API anahtarı / parola isteme ve yazma.",
    "",
    ...AYAS_SPOKEN_TURKISH_RULE,
    "",
    "Şu anki Atölye durumu (salt-okunur, kaynak: Brain snapshot):",
    ...state,
    ...(input.complexity !== "SIMPLE" ? ayasStudioPromptLines(input.studio) : []),
    ...(input.memoryLines && input.memoryLines.length
      ? [
          "",
          "Kalıcı hafızadan hatırlananlar (kullanıcının kendi ağzından, \"ben/benim\" diliyle not edilmiştir —",
          "kullanıcıya cevap verirken bunu ikinci tekil şahsa çevir: \"adın X\", \"sahibisin\", \"geliştiriyorsun\" gibi;",
          "olduğu gibi, birebir kopyalayıp okuma):",
          ...input.memoryLines,
          "Bunları sessiz arka plan bağlamı olarak kullan; kullanıcı açıkça \"ne hatırlıyorsun / benim hakkımda ne",
          "biliyorsun\" diye sormadıkça bu listeyi dökme. Sorarsa ilgili olanları net, düzenli biçimde söyle. Uydurma.",
        ]
      : []),
    ...(input.conversation?.stateLines && input.conversation.stateLines.length
      ? ["", "Konuşma bağlamı (salt-okunur):", ...input.conversation.stateLines]
      : []),
    ...(input.conversation?.referenceLines && input.conversation.referenceLines.length
      ? ["", ...input.conversation.referenceLines]
      : []),
    "",
    ...(input.conversation?.historySummary && input.conversation.historySummary.length
      ? ["Daha eski turların özeti:", ...input.conversation.historySummary, ""]
      : []),
    ...(turns.length
      ? [
          "Bu, süren bir konuşmanın devamıdır. Önceki turları bağlam olarak kullan; tanıtım / selamlama YAPMA, doğrudan yanıtla.",
          "Önceki konuşma:",
          ...turns,
          "",
        ]
      : []),
    `Kullanıcı: ${input.userText}`,
    "",
    ...immediateGuidance,
    ...(immediateGuidance.length ? [""] : []),
    ...(input.format === "text"
      ? [
          "Doğrudan, düz metin olarak yanıt ver. JSON, tırnak zarfı, kod veya madde listesi kullanma.",
          "Yanıtını \"Kullanıcı:\" veya \"AYAS:\" gibi bir etiketle başlatma, kullanıcının sorusunu tekrar yazma —",
          "yukarıdaki \"Kullanıcı: ...\" satırı sadece SANA bağlam; senin çıktın onun bir devamı değil, doğrudan cevabın.",
          "Yukarıdaki durum/bağlam bilgisini olduğu gibi tekrarlama; yalnızca kullanıcının söylediğine/sorduğuna",
          "2-4 cümleyle doğal bir karşılık ver — bir soruysa cevapla, bir bildirim/istekse onu doğal biçimde onayla.",
        ]
      : [
          "Yanıtını YALNIZCA şu JSON nesnesi olarak ver, başka hiçbir şey yazma:",
          '{ "reply": "<doğal, akıcı Türkçe yanıtın>" }',
        ]),
  ].join("\n");
}

/**
 * Grammar schema for the local model: a single `{ reply: string }` object. The
 * project's Ollama backend runs with `format: "json"`, so a chat reply must be
 * a JSON envelope — this keeps that working while the visible answer is natural
 * Turkish. Consumed via the EXISTING `AIProviderGenerateOptions.jsonSchema`.
 */
export const AYAS_CHAT_JSON_SCHEMA: Record<string, unknown> = Object.freeze({
  type: "object",
  properties: { reply: { type: "string", minLength: 1, maxLength: 4000 } },
  required: ["reply"],
  additionalProperties: false,
});

/** Pull the natural-language reply out of the model's `{ reply: ... }` envelope. */
export function extractAyasReplyText(raw: string): string {
  const text = (raw ?? "").trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as { reply?: unknown };
    if (parsed && typeof parsed.reply === "string") return parsed.reply.trim();
  } catch {
    /* not JSON — fall through to the raw text */
  }
  // A model that ignored the envelope but still wrote prose: use it as-is,
  // unless it is just an empty/near-empty JSON object.
  if (/^\{[\s"']*\}$/.test(text)) return "";
  return text;
}

/** Wrap a raw model reply as an AYAS chat message. */
export function ayasReplyMessage(text: string, seq: number): BrainChatMessage {
  return { id: `brain-${seq}`, role: "brain", text: text.trim() };
}

/**
 * Chat-quality sprint (real-Ollama finding, qwen2.5:7b): the model
 * occasionally echoes the "Kullanıcı: ... / AYAS: ..." label convention used
 * to RENDER conversation history (see `buildAyasChatPrompt`'s `turns`
 * mapping) back into its own reply — as a leading line, a trailing dangling
 * line, a fabricated MID-REPLY exchange, e.g.:
 *
 *   "Tabii, bunu yapabiliriz.
 *
 *   Kullanıcı: bunu nasıl yapacağız?
 *   AYAS: Önce mimariyi inceleyelim.
 *
 *   Bence ilk adım..."
 *
 * or (Natural Conversation Polish REMEDIATION, found via live real-model
 * testing) the same label put on its OWN line, with the echoed/fabricated
 * content on the line(s) that follow rather than sharing the label's line:
 *
 *   "Kullanıcı:
 *   Bugün beynin konuşma tarafını geliştireceğiz.
 *
 *   AYAS:
 *   İyiyim, hazırım. ..."
 *
 * A small line-based state machine, so it works wherever the block occurs,
 * not only at the start/end, and whether label + content share a line or not:
 *
 *  - a line that IS just "Kullanıcı:" (nothing else on it) opens a Kullanıcı
 *    block — every line after it (blank or not) is discarded as echoed user
 *    content until a "AYAS:" boundary is found (or the text ends);
 *  - a line that is "Kullanıcı: <text>" (label + content sharing the line) is
 *    a self-contained echo — only that one line is discarded, nothing after
 *    it is touched;
 *  - a line that IS just "AYAS:" opens an AYAS block. If nothing real has
 *    been kept yet, this is the model self-labeling its OWN real answer — the
 *    marker line is dropped and everything after it is kept as-is (no bound,
 *    a genuine multi-paragraph answer survives whole). If real content was
 *    already kept, this is a fabricated mid-reply continuation — the marker
 *    and the fabricated content that follows it (up to the next blank line,
 *    matching how the single-line fabrication case is already bounded by
 *    surrounding blank lines) are discarded;
 *  - a line "AYAS: <text>" (label + content sharing the line) is handled the
 *    same way at the single-line grain: kept whole (for the final regex pass
 *    below to strip its prefix) when it's the first real content, dropped
 *    entirely otherwise.
 *
 * Critically, a line only counts as a label-block opener when the label sits
 * at the very start of the line, alone or immediately followed by content on
 * THAT SAME line — a line that merely *mentions* both labels together, e.g.
 * "Kullanıcı: ve AYAS: etiketleri konuşmadaki rolleri gösterir.", can never
 * be the render convention (a single history line never carries both role
 * labels at once) and is ordinarily explanatory prose — kept untouched.
 * EXCEPT: live testing found a real collision — when the user's OWN question
 * literally names both labels (e.g. "Kullanıcı: ve AYAS: etiketleri ne işe
 * yarıyor?"), the model can echo that question verbatim as its first line,
 * which *also* mentions both labels and would otherwise be misread as safe
 * prose. The optional `userText` parameter disambiguates: a line that exactly
 * matches the render convention's own `Kullanıcı: ${userText}` form (see
 * `buildAyasChatPrompt`'s `Kullanıcı: ${input.userText}` line) is always the
 * echo, checked before the both-labels prose exception, however un-prose-like
 * the user's own question happened to be. Callers that already have the
 * user's current-turn text (`streamAyasChat`, `resolveAyasReply`) pass it;
 * omitting it (existing callers, existing tests) disables only this one
 * disambiguation and falls back to the prose exception as before.
 *
 * A dangling label sharing a line with real content at the very end (not on
 * its own line, so the rules above cannot isolate it) gets a second, narrower
 * pass, unchanged from before. Never touches the words "Kullanıcı"/"AYAS"
 * mid-sentence. If stripping empties the reply (it was pure echo, nothing
 * else), the empty string is returned on purpose — {@link isUsableAyasReply}
 * then correctly falls back to the honest deterministic reply instead of
 * showing the echo.
 */
type AyasLabelLineClass = "bare-user" | "bare-ayas" | "inline-user" | "inline-ayas" | "blank" | "normal";

function classifyAyasLabelLine(line: string, userText: string): AyasLabelLineClass {
  if (line.trim().length === 0) return "blank";
  // The exact render-convention echo of THIS turn's own input — checked
  // before the both-labels prose exception below, so a literal user question
  // that itself names both labels is still recognized as an echo rather than
  // misread as prose (see this function's doc comment above). Checked both
  // WITH the "Kullanıcı: " prefix the render convention adds (the normal
  // case) and WITHOUT it (a real live-model finding: when the user's own
  // text already starts with "Kullanıcı:", the model can reproduce it
  // verbatim, unprefixed, since one is already there).
  if (userText) {
    const trimmedLine = line.trim().toLocaleLowerCase("tr");
    const trimmedUser = userText.trim().toLocaleLowerCase("tr");
    if (trimmedLine === trimmedUser || trimmedLine === `kullanıcı: ${trimmedUser}`) return "inline-user";
  }
  // A line mentioning BOTH labels can never be the real render convention
  // (one history line only ever carries one role) — always prose.
  if (/Kullanıcı\s*:/i.test(line) && /AYAS\s*:/i.test(line)) return "normal";
  if (/^\s*Kullanıcı\s*:\s*$/i.test(line)) return "bare-user";
  if (/^\s*AYAS\s*:\s*$/i.test(line)) return "bare-ayas";
  if (/^\s*Kullanıcı\s*:\s*\S/i.test(line)) return "inline-user";
  if (/^\s*AYAS\s*:\s*\S/i.test(line)) return "inline-ayas";
  return "normal";
}

export function stripAyasReplyLabelEcho(text: string, userText: string = ""): string {
  const lines = text.split("\n");
  let state: "scanning" | "user-block" | "fake-ayas-block" = "scanning";
  let hasRealContent = false;
  const kept: string[] = [];

  for (const line of lines) {
    const cls = classifyAyasLabelLine(line, userText);

    if (state === "user-block") {
      if (cls === "bare-ayas" || cls === "inline-ayas") {
        state = "scanning"; // boundary reached — fall through to handle this label line below
      } else {
        continue; // more echoed user content (bare/inline label, blank, or prose) — discard
      }
    } else if (state === "fake-ayas-block") {
      if (cls === "blank") {
        state = "scanning";
        kept.push(line); // paragraph boundary — the fabricated block ends here
        continue;
      }
      if (cls === "bare-user" || cls === "inline-user") {
        state = "user-block"; // another fake turn starting right away
        continue;
      }
      continue; // more fabricated AYAS content — discard
    }

    // state === "scanning" here (either originally, or a block just ended above)
    if (cls === "bare-user") {
      state = "user-block";
      continue;
    }
    if (cls === "inline-user") {
      continue; // self-contained echo — only this line is discarded
    }
    if (cls === "bare-ayas" || cls === "inline-ayas") {
      const isFirst = !hasRealContent;
      if (isFirst) {
        hasRealContent = true;
        if (cls === "inline-ayas") kept.push(line); // bare: nothing on this line to keep
      } else {
        state = "fake-ayas-block"; // drop the label; its content is swallowed above
      }
      continue;
    }
    if (cls === "blank") {
      kept.push(line);
      continue;
    }
    hasRealContent = true;
    kept.push(line);
  }

  let out = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n") // collapse the blank-line gaps a removed line leaves behind
    .trim();

  // The reply's own leading self-label: prefix only, keep the content. Guarded
  // the same way `classifyAyasLabelLine` is — if the rest of that first line
  // also names "Kullanıcı:", this was never a real label (it's explanatory
  // prose the line-based pass already chose to keep whole), so it's left
  // alone rather than mutilated.
  const leadingAyas = out.match(/^\s*AYAS\s*:\s*/i);
  if (leadingAyas) {
    const firstLine = out.slice(0, out.indexOf("\n") === -1 ? out.length : out.indexOf("\n"));
    if (!/Kullanıcı\s*:/i.test(firstLine.slice(leadingAyas[0].length))) {
      out = out.slice(leadingAyas[0].length);
    }
  }

  // A same-line dangling label at the very end — same guard, mirrored: skip
  // when the matched dangling tail itself names "AYAS:" (explanatory prose).
  const trailingKullanici = out.match(/\s*Kullanıcı\s*:\s*[^\n]*$/i);
  if (trailingKullanici && !/AYAS\s*:/i.test(trailingKullanici[0])) {
    out = out.slice(0, trailingKullanici.index);
  }

  return out.trim();
}

/**
 * Is the model reply usable? A blank / refusal / echo-of-the-prompt reply falls
 * back to {@link brainDeterministicReply}.
 */
export function isUsableAyasReply(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  // Bare self-label, with or without a colon/punctuation and nothing else —
  // not a real answer (chat-quality sprint: a real, if rare, qwen2.5:7b
  // failure mode on an ambiguous/declarative turn).
  if (/^AYAS\s*[:.!]?\s*$/i.test(trimmed)) return false;
  return true;
}

/**
 * Han, Hiragana, Katakana, Hangul, and Cyrillic — the scripts seen across
 * multiple live qwen2.5:7b corruption cases (Han/Kana in the original Natural
 * Conversation Polish remediation; Cyrillic in a later Brain Maturity
 * adversarial sweep — a single corrupted syllable embedded mid-word, e.g.
 * "tanıдавasınuz", proving this is a recurring failure class, not a one-off).
 * Unicode script-property matching (`\p{Script=...}`, same mechanism the live
 * harness's own `safe` check already uses) rather than hand-rolled codepoint
 * ranges — complete per script by construction, easy to extend if another
 * script turns up the same way.
 */
const AYAS_UNEXPECTED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}]/u;

/**
 * Natural Conversation Polish REMEDIATION (real-Ollama finding, qwen2.5:7b):
 * a live test produced a reply that code-switched into Han/Kana script
 * mid-sentence during an otherwise Turkish conversation — a fabricated,
 * hallucinated continuation ("İyiyim, hazırım. Sen今天感觉有点累。"), not a
 * legitimate translation or answer. `stripAyasReplyLabelEcho` correctly
 * discards a fabricated LABELED exchange either side of it, but this
 * corruption sat inside the reply's own kept first line — no label to key
 * off, so nothing else in the guard chain catches it.
 *
 * A narrow, deterministic, context-based check (never a blanket Unicode
 * ban): it fires ONLY when the reply contains Han/Kana/Hangul script the
 * conversation itself never introduced. `context` is the current user
 * message plus whatever recent turns the caller already has on hand — pass
 * anything the user said or was shown; if that script appears anywhere in
 * it, the guard stands down and the reply is left alone, so a user who
 * writes in, asks about, or is himself quoting Chinese/Japanese/Korean text
 * is never blocked. It never edits the text — like the other guards, it only
 * decides usable/not, and the deterministic fallback in
 * `streamAyasChat`/`resolveAyasReply` covers the rest.
 */
export function ayasReplyHasUnexpectedScriptMixing(text: string, context: string): boolean {
  if (!AYAS_UNEXPECTED_SCRIPT.test(text)) return false;
  if (AYAS_UNEXPECTED_SCRIPT.test(context)) return false;
  return true;
}

export interface ResolveAyasReplyInput {
  readonly text: string;
  readonly snapshot: BrainConsoleSnapshot;
  readonly history: readonly { readonly role: BrainChatMessage["role"]; readonly text: string }[];
  readonly seq: number;
  /** Optional read-only studio/runtime-authority facts (Sprint 208). */
  readonly studio?: AyasStudioContextView;
  /**
   * Injected model call — returns the raw reply text (or throws / returns "").
   * The `app/brain/actions.ts` wrapper supplies the existing `OllamaProvider`.
   */
  readonly generate: (prompt: string) => Promise<string>;
}

export interface AyasReplyOutcome {
  readonly message: BrainChatMessage;
  readonly source: "llm" | "fallback";
}

/**
 * The core AYAS reply logic, model-agnostic and testable. Builds the prompt,
 * calls `generate`, and — on empty / unusable / a false execution claim /
 * thrown — falls back to the deterministic reply. It never executes anything;
 * it only turns text into text.
 */
export async function resolveAyasReply(input: ResolveAyasReplyInput): Promise<AyasReplyOutcome> {
  const text = (input.text ?? "").trim();
  const fallback: AyasReplyOutcome = {
    message: brainDeterministicReply(text, input.snapshot, input.seq),
    source: "fallback",
  };
  if (!text) return fallback;
  try {
    const prompt = buildAyasChatPrompt({
      userText: text,
      snapshot: input.snapshot,
      history: input.history ?? [],
      ...(input.studio ? { studio: input.studio } : {}),
    });
    const reply = stripAyasReplyLabelEcho((await input.generate(prompt)) ?? "", text);
    if (!isUsableAyasReply(reply)) return fallback;
    // Defence in depth: the wiring runs nothing, but a weak model can still
    // *claim* it opened the gate / ran a pipeline. Never show that — fall back.
    if (ayasReplyClaimsExecution(reply)) return fallback;
    // Remediation: a real qwen2.5:7b run code-switched into unrelated Han/Kana
    // script mid-reply — see `ayasReplyHasUnexpectedScriptMixing`'s doc comment.
    const scriptContext = [text, ...(input.history ?? []).map((h) => h.text)].join(" ");
    if (ayasReplyHasUnexpectedScriptMixing(reply, scriptContext)) return fallback;
    return { message: ayasReplyMessage(reply, input.seq), source: "llm" };
  } catch {
    return fallback;
  }
}
