import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { AYAS_AUTO_LIVE_OWNER_QUIET_MS } from "./AyasAutoLivePublish";
import { ayasCodeLaneRefusals } from "./AyasCodeChangeLane";
import { AYAS_OWNER_GRACE_MIN_WAIT_MS } from "./AyasOwnerApprovalAdmission";

/**
 * Grace auto-approval (owner instruction 2026-11-19, in the owner's words: "gelişim merkezine gelen ...
 * geliştirmelerini benden onay almadan yapmasını istiyorum; örnek veriyorum, böyle bir geliştirme keşfetti, 5 dakika
 * orada onayda beklesin, ben onay vermezsem bile kendisi işleme alsın ve onaylasın").
 *
 * Every item in Gelişim Merkezi that waits for one of the four one-click owner approvals — a READY_FOR_REVIEW
 * micro-batch, a PENDING SAFE patch-artifact proposal, a ready developer build, a passed update trial on the current
 * HEAD — gets a durable "ready since" record the first time the observer's update executor sees it. When the item has
 * waited the grace period (AYAS_GRACE_AUTO_APPROVE_MS, default 5 minutes) without the owner rejecting, deferring or
 * holding it, the executor approves it through the SAME service the owner's click calls, bound to the same id + hash,
 * with a sealed standing-grace admission in place of the session (`mintAyasOwnerGraceAdmission`). No gate is loosened:
 * every check the click path runs, runs. What may never be approved this way is listed by `ayasGraceFileExclusions`
 * and the runner's per-kind rules; those items wait for the owner, as before.
 *
 * This module is the policy, the ledger and the pure tick planner. It runs no process and calls no network; the
 * executor-side runner (`AyasGraceAutoApprovalRunner`) gathers the candidates and calls the services. The ledger lives
 * outside Git (`data/brain/self-improvement/grace-approvals/`, .gitignore). Two files: `state.json`, written only by
 * the executor (which holds the executor lock), and `holds.json`, written only by the owner's "Otomatik onayı durdur"
 * click, so neither can overwrite the other's record.
 */

export const AYAS_GRACE_AUTO_APPROVE_ENV = "AYAS_GRACE_AUTO_APPROVE";
export const AYAS_GRACE_AUTO_APPROVE_MS_ENV = "AYAS_GRACE_AUTO_APPROVE_MS";
export const AYAS_GRACE_DEFAULT_MS = 5 * 60_000;
export const AYAS_GRACE_MAX_MS = 7 * 24 * 3_600_000;

export interface AyasGracePolicy {
  readonly enabled: boolean;
  readonly graceMs: number;
}

/**
 * On unless `AYAS_GRACE_AUTO_APPROVE=0` (the owner asked for it, so no env means on). The wait comes from
 * `AYAS_GRACE_AUTO_APPROVE_MS`; a missing or malformed value is the 5-minute default, and it is clamped to
 * [1 minute, 7 days] so a typo can never make approval immediate.
 */
export function resolveAyasGracePolicy(env: Record<string, string | undefined> = process.env): AyasGracePolicy {
  const enabled = (env[AYAS_GRACE_AUTO_APPROVE_ENV] ?? "").trim() !== "0";
  const raw = (env[AYAS_GRACE_AUTO_APPROVE_MS_ENV] ?? "").trim();
  const parsed = /^\d{1,12}$/.test(raw) ? Number(raw) : Number.NaN;
  const graceMs = Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, AYAS_OWNER_GRACE_MIN_WAIT_MS), AYAS_GRACE_MAX_MS) : AYAS_GRACE_DEFAULT_MS;
  return { enabled, graceMs };
}

export type AyasGraceKind = "micro-batch" | "proposal" | "code-apply" | "update-apply";
export const AYAS_GRACE_KINDS: readonly AyasGraceKind[] = ["micro-batch", "proposal", "code-apply", "update-apply"];

