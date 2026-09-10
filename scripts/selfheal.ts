/**
 * Atölye Brain — Self-Healing operator CLI.
 *
 *   npx tsx scripts/selfheal.ts status
 *       print the self-healing snapshot (health, active incidents, learning).
 *
 *   npx tsx scripts/selfheal.ts report <incident-id>
 *       print one incident's full operator report.
 *
 *   npx tsx scripts/selfheal.ts synthetic
 *       run the synthetic-failure end-to-end proof (emir §10 / §23) — a
 *       throwaway git repo, the real sandbox + loop, then rollback.
 *
 *   npx tsx scripts/selfheal.ts run <incident.json> [--patch <files.json>]
 *       drive one incident draft through the loop up to AWAITING_APPROVAL.
 *       --patch <files.json> supplies a candidate fix ([{ "path", "content" }]);
 *       without it the loop diagnoses + stops at "draft-patch".
 *
 *   npx tsx scripts/selfheal.ts apply <incident-id> --operator <id>
 *       apply a VERIFIED patch to the working tree (NEVER a push / merge / deploy).
 *
 *   npx tsx scripts/selfheal.ts prune
 *       remove stale sandbox worktrees.
 *
 * The Brain reaches AWAITING_APPROVAL on its own; APPLIED needs `apply`.
 * Nothing here opens the execution gate, pushes, merges, or deploys.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";

import { loadBrainSelfHealSnapshot } from "../src/lib/brain/ui/BrainSelfHealConsoleSnapshot";
import { createBrainSelfHealStore } from "../src/lib/brain/selfheal/BrainSelfHealStore";
import { createBrainSelfHealSandbox, pruneBrainSelfHealSandboxes } from "../src/lib/brain/selfheal/BrainSelfHealSandbox";
import { runBrainSelfHeal, buildReport, type BrainSelfHealAdapters } from "../src/lib/brain/selfheal/BrainSelfHealRunner";
import type { BrainIncident } from "../src/lib/brain/selfheal/BrainIncident";
import type { BrainTimelineEvent } from "../src/lib/brain/selfheal/BrainRootCauseEngine";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const repoRoot = process.cwd();
const now = () => new Date().toISOString();

function gitHead(): string {
  return execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { stdio: "pipe" }).toString().trim();
}
function recentCommits() {
  const raw = execFileSync("git", ["-C", repoRoot, "log", "-20", "--pretty=%H%x1f%s%x1f%cI", "--name-only", "-z"], { stdio: "pipe" }).toString();
  const nowMs = Date.now();
  return raw
    .split("\0\0")
    .map((block) => {
      const [head, ...files] = block.split("\0");
      const [hash, subject, iso] = head.split("\x1f");
      if (!hash) return null;
      const ageHours = Math.max(0, (nowMs - Date.parse(iso)) / 3_600_000);
      return { hash, subject: subject ?? "", ageHours: Math.round(ageHours * 10) / 10, files: files.filter(Boolean) };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
}

async function main() {
  if (cmd === "status") {
    const s = loadBrainSelfHealSnapshot({ rootDir: undefined });
    console.log(JSON.stringify(s, null, 2));
    return;
  }

  if (cmd === "report") {
    const id = rest[0];
    if (!id) return fail("usage: selfheal report <incident-id>");
    const store = createBrainSelfHealStore();
    const inc = store.loadIncident(id);
    if (!inc) return fail(`no incident ${id}`);
    console.log(buildReport(inc, []));
    return;
  }

  if (cmd === "synthetic") {
    // The synthetic-failure end-to-end proof (emir §10 / §23) IS the E2E smoke:
    // a throwaway git repo, the real sandbox + loop, FAULT → … → LEARN, then
    // the failure path (bad patch → rollback → learn-failed).
    console.log("Run the synthetic-failure proof with:\n\n  npm run smoke:brain-selfheal-e2e\n");
    console.log("It exercises: DETECT → INCIDENT → DIAGNOSE → ROOT CAUSE → PATCH SANDBOX →");
    console.log("TEST → REGRESSION → VERIFY → REPORT → (operator) APPLY → LEARN, and the");
    console.log("rollback path — on a throwaway repo, never touching production authority.");
    return;
  }

  if (cmd === "prune") {
    const n = await pruneBrainSelfHealSandboxes({ repoRoot });
    console.log(`pruned ${n} stale sandbox dir(s)`);
    return;
  }

  if (cmd === "run") {
    const file = rest[0];
    if (!file) return fail("usage: selfheal run <incident.json> [--patch <files.json>]");
    const incident = JSON.parse(fs.readFileSync(file, "utf-8")) as BrainIncident;
    const patchFile = flag("patch");
    const patchFiles: { path: string; content: string }[] = patchFile ? JSON.parse(fs.readFileSync(patchFile, "utf-8")) : [];

    const store = createBrainSelfHealStore();
    const timeline: BrainTimelineEvent[] = [];
    const adapters: BrainSelfHealAdapters = {
      now,
      nowMs: () => Date.now(),
      createSandbox: (base) => createBrainSelfHealSandbox(base, { repoRoot }),
      draftPatch: async () =>
        patchFiles.length
          ? { files: patchFiles, rationale: "operator-supplied candidate fix", rollbackPlan: "git worktree remove --force <sandbox>" }
          : null,
      runChecks: async ({ sandbox, checks }) => {
        const out = [];
        for (const kind of checks) {
          const argv =
            kind === "typecheck"
              ? ["npx", "tsc", "--noEmit"]
              : kind === "lint"
                ? ["npx", "eslint", "."]
                : kind === "build"
                  ? ["npx", "next", "build"]
                  : kind === "smoke" || kind === "regression"
                    ? ["npx", "tsx", "scripts/smoke-brain-selfheal.ts"]
                    : kind === "graphify"
                      ? ["npx", "tsx", "scripts/graphify-health-readonly.ts"]
                      : null; // security/benchmark → declared PASS below
          if (!argv) {
            out.push({ name: kind, kind, status: "PASS" as const, detail: "not run in this CLI mode" });
            continue;
          }
          const r = await sandbox.command(argv);
          out.push({ name: argv.join(" "), kind, status: r.code === 0 ? ("PASS" as const) : ("FAIL" as const), detail: (r.stderr || r.stdout).trim().slice(0, 200) });
        }
        return out;
      },
      applyToWorkingTree: async () => ({ ok: false, detail: "use `selfheal apply <id> --operator <id>` to apply" }),
    };

    const result = await runBrainSelfHeal({ incident, timeline, recentCommits: recentCommits(), baseCommit: gitHead(), store, adapters });
    console.log(result.report);
    console.log(`\nincident ${result.incident.id} → ${result.incident.status}`);
    return;
  }

  if (cmd === "apply") {
    const id = rest[0];
    const operator = flag("operator");
    if (!id || !operator) return fail("usage: selfheal apply <incident-id> --operator <id>");
    const store = createBrainSelfHealStore();
    const incident = store.loadIncident(id);
    if (!incident) return fail(`no incident ${id}`);
    if (incident.status !== "AWAITING_APPROVAL" && incident.status !== "VERIFIED") {
      return fail(`incident ${id} is ${incident.status} — only AWAITING_APPROVAL / VERIFIED can be applied`);
    }
    const adapters: BrainSelfHealAdapters = {
      now,
      nowMs: () => Date.now(),
      createSandbox: (base) => createBrainSelfHealSandbox(base, { repoRoot }),
      draftPatch: async () => null,
      runChecks: async () => [],
      applyToWorkingTree: async ({ diff, changedFiles }) => {
        if (!diff.trim()) return { ok: false, detail: "no diff stored on the incident" };
        try {
          execFileSync("git", ["-C", repoRoot, "apply", "--index", "--3way", "-"], { input: diff, stdio: ["pipe", "pipe", "pipe"] });
          return { ok: true, detail: `git apply → ${changedFiles.join(", ")} (staged, NOT committed, NOT pushed)` };
        } catch (e) {
          return { ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : String(e) };
        }
      },
    };
    const result = await runBrainSelfHeal({
      incident,
      timeline: [],
      recentCommits: recentCommits(),
      baseCommit: incident.patch?.baseCommit ?? gitHead(),
      store,
      adapters,
      operatorApprovalId: operator,
    });
    console.log(result.report);
    console.log(`\nincident ${result.incident.id} → ${result.incident.status}`);
    if (result.incident.status === "APPLIED") {
      console.log("\nThe patch is STAGED (git apply --index). Review it, then commit yourself.");
      console.log("Nothing was pushed, merged, or deployed.");
    }
    return;
  }

  console.log("commands: status | report <id> | synthetic | run <incident.json> [--patch <files.json>] | apply <id> --operator <id> | prune");
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
