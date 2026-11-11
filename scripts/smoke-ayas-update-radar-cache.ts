import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AyasResearchSeenItem } from "../src/lib/brain/autonomy/AyasResearchNoveltyStore";
import { AYAS_TRACKED_RELEASE_SOURCES } from "../src/lib/brain/autonomy/AyasResearchReleaseRelevance";
import {
  ayasPackageUsersRefreshInFlight, buildAyasUpdateRadar, findAyasPackageUsers, forgetAyasPackageUsersMemory, loadAyasRootPackageUsers,
  resolveAyasPackageUsersCacheFile,
} from "../src/lib/brain/autonomy/AyasUpdateRadar";

/**
 * Owner-approved performance change (2026-11-11, "tamam a yı yap madem"): `/` and `/brain` build the update radar before
 * sending a byte, and its package-users scan read all 2,052 source files (26 MB; 50.0 s on a cold disk) with synchronous
 * fs in every new process, and package-lock.json ~70 times per load. This suite proves, on a synthetic repository root
 * only (no network, model or live data): a load with a valid cache file reads no source file; a changed lock file or HEAD,
 * or an old copy, is replaced by one asynchronous rescan while the load stays non-blocking; an unreadable cache is never
 * trusted; the map equals the uncached scan; the cache sits in a Git-ignored folder; the lock is parsed at most once.
 */
let count = 0;
const scenario = async (name: string, fn: () => Promise<void> | void): Promise<void> => { await fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); };

const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-update-radar-cache-"));
const write = (file: string, content: string): void => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), content); };
const PAST = new Date("2026-10-01T00:00:00.000Z");
/** Settled locks get distinct mtimes long in the past; `mtime` pins a recent one, as two writes inside one tick would share. */
const writeLock = (versions: Record<string, string>, mtime?: Date): void => {
  write("package-lock.json", JSON.stringify({ packages: Object.fromEntries(Object.entries(versions).map(([name, version]) => [`node_modules/${name}`, { version }])) }));
  if (!mtime) PAST.setTime(PAST.getTime() + 60_000);
  fs.utimesSync(path.join(repo, "package-lock.json"), mtime ?? PAST, mtime ?? PAST);
};
const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
writeLock({ next: "16.3.8", eslint: "9.39.4", typescript: "5.9.3" });
write(".git/HEAD", `${HEAD_A}\n`);
write("next.config.ts", "export default {};\n");
write("src/app-shell.tsx", "import Link from \"next/link\";\nexport const shell = Link;\n");
write("app/page.tsx", "import { redirect } from \"next/navigation\";\nexport default function Page() { redirect(\"/brain\"); }\n");
write("scripts/smoke-shell.ts", "import { NextResponse } from \"next/server\";\nvoid NextResponse;\n");
write("src/unrelated.ts", "import nextTick from \"next-tick\";\nvoid nextTick;\n");
write("src/compiler.ts", "import ts from \"typescript\";\nexport const k = ts.SyntaxKind;\n");

const seen = (sourceId: string, versionTag: string): AyasResearchSeenItem => ({
  schemaVersion: "1", itemId: `${sourceId}-${versionTag}`, sourceId, normalizedUrl: `https://example.test/${sourceId}/${encodeURIComponent(versionTag)}`,
  versionTag, contentFingerprint: "f", firstSeenAt: "2026-10-15T06:00:00.000Z", lastSeenAt: "2026-10-15T06:00:00.000Z", timesSeen: 1,
} as AyasResearchSeenItem);
const seenItems = [
  ...["v16.4.0", "v16.4.1", "v16.4.2", "v16.5.0", "v16.5.1", "v16.6.0"].map((tag) => seen("nextjs", tag)),
  ...["v10.10.0", "v10.11.0", "v10.12.0"].map((tag) => seen("eslint", tag)),
  ...["TypeScript 6.0.2", "TypeScript 6.0.3"].map((tag) => seen("typescript", tag)),
];
const radar = () => buildAyasUpdateRadar({ repoRoot: repo, seenItems, findings: [] });
const nextBrief = () => radar().find((item) => item.sourceId === "nextjs")!.brief;