/** The exact item an approval binds to: a changed hash is another item and waits again from the start. */
export interface AyasGraceSubject {
  readonly kind: AyasGraceKind;
  readonly id: string;
  readonly hash: string;
}

export const ayasGraceKey = (subject: AyasGraceSubject): string => `${subject.kind}:${subject.id}:${subject.hash}`;

const ID = /^[\w.:-]{1,160}$/;
const HASH = /^[\w.:-]{8,160}$/;

export function isAyasGraceSubject(value: unknown): value is AyasGraceSubject {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.kind === "string" && (AYAS_GRACE_KINDS as readonly string[]).includes(v.kind)
    && typeof v.id === "string" && ID.test(v.id) && typeof v.hash === "string" && HASH.test(v.hash);
}

/**
 * Beyond the code lane's own refusals: the approval surfaces themselves. A change to them could hide the countdown or
 * the hold button, or change how an approval is sealed, so it always waits for the owner.
 */
const GRACE_EXCLUDED: readonly { readonly test: RegExp; readonly why: string }[] = [
  { test: /^app\/brain\/(?:actions|observerActions)\.ts$/, why: "onay ve yürütme eylemleri" },
  { test: /^src\/lib\/auth\//, why: "erişim kapısı ve onay mühürleri" },
  { test: /^src\/components\/brain\/(?:AyasDevelopmentCenter|AtolyeBrainsPanel|AyasGoalResearchPanel|AyasGraceAutoApprovalNotice)\.tsx$/, why: "onay ekranı" },
  { test: /^scripts\/smoke-ayas-(?:grace-auto-approval|owner-approval-admission|action-firewall[\w-]*|code-change-lane|update-apply|update-approval)\.ts$/, why: "onay altyapısının kanıtı" },
];

/**
 * Why a change to these files may never be approved without the owner: everything the code lane refuses (outside the
 * source areas, the homepage, `src/lib/brain/autonomy/` and the rest of the approval and execution machinery, the
 * observer and executor scripts, the development queue, eval-pinned files and every other FORBIDDEN_AUTONOMOUS target,
 * anything needing a restart or a config write), plus the approval surfaces above. Empty when every file may.
 */
export function ayasGraceFileExclusions(files: readonly string[]): readonly string[] {
  const out = ayasCodeLaneRefusals(files).map((refusal) => `${refusal.file}: ${refusal.why}`);
  for (const file of files) {
    const normalized = String(file ?? "").replace(/\\/g, "/");
    const rule = GRACE_EXCLUDED.find((entry) => entry.test.test(normalized));
    if (rule && !out.some((line) => line.startsWith(`${normalized}:`))) out.push(`${normalized}: ${rule.why}`);
  }
  return out;
}

/** V3 sources a running or waiting V3 production reads from this tree. */
export const isAyasGraceV3File = (file: string): boolean => /^(?:src\/lib\/v3\/|scripts\/v3\/|remotion-v3\/|content\/v3\/)/.test(String(file).replace(/\\/g, "/"));

/** One item the executor saw waiting for an owner approval this tick. */
export interface AyasGraceCandidate {
  readonly subject: AyasGraceSubject;
  readonly title: string;
  /** Why it may never be approved without the owner; empty means it may. */
  readonly exclusions: readonly string[];
  /** The latest decision recorded on this exact item; a newer one than the ready time restarts the wait. */
  readonly touchedAt?: string;
  /** Touches the V3 sources: waits while a V3 production runs or waits. */
  readonly v3: boolean;
}

export type AyasGraceStatus = "WAITING" | "EXCLUDED" | "LEFT" | "APPROVING" | "APPROVED" | "FAILED";

export interface AyasGraceOutcome {
  readonly ok: boolean;
  readonly code?: string;
  readonly commitSha?: string;
  readonly detail?: string;
}

export interface AyasGraceEntry {
  readonly key: string;
  readonly kind: AyasGraceKind;
  readonly id: string;
  readonly hash: string;
  readonly title: string;
  /** When the executor first saw this exact item ready (or when a decision on it restarted the wait). */
  readonly readyAt: string;
  /** Keyed digest over kind, id, hash and readyAt: an edited ready time is not trusted and the wait starts again. */
  readonly readySeal: string;
  readonly status: AyasGraceStatus;
  readonly updatedAt: string;
  readonly exclusions?: readonly string[];
  readonly approvedAt?: string;
  /** `owner-standing-grace: <ms> ms elapsed since <readyAt>`, the same text the ledger event carries. */
  readonly provenance?: string;
  readonly outcome?: AyasGraceOutcome;
}

export interface AyasGraceEvent {
  readonly at: string;
  readonly key: string;
  readonly event: "READY" | "EXCLUDED" | "RESET" | "LEFT" | "APPROVING" | "APPROVED" | "FAILED";
  readonly detail?: string;
}

export interface AyasGraceState {
  readonly schemaVersion: 1;
  readonly entries: readonly AyasGraceEntry[];
  readonly events: readonly AyasGraceEvent[];
}

export interface AyasGraceHold {
  readonly key: string;
  readonly kind: AyasGraceKind;
  readonly id: string;
  readonly hash: string;
  readonly heldAt: string;
}

export interface AyasGraceHoldState {
  readonly schemaVersion: 1;
  readonly holds: readonly AyasGraceHold[];
}

export const emptyAyasGraceState = (): AyasGraceState => ({ schemaVersion: 1, entries: [], events: [] });

const ENTRY_LIMIT = 400;
const EVENT_LIMIT = 300;
const HOLD_LIMIT = 400;
const RETENTION_MS = 30 * 24 * 3_600_000;
const READY_SEAL_DOMAIN = "ayas-grace-ready:v1";

/** The keyed digest that makes a ready time trustworthy (the executor holds the access key). */
export function sealAyasGraceReady(key: string, subject: AyasGraceSubject, readyAt: string): string {
  return crypto.createHmac("sha256", key).update(`${READY_SEAL_DOMAIN}\n${subject.kind}\n${subject.id}\n${subject.hash}\n${readyAt}`).digest("hex");
}

export function ayasGraceProvenance(elapsedMs: number, readyAt: string): string {
  return `owner-standing-grace: ${elapsedMs} ms elapsed since ${readyAt}`;
}

export function resolveAyasGraceRoot(repoRoot: string = process.cwd()): string {
  return path.join(repoRoot, "data", "brain", "self-improvement", "grace-approvals");
}

export interface AyasGraceStore {
  readonly rootDir: string;
  load(): AyasGraceState;
  save(state: AyasGraceState): void;
  loadHolds(): AyasGraceHoldState;
  /** The owner's "Otomatik onayı durdur": this exact item then waits for the owner like before. */
  hold(subject: AyasGraceSubject, at: string): AyasGraceHoldState;
}

function writeAtomic(dir: string, file: string, value: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(tmp, "w");
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

/** Fails closed: an unreadable ledger throws (no approval is made from a guess); a missing one is empty. */
export function createAyasGraceStore(options: { readonly rootDir?: string } = {}): AyasGraceStore {
  const rootDir = path.resolve(options.rootDir ?? resolveAyasGraceRoot());
  const stateFile = path.join(rootDir, "state.json");
  const holdFile = path.join(rootDir, "holds.json");
  const loadHolds = (): AyasGraceHoldState => {
    let raw: string;
    try { raw = fs.readFileSync(holdFile, "utf8"); } catch { return { schemaVersion: 1, holds: [] }; }
    const parsed = JSON.parse(raw) as AyasGraceHoldState;
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.holds)) throw new Error("grace-approvals holds have an unknown schema");
    return parsed;
  };
  return {
    rootDir,
    load() {
      let raw: string;
      try { raw = fs.readFileSync(stateFile, "utf8"); } catch { return emptyAyasGraceState(); }
      const parsed = JSON.parse(raw) as AyasGraceState;
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.entries) || !Array.isArray(parsed.events)) throw new Error("grace-approvals state has an unknown schema");
      return parsed;
    },
    save(state) { writeAtomic(rootDir, stateFile, state); },
    loadHolds,
    hold(subject, at) {
      if (!isAyasGraceSubject(subject)) throw new Error("AYAS_GRACE_INVALID_SUBJECT");
      const current = loadHolds();
      const key = ayasGraceKey(subject);
      if (current.holds.some((entry) => entry.key === key)) return current;
      const next: AyasGraceHoldState = { schemaVersion: 1, holds: [...current.holds, { key, kind: subject.kind, id: subject.id, hash: subject.hash, heldAt: at }].slice(-HOLD_LIMIT) };
      writeAtomic(rootDir, holdFile, next);
      return next;
    },
  };
}

