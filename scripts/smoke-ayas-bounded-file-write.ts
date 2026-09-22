import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { applyAyasBoundedFileReplacements, resolveAyasBoundedPath, AyasBoundedFileWriteError } from "../src/lib/brain/autonomy/AyasBoundedFileWrite";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-bounded-write-")); }
const hash = (v: string) => crypto.createHash("sha256").update(v, "utf8").digest("hex");

async function main() {
  await scenario("path traversal is denied", () => assert.throws(() => resolveAyasBoundedPath(root(), "../escape.ts", ["src/"]), (e: unknown) => e instanceof AyasBoundedFileWriteError && e.code === "AYAS_BOUNDED_WRITE_PATH_DENIED"));
  await scenario("absolute path is denied", () => assert.throws(() => resolveAyasBoundedPath(root(), "/etc/passwd", ["src/"]), (e: unknown) => e instanceof AyasBoundedFileWriteError && e.code === "AYAS_BOUNDED_WRITE_PATH_DENIED"));
  await scenario("windows drive path is denied", () => assert.throws(() => resolveAyasBoundedPath(root(), "C:/secrets.txt", ["src/"]), (e: unknown) => e instanceof AyasBoundedFileWriteError && e.code === "AYAS_BOUNDED_WRITE_PATH_DENIED"));
  await scenario("denied segment (data/) is rejected even inside an allowed root name", () => assert.throws(() => resolveAyasBoundedPath(root(), "src/data/secret.ts", ["src/"]), (e: unknown) => e instanceof AyasBoundedFileWriteError && e.code === "AYAS_BOUNDED_WRITE_PATH_DENIED"));
  await scenario(".env is denied", () => assert.throws(() => resolveAyasBoundedPath(root(), ".env", ["./"]), (e: unknown) => e instanceof AyasBoundedFileWriteError && e.code === "AYAS_BOUNDED_WRITE_PATH_DENIED"));
  await scenario("path outside allowlist is denied", () => assert.throws(() => resolveAyasBoundedPath(root(), "config/settings.ts", ["src/"]), (e: unknown) => e instanceof AyasBoundedFileWriteError && e.code === "AYAS_BOUNDED_WRITE_PATH_OUTSIDE_ALLOWLIST"));
  await scenario("allowed path resolves under repoRoot", () => { const r = root(); assert.equal(resolveAyasBoundedPath(r, "src/fixture.ts", ["src/"]), path.resolve(r, "src/fixture.ts"), "assert.equal(resolveAyasBoundedPath(r, \"src/fixture.ts\", [\"src/\"]), path.resolve(r, \"src/fixture.ts\"))"); });

  await scenario("new file requires allowCreate", async () => {
    const r = root();
    await assert.rejects(applyAyasBoundedFileReplacements(r, ["src/"], [{ filePath: "src/new.ts", expectedHash: null, content: "x" }], async () => undefined), (e: unknown) => e instanceof AyasBoundedFileWriteError && e.code === "AYAS_BOUNDED_WRITE_CREATE_NOT_ALLOWED");
    assert.equal(fs.existsSync(path.join(r, "src/new.ts")), false, "assert.equal(fs.existsSync(path.join(r, \"src/new.ts\")), false)");
  });
  await scenario("new file with allowCreate succeeds and returns outcomes", async () => {
    const r = root();
    const outcomes = await applyAyasBoundedFileReplacements(r, ["src/"], [{ filePath: "src/new.ts", expectedHash: null, content: "hello\n", allowCreate: true }], async (o) => o);
    assert.equal(fs.readFileSync(path.join(r, "src/new.ts"), "utf8"), "hello\n", "assert.equal(fs.readFileSync(path.join(r, \"src/new.ts\"), \"utf8\"), \"hello\\n\")");
    assert.equal(outcomes[0]?.beforeHash, null, "assert.equal(outcomes[0]?.beforeHash, null)");
    assert.equal(outcomes[0]?.afterHash, hash("hello\n"), "assert.equal(outcomes[0]?.afterHash, hash(\"hello\\n\"))");
  });
  await scenario("new file must use null precondition", async () => {
    const r = root();
    await assert.rejects(applyAyasBoundedFileReplacements(r, ["src/"], [{ filePath: "src/new.ts", expectedHash: "not-null", content: "x", allowCreate: true }], async () => undefined), (e: unknown) => e instanceof AyasBoundedFileWriteError && e.code === "AYAS_BOUNDED_WRITE_NEW_FILE_MUST_USE_NULL_PRECONDITION");
  });
  await scenario("existing file with correct hash is overwritten", async () => {
    const r = root(); fs.mkdirSync(path.join(r, "src"), { recursive: true }); fs.writeFileSync(path.join(r, "src/fixture.ts"), "old\n");
    await applyAyasBoundedFileReplacements(r, ["src/"], [{ filePath: "src/fixture.ts", expectedHash: hash("old\n"), content: "new\n" }], async () => undefined);
    assert.equal(fs.readFileSync(path.join(r, "src/fixture.ts"), "utf8"), "new\n", "assert.equal(fs.readFileSync(path.join(r, \"src/fixture.ts\"), \"utf8\"), \"new\\n\")");
  });
  await scenario("existing file with wrong hash is rejected and left untouched", async () => {
    const r = root(); fs.mkdirSync(path.join(r, "src"), { recursive: true }); fs.writeFileSync(path.join(r, "src/fixture.ts"), "old\n");
    await assert.rejects(applyAyasBoundedFileReplacements(r, ["src/"], [{ filePath: "src/fixture.ts", expectedHash: "stale", content: "new\n" }], async () => undefined), (e: unknown) => e instanceof AyasBoundedFileWriteError && e.code === "AYAS_BOUNDED_WRITE_PRECONDITION_MISMATCH");
    assert.equal(fs.readFileSync(path.join(r, "src/fixture.ts"), "utf8"), "old\n", "assert.equal(fs.readFileSync(path.join(r, \"src/fixture.ts\"), \"utf8\"), \"old\\n\")");
  });
  await scenario("failing after() rolls back an existing file to its original content", async () => {
    const r = root(); fs.mkdirSync(path.join(r, "src"), { recursive: true }); fs.writeFileSync(path.join(r, "src/fixture.ts"), "old\n");
    await assert.rejects(applyAyasBoundedFileReplacements(r, ["src/"], [{ filePath: "src/fixture.ts", expectedHash: hash("old\n"), content: "new\n" }], async () => { throw new Error("validation failed"); }), /validation failed/);
    assert.equal(fs.readFileSync(path.join(r, "src/fixture.ts"), "utf8"), "old\n", "assert.equal(fs.readFileSync(path.join(r, \"src/fixture.ts\"), \"utf8\"), \"old\\n\")");
  });
  await scenario("failing after() deletes a newly-created file rather than leaving it behind", async () => {
    const r = root();
    await assert.rejects(applyAyasBoundedFileReplacements(r, ["src/"], [{ filePath: "src/new.ts", expectedHash: null, content: "x", allowCreate: true }], async () => { throw new Error("validation failed"); }), /validation failed/);
    assert.equal(fs.existsSync(path.join(r, "src/new.ts")), false, "assert.equal(fs.existsSync(path.join(r, \"src/new.ts\")), false)");
  });
  await scenario("a precondition failure on the second file leaves the first file completely untouched (all-or-nothing)", async () => {
    const r = root(); fs.mkdirSync(path.join(r, "src"), { recursive: true });
    fs.writeFileSync(path.join(r, "src/a.ts"), "a-old\n");
    fs.writeFileSync(path.join(r, "src/b.ts"), "b-old\n");
    await assert.rejects(applyAyasBoundedFileReplacements(r, ["src/"], [
      { filePath: "src/a.ts", expectedHash: hash("a-old\n"), content: "a-new\n" },
      { filePath: "src/b.ts", expectedHash: "stale", content: "b-new\n" },
    ], async () => undefined), (e: unknown) => e instanceof AyasBoundedFileWriteError && e.code === "AYAS_BOUNDED_WRITE_PRECONDITION_MISMATCH");
    assert.equal(fs.readFileSync(path.join(r, "src/a.ts"), "utf8"), "a-old\n", "assert.equal(fs.readFileSync(path.join(r, \"src/a.ts\"), \"utf8\"), \"a-old\\n\")");
    assert.equal(fs.readFileSync(path.join(r, "src/b.ts"), "utf8"), "b-old\n", "assert.equal(fs.readFileSync(path.join(r, \"src/b.ts\"), \"utf8\"), \"b-old\\n\")");
  });
  await scenario("multi-file success writes all files and rolls back none", async () => {
    const r = root(); fs.mkdirSync(path.join(r, "src"), { recursive: true });
    fs.writeFileSync(path.join(r, "src/a.ts"), "a-old\n");
    const result = await applyAyasBoundedFileReplacements(r, ["src/"], [
      { filePath: "src/a.ts", expectedHash: hash("a-old\n"), content: "a-new\n" },
      { filePath: "src/b.ts", expectedHash: null, content: "b-new\n", allowCreate: true },
    ], async (outcomes) => outcomes.map((o) => o.filePath));
    assert.deepEqual(result, ["src/a.ts", "src/b.ts"], "assert.deepEqual(result, [\"src/a.ts\", \"src/b.ts\"])");
    assert.equal(fs.readFileSync(path.join(r, "src/a.ts"), "utf8"), "a-new\n", "assert.equal(fs.readFileSync(path.join(r, \"src/a.ts\"), \"utf8\"), \"a-new\\n\")");
    assert.equal(fs.readFileSync(path.join(r, "src/b.ts"), "utf8"), "b-new\n", "assert.equal(fs.readFileSync(path.join(r, \"src/b.ts\"), \"utf8\"), \"b-new\\n\")");
  });
  await scenario("rollback does not clobber a file someone else already changed further", async () => {
    const r = root(); fs.mkdirSync(path.join(r, "src"), { recursive: true }); fs.writeFileSync(path.join(r, "src/fixture.ts"), "old\n");
    await assert.rejects(applyAyasBoundedFileReplacements(r, ["src/"], [{ filePath: "src/fixture.ts", expectedHash: hash("old\n"), content: "new\n" }], async () => {
      fs.writeFileSync(path.join(r, "src/fixture.ts"), "raced\n"); // a concurrent writer changed it after our write, before rollback
      throw new Error("validation failed");
    }), /validation failed/);
    assert.equal(fs.readFileSync(path.join(r, "src/fixture.ts"), "utf8"), "raced\n", "assert.equal(fs.readFileSync(path.join(r, \"src/fixture.ts\"), \"utf8\"), \"raced\\n\")");
  });

  console.log(`AYAS bounded file write smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-bounded-file-write", scenarios: count }));
}
void main();
