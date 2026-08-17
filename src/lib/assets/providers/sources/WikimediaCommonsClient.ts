/**
 * Thin, provider-agnostic wrapper around the public Wikimedia Commons MediaWiki API.
 * No API key is required for read/search access; Wikimedia's API etiquette asks for a
 * descriptive User-Agent identifying the calling application, which is sent on every request.
 *
 * Follows the same fetch conventions as every other real provider in this codebase
 * (see OpenAIImageProvider.ts): injectable fetcher, AbortController + timeout, incrementally
 * bounded response reading, and safe (non-leaking) error surfaces.
 */

const SEARCH_ENDPOINT = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "AtolyeV2-RealPhotoSource/1.0 (personal AI production studio; contact via project owner)";

export interface WikimediaCommonsClientOptions {
  fetcher?: typeof fetch;
  timeoutMs: number;
  maxResponseBytes: number;
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

export class WikimediaCommonsClient {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: WikimediaCommonsClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs;
    this.maxResponseBytes = options.maxResponseBytes;
  }

  async search(query: string, limit: number): Promise<WikimediaCommonsCandidate[]> {
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
    url.searchParams.set("format", "json");

    let payload: unknown;
    try {
      payload = await this.request(url);
    } catch {
      return [];
    }

    return parseSearchResponse(payload);
  }

  async downloadImage(imageUrl: string): Promise<Buffer> {
    const parsed = safeHttpsUrl(imageUrl);
    if (!parsed || parsed.host !== "upload.wikimedia.org") {
      throw new WikimediaCommonsClientError();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(parsed.toString(), {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });
      if (!response.ok) throw new WikimediaCommonsClientError();
      return await readBoundedBody(response, this.maxResponseBytes, controller);
    } catch (error) {
      if (error instanceof WikimediaCommonsClientError) throw error;
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
      if (!response.ok) throw new WikimediaCommonsClientError();
      const body = await readBoundedBody(response, this.maxResponseBytes, controller);
      try {
        return JSON.parse(body.toString("utf8"));
      } catch {
        throw new WikimediaCommonsClientError();
      }
    } catch (error) {
      if (error instanceof WikimediaCommonsClientError) throw error;
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

    candidates.push({
      sourceName: "wikimedia-commons",
      title,
      pageUrl,
      imageUrl,
      mimeType,
      width,
      height,
      license,
      attribution: artist ?? credit,
    });
  }

  return candidates;
}

function stripHtml(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const stripped = value.replace(/<[^>]*>/g, "").trim();
  return stripped.length > 0 ? stripped.slice(0, 300) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
