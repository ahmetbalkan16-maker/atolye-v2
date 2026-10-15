import fs from "node:fs";
import path from "node:path";

import type { AyasExternalResearchFinding } from "./AyasExternalResearchStore";
import type { AyasResearchSeenItem } from "./AyasResearchNoveltyStore";
import { AYAS_RESEARCH_SOURCE_REGISTRY } from "./AyasResearchSourceRegistry";
import { AYAS_TRACKED_RELEASE_SOURCES, assessAyasReleaseRelevance, compareAyasReleaseVersions } from "./AyasResearchReleaseRelevance";

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

function bumpOf(installed: string, latest: string): AyasUpdateRadarItem["bump"] {
  const [a, b] = [installed, latest].map((value) => value.split("-")[0]!.split(".").map(Number));
  return a![0] !== b![0] ? "MAJOR" : a![1] !== b![1] ? "MINOR" : "PATCH";
}

function sourceFiles(repoRoot: string): string[] {
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
  for (const root of SCAN_ROOTS) walk(root);
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

/** The /brain view loads often; the import scan is reused until package-lock.json changes, for at most 10 minutes. */
const USERS_CACHE_MS = 10 * 60_000;
let usersCache: { readonly key: string; readonly at: number; readonly users: Map<string, string[]> } | undefined;
function packageUsers(repoRoot: string, packageName: string): string[] {
  let lockMtime = 0;
  try { lockMtime = fs.statSync(path.join(repoRoot, "package-lock.json")).mtimeMs; } catch { /* no lock: still scan */ }
  const key = `${path.resolve(repoRoot)}|${lockMtime}`;
  if (!usersCache || usersCache.key !== key || Date.now() - usersCache.at > USERS_CACHE_MS) usersCache = { key, at: Date.now(), users: new Map() };
  const cached = usersCache.users.get(packageName);
  if (cached) return cached;
  const contents = new Map<string, string>();
  const files = sourceFiles(repoRoot);
  for (const file of files) { try { contents.set(file, fs.readFileSync(path.join(repoRoot, file), "utf8")); } catch { contents.set(file, ""); } }
  for (const tracked of Object.values(AYAS_TRACKED_RELEASE_SOURCES)) {
    if (tracked.installed.kind === "npm") usersCache.users.set(tracked.installed.packageName, findAyasPackageUsers(repoRoot, tracked.installed.packageName, files, (file) => contents.get(file) ?? ""));
  }
  return usersCache.users.get(packageName) ?? findAyasPackageUsers(repoRoot, packageName, files, (file) => contents.get(file) ?? "");
}

function briefFor(item: Omit<AyasUpdateRadarItem, "brief">, users: readonly string[]): AyasDevelopmentBrief {
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
    const target = tracked.installed.kind === "npm" ? `npm:${tracked.installed.packageName}` : "Node.js runtime";
    const base = {
      sourceId, provider: source.provider, toolName: tracked.toolName, target, installedVersion: latest.installed, latestVersion: latest.release,
      bump: bumpOf(latest.installed, latest.release), newerStableReleases: new Set(newer.map((entry) => entry.release)).size,
      latestUrl: latest.seen.normalizedUrl, lastSeenAt: latest.seen.lastSeenAt,
      applyChannel: tracked.installed.kind === "node" ? "OWNER_PINNED_RUNTIME" as const : "DEVELOPMENT_SESSION" as const,
      evidence: Object.freeze(evidence),
    };
    const users = tracked.installed.kind === "npm" ? packageUsers(input.repoRoot, tracked.installed.packageName) : [];
    items.push(Object.freeze({ ...base, brief: briefFor(base, users) }));
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
