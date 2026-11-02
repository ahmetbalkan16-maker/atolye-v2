import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  AYAS_BLOCKING_VULNERABILITY_SEVERITIES, introducedAyasVulnerabilities, scanAyasLockVulnerabilities, summarizeAyasVulnerabilities, type AyasKnownVulnerability, type AyasOsvFetch,
} from "./AyasDependencyVulnerabilities";
import type { AyasUpdateApprovalView } from "./AyasUpdateApprovalStore";
import { findAyasPackageUsers } from "./AyasUpdateRadar";
import { parseAyasUpdateTarget } from "./AyasUpdateWorkspaces";
import {
  ayasUpdateTrialHash, ayasUpdateTrialSha256, buildAyasUpdateInstallPlan, checkAyasPackageJsonChange, diffAyasPackageLocks, newAyasUpdateTrialId,
  readAyasCiSmokeCommands, type AyasUpdateTrialRecord, type AyasUpdateTrialStep, type AyasUpdateTrialStepName, type AyasUpdateTrialStore,
} from "./AyasUpdateTrialStore";

/**
 * Runs one owner-approved update trial (owner decisions 2026-10-15). Everything happens in a detached git worktree of
 * the current HEAD outside the repository; the canonical tree, its node_modules and the live copy are never written.
 * The checks are what CI runs on a clean checkout (npm ci, tsc, lint, the workflow's smokes) plus a production build,
 * the smokes that import the package, and three supply-chain checks: install scripts never run, every installed
 * package must carry a verified registry signature, and the update may bring in no high or critical known
 * vulnerability nor a package reported as malicious (OSV, AyasDependencyVulnerabilities, 2026-11-02). A smoke that already failed before the update is reported and not
 * counted; any check the update makes newly fail fails the trial. The worktree is removed in every outcome. A
 * sub-package's update (AYAS_UPDATE_WORKSPACES, owner decision 2026-11-02) is installed and type-checked in its own
 * folder, and instead of the root app's build the tool itself is run once (Remotion: a short render).
 *
 * Effectful by design (git, npm, node): reached only from scripts/ayas-update-executor.ts, which the observer starts.
 */
export interface AyasCommandResult { readonly code: number | null; readonly output: string; readonly durationMs: number; readonly timedOut: boolean }
/** A child environment; never the parent's secrets (see ayasUpdateTrialChildEnv). */
export type AyasChildEnv = Readonly<Record<string, string | undefined>>;
export type AyasCommandRunner = (command: string, args: readonly string[], options: { readonly cwd: string; readonly timeoutMs: number; readonly env: AyasChildEnv }) => Promise<AyasCommandResult>;

const MAX_OUTPUT = 2_000_000;

/** spawn without a shell; on timeout the whole process tree is ended (npm and next start their own children). */
export const runAyasCommand: AyasCommandRunner = (command, args, options) => new Promise((resolve) => {
  const started = Date.now();
  let output = ""; let timedOut = false; let settled = false;
  const child = spawn(command, [...args], { cwd: options.cwd, env: options.env as NodeJS.ProcessEnv, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  const append = (chunk: Buffer) => { if (output.length < MAX_OUTPUT) output += chunk.toString("utf8"); };
  child.stdout?.on("data", append); child.stderr?.on("data", append);
  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGKILL");
  }, options.timeoutMs);
  const finish = (code: number | null) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code, output, durationMs: Date.now() - started, timedOut }); };
  child.on("error", (error) => { output += `\n${error.message}`; finish(null); });
  child.on("close", (code) => finish(code));
});

/** npm's own CLI next to the running node, so no shell or .cmd shim is involved. */
export function resolveAyasNpmCli(nodeExecPath: string = process.execPath): string {
  const cli = path.join(path.dirname(nodeExecPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!fs.existsSync(cli)) throw new Error("npm CLI not found next to node");
  return cli;
}

/**
 * Where trial worktrees live: <studio>/private/temp (owner rule: development and test work stays on D). Two tools
 * disagree about non-ASCII paths, so the same folder is reached two ways:
 *   - `root`, the real path, for everything but lint: through a link, tsx loads files by their real path but the
 *     tsconfig by the link path (so JSX settings do not apply), and Turbopack refuses a distDir outside the root;
 *   - `lintRoot`, an ASCII link to the same folder at the drive root when the real path is not ASCII (D:\URETIM ->
 *     D:\ÜRETİM on this host): ESLint cannot match its per-file overrides from a non-ASCII path.
 */
export function resolveAyasUpdateTrialRoots(repoRoot: string): { readonly root: string; readonly lintRoot: string } {
  const studio = path.resolve(repoRoot, "..", "..");
  const root = path.join(studio, "private", "temp");
  if (!/[^\x20-\x7e]/.test(root)) return { root, lintRoot: root };
  const drive = path.parse(studio).root;
  let real: string;
  try { real = fs.realpathSync.native(studio); } catch { return { root, lintRoot: root }; }
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(drive, { withFileTypes: true }); } catch { return { root, lintRoot: root }; }
  for (const entry of entries) {
    if (/[^\x20-\x7e]/.test(entry.name) || !entry.isSymbolicLink()) continue;
    const candidate = path.join(drive, entry.name);
    try { if (fs.realpathSync.native(candidate) === real) return { root, lintRoot: path.join(candidate, "private", "temp") }; } catch { /* not a usable link */ }
  }
  return { root, lintRoot: root };
}