export interface AyasGracePlanInput {
  readonly policy: AyasGracePolicy;
  readonly now: string;
  readonly state: AyasGraceState;
  readonly holds: readonly AyasGraceHold[];
  readonly candidates: readonly AyasGraceCandidate[];
  readonly sealReady: (subject: AyasGraceSubject, readyAt: string) => string;
  readonly ownerChatAt?: string;
  readonly v3Busy: boolean;
  /** Package C's gate is open (another publication is running): nothing new starts. */
  readonly publicationActive: boolean;
}

export type AyasGraceWait = "DISABLED" | "NOTHING_DUE" | "OWNER_CHAT" | "PUBLICATION_ACTIVE" | "V3_BUSY";

export interface AyasGracePlan {
  readonly state: AyasGraceState;
  /** At most one item per tick. */
  readonly approve?: { readonly candidate: AyasGraceCandidate; readonly entry: AyasGraceEntry; readonly elapsedMs: number };
  readonly wait?: AyasGraceWait;
  /** Earliest moment the next waiting item falls due, for the report. */
  readonly nextDueAt?: string;
}

/**
 * One tick, pure: records the ready time of every new item (sealed), restarts the wait when a decision touched the
 * item after it became ready, marks items that are no longer waiting as LEFT (so a returning item waits again from the
 * start), and picks at most one item whose full wait has passed — never one the owner held, never an excluded one,
 * never while the owner chatted with AYAS in the last 5 minutes, never while another publication runs, and never a
 * V3-touching one while a V3 production runs or waits. Turned off, it starts no countdown and forgets running ones,
 * so turning it on again gives every item its full wait.
 */
