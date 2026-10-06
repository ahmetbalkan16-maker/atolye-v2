import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repository = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-health-response-mutations-"));
const moduleFile = "src/lib/runtime/ProductionRuntimeHealthResponse.ts";
const testFile = "scripts/smoke-production-runtime-health-response.ts";
const files = [moduleFile, testFile, "src/types/productionRuntimeStatus.ts", "src/types/productionRuntimeHealth.ts"];
const original = fs.readFileSync(path.join(repository, moduleFile), "utf8");
const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const name of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"])
  if (process.env[name]) environment[name] = process.env[name];
const mutants = [
  ["inconsistent-ready-accepted", 'if (!readinessIsConsistent(runtimeStatus)) return "unavailable";', 'if (false) return "unavailable";'],
  ["invalid-snapshot-accepted", "if (!validRuntimeSnapshotBase(runtimeStatus)) return false;", "if (false) return false;"],
  ["unsafe-failure-shape-accepted", 'if (!keys.every((key) => key === "reasonCode" || key === "failedProjectSlug")) return false;', "if (false) return false;"],
  ["cache-policy-weakened", '"Cache-Control": "no-store"', '"Cache-Control": "public"'],
  ["fault-body-leaked", "return unavailableResponse(observedAt);\n  }\n}", 'throw new Error("unsafe runtime failure");\n  }\n}'],
] as const;
try {
  for (const file of files) {
    const destination = path.join(temporary, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(repository, file), destination);
  }
  const modules = path.join(temporary, "node_modules");
  fs.symlinkSync(path.join(repository, "node_modules"), modules, process.platform === "win32" ? "junction" : "dir");
  const run = () => spawnSync(process.execPath, ["--import", loader, testFile], {
    cwd: temporary, env: environment, windowsHide: true, encoding: "utf8", timeout: 15_000, maxBuffer: 1_000_000,
  });
  const positive = run();
  assert.equal(positive.status, 0, positive.stderr);
  assert.equal(JSON.parse(positive.stdout.trim()).scenarios, 20);
  for (const [id, from, to] of mutants) {
    assert.equal(original.split(from).length, 2, id + ": exact mutation anchor");
    fs.writeFileSync(path.join(temporary, moduleFile), original.replace(from, to));
    const result = run();
    assert.ok(!result.error, id + ": bounded child completed");
    assert.notEqual(result.status, 0, id + ": mutation must fail");
    assert.match(result.stderr, /AssertionError/, id + ": assertion-caught");
    assert.doesNotMatch(result.stderr, /SyntaxError|MODULE_NOT_FOUND|Cannot find module/, id + ": load-valid");
  }
  assert.equal(fs.readFileSync(path.join(repository, moduleFile), "utf8"), original);
  console.log(JSON.stringify({ status: "PASS", suite: "production-runtime-health-response-mutations",
    controls: mutants.length, assertionCaught: mutants.length, originalSourceUnchanged: true,
    fixture: "OWNED_TEMP_ONLY_NO_RUNTIME_AUTHORITY_OR_CREDENTIAL_ENV" }));
} finally {
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith("ayas-health-response-mutations-"));
  const modules = path.join(temporary, "node_modules");
  if (fs.existsSync(modules)) {
    assert.ok(fs.lstatSync(modules).isSymbolicLink());
    fs.unlinkSync(modules);
  }
  fs.rmSync(temporary, { recursive: true, force: true });
}