// What one load reads synchronously: source files and directories under the scan roots, and the lock file.
const counted = { sourceReads: 0, sourceDirs: 0, lockReads: 0 };
const scanned = (target: unknown): boolean => /^(?:src|app|scripts)(?:\/|$)/.test(path.relative(repo, String(target)).split(path.sep).join("/"));
const originalRead = fs.readFileSync;
const originalReaddir = fs.readdirSync;
(fs as { readFileSync: unknown }).readFileSync = ((file: fs.PathOrFileDescriptor, options?: unknown) => {
  if (typeof file === "string" && scanned(file)) counted.sourceReads += 1;
  if (typeof file === "string" && path.basename(file) === "package-lock.json") counted.lockReads += 1;
  return (originalRead as (f: unknown, o?: unknown) => unknown)(file, options);
}) as typeof fs.readFileSync;
(fs as { readdirSync: unknown }).readdirSync = ((dir: fs.PathLike, options?: unknown) => {
  if (scanned(dir)) counted.sourceDirs += 1;
  return (originalReaddir as (d: unknown, o?: unknown) => unknown)(dir, options);
}) as typeof fs.readdirSync;
const measure = <T>(fn: () => T): { readonly value: T; readonly sourceReads: number; readonly sourceDirs: number; readonly lockReads: number } => {
  Object.assign(counted, { sourceReads: 0, sourceDirs: 0, lockReads: 0 });
  const value = fn();
  return { value, ...counted };
};

const rootPackages = [...new Set(Object.values(AYAS_TRACKED_RELEASE_SOURCES)
  .flatMap((tracked) => tracked.installed.kind === "npm" && !tracked.installed.workspace ? [tracked.installed.packageName] : []))].sort();
const uncachedMap = () => Object.fromEntries(rootPackages.map((name) => [name, findAyasPackageUsers(repo, name)]));
const cacheFile = resolveAyasPackageUsersCacheFile(repo);
const cached = () => JSON.parse(originalRead(cacheFile, "utf8") as string) as { key: string; computedAt: number; users: Record<string, string[]> };

