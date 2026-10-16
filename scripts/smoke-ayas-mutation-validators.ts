import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runAyasValidators, createAyasSmokeTestValidator, AyasValidatorFailedError, type AyasValidator, type AyasValidatorResult } from "../src/lib/brain/autonomy/AyasMutationValidators";
import { runAyasBoundedMutationWithValidators } from "../src/lib/brain/autonomy/AyasMutationRegistry";
import { AyasBoundedFileWriteError } from "../src/lib/brain/autonomy/AyasBoundedFileWrite";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-validators-")); }

const passing = (name: string): AyasValidator => async () => ({ validator: name, pass: true, summary: "ok" });
const failing = (name: string): AyasValidator => async () => ({ validator: name, pass: false, summary: "deliberately failed" });
const throwing = (name: string): AyasValidator => async () => { throw new Error(`${name} exploded`); };
const malformed = (): AyasValidator => async () => ({ nonsense: true } as unknown as AyasValidatorResult);

async function main() {
  await scenario("a single passing validator returns pass:true with a safe summary", async () => {
    const results = await runAyasValidators(root(), [passing("v1")]);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.pass, true);
  });
  await scenario("multiple validators all passing returns all results in order", async () => {
    const results = await runAyasValidators(root(), [passing("v1"), passing("v2"), passing("v3")]);
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.pass));
    assert.deepEqual(results.map((r) => r.validator), ["v1", "v2", "v3"]);
  });
  await scenario("a failing validator throws AyasValidatorFailedError", async () => {
    await assert.rejects(runAyasValidators(root(), [failing("v1")]), (e: unknown) => e instanceof AyasValidatorFailedError);
  });
  await scenario("a second validator failing after the first passes still throws, and both results are captured", async () => {
    await assert.rejects(
      runAyasValidators(root(), [passing("v1"), failing("v2")]),
      (e: unknown) => e instanceof AyasValidatorFailedError && e.results.length === 2 && e.results[0]?.pass === true && e.results[1]?.pass === false,
    );
  });
  await scenario("a validator later than a failure is never invoked", async () => {
    let secondCalled = false;
    const neverRun: AyasValidator = async () => { secondCalled = true; return { validator: "never", pass: true, summary: "" }; };
    await assert.rejects(runAyasValidators(root(), [failing("v1"), neverRun]));
    assert.equal(secondCalled, false);
  });
  await scenario("a validator that throws is treated as a failure, not an uncaught crash", async () => {
    await assert.rejects(runAyasValidators(root(), [throwing("v1")]), (e: unknown) => e instanceof AyasValidatorFailedError && e.results[0]?.pass === false);
  });
  await scenario("a validator returning a malformed result is treated as a failure", async () => {
    await assert.rejects(runAyasValidators(root(), [malformed()]), (e: unknown) => e instanceof AyasValidatorFailedError && e.results[0]?.validator === "unknown");
  });
  await scenario("validator summaries are length-bounded and whitespace-collapsed (never an unbounded dump)", async () => {
    const huge: AyasValidator = async () => ({ validator: "v", pass: false, summary: "x".repeat(10_000) });
    await assert.rejects(runAyasValidators(root(), [huge]), (e: unknown) => e instanceof AyasValidatorFailedError && (e.results[0]?.summary.length ?? 0) <= 500);
  });

  await scenario("createAyasSmokeTestValidator passes for a real script that reports PASS", async () => {
    const r = root();
    fs.mkdirSync(path.join(r, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(r, "scripts/ok.ts"), 'console.log(JSON.stringify({ status: "PASS" }));\n');
    fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(r, "node_modules"), "junction");
    const validator = createAyasSmokeTestValidator("scripts/ok.ts");
    const result = await validator(r);
    assert.equal(result.pass, true);
  });
  await scenario("createAyasSmokeTestValidator does not count a self-skipped suite (PASS with 0 scenarios) as a pass", async () => {
    const r = root();
    fs.mkdirSync(path.join(r, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(r, "scripts/skip.ts"), 'console.log("SKIP: host dependency missing");\nconsole.log("ATOLYE_SMOKE_RESULT " + JSON.stringify({ status: "PASS", suite: "s", scenarios: 0 }));\n');
    fs.writeFileSync(path.join(r, "scripts/ten.ts"), 'console.log("ATOLYE_SMOKE_RESULT " + JSON.stringify({ status: "PASS", suite: "s", scenarios: 10 }));\n');
    fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(r, "node_modules"), "junction");
    const skipped = await createAyasSmokeTestValidator("scripts/skip.ts")(r);
    assert.equal(skipped.pass, false);
    assert.match(skipped.summary, /skipped itself/);
    assert.equal((await createAyasSmokeTestValidator("scripts/ten.ts")(r)).pass, true, "10 scenarios is not 0");
  });
  await scenario("createAyasSmokeTestValidator accepts the repository's plain-text PASS convention and rejects its self-skips", async () => {
    const r = root();
    fs.mkdirSync(path.join(r, "scripts"), { recursive: true });
    const write = (name: string, lines: readonly string[]) => fs.writeFileSync(path.join(r, `scripts/${name}.ts`), lines.map((line) => `console.log(${JSON.stringify(line)});`).join("\n") + "\n");
    const passing = {
      text: ["Lifecycle revision audit: PASS (5/5 caught; TEMP only)"],
      bare: ["PASS (12 scenarios)"],
      ratio: ["Local coding pins/adapter: 9/9 PASS; synthetic only, model runs 0."],
      counted: ["PASS 4 local Whisper wake checks"],
      trailing: ["7 natural conversation scenarios PASS."],
      partial: ["SKIP real integration (model unset)", "PASS (7 scenarios)"],
    };
    const skipping = { zero: ["SKIP: host dependency missing", "PASS (0 scenarios)"], "zero-ratio": ["Mutation audit: PASS (0/5 caught)"], "zero-lead": ["0/0 PASS; nothing ran"] };
    for (const [name, lines] of Object.entries({ ...passing, ...skipping })) write(name, lines);
    write("silent", ["done"]);
    write("sentence", ["this smoke test never reports PASS"]);
    write("json-fail", ['{"status":"FAIL","checks":["PASS"]}', "PASS (3 scenarios)"]);
    fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(r, "node_modules"), "junction");
    const run = async (name: string) => createAyasSmokeTestValidator(`scripts/${name}.ts`)(r);
    for (const name of Object.keys(passing)) assert.equal((await run(name)).pass, true, `${name}: a plain-text result line on a clean exit is a pass`);
    for (const name of Object.keys(skipping)) {
      const result = await run(name);
      assert.equal(result.pass, false, `${name}: a self-skipped plain-text suite is not a pass`);
      assert.match(result.summary, /skipped itself/, name);
    }
    assert.equal((await run("silent")).pass, false, "no PASS marker at all is not a pass");
    assert.equal((await run("sentence")).pass, false, "a sentence that merely contains the word is not a result line");
    assert.equal((await run("json-fail")).pass, false, "a suite that reports a JSON status is judged by that status alone");
  });
  await scenario("createAyasSmokeTestValidator fails for a script that throws", async () => {
    const r = root();
    fs.mkdirSync(path.join(r, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(r, "scripts/bad.ts"), 'throw new Error("boom");\n');
    fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(r, "node_modules"), "junction");
    const validator = createAyasSmokeTestValidator("scripts/bad.ts");
    const result = await validator(r);
    assert.equal(result.pass, false);
  });
  await scenario("createAyasSmokeTestValidator fails closed for a nonexistent script", async () => {
    const r = root();
    fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(r, "node_modules"), "junction");
    const validator = createAyasSmokeTestValidator("scripts/does-not-exist.ts");
    const result = await validator(r);
    assert.equal(result.pass, false);
    assert.match(result.summary, /does not exist/);
  });
  await scenario("createAyasSmokeTestValidator fails closed when the local tsx CLI itself is unavailable", async () => {
    const r = root();
    const validator = createAyasSmokeTestValidator("scripts/whatever.ts");
    const result = await validator(r);
    assert.equal(result.pass, false);
    assert.match(result.summary, /tsx CLI is unavailable/);
  });

  await scenario("runAyasBoundedMutationWithValidators: all validators pass -> file is written and kept", async () => {
    const r = root();
    const result = await runAyasBoundedMutationWithValidators(r, ["scripts/"], [{ filePath: "scripts/new.ts", expectedHash: null, content: "export {};\n", allowCreate: true }], [passing("v1")]);
    assert.deepEqual(result.changedFiles, ["scripts/new.ts"]);
    assert.deepEqual(result.testResults, ["PASS"]);
    assert.equal(fs.existsSync(path.join(r, "scripts/new.ts")), true);
  });
  await scenario("runAyasBoundedMutationWithValidators: a failing validator rolls back the write and rejects", async () => {
    const r = root();
    await assert.rejects(
      runAyasBoundedMutationWithValidators(r, ["scripts/"], [{ filePath: "scripts/new.ts", expectedHash: null, content: "export {};\n", allowCreate: true }], [failing("v1")]),
      (e: unknown) => e instanceof AyasValidatorFailedError,
    );
    assert.equal(fs.existsSync(path.join(r, "scripts/new.ts")), false, "the file must be rolled back, not left half-written");
  });
  await scenario("runAyasBoundedMutationWithValidators: rollback restores an existing file's original content on validator failure", async () => {
    const r = root();
    fs.mkdirSync(path.join(r, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(r, "scripts/existing.ts"), "old content\n");
    const hash = crypto.createHash("sha256").update("old content\n", "utf8").digest("hex");
    await assert.rejects(
      runAyasBoundedMutationWithValidators(r, ["scripts/"], [{ filePath: "scripts/existing.ts", expectedHash: hash, content: "new content\n" }], [failing("v1")]),
    );
    assert.equal(fs.readFileSync(path.join(r, "scripts/existing.ts"), "utf8"), "old content\n");
  });
  await scenario("runAyasBoundedMutationWithValidators: precondition failure never even reaches the validator", async () => {
    let called = false;
    const spy: AyasValidator = async () => { called = true; return { validator: "spy", pass: true, summary: "" }; };
    await assert.rejects(
      runAyasBoundedMutationWithValidators(root(), ["scripts/"], [{ filePath: "scripts/x.ts", expectedHash: "stale", content: "x", allowCreate: true }], [spy]),
      (e: unknown) => e instanceof AyasBoundedFileWriteError,
    );
    assert.equal(called, false);
  });

  console.log(`AYAS mutation validators smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-mutation-validators", scenarios: count }));
}
void main();
