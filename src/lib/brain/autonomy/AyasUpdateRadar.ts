import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { AyasExternalResearchFinding } from "./AyasExternalResearchStore";
import type { AyasResearchSeenItem } from "./AyasResearchNoveltyStore";
import { AYAS_RESEARCH_SOURCE_REGISTRY } from "./AyasResearchSourceRegistry";
import { AYAS_TRACKED_RELEASE_SOURCES, assessAyasReleaseRelevance, compareAyasReleaseVersions } from "./AyasResearchReleaseRelevance";
import { ayasUpdateTarget, parseAyasUpdateTarget } from "./AyasUpdateWorkspaces";

/**
 * Research integration Phase 2 (owner plan 2026-10-15, "Radar + özet + sağlık"): a read-only update radar over what
 * the research already saw. For every tracked tool it compares the newest stable release in the novelty memory with the
 * installed version, attaches the verified quotes of grounded findings from the same repository and drafts a
 * development brief. No model, no network, no mutation: applying an update stays an owner-approved development session
 * (npm), or an owner re-pin for the hash-pinned Node.js runtime of phone access.
 */
export interface AyasDevelopmentBrief {
  readonly summary: string;
  readonly affectedFileCount: number;
  readonly affectedFiles: readonly string[];
  readonly validation: readonly string[];
  readonly risk: string;
}

export interface AyasUpdateRadarItem {
  readonly sourceId: string;
  readonly provider: string;
  /** The tool's name for people ("TypeScript", not the registry vendor "Microsoft"). */
  readonly toolName: string;
  readonly target: string;
  readonly installedVersion: string;
  readonly latestVersion: string;
  readonly bump: "MAJOR" | "MINOR" | "PATCH";
  readonly newerStableReleases: number;
  readonly latestUrl: string;
  readonly lastSeenAt: string;
  readonly applyChannel: "DEVELOPMENT_SESSION" | "OWNER_PINNED_RUNTIME";
  readonly evidence: readonly { readonly quote: string; readonly url: string; readonly findingId: string }[];
  readonly brief: AyasDevelopmentBrief;
  /** Binds an owner decision to exactly this tool, installed version and target version (see AyasUpdateApprovalStore). */
  readonly itemHash: string;
}

/** sha256 over what the owner approves: which tool, from which installed version, to which version, by which channel. */
export function ayasUpdateRadarItemHash(item: Pick<AyasUpdateRadarItem, "sourceId" | "target" | "installedVersion" | "latestVersion" | "applyChannel">): string {
  const material = JSON.stringify(["ayas-update-radar-item:v1", item.sourceId, item.target, item.installedVersion, item.latestVersion, item.applyChannel]);
  return crypto.createHash("sha256").update(material).digest("hex");
}

export interface AyasResearchHealth {
  readonly status: "HEALTHY" | "QUIET" | "DEGRADED";
  readonly reasons: readonly string[];
  readonly lastFindingAt?: string;
  readonly findingsLast7d: number;
  readonly groundedFindingsLast7d: number;
  readonly trackedToolsWithUpdates: number;
}

const MAX_EVIDENCE = 5;
const MAX_LISTED_FILES = 12;
const SCAN_ROOTS = ["src", "app", "scripts"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".mjs", ".cjs", ".js"]);
const CONFIG_FILES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  next: ["next.config.ts", "next.config.mjs", "next.config.js"],
  typescript: ["tsconfig.json"],
  eslint: ["eslint.config.mjs"],
  tailwindcss: ["postcss.config.mjs", "app/globals.css"],
  wrangler: ["wrangler.toml", "wrangler.jsonc", "wrangler.json"],
});

export function ayasUpdateBump(installed: string, latest: string): AyasUpdateRadarItem["bump"] {
  const [a, b] = [installed, latest].map((value) => value.split("-")[0]!.split(".").map(Number));
  return a![0] !== b![0] ? "MAJOR" : a![1] !== b![1] ? "MINOR" : "PATCH";
}

function sourceFiles(repoRoot: string, roots: readonly string[] = SCAN_ROOTS): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (entry.name !== "node_modules" && !entry.name.startsWith(".")) walk(relative); }
      else if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) out.push(relative);
    }
  };
  for (const root of roots) walk(root);
  return out;
}

