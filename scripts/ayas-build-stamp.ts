/**
 * Stage 15G — runs after `next build` (`npm run build` calls it as `postbuild`).
 *
 * Writes `.next/ayas-build-stamp.json`: the commit and lockfile the build was made from, and whether the tree was
 * clean. The release provenance manifest reads it to say whether a build can be bound to a commit.
 *
 * It never fails a build: with no build directory or no readable Git state it says so and exits 0. It reads Git and
 * one file, and writes one file inside the build directory. Nothing else.
 */
import fs from "node:fs";
import path from "node:path";

import { AYAS_BUILD_DIR, AYAS_BUILD_STAMP_FILE, buildAyasBuildStamp } from "../src/lib/ayas/provenance/AyasBuildStamp";

function main(): void {
  const repoRoot = process.cwd();
  const buildDir = path.join(repoRoot, AYAS_BUILD_DIR);
  if (!fs.existsSync(path.join(buildDir, "BUILD_ID"))) { console.log("ayas-build-stamp: no build output; nothing stamped"); return; }
  const stamp = buildAyasBuildStamp(repoRoot, new Date());
  if (!stamp) { console.log("ayas-build-stamp: Git state unreadable; build left unstamped"); return; }
  fs.writeFileSync(path.join(buildDir, AYAS_BUILD_STAMP_FILE), `${JSON.stringify(stamp, null, 2)}\n`);
  console.log(`ayas-build-stamp: ${stamp.gitHead.slice(0, 12)} ${stamp.treeState}`);
}

try { main(); } catch (error) { console.log(`ayas-build-stamp: skipped (${error instanceof Error ? error.name : "error"})`); }
