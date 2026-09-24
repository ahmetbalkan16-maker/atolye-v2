/**
 * AYAS Memory Temporal v2 — pure temporal semantics over memory records.
 *
 * Records stay immutable and append-only. Everything temporal about a SET of
 * records is derived here at read time:
 *
 *   observedAt      when AYAS learned it (existing field)
 *   recordedAt      when the durable record was written
 *   effectiveFrom   when it became true — only when the statement says so
 *   effectiveUntil  when it stopped being true — only when the statement says so
 *   heldFrom/Until  a period the statement names as one in which it held
 *
 * Supersession is derived, never stored as a pointer: records sharing an
 * exclusive fact slot (`factKey`) form a version chain ordered by observation.
 * A single append therefore moves "old CURRENT → SUPERSEDED, new → CURRENT"
 * atomically, deleting a record can never leave a copy of it behind, and there
 * are no references that could dangle, cycle or be forged.
 *
 * Deterministic, no model, no IO. Calendar periods are evaluated in UTC.
 */

import type {
  BrainMemoryKind,
  BrainMemoryProvenance,
  BrainMemoryRecord,
  BrainMemoryTemporalAssertion,
  BrainMemoryTemporalInput,
  BrainMemoryTemporalPrecision,
} from "../../../types/brainMemory";
import { isValidBrainMemoryTemporal } from "../../brain/BrainMemoryModel";

/* ------------------------------------------------------------------ */
/* Fact identity                                                        */
/* ------------------------------------------------------------------ */

/**
 * Closed registry of exclusive fact slots — at most one value is current at a
 * time. A record without a key is an independent fact: it never supersedes and
 * is never superseded, so unrelated memories can legitimately overlap.
 */
export const AYAS_MEMORY_FACT_KEYS = [
  "user.identity.name",
  "user.preference.response-length",
  "user.preference.voice-length",
] as const;

export type AyasMemoryFactKey = (typeof AYAS_MEMORY_FACT_KEYS)[number];

export interface AyasMemoryFact {
  readonly key: AyasMemoryFactKey;
  readonly value: string;
}

export function isAyasMemoryFactKey(value: unknown): value is AyasMemoryFactKey {
  return typeof value === "string" && (AYAS_MEMORY_FACT_KEYS as readonly string[]).includes(value);
}

/** Titles the deterministic chat extractor gives user statements (`AyasMemoryCandidate.ts`). */
const IDENTITY_TITLE = "Kullanıcı kimliği / hitap tercihi";
const USER_STATEMENT_TITLES = new Set([
  IDENTITY_TITLE,
  "Kullanıcı tercihi",
  "Alınan karar",
  "Çalışma ortamı bilgisi",
  "Bilinen sorun",
]);

function fold(text: string): string {
  return String(text ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[İıI]/g, "i")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/â/g, "a")
    // Other accents ("José", "Zoë") fold to their base letter, so a name is
    // never cut at an accent; letters NFD cannot decompose are mapped.
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ø/g, "o")
    .replace(/ł/g, "l")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/[đð]/g, "d")
    .replace(/þ/g, "th")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");
}

/** The folded form a stored name value is compared in — for displaying the name as the user wrote it. */
export function ayasMemoryNameKey(text: string): string {
  return fold(text).trim();
}

/**
 * Naming forms in the v1 conflict-check order (beni / adım / ben / bana), so a
 * legacy record with one naming form resolves to the value v1 gave it. "ben
 * X'im" needs the apostrophe (folded to a space), as the extractor does —
 * otherwise "ben öğretmenim" names nobody. "adım" is also the noun "step"
 * ("sonraki adım testleri çalıştırmak"), so it names someone only at the
 * start of a segment (after a greeting or "hayır" at most) or as "benim adım".
 * "beni X olarak" / "bana X diye" name someone only with the positive
 * instruction the extractor gates on — never "hatırlama", "kaydettin",
 * "hatırlıyordun" or "hitap etme".
 */
