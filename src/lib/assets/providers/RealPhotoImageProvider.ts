import type { ImageGenerationResult, ImageMimeType } from "@/types/asset";
import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import { ImageStorage } from "../storage/ImageStorage";
import { getRealImageProviderConfig } from "./ImageProviderConfig";
import type { ImageGenerationInput, ConfiguredImageProvider } from "./ImageProvider";
import {
  WikimediaCommonsClient,
  WikimediaCommonsRateLimitedError,
  type WikimediaCommonsCandidate,
} from "./sources/WikimediaCommonsClient";

const NOT_FOUND_ERROR = "No matching real photo found.";

/**
 * Wikimedia's standard attribution placeholder for images mass-extracted from Internet Archive
 * book/document scans by the "Internet Archive Book Images" bot. These pages share the scanned
 * book's title regardless of what the individual page illustration actually depicts, so a title
 * match alone cannot be trusted for them — they are excluded rather than ranked (Sprint 130.1).
 */
const BOOK_SCAN_ATTRIBUTION = "internet archive book images";

type RankedCandidate = WikimediaCommonsCandidate & {
  license: string;
  mimeType: ImageMimeType;
  score: number;
};

/**
 * "Real" image provider: searches free/openly-licensed photo archives for a scene before any
 * AI generation is attempted. Currently backed by Wikimedia Commons only; future sources
 * (Openverse, Library of Congress/Archive.org, NASA, Pexels/Pixabay/Unsplash) are added as
 * additional internal source clients here, not as new top-level ImageProviderName values —
 * see ADR-019.
 *
 * When no acceptable real photo is found, this returns success:false rather than silently
 * generating an AI image itself; VisualAssetPipeline decides whether to fall back to the
 * "openai" provider so the persisted asset's provider/model fields stay an honest record of
 * what actually produced each image.
 */
export class RealPhotoImageProvider implements ConfiguredImageProvider {
  readonly name = "real" as const;
  private readonly client: WikimediaCommonsClient;
  private readonly delayFn: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** Wall-clock time of the last dispatched scene, for inter-scene pacing (Sprint 130.2). */
  private lastRequestAt: number | null = null;
  /**
   * Source pages already used by an earlier scene in this batch. The pipeline
   * reuses one provider instance across every scene, so this stops the same
   * archival image being pulled into two or more scenes (a documentary reading
   * as broken).
   */
  private readonly usedSourceUrls = new Set<string>();

  constructor(options: {
    fetcher?: typeof fetch;
    client?: WikimediaCommonsClient;
    delayFn?: (ms: number) => Promise<void>;
    /** Injectable clock for deterministic scene-budget tests; defaults to Date.now. */
    now?: () => number;
  } = {}) {
    const config = getRealImageProviderConfig();
    this.delayFn = options.delayFn ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
    this.client = options.client ?? new WikimediaCommonsClient({
      fetcher: options.fetcher,
      timeoutMs: config.timeoutMs,
      maxResponseBytes: config.maximumResponseBytes,
      retryDelayMs: config.retryDelayMs,
      delayFn: this.delayFn,
    });
  }

  createImmutableImageDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name }, requiredMethods: ["generateImage"],
    });
  }

  private async paceRequest(minIntervalMs: number): Promise<void> {
    if (minIntervalMs > 0 && this.lastRequestAt !== null) {
      const wait = minIntervalMs - (this.now() - this.lastRequestAt);
      if (wait > 0) await this.delayFn(wait);
    }
    this.lastRequestAt = this.now();
  }

  async generateImage(
    input: ImageGenerationInput,
  ): Promise<ImageGenerationResult> {
    const createdAt = new Date().toISOString();
    const queries = buildSearchQueries(input.searchKeywords);
    const promptText = typeof input.prompt === "string" ? input.prompt : undefined;

    if (queries.length === 0 || !input.projectSlug) {
      return notFoundResult(input.sceneId, createdAt);
    }

    const config = getRealImageProviderConfig();
    // Sprint 130.2: the whole scene (every query variant + every candidate
    // attempt combined) is bounded by a single wall-clock deadline.
    const deadline = this.now() + config.sceneBudgetMs;

    // Wikimedia full-text search collapses a long multi-concept query into
    // scattered low-relevance hits (old book scans etc.), so a single scene
    // often needs each keyword tried as its own focused query. First query that
    // yields a downloadable, eligible candidate wins.
    for (const query of queries) {
      if (this.now() >= deadline) break;
      const outcome = await this.tryQuery(
        query, promptText, input.projectSlug, input.sceneId, config, deadline, createdAt,
      );
      if (outcome === "rate-limited") break;
      if (outcome) return outcome;
    }

    return notFoundResult(input.sceneId, createdAt);
  }

  private async tryQuery(
    query: string,
    promptText: string | undefined,
    projectSlug: string,
    sceneId: number,
    config: ReturnType<typeof getRealImageProviderConfig>,
    deadline: number,
    createdAt: string,
  ): Promise<ImageGenerationResult | "rate-limited" | null> {
    // A batch of scenes fired back-to-back with no gap can trip Wikimedia's burst rate limiting
    // even though each request individually is well inside quota — space consecutive requests on
    // this provider instance apart by a minimum interval (Sprint 130.2).
    await this.paceRequest(config.minRequestIntervalMs);

    let candidates: WikimediaCommonsCandidate[];
    try {
      candidates = await this.client.search(query, config.searchResultLimit, config.targetDownloadWidth);
    } catch {
      return null;
    }

    const ranked = rankEligibleCandidates(candidates, query, promptText, config)
      .filter((candidate) => !this.usedSourceUrls.has(candidate.pageUrl));
    // When the relevance gate or the cross-scene dedup leaves nothing, this
    // query yields no usable photo. The provider moves to the next query and,
    // if every query is exhausted, returns notFoundResult() so
    // VisualAssetPipeline falls back to AI generation — it never drops to an
    // off-topic archive image just to return "something".
    if (ranked.length === 0) return null;

    const attemptLimit = Math.min(ranked.length, config.candidateAttemptLimit);
    const perCandidateTimeoutMs = Math.max(
      1_000,
      Math.min(config.timeoutMs, Math.floor(config.sceneBudgetMs / attemptLimit)),
    );

    for (let index = 0; index < attemptLimit; index += 1) {
      if (this.now() >= deadline) break;

      const candidate = ranked[index];
      if (index > 0) {
        const pacing = Math.min(config.retryDelayMs, Math.max(0, deadline - this.now()));
        if (pacing > 0) await this.delayFn(pacing);
        if (this.now() >= deadline) break;
      }

      const attemptTimeoutMs = Math.min(perCandidateTimeoutMs, Math.max(0, deadline - this.now()));
      if (attemptTimeoutMs <= 0) break;

      let bytes: Buffer;
      try {
        bytes = await this.client.downloadImage(candidate.imageUrl, attemptTimeoutMs);
      } catch (error) {
        // A rate limit applies to the whole host, not this one file — trying more candidates
        // would just collect more 429s. Stop the scene here rather than compound it.
        if (error instanceof WikimediaCommonsRateLimitedError) return "rate-limited";
        continue;
      }

      const saved = trySaveCandidate(projectSlug, bytes, candidate.mimeType);
      if (!saved) continue;

      this.usedSourceUrls.add(candidate.pageUrl);
      return {
        success: true,
        sceneId,
        provider: "real",
        model: candidate.sourceName,
        filePath: saved.filePath,
        url: saved.url,
        mimeType: candidate.mimeType,
        sourceName: candidate.sourceName,
        sourceUrl: candidate.pageUrl,
        license: candidate.license,
        attribution: candidate.attribution,
        selectionScore: candidate.score,
        selectionRank: index + 1,
        candidateCount: ranked.length,
        width: candidate.width,
        height: candidate.height,
        createdAt,
      };
    }

    return null;
  }
}

function trySaveCandidate(
  projectSlug: string,
  bytes: Buffer,
  mimeType: ImageMimeType,
): { filePath: string; url: string } | null {
  try {
    const savedImage = ImageStorage.saveImage({ projectSlug, data: bytes, mimeType });
    const inspection = ImageStorage.inspectStoredImage(projectSlug, savedImage.filePath, mimeType);
    if (
      inspection.byteLength !== bytes.byteLength ||
      savedImage.url !== ImageStorage.getImageUrl(projectSlug, savedImage.fileName) ||
      savedImage.filePath !== ImageStorage.getImagePath(projectSlug, savedImage.fileName)
    ) {
      return null;
    }
    return { filePath: savedImage.filePath, url: savedImage.url };
  } catch {
    return null;
  }
}

