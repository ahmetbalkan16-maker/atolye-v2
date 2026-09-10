/**
 * Atölye Brain — Self-Healing: observability adapter (pure).
 *
 * Emir §4 / §5. Turns the telemetry the Brain already collects
 * (`BrainLifecycleTelemetry` from `brainLifecycle.ts`, the wake-adapter
 * `VoiceHealthSnapshot`) into the shapes the anomaly classifier reads, and
 * builds an incident DRAFT when the classifier says "REAL_INCIDENT" / "UNKNOWN".
 *
 * No fs, no store, no clock beyond an injected `now`. The operator loop /
 * autonomous cycle calls this, then persists + runs the returned draft.
 */

import {
  classifyBrainAnomaly,
  type BrainAnomalyResult,
  type BrainAnomalySnapshot,
  type BrainKnownBaseline,
  type BrainVoiceAnomalySnapshot,
} from "./BrainAnomalyClassifier";
import {
  buildBrainIncident,
  brainIncidentSignature,
  type BrainIncident,
  type BrainIncidentEvidence,
} from "./BrainIncident";
import { sanitizeUntrustedNote } from "./BrainUntrustedInput";

/** The subset of `BrainLifecycleTelemetry` this adapter needs (loose, to avoid a hard import). */
export interface BrainLifecycleTelemetryLike {
  readonly reloadCause: string;
  readonly navigationKind: string;
  readonly evictionKind: string;
  readonly unexpectedReload: boolean;
  readonly browserReloadLikely: boolean;
  readonly priorVoiceActive: boolean;
  readonly priorCleanPagehide: boolean;
  readonly priorDiedHidden: boolean;
  readonly priorDiedAtPhase: string;
  readonly priorHeartbeatAgeMs: number;
  readonly priorLastEvent: string;
  readonly bootCount: number;
  readonly lastVoicePhase?: string;
  readonly serviceWorkerState?: string;
  readonly lastLifecycleEvent?: string;
}

export interface BrainVoiceHealthLike {
  readonly phase: string;
  readonly droppedFrames: number;
  readonly frameAgeMs: number;
  readonly recoveryCount: number;
  readonly audioContextState: string;
  readonly lastCaptureMs: number;
  readonly lastSttMs: number;
  readonly lastError: string | null;
  /** WakeAdapterStatus.mic when available. */
  readonly mic?: string;
}

function toAnomalySnapshot(t: BrainLifecycleTelemetryLike): BrainAnomalySnapshot {
  return {
    reloadCause: t.reloadCause,
    navigationKind: t.navigationKind,
    evictionKind: t.evictionKind,
    unexpectedReload: t.unexpectedReload,
    browserReloadLikely: t.browserReloadLikely,
    firstBoot: t.bootCount <= 1,
    priorVoiceActive: t.priorVoiceActive,
    priorCleanPagehide: t.priorCleanPagehide,
    priorDiedHidden: t.priorDiedHidden,
    priorDiedAtPhase: t.priorDiedAtPhase,
    priorHeartbeatAgeMs: t.priorHeartbeatAgeMs,
    priorLastEvent: t.priorLastEvent,
    bfcacheRestore: t.reloadCause === "bfcache-restore",
    swReloadMarker: t.reloadCause === "sw-update",
  };
}

function toVoiceAnomalySnapshot(v: BrainVoiceHealthLike | null | undefined): BrainVoiceAnomalySnapshot | null {
  if (!v) return null;
  return {
    phase: v.phase,
    mic: v.mic ?? (v.phase === "fatal" ? "fatal" : v.phase === "paused" ? "paused" : v.phase === "recovering" ? "recovering" : "on"),
    recoveryCount: v.recoveryCount,
    droppedFrames: v.droppedFrames,
    frameAgeMs: v.frameAgeMs,
    lastError: v.lastError,
    lastCaptureMs: v.lastCaptureMs,
    lastSttMs: v.lastSttMs,
  };
}

export interface BrainSelfHealObserveInput {
  readonly lifecycle: BrainLifecycleTelemetryLike;
  readonly voice?: BrainVoiceHealthLike | null;
  readonly knownBaselines?: readonly BrainKnownBaseline[];
  readonly now: string;
  /** Extra structured evidence from the caller (numeric/enum only). */
  readonly extraEvidence?: readonly BrainIncidentEvidence[];
}

export interface BrainSelfHealObservation {
  readonly result: BrainAnomalyResult;
  readonly signature: string;
  /** Present only when `result.openIncident`. */
  readonly incidentDraft: BrainIncident | null;
}

/** Classify the current telemetry and, when warranted, build an incident draft. */
export function observeForSelfHeal(input: BrainSelfHealObserveInput): BrainSelfHealObservation {
  const snapshot = toAnomalySnapshot(input.lifecycle);
  const voice = toVoiceAnomalySnapshot(input.voice);

  // A provisional signature so a KNOWN_BASELINE can be matched.
  const provisionalSymptom = input.voice
    ? `${input.lifecycle.reloadCause} voice ${input.voice.phase} recovery ${input.voice.recoveryCount}`
    : input.lifecycle.reloadCause;
  const provisionalSignature = brainIncidentSignature({ category: voice ? "voice" : "lifecycle", symptom: provisionalSymptom });

  const result = classifyBrainAnomaly({
    lifecycle: snapshot,
    voice,
    knownBaselines: input.knownBaselines,
    signature: provisionalSignature,
  });

  if (!result.openIncident) {
    return { result, signature: provisionalSignature, incidentDraft: null };
  }

  const symptom = sanitizeUntrustedNote(result.reason, 400);
  const evidence: BrainIncidentEvidence[] = [
    {
      at: input.now,
      source: "self-heal-observer",
      note: sanitizeUntrustedNote(`classification ${result.classification}; reload ${result.reloadReason}`, 200),
      signals: result.signals,
    },
    ...(input.lifecycle.lastLifecycleEvent
      ? [{ at: input.now, source: "lifecycle", note: sanitizeUntrustedNote(input.lifecycle.lastLifecycleEvent, 120) }]
      : []),
    ...(input.voice?.lastError
      ? [{ at: input.now, source: "voice", note: sanitizeUntrustedNote(`lastError: ${input.voice.lastError}`, 120) }]
      : []),
    ...(input.extraEvidence ?? []),
  ];

  const incidentDraft = buildBrainIncident({
    category: result.category,
    severity: result.severity,
    classification: result.classification,
    symptom,
    now: input.now,
    evidence,
    dedupeKey: brainIncidentSignature({ category: result.category, symptom }),
  });

  return { result, signature: brainIncidentSignature(incidentDraft), incidentDraft };
}
