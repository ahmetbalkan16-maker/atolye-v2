/**
 * Thin, provider-agnostic wrapper around the public Wikimedia Commons MediaWiki API.
 * No API key is required for read/search access; Wikimedia's API etiquette asks for a
 * descriptive User-Agent identifying the calling application, which is sent on every request.
 *
 * The User-Agent below follows Wikimedia's own recommended shape — `Client/Version
 * (ContactInformation)` — with a real, reachable contact (the project's public repository) rather
 * than a vague description. Clients that omit this or send an unidentifiable User-Agent are
 * documented to receive materially harsher rate limiting (Sprint 130.2 live-check finding), so
 * this is a correctness requirement here, not just etiquette.
 *
 * Follows the same fetch conventions as every other real provider in this codebase
 * (see OpenAIImageProvider.ts): injectable fetcher, AbortController + timeout, incrementally
 * bounded response reading, and safe (non-leaking) error surfaces.
 */

const SEARCH_ENDPOINT = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT =
  "AtolyeV2-RealPhotoSource/1.0 (https://github.com/ahmetbalkan16-maker/atolye-v2)";

export interface WikimediaCommonsClientOptions {
  fetcher?: typeof fetch;
  timeoutMs: number;
  maxResponseBytes: number;
  /** Delay before a single retry after a transient search/download failure. 0 disables retry. */
  retryDelayMs?: number;
  /** Injectable for tests; defaults to a real setTimeout-based wait. */
  delayFn?: (ms: number) => Promise<void>;
}

export interface WikimediaCommonsCandidate {
  sourceName: "wikimedia-commons";
  title: string;
  pageUrl: string;
  imageUrl: string;
  mimeType: string;
  width: number;
  height: number;
  license?: string;
  attribution?: string;
}

export class WikimediaCommonsClientError extends Error {
  readonly code = "WIKIMEDIA_COMMONS_CLIENT_FAILED";

  constructor() {
    super("Wikimedia Commons request failed.");
    this.name = "WikimediaCommonsClientError";
    this.stack = undefined;
  }
}

/**
 * Wikimedia responded 429 — its own error text explicitly asks callers not to retry the same
 * request ("a less disruptive approach"). Retrying into an active rate limit only prolongs it,
 * so this is a distinct, non-retried error type (Sprint 130.2).
 */
export class WikimediaCommonsRateLimitedError extends Error {
  readonly code = "WIKIMEDIA_COMMONS_RATE_LIMITED";

  constructor() {
    super("Wikimedia Commons rate-limited this request.");
    this.name = "WikimediaCommonsRateLimitedError";
    this.stack = undefined;
  }
}

export class WikimediaCommonsClient {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly retryDelayMs: number;
  private readonly delayFn: (ms: number) => Promise<void>;

  constructor(options: WikimediaCommonsClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs;
    this.maxResponseBytes = options.maxResponseBytes;
    this.retryDelayMs = options.retryDelayMs ?? 0;
    this.delayFn = options.delayFn ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * `targetWidth`, when given, asks Wikimedia to also return a pre-scaled thumbnail rendition
   * (via `iiurlwidth`) alongside the original. Candidates whose original exceeds that width use
   * the thumbnail as their download target — a multi-thousand-pixel original the pipeline will
   * only ever re-encode to 1920x1080 anyway is a needless multi-MB download (Sprint 130.2).
   */
  async search(
    query: string,
    limit: number,
    targetWidth?: number,
  ): Promise<WikimediaCommonsCandidate[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const url = new URL(SEARCH_ENDPOINT);
    url.searchParams.set("action", "query");
    url.searchParams.set("generator", "search");
    url.searchParams.set("gsrsearch", trimmed);
    url.searchParams.set("gsrnamespace", "6");
    url.searchParams.set("gsrlimit", String(Math.max(1, Math.min(limit, 20))));
    url.searchParams.set("prop", "imageinfo");
    url.searchParams.set("iiprop", "url|size|mime|extmetadata");
    if (targetWidth && targetWidth > 0) {
      url.searchParams.set("iiurlwidth", String(Math.floor(targetWidth)));
    }
    url.searchParams.set("format", "json");

    let payload: unknown;
    try {
      payload = await this.withRetry(() => this.request(url));
    } catch {
      return [];
    }

    return parseSearchResponse(payload);
  }

  /**
   * `timeoutOverrideMs`, when given, shrinks (never extends) the per-attempt timeout below the
   * client's configured ceiling — used by RealPhotoImageProvider to stay inside a per-scene
   * time budget across multiple candidate attempts (Sprint 130.2).
   */
  async downloadImage(imageUrl: string, timeoutOverrideMs?: number): Promise<Buffer> {
    const parsed = safeHttpsUrl(imageUrl);
    if (!parsed || parsed.host !== "upload.wikimedia.org") {
      throw new WikimediaCommonsClientError();
    }

    const effectiveTimeoutMs = timeoutOverrideMs === undefined
      ? this.timeoutMs
      : Math.max(1, Math.min(timeoutOverrideMs, this.timeoutMs));

    return this.withRetry(() => this.downloadOnce(parsed, effectiveTimeoutMs));
  }

  /**
   * Retries a single transient failure once, after a gentle delay — never hammers Wikimedia.
   * A rate-limit response is the one exception: it is never retried (see
   * WikimediaCommonsRateLimitedError).
   */
  private async withRetry<T>(attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt();
    } catch (firstError) {
      if (this.retryDelayMs <= 0 || firstError instanceof WikimediaCommonsRateLimitedError) {
        throw firstError;
      }
      await this.delayFn(this.retryDelayMs);
      return attempt();
    }
  }

