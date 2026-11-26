/**
 * Bekçi's continuous security research — the pure part (owner 2026-11-27: "Bekçi için kendini geliştirmesi için
 * internete bağla, araştırsın sürekli").
 *
 * Bekçi reads a short, explicit list of public, key-free advisory sources once a day (and when the shipped packages
 * change), and keeps only what concerns THIS stack: the shipped (non-dev) npm packages of the lock at their installed
 * versions, the Node.js that runs the app, and the Ollama / cloudflared binaries on this machine. An advisory counts
 * only when the installed version is inside its affected range; this file decides that with a small range matcher
 * (npm and GitHub range syntax), no npm package and no model.
 *
 * Pure: no I/O, no network. `scripts/ayas-security-research.ts` fetches and stores; `SecurityWatchModel` turns the
 * stored facts into findings. Lives under `src/lib/brain/security/` (FORBIDDEN_AUTONOMOUS): automatic development can
 * never loosen these rules.
 */

export type ComponentEcosystem = "npm" | "node" | "go";

/** How a component is updated — decides the advice and the kind of improvement need. */
export type ComponentUpdatePath =
  /** A direct dependency the Güncelleme Radarı tracks: tried and applied through its update trial. */
  | "radar"
  /** Another shipped npm package (direct or transitive): an approved development session updates the lock. */
  | "paket"
  /** A program installed on this machine (Node.js, Ollama, cloudflared): the owner installs the new version. */
  | "kurulum";

export interface InstalledComponent {
  readonly ecosystem: ComponentEcosystem;
  /** Registry name: the npm name, "node", or the Go module path the advisories use. */
  readonly name: string;
  readonly version: string;
  /** Turkish/people name for the report ("Next.js", "Node.js", "Ollama"). */
  readonly label: string;
  readonly via: ComponentUpdatePath;
}

export type AdvisorySeverity = "critical" | "high" | "medium" | "low" | "unknown";

export interface AdvisoryAffect {
  readonly ecosystem: ComponentEcosystem;
  readonly name: string;
  /** Affected range, npm syntax or GitHub's comma-separated comparators (both read by `versionInRange`). */
  readonly vulnerable: string;
  /** First fixed version (GitHub), shown as advice; never widens or narrows the range. */
  readonly fixed: string | null;
  /** Patched range (Node.js security WG): a version inside it is NOT affected even when `vulnerable` matches. */
  readonly patchedRange?: string;
}

export interface SecurityAdvisory {
  /** GHSA id, or the CVE (Node.js core). */
  readonly id: string;
  readonly aliases: readonly string[];
  readonly source: ResearchSourceId;
  readonly severity: AdvisorySeverity;
  /** Untrusted text from the source, cut and stripped of control characters; shown, never obeyed or sent onwards. */
  readonly summary: string;
  readonly url: string;
  readonly publishedAt?: string;
  readonly affects: readonly AdvisoryAffect[];
  /** Platforms the advisory applies to (Node.js core: "all", "win32", "linux"…); absent = all. */
  readonly environments?: readonly string[];
}

/** A stable release of a watched program whose notes name a security fix (compared with the installed one later). */
export interface SecurityReleaseNote {
  readonly component: string;
  readonly label: string;
  readonly version: string;
  readonly tag: string;
  readonly url: string;
  readonly publishedAt: string;
  /** The words that marked it as a security release (a CVE/GHSA id or "security fix"), never the release body. */
  readonly marker: string;
}

/**
 * The explicit source list (owner rule: public, key-free, read-only, small). Every URL is built in code from package
 * names and versions only; nothing about the owner or the machine is sent.
 */
export const RESEARCH_SOURCES = {
  "github-npm": { label: "GitHub Advisory Database (npm)", host: "api.github.com" },
  "github-go": { label: "GitHub Advisory Database (Ollama, cloudflared)", host: "api.github.com" },
  "node-core": { label: "Node.js güvenlik çalışma grubu (çekirdek açıkları)", host: "raw.githubusercontent.com" },
  "github-releases": { label: "GitHub sürüm notları (Ollama, cloudflared)", host: "api.github.com" },
} as const;
export type ResearchSourceId = keyof typeof RESEARCH_SOURCES;

