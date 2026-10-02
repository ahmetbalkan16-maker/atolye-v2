/**
 * Stage 15J — the historical fact pack.
 *
 * What a historical story is allowed to state, made before the script: the key
 * claims, each with its dates, people, places, how certain it is, the sources
 * it rests on, and the scenes that narrate it.
 *
 * `checkNarrationEvidence` is the rule the design asks for: a factual claim
 * without evidence cannot silently enter narration. It reads the narration of
 * each unit against the claims mapped to it and reports what is stated without
 * support. It is a deterministic text check, not understanding: it sees years,
 * names and the claims the pack maps, and nothing subtler.
 *
 * Pure: no filesystem, no network, no clock, no model. Advisory: it blocks
 * nothing by itself; a caller decides what a `BLOCKED` gate stops.
 */
export const HISTORICAL_FACT_PACK_SCHEMA_VERSION = "1" as const;

export const FACT_CERTAINTIES = Object.freeze(["ESTABLISHED", "PROBABLE", "DISPUTED", "LEGENDARY", "UNKNOWN"] as const);
export type FactCertainty = (typeof FACT_CERTAINTIES)[number];

export interface HistoricalFactSource {
  readonly id: string;
  /** A source from the period, or a later work about it. */
  readonly kind: "PRIMARY" | "SECONDARY";
  readonly title: string;
  /** Where it can be found: a URL or a citation. */
  readonly reference: string;
}
export interface HistoricalFactClaim {
  readonly id: string;
  readonly statement: string;
  /** Years or dates the claim states, as written (for example "1453", "29 Mayıs 1453"). */
  readonly dates: readonly string[];
  readonly people: readonly string[];
  readonly locations: readonly string[];
  readonly certainty: FactCertainty;
  readonly sourceIds: readonly string[];
  /** The scenes whose narration states this claim. */
  readonly sceneIds: readonly number[];
}
export interface HistoricalFactPack {
  readonly schemaVersion: typeof HISTORICAL_FACT_PACK_SCHEMA_VERSION;
  readonly topic: string;
  readonly claims: readonly HistoricalFactClaim[];
  readonly sources: readonly HistoricalFactSource[];
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_CLAIMS = 300;
const MAX_SOURCES = 300;
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const texts = (value: unknown, max: number, count: number): value is string[] => Array.isArray(value) && value.length <= count && value.every((item) => text(item, max));

/** Whether a value is a fact pack this module will read. Every problem is named; nothing is repaired. */
export function validateHistoricalFactPack(value: unknown): { readonly ok: true; readonly pack: HistoricalFactPack } | { readonly ok: false; readonly problems: readonly string[] } {
  if (!plain(value)) return { ok: false, problems: ["NOT_AN_OBJECT"] };
  const problems: string[] = [];
  if (value.schemaVersion !== HISTORICAL_FACT_PACK_SCHEMA_VERSION) problems.push("SCHEMA_VERSION");
  if (!text(value.topic, 300)) problems.push("TOPIC");
  const sources = Array.isArray(value.sources) ? value.sources : null;
  const claims = Array.isArray(value.claims) ? value.claims : null;
  if (!sources || sources.length > MAX_SOURCES) problems.push("SOURCES");
  if (!claims || claims.length === 0 || claims.length > MAX_CLAIMS) problems.push("CLAIMS");
  const sourceIds = new Set<string>();
  for (const [index, source] of (sources ?? []).entries()) {
    if (!plain(source) || typeof source.id !== "string" || !ID.test(source.id) || sourceIds.has(source.id) || (source.kind !== "PRIMARY" && source.kind !== "SECONDARY") || !text(source.title, 300) || !text(source.reference, 500)) problems.push(`SOURCE:${index}`);
    else sourceIds.add(source.id);
  }
  const claimIds = new Set<string>();
  for (const [index, claim] of (claims ?? []).entries()) {
    if (!plain(claim) || typeof claim.id !== "string" || !ID.test(claim.id) || claimIds.has(claim.id) || !text(claim.statement, 1000) ||
        !texts(claim.dates, 60, 20) || !texts(claim.people, 120, 40) || !texts(claim.locations, 120, 40) || !(FACT_CERTAINTIES as readonly unknown[]).includes(claim.certainty) ||
        !Array.isArray(claim.sourceIds) || claim.sourceIds.length > 20 || !claim.sourceIds.every((id) => typeof id === "string") ||
        !Array.isArray(claim.sceneIds) || claim.sceneIds.length > 200 || !claim.sceneIds.every((id) => Number.isSafeInteger(id) && (id as number) > 0)) { problems.push(`CLAIM:${index}`); continue; }
    claimIds.add(claim.id);
    // A source a claim names has to be in the pack: a reference to nothing is not a source.
    if ((claim.sourceIds as string[]).some((id) => !sourceIds.has(id))) problems.push(`CLAIM_SOURCE_UNRESOLVED:${claim.id}`);
  }
  return problems.length ? { ok: false, problems } : { ok: true, pack: value as unknown as HistoricalFactPack };
}

export type FactEvidence = "SUPPORTED" | "SUPPORTED_UNCERTAIN" | "UNSUPPORTED";

/**
 * Whether a claim may be narrated. It needs at least one source in the pack. A disputed or legendary claim is
 * supported only as what it is: the narration has to say that it is uncertain. A claim of unknown certainty is not
 * supported, whatever it cites.
 */
export function classifyFactEvidence(claim: HistoricalFactClaim, pack: HistoricalFactPack): FactEvidence {
  const resolved = claim.sourceIds.filter((id) => pack.sources.some((source) => source.id === id));
  if (resolved.length === 0 || claim.certainty === "UNKNOWN") return "UNSUPPORTED";
  return claim.certainty === "ESTABLISHED" || claim.certainty === "PROBABLE" ? "SUPPORTED" : "SUPPORTED_UNCERTAIN";
}

/** One stretch of narration and the scenes it is heard over. */
export interface NarrationUnit { readonly id: number; readonly sceneIds: readonly number[]; readonly text: string }
export type NarrationEvidenceCode = "CLAIM_UNSUPPORTED_NARRATED" | "DATE_WITHOUT_CLAIM" | "CLAIM_NOT_MAPPED_TO_SCENE" | "UNCERTAINTY_NOT_STATED" | "NAME_WITHOUT_CLAIM";
export interface NarrationEvidenceFinding {
  readonly code: NarrationEvidenceCode;
  readonly severity: "BLOCKER" | "MAJOR" | "REVIEW";
  readonly unitId: number;
  /** The claim, year or name the finding is about. */
  readonly subject: string;
}
export interface NarrationEvidenceReview {
  readonly gate: "PASS" | "REVIEW_REQUIRED" | "BLOCKED";
  readonly findings: readonly NarrationEvidenceFinding[];
  readonly claims: { readonly total: number; readonly supported: number; readonly supportedUncertain: number; readonly unsupported: number; readonly unmapped: number };
  readonly authority: "ADVISORY_ONLY";
}

const lower = (value: string) => value.toLocaleLowerCase("tr");
/** Words after a number that make it a count, not a year. */
const COUNT_NOUNS = new Set(["asker", "askeri", "askerle", "kişi", "kişilik", "adam", "gemi", "gemiden", "top", "atlı", "süvari", "okçu", "esir", "kilometre", "km", "metre", "mil", "altın", "akçe", "soldiers", "men", "troops", "ships", "people", "cannons", "horsemen", "archers", "miles", "kilometres", "kilometers", "metres", "meters", "gold", "prisoners"]);
/** Phrases that say a statement is not certain. */
const HEDGES = ["rivayete göre", "rivayet edilir", "söylenir", "söylenegelir", "iddia", "muhtemelen", "olasılıkla", "belki", "tartışmalı", "efsaneye göre", "efsane", "kesin değil", "kesin olarak bilinmiyor", "bilinmiyor", "anlatılır",
  "according to legend", "legend has it", "reportedly", "allegedly", "possibly", "probably", "perhaps", "disputed", "it is said", "is said to", "may have", "might have", "uncertain", "unclear", "tradition holds"];

/** Years a text states: three- or four-digit numbers from 100 to 2100 that are not followed by a count noun. */
export function extractNarratedYears(value: string): string[] {
  const years: string[] = [];
  for (const match of value.matchAll(/(?<![\p{L}\d.,])(\d{3,4})(?![\d]|[.,]\d)(?:['’]\p{L}+)?(?:\s+(\p{L}+))?/gu)) {
    const year = Number(match[1]);
    if (year < 100 || year > 2100) continue;
    if (match[2] && COUNT_NOUNS.has(lower(match[2]))) continue;
    if (!years.includes(match[1]!)) years.push(match[1]!);
  }
  return years;
}

/** Capitalized words that are not the first word of a sentence: the names a text uses. */
export function extractNarratedNames(value: string): string[] {
  const names: string[] = [];
  for (const sentence of value.split(/(?<=[.!?…:;])\s+|\n+/u)) {
    const words = sentence.trim().split(/\s+/u);
    for (const [index, raw] of words.entries()) {
      const word = raw.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "").replace(/['’].*$/u, "");
      if (index === 0 || word.length < 3 || !/^\p{Lu}\p{Ll}+$/u.test(word)) continue;
      if (!names.includes(word)) names.push(word);
    }
  }
  return names;
}

/**
 * Reads each unit's narration against the claims mapped to its scenes.
 *
 *  - A mapped claim that is not supported is a blocker: the narration states it and nothing backs it.
 *  - A year the narration states has to be in a supported claim mapped to the unit. In a claim mapped elsewhere it
 *    is a mapping gap to review; in no supported claim at all it is a blocker.
 *  - A disputed or legendary claim has to be narrated as uncertain.
 *  - A name the pack does not know is reported for review. Names are found by capitalization, so this over-reports.
 */
export function checkNarrationEvidence(pack: HistoricalFactPack, units: readonly NarrationUnit[]): NarrationEvidenceReview {
  const findings: NarrationEvidenceFinding[] = [];
  const evidence = new Map(pack.claims.map((claim) => [claim.id, classifyFactEvidence(claim, pack)]));
  const usable = (claim: HistoricalFactClaim) => evidence.get(claim.id) !== "UNSUPPORTED";
  const yearsOf = (claim: HistoricalFactClaim) => claim.dates.flatMap(extractYearTokens);
  const vocabulary = new Set<string>();
  for (const phrase of [pack.topic, ...pack.claims.flatMap((claim) => [...claim.people, ...claim.locations, claim.statement])]) for (const word of phrase.split(/[^\p{L}]+/u)) if (word.length >= 3) vocabulary.add(lower(word));

  for (const unit of units) {
    const mapped = pack.claims.filter((claim) => claim.sceneIds.some((id) => unit.sceneIds.includes(id)));
    const said = lower(unit.text);
    for (const claim of mapped) {
      const state = evidence.get(claim.id);
      if (state === "UNSUPPORTED") findings.push({ code: "CLAIM_UNSUPPORTED_NARRATED", severity: "BLOCKER", unitId: unit.id, subject: claim.id });
      else if (state === "SUPPORTED_UNCERTAIN" && !HEDGES.some((hedge) => said.includes(hedge))) findings.push({ code: "UNCERTAINTY_NOT_STATED", severity: "MAJOR", unitId: unit.id, subject: claim.id });
    }
    for (const year of extractNarratedYears(unit.text)) {
      if (mapped.some((claim) => usable(claim) && yearsOf(claim).includes(year))) continue;
      const elsewhere = pack.claims.some((claim) => usable(claim) && yearsOf(claim).includes(year));
      findings.push(elsewhere ? { code: "CLAIM_NOT_MAPPED_TO_SCENE", severity: "REVIEW", unitId: unit.id, subject: year } : { code: "DATE_WITHOUT_CLAIM", severity: "BLOCKER", unitId: unit.id, subject: year });
    }
    for (const name of extractNarratedNames(unit.text).slice(0, 40)) {
      if (!vocabulary.has(lower(name))) findings.push({ code: "NAME_WITHOUT_CLAIM", severity: "REVIEW", unitId: unit.id, subject: name });
    }
  }
  const count = (state: FactEvidence) => pack.claims.filter((claim) => evidence.get(claim.id) === state).length;
  const narrated = new Set(units.flatMap((unit) => unit.sceneIds));
  return {
    gate: findings.some((finding) => finding.severity === "BLOCKER") ? "BLOCKED" : findings.length ? "REVIEW_REQUIRED" : "PASS",
    findings,
    claims: { total: pack.claims.length, supported: count("SUPPORTED"), supportedUncertain: count("SUPPORTED_UNCERTAIN"), unsupported: count("UNSUPPORTED"), unmapped: pack.claims.filter((claim) => !claim.sceneIds.some((id) => narrated.has(id))).length },
    authority: "ADVISORY_ONLY",
  };
}

/** The year numbers inside a date as written ("29 Mayıs 1453" gives "1453"). */
function extractYearTokens(date: string): string[] {
  return [...date.matchAll(/(?<!\d)(\d{3,4})(?!\d)/g)].map((match) => match[1]!).filter((year) => Number(year) >= 100 && Number(year) <= 2100);
}
