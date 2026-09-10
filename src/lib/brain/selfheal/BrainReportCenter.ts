/**
 * Atölye Brain — AYAS Report Center: the operator-facing view model (pure).
 *
 * Emir §7 / §8 / §9 / §14 / §15. Folds the existing self-heal records (incidents,
 * learned patterns, optimization runs, operator decisions) into ONE read-only
 * shape the Report Center renders — system health, the count row, and a per
 * incident "what did AYAS find / why / what evidence / what does it want to
 * change / did it test it / what is the risk / did it actually heal / what did it
 * learn" chain.
 *
 * Also the pure "AYAS, rapor ver" voice/text helpers (§11): a deterministic,
 * spoken-Turkish summary built from the same view — no model call, runs nothing.
 *
 * PURE: no fs, no store, no clock beyond an injected `now`. Everything here has
 * already been redacted + instruction-quarantined upstream (BrainIncident,
 * BrainUntrustedInput). The raw unified diff is NEVER surfaced.
 */

import type {
  BrainIncident,
  BrainIncidentCategory,
  BrainIncidentSeverity,
  BrainIncidentStatus,
} from "./BrainIncident";
import { classifyPatchSet } from "./BrainPatchSafety";
import { sanitizeUntrustedNote } from "./BrainUntrustedInput";
import type { BrainSelfHealDecision, BrainSelfHealDecisionKind } from "./BrainSelfHealDecision";

/**
 * Defence in depth (§28): the incident records are already redacted +
 * instruction-quarantined upstream, but the Report Center is the surface an
 * operator reads and hears — so every free-text field it emits passes through
 * the untrusted-input guard once more. A no-op for already-clean text.
 */
const clean = (v: string | null | undefined, max = 400): string => (v ? sanitizeUntrustedNote(v, max) : "");
import type {
  BrainSelfHealLearningView,
  BrainSelfHealLiveState,
  BrainSelfHealOptimizationView,
} from "./BrainSelfHealSnapshot";
import type { BrainLearnedPattern } from "./BrainLearnedPattern";

/* ------------------------------------------------------------------ buckets */

export type BrainReportBucket =
  | "investigating" // the Brain is actively observing / diagnosing / sandbox-testing / monitoring
  | "awaiting" // verified, waiting for an operator decision
  | "resolved" // healed or operator-applied
  | "rolledBack" // a patch was rolled back
  | "failed"; // needs a human directly

const INVESTIGATING_STATUSES: readonly BrainIncidentStatus[] = [
  "OBSERVED",
  "DIAGNOSED",
  "PATCHING_SANDBOX",
  "TESTING",
  "APPLIED",
  "MONITORING",
];

export const BRAIN_REPORT_CATEGORIES: readonly BrainIncidentCategory[] = [
  "voice",
  "stt",
  "tts",
  "ui",
  "lifecycle",
  "graphify",
  "performance",
  "network",
  "storage",
  "security",
  "unknown",
];

export const BRAIN_REPORT_STATUS_FILTERS = [
  "all",
  "investigating",
  "awaiting",
  "resolved",
  "rolledBack",
  "failed",
] as const;
export type BrainReportStatusFilter = (typeof BRAIN_REPORT_STATUS_FILTERS)[number];

const CATEGORY_TR: Record<BrainIncidentCategory, string> = {
  voice: "Ses",
  stt: "Konuşma tanıma",
  tts: "Sesli yanıt",
  ui: "Arayüz",
  lifecycle: "Sayfa yaşam döngüsü",
  graphify: "Graphify",
  performance: "Başarım",
  network: "Ağ",
  storage: "Depolama",
  security: "Güvenlik",
  unknown: "Bilinmeyen",
};

const STATUS_TR: Record<BrainIncidentStatus, string> = {
  OBSERVED: "Gözlemlendi",
  DIAGNOSED: "Teşhis edildi",
  PATCHING_SANDBOX: "Sandbox'ta düzeltiliyor",
  TESTING: "Test ediliyor",
  VERIFIED: "Doğrulandı — onay bekliyor",
  AWAITING_APPROVAL: "Onay bekliyor",
  APPLIED: "Uygulandı (staged) — izleniyor",
  MONITORING: "İzleniyor (watchdog)",
  HEALED: "Çözüldü",
  ROLLED_BACK: "Geri alındı",
  FAILED: "Başarısız — insan gerekli",
};

