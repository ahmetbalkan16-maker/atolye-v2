/**
 * Atölye Brain Core — pure UI state model (Sprint 184).
 *
 * No React, no DOM. The visual components (`BrainCoreOrb`, `BrainConsoleView`)
 * and the smoke suite both consume these helpers, so the Brain Core's behaviour
 * is testable without a browser.
 */

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
  | "error";

export interface BrainCoreStateInfo {
  readonly state: BrainCoreState;
  readonly label: string;
  readonly tr: string;
  readonly description: string;
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
      intensity: 0.35,
      hue: "cyan",
    },
    active: {
      state: "active",
      label: "Active",
      tr: "Etkin",
      description: "Talking with you / taking your input.",
      intensity: 0.6,
      hue: "cyan",
    },
    thinking: {
      state: "thinking",
      label: "Thinking",
      tr: "Düşünüyor",
      description: "Running a safe analysis or planning step.",
      intensity: 0.75,
      hue: "violet",
    },
    learning: {
      state: "learning",
      label: "Learning",
      tr: "Öğreniyor",
      description: "Reviewing experience / knowledge.",
      intensity: 0.7,
      hue: "emerald",
    },
    working: {
      state: "working",
      label: "Working",
      tr: "Çalışıyor",
      description: "A Brain Worker cycle is processing safe tasks.",
      intensity: 0.85,
      hue: "violet",
    },
    warning: {
      state: "warning",
      label: "Warning",
      tr: "Uyarı",
      description: "Something needs your approval or attention.",
      intensity: 0.9,
      hue: "amber",
    },
    error: {
      state: "error",
      label: "Error",
      tr: "Hata",
      description: "A read failed — check the details.",
      intensity: 1,
      hue: "rose",
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
        ? "Atölye'nin merkezine bağlısın. Brain altyapısı okunuyor; yürütme kapısı kapalı."
        : "Atölye Brain Core. Henüz kalıcı bir durum yok — kuyruk ve deneyim store'ları boş.",
  };
}
