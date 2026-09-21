/**
 * Deterministic AYAS memory retrieval and reranking.
 *
 * The persistent record remains the authority. This module adds a read-time
 * decision envelope: provenance/trust, temporal freshness, lexical and concept
 * relevance, and conflict quarantine. It is pure and has no model/network IO.
 */

import { recallBrainMemory } from "@/lib/brain/BrainMemoryModel";
import type { BrainMemoryRecord } from "@/types/brainMemory";

export type AyasMemoryTrustClass = "user-reported" | "system-observed" | "ayas-inferred";
export type AyasMemoryFreshness = "fresh" | "aging" | "stale" | "pinned";
export type AyasMemoryConflictState = "clear" | "conflicting";

export interface AyasMemoryRetrievalDecision {
  readonly record: BrainMemoryRecord;
  readonly source: AyasMemoryTrustClass;
  readonly timestamp: string;
  readonly confidence: BrainMemoryRecord["confidence"];
  readonly trustClass: AyasMemoryTrustClass;
  readonly freshness: AyasMemoryFreshness;
  readonly conflictState: AyasMemoryConflictState;
  readonly lexicalScore: number;
  readonly conceptScore: number;
  readonly rerankScore: number;
  readonly quarantined: boolean;
  readonly quarantineReason?:
    | "conflicting-fact"
    | "future-timestamp"
    | "stale-fact"
    | "current-request-overrides-memory"
    | "memory-instruction-injection";
}

export interface AyasMemoryRetrievalResult {
  readonly selected: readonly AyasMemoryRetrievalDecision[];
  readonly quarantined: readonly AyasMemoryRetrievalDecision[];
  readonly droppedExpired: number;
  readonly droppedDuplicates: number;
}

const TOP_K = 4;
const RRF_K = 60;
const DAY_MS = 86_400_000;

const IMPORTANCE_WEIGHT: Readonly<Record<BrainMemoryRecord["importance"], number>> = {
  transient: 0,
  normal: 2,
  durable: 4,
  pinned: 6,
};

const TRUST_WEIGHT: Readonly<Record<AyasMemoryTrustClass, number>> = {
  "ayas-inferred": 0,
  "system-observed": 1,
  "user-reported": 2,
};

const FRESHNESS_WEIGHT: Readonly<Record<AyasMemoryFreshness, number>> = {
  stale: -1,
  aging: 0,
  fresh: 1,
  pinned: 1,
};

const STOPWORDS = new Set([
  "acaba", "ama", "bana", "ben", "beni", "benim", "bir", "bu", "icin", "ile", "mi", "mu",
  "nasıl", "nasil", "ne", "nedir", "olan", "olarak", "su", "şu", "ve", "veya", "yok",
  "the", "a", "an", "is", "to", "of",
]);

const SUFFIXES = [
  "larimiz", "lerimiz", "larınız", "leriniz", "lari", "leri", "dan", "den", "nin", "nın", "nun",
  "nün", "dir", "dır", "dur", "dür", "lik", "lık", "luk", "lük", "yi", "yı", "yu", "yü",
];

function fold(text: string): string {
  return String(text ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[İıI]/g, "i")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");
}

function stem(word: string): string {
  const suffix = SUFFIXES.find((candidate) => word.endsWith(candidate) && word.length - candidate.length >= 4);
  return suffix ? word.slice(0, -suffix.length) : word;
}

