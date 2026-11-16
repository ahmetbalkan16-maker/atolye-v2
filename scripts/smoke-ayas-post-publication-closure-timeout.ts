import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { AYAS_POST_PUBLICATION_GRAPHIFY_TIMEOUT_MS, AyasPostPublicationClosureError, refreshAyasGraphifyForHead } from "../src/lib/brain/autonomy/AyasPostPublicationClosure";

/**
 * 2026-11-16: batch b159a548 was committed and pushed (7e2fbbb0) but its post-push `graphify update` hit the 5-minute
 * bound (`spawnSync cmd.exe ETIMEDOUT`), so Gelişim Merkezi showed "PAKET KURTARMA" until the self-heal reconciled it.
 * The next full refresh on the same repo took 4 min 09 s. This suite pins the bound with room for a busy machine and
 * proves a refresh that still fails stays a closed failure.
 */
let count = 0;
function scenario(name: string, fn: () => void): void {
  fn(); count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const OBSERVED_FULL_REFRESH_MS = 249_000; // 33177c00, 2026-11-16 13:13:35 → 13:17:44

scenario("the refresh bound leaves at least three times the observed full Graphify run", () => {
  assert.ok(AYAS_POST_PUBLICATION_GRAPHIFY_TIMEOUT_MS >= 3 * OBSERVED_FULL_REFRESH_MS, `bound ${AYAS_POST_PUBLICATION_GRAPHIFY_TIMEOUT_MS} ms is too tight`);
  assert.ok(AYAS_POST_PUBLICATION_GRAPHIFY_TIMEOUT_MS <= 30 * 60_000, "a stuck run must still end inside half an hour");
});

scenario("the production launcher uses the exported bound, not a literal", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "brain", "autonomy", "AyasPostPublicationClosure.ts"), "utf8");
  assert.match(source, /timeout: AYAS_POST_PUBLICATION_GRAPHIFY_TIMEOUT_MS/);
  assert.doesNotMatch(source, /timeout: 300_000/);
});

scenario("a refresh that times out is still a closed refresh failure", () => {
  assert.throws(() => refreshAyasGraphifyForHead("a".repeat(40), {
    repoRoot: ".",
    refreshGraphify: () => { throw new AyasPostPublicationClosureError("AYAS_POST_PUBLICATION_GRAPHIFY_REFRESH_FAILED", "spawnSync C:\\WINDOWS\\system32\\cmd.exe ETIMEDOUT"); },
    readGraphifyBranch: () => ({ lastAnalyzedHead: "a".repeat(40), stale: false }),
    readIntegrity: () => ({ duplicateIds: 0, danglingEdges: 0, selfLoops: 0 }),
  }), (error: unknown) => error instanceof AyasPostPublicationClosureError && error.code === "AYAS_POST_PUBLICATION_GRAPHIFY_REFRESH_FAILED");
});

scenario("a refresh that finishes inside the bound closes the Graphify half", () => {
  const head = "b".repeat(40);
  const integrity = refreshAyasGraphifyForHead(head, {
    repoRoot: ".",
    refreshGraphify: () => undefined,
    readGraphifyBranch: () => ({ lastAnalyzedHead: head, stale: false }),
    readIntegrity: () => ({ duplicateIds: 0, danglingEdges: 0, selfLoops: 0 }),
  });
  assert.deepEqual(integrity, { duplicateIds: 0, danglingEdges: 0, selfLoops: 0 });
});

console.log(`AYAS post-publication closure timeout smoke: PASS (${count} scenarios)`);