/** Files that import the package (or a subpath of it), plus the package's own config files that exist. */
export function findAyasPackageUsers(repoRoot: string, packageName: string, files: readonly string[] = sourceFiles(repoRoot),
  read: (file: string) => string = (file) => { try { return fs.readFileSync(path.join(repoRoot, file), "utf8"); } catch { return ""; } }): string[] {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const specifier = new RegExp(String.raw`(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["']${escaped}(?:/[^"']*)?["']`);
  const users = files.filter((file) => specifier.test(read(file)));
  const configs = (CONFIG_FILES[packageName] ?? []).filter((file) => fs.existsSync(path.join(repoRoot, file)));
  return [...new Set([...configs, ...users])].sort();
}

/*
 * Which files import each tracked root npm package, for the development briefs.
 *
 * Owner-approved performance change (2026-11-11, "tamam a yı yap madem"): the scan reads every source file under src/,
 * app/ and scripts/ (2,052 files, 26 MB) with synchronous fs on the server's only thread, and `/` and `/brain` build this
 * radar before sending a byte. Measured that day: 50.0 s on a cold disk (0.5 s warm), while every other request stalled;
 * its 10-minute memory cache started empty in every new process (the app restarts on every live publish and boot, 11
 * starts that day). The result is now also kept in data/brain/autonomy/update-radar-package-users.json (Git-ignored,
 * derived, written atomically), keyed by the repository root, HEAD and package-lock.json's mtime and size.
 *
 * A load takes the memory copy, else the file copy. A copy whose key no longer matches (a commit, a dependency change)
 * or that is older than the old 10 minutes (uncommitted edits) is still returned once while a single asynchronous rescan
 * replaces it without blocking the thread. That is sound because the list only informs the owner: item hashes exclude
 * the brief, and the update trial runner scans its own worktree with `findAyasPackageUsers`. Only when no copy exists at
 * all (the very first run, or a deleted/unreadable cache file) does a load scan synchronously, once, as before.
 */
const USERS_CACHE_MS = 10 * 60_000;
const USERS_CACHE_SCHEMA = "ayas-update-radar-package-users:v1";
type AyasPackageUsersMap = ReadonlyMap<string, readonly string[]>;
interface PackageUsersEntry { readonly key: string; readonly at: number; readonly users: AyasPackageUsersMap }
const usersMemory = new Map<string, PackageUsersEntry>();
const usersRefreshes = new Map<string, Promise<void>>();

/** The derived cache file of the package-users scan for this repository root (under the Git-ignored data/brain/autonomy/). */
export function resolveAyasPackageUsersCacheFile(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), "data", "brain", "autonomy", "update-radar-package-users.json");
}

/** Drops the in-process copy, as a new process starts; for smokes that prove what a fresh process reads. */
export function forgetAyasPackageUsersMemory(): void {
  usersMemory.clear();
}

/** The asynchronous rescan currently replacing a stale copy for this root, if any (smokes await it). */
export function ayasPackageUsersRefreshInFlight(repoRoot: string): Promise<void> | undefined {
  return usersRefreshes.get(path.resolve(repoRoot));
}

function rootTrackedPackages(): string[] {
  return [...new Set(Object.values(AYAS_TRACKED_RELEASE_SOURCES)
    .flatMap((tracked) => tracked.installed.kind === "npm" && !tracked.installed.workspace ? [tracked.installed.packageName] : []))].sort();
}

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
/** HEAD read from the Git files themselves (no process: this module is reachable from the console's server code). */
function readGitHead(repoRoot: string): string | undefined {
  try {
    let gitDir = path.join(repoRoot, ".git");
    if (fs.statSync(gitDir).isFile()) {
      const pointer = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitDir, "utf8"))?.[1]?.trim();
      if (!pointer) return undefined;
      gitDir = path.resolve(repoRoot, pointer);
    }
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (SHA.test(head)) return head;
    const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
    if (!ref) return undefined;
    let commonDir = gitDir;
    try { commonDir = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim()); } catch { /* a main checkout */ }
    for (const dir of [gitDir, commonDir]) {
      try { const sha = fs.readFileSync(path.join(dir, ref), "utf8").trim(); if (SHA.test(sha)) return sha; } catch { /* packed */ }
    }
    const packed = fs.readFileSync(path.join(commonDir, "packed-refs"), "utf8").split(/\r?\n/).find((line) => line.endsWith(` ${ref}`))?.split(" ")[0];
    return packed && SHA.test(packed) ? packed : undefined;
  } catch { return undefined; }
}