export const GITHUB_API = "https://api.github.com";
export const NODE_CORE_INDEX_URL = "https://raw.githubusercontent.com/nodejs/security-wg/main/vuln/core/index.json";
/** Programs on this machine whose advisories and release notes Bekçi reads (Go module path → GitHub repository). */
export const WATCHED_PROGRAMS: readonly { readonly module: string; readonly repo: string; readonly label: string }[] = [
  { module: "github.com/ollama/ollama", repo: "ollama/ollama", label: "Ollama" },
  { module: "github.com/cloudflare/cloudflared", repo: "cloudflare/cloudflared", label: "cloudflared" },
];
/**
 * Direct dependencies the Güncelleme Radarı tracks (the npm ones of AyasResearchReleaseRelevance's tracked sources,
 * copied rather than imported so the browser bundle and the watcher reach no autonomy module).
 */
export const RADAR_PACKAGES: Readonly<Record<string, string>> = {
  next: "Next.js", react: "React", typescript: "TypeScript", eslint: "ESLint", tailwindcss: "Tailwind CSS",
  "@huggingface/transformers": "Transformers.js", wrangler: "Wrangler",
};
/** GitHub's `affects` filter: package names per request (keeps every URL well under 2 KB). */
export const NPM_QUERY_CHUNK = 40;

export const RESEARCH_EVERY_MS = 24 * 60 * 60_000;
/** After a failed attempt, the next one waits this long (the unauthenticated GitHub API allows 60 requests an hour). */
export const RESEARCH_RETRY_MS = 3 * 60 * 60_000;
/** Never two attempts closer than this, whatever changed. */
export const RESEARCH_MIN_GAP_MS = 60 * 60_000;
/** Below this many remaining GitHub API requests Bekçi stops for the window instead of spending the rest. */
export const GITHUB_RATE_RESERVE = 10;
/** A source not read successfully for this long is reported as unmeasured even if a cached list exists. */
export const RESEARCH_STALE_MS = 3 * RESEARCH_EVERY_MS;

// ---------------------------------------------------------------------------------------------------------------
// Versions and ranges
// ---------------------------------------------------------------------------------------------------------------

interface ParsedVersion { readonly nums: readonly [number, number, number]; readonly pre: readonly string[] }

/** "v1.2.3-rc.1+build" → numbers and prerelease ids; `null` when it is not a version. */
export function parseVersion(raw: string): ParsedVersion | null {
  const text = raw.trim().replace(/^[=v]+/i, "").split("+")[0]!;
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(text);
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)], pre: m[4] ? m[4].split(".") : [] };
}

