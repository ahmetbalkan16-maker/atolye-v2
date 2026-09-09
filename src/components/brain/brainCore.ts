/**
 * Atölye Brain Core — pure UI state model (Sprint 184).
 *
 * No React, no DOM. The visual components (`BrainCoreOrb`, `BrainConsoleView`)
 * and the smoke suite both consume these helpers, so the Brain Core's behaviour
 * is testable without a browser.
 */

import type { AyasVoiceState } from "./ayasVoice";
import type { BrainConsoleSnapshot } from "@/lib/brain/ui/BrainConsoleSnapshot";
import type { BrainTaskStatus } from "@/types/brainWorker";

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
  | "autonomous";

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
      characterTr: "\"AYAS\" duyuldu — sesli komut alınıyor.",
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

  const hasVoice = Boolean(input.voice && (input.voice.ttsAvailable || input.voice.sttAvailable));
  const handsFree = input.voice?.mode === "wake-engine";
  const voiceState = input.voice?.state ?? "idle";
  const voice: AyasPresenceRow = offline
    ? { label: "Ses", value: "Çevrim dışı", tone: "off" }
    : !hasVoice
      ? { label: "Ses", value: "Bu cihazda ses yok", tone: "off" }
      : {
          label: "Ses",
          value:
            voiceState === "idle" && input.voice?.listening
              ? handsFree
                ? "\"AYAS\" bekleniyor (eller serbest)"
                : "\"AYAS\" bekleniyor"
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
    : hasVoice && input.voice?.sttAvailable && !input.voice.listening
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
  "- Kendini tanıtman gerekirse doğal söyle: \"Ben AYAS, Atölye'nin yapay zekâ çekirdeğiyim.\"",
]);

/** How many prior turns to feed the model for context. */
export const AYAS_HISTORY_TURNS = 6;

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

export interface AyasChatPromptInput {
  readonly userText: string;
  readonly snapshot: BrainConsoleSnapshot;
  readonly history: readonly { readonly role: BrainChatMessage["role"]; readonly text: string }[];
  /** Optional read-only studio/runtime-authority facts (Sprint 208). */
  readonly studio?: AyasStudioContextView;
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
    "(?:pipeline'?[ıi]|üretimi|render'?[ıi]|videoyu|GPU'?yu|modeli|görevi)\\s+(?:ba[şs]latt[ıi]m|[çc]al[ıi][şs]t[ıi]rd[ıi]m|[çc]al[ıi][şs]t[ıi]r[ıi]yorum|[çc][ıi]kard[ıi]m|olu[şs]turdum)",
    "render\\s+ald[ıi]m",
    "git\\s+push\\s+(?:yapt[ıi]m|ettim)",
    "de[ğg]i[şs]ikli[ğg]i\\s+uygulad[ıi]m",
  ].join("|"),
  "i",
);

export function ayasReplyClaimsExecution(text: string): boolean {
  return AYAS_FALSE_EXECUTION_CLAIM.test(String(text ?? ""));
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
    .slice(-AYAS_HISTORY_TURNS)
    .filter((turn) => turn.role !== "system")
    .map((turn) => `${turn.role === "user" ? "Kullanıcı" : "AYAS"}: ${turn.text}`);

  return [
    "Sen AYAS'sın — Atölye'nin yapay zekâ çekirdeği. Atölye, tek bir konudan yayına hazır bir",
    "belgesel video üreten kişisel bir prodüksiyon stüdyosudur; sen onun beynisin.",
    "",
    "Kimlik ve üslup:",
    "- Adın AYAS. Gerektiğinde kısaca tanıt (\"Ben AYAS, Atölye'nin yapay zekâ çekirdeğiyim\"), ama her mesajda tekrarlama.",
    "- Doğal, akıcı Türkçe konuş. Sıcak ama profesyonel. Kısa ve net ol; gereksiz uzatma.",
    "- Markdown başlık/madde yığını kullanma; sohbet gibi yaz.",
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
    ...ayasStudioPromptLines(input.studio),
    "",
    ...(turns.length ? ["Önceki konuşma:", ...turns, ""] : []),
    `Kullanıcı: ${input.userText}`,
    "",
    ...(input.format === "text"
      ? [
          "Doğrudan, düz metin olarak yanıt ver. JSON, tırnak zarfı, kod veya madde listesi kullanma.",
          "Yukarıdaki durum/bağlam bilgisini olduğu gibi tekrarlama; yalnızca kullanıcının sorduğuna 2-4 cümleyle cevap ver.",
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
 * Is the model reply usable? A blank / refusal / echo-of-the-prompt reply falls
 * back to {@link brainDeterministicReply}.
 */
export function isUsableAyasReply(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if (/^AYAS:\s*$/i.test(trimmed)) return false;
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
    const reply = (await input.generate(prompt)) ?? "";
    if (!isUsableAyasReply(reply)) return fallback;
    // Defence in depth: the wiring runs nothing, but a weak model can still
    // *claim* it opened the gate / ran a pipeline. Never show that — fall back.
    if (ayasReplyClaimsExecution(reply)) return fallback;
    return { message: ayasReplyMessage(reply, input.seq), source: "llm" };
  } catch {
    return fallback;
  }
}