/**
 * The lowest `titleMatchScore − modernInfraPenalty` a candidate may have and
 * still be shipped as a scene's real photo. Below this the title barely covers
 * the query (or a modern-infrastructure penalty wiped a perfect title match
 * out), so the candidate is dropped and the scene falls through to
 * VisualAssetPipeline's AI fallback instead of getting an off-topic archive
 * image. 0.34 ≈ "at least one meaningful query word actually names the file",
 * and it forces any penalised perfect-match (score ≤ 0) out entirely.
 */
export const MIN_SELECTION_SCORE = 0.34;

/** Sort-only weights — never folded into the persisted `selectionScore`. */
const PROMPT_RELEVANCE_SORT_WEIGHT = 0.5;
const HISTORICAL_ART_SORT_BONUS = 0.35;

/**
 * Filters to eligible candidates (safe MIME, minimum resolution, free license, not a book-scan
 * artifact), drops the ones that are not a defensible topical match (relevance gate), and ranks
 * what is left. A pure "highest resolution wins" rule can pick a technically-eligible but
 * semantically wrong match; word-overlap scoring against the file title (Sprint 130.1) plus a
 * modern-infrastructure / wrong-context penalty and a scene-description overlap / historical-art
 * bias (Sprint 173) prefer the candidate whose title actually depicts the scene's subject in the
 * right era.
 */
function rankEligibleCandidates(
  candidates: WikimediaCommonsCandidate[],
  query: string,
  promptText: string | undefined,
  config: ReturnType<typeof getRealImageProviderConfig>,
): RankedCandidate[] {
  const queryWords = tokenize(query);
  const promptWords = significantWords(promptText ?? "");
  return candidates
    .filter((candidate) => !isBookScanArtifact(candidate))
    .filter((candidate): candidate is WikimediaCommonsCandidate & { license: string; mimeType: ImageMimeType } =>
      toSafeImageMimeType(candidate.mimeType) !== null &&
      candidate.width >= config.minimumWidth &&
      candidate.height >= config.minimumHeight &&
      isFreeLicense(candidate.license))
    .map((candidate) => {
      // `score` keeps its pre-Sprint-173 formula unchanged — it is what is
      // persisted as the asset's `selectionScore`.
      const score =
        titleMatchScore(queryWords, candidate.title) -
        modernInfraPenalty(queryWords, candidate.title);
      const wrongContext = wrongContextSignal(candidate.title);
      const historicalArt = historicalArtSignal(candidate.title);
      const promptRelevance = titleOverlapFraction(promptWords, candidate.title);
      const rankKey =
        score +
        PROMPT_RELEVANCE_SORT_WEIGHT * promptRelevance +
        (historicalArt ? HISTORICAL_ART_SORT_BONUS : 0) -
        (wrongContext ? 2 : 0);
      return { candidate: { ...candidate, score }, score, rankKey, wrongContext };
    })
    .filter((entry) => entry.score >= MIN_SELECTION_SCORE && !entry.wrongContext)
    .sort(
      (a, b) =>
        b.rankKey - a.rankKey ||
        b.score - a.score ||
        b.candidate.width * b.candidate.height - a.candidate.width * a.candidate.height,
    )
    .map((entry) => entry.candidate);
}

/**
 * An entity name like "Fatih Sultan Mehmet" or "Golden Horn" also names a modern
 * bridge / avenue / mosque / monument / shipyard, and those contemporary photos
 * win a naive title match against a historical query (the real 302ce03f failure:
 * "Edirne" → a modern street, "Boğaz" → a war memorial, "Fatih Sultan Mehmet" →
 * the suspension bridge). Down-rank one modern-place word per hit — unless the
 * query itself asked for it (still selectable, just no longer the default pick).
 */
const MODERN_INFRA_WORDS = new Set([
  // transit / large infrastructure
  "bridge", "kopru", "koprusu", "metro", "metrosu", "tram", "tramway", "tramvay",
  "subway", "underground", "airport", "havalimani", "havaalani", "stadium",
  "stadyum", "stadyumu", "arena", "motorway", "highway", "freeway", "otoyol",
  "expressway", "skyscraper", "tower", "kule", "shopping", "mall", "avm",
  "station", "istasyon", "istasyonu", "gari", "railway", "tunnel", "tuneli",
  "tunel", "helicopter", "aircraft", "airplane", "ucak",
  // streets / squares / civic buildings
  "avenue", "caddesi", "cadde", "street", "sokak", "sokagi", "road", "yolu",
  "bulvari", "boulevard", "meydan", "meydani", "square", "park", "parki",
  "hotel", "oteli", "university", "universite", "universitesi", "hospital",
  "hastane", "hastanesi", "museum", "muze", "muzesi", "library", "kutuphane",
  "plaza", "building", "bina", "binasi", "apartment", "apartmani",
  // religious / commemorative structures (as *modern photos* of them)
  "mosque", "cami", "camii", "camisi", "mescit", "church", "kilise", "cathedral",
  "katedral", "chapel", "monastery", "manastir", "monument", "anit", "aniti",
  "memorial", "statue", "heykel", "heykeli", "bust", "bust", "fountain", "cesme",
  "cemetery", "mezarlik", "mezarligi", "graveyard", "sehitligi", "sehitlik",
  "shipyard", "tersane", "tersanesi", "dockyard", "girisi", "giris",
]);