/** Semver precedence: -1, 0, 1; `null` when either side is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  return compareParsed(x, y);
}

function compareParsed(x: ParsedVersion, y: ParsedVersion): number {
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i]! < y.nums[i]! ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

type Op = ">=" | ">" | "<=" | "<" | "=";
interface Comparator { readonly op: Op; readonly v: ParsedVersion }

const v3 = (a: number, b: number, c: number): ParsedVersion => ({ nums: [a, b, c], pre: [] });

/** One partial version ("26", "1.2", "1.2.x", "*") → its numbers and how many were given. */
function partial(text: string): { readonly n: readonly number[]; readonly pre: readonly string[] } | null {
  const t = text.replace(/^v/i, "");
  if (t === "" || t === "*" || /^x$/i.test(t)) return { n: [], pre: [] };
  const m = /^(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/.exec(t);
  if (!m) return null;
  const n: number[] = [];
  for (const part of [m[1], m[2], m[3]]) { if (part === undefined || /^[xX*]$/.test(part)) break; n.push(Number(part)); }
  return { n, pre: m[4] && n.length === 3 ? m[4].split(".") : [] };
}

/** One npm range token (">=1.2.3", "^26.12.1", "26.x", "<= 4") → comparators that must all hold; `null` if unreadable. */
function tokenComparators(token: string): Comparator[] | null {
  const m = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(token)!;
  const op = m[1] ?? "";
  const p = partial(m[2]!.trim());
  if (!p) return null;
  const [a = 0, b = 0, c = 0] = p.n;
  const full: ParsedVersion = { nums: [a, b, c], pre: p.pre };
  const len = p.n.length;
  if (op === "^") {
    if (len === 0) return [];
    const upper = a > 0 || len === 1 ? v3(a + 1, 0, 0) : b > 0 || len === 2 ? v3(0, b + 1, 0) : v3(0, 0, c + 1);
    return [{ op: ">=", v: full }, { op: "<", v: upper }];
  }
  if (op === "~") {
    if (len === 0) return [];
    return [{ op: ">=", v: full }, { op: "<", v: len === 1 ? v3(a + 1, 0, 0) : v3(a, b + 1, 0) }];
  }
  const next = len === 1 ? v3(a + 1, 0, 0) : len === 2 ? v3(a, b + 1, 0) : null;
  if (op === "" || op === "=") {
    if (len === 0) return [];
    return len === 3 ? [{ op: "=", v: full }] : [{ op: ">=", v: full }, { op: "<", v: next! }];
  }
  if (len === 0) return op === "<" || op === ">" ? [{ op: "<", v: v3(0, 0, 0) }] : [];
  if (len === 3) return [{ op: op as Op, v: full }];
  // Partial bounds, npm style: "<=4" is "<5.0.0", ">4" is ">=5.0.0", ">=4" and "<4" read as 4.0.0.
  if (op === "<=") return [{ op: "<", v: next! }];
  if (op === ">") return [{ op: ">=", v: next! }];
  return [{ op: op as Op, v: full }];
}

function holds(version: ParsedVersion, c: Comparator): boolean {
  const d = compareParsed(version, c.v);
  return c.op === ">=" ? d >= 0 : c.op === ">" ? d > 0 : c.op === "<=" ? d <= 0 : c.op === "<" ? d < 0 : d === 0;
}

/**
 * Whether `version` is inside `range`. Reads npm ranges ("22.x || ^26.12.1", ">=1.2.3 <2", "1.0.0 - 1.4.0") and
 * GitHub's comma form (">= 16.0.0, <= 16.4.4"). `null` = the version or the range could not be read — the caller
 * reports that, never treats it as "not affected".
 */
export function versionInRange(version: string, range: string): boolean | null {
  const v = parseVersion(version);
  if (!v || !range.trim()) return null;
  const alternatives = range.split("||").map((alt) => alt.replace(/,/g, " ").replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1").trim());
  if (alternatives.length === 0) return null;
  let anyRead = false;
  for (const alt of alternatives) {
    const tokens = alt.split(/\s+/).filter(Boolean);
    let comparators: Comparator[] | null = [];
    if (tokens.length === 3 && tokens[1] === "-") {
      const lo = tokenComparators(`>=${tokens[0]}`), hi = tokenComparators(`<=${tokens[2]}`);
      comparators = lo && hi ? [...lo, ...hi] : null;
    } else {
      for (const token of tokens) {
        const cs = tokenComparators(token);
        if (!cs) { comparators = null; break; }
        comparators.push(...cs);
      }
    }
    if (comparators === null) continue;
    anyRead = true;
    if (comparators.every((c) => holds(v, c))) return true;
  }
  return anyRead ? false : null;
}

/** The fixed version that applies to `installed` from a patched range ("^22.23.4 || ^26.12.1" → "26.12.1" for 26.x). */
export function fixedForInstalled(patchedRange: string, installed: string): string | null {
  const major = parseVersion(installed)?.nums[0];
  const candidates = patchedRange.split("||").map((t) => t.trim().replace(/^(>=|\^|~|=)\s*/, "")).filter((t) => parseVersion(t));
  return candidates.find((t) => parseVersion(t)!.nums[0] === major) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Our stack
// ---------------------------------------------------------------------------------------------------------------

interface LockEntry { readonly version?: string; readonly dev?: boolean; readonly devOptional?: boolean; readonly link?: boolean }

/**
 * The shipped npm packages of a lock (dev tooling excluded, like the osv.dev check), one entry per name and installed
 * version. A direct dependency the Güncelleme Radarı tracks is marked `radar`.
 */
export function shippedNpmComponents(lockText: string): readonly InstalledComponent[] {
  const lock = JSON.parse(lockText) as { packages?: Record<string, LockEntry> };
  const out = new Map<string, InstalledComponent>();
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key || entry.dev || entry.devOptional || entry.link || typeof entry.version !== "string") continue;
    const at = key.lastIndexOf("node_modules/");
    if (at < 0) continue;
    const name = key.slice(at + "node_modules/".length);
    const direct = key === `node_modules/${name}`;
    const label = direct && RADAR_PACKAGES[name] ? RADAR_PACKAGES[name]! : name;
    out.set(`${name}@${entry.version}`, { ecosystem: "npm", name, version: entry.version, label, via: direct && RADAR_PACKAGES[name] ? "radar" : "paket" });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export function nodeComponent(version: string): InstalledComponent {
  return { ecosystem: "node", name: "node", version: version.replace(/^v/, ""), label: "Node.js", via: "kurulum" };
}

/** The printed version of `cloudflared --version` / `ollama --version` ("cloudflared version 2026.8.3 (built …)"). */
export function programVersionFromOutput(output: string): string | null {
  const m = /version(?: is)?\s+v?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)/i.exec(output);
  return m ? m[1]! : null;
}

/** A short, stable fingerprint of what the npm query depends on (FNV-1a; no crypto so the browser bundle can read it). */
export function inventoryHash(components: readonly InstalledComponent[]): string {
  let h = 0x811c9dc5;
  const text = components.filter((c) => c.ecosystem !== "go").map((c) => `${c.ecosystem}:${c.name}@${c.version}`).join("\n");
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/** GitHub advisory query URLs for the shipped npm packages (`name@version`, so GitHub filters to affected versions). */
export function npmAdvisoryQueryUrls(components: readonly InstalledComponent[]): readonly string[] {
  const specs = components.filter((c) => c.ecosystem === "npm").map((c) => `${c.name}@${c.version}`);
  const urls: string[] = [];
  for (let i = 0; i < specs.length; i += NPM_QUERY_CHUNK) {
    urls.push(`${GITHUB_API}/advisories?ecosystem=npm&per_page=100&affects=${specs.slice(i, i + NPM_QUERY_CHUNK).map(encodeURIComponent).join(",")}`);
  }
  return urls;
}

/** The Go advisory query for the watched programs (by module only; the installed version is matched here). */
export function goAdvisoryQueryUrl(): string {
  return `${GITHUB_API}/advisories?ecosystem=go&per_page=100&affects=${WATCHED_PROGRAMS.map((p) => encodeURIComponent(p.module)).join(",")}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the sources (untrusted JSON → bounded records)
// ---------------------------------------------------------------------------------------------------------------

const clean = (value: unknown, max: number): string => String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const SEVERITIES: readonly AdvisorySeverity[] = ["critical", "high", "medium", "low", "unknown"];
const severityOf = (value: unknown): AdvisorySeverity => {
  const s = clean(value, 20).toLowerCase();
  return s === "moderate" ? "medium" : (SEVERITIES as readonly string[]).includes(s) ? (s as AdvisorySeverity) : "unknown";
};
const httpsUrl = (value: unknown): string => { const s = clean(value, 300); return /^https:\/\//.test(s) ? s : ""; };

/** GitHub's global advisories response → advisories (withdrawn ones dropped, only npm/go entries kept). */
export function normalizeGithubAdvisories(json: unknown, source: ResearchSourceId): readonly SecurityAdvisory[] {
  if (!Array.isArray(json)) throw new Error("GitHub yanıtı liste değil");
  const out: SecurityAdvisory[] = [];
  for (const raw of json as Record<string, unknown>[]) {
    if (!raw || typeof raw !== "object" || raw.withdrawn_at) continue;
    const id = clean(raw.ghsa_id, 40);
    if (!/^GHSA-[a-z0-9-]+$/i.test(id)) continue;
    const affects: AdvisoryAffect[] = [];
    for (const v of Array.isArray(raw.vulnerabilities) ? (raw.vulnerabilities as Record<string, unknown>[]) : []) {
      const pkg = (v?.package ?? {}) as Record<string, unknown>;
      const ecosystem = clean(pkg.ecosystem, 10).toLowerCase();
      if (ecosystem !== "npm" && ecosystem !== "go") continue;
      const vulnerable = clean(v.vulnerable_version_range, 200);
      if (!vulnerable) continue;
      affects.push({ ecosystem, name: clean(pkg.name, 214), vulnerable, fixed: v.first_patched_version ? clean(v.first_patched_version, 60) : null });
    }
    if (affects.length === 0) continue;
    out.push({
      id, aliases: raw.cve_id ? [clean(raw.cve_id, 40)] : [], source, severity: severityOf(raw.severity), summary: clean(raw.summary, 200),
      url: httpsUrl(raw.html_url) || `https://github.com/advisories/${id}`, ...(raw.published_at ? { publishedAt: clean(raw.published_at, 30) } : {}), affects,
    });
  }
  return out;
}

