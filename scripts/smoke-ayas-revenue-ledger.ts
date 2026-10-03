/** Stage16.2: 53 primary +10 frozen held-out. All mutations use an owned TEMP checkout; live data is fingerprinted. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { AyasRevenueLedgerStore } from "../src/lib/ayas/revenue/AyasRevenueLedgerStore";
import { AYAS_REVENUE_LEDGER_MAX_BYTES, AYAS_REVENUE_LEDGER_MAX_ENTRIES, createAyasRevenueLedgerEntry, digestAyasRevenueExternalId,
  validateAyasRevenueLedgerState, type AyasRevenueLedgerInput } from "../src/lib/ayas/revenue/AyasRevenueLedger";
import { groupAyasRevenueEconomics, summarizeAyasRevenueEconomics } from "../src/lib/ayas/revenue/AyasRevenueEconomics";
import { decideAyasRevenueSpend, AYAS_REVENUE_AUTONOMOUS_SPEND_USD } from "../src/lib/ayas/revenue/AyasRevenueSpendPolicy";
import { classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";
import { REVENUE_LEDGER_FIXTURE_AT as AT, revenueLedgerFixtureFact as fact, revenueLedgerFixtureState as state } from "./fixtures/ayas-revenue-ledger-fixture";

const repo = process.cwd(), parent = fs.realpathSync.native(os.tmpdir()), temp = fs.mkdtempSync(path.join(parent, "ayas-revenue-ledger-smoke-"));
const selected = process.env.AYAS_REVENUE_LEDGER_MUTATION_CASE;
if (selected !== undefined) { assert.equal(path.dirname(fs.realpathSync.native(repo)).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(repo).startsWith("ayas-revenue-ledger-audit-")); assert.ok(!fs.existsSync(path.join(repo, ".git"))); assert.match(selected, /^[PH]\d{2}$/); }
const results: { id: string; set: string; ok: boolean; detail?: string }[] = [];
function fingerprint(root: string): string {
  if (!fs.existsSync(root)) return "MISSING";
  const records: string[] = [];
  const visit = (p: string) => { const s = fs.lstatSync(p), rel = path.relative(root, p); records.push(`${rel}:${s.mode}:${s.size}:${s.mtimeMs}`);
    if (s.isSymbolicLink()) { records.push(fs.readlinkSync(p)); return; }
    if (s.isDirectory()) for (const n of fs.readdirSync(p).sort()) visit(path.join(p, n)); else records.push(createHash("sha256").update(fs.readFileSync(p)).digest("hex")); };
  visit(root); return createHash("sha256").update(records.join("\n")).digest("hex");
}
const liveRoot = path.join(repo, "data", "brain", "revenue"), liveBefore = fingerprint(liveRoot);
const file = (root: string) => path.join(root, "data", "brain", "revenue", "ledger.json");
const store = (root: string, maxEntries?: number) => new AyasRevenueLedgerStore(root, { now: () => AT, ...(maxEntries ? { maxEntries } : {}) });
const code = (name: string) => new RegExp(`AYAS_REVENUE_LEDGER_${name}`);
const economics = (...facts: AyasRevenueLedgerInput[]) => summarizeAyasRevenueEconomics(state(...facts));
const reversal = (tag: string, input: AyasRevenueLedgerInput, patch: Record<string, unknown> = {}) => fact(tag, "REVERSAL", input.amount.valueMinor,
  { platform: input.platform, amount: { ...input.amount }, orderDigest: input.orderDigest, offerDigest: input.offerDigest, activityDigest: input.activityDigest,
    reversesEntryId: createAyasRevenueLedgerEntry(input, AT).entryId, notesCode: "CORRECTION", ...patch });
async function scenario(set: "primary" | "held-out", id: string, name: string, body: (root: string) => void | Promise<void>) {
  if (selected !== undefined && selected !== id) return;
  const root = path.join(temp, id); fs.mkdirSync(root);
  if (selected !== undefined) { await body(root); results.push({ id, set, ok: true }); return; }
  try { await body(root); results.push({ id, set, ok: true }); } catch (e) { results.push({ id, set, ok: false, detail: `${name}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` }); }
  if (process.env.SMOKE_TRACE === "1") console.log(`${results.at(-1)!.ok ? "PASS" : "FAIL"} ${id}: ${name}`);
}
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" }; for (const k of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[k]) env[k] = process.env[k];
async function race(root: string, a: AyasRevenueLedgerInput, b: AyasRevenueLedgerInput, maxEntries?: number): Promise<{ status: string; revision?: number; code?: string }[]> {
  const worker = path.resolve("scripts/fixtures/ayas-revenue-ledger-worker.ts"), loader = pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href;
  const expectedInitialRevision = store(root).read().revision;
  const children: ReturnType<typeof spawn>[] = [];
  try {
    const promises = [a, b].map((input, i) => {
      const tag = i === 0 ? "a" : "b"; fs.writeFileSync(path.join(root, `task-${tag}.json`), JSON.stringify({ input, maxEntries }));
      const child = spawn(process.execPath, ["--import", loader, worker, root, tag], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); children.push(child);
      return new Promise<{ status: string; revision?: number; code?: string }>((resolve, reject) => {
        let out = "", err = ""; const timer = setTimeout(() => { child.kill(); reject(new Error("child timeout")); }, 60_000);
        child.stdout!.on("data", (d) => { out += String(d); }); child.stderr!.on("data", (d) => { err += String(d); });
        child.on("error", (e) => { clearTimeout(timer); reject(e); }); child.on("close", (exit, signal) => { clearTimeout(timer);
          try { assert.equal(signal, null); assert.equal(exit, 0, `${err}${out}`); resolve(JSON.parse(out.trim())); } catch (e) { reject(e); } });
      });
    });
    // Attach the rejection observer before waiting for the barrier.
    const done = Promise.all(promises); void done.catch(() => undefined);
    const deadline = Date.now() + 20_000;
    while (!["a", "b"].every((tag) => fs.existsSync(path.join(root, `ready-${tag}`)))) {
      assert.ok(Date.now() < deadline, "child readiness timed out"); await new Promise((r) => setTimeout(r, 10));
    }
    fs.writeFileSync(path.join(root, "go"), "go");
    const snapshotDeadline = Date.now() + 25_000;
    while (!["a", "b"].every(tag => fs.existsSync(path.join(root, `snapshot-${tag}.json`)))) {
      assert.ok(Date.now() < snapshotDeadline, "snapshot readiness timed out"); await new Promise(r => setTimeout(r, 10));
    }
    for (const tag of ["a", "b"]) assert.equal(JSON.parse(fs.readFileSync(path.join(root, `snapshot-${tag}.json`), "utf8")).revision, expectedInitialRevision);
    fs.writeFileSync(path.join(root, "go-after-snapshot"), "go"); return await done;
  } finally { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill(); }
}
function enterSafe(root: string, corrupt = false) {
  const d = path.join(root, "data", "brain", "execution", "safe-mode"); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "000001.json"), corrupt ? "{" : JSON.stringify({ schemaVersion: "1", sequence: 1, event: "ENTER", at: AT, actor: "LOCAL_OPERATOR", previousDigest: null, healthChecks: null }));
}
function tamper(root: string, alter: (v: Record<string, unknown>) => void) { const v = JSON.parse(fs.readFileSync(file(root), "utf8")); alter(v); fs.writeFileSync(file(root), JSON.stringify(v, null, 2) + "\n"); }
async function main() {
  await scenario("primary", "P01", "missing store read creates nothing", (root) => { assert.equal(store(root).read().revision, 0); assert.deepEqual(fs.readdirSync(root), []); });
  await scenario("primary", "P02", "append durable restart immutable observation", async (root) => { const r = await store(root).append(fact("append")); assert.equal(r.status, "APPENDED"); assert.equal(r.grantsAuthority, false);
    assert.deepEqual(store(root).read().entries, [r.entry]); assert.ok(Object.isFrozen(r.entry.amount)); assert.ok(Object.isFrozen(store(root).read().entries)); });
  await scenario("primary", "P03", "sequential exact replay performs no filesystem write", async (root) => {
    const s = store(root), input = fact("replay"), first = await s.append(input), bytes = fs.readFileSync(file(root)), before = fingerprint(root); let writes = 0;
    const write = fs.writeFileSync, rename = fs.renameSync, mkdir = fs.mkdirSync, open = fs.openSync;
    fs.writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => { writes++; return write(...args); }) as typeof fs.writeFileSync;
    fs.renameSync = ((...args: Parameters<typeof fs.renameSync>) => { writes++; return rename(...args); }) as typeof fs.renameSync;
    fs.mkdirSync = ((...args: Parameters<typeof fs.mkdirSync>) => { writes++; return mkdir(...args); }) as typeof fs.mkdirSync;
    fs.openSync = ((p: fs.PathLike, flags: string | number, mode?: fs.Mode) => { if (typeof flags === "string" ? flags !== "r" : (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) !== 0) writes++; return open(p, flags, mode); }) as typeof fs.openSync;
    try { const r = await new AyasRevenueLedgerStore(root, { now: () => "2026-10-04T12:00:00.000Z" }).append(input); assert.equal(r.status, "REPLAY"); assert.equal(r.revision, 1); assert.deepEqual(r.entry, first.entry); assert.equal(writes, 0); }
    finally { fs.writeFileSync = write; fs.renameSync = rename; fs.mkdirSync = mkdir; fs.openSync = open; }
    assert.deepEqual(fs.readFileSync(file(root)), bytes); assert.equal(fingerprint(root), before);
  });
  await scenario("primary", "P04", "amount conflict preserves bytes", async (root) => { const s = store(root), input = fact("conflict"); await s.append(input); const before = fingerprint(root);
    await assert.rejects(s.append({ ...input, amount: { ...input.amount, valueMinor: 999 } }), code("CONFLICT")); assert.equal(fingerprint(root), before); });
  await scenario("primary", "P05", "economic event conflict", async (root) => { const s = store(root), input = fact("event"); await s.append(input); await assert.rejects(s.append({ ...input, event: "REFUND" }), code("CONFLICT")); });
  await scenario("primary", "P06", "group identity and time conflicts", async (root) => { const s = store(root), input = fact("group"); await s.append(input);
    for (const patch of [{ orderDigest: null }, { offerDigest: null }, { activityDigest: null }, { occurredAt: "2026-10-02T12:00:00.000Z" }]) await assert.rejects(s.append({ ...input, ...patch }), code("CONFLICT")); });
  await scenario("primary", "P07", "changed evidence never silently upgrades a replay", async (root) => { const s = store(root), input = fact("evidence"); await s.append(input);
    await assert.rejects(s.append({ ...input, evidence: { ...input.evidence, evidenceDigest: digestAyasRevenueExternalId("different") } }), code("CONFLICT")); assert.equal(s.read().entries[0]!.evidence.source, "OWNER_IMPORT"); });
  await scenario("primary", "P08", "two process distinct append race on nonempty ledger loses no fact", async (root) => { await store(root).append(fact("race-initial")); const r = await race(root, fact("race-a"), fact("race-b")); assert.deepEqual(r.map(v => v.status), ["APPENDED", "APPENDED"]);
    assert.equal(store(root).read().revision, 3); assert.equal(new Set(store(root).read().entries.map(v => v.entryId)).size, 3); });
  await scenario("primary", "P09", "two process exact replay race appends once", async (root) => { const input = fact("race-same"), r = await race(root, input, input); assert.deepEqual(r.map(v => v.status).sort(), ["APPENDED", "REPLAY"]); assert.equal(store(root).read().revision, 1); });
  await scenario("primary", "P10", "two process reversal race permits only one reversal", async (root) => { const input = fact("race-target"); await store(root).append(input);
    const r = await race(root, reversal("reverse-a", input), reversal("reverse-b", input)); assert.deepEqual(r.map(v => v.status).sort(), ["APPENDED", "REFUSED"]); assert.equal(r.find(v => v.status === "REFUSED")!.code, "AYAS_REVENUE_LEDGER_INVALID_REVERSAL"); assert.equal(store(root).read().revision, 2); });
  await scenario("primary", "P11", "failed atomic rename leaves canonical bytes intact", async (root) => { const s = store(root); await s.append(fact("original")); const bytes = fs.readFileSync(file(root)), original = fs.renameSync;
    fs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => { if (String(to) === file(root)) throw new Error("fixture rename failure"); return original(from, to); }) as typeof fs.renameSync;
    try { await assert.rejects(s.append(fact("not-published")), code("STORAGE_IO")); } finally { fs.renameSync = original; }
    assert.deepEqual(fs.readFileSync(file(root)), bytes); assert.equal(s.read().revision, 1); assert.ok(!fs.readdirSync(path.dirname(file(root))).some(n => n.endsWith(".tmp"))); });
  await scenario("primary", "P12", "failed fsync does not publish", async (root) => { const s = store(root); await s.append(fact("synced")); const bytes = fs.readFileSync(file(root)), original = fs.fsyncSync;
    fs.fsyncSync = (() => { throw new Error("fixture fsync failure"); }) as typeof fs.fsyncSync;
    try { await assert.rejects(s.append(fact("not-synced")), code("STORAGE_IO")); } finally { fs.fsyncSync = original; } assert.deepEqual(fs.readFileSync(file(root)), bytes); });
  await scenario("primary", "P13", "corrupt JSON refuses read and append without overwrite", async (root) => { const s = store(root); await s.append(fact("corrupt")); fs.writeFileSync(file(root), "{");
    assert.throws(() => s.read(), code("INVALID_LEDGER")); await assert.rejects(s.append(fact("new")), code("INVALID_LEDGER")); assert.equal(fs.readFileSync(file(root), "utf8"), "{"); });
  await scenario("primary", "P14", "wrong revision and invalid history fail closed", async (root) => { const s = store(root); await s.append(fact("revision")); tamper(root, v => { v.revision = 2; }); assert.throws(() => s.read(), code("INVALID_LEDGER"));
    for (const v of [{ schemaVersion: "1", revision: 0, entries: {}, }, { schemaVersion: "2", revision: 0, entries: [] }, { schemaVersion: "1", revision: 0, entries: [], customer: "raw" }]) assert.throws(() => validateAyasRevenueLedgerState(v), code("INVALID_LEDGER")); });
  await scenario("primary", "P15", "stored identity tampering refused", async (root) => { const s = store(root); await s.append(fact("identity")); tamper(root, v => { ((v.entries as Record<string, unknown>[])[0]!.amount as Record<string, unknown>).valueMinor = 2; }); assert.throws(() => s.read(), code("INVALID_LEDGER")); });
  await scenario("primary", "P16", "duplicate stored external event refused", async (root) => { const s = store(root); await s.append(fact("duplicate")); tamper(root, v => { (v.entries as unknown[]).push((v.entries as unknown[])[0]); v.revision = 2; }); assert.throws(() => s.read(), code("INVALID_LEDGER")); });
  await scenario("primary", "P17", "unknown PII and platform payload fields impossible", async (root) => { for (const key of ["customerName", "email", "phone", "address", "message", "bank", "token", "rawPlatformJson", "authority"]) await assert.rejects(store(root).append({ ...fact(`privacy-${key}`), [key]: "raw" }), code("INVALID_INPUT")); assert.ok(!fs.existsSync(path.join(root, "data"))); });
  await scenario("primary", "P18", "nested money and evidence unknown fields refused", async (root) => { const input = fact("nested"); for (const patch of [{ amount: { ...input.amount, profit: 10 } }, { evidence: { ...input.evidence, raw: "buyer@example.com" } }]) await assert.rejects(store(root).append({ ...input, ...patch }), code("INVALID_INPUT")); });
  await scenario("primary", "P19", "secret adapter text and forged provenance refused", async (root) => { const input = fact("secret"); for (const evidence of [{ ...input.evidence, source: "PLATFORM_ADAPTER", adapterId: "sk-proj-" + "a".repeat(24), adapterVersion: 1 }, { ...input.evidence, adapterId: "etsy-official", adapterVersion: 1 }]) await assert.rejects(store(root).append({ ...input, evidence }), code("INVALID_INPUT")); });
  await scenario("primary", "P20", "negative magnitudes including negative zero refused", async (root) => { for (const n of [-1, -0]) await assert.rejects(store(root).append(fact("negative", "REFUND", n)), code("INVALID_INPUT")); });
  await scenario("primary", "P21", "fractional unsafe and unbounded money refused", async (root) => { for (const n of [0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1_000_000_000_001]) await assert.rejects(store(root).append(fact("unsafe", "GROSS_REVENUE", n)), code("INVALID_INPUT")); });
  await scenario("primary", "P22", "currency vocabulary exact", async (root) => { for (const currency of ["usd", "BTC", "US D", "", "USD;execute"]) await assert.rejects(store(root).append({ ...fact("currency"), amount: { valueMinor: 100, currency } }), code("INVALID_INPUT")); });
  await scenario("primary", "P23", "closed event platform source and notes", async (root) => { const input = fact("vocabulary"); for (const patch of [{ event: "PURCHASE" }, { platform: "amazon" }, { notesCode: "send funds" }, { schemaVersion: "2" }, { evidence: { ...input.evidence, source: "MODEL" } }, { occurredAt: "not-a-date" }]) await assert.rejects(store(root).append({ ...input, ...patch }), code("INVALID_INPUT")); });
  await scenario("primary", "P24", "getters never run before refusal", async (root) => { let gets = 0; const input = fact("getter"); const amount = { currency: "USD" }; Object.defineProperty(amount, "valueMinor", { enumerable: true, get() { gets++; return 1; } });
    await assert.rejects(store(root).append({ ...input, amount }), code("INVALID_INPUT")); const evidence = { ...input.evidence }; Object.defineProperty(evidence, "source", { enumerable: true, get() { gets++; return "OWNER_IMPORT"; } }); await assert.rejects(store(root).append({ ...input, evidence }), code("INVALID_INPUT")); assert.equal(gets, 0); });
  await scenario("primary", "P25", "hostile reflection proxy refuses without leak", async (root) => { await assert.rejects(store(root).append(new Proxy(fact("proxy"), { getPrototypeOf() { throw new Error("private fixture"); } })), code("INVALID_INPUT")); await assert.rejects(store(root).append(new Proxy(fact("plain-proxy"), {})), code("INVALID_INPUT")); });
  await scenario("primary", "P26", "pending caller mutation cannot change committed snapshot", async (root) => { const input = fact("snapshot") as unknown as { amount: { valueMinor: number }; evidence: { source: string } }; const pending = store(root).append(input); input.amount.valueMinor = 777; input.evidence.source = "MODEL";
    const r = await pending; assert.equal(r.entry.amount.valueMinor, 1000); assert.equal(store(root).read().entries[0]!.evidence.source, "OWNER_IMPORT"); });
  await scenario("primary", "P27", "ancestor junction escape refused", async (root) => { const outside = path.join(temp, "outside-P27"); fs.mkdirSync(outside); const link = path.join(root, "data"); fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    try { assert.throws(() => store(root).read(), code("STORAGE_UNSAFE")); await assert.rejects(store(root).append(fact("escape")), code("STORAGE_UNSAFE")); assert.deepEqual(fs.readdirSync(outside), []); } finally { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); } });
  await scenario("primary", "P28", "canonical ledger link refused (directory junction on Windows)", async (root) => { const s = store(root); await s.append(fact("link")); const outside = path.join(temp, "outside-P28"); fs.mkdirSync(outside); const outsideFile = path.join(outside, "ledger.json"); fs.renameSync(file(root), outsideFile);
    fs.symlinkSync(process.platform === "win32" ? outside : outsideFile, file(root), process.platform === "win32" ? "junction" : "file");
    try { assert.throws(() => s.read(), code("STORAGE_UNSAFE")); } finally { if (process.platform === "win32") fs.rmdirSync(file(root)); else fs.unlinkSync(file(root)); } });
  await scenario("primary", "P29", "canonical hardlink refused", async (root) => { const s = store(root); await s.append(fact("hardlink")); fs.linkSync(file(root), path.join(root, "other.json")); assert.throws(() => s.read(), code("STORAGE_UNSAFE")); });
  await scenario("primary", "P30", "canonical non-file refused", (root) => { fs.mkdirSync(file(root), { recursive: true }); assert.throws(() => store(root).read(), code("STORAGE_UNSAFE")); });
  await scenario("primary", "P31", "capacity refuses without truncation; replay remains read", async (root) => { const s = store(root, 1), input = fact("capacity"); await s.append(input); const bytes = fs.readFileSync(file(root));
    await assert.rejects(s.append(fact("overflow")), code("CAPACITY")); assert.equal((await s.append(input)).status, "REPLAY"); assert.deepEqual(fs.readFileSync(file(root)), bytes); assert.equal(s.read().entries.length, 1); });
  await scenario("primary", "P32", "oversized stored bytes refused before parsing", async (root) => { const s = store(root); await s.append(fact("size")); fs.truncateSync(file(root), AYAS_REVENUE_LEDGER_MAX_BYTES + 1); assert.throws(() => s.read(), code("STORAGE_UNSAFE")); });
  await scenario("primary", "P33", "SAFE_READ_ONLY blocks before first revenue effect; replay still read", async (root) => { const s = store(root); await s.append(fact("safe-replay")); enterSafe(root); const before = fingerprint(path.dirname(file(root)));
    await assert.rejects(s.append(fact("safe-blocked")), /AYAS_SAFE_READ_ONLY/); assert.equal((await s.append(fact("safe-replay"))).status, "REPLAY"); assert.equal(fingerprint(path.dirname(file(root))), before); });
  await scenario("primary", "P34", "safe mode entered after fsync prevents publication", async (root) => { const s = store(root); await s.append(fact("before-safe")); const bytes = fs.readFileSync(file(root)), original = fs.fsyncSync;
    fs.fsyncSync = ((fd: number) => { original(fd); enterSafe(root); }) as typeof fs.fsyncSync;
    try { await assert.rejects(s.append(fact("after-safe")), /AYAS_SAFE_READ_ONLY/); } finally { fs.fsyncSync = original; } assert.deepEqual(fs.readFileSync(file(root)), bytes); });
  await scenario("primary", "P35", "unavailable safe mode fails closed", async (root) => { enterSafe(root, true); await assert.rejects(store(root).append(fact("unknown-mode")), /AYAS_SAFE_MODE_UNAVAILABLE/); assert.ok(!fs.existsSync(path.join(root, "data", "brain", "revenue"))); });
  await scenario("primary", "P36", "correction by immutable reversal plus replacement", async (root) => { const s = store(root), old = fact("old-sale"); await s.append(old); const initial = s.read().entries[0]; await s.append(reversal("correct-old", old)); await s.append(fact("new-sale", "GROSS_REVENUE", 800));
    assert.deepEqual(s.read().entries[0], initial); assert.equal(summarizeAyasRevenueEconomics(s.read())[0]!.grossRevenueMinor, 800); assert.equal(summarizeAyasRevenueEconomics(s.read())[0]!.reversalCount, 1); });
  await scenario("primary", "P37", "second reversal refused", async (root) => { const s = store(root), old = fact("double-target"); await s.append(old); await s.append(reversal("first-reverse", old)); await assert.rejects(s.append(reversal("second-reverse", old)), code("INVALID_REVERSAL")); assert.equal(s.read().revision, 2); });
  await scenario("primary", "P38", "reversal cannot itself be reversed", async (root) => { const s = store(root), old = fact("reverse-target"), reverse = reversal("reverse-it", old); await s.append(old); await s.append(reverse); await assert.rejects(s.append(reversal("reverse-reverse", reverse)), code("INVALID_REVERSAL")); });
  await scenario("primary", "P39", "reversal exact target platform currency magnitude group and time", async (root) => { const s = store(root), old = fact("exact-target"); await s.append(old);
    for (const patch of [{ platform: "upwork" }, { amount: { valueMinor: 1000, currency: "TRY" } }, { amount: { valueMinor: 999, currency: "USD" } }, { orderDigest: null }, { offerDigest: null }, { activityDigest: null }, { occurredAt: "2026-10-02T12:00:00.000Z" }, { reversesEntryId: "revenue-" + "a".repeat(64) }]) await assert.rejects(s.append(reversal("wrong-reversal", old, patch)), code("INVALID_REVERSAL")); });
  await scenario("primary", "P40", "all contribution components and margin calculated", () => { const e = economics(fact("gross", "GROSS_REVENUE", 10000), fact("refund", "REFUND", 1000), fact("fee", "PLATFORM_FEE", 600), fact("processing", "PAYMENT_PROCESSING_FEE", 300),
    fact("delivery", "VARIABLE_DELIVERY_COST", 400), fact("ad", "AD_SPEND", 200), fact("other", "OTHER_COST", 100))[0]!;
    assert.equal(e.netRevenueMinor, 9000); assert.equal(e.variableCostsMinor, 1600); assert.equal(e.contributionProfitMinor, 7400); assert.equal(e.contributionMargin, 7400 / 9000); assert.equal(e.status, "COMPLETE_OBSERVATIONS"); });
  await scenario("primary", "P41", "currencies never added even without currency grouping", () => { const usd = fact("usd"), tryFact = fact("try", "GROSS_REVENUE", 5000, { amount: { valueMinor: 5000, currency: "TRY" } }), jpy = fact("jpy", "GROSS_REVENUE", 10, { amount: { valueMinor: 10, currency: "JPY" } });
    const groups = groupAyasRevenueEconomics(state(usd, tryFact, jpy), ["platform"]); assert.equal(groups.length, 3); assert.deepEqual(groups.map(g => g.economics.currency).sort(), ["JPY", "TRY", "USD"]); assert.equal(groups.find(g => g.economics.currency === "TRY")!.economics.grossRevenueMinor, 5000); });
  await scenario("primary", "P42", "tax and payout separately displayed, not revenue or costs", () => { const e = economics(fact("sale"), fact("tax", "TAX_WITHHELD", 100), fact("payout", "PAYOUT_OBSERVED", 900))[0]!; assert.equal(e.grossRevenueMinor, 1000); assert.equal(e.taxWithheldMinor, 100); assert.equal(e.payoutObservedMinor, 900); assert.equal(e.variableCostsMinor, 0); });
  await scenario("primary", "P43", "refund over sales has negative net; margin null", () => { const e = economics(fact("sale-small"), fact("refund-large", "REFUND", 1500), fact("fee-zero", "PLATFORM_FEE", 0), fact("processing-zero", "PAYMENT_PROCESSING_FEE", 0))[0]!;
    assert.equal(e.netRevenueMinor, -500); assert.equal(e.contributionProfitMinor, -500); assert.equal(e.contributionMargin, null); });
  await scenario("primary", "P44", "missing fees incomplete; explicit zero fees observed", () => { const sale = fact("missing-fees"); const e = economics(sale)[0]!; assert.equal(e.incompleteEvidence, true); assert.equal(e.contributionProfitMinor, null); assert.equal(e.contributionMargin, null);
    assert.equal(economics(sale, fact("known-zero-fee", "PLATFORM_FEE", 0), fact("known-zero-processing", "PAYMENT_PROCESSING_FEE", 0))[0]!.contributionProfitMinor, 1000);
    assert.equal(economics(fact("no-order", "GROSS_REVENUE", 1000, { orderDigest: null }), fact("fee-order", "PLATFORM_FEE", 0), fact("processing-order", "PAYMENT_PROCESSING_FEE", 0))[0]!.status, "INCOMPLETE"); });
  await scenario("primary", "P45", "source coverage preserves observed provenance without certification", () => { const e = economics(fact("owner"), fact("platform", "PLATFORM_FEE", 0, { evidence: { source: "PLATFORM_ADAPTER", adapterId: "etsy-fixture", adapterVersion: 1, observedAt: AT, evidenceDigest: digestAyasRevenueExternalId("platform-evidence") } }),
    fact("system", "PAYMENT_PROCESSING_FEE", 0, { evidence: { source: "SYSTEM_DERIVED", adapterId: null, adapterVersion: null, observedAt: AT, evidenceDigest: digestAyasRevenueExternalId("system-evidence") } }))[0]!;
    assert.deepEqual(e.sourceCoverage, { OWNER_IMPORT: 1, PLATFORM_ADAPTER: 1, SYSTEM_DERIVED: 1 }); assert.equal(e.evidenceVerification, "UNVERIFIED_OBSERVATIONS"); assert.equal(e.conflictCount, null); assert.equal(e.conflictCoverage, "NOT_RECORDED"); });
  await scenario("primary", "P46", "UTC day week month and opaque grouping", () => { const input = fact("period", "GROSS_REVENUE", 1000, { occurredAt: "2026-10-04T23:59:00.000Z" });
    const g = groupAyasRevenueEconomics(state(input), ["platform", "orderDigest", "offerDigest", "activityDigest", "day", "week", "month"])[0]!;
    assert.equal(g.key.day, "2026-10-04"); assert.equal(g.key.week, "2026-09-28"); assert.equal(g.key.month, "2026-10"); assert.equal(g.key.currency, "USD"); assert.equal(g.key.orderDigest, input.orderDigest);
    assert.throws(() => groupAyasRevenueEconomics(state(input), ["platform", "platform"]), code("INVALID_INPUT")); });
  await scenario("primary", "P47", "time group never resurrects an entry reversed next day", () => { const old = fact("yesterday", "GROSS_REVENUE", 2000, { occurredAt: "2026-10-02T12:00:00.000Z" }); const g = groupAyasRevenueEconomics(state(old, reversal("today-reversal", old)), ["day"]);
    assert.equal(g.find(v => v.key.day === "2026-10-02")!.economics.grossRevenueMinor, 0); assert.equal(g.find(v => v.key.day === "2026-10-03")!.economics.reversalCount, 1); });
  await scenario("primary", "P48", "aggregate safe integer overflow refuses", () => { const inputs = Array.from({ length: 9008 }, (_, i) => fact(`large-${i}`, "GROSS_REVENUE", 1_000_000_000_000)); assert.throws(() => economics(...inputs), code("AGGREGATE_OVERFLOW")); });
  await scenario("primary", "P49", "realized observed profit cannot raise spend authority", () => { const e = economics(fact("profit-sale"), fact("profit-fee", "PLATFORM_FEE", 0), fact("profit-processing", "PAYMENT_PROCESSING_FEE", 0))[0]!;
    assert.equal(e.contributionProfitMinor, 1000); assert.equal(e.grantsAuthority, false); assert.equal(AYAS_REVENUE_AUTONOMOUS_SPEND_USD, 0);
    const d = decideAyasRevenueSpend({ schemaVersion: "1", platform: "etsy", operation: "LISTING_LIST_READ", event: "AD_SPEND", amount: { valueMinor: 1, currency: "USD" }, costClass: "local-zero-cost", source: "OWNER_POLICY", requestedAt: AT }); assert.equal(d.allowedAutonomously, false); });
  await scenario("primary", "P50", "only digests and closed codes stored; production/live data unchanged", async (root) => { await store(root).append(fact("private-opaque-event")); const bytes = fs.readFileSync(file(root), "utf8"); assert.doesNotMatch(bytes, /private-opaque-event|fixture-order-one|fixture-offer-one|fixture-activity-one/);
    assert.equal(fingerprint(liveRoot), liveBefore); assert.ok(!fs.existsSync(path.join(root, "data", "production"))); });
  await scenario("primary", "P51", "real atomic replacement between lstat and open is retried", async (root) => { const s = store(root); await s.append(fact("read-first"));
    const next = state(fact("read-first"), fact("read-second")), pending = path.join(root, "read-replacement.json"); fs.writeFileSync(pending, JSON.stringify(next, null, 2) + "\n"); const original = fs.openSync; let replacements = 0;
    fs.openSync = ((p: fs.PathLike, flags: string | number, mode?: fs.Mode) => { if (String(p) === file(root) && replacements === 0) { replacements++; fs.renameSync(pending, file(root)); } return original(p, flags, mode); }) as typeof fs.openSync;
    try { assert.doesNotThrow(() => { assert.equal(s.read().revision, 2); }); assert.equal(replacements, 1); } finally { fs.openSync = original; }
  });
  await scenario("primary", "P52", "two process capacity race rechecks limit under lock", async (root) => { const s = store(root, 2); await s.append(fact("capacity-seed")); const r = await race(root, fact("capacity-race-a"), fact("capacity-race-b"), 2);
    assert.deepEqual(r.map(v => v.status).sort(), ["APPENDED", "REFUSED"]); assert.equal(r.find(v => v.status === "REFUSED")!.code, "AYAS_REVENUE_LEDGER_CAPACITY"); assert.equal(s.read().revision, 2); });
  await scenario("primary", "P53", "canonical extended ISO year groups and reversal chronology", () => { const old = fact("extended-year", "GROSS_REVENUE", 1, { occurredAt: "9999-12-31T12:00:00.000Z" });
    let history!: ReturnType<typeof state>; assert.doesNotThrow(() => { history = state(old, reversal("extended-reversal", old, { occurredAt: "+010000-01-01T12:00:00.000Z" })); }); const e = summarizeAyasRevenueEconomics(history)[0]!;
    assert.equal(e.earliestFactAt, old.occurredAt); assert.equal(e.latestFactAt, "+010000-01-01T12:00:00.000Z"); assert.equal(e.grossRevenueMinor, 0);
    const g = groupAyasRevenueEconomics(history, ["day", "month"]); assert.ok(g.some(v => v.key.day === "+010000-01-01" && v.key.month === "+010000-01")); });

  // Frozen held-out: cross-platform, provenance and lifecycle combinations beyond the primary fixtures.
  await scenario("held-out", "H01", "Fiverr explicit free fee observations", () => { const inputs = [fact("f-sale"), fact("f-fee", "PLATFORM_FEE", 0), fact("f-process", "PAYMENT_PROCESSING_FEE", 0)].map(v => ({ ...v, platform: "fiverr" as const })); const e = economics(...inputs)[0]!; assert.equal(e.contributionMargin, 1); assert.equal(e.grantsAuthority, false); });
  await scenario("held-out", "H02", "Upwork refund and payout with reversed refund", () => { const sale = fact("u-sale", "GROSS_REVENUE", 500, { platform: "upwork" }), refund = fact("u-refund", "REFUND", 200, { platform: "upwork" }); const e = economics(sale, refund, reversal("u-reverse", refund), fact("u-payout", "PAYOUT_OBSERVED", 500, { platform: "upwork" }))[0]!; assert.equal(e.grossRevenueMinor, 500); assert.equal(e.refundsMinor, 0); assert.equal(e.payoutObservedMinor, 500); assert.equal(e.incompleteEvidence, true); });
  await scenario("held-out", "H03", "Udemy JPY integer facts without decimal conversion", () => { const inputs = [fact("j-sale", "GROSS_REVENUE", 199), fact("j-fee", "PLATFORM_FEE", 29), fact("j-process", "PAYMENT_PROCESSING_FEE", 0)].map(v => ({ ...v, platform: "udemy" as const, amount: { ...v.amount, currency: "JPY" } })); assert.equal(economics(...inputs)[0]!.contributionProfitMinor, 170); });
  await scenario("held-out", "H04", "same external digest on separate platforms is separate; no cross-platform fee coverage", async (root) => { const s = store(root), input = fact("shared-external"); await s.append(input); await s.append({ ...input, platform: "lemon-squeezy" }); const e = economics(input, { ...input, platform: "lemon-squeezy" }, fact("fee-etsy", "PLATFORM_FEE", 0), fact("processing-etsy", "PAYMENT_PROCESSING_FEE", 0))[0]!; assert.equal(s.read().revision, 2); assert.equal(e.grossRevenueMinor, 2000); assert.equal(e.incompleteEvidence, true); });
  await scenario("held-out", "H05", "reversed delivery cost removed globally across time groups", () => { const delivery = fact("late-cost", "VARIABLE_DELIVERY_COST", 25, { occurredAt: "2026-10-01T12:00:00.000Z" }); const g = groupAyasRevenueEconomics(state(delivery, reversal("late-cost-reverse", delivery)), ["month"])[0]!; assert.equal(g.economics.variableDeliveryCostMinor, 0); assert.equal(g.economics.activeEntryCount, 0); });
  await scenario("held-out", "H06", "capacity override cannot widen bound; all persisted history retained", async (root) => { assert.throws(() => new AyasRevenueLedgerStore(root, { maxEntries: AYAS_REVENUE_LEDGER_MAX_ENTRIES + 1 }), code("INVALID_INPUT")); assert.throws(() => new AyasRevenueLedgerStore(root, { maxEntries: 0 }), code("INVALID_INPUT")); const s = store(root, 2); await s.append(fact("cap-one")); await s.append(fact("cap-two")); await assert.rejects(s.append(fact("cap-three")), code("CAPACITY")); assert.equal(s.read().entries.length, 2); });
  await scenario("held-out", "H07", "owner replay cannot promote to platform evidence", async (root) => { const s = store(root), input = fact("promote"); await s.append(input); await assert.rejects(s.append({ ...input, evidence: { ...input.evidence, source: "PLATFORM_ADAPTER", adapterId: "etsy-fixture", adapterVersion: 1 } }), code("CONFLICT")); assert.equal(s.read().entries[0]!.evidence.source, "OWNER_IMPORT"); });
  await scenario("held-out", "H08", "invalid imported double reversal and reversed reversal history refused", () => { const old = fact("import-old"), first = reversal("import-reverse", old); assert.throws(() => state(old, first, reversal("import-second", old)), code("INVALID_LEDGER")); assert.throws(() => state(old, first, reversal("import-nested", first)), code("INVALID_LEDGER")); });
  await scenario("held-out", "H09", "bounded normalization refuses secret and raw contact identifiers", () => { assert.equal(digestAyasRevenueExternalId("  opaque-42  "), digestAyasRevenueExternalId("opaque-42")); for (const v of ["buyer@example.com", "../ledger", "sk-proj-" + "z".repeat(30), "4111111111111111", "x".repeat(257), "raw\ncommand"]) assert.throws(() => digestAyasRevenueExternalId(v), code("INVALID_INPUT")); });
  await scenario("held-out", "H10", "offline observation modules and graders protected from autonomous patch", () => { for (const p of ["src/lib/ayas/revenue/AyasRevenueLedger.ts", "src/lib/ayas/revenue/AyasRevenueLedgerStore.ts", "src/lib/ayas/revenue/AyasRevenueEconomics.ts", "scripts/smoke-ayas-revenue-ledger.ts", "scripts/fixtures/ayas-revenue-ledger-fixture.ts", "scripts/fixtures/ayas-revenue-ledger-worker.ts", "docs/AYAS_REVENUE_UNIT_ECONOMICS.md"]) assert.equal(classifyPatchTarget(p).level, "FORBIDDEN_AUTONOMOUS", p);
    for (const p of ["AyasRevenueLedger.ts", "AyasRevenueLedgerStore.ts", "AyasRevenueEconomics.ts"]) assert.doesNotMatch(fs.readFileSync(path.join("src/lib/ayas/revenue", p), "utf8"), /fetch\s*\(|https?:\/\/|process\.env|child_process|WebSocket|XMLHttpRequest/); });
  if (selected === undefined) { assert.equal(results.filter(v => v.set === "primary").length, 53); assert.equal(results.filter(v => v.set === "held-out").length, 10); }
  console.log(JSON.stringify({ status: results.every(v => v.ok) ? "PASS" : "FAIL", primary: results.filter(v => v.set === "primary" && v.ok).length, heldOut: results.filter(v => v.set === "held-out" && v.ok).length, liveRevenueUnchanged: fingerprint(liveRoot) === liveBefore, results }, null, 2));
  if (results.some(v => !v.ok)) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { assert.equal(fingerprint(liveRoot), liveBefore); assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(temp).startsWith("ayas-revenue-ledger-smoke-")); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });
