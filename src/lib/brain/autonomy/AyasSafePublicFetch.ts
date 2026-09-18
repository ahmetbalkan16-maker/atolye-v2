import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { URL } from "node:url";

/**
 * AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint, Part D — the ONLY module in
 * this codebase allowed to make an outbound HTTP(S) request to a
 * researcher-supplied/registry-supplied URL. Every other AYAS module that
 * needs public web content goes through this one, never `fetch`/`http`/
 * `https` directly, so the SSRF/size/redirect/content-type boundary below is
 * enforced exactly once, in exactly one place.
 *
 * Threat model: a malicious or compromised source URL (or a source whose DNS
 * answer changes between "looks safe" and "actually connects" — DNS
 * rebinding) must never let AYAS reach the local machine, the local network,
 * or a cloud metadata endpoint. This is closed by resolving DNS ourselves
 * via a custom `lookup` passed straight into `http(s).request` — Node then
 * connects to EXACTLY the IP this module already validated, never a second,
 * independently-resolved address, which is what makes this immune to DNS
 * rebinding (a naive "resolve, check, then let `fetch` resolve again and
 * connect" implementation is not).
 *
 * No cookies are read or sent (a fresh request every time, `Cookie` never
 * set, `Set-Cookie` never processed). No `Authorization` header is ever
 * sent. No repository content, `.env` value, API key, or private runtime
 * state is ever included in a request — callers only ever pass a bounded,
 * fixed prompt-shaped snippet of ALREADY-PUBLIC source-registry metadata
 * (nothing from this fetch layer's own call sites reads secrets at all).
 */

export type AyasSafeFetchErrorCode =
  | "AYAS_FETCH_UNSUPPORTED_PROTOCOL"
  | "AYAS_FETCH_INVALID_URL"
  | "AYAS_FETCH_BLOCKED_HOST"
  | "AYAS_FETCH_DNS_FAILED"
  | "AYAS_FETCH_BLOCKED_RESOLVED_IP"
  | "AYAS_FETCH_TIMEOUT"
  | "AYAS_FETCH_TOO_MANY_REDIRECTS"
  | "AYAS_FETCH_REDIRECT_BLOCKED"
  | "AYAS_FETCH_REDIRECT_MISSING_LOCATION"
  | "AYAS_FETCH_BODY_TOO_LARGE"
  | "AYAS_FETCH_UNSUPPORTED_CONTENT_TYPE"
  | "AYAS_FETCH_NETWORK_ERROR"
  | "AYAS_FETCH_RATE_LIMITED"
  | "AYAS_FETCH_HTTP_ERROR";

/**
 * AYAS EXTERNAL RESEARCH INTELLIGENCE sprint — the failure TAXONOMY every
 * research caller classifies a fetch outcome by, instead of re-deriving
 * "was that worth retrying?" from a raw code at each call site.
 *
 * - `TRANSIENT` — a blip (connection reset, read timeout, momentary DNS
 *   failure). Retrying the same URL shortly is reasonable, and this is the
 *   ONLY class this module ever retries automatically.
 * - `RATE_LIMIT` — the endpoint explicitly said "too many requests".
 *   Deliberately NOT retried inline: a provider's reset window is
 *   minutes-to-an-hour, so a same-scan retry would be exactly the
 *   "continuous open-ended crawling" the research policy forbids. The
 *   caller backs the source off instead.
 * - `PERMANENT_ENDPOINT` — the endpoint answered and its answer was a
 *   durable no (HTTP error, a redirect that goes nowhere). Retrying inside
 *   one scan cannot change it.
 * - `UNSUPPORTED_CONTENT` — reached and readable, but not a content type
 *   this system knows how to parse deterministically.
 * - `POLICY` — refused by THIS module's own SSRF/protocol/size boundary.
 *   Never retried: a retry would only re-run the identical refusal.
 */
export type AyasFetchFailureClass = "TRANSIENT" | "RATE_LIMIT" | "PERMANENT_ENDPOINT" | "UNSUPPORTED_CONTENT" | "POLICY";

