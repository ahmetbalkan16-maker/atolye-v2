/**
 * Stage 8 finding builders. Imports only modules that already existed before
 * Stage 8, so the same evaluator can run unchanged against a clean archive of
 * the pre-Stage-8 commit to produce a true baseline.
 */
import crypto from "node:crypto";

import type { AyasExternalResearchFinding } from "../../src/lib/brain/autonomy/AyasExternalResearchStore";
import { classifyAyasResearchDisposition } from "../../src/lib/brain/autonomy/AyasResearchDisposition";

export interface FindingSpec {
  readonly category?: AyasExternalResearchFinding["category"] | null;
  readonly capability?: string;
  readonly problemSolved?: string;
  readonly gapNotes?: string;
  readonly sourceUrl?: string;
  readonly official?: boolean;
  readonly confidence?: "high" | "medium" | "low";
  readonly license?: AyasExternalResearchFinding["licenseCostStatus"];
  readonly gap?: AyasExternalResearchFinding["atolyeGapStatus"];
  readonly recordedAt?: string;
  readonly lastCheckedAt?: string;
  readonly researchRunId?: string;
  readonly findingId?: string;
}

export const FIXTURE_NOW = "2026-09-24T12:00:00.000Z";

/** A finding exactly as the DEEP scan would record it, including its deterministic disposition. */
export function makeFinding(spec: FindingSpec = {}): AyasExternalResearchFinding {
  const checked = spec.lastCheckedAt ?? "2026-09-20T08:00:00.000Z";
  const category = spec.category === null ? null : spec.category ?? "MEMORY_CONTEXT";
  const official = spec.official ?? true;
  const confidence = spec.confidence ?? "high";
  const license = spec.license ?? "open-source";
  const gap = spec.gap ?? "missing";
  const { disposition, reasonCode } = classifyAyasResearchDisposition({ category, atolyeGapStatus: gap, confidence, licenseCostStatus: license, isOfficialSource: official });
  return {
    schemaVersion: "1",
    findingId: spec.findingId ?? `ayas-research-${crypto.randomUUID()}`,
    recordedAt: spec.recordedAt ?? checked,
    provider: "FixtureProvider",
    capability: spec.capability ?? "Multi-turn follow-up reference resolution",
    ...(category ? { category } : {}),
    problemSolved: spec.problemSolved ?? "Resolves pronouns and ordinal follow-ups against earlier conversation turns.",
    sourceUrl: spec.sourceUrl ?? "https://example.org/releases/reference-resolution",
    isOfficialSource: official,
    featureDate: null,
    lastCheckedAt: checked,
    confidence,
    licenseCostStatus: license,
    licenseCostNotes: "fixture",
    atolyeGapStatus: gap,
    atolyeGapNotes: spec.gapNotes ?? "fixture gap note",
    treatedSourceAsUntrusted: true,
    disposition,
    dispositionReason: reasonCode,
    researchMode: "DEEP",
    ...(spec.researchRunId ? { researchRunId: spec.researchRunId } : {}),
  };
}
