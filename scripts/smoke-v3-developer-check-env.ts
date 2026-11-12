/**
 * V3 developer: a build's checks run without secrets (11 Nov 2026 security review).
 *
 * The checks of an unattended developer build (tsc, smoke suites — the build's own new ones included — and the lint)
 * run code the build just wrote. `checkEnv` hands them a copy of the environment without any credential — one rule
 * (`ayasCheckEnv`) shared with the code-apply runner's re-verification since 12 Nov 2026. Since then the Claude build
 * agent (`claude -p`) gets only what starts and signs in Claude Code (`claudeAgentEnv`); the apprentice's writer keeps
 * the studio's model key. Proven on the pure filters and on the real paths: `develop()` with a fake agent and a fake
 * check, and the apprentice's `runChecks`. No network, no model, no real Claude, temp roots only.
 *
 * Run: npx tsx scripts/smoke-v3-developer-check-env.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ayasCodeCheckEnv } from "../src/lib/brain/autonomy/AyasCodeChangeApplyRunner";
import { ayasCheckEnv, isAyasCheckEnvDenied } from "../src/lib/brain/autonomy/AyasCheckEnv";
import { claudeAgentEnv, develop } from "../src/lib/v3/council/Developer";
import { runChecks } from "../src/lib/v3/council/DevWriter";
import { decideProposal, listProposals, proposeDevelopment } from "../src/lib/v3/council/SelfImprovement";
import { checkEnv, runProcess } from "../src/lib/v3/util/Proc";

let scenarios = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
  scenarios++;
}

/** Fake secrets put into this process's environment for the end-to-end scenarios (restored at the end). */
const FAKE_SECRETS: Record<string, string> = {
  OPENAI_API_KEY: "sk-smoke-fake",
  AYAS_ACCESS_KEY: "smoke-fake-access-key-000",
  GITHUB_TOKEN: "ghp_smoke_fake",
  YOUTUBE_ACCESS_TOKEN: "ya29.smoke-fake",
  ATOLYE_V3_SECRETS_ENV: "C:\\nowhere\\.env.local",
  GIT_ASKPASS: "C:\\nowhere\\askpass.exe",
};
const SECRET_NAMES = Object.keys(FAKE_SECRETS);

/** A check (plain node) that fails with the names it can see when any fake secret reached it, or PATH did not. */
const ENV_PROBE = `const seen=${JSON.stringify(SECRET_NAMES)}.filter(k=>process.env[k]!==undefined);if(seen.length||!process.env.PATH){console.error("seen:"+seen.join(","));process.exit(4)}console.log("clean")`;