async function main(): Promise<void> {
  let firstBrief: ReturnType<typeof nextBrief> | undefined;
  await scenario("the first run without a cache scans once, writes the cache and equals the uncached scan", () => {
    forgetAyasPackageUsersMemory();
    const load = measure(nextBrief);
    assert.ok(load.sourceReads > 0, "nothing to reuse yet: the load scans");
    firstBrief = load.value;
    assert.deepEqual(firstBrief.affectedFiles, ["app/page.tsx", "next.config.ts", "scripts/smoke-shell.ts", "src/app-shell.tsx"]);
    assert.ok(fs.existsSync(cacheFile), "the scan result is kept for the next process");
    assert.match(cached().key, new RegExp(HEAD_A));
    assert.deepEqual(cached().users, uncachedMap(), "the kept map is the uncached scan's map");
    assert.deepEqual(Object.fromEntries(loadAyasRootPackageUsers(repo)), uncachedMap());
  });

  await scenario("a new process with a valid cache file reads no source file and starts no rescan", () => {
    forgetAyasPackageUsersMemory();
    const load = measure(nextBrief);
    assert.equal(load.sourceReads, 0, `source files read: ${load.sourceReads}`);
    assert.equal(load.sourceDirs, 0, `source directories listed: ${load.sourceDirs}`);
    assert.deepEqual(load.value, firstBrief, "the homepage shows the same brief");
    assert.equal(ayasPackageUsersRefreshInFlight(repo), undefined);
  });

  await scenario("a changed lock file invalidates the cache: the load stays non-blocking and one async rescan replaces it", async () => {
    write("src/new-next-user.ts", "import { headers } from \"next/headers\";\nvoid headers;\n");
    writeLock({ next: "16.3.8", eslint: "9.39.4", typescript: "5.9.3", react: "19.2.0" });
    const before = cached().key;
    forgetAyasPackageUsersMemory();
    const load = measure(nextBrief);
    assert.equal(load.sourceReads, 0, "the stale copy is served without a synchronous scan");
    assert.ok(!load.value.affectedFiles.includes("src/new-next-user.ts"), "until the rescan lands, the previous scan's list is shown");
    const refresh = ayasPackageUsersRefreshInFlight(repo);
    assert.ok(refresh, "the changed lock started a rescan");
    await refresh;
    assert.notEqual(cached().key, before, "the cache was rewritten under the new key");
    forgetAyasPackageUsersMemory();
    const after = measure(nextBrief);
    assert.equal(after.sourceReads, 0);
    assert.ok(after.value.affectedFiles.includes("src/new-next-user.ts"), JSON.stringify(after.value.affectedFiles));
    assert.deepEqual(Object.fromEntries(loadAyasRootPackageUsers(repo)), uncachedMap());
    assert.equal(ayasPackageUsersRefreshInFlight(repo), undefined);
  });

  await scenario("a new HEAD (a worktree's gitdir pointer, a packed ref) invalidates the cache likewise", async () => {
    fs.rmSync(path.join(repo, ".git"), { recursive: true, force: true });
    write(".git", "gitdir: git-meta/worktrees/wt\n");
    write("git-meta/worktrees/wt/HEAD", "ref: refs/heads/feature\n");
    write("git-meta/worktrees/wt/commondir", "../..\n");
    write("git-meta/packed-refs", `# pack-refs with: peeled fully-peeled sorted\n${"c".repeat(40)} refs/heads/main\n${HEAD_B} refs/heads/feature\n`);
    write("scripts/smoke-head.ts", "import { notFound } from \"next/navigation\";\nvoid notFound;\n");
    forgetAyasPackageUsersMemory();
    assert.equal(measure(nextBrief).sourceReads, 0);
    const refresh = ayasPackageUsersRefreshInFlight(repo);
    assert.ok(refresh, "the new HEAD started a rescan");
    await refresh;
    assert.match(cached().key, new RegExp(HEAD_B));
    assert.ok(cached().users.next!.includes("scripts/smoke-head.ts"));
  });

  await scenario("a copy older than 10 minutes is served once and refreshed in the background (uncommitted edits)", async () => {
    write("src/edited.ts", "import Image from \"next/image\";\nvoid Image;\n");
    const old = cached();
    fs.writeFileSync(cacheFile, JSON.stringify({ schema: "ayas-update-radar-package-users:v1", ...old, computedAt: Date.now() - 11 * 60_000 }));
    forgetAyasPackageUsersMemory();
    assert.equal(measure(nextBrief).sourceReads, 0);
    const refresh = ayasPackageUsersRefreshInFlight(repo);
    assert.ok(refresh, "the old copy started a rescan");
    await refresh;
    assert.ok(Date.now() - cached().computedAt < 60_000);
    assert.ok(cached().users.next!.includes("src/edited.ts"));
  });

  await scenario("an unreadable or foreign cache file is never trusted: the load scans as before", () => {
    for (const content of ["{not json", JSON.stringify({ schema: "something-else", key: "k", computedAt: Date.now(), users: {} }),
      JSON.stringify({ ...cached(), schema: "ayas-update-radar-package-users:v1", users: { next: ["src/fake.ts"] } })]) {
      fs.writeFileSync(cacheFile, content);
      forgetAyasPackageUsersMemory();
      const load = measure(() => loadAyasRootPackageUsers(repo));
      assert.ok(load.sourceReads > 0, "scanned instead");
      assert.deepEqual(Object.fromEntries(load.value), uncachedMap());
      assert.deepEqual(cached().users, uncachedMap(), "and rewritten valid");
    }
  });

  await scenario("the cache file lives in a Git-ignored folder of this repository (an unignored store stops the observer)", () => {
    assert.equal(path.relative(repo, cacheFile).split(path.sep).join("/"), "data/brain/autonomy/update-radar-package-users.json");
    const ignored = spawnSync("git", ["check-ignore", "-q", "--no-index", "data/brain/autonomy/update-radar-package-users.json"], { cwd: process.cwd(), windowsHide: true });
    assert.equal(ignored.status, 0, "data/brain/autonomy/update-radar-package-users.json must be ignored");
  });

  await scenario("package-lock.json is parsed at most once per version of the file, and a fresh rewrite is still read", () => {
    writeLock({ next: "16.3.8", eslint: "9.39.4", typescript: "5.9.3" });
    const first = measure(radar);
    assert.ok(first.lockReads <= 1, `lock read ${first.lockReads} times for ${seenItems.length} seen releases`);
    assert.equal(measure(radar).lockReads, 0, "an unchanged settled lock is not read again");
    // Same size and the same recent mtime (two writes inside one timestamp tick): a lock read so soon after its write is
    // not trusted, so the second version is read rather than the first one's parse reused.
    const tick = new Date(Math.floor(Date.now() / 1000) * 1000);
    writeLock({ next: "16.3.9", eslint: "9.39.4", typescript: "5.9.3" }, tick);
    assert.equal(radar().find((item) => item.sourceId === "nextjs")!.installedVersion, "16.3.9");
    writeLock({ next: "16.4.0", eslint: "9.39.4", typescript: "5.9.3" }, tick);
    assert.equal(radar().find((item) => item.sourceId === "nextjs")!.installedVersion, "16.4.0");
  });

  const pending = ayasPackageUsersRefreshInFlight(repo);
  if (pending) await pending;
  fs.rmSync(repo, { recursive: true, force: true });
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-update-radar-cache", scenarios: count, modelRuns: 0, networkCalls: 0 }));
}

void main().catch((error: unknown) => { console.error(error); fs.rmSync(repo, { recursive: true, force: true }); process.exit(1); });
