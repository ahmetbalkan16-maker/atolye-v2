import { createHash } from "node:crypto";
import type { ResearchData, ResearchMediaCandidate } from "@/types/research";
import type { MediaType } from "@/types/asset";
import type { VisualData, VisualScene } from "@/types/visual";
import type {
  WikimediaCommonsCandidate,
} from "./providers/sources/WikimediaCommonsClient";
import { WikimediaCommonsClient } from "./providers/sources/WikimediaCommonsClient";
import { getRealImageProviderConfig } from "./providers/ImageProviderConfig";
import { classifyMediaRightsStatus } from "./MediaRightsPolicy";
import { isRealMediaAdmissible } from "./VisualMediaAdmissionPolicy";

/**
 * Documentary media effort — Faz 2: real media discovery in the research stage.
 *
 * The LLM only plans "what to search for"; the actual media candidates come from
 * a real source client (Wikimedia Commons today), NOT from fabricated URLs. Each
 * candidate's licence is classified deterministically (MediaRightsPolicy reuse),
 * candidates are deduped by source URL, and admissibility follows the Faz 1
 * policy. No download and no video render here — that is Faz 3.
 */

/** Minimal shape of a source client — WikimediaCommonsClient satisfies it structurally. */
export interface MediaSearchClient {
  search(
    query: string,
    limit: number,
    targetWidth?: number,
  ): Promise<WikimediaCommonsCandidate[]>;
}

export interface DiscoveryQuery {
  readonly term: string;
  readonly association: ResearchMediaCandidate["association"];
}

const MAX_QUERIES = 12;
const DEFAULT_PER_QUERY_LIMIT = 4;
const DEFAULT_MAX_CANDIDATES = 40;
const MIN_TERM_LENGTH = 3;

/** Reuse the existing "real" image provider configuration for the search client. */
export function createWikimediaSearchClient(
  fetcher?: typeof fetch,
): WikimediaCommonsClient {
  const config = getRealImageProviderConfig();
  return new WikimediaCommonsClient({
    fetcher,
    timeoutMs: config.timeoutMs,
    maxResponseBytes: config.maximumResponseBytes,
    retryDelayMs: config.retryDelayMs,
  });
}

/**
 * Deterministically derive the search plan from the (LLM-produced) research
 * text. Concrete named entities only — locations, characters, key events — plus
 * the topic itself. Pure; no network.
 */
export function deriveDiscoveryQueries(research: ResearchData): DiscoveryQuery[] {
  const seen = new Set<string>();
  const out: DiscoveryQuery[] = [];
  const add = (raw: unknown, association: DiscoveryQuery["association"]) => {
    if (typeof raw !== "string") return;
    // An LLM entity string is often `"Name: descriptive clause."` or
    // `"Name — clause"`; only the leading name is a useful archive query. A
    // whole clause becomes a scattered low-relevance Wikimedia full-text search.
    const cleaned = raw.trim().replace(/\s+/g, " ");
    const head = (cleaned.split(/\s*[:—–]\s*|\.\s+/)[0] ?? "").trim();
    const term = (head.length >= MIN_TERM_LENGTH ? head : cleaned).replace(/[.,;:]+$/, "").trim();
    const key = term.toLowerCase();
    if (term.length < MIN_TERM_LENGTH || term.length > 120 || seen.has(key)) return;
    seen.add(key);
    out.push({ term, association });
  };

  if (typeof research.topic === "string") add(research.topic, "topic");
  for (const location of asArray(research.locations)) add(location, "location");
  for (const character of asArray(research.characters)) add(character, "character");
  for (const event of asArray(research.keyEvents)) add(event, "event");

  return out.slice(0, MAX_QUERIES);
}

export interface DiscoverResearchMediaInput {
  readonly research: ResearchData;
  readonly client: MediaSearchClient;
  readonly perQueryLimit?: number;
  readonly maxCandidates?: number;
  /** Candidates already discovered on a prior pass — merged and deduped, not re-added. */
  readonly existing?: readonly ResearchMediaCandidate[];
  readonly now?: () => string;
}

/**
 * Run the search plan against the source client and return deduped, rights-
 * classified candidates. A failing query is skipped (never throws for a single
 * query failure). Deterministic given the same client responses.
 */
