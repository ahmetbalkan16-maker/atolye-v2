/**
 * Bekçi's security research run (owner 2026-11-27: "Bekçi için kendini geliştirmesi için internete bağla, araştırsın
 * sürekli").
 *
 *   npx tsx scripts/ayas-security-research.ts [--force]
 *
 * Started by the watch round (scripts/ayas-security-watch.ts) as an arm's-length child with a time limit, daily and
 * when the shipped packages change; it decides itself whether a run is due (SecurityResearch.researchDue) unless
 * --force. Sources, all public, key-free and read-only (SecurityResearch.RESEARCH_SOURCES):
 *   - GitHub Advisory Database, npm: the shipped packages of package-lock.json as `name@version` (a few requests);
 *   - GitHub Advisory Database, Go: the Ollama and cloudflared modules;
 *   - the Node.js security working group's core vulnerability index (raw.githubusercontent.com);
 *   - the GitHub releases of Ollama and cloudflared, for notes that name a security fix.
 * Conditional requests (ETag) are reused, so an unchanged answer costs no GitHub rate limit; below
 * GITHUB_RATE_RESERVE remaining requests it stops until the window resets. Only package names and versions leave the
 * machine. Local program versions come from `cloudflared --version` and `ollama --version` (OLLAMA_HOST pointed at a
 * closed loopback port, so the running Ollama service is not contacted). Writes only data/brain/security/research.json;
 * prints one JSON line.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  GITHUB_RATE_RESERVE, goAdvisoryQueryUrl, inventoryHash, matchAdvisories, nodeComponent, normalizeGithubAdvisories, normalizeNodeCoreIndex,
  NODE_CORE_INDEX_URL, npmAdvisoryQueryUrls, programVersionFromOutput, RESEARCH_SOURCES, researchDue, researchFactsFromState, securityReleasesFrom,
  shippedNpmComponents, WATCHED_PROGRAMS, GITHUB_API,
  type InstalledComponent, type ResearchSourceId, type ResearchSourceState, type SecurityAdvisory, type SecurityReleaseNote, type SecurityResearchState,
} from "../src/lib/brain/security/SecurityResearch";
import { readSecurityResearchState, writeSecurityResearchState } from "../src/lib/brain/security/SecurityWatchStore";
import { fixedHostGet, nextPageUrl, type FetchLike } from "./lib/SecurityFixedHostFetch";

const HOSTS = [...new Set(Object.values(RESEARCH_SOURCES).map((s) => s.host))];
const MAX_PAGES = 3;

/** Where the watched programs are installed on Windows (per-user Ollama, cloudflared's MSI). */
function programCandidates(module: string, env: NodeJS.ProcessEnv): readonly string[] {
  if (module.endsWith("/ollama")) return [path.join(env.LOCALAPPDATA ?? "", "Programs", "Ollama", "ollama.exe")];
  return [path.join(env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "cloudflared", "cloudflared.exe"), path.join(env.ProgramFiles ?? "C:\\Program Files", "cloudflared", "cloudflared.exe")];
}

/** The installed versions of Ollama and cloudflared; a program that is absent is simply not in the stack. */
export function readProgramComponents(env: NodeJS.ProcessEnv = process.env): { readonly components: readonly InstalledComponent[]; readonly errors: readonly string[] } {
  const components: InstalledComponent[] = [];
  const errors: string[] = [];
  for (const program of WATCHED_PROGRAMS) {
    const exe = programCandidates(program.module, env).find((p) => p && fs.existsSync(p));
    if (!exe) continue;
    const run = spawnSync(exe, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 15_000, env: { ...env, OLLAMA_HOST: "127.0.0.1:9" } });
    const version = programVersionFromOutput(`${run.stdout ?? ""}\n${run.stderr ?? ""}`);
    if (version) components.push({ ecosystem: "go", name: program.module, version, label: program.label, via: "kurulum" });
    else errors.push(`${program.label} sürümü okunamadı (${run.error?.message ?? `çıkış ${run.status}`})`.slice(0, 200));
  }
  return { components, errors };
}

