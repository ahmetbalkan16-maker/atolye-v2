/**
 * Atölye Brain — AYAS memory governance (Phase 2 · Phase C.1).
 *
 * AYAS does NOT write every message to long-term memory. A turn produces zero or
 * more *candidates* (`AyasMemoryCandidate.ts`); each runs this gate:
 *
 *   candidate → importance scoring → confidence → (redaction: BrainMemoryModel)
 *             → store | reject
 *
 * Pure + deterministic. It decides WHETHER + at WHAT importance; the actual
 * record build + redaction + validation is `buildBrainMemoryRecord` /
 * `validateBrainMemoryRecord`, and persistence is `AyasMemoryStore`.
 */

import { containsBrainSecret } from "@/lib/brain/BrainRedaction";
import type {
  BrainMemoryConfidence,
  BrainMemoryImportance,
  BrainMemoryKind,
} from "@/types/brainMemory";

export interface AyasMemoryCandidate {
  readonly kind: BrainMemoryKind;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  /** Where it came from — `user-stated` is trusted more than `ayas-inferred`. */
  readonly source: "user-stated" | "user-decision" | "ayas-inferred";
}

export interface AyasMemoryGovernanceDecision {
  readonly store: boolean;
  readonly importance: BrainMemoryImportance;
  readonly confidence: BrainMemoryConfidence;
  /** Safe one-liner — why it was (not) stored. */
  readonly reason: string;
  /** Non-pinned notes get an expiry this many days out; `null` = no expiry. */
  readonly expiresInDays: number | null;
}

const MIN_BODY = 8;
const MAX_BODY = 600;

/** These NEVER go to long-term memory even if a candidate is produced. */
const NEVER_STORE_KINDS = new Set<BrainMemoryKind>(["security-policy"]);

export function scoreAyasMemoryCandidate(candidate: AyasMemoryCandidate): AyasMemoryGovernanceDecision {
  const body = candidate.body.replace(/\s+/g, " ").trim();
  const title = candidate.title.replace(/\s+/g, " ").trim();

  if (!title || body.length < MIN_BODY) {
    return reject("çok kısa / boş içerik");
  }
  if (body.length > MAX_BODY) {
    return reject("içerik uzunluk sınırını aştı");
  }
  if (NEVER_STORE_KINDS.has(candidate.kind)) {
    return reject(`"${candidate.kind}" türü kalıcı hafızaya alınmaz`);
  }
  // Secrets never — the model's redactor would scrub them anyway, but reject the
  // whole candidate rather than store a scrubbed shell.
  if (containsBrainSecret(title) || containsBrainSecret(body)) {
    return reject("sır / anahtar içeriyor");
  }
  // Transient chit-chat: a candidate the extractor would only emit as
  // `ayas-inferred` with no tags and no durable kind → drop.
  const durableKind =
    candidate.kind === "user-preference" ||
    candidate.kind === "decision" ||
    candidate.kind === "known-bug" ||
    candidate.kind === "project-structure" ||
    candidate.kind === "environment-note";

  if (candidate.source === "ayas-inferred" && !durableKind) {
    return reject("geçici çıkarım — kalıcı değil");
  }

  const importance: BrainMemoryImportance =
    candidate.source === "user-decision"
      ? "durable"
      : candidate.source === "user-stated" && candidate.kind === "user-preference"
        ? "durable"
        : durableKind
          ? "normal"
          : "transient";

  const confidence: BrainMemoryConfidence =
    candidate.source === "ayas-inferred" ? "inferred" : "reported";

  const expiresInDays = importance === "transient" ? 7 : importance === "normal" ? 120 : null;

  return {
    store: importance !== "transient",
    importance,
    confidence,
    reason:
      importance === "transient"
        ? "geçici — saklanmadı"
        : `${importance} / ${confidence} olarak saklanacak`,
    expiresInDays,
  };
}

function reject(reason: string): AyasMemoryGovernanceDecision {
  return { store: false, importance: "transient", confidence: "inferred", reason, expiresInDays: null };
}
