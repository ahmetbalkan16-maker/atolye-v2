/**
 * Known vulnerabilities of an npm lock's packages, from OSV (osv.dev: the open vulnerability database Google's
 * osv-scanner reads; owner 2026-11-02 after the @selahattinunlu Shorts review, "hangisi bizi geliştirecekse kullan").
 * The lock is read here, every installed name@version is asked in batches, and each vulnerability found is looked up
 * once for its severity. No binary to install or pin: the same data osv-scanner would report, over two HTTPS calls.
 *
 * Fail-closed: any answer that is not a well-formed OSV reply throws, so a check that could not run never reads as
 * "nothing found". Sends only package names and versions (public data), never a file or a secret.
 */
import { compareAyasReleaseVersions } from "./AyasResearchReleaseRelevance";

/** `dev`: reached only from devDependencies (the lock's own flag), so never part of what the app ships. */
export interface AyasLockPackage { readonly name: string; readonly version: string; readonly dev: boolean }

export type AyasVulnerabilitySeverity = "MALICIOUS" | "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";

export interface AyasKnownVulnerability {
  readonly id: string;
  /** name@version of the affected installed package. */
  readonly package: string;
  readonly severity: AyasVulnerabilitySeverity;
  readonly summary: string;
  readonly dev: boolean;
  /** The first version OSV lists as fixed for the installed one, when it lists one. */
  readonly fixedIn?: string;
}

/** An update that brings in one of these is refused; a malicious-package report (OSV `MAL-…`) always is. */
export const AYAS_BLOCKING_VULNERABILITY_SEVERITIES: readonly AyasVulnerabilitySeverity[] = Object.freeze(["MALICIOUS", "CRITICAL", "HIGH"]);

export type AyasOsvFetch = (url: string, init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string; readonly signal?: AbortSignal }) =>
  Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

const OSV = "https://api.osv.dev/v1";
/** OSV's own limit for one batch. */
const BATCH = 1000;
const MAX_PAGES = 10;
const DETAIL_CONCURRENCY = 8;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const OSV_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,80}$/;

type Lock = { readonly packages?: Readonly<Record<string, Readonly<Record<string, unknown>>>> };

/** Every installed package of a lockfile v2/v3, once per name@version (links and the root entry are not packages). */
export function listAyasLockPackages(lock: Lock): readonly AyasLockPackage[] {
  const seen = new Map<string, AyasLockPackage>();
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key || entry.link === true) continue;
    const at = key.lastIndexOf("node_modules/");
    const name = typeof entry.name === "string" ? entry.name : at >= 0 ? key.slice(at + "node_modules/".length) : "";
    const version = entry.version;
    if (!name || typeof version !== "string" || !SEMVER.test(version)) continue;
    // Several copies of one name@version: dev only when every copy is.
    const dev = entry.dev === true && seen.get(`${name}@${version}`)?.dev !== false;
    seen.set(`${name}@${version}`, Object.freeze({ name, version, dev }));
  }
  return Object.freeze([...seen.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)));
}

async function call(fetcher: AyasOsvFetch, url: string, timeoutMs: number, body?: unknown): Promise<Record<string, unknown>> {
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetcher(url, body === undefined ? { signal } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!response.ok) throw new Error(`OSV ${response.status}: ${url.slice(OSV.length)}`);
  const value = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`OSV gave no object: ${url.slice(OSV.length)}`);
  return value as Record<string, unknown>;
}

const idsOf = (result: unknown): string[] => {
  const vulns = (result as { vulns?: unknown } | undefined)?.vulns;
  if (vulns === undefined) return [];
  if (!Array.isArray(vulns)) throw new Error("OSV result is malformed");
  return vulns.map((v) => {
    const id = (v as { id?: unknown }).id;
    if (typeof id !== "string" || !OSV_ID.test(id)) throw new Error("OSV vulnerability id is malformed");
    return id;
  });
};

function severityOf(id: string, detail: Record<string, unknown>): AyasVulnerabilitySeverity {
  if (id.startsWith("MAL-")) return "MALICIOUS";
  const raw = String((detail.database_specific as { severity?: unknown } | undefined)?.severity ?? "").toUpperCase();
  if (raw === "CRITICAL" || raw === "HIGH" || raw === "LOW") return raw;
  if (raw === "MODERATE" || raw === "MEDIUM") return "MODERATE";
  return "UNKNOWN";
}

/** The `fixed` event closing the range the installed version falls in (OSV `affected[].ranges[].events`). */
function fixedVersion(affected: unknown, pkg: AyasLockPackage): string | undefined {
  for (const entry of Array.isArray(affected) ? affected : []) {
    const p = (entry as { package?: { name?: unknown; ecosystem?: unknown } }).package;
    if (p?.name !== pkg.name || p.ecosystem !== "npm") continue;
    for (const range of (entry as { ranges?: unknown }).ranges as { events?: { introduced?: unknown; fixed?: unknown }[] }[] ?? []) {
      let from: string | undefined;
      for (const event of range.events ?? []) {
        if (typeof event.introduced === "string") from = event.introduced;
        if (typeof event.fixed === "string" && SEMVER.test(event.fixed)) {
          const inside = (from === undefined || from === "0" || compareAyasReleaseVersions(pkg.version, from) >= 0) && compareAyasReleaseVersions(pkg.version, event.fixed) < 0;
          if (inside) return event.fixed;
          from = undefined;
        }
      }
    }
  }
  return undefined;
}