  private async downloadOnce(parsed: URL, timeoutMs: number): Promise<Buffer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetcher(parsed.toString(), {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });
      if (response.status === 429) throw new WikimediaCommonsRateLimitedError();
      if (!response.ok) throw new WikimediaCommonsClientError();
      return await readBoundedBody(response, this.maxResponseBytes, controller);
    } catch (error) {
      if (error instanceof WikimediaCommonsClientError ||
        error instanceof WikimediaCommonsRateLimitedError) throw error;
      throw new WikimediaCommonsClientError();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url.toString(), {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: controller.signal,
      });
      if (response.status === 429) throw new WikimediaCommonsRateLimitedError();
      if (!response.ok) throw new WikimediaCommonsClientError();
      const body = await readBoundedBody(response, this.maxResponseBytes, controller);
      try {
        return JSON.parse(body.toString("utf8"));
      } catch {
        throw new WikimediaCommonsClientError();
      }
    } catch (error) {
      if (error instanceof WikimediaCommonsClientError ||
        error instanceof WikimediaCommonsRateLimitedError) throw error;
      throw new WikimediaCommonsClientError();
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
  controller: AbortController,
): Promise<Buffer> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) {
    controller.abort();
    throw new WikimediaCommonsClientError();
  }
  if (!response.body) throw new WikimediaCommonsClientError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        controller.abort();
        await reader.cancel();
        throw new WikimediaCommonsClientError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function safeHttpsUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

type WikimediaImageInfo = {
  url?: unknown;
  descriptionurl?: unknown;
  width?: unknown;
  height?: unknown;
  mime?: unknown;
  thumburl?: unknown;
  thumbwidth?: unknown;
  thumbheight?: unknown;
  extmetadata?: {
    LicenseShortName?: { value?: unknown };
    UsageTerms?: { value?: unknown };
    Artist?: { value?: unknown };
    Credit?: { value?: unknown };
  };
};

function parseSearchResponse(payload: unknown): WikimediaCommonsCandidate[] {
  if (!isRecord(payload)) return [];
  const query = payload.query;
  if (!isRecord(query)) return [];
  const pages = query.pages;
  if (!isRecord(pages)) return [];

  const candidates: WikimediaCommonsCandidate[] = [];
  for (const page of Object.values(pages)) {
    if (!isRecord(page)) continue;
    const title = page.title;
    const imageInfoList = page.imageinfo;
    if (typeof title !== "string" || !Array.isArray(imageInfoList) || !imageInfoList[0]) continue;

    const info = imageInfoList[0] as WikimediaImageInfo;
    const imageUrl = info.url;
    const pageUrl = info.descriptionurl;
    const width = info.width;
    const height = info.height;
    const mimeType = info.mime;

    if (
      typeof imageUrl !== "string" ||
      typeof pageUrl !== "string" ||
      typeof width !== "number" ||
      typeof height !== "number" ||
      typeof mimeType !== "string"
    ) continue;

    const license = stripHtml(info.extmetadata?.LicenseShortName?.value ?? info.extmetadata?.UsageTerms?.value);
    const artist = stripHtml(info.extmetadata?.Artist?.value);
    const credit = stripHtml(info.extmetadata?.Credit?.value);
    const scaled = selectDownloadTarget(imageUrl, width, height, info.thumburl, info.thumbwidth, info.thumbheight);

    candidates.push({
      sourceName: "wikimedia-commons",
      title,
      pageUrl,
      imageUrl: scaled.url,
      mimeType,
      width: scaled.width,
      height: scaled.height,
      license,
      attribution: artist ?? credit,
    });
  }

  return candidates;
}

/**
 * Prefers Wikimedia's pre-scaled thumbnail over the original when it's an actual downscale
 * (never upscales, never trusts a thumbnail claiming to be larger than the original).
 */
function selectDownloadTarget(
  originalUrl: string,
  originalWidth: number,
  originalHeight: number,
  thumbUrl: unknown,
  thumbWidth: unknown,
  thumbHeight: unknown,
): { url: string; width: number; height: number } {
  if (
    typeof thumbUrl === "string" && thumbUrl.trim() &&
    typeof thumbWidth === "number" && Number.isFinite(thumbWidth) && thumbWidth > 0 &&
    typeof thumbHeight === "number" && Number.isFinite(thumbHeight) && thumbHeight > 0 &&
    thumbWidth < originalWidth
  ) {
    return { url: thumbUrl, width: thumbWidth, height: thumbHeight };
  }
  return { url: originalUrl, width: originalWidth, height: originalHeight };
}

function stripHtml(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const stripped = value.replace(/<[^>]*>/g, "").trim();
  return stripped.length > 0 ? stripped.slice(0, 300) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
