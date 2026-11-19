import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AYAS_POST_PUBLICATION_GRAPHIFY_TIMEOUT_MS, AyasPostPublicationClosureError, ayasWindowsOrphanSweepScript, refreshAyasGraphifyForHead,
  sweepAyasWindowsOrphans,
} from "../src/lib/brain/autonomy/AyasPostPublicationClosure";

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

scenario("the orphan sweep script names only the dead launcher's children born after the launch", () => {
  const script = ayasWindowsOrphanSweepScript(4242, 1_800_000_000_000);
  assert.match(script, /ParentProcessId=4242'/);
  assert.match(script, /FromUnixTimeMilliseconds\(1799999998000\)/);
  assert.match(script, /CreationDate -ge \$floor/);
  assert.match(script, /taskkill\.exe \/PID \$_\.ProcessId \/T \/F/);
  assert.throws(() => ayasWindowsOrphanSweepScript(0, 1), RangeError);
  assert.throws(() => ayasWindowsOrphanSweepScript(12.5, 1), RangeError);
  assert.throws(() => ayasWindowsOrphanSweepScript(1, Number.NaN), RangeError);
});

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

if (process.platform === "win32") {
  scenario("a timed-out cmd.exe launch leaves its child running, and the sweep ends it (Windows, real processes)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-orphan-sweep-"));
    const marker = path.join(dir, "child.pid");
    const childScript = path.join(dir, "child.js");
    fs.writeFileSync(childScript, `require("fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setTimeout(() => {}, 120000);\n`);
    const comSpec = process.env.ComSpec ?? "cmd.exe";
    const startedAtMs = Date.now();
    // Verbatim: Node would otherwise escape the inner quotes as \" and cmd.exe would not find node.exe.
    const run = spawnSync(comSpec, ["/d", "/s", "/c", `""${process.execPath}" child.js"`], { cwd: dir, windowsHide: true, windowsVerbatimArguments: true, timeout: 4_000, encoding: "utf8" });
    const launch = { code: (run.error as NodeJS.ErrnoException | undefined)?.code, pid: run.pid };
    assert.equal(launch.code, "ETIMEDOUT", "the sleeping child must outlive the bound");
    assert.equal(typeof launch.pid, "number");
    // The production launcher uses execFileSync: its timeout error must carry the same code and pid the sweep needs.
    let production: { code?: unknown; pid?: unknown } = {};
    try { execFileSync(comSpec, ["/d", "/s", "/c", "ping -n 6 127.0.0.1 >nul"], { windowsHide: true, timeout: 1_000, encoding: "utf8" }); } catch (error) { production = error as typeof production; }
    assert.equal(production.code, "ETIMEDOUT");
    assert.equal(typeof production.pid, "number");
    const orphan = Number(fs.readFileSync(marker, "utf8"));
    try {
      assert.ok(alive(orphan), "Node's timeout kills only cmd.exe; the child is orphaned");
      sweepAyasWindowsOrphans(launch.pid as number, startedAtMs);
      const until = Date.now() + 10_000;
      while (alive(orphan) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      assert.equal(alive(orphan), false, "the sweep must end the orphan");
    } finally {
      if (alive(orphan)) process.kill(orphan);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

console.log(`AYAS post-publication closure timeout smoke: PASS (${count} scenarios)`);
