/**
 * Memory Temporal v2 — deterministic ground-truth cases.
 *
 * Built for the NEXT roadmap stage (Retrieval Evaluation): each case lists a
 * set of memory records, one query with its time, and the temporal outcome
 * that is known to be correct. There is no scoring here — `smoke-ayas-memory-
 * temporal.ts` only proves every case holds against the current resolver.
 *
 * Synthetic data only. Relative imports only (scripts may run from any cwd).
 */

import type { BrainMemoryRecordInput, BrainMemoryTemporalInput } from "../../src/types/brainMemory";
import type {
  AyasMemoryTemporalCertainty,
  AyasMemoryTemporalQuery,
  AyasMemoryTemporalState,
} from "../../src/lib/ayas/memory/AyasMemoryTemporal";

export type AyasMemoryTemporalCaseCategory =
  | "recency-change"
  | "correction"
  | "historical-fact"
  | "future-intent"
  | "contradiction"
  | "identity-preference-change"
  | "project-decision-change";

export interface AyasMemoryTemporalCaseRecord {
  readonly label: string;
  readonly input: BrainMemoryRecordInput;
}

export interface AyasMemoryTemporalCase {
  readonly id: string;
  readonly category: AyasMemoryTemporalCaseCategory;
  readonly description: string;
  readonly nowIso: string;
  readonly records: readonly AyasMemoryTemporalCaseRecord[];
  readonly query: { readonly text: string; readonly temporal?: AyasMemoryTemporalQuery };
  /** Lifecycle state per record label, as of `nowIso` (or `knownAt`). */
  readonly expectedStates: Readonly<Record<string, AyasMemoryTemporalState>>;
  /** Labels that must be selected for the query (order-free). */
  readonly expectedSelected: readonly string[];
  /** As-of only: how certain each selected label is for the window. */
  readonly expectedCertainty?: Readonly<Record<string, AyasMemoryTemporalCertainty>>;
}

const NOW = "2026-09-23T12:00:00.000Z";
const JAN = "2026-01-15T09:00:00.000Z";
const AUG = "2026-08-10T09:00:00.000Z";
const SEP = "2026-09-02T09:00:00.000Z";

function temporal(observedAt: string, over: Partial<BrainMemoryTemporalInput> = {}): BrainMemoryTemporalInput {
  return { assertion: "current", provenance: "direct-user-statement", recordedAt: observedAt, ...over };
}

function identity(name: string, observedAt: string, over: Partial<BrainMemoryRecordInput> = {}): BrainMemoryRecordInput {
  return {
    kind: "user-preference",
    title: "Kullanıcı kimliği / hitap tercihi",
    body: `beni ${name} olarak hatırla`,
    importance: "durable",
    confidence: "reported",
    tags: ["kimlik"],
    observedAt,
    links: [],
    temporal: temporal(observedAt, { factKey: "user.identity.name", factValue: name.toLocaleLowerCase("tr") }),
    ...over,
  };
}

function preference(body: string, observedAt: string, factKey: string, factValue: string, over: Partial<BrainMemoryTemporalInput> = {}): BrainMemoryRecordInput {
  return {
    kind: "user-preference",
    title: "Kullanıcı tercihi",
    body,
    importance: "durable",
    confidence: "reported",
    tags: ["tercih"],
    observedAt,
    links: [],
    temporal: temporal(observedAt, { factKey, factValue, ...over }),
  };
}

function note(kind: BrainMemoryRecordInput["kind"], title: string, body: string, observedAt: string, over: Partial<BrainMemoryTemporalInput> = {}): BrainMemoryRecordInput {
  return {
    kind,
    title,
    body,
    importance: "durable",
    confidence: "reported",
    tags: [kind === "decision" ? "karar" : "ortam"],
    observedAt,
    links: [],
    temporal: temporal(observedAt, over),
  };
}