// Group 1 is everything before the name, group 2 the name — so the name's position is known exactly.
const IDENTITY_PATTERNS = [
  /(\bbeni\s+)([a-z][a-z0-9'-]{1,40})\s+olarak\s+(?:\S+\s+){0,2}?hatirla(?:yin|yiniz|r\s+misin|r\s+misiniz)?\b/g,
  /((?:^\s*(?:(?:merhaba|selam|hayir|evet|tamam|aslinda|yani|peki|bu arada|ha)\s+)*|\bbenim\s+)adim\s+)([a-z][a-z0-9'-]{1,40})\b/g,
  /(\bben\s+)([a-z][a-z0-9'-]{1,40})\s+(?:im|yim)\b/g,
  /(\bbana\s+)([a-z][a-z0-9'-]{1,40})\s+diye\s+(?:hitap\s+e(?:t(?:in|iniz|ir\s+misin)?|debilir(?:sin|siniz|\s+misin))|seslen(?:in|iniz|ebilirsin)?|cagir(?:in|iniz|abilirsin)?)\b/g,
];
/**
 * What follows a name that makes it not a current statement: a negation or a
 * past copula ("Ali değil(di)", "Ali'ydi", "Ahmet'ti"), a question particle
 * ("Ahmet miydi?") or a conditional ("Ahmet olsaydı"). Bare "di/ti" only:
 * "tüm" and "dün" fold to "tum"/"dun" and must not read as a copula.
 */
const NOT_CURRENT_NAME = /^\s+(?:degil\w*|y?d[iu]|t[iu]|yd[iu][mnk]|idi[mnk]?|m[iu](?:ydi|ydu|dir|sin|yim|yiz)?|ols\w*)\b/;
/** A copula typed without the apostrophe stays on the name ("Aliydi", "Ahmetti"). */
const COPULA_ON_NAME = /(?:[aeiou]yd[iu][mk]?|tt[iu])$/;
/** Question words, particles and fillers are never a name ("adım ne", "adım Ali değil ki"). */
const NOT_A_NAME = new Set([
  "ne", "nedir", "neydi", "nerede", "kim", "kimdir", "kimdi", "mi", "mu", "miydi", "muydu", "midir", "misin", "musun",
  "degil", "ki", "de", "da", "ama", "ve", "bu", "su", "o", "adim", "ismim", "benim", "hayir", "evet", "tamam",
  "yanlis", "dogru", "aslinda", "yok", "var", "yani", "peki",
]);
/** "…ama/artık/ve…" splits what was from what is ("adım Ahmet'ti ama artık Mehmet"). */
const SEGMENT_BREAK = /\b(?:ama|fakat|ancak|artik|ve)\b/;

/** Folded segments in document order: clauses by punctuation, then by contrast words. */
function statementSegments(text: string): string[] {
  return String(text ?? "")
    .split(/[,.;!?\n]+/)
    .flatMap((clause) => fold(clause).split(SEGMENT_BREAK))
    .filter((segment) => segment.trim().length > 0);
}

/** "Eskiden adım Ali" — a time adverb before the name puts that name in the past ("daha önce" usually modifies "söyledim", so it is not one). */
const NAME_HISTORY_CUE = /\b(?:eskiden|onceden|bir zamanlar|o zamanlar|gecmiste|gecen (?:yil|sene|ay))\b/;

/**
 * What an identity statement says about the current name:
 *  - a name, with the segment that states it;
 *  - `withdrawn`: it names someone only as past or negated ("adım Ali
 *    değil", "eskiden adım Ali idi") and states no current name — the old
 *    name must not be reaffirmed, and no new one is guessed;
 *  - `null`: no naming form at all.
 * A name is past only by what is attached to it: its copula ("Ali'ydi",
 * "Ali değil"), a question particle after it, or a time adverb before it in
 * the same segment. An unrelated past verb later in the sentence ("adım
 * Ahmet, bunu söylemiştim") does not unname anyone.
 */
export type AyasIdentityReading = { readonly value: string; readonly clause: string } | { readonly withdrawn: true } | null;

function identityEvidence(body: string, tags: readonly string[]): AyasIdentityReading {
  if (!tags.includes("kimlik")) return null;
  const segments = statementSegments(body);
  let withdrawn = false;
  for (const pattern of IDENTITY_PATTERNS) {
    for (const segment of segments) {
      for (const match of segment.matchAll(pattern)) {
        const name = match[2];
        if (NOT_A_NAME.has(name)) continue;
        const nameStart = match.index + match[1].length;
        const nameEnd = nameStart + name.length;
        if (NOT_CURRENT_NAME.test(segment.slice(nameEnd)) || COPULA_ON_NAME.test(name) || NAME_HISTORY_CUE.test(segment.slice(0, nameStart))) {
          withdrawn = true;
          continue;
        }
        return { value: name.slice(0, 40), clause: segment };
      }
    }
  }
  return withdrawn ? { withdrawn: true } : null;
}

/** For callers outside the writer (the chat identity guard): the same reading of one user statement. */
export function readAyasIdentityStatement(text: string): AyasIdentityReading {
  return identityEvidence(text, ["kimlik"]);
}

const SHORT_CUE = /\b(kisa|oz|ozet)\b/;
const LONG_CUE = /\b(uzun|detayli|ayrintili)\b/;
/** "kısa değil", "kısa cevap verme", "uzun tutma" — a negated cue states no length. */
const NEGATED_LENGTH = /\b(?:kisa|oz|ozet|uzun|detayli|ayrintili)\s+(?:degil\w*|(?:[a-z]+\s+)?[a-z]+m[ae](?:yin|yiniz|sin)?\b)/g;

/**
 * The slot a statement fills, from its content, and the segment that fills
 * it. Same shapes the v1 conflict check recognised (identity name,
 * response/voice length). Wording similarity alone never creates a key. A
 * length stated as past ("eskiden kısa cevap istiyordum, artık uzun") yields
 * to the present one; within the chosen text "short" wins, as in v1.
 */
function deriveFactEvidence(input: {
  readonly kind: BrainMemoryKind;
  readonly body: string;
  readonly tags: readonly string[];
}): { fact: AyasMemoryFact; clause: string | null } | null {
  const identity = identityEvidence(input.body, input.tags);
  if (identity && "value" in identity) return { fact: { key: "user.identity.name", value: identity.value }, clause: identity.clause };
  // An identity statement fills only the identity slot — a withdrawn or unreadable one fills none.
  if (identity || input.tags.includes("kimlik") || input.kind !== "user-preference") return null;
  const whole = fold(`${input.body} ${input.tags.join(" ")}`);
  const segments = statementSegments(input.body).map((segment) => segment.replace(NEGATED_LENGTH, " "));
  const hasCue = (segment: string) => SHORT_CUE.test(segment) || LONG_CUE.test(segment);
  const present = segments.filter((segment) => hasCue(segment) && !PAST_STATE.test(segment) && !HISTORY_CUE.test(segment));
  const chosen = present.length > 0 ? present : segments.filter(hasCue);
  // Only a cue that survives negation counts: "uzun değil lütfen" states no length.
  const text = chosen.length > 0 ? chosen.join(" ") : fold(input.tags.join(" "));
  const polarity = SHORT_CUE.test(text) ? "short" : LONG_CUE.test(text) ? "long" : null;
  if (!polarity) return null;
  const key = /\b(ses|sesli|tts|voice)\b/.test(whole) ? "user.preference.voice-length" : "user.preference.response-length";
  const cue = polarity === "short" ? SHORT_CUE : LONG_CUE;
  return { fact: { key, value: polarity }, clause: chosen.find((segment) => cue.test(segment)) ?? null };
}

export function deriveAyasMemoryFact(input: {
  readonly kind: BrainMemoryKind;
  readonly body: string;
  readonly tags: readonly string[];
}): AyasMemoryFact | null {
  return deriveFactEvidence(input)?.fact ?? null;
}

/** v2 records carry the slot chosen at write time; legacy records derive it. */
export function ayasMemoryRecordFact(record: BrainMemoryRecord): AyasMemoryFact | null {
  if (record.temporal) {
    const { factKey, factValue } = record.temporal;
    return isAyasMemoryFactKey(factKey) && typeof factValue === "string" ? { key: factKey, value: factValue } : null;
  }
  return deriveAyasMemoryFact(record);
}

/* ------------------------------------------------------------------ */
/* Provenance, trust, injection                                         */
/* ------------------------------------------------------------------ */

export function ayasMemoryProvenance(record: BrainMemoryRecord): BrainMemoryProvenance {
  if (record.temporal) return record.temporal.provenance;
  if (record.confidence === "observed") return "system-observation";
  if (record.confidence === "inferred") return "conversation-derived";
  return USER_STATEMENT_TITLES.has(record.title) ? "direct-user-statement" : "imported-history";
}

/** reported (user) > observed (system) > inferred (AYAS) — unchanged from v1. */
export function ayasMemoryTrustRank(record: BrainMemoryRecord): number {
  return record.confidence === "reported" ? 2 : record.confidence === "observed" ? 1 : 0;
}

export function containsAyasMemoryInstructionInjection(record: BrainMemoryRecord): boolean {
  const value = fold(record.body);
  return /\b(?:onceki|tum|sistem|gelistirici|developer)\s+(?:talimatlari|kurallari|mesaji|promptu)\s+(?:yok say|unut|gormezden gel|ez)\b/.test(value) ||
    /\b(?:system prompt|developer message|ignore previous instructions)\b/.test(value);
}

/**
 * Only a direct user statement may move an exclusive slot to a new value. For
 * a legacy identity record that means the explicit identity declaration shape
 * (the v1 newest-wins guard); web-shaped or inferred text never qualifies.
 */
function isAuthoritative(record: BrainMemoryRecord): boolean {
  const provenance = ayasMemoryProvenance(record);
  if (provenance !== "direct-user-statement" && provenance !== "explicit-correction") return false;
  if (record.confidence !== "reported") return false;
  if (!record.temporal && record.tags.includes("kimlik") && record.title !== IDENTITY_TITLE) return false;
  return !containsAyasMemoryInstructionInjection(record);
}

/* ------------------------------------------------------------------ */
/* Calendar periods (UTC)                                               */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;

function periodEnd(ms: number, precision: BrainMemoryTemporalPrecision): number {
  const date = new Date(ms);
  if (precision === "instant") return ms;
  if (precision === "day") return ms + DAY_MS;
  if (precision === "month") return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return Date.UTC(date.getUTCFullYear() + 1, 0, 1);
}

function periodStartBefore(ms: number, precision: BrainMemoryTemporalPrecision): number {
  const date = new Date(ms);
  if (precision === "instant") return ms;
  if (precision === "day") return ms - DAY_MS;
  if (precision === "month") return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1);
  return Date.UTC(date.getUTCFullYear() - 1, 0, 1);
}

function isoInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}

/* ------------------------------------------------------------------ */
/* Temporal view                                                        */
/* ------------------------------------------------------------------ */

/**
 * Lifecycle state as of now (or as of `knownAt`, when the caller asks what
 * was known then):
 *  - current     believed true now
 *  - superseded  an exclusive slot has since moved to another value
 *  - historical  stated as past, or its known end has passed
 *  - future      stated as an intent/plan; never auto-activated
 *  - disputed    equally strong competing values with no defensible order
 *  - conflicting a weaker source disagrees with the trusted value
 *  - invalid     malformed temporal block — never trusted
 */
export type AyasMemoryTemporalState =
  | "current"
  | "superseded"
  | "historical"
  | "future"
  | "disputed"
  | "conflicting"
  | "invalid";

/** Whether the fact held during the as-of window. */
export type AyasMemoryTemporalCertainty = "certain" | "possible" | "none";

export interface AyasMemoryTemporalView {
  readonly legacy: boolean;
  readonly assertion: BrainMemoryTemporalAssertion;
  readonly provenance: BrainMemoryProvenance;
  readonly recordedAt: string;
  readonly effectiveFrom?: string;
  readonly effectiveUntil?: string;
  readonly heldFrom?: string;
  readonly heldUntil?: string;
  readonly effectivePrecision?: BrainMemoryTemporalPrecision;
  readonly fact: AyasMemoryFact | null;
  readonly state: AyasMemoryTemporalState;
  /** Derived: when the next version of the slot was first observed. */
  readonly supersededAt?: string;
  readonly supersededBy?: string;
  /** An explicit start earlier than the previous version's observation was clamped after it. */
  readonly startClamped?: boolean;
  /** Present only for as-of queries. */
  readonly asOf?: AyasMemoryTemporalCertainty;
}

export type AyasMemoryTemporalQuery =
  | { readonly mode: "current"; readonly includeHistory?: boolean }
  | { readonly mode: "as-of"; readonly at: string; readonly until?: string; readonly knownAt?: string };

export interface AyasMemoryTemporalResolution {
  readonly views: ReadonlyMap<string, AyasMemoryTemporalView>;
  /** `true` when an as-of query was malformed; nothing may then be selected (current state is never a substitute). */
  readonly invalidQuery: boolean;
}

interface Bounds {
  sLo: number;
  sHi: number;
  eLo: number;
  eHi: number;
  clamped: boolean;
}

/** Bounds on the fact's true interval [s, e): s ∈ [sLo, sHi], e ∈ [eLo, eHi]. */
function baseBounds(record: BrainMemoryRecord, beliefMs: number): Bounds {
  const observed = Date.parse(record.observedAt);
  const t = record.temporal;
  const assertion = t?.assertion ?? "current";
  const precision = t?.effectivePrecision ?? "instant";
  const from = t?.effectiveFrom !== undefined ? Date.parse(t.effectiveFrom) : null;
  const until = t?.effectiveUntil !== undefined ? Date.parse(t.effectiveUntil) : null;
  const b: Bounds = { sLo: -Infinity, sHi: Infinity, eLo: -Infinity, eHi: Infinity, clamped: false };

  if (assertion === "current") {
    // Asserted true at `observed`, and believed to persist until something changes it.
    b.sHi = from !== null ? Math.min(periodEnd(from, precision), observed) : observed;
    b.sLo = from !== null ? Math.min(from, b.sHi) : -Infinity;
    b.eHi = until !== null ? until : Infinity;
    b.eLo = until !== null ? Math.min(periodStartBefore(until, precision), until) : Math.max(observed, beliefMs);
  } else if (assertion === "historical") {
    // Stated as past: it no longer held when it was said.
    b.eHi = until !== null ? Math.min(until, observed) : observed;
    b.sLo = from !== null ? from : -Infinity;
    b.sHi = from !== null ? Math.min(periodEnd(from, precision), b.eHi) : b.eHi;
    b.eLo = until !== null ? Math.min(periodStartBefore(until, precision), b.eHi) : b.sLo;
  } else {
    // Future intent: it did not hold yet when it was said.
    b.sLo = from !== null ? Math.max(from, observed) : observed;
    b.sHi = from !== null ? Math.max(periodEnd(from, precision), b.sLo) : Infinity;
    b.eHi = until !== null ? until : Infinity;
    b.eLo = until !== null ? Math.max(periodStartBefore(until, precision), b.sLo) : b.sLo;
  }
  // A named period in which it held: it began before the period ended and
  // ended after the period began — nothing more.
  if (t?.heldFrom !== undefined && t.heldUntil !== undefined) {
    b.sHi = Math.min(b.sHi, Date.parse(t.heldUntil));
    b.eLo = Math.max(b.eLo, Date.parse(t.heldFrom));
  }
  return b;
}

/**
 * Window [from, until). `sHi`/`eLo` are period boundaries or observations the
 * fact is known to span, so touching the window edge still counts as held.
 */
function certaintyFor(bounds: Bounds, windowFrom: number, windowUntil: number): AyasMemoryTemporalCertainty {
  if (bounds.sHi <= windowUntil && bounds.eLo >= windowFrom) return "certain";
  if (bounds.sLo < windowUntil && bounds.eHi > windowFrom) return "possible";
  return "none";
}

interface NormalizedQuery {
  readonly mode: "current" | "as-of";
  readonly includeHistory: boolean;
  readonly windowFrom: number;
  readonly windowUntil: number;
  readonly beliefMs: number;
  readonly invalid: boolean;
}

function normalizeQuery(query: AyasMemoryTemporalQuery | undefined, nowMs: number): NormalizedQuery {
  if (!query || query.mode === "current") {
    return { mode: "current", includeHistory: query?.includeHistory === true, windowFrom: nowMs, windowUntil: nowMs + 1, beliefMs: nowMs, invalid: false };
  }
  const at = isoInstant(query.at);
  const until = query.until === undefined ? null : isoInstant(query.until);
  const knownAt = query.knownAt === undefined ? null : isoInstant(query.knownAt);
  const invalid =
    at === null ||
    (query.until !== undefined && (until === null || until <= at)) ||
    (query.knownAt !== undefined && knownAt === null);
  const from = at ?? nowMs;
  return {
    mode: "as-of",
    includeHistory: false,
    windowFrom: from,
    windowUntil: until ?? from + 1,
    beliefMs: knownAt !== null ? Math.min(knownAt, nowMs) : nowMs,
    invalid,
  };
}

/** Records the query may see: for `knownAt`, only what had been observed and written by then. */
export function isAyasMemoryKnownAt(record: BrainMemoryRecord, query: AyasMemoryTemporalQuery | undefined): boolean {
  if (!query || query.mode !== "as-of" || query.knownAt === undefined) return true;
  const knownAt = isoInstant(query.knownAt);
  if (knownAt === null) return false;
  const recordedAt = record.temporal ? Date.parse(record.temporal.recordedAt) : Date.parse(record.observedAt);
  return Date.parse(record.observedAt) <= knownAt && recordedAt <= knownAt;
}

/** A run of consecutive observations of one value; `observedMs` is its LAST observation. */
interface Version {
  records: BrainMemoryRecord[];
  values: Set<string>;
  observedMs: number;
}

/**
 * Resolve the temporal view of every record. Rules, in order:
 *  1. malformed temporal metadata, future observation and instruction-shaped
 *     text never take part in resolution;
 *  2. historical and future statements are evaluated on their own intervals;
 *  3. in an exclusive slot the strongest source class wins (reported >
 *     observed > inferred); a weaker disagreeing value is `conflicting`;
 *  4. among the strongest, direct user statements form a version chain in
 *     observation order — each new value supersedes the previous one;
 *  5. equally strong competing values with no usable order are `disputed`.
 */
export function resolveAyasMemoryTemporal(
  records: readonly BrainMemoryRecord[],
  options: { readonly nowIso: string; readonly query?: AyasMemoryTemporalQuery },
): AyasMemoryTemporalResolution {
  const nowMs = Date.parse(options.nowIso);
  const query = normalizeQuery(options.query, nowMs);
  const views = new Map<string, AyasMemoryTemporalView>();
  const bounds = new Map<string, Bounds>();
  const state = new Map<string, AyasMemoryTemporalState>();
  const superseded = new Map<string, { at: string; by: string }>();
  const groups = new Map<AyasMemoryFactKey, BrainMemoryRecord[]>();
  const facts = new Map<string, AyasMemoryFact | null>();

  for (const record of records) {
    const invalidTemporal =
      !isValidBrainMemoryTemporal(record) ||
      (record.temporal?.factKey !== undefined && !isAyasMemoryFactKey(record.temporal.factKey));
    if (invalidTemporal) {
      state.set(record.recordId, "invalid");
      continue;
    }
    bounds.set(record.recordId, baseBounds(record, query.beliefMs));
    const assertion = record.temporal?.assertion ?? "current";
    const fact = ayasMemoryRecordFact(record);
    facts.set(record.recordId, fact);
    const excluded =
      fact !== null &&
      (Date.parse(record.observedAt) > nowMs + FUTURE_TOLERANCE_MS || containsAyasMemoryInstructionInjection(record));
    if (assertion !== "current") {
      state.set(record.recordId, assertion === "historical" ? "historical" : "future");
    } else if (fact && !excluded) {
      const group = groups.get(fact.key) ?? [];
      group.push(record);
      groups.set(fact.key, group);
    } else {
      state.set(record.recordId, "current");
    }
  }

  for (const group of groups.values()) {
    const valueOf = (record: BrainMemoryRecord) => facts.get(record.recordId)!.value;
    const topTrust = Math.max(...group.map(ayasMemoryTrustRank));
    const top = group.filter((record) => ayasMemoryTrustRank(record) === topTrust);
    const topValues = new Set(top.map(valueOf));
    let resolved: string | null = null;

    if (topValues.size === 1) {
      resolved = [...topValues][0];
    } else {
      const chain = top
        .filter(isAuthoritative)
        .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt) || left.recordId.localeCompare(right.recordId));
      // Group by observation instant (a tie of different values stays one
      // disputed group), then merge consecutive single-value groups of the
      // same value into one version.
      const instants: Version[] = [];
      for (const record of chain) {
        const observedMs = Date.parse(record.observedAt);
        const last = instants.at(-1);
        if (last && last.observedMs === observedMs) {
          last.records.push(record);
          last.values.add(valueOf(record));
        } else {
          instants.push({ records: [record], values: new Set([valueOf(record)]), observedMs });
        }
      }
      const versions: Version[] = [];
      for (const instant of instants) {
        const last = versions.at(-1);
        const sameValue = last && last.values.size === 1 && instant.values.size === 1 && last.values.has([...instant.values][0]);
        if (last && sameValue) {
          last.records.push(...instant.records);
          last.observedMs = instant.observedMs;
        } else {
          versions.push(instant);
        }
      }
      const latest = versions.at(-1);
      if (latest && latest.values.size === 1) {
        resolved = [...latest.values][0];
        linkVersions(versions, bounds, state, superseded);
      }
    }

    for (const record of group) {
      if (state.has(record.recordId)) continue;
      if (resolved === null) {
        state.set(record.recordId, ayasMemoryTrustRank(record) === topTrust ? "disputed" : "conflicting");
      } else {
        state.set(record.recordId, valueOf(record) === resolved ? "current" : "conflicting");
      }
    }
  }

  for (const record of records) {
    const recordState = state.get(record.recordId) ?? "invalid";
    const recordBounds = bounds.get(record.recordId);
    // An explicit end that has already passed turns a current fact into history.
    const finalState = recordState === "current" && recordBounds && recordBounds.eHi <= query.beliefMs ? "historical" : recordState;
    const link = superseded.get(record.recordId);
    const t = record.temporal;
    views.set(record.recordId, {
      legacy: t === undefined,
      assertion: t?.assertion ?? "current",
      provenance: ayasMemoryProvenance(record),
      recordedAt: t?.recordedAt ?? record.observedAt,
      ...(t?.effectiveFrom !== undefined ? { effectiveFrom: t.effectiveFrom } : {}),
      ...(t?.effectiveUntil !== undefined ? { effectiveUntil: t.effectiveUntil } : {}),
      ...(t?.heldFrom !== undefined ? { heldFrom: t.heldFrom, heldUntil: t.heldUntil } : {}),
      ...(t?.effectivePrecision !== undefined ? { effectivePrecision: t.effectivePrecision } : {}),
      fact: facts.get(record.recordId) ?? null,
      state: finalState,
      ...(link ? { supersededAt: link.at, supersededBy: link.by } : {}),
      ...(recordBounds?.clamped ? { startClamped: true } : {}),
      ...(query.mode === "as-of"
        ? { asOf: asOfCertainty(finalState, recordBounds, query) }
        : {}),
    });
  }
  return { views, invalidQuery: query.invalid };
}

function asOfCertainty(
  state: AyasMemoryTemporalState,
  bounds: Bounds | undefined,
  query: NormalizedQuery,
): AyasMemoryTemporalCertainty {
  if (!bounds || query.invalid || state === "invalid" || state === "disputed" || state === "conflicting") return "none";
  const certainty = certaintyFor(bounds, query.windowFrom, query.windowUntil);
  // An intent is never proof that the plan happened.
  return state === "future" && certainty === "certain" ? "possible" : certainty;
}

/** Close each version's interval at the next version's start; mark older versions superseded. */
function linkVersions(
  versions: readonly Version[],
  bounds: Map<string, Bounds>,
  state: Map<string, AyasMemoryTemporalState>,
  superseded: Map<string, { at: string; by: string }>,
): void {
  const merged = versions.map((version) => {
    const own = version.records.map((record) => bounds.get(record.recordId)!);
    return {
      version,
      sLo: Math.min(...own.map((b) => b.sLo)),
      sHi: Math.min(...own.map((b) => b.sHi)),
      eLo: Math.max(...own.map((b) => b.eLo)),
      eHi: Math.min(...own.map((b) => b.eHi)),
      clamped: false,
    };
  });
  for (let index = 1; index < merged.length; index += 1) {
    const previous = merged[index - 1];
    const next = merged[index];
    // The previous value was asserted at its last observation; the change came
    // after it. An explicit earlier start contradicts that observation and is
    // clamped (reported), never allowed to rewrite what was observed.
    if (next.sLo < previous.version.observedMs) {
      if (Number.isFinite(next.sLo)) next.clamped = true;
      next.sLo = previous.version.observedMs;
    }
    next.sHi = Math.max(next.sHi, next.sLo);
    // The old value ended exactly when the new one started.
    previous.eHi = Math.min(previous.eHi, next.sHi);
    previous.eLo = Math.min(next.sLo, previous.eHi);
  }
  merged.forEach((entry, index) => {
    const next = merged[index + 1];
    for (const record of entry.version.records) {
      bounds.set(record.recordId, { sLo: entry.sLo, sHi: entry.sHi, eLo: entry.eLo, eHi: entry.eHi, clamped: entry.clamped });
      if (next) {
        state.set(record.recordId, entry.version.values.size === 1 ? "superseded" : "disputed");
        const first = next.version.records[0];
        superseded.set(record.recordId, { at: first.observedAt, by: first.recordId });
      } else {
        state.set(record.recordId, "current");
      }
    }
  });
}

/**
 * Records that hold the current value of an exclusive slot — only among
 * records recall could ever surface (not expired, not future-observed, not
 * instruction-shaped), so a quarantined or expired record never counts.
 */
export function currentAyasMemoryFactRecords(records: readonly BrainMemoryRecord[], nowIso: string): BrainMemoryRecord[] {
  const nowMs = Date.parse(nowIso);
  const eligible = records.filter((record) =>
    ayasMemoryRecordFact(record) !== null &&
    (record.importance === "pinned" || !record.expiresAt || Date.parse(record.expiresAt) > nowMs) &&
    Date.parse(record.observedAt) <= nowMs + FUTURE_TOLERANCE_MS &&
    !containsAyasMemoryInstructionInjection(record),
  );
  if (eligible.length === 0) return [];
  const { views } = resolveAyasMemoryTemporal(eligible, { nowIso });
  return eligible.filter((record) => views.get(record.recordId)?.state === "current");
}

/**
 * The current value of one slot in a record set, and the strongest trust
 * behind it — `null` when the slot is empty or disputed. A read-side helper
 * for diagnostics and tests; the store itself only dedupes exact duplicates
 * (by content fingerprint) and lets the resolver merge same-value restatements.
 */
export function currentAyasMemoryFactValue(
  records: readonly BrainMemoryRecord[],
  key: AyasMemoryFactKey,
  nowIso: string,
): { readonly value: string; readonly trust: number } | null {
  const keyed = records.filter((record) => ayasMemoryRecordFact(record)?.key === key);
  const current = currentAyasMemoryFactRecords(keyed, nowIso);
  const values = new Set(current.map((record) => ayasMemoryRecordFact(record)!.value));
  if (values.size !== 1) return null;
  return { value: [...values][0], trust: Math.max(...current.map(ayasMemoryTrustRank)) };
}

/* ------------------------------------------------------------------ */
/* Write side: classify a user statement                                */
/* ------------------------------------------------------------------ */

const MONTHS = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];
const MONTH_PATTERN = `(${MONTHS.join("|")})`;

/**
 * Past-tense evidence, deliberately narrow: past continuous, pluperfect, "was"
 * forms and first-person past ("-dım/-tım", "-dık/-tık"). The past suffix
 * takes -t- only after a voiceless consonant, so "kritik", "pratik",
 * "otomatik", "artık" and "mantık" are not verbs. A noun with a possessive
 * ending ("adım", "yardım", "kendim") and loanwords in "-stik"/"-ptik" still
 * look like past verbs, so those are listed.
 */
const PAST_FORM = /(?:yordu(?:m|n|k|nuz)?|m[iu]st[iu](?:m|n|k|niz|nuz)?)\b|\b(?:idi[mnk]?|iken|vardi|yoktu|neydi|nasildi|kimdi)\b|\b[a-z]{3,}y(?:di|du)[mnk]?\b/;
const FIRST_PERSON_PAST = /\b[a-z]*(?:[cfhkpst]t|[abdegijlmnoruvyz]d)[iu][mk]\b/g;
const NOT_PAST = new Set(["adim", "yardim", "kendim", "plastik", "lojistik", "istatistik", "fantastik", "elastik", "mistik", "optik"]);

/** Any past tense — enough for a QUESTION about the past ("ne karar verdik?"). */
function hasPastVerb(value: string): boolean {
  if (PAST_FORM.test(value)) return true;
  return (value.match(FIRST_PERSON_PAST) ?? []).some((word) => !NOT_PAST.has(word));
}

/**
 * A past STATE — past continuous, "was", pluperfect — says something no longer
 * holds ("İzmir'de yaşıyordum"). A completed past event does not: after
 * "taşındım" or "karar verdik" the result still holds, so it stays current.
 * Folding splits a proper noun's copula off at the apostrophe ("İzmir'deydim"
 * → "izmir deydim", "Ali'ydi" → "ali ydi", "Ahmet'ti" → "ahmet ti").
 */
const PAST_STATE = /(?:yordu(?:m|n|k|nuz)?|m[iu]st[iu](?:m|n|k|niz|nuz)?)\b|\b(?:idi[mnk]?|iken|vardi|yoktu)\b|\b[a-z]{3,}y(?:di|du)[mnk]?\b|\b(?:de|da|te|ta)y(?:di|du)[mnk]?\b|\by(?:di|du)[mnk]?\b|\b[dt][iu]\b/;
const HISTORY_CUE = /\b(?:eskiden|onceden|bir zamanlar|daha once|gecen (?:yil|sene|ay)|o zamanlar|gecmiste)\b/;
const CURRENT_CUE = /\b(?:artik|simdi|su an|su anda|halen|hala|bundan sonra|bugunden itibaren|su andan itibaren)\b/;
const FROM_NOW_CUE = /\b(?:bundan sonra|bugunden itibaren|su andan itibaren)\b/;
const FUTURE_CUE = /\b(?:gelecek (?:ay|hafta|yil|sene)|haftaya|seneye|yakinda|ileride|onumuzdeki (?:ay|hafta|yil|sene)|yarindan itibaren)\b/;
const CORRECTION_CUE = /\b(?:artik|yanlis|duzelt\w*|aslinda|yerine|degistir\w*|degisti)\b/;

/** A future-tense verb — the word "gelecek" ("next") itself is the cue, not a verb. */
function hasFutureVerb(value: string): boolean {
  return (value.match(/\b[a-z]*(?:acag|eceg|acak|ecek)[a-z]*\b/g) ?? []).some((word) => !word.startsWith("gelecek"));
}

export interface AyasMemoryStatementTime {
  readonly assertion: BrainMemoryTemporalAssertion;
  readonly effectiveFrom?: string;
  readonly effectiveUntil?: string;
  readonly heldFrom?: string;
  readonly heldUntil?: string;
  readonly effectivePrecision?: BrainMemoryTemporalPrecision;
  readonly correction: boolean;
}

/**
 * A calendar year needs year-shaped context — a case ending ("2024'te",
 * "2020'den"), "yılı/senesi", or a month beside it. "RTX 2000" and "Windows
 * 2019" are names, not years.
 */
const YEAR_FORMS = [
  /\b(19\d{2}|20\d{2})\s?(?:de|da|te|ta|den|dan|ten|tan|e|a|ye|ya|in|nin|un|nun)\b/,
  /\b(19\d{2}|20\d{2})\s+(?:yil|sene)\w*/,
  new RegExp(`\\b(?:${MONTHS.join("|")})\\s+(19\\d{2}|20\\d{2})\\b`),
  new RegExp(`\\b(19\\d{2}|20\\d{2})\\s+(?:${MONTHS.join("|")})\\b`),
];

/** A number right after a product or version word is a model number, whatever suffix follows ("RTX 2000'de"). */
const PRODUCT_BEFORE_NUMBER = /\b(?:rtx|gtx|gt|rx|quadro|radeon|windows|win|office|server|sql|iphone|galaxy|model|seri|serisi|versiyon|surum|v)\s*$/;

function yearOf(text: string): number | null {
  for (const form of YEAR_FORMS) {
    const match = text.match(form);
    if (match && !PRODUCT_BEFORE_NUMBER.test(text.slice(0, match.index! + match[0].indexOf(match[1])))) return Number(match[1]);
  }
  return null;
}

/** Most recent occurrence of a month not after `now` (UTC). */
function monthStart(monthIndex: number, nowMs: number, year: number | null): number {
  const now = new Date(nowMs);
  const resolvedYear = year ?? (monthIndex <= now.getUTCMonth() ? now.getUTCFullYear() : now.getUTCFullYear() - 1);
  return Date.UTC(resolvedYear, monthIndex, 1);
}

/**
 * Several month names are also ordinary words ("aralık" interval, "ocak"
 * stove, "ekim" sowing, "nişan" engagement, "Kasım" a name), so a month needs
 * month-shaped context: a locative/ablative ending ("haziranda", "eylülden"),
 * "ayı" ("ocak ayında"), a year or day next to it ("Ocak 2025", "15 Ocak"),
 * or "... önce" ("eylül değişikliğinden önce"). A bare "aralık" is not December.
 */
const MONTH_FORMS = [
  new RegExp(`\\b${MONTH_PATTERN}\\s?(?:da|de|ta|te|dan|den|tan|ten)\\b`),
  new RegExp(`\\b${MONTH_PATTERN}\\s+ayi\\w*`),
  new RegExp(`\\b${MONTH_PATTERN}\\s+(?:19|20)\\d{2}\\b`),
  new RegExp(`\\b(?:\\d{1,2}|(?:19|20)\\d{2})\\s+${MONTH_PATTERN}\\b`),
  new RegExp(`\\b${MONTH_PATTERN}\\s+\\S+(?:\\s+\\S+)?\\s+once\\w*\\b`),
];

function monthIndexIn(text: string): number | null {
  for (const form of MONTH_FORMS) {
    const match = text.match(form);
    if (match) return MONTHS.indexOf(match[1]);
  }
  return null;
}

/** `neutral`: a past state with no time anchor — compatible with a historical message, never historical alone. */
type ClauseTime = Omit<AyasMemoryStatementTime, "correction" | "assertion"> & {
  readonly assertion: BrainMemoryTemporalAssertion | "neutral";
};

function classifyClause(value: string, nowMs: number): ClauseTime {
  const year = yearOf(value);
  const month = monthIndexIn(value);
  const current = CURRENT_CUE.test(value);

  if (!current && FUTURE_CUE.test(value) && hasFutureVerb(value)) {
    if (/\b(?:gelecek|onumuzdeki) ay\w*/.test(value)) {
      const now = new Date(nowMs);
      const from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
      return { assertion: "future", effectiveFrom: new Date(from).toISOString(), effectivePrecision: "month" };
    }
    return { assertion: "future" };
  }

  const sinceMatch = new RegExp(`\\b(?:${MONTH_PATTERN}|(19\\d{2}|20\\d{2}))(?:\\s*ayin)?\\s*(?:dan|den|tan|ten)\\s+(?:beri|itibaren)\\b`).exec(value);
  // "Windows 2019'dan beri" is a product, not a date.
  const since = sinceMatch && !(sinceMatch[2] && PRODUCT_BEFORE_NUMBER.test(value.slice(0, sinceMatch.index))) ? sinceMatch : null;
  const anchoredPast = HISTORY_CUE.test(value) || year !== null || month !== null;
  if (!current && !since && anchoredPast && PAST_STATE.test(value)) {
    if (/\bgecen (?:yil|sene)\b/.test(value)) return period("historical", Date.UTC(new Date(nowMs).getUTCFullYear() - 1, 0, 1), "year");
    if (/\bgecen ay\b/.test(value)) {
      const now = new Date(nowMs);
      return period("historical", Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1), "month");
    }
    // A named period that has not begun yet ("Aralık 2026'da … yapıyordum" said in September) dates nothing.
    const start = month !== null ? monthStart(month, nowMs, year) : year !== null ? Date.UTC(year, 0, 1) : null;
    if (start !== null && start <= nowMs) return period("historical", start, month !== null ? "month" : "year");
    return { assertion: "historical" };
  }

  if (since) {
    const sinceMonth = since[1] ? MONTHS.indexOf(since[1]) : null;
    const from = sinceMonth !== null ? monthStart(sinceMonth, nowMs, year) : Date.UTC(Number(since[2]), 0, 1);
    if (from <= nowMs) {
      return { assertion: "current", effectiveFrom: new Date(from).toISOString(), effectivePrecision: sinceMonth !== null ? "month" : "year" };
    }
  }
  if (FROM_NOW_CUE.test(value)) {
    return { assertion: "current", effectiveFrom: new Date(nowMs).toISOString(), effectivePrecision: "instant" };
  }
  return { assertion: !current && PAST_STATE.test(value) ? "neutral" : "current" };
}

/**
 * Deterministic, conservative classification of the time a statement speaks
 * about. Only explicit wording produces dates; everything else stays unknown.
 * Each clause is read on its own, and a message is historical (or future)
 * only when EVERY clause is — "Adım Ahmet, 2020'de taşındım" keeps the name
 * current. A decision is a present commitment whatever its tense.
 */
export function classifyAyasMemoryStatement(text: string, kind: BrainMemoryKind, nowIso: string): AyasMemoryStatementTime {
  const nowMs = Date.parse(nowIso);
  const correction = CORRECTION_CUE.test(fold(text));
  const clauses = String(text ?? "")
    .split(/[,.;!?\n]+/)
    .map(fold)
    .filter((clause) => clause.trim().length > 0)
    .map((clause) => classifyClause(clause, nowMs));
  const decisive = clauses.filter((clause) => clause.assertion !== "neutral");
  const kinds = new Set(decisive.map((clause) => clause.assertion));
  if (kind !== "decision" && kinds.size === 1 && !kinds.has("current")) {
    const dated = decisive.find((clause) => clause.effectiveFrom !== undefined || clause.heldFrom !== undefined) ?? decisive[0];
    return { ...dated, assertion: dated.assertion as BrainMemoryTemporalAssertion, correction };
  }
  const dated = decisive.find((clause) => clause.assertion === "current" && clause.effectiveFrom !== undefined);
  return { assertion: "current", ...(dated ? { effectiveFrom: dated.effectiveFrom, effectivePrecision: dated.effectivePrecision } : {}), correction };
}

/**
 * "2024'te İzmir'de yaşıyordum" says it held at some point in 2024 — not that
 * it began or ended in 2024. Only the named period is recorded.
 */
function period(assertion: "historical", fromMs: number, precision: BrainMemoryTemporalPrecision): ClauseTime {
  return {
    assertion,
    heldFrom: new Date(fromMs).toISOString(),
    heldUntil: new Date(periodEnd(fromMs, precision)).toISOString(),
    effectivePrecision: precision,
  };
}

/** The temporal block for a chat-extracted candidate. */
export function buildAyasMemoryTemporalInput(input: {
  readonly kind: BrainMemoryKind;
  readonly body: string;
  readonly tags: readonly string[];
  readonly source: "user-stated" | "user-decision" | "ayas-inferred";
  readonly userText: string;
  readonly nowIso: string;
}): BrainMemoryTemporalInput {
  const whole = classifyAyasMemoryStatement(input.userText, input.kind, input.nowIso);
  const evidence = deriveFactEvidence(input);
  // A slot's time is read from the clause that fills it: "Ocak'tan beri kısa
  // cevap tercih ederim, adım Ahmet" dates the preference, never the name.
  // Whether the message corrects something is a property of the whole turn.
  const time = evidence?.clause ? classifyAyasMemoryStatement(evidence.clause, input.kind, input.nowIso) : whole;
  const provenance: BrainMemoryProvenance =
    input.source === "ayas-inferred" ? "conversation-derived" : whole.correction ? "explicit-correction" : "direct-user-statement";
  return {
    assertion: time.assertion,
    provenance,
    recordedAt: input.nowIso,
    ...(time.effectiveFrom !== undefined ? { effectiveFrom: time.effectiveFrom } : {}),
    ...(time.effectiveUntil !== undefined ? { effectiveUntil: time.effectiveUntil } : {}),
    ...(time.heldFrom !== undefined ? { heldFrom: time.heldFrom, heldUntil: time.heldUntil } : {}),
    ...(time.effectivePrecision !== undefined ? { effectivePrecision: time.effectivePrecision } : {}),
    ...(evidence ? { factKey: evidence.fact.key, factValue: evidence.fact.value } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Read side: what time a question asks about                           */
/* ------------------------------------------------------------------ */

const KNOWLEDGE_CUE = /\b(?:biliyordu[mnk]?|biliyor muydu[mnk]?|hatirliyordu[mnk]?|kayitliydi)\b/;
const HISTORY_QUESTION_CUE = /\b(?:eskiden|onceden|daha once|ilk basta|gecmiste|onceki|eski)\b/;
const QUESTION_WORD = /\b(?:ne|neydi|nedir|nasil|nasildi|hangi|hangisi|hangisiydi|kim|kimdi|nerede|neredeydi|niye|neden|mi|mu|miydi|muydu|misin|musun|miyim|muyum)\b/;

/**
 * Chat stays simple: a turn is only temporal when ONE clause names a month or
 * a year, speaks in the past AND asks something ("Haziran'da planım neydi?"),
 * or asks what it used to be ("Eskiden adım neydi?"). A past statement next
 * to an unrelated question ("2020'de taşındım, adımı hatırlıyor musun?") stays
 * current recall.
 */
export function detectAyasMemoryTemporalQuery(text: string, nowIso: string): AyasMemoryTemporalQuery {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return { mode: "current" };
  const clauses = String(text ?? "")
    .split(/[,.;!?\n]+/)
    .map(fold)
    // A clause that says "now" ("artık", "şimdi", "hâlâ") is about the present, whatever else it contains.
    .filter((clause) => clause.trim().length > 0 && QUESTION_WORD.test(clause) && !CURRENT_CUE.test(clause) && hasPastVerb(clause));

  for (const clause of clauses) {
    const year = yearOf(clause);
    const month = monthIndexIn(clause);
    if (month === null && year === null) continue;
    const from = month !== null ? monthStart(month, nowMs, year) : Date.UTC(year!, 0, 1);
    if (from > nowMs) continue;
    const knowledge = KNOWLEDGE_CUE.test(clause);
    if (new RegExp(`\\b(?:${MONTH_PATTERN}|19\\d{2}|20\\d{2})\\S*(?:\\s+\\S+){0,2}\\s+once\\w*\\b`).test(clause)) {
      const at = new Date(from - 1).toISOString();
      return { mode: "as-of", at, ...(knowledge ? { knownAt: at } : {}) };
    }
    const until = Math.min(periodEnd(from, month !== null ? "month" : "year"), nowMs + 1);
    return {
      mode: "as-of",
      at: new Date(from).toISOString(),
      until: new Date(until).toISOString(),
      ...(knowledge ? { knownAt: new Date(until - 1).toISOString() } : {}),
    };
  }
  if (clauses.some((clause) => HISTORY_QUESTION_CUE.test(clause))) return { mode: "current", includeHistory: true };
  return { mode: "current" };
}

/* ------------------------------------------------------------------ */
/* Safe, content-free annotation for historical context lines           */
/* ------------------------------------------------------------------ */

function formatBound(iso: string | undefined, precision: BrainMemoryTemporalPrecision | undefined): string {
  if (!iso) return "?";
  if (precision === "year") return iso.slice(0, 4);
  if (precision === "month") return iso.slice(0, 7);
  return iso.slice(0, 10);
}

/** Dates and a state label only — never content. `null` for a plain current-mode line (v1 format). */
export function formatAyasMemoryTemporalAnnotation(
  view: AyasMemoryTemporalView,
  observedAt: string,
  query: AyasMemoryTemporalQuery | undefined,
): string | null {
  const asOf = query?.mode === "as-of";
  const history = query?.mode === "current" && query.includeHistory === true;
  if (!asOf && !history) return null;
  const certainty = asOf ? (view.asOf === "certain" ? "o dönemde geçerli · " : "o dönemde geçerli olabilir, kesin değil · ") : "";
  const label = certainty + (
    view.state === "current" ? "güncel"
      : view.state === "superseded" ? "eski sürüm"
        : view.state === "historical" ? "geçmiş bilgi"
          : "plan/niyet, teyit edilmedi");
  // Only an explicit end or a derived supersession closes the interval; otherwise it is open or unknown.
  const until = view.effectiveUntil
    ? formatBound(view.effectiveUntil, view.effectivePrecision)
    : view.supersededAt
      ? `en geç ${view.supersededAt.slice(0, 10)}`
      : view.state === "current" ? "sürüyor" : "?";
  const from = view.assertion === "current" && !view.effectiveFrom
    ? `? (en geç ${observedAt.slice(0, 10)})`
    : formatBound(view.effectiveFrom, view.effectivePrecision);
  const named = view.heldFrom ? ` · dönem ${formatBound(view.heldFrom, view.effectivePrecision)}` : "";
  return `${label} · kayıt ${observedAt.slice(0, 10)} · geçerlilik ${from} → ${until}${named}`;
}