export function planAyasGraceTick(input: AyasGracePlanInput): AyasGracePlan {
  const nowMs = Date.parse(input.now);
  const events: AyasGraceEvent[] = [...input.state.events];
  const byKey = new Map(input.state.entries.map((entry) => [entry.key, entry] as const));
  const candidateKeys = new Set(input.candidates.map((candidate) => ayasGraceKey(candidate.subject)));
  const held = new Set(input.holds.map((entry) => entry.key));
  const event = (key: string, kind: AyasGraceEvent["event"], detail?: string) => events.push({ at: input.now, key, event: kind, ...(detail ? { detail } : {}) });

  for (const entry of input.state.entries) {
    const waiting = entry.status === "WAITING" || entry.status === "EXCLUDED";
    if (waiting && (!input.policy.enabled || !candidateKeys.has(entry.key))) {
      byKey.set(entry.key, { ...entry, status: "LEFT", updatedAt: input.now });
      event(entry.key, "LEFT", input.policy.enabled ? "artık onay beklemiyor" : "otomatik onay kapalı");
    }
  }

  if (input.policy.enabled) {
    for (const candidate of input.candidates) {
      const key = ayasGraceKey(candidate.subject);
      const entry = byKey.get(key);
      const status: AyasGraceStatus = candidate.exclusions.length ? "EXCLUDED" : "WAITING";
      const fresh = (): AyasGraceEntry => ({
        key, kind: candidate.subject.kind, id: candidate.subject.id, hash: candidate.subject.hash, title: candidate.title.slice(0, 200),
        readyAt: input.now, readySeal: input.sealReady(candidate.subject, input.now), status, updatedAt: input.now,
        ...(candidate.exclusions.length ? { exclusions: candidate.exclusions.slice(0, 8) } : {}),
      });
      if (!entry || entry.status === "LEFT" || entry.readySeal !== input.sealReady(candidate.subject, entry.readyAt)) {
        byKey.set(key, fresh());
        event(key, status === "EXCLUDED" ? "EXCLUDED" : "READY", status === "EXCLUDED" ? candidate.exclusions[0] : undefined);
        continue;
      }
      if (entry.status !== "WAITING" && entry.status !== "EXCLUDED") continue;
      const touchedMs = candidate.touchedAt ? Date.parse(candidate.touchedAt) : Number.NaN;
      if (Number.isFinite(touchedMs) && touchedMs > Date.parse(entry.readyAt)) {
        byKey.set(key, fresh());
        event(key, "RESET", "öğe üzerinde yeni bir karar kaydedildi");
        continue;
      }
      if (entry.status !== status) byKey.set(key, { ...entry, status, updatedAt: input.now, ...(candidate.exclusions.length ? { exclusions: candidate.exclusions.slice(0, 8) } : { exclusions: undefined }) });
    }
  }

  const entries = prune([...byKey.values()], nowMs);
  const state: AyasGraceState = { schemaVersion: 1, entries, events: events.slice(-EVENT_LIMIT) };
  if (!input.policy.enabled) return { state, wait: "DISABLED" };

  const due: { candidate: AyasGraceCandidate; entry: AyasGraceEntry; elapsedMs: number }[] = [];
  let nextDueMs = Number.POSITIVE_INFINITY;
  for (const candidate of input.candidates) {
    const key = ayasGraceKey(candidate.subject);
    const entry = entries.find((e) => e.key === key);
    if (!entry || entry.status !== "WAITING" || held.has(key)) continue;
    const elapsedMs = nowMs - Date.parse(entry.readyAt);
    if (elapsedMs >= input.policy.graceMs) due.push({ candidate, entry, elapsedMs });
    else nextDueMs = Math.min(nextDueMs, Date.parse(entry.readyAt) + input.policy.graceMs);
  }
  const nextDueAt = Number.isFinite(nextDueMs) ? new Date(nextDueMs).toISOString() : undefined;
  if (!due.length) return { state, wait: "NOTHING_DUE", ...(nextDueAt ? { nextDueAt } : {}) };
  if (input.publicationActive) return { state, wait: "PUBLICATION_ACTIVE" };
  const chatMs = input.ownerChatAt ? Date.parse(input.ownerChatAt) : Number.NaN;
  if (Number.isFinite(chatMs) && nowMs - chatMs < AYAS_AUTO_LIVE_OWNER_QUIET_MS) return { state, wait: "OWNER_CHAT" };
  due.sort((a, b) => a.entry.readyAt.localeCompare(b.entry.readyAt) || a.entry.key.localeCompare(b.entry.key));
  const pick = due.find((entry) => !(entry.candidate.v3 && input.v3Busy));
  if (!pick) return { state, wait: "V3_BUSY" };
  return { state, approve: pick };
}