/* ------------------------------------------------------------------- views */

export type BrainReportSeverityTone = "critical" | "high" | "medium" | "info" | "resolved";

export interface BrainReportTimelineEntry {
  readonly at: string;
  readonly label: string;
}

export interface BrainIncidentReportView {
  readonly id: string;
  readonly category: BrainIncidentCategory;
  readonly categoryTr: string;
  readonly severity: BrainIncidentSeverity;
  readonly status: BrainIncidentStatus;
  readonly classification: string;
  readonly bucket: BrainReportBucket;
  readonly severityTone: BrainReportSeverityTone;
  /** Human-first one-liner (plain text — no emoji, safe to speak). */
  readonly headline: string;
  readonly symptom: string;
  readonly evidence: readonly { readonly at: string; readonly source: string; readonly note: string }[];
  readonly timeline: readonly BrainReportTimelineEntry[];
  readonly rootCause: string | null;
  readonly confidence: number | null;
  readonly counterEvidence: readonly string[];
  readonly suspectFiles: readonly string[];
  readonly proposedFix:
    | {
        readonly changedFiles: readonly string[];
        readonly diffLines: number;
        readonly safetyLevel: string;
        readonly risk: string;
        readonly rollbackPlan: string;
        readonly summary: string;
      }
    | null;
  readonly sandbox: "PASS" | "FAIL" | "—";
  readonly regression: "PASS" | "FAIL" | "—";
  readonly security: "PASS" | "FAIL" | "—";
  readonly checksDetail: readonly { readonly name: string; readonly kind: string; readonly status: string }[];
  /** Human status label. */
  readonly result: string;
  readonly operatorDecision:
    | {
        readonly decision: BrainSelfHealDecisionKind;
        readonly operatorApprovalId: string;
        readonly decidedAt: string;
        readonly note: string;
      }
    | null;
  readonly watchdog: {
    readonly verdict: "HEALED" | "HEAL_FAILED" | "OBSERVING" | null;
    readonly evidence: readonly string[];
  };
  readonly learning: {
    readonly learned: boolean;
    readonly patternId: string | null;
    readonly confirmed: number;
    readonly failed: number;
    readonly fix: string | null;
  };
  /** The operator may still approve / reject this from the UI. */
  readonly canDecide: boolean;
  /** Needs a human directly (FORBIDDEN area / FAILED) — the UI shows no approve button. */
  readonly needsHumanDirect: boolean;
  readonly updatedAt: string;
  readonly createdAt: string;
}

export interface BrainReportCounts {
  readonly open: number;
  readonly awaitingApproval: number;
  readonly investigating: number;
  readonly resolved: number;
  readonly failed: number;
  readonly rolledBack: number;
  readonly learnedPatterns: number;
}

export interface BrainReportCenterView {
  readonly generatedAt: string;
  readonly systemHealthPercent: number;
  readonly counts: BrainReportCounts;
  readonly liveState: BrainSelfHealLiveState;
  /** One plain-text line for the home card + spoken summary. */
  readonly headline: string;
  readonly reports: readonly BrainIncidentReportView[];
  readonly learning: readonly BrainSelfHealLearningView[];
  readonly optimizations: readonly BrainSelfHealOptimizationView[];
}

/* --------------------------------------------------------------- builders */

function severityTone(i: BrainIncident): BrainReportSeverityTone {
  if (i.status === "HEALED" || i.status === "APPLIED") return "resolved";
  if (i.status === "FAILED" || i.needsHumanReason) return "critical";
  if (i.severity === "P0") return "critical";
  if (i.severity === "P1") return "high";
  if (i.severity === "P2") return "medium";
  return "info";
}