export function classifyAyasFetchFailure(code: AyasSafeFetchErrorCode): AyasFetchFailureClass {
  switch (code) {
    case "AYAS_FETCH_NETWORK_ERROR":
    case "AYAS_FETCH_TIMEOUT":
    case "AYAS_FETCH_DNS_FAILED":
      return "TRANSIENT";
    case "AYAS_FETCH_RATE_LIMITED":
      return "RATE_LIMIT";
    case "AYAS_FETCH_HTTP_ERROR":
    case "AYAS_FETCH_REDIRECT_MISSING_LOCATION":
    case "AYAS_FETCH_REDIRECT_BLOCKED":
    case "AYAS_FETCH_TOO_MANY_REDIRECTS":
      return "PERMANENT_ENDPOINT";
    case "AYAS_FETCH_UNSUPPORTED_CONTENT_TYPE":
      return "UNSUPPORTED_CONTENT";
    case "AYAS_FETCH_UNSUPPORTED_PROTOCOL":
    case "AYAS_FETCH_INVALID_URL":
    case "AYAS_FETCH_BLOCKED_HOST":
    case "AYAS_FETCH_BLOCKED_RESOLVED_IP":
    case "AYAS_FETCH_BODY_TOO_LARGE":
      return "POLICY";
    default:
      return "PERMANENT_ENDPOINT"; // fail closed — an unrecognized code is never treated as retryable
  }
}

export interface AyasSafeFetchOptions {
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
  readonly maxRedirects?: number;
  /** Conditional GET support for the LIGHT scan's cheap change check. */
  readonly ifNoneMatch?: string;
  readonly ifModifiedSince?: string;
  /**
   * Opt-in: accept the BOUNDED PREFIX of a response that exceeds
   * `maxBodyBytes` (returned with `truncated: true`) instead of failing the
   * whole fetch with `AYAS_FETCH_BODY_TOO_LARGE`.
   *
   * This exists because a large response is not, by itself, an error for
   * this system's actual callers. A legitimate official release feed can be
   * well over a megabyte purely because its release notes are long
   * (`nodejs/node`, `huggingface/transformers` and `OpenShot/openshot-qt`
   * all are), and the LIGHT scan only needs a deterministic change signal
   * while the DEEP scan only reads the first few `<entry>` blocks — which
   * for a newest-first feed are at the very START of the body. Refusing
   * such a source outright would permanently blind AYAS to the most active
   * projects it watches, which is the opposite of the intent behind the
   * size bound.
   *
   * The size bound itself is NOT relaxed: at most `maxBodyBytes` are ever
   * read into memory, the connection is still cut at the bound, and nothing
   * here can turn into a full-site dump. Default `false`, so a caller that
   * genuinely needs a complete body keeps the strict, fail-closed behavior.
   */
  readonly acceptTruncatedBody?: boolean;
  /**
   * Bounded automatic retries for TRANSIENT failures only (see
   * `classifyAyasFetchFailure`). Default `0` — this primitive stays a
   * single, predictable request unless a caller explicitly opts into a
   * retry policy, so the retry decision is always visible at the call site
   * rather than hidden in the transport. Capped by
   * `AYAS_SAFE_FETCH_MAX_RETRIES_CAP` regardless of what is passed.
   */
  readonly maxRetries?: number;
  /** Base delay for the exponential + full-jitter backoff between retries. Exposed so a test can drive the retry path deterministically without real waiting. */
  readonly retryBaseDelayMs?: number;
  /**
   * Test-only. Disables the private-network/SSRF block (protocol and
   * content-type allowlisting still apply) so this module's own smoke test
   * can run a fully offline, deterministic clean-room suite against a real
   * `127.0.0.1` fixture server instead of depending on internet access or a
   * second, parallel test-only fetch implementation. No production caller
   * in this codebase (the light/deep research engines, the scheduler) ever
   * sets this — grep for it before adding a new caller that does.
   */
  readonly dangerouslyAllowPrivateNetworkForTests?: boolean;
}

export interface AyasSafeFetchSuccess {
  readonly ok: true;
  readonly status: number;
  /** `true` only for a real HTTP 304 against a conditional request — the LIGHT scan's "nothing changed" fast path. `body` is always `""` in that case. */
  readonly notModified: boolean;
  readonly finalUrl: string;
  readonly contentType: string;
  readonly body: string;
  readonly truncated: boolean;
  readonly etag?: string;
  readonly lastModified?: string;
}

export interface AyasSafeFetchFailure {
  readonly ok: false;
  readonly code: AyasSafeFetchErrorCode;
  readonly message: string;
  /** Derived from `code` — carried on the failure so a caller never has to re-classify, and so a persisted health record keeps the class it was actually judged by. */
  readonly failureClass: AyasFetchFailureClass;
  /** Only for `AYAS_FETCH_RATE_LIMITED`, and only when the endpoint stated a `Retry-After` this module could parse. Advisory for the caller's own backoff — never slept on inside this module. */
  readonly retryAfterMs?: number;
  /** How many attempts were actually made (1 when no retry was configured or the failure was not retryable). */
  readonly attempts: number;
}

