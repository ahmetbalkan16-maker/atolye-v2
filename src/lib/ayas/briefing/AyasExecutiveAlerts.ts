/** Stage15T pure metadata reducer. An alert, acknowledgement or delivery never confers authority. */
import { createHash } from "node:crypto";
import { canonicalAyasJson } from "../provenance/AyasReleaseProvenance";
import { sanitizeUntrustedNote } from "../../brain/selfheal/BrainUntrustedInput";
export const AYAS_ALERT_PRIORITIES = ["CRITICAL", "ACTION_REQUIRED", "MATERIAL_INFO", "ROUTINE"] as const;
export type AyasAlertPriority = typeof AYAS_ALERT_PRIORITIES[number];
export const AYAS_BRIEFING_DOMAINS = ["health", "improvements", "failures", "decisions", "production", "revenue", "security", "technology", "capacity"] as const;
export type AyasBriefingDomain = typeof AYAS_BRIEFING_DOMAINS[number];
export interface AyasExecutiveSignal {
  readonly issueKey: string; readonly domain: AyasBriefingDomain; readonly priority: AyasAlertPriority;
  readonly summary: string; readonly consequence: string; readonly requestedDecision: string | null;
  readonly evidence: { readonly source: string; readonly reference: string; readonly digest: string; readonly observedAt: string | null };
}
export interface AyasExecutiveAlert extends AyasExecutiveSignal {
  readonly alertId: string; readonly fingerprint: string; readonly active: boolean;
  readonly firstSeen: string; readonly lastChanged: string; readonly lastNotified: string | null;
  readonly notifiedFingerprint: string | null; readonly acknowledgedFingerprint: string | null;
  readonly nextEligibleNotification: string | null; readonly escalationReason: "SEVERITY_INCREASED" | "MATERIAL_EVIDENCE_CHANGED" | "REOPENED" | null;
}
export interface AyasExecutiveAlertState { readonly schemaVersion: "1"; readonly changedAt: string | null; readonly alerts: readonly AyasExecutiveAlert[] }
export const emptyAyasExecutiveAlerts = (): AyasExecutiveAlertState => ({ schemaVersion: "1", changedAt: null, alerts: [] });
export const alertDigest = (v: unknown): string => createHash("sha256").update(canonicalAyasJson(v)).digest("hex");
const HASH = /^[a-f0-9]{64}$/, KEY = /^[a-z][a-z0-9:_-]{1,159}$/;
const rank: Readonly<Record<AyasAlertPriority, number>> = { CRITICAL: 3, ACTION_REQUIRED: 2, MATERIAL_INFO: 1, ROUTINE: 0 };
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
    || !Array.isArray(raw.alerts) || raw.alerts.length > 1000) fail();
  const seen = new Set<string>();
  for (const a of raw.alerts) {
    assertAyasExecutiveSignal(a, true); const v = a as AyasExecutiveAlert;
    if (seen.has(v.issueKey) || v.alertId !== alertDigest({ issueKey: v.issueKey }) || v.fingerprint !== executiveSignalFingerprint(v)
      || typeof v.active !== "boolean" || !iso(v.firstSeen) || !iso(v.lastChanged) || v.firstSeen > v.lastChanged
      || raw.changedAt === null || v.lastChanged > raw.changedAt
      || (v.lastNotified !== null && (!iso(v.lastNotified) || v.lastNotified > raw.changedAt))
      || (v.nextEligibleNotification !== null && !iso(v.nextEligibleNotification))
      || (v.notifiedFingerprint !== null && !HASH.test(v.notifiedFingerprint)) || (v.acknowledgedFingerprint !== null && !HASH.test(v.acknowledgedFingerprint))
      || ![null, "SEVERITY_INCREASED", "MATERIAL_EVIDENCE_CHANGED", "REOPENED"].includes(v.escalationReason)) fail();
    seen.add(v.issueKey);
  }
}
function clock(state: AyasExecutiveAlertState, at: string) { if (!iso(at) || (state.changedAt !== null && at < state.changedAt)) fail(); }
export function observeAyasExecutiveSignals(state: AyasExecutiveAlertState, signals: readonly AyasExecutiveSignal[], covered: readonly AyasBriefingDomain[], at: string): AyasExecutiveAlertState {
  assertAyasExecutiveAlertState(state); clock(state, at);
  if (!Array.isArray(signals) || signals.length > 1000 || !Array.isArray(covered) || new Set(covered).size !== covered.length || covered.some(d => !AYAS_BRIEFING_DOMAINS.includes(d))) fail();
  const incoming = new Map<string, AyasExecutiveSignal>();
  for (const s of signals) { assertAyasExecutiveSignal(s); if (incoming.has(s.issueKey)) fail(); incoming.set(s.issueKey, s); }
  const alerts: AyasExecutiveAlert[] = [];
  let changed = false;
  for (const old of state.alerts) {
    const s = incoming.get(old.issueKey); incoming.delete(old.issueKey);
    if (!s) { const resolve = old.active && covered.includes(old.domain); alerts.push(resolve ? { ...old, active: false, lastChanged: at } : old); changed ||= resolve; continue; }
    const fingerprint = executiveSignalFingerprint(s);
    if (fingerprint === old.fingerprint && old.active) { alerts.push(old); continue; }
    changed = true;
    alerts.push({ ...old, ...s, fingerprint, active: true, lastChanged: at, acknowledgedFingerprint: null,
      notifiedFingerprint: old.active ? old.notifiedFingerprint : null,
      escalationReason: !old.active ? "REOPENED" : rank[s.priority] > rank[old.priority] ? "SEVERITY_INCREASED" : "MATERIAL_EVIDENCE_CHANGED" });
  }
  for (const s of incoming.values()) { changed = true; alerts.push({ ...s, alertId: alertDigest({ issueKey: s.issueKey }), fingerprint: executiveSignalFingerprint(s), active: true,
    firstSeen: at, lastChanged: at, lastNotified: null, notifiedFingerprint: null, acknowledgedFingerprint: null, nextEligibleNotification: null, escalationReason: null }); }
  if (!changed) return state;
  const next: AyasExecutiveAlertState = { schemaVersion: "1", changedAt: at, alerts: alerts.sort((a,b) => a.issueKey.localeCompare(b.issueKey, "en")) };
  assertAyasExecutiveAlertState(next); return next;
}
export function executiveNotificationEligible(a: AyasExecutiveAlert, at: string): boolean {
  if (!iso(at)) fail();
  return a.active && a.priority !== "ROUTINE" && a.acknowledgedFingerprint !== a.fingerprint && a.notifiedFingerprint !== a.fingerprint
    && (a.nextEligibleNotification === null || at >= a.nextEligibleNotification || a.escalationReason !== null);
}
export function updateAyasExecutiveAlert(state: AyasExecutiveAlertState, input: { readonly operation: "ACKNOWLEDGE" | "DELIVERED"; readonly alertId: string; readonly fingerprint: string; readonly at: string; readonly cooldownMs: number }): AyasExecutiveAlertState {
  assertAyasExecutiveAlertState(state); clock(state, input.at);
  if (!record(input) || !exact(input as unknown as Record<string, unknown>, ["operation", "alertId", "fingerprint", "at", "cooldownMs"])
    || !["ACKNOWLEDGE", "DELIVERED"].includes(input.operation) || !HASH.test(input.alertId) || !HASH.test(input.fingerprint)
    || !Number.isSafeInteger(input.cooldownMs) || input.cooldownMs < 60_000 || input.cooldownMs > 86_400_000) fail();
  const found = state.alerts.find(a => a.alertId === input.alertId);
  if (!found || !found.active || found.fingerprint !== input.fingerprint) throw new Error("AYAS_BRIEFING_STALE_REVIEW");
  if (input.operation === "DELIVERED" && !executiveNotificationEligible(found, input.at)) return state;
  if (input.operation === "ACKNOWLEDGE" && found.acknowledgedFingerprint === found.fingerprint) return state;
  const alerts = state.alerts.map(a => a !== found ? a : input.operation === "ACKNOWLEDGE" ? { ...a, acknowledgedFingerprint: a.fingerprint }
    : { ...a, lastNotified: input.at, notifiedFingerprint: a.fingerprint, nextEligibleNotification: new Date(Date.parse(input.at) + input.cooldownMs).toISOString(), escalationReason: null });
  const next = { schemaVersion: "1" as const, changedAt: input.at, alerts }; assertAyasExecutiveAlertState(next); return next;
}
export function executiveAlertQueues(state: AyasExecutiveAlertState, at: string) {
  assertAyasExecutiveAlertState(state);
  const active = state.alerts.filter(a => a.active), eligible = active.filter(a => executiveNotificationEligible(a, at));
  return { immediate: eligible.filter(a => a.priority === "CRITICAL"), approvalQueue: active.filter(a => a.priority === "ACTION_REQUIRED"),
    nextBriefing: eligible.filter(a => a.priority === "MATERIAL_INFO"), auditOnly: active.filter(a => a.priority === "ROUTINE"), grantsAuthority: false as const };
}