/** Children get no secret: the trial mirrors CI, which has no access key or provider credential either. */
export function ayasUpdateTrialChildEnv(base: AyasChildEnv, privateTemp: string, npmCache: string): AyasChildEnv {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(base)) if (!/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^AYAS_|^OPENAI|^ANTHROPIC|^ELEVENLABS|^YOUTUBE|^NODE_ENV$/i.test(key)) env[key] = value;
  // NODE_ENV is left to each tool (next build sets production itself), as on a CI runner.
  return { ...env, TEMP: privateTemp, TMP: privateTemp, NPM_CONFIG_CACHE: npmCache, CI: "1", NEXT_TELEMETRY_DISABLED: "1", NO_COLOR: "1" };
}

/** The last lines of a command's output, without ANSI codes or the worktree path. */
export function summarizeAyasCommandOutput(output: string, worktree: string, maxChars = 600): string {
  const clean = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split(worktree).join("<worktree>").split(worktree.replace(/\\/g, "/")).join("<worktree>");
  const lines = clean.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
  const tail = lines.slice(-8).join("\n");
  return tail.length > maxChars ? tail.slice(tail.length - maxChars) : tail;
}

export interface AyasUpdateTrialRunnerDeps {
  readonly repoRoot: string;
  readonly store: AyasUpdateTrialStore;
  readonly run?: AyasCommandRunner;
  readonly now?: () => string;
  /** Defaults to resolveAyasUpdateTrialRoots(repoRoot). */
  readonly trialRoots?: { readonly root: string; readonly lintRoot: string };
  readonly env?: AyasChildEnv;
  readonly nodeExecPath?: string;
  readonly npmCli?: string;
  /** The OSV database call (osv.dev); defaults to fetch. */
  readonly osvFetch?: AyasOsvFetch;
  /** Per-step bounds; a smoke gets its own. */
  readonly stepTimeoutMs?: number;
  readonly smokeTimeoutMs?: number;
}

/** Smokes that check the radar and approval surfaces themselves; run in every trial. */
const OWN_SMOKES = ["scripts/smoke-ayas-update-radar.ts", "scripts/smoke-ayas-update-approval.ts", "scripts/smoke-ayas-update-trial.ts"];
const MAX_PACKAGE_SMOKES = 8;