function bucketOf(i: BrainIncident, decision: BrainSelfHealDecision | undefined): BrainReportBucket {
  if (i.status === "FAILED" || i.needsHumanReason) return "failed";
  if (i.status === "ROLLED_BACK") return "rolledBack";
  if (i.status === "HEALED" || (i.status === "APPLIED" && Boolean(i.learnedPatternId))) return "resolved";
  if (i.status === "VERIFIED" || i.status === "AWAITING_APPROVAL") {
    return decision?.decision === "APPROVE" ? "investigating" : "awaiting";
  }
  if (INVESTIGATING_STATUSES.includes(i.status)) return "investigating";
  return "investigating";
}

function checkVerdict(i: BrainIncident, kinds: readonly string[]): "PASS" | "FAIL" | "—" {
  const relevant = i.checks.filter((c) => kinds.includes(c.kind));
  if (relevant.length === 0) return "—";
  if (relevant.some((c) => c.status === "FAIL" && !c.baseline)) return "FAIL";
  if (relevant.some((c) => c.status === "PASS")) return "PASS";
  return "—";
}

function shortSymptom(symptom: string): string {
  const s = clean(symptom, 400).replace(/\s+/g, " ").trim();
  return s.length > 90 ? `${s.slice(0, 88)}…` : s;
}

function buildTimeline(i: BrainIncident): BrainReportTimelineEntry[] {
  // "Açıldı" is the anchor and always comes first; the closing disposition is
  // always last; evidence (which can predate the formal open) sits in between,
  // sorted by its own timestamp.
  const middle: BrainReportTimelineEntry[] = [];
  for (const e of i.evidence) {
    if (!e.at || e.at === i.createdAt) continue;
    middle.push({ at: e.at, label: clean(`${e.source}: ${e.note}`, 160) });
  }
  middle.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  if (i.hypotheses.length > 0) {
    middle.push({ at: i.updatedAt, label: `Kök neden hipotezi (güven ${(i.hypotheses[0].confidence ?? 0).toFixed(2)})` });
  }
  if (i.patch) {
    middle.push({ at: i.updatedAt, label: `Sandbox'ta düzeltme #${i.patch.attempt} (${i.patch.safetyLevel})` });
  }
  if (i.checks.length > 0) {
    const pass = i.checks.filter((c) => c.status === "PASS").length;
    const fail = i.checks.filter((c) => c.status === "FAIL" && !c.baseline).length;
    middle.push({ at: i.updatedAt, label: `Testler: ${pass} geçti / ${fail} başarısız` });
  }
  if (i.healVerdict) {
    middle.push({ at: i.updatedAt, label: `Watchdog: ${i.healVerdict}` });
  }
  return [
    { at: i.createdAt, label: `Açıldı — ${i.classification}` },
    ...middle,
    { at: i.updatedAt, label: clean(i.disposition, 200) },
  ].slice(0, 14);
}

export interface BuildReportCenterInput {
  readonly incidents: readonly BrainIncident[];
  readonly learned: readonly BrainLearnedPattern[];
  readonly decisions: readonly BrainSelfHealDecision[];
  readonly optimizations?: readonly BrainSelfHealOptimizationView[];
  readonly now: string;
}

