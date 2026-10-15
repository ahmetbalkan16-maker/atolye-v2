import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AyasUpdateApplyDecisionRecord, AyasUpdateApprovalView } from "../src/lib/brain/autonomy/AyasUpdateApprovalStore";
import {
  ayasUpdateTrialChildEnv, resolveAyasUpdateTrialRoots, runAyasUpdateTrial, summarizeAyasCommandOutput, type AyasCommandRunner,
} from "../src/lib/brain/autonomy/AyasUpdateTrialRunner";
import {
  AYAS_UPDATE_LIVE_MAX_ATTEMPTS, ayasUpdateTrialHash, buildAyasUpdateInstallPlan, checkAyasPackageJsonChange, createAyasUpdateTrialStore,
  diffAyasPackageLocks, isAyasUpdateTrialIntact, listAyasUpdateTrialViews, readAyasCiSmokeCommands, readAyasObservedHead,
  selectAyasUpdateApplyJob, selectAyasUpdateTrialJob, type AyasUpdateApplyRecord, type AyasUpdateTrialRecord,
} from "../src/lib/brain/autonomy/AyasUpdateTrialStore";

/**
 * Update trials (owner decisions 2026-10-15: "dene, sonra uygula"). The pure decisions, and the runner end to end with
 * a scripted command runner over a TEMP worktree fixture: no git, npm, network, model or production state.
 */
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-update-trial-"));
let count = 0;
const scenario = async (name: string, fn: () => Promise<void> | void): Promise<void> => { await fn(); count += 1; void name; };

const HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);
const approval = (over: Partial<AyasUpdateApprovalView> = {}): AyasUpdateApprovalView => ({
  decisionId: "ayas-update-decision-1", sourceId: "nextjs", toolName: "Next.js", target: "npm:next", installedVersion: "16.4.1", targetVersion: "16.4.2",
  bump: "PATCH", applyChannel: "DEVELOPMENT_SESSION", itemHash: "c".repeat(64), approvedAt: "2026-10-15T10:00:00.000Z", status: "WAITING", ...over,
});
const trial = (over: Partial<AyasUpdateTrialRecord> = {}): AyasUpdateTrialRecord => ({
  schemaVersion: 1, trialId: `ayas-update-trial-${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`, approvalDecisionId: "ayas-update-decision-1", sourceId: "nextjs",
  toolName: "Next.js", target: "npm:next", installedVersion: "16.4.1", targetVersion: "16.4.2", bump: "PATCH", itemHash: "c".repeat(64), baseHead: HEAD,
  installSpecs: ["next@16.4.2"], status: "PASSED", startedAt: "2026-10-15T10:05:00.000Z", steps: [], ...over,
});

/* ----------------------------------------------------------- fixture runner --- */
const PACKAGE_JSON = { name: "fixture", scripts: { lint: "eslint", build: "next build" }, dependencies: { next: "16.4.1", react: "19.2.4" }, devDependencies: { "eslint-config-next": "16.4.1", typescript: "^5" } };
const LOCK = { lockfileVersion: 3, packages: { "": { name: "fixture" }, "node_modules/next": { version: "16.4.1" }, "node_modules/eslint-config-next": { version: "16.4.1" }, "node_modules/old-dep": { version: "1.0.0" } } };
const WORKFLOW = "jobs:\n  ci:\n    steps:\n      - run: npm ci\n      - name: a\n        run: npx tsx scripts/smoke-ci-a.ts\n      - name: gate\n        run: npx tsx scripts/smoke-ci-gate.ts --gate\n";

interface Script {
  readonly fail?: Partial<Record<"ci" | "install" | "audit" | "tsc" | "lint" | "build" | "worktree", boolean>>;
  /** Smoke outcomes before and after the install (true = pass). */
  readonly smokes?: Readonly<Record<string, { readonly before: boolean; readonly after: boolean }>>;
  /** The install touches package.json beyond the approved entries. */
  readonly installTouchesScripts?: boolean;
}

