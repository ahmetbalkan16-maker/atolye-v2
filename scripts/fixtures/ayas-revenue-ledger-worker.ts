/** Actual child-process append, allowed only in the parent's bounded, owned TEMP fixture. */
import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AyasRevenueLedgerStore } from "../../src/lib/ayas/revenue/AyasRevenueLedgerStore";
async function main() {
  const [rootArg, taskArg] = process.argv.slice(2);
  assert.ok(rootArg && taskArg); const root = fs.realpathSync.native(rootArg), parent = path.dirname(root);
  assert.equal(path.dirname(parent).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(parent).startsWith("ayas-revenue-ledger-smoke-")); assert.match(path.basename(root), /^[PH]\d{2}$/);
  assert.ok(!fs.existsSync(path.join(root, ".git"))); assert.match(taskArg, /^[ab]$/);
  const task = JSON.parse(fs.readFileSync(path.join(root, `task-${taskArg}.json`), "utf8")) as { input: unknown; maxEntries?: number };
  fs.writeFileSync(path.join(root, `ready-${taskArg}`), "ready", { flag: "wx" });
  const deadline = Date.now() + 15_000;
  while (!fs.existsSync(path.join(root, "go"))) { assert.ok(Date.now() < deadline, "parent barrier timed out"); await new Promise((r) => setTimeout(r, 10)); }
  const ledger = new AyasRevenueLedgerStore(root, { maxEntries: task.maxEntries }), originalRead = ledger.read.bind(ledger), originalMkdir = fsPromises.mkdir;
  let initialRevision: number | undefined, paused = false;
  ledger.read = () => { const current = originalRead(); initialRevision ??= current.revision; return current; };
  // The real lock's first async mkdir is AFTER append's initial snapshot and BEFORE lock acquisition/publication.
  // Both children pause here; no production test hook or policy override is introduced.
  fsPromises.mkdir = (async (...args: Parameters<typeof fsPromises.mkdir>) => {
    if (!paused && path.resolve(String(args[0])) === path.join(root, "data", "brain", "revenue", "execution")) {
      paused = true; assert.notEqual(initialRevision, undefined); const snapshotPending = path.join(root, `.snapshot-${taskArg}.tmp`);
      fs.writeFileSync(snapshotPending, JSON.stringify({ revision: initialRevision }), { flag: "wx" }); fs.renameSync(snapshotPending, path.join(root, `snapshot-${taskArg}.json`));
      const snapshotDeadline = Date.now() + 20_000;
      while (!fs.existsSync(path.join(root, "go-after-snapshot"))) { assert.ok(Date.now() < snapshotDeadline, "snapshot barrier timed out"); await new Promise(r => setTimeout(r, 10)); }
    }
    return originalMkdir(...args);
  }) as typeof fsPromises.mkdir;
  try { const result = await ledger.append(task.input); console.log(JSON.stringify({ status: result.status, revision: result.revision, entryId: result.entry.entryId })); }
  catch (e) { console.log(JSON.stringify({ status: "REFUSED", code: e instanceof Error ? e.message : "UNKNOWN" })); }
  finally { fsPromises.mkdir = originalMkdir; }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