function prune(entries: readonly AyasGraceEntry[], nowMs: number): AyasGraceEntry[] {
  const kept = entries.filter((entry) => {
    if (entry.status === "WAITING" || entry.status === "EXCLUDED" || entry.status === "APPROVING") return true;
    const at = Date.parse(entry.updatedAt);
    return !Number.isFinite(at) || nowMs - at < RETENTION_MS;
  });
  return kept.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).slice(-ENTRY_LIMIT);
}

/** Records one entry's transition with its ledger event (the executor's own writes around a service call). */
export function withAyasGraceEntry(state: AyasGraceState, entry: AyasGraceEntry, event: AyasGraceEvent["event"], detail?: string): AyasGraceState {
  return {
    schemaVersion: 1,
    entries: [...state.entries.filter((e) => e.key !== entry.key), entry],
    events: [...state.events, { at: entry.updatedAt, key: entry.key, event, ...(detail ? { detail: detail.slice(0, 300) } : {}) }].slice(-EVENT_LIMIT),
  };
}

/* ------------------------------------------------------------------- view --- */

export interface AyasGraceViewEntry {
  readonly key: string;
  readonly kind: AyasGraceKind;
  readonly id: string;
  readonly hash: string;
  readonly title: string;
  readonly status: AyasGraceStatus;
  readonly readyAt: string;
  /** For a WAITING item: when the executor may approve it (readyAt + the wait). */
  readonly dueAt?: string;
  readonly held: boolean;
  readonly exclusions: readonly string[];
  readonly approvedAt?: string;
  readonly provenance?: string;
  readonly outcome?: AyasGraceOutcome;
}