function fail(code: AyasSafeFetchErrorCode, message: string, extra: { readonly retryAfterMs?: number; readonly attempts?: number } = {}): AyasSafeFetchFailure {
  return { ok: false, code, message, failureClass: classifyAyasFetchFailure(code), attempts: extra.attempts ?? 1, ...(extra.retryAfterMs === undefined ? {} : { retryAfterMs: extra.retryAfterMs }) };
}

export type AyasSafeFetchOutcome = AyasSafeFetchSuccess | AyasSafeFetchFailure;

export const AYAS_SAFE_FETCH_DEFAULT_TIMEOUT_MS = 10_000;
export const AYAS_SAFE_FETCH_DEFAULT_MAX_BODY_BYTES = 2_000_000; // 2 MB — bounded evidence, never a full-site dump
export const AYAS_SAFE_FETCH_DEFAULT_MAX_REDIRECTS = 5;
export const AYAS_SAFE_FETCH_USER_AGENT = "AtolyeAYAS-ResearchBot/1 (+read-only capability research; https://github.com/)";

/** Content types Part D's DEEP/LIGHT research callers know how to safely, deterministically parse. Anything else is refused rather than silently mis-parsed as text. */
const ALLOWED_CONTENT_TYPES = [
  "text/html",
  "application/json",
  "application/rss+xml",
  "application/atom+xml",
  "text/xml",
  "application/xml",
  "text/plain",
];

function isAllowedContentType(contentType: string): boolean {
  const base = contentType.split(";")[0]!.trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.includes(base);
}

// --- SSRF blocklist -----------------------------------------------------

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true; // malformed -> fail closed
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // "this network"
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local, INCLUDES the 169.254.169.254 cloud metadata address
  if (a === 100 && b >= 64 && b <= 127) return true; // RFC6598 carrier-grade NAT
  if (a >= 224) return true; // multicast/reserved (224.0.0.0 - 255.255.255.255)
  return false;
}

function isBlockedIPv6(ipRaw: string): boolean {
  const ip = ipRaw.toLowerCase();
  if (ip === "::1" || ip === "::" ) return true; // loopback / unspecified
  if (/^fe[89ab][0-9a-f]:/.test(ip) || ip.startsWith("fe80::")) return true; // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{0,2}:/.test(ip)) return true; // fc00::/7 unique local
  if (ip.startsWith("::ffff:")) {
    const v4 = ip.slice("::ffff:".length);
    if (net.isIPv4(v4)) return isBlockedIPv4(v4);
  }
  return false;
}

function isBlockedResolvedAddress(address: string, family: number): boolean {
  return family === 4 ? isBlockedIPv4(address) : isBlockedIPv6(address);
}

const BLOCKED_HOSTNAME_LITERALS = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback", "metadata.google.internal"]);

function isSyntacticallyBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAME_LITERALS.has(h)) return true;
  if (h.endsWith(".localhost")) return true;
  if (h.endsWith(".local")) return true; // mDNS — never a public research source
  if (h.endsWith(".internal")) return true;
  return false;
}

/**
 * The custom `lookup` handed to `http(s).request`. Resolves DNS itself
 * (`dns.lookup` with `all: true` so every returned address is checked, not
 * just the one that happens to be tried first), rejects if ANY resolved
 * address is non-public, and then returns exactly the address(es) it
 * validated — Node connects to one of those and never re-resolves. This is
 * the anti-DNS-rebinding guarantee this module is built around.
 *
 * `dns.lookup`'s callback contract is polymorphic on its OWN `all` option —
 * `(err, address, family)` normally, `(err, addresses[])` when `all: true`
 * — and Node's own `net.connect` relies on that polymorphism itself: modern
 * Node (Happy Eyeballs / `autoSelectFamily`, on by default) calls a custom
 * `lookup` with `options.all = true` and expects the ARRAY form back, not
 * the single-address form. A `lookup` that always replies in single-address
 * form breaks that internal dual-stack path outright (confirmed live: every
 * HTTPS request failed with Node's own internal `ERR_INVALID_IP_ADDRESS`
 * until this honored `options.all`) — so this mirrors `dns.lookup`'s own
 * contract exactly rather than assuming one fixed shape.
 */
