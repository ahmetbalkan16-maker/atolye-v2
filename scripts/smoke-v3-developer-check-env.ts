/**
 * V3 developer: a build's checks run without secrets (11 Nov 2026 security review).
 *
 * The checks of an unattended developer build (tsc, smoke suites — the build's own new ones included — and the lint)
 * run code the build just wrote. `checkEnv` hands them a copy of the environment without any credential, while the
 * build agent keeps its own full environment. Proven on the pure filter and on the real check paths: `develop()` with a
 * fake agent and a fake check, and the apprentice's `runChecks`. No network, no model, temp roots only.
 *
 * Run: npx tsx scripts/smoke-v3-developer-check-env.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { develop } from "../src/lib/v3/council/Developer";
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
      CLOUDFLARE_API_TOKEN: "x", CF_ACCOUNT_ID: "x",
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

  const previous: Record<string, string | undefined> = {};
  for (const name of SECRET_NAMES) {
    previous[name] = process.env[name];
    process.env[name] = FAKE_SECRETS[name];
  }
  const base = mkdtempSync(path.join(os.tmpdir(), "v3-check-env-"));
  try {
    await scenario("B develop(): the checks see no secret (and still PATH); the build agent keeps its environment", async () => {
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
      // The fake agent edits a V3 file and reports whether it saw the key (it must: claude -p needs its own setup).
      const agent = [process.execPath, "-e", `require("fs").writeFileSync("src/lib/v3/a.ts","export const a = 2;\\n");process.stdin.resume();process.stdin.on("end",()=>console.log("ajan anahtari "+(process.env.OPENAI_API_KEY?"goruyor":"gormuyor")))`];
      const job = (await listProposals(work))[0]!.proposal;
      const done = await develop(job, { repoRoot: repo, workRoot: work, worktreeRoot: path.join(base, "gelistirme"), agent, checks: [[process.execPath, "-e", ENV_PROBE]], log: () => {} });
      assert.equal(done.durum, "hazir", `the check saw a secret: ${JSON.stringify(done.is?.sorunlar)}`);
      assert.match(done.is?.ozet ?? "", /ajan anahtari goruyor/, "the agent's own environment is unchanged");
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