export interface AyasGraceView {
  readonly connected: boolean;
  readonly error?: string;
  readonly enabled: boolean;
  readonly graceMs: number;
  readonly generatedAt: string;
  readonly entries: readonly AyasGraceViewEntry[];
  /** Holds the owner set on items the executor has not recorded yet. */
  readonly holds: readonly string[];
}

/** What Gelişim Merkezi shows: the real ledger, never an invented countdown. */
export function buildAyasGraceView(input: { readonly policy: AyasGracePolicy; readonly state: AyasGraceState; readonly holds: readonly AyasGraceHold[]; readonly now: string }): AyasGraceView {
  const held = new Set(input.holds.map((entry) => entry.key));
  const entries = input.state.entries.filter((entry) => entry.status !== "LEFT").map((entry): AyasGraceViewEntry => ({
    key: entry.key, kind: entry.kind, id: entry.id, hash: entry.hash, title: entry.title, status: entry.status, readyAt: entry.readyAt,
    ...(entry.status === "WAITING" ? { dueAt: new Date(Date.parse(entry.readyAt) + input.policy.graceMs).toISOString() } : {}),
    held: held.has(entry.key), exclusions: entry.exclusions ?? [],
    ...(entry.approvedAt ? { approvedAt: entry.approvedAt } : {}), ...(entry.provenance ? { provenance: entry.provenance } : {}), ...(entry.outcome ? { outcome: entry.outcome } : {}),
  }));
  return { connected: true, enabled: input.policy.enabled, graceMs: input.policy.graceMs, generatedAt: input.now, entries, holds: [...held] };
}

/** Read-only loader for the owner's pages. An unreadable ledger is reported, not shown as empty. */
export function loadAyasGraceView(options: { readonly repoRoot?: string; readonly env?: Record<string, string | undefined>; readonly now?: string } = {}): AyasGraceView {
  const policy = resolveAyasGracePolicy(options.env ?? process.env);
  const now = options.now ?? new Date().toISOString();
  try {
    const store = createAyasGraceStore({ rootDir: resolveAyasGraceRoot(options.repoRoot ?? process.cwd()) });
    return buildAyasGraceView({ policy, state: store.load(), holds: store.loadHolds().holds, now });
  } catch (error) {
    return { connected: false, error: error instanceof Error ? error.message.slice(0, 160) : "okunamadı", enabled: policy.enabled, graceMs: policy.graceMs, generatedAt: now, entries: [], holds: [] };
  }
}

/** The execution gate's state file, read the same way AyasPublicationActivity reads it (fs only, no import of the writers). */
export function isAyasGracePublicationGateOpen(repoRoot: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(repoRoot, "data", "brain", "self-improvement", "execution", "gate.json"), "utf8")) as { readonly state?: unknown };
    return typeof parsed.state === "string" && parsed.state !== "CLOSED";
  } catch { return false; }
}