export async function discoverResearchMediaCandidates(
  input: DiscoverResearchMediaInput,
): Promise<ResearchMediaCandidate[]> {
  const perQueryLimit = clampInt(input.perQueryLimit, DEFAULT_PER_QUERY_LIMIT, 1, 20);
  const maxCandidates = clampInt(input.maxCandidates, DEFAULT_MAX_CANDIDATES, 1, 200);
  const now = input.now ?? (() => new Date().toISOString());
  const discoveredAt = now();

  const byId = new Map<string, ResearchMediaCandidate>();
  for (const candidate of input.existing ?? []) {
    if (isResearchMediaCandidate(candidate)) byId.set(candidate.id, candidate);
  }

  for (const query of deriveDiscoveryQueries(input.research)) {
    let results: WikimediaCommonsCandidate[];
    try {
      results = await input.client.search(query.term, perQueryLimit);
    } catch {
      continue;
    }
    for (const raw of results) {
      const mapped = toResearchMediaCandidate(raw, query, discoveredAt);
      if (!mapped) continue;
      const prior = byId.get(mapped.id);
      if (prior) {
        byId.set(mapped.id, mergeCandidate(prior, mapped));
      } else {
        byId.set(mapped.id, mapped);
      }
    }
  }

  return [...byId.values()]
    .sort(compareCandidates)
    .slice(0, maxCandidates);
}

/**
 * Best-effort research enrichment. Runs discovery, merges the result into
 * `research.mediaCandidates`, and returns a new ResearchData. ANY failure
 * (network, client, unexpected shape) returns the input research unchanged —
 * discovery never fails the research stage.
 */
export async function enrichResearchWithMediaDiscovery(
  research: ResearchData,
  options: { client?: MediaSearchClient; now?: () => string } = {},
): Promise<ResearchData> {
  try {
    const client = options.client ?? createWikimediaSearchClient();
    const candidates = await discoverResearchMediaCandidates({
      research,
      client,
      existing: research.mediaCandidates,
      now: options.now,
    });
    if (candidates.length === 0) return research;
    return { ...research, mediaCandidates: candidates };
  } catch (error) {
    console.error("[ResearchMediaDiscovery] discovery skipped (best-effort):", error);
    return research;
  }
}

/**
 * Deterministically assign one admissible candidate to each scene, best match
 * first, without reusing a candidate across scenes while unassigned admissible
 * candidates remain. Pure.
 */
export function matchResearchMediaToScenes(
  candidates: readonly ResearchMediaCandidate[],
  scenes: readonly VisualScene[],
): Map<number, ResearchMediaCandidate> {
  const pool = candidates
    .filter((candidate) => candidate.admissible)
    .slice()
    .sort(compareCandidates);
  const used = new Set<string>();
  const assignment = new Map<number, ResearchMediaCandidate>();

  for (const scene of scenes) {
    let best: { candidate: ResearchMediaCandidate; score: number } | undefined;
    for (const candidate of pool) {
      if (used.has(candidate.id)) continue;
      const score = scoreSceneMediaOverlap(scene, candidate);
      if (score <= 0) continue;
      if (!best || score > best.score) best = { candidate, score };
    }
    if (best) {
      used.add(best.candidate.id);
      assignment.set(scene.sceneId, best.candidate);
    }
  }
  return assignment;
}

/**
 * Deterministic 0+ relevance score between a scene and a candidate: the number
 * of shared, normalised terms across the scene's `searchKeywords` + visual
 * prompt and the candidate's query terms + title. Shared by the Faz 2 research
 * matcher and the Faz 3 `SceneMediaSelection` ladder so both rank identically.
 */
export function scoreSceneMediaOverlap(
  scene: VisualScene,
  candidate: ResearchMediaCandidate,
): number {
  return overlapScore(sceneMatchTerms(scene), candidateTerms(candidate));
}

/**
 * Apply discovered candidates to a VisualData: attach the matched candidate to
 * each scene and prepend its query terms to `searchKeywords` (deduped) so the
 * existing "real" image provider searches a known-good term. Additive and pure —
 * scenes with no match are untouched. Carries all candidates onto
 * `visualData.mediaCandidates` for the audit trail.
 */
export function applyResearchMediaCandidatesToVisualData(
  visualData: VisualData,
  research: ResearchData | null | undefined,
): VisualData {
  const candidates = research?.mediaCandidates ?? [];
  if (candidates.length === 0) return visualData;

  const assignment = matchResearchMediaToScenes(candidates, visualData.scenes);
  if (assignment.size === 0) {
    return { ...visualData, mediaCandidates: candidates };
  }

  const scenes = visualData.scenes.map((scene) => {
    const candidate = assignment.get(scene.sceneId);
    if (!candidate) return scene;
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const term of [...candidate.queryTerms, ...(scene.searchKeywords ?? [])]) {
      const key = term.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(term.trim());
    }
    return { ...scene, searchKeywords: merged, mediaCandidate: candidate };
  });

  return { ...visualData, scenes, mediaCandidates: candidates };
}

