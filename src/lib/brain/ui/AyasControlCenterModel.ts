/**
 * Stage 11 — AYAS Brain Control Center: the pure, deterministic read model.
 *
 * It turns already-collected facts into one owner-centred view: per-domain
 * status, an owner-attention list and a bounded recent-activity feed. Two
 * inputs feed it:
 *
 *  - `server`: facts only the server can read (health, repository, Graphify,
 *    experiments, memory counts, capabilities, security, Atölye inventory),
 *    collected by `AyasControlCenterCollector.ts` and already sanitised.
 *  - the views the Brain page ALREADY loads and refreshes (approval inbox,
 *    micro-batch, owner recommendations, research engine, goals, reports,
 *    autonomous loop). They are passed through, never re-read, so every
 *    domain keeps exactly one source of truth.
 *
 * No I/O, no clock, no authority. Only `import type` from other modules, so it
 * is safe in the client bundle. "Now" is the server's `generatedAt`, which
 * keeps server render and hydration identical.
 *
 * Attention is deterministic and never colour-only: every item carries a
 * level, a reason, its source, a timestamp and a classified next action. A
 * next action is navigation to an existing panel (whose own controls call the
 * existing authority services) or a command for the owner to run. The model
 * never offers a mutation of its own.
 */

import type { AyasApprovalInboxView, AyasDevelopmentProposal } from "../autonomy/AyasApprovalInboxView";
import type { AyasMicroBatchDevelopmentView } from "../autonomy/AyasMicroBatchDevelopmentView";
import type { AyasOwnerRecommendationsView } from "../autonomy/AyasOwnerRecommendationsView";
import type { AyasResearchEngineStatusView } from "../autonomy/AyasResearchEngineStatusView";
import type { AyasGoalDevelopmentView } from "../autonomy/AyasGoalDevelopmentView";
import type { AyasAutonomousView } from "../autonomy/AyasAutonomousView";
import type { AyasHealthVerdict, AyasHealthSeverity } from "../autonomy/AyasSelfImprovementHealth";
import type { BrainReportCenterView } from "../selfheal/BrainReportCenter";
import type { AyasCapability } from "../../ayas/routing/AyasAgenticRouting";
import type { AyasSecurityReviewRecord } from "../../ayas/security/AyasSecurityReviewRecord";

/* ------------------------------------------------------------ facts --- */

export const AYAS_CONTROL_CENTER_SCHEMA_VERSION = "1" as const;

/** `absent` = the source has simply never produced data; `unavailable` = reading it failed or timed out. */
export type AyasCcFact<T> =
  | { readonly kind: "ok"; readonly observedAt: string; readonly value: T }
  | { readonly kind: "absent"; readonly observedAt: string; readonly code: string }
  | { readonly kind: "unavailable"; readonly observedAt: string; readonly code: string };

export interface AyasCcHealthFinding {
  readonly code: string;
  readonly severity: AyasHealthSeverity;
  readonly subject: string;
  readonly message: string;
}

export interface AyasCcHealthFacts {
  readonly verdict: AyasHealthVerdict;
  readonly ownerActionRecommended: boolean;
  readonly findings: readonly AyasCcHealthFinding[];
  readonly observer: { readonly phase: string | null; readonly heartbeatAt: string | null; readonly heartbeatCount: number | null };
  readonly research: { readonly enabled: boolean; readonly nextLightAt: string | null; readonly nextDeepAt: string | null };
  readonly autonomousExecutionEnabled: boolean;
}

export interface AyasCcCommit { readonly hash: string; readonly committedAt: string; readonly subject: string }

export interface AyasCcDevelopmentFacts {
  readonly branch: string | null;
  readonly head: string | null;
  readonly upstream: string | null;
  readonly upstreamHead: string | null;
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly counts: { readonly staged: number; readonly unstaged: number; readonly untracked: number; readonly unmerged: number; readonly total: number };
  readonly changedAreas: readonly string[];
  readonly secretRiskPaths: number;
  /** Stage 10 recovery, present only while work is in progress (dirty, ahead or behind). */
  readonly recovery: { readonly mode: string; readonly firstUnfinishedGate: string; readonly readiness: string; readonly reasonCodes: readonly string[] } | null;
  readonly recentCommits: readonly AyasCcCommit[];
  readonly knownUnsafeTests: readonly { readonly scriptPath: string; readonly hazard: string }[];
  readonly errors: readonly string[];
}

export interface AyasCcGraphifyFacts {
  readonly classification: string;
  readonly structuralStatus: string;
  readonly structuralReasons: readonly string[];
  readonly semanticStatus: string;
  readonly sourceHead: string | null;
  readonly lastAnalyzedHead: string | null;
  readonly graphBuiltFromHead: string | null;
  readonly analyzedAt: string | null;
  readonly worktreeState: string;
  readonly dirtyUncoveredCount: number;
  readonly incompleteCodeFiles: readonly string[];
  readonly criticalIncompleteFiles: readonly string[];
  readonly localCli: string;
  readonly cliVersion: string | null;
  readonly localMcp: string;
  readonly remoteMcp: string;
  readonly consumers: readonly { readonly host: string; readonly mode: string; readonly location: string; readonly status: string; readonly findings: readonly string[] }[];
  readonly graph: { readonly nodes: number; readonly links: number; readonly anomalies: number } | null;
  readonly recoveryCommand: string | null;
  readonly nextAction: string;
}

export interface AyasCcExperimentRow {
  readonly experimentId: string;
  readonly hypothesisId: string;
  readonly status: string;
  readonly verdict: string | null;
  readonly baseHead: string;
  readonly strategyId: string;
  readonly reservedAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly reasonCodes: readonly string[];
  readonly hypothesis: { readonly capability: string; readonly benchmarkId: string; readonly targetDimension: string; readonly statement: string; readonly riskClass: string; readonly regressionSuiteCount: number } | null;
  readonly evidence: { readonly baseline: string; readonly experiment: string; readonly newlyFailingCases: number; readonly heldOutDelta: number; readonly failingSuites: number; readonly targetGain: number; readonly remainingTargetFailures: number } | null;
}

export interface AyasCcExperimentFacts {
  readonly experiments: readonly AyasCcExperimentRow[];
  readonly hypothesesCount: number;
  readonly findingsIndexed: number;
  readonly findingOutcomes: Readonly<Record<string, number>>;
  readonly admissionDeferredUntil: string | null;
  readonly registeredStrategies: number;
  readonly benchmarks: number;
}

export interface AyasCcMemoryFacts {
  readonly total: number;
  readonly capacity: number;
  readonly revision: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly byImportance: Readonly<Record<string, number>>;
  readonly currentFacts: number;
  readonly historicalFacts: number;
  readonly expired: number;
  readonly lastObservedAt: string | null;
}

export interface AyasCcCapabilityFacts {
  readonly items: readonly AyasCapability[];
  readonly ollama: { readonly configured: boolean; readonly available: boolean; readonly detail: string; readonly checkedAt: string; readonly model: string | null };
}

export interface AyasCcSecurityFacts {
  readonly accessGate: "enforced" | "disabled-dev" | "misconfigured";
  readonly autonomousExecutionEnabled: boolean;
  readonly executionGate: "CLOSED";
  readonly review: AyasSecurityReviewRecord;
}

export interface AyasCcAtolyeFacts {
  readonly available: boolean;
  readonly runtimeClassification: string;
  readonly external: boolean;
  readonly totalProjects: number;
  readonly completed: number;
  readonly incomplete: number;
  readonly unreadable: number;
  readonly resumable: number;
  readonly withFinalVideo: number;
  readonly statusDistribution: readonly { readonly status: string; readonly count: number }[];
  readonly latestUpdatedAt: string | null;
}

