import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { redactBrainText } from "../BrainRedaction";
import type { AyasCapabilityCategory } from "./AyasCapabilityTaxonomy";
import type { AyasResearchDisposition } from "./AyasResearchDisposition";

/**
 * M22.3/M22.11/M22.12 — durable record of ONE external capability research
 * finding. This store never fetches anything itself: it has no network
 * code at all. A finding is recorded here only after a human-in-session
 * (today) — or, in a future sprint, a specifically-authorized research
 * step — has already done the actual lookup using ordinary read-only web
 * tools and independently written up what was found. This is deliberate:
 * M22.12 requires external content to be treated as untrusted input that
 * can never override AYAS policy, and the surest way to guarantee that is
 * for this store to never execute anything an external source returned —
 * it only ever stores a human-authored (or human-reviewed) SUMMARY record.
 *
 * Every field below maps directly to M22.11's "research freshness" and
 * M22.5's "license/cost governance" requirements — a finding without a
 * source URL, discovery date, or license/cost status is treated as
 * unusable evidence, not silently defaulted into looking authoritative.
 */
export const ayasExternalResearchSchemaVersion = "1" as const;

export type AyasResearchLicenseCostStatus = "free-tier-available" | "paid-only" | "open-source" | "unknown";

export interface AyasExternalResearchFinding {
  readonly schemaVersion: typeof ayasExternalResearchSchemaVersion;
  readonly findingId: string;
  readonly recordedAt: string;
  /** e.g. "ElevenLabs", "CapCut", "ffmpeg". Never a proprietary code excerpt. */
  readonly provider: string;
  /** e.g. "voice cloning with prosody control". Human-facing capability name. */
  readonly capability: string;
  /** M22.6 — the fixed taxonomy category this finding belongs to. Optional for backward compatibility with findings recorded before this field existed (e.g. M22.13's first real finding); a finding missing it is simply not filterable by category, never treated as invalid. */
  readonly category?: AyasCapabilityCategory;
  /** The exact problem this external capability solves for a user — never invented, always traceable to `sourceUrl`. */
  readonly problemSolved: string;
  readonly sourceUrl: string;
  readonly isOfficialSource: boolean;
  /** When the underlying feature/version was documented as available, if statable; otherwise `null` (never guessed). */
  readonly featureDate: string | null;
  /** When THIS finding was looked at — distinct from `recordedAt` (when it was written here) so a later re-check can update this without re-litigating the whole record. */
  readonly lastCheckedAt: string;
  readonly confidence: "high" | "medium" | "low";
  readonly licenseCostStatus: AyasResearchLicenseCostStatus;
  readonly licenseCostNotes: string;
  /** Atölye gap analysis — never left implicit. */
  readonly atolyeGapStatus: "already-supported" | "partially-supported" | "missing";
  readonly atolyeGapNotes: string;
  /** M22.12 — explicit acknowledgement that source content was treated as data, never as instructions. Always true for a real record; the field exists so a reviewer can see the boundary was actually considered, not merely assumed. */
  readonly treatedSourceAsUntrusted: true;
  /** Deterministic post-corroboration routing result. Optional for legacy/manual findings. */
  readonly disposition?: AyasResearchDisposition;
  readonly dispositionReason?: string;
  readonly researchMode?: "LIGHT" | "DEEP";
  /** Present for scheduler-originated findings; legacy/manual findings remain readable. */
  readonly scheduledFor?: string;
  readonly executedAt?: string;
  readonly researchRunId?: string;
  readonly occurrenceId?: string;
  readonly goalId?: string;
}

export class AyasExternalResearchStoreError extends Error {
  constructor(readonly code: "AYAS_RESEARCH_INVALID" | "AYAS_RESEARCH_IO" | "AYAS_RESEARCH_CORRUPT", message: string) {
    super(message);
    this.name = "AyasExternalResearchStoreError";
    this.stack = undefined;
  }
}

const MAX_TEXT = 600;
const scrub = (value: string, max = MAX_TEXT): string => redactBrainText(String(value ?? "")).text.slice(0, max);

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export type AyasExternalResearchFindingInput = Omit<AyasExternalResearchFinding, "schemaVersion" | "findingId" | "recordedAt" | "treatedSourceAsUntrusted">;

export interface AyasExternalResearchStoreOptions { readonly rootDir?: string }

export interface AyasExternalResearchStore {
  readonly dir: string;
  record(input: AyasExternalResearchFindingInput): AyasExternalResearchFinding;
  list(): readonly AyasExternalResearchFinding[];
  /** Dedup key: same provider + capability, case-insensitive — M22.10's "avoid repeatedly rediscovering the same external feature unless materially changed" without inventing a fuzzy-matching scheme. */
  findByProviderAndCapability(provider: string, capability: string): AyasExternalResearchFinding | undefined;
}