type AyasLookupAllCallback = (err: NodeJS.ErrnoException | null, address: string | readonly { readonly address: string; readonly family: number }[], family?: number) => void;

/**
 * `allowPrivateNetwork` exists ONLY so this module's own smoke test can run
 * fully offline against a real `127.0.0.1` fixture server — matching the
 * sprint's own clean-room requirement ("use local HTTP fixture servers for
 * hostile/network security tests") without maintaining a second, parallel
 * fetch implementation that could silently drift from the real one. It is a
 * closure captured once per `ayasSafePublicFetch` CALL (see
 * `makeAyasSafeLookup` below), never a persistent/global toggle, and is
 * wired to exactly one option (`dangerouslyAllowPrivateNetworkForTests`)
 * that every real production call site in this codebase leaves unset.
 */
function makeAyasSafeLookup(allowPrivateNetwork: boolean): (hostname: string, options: { readonly all?: boolean }, cb: AyasLookupAllCallback) => void {
  return (hostname, options, cb) => {
    const wantsAll = options?.all === true;
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) { cb(err, wantsAll ? [] : "", 4); return; }
      const list = addresses as readonly { readonly address: string; readonly family: number }[];
      if (!list || list.length === 0) {
        const notFound = new Error("AYAS_FETCH_DNS_NO_RESULTS") as NodeJS.ErrnoException;
        notFound.code = "ENOTFOUND";
        cb(notFound, wantsAll ? [] : "", 4);
        return;
      }
      const blocked = allowPrivateNetwork ? undefined : list.find((a) => isBlockedResolvedAddress(a.address, a.family));
      if (blocked) {
        const blockedErr = new Error(`AYAS_FETCH_BLOCKED_RESOLVED_IP: ${hostname} resolved to non-public address ${blocked.address}`) as NodeJS.ErrnoException;
        blockedErr.code = "AYAS_FETCH_BLOCKED_RESOLVED_IP";
        cb(blockedErr, wantsAll ? [] : "", 4);
        return;
      }
      if (wantsAll) { cb(null, list); return; }
      const chosen = list[0]!;
      cb(null, chosen.address, chosen.family);
    });
  };
}

function validateUrlSyntax(rawUrl: string, allowPrivateNetwork: boolean): { readonly ok: true; readonly url: URL } | { readonly ok: false; readonly code: AyasSafeFetchErrorCode; readonly message: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, code: "AYAS_FETCH_INVALID_URL", message: `not a valid URL: ${rawUrl}` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, code: "AYAS_FETCH_UNSUPPORTED_PROTOCOL", message: `unsupported protocol: ${url.protocol}` };
  }
  const hostname = url.hostname.toLowerCase();
  if (!allowPrivateNetwork) {
    if (isSyntacticallyBlockedHost(hostname)) {
      return { ok: false, code: "AYAS_FETCH_BLOCKED_HOST", message: `blocked host: ${hostname}` };
    }
    if (net.isIP(hostname)) {
      const family = net.isIPv6(hostname) ? 6 : 4;
      if (isBlockedResolvedAddress(hostname, family)) {
        return { ok: false, code: "AYAS_FETCH_BLOCKED_HOST", message: `literal IP target is not a public address: ${hostname}` };
      }
    }
  }
  return { ok: true, url };
}

interface OneRequestResult {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
  readonly truncated: boolean;
}