export interface AyasControlCenterServerFacts {
  readonly schemaVersion: typeof AYAS_CONTROL_CENTER_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly health: AyasCcFact<AyasCcHealthFacts>;
  readonly development: AyasCcFact<AyasCcDevelopmentFacts>;
  readonly graphify: AyasCcFact<AyasCcGraphifyFacts>;
  readonly experiments: AyasCcFact<AyasCcExperimentFacts>;
  readonly memory: AyasCcFact<AyasCcMemoryFacts>;
  readonly capabilities: AyasCcFact<AyasCcCapabilityFacts>;
  readonly security: AyasCcFact<AyasCcSecurityFacts>;
  readonly atolye: AyasCcFact<AyasCcAtolyeFacts>;
  readonly roadmap: AyasCcFact<{ readonly nextStage: string }>;
}

export interface AyasControlCenterInput {
  /** `null` = the server read model itself failed; its domains then render as unavailable. */
  readonly server: AyasControlCenterServerFacts | null;
  readonly approvalInbox?: AyasApprovalInboxView;
  readonly microBatch?: AyasMicroBatchDevelopmentView;
  readonly ownerRecommendations?: AyasOwnerRecommendationsView;
  readonly researchEngineStatus?: AyasResearchEngineStatusView;
  readonly goalDevelopment?: AyasGoalDevelopmentView;
  readonly reportCenter?: BrainReportCenterView | null;
  readonly autonomous?: AyasAutonomousView;
}

/* ------------------------------------------------------------- view --- */

export type AyasCcAttention = "ACTION_REQUIRED" | "WARNING" | "IN_PROGRESS" | "HEALTHY" | "INFORMATIONAL";
/** Phase 18 — every action shown on the Control Center is one of these. */
export type AyasCcActionClass = "READ_ONLY" | "OWNER_APPROVAL" | "SAFE_OPERATION" | "MUTATING_GOVERNED" | "UNAVAILABLE";
export type AyasCcDomainId =
  | "health" | "autonomy" | "approvals" | "development" | "graphify" | "research"
  | "experiments" | "memory" | "capabilities" | "security" | "atolye" | "reports";
/** Existing Brain panels an action may open. Opening a panel is navigation only. */
export type AyasCcPanelTarget = "development" | "research" | "memory" | "selfheal" | "production" | "system" | "autonomous";

export interface AyasCcNextAction {
  readonly kind: AyasCcActionClass;
  readonly label: string;
  readonly panel?: AyasCcPanelTarget;
  /** Shown for the owner to run; the Control Center never executes it. */
  readonly command?: string;
}

export interface AyasCcAttentionItem {
  readonly id: string;
  readonly domain: AyasCcDomainId;
  readonly level: "ACTION_REQUIRED" | "WARNING" | "IN_PROGRESS";
  readonly title: string;
  readonly reason: string;
  readonly source: string;
  /** Time of the underlying fact; `null` when the source carries none (never the UI clock). */
  readonly at: string | null;
  readonly next: AyasCcNextAction;
  readonly details: readonly string[];
}

export interface AyasCcDomainStatus {
  readonly id: AyasCcDomainId;
  readonly title: string;
  readonly attention: AyasCcAttention;
  /** Text status, so meaning never depends on colour. */
  readonly statusLabel: string;
  readonly summary: string;
  readonly source: string;
  readonly availability: "OK" | "NO_DATA" | "UNAVAILABLE";
  /** When the server read the source (`null` for views loaded by their own loaders). */
  readonly observedAt: string | null;
  /** Freshness of the data itself (heartbeat, analysis, last run…). */
  readonly dataAt: string | null;
  readonly dataAtLabel: string;
  readonly panel?: AyasCcPanelTarget;
}

export interface AyasCcActivityItem {
  readonly id: string;
  readonly at: string;
  readonly domain: AyasCcDomainId;
  readonly title: string;
}

export type AyasCcCapabilityLabel = "AVAILABLE" | "UNAVAILABLE" | "REGISTERED" | "LOCAL-ONLY" | "MANUAL-HANDOFF" | "NOT CONFIGURED";
export interface AyasCcCapabilityRow {
  readonly id: string;
  readonly type: AyasCapability["type"];
  readonly label: AyasCcCapabilityLabel;
  readonly note: string;
}

export interface AyasControlCenterView {
  readonly generatedAt: string | null;
  readonly overall: { readonly level: AyasCcAttention; readonly label: string };
  readonly roadmapNextStage: string | null;
  readonly attention: readonly AyasCcAttentionItem[];
  readonly domains: readonly AyasCcDomainStatus[];
  readonly activity: readonly AyasCcActivityItem[];
  readonly capabilities: readonly AyasCcCapabilityRow[];
}

/* ---------------------------------------------------------- helpers --- */

export const AYAS_CC_ACTIVITY_LIMIT = 12;
export const AYAS_CC_ACTIVITY_WINDOW_MS = 14 * 24 * 60 * 60_000;
/** Clock skew a future timestamp may show before it is treated as invalid. */
export const AYAS_CC_FUTURE_TOLERANCE_MS = 5 * 60_000;
export const AYAS_CC_TEXT_MAX = 140;
export const AYAS_CC_DETAIL_LIMIT = 5;
export const AYAS_CC_ATTENTION_VISIBLE = 4;

const ATTENTION_RANK: Readonly<Record<AyasCcAttention, number>> = { ACTION_REQUIRED: 4, WARNING: 3, IN_PROGRESS: 2, HEALTHY: 1, INFORMATIONAL: 0 };

export const AYAS_CC_ATTENTION_LABEL: Readonly<Record<AyasCcAttention, string>> = {
  ACTION_REQUIRED: "EYLEM GEREKLİ",
  WARNING: "UYARI",
  IN_PROGRESS: "SÜRÜYOR",
  HEALTHY: "SAĞLIKLI",
  INFORMATIONAL: "BİLGİ",
};

export const AYAS_CC_ACTION_LABEL: Readonly<Record<AyasCcActionClass, string>> = {
  READ_ONLY: "salt okunur",
  OWNER_APPROVAL: "sahip onayı",
  SAFE_OPERATION: "güvenli işlem (sen çalıştırırsın)",
  MUTATING_GOVERNED: "yönetişimli değişiklik",
  UNAVAILABLE: "bu yüzeyde yok",
};

