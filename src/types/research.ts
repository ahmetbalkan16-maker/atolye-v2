import type { MediaRightsStatus, MediaType } from "./asset";

/**
 * A concrete, real-world media item found by the research-stage discovery step
 * (Sprint 168 / documentary media Faz 2) against a real source client
 * (Wikimedia Commons today) — NOT an LLM-fabricated URL. Additive: absent on
 * every research.json produced before this step existed.
 */
export interface ResearchMediaCandidate {
  /** Stable id derived from the normalised source page URL (deterministic dedup key). */
  id: string;

  mediaType: MediaType;

  title: string;

  /** e.g. "wikimedia-commons". */
  provider: string;

  /** The source's human page for this item — REQUIRED; a candidate with no source URL is dropped. */
  sourceUrl: string;

  /** Direct file URL, when the source exposes one (used by a later download phase, not Faz 2). */
  mediaUrl?: string;

  thumbnailUrl?: string;

  license?: string;

  attribution?: string;

  /** Deterministic classification of `license` via MediaRightsPolicy. */
  rightsStatus: MediaRightsStatus;

  /**
   * `rightsStatus` is production-admissible AND a source URL is present. A
   * candidate with `admissible: false` is retained for the audit trail but is
   * never selected for a production render.
   */
  admissible: boolean;

  width?: number;

  height?: number;

  /** Source media runtime, when the source reports one (`mediaType: "video"`). */
  durationSeconds?: number;

  /**
   * Optional in/out points for a `mediaType: "video"` candidate, in seconds from
   * the start of the source. When present the ingestion layer (ADR-020 / Faz 3)
   * renders only `[segmentStartSeconds, segmentEndSeconds)` rather than the whole
   * clip. Both must be set together and validated against the probed duration.
   */
  segmentStartSeconds?: number;

  segmentEndSeconds?: number;

  /** The search term(s) that surfaced this candidate. */
  queryTerms: string[];

  /** Which research aspect the query came from. */
  association: "location" | "character" | "event" | "topic";

  /** 0–1 deterministic relevance score (query-term / title overlap). */
  confidence: number;

  discoveredAt: string;
}

export interface ResearchData {
  topic: string;

  summary: string;

  historicalContext: string;

  timeline: string[];

  characters: string[];

  locations: string[];

  keyEvents: string[];

  strategies: string[];

  controversies: string[];

  interestingFacts: string[];

  documentaryFlow: string[];

  sceneIdeas: string[];

  imagePrompts: string[];

  animationPrompts: string[];

  musicIdeas: string[];

  soundEffects: string[];

  thumbnailIdeas: string[];

  youtubeTitles: string[];

  sources: string[];

  /**
   * Real media items discovered from a source client during the research stage
   * (Sprint 168 / Faz 2). Additive, deduped by `id`; discovery failure leaves
   * this absent and does not fail the research stage.
   */
  mediaCandidates?: ResearchMediaCandidate[];

  createdAt: string;
}