/** The known vulnerabilities of a lock's packages, sorted most severe first. */
export async function scanAyasLockVulnerabilities(lock: Lock, options: { readonly fetcher?: AyasOsvFetch; readonly timeoutMs?: number } = {}): Promise<readonly AyasKnownVulnerability[]> {
  const fetcher = options.fetcher ?? (fetch as unknown as AyasOsvFetch);
  const timeoutMs = options.timeoutMs ?? 60_000;
  const packages = listAyasLockPackages(lock);
  const hits: { pkg: AyasLockPackage; id: string }[] = [];
  for (let start = 0; start < packages.length; start += BATCH) {
    const chunk = packages.slice(start, start + BATCH);
    const reply = await call(fetcher, `${OSV}/querybatch`, timeoutMs, { queries: chunk.map((pkg) => ({ package: { name: pkg.name, ecosystem: "npm" }, version: pkg.version })) });
    const results = reply.results;
    if (!Array.isArray(results) || results.length !== chunk.length) throw new Error("OSV batch reply does not match the query");
    for (const [i, result] of results.entries()) {
      const pkg = chunk[i]!;
      for (const id of idsOf(result)) hits.push({ pkg, id });
      // More than one page of vulnerabilities for one package: follow it, bounded.
      let token = (result as { next_page_token?: unknown }).next_page_token;
      for (let page = 0; typeof token === "string" && token && page < MAX_PAGES; page++) {
        const more = await call(fetcher, `${OSV}/query`, timeoutMs, { package: { name: pkg.name, ecosystem: "npm" }, version: pkg.version, page_token: token });
        for (const id of idsOf(more)) hits.push({ pkg, id });
        token = more.next_page_token;
      }
    }
  }
  const ids = [...new Set(hits.map((hit) => hit.id))];
  const details = new Map<string, { severity: AyasVulnerabilitySeverity; summary: string; affected: unknown }>();
  for (let start = 0; start < ids.length; start += DETAIL_CONCURRENCY) {
    await Promise.all(ids.slice(start, start + DETAIL_CONCURRENCY).map(async (id) => {
      const detail = await call(fetcher, `${OSV}/vulns/${encodeURIComponent(id)}`, timeoutMs);
      details.set(id, { severity: severityOf(id, detail), summary: String(detail.summary ?? "").replace(/\s+/g, " ").slice(0, 160), affected: detail.affected });
    }));
  }
  const rank = (s: AyasVulnerabilitySeverity) => ["MALICIOUS", "CRITICAL", "HIGH", "MODERATE", "LOW", "UNKNOWN"].indexOf(s);
  const seen = new Set<string>();
  return Object.freeze(hits.flatMap(({ pkg, id }) => {
    const key = `${id}|${pkg.name}@${pkg.version}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const { severity, summary, affected } = details.get(id)!;
    const fixedIn = fixedVersion(affected, pkg);
    return [Object.freeze({ id, package: `${pkg.name}@${pkg.version}`, severity, summary, dev: pkg.dev, ...(fixedIn ? { fixedIn } : {}) })];
  }).sort((a, b) => rank(a.severity) - rank(b.severity) || a.package.localeCompare(b.package) || a.id.localeCompare(b.id)));
}

/**
 * What an update brought in: a vulnerability of a package name it did not have before (the same advisory on the same
 * package at its old version is not new; one that comes with a newly added dependency is).
 */
export function introducedAyasVulnerabilities(before: readonly AyasKnownVulnerability[], after: readonly AyasKnownVulnerability[]): readonly AyasKnownVulnerability[] {
  const name = (pkg: string) => pkg.slice(0, pkg.lastIndexOf("@"));
  const had = new Set(before.map((v) => `${v.id}|${name(v.package)}`));
  return Object.freeze(after.filter((v) => !had.has(`${v.id}|${name(v.package)}`)));
}

/** One short Turkish line per severity, for a trial step or the CLI. */
export function summarizeAyasVulnerabilities(list: readonly AyasKnownVulnerability[]): string {
  if (!list.length) return "bilinen açık yok";
  const counts = new Map<AyasVulnerabilitySeverity, number>();
  for (const v of list) counts.set(v.severity, (counts.get(v.severity) ?? 0) + 1);
  const word: Record<AyasVulnerabilitySeverity, string> = { MALICIOUS: "zararlı paket", CRITICAL: "kritik", HIGH: "yüksek", MODERATE: "orta", LOW: "düşük", UNKNOWN: "önemi belirsiz" };
  return [...counts].map(([severity, n]) => `${n} ${word[severity]}`).join(", ");
}