/** Plain, single-line, bounded text — every free-form string passes through here before display. */
export function ayasCcText(value: unknown, max = AYAS_CC_TEXT_MAX): string {
  const text = typeof value === "string" ? value : "";
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function ayasCcShortSha(value: string | null | undefined): string {
  return typeof value === "string" && /^[0-9a-f]{7,40}$/i.test(value) ? value.slice(0, 7) : "—";
}

function isoMs(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Deterministic "HH:MM · N dk önce" relative to the server read time, Istanbul local time. */
export function ayasCcFormatTime(value: string | null | undefined, now: string | null): string {
  const ms = isoMs(value);
  if (ms === null) return "—";
  const local = new Date(ms + 3 * 60 * 60_000).toISOString();
  const stamp = `${local.slice(8, 10)}.${local.slice(5, 7)} ${local.slice(11, 16)}`;
  const nowMs = isoMs(now);
  if (nowMs === null) return stamp;
  const age = nowMs - ms;
  // Scheduled times (next research run…) are legitimately ahead of the read; say how far.
  const minutes = Math.round(Math.abs(age) / 60_000);
  const span = minutes < 60 ? `${minutes} dk` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} sa` : `${Math.round(minutes / 1440)} gün`;
  if (age < -AYAS_CC_FUTURE_TOLERANCE_MS) return `${stamp} · ${span} sonra`;
  return `${stamp} · ${minutes < 1 ? "az önce" : `${span} önce`}`;
}

/** Owner attention first, without burying the rest: every ACTION_REQUIRED item plus others up to `visible`; the remainder stays one tap away. */
export function ayasCcSplitAttention(items: readonly AyasCcAttentionItem[], visible = AYAS_CC_ATTENTION_VISIBLE): { readonly shown: readonly AyasCcAttentionItem[]; readonly folded: readonly AyasCcAttentionItem[] } {
  const shown = items.filter((item, index) => item.level === "ACTION_REQUIRED" || index < visible);
  return { shown, folded: items.filter((item) => !shown.includes(item)) };
}

function maxAttention(levels: readonly AyasCcAttention[]): AyasCcAttention {
  return levels.reduce<AyasCcAttention>((best, level) => (ATTENTION_RANK[level] > ATTENTION_RANK[best] ? level : best), "INFORMATIONAL");
}

function pluralCount(n: number, word: string): string { return `${n} ${word}`; }

interface DomainSeed {
  readonly id: AyasCcDomainId;
  readonly title: string;
  readonly source: string;
  readonly panel?: AyasCcPanelTarget;
}

function factStatus(seed: DomainSeed, fact: AyasCcFact<unknown> | undefined, noDataSummary: string): AyasCcDomainStatus {
  if (fact && fact.kind === "absent") {
    return { ...seed, attention: "INFORMATIONAL", statusLabel: "VERİ YOK", summary: noDataSummary, availability: "NO_DATA", observedAt: fact.observedAt, dataAt: null, dataAtLabel: "veri yok" };
  }
  const code = fact && fact.kind === "unavailable" ? fact.code : "SERVER_READ_MODEL_UNAVAILABLE";
  return { ...seed, attention: "WARNING", statusLabel: "OKUNAMADI", summary: `Kaynak okunamadı (${ayasCcText(code, 60)}).`, availability: "UNAVAILABLE", observedAt: fact?.observedAt ?? null, dataAt: null, dataAtLabel: "okunamadı" };
}

function unreadableItem(domain: AyasCcDomainStatus, panel?: AyasCcPanelTarget): AyasCcAttentionItem {
  return {
    id: `${domain.id}:unavailable`,
    domain: domain.id,
    level: "WARNING",
    title: `${domain.title}: veri okunamadı`,
    reason: domain.summary,
    source: domain.source,
    at: domain.observedAt,
    next: panel ? { kind: "READ_ONLY", label: "Paneli aç ve durumu yenile", panel } : { kind: "READ_ONLY", label: "Durumu yenile" },
    details: [],
  };
}

/* ---------------------------------------------------------- domains --- */

const HEALTH_LABEL: Readonly<Record<AyasHealthVerdict, { readonly attention: AyasCcAttention; readonly label: string }>> = {
  HEALTHY: { attention: "HEALTHY", label: "SAĞLIKLI" },
  DEGRADED: { attention: "WARNING", label: "KISMEN BOZUK" },
  STALLED: { attention: "ACTION_REQUIRED", label: "TAKILDI" },
  DOWN: { attention: "ACTION_REQUIRED", label: "DURDU" },
  UNKNOWN: { attention: "WARNING", label: "BİLİNMİYOR" },
};

const OBSERVER_NOT_RUNNING = new Set(["OBSERVER_STATE_ABSENT", "OBSERVER_STATE_UNREADABLE", "OBSERVER_LOCK_ABSENT", "OBSERVER_OWNER_DEAD", "OBSERVER_HEARTBEAT_STALE", "OBSERVER_HEARTBEAT_UNREADABLE"]);

function healthDomain(fact: AyasCcFact<AyasCcHealthFacts> | undefined, items: AyasCcAttentionItem[]): AyasCcDomainStatus {
  const seed: DomainSeed = { id: "health", title: "AYAS sağlığı", source: "AyasSelfImprovementHealth", panel: "autonomous" };
  if (!fact || fact.kind !== "ok") {
    const status = factStatus(seed, fact, "Sağlık verisi yok.");
    if (status.availability === "UNAVAILABLE") items.push(unreadableItem(status, "autonomous"));
    return status;
  }
  const health = fact.value;
  const mapped = HEALTH_LABEL[health.verdict] ?? HEALTH_LABEL.UNKNOWN;
  const top = health.findings.filter((finding) => finding.severity !== "INFO");
  const summary = top.length ? ayasCcText(top[0].message) : "Gözlemci ve araştırma döngüsü beklenen düzende.";
  if (mapped.attention === "ACTION_REQUIRED" || mapped.attention === "WARNING") {
    items.push({
      id: `health:${health.verdict}`,
      domain: "health",
      level: mapped.attention,
      title: `Öz-gelişim döngüsü: ${mapped.label}`,
      reason: summary,
      source: seed.source,
      at: health.observer.heartbeatAt ?? fact.observedAt,
      next: { kind: "READ_ONLY", label: "Bulguları Otonom sekmesinde incele", panel: "autonomous" },
      details: top.slice(0, AYAS_CC_DETAIL_LIMIT).map((finding) => `${finding.severity} · ${finding.code}`),
    });
  }
  return {
    ...seed,
    attention: mapped.attention,
    statusLabel: mapped.label,
    summary,
    availability: "OK",
    observedAt: fact.observedAt,
    dataAt: health.observer.heartbeatAt,
    dataAtLabel: "son gözlemci kalp atışı",
  };
}

function autonomyDomain(fact: AyasCcFact<AyasCcHealthFacts> | undefined, autonomous: AyasAutonomousView | undefined): AyasCcDomainStatus {
  const seed: DomainSeed = { id: "autonomy", title: "Otonomi", source: "AyasSelfImprovementHealth · AYAS_AUTONOMOUS_EXECUTION_ENABLED", panel: "autonomous" };
  if (!fact || fact.kind !== "ok") return factStatus(seed, fact, "Gözlemci durumu yok.");
  const health = fact.value;
  const running = !health.findings.some((finding) => OBSERVER_NOT_RUNNING.has(finding.code));
  const phase = health.observer.phase ?? "—";
  const execution = health.autonomousExecutionEnabled ? "AÇIK" : "KAPALI (varsayılan)";
  const queue = autonomous?.connected ? ` · döngü ${autonomous.cycleCount}` : "";
  let attention: AyasCcAttention;
  let label: string;
  if (!running) { attention = "WARNING"; label = "ÇALIŞMIYOR"; }
  else if (phase === "ERROR" || phase === "BACKOFF") { attention = "WARNING"; label = `ÇALIŞIYOR · ${phase}`; }
  else if (phase.startsWith("PAUSED_")) { attention = "INFORMATIONAL"; label = `DURAKLATILDI · ${phase}`; }
  else { attention = "HEALTHY"; label = `ÇALIŞIYOR · ${phase}`; }
  return {
    ...seed,
    attention,
    statusLabel: label,
    summary: `Otonom yürütme: ${execution} · yürütme kapısı KAPALI${queue}`,
    availability: "OK",
    observedAt: fact.observedAt,
    dataAt: health.observer.heartbeatAt,
    dataAtLabel: "son gözlemci kalp atışı",
  };
}

const DISPLAY_STATE_LABEL: Readonly<Record<string, string>> = {
  NORMAL: "normal",
  EXECUTING_NOW: "şu an yürütülüyor",
  WAITING_OTHER_PUBLICATION: "başka yayın bekleniyor",
  REVALIDATING_FOR_NEW_HEAD: "yeni HEAD için yeniden doğrulanıyor",
  STALE_SUPERSEDED: "bayat (yenisi var)",
  STALE_AWAITING_REDISCOVERY: "bayat",
};

/** Phase 8 — what a proposal still needs, in words; never an authority decision itself. */
export function ayasCcApprovalRequirement(proposal: AyasDevelopmentProposal): { readonly level: "ACTION_REQUIRED" | "WARNING" | "IN_PROGRESS" | "INFORMATIONAL"; readonly label: string } {
  if (proposal.status === "STALE") return { level: "INFORMATIONAL", label: "Bayat — karar verilemez" };
  if (proposal.displayState === "EXECUTING_NOW" || proposal.status === "RESERVED") return { level: "IN_PROGRESS", label: "Yürütülüyor" };
  if (proposal.displayState === "WAITING_OTHER_PUBLICATION" || proposal.displayState === "REVALIDATING_FOR_NEW_HEAD") return { level: "IN_PROGRESS", label: "Şu an karar verilemez — yeniden doğrulama bekleniyor" };
  if (proposal.status === "RECOVERY_REQUIRED") return { level: "ACTION_REQUIRED", label: "Kurtarma gerekli" };
  if (proposal.status === "APPROVED") {
    return proposal.ownerApprovedPendingExecution
      ? { level: "IN_PROGRESS", label: "Onaylandı — otonom yürütme bayrağı bekleniyor" }
      : { level: "ACTION_REQUIRED", label: "Onaylandı — YÜRÜT bekliyor" };
  }
  if (proposal.status !== "PENDING" && proposal.status !== "DEFERRED") return { level: "INFORMATIONAL", label: proposal.status };
  if (proposal.safetyClassification !== "SAFE") return { level: "WARNING", label: `${proposal.safetyClassification} — arayüzden onaylanamaz; yalnız RED/SONRA` };
  if (!proposal.approvalReady) return { level: "WARNING", label: "Eksik açıklama/kanıt — onaylanamaz" };
  return { level: "ACTION_REQUIRED", label: "Karar bekliyor — ONAYLA / REDDET / SONRA" };
}

export function ayasCcProposalLine(proposal: AyasDevelopmentProposal): string {
  const requirement = ayasCcApprovalRequirement(proposal);
  const source = proposal.discoverySource ?? "bilinmiyor";
  const kind = proposal.mutationKind ?? "tür yok";
  return [
    `${ayasCcText(proposal.proposalId, 64)} · ${ayasCcText(proposal.objective, 70)}`,
    `tür ${ayasCcText(kind, 40)} · kaynak ${source}`,
    `${proposal.safetyClassification} · risk ${ayasCcText(proposal.risk, 30)} · baseHead ${ayasCcShortSha(proposal.baseHead)}`,
    `${proposal.evidence.length} kanıt · ${proposal.graphifyEvidence.length} Graphify kanıtı · ${proposal.status} (${DISPLAY_STATE_LABEL[proposal.displayState] ?? proposal.displayState})`,
    requirement.label,
  ].join(" | ");
}

function approvalsDomain(input: AyasControlCenterInput, items: AyasCcAttentionItem[]): AyasCcDomainStatus {
  const seed: DomainSeed = { id: "approvals", title: "Onaylar", source: "AyasApprovalInboxView · AyasMicroBatchDevelopmentView", panel: "development" };
  const inbox = input.approvalInbox;
  if (!inbox || !inbox.connected) {
    const status: AyasCcDomainStatus = { ...seed, attention: "WARNING", statusLabel: "OKUNAMADI", summary: inbox?.error ? `Onay kutusu okunamadı: ${ayasCcText(inbox.error, 80)}` : "Onay kutusu okunamadı.", availability: "UNAVAILABLE", observedAt: null, dataAt: null, dataAtLabel: "okunamadı" };
    items.push(unreadableItem(status, "development"));
    return status;
  }
  const byId = new Map<string, AyasDevelopmentProposal>();
  for (const proposal of [...inbox.history, ...inbox.today, ...inbox.pending]) byId.set(proposal.proposalId, proposal);
  const classified = [...byId.values()].map((proposal) => ({ proposal, requirement: ayasCcApprovalRequirement(proposal) }));
  const group = (level: string) => classified.filter((entry) => entry.requirement.level === level).map((entry) => entry.proposal);
  const actionable = group("ACTION_REQUIRED");
  const blocked = group("WARNING");
  const moving = group("IN_PROGRESS");
  const stale = classified.filter((entry) => entry.proposal.status === "STALE").length;
  const recommended = input.ownerRecommendations?.connected ? input.ownerRecommendations.recommendations.length : 0;
  const batch = input.microBatch?.connected ? input.microBatch.active : null;
  const batchReady = batch && batch.status === "READY_FOR_REVIEW" && batch.displayState === "NORMAL";
  const batchRecovery = (input.microBatch?.history ?? []).filter((entry) => entry.status === "RECOVERY_REQUIRED").length;
  const latest = (list: readonly AyasDevelopmentProposal[]) => list.map((p) => p.lastUpdatedAt).sort().at(-1) ?? null;

  if (actionable.length > 0) {
    items.push({
      id: "approvals:actionable",
      domain: "approvals",
      level: "ACTION_REQUIRED",
      title: `${pluralCount(actionable.length, "öneri")} kararını bekliyor`,
      reason: recommended > 0 ? `AYAS bunlardan ${recommended} tanesini onay için öneriyor.` : "Mevcut onay denetimleriyle karar ver; hiçbir şey kendiliğinden uygulanmaz.",
      source: "AyasApprovalInboxView",
      at: latest(actionable),
      next: { kind: "OWNER_APPROVAL", label: "Gelişim Merkezi'nde karar ver", panel: "development" },
      details: actionable.slice(0, AYAS_CC_DETAIL_LIMIT).map(ayasCcProposalLine),
    });
  }
  if (batchReady && batch) {
    items.push({
      id: `approvals:batch:${batch.batchId}`,
      domain: "approvals",
      level: "ACTION_REQUIRED",
      title: `Küçük geliştirme paketi onaya hazır (${pluralCount(batch.items.length, "öğe")})`,
      reason: `baseHead ${ayasCcShortSha(batch.baseHead)} · risk ${ayasCcText(batch.aggregateRisk, 40)}`,
      source: "AyasMicroBatchDevelopmentView",
      at: batch.lastUpdatedAt,
      next: { kind: "OWNER_APPROVAL", label: "BATCH ONAYLA VE UYGULA — Gelişim Merkezi", panel: "development" },
      details: [],
    });
  }
  if (batchRecovery > 0) {
    items.push({ id: "approvals:batch-recovery", domain: "approvals", level: "ACTION_REQUIRED", title: `${pluralCount(batchRecovery, "paket")} kurtarma bekliyor`, reason: "Yarım kalmış bir paket yayını var.", source: "AyasMicroBatchDevelopmentView", at: null, next: { kind: "READ_ONLY", label: "Gelişim Merkezi'nde incele", panel: "development" }, details: [] });
  }
  if (blocked.length > 0) {
    items.push({
      id: "approvals:blocked",
      domain: "approvals",
      level: "WARNING",
      title: `${pluralCount(blocked.length, "öneri")} arayüzden onaylanamaz`,
      reason: "İnceleme gerektiren ya da eksik bilgili öneriler; yalnız reddedilebilir veya ertelenebilir.",
      source: "AyasApprovalInboxView",
      at: latest(blocked),
      next: { kind: "READ_ONLY", label: "Gelişim Merkezi'nde incele", panel: "development" },
      details: blocked.slice(0, AYAS_CC_DETAIL_LIMIT).map(ayasCcProposalLine),
    });
  }
  if (moving.length > 0 && actionable.length === 0) {
    items.push({
      id: "approvals:in-progress",
      domain: "approvals",
      level: "IN_PROGRESS",
      title: `${pluralCount(moving.length, "öneri")} yürütülüyor veya yeniden doğrulanıyor`,
      reason: "Bu öneriler şu an karar beklemiyor.",
      source: "AyasApprovalInboxView",
      at: latest(moving),
      next: { kind: "READ_ONLY", label: "Gelişim Merkezi'nde izle", panel: "development" },
      details: moving.slice(0, AYAS_CC_DETAIL_LIMIT).map(ayasCcProposalLine),
    });
  }
  const attention: AyasCcAttention = actionable.length || batchReady || batchRecovery ? "ACTION_REQUIRED" : blocked.length ? "WARNING" : moving.length || batch ? "IN_PROGRESS" : "HEALTHY";
  const label = attention === "ACTION_REQUIRED" ? "KARAR BEKLİYOR" : attention === "WARNING" ? "İNCELEME" : attention === "IN_PROGRESS" ? "SÜRÜYOR" : "BEKLEYEN YOK";
  const parts = [`${actionable.length} karar bekliyor`, `${blocked.length} onaylanamaz`, `${moving.length} süren`, `${stale} bayat`];
  if (batch) parts.push(`paket: ${batch.status}`);
  return { ...seed, attention, statusLabel: label, summary: parts.join(" · "), availability: "OK", observedAt: null, dataAt: latest([...byId.values()]), dataAtLabel: "son öneri güncellemesi" };
}

function developmentDomain(fact: AyasCcFact<AyasCcDevelopmentFacts> | undefined, items: AyasCcAttentionItem[]): AyasCcDomainStatus {
  const seed: DomainSeed = { id: "development", title: "Geliştirme", source: "AyasRepositoryStateCollector · AyasRepositoryRecovery", panel: "development" };
  if (!fact || fact.kind !== "ok") {
    const status = factStatus(seed, fact, "Depo durumu yok.");
    if (status.availability === "UNAVAILABLE") items.push(unreadableItem(status, "development"));
    return status;
  }
  const dev = fact.value;
  const baseline = dev.upstreamHead ? ayasCcShortSha(dev.upstreamHead) : "HEAD";
  const handoff: AyasCcNextAction = { kind: "SAFE_OPERATION", label: "Devir paketi oluştur (salt okunur CLI)", command: `npx tsx scripts/ayas-developer-handoff.ts --task "<görev>" --baseline ${baseline} --scope <yol>` };
  const where = `${dev.branch ?? "(dal yok)"} @ ${ayasCcShortSha(dev.head)}`;
  const counts = `${dev.counts.total} değişiklik (${dev.counts.staged} hazırlanmış, ${dev.counts.unstaged} hazırlanmamış, ${dev.counts.untracked} izlenmeyen)`;
  const sync = `ileri ${dev.ahead ?? "?"} / geri ${dev.behind ?? "?"}`;
  let attention: AyasCcAttention;
  let label: string;
  let reason: string;
  const gate = dev.recovery?.firstUnfinishedGate ?? null;
  if (dev.errors.length > 0 && !dev.recovery && dev.head === null) { attention = "WARNING"; label = "OKUNAMADI"; reason = `Git durumu okunamadı (${dev.errors.slice(0, 3).join(", ")}).`; }
  else if (dev.counts.unmerged > 0 || dev.recovery?.mode === "STOP_UNKNOWN_STATE") { attention = "ACTION_REQUIRED"; label = "DURUM BELİRSİZ"; reason = "Birleştirilmemiş yollar veya ayrık HEAD var; devam etmeden önce sahibin kararı gerekir."; }
  else if (dev.recovery?.mode === "DIVERGED") { attention = "ACTION_REQUIRED"; label = "AYRIŞTI"; reason = "Yerel ve uzak dal ayrıştı; zorla itme yapılmaz, sahibin kararı gerekir."; }
  else if (dev.secretRiskPaths > 0) { attention = "ACTION_REQUIRED"; label = "GİZLİ BİLGİ RİSKİ"; reason = `${dev.secretRiskPaths} değişiklik gizli bilgi taşıyabilecek bir yolda.`; }
  else if (dev.recovery?.mode === "SYNC_REQUIRED") { attention = "WARNING"; label = "EŞİTLEME GEREKLİ"; reason = `Yerel dal uzaktan geride (${sync}).`; }
  else if (dev.recovery) { attention = "IN_PROGRESS"; label = `YARIM İŞ · ${gate}`; reason = `${counts}; ${sync}. İlk açık kapı: ${gate} (${dev.recovery.readiness}).`; }
  // Clean only when it is provably clean and in sync; a skipped recovery is never read as "clean".
  else if (dev.counts.total > 0 || (dev.ahead ?? 0) > 0 || (dev.behind ?? 0) > 0 || dev.errors.length > 0) { attention = "WARNING"; label = "DURUM HESAPLANAMADI"; reason = `Depo durumu tam okunamadı${dev.errors.length ? ` (${dev.errors.slice(0, 3).join(", ")})` : ""}; ${counts}; ${sync}.`; }
  else { attention = "HEALTHY"; label = "TEMİZ · EŞİT"; reason = `${where} · ${sync}`; }
  if (attention !== "HEALTHY") {
    items.push({
      id: `development:${label}`,
      domain: "development",
      level: attention === "ACTION_REQUIRED" ? "ACTION_REQUIRED" : attention === "WARNING" ? "WARNING" : "IN_PROGRESS",
      title: attention === "IN_PROGRESS" ? "Geliştirme yarım kalmış görünüyor" : `Depo: ${label}`,
      reason,
      source: seed.source,
      // The working-tree state is what the server just observed, not the last commit.
      at: fact.observedAt,
      next: handoff,
      details: (dev.recovery?.reasonCodes ?? []).slice(0, AYAS_CC_DETAIL_LIMIT),
    });
  }
  return { ...seed, attention, statusLabel: label, summary: attention === "HEALTHY" ? where : reason, availability: "OK", observedAt: fact.observedAt, dataAt: dev.recentCommits[0]?.committedAt ?? null, dataAtLabel: "son commit" };
}

const GRAPHIFY_LABEL: Readonly<Record<string, { readonly attention: AyasCcAttention; readonly label: string }>> = {
  GRAPH_CURRENT: { attention: "HEALTHY", label: "GÜNCEL" },
  GRAPH_PARTIAL: { attention: "INFORMATIONAL", label: "KISMİ (GRAPH_PARTIAL)" },
  GRAPH_SEMANTIC_PENDING_ONLY: { attention: "INFORMATIONAL", label: "YAPISAL GÜNCEL · ANLAMSAL BEKLİYOR" },
  GRAPH_MCP_UNAVAILABLE: { attention: "INFORMATIONAL", label: "GÜNCEL · MCP YOK" },
  GRAPH_STALE: { attention: "WARNING", label: "ESKİ (GRAPH_STALE)" },
  GRAPH_MISSING: { attention: "WARNING", label: "YOK (GRAPH_MISSING)" },
  GRAPH_CONFIG_INVALID: { attention: "WARNING", label: "YAPILANDIRMA GEÇERSİZ" },
  GRAPH_EXTRACTION_FAILED: { attention: "WARNING", label: "ÇIKARIM BAŞARISIZ" },
};

function graphifyDomain(fact: AyasCcFact<AyasCcGraphifyFacts> | undefined, items: AyasCcAttentionItem[]): AyasCcDomainStatus {
  const seed: DomainSeed = { id: "graphify", title: "Graphify", source: "AyasGraphifyState (Stage 10A)", panel: "system" };
  if (!fact || fact.kind !== "ok") {
    const status = factStatus(seed, fact, "Graphify durumu yok.");
    if (status.availability === "UNAVAILABLE") items.push(unreadableItem(status, "system"));
    return status;
  }
  const graph = fact.value;
  const mapped = GRAPHIFY_LABEL[graph.classification] ?? { attention: "WARNING" as const, label: ayasCcText(graph.classification, 40) };
  const heads = `kaynak ${ayasCcShortSha(graph.sourceHead)} · analiz ${ayasCcShortSha(graph.lastAnalyzedHead)}`;
  const partial = graph.incompleteCodeFiles.length ? ` · ${graph.incompleteCodeFiles.length} dosya grafikte yok` : "";
  const summary = `${heads} · yapısal ${graph.structuralStatus} · anlamsal ${graph.semanticStatus}${partial}`;
  if (mapped.attention === "WARNING") {
    items.push({
      id: `graphify:${graph.classification}`,
      domain: "graphify",
      level: "WARNING",
      title: `Graphify ${mapped.label}`,
      reason: ayasCcText(graph.nextAction, 200),
      source: seed.source,
      at: graph.analyzedAt ?? fact.observedAt,
      next: graph.recoveryCommand ? { kind: "SAFE_OPERATION", label: "Grafiği yenile (yerel, AST)", command: graph.recoveryCommand } : { kind: "READ_ONLY", label: "Sistem sekmesinde incele", panel: "system" },
      details: graph.structuralReasons.slice(0, AYAS_CC_DETAIL_LIMIT),
    });
  }
  return { ...seed, attention: mapped.attention, statusLabel: mapped.label, summary, availability: "OK", observedAt: fact.observedAt, dataAt: graph.analyzedAt, dataAtLabel: "son Graphify güncellemesi" };
}

function researchDomain(input: AyasControlCenterInput, items: AyasCcAttentionItem[]): AyasCcDomainStatus {
  const seed: DomainSeed = { id: "research", title: "Araştırma", source: "AyasResearchEngineStatusView · AyasSelfImprovementHealth", panel: "research" };
  const status = input.researchEngineStatus;
  if (!status || !status.connected) {
    const domain: AyasCcDomainStatus = { ...seed, attention: "WARNING", statusLabel: "OKUNAMADI", summary: status?.error ? `Araştırma durumu okunamadı: ${ayasCcText(status.error, 80)}` : "Araştırma durumu okunamadı.", availability: "UNAVAILABLE", observedAt: null, dataAt: null, dataAtLabel: "okunamadı" };
    items.push(unreadableItem(domain, "research"));
    return domain;
  }
  const health = input.server?.health.kind === "ok" ? input.server.health.value : null;
  const findings = (health?.findings ?? []).filter((finding) => finding.subject === "research");
  const disabled = health ? !health.research.enabled : false;
  const problems = findings.filter((finding) => finding.severity !== "INFO" && finding.code !== "RESEARCH_DISABLED_BY_ENV");
  const running = findings.some((finding) => finding.code === "RESEARCH_RUN_IN_PROGRESS") || (status.runningGoalCount ?? 0) > 0;
  const awaitingOwner = status.awaitingOwnerGoalCount ?? 0;
  const lastRun = status.lastSuccessfulResearchAt ?? status.lastLightCompletedAt ?? null;
  if (awaitingOwner > 0) {
    items.push({ id: "research:awaiting-owner", domain: "research", level: "ACTION_REQUIRED", title: `${pluralCount(awaitingOwner, "hedef araştırması")} onayını bekliyor`, reason: "Kaçırılan veya sınırı aşan bir çalışma, yeniden denenmeden önce sahibin onayını istiyor.", source: "AyasResearchEngineStatusView", at: status.lastReconciledAt ?? null, next: { kind: "OWNER_APPROVAL", label: "Araştırma sekmesinde onayla / atla", panel: "research" }, details: [] });
  }
  if (status.uncertainOutcomePendingReview) {
    items.push({ id: "research:uncertain", domain: "research", level: "WARNING", title: "Sonucu belirsiz bir araştırma çalışması var", reason: "Çalışma yarıda kesildi; sonraki başarılı döngüye kadar sonucu doğrulanamıyor.", source: "AyasResearchEngineStatusView", at: status.lastReconciledAt ?? null, next: { kind: "READ_ONLY", label: "Araştırma sekmesinde incele", panel: "research" }, details: [] });
  }
  if (problems.length > 0) {
    items.push({ id: "research:health", domain: "research", level: "WARNING", title: "Araştırma döngüsünde sorun", reason: ayasCcText(problems[0].message, 200), source: "AyasSelfImprovementHealth", at: lastRun, next: { kind: "READ_ONLY", label: "Araştırma sekmesinde incele", panel: "research" }, details: problems.slice(0, AYAS_CC_DETAIL_LIMIT).map((finding) => `${finding.severity} · ${finding.code}`) });
  }
  const attention: AyasCcAttention = awaitingOwner > 0 ? "ACTION_REQUIRED" : problems.length || status.uncertainOutcomePendingReview ? "WARNING" : disabled ? "INFORMATIONAL" : running ? "IN_PROGRESS" : "HEALTHY";
  const label = attention === "ACTION_REQUIRED" ? "ONAY BEKLİYOR" : attention === "WARNING" ? "SORUNLU" : disabled ? "DEVRE DIŞI" : running ? "ÇALIŞIYOR" : "ZAMANINDA";
  const digest = status.digest;
  const summary = `sonraki hafif ${status.nextLightAt ? "planlı" : "—"} · ${digest.sourcesRegistered} kaynak (${digest.sourcesFailingNow} hatalı) · 24 sa: ${digest.findingsLast24h} bulgu`;
  return { ...seed, attention, statusLabel: label, summary, availability: "OK", observedAt: null, dataAt: lastRun, dataAtLabel: "son başarılı araştırma" };
}

const ACTIVE_EXPERIMENT = new Set(["RESERVED", "BASELINE_RUNNING", "EXPERIMENT_RUNNING"]);

function experimentsDomain(fact: AyasCcFact<AyasCcExperimentFacts> | undefined, items: AyasCcAttentionItem[]): AyasCcDomainStatus {
  const seed: DomainSeed = { id: "experiments", title: "Deneyler", source: "AyasResearchExperimentStore (Stage 8)", panel: "research" };
  if (!fact || fact.kind !== "ok") {
    const status = factStatus(seed, fact, "Deney deposu henüz oluşmamış.");
    if (status.availability === "UNAVAILABLE") items.push(unreadableItem(status, "research"));
    return status;
  }
  const facts = fact.value;
  const uncertain = facts.experiments.filter((row) => row.status === "UNCERTAIN");
  const active = facts.experiments.filter((row) => ACTIVE_EXPERIMENT.has(row.status));
  const completed = facts.experiments.filter((row) => row.status === "COMPLETED");
  const latest = facts.experiments.map((row) => row.updatedAt).sort().at(-1) ?? null;
  if (uncertain.length > 0) {
    items.push({ id: "experiments:uncertain", domain: "experiments", level: "WARNING", title: `${pluralCount(uncertain.length, "deney")} belirsiz durumda`, reason: "Sahibi ölen bir deney kurtarma bekliyor; sonuç yetkisizdir.", source: seed.source, at: uncertain[0].updatedAt, next: { kind: "READ_ONLY", label: "Araştırma sekmesinde incele", panel: "research" }, details: uncertain.slice(0, AYAS_CC_DETAIL_LIMIT).map((row) => `${row.experimentId} · ${row.status}`) });
  }
  const attention: AyasCcAttention = uncertain.length ? "WARNING" : active.length ? "IN_PROGRESS" : "INFORMATIONAL";
  const label = uncertain.length ? "BELİRSİZ" : active.length ? "ÇALIŞIYOR" : completed.length ? "TAMAMLANANLAR VAR" : "DENEY YOK";
  const summary = facts.experiments.length
    ? `${active.length} süren · ${completed.length} tamamlanan · ${facts.hypothesesCount} hipotez`
    : `Deney yok · ${facts.findingsIndexed} bulgu dizinlendi · ${facts.registeredStrategies} kayıtlı strateji`;
  return { ...seed, attention, statusLabel: label, summary, availability: "OK", observedAt: fact.observedAt, dataAt: latest, dataAtLabel: "son deney güncellemesi" };
}

function memoryDomain(fact: AyasCcFact<AyasCcMemoryFacts> | undefined, items: AyasCcAttentionItem[]): AyasCcDomainStatus {
  const seed: DomainSeed = { id: "memory", title: "Bellek", source: "AyasMemoryStore · AyasMemoryTemporal", panel: "memory" };
  if (!fact || fact.kind !== "ok") {
    const status = factStatus(seed, fact, "Henüz uzun süreli bellek kaydı yok.");
    if (status.availability === "UNAVAILABLE") items.push(unreadableItem(status, "memory"));
    return status;
  }
  const memory = fact.value;
  const nearCapacity = memory.capacity > 0 && memory.total >= Math.floor(memory.capacity * 0.9);
  return {
    ...seed,
    attention: nearCapacity ? "INFORMATIONAL" : "HEALTHY",
    statusLabel: nearCapacity ? "KAPASİTEYE YAKIN" : "SAĞLIKLI",
    summary: `${memory.total}/${memory.capacity} kayıt · ${memory.currentFacts} güncel olgu · ${memory.historicalFacts} geçmiş`,
    availability: "OK",
    observedAt: fact.observedAt,
    dataAt: memory.lastObservedAt,
    dataAtLabel: "son bellek kaydı",
  };
}

/** Phase 14 — availability in the owner's words; never implies a dispatch that does not exist. */
export function ayasCcCapabilityRow(item: AyasCapability, ollama: AyasCcCapabilityFacts["ollama"] | null): AyasCcCapabilityRow {
  const row = (label: AyasCcCapabilityLabel, note: string): AyasCcCapabilityRow => ({ id: item.id, type: item.type, label, note });
  if (item.type === "tool") {
    if (!item.available) return row("UNAVAILABLE", item.source === "descriptive-only" ? "Yalnız tanımlı; canlı web araması yok." : "Bu çalışma zamanında kapalı.");
    return row("LOCAL-ONLY", item.mutates ? "Yazar — sahip onayı gerekir." : "Salt okunur, yerel.");
  }
  if (item.type === "skill") {
    return item.source === "runtime-registration" ? row("REGISTERED", "AYAS çalışma zamanına kayıtlı.") : row("UNAVAILABLE", "Kurulu ama AYAS çalışma zamanına kayıtlı değil.");
  }
  if (item.type === "model") {
    if (item.id === "ollama") {
      if (!ollama || !ollama.configured) return row("NOT CONFIGURED", "Yerel model yapılandırılmamış.");
      return ollama.available ? row("AVAILABLE", `Yerel · $0 · ${ayasCcText(ollama.model ?? "model", 40)} · ${ayasCcText(ollama.detail, 40)}`) : row("UNAVAILABLE", `Yerel model erişilemez (${ayasCcText(ollama.detail, 40)}).`);
    }
    return row("NOT CONFIGURED", "Sıfır maliyet politikası ücretli/belirsiz maliyetli bulut modelini kapatır.");
  }
  if (item.id === "local-ayas") return row("LOCAL-ONLY", "AYAS'ın kendisi; salt okunur araçlarla.");
  return item.available ? row("REGISTERED", "Gönderim adaptörü kayıtlı.") : row("MANUAL-HANDOFF", "Doğrudan gönderim yok; Stage 10 devir paketiyle elle yapıştırılır.");
}

function capabilitiesDomain(fact: AyasCcFact<AyasCcCapabilityFacts> | undefined, items: AyasCcAttentionItem[]): AyasCcDomainStatus {
  const seed: DomainSeed = { id: "capabilities", title: "Model · Araç · Yetenek · Ajan", source: "AyasAgenticRouting (Stage 7) · Ollama sağlık yoklaması", panel: "system" };
  if (!fact || fact.kind !== "ok") {
    const status = factStatus(seed, fact, "Yetenek envanteri yok.");
    if (status.availability === "UNAVAILABLE") items.push(unreadableItem(status, "system"));
    return status;
  }
  const { ollama, items: inventory } = fact.value;
  const tools = inventory.filter((item) => item.type === "tool");
  const usableTools = tools.filter((item) => item.available).length;
  let attention: AyasCcAttention = "HEALTHY";
  let label = "YEREL MODEL HAZIR";
  if (!ollama.configured) { attention = "WARNING"; label = "MODEL YAPILANDIRILMAMIŞ"; }
  else if (!ollama.available) { attention = "WARNING"; label = "YEREL MODEL ERİŞİLEMEZ"; }
  if (attention === "WARNING") {
    items.push({ id: "capabilities:ollama", domain: "capabilities", level: "WARNING", title: label, reason: "AYAS sohbeti yerel modele ulaşamazsa deterministik özet yanıt verir; ücretli yedek yoktur.", source: "OllamaAyasProvider.health", at: ollama.checkedAt, next: { kind: "READ_ONLY", label: "Sistem sekmesinde incele", panel: "system" }, details: [ayasCcText(ollama.detail, 80)] });
  }
  return { ...seed, attention, statusLabel: label, summary: `${usableTools}/${tools.length} araç · Claude/Codex: manuel devir`, availability: "OK", observedAt: fact.observedAt, dataAt: ollama.checkedAt, dataAtLabel: "model yoklaması" };
}

function securityDomain(fact: AyasCcFact<AyasCcSecurityFacts> | undefined, items: AyasCcAttentionItem[]): AyasCcDomainStatus {
  const seed: DomainSeed = { id: "security", title: "Güvenlik", source: "accessGate · AyasSecurityReviewRecord (Stage 9)", panel: "system" };
  if (!fact || fact.kind !== "ok") {
    const status = factStatus(seed, fact, "Güvenlik durumu yok.");
    if (status.availability === "UNAVAILABLE") items.push(unreadableItem(status, "system"));
    return status;
  }
  const security = fact.value;
  const review = security.review;
  let attention: AyasCcAttention = "HEALTHY";
  let label = "KAPI ZORUNLU";
  if (security.accessGate === "misconfigured") { attention = "ACTION_REQUIRED"; label = "KAPI YANLIŞ YAPILANDIRILMIŞ"; }
  else if (review.blockers > 0 || review.unresolvedMajors > 0) { attention = "ACTION_REQUIRED"; label = "AÇIK BULGU"; }
  else if (security.accessGate === "disabled-dev") { attention = "WARNING"; label = "KAPI KAPALI (yerel geliştirme)"; }
  if (attention !== "HEALTHY") {
    items.push({ id: `security:${label}`, domain: "security", level: attention === "ACTION_REQUIRED" ? "ACTION_REQUIRED" : "WARNING", title: `Güvenlik: ${label}`, reason: security.accessGate === "disabled-dev" ? "AYAS_ACCESS_KEY tanımlı değil; korunan sayfalar oturum istemiyor. Yalnız yerel geliştirmede kabul edilebilir." : "Güvenlik incelemesinde çözülmemiş bulgu var.", source: seed.source, at: fact.observedAt, next: { kind: "READ_ONLY", label: "Sistem sekmesinde incele", panel: "system" }, details: [] });
  }
  return { ...seed, attention, statusLabel: label, summary: `son inceleme ${review.reviewedOn} · engelleyici ${review.blockers} · çözülmemiş majör ${review.unresolvedMajors} · ${review.deferredChecks.length} ertelenmiş kontrol`, availability: "OK", observedAt: fact.observedAt, dataAt: `${review.reviewedOn}T00:00:00.000Z`, dataAtLabel: "son güvenlik incelemesi" };
}

function atolyeDomain(fact: AyasCcFact<AyasCcAtolyeFacts> | undefined, items: AyasCcAttentionItem[]): AyasCcDomainStatus {
  const seed: DomainSeed = { id: "atolye", title: "Atölye", source: "AyasProjectCatalog (salt okunur)", panel: "production" };
  if (!fact || fact.kind !== "ok") {
    const status = factStatus(seed, fact, "Proje envanteri yok.");
    if (status.availability === "UNAVAILABLE") items.push(unreadableItem(status, "production"));
    return status;
  }
  const atolye = fact.value;
  if (!atolye.available) {
    const status: AyasCcDomainStatus = { ...seed, attention: "WARNING", statusLabel: "OKUNAMADI", summary: "Runtime kökü veya proje envanteri çözülemedi.", availability: "UNAVAILABLE", observedAt: fact.observedAt, dataAt: null, dataAtLabel: "okunamadı" };
    items.push(unreadableItem(status, "production"));
    return status;
  }
  return {
    ...seed,
    attention: "INFORMATIONAL",
    statusLabel: `${atolye.totalProjects} PROJE`,
    summary: `${atolye.completed} tamamlandı · ${atolye.incomplete} sürüyor · ${atolye.resumable} devam ettirilebilir · ${atolye.unreadable} okunamadı`,
    availability: "OK",
    observedAt: fact.observedAt,
    dataAt: atolye.latestUpdatedAt,
    dataAtLabel: "son proje güncellemesi",
  };
}

function reportsDomain(report: BrainReportCenterView | null | undefined, items: AyasCcAttentionItem[]): AyasCcDomainStatus {
  const seed: DomainSeed = { id: "reports", title: "AYAS Raporları", source: "BrainReportCenter", panel: "selfheal" };
  if (!report) return { ...seed, attention: "INFORMATIONAL", statusLabel: "VERİ YOK", summary: "Öz-onarım rapor verisi yok.", availability: "NO_DATA", observedAt: null, dataAt: null, dataAtLabel: "veri yok" };
  const counts = report.counts;
  const needsOwner = counts.failed + counts.awaitingApproval;
  if (needsOwner > 0) {
    items.push({ id: "reports:owner", domain: "reports", level: "ACTION_REQUIRED", title: `${pluralCount(needsOwner, "rapor")} sahibini bekliyor`, reason: `${counts.failed} insan gerektiriyor · ${counts.awaitingApproval} onay bekliyor.`, source: seed.source, at: report.generatedAt, next: { kind: "OWNER_APPROVAL", label: "AYAS Raporları'nda karar ver", panel: "selfheal" }, details: [] });
  }
  const attention: AyasCcAttention = needsOwner > 0 ? "ACTION_REQUIRED" : counts.investigating > 0 ? "IN_PROGRESS" : "HEALTHY";
  return { ...seed, attention, statusLabel: needsOwner > 0 ? "KARAR BEKLİYOR" : counts.investigating > 0 ? "İNCELENİYOR" : "AÇIK SORUN YOK", summary: ayasCcText(report.headline) || `${counts.open} açık · ${counts.resolved} çözüldü`, availability: "OK", observedAt: null, dataAt: report.generatedAt, dataAtLabel: "rapor üretimi" };
}

/* --------------------------------------------------------- activity --- */

const VERDICT_TR: Readonly<Record<string, string>> = { APPROVE: "onaylandı", REJECT: "reddedildi", LATER: "ertelendi" };

/** Phase 17 — state transitions only, from real durable timestamps; bounded, deduplicated and windowed. */
export function buildAyasCcActivity(input: AyasControlCenterInput, now: string | null): readonly AyasCcActivityItem[] {
  const out: AyasCcActivityItem[] = [];
  const push = (id: string, at: string | null | undefined, domain: AyasCcDomainId, title: string) => {
    if (typeof at === "string") out.push({ id, at, domain, title: ayasCcText(title) });
  };
  const inbox = input.approvalInbox;
  if (inbox?.connected) {
    const seen = new Set<string>();
    for (const proposal of [...inbox.pending, ...inbox.today, ...inbox.history]) {
      if (seen.has(proposal.proposalId)) continue;
      seen.add(proposal.proposalId);
      const name = ayasCcText(proposal.objective, 80);
      push(`proposal:${proposal.proposalId}:created`, proposal.createdAt, "approvals", `Öneri oluşturuldu: ${name}`);
      if (proposal.decision) push(`proposal:${proposal.proposalId}:decision:${proposal.decision.decisionId}`, proposal.decision.decidedAt, "approvals", `Öneri ${VERDICT_TR[proposal.decision.decision] ?? proposal.decision.decision}: ${name}`);
      if (proposal.result) push(`proposal:${proposal.proposalId}:result:${proposal.result.resultId}`, proposal.result.completedAt, "approvals", `Öneri sonucu ${proposal.result.outcome}: ${name}`);
    }
  }
  const batches = input.microBatch?.connected ? [input.microBatch.active, ...input.microBatch.history] : [];
  for (const batch of batches) {
    if (!batch) continue;
    push(`batch:${batch.batchId}:created`, batch.createdAt, "approvals", `Küçük geliştirme paketi açıldı (${batch.items.length} öğe)`);
    if (["COMPLETED", "FAILED", "STALE", "ABANDONED", "RECOVERY_REQUIRED"].includes(batch.status)) push(`batch:${batch.batchId}:${batch.status}`, batch.lastUpdatedAt, "approvals", `Paket ${batch.status}`);
  }
  const research = input.researchEngineStatus;
  if (research?.connected) {
    push(`research:light:${research.lastLightCompletedAt}`, research.lastLightCompletedAt, "research", "Hafif araştırma tamamlandı");
    push(`research:deep:${research.lastDeepCompletedAt}`, research.lastDeepCompletedAt, "research", "Derin araştırma tamamlandı");
    for (const job of research.goalResearchJobs ?? []) {
      if (job.status === "SUCCEEDED" || job.status === "FAILED") push(`research:goal:${job.jobId}:${job.attempt}`, job.executedAt, "research", `Hedef araştırması ${job.status === "SUCCEEDED" ? `tamamlandı (${job.findingsRecorded ?? 0} bulgu)` : "başarısız"}`);
    }
  }
  const server = input.server;
  if (server?.experiments.kind === "ok") {
    for (const row of server.experiments.value.experiments) {
      push(`experiment:${row.experimentId}:reserved`, row.reservedAt, "experiments", `Deney başladı: ${row.hypothesis?.capability ?? row.hypothesisId}`);
      if (row.completedAt) push(`experiment:${row.experimentId}:completed`, row.completedAt, "experiments", `Deney tamamlandı: ${row.verdict ?? "sonuç yok"}`);
    }
  }
  if (server?.development.kind === "ok") {
    for (const commit of server.development.value.recentCommits) push(`commit:${commit.hash}`, commit.committedAt, "development", `Commit ${commit.hash.slice(0, 7)}: ${commit.subject}`);
  }
  if (server?.graphify.kind === "ok" && server.graphify.value.analyzedAt) {
    const graph = server.graphify.value;
    push(`graphify:${graph.lastAnalyzedHead}:${graph.analyzedAt}`, graph.analyzedAt, "graphify", `Graphify analizi ${ayasCcShortSha(graph.lastAnalyzedHead)} (${graph.classification})`);
  }

  const nowMs = isoMs(now);
  const unique = new Map<string, AyasCcActivityItem>();
  for (const item of out) {
    const ms = isoMs(item.at);
    if (ms === null) continue;
    if (nowMs !== null && (ms > nowMs + AYAS_CC_FUTURE_TOLERANCE_MS || nowMs - ms > AYAS_CC_ACTIVITY_WINDOW_MS)) continue;
    if (!unique.has(item.id)) unique.set(item.id, item);
  }
  return [...unique.values()]
    .sort((a, b) => (isoMs(b.at) ?? 0) - (isoMs(a.at) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, AYAS_CC_ACTIVITY_LIMIT);
}

/* ------------------------------------------------------------ build --- */

const OVERALL_LABEL: Readonly<Record<AyasCcAttention, string>> = {
  ACTION_REQUIRED: "Kararın gerekiyor",
  WARNING: "Dikkat edilmesi gereken uyarılar var",
  IN_PROGRESS: "Süren işler var — şu an müdahale gerekmiyor",
  HEALTHY: "Her şey yolunda",
  INFORMATIONAL: "Her şey yolunda",
};

export function buildAyasControlCenterView(input: AyasControlCenterInput): AyasControlCenterView {
  const server = input.server;
  const items: AyasCcAttentionItem[] = [];
  const domains: AyasCcDomainStatus[] = [
    healthDomain(server?.health, items),
    autonomyDomain(server?.health, input.autonomous),
    approvalsDomain(input, items),
    developmentDomain(server?.development, items),
    graphifyDomain(server?.graphify, items),
    researchDomain(input, items),
    experimentsDomain(server?.experiments, items),
    memoryDomain(server?.memory, items),
    capabilitiesDomain(server?.capabilities, items),
    securityDomain(server?.security, items),
    atolyeDomain(server?.atolye, items),
    reportsDomain(input.reportCenter, items),
  ];
  if (!server) {
    items.push({ id: "server:unavailable", domain: "health", level: "WARNING", title: "Kontrol merkezi sunucu okuması başarısız", reason: "Sağlık, depo, Graphify, deney, bellek, yetenek, güvenlik ve Atölye durumları şu an okunamıyor.", source: "AyasControlCenterCollector", at: null, next: { kind: "READ_ONLY", label: "Durumu yenile" }, details: [] });
  }
  const attention = items.sort((a, b) => ATTENTION_RANK[b.level] - ATTENTION_RANK[a.level] || (isoMs(b.at) ?? 0) - (isoMs(a.at) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const level = maxAttention([...domains.map((domain) => domain.attention), ...attention.map((item) => item.level)]);
  const overall: AyasCcAttention = level === "INFORMATIONAL" ? "HEALTHY" : level;
  const now = server?.generatedAt ?? null;
  const capabilityFacts = server?.capabilities.kind === "ok" ? server.capabilities.value : null;
  return {
    generatedAt: now,
    overall: { level: overall, label: OVERALL_LABEL[overall] },
    roadmapNextStage: server?.roadmap.kind === "ok" ? ayasCcText(server.roadmap.value.nextStage, 120) : null,
    attention,
    domains,
    activity: buildAyasCcActivity(input, now),
    capabilities: capabilityFacts ? capabilityFacts.items.map((item) => ayasCcCapabilityRow(item, capabilityFacts.ollama)) : [],
  };
}