async function main() {
  await scenario("A checkEnv drops every credential-bearing name and keeps what tsc/tsx/node/git need", () => {
    const env: Record<string, string> = {
      // dropped
      OPENAI_API_KEY: "x", OPENAI_MODEL: "x", ANTHROPIC_API_KEY: "x", ANTHROPIC_BASE_URL: "x", CLAUDE_CODE_OAUTH_TOKEN: "x",
      GEMINI_API_KEY: "x", GOOGLE_CLIENT_SECRET: "x", GOOGLE_APPLICATION_CREDENTIALS: "x", YOUTUBE_ACCESS_TOKEN: "x",
      YOUTUBE_CHANNEL_ID: "x", AYAS_ACCESS_KEY: "x", AYAS_PORTABLE_PASSPHRASE: "x", AYAS_PORTABLE_OWNER_SESSION: "x",
      AYAS_PHONE_GATEWAY_KEY: "x", GH_TOKEN: "x", GITHUB_TOKEN: "x", GIT_ASKPASS: "x", SSH_ASKPASS: "x", SSH_AUTH_SOCK: "x",
      GCM_INTERACTIVE: "x", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraheader", GIT_CONFIG_VALUE_0: "x",
      GIT_CONFIG_PARAMETERS: "x", NPM_CONFIG__AUTH: "x", NPM_TOKEN: "x", ELEVENLABS_API_KEY: "x", DB_PASSWORD: "x",
      SESSION_SECRET: "x", ATOLYE_V3_SECRETS_ENV: "x", openai_api_key: "x", AWS_SECRET_ACCESS_KEY: "x", HF_TOKEN: "x",
      CLOUDFLARE_API_TOKEN: "x", CF_ACCOUNT_ID: "x", SSH_PRIVATE_KEY_FILE: "x", SLACK_WEBHOOK_URL: "x", DATABASE_URL: "x",
      SENTRY_DSN: "x", KUBECONFIG: "x", NETRC: "x", API_JWT: "x",
      // kept
      PATH: "p", Path: "p", PATHEXT: ".EXE", SystemRoot: "C:\\Windows", ComSpec: "cmd.exe", TEMP: "t", TMP: "t",
      USERPROFILE: "u", APPDATA: "a", LOCALAPPDATA: "l", NPM_CONFIG_CACHE: "c", NODE_OPTIONS: "--max-old-space-size=8192",
      ATOLYE_V3_WORK_ROOT: "w", ATOLYE_V3_TOOLS_ROOT: "t", ATOLYE_V3_GELISTIRICI: "1", PWD: "d", SESSIONNAME: "Console",
      HOME: "h", NODE_ENV: "test", GIT_CONFIG_NOSYSTEM: "1", OLLAMA_HOST: "http://127.0.0.1:11434",
    };
    const before = { ...env };
    const out = checkEnv(env);
    const dropped = Object.keys(env).filter((k) => !(k in out));
    const kept = Object.keys(out);
    assert.deepEqual(kept.sort(), ["PATH", "Path", "PATHEXT", "SystemRoot", "ComSpec", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "NPM_CONFIG_CACHE", "NODE_OPTIONS", "ATOLYE_V3_WORK_ROOT", "ATOLYE_V3_TOOLS_ROOT", "ATOLYE_V3_GELISTIRICI", "PWD", "SESSIONNAME", "HOME", "NODE_ENV", "GIT_CONFIG_NOSYSTEM", "OLLAMA_HOST"].sort());
    assert.equal(dropped.length, Object.keys(env).length - kept.length);
    assert.deepEqual(env, before, "the input is not changed");
    assert.equal(out.PATH, "p");
  });

  await scenario("A2 claudeAgentEnv: the Claude build agent gets only what starts and signs in Claude Code — no studio key", () => {
    const env: Record<string, string | undefined> = {
      // dropped: the studio's provider keys and settings, Git/GitHub credentials, AYAS's own keys, nested-session markers
      OPENAI_API_KEY: "x", OPENAI_MODEL: "x", GEMINI_API_KEY: "x", GOOGLE_CLIENT_SECRET: "x", GOOGLE_APPLICATION_CREDENTIALS: "x",
      YOUTUBE_ACCESS_TOKEN: "x", YOUTUBE_REFRESH_TOKEN: "x", ELEVENLABS_API_KEY: "x", GH_TOKEN: "x", GITHUB_TOKEN: "x",
      GIT_ASKPASS: "x", SSH_AUTH_SOCK: "x", GIT_CONFIG_COUNT: "1", ATOLYE_V3_SECRETS_ENV: "x", AYAS_ACCESS_KEY: "x",
      AYAS_PHONE_GATEWAY_KEY: "x", AYAS_PORTABLE_PASSPHRASE: "x", AWS_SECRET_ACCESS_KEY: "x", CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_VERTEX: "1", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s", CLAUDE_CODE_MESSAGING_TOKEN: "x",
      CLAUDE_CODE_ENTRYPOINT: "sdk", ANIMATION_OPENAI_ENDPOINT: "x", AUDIO_PROVIDER: "x", ATOLYE_V3_WORK_ROOT: "w",
      OLLAMA_HOST: "x", HTTPS_PROXY: "http://u:p@proxy", NODE_ENV: "test", UNDEFINED_ONE: undefined,
      // kept: Windows/Node/Git Bash basics (any case) and Claude Code's own sign-in when set
      Path: "p", PATHEXT: ".EXE", SystemRoot: "C:\\Windows", windir: "C:\\Windows", ComSpec: "cmd.exe", TEMP: "t", TMP: "t",
      USERPROFILE: "u", HOME: "h", APPDATA: "a", LOCALAPPDATA: "l", ProgramFiles: "pf", "ProgramFiles(x86)": "pf86",
      NUMBER_OF_PROCESSORS: "8", NPM_CONFIG_CACHE: "c", NODE_OPTIONS: "--max-old-space-size=8192",
      ANTHROPIC_API_KEY: "x", ANTHROPIC_BASE_URL: "x", CLAUDE_CODE_OAUTH_TOKEN: "x", CLAUDE_CONFIG_DIR: "x", CLAUDE_CODE_GIT_BASH_PATH: "x",
    };
    const before = { ...env };
    const out = claudeAgentEnv(env);
    assert.deepEqual(Object.keys(out).sort(), [
      "Path", "PATHEXT", "SystemRoot", "windir", "ComSpec", "TEMP", "TMP", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "ProgramFiles",
      "ProgramFiles(x86)", "NUMBER_OF_PROCESSORS", "NPM_CONFIG_CACHE", "NODE_OPTIONS",
      "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_GIT_BASH_PATH",
    ].sort());
    assert.equal(out.Path, "p");
    assert.deepEqual(env, before, "the input is not changed");
    // The real environment of this process: no credential-shaped name leaves it except Claude's own.
    const real = claudeAgentEnv(process.env);
    const leaked = Object.keys(real).filter((k) => isAyasCheckEnvDenied(k) && !["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_GIT_BASH_PATH"].includes(k.toUpperCase()));
    assert.deepEqual(leaked, []);
    assert.ok(real.PATH ?? real.Path, "PATH reaches Claude Code");
  });

  await scenario("A3 one rule: V3's checkEnv and the code-apply runner's re-verification env filter exactly alike", () => {
    const env: Record<string, string> = {
      GEMINI_API_KEY: "x", GOOGLE_CLIENT_SECRET: "x", GH_TOKEN: "x", GIT_ASKPASS: "x", AYAS_PORTABLE_PASSPHRASE: "x",
      AYAS_PORTABLE_OWNER_SESSION: "x", ATOLYE_V3_SECRETS_ENV: "x", OPENAI_API_KEY: "x", SSH_AUTH_SOCK: "x", GCM_INTERACTIVE: "x",
      GIT_CONFIG_PARAMETERS: "x", AYAS_PHONE_GATEWAY_KEY: "x", SENTRY_DSN: "x",
      PATH: "p", SystemRoot: "C:\\Windows", USERPROFILE: "u", SESSIONNAME: "Console", NODE_ENV: "test", TEMP: "elsewhere", TMP: "elsewhere",
    };
    const shared = ayasCheckEnv(env);
    assert.deepEqual(checkEnv(env), shared);
    const repoRoot = path.join("D:\\", "ÜRETİM", "Atolye", "atolye-v2");
    const runner = ayasCodeCheckEnv(repoRoot, env);
    const temp = path.resolve(repoRoot, "..", "..", "private", "temp");
    assert.deepEqual(runner, { ...shared, TEMP: temp, TMP: temp, NPM_CONFIG_CACHE: path.resolve(repoRoot, "..", "..", "private", "npm-cache") });
    assert.deepEqual(Object.keys(runner).sort(), ["NODE_ENV", "NPM_CONFIG_CACHE", "PATH", "SESSIONNAME", "SystemRoot", "TEMP", "TMP", "USERPROFILE"]);
    assert.ok(runner.TEMP.includes("ÜRETİM"), "the TEMP path keeps its Turkish İ (never lower-cased)");
  });

  const previous: Record<string, string | undefined> = {};
  for (const name of SECRET_NAMES) {
    previous[name] = process.env[name];
    process.env[name] = FAKE_SECRETS[name];
  }
  const base = mkdtempSync(path.join(os.tmpdir(), "v3-check-env-"));
  try {
    await scenario("B develop(): the checks see no secret (and still PATH); the Claude build agent sees none either (12 Nov 2026)", async () => {
      const repo = path.join(base, "repo");
      const work = path.join(base, "runtime");
      mkdirSync(path.join(repo, "src", "lib", "v3"), { recursive: true });
      writeFileSync(path.join(repo, "src", "lib", "v3", "a.ts"), "export const a = 1;\n");
      const g = async (args: string[]) => {
        const r = await runProcess("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
        assert.equal(r.code, 0, `${args.join(" ")}: ${r.stderr}`);
      };
      await g(["init", "-q", "-b", "main"]);
      await g(["add", "-A"]);
      await g(["commit", "-q", "-m", "init"]);
      await proposeDevelopment(work, { beyin: "kurgu", baslik: "Change a", neden: "n", kaynak: "ep1", kaynakTuru: "olcum" });
      const id = (await listProposals(work))[0]!.proposal.id;
      await decideProposal(work, id, "onaylandi");
      // The fake agent (in Claude's place: yazan defaults to "claude") edits a V3 file and reports which fake secret it
      // saw, and whether PATH and USERPROFILE (where Claude finds its own login) still reached it.
      const agent = [process.execPath, "-e", `require("fs").writeFileSync("src/lib/v3/a.ts","export const a = 2;\\n");process.stdin.resume();process.stdin.on("end",()=>{const seen=${JSON.stringify(SECRET_NAMES)}.filter(k=>process.env[k]!==undefined);console.log("ajan gordu ["+seen.join(",")+"] path "+(process.env.PATH?"var":"yok")+" profil "+(process.env.USERPROFILE||process.env.HOME?"var":"yok"))})`];
      const job = (await listProposals(work))[0]!.proposal;
      const done = await develop(job, { repoRoot: repo, workRoot: work, worktreeRoot: path.join(base, "gelistirme"), agent, checks: [[process.execPath, "-e", ENV_PROBE]], log: () => {} });
      assert.equal(done.durum, "hazir", `the check saw a secret: ${JSON.stringify(done.is?.sorunlar)}`);
      assert.match(done.is?.ozet ?? "", /ajan gordu \[\] path var profil var/, `the Claude agent saw a secret or lost PATH: ${done.is?.ozet}`);
    });

    await scenario("B2 develop() with the apprentice (yazan cirak): its writer keeps the studio's model key, its checks still see none", async () => {
      const repo = path.join(base, "repo2");
      const work = path.join(base, "runtime2");
      mkdirSync(path.join(repo, "src", "lib", "v3"), { recursive: true });
      writeFileSync(path.join(repo, "src", "lib", "v3", "a.ts"), "export const a = 1;\n");
      const g = async (args: string[]) => {
        const r = await runProcess("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
        assert.equal(r.code, 0, `${args.join(" ")}: ${r.stderr}`);
      };
      await g(["init", "-q", "-b", "main"]);
      await g(["add", "-A"]);
      await g(["commit", "-q", "-m", "init"]);
      await proposeDevelopment(work, { beyin: "kurgu", baslik: "Change a", neden: "n", kaynak: "ep1", kaynakTuru: "olcum" });
      const id = (await listProposals(work))[0]!.proposal.id;
      await decideProposal(work, id, "onaylandi");
      const agent = [process.execPath, "-e", `require("fs").writeFileSync("src/lib/v3/a.ts","export const a = 2;\\n");process.stdin.resume();process.stdin.on("end",()=>console.log("cirak anahtari "+(process.env.OPENAI_API_KEY?"goruyor":"gormuyor")))`];
      const job = (await listProposals(work))[0]!.proposal;
      const done = await develop(job, { repoRoot: repo, workRoot: work, worktreeRoot: path.join(base, "gelistirme2"), agent, yazan: "cirak", checks: [[process.execPath, "-e", ENV_PROBE]], log: () => {} });
      assert.equal(done.durum, "hazir", `the check saw a secret: ${JSON.stringify(done.is?.sorunlar)}`);
      assert.match(done.is?.ozet ?? "", /cirak anahtari goruyor/);
    });

    await scenario("C the apprentice's runChecks: the code it wrote runs without secrets", async () => {
      const dir = path.join(base, "cirak");
      mkdirSync(dir, { recursive: true });
      const r = await runChecks(dir, [[process.execPath, "-e", ENV_PROBE]], 60_000);
      assert.equal(r.ok, true, r.cikti);
    });

    await scenario("D the default of runProcess is unchanged for every other caller", async () => {
      const r = await runProcess(process.execPath, ["-e", "console.log(process.env.OPENAI_API_KEY ?? '')"]);
      assert.equal(r.stdout.trim(), FAKE_SECRETS.OPENAI_API_KEY);
    });
  } finally {
    for (const name of SECRET_NAMES) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    rmSync(base, { recursive: true, force: true });
  }

  console.log(`PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
