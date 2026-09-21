import type { AIProvider, AIProviderOutput } from "../../ai/providers/AIProvider";
import { createAyasChatProvider } from "../../ayas/AyasModelProfile";
import { ayasSafePublicFetch } from "./AyasSafePublicFetch";
import { extractAyasFeedEntries, type AyasFeedEntry } from "./AyasFeedEntryExtractor";
import { buildAyasDeepAnalysisPrompt, parseAyasDeepAnalysisOutput, corroborateAyasGapClaim, AYAS_DEEP_ANALYSIS_JSON_SCHEMA } from "./AyasDeepAnalysis";
import { createAyasExternalResearchStore, type AyasExternalResearchStore } from "./AyasExternalResearchStore";
import { resolveAyasResearchSourcePolicy, type AyasResearchSource } from "./AyasResearchSourceRegistry";
import { classifyAyasResearchDisposition, type AyasResearchDisposition } from "./AyasResearchDisposition";
import { createAyasResearchNoveltyStore, type AyasResearchNoveltyStore } from "./AyasResearchNoveltyStore";

/**
 * AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint, Part F — the DEEP scan.
 * Takes the sources the LIGHT scan flagged as changed (or an explicit list,
 * for the manual Live Acceptance run), fetches each one's full content,
 * extracts a BOUNDED number of feed entries, and for each entry not already
 * recorded, asks the local model (`createAyasChatProvider()` — the exact
 * free, self-hosted `ollama` provider AYAS chat already uses; never a paid
 * API, per Part I's cost policy) to classify it via
 * `AyasDeepAnalysis.ts`'s schema-validated, untrusted-content-boundary
 * prompt. A genuinely new, noteworthy finding is recorded through the
 * EXISTING `AyasExternalResearchStore` — the same durable store a
 * human-in-session finding already uses, so Gelişim Merkezi and the goal
 * engine need no separate code path for an automated vs. a manual finding.
 *
 * External research NEVER mutates production source here (Part M's own
 * requirement): this module has no sandbox step, no patch, no git call —
 * `researchStore.record()` writes one JSON file, nothing else.
 */
export interface AyasDeepScanEntryOutcome {
  readonly sourceId: string;
  readonly entryTitle: string;
  readonly outcome: "RECORDED" | "SKIPPED_NOT_NOTEWORTHY" | "SKIPPED_DUPLICATE" | "SKIPPED_UNCHANGED" | "SKIPPED_INVALID_MODEL_OUTPUT" | "SKIPPED_ANALYSIS_ERROR";
  readonly findingId?: string;
  readonly gapClaimDowngraded?: boolean;
  /** What AYAS decided this finding is FOR. Only `ACTIONABLE_PROPOSAL_CANDIDATE` may enter discovery, and even that authorizes nothing on its own. */
  readonly disposition?: AyasResearchDisposition;
  /** Why the novelty memory considered this item new (or not). */
  readonly noveltyReason?: string;
}

export interface AyasDeepScanResult {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly sourcesAnalyzed: number;
  readonly sourcesFailed: number;
  readonly entriesConsidered: number;
  readonly findingsRecorded: number;
  readonly entryOutcomes: readonly AyasDeepScanEntryOutcome[];
  readonly sourceErrors: readonly { readonly sourceId: string; readonly error: string }[];
}

export interface AyasDeepResearchDeps {
  readonly sources: readonly AyasResearchSource[];
  readonly researchStore?: AyasExternalResearchStore;
  readonly noveltyStore?: AyasResearchNoveltyStore;
  /** Overrides each source's own retry policy — for deterministic tests. */
  readonly maxRetries?: number;
  readonly retryBaseDelayMs?: number;
  readonly provider?: AIProvider;
  readonly repoRoot?: string;
  readonly maxEntriesPerSource?: number;
  readonly maxBodyBytes?: number;
  readonly timeoutMs?: number;
  readonly maxTokens?: number;
  readonly now?: () => string;
  /** Test-only passthrough — see `AyasSafePublicFetch`'s own doc comment. Never set by the real scheduler. */
  readonly dangerouslyAllowPrivateNetworkForTests?: boolean;
}

