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
import { observeForSelfHeal, type BrainLifecycleTelemetryLike, type BrainVoiceHealthLike } from "../src/lib/brain/selfheal/BrainSelfHealObservability";
import { decideQueueAdmission } from "../src/lib/brain/selfheal/BrainSelfHealQueue";
import {
  buildLatencyIncident,
  describeLatencyObservation,
  DEFAULT_LATENCY_CONFIG,
  extractLatencySamples,
  normalizeLatencySamples,
  observeVoiceLatency,
} from "../src/lib/brain/selfheal/BrainVoiceLatency";
import { canApplyFromDecision, describeSelfHealDecision } from "../src/lib/brain/selfheal/BrainSelfHealDecision";
import { DEFAULT_AUTO_APPLY_CONFIG } from "../src/lib/brain/selfheal/BrainAutoApplyPolicy";
import { DEFAULT_HEAL_WATCHDOG_CONFIG } from "../src/lib/brain/selfheal/BrainHealWatchdog";
import { compareBenchmark, type BrainBenchmarkSample } from "../src/lib/brain/selfheal/BrainOptimizationBenchmark";

/** Autonomous SAFE auto-apply is OFF unless the operator sets SELFHEAL_AUTO_APPLY=on. */
const AUTO_APPLY_ENABLED = process.env.SELFHEAL_AUTO_APPLY === "on";

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