function incidentReportView(
  i: BrainIncident,
  decision: BrainSelfHealDecision | undefined,
  learnedById: Map<string, BrainLearnedPattern>,
): BrainIncidentReportView {
  const forbidden =
    i.patch?.safetyLevel === "FORBIDDEN_AUTONOMOUS" ||
    classifyPatchSet(i.patch?.changedFiles ?? i.hypotheses[0]?.suspectFiles ?? []).forbidden.length > 0;
  const needsHumanDirect = i.status === "FAILED" || Boolean(i.needsHumanReason) || forbidden;
  const canDecide =
    !needsHumanDirect &&
    (i.status === "VERIFIED" || i.status === "AWAITING_APPROVAL") &&
    Boolean(i.patch) &&
    decision?.decision !== "APPROVE";

  const learnedPattern = i.learnedPatternId ? learnedById.get(i.learnedPatternId) : undefined;
  const tone = severityTone(i);

  return {
    id: i.id,
    category: i.category,
    categoryTr: CATEGORY_TR[i.category] ?? i.category,
    severity: i.severity,
    status: i.status,
    classification: i.classification,
    bucket: bucketOf(i, decision),
    severityTone: tone,
    headline: `${CATEGORY_TR[i.category] ?? i.category} — ${shortSymptom(i.symptom)}`,
    symptom: clean(i.symptom, 400),
    evidence: i.evidence.map((e) => ({ at: e.at, source: clean(e.source, 60), note: clean(e.note, 300) })),
    timeline: buildTimeline(i),
    rootCause: (() => {
      const rc = i.confirmedRootCause ?? i.hypotheses[0]?.statement;
      return rc ? clean(rc, 400) : null;
    })(),
    confidence: i.hypotheses[0]?.confidence ?? null,
    counterEvidence: (i.hypotheses[0]?.counterEvidence ?? []).map((e) => clean(e, 300)),
    suspectFiles: i.patch?.changedFiles ?? i.hypotheses[0]?.suspectFiles ?? [],
    proposedFix: i.patch
      ? {
          changedFiles: i.patch.changedFiles,
          diffLines: i.patch.diffLines,
          safetyLevel: i.patch.safetyLevel,
          risk: i.patch.risk,
          rollbackPlan: i.patch.rollbackPlan,
          summary: `${i.patch.changedFiles.length} dosya · ${i.patch.diffLines} satır · ${i.patch.safetyLevel} · risk ${i.patch.risk}`,
        }
      : null,
    sandbox: checkVerdict(i, ["typecheck", "lint", "build", "smoke", "unit"]),
    regression: checkVerdict(i, ["regression", "graphify"]),
    security: checkVerdict(i, ["security"]),
    checksDetail: i.checks.map((c) => ({ name: c.name, kind: c.kind, status: c.status })),
    result: STATUS_TR[i.status] ?? i.status,
    operatorDecision: decision
      ? {
          decision: decision.decision,
          operatorApprovalId: decision.operatorApprovalId,
          decidedAt: decision.decidedAt,
          note: decision.note,
        }
      : null,
    watchdog: {
      verdict: i.healVerdict ?? null,
      evidence: i.healEvidence ?? [],
    },
    learning: {
      learned: Boolean(i.learnedPatternId),
      patternId: i.learnedPatternId ?? null,
      confirmed: learnedPattern?.timesConfirmed ?? 0,
      failed: learnedPattern?.timesFailed ?? 0,
      fix: learnedPattern?.successfulFix ?? null,
    },
    canDecide,
    needsHumanDirect,
    updatedAt: i.updatedAt,
    createdAt: i.createdAt,
  };
}