export async function runAyasUpdateTrial(approval: AyasUpdateApprovalView, head: string, deps: AyasUpdateTrialRunnerDeps): Promise<AyasUpdateTrialRecord> {
  const run = deps.run ?? runAyasCommand;
  const now = deps.now ?? (() => new Date().toISOString());
  const nodeExec = deps.nodeExecPath ?? process.execPath;
  const stepTimeout = deps.stepTimeoutMs ?? 20 * 60_000;
  const smokeTimeout = deps.smokeTimeoutMs ?? 5 * 60_000;
  const studioPrivate = path.resolve(deps.repoRoot, "..", "..", "private");
  const env = ayasUpdateTrialChildEnv(deps.env ?? process.env, path.join(studioPrivate, "temp"), path.join(studioPrivate, "npm-cache"));
  const parsedTarget = parseAyasUpdateTarget(approval.target);
  const packageName = parsedTarget?.packageName ?? approval.target.replace(/^npm:/, "");
  // A sub-package (AYAS_UPDATE_WORKSPACES) is installed, checked and run in its own folder of the same worktree.
  const workspace = parsedTarget?.workspace;
  const trialId = newAyasUpdateTrialId();
  const roots = deps.trialRoots ?? resolveAyasUpdateTrialRoots(deps.repoRoot);
  const worktree = path.join(roots.root, trialId);
  const lintWorktree = path.join(roots.lintRoot, trialId);
  const packageDir = workspace ? path.join(worktree, workspace.dir) : worktree;

  let record: AyasUpdateTrialRecord = {
    schemaVersion: 1, trialId, approvalDecisionId: approval.decisionId, sourceId: approval.sourceId, toolName: approval.toolName,
    target: approval.target, installedVersion: approval.installedVersion, targetVersion: approval.targetVersion, bump: approval.bump,
    itemHash: approval.itemHash, baseHead: head, installSpecs: [], status: "RUNNING", startedAt: now(), steps: [],
  };
  const save = (patch: Partial<AyasUpdateTrialRecord>) => { record = { ...record, ...patch }; deps.store.upsert(record); };
  save({});

  const steps: AyasUpdateTrialStep[] = [];
  const step = (name: AyasUpdateTrialStepName, ok: boolean, durationMs: number, summary: string) => { steps.push(Object.freeze({ name, ok, durationMs, summary })); save({ steps: [...steps] }); };
  const fail = (name: AyasUpdateTrialStepName, reason: string): AyasUpdateTrialRecord => { save({ status: "FAILED", failedStep: name, failureReason: reason.slice(0, 600), finishedAt: now() }); return record; };
  const exec = (command: string, args: readonly string[], timeoutMs = stepTimeout, cwd = worktree) => run(command, args, { cwd, timeoutMs, env });
  const npm = (args: readonly string[], timeoutMs = stepTimeout, cwd = worktree) => exec(nodeExec, [deps.npmCli ?? resolveAyasNpmCli(nodeExec), ...args], timeoutMs, cwd);
  const outcome = (result: { code: number | null; timedOut: boolean; output: string }) => result.timedOut ? "süre sınırı aşıldı" : summarizeAyasCommandOutput(summarizeAyasCommandOutput(result.output, lintWorktree, 100_000), worktree);
  const smoke = (command: readonly string[]) => exec(nodeExec, [path.join(worktree, "node_modules", "tsx", "dist", "cli.mjs"), ...command], smokeTimeout);

  let worktreeAdded = false;
  try {
    fs.mkdirSync(path.dirname(worktree), { recursive: true });
    const added = await exec("git", ["worktree", "add", "--detach", worktree, head], 120_000, deps.repoRoot);
    worktreeAdded = added.code === 0;
    step("WORKTREE", worktreeAdded, added.durationMs, worktreeAdded ? `ayrı kopya ${head.slice(0, 8)}` : outcome(added));
    if (!worktreeAdded) return fail("WORKTREE", "ayrı kopya oluşturulamadı");

    // The root's packages always (the smokes and tsc run from them); a sub-package's own set beside them.
    const ci = await npm(["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
    const workspaceCi = ci.code === 0 && workspace ? await npm(["ci", "--ignore-scripts", "--no-audit", "--no-fund"], stepTimeout, packageDir) : undefined;
    const ciOk = ci.code === 0 && (workspaceCi === undefined || workspaceCi.code === 0);
    step("NPM_CI", ciOk, ci.durationMs + (workspaceCi?.durationMs ?? 0), ciOk ? `bağımlılıklar kilit dosyasından kuruldu${workspace ? ` (kök ve ${workspace.dir})` : ""} (kurulum betikleri çalıştırılmadı)` : outcome(workspaceCi && workspaceCi.code !== 0 ? workspaceCi : ci));
    if (!ciOk) return fail("NPM_CI", "mevcut bağımlılıklar kurulamadı");
    // What npm does not install but the tool needs (Remotion's headless Chrome), copied from the canonical tree: local
    // files only, so the trial downloads nothing beyond the packages themselves.
    for (const folder of workspace?.carry ?? []) {
      const from = path.join(deps.repoRoot, workspace!.dir, folder);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(packageDir, folder), { recursive: true });
    }

    const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(packageDir, file), "utf8")) as Record<string, unknown>;
    const packageJsonBefore = readJson("package.json");
    const lockBefore = readJson("package-lock.json");
    const plan = buildAyasUpdateInstallPlan(packageJsonBefore, packageName, approval.targetVersion);
    save({ installSpecs: plan.specs });

    // The smokes this update could break: CI's own, the ones that import the package (or load the sub-package's
    // modules), and the radar/approval suites.
    const workflow = (() => { try { return fs.readFileSync(path.join(worktree, ".github", "workflows", "ayas-safe-ci.yml"), "utf8"); } catch { return ""; } })();
    const users = workspace ? [...workspace.smokes]
      : findAyasPackageUsers(worktree, packageName).filter((file) => /^scripts\/smoke-[^/]+\.ts$/.test(file)).slice(0, MAX_PACKAGE_SMOKES);
    const smokeCommands = [...readAyasCiSmokeCommands(workflow), ...[...users, ...OWN_SMOKES].map((file) => [file])]
      .filter((command, index, all) => fs.existsSync(path.join(worktree, command[0]!)) && all.findIndex((other) => other.join(" ") === command.join(" ")) === index);
    const baselineStarted = Date.now();
    const baselineFailures: string[] = [];
    for (const command of smokeCommands) if ((await smoke(command)).code !== 0) baselineFailures.push(command.join(" "));
    step("BASELINE_SMOKES", true, Date.now() - baselineStarted, `${smokeCommands.length} test güncellemeden önce çalıştı; ${baselineFailures.length} tanesi zaten başarısızdı`);
    save({ preExistingSmokeFailures: baselineFailures });

    const install = await npm(["install", ...plan.specs, ...(plan.saveExact ? ["--save-exact"] : []), "--ignore-scripts", "--no-audit", "--no-fund"], stepTimeout, packageDir);
    step("NPM_INSTALL", install.code === 0, install.durationMs, install.code === 0 ? `kuruldu: ${plan.specs.join(", ")}${workspace ? ` (${workspace.dir})` : ""}` : outcome(install));
    if (install.code !== 0) return fail("NPM_INSTALL", "güncelleme kurulamadı");

    const packageJsonText = fs.readFileSync(path.join(packageDir, "package.json"), "utf8");
    const packageLockText = fs.readFileSync(path.join(packageDir, "package-lock.json"), "utf8");
    const packageJsonAfter = JSON.parse(packageJsonText) as Record<string, unknown>;
    const lockAfter = JSON.parse(packageLockText) as { packages?: Record<string, { version?: string }> };
    const packageCheck = checkAyasPackageJsonChange(packageJsonBefore, packageJsonAfter, plan.specs);
    const names = plan.specs.map((spec) => spec.slice(0, spec.lastIndexOf("@")));
    const wrongVersion = names.find((name) => lockAfter.packages?.[`node_modules/${name}`]?.version !== approval.targetVersion);
    const lockChanges = diffAyasPackageLocks(lockBefore, lockAfter, names);
    const lockOk = packageCheck.ok && !wrongVersion;
    step("LOCK_CHECK", lockOk, 0, lockOk ? `${lockChanges.changed} paket değişti, ${lockChanges.added} eklendi, ${lockChanges.removed} kaldırıldı` : (!packageCheck.ok ? packageCheck.reason : `${wrongVersion} beklenen ${approval.targetVersion} sürümünde değil`));
    save({ lockChanges });
    if (!lockOk) return fail("LOCK_CHECK", "paket dosyaları beklenenden farklı değişti");

    const signatures = await npm(["audit", "signatures"], 5 * 60_000, packageDir);
    step("SIGNATURES", signatures.code === 0, signatures.durationMs, signatures.code === 0 ? "bütün paketlerin kayıt imzası doğrulandı" : outcome(signatures));
    if (signatures.code !== 0) return fail("SIGNATURES", "paket imzaları doğrulanamadı");

    // The lock before and after, against OSV: an update must not bring in a high or critical known vulnerability or a
    // package reported as malicious. A check that cannot reach the database fails the trial (never "nothing found").
    const vulnStarted = Date.now();
    let scanned: { before: readonly AyasKnownVulnerability[]; after: readonly AyasKnownVulnerability[] };
    try {
      const [before, after] = await Promise.all([scanAyasLockVulnerabilities(lockBefore, deps.osvFetch ? { fetcher: deps.osvFetch } : {}), scanAyasLockVulnerabilities(lockAfter, deps.osvFetch ? { fetcher: deps.osvFetch } : {})]);
      scanned = { before, after };
    } catch (error) {
      step("VULNERABILITIES", false, Date.now() - vulnStarted, `güvenlik açığı veritabanı (OSV) okunamadı: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`);
      return fail("VULNERABILITIES", "bilinen güvenlik açıkları denetlenemedi");
    }
    const introduced = introducedAyasVulnerabilities(scanned.before, scanned.after);
    const blocking = introduced.filter((v) => AYAS_BLOCKING_VULNERABILITY_SEVERITIES.includes(v.severity));
    save({ vulnerabilities: { before: scanned.before.length, after: scanned.after.length, introduced } });
    step("VULNERABILITIES", blocking.length === 0, Date.now() - vulnStarted, blocking.length
      ? `güncelleme yüksek önemde açık getirdi: ${blocking.slice(0, 4).map((v) => `${v.id} (${v.package})`).join(", ")}`
      : `bilinen açık: önce ${scanned.before.length}, sonra ${scanned.after.length} (${summarizeAyasVulnerabilities(scanned.after)}); güncellemenin getirdiği: ${introduced.length ? summarizeAyasVulnerabilities(introduced) : "yok"}`);
    if (blocking.length) return fail("VULNERABILITIES", "güncelleme bilinen yüksek önemde bir güvenlik açığı getiriyor");

    const typecheck = await npm(["exec", "--no", "--", "tsc", "--noEmit", "--incremental", "false"]);
    const workspaceTypecheck = typecheck.code === 0 && workspace ? await npm(["exec", "--no", "--", "tsc", "--noEmit", "--incremental", "false"], stepTimeout, packageDir) : undefined;
    const typesOk = typecheck.code === 0 && (workspaceTypecheck === undefined || workspaceTypecheck.code === 0);
    step("TYPECHECK", typesOk, typecheck.durationMs + (workspaceTypecheck?.durationMs ?? 0), typesOk ? `TypeScript hatasız${workspace ? ` (kök ve ${workspace.dir})` : ""}` : outcome(workspaceTypecheck && workspaceTypecheck.code !== 0 ? workspaceTypecheck : typecheck));
    if (!typesOk) return fail("TYPECHECK", "TypeScript hata verdi; güncelleme kod değişikliği gerektiriyor");

    const lint = await npm(["run", "lint"], stepTimeout, lintWorktree);
    step("LINT", lint.code === 0, lint.durationMs, lint.code === 0 ? "lint hatasız" : outcome(lint));
    if (lint.code !== 0) return fail("LINT", "lint hata verdi; güncelleme kod ya da yapılandırma değişikliği gerektiriyor");

    if (workspace) {
      // The root app's build does not include a sub-package; the tool itself is run once instead.
      const outDir = path.join(worktree, ".ayas-update-trial-out");
      fs.mkdirSync(outDir, { recursive: true });
      const render = await exec(nodeExec, workspace.check.args(outDir), stepTimeout, packageDir);
      const renderOk = render.code === 0 && fs.readdirSync(outDir).some((file) => fs.statSync(path.join(outDir, file)).size > 0);
      step("RENDER", renderOk, render.durationMs, renderOk ? `${workspace.check.label} üretildi` : outcome(render));
      if (!renderOk) return fail("RENDER", `${workspace.check.label} üretilemedi`);
    } else {
      const build = await npm(["run", "build"]);
      step("BUILD", build.code === 0, build.durationMs, build.code === 0 ? "üretim derlemesi başarılı" : outcome(build));
      if (build.code !== 0) return fail("BUILD", "üretim derlemesi başarısız");
    }

    const smokesStarted = Date.now();
    const newFailures: string[] = [];
    for (const command of smokeCommands) {
      if (baselineFailures.includes(command.join(" "))) continue;
      if ((await smoke(command)).code !== 0) newFailures.push(command.join(" "));
    }
    step("SMOKES", newFailures.length === 0, Date.now() - smokesStarted, newFailures.length ? `güncellemeden sonra bozulan: ${newFailures.join(", ")}` : `${smokeCommands.length - baselineFailures.length} test geçti`);
    if (newFailures.length) return fail("SMOKES", "güncelleme testleri bozdu");

    const tested = { trialId, itemHash: approval.itemHash, baseHead: head, installSpecs: plan.specs, packageJsonSha256: ayasUpdateTrialSha256(packageJsonText), packageLockSha256: ayasUpdateTrialSha256(packageLockText) };
    deps.store.writeArtifacts(trialId, { packageJson: packageJsonText, packageLock: packageLockText });
    save({ ...tested, status: "PASSED", finishedAt: now(), trialHash: ayasUpdateTrialHash(tested) });
    return record;
  } catch (error) {
    return fail(steps.at(-1)?.name ?? "WORKTREE", error instanceof Error ? error.message : String(error));
  } finally {
    if (worktreeAdded) {
      const removed = await run("git", ["worktree", "remove", "--force", worktree], { cwd: deps.repoRoot, timeoutMs: 10 * 60_000, env });
      if (removed.code !== 0) { try { fs.rmSync(worktree, { recursive: true, force: true }); } catch { /* best effort */ } await run("git", ["worktree", "prune"], { cwd: deps.repoRoot, timeoutMs: 60_000, env }); }
    }
  }
}