function packageUsersKey(repoRoot: string): string {
  let lock = "none";
  try { const stat = fs.statSync(path.join(repoRoot, "package-lock.json")); lock = `${stat.mtimeMs}:${stat.size}`; } catch { /* no lock: still keyed */ }
  return JSON.stringify([USERS_CACHE_SCHEMA, path.resolve(repoRoot), readGitHead(repoRoot) ?? "unknown-head", lock, rootTrackedPackages()]);
}

function usersFromContents(repoRoot: string, files: readonly string[], contents: ReadonlyMap<string, string>): AyasPackageUsersMap {
  return new Map(rootTrackedPackages().map((name) => [name, Object.freeze(findAyasPackageUsers(repoRoot, name, files, (file) => contents.get(file) ?? ""))]));
}

function scanPackageUsersSync(repoRoot: string): AyasPackageUsersMap {
  const files = sourceFiles(repoRoot);
  const contents = new Map<string, string>();
  for (const file of files) { try { contents.set(file, fs.readFileSync(path.join(repoRoot, file), "utf8")); } catch { contents.set(file, ""); } }
  return usersFromContents(repoRoot, files, contents);
}

/** The same walk and reads as the synchronous scan, one file at a time on the async API, so the thread stays free. */
async function scanPackageUsersAsync(repoRoot: string): Promise<AyasPackageUsersMap> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(path.join(repoRoot, dir), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (entry.name !== "node_modules" && !entry.name.startsWith(".")) await walk(relative); }
      else if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) files.push(relative);
    }
  };
  for (const root of SCAN_ROOTS) await walk(root);
  const contents = new Map<string, string>();
  for (const file of files) { try { contents.set(file, await fs.promises.readFile(path.join(repoRoot, file), "utf8")); } catch { contents.set(file, ""); } }
  return usersFromContents(repoRoot, files, contents);
}

function readPackageUsersFile(repoRoot: string): PackageUsersEntry | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(resolveAyasPackageUsersCacheFile(repoRoot), "utf8")) as { schema?: unknown; key?: unknown; computedAt?: unknown; users?: Record<string, unknown> };
    if (raw?.schema !== USERS_CACHE_SCHEMA || typeof raw.key !== "string" || typeof raw.computedAt !== "number" || !raw.users || typeof raw.users !== "object") return undefined;
    const users = new Map<string, readonly string[]>();
    for (const name of rootTrackedPackages()) {
      const list = raw.users[name];
      if (!Array.isArray(list) || !list.every((file) => typeof file === "string")) return undefined;
      users.set(name, Object.freeze([...list] as string[]));
    }
    return { key: raw.key, at: raw.computedAt, users };
  } catch { return undefined; }
}