// --------------------------------------------------------------------------- internals

function toResearchMediaCandidate(
  raw: WikimediaCommonsCandidate | null | undefined,
  query: DiscoveryQuery,
  discoveredAt: string,
): ResearchMediaCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const sourceUrl = normalizeHttpUrl(raw.pageUrl);
  if (!sourceUrl) return null; // rule: no source URL -> not a candidate

  const license = typeof raw.license === "string" && raw.license.trim()
    ? raw.license.trim().slice(0, 200)
    : undefined;
  const rightsStatus = classifyMediaRightsStatus(license);
  const admissible = isRealMediaAdmissible(license) && Boolean(sourceUrl);
  const title = typeof raw.title === "string" && raw.title.trim()
    ? raw.title.trim().slice(0, 300)
    : query.term;

  return {
    id: `wikimedia-commons:${createHash("sha256").update(sourceUrl).digest("hex").slice(0, 24)}`,
    mediaType: mediaTypeFromMime(raw.mimeType),
    title,
    provider: "wikimedia-commons",
    sourceUrl,
    mediaUrl: normalizeHttpUrl(raw.imageUrl) ?? undefined,
    thumbnailUrl: undefined,
    license,
    attribution: typeof raw.attribution === "string" && raw.attribution.trim()
      ? raw.attribution.trim().slice(0, 300)
      : undefined,
    rightsStatus,
    admissible,
    width: positiveInt(raw.width),
    height: positiveInt(raw.height),
    queryTerms: [query.term],
    association: query.association,
    confidence: titleOverlapConfidence(query.term, title),
    discoveredAt,
  };
}

function mergeCandidate(
  prior: ResearchMediaCandidate,
  next: ResearchMediaCandidate,
): ResearchMediaCandidate {
  const queryTerms: string[] = [];
  const seen = new Set<string>();
  for (const term of [...prior.queryTerms, ...next.queryTerms]) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queryTerms.push(term);
  }
  return {
    ...prior,
    queryTerms,
    confidence: Math.max(prior.confidence, next.confidence),
  };
}

/**
 * Canonical deterministic ordering for media candidates: admissible first, then
 * higher confidence, then id ascending as the final tie-break. Exported so the
 * Faz 3 selector orders its pools identically.
 */
export function compareResearchMediaCandidates(
  a: ResearchMediaCandidate,
  b: ResearchMediaCandidate,
): number {
  if (a.admissible !== b.admissible) return a.admissible ? -1 : 1;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const compareCandidates = compareResearchMediaCandidates;

function sceneMatchTerms(scene: VisualScene): Set<string> {
  const terms = new Set<string>();
  for (const kw of scene.searchKeywords ?? []) for (const w of tokenize(kw)) terms.add(w);
  for (const w of tokenize(scene.visualPrompt)) terms.add(w);
  return terms;
}

function candidateTerms(candidate: ResearchMediaCandidate): Set<string> {
  const terms = new Set<string>();
  for (const q of candidate.queryTerms) for (const w of tokenize(q)) terms.add(w);
  for (const w of tokenize(candidate.title)) terms.add(w);
  return terms;
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const w of b) if (a.has(w)) hits += 1;
  return hits;
}

function titleOverlapConfidence(term: string, title: string): number {
  const t = new Set(tokenize(term));
  const T = new Set(tokenize(title));
  if (t.size === 0) return 0;
  let hits = 0;
  for (const w of t) if (T.has(w)) hits += 1;
  return Math.round((hits / t.size) * 100) / 100;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/^file:/, "")
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .split(/[^a-z0-9À-ɏ]+/i)
    .filter((w) => w.length >= MIN_TERM_LENGTH);
}

function mediaTypeFromMime(mime: unknown): MediaType {
  if (typeof mime !== "string") return "photo";
  const m = mime.toLowerCase();
  if (m.startsWith("video/")) return "video";
  if (m === "application/pdf" || m.startsWith("text/")) return "document";
  return "photo";
}

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function isResearchMediaCandidate(value: unknown): value is ResearchMediaCandidate {
  if (!value || typeof value !== "object") return false;
  const c = value as ResearchMediaCandidate;
  return typeof c.id === "string" && typeof c.sourceUrl === "string" &&
    typeof c.admissible === "boolean" && Array.isArray(c.queryTerms);
}
