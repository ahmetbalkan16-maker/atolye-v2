/**
 * Smoke: every DEEP research cycle also reads the release feeds of the tools AYAS ships (owner 2026-11-27, "React
 * güncelleme boşluğu: uygula"). React 19.3.x was never offered by the update radar: its feed change was seen by a
 * LIGHT-only cycle before the 9 Nov carry-over fix, nothing was owed afterwards, and the novelty memory had no React
 * record at all. Now a tracked feed rides along on every DEEP, after the owed sources, and a tracked feed the budget
 * did not reach is never carried as owed (it is simply read on the next DEEP).
 *
 * Isolated temp gate/repo roots only. Sources point at an address nothing listens on, so the engines fail fast and
 * deterministically; which sources the DEEP scan tried is read from its per-source errors. No network, no model.
 *
 *   npx tsx scripts/smoke-ayas-research-tracked-deep.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { tickAyasResearchScheduler } from "../src/lib/brain/autonomy/AyasResearchScheduler";
import { createAyasResearchSchedulerStateStore } from "../src/lib/brain/autonomy/AyasResearchSchedulerStateStore";
import { createAyasResearchSourceStateStore } from "../src/lib/brain/autonomy/AyasResearchSourceStateStore";
import { createAyasExternalResearchStore } from "../src/lib/brain/autonomy/AyasExternalResearchStore";
import { createAyasResearchNoveltyStore } from "../src/lib/brain/autonomy/AyasResearchNoveltyStore";
import { AYAS_TRACKED_RELEASE_SOURCES } from "../src/lib/brain/autonomy/AyasResearchReleaseRelevance";
import type { AyasResearchSource } from "../src/lib/brain/autonomy/AyasResearchSourceRegistry";

let count = 0;
const scenario = async (name: string, fn: () => Promise<void>) => { await fn(); count++; console.log(`PASS ${count}: ${name}`); };
const roots: string[] = [];
const tempRoot = () => { const r = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-tracked-deep-")); roots.push(r); return r; };

const source = (sourceId: string): AyasResearchSource => ({ sourceId, provider: "Stub", category: "OPEN_SOURCE_AI", kind: "github-releases-atom", url: `http://127.0.0.1:1/${sourceId}.atom`, officialSource: true, expectedContentTypes: ["application/atom+xml"], notes: "unreachable by design" });
const SOURCES = [source("stub-untracked"), source("react"), source("nextjs")];

function deps(root: string) {
  return {
    repoRoot: root, gateRoot: root, sources: SOURCES,
    light: { stateStore: createAyasResearchSourceStateStore({ rootDir: path.join(root, "research-sources") }) },
    deep: { researchStore: createAyasExternalResearchStore({ rootDir: path.join(root, "external-research") }), noveltyStore: createAyasResearchNoveltyStore({ rootDir: path.join(root, "novelty") }), maxRetries: 0, timeoutMs: 1000 },
  };
}

async function main(): Promise<void> {
  try {
    assert.ok(AYAS_TRACKED_RELEASE_SOURCES.react && AYAS_TRACKED_RELEASE_SOURCES.nextjs && !AYAS_TRACKED_RELEASE_SOURCES["stub-untracked"], "fixture ids match the tracked list");

    await scenario("a DEEP with nothing owed still reads the tracked release feeds, and only those", async () => {
      const root = tempRoot();
      const result = await tickAyasResearchScheduler(deps(root));
      assert.equal(result.outcome, "DEEP", "assert.equal(result.outcome, \"DEEP\")");
      const tried = result.deep!.sourceErrors.map((e) => e.sourceId);
      assert.deepEqual(tried, ["react", "nextjs"], JSON.stringify(result.deep!.sourceErrors));
      assert.equal(result.state.pendingDeepSourceIds, undefined, "a failed tracked feed is not carried as owed");
    });

    await scenario("owed sources come first; a tracked feed is not tried twice when it is owed itself", async () => {
      const root = tempRoot();
      const store = createAyasResearchSchedulerStateStore({ rootDir: root });
      store.write({ ...store.read(), pendingDeepSourceIds: ["stub-untracked", "nextjs"] });
      const result = await tickAyasResearchScheduler(deps(root));
      assert.equal(result.outcome, "DEEP", "assert.equal(result.outcome, \"DEEP\")");
      assert.deepEqual(result.deep!.sourceErrors.map((e) => e.sourceId), ["stub-untracked", "nextjs", "react"], "assert.deepEqual(result.deep!.sourceErrors.map((e) => e.sourceId), [\"stub-untracked\", \"nextjs\", \"react\"])");
    });

    await scenario("when the budget runs out, only the owed sources are carried to the next tick, never the ride-along feeds", async () => {
      const root = tempRoot();
      const store = createAyasResearchSchedulerStateStore({ rootDir: root });
      store.write({ ...store.read(), pendingDeepSourceIds: ["stub-untracked"] });
      // The scheduler's clock moves a minute per reading: the cycle starts before the deadline, and by the time the
      // DEEP scan looks at its first source the budget is spent, so every source of the scan is deferred.
      const t0 = Date.now();
      let reads = 0;
      const now = () => new Date(t0 + 60_000 * reads++).toISOString();
      const result = await tickAyasResearchScheduler({ ...deps(root), now, deadlineAt: new Date(t0 + 90_000).toISOString(), deep: { ...deps(root).deep, now } });
      assert.equal(result.outcome, "DEEP", "assert.equal(result.outcome, \"DEEP\")");
      assert.deepEqual([...result.deep!.deferredSourceIds].sort(), ["nextjs", "react", "stub-untracked"], "assert.deepEqual([...result.deep!.deferredSourceIds].sort(), [\"nextjs\", \"react\", \"stub-untracked\"])");
      assert.deepEqual(result.state.pendingDeepSourceIds, ["stub-untracked"], "assert.deepEqual(result.state.pendingDeepSourceIds, [\"stub-untracked\"])");
    });

    await scenario("a LIGHT cycle reads no tracked feed in depth (the ride-along is DEEP-only)", async () => {
      const root = tempRoot();
      const t0 = Date.now();
      const first = await tickAyasResearchScheduler({ ...deps(root), now: () => new Date(t0).toISOString() });
      assert.equal(first.outcome, "DEEP", "assert.equal(first.outcome, \"DEEP\")");
      // 2.5 h later: LIGHT (every 2 h) is due, DEEP (every 3 h) is not.
      const later = () => new Date(t0 + 150 * 60_000).toISOString();
      const second = await tickAyasResearchScheduler({ ...deps(root), now: later });
      assert.equal(second.outcome, "LIGHT", "assert.equal(second.outcome, \"LIGHT\")");
      assert.equal(second.deep, undefined, "assert.equal(second.deep, undefined)");
    });
  } finally {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  }
  console.log(`PASS (${count} scenarios)`);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