export function createAyasExternalResearchStore(options: AyasExternalResearchStoreOptions = {}): AyasExternalResearchStore {
  const dir = path.resolve(options.rootDir ?? path.join(process.cwd(), "data", "brain", "self-improvement", "external-research"));

  const listRaw = (): readonly AyasExternalResearchFinding[] => {
    if (!fs.existsSync(dir)) return [];
    const out: AyasExternalResearchFinding[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json") || f.startsWith(".")) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as AyasExternalResearchFinding;
        if (parsed && parsed.schemaVersion === ayasExternalResearchSchemaVersion) out.push(parsed);
      } catch { /* a corrupt finding never blocks reading the rest */ }
    }
    return out;
  };

  return {
    dir,
    record(input) {
      if (!input.sourceUrl?.trim() || !isHttpUrl(input.sourceUrl)) {
        throw new AyasExternalResearchStoreError("AYAS_RESEARCH_INVALID", "sourceUrl must be a real http(s) URL — a finding with no traceable source is not usable evidence");
      }
      if (!input.provider?.trim() || !input.capability?.trim() || !input.problemSolved?.trim()) {
        throw new AyasExternalResearchStoreError("AYAS_RESEARCH_INVALID", "provider, capability, and problemSolved are required");
      }
      if ((input.scheduledFor !== undefined && (!Number.isFinite(Date.parse(input.scheduledFor)) || new Date(Date.parse(input.scheduledFor)).toISOString() !== input.scheduledFor)) ||
        (input.executedAt !== undefined && (!Number.isFinite(Date.parse(input.executedAt)) || new Date(Date.parse(input.executedAt)).toISOString() !== input.executedAt)) ||
        (input.researchRunId !== undefined && !/^[0-9a-f-]{36}$/i.test(input.researchRunId)) ||
        (input.occurrenceId !== undefined && !/^[0-9a-f]{64}$/.test(input.occurrenceId)) ||
        (input.goalId !== undefined && !/^ayas-goal-[0-9a-f-]{36}$/i.test(input.goalId))) {
        throw new AyasExternalResearchStoreError("AYAS_RESEARCH_INVALID", "research execution identity or time is invalid");
      }
      const now = new Date().toISOString();
      const finding: AyasExternalResearchFinding = {
        schemaVersion: ayasExternalResearchSchemaVersion,
        findingId: `ayas-research-${crypto.randomUUID()}`,
        recordedAt: now,
        provider: scrub(input.provider, 120),
        capability: scrub(input.capability, 200),
        ...(input.category ? { category: input.category } : {}),
        problemSolved: scrub(input.problemSolved),
        sourceUrl: input.sourceUrl.trim(),
        isOfficialSource: input.isOfficialSource,
        featureDate: input.featureDate,
        lastCheckedAt: input.lastCheckedAt,
        confidence: input.confidence,
        licenseCostStatus: input.licenseCostStatus,
        licenseCostNotes: scrub(input.licenseCostNotes),
        atolyeGapStatus: input.atolyeGapStatus,
        atolyeGapNotes: scrub(input.atolyeGapNotes),
        treatedSourceAsUntrusted: true,
        ...(input.disposition ? { disposition: input.disposition } : {}),
        ...(input.dispositionReason ? { dispositionReason: scrub(input.dispositionReason, 120) } : {}),
        ...(input.researchMode ? { researchMode: input.researchMode } : {}),
        ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
        ...(input.executedAt ? { executedAt: input.executedAt } : {}),
        ...(input.researchRunId ? { researchRunId: input.researchRunId } : {}),
        ...(input.occurrenceId ? { occurrenceId: input.occurrenceId } : {}),
        ...(input.goalId ? { goalId: input.goalId } : {}),
      };
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, `${finding.findingId}.json`);
      const tmp = path.join(dir, `.${finding.findingId}.${process.pid}.${crypto.randomUUID()}.tmp`);
      try {
        const fd = fs.openSync(tmp, "wx");
        try { fs.writeFileSync(fd, `${JSON.stringify(finding, null, 2)}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, target);
      } catch (error) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* fail closed */ }
        throw new AyasExternalResearchStoreError("AYAS_RESEARCH_IO", error instanceof Error ? error.message : String(error));
      }
      return finding;
    },
    list() { return listRaw(); },
    findByProviderAndCapability(provider, capability) {
      const p = provider.trim().toLowerCase();
      const c = capability.trim().toLowerCase();
      return listRaw().find((f) => f.provider.trim().toLowerCase() === p && f.capability.trim().toLowerCase() === c);
    },
  };
}