function fixtureRunner(script: Script) {
  const calls: { command: string; args: readonly string[]; cwd: string; env: Readonly<Record<string, string | undefined>> }[] = [];
  let installed = false;
  const run: AyasCommandRunner = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, env: options.env });
    const ok = { code: 0, output: "ok", durationMs: 1, timedOut: false };
    const bad = (output: string) => ({ code: 1, output, durationMs: 1, timedOut: false });
    if (command === "git" && args[0] === "worktree" && args[1] === "add") {
      if (script.fail?.worktree) return bad("fatal: could not create worktree");
      const wt = args[3]!;
      fs.mkdirSync(path.join(wt, ".github", "workflows"), { recursive: true });
      fs.mkdirSync(path.join(wt, "scripts"), { recursive: true });
      fs.writeFileSync(path.join(wt, "package.json"), `${JSON.stringify(PACKAGE_JSON, null, 2)}\n`);
      fs.writeFileSync(path.join(wt, "package-lock.json"), `${JSON.stringify(LOCK, null, 2)}\n`);
      fs.writeFileSync(path.join(wt, ".github", "workflows", "ayas-safe-ci.yml"), WORKFLOW);
      for (const name of ["smoke-ci-a", "smoke-ci-gate", "smoke-next-user", "smoke-ayas-update-radar"]) fs.writeFileSync(path.join(wt, "scripts", `${name}.ts`), name === "smoke-next-user" ? "import { NextResponse } from \"next/server\";\nvoid NextResponse;\n" : "export {};\n");
      return ok;
    }
    if (command === "git" && args[0] === "worktree" && args[1] === "remove") { fs.rmSync(args[3]!, { recursive: true, force: true }); return ok; }
    if (command === "git") return ok;
    if (command === "node-fake" && args[0] === "npm-cli-fake") {
      const sub = args.slice(1);
      if (sub[0] === "ci") return script.fail?.ci ? bad("npm ERR! ci") : ok;
      if (sub[0] === "install") {
        if (script.fail?.install) return bad("npm ERR! ETARGET");
        installed = true;
        const pkg = JSON.parse(fs.readFileSync(path.join(options.cwd, "package.json"), "utf8"));
        for (const spec of sub.filter((arg) => /@\d/.test(arg))) {
          const at = spec.lastIndexOf("@"); const name = spec.slice(0, at); const version = spec.slice(at + 1);
          const section = pkg.dependencies[name] !== undefined ? "dependencies" : "devDependencies";
          pkg[section][name] = sub.includes("--save-exact") ? version : `^${version}`;
        }
        if (script.installTouchesScripts) pkg.scripts.postinstall = "node evil.js";
        fs.writeFileSync(path.join(options.cwd, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
        const lock = JSON.parse(fs.readFileSync(path.join(options.cwd, "package-lock.json"), "utf8"));
        lock.packages["node_modules/next"].version = "16.4.2"; lock.packages["node_modules/eslint-config-next"].version = "16.4.2";
        delete lock.packages["node_modules/old-dep"]; lock.packages["node_modules/new-dep"] = { version: "2.0.0" };
        fs.writeFileSync(path.join(options.cwd, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
        return ok;
      }
      if (sub[0] === "audit") return script.fail?.audit ? bad("1 package has an invalid registry signature") : ok;
      if (sub[0] === "exec") return script.fail?.tsc ? bad(`${options.cwd}\\src\\x.ts(1,1): error TS2322`) : ok;
      if (sub[0] === "run" && sub[1] === "lint") return script.fail?.lint ? bad("1 error") : ok;
      if (sub[0] === "run" && sub[1] === "build") return script.fail?.build ? bad("\x1b[31mBuild error occurred\x1b[0m") : ok;
    }
    if (command === "node-fake") {
      const smoke = args[1]!;
      const outcome = script.smokes?.[smoke];
      return (installed ? outcome?.after ?? true : outcome?.before ?? true) ? ok : bad("AssertionError");
    }
    return bad(`unexpected command ${command} ${args.join(" ")}`);
  };
  return { run, calls };
}

let fixtureIndex = 0;
function runFixture(script: Script) {
  const base = path.join(temp, `fixture-${fixtureIndex++}`);
  const repoRoot = path.join(base, "Atolye", "repo");
  fs.mkdirSync(repoRoot, { recursive: true });
  const store = createAyasUpdateTrialStore({ rootDir: path.join(base, "store") });
  const runner = fixtureRunner(script);
  const roots = { root: path.join(base, "real"), lintRoot: path.join(base, "lint-alias") };
  const env = { PATH: "x", AYAS_ACCESS_KEY: "secret-key-value", OPENAI_API_KEY: "sk", GITHUB_TOKEN: "t", NODE_ENV: "production" };
  return { store, runner, roots, promise: runAyasUpdateTrial(approval(), HEAD, { repoRoot, store, run: runner.run, trialRoots: roots, env, nodeExecPath: "node-fake", npmCli: "npm-cli-fake" }) };
}

async function main(): Promise<void> {
  await scenario("the install plan keeps exact pins exact, ranges as ranges, and moves lockstep companions", () => {
    assert.deepEqual(buildAyasUpdateInstallPlan(PACKAGE_JSON, "next", "16.4.2"), { specs: ["next@16.4.2", "eslint-config-next@16.4.2"], saveExact: true });
    assert.deepEqual(buildAyasUpdateInstallPlan(PACKAGE_JSON, "typescript", "7.0.2"), { specs: ["typescript@7.0.2"], saveExact: false });
    assert.deepEqual(buildAyasUpdateInstallPlan(PACKAGE_JSON, "react", "19.3.0").specs, ["react@19.3.0"], "react-dom is not listed here, so it is not added");
    assert.throws(() => buildAyasUpdateInstallPlan(PACKAGE_JSON, "left-pad", "1.0.0"), /not a direct dependency/);
    assert.throws(() => buildAyasUpdateInstallPlan(PACKAGE_JSON, "next", "16.4.2-canary.1"), /invalid/);
    assert.throws(() => buildAyasUpdateInstallPlan(PACKAGE_JSON, "next; rm -rf /", "16.4.2"), /invalid/);
  });

  await scenario("package.json may change only in the approved dependency entries", () => {
    const after = { ...PACKAGE_JSON, dependencies: { ...PACKAGE_JSON.dependencies, next: "16.4.2" }, devDependencies: { ...PACKAGE_JSON.devDependencies, "eslint-config-next": "16.4.2" } };
    assert.deepEqual(checkAyasPackageJsonChange(PACKAGE_JSON, after, ["next@16.4.2", "eslint-config-next@16.4.2"]), { ok: true });
    assert.equal(checkAyasPackageJsonChange(PACKAGE_JSON, { ...after, scripts: { ...after.scripts, postinstall: "x" } }, ["next@16.4.2", "eslint-config-next@16.4.2"]).ok, false);
    assert.equal(checkAyasPackageJsonChange(PACKAGE_JSON, { ...after, dependencies: { ...after.dependencies, react: "19.3.0" } }, ["next@16.4.2", "eslint-config-next@16.4.2"]).ok, false);
    assert.equal(checkAyasPackageJsonChange(PACKAGE_JSON, { ...after, dependencies: { react: "19.2.4" }, devDependencies: { ...after.devDependencies, next: "16.4.2" } }, ["next@16.4.2", "eslint-config-next@16.4.2"]).ok, false, "moving a dependency between sections is refused");
    assert.equal(checkAyasPackageJsonChange(PACKAGE_JSON, { ...after, dependencies: { ...after.dependencies, "left-pad": "1.0.0" } }, ["next@16.4.2", "eslint-config-next@16.4.2"]).ok, false, "a new dependency is refused");
  });

  await scenario("lock differences, CI smoke commands and the observed HEAD are read deterministically", () => {
    const after = { packages: { ...LOCK.packages, "node_modules/next": { version: "16.4.2" }, "node_modules/new-dep": { version: "2.0.0" } } } as { packages: Record<string, { version?: string }> };
    delete after.packages["node_modules/old-dep"];
    assert.deepEqual(diffAyasPackageLocks(LOCK, after, ["next", "eslint-config-next"]), { added: 1, removed: 1, changed: 1, direct: [{ name: "next", from: "16.4.1", to: "16.4.2" }] });
    assert.deepEqual(readAyasCiSmokeCommands(WORKFLOW), [["scripts/smoke-ci-a.ts"], ["scripts/smoke-ci-gate.ts", "--gate"]]);
    const real = fs.readFileSync(path.join(process.cwd(), ".github", "workflows", "ayas-safe-ci.yml"), "utf8");
    assert.ok(readAyasCiSmokeCommands(real).length >= 10, "the real workflow's smokes are found");
    const repo = path.join(temp, "observed"); fs.mkdirSync(path.join(repo, "data", "brain", "autonomy"), { recursive: true });
    assert.equal(readAyasObservedHead(repo), undefined);
    fs.writeFileSync(path.join(repo, "data", "brain", "autonomy", "daemon-state.json"), JSON.stringify({ lastObservationHead: HEAD }));
    assert.equal(readAyasObservedHead(repo), HEAD);
    fs.writeFileSync(path.join(repo, "data", "brain", "autonomy", "daemon-state.json"), JSON.stringify({ lastObservationHead: "not-a-sha" }));
    assert.equal(readAyasObservedHead(repo), undefined);
  });

  await scenario("trial job selection: oldest npm approval first; failed never retried; passed re-run once per new HEAD", () => {
    const first = approval(); const second = approval({ decisionId: "ayas-update-decision-2", sourceId: "eslint", target: "npm:eslint", approvedAt: "2026-10-15T11:00:00.000Z" });
    const node = approval({ decisionId: "ayas-update-decision-3", sourceId: "nodejs", target: "Node.js runtime", applyChannel: "OWNER_PINNED_RUNTIME", approvedAt: "2026-10-15T09:00:00.000Z" });
    const pick = (trials: AyasUpdateTrialRecord[], approvals = [second, first, node], head = HEAD) => selectAyasUpdateTrialJob({ approvals, trials, head });
    assert.equal((pick([]) as { approval: AyasUpdateApprovalView }).approval.decisionId, first.decisionId);
    assert.equal(pick([], [approval({ status: "APPLIED" })]).kind, "NONE");
    assert.equal(pick([], [node]).kind, "NONE", "the pinned Node.js runtime is never trialled");
    assert.equal((pick([trial({ status: "FAILED" })]) as { approval: AyasUpdateApprovalView }).approval.decisionId, second.decisionId, "a failed approval is skipped");
    assert.equal((pick([trial({ status: "RUNNING" })]) as { approval: AyasUpdateApprovalView }).approval.decisionId, second.decisionId);
    assert.equal(pick([trial()], [first]).kind, "NONE", "passed on this HEAD: waits for the owner");
    const moved = pick([trial()], [first], OTHER_HEAD);
    assert.equal(moved.kind, "TRIAL"); assert.equal((moved as { reason: string }).reason, "HEAD_MOVED");
    assert.equal((pick([trial({ status: "ABANDONED" })], [first]) as { reason: string }).reason, "RETRY_ABANDONED");
    assert.equal(pick([trial({ status: "ABANDONED" }), trial({ status: "ABANDONED", trialId: trial().trialId.replace(/0$/, "1") })], [first]).kind, "NONE", "two interruptions stop retries");
  });

  await scenario("apply job selection: a pending live publish first, then the oldest Uygula, each carried out once", () => {
    const decision = { decisionId: "ayas-update-apply-1", trialId: trial().trialId, trialHash: "d".repeat(64), decidedAt: "2026-10-15T12:00:00.000Z" } as AyasUpdateApplyDecisionRecord;
    const passed = trial({ trialHash: "d".repeat(64) });
    const applyRecord = (over: Partial<AyasUpdateApplyRecord>): AyasUpdateApplyRecord => ({ schemaVersion: 1, applyId: "run-1", applyDecisionId: decision.decisionId, trialId: passed.trialId, sourceId: "nextjs", toolName: "Next.js", installedVersion: "16.4.1", targetVersion: "16.4.2", baseHead: HEAD, status: "COMPLETED", startedAt: "2026-10-15T12:01:00.000Z", ...over });
    assert.equal(selectAyasUpdateApplyJob({ decisions: [decision], trials: [passed], applies: [] }).kind, "APPLY");
    assert.equal(selectAyasUpdateApplyJob({ decisions: [decision], trials: [trial({ trialHash: "e".repeat(64) })], applies: [] }).kind, "NONE", "a decision binds to the exact trial hash");
    assert.equal(selectAyasUpdateApplyJob({ decisions: [decision], trials: [passed], applies: [applyRecord({ status: "RECOVERY_REQUIRED" })] }).kind, "NONE", "never retried once something may have happened");
    assert.equal(selectAyasUpdateApplyJob({ decisions: [decision], trials: [passed], applies: [applyRecord({ status: "ABANDONED" })] }).kind, "APPLY", "an untouched interruption is retried");
    assert.equal(selectAyasUpdateApplyJob({ decisions: [decision], trials: [passed], applies: [applyRecord({ status: "ABANDONED" }), applyRecord({ applyId: "run-2", status: "ABANDONED" })] }).kind, "NONE");
    assert.equal(selectAyasUpdateApplyJob({ decisions: [decision], trials: [passed], applies: [applyRecord({ livePending: true, live: { status: "ROLLED_BACK", summary: "", attempts: 1, at: "x" } })] }).kind, "LIVE_PUBLISH");
    assert.equal(selectAyasUpdateApplyJob({ decisions: [decision], trials: [passed], applies: [applyRecord({ livePending: true, live: { status: "FAILED", summary: "", attempts: AYAS_UPDATE_LIVE_MAX_ATTEMPTS, at: "x" } })] }).kind, "NONE", "live publish attempts are bounded");
  });

  await scenario("a passed trial is intact only while its artifacts hash to what was tested", () => {
    const store = createAyasUpdateTrialStore({ rootDir: path.join(temp, "intact") });
    const base = trial({ steps: [{ name: "BUILD", ok: true, durationMs: 1, summary: "" }], packageJsonSha256: "", packageLockSha256: "" });
    const artifacts = { packageJson: "{\"a\":1}\n", packageLock: "{\"b\":2}\n" };
    store.writeArtifacts(base.trialId, artifacts);
    const sha = (text: string) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
    const tested = { ...base, packageJsonSha256: sha(artifacts.packageJson), packageLockSha256: sha(artifacts.packageLock) };
    const record = { ...tested, trialHash: ayasUpdateTrialHash(tested) };
    assert.equal(isAyasUpdateTrialIntact(record, store.readArtifacts(record.trialId)), true);
    assert.equal(isAyasUpdateTrialIntact(record, { ...artifacts, packageLock: "{\"b\":3}\n" }), false);
    assert.equal(isAyasUpdateTrialIntact({ ...record, baseHead: OTHER_HEAD }, store.readArtifacts(record.trialId)), false, "the hash covers the base commit");
    assert.equal(isAyasUpdateTrialIntact({ ...record, status: "FAILED" }, store.readArtifacts(record.trialId)), false);
    assert.throws(() => store.readArtifacts("../escape"), /malformed/);
  });

  await scenario("a passing trial runs every check in a separate worktree, lint from the ASCII alias, and keeps only the tested bytes", async () => {
    const { store, runner, roots, promise } = runFixture({});
    const record = await promise;
    assert.equal(record.status, "PASSED", JSON.stringify(record.steps));
    assert.deepEqual(record.steps.map((step) => step.name), ["WORKTREE", "NPM_CI", "BASELINE_SMOKES", "NPM_INSTALL", "LOCK_CHECK", "SIGNATURES", "TYPECHECK", "LINT", "BUILD", "SMOKES"]);
    assert.deepEqual(record.installSpecs, ["next@16.4.2", "eslint-config-next@16.4.2"]);
    assert.ok(isAyasUpdateTrialIntact(record, store.readArtifacts(record.trialId)));
    assert.match(store.readArtifacts(record.trialId)!.packageJson, /"next": "16.4.2"/);
    const npmCalls = runner.calls.filter((call) => call.args[0] === "npm-cli-fake");
    assert.ok(npmCalls.find((call) => call.args[1] === "install")!.args.includes("--ignore-scripts"), "install scripts never run");
    assert.ok(npmCalls.find((call) => call.args[1] === "ci")!.args.includes("--ignore-scripts"));
    assert.ok(npmCalls.find((call) => call.args[1] === "run" && call.args[2] === "lint")!.cwd.startsWith(roots.lintRoot));
    assert.ok(npmCalls.find((call) => call.args[1] === "run" && call.args[2] === "build")!.cwd.startsWith(roots.root));
    for (const call of runner.calls) {
      assert.equal(call.env.AYAS_ACCESS_KEY, undefined); assert.equal(call.env.OPENAI_API_KEY, undefined); assert.equal(call.env.GITHUB_TOKEN, undefined); assert.equal(call.env.NODE_ENV, undefined);
    }
    const smokesRun = runner.calls.filter((call) => call.command === "node-fake" && call.args[0] !== "npm-cli-fake").map((call) => call.args.slice(1).join(" "));
    assert.ok(smokesRun.includes("scripts/smoke-ci-gate.ts --gate") && smokesRun.includes("scripts/smoke-next-user.ts") && smokesRun.includes("scripts/smoke-ayas-update-radar.ts"));
    assert.equal(fs.existsSync(path.join(roots.root, record.trialId)), false, "the worktree is removed");
    assert.equal(store.load().trials.length, 1);
  });

  await scenario("a smoke broken before the update is reported, not counted; one the update breaks fails the trial", async () => {
    const preExisting = await runFixture({ smokes: { "scripts/smoke-ci-a.ts": { before: false, after: false } } }).promise;
    assert.equal(preExisting.status, "PASSED"); assert.deepEqual(preExisting.preExistingSmokeFailures, ["scripts/smoke-ci-a.ts"]);
    const broken = await runFixture({ smokes: { "scripts/smoke-next-user.ts": { before: true, after: false } } }).promise;
    assert.equal(broken.status, "FAILED"); assert.equal(broken.failedStep, "SMOKES"); assert.match(broken.steps.at(-1)!.summary, /smoke-next-user/);
  });

  await scenario("every failing check stops the trial at that step, stores no artifacts and removes the worktree", async () => {
    for (const [fail, step] of [["ci", "NPM_CI"], ["install", "NPM_INSTALL"], ["audit", "SIGNATURES"], ["tsc", "TYPECHECK"], ["lint", "LINT"], ["build", "BUILD"], ["worktree", "WORKTREE"]] as const) {
      const { store, roots, promise } = runFixture({ fail: { [fail]: true } });
      const record = await promise;
      assert.equal(record.status, "FAILED", fail); assert.equal(record.failedStep, step, fail);
      assert.equal(record.trialHash, undefined); assert.equal(store.readArtifacts(record.trialId), undefined);
      assert.equal(fs.existsSync(path.join(roots.root, record.trialId)), false);
      assert.doesNotMatch(record.steps.map((entry) => entry.summary).join("\n"), /\x1b\[/, "no ANSI codes are kept");
    }
    const touched = await runFixture({ installTouchesScripts: true }).promise;
    assert.equal(touched.failedStep, "LOCK_CHECK"); assert.match(touched.steps.at(-1)!.summary, /beyond the approved/);
  });

  await scenario("child environments carry no secret, outputs no path, and an ASCII root needs no alias", () => {
    const env = ayasUpdateTrialChildEnv({ PATH: "p", AYAS_ACCESS_KEY: "k", ANTHROPIC_API_KEY: "a", NPM_TOKEN: "t", DB_PASSWORD: "x", HOME: "h" }, "T", "C");
    assert.deepEqual(env, { PATH: "p", HOME: "h", TEMP: "T", TMP: "T", NPM_CONFIG_CACHE: "C", CI: "1", NEXT_TELEMETRY_DISABLED: "1", NO_COLOR: "1" });
    assert.equal(summarizeAyasCommandOutput("\x1b[31mC:\\wt\\src\\a.ts: error\x1b[0m\nC:/wt/b.ts", "C:\\wt"), "<worktree>\\src\\a.ts: error\n<worktree>/b.ts");
    const ascii = path.join(temp, "ascii", "Atolye", "repo");
    assert.deepEqual(resolveAyasUpdateTrialRoots(ascii), { root: path.join(temp, "ascii", "private", "temp"), lintRoot: path.join(temp, "ascii", "private", "temp") });
  });

  await scenario("the card view shows the latest trial of each approval and whether it is on the observed HEAD", () => {
    const older = trial({ startedAt: "2026-10-15T09:00:00.000Z", status: "FAILED" });
    const latest = trial({ trialId: trial().trialId.replace(/0$/, "9"), startedAt: "2026-10-15T10:00:00.000Z", trialHash: "f".repeat(64) });
    const [view] = listAyasUpdateTrialViews({ approvals: [approval()], trials: [latest, older], head: HEAD });
    assert.equal(view?.trialId, latest.trialId); assert.equal(view?.onCurrentHead, true); assert.equal(view?.trialHash, "f".repeat(64));
    assert.equal(listAyasUpdateTrialViews({ approvals: [approval()], trials: [latest], head: OTHER_HEAD })[0]?.onCurrentHead, false);
    assert.equal(listAyasUpdateTrialViews({ approvals: [approval()], trials: [latest], head: undefined })[0]?.onCurrentHead, false);
  });
}

main().then(() => {
  fs.rmSync(temp, { recursive: true, force: true });
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-update-trial", scenarios: count, modelRuns: 0, networkCalls: 0 }));
}, (error: unknown) => {
  fs.rmSync(temp, { recursive: true, force: true });
  console.error(error);
  process.exit(1);
});
