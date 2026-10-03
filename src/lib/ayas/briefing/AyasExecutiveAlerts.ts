/**
 * Stage 15T — owner alert priority, dedupe and cooldown. Pure reducer.
 *
 * One alert per issue key. An alert is notification metadata only: an
 * acknowledgement, a delivery or an escalation never grants authority,
 * approves a proposal or starts a tool.
 *
 * - ROUTINE is audit-only. It is never stored and never notifies; the source
 *   that reported it keeps the record. An issue reported as ROUTINE counts as
 *   absent here.
 * - The fingerprint covers the material content. Observation time is not
 *   material, so re-reading an unchanged issue changes nothing.
 * - Cooldown starts at an actual delivery. Only a severity increase or new
 *   material evidence on a still-active issue bypasses it. A reopened issue
 *   with no higher severity, or a lower severity, waits for the cooldown.
 * - An issue resolves only when its whole briefing domain was observed.
 * - Resolved issues are pruned after a retention window, so state stays bounded.
 */
import { createHash } from "node:crypto";
import { canonicalAyasJson } from "../provenance/AyasReleaseProvenance";
import { sanitizeUntrustedNote } from "../../brain/selfheal/BrainUntrustedInput";
export const AYAS_ALERT_PRIORITIES = ["CRITICAL", "ACTION_REQUIRED", "MATERIAL_INFO", "ROUTINE"] as const;
export type AyasAlertPriority = typeof AYAS_ALERT_PRIORITIES[number];
export const AYAS_BRIEFING_DOMAINS = ["health", "improvements", "failures", "decisions", "production", "revenue", "security", "technology", "capacity"] as const;
export type AyasBriefingDomain = typeof AYAS_BRIEFING_DOMAINS[number];
export const AYAS_EXECUTIVE_ALERT_LIMITS = Object.freeze({ active: 128, inactive: 64, inactiveRetentionMs: 30 * 86_400_000 });
export const AYAS_EXECUTIVE_COOLDOWN_MS = Object.freeze({ default: 3_600_000, min: 60_000, max: 86_400_000 });
export interface AyasExecutiveSignal {
  readonly issueKey: string; readonly domain: AyasBriefingDomain; readonly priority: AyasAlertPriority;
  readonly summary: string; readonly consequence: string; readonly requestedDecision: string | null;
  readonly evidence: { readonly source: string; readonly reference: string; readonly digest: string; readonly observedAt: string | null };
}
export type AyasEscalationReason = "SEVERITY_INCREASED" | "MATERIAL_EVIDENCE_CHANGED" | "REOPENED";
export interface AyasExecutiveAlert extends AyasExecutiveSignal {
  readonly alertId: string; readonly fingerprint: string; readonly active: boolean;
  readonly firstSeen: string; readonly lastChanged: string; readonly lastNotified: string | null;
  readonly notifiedFingerprint: string | null; readonly acknowledgedFingerprint: string | null;
  readonly nextEligibleNotification: string | null; readonly escalationReason: AyasEscalationReason | null;
}
export interface AyasExecutiveAlertState { readonly schemaVersion: "1"; readonly changedAt: string | null; readonly alerts: readonly AyasExecutiveAlert[] }
export const emptyAyasExecutiveAlerts = (): AyasExecutiveAlertState => ({ schemaVersion: "1", changedAt: null, alerts: [] });
export const alertDigest = (v: unknown): string => createHash("sha256").update(canonicalAyasJson(v)).digest("hex");
const HASH = /^[a-f0-9]{64}$/, KEY = /^[a-z][a-z0-9:_-]{1,159}$/;
const rank: Readonly<Record<AyasAlertPriority, number>> = { CRITICAL: 3, ACTION_REQUIRED: 2, MATERIAL_INFO: 1, ROUTINE: 0 };
/** Only these may notify inside a cooldown window. */
const COOLDOWN_BYPASS: readonly (AyasEscalationReason | null)[] = ["SEVERITY_INCREASED", "MATERIAL_EVIDENCE_CHANGED"];
const iso = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export const briefingText = (v: unknown, max = 240): string => sanitizeUntrustedNote(typeof v === "string" ? v : "", max).replace(/(?:[a-z]:[\\/]|\\\\)[^\s"'|]+/gi, "[machine-path]");
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
  && Reflect.ownKeys(v).length === Object.keys(v).length && Object.values(Object.getOwnPropertyDescriptors(v)).every(d => Object.hasOwn(d, "value"));
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).sort().join("|") === [...keys].sort().join("|");
const signalKeys = ["issueKey", "domain", "priority", "summary", "consequence", "requestedDecision", "evidence"];
const alertKeys = [...signalKeys, "alertId", "fingerprint", "active", "firstSeen", "lastChanged", "lastNotified", "notifiedFingerprint", "acknowledgedFingerprint", "nextEligibleNotification", "escalationReason"];
function fail(): never { throw new Error("AYAS_BRIEFING_METADATA_INVALID"); }
export function assertAyasExecutiveSignal(raw: unknown, stored = false): asserts raw is AyasExecutiveSignal {
  if (!record(raw) || !exact(raw, stored ? alertKeys : signalKeys) || typeof raw.issueKey !== "string" || !KEY.test(raw.issueKey)
    || !AYAS_BRIEFING_DOMAINS.includes(raw.domain as AyasBriefingDomain) || !AYAS_ALERT_PRIORITIES.includes(raw.priority as AyasAlertPriority)
    || (stored && raw.priority === "ROUTINE")
    || typeof raw.summary !== "string" || !raw.summary || raw.summary !== briefingText(raw.summary)
    || typeof raw.consequence !== "string" || raw.consequence !== briefingText(raw.consequence)
    || (raw.requestedDecision !== null && (typeof raw.requestedDecision !== "string" || raw.requestedDecision !== briefingText(raw.requestedDecision)))
    || !record(raw.evidence) || !exact(raw.evidence, ["source", "reference", "digest", "observedAt"])
    || typeof raw.evidence.source !== "string" || !KEY.test(raw.evidence.source) || typeof raw.evidence.reference !== "string" || !KEY.test(raw.evidence.reference)
    || typeof raw.evidence.digest !== "string" || !HASH.test(raw.evidence.digest) || (raw.evidence.observedAt !== null && !iso(raw.evidence.observedAt))) fail();
}
export function executiveSignalFingerprint(signal: AyasExecutiveSignal): string {
  // Observation time is not material evidence; repeated reads cannot reopen an issue.
  return alertDigest({ issueKey: signal.issueKey, domain: signal.domain, priority: signal.priority, summary: signal.summary,
    consequence: signal.consequence, requestedDecision: signal.requestedDecision, evidence: { source: signal.evidence.source, reference: signal.evidence.reference, digest: signal.evidence.digest } });
}
export function assertAyasExecutiveAlertState(raw: unknown): asserts raw is AyasExecutiveAlertState {
  if (!record(raw) || !exact(raw, ["schemaVersion", "changedAt", "alerts"]) || raw.schemaVersion !== "1" || (raw.changedAt !== null && !iso(raw.changedAt))
    || !Array.isArray(raw.alerts) || raw.alerts.length > AYAS_EXECUTIVE_ALERT_LIMITS.active + AYAS_EXECUTIVE_ALERT_LIMITS.inactive) fail();
  const seen = new Set<string>();
  let active = 0;
  for (const a of raw.alerts) {
    assertAyasExecutiveSignal(a, true); const v = a as AyasExecutiveAlert;
    if (seen.has(v.issueKey) || v.alertId !== alertDigest({ issueKey: v.issueKey }) || v.fingerprint !== executiveSignalFingerprint(v)
      || typeof v.active !== "boolean" || !iso(v.firstSeen) || !iso(v.lastChanged) || v.firstSeen > v.lastChanged
      || raw.changedAt === null || v.lastChanged > raw.changedAt
      || (v.lastNotified !== null && (!iso(v.lastNotified) || v.lastNotified > raw.changedAt))
      || (v.nextEligibleNotification !== null && !iso(v.nextEligibleNotification))
      || (v.notifiedFingerprint !== null && !HASH.test(v.notifiedFingerprint)) || (v.acknowledgedFingerprint !== null && !HASH.test(v.acknowledgedFingerprint))
      || ![null, "SEVERITY_INCREASED", "MATERIAL_EVIDENCE_CHANGED", "REOPENED"].includes(v.escalationReason)) fail();
    seen.add(v.issueKey); if (v.active) active++;
  }
  if (active > AYAS_EXECUTIVE_ALERT_LIMITS.active || raw.alerts.length - active > AYAS_EXECUTIVE_ALERT_LIMITS.inactive) fail();
}
function clock(state: AyasExecutiveAlertState, at: string) { if (!iso(at) || (state.changedAt !== null && at < state.changedAt)) fail(); }
/** Resolved alerts older than the retention window go first; then the oldest beyond the inactive limit. */
function prune(alerts: readonly AyasExecutiveAlert[], at: string): AyasExecutiveAlert[] {
  const now = Date.parse(at);
  const kept = alerts.filter(a => a.active || now - Date.parse(a.lastChanged) <= AYAS_EXECUTIVE_ALERT_LIMITS.inactiveRetentionMs);
  const inactive = kept.filter(a => !a.active).sort((a, b) => a.lastChanged.localeCompare(b.lastChanged, "en") || a.issueKey.localeCompare(b.issueKey, "en"));
  const drop = new Set(inactive.slice(0, Math.max(0, inactive.length - AYAS_EXECUTIVE_ALERT_LIMITS.inactive)));
  return kept.filter(a => !drop.has(a));
}
export function observeAyasExecutiveSignals(state: AyasExecutiveAlertState, signals: readonly AyasExecutiveSignal[], covered: readonly AyasBriefingDomain[], at: string): AyasExecutiveAlertState {
  assertAyasExecutiveAlertState(state); clock(state, at);
  if (!Array.isArray(signals) || signals.length > 1000 || !Array.isArray(covered) || new Set(covered).size !== covered.length || covered.some(d => !AYAS_BRIEFING_DOMAINS.includes(d))) fail();
  const keys = new Set<string>(), incoming = new Map<string, AyasExecutiveSignal>();
  for (const s of signals) {
    assertAyasExecutiveSignal(s); if (keys.has(s.issueKey)) fail(); keys.add(s.issueKey);
    if (s.priority !== "ROUTINE") incoming.set(s.issueKey, s);
  }
  const alerts: AyasExecutiveAlert[] = [];
  let changed = false;
  for (const old of state.alerts) {
    const s = incoming.get(old.issueKey); incoming.delete(old.issueKey);
    if (!s) { const resolve = old.active && covered.includes(old.domain); alerts.push(resolve ? { ...old, active: false, lastChanged: at } : old); changed ||= resolve; continue; }
    const fingerprint = executiveSignalFingerprint(s);
    if (fingerprint === old.fingerprint && old.active) { alerts.push(old); continue; }
    changed = true;
    const escalationReason: AyasEscalationReason | null = rank[s.priority] > rank[old.priority] ? "SEVERITY_INCREASED"
      : !old.active ? "REOPENED" : rank[s.priority] < rank[old.priority] ? null : "MATERIAL_EVIDENCE_CHANGED";
    alerts.push({ ...old, ...s, fingerprint, active: true, lastChanged: at, acknowledgedFingerprint: null,
      notifiedFingerprint: old.active ? old.notifiedFingerprint : null, escalationReason });
  }
  for (const s of incoming.values()) { changed = true; alerts.push({ ...s, alertId: alertDigest({ issueKey: s.issueKey }), fingerprint: executiveSignalFingerprint(s), active: true,
    firstSeen: at, lastChanged: at, lastNotified: null, notifiedFingerprint: null, acknowledgedFingerprint: null, nextEligibleNotification: null, escalationReason: null }); }
  const kept = prune(alerts, at);
  if (kept.length !== alerts.length) changed = true;
  if (!changed) return state;
  // More active issues than the limit fail closed in the state assertion; they are never dropped.
  const next: AyasExecutiveAlertState = { schemaVersion: "1", changedAt: at, alerts: kept.sort((a,b) => a.issueKey.localeCompare(b.issueKey, "en")) };
  assertAyasExecutiveAlertState(next); return next;
}
export function executiveNotificationEligible(a: AyasExecutiveAlert, at: string): boolean {
  if (!iso(at)) fail();
  return a.active && a.priority !== "ROUTINE" && a.acknowledgedFingerprint !== a.fingerprint && a.notifiedFingerprint !== a.fingerprint
    && (a.nextEligibleNotification === null || at >= a.nextEligibleNotification || COOLDOWN_BYPASS.includes(a.escalationReason));
}
export function updateAyasExecutiveAlert(state: AyasExecutiveAlertState, input: { readonly operation: "ACKNOWLEDGE" | "DELIVERED"; readonly alertId: string; readonly fingerprint: string; readonly at: string; readonly cooldownMs: number }): AyasExecutiveAlertState {
  assertAyasExecutiveAlertState(state); clock(state, input.at);
  if (!record(input) || !exact(input as unknown as Record<string, unknown>, ["operation", "alertId", "fingerprint", "at", "cooldownMs"])
    || !["ACKNOWLEDGE", "DELIVERED"].includes(input.operation) || !HASH.test(input.alertId) || !HASH.test(input.fingerprint)
    || !Number.isSafeInteger(input.cooldownMs) || input.cooldownMs < AYAS_EXECUTIVE_COOLDOWN_MS.min || input.cooldownMs > AYAS_EXECUTIVE_COOLDOWN_MS.max) fail();
  const found = state.alerts.find(a => a.alertId === input.alertId);
  if (!found || !found.active || found.fingerprint !== input.fingerprint) throw new Error("AYAS_BRIEFING_STALE_REVIEW");
  if (input.operation === "DELIVERED" && !executiveNotificationEligible(found, input.at)) return state;
  if (input.operation === "ACKNOWLEDGE" && found.acknowledgedFingerprint === found.fingerprint) return state;
  const alerts = state.alerts.map(a => a !== found ? a : input.operation === "ACKNOWLEDGE" ? { ...a, acknowledgedFingerprint: a.fingerprint }
    : { ...a, lastNotified: input.at, notifiedFingerprint: a.fingerprint, nextEligibleNotification: new Date(Date.parse(input.at) + input.cooldownMs).toISOString(), escalationReason: null });
  const next = { schemaVersion: "1" as const, changedAt: input.at, alerts }; assertAyasExecutiveAlertState(next); return next;
}
/** CRITICAL: immediate owner notification. ACTION_REQUIRED: approval queue. MATERIAL_INFO: next briefing. ROUTINE is never stored. */
export function executiveAlertQueues(state: AyasExecutiveAlertState, at: string) {
  assertAyasExecutiveAlertState(state);
  const active = state.alerts.filter(a => a.active), eligible = active.filter(a => executiveNotificationEligible(a, at));
  return { immediate: eligible.filter(a => a.priority === "CRITICAL"), approvalQueue: active.filter(a => a.priority === "ACTION_REQUIRED"),
    nextBriefing: eligible.filter(a => a.priority === "MATERIAL_INFO"), grantsAuthority: false as const };
}