/** The Node.js security WG core index (`{ "1": { cve, vulnerable, patched, severity, affectedEnvironments, … } }`). */
export function normalizeNodeCoreIndex(json: unknown): readonly SecurityAdvisory[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Node.js dizini nesne değil");
  const out: SecurityAdvisory[] = [];
  for (const [key, raw] of Object.entries(json as Record<string, Record<string, unknown>>)) {
    if (!raw || typeof raw !== "object") continue;
    const vulnerable = clean(raw.vulnerable, 200);
    if (!vulnerable) continue;
    const cves = (Array.isArray(raw.cve) ? raw.cve : []).map((c) => clean(c, 40)).filter((c) => /^CVE-\d{4}-\d+$/.test(c));
    const patched = clean(raw.patched, 200);
    out.push({
      id: cves[0] ?? `NODE-${clean(key, 10)}`, aliases: cves.slice(1), source: "node-core", severity: severityOf(raw.severity), summary: clean(raw.description, 200),
      url: httpsUrl(raw.ref) || NODE_CORE_INDEX_URL,
      affects: [{ ecosystem: "node", name: "node", vulnerable, fixed: null, ...(patched ? { patchedRange: patched } : {}) }],
      ...(Array.isArray(raw.affectedEnvironments) ? { environments: raw.affectedEnvironments.map((e) => clean(e, 20).toLowerCase()) } : {}),
    });
  }
  return out;
}