/** Fold Turkish diacritics so `tokenize`'s ASCII-only regex still yields words. */
function foldTurkish(value: string): string {
  return value
    .replace(/İ/g, "i").replace(/I/g, "i").replace(/ı/g, "i")
    .replace(/ş/g, "s").replace(/Ş/g, "s").replace(/ç/g, "c").replace(/Ç/g, "c")
    .replace(/ö/g, "o").replace(/Ö/g, "o").replace(/ü/g, "u").replace(/Ü/g, "u")
    .replace(/ğ/g, "g").replace(/Ğ/g, "g");
}

/** Distinct modern-place words in the title that the query did not itself ask for. */
function modernInfraPenalty(queryWords: string[], title: string): number {
  const querySet = new Set(queryWords.map(foldTurkish));
  const hits = new Set(
    tokenize(foldTurkish(title)).filter(
      (word) => MODERN_INFRA_WORDS.has(word) && !querySet.has(word),
    ),
  );
  return hits.size;
}

/**
 * Titles that name a wholly different *kind* of subject from any documentary
 * frame — a religious painting of a namesake saint ("Blessed Giovanni
 * Giustiniani and Saints"), a statue of a same-name pope, or a demographic
 * chart ("Istanbul Çingeneleri ve Oranları"). A single hit disqualifies the
 * candidate outright regardless of title-word overlap.
 */
const WRONG_CONTEXT_WORDS = new Set([
  "blessed", "saint", "saints", "sainte", "aziz", "azize", "evliya",
  "madonna", "virgin", "crucifixion", "nativity", "annunciation", "altarpiece",
  "pope", "papa", "papal", "cardinal", "iconostasis",
  "cingene", "cingeneleri", "gypsy", "gypsies", "roman", "romani",
  "oran", "oranlar", "oranlari", "ratio", "ratios", "percentage", "yuzde",
  "nufus", "population", "demographic", "demographics", "istatistik",
  "statistics", "chart", "grafik", "graph", "diagram", "infographic",
  "logo", "coatofarms", "heraldry", "armory",
]);

function wrongContextSignal(title: string): boolean {
  const words = new Set(tokenize(foldTurkish(title)));
  return [...WRONG_CONTEXT_WORDS].some((word) => words.has(word));
}

/**
 * Positive signal that a title names period art / a primary historical source —
 * a painting, portrait, miniature, engraving, manuscript, or a pre-1900 dated
 * work. Only nudges the sort order; never a hard requirement (many legitimate
 * archival photos of ruins, walls and terrain carry none of these words).
 */
const HISTORICAL_ART_WORDS = new Set([
  "painting", "portrait", "miniature", "minyatur", "engraving", "gravur",
  "etching", "lithograph", "litografi", "woodcut", "mezzotint", "drawing",
  "sketch", "watercolour", "watercolor", "fresco", "fresk", "mural",
  "manuscript", "yazma", "elyazmasi", "illumination", "tezhip", "tasvir",
  "tablo", "map", "harita",
]);

function historicalArtSignal(title: string): boolean {
  const words = tokenize(foldTurkish(title));
  if (words.some((word) => HISTORICAL_ART_WORDS.has(word))) return true;
  return words.some((word) => /^1[0-8]\d{2}$/.test(word));
}

function isBookScanArtifact(candidate: WikimediaCommonsCandidate): boolean {
  return candidate.attribution?.trim().toLowerCase() === BOOK_SCAN_ATTRIBUTION;
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "and", "or", "in", "on", "at", "to", "from", "with",
  "by", "for", "as", "is", "are", "his", "her", "its", "into", "over", "under",
  "near", "front", "back", "background", "foreground", "scene", "shot", "wide",
  "close", "up", "view", "image", "photo", "camera", "cinematic", "dramatic",
  "ve", "ile", "bir", "bu", "su", "o", "de", "da", "ki", "icin", "gibi",
  "onunde", "arkasinda", "arkada", "onde", "planda", "goruluyor", "gorunuyor",
]);