function performOneRequest(url: URL, options: Required<Pick<AyasSafeFetchOptions, "timeoutMs" | "maxBodyBytes">> & Pick<AyasSafeFetchOptions, "ifNoneMatch" | "ifModifiedSince" | "dangerouslyAllowPrivateNetworkForTests">): Promise<OneRequestResult | { readonly error: AyasSafeFetchFailure }> {
  return new Promise((resolveRaw) => {
    // Every path below settles through this guard, and the FIRST settle
    // wins. That is what makes the size bound deterministic: hitting the
    // bound settles the outcome and only THEN destroys the request, so the
    // `'error'` event that tearing down a live stream necessarily emits can
    // no longer overwrite the real reason with a generic network error.
    //
    // Regression this closes (observed in production, four official feeds
    // stuck at `AYAS_FETCH_NETWORK_ERROR: response stream error` for three
    // consecutive cycles): `req.destroy()` was previously called from
    // inside the `data` handler BEFORE anything resolved, so `res` emitted
    // `'error'` instead of `'end'` and the oversize verdict was lost. It
    // only reproduced against a body big enough to span multiple TCP reads
    // — a small fixture body arrives complete before the destroy takes
    // effect and still emits `'end'`, which is exactly why the existing
    // 10 KB oversize test passed against the broken code.
    let settled = false;
    const resolve = (value: OneRequestResult | { readonly error: AyasSafeFetchFailure }): void => {
      if (settled) return;
      settled = true;
      resolveRaw(value);
    };
    const transport = url.protocol === "https:" ? https : http;
    const headers: Record<string, string> = {
      "User-Agent": AYAS_SAFE_FETCH_USER_AGENT,
      Accept: ALLOWED_CONTENT_TYPES.join(", ") + ";q=0.9, */*;q=0.1",
      Connection: "close",
    };
    if (options.ifNoneMatch) headers["If-None-Match"] = options.ifNoneMatch;
    if (options.ifModifiedSince) headers["If-Modified-Since"] = options.ifModifiedSince;

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers,
        // The DNS-rebinding-safe custom resolver — see `ayasSafeLookup` above.
        lookup: makeAyasSafeLookup(options.dangerouslyAllowPrivateNetworkForTests === true) as unknown as typeof dns.lookup,
        timeout: options.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          if (truncated) return;
          const room = options.maxBodyBytes - total;
          if (chunk.length > room) {
            // Keep EXACTLY the bounded prefix (never one byte more), settle
            // the oversize verdict, and only then tear the connection down.
            truncated = true;
            if (room > 0) chunks.push(chunk.subarray(0, room));
            total = options.maxBodyBytes;
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), truncated: true });
            req.destroy();
            return;
          }
          total += chunk.length;
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), truncated });
        });
        res.on("error", () => {
          resolve({ error: fail("AYAS_FETCH_NETWORK_ERROR", "response stream error") });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ error: fail("AYAS_FETCH_TIMEOUT", `request timed out after ${options.timeoutMs}ms`) });
    });
    req.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "AYAS_FETCH_BLOCKED_RESOLVED_IP") {
        resolve({ error: fail("AYAS_FETCH_BLOCKED_RESOLVED_IP", err.message) });
      } else if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
        resolve({ error: fail("AYAS_FETCH_DNS_FAILED", err.message) });
      } else {
        resolve({ error: fail("AYAS_FETCH_NETWORK_ERROR", err.message) });
      }
    });
    req.end();
  });
}

/**
 * The single entrypoint every research module uses. Follows redirects
 * itself (never delegates to the HTTP client's own redirect handling) so
 * EVERY hop — not just the first URL — goes through the full protocol +
 * host + resolved-IP validation above.
 */
async function ayasSafePublicFetchOnce(rawUrl: string, options: AyasSafeFetchOptions = {}): Promise<AyasSafeFetchOutcome> {
  const timeoutMs = options.timeoutMs ?? AYAS_SAFE_FETCH_DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? AYAS_SAFE_FETCH_DEFAULT_MAX_BODY_BYTES;
  const maxRedirects = options.maxRedirects ?? AYAS_SAFE_FETCH_DEFAULT_MAX_REDIRECTS;

  const allowPrivateNetwork = options.dangerouslyAllowPrivateNetworkForTests === true;
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validated = validateUrlSyntax(currentUrl, allowPrivateNetwork);
    if (!validated.ok) return fail(validated.code, validated.message);

    const result = await performOneRequest(validated.url, { timeoutMs, maxBodyBytes, ifNoneMatch: options.ifNoneMatch, ifModifiedSince: options.ifModifiedSince, dangerouslyAllowPrivateNetworkForTests: allowPrivateNetwork });
    if ("error" in result) return result.error;

    if (result.status === 304) {
      return { ok: true, status: 304, notModified: true, finalUrl: validated.url.toString(), contentType: "", body: "", truncated: false, etag: typeof result.headers.etag === "string" ? result.headers.etag : undefined, lastModified: typeof result.headers["last-modified"] === "string" ? result.headers["last-modified"] : undefined };
    }

    if (result.status >= 300 && result.status < 400) {
      const location = result.headers.location;
      if (!location || typeof location !== "string") return fail("AYAS_FETCH_REDIRECT_MISSING_LOCATION", `HTTP ${result.status} with no Location header`);
      let nextUrl: string;
      try { nextUrl = new URL(location, validated.url).toString(); } catch { return fail("AYAS_FETCH_REDIRECT_BLOCKED", `redirect Location is not a resolvable URL: ${location}`); }
      currentUrl = nextUrl;
      continue;
    }

    // An explicit rate-limit answer is its own class, never a generic HTTP
    // error: the caller must back the source off rather than treat it as a
    // broken endpoint. GitHub signals an exhausted quota as 403 with
    // `x-ratelimit-remaining: 0`, which is why status alone is not enough.
    const rateLimited = result.status === 429 || (result.status === 403 && String(result.headers["x-ratelimit-remaining"] ?? "").trim() === "0");
    if (rateLimited) {
      return fail("AYAS_FETCH_RATE_LIMITED", `HTTP ${result.status} (rate limited)`, { retryAfterMs: parseRetryAfterMs(result.headers) });
    }

    if (result.truncated && options.acceptTruncatedBody !== true) {
      return fail("AYAS_FETCH_BODY_TOO_LARGE", `response exceeded ${maxBodyBytes} bytes`);
    }

    if (result.status < 200 || result.status >= 300) {
      return fail("AYAS_FETCH_HTTP_ERROR", `HTTP ${result.status}`);
    }

    const contentType = typeof result.headers["content-type"] === "string" ? result.headers["content-type"] : "";
    if (!isAllowedContentType(contentType)) {
      return fail("AYAS_FETCH_UNSUPPORTED_CONTENT_TYPE", `unsupported content-type: ${contentType || "(none)"}`);
    }

    return {
      ok: true,
      status: result.status,
      notModified: false,
      finalUrl: validated.url.toString(),
      contentType,
      body: result.body,
      truncated: result.truncated,
      etag: typeof result.headers.etag === "string" ? result.headers.etag : undefined,
      lastModified: typeof result.headers["last-modified"] === "string" ? result.headers["last-modified"] : undefined,
    };
  }
  return fail("AYAS_FETCH_TOO_MANY_REDIRECTS", `exceeded ${maxRedirects} redirects`);
}