export const AYAS_MEMORY_TEMPORAL_CASES: readonly AyasMemoryTemporalCase[] = [
  {
    id: "recency-response-length",
    category: "recency-change",
    description: "A later explicit preference replaces the earlier one; both stay on record.",
    nowIso: NOW,
    records: [
      { label: "short", input: preference("bundan sonra cevapları kısa tut", JAN, "user.preference.response-length", "short") },
      { label: "long", input: preference("bundan sonra cevapları uzun ve detaylı yaz", SEP, "user.preference.response-length", "long", { provenance: "explicit-correction" }) },
    ],
    query: { text: "cevap uzunluğu tercihim ne" },
    expectedStates: { short: "superseded", long: "current" },
    expectedSelected: ["long"],
  },
  {
    id: "identity-correction-current",
    category: "correction",
    description: "An explicit identity correction supersedes the old name for current recall.",
    nowIso: NOW,
    records: [
      { label: "ahmet", input: identity("Ahmet", JAN) },
      { label: "mehmet", input: { ...identity("Mehmet", SEP), body: "yanlış yazdım, beni Mehmet olarak hatırla", temporal: temporal(SEP, { provenance: "explicit-correction", factKey: "user.identity.name", factValue: "mehmet" }) } },
    ],
    query: { text: "benim adım ne" },
    expectedStates: { ahmet: "superseded", mehmet: "current" },
    expectedSelected: ["mehmet"],
  },
  {
    id: "identity-as-of-january",
    category: "correction",
    description: "Asked about January: the old name held for certain; the change date is unknown, so the new name is only possible.",
    nowIso: NOW,
    records: [
      { label: "ahmet", input: identity("Ahmet", JAN) },
      { label: "mehmet", input: identity("Mehmet", SEP) },
    ],
    query: { text: "Ocak ayında adım neydi", temporal: { mode: "as-of", at: "2026-01-01T00:00:00.000Z", until: "2026-02-01T00:00:00.000Z" } },
    expectedStates: { ahmet: "superseded", mehmet: "current" },
    expectedSelected: ["ahmet", "mehmet"],
    expectedCertainty: { ahmet: "certain", mehmet: "possible" },
  },
  {
    id: "identity-known-at-january",
    category: "correction",
    description: "What was known at the end of January: only the old name existed, so it was current then.",
    nowIso: NOW,
    records: [
      { label: "ahmet", input: identity("Ahmet", JAN) },
      { label: "mehmet", input: identity("Mehmet", SEP) },
    ],
    query: { text: "Ocak sonunda adım ne olarak biliniyordu", temporal: { mode: "as-of", at: "2026-01-31T00:00:00.000Z", knownAt: "2026-01-31T00:00:00.000Z" } },
    expectedStates: { ahmet: "current" },
    expectedSelected: ["ahmet"],
    expectedCertainty: { ahmet: "certain" },
  },
  {
    id: "identity-as-of-after-change",
    category: "correction",
    description: "A point after the change sees only the new name.",
    nowIso: NOW,
    records: [
      { label: "ahmet", input: identity("Ahmet", JAN) },
      { label: "mehmet", input: identity("Mehmet", SEP) },
    ],
    query: { text: "adım neydi", temporal: { mode: "as-of", at: "2026-09-20T00:00:00.000Z" } },
    expectedStates: { ahmet: "superseded", mehmet: "current" },
    expectedSelected: ["mehmet"],
    expectedCertainty: { mehmet: "certain" },
  },
  {
    id: "historical-recorded-today",
    category: "historical-fact",
    description: "A past fact recorded recently is history, not current; it answers a question about its own year.",
    nowIso: NOW,
    records: [
      { label: "izmir2024", input: note("environment-note", "Çalışma ortamı bilgisi", "2024'te İzmir'de yaşıyordum ve orada çalışıyordum", "2026-09-20T09:00:00.000Z", { assertion: "historical", heldFrom: "2024-01-01T00:00:00.000Z", heldUntil: "2025-01-01T00:00:00.000Z", effectivePrecision: "year" }) },
    ],
    query: { text: "İzmir'de ne zaman yaşıyordum", temporal: { mode: "as-of", at: "2024-01-01T00:00:00.000Z", until: "2025-01-01T00:00:00.000Z" } },
    expectedStates: { izmir2024: "historical" },
    expectedSelected: ["izmir2024"],
    expectedCertainty: { izmir2024: "certain" },
  },
  {
    id: "historical-not-current",
    category: "historical-fact",
    description: "The same past fact never reaches current recall.",
    nowIso: NOW,
    records: [
      { label: "izmir2024", input: note("environment-note", "Çalışma ortamı bilgisi", "2024'te İzmir'de yaşıyordum ve orada çalışıyordum", "2026-09-20T09:00:00.000Z", { assertion: "historical", heldFrom: "2024-01-01T00:00:00.000Z", heldUntil: "2025-01-01T00:00:00.000Z", effectivePrecision: "year" }) },
    ],
    query: { text: "İzmir'de mi yaşıyorum" },
    expectedStates: { izmir2024: "historical" },
    expectedSelected: [],
  },
  {
    id: "future-intent-not-current",
    category: "future-intent",
    description: "A stated plan is never presented as a current fact.",
    nowIso: NOW,
    records: [
      { label: "move", input: note("environment-note", "Çalışma ortamı bilgisi", "gelecek ay yeni bilgisayarımı kuracağım ve ortamı taşıyacağım", "2026-09-20T09:00:00.000Z", { assertion: "future", effectiveFrom: "2026-10-01T00:00:00.000Z", effectivePrecision: "month" }) },
    ],
    query: { text: "bilgisayar ortamım ne durumda" },
    expectedStates: { move: "future" },
    expectedSelected: [],
  },
  {
    id: "future-intent-as-of-never-certain",
    category: "future-intent",
    description: "Even for a window after its planned start, a plan is only possible — never proof it happened.",
    nowIso: NOW,
    records: [
      { label: "move", input: note("environment-note", "Çalışma ortamı bilgisi", "gelecek ay yeni bilgisayarımı kuracağım ve ortamı taşıyacağım", "2026-09-20T09:00:00.000Z", { assertion: "future", effectiveFrom: "2026-10-01T00:00:00.000Z", effectivePrecision: "month" }) },
    ],
    query: { text: "bilgisayar ortamım", temporal: { mode: "as-of", at: "2026-11-01T00:00:00.000Z", until: "2026-12-01T00:00:00.000Z" } },
    expectedStates: { move: "future" },
    expectedSelected: ["move"],
    expectedCertainty: { move: "possible" },
  },
  {
    id: "same-instant-contradiction",
    category: "contradiction",
    description: "Two equally trusted values at the same instant have no defensible order: both disputed, neither recalled.",
    nowIso: NOW,
    records: [
      { label: "ahmet", input: identity("Ahmet", AUG) },
      { label: "mehmet", input: identity("Mehmet", AUG) },
    ],
    query: { text: "benim adım ne" },
    expectedStates: { ahmet: "disputed", mehmet: "disputed" },
    expectedSelected: [],
  },
  {
    id: "weaker-newer-source",
    category: "contradiction",
    description: "A newer inferred value never overrides the user's own statement.",
    nowIso: NOW,
    records: [
      { label: "ahmet", input: identity("Ahmet", AUG) },
      { label: "atlas", input: { ...identity("Atlas", SEP), title: "AYAS çıkarımı", confidence: "inferred", temporal: temporal(SEP, { provenance: "conversation-derived", factKey: "user.identity.name", factValue: "atlas" }) } },
    ],
    query: { text: "benim adım ne" },
    expectedStates: { ahmet: "current", atlas: "conflicting" },
    expectedSelected: ["ahmet"],
  },
  {
    id: "voice-length-change",
    category: "identity-preference-change",
    description: "A legacy (v1) preference is superseded by a later explicit v2 change.",
    nowIso: NOW,
    records: [
      { label: "shortLegacy", input: { kind: "user-preference", title: "Kullanıcı tercihi", body: "sesli yanıtları kısa tut", importance: "durable", confidence: "reported", tags: ["tercih"], observedAt: AUG, links: [] } },
      { label: "long", input: preference("artık sesli yanıtları uzun tut", SEP, "user.preference.voice-length", "long", { provenance: "explicit-correction" }) },
    ],
    query: { text: "sesli yanıt tercihim ne" },
    expectedStates: { shortLegacy: "superseded", long: "current" },
    expectedSelected: ["long"],
  },
  {
    id: "project-decision-free-text",
    category: "project-decision-change",
    description: "Free-text decisions have no exclusive slot: both stay current. This is the known gap Retrieval Evaluation must measure, not a resolver bug.",
    nowIso: NOW,
    records: [
      { label: "ffmpeg", input: note("decision", "Alınan karar", "render için FFmpeg kullanacağız", AUG) },
      { label: "remotion", input: note("decision", "Alınan karar", "artık render için Remotion kullanacağız", SEP, { provenance: "explicit-correction" }) },
    ],
    query: { text: "render için ne kullanacağız" },
    expectedStates: { ffmpeg: "current", remotion: "current" },
    expectedSelected: ["ffmpeg", "remotion"],
  },
];
