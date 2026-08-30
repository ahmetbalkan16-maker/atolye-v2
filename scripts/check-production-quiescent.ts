/**
 * READ-ONLY quiescence check for a production run. Makes NO provider/API call
 * and writes nothing — its whole job is to prove, before anyone says "the run
 * is stopped", that:
 *
 *   1. no OS process is still executing a production entry point, AND
 *   2. the project's `ai-usage.json` spend ledger is not still growing.
 *
 * Background: on 2026-08-30 a run launched with `nohup npx tsx … &` could not be
 * killed by `taskkill`/`pkill` on the captured `$!` (that PID was the `npx`
 * wrapper, not the detached `node` worker). The worker kept spending for ~11
 * minutes after it was believed dead. The safe launch pattern is now: run the
 * production CLI in the FOREGROUND (the pipeline is fully synchronous and
 * in-process — `run-production-acceptance.ts` never self-detaches), or, when
 * backgrounding through a task runner, hold the real `node` PID. Either way,
 * confirm quiescence with this script before continuing.
 *
 * Usage:
 *   npx tsx scripts/check-production-quiescent.ts --project-slug=<slug> [--watch-seconds=10]
 *
 * Exit 0 = quiescent (no production process, ledger stable).
 * Exit 1 = NOT quiescent (a process is running and/or the ledger grew).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PRODUCTION_ENTRYPOINTS = [
  "run-production-acceptance.ts",
  "run-production-regeneration.ts",
  "run-pipeline-stage-regeneration.ts",
  "PipelineRunner",
];

function arg(name: string): string | undefined {
  return process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
}

interface LedgerSnapshot {
  readonly records: number;
  readonly knownUsd: number;
}

function readLedger(slug: string): LedgerSnapshot {
  const file = path.join("data", "projects", slug, "ai-usage.json");
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const records: unknown[] = Array.isArray(raw) ? raw : (raw.records ?? raw.entries ?? []);
    let knownUsd = 0;
    for (const r of records) {
      const rec = r as { estimatedCost?: unknown; pricingStatus?: unknown };
      if (typeof rec.estimatedCost === "number" && rec.pricingStatus === "known") {
        knownUsd += rec.estimatedCost;
      }
    }
    return { records: records.length, knownUsd: Math.round(knownUsd * 1e6) / 1e6 };
  } catch {
    return { records: 0, knownUsd: 0 };
  }
}

/** Best-effort process listing on Windows; empty list on failure (never throws). */
function productionProcesses(): string[] {
  const attempts: Array<[string, string[]]> = [
    ["wmic", ["process", "where", "name='node.exe'", "get", "ProcessId,CommandLine", "/format:list"]],
    ["tasklist", ["/v", "/fo", "csv"]],
  ];
  for (const [exe, args] of attempts) {
    const out = spawnSync(exe, args, { encoding: "utf8", windowsHide: true });
    if (out.status !== 0 || !out.stdout) continue;
    return out.stdout
      .split(/\r?\n/)
      .filter((line) => PRODUCTION_ENTRYPOINTS.some((entry) => line.includes(entry)))
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [];
}

async function main() {
  const slug = arg("project-slug");
  if (!slug || !/^[a-zA-Z0-9-_]+$/.test(slug)) {
    process.stderr.write('{"error":"MISSING_OR_INVALID_PROJECT_SLUG"}\n');
    process.exitCode = 1;
    return;
  }
  const watchSeconds = Math.max(0, Math.min(120, Number(arg("watch-seconds") ?? "0") || 0));

  const before = readLedger(slug);
  const procsBefore = productionProcesses();

  let after = before;
  if (watchSeconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, watchSeconds * 1000));
    after = readLedger(slug);
  }
  const procsAfter = productionProcesses();

  const processesRunning = procsBefore.length > 0 || procsAfter.length > 0;
  const ledgerGrew = after.records !== before.records || after.knownUsd !== before.knownUsd;
  const quiescent = !processesRunning && !ledgerGrew;

  process.stdout.write(`${JSON.stringify({
    projectSlug: slug,
    quiescent,
    processesRunning,
    productionProcesses: [...new Set([...procsBefore, ...procsAfter])],
    ledger: {
      watchedSeconds: watchSeconds,
      before,
      after,
      grew: ledgerGrew,
    },
    verdict: quiescent
      ? "SAFE: no production process, ledger stable"
      : "NOT SAFE: a production process is running and/or the ledger is still growing",
  }, null, 2)}\n`);
  process.exitCode = quiescent ? 0 : 1;
}

void main();