export const AYAS_DEEP_SCAN_DEFAULT_MAX_ENTRIES_PER_SOURCE = 3;
export const AYAS_DEEP_SCAN_DEFAULT_MAX_BODY_BYTES = 2_000_000;
export const AYAS_DEEP_SCAN_DEFAULT_MAX_TOKENS = 500;

function textOf(output: AIProviderOutput): string {
  if (typeof output === "string") return output;
  return output.refused ? "" : output.content ?? "";
}

function resolveEntryUrl(entry: AyasFeedEntry, source: AyasResearchSource): string {
  try {
    return new URL(entry.link, source.url).toString();
  } catch {
    return source.url;
  }
}

export async function runAyasDeepResearchScan(deps: AyasDeepResearchDeps): Promise<AyasDeepScanResult> {
  const researchStore = deps.researchStore ?? createAyasExternalResearchStore();
  const noveltyStore = deps.noveltyStore ?? createAyasResearchNoveltyStore();
  const provider = deps.provider ?? createAyasChatProvider();
  const repoRoot = deps.repoRoot ?? process.cwd();
  const maxEntriesPerSource = deps.maxEntriesPerSource ?? AYAS_DEEP_SCAN_DEFAULT_MAX_ENTRIES_PER_SOURCE;
  const now = deps.now ?? (() => new Date().toISOString());
  const startedAt = now();

  const entryOutcomes: AyasDeepScanEntryOutcome[] = [];
  const sourceErrors: { readonly sourceId: string; readonly error: string }[] = [];
  let sourcesAnalyzed = 0;
  let entriesConsidered = 0;

  for (const source of deps.sources) {
    let body: string;
    let contentType: string;
    try {
      const policy = resolveAyasResearchSourcePolicy(source);
      const fetched = await ayasSafePublicFetch(source.url, {
        timeoutMs: deps.timeoutMs ?? 12000,
        maxBodyBytes: deps.maxBodyBytes ?? policy.deepMaxBodyBytes ?? AYAS_DEEP_SCAN_DEFAULT_MAX_BODY_BYTES,
        // The DEEP scan reads at most `maxEntriesPerSource` entries, and a
        // newest-first feed puts them at the very start of the body, so a
        // bounded prefix is all this step has ever actually needed. A feed
        // truncated mid-`<entry>` simply yields one fewer complete block —
        // the extractor only matches closed `<entry>...</entry>` pairs, so
        // a partial trailing block is dropped rather than half-parsed.
        acceptTruncatedBody: true,
        maxRetries: deps.maxRetries ?? policy.maxRetries,
        ...(deps.retryBaseDelayMs === undefined ? {} : { retryBaseDelayMs: deps.retryBaseDelayMs }),
        dangerouslyAllowPrivateNetworkForTests: deps.dangerouslyAllowPrivateNetworkForTests,
      });
      if (!fetched.ok) { sourceErrors.push({ sourceId: source.sourceId, error: `${fetched.code}: ${fetched.message}` }); continue; }
      body = fetched.body;
      contentType = fetched.contentType;
    } catch (error) {
      sourceErrors.push({ sourceId: source.sourceId, error: error instanceof Error ? error.message : String(error) });
      continue;
    }

    sourcesAnalyzed += 1;
    const entries = extractAyasFeedEntries(body, `${contentType} ${source.kind}`, maxEntriesPerSource);
    const existing = researchStore.list();

    for (const entry of entries) {
      entriesConsidered += 1;
      const entryUrl = resolveEntryUrl(entry, source);
      const observation = { sourceId: source.sourceId, url: entryUrl, versionTag: entry.title?.trim() || null, contentText: `${entry.title}\n${entry.summary}` };

      // Novelty memory comes FIRST, before any model call. An item AYAS has
      // already looked at costs nothing to skip here, whereas the old
      // findings-only dedup re-analyzed every not-noteworthy entry on every
      // single scan, forever. A materially changed version still reopens
      // evaluation — `assess` says so explicitly.
      const novelty = noveltyStore.assess(observation);
      if (!novelty.isNovel) {
        noveltyStore.remember(observation);
        entryOutcomes.push({ sourceId: source.sourceId, entryTitle: entry.title, outcome: "SKIPPED_UNCHANGED", noveltyReason: novelty.reasonCode });
        continue;
      }

      if (existing.some((f) => f.sourceUrl === entryUrl)) {
        noveltyStore.remember(observation);
        entryOutcomes.push({ sourceId: source.sourceId, entryTitle: entry.title, outcome: "SKIPPED_DUPLICATE", noveltyReason: novelty.reasonCode });
        continue;
      }

      let raw: AIProviderOutput;
      try {
        raw = await provider.generate(
          buildAyasDeepAnalysisPrompt({ source: { provider: source.provider, category: source.category }, entry }),
          { maxTokens: deps.maxTokens ?? AYAS_DEEP_SCAN_DEFAULT_MAX_TOKENS, jsonSchema: AYAS_DEEP_ANALYSIS_JSON_SCHEMA as unknown as Record<string, unknown> },
        );
      } catch (error) {
        entryOutcomes.push({ sourceId: source.sourceId, entryTitle: entry.title, outcome: "SKIPPED_ANALYSIS_ERROR" });
        sourceErrors.push({ sourceId: source.sourceId, error: `model call failed: ${error instanceof Error ? error.message : String(error)}` });
        continue;
      }

      const parsed = parseAyasDeepAnalysisOutput(textOf(raw));
      if (!parsed) {
        entryOutcomes.push({ sourceId: source.sourceId, entryTitle: entry.title, outcome: "SKIPPED_INVALID_MODEL_OUTPUT" });
        continue;
      }
      if (!parsed.isNoteworthy) {
        // Remember the verdict. This is the case the old dedup could not
        // see at all, and the reason an uninteresting release note used to
        // be re-analyzed on every scan for the rest of time.
        noveltyStore.remember(observation, { judgedNotNoteworthy: true });
        entryOutcomes.push({ sourceId: source.sourceId, entryTitle: entry.title, outcome: "SKIPPED_NOT_NOTEWORTHY", noveltyReason: novelty.reasonCode });
        continue;
      }

      const corroboration = corroborateAyasGapClaim(parsed.category, parsed.atolyeGapStatus, parsed.atolyeGapNotes, repoRoot);

      // What is this finding FOR? Decided deterministically from already-
      // structured, already-corroborated facts — never from the external
      // text, and never as a free-text verdict the model could inflate.
      const { disposition, reasonCode: dispositionReason } = classifyAyasResearchDisposition({
        category: parsed.category ?? source.category,
        atolyeGapStatus: corroboration.atolyeGapStatus,
        confidence: parsed.confidence,
        licenseCostStatus: parsed.licenseCostStatus,
        isOfficialSource: source.officialSource,
        previouslyEvaluated: novelty.reasonCode === "UNCHANGED",
      });

      try {
        const finding = researchStore.record({
          provider: source.provider,
          capability: parsed.capability,
          category: parsed.category ?? source.category,
          problemSolved: parsed.problemSolved,
          sourceUrl: entryUrl,
          isOfficialSource: source.officialSource,
          featureDate: entry.updatedAt ?? null,
          lastCheckedAt: now(),
          confidence: parsed.confidence,
          licenseCostStatus: parsed.licenseCostStatus,
          licenseCostNotes: parsed.licenseCostNotes,
          atolyeGapStatus: corroboration.atolyeGapStatus,
          atolyeGapNotes: corroboration.atolyeGapNotes,
          disposition,
          dispositionReason,
          researchMode: "DEEP",
        });
        noveltyStore.remember(observation, { disposition, findingId: finding.findingId, judgedNotNoteworthy: false });
        entryOutcomes.push({ sourceId: source.sourceId, entryTitle: entry.title, outcome: "RECORDED", findingId: finding.findingId, gapClaimDowngraded: corroboration.downgraded, disposition, noveltyReason: novelty.reasonCode });
      } catch (error) {
        entryOutcomes.push({ sourceId: source.sourceId, entryTitle: entry.title, outcome: "SKIPPED_ANALYSIS_ERROR" });
        sourceErrors.push({ sourceId: source.sourceId, error: `record failed: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }

  const completedAt = now();
  return {
    startedAt,
    completedAt,
    sourcesAnalyzed,
    sourcesFailed: sourceErrors.length > 0 ? new Set(sourceErrors.map((e) => e.sourceId)).size : 0,
    entriesConsidered,
    findingsRecorded: entryOutcomes.filter((e) => e.outcome === "RECORDED").length,
    entryOutcomes,
    sourceErrors,
  };
}
