/**
 * Atölye Brain — Autonomous v2: the runtime event model + a bounded buffer (pure).
 *
 * Emir §5 / §6. Continuous observability needs a place for the signals the
 * runtime emits (a wake stall, a pagehide, an STT error, an API timeout) to
 * land before the anomaly classifier looks at them. This is that place:
 *
 *  - a small structured record — timestamp / component / event / severity /
 *    ids / numeric-or-enum metadata;
 *  - NEVER a secret: `containsBrainSecret` on every string; a leak is dropped
 *    (the buffer keeps a redacted note, not the raw value);
 *  - a fixed-size ring (bounded memory);
 *  - deterministic — no clock of its own, the caller stamps `at`.
 *
 * No fs. The Node event store persists a slice of this; the browser observer
 * pushes into it and hands the window to `observeForSelfHeal`.
 */

import { containsBrainSecret, redactBrainText } from "../BrainRedaction";
import { sanitizeUntrustedNote } from "./BrainUntrustedInput";

export type BrainRuntimeEventComponent =
  | "voice"
  | "wake"
  | "stt"
  | "tts"
  | "audio"
  | "lifecycle"
  | "conversation"
  | "brain"
  | "api"
  | "graphify"
  | "performance"
  | "selfheal";

export type BrainRuntimeEventSeverity = "debug" | "info" | "warn" | "error" | "fatal";

export interface BrainRuntimeEvent {
  readonly at: string;
  readonly component: BrainRuntimeEventComponent;
  readonly event: string;
  readonly severity: BrainRuntimeEventSeverity;
  readonly sessionId?: string;
  readonly conversationId?: string;
  /** numeric / boolean / short-enum only — no free text from an untrusted source. */
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface BrainRuntimeEventInput {
  readonly at: string;
  readonly component: BrainRuntimeEventComponent;
  readonly event: string;
  readonly severity?: BrainRuntimeEventSeverity;
  readonly sessionId?: string;
  readonly conversationId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const MAX_EVENT_NAME = 80;
const MAX_META_KEYS = 24;

function scrub(v: unknown, max: number): string {
  return redactBrainText(String(v ?? "")).text.replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function sanitizeId(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 64);
  return s || undefined;
}

function sanitizeMeta(meta: Readonly<Record<string, unknown>> | undefined): BrainRuntimeEvent["metadata"] {
  if (!meta) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  let n = 0;
  for (const [k, v] of Object.entries(meta)) {
    if (n >= MAX_META_KEYS) break;
    const key = k.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40);
    if (!key) continue;
    if (typeof v === "number" || typeof v === "boolean" || v === null) {
      out[key] = v;
      n += 1;
    } else if (typeof v === "string") {
      // strings in metadata are treated as untrusted: sanitise + drop a secret
      const s = sanitizeUntrustedNote(v, 80);
      out[key] = containsBrainSecret(s) ? "[redacted]" : s;
      n += 1;
    }
  }
  return Object.freeze(out);
}

/** Build a safe event record from a raw input. Never throws. */
export function buildRuntimeEvent(input: BrainRuntimeEventInput): BrainRuntimeEvent {
  return {
    at: scrub(input.at, 40) || new Date(0).toISOString(),
    component: input.component,
    event: scrub(input.event, MAX_EVENT_NAME) || "unnamed",
    severity: input.severity ?? "info",
    ...(sanitizeId(input.sessionId) ? { sessionId: sanitizeId(input.sessionId) } : {}),
    ...(sanitizeId(input.conversationId) ? { conversationId: sanitizeId(input.conversationId) } : {}),
    ...(input.metadata ? { metadata: sanitizeMeta(input.metadata) } : {}),
  };
}

export interface BrainRuntimeEventBufferOptions {
  readonly capacity?: number;
}

/** A bounded, in-memory ring of runtime events. Deterministic; no clock. */
export class BrainRuntimeEventBuffer {
  private readonly ring: BrainRuntimeEvent[] = [];
  private readonly capacity: number;
  private nSeen = 0;
  private nDropped = 0;

  constructor(options: BrainRuntimeEventBufferOptions = {}) {
    this.capacity = Math.max(2, Math.min(5000, Math.floor(options.capacity ?? 500)));
  }

  push(input: BrainRuntimeEventInput): BrainRuntimeEvent {
    const e = buildRuntimeEvent(input);
    this.nSeen += 1;
    this.ring.push(e);
    if (this.ring.length > this.capacity) {
      this.ring.shift();
      this.nDropped += 1;
    }
    return e;
  }

  /** Events at or after `sinceIso` (all when omitted), oldest first. */
  window(sinceIso?: string): readonly BrainRuntimeEvent[] {
    if (!sinceIso) return [...this.ring];
    return this.ring.filter((e) => e.at >= sinceIso);
  }

  /** The most recent `n` events. */
  recent(n: number): readonly BrainRuntimeEvent[] {
    return this.ring.slice(-Math.max(0, n));
  }

  get stats(): { readonly size: number; readonly seen: number; readonly dropped: number; readonly capacity: number } {
    return { size: this.ring.length, seen: this.nSeen, dropped: this.nDropped, capacity: this.capacity };
  }

  clear(): void {
    this.ring.length = 0;
  }
}

/**
 * Turn an event window into a `BrainTimelineEvent[]` (the shape the root-cause
 * engine reads). Deterministic — `at` strings become epoch ms.
 */
export function eventsToTimeline(events: readonly BrainRuntimeEvent[]): { at: number; name: string; detail?: string }[] {
  const out: { at: number; name: string; detail?: string }[] = [];
  for (const e of events) {
    const at = Date.parse(e.at);
    if (Number.isFinite(at)) out.push({ at, name: `${e.component}:${e.event}`, detail: String(e.severity) });
  }
  return out;
}

/** True when the recent window shows the runtime is BUSY (a live voice turn / critical op). */
export function runtimeIsBusy(events: readonly BrainRuntimeEvent[], nowMs: number, windowMs = 15_000): boolean {
  return events.some((e) => {
    const at = Date.parse(e.at);
    if (!Number.isFinite(at) || nowMs - at > windowMs) return false;
    return (
      (e.component === "voice" && /wake-hit|capture-start|command-start|speaking/.test(e.event)) ||
      (e.component === "conversation" && /thinking|stream-start/.test(e.event)) ||
      e.event === "user-interaction"
    );
  });
}