const SECURITY_MARKER = /\bCVE-\d{4}-\d{4,}\b|\bGHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}\b|\bsecurity (?:fix(?:es)?|issue|vulnerabilit(?:y|ies)|update|patch|advisory)\b|\bvulnerabilit(?:y|ies)\b/i;

/** A program's GitHub releases → its stable releases whose notes name a security fix (only the marker is kept). */
export function securityReleasesFrom(json: unknown, program: { readonly module: string; readonly label: string }): readonly SecurityReleaseNote[] {
  if (!Array.isArray(json)) throw new Error("sürüm listesi okunamadı");
  const out: SecurityReleaseNote[] = [];
  for (const raw of json as Record<string, unknown>[]) {
    if (!raw || raw.draft || raw.prerelease) continue;
    const tag = clean(raw.tag_name, 60);
    const version = tag.replace(/^v/i, "");
    if (!parseVersion(version)) continue;
    const marker = SECURITY_MARKER.exec(String(raw.body ?? "").slice(0, 20_000))?.[0];
    if (!marker) continue;
    out.push({ component: program.module, label: program.label, version, tag, url: httpsUrl(raw.html_url), publishedAt: clean(raw.published_at, 30), marker: clean(marker, 60) });
  }
  return out;
}

/** The newest security release above each installed program's version. */
export function newerSecurityReleases(inventory: readonly InstalledComponent[], releases: readonly SecurityReleaseNote[]): readonly (SecurityReleaseNote & { readonly installed: string })[] {
  const out: (SecurityReleaseNote & { installed: string })[] = [];
  for (const c of inventory) {
    const newer = releases.filter((r) => r.component === c.name && (compareVersions(r.version, c.version) ?? 0) > 0).sort((a, b) => compareVersions(b.version, a.version) ?? 0);
    if (newer[0]) out.push({ ...newer[0], installed: c.version });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Matching and cadence
// ---------------------------------------------------------------------------------------------------------------

export interface AdvisoryHit {
  readonly advisory: SecurityAdvisory;
  readonly component: InstalledComponent;
  readonly vulnerable: string;
  readonly fixed: string | null;
}

/**
 * The advisories that affect an INSTALLED version, and the ones that could not be judged (unreadable range or
 * version). Platform-specific Node.js advisories count only for "all" or "win32" (this machine).
 */
export function matchAdvisories(inventory: readonly InstalledComponent[], advisories: readonly SecurityAdvisory[], platform = "win32"): { readonly hits: readonly AdvisoryHit[]; readonly unreadable: readonly string[] } {
  const hits: AdvisoryHit[] = [];
  const unreadable: string[] = [];
  const seen = new Set<string>();
  for (const advisory of advisories) {
    if (advisory.environments?.length && !advisory.environments.some((e) => e === "all" || e === platform)) continue;
    for (const affect of advisory.affects) {
      for (const component of inventory) {
        if (component.ecosystem !== affect.ecosystem || component.name !== affect.name) continue;
        const key = `${advisory.id}|${component.name}|${component.version}`;
        if (seen.has(key)) continue;
        const inRange = versionInRange(component.version, affect.vulnerable);
        const patched = affect.patchedRange ? versionInRange(component.version, affect.patchedRange) : false;
        if (inRange === null || patched === null) { unreadable.push(`${advisory.id} (${component.name} ${component.version})`); seen.add(key); continue; }
        if (!inRange || patched) continue;
        seen.add(key);
        hits.push({ advisory, component, vulnerable: affect.vulnerable, fixed: affect.fixed ?? (affect.patchedRange ? fixedForInstalled(affect.patchedRange, component.version) : null) });
      }
    }
  }
  return { hits, unreadable: [...new Set(unreadable)] };
}

export interface ResearchSourceStatus {
  readonly id: ResearchSourceId | "yerel" | "cocuk";
  readonly ok: boolean;
  readonly at: string;
  /** Last successful read (cached lists come from then). */
  readonly okAt?: string;
  readonly error?: string;
}

/** What the watch round hands the model (from `research.json`). */
export interface SecurityResearchFacts {
  readonly inventory: readonly InstalledComponent[];
  readonly advisories: readonly SecurityAdvisory[];
  readonly releases: readonly SecurityReleaseNote[];
  readonly sources: readonly ResearchSourceStatus[];
}

/** One source's stored state in `data/brain/security/research.json`. */
export interface ResearchSourceState {
  readonly lastAttemptAt: string;
  readonly lastOkAt?: string;
  readonly ok: boolean;
  readonly error?: string;
  /**
   * What each request URL last returned, with its ETag for a conditional request (a 304 costs no GitHub rate limit).
   * A failed request keeps its previous list: a bad day does not make a known threat disappear (it is reported as
   * unmeasured instead).
   */
  readonly requests?: Readonly<Record<string, { readonly etag?: string; readonly fetchedAt: string; readonly advisories?: readonly SecurityAdvisory[]; readonly releases?: readonly SecurityReleaseNote[] }>>;
}

export interface SecurityResearchState {
  readonly schemaVersion: 1;
  readonly lastAttemptAt: string;
  readonly inventoryHash: string;
  readonly inventory: readonly InstalledComponent[];
  /** Installed programs that were found but whose version could not be read. */
  readonly localErrors?: readonly string[];
  /** GitHub said "enough for now": no API request before this time. */
  readonly rateLimitedUntil?: string;
  /** GitHub's last reported remaining requests and when that window resets. */
  readonly rateRemaining?: number;
  readonly rateResetAt?: string;
  readonly sources: Readonly<Partial<Record<ResearchSourceId, ResearchSourceState>>>;
}

/**
 * Whether the watch round should start a research run now: daily, when the packages changed (new HEAD), sooner after
 * nothing; never inside GitHub's rate-limit window, never twice within an hour, and only every three hours after a
 * failed attempt.
 */
export function researchDue(state: SecurityResearchState | null, currentInventoryHash: string, nowMs: number): { readonly due: boolean; readonly reason: string } {
  if (!state) return { due: true, reason: "ilk araştırma" };
  if (state.rateLimitedUntil && Date.parse(state.rateLimitedUntil) > nowMs) return { due: false, reason: `GitHub hız sınırı ${state.rateLimitedUntil} saatine kadar` };
  const sinceAttempt = nowMs - Date.parse(state.lastAttemptAt);
  if (!(sinceAttempt >= RESEARCH_MIN_GAP_MS)) return { due: false, reason: "son deneme bir saatten yeni" };
  if (state.inventoryHash !== currentInventoryHash) return { due: true, reason: "paketler değişti" };
  const sources = Object.keys(RESEARCH_SOURCES).map((id) => state.sources[id as ResearchSourceId]);
  const failed = sources.some((s) => !s || !s.ok);
  if (failed) return sinceAttempt >= RESEARCH_RETRY_MS ? { due: true, reason: "önceki deneme başarısızdı" } : { due: false, reason: "başarısız denemeden sonra 3 saat beklenir" };
  const oldest = Math.min(...sources.map((s) => Date.parse(s!.lastOkAt ?? s!.lastAttemptAt)));
  return nowMs - oldest >= RESEARCH_EVERY_MS ? { due: true, reason: "günlük araştırma" } : { due: false, reason: "bugün araştırıldı" };
}

/** The stored state → the model's facts: cached lists stay (a failed day does not make a threat vanish) but a failed or stale source is reported. */
export function researchFactsFromState(state: SecurityResearchState, nowMs: number): SecurityResearchFacts {
  const sources: ResearchSourceStatus[] = [];
  const advisories: SecurityAdvisory[] = [];
  const releases: SecurityReleaseNote[] = [];
  for (const id of Object.keys(RESEARCH_SOURCES) as ResearchSourceId[]) {
    const s = state.sources[id];
    if (!s) { sources.push({ id, ok: false, at: state.lastAttemptAt, error: "henüz okunmadı" }); continue; }
    const stale = !s.lastOkAt || nowMs - Date.parse(s.lastOkAt) > RESEARCH_STALE_MS;
    sources.push({ id, ok: s.ok && !stale, at: s.lastAttemptAt, ...(s.lastOkAt ? { okAt: s.lastOkAt } : {}), ...(!s.ok ? { error: s.error ?? "okunamadı" } : stale ? { error: "3 günden eski" } : {}) });
    for (const r of Object.values(s.requests ?? {})) {
      advisories.push(...(r.advisories ?? []));
      releases.push(...(r.releases ?? []));
    }
  }
  for (const e of state.localErrors ?? []) sources.push({ id: "yerel", ok: false, at: state.lastAttemptAt, error: e });
  const unique = [...new Map(advisories.map((a) => [`${a.source}|${a.id}`, a])).values()];
  const uniqueReleases = [...new Map(releases.map((r) => [`${r.component}|${r.tag}`, r])).values()];
  return { inventory: state.inventory, advisories: unique, releases: uniqueReleases, sources };
}

/** A short Turkish summary for the Güvenlik panel. */
export interface SecurityResearchSummary {
  readonly checkedAt: string;
  readonly components: number;
  readonly advisories: number;
  readonly affecting: number;
  readonly sources: readonly { readonly id: string; readonly label: string; readonly ok: boolean; readonly okAt?: string; readonly error?: string }[];
}

export function summarizeResearch(facts: SecurityResearchFacts, checkedAt: string): SecurityResearchSummary {
  const label = (id: string) => (RESEARCH_SOURCES as Record<string, { label: string }>)[id]?.label ?? (id === "yerel" ? "Bu bilgisayardaki program sürümleri" : "Araştırma süreci");
  return {
    checkedAt, components: facts.inventory.length, advisories: facts.advisories.length, affecting: matchAdvisories(facts.inventory, facts.advisories).hits.length,
    sources: facts.sources.map((s) => ({ id: s.id, label: label(s.id), ok: s.ok, ...(s.okAt ? { okAt: s.okAt } : {}), ...(s.error ? { error: s.error } : {}) })),
  };
}