export interface ResearchRunOptions {
  readonly root: string;
  readonly now?: Date;
  readonly force?: boolean;
  readonly fetchImpl?: FetchLike;
  /** Injected in tests; the real programs otherwise. */
  readonly programs?: () => { readonly components: readonly InstalledComponent[]; readonly errors: readonly string[] };
  readonly nodeVersion?: string;
}

type RequestCache = NonNullable<ResearchSourceState["requests"]>;

/**
 * One research run. Returns NOT_DUE without any request when nothing is due; otherwise reads every source (each failure
 * recorded on its source, the previous answer kept) and writes research.json.
 */
export async function runSecurityResearch(options: ResearchRunOptions): Promise<{ readonly status: "NOT_DUE" | "RESEARCHED"; readonly reason: string; readonly state: SecurityResearchState | null }> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const previous = readSecurityResearchState(options.root);
  const npm = shippedNpmComponents(fs.readFileSync(path.join(options.root, "package-lock.json"), "utf8"));
  const programs = (options.programs ?? (() => readProgramComponents()))();
  const inventory = [...npm, nodeComponent(options.nodeVersion ?? process.versions.node), ...programs.components];
  const hash = inventoryHash(inventory);
  const due = researchDue(previous, hash, nowMs);
  if (!options.force && !due.due) return { status: "NOT_DUE", reason: due.reason, state: previous };

  let rateLimitedUntil = previous?.rateLimitedUntil && Date.parse(previous.rateLimitedUntil) > nowMs ? previous.rateLimitedUntil : undefined;
  let rateRemaining = previous?.rateResetAt && Date.parse(previous.rateResetAt) > nowMs ? previous.rateRemaining : undefined;
  let rateResetAt = rateRemaining !== undefined ? previous?.rateResetAt : undefined;

  /** One GET (following GitHub's pagination for 200 answers); `null` body = 304, reuse the cache. */
  async function get(url: string, etag: string | undefined): Promise<{ readonly ok: true; readonly pages: readonly unknown[] | null; readonly etag?: string } | { readonly ok: false; readonly error: string }> {
    const pages: unknown[] = [];
    let next: string | null = url;
    let firstEtag: string | undefined;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const api: boolean = new URL(next).hostname === "api.github.com";
      if (api && rateLimitedUntil) return { ok: false, error: `GitHub hız sınırı ${rateLimitedUntil} saatine kadar` };
      if (api && rateRemaining !== undefined && rateRemaining < GITHUB_RATE_RESERVE) {
        rateLimitedUntil = rateResetAt ?? new Date(nowMs + 3600_000).toISOString();
        return { ok: false, error: `GitHub'da ${rateRemaining} istek hakkı kaldı; ${rateLimitedUntil} saatine kadar beklenir` };
      }
      const r = await fixedHostGet(next, { allowedHosts: HOSTS, timeoutMs: 30_000, maxBytes: 3_000_000, ...(page === 0 && etag ? { ifNoneMatch: etag } : {}), ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
      if (api && "rateRemaining" in r && r.rateRemaining !== undefined) { rateRemaining = r.rateRemaining; if (r.rateResetMs) rateResetAt = new Date(r.rateResetMs).toISOString(); }
      if (!r.ok) {
        if (r.code === "RATE_LIMITED") rateLimitedUntil = new Date(r.rateResetMs ?? nowMs + 3600_000).toISOString();
        return { ok: false, error: r.message };
      }
      if (r.notModified) return { ok: true, pages: null, ...(etag ? { etag } : {}) };
      if (page === 0) firstEtag = r.etag;
      try { pages.push(JSON.parse(r.body.toString("utf8"))); } catch { return { ok: false, error: "yanıt JSON değil" }; }
      next = api ? nextPageUrl(r.link) : null;
    }
    return { ok: true, pages, ...(firstEtag ? { etag: firstEtag } : {}) };
  }

  /** Reads a source's requests; a request that fails keeps its previous answer and fails the source. */
  async function source(id: ResearchSourceId, requests: readonly { readonly url: string; readonly read: (pages: readonly unknown[]) => { advisories?: readonly SecurityAdvisory[]; releases?: readonly SecurityReleaseNote[] } }[]): Promise<ResearchSourceState> {
    const before = previous?.sources[id];
    const cache: Record<string, RequestCache[string]> = {};
    const errors: string[] = [];
    for (const req of requests) {
      const old = before?.requests?.[req.url];
      const got = await get(req.url, old?.etag);
      if (!got.ok) { errors.push(got.error); if (old) cache[req.url] = old; continue; }
      if (got.pages === null && old) { cache[req.url] = { ...old, fetchedAt: nowIso }; continue; }
      try {
        const parts = (got.pages ?? []).map((p) => req.read([p]));
        cache[req.url] = { ...(got.etag ? { etag: got.etag } : {}), fetchedAt: nowIso, advisories: parts.flatMap((p) => p.advisories ?? []), releases: parts.flatMap((p) => p.releases ?? []) };
      } catch (error) {
        errors.push((error instanceof Error ? error.message : String(error)).slice(0, 160));
        if (old) cache[req.url] = old;
      }
    }
    const ok = errors.length === 0;
    return { lastAttemptAt: nowIso, ok, ...(ok ? { lastOkAt: nowIso } : before?.lastOkAt ? { lastOkAt: before.lastOkAt } : {}), ...(ok ? {} : { error: [...new Set(errors)].join("; ").slice(0, 300) }), requests: cache };
  }

  const sources: Partial<Record<ResearchSourceId, ResearchSourceState>> = {};
  sources["node-core"] = await source("node-core", [{ url: NODE_CORE_INDEX_URL, read: ([p]) => ({ advisories: normalizeNodeCoreIndex(p) }) }]);
  sources["github-npm"] = await source("github-npm", npmAdvisoryQueryUrls(inventory).map((url) => ({ url, read: ([p]) => ({ advisories: normalizeGithubAdvisories(p, "github-npm") }) })));
  sources["github-go"] = await source("github-go", [{ url: goAdvisoryQueryUrl(), read: ([p]) => ({ advisories: normalizeGithubAdvisories(p, "github-go") }) }]);
  const installedPrograms = WATCHED_PROGRAMS.filter((p) => inventory.some((c) => c.name === p.module));
  sources["github-releases"] = await source("github-releases", installedPrograms.map((program) => ({ url: `${GITHUB_API}/repos/${program.repo}/releases?per_page=10`, read: ([p]) => ({ releases: securityReleasesFrom(p, program) }) })));

  const state: SecurityResearchState = {
    schemaVersion: 1, lastAttemptAt: nowIso, inventoryHash: hash, inventory,
    ...(programs.errors.length ? { localErrors: programs.errors } : {}),
    ...(rateLimitedUntil ? { rateLimitedUntil } : {}),
    ...(rateRemaining !== undefined ? { rateRemaining } : {}), ...(rateResetAt ? { rateResetAt } : {}),
    sources,
  };
  writeSecurityResearchState(state, options.root);
  return { status: "RESEARCHED", reason: options.force ? "elle" : due.reason, state };
}

async function main(): Promise<void> {
  const root = process.cwd();
  const result = await runSecurityResearch({ root, force: process.argv.includes("--force") });
  const facts = result.state ? researchFactsFromState(result.state, Date.now()) : null;
  const match = facts ? matchAdvisories(facts.inventory, facts.advisories) : null;
  console.log(JSON.stringify({
    status: result.status, reason: result.reason,
    ...(facts && match ? {
      components: facts.inventory.length, advisories: facts.advisories.length, affecting: match.hits.map((h) => `${h.advisory.id} ${h.component.name}@${h.component.version}`), unreadable: match.unreadable.length,
      sources: Object.fromEntries(facts.sources.map((s) => [s.id, s.ok ? "ok" : s.error ?? "hata"])), rateRemaining: result.state?.rateRemaining ?? null,
    } : {}),
  }));
}

if (path.basename(process.argv[1] ?? "") === "ayas-security-research.ts") {
  main().catch((error: unknown) => {
    console.error(`Güvenlik araştırması yapılamadı: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