/** Hard ceiling on retries no caller can exceed — research must stay bounded and auditable, never an open-ended hammer on someone else's endpoint. */
export const AYAS_SAFE_FETCH_MAX_RETRIES_CAP = 3;
export const AYAS_SAFE_FETCH_DEFAULT_RETRY_BASE_DELAY_MS = 400;
const AYAS_SAFE_FETCH_MAX_RETRY_DELAY_MS = 4_000;

function parseRetryAfterMs(headers: http.IncomingHttpHeaders): number | undefined {
  const raw = headers["retry-after"];
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60 * 60_000);
  const at = Date.parse(raw.trim()); // the HTTP-date form
  if (!Number.isNaN(at)) return Math.max(0, Math.min(at - Date.now(), 60 * 60_000));
  return undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * The single entrypoint every research module uses — a bounded retry
 * wrapper around one fully-validated request/redirect chain.
 *
 * Retries are deliberately conservative: only `TRANSIENT` failures, only up
 * to the caller's `maxRetries` (default 0, hard-capped at
 * `AYAS_SAFE_FETCH_MAX_RETRIES_CAP`), with exponential backoff plus FULL
 * jitter so a scan that hits a shared outage does not resynchronize every
 * source into one thundering retry. A rate-limit answer is never retried
 * here — see `classifyAyasFetchFailure`.
 */
export async function ayasSafePublicFetch(rawUrl: string, options: AyasSafeFetchOptions = {}): Promise<AyasSafeFetchOutcome> {
  const maxRetries = Math.max(0, Math.min(Math.trunc(options.maxRetries ?? 0), AYAS_SAFE_FETCH_MAX_RETRIES_CAP));
  const baseDelayMs = Math.max(0, options.retryBaseDelayMs ?? AYAS_SAFE_FETCH_DEFAULT_RETRY_BASE_DELAY_MS);

  let attempt = 0;
  for (;;) {
    const outcome = await ayasSafePublicFetchOnce(rawUrl, options);
    attempt += 1;
    if (outcome.ok) return outcome;
    if (attempt > maxRetries || outcome.failureClass !== "TRANSIENT") {
      return { ...outcome, attempts: attempt };
    }
    const ceiling = Math.min(baseDelayMs * 2 ** (attempt - 1), AYAS_SAFE_FETCH_MAX_RETRY_DELAY_MS);
    await sleep(Math.floor(Math.random() * (ceiling + 1))); // full jitter
  }
}

/** Exported for tests only — the pure, side-effect-free half of the SSRF boundary. */
export const __testables = { isBlockedIPv4, isBlockedIPv6, isSyntacticallyBlockedHost, isAllowedContentType };
