/**
 * Bekçi's GET to a FIXED public host (GitHub's advisory API, raw.githubusercontent.com, GitHub release downloads).
 *
 * Why not AyasSafePublicFetch: that module is for researcher- or registry-supplied URLs and is mapped as owner/leased
 * work in the pinned firewall closure audit (scripts/smoke-ayas-action-firewall-closure.ts); a new entry point that
 * imports it must be named there, which only an owner-approved eval-pin bump may do. Every URL here is built in code
 * from package names and versions, like the osv.dev check (AyasDependencyVulnerabilities) does with the global fetch,
 * so the SSRF/rebinding surface the safe fetch closes does not arise. The same boundaries are kept anyway: https only,
 * an explicit host list checked on every redirect hop, GET only, no cookies or credentials, a generic User-Agent,
 * a time limit and a byte cap. Nothing about the owner or the machine is sent.
 */

export const SECURITY_FETCH_USER_AGENT = "Atolye-Bekci/1 (read-only security advisories)";

export type FixedFetchFailureCode = "HOST" | "RATE_LIMITED" | "HTTP" | "NETWORK" | "TIMEOUT" | "TOO_LARGE" | "REDIRECT";

export type FixedFetchOutcome =
  | { readonly ok: true; readonly status: number; readonly notModified: boolean; readonly body: Buffer; readonly etag?: string; readonly link?: string; readonly rateRemaining?: number; readonly rateResetMs?: number; readonly finalUrl: string }
  | { readonly ok: false; readonly code: FixedFetchFailureCode; readonly message: string; readonly rateResetMs?: number; readonly rateRemaining?: number };

export type FetchLike = (url: string, init: { method: "GET"; redirect: "manual"; headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

export interface FixedFetchOptions {
  readonly allowedHosts: readonly string[];
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly ifNoneMatch?: string;
  readonly accept?: string;
  readonly maxRedirects?: number;
  /** Injected in tests; the global fetch otherwise. */
  readonly fetchImpl?: FetchLike;
}

function hostAllowed(raw: string, hosts: readonly string[]): URL | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
  return hosts.includes(url.hostname) ? url : null;
}

const num = (value: string | null): number | undefined => (value !== null && /^\d+$/.test(value) ? Number(value) : undefined);

export async function fixedHostGet(rawUrl: string, options: FixedFetchOptions): Promise<FixedFetchOutcome> {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const maxBytes = options.maxBytes ?? 2_000_000;
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  let current = rawUrl;
  for (let hop = 0; hop <= (options.maxRedirects ?? 0); hop++) {
    const url = hostAllowed(current, options.allowedHosts);
    if (!url) return { ok: false, code: "HOST", message: `izin verilmeyen adres: ${current.slice(0, 120)}` };
    const headers: Record<string, string> = { "User-Agent": SECURITY_FETCH_USER_AGENT, Accept: options.accept ?? "application/json" };
    if (url.hostname === "api.github.com") headers["X-GitHub-Api-Version"] = "2022-11-28";
    if (options.ifNoneMatch && hop === 0) headers["If-None-Match"] = options.ifNoneMatch;
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), { method: "GET", redirect: "manual", headers, signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
    } catch (error) {
      const name = (error as { name?: string }).name;
      return { ok: false, code: name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "NETWORK", message: (error instanceof Error ? error.message : String(error)).slice(0, 160) };
    }
    const rateRemaining = num(response.headers.get("x-ratelimit-remaining"));
    const reset = num(response.headers.get("x-ratelimit-reset"));
    const rateResetMs = reset !== undefined ? reset * 1000 : undefined;
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, code: "REDIRECT", message: `HTTP ${response.status} adressiz yönlendirme` };
      current = new URL(location, url).toString();
      continue;
    }
    if (response.status === 304) return { ok: true, status: 304, notModified: true, body: Buffer.alloc(0), finalUrl: url.toString(), ...(rateRemaining !== undefined ? { rateRemaining } : {}), ...(rateResetMs ? { rateResetMs } : {}) };
    if (response.status === 429 || (response.status === 403 && rateRemaining === 0)) {
      const retryAfter = num(response.headers.get("retry-after"));
      return { ok: false, code: "RATE_LIMITED", message: `HTTP ${response.status} (hız sınırı)`, rateResetMs: rateResetMs ?? (retryAfter !== undefined ? Date.now() + retryAfter * 1000 : Date.now() + 3600_000), rateRemaining: 0 };
    }
    if (response.status < 200 || response.status >= 300) return { ok: false, code: "HTTP", message: `HTTP ${response.status}` };
    const declared = num(response.headers.get("content-length"));
    if (declared !== undefined && declared > maxBytes) return { ok: false, code: "TOO_LARGE", message: `${declared} bayt (sınır ${maxBytes})` };
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    if (reader) {
      for (;;) {
        let part: ReadableStreamReadResult<Uint8Array>;
        try { part = await reader.read(); } catch (error) { return { ok: false, code: "NETWORK", message: (error instanceof Error ? error.message : String(error)).slice(0, 160) }; }
        if (part.done) break;
        total += part.value.byteLength;
        if (total > maxBytes) { await reader.cancel().catch(() => undefined); return { ok: false, code: "TOO_LARGE", message: `${maxBytes} bayttan büyük` }; }
        chunks.push(Buffer.from(part.value));
      }
    }
    const etag = response.headers.get("etag") ?? undefined;
    const link = response.headers.get("link") ?? undefined;
    return { ok: true, status: response.status, notModified: false, body: Buffer.concat(chunks), finalUrl: url.toString(), ...(etag ? { etag } : {}), ...(link ? { link } : {}), ...(rateRemaining !== undefined ? { rateRemaining } : {}), ...(rateResetMs ? { rateResetMs } : {}) };
  }
  return { ok: false, code: "REDIRECT", message: "çok fazla yönlendirme" };
}

/** GitHub's `Link: <…>; rel="next"` → the next page URL. */
export function nextPageUrl(link: string | undefined): string | null {
  const m = /<([^>]+)>;\s*rel="next"/.exec(link ?? "");
  return m ? m[1]! : null;
}