/** Best effort: a cache that cannot be written only means the next process scans again. */
function writePackageUsersFile(repoRoot: string, entry: PackageUsersEntry): void {
  if (!fs.existsSync(repoRoot)) return;
  const file = resolveAyasPackageUsersCacheFile(repoRoot);
  const tmp = path.join(path.dirname(file), `.update-radar-package-users.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(tmp, "w");
    try { fs.writeFileSync(fd, `${JSON.stringify({ schema: USERS_CACHE_SCHEMA, key: entry.key, computedAt: entry.at, users: Object.fromEntries(entry.users) })}\n`, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } catch { try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ } }
}

function startPackageUsersRefresh(repoRoot: string, key: string): void {
  const root = path.resolve(repoRoot);
  if (usersRefreshes.has(root)) return;
  const at = Date.now();
  const refresh = scanPackageUsersAsync(root).then((users) => {
    const entry = { key, at, users };
    usersMemory.set(root, entry);
    writePackageUsersFile(root, entry);
  }).catch(() => { /* the stale copy stays; the next load tries again */ }).finally(() => { usersRefreshes.delete(root); });
  usersRefreshes.set(root, refresh);
}

/** Every tracked root package's importing files: memory copy, then file copy (refreshed in the background when stale). */
export function loadAyasRootPackageUsers(repoRoot: string): AyasPackageUsersMap {
  const root = path.resolve(repoRoot);
  const key = packageUsersKey(root);
  let entry = usersMemory.get(root);
  if (!entry || entry.key !== key) {
    const fromFile = readPackageUsersFile(root);
    if (fromFile && (!entry || fromFile.key === key || fromFile.at > entry.at)) { entry = fromFile; usersMemory.set(root, fromFile); }
  }
  if (entry) {
    if (entry.key !== key || Date.now() - entry.at > USERS_CACHE_MS) startPackageUsersRefresh(root, key);
    return entry.users;
  }
  const scanned = { key, at: Date.now(), users: scanPackageUsersSync(root) };
  usersMemory.set(root, scanned);
  writePackageUsersFile(root, scanned);
  return scanned.users;
}

function packageUsers(rootUsers: () => AyasPackageUsersMap, repoRoot: string, packageName: string): string[] {
  const cached = rootUsers().get(packageName);
  return cached ? [...cached] : findAyasPackageUsers(repoRoot, packageName);
}

function briefFor(item: Omit<AyasUpdateRadarItem, "brief" | "itemHash">, users: readonly string[]): AyasDevelopmentBrief {
  const workspace = parseAyasUpdateTarget(item.target)?.workspace;
  if (workspace) {
    return Object.freeze({
      summary: `${item.toolName} ${item.installedVersion} → ${item.latestVersion} (${workspace.dir}/, ${item.newerStableReleases} yeni kararlı sürüm, ${item.bump === "MAJOR" ? "ana" : item.bump === "MINOR" ? "ara" : "yama"} sürüm)`,
      affectedFileCount: users.length,
      affectedFiles: Object.freeze(users.slice(0, MAX_LISTED_FILES)),
      validation: Object.freeze([`${workspace.dir}: npm ci, güncelleme, kayıt imzaları, npx tsc --noEmit`, "npx tsc --noEmit", "CI-eşdeğeri lint (git'teki dosyalar)", workspace.check.label, ...workspace.smokes.map((file) => `npx tsx ${file}`)]),
      risk: `Yalnız ${workspace.dir}/package.json ve package-lock.json değişir; canlı uygulama etkilenmez. Uygulandıktan sonra ana kopyanın ${workspace.dir}/node_modules'u, sürmekte olan bir V3 üretimi yokken yenilenir.`,
    });
  }
  const pinned = item.applyChannel === "OWNER_PINNED_RUNTIME";
  const risk = pinned
    ? "Telefon erişimi yayını node.exe SHA-256'sına bağlı; güncelleme yeni sürümün kurulup sabitlenmesiyle (scripts/new-pc-setup.ps1 pinleri) owner tarafından yapılır."
    : item.bump === "MAJOR" ? "Ana sürüm atlaması: kırıcı değişiklikler olası. Geçiş notları okunmalı ve ayrı bir geliştirme turunda yapılmalı."
      : item.bump === "MINOR" ? "Ara sürüm: yeni özellikler, genellikle geriye uyumlu."
        : "Yama sürümü: hata düzeltmeleri, düşük risk.";
  const smokes = users.filter((file) => /^scripts\/smoke-[^/]+\.ts$/.test(file)).slice(0, 8);
  const validation = pinned
    ? ["Yeni Node.js sürümünü kur ve SHA-256'sını doğrula", "ayas-prebuilt-runtime pinlerini güncelle ve telefon erişimini yeniden yayınla", "npx tsc --noEmit", "CI-eşdeğeri lint (git'teki dosyalar)"]
    : ["npx tsc --noEmit", "CI-eşdeğeri lint (git'teki dosyalar)", ...(item.target === "npm:next" || item.target === "npm:react" ? ["npm run build"] : []), ...smokes.map((file) => `npx tsx ${file}`)];
  return Object.freeze({
    summary: `${item.toolName} ${item.installedVersion} → ${item.latestVersion} (${item.newerStableReleases} yeni kararlı sürüm, ${item.bump === "MAJOR" ? "ana" : item.bump === "MINOR" ? "ara" : "yama"} sürüm)`,
    affectedFileCount: users.length,
    affectedFiles: Object.freeze(users.slice(0, MAX_LISTED_FILES)),
    validation: Object.freeze(validation),
    risk,
  });
}