/** Content words of a free-text prompt, Turkish-folded and stop-word filtered. */
function significantWords(text: string): string[] {
  return Array.from(
    new Set(
      tokenize(foldTurkish(text)).filter(
        (word) => word.length >= 3 && !STOP_WORDS.has(word),
      ),
    ),
  );
}

/** Fraction (0-1) of `words` that appear as whole words in the candidate title. */
function titleOverlapFraction(words: string[], title: string): number {
  if (words.length === 0) return 0;
  const titleWords = new Set(tokenize(foldTurkish(title)));
  return words.filter((word) => titleWords.has(word)).length / words.length;
}

/** Fraction (0-1) of distinct query words that appear as whole words in the candidate title. */
function titleMatchScore(queryWords: string[], title: string): number {
  const distinctQueryWords = Array.from(new Set(queryWords));
  if (distinctQueryWords.length === 0) return 0;
  const titleWords = new Set(tokenize(title));
  const matched = distinctQueryWords.filter((word) => titleWords.has(word)).length;
  return matched / distinctQueryWords.length;
}

/**
 * Turn a scene's keyword list into a prioritised list of Wikimedia search
 * queries. Each keyword becomes its own focused query (Wikimedia full-text
 * search returns scattered low-relevance hits for a long multi-concept string),
 * a `"Name: description"` keyword is reduced to just the entity name. The
 * queries are ordered most-specific-first — by word count, then length — so a
 * subject-rich phrase ("Ottoman siege cannon 1453") is tried before a bare
 * place name ("Edirne") that would match a modern street photo on title alone.
 * The two most specific keywords joined are appended as a broader last resort.
 * Deduped; bounded to `MAX_SEARCH_QUERIES` so the per-scene budget still holds.
 */
function buildSearchQueries(keywords: string[] | undefined): string[] {
  if (!keywords || keywords.length === 0) return [];
  const cleaned = keywords
    .map(normaliseKeyword)
    .filter((keyword): keyword is string => Boolean(keyword));
  if (cleaned.length === 0) return [];

  const bySpecificity = [...cleaned].sort((a, b) => {
    const wordsA = a.split(/\s+/).length;
    const wordsB = b.split(/\s+/).length;
    return wordsB - wordsA || b.length - a.length;
  });

  const queries: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | undefined) => {
    const query = value?.trim().slice(0, 200);
    if (!query) return;
    const key = query.toLowerCase();
    if (seen.has(key) || queries.length >= MAX_SEARCH_QUERIES) return;
    seen.add(key);
    queries.push(query);
  };

  for (const keyword of bySpecificity) add(keyword);
  if (bySpecificity.length > 1) add(bySpecificity.slice(0, 2).join(" "));
  return queries;
}

const MAX_SEARCH_QUERIES = 4;

/**
 * `"Fatih Sultan Mehmet: Osmanlı padişahı ve İstanbul'un fatihi."` ->
 * `"Fatih Sultan Mehmet"`. An LLM research/scene keyword is often an entity name
 * followed by a `:` / `—` / `.` and a descriptive clause; only the name is a
 * useful archive query. A keyword with no such separator is passed through
 * (trimmed, trailing punctuation removed).
 */
function normaliseKeyword(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const head = (trimmed.split(/\s*[:—–]\s*|\.\s+/)[0] ?? "").trim();
  const value = (head.length >= 3 ? head : trimmed).replace(/[.,;:]+$/, "").trim();
  return value.length >= 2 ? value : undefined;
}

function toSafeImageMimeType(value: string): ImageMimeType | null {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp"
    ? value
    : null;
}

function isFreeLicense(license: string | undefined): boolean {
  if (!license) return false;
  const normalized = license.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("public domain")) return true;
  if (/^pd(-|$)/.test(normalized)) return true;
  if (normalized.startsWith("cc0")) return true;
  if (/^cc[\s-]by(?:[\s-]sa)?[\s-]?\d/.test(normalized)) return true;
  return false;
}

function notFoundResult(sceneId: number, createdAt: string): ImageGenerationResult {
  return {
    success: false,
    sceneId,
    provider: "real",
    createdAt,
    error: NOT_FOUND_ERROR,
  };
}
