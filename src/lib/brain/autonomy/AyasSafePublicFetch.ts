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
  | "AYAS_FETCH_HTTP_ERROR";

export interface AyasSafeFetchOptions {
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
  readonly maxRedirects?: number;
  /** Conditional GET support for the LIGHT scan's cheap change check. */
  readonly ifNoneMatch?: string;
  readonly ifModifiedSince?: string;
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
  return new Promise((resolve) => {
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
          total += chunk.length;
          if (total > options.maxBodyBytes) {
            truncated = true;
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), truncated });
        });
        res.on("error", () => {
          resolve({ error: { ok: false, code: "AYAS_FETCH_NETWORK_ERROR", message: "response stream error" } });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ error: { ok: false, code: "AYAS_FETCH_TIMEOUT", message: `request timed out after ${options.timeoutMs}ms` } });
    });
    req.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "AYAS_FETCH_BLOCKED_RESOLVED_IP") {
        resolve({ error: { ok: false, code: "AYAS_FETCH_BLOCKED_RESOLVED_IP", message: err.message } });
      } else {
        resolve({ error: { ok: false, code: "AYAS_FETCH_NETWORK_ERROR", message: err.message } });
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
export async function ayasSafePublicFetch(rawUrl: string, options: AyasSafeFetchOptions = {}): Promise<AyasSafeFetchOutcome> {
  const timeoutMs = options.timeoutMs ?? AYAS_SAFE_FETCH_DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? AYAS_SAFE_FETCH_DEFAULT_MAX_BODY_BYTES;
  const maxRedirects = options.maxRedirects ?? AYAS_SAFE_FETCH_DEFAULT_MAX_REDIRECTS;

  const allowPrivateNetwork = options.dangerouslyAllowPrivateNetworkForTests === true;
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validated = validateUrlSyntax(currentUrl, allowPrivateNetwork);
    if (!validated.ok) return { ok: false, code: validated.code, message: validated.message };

    const result = await performOneRequest(validated.url, { timeoutMs, maxBodyBytes, ifNoneMatch: options.ifNoneMatch, ifModifiedSince: options.ifModifiedSince, dangerouslyAllowPrivateNetworkForTests: allowPrivateNetwork });
    if ("error" in result) return result.error;

    if (result.status === 304) {
      return { ok: true, status: 304, notModified: true, finalUrl: validated.url.toString(), contentType: "", body: "", truncated: false, etag: typeof result.headers.etag === "string" ? result.headers.etag : undefined, lastModified: typeof result.headers["last-modified"] === "string" ? result.headers["last-modified"] : undefined };
    }

    if (result.status >= 300 && result.status < 400) {
      const location = result.headers.location;
      if (!location || typeof location !== "string") return { ok: false, code: "AYAS_FETCH_REDIRECT_MISSING_LOCATION", message: `HTTP ${result.status} with no Location header` };
      let nextUrl: string;
      try { nextUrl = new URL(location, validated.url).toString(); } catch { return { ok: false, code: "AYAS_FETCH_REDIRECT_BLOCKED", message: `redirect Location is not a resolvable URL: ${location}` }; }
      currentUrl = nextUrl;
      continue;
    }

    if (result.truncated) return { ok: false, code: "AYAS_FETCH_BODY_TOO_LARGE", message: `response exceeded ${maxBodyBytes} bytes` };

    if (result.status < 200 || result.status >= 300) {
      return { ok: false, code: "AYAS_FETCH_HTTP_ERROR", message: `HTTP ${result.status}` };
    }

    const contentType = typeof result.headers["content-type"] === "string" ? result.headers["content-type"] : "";
    if (!isAllowedContentType(contentType)) {
      return { ok: false, code: "AYAS_FETCH_UNSUPPORTED_CONTENT_TYPE", message: `unsupported content-type: ${contentType || "(none)"}` };
    }

    return {
      ok: true,
      status: result.status,
      notModified: false,
      finalUrl: validated.url.toString(),
      contentType,
      body: result.body,
      truncated: false,
      etag: typeof result.headers.etag === "string" ? result.headers.etag : undefined,
      lastModified: typeof result.headers["last-modified"] === "string" ? result.headers["last-modified"] : undefined,
    };
  }
  return { ok: false, code: "AYAS_FETCH_TOO_MANY_REDIRECTS", message: `exceeded ${maxRedirects} redirects` };
}

/** Exported for tests only — the pure, side-effect-free half of the SSRF boundary. */
export const __testables = { isBlockedIPv4, isBlockedIPv6, isSyntacticallyBlockedHost, isAllowedContentType };