/** Deterministic 0..100 system-health read (§8). Starts at 100, subtracts for pain. */
export function systemHealthPercent(reports: readonly BrainIncidentReportView[]): number {
  let score = 100;
  for (const r of reports) {
    if (r.bucket === "failed") score -= 16;
    else if (r.bucket === "rolledBack") score -= 8;
    else if (r.bucket === "awaiting") score -= 3;
    else if (r.bucket === "investigating") {
      score -= r.severity === "P0" ? 18 : r.severity === "P1" ? 9 : r.severity === "P2" ? 4 : 2;
    }
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function buildBrainReportCenterView(input: BuildReportCenterInput): BrainReportCenterView {
  const decisionByIncident = new Map<string, BrainSelfHealDecision>();
  for (const d of [...input.decisions].sort((a, b) => (a.decidedAt < b.decidedAt ? -1 : 1))) {
    decisionByIncident.set(d.incidentId, d); // last write wins → latest decision
  }
  const learnedById = new Map(input.learned.map((p) => [p.id, p]));

  const reports = [...input.incidents]
    .sort((a, b) => (b.updatedAt < a.updatedAt ? -1 : b.updatedAt > a.updatedAt ? 1 : a.id.localeCompare(b.id)))
    .map((i) => incidentReportView(i, decisionByIncident.get(i.id), learnedById));

  const counts: BrainReportCounts = {
    open: reports.filter((r) => r.bucket === "awaiting" || r.bucket === "investigating").length,
    awaitingApproval: reports.filter((r) => r.bucket === "awaiting").length,
    investigating: reports.filter((r) => r.bucket === "investigating").length,
    resolved: reports.filter((r) => r.bucket === "resolved").length,
    failed: reports.filter((r) => r.bucket === "failed").length,
    rolledBack: reports.filter((r) => r.bucket === "rolledBack").length,
    learnedPatterns: input.learned.length,
  };

  const health = systemHealthPercent(reports);

  const STATUS_TO_LIVE: Partial<Record<BrainIncidentStatus, BrainSelfHealLiveState>> = {
    OBSERVED: "OBSERVING",
    DIAGNOSED: "DIAGNOSING",
    PATCHING_SANDBOX: "REPAIRING",
    TESTING: "TESTING",
    VERIFIED: "VERIFYING",
    AWAITING_APPROVAL: "NEEDS_HUMAN",
    APPLIED: "MONITORING",
    MONITORING: "MONITORING",
    HEALED: "HEALED",
  };
  const liveState: BrainSelfHealLiveState =
    counts.failed > 0
      ? "NEEDS_HUMAN"
      : (reports.find((r) => r.bucket === "investigating" || r.bucket === "awaiting")
          ? STATUS_TO_LIVE[reports.find((r) => r.bucket === "investigating" || r.bucket === "awaiting")!.status] ?? "OBSERVING"
          : reports[0]?.status === "HEALED"
            ? "HEALED"
            : "IDLE");

  const headline =
    counts.failed > 0
      ? `${counts.failed} konu insan müdahalesi bekliyor.`
      : counts.awaitingApproval > 0
        ? `${counts.awaitingApproval} çözüm onayını bekliyor. ${counts.investigating} konu inceleniyor.`
        : counts.investigating > 0
          ? `${counts.investigating} konu inceleniyor. Onay bekleyen yok.`
          : `Açık sorun yok. ${counts.resolved} çözüldü, ${counts.learnedPatterns} pattern öğrenildi.`;

  const learning: BrainSelfHealLearningView[] = [...input.learned]
    .sort((a, b) => (b.updatedAt < a.updatedAt ? -1 : 1))
    .slice(0, 20)
    .map((p) => ({
      id: p.id,
      signature: p.signature,
      problem: p.problemPattern,
      rootCause: p.rootCause,
      fix: p.successfulFix,
      confirmed: p.timesConfirmed,
      failed: p.timesFailed,
      status: p.status,
    }));

  return {
    generatedAt: input.now,
    systemHealthPercent: health,
    counts,
    liveState,
    headline,
    reports,
    learning,
    optimizations: input.optimizations ?? [],
  };
}

export function filterReports(
  reports: readonly BrainIncidentReportView[],
  filter: { readonly status?: BrainReportStatusFilter; readonly category?: string },
): readonly BrainIncidentReportView[] {
  return reports.filter((r) => {
    if (filter.status && filter.status !== "all" && r.bucket !== filter.status) return false;
    if (filter.category && filter.category !== "all" && r.category !== filter.category) return false;
    return true;
  });
}

export const EMPTY_BRAIN_REPORT_CENTER_VIEW: BrainReportCenterView = Object.freeze({
  generatedAt: "",
  systemHealthPercent: 100,
  counts: Object.freeze({
    open: 0,
    awaitingApproval: 0,
    investigating: 0,
    resolved: 0,
    failed: 0,
    rolledBack: 0,
    learnedPatterns: 0,
  }),
  liveState: "IDLE" as BrainSelfHealLiveState,
  headline: "Açık sorun yok — AYAS telemetriyi izliyor.",
  reports: [],
  learning: [],
  optimizations: [],
});

/* --------------------------------------------- "AYAS, rapor ver" (§11) --- */

export type AyasReportIntent = { readonly kind: "summary" } | { readonly kind: "pending-detail" } | null;

/**
 * Does this chat turn ask for the self-healing report? Deterministic, Turkish
 * aware. Kept deliberately narrow so a normal sentence with the word "rapor"
 * does not trigger it.
 */
export function detectAyasReportIntent(text: string): AyasReportIntent {
  const t = String(text ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[İıI]/g, "i")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;

  const pendingDetail =
    /\bonay bekleyen\b/.test(t) ||
    /\bbekleyen (ne|nedir|hangi|neler)\b/.test(t) ||
    /\bonay bekliyor\b.*\?$/.test(t) ||
    /\b(ne(yi)?|hangi (sey|konu|cozum|cozumu))\b.*\bonay\b/.test(t);
  if (pendingDetail) return { kind: "pending-detail" };

  const summary =
    /\brapor ver\b/.test(t) ||
    /\bdurum raporu\b/.test(t) ||
    /\brapor(u|un)? (ver|goster|oku|ozetle|soyle)\b/.test(t) ||
    /\b(kendini|sistemi) (kontrol et|incele)\b/.test(t) ||
    /\bson inceleme\b/.test(t) ||
    /\b(self ?heal|kendini iyilestirme) (durumu|raporu)\b/.test(t) ||
    /^rapor\b/.test(t);
  if (summary) return { kind: "summary" };

  return null;
}

/**
 * The deterministic spoken-Turkish answer. Obeys AYAS_SPOKEN_TURKISH_RULE — no
 * markdown, symbols, headings, bullets or emoji; 2–4 short sentences. Never a
 * model call, never runs anything.
 */
export function buildAyasReportSpokenAnswer(view: BrainReportCenterView, intent: AyasReportIntent): string {
  const c = view.counts;

  if (intent?.kind === "pending-detail") {
    const awaiting = view.reports.filter((r) => r.bucket === "awaiting");
    if (awaiting.length === 0) {
      return "Şu an onay bekleyen bir çözüm yok. İncelenen konu sayısı " + c.investigating + ".";
    }
    const r = awaiting[0];
    const tests =
      r.sandbox === "PASS" && (r.regression === "PASS" || r.regression === "—")
        ? "Sandbox ve regresyon testleri başarılı"
        : "Testler henüz tamamlanmadı";
    const extra =
      awaiting.length > 1 ? " Onay bekleyen toplam " + awaiting.length + " konu var." : "";
    return (
      r.headline +
      ". Kök neden " +
      (r.rootCause ?? "henüz belirlenmedi") +
      ". " +
      tests +
      ". Çalışan sisteme henüz uygulanmadı, onayını bekliyor." +
      extra +
      " Raporu açıp onaylayabilir ya da reddedebilirsin."
    );
  }

  if (c.failed > 0) {
    return (
      c.failed +
      " konu insan müdahalesi bekliyor. Ayrıca " +
      c.awaitingApproval +
      " çözüm onay bekliyor ve " +
      c.investigating +
      " konu inceleniyor. Sistem sağlığı yüzde " +
      view.systemHealthPercent +
      ". Raporu açıp ayrıntılara bakabilirsin."
    );
  }

  if (c.open === 0) {
    return (
      "Şu an açık bir sorun yok. Sistem sağlığı yüzde " +
      view.systemHealthPercent +
      ". Bugüne kadar " +
      c.resolved +
      " sorun çözüldü ve " +
      c.learnedPatterns +
      " doğrulanmış çözüm öğrenildi."
    );
  }

  const pieces: string[] = [];
  pieces.push("Son incelememde " + c.open + " açık konu var.");
  const bits: string[] = [];
  if (c.resolved > 0) bits.push(c.resolved + " sorun çözüldü");
  if (c.investigating > 0) bits.push(c.investigating + " tanesi inceleniyor");
  if (c.awaitingApproval > 0) bits.push(c.awaitingApproval + " tanesi senden onay bekliyor");
  if (bits.length) pieces.push(bits.join(", ") + ".");
  pieces.push("Sistem sağlığı yüzde " + view.systemHealthPercent + ".");
  if (c.awaitingApproval > 0) pieces.push("Onay bekleyen konuyu görmek için raporu açabilirsin.");
  return pieces.join(" ");
}