export function buildAyasUpdateRadar(input: {
  readonly repoRoot: string; readonly seenItems: readonly AyasResearchSeenItem[]; readonly findings: readonly AyasExternalResearchFinding[];
}): readonly AyasUpdateRadarItem[] {
  const items: AyasUpdateRadarItem[] = [];
  let resolvedRootUsers: AyasPackageUsersMap | undefined;
  const rootUsers = (): AyasPackageUsersMap => (resolvedRootUsers ??= loadAyasRootPackageUsers(input.repoRoot));
  for (const [sourceId, tracked] of Object.entries(AYAS_TRACKED_RELEASE_SOURCES)) {
    const source = AYAS_RESEARCH_SOURCE_REGISTRY.find((entry) => entry.sourceId === sourceId);
    if (!source) continue;
    const newer = input.seenItems.filter((seen) => seen.sourceId === sourceId && seen.versionTag)
      .map((seen) => ({ seen, relevance: assessAyasReleaseRelevance(sourceId, seen.versionTag!, input.repoRoot) }))
      .flatMap(({ seen, relevance }) => relevance.status === "NEWER" ? [{ seen, installed: relevance.installedVersion, release: relevance.releaseVersion }] : []);
    if (!newer.length) continue;
    const latest = newer.reduce((best, entry) => compareAyasReleaseVersions(entry.release, best.release) > 0 ? entry : best);
    const repository = source.url.replace(/\/releases\.atom$/, "/");
    const evidence = input.findings
      .filter((finding) => finding.evidenceQuote && finding.sourceUrl.startsWith(repository))
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).slice(0, MAX_EVIDENCE)
      .map((finding) => Object.freeze({ quote: finding.evidenceQuote!, url: finding.sourceUrl, findingId: finding.findingId }));
    const target = tracked.installed.kind === "npm" ? ayasUpdateTarget(tracked.installed.packageName, tracked.installed.workspace) : "Node.js runtime";
    const base = {
      sourceId, provider: source.provider, toolName: tracked.toolName, target, installedVersion: latest.installed, latestVersion: latest.release,
      bump: ayasUpdateBump(latest.installed, latest.release), newerStableReleases: new Set(newer.map((entry) => entry.release)).size,
      latestUrl: latest.seen.normalizedUrl, lastSeenAt: latest.seen.lastSeenAt,
      applyChannel: tracked.installed.kind === "node" ? "OWNER_PINNED_RUNTIME" as const : "DEVELOPMENT_SESSION" as const,
      evidence: Object.freeze(evidence),
    };
    const users = tracked.installed.kind !== "npm" ? []
      : tracked.installed.workspace ? findAyasPackageUsers(input.repoRoot, tracked.installed.packageName, sourceFiles(input.repoRoot, [`${tracked.installed.workspace}/src`]))
        : packageUsers(rootUsers, input.repoRoot, tracked.installed.packageName);
    items.push(Object.freeze({ ...base, brief: briefFor(base, users), itemHash: ayasUpdateRadarItemHash(base) }));
  }
  const rank = { MAJOR: 0, MINOR: 1, PATCH: 2 };
  return Object.freeze(items.sort((a, b) => rank[a.bump] - rank[b.bump] || a.provider.localeCompare(b.provider)));
}

const DAY_MS = 24 * 60 * 60_000;
/** Light research runs every 2 h (owner cadence); three missed windows count as degraded. */
const STALE_RESEARCH_MS = 6 * 60 * 60_000;

export function buildAyasResearchHealth(input: {
  readonly now: string; readonly findings: readonly AyasExternalResearchFinding[]; readonly radar: readonly AyasUpdateRadarItem[];
  readonly lastSuccessfulResearchAt?: string; readonly consecutiveFailures: number;
}): AyasResearchHealth {
  const nowMs = Date.parse(input.now);
  const recent = input.findings.filter((finding) => nowMs - Date.parse(finding.recordedAt) <= 7 * DAY_MS);
  const lastFindingAt = input.findings.map((finding) => finding.recordedAt).sort().at(-1);
  const reasons: string[] = [];
  if (input.consecutiveFailures > 0) reasons.push(`Araştırma art arda ${input.consecutiveFailures} kez başarısız oldu.`);
  if (!input.lastSuccessfulResearchAt || nowMs - Date.parse(input.lastSuccessfulResearchAt) > STALE_RESEARCH_MS) reasons.push("Son başarılı araştırma 6 saatten eski.");
  const degraded = reasons.length > 0;
  if (!recent.length) reasons.push("Son 7 günde yeni bulgu yok.");
  return Object.freeze({
    status: degraded ? "DEGRADED" : recent.length ? "HEALTHY" : "QUIET",
    reasons: Object.freeze(reasons),
    ...(lastFindingAt ? { lastFindingAt } : {}),
    findingsLast7d: recent.length,
    groundedFindingsLast7d: recent.filter((finding) => finding.evidenceQuote).length,
    trackedToolsWithUpdates: input.radar.length,
  });
}