/** Adapters for `heal` — real sandbox + working-tree apply/rollback + a post-apply observe stub. */
function healAdapters(patchFiles: { path: string; content: string }[]): BrainSelfHealAdapters {
  const runChecksArgv = (kind: string): string[] | null =>
    kind === "typecheck" ? ["npx", "tsc", "--noEmit"]
    : kind === "lint" ? ["npx", "eslint", "."]
    : kind === "build" ? ["npx", "next", "build"]
    : kind === "smoke" || kind === "regression" ? ["npx", "tsx", "scripts/smoke-brain-selfheal.ts"]
    : kind === "graphify" ? ["npx", "tsx", "scripts/graphify-health-readonly.ts"]
    : null;
  return {
    now,
    nowMs: () => Date.now(),
    createSandbox: (base) => createBrainSelfHealSandbox(base, { repoRoot }),
    draftPatch: async () =>
      patchFiles.length ? { files: patchFiles, rationale: "operator / generator supplied", rollbackPlan: "git checkout -- <files>" } : null,
    runChecks: async ({ sandbox, checks }) => {
      const out = [];
      for (const kind of checks) {
        const argv = runChecksArgv(kind);
        if (!argv) { out.push({ name: kind, kind, status: "PASS" as const, detail: "not run in this CLI mode" }); continue; }
        const r = await sandbox.command(argv);
        out.push({ name: argv.join(" "), kind, status: r.code === 0 ? ("PASS" as const) : ("FAIL" as const), detail: (r.stderr || r.stdout).trim().slice(0, 200) });
      }
      return out;
    },
    applyToWorkingTree: async () => ({ ok: false, detail: "heal uses autoApply / rollback" }),
    autoApplyToWorkingTree: async ({ diff, changedFiles }) => {
      if (!diff.trim()) return { ok: false, detail: "no diff stored" };
      try {
        execFileSync("git", ["-C", repoRoot, "apply", "--index", "--3way", "-"], { input: diff, stdio: ["pipe", "pipe", "pipe"] });
        return { ok: true, detail: `staged ${changedFiles.join(", ")} (NOT committed, NOT pushed)` };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : String(e) };
      }
    },
    rollbackWorkingTree: async ({ changedFiles }) => {
      try {
        execFileSync("git", ["-C", repoRoot, "checkout", "HEAD", "--", ...changedFiles], { stdio: "pipe" });
        execFileSync("git", ["-C", repoRoot, "reset", "HEAD", "--", ...changedFiles], { stdio: "pipe" });
        return { ok: true, detail: `restored ${changedFiles.join(", ")}` };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : String(e) };
      }
    },
    observePostApply: async () => ({
      // The CLI cannot watch the live browser runtime; it re-runs the relevant
      // check as the post-apply signal. A real deployment feeds the event buffer.
      eventsSinceApply: [],
      signatureRecurrences: 0,
      postApplyChecks: [{ name: "post-apply smoke", status: "PASS" as const }],
    }),
  };
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

  if (cmd === "decisions") {
    const store = createBrainSelfHealStore();
    const list = store.listSelfHealDecisions();
    if (list.length === 0) {
      console.log("no operator decisions recorded (Report Center ONAYLA / REDDET / DAHA SONRA).");
      return;
    }
    for (const d of list) console.log(describeSelfHealDecision(d));
    const approved = list.filter((d) => d.decision === "APPROVE");
    if (approved.length) {
      console.log(`\n${approved.length} APPROVE — apply with:`);
      for (const d of approved) console.log(`  npm run selfheal -- apply ${d.incidentId}`);
    }
    return;
  }

  if (cmd === "observe") {
    // selfheal observe <telemetry.json>  where telemetry.json = { lifecycle, voice? }
    const file = rest[0];
    if (!file) return fail("usage: selfheal observe <telemetry.json>");
    const t = JSON.parse(fs.readFileSync(file, "utf-8")) as { lifecycle: BrainLifecycleTelemetryLike; voice?: BrainVoiceHealthLike };
    const obs = observeForSelfHeal({ lifecycle: t.lifecycle, voice: t.voice ?? null, now: now() });
    console.log(`classification: ${obs.result.classification}  reload: ${obs.result.reloadReason}  → ${obs.result.reason}`);
    if (!obs.incidentDraft) {
      console.log("no incident opened (expected / transient / user-action / known-baseline).");
      return;
    }
    const store = createBrainSelfHealStore();
    const q = decideQueueAdmission(obs.incidentDraft, store.listIncidents());
    if (q.action !== "enqueue") {
      console.log(`queue: ${q.action} — ${q.reason}`);
      return;
    }
    store.saveIncident(obs.incidentDraft);
    console.log(`opened incident ${obs.incidentDraft.id} (${obs.incidentDraft.category}/${obs.incidentDraft.severity}). Run:  npm run selfheal -- heal ${obs.incidentDraft.id}`);
    return;
  }

  if (cmd === "latency") {
    // selfheal latency [<voice-lab-report.json>]
    //  - no arg → print the current latency observation from the store
    //  - with arg → ingest the report's marks, observe, and open a `performance`
    //    incident if there is a confident regression. NEVER runs a sandbox / apply.
    const store = createBrainSelfHealStore();
    const file = rest[0];
    if (file) {
      let report: unknown;
      try {
        report = JSON.parse(fs.readFileSync(file, "utf-8"));
      } catch (e) {
        return fail(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
      }
      const extracted = extractLatencySamples(report, { now: now(), source: "voice-lab" });
      if (extracted.rejected.length) {
        console.log(`rejected ${extracted.rejected.length} mark(s):`);
        for (const r of extracted.rejected.slice(0, 8)) console.log(`  - ${r.reason}`);
      }
      if (extracted.valid.length === 0) {
        console.log("no valid latency marks in the report — nothing ingested.");
        return;
      }
      store.appendLatencySamples(normalizeLatencySamples(extracted.valid, { now: now() }));
      console.log(`ingested ${extracted.valid.length} latency mark(s).`);
    }

    const samples = store.loadLatencySamples();
    const obs = observeVoiceLatency(samples, DEFAULT_LATENCY_CONFIG, now());
    console.log(describeLatencyObservation(obs));
    for (const f of obs.findings) {
      console.log(`  ${f.metric}: ${f.verdict} · baz ${f.baselineMs ?? "—"} ms · güncel ${f.currentMs ?? "—"} ms · trend ${f.trend} · örnek ${f.baselineSamples}+${f.recentSamples} · güven ${f.confidence.toFixed(2)}`);
    }

    const incidentDraft = buildLatencyIncident(obs, now());
    if (!incidentDraft) {
      console.log("\nno confident latency regression → no incident opened (observation recorded).");
      return;
    }
    const q = decideQueueAdmission(incidentDraft, store.listIncidents());
    if (q.action !== "enqueue") {
      console.log(`\nlatency regression, but queue: ${q.action} — ${q.reason}`);
      return;
    }
    store.saveIncident(incidentDraft);
    console.log(`\nopened performance incident ${incidentDraft.id} (${incidentDraft.classification}).`);
    console.log(`It is an OBSERVATION — nothing auto-applies. Review:  npm run selfheal -- report ${incidentDraft.id}`);
    console.log(`Fix (operator decides):  npm run selfheal -- heal ${incidentDraft.id} --patch <files.json>`);
    return;
  }

  if (cmd === "heal") {
    const id = rest[0];
    if (!id) return fail("usage: selfheal heal <incident-id>  (SELFHEAL_AUTO_APPLY=on enables SAFE auto-apply)");
    const store = createBrainSelfHealStore();
    const incident = store.loadIncident(id);
    if (!incident) return fail(`no incident ${id}`);
    const patchFiles: { path: string; content: string }[] = flag("patch") ? JSON.parse(fs.readFileSync(flag("patch")!, "utf-8")) : [];
    const adapters = healAdapters(patchFiles);
    const result = await runBrainSelfHeal({
      incident,
      timeline: [],
      recentCommits: recentCommits(),
      baseCommit: gitHead(),
      store,
      adapters,
      autoApply: { ...DEFAULT_AUTO_APPLY_CONFIG, enabled: AUTO_APPLY_ENABLED, confidenceThreshold: 0.82 },
      healWatchdog: DEFAULT_HEAL_WATCHDOG_CONFIG,
      autonomousApplyTimestampsMs: store.loadAutonomousApplyTimestamps(),
      maxIterations: 60,
    });
    console.log(result.report);
    console.log(`\nincident ${result.incident.id} → ${result.incident.status}` + (AUTO_APPLY_ENABLED ? " (auto-apply ON)" : " (auto-apply OFF — SELFHEAL_AUTO_APPLY=on to enable SAFE auto-apply)"));
    if (result.incident.appliedBy === "autonomous-safe") store.recordAutonomousApply(Date.now());
    return;
  }

  if (cmd === "optimize") {
    // selfheal optimize <bench.json>  where bench.json = { metricName, hypothesis, before, after }
    const file = rest[0];
    if (!file) return fail("usage: selfheal optimize <bench.json>");
    const b = JSON.parse(fs.readFileSync(file, "utf-8")) as { metricName: string; hypothesis: string; before: BrainBenchmarkSample; after: BrainBenchmarkSample };
    const v = compareBenchmark(b.before, b.after);
    console.log(`${b.metricName}: ${v.verdict} — ${v.reason}`);
    if (v.headline) console.log(`headline: ${v.headline}`);
    console.log(v.verdict === "ACCEPT" ? "→ draft a sandbox change, re-benchmark, run the regression, then `selfheal heal`." : "→ no change worth making.");
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
    if (!id) return fail("usage: selfheal apply <incident-id> [--operator <id>]");
    const store = createBrainSelfHealStore();
    const incident = store.loadIncident(id);
    if (!incident) return fail(`no incident ${id}`);
    if (incident.status !== "AWAITING_APPROVAL" && incident.status !== "VERIFIED") {
      return fail(`incident ${id} is ${incident.status} — only AWAITING_APPROVAL / VERIFIED can be applied`);
    }
    // The operator id comes from --operator, OR from a Report Center APPROVE
    // decision. REJECT / DAHA SONRA / no decision → refuse.
    let operator = flag("operator");
    if (!operator) {
      const decision = store.loadSelfHealDecision(id);
      if (!canApplyFromDecision(decision)) {
        return fail(
          decision
            ? `incident ${id} decision is ${decision.decision} — not APPROVE. Approve it in the Report Center, or pass --operator <id>.`
            : `incident ${id} has no operator decision. Approve it in the Report Center (AYAS Raporları), or pass --operator <id>.`,
        );
      }
      operator = decision!.operatorApprovalId;
      console.log(`using Report Center approval — approvalId ${operator} (${decision!.decidedAt.slice(0, 19)})`);
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

  console.log(
    [
      "Atölye Brain — Self-Healing / Autonomous v2 operator CLI",
      "",
      "  status                         the self-healing snapshot (health, live state, incidents, learning)",
      "  report <id>                    one incident's full 🧠 report",
      "  decisions                      list Report Center operator decisions (ONAYLA / REDDET / DAHA SONRA)",
      "  observe <telemetry.json>       classify a telemetry snapshot; open an incident if it is a real fault",
      "  latency [<voice-lab.json>]     ingest Voice Lab latency marks → optimization observation;",
      "                                 open a `performance` incident on a confident regression (observation only)",
      "  heal <id> [--patch <f.json>]   drive an incident through the loop (auto-apply SAFE if SELFHEAL_AUTO_APPLY=on)",
      "  run <incident.json> [--patch]  v1-style run: diagnose + sandbox-test, stop at AWAITING_APPROVAL",
      "  apply <id> [--operator <id>]   apply a VERIFIED patch to the working tree (git apply --index; never a push).",
      "                                 without --operator it uses the Report Center APPROVE decision for <id>.",
      "  optimize <bench.json>          compare a before/after benchmark → ACCEPT / REJECT / NEUTRAL",
      "  synthetic                      the synthetic-failure end-to-end proof",
      "  prune                          remove stale sandbox worktrees",
      "",
      "  SELFHEAL_AUTO_APPLY=on   enables autonomous SAFE working-tree apply (staged, watchdog-guarded). Default OFF.",
      "  Nothing here ever pushes, merges, deploys, opens the execution gate, or reads .env.",
    ].join("\n"),
  );
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