function tokenList(text: string): string[] {
  return fold(text)
    .split(/\s+/)
    .map(stem)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

function trustClass(record: BrainMemoryRecord): AyasMemoryTrustClass {
  if (record.confidence === "reported") return "user-reported";
  if (record.confidence === "observed") return "system-observed";
  return "ayas-inferred";
}

function freshness(record: BrainMemoryRecord, nowMs: number): AyasMemoryFreshness {
  if (record.importance === "pinned") return "pinned";
  const ageDays = Math.max(0, (nowMs - Date.parse(record.observedAt)) / DAY_MS);
  if (ageDays <= 30) return "fresh";
  if (ageDays <= 180) return "aging";
  return "stale";
}

function concepts(text: string, tags: readonly string[] = []): Set<string> {
  const value = fold(`${text} ${tags.join(" ")}`);
  const out = new Set<string>();
  if (/\b(adim|isim|ismim|kimim|kimlik|hitap)\b/.test(value)) out.add("identity");
  if (/\b(tercih|isterim|istemiyorum|kisa|uzun|varsayilan)\b/.test(value)) out.add("preference");
  if (/\b(proje|pipeline|stage|asama|sahne|render|ffmpeg)\b/.test(value)) out.add("project");
  if (/\b(hata|bug|bozuk|calismiyor|timeout|basarisiz)\b/.test(value)) out.add("problem");
  if (/\b(makine|bilgisayar|gpu|ortam|repo|kurulum)\b/.test(value)) out.add("environment");
  if (/\b(karar|kararlastir|anlastik|kullanacagiz)\b/.test(value)) out.add("decision");
  return out;
}

function identityValue(record: BrainMemoryRecord): string | null {
  if (!record.tags.includes("kimlik")) return null;
  const value = fold(record.body);
  const patterns = [
    /\bbeni\s+([a-z]{2,40})\s+olarak\b/,
    /\badim\s+([a-z]{2,40})\b/,
    /\bben\s+([a-z]{2,40})\s*(?:im|yim)\b/,
    /\bbana\s+([a-z]{2,40})\s+diye\b/,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

interface ConflictClaim {
  readonly domain: string;
  readonly value: string;
}

function conflictClaim(record: BrainMemoryRecord): ConflictClaim | null {
  const identity = identityValue(record);
  if (identity) return { domain: "identity", value: identity };
  if (record.kind !== "user-preference") return null;
  const value = fold(`${record.body} ${record.tags.join(" ")}`);
  const polarity = /\b(kisa|oz|ozet)\b/.test(value)
    ? "short"
    : /\b(uzun|detayli|ayrintili)\b/.test(value)
      ? "long"
      : null;
  if (!polarity) return null;
  const domain = /\b(ses|sesli|tts|voice)\b/.test(value) ? "voice-length" : "response-length";
  return { domain, value: polarity };
}

function conflictingRecordIds(records: readonly BrainMemoryRecord[]): Set<string> {
  const groups = new Map<string, { record: BrainMemoryRecord; claim: ConflictClaim }[]>();
  for (const record of records) {
    const claim = conflictClaim(record);
    if (!claim) continue;
    const group = groups.get(claim.domain) ?? [];
    group.push({ record, claim });
    groups.set(claim.domain, group);
  }

  const conflicts = new Set<string>();
  for (const group of groups.values()) {
    if (new Set(group.map((entry) => entry.claim.value)).size <= 1) continue;
    const topTrust = Math.max(...group.map((entry) => TRUST_WEIGHT[trustClass(entry.record)]));
    const topValues = new Set(
      group
        .filter((entry) => TRUST_WEIGHT[trustClass(entry.record)] === topTrust)
        .map((entry) => entry.claim.value),
    );
    if (topValues.size !== 1) {
      group.forEach((entry) => conflicts.add(entry.record.recordId));
      continue;
    }
    const trustedValue = [...topValues][0];
    group
      .filter((entry) => entry.claim.value !== trustedValue)
      .forEach((entry) => conflicts.add(entry.record.recordId));
  }
  return conflicts;
}

function containsInstructionInjection(record: BrainMemoryRecord): boolean {
  const value = fold(record.body);
  return /\b(?:onceki|tum|sistem|gelistirici|developer)\s+(?:talimatlari|kurallari|mesaji|promptu)\s+(?:yok say|unut|gormezden gel|ez)\b/.test(value) ||
    /\b(?:system prompt|developer message|ignore previous instructions)\b/.test(value);
}

function currentRequestOverrides(record: BrainMemoryRecord, query: string): boolean {
  if (record.kind !== "user-preference") return false;
  const current = fold(query);
  const remembered = fold(record.body);
  const isImmediateInstruction =
    /\b(bu sefer|bu kez|bu yanitta|simdi|simdilik)\b/.test(current) ||
    /\b(anlat|yaz|cevapla|tut)\b/.test(current);
  if (!isImmediateInstruction) return false;
  const asksShort = /\b(kisa|oz|ozet)\b/.test(current);
  const asksLong = /\b(uzun|detayli|ayrintili)\b/.test(current);
  const rememberedShort = /\b(kisa|oz|ozet)\b/.test(remembered);
  const rememberedLong = /\b(uzun|detayli|ayrintili)\b/.test(remembered);
  return (asksShort && rememberedLong) || (asksLong && rememberedShort);
}

function lexicalScores(records: readonly BrainMemoryRecord[], query: string): Map<string, number> {
  const queryTokens = [...new Set(tokenList(query))];
  const docs = records.map((record) => tokenList(`${record.title} ${record.body} ${record.tags.join(" ")}`));
  const averageLength = docs.length ? docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length : 1;
  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const token of new Set(doc)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const scores = new Map<string, number>();

  records.forEach((record, index) => {
    const doc = docs[index];
    const frequencies = new Map<string, number>();
    for (const token of doc) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    let score = 0;
    for (const token of queryTokens) {
      const tf = frequencies.get(token) ?? 0;
      if (tf === 0) continue;
      const containing = documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + (records.length - containing + 0.5) / (containing + 0.5));
      const denominator = tf + 1.2 * (0.25 + 0.75 * (doc.length / Math.max(1, averageLength)));
      score += idf * ((tf * 2.2) / denominator);
    }
    scores.set(record.recordId, score);
  });
  return scores;
}

function rankMap(values: readonly { id: string; score: number }[]): Map<string, number> {
  const ranked = [...values]
    .filter((value) => value.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  return new Map(ranked.map((value, index) => [value.id, index + 1]));
}

export function retrieveAyasMemory(
  records: readonly BrainMemoryRecord[],
  query: string,
  options: { readonly activeProject?: string; readonly nowIso?: string; readonly limit?: number } = {},
): AyasMemoryRetrievalResult {
  const effectiveNowIso = options.nowIso ?? new Date().toISOString();
  const recalled = recallBrainMemory(records, {}, effectiveNowIso);
  const seenFingerprints = new Set<string>();
  const candidates = recalled.records.filter((record) => {
    if (seenFingerprints.has(record.contentFingerprint)) return false;
    seenFingerprints.add(record.contentFingerprint);
    return true;
  });
  const nowMs = Date.parse(effectiveNowIso);
  const lexical = lexicalScores(candidates, query);
  const queryConcepts = concepts(query);
  const projectTokens = new Set(tokenList(options.activeProject ?? ""));

  const conceptValues = candidates.map((record) => {
    const recordConcepts = concepts(`${record.title} ${record.body}`, record.tags);
    let score = 0;
    for (const concept of queryConcepts) if (recordConcepts.has(concept)) score += 1;
    return { id: record.recordId, score };
  });
  const conceptScores = new Map(conceptValues.map((value) => [value.id, value.score]));
  const lexicalRanks = rankMap(candidates.map((record) => ({ id: record.recordId, score: lexical.get(record.recordId) ?? 0 })));
  const conceptRanks = rankMap(conceptValues);

  const conflictIds = conflictingRecordIds(candidates);

  const decisions = candidates.map((record): AyasMemoryRetrievalDecision => {
    const source = trustClass(record);
    const state = freshness(record, nowMs);
    const lexicalScore = lexical.get(record.recordId) ?? 0;
    const conceptScore = conceptScores.get(record.recordId) ?? 0;
    const documentTokens = new Set(tokenList(`${record.title} ${record.body} ${record.tags.join(" ")}`));
    let projectScore = 0;
    for (const token of projectTokens) if (documentTokens.has(token)) projectScore += 2;
    const reciprocalRank =
      (lexicalRanks.has(record.recordId) ? 1 / (RRF_K + lexicalRanks.get(record.recordId)!) : 0) +
      (conceptRanks.has(record.recordId) ? 1 / (RRF_K + conceptRanks.get(record.recordId)!) : 0);
    const isConflict = conflictIds.has(record.recordId);
    const isFuture = Date.parse(record.observedAt) > nowMs + 5 * 60_000;
    const isStale = state === "stale";
    const overridden = currentRequestOverrides(record, query);
    const instructionInjection = containsInstructionInjection(record);
    const quarantined = isConflict || isFuture || isStale || overridden || instructionInjection;
    const rerankScore =
      IMPORTANCE_WEIGHT[record.importance] +
      TRUST_WEIGHT[source] +
      FRESHNESS_WEIGHT[state] +
      projectScore +
      lexicalScore * 2 +
      conceptScore * 2 +
      reciprocalRank * RRF_K;
    return {
      record,
      source,
      timestamp: record.observedAt,
      confidence: record.confidence,
      trustClass: source,
      freshness: state,
      conflictState: isConflict ? "conflicting" : "clear",
      lexicalScore,
      conceptScore,
      rerankScore,
      quarantined,
      ...(isConflict
        ? { quarantineReason: "conflicting-fact" as const }
        : isFuture
          ? { quarantineReason: "future-timestamp" as const }
          : isStale
            ? { quarantineReason: "stale-fact" as const }
            : overridden
              ? { quarantineReason: "current-request-overrides-memory" as const }
              : instructionInjection
                ? { quarantineReason: "memory-instruction-injection" as const }
                : {}),
    };
  });

  const selected = decisions
    .filter((decision) => !decision.quarantined)
    .filter((decision) => decision.lexicalScore > 0 || decision.conceptScore > 0)
    .sort((left, right) =>
      right.rerankScore - left.rerankScore ||
      Date.parse(right.record.observedAt) - Date.parse(left.record.observedAt) ||
      left.record.recordId.localeCompare(right.record.recordId),
    )
    .slice(0, Math.max(1, options.limit ?? TOP_K));

  return {
    selected,
    quarantined: decisions.filter((decision) => decision.quarantined),
    droppedExpired: recalled.droppedExpired,
    droppedDuplicates: recalled.records.length - candidates.length,
  };
}
