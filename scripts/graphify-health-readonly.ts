/**
 * GRAPHIFY MASTER HEALTH REPORT — read-only (Final Production Master Sprint §14).
 *
 * Runs `scanGraphifyConsistency` against whatever `resolveRuntimeStorageContext`
 * resolves to (post-cutover: `D:\AtolyeRuntime`) and cross-checks the numbers
 * AYAS chat would report (`loadAyasStudioContext`). It:
 *   - NEVER writes to `D:\AtolyeRuntime` / `D:\AtolyeAuthority` or `data/projects`;
 *   - NEVER runs a stage, NEVER opens the execution gate;
 *   - only reads `project.json` / `manifest.json`.
 *
 * Root selection is explicit, never silent. A consistency verdict is reported
 * ONLY for the live runtime (`ATOLYE_RUNTIME_ROOT` set → `explicit-external`).
 * Any other root is still scanned for diagnostics, but the final JSON carries
 * `status: "NOT_LIVE_RUNTIME"` + `verdict: null` so a legacy/workspace scan can
 * never be mistaken for a live `INCONSISTENT` result (exit 0 — this is a
 * report, not a gate — `scripts/selfheal.ts` treats exit 0 as a passing check).
 * A configured-but-unusable root (invalid value, missing `projects/` dir)
 * prints `status: "INVALID_RUNTIME_ROOT"` and exits 1.
 *
 * Usage:  npx tsx scripts/graphify-health-readonly.ts
 *         (tsx does NOT load `.env.local` — export ATOLYE_RUNTIME_ROOT first)
 */

import fs from "node:fs";

import {
  resolveRuntimeStorageContext,
  getProjectsRoot,
  runtimeStorageEnvironmentVariable,
  RuntimeStorageError,
  type RuntimeStorageContext,
} from "../src/lib/runtime/RuntimeStoragePaths";
import { resolveProjectFolderSegment, clearProjectFolderIndexCache } from "../src/lib/projects/ProjectFolderIndex";
import { scanGraphifyConsistency } from "../src/lib/ayas/GraphifyConsistency";
import { loadAyasStudioContext } from "../src/lib/ayas/AyasStudioContext";

function line(label: string, value: unknown) {
  console.log(`  ${label.padEnd(34)} ${String(value)}`);
}

interface RootAssessment {
  readonly rootStatus:
    | "LIVE_RUNTIME"
    | "ATOLYE_RUNTIME_ROOT_NOT_SET"
    | "EXPLICIT_LEGACY_ROOT"
    | "EXPLICIT_WORKSPACE_ROOT";
  readonly rootClassification: "LIVE_RUNTIME" | "LEGACY_REPOSITORY" | "WORKSPACE_ROOT";
  readonly live: boolean;
  /** Machine-readable warning codes; empty only for the live runtime. */
  readonly diagnostics: readonly string[];
}

/** Only an explicitly configured external root is the live runtime. */
function assessRoot(context: RuntimeStorageContext): RootAssessment {
  if (context.source === "environment" && context.classification === "explicit-external") {
    return { rootStatus: "LIVE_RUNTIME", rootClassification: "LIVE_RUNTIME", live: true, diagnostics: [] };
  }
  if (context.source === "legacy-default") {
    return {
      rootStatus: "ATOLYE_RUNTIME_ROOT_NOT_SET",
      rootClassification: "LEGACY_REPOSITORY",
      live: false,
      diagnostics: ["ATOLYE_RUNTIME_ROOT_NOT_SET", "LEGACY_REPOSITORY", "NOT_LIVE_RUNTIME"],
    };
  }
  if (context.classification === "explicit-legacy") {
    return {
      rootStatus: "EXPLICIT_LEGACY_ROOT",
      rootClassification: "LEGACY_REPOSITORY",
      live: false,
      diagnostics: ["EXPLICIT_LEGACY_ROOT", "LEGACY_REPOSITORY", "NOT_LIVE_RUNTIME"],
    };
  }
  return {
    rootStatus: "EXPLICIT_WORKSPACE_ROOT",
    rootClassification: "WORKSPACE_ROOT",
    live: false,
    diagnostics: ["EXPLICIT_WORKSPACE_ROOT", "NOT_LIVE_RUNTIME"],
  };
}

function invalidRoot(reason: string) {
  console.log("!!! INVALID_RUNTIME_ROOT — no health verdict produced !!!");
  line("reason", reason);
  line(`${runtimeStorageEnvironmentVariable} set`, runtimeStorageEnvironmentVariable in process.env);
  console.log();
  console.log("========== VERDICT ==========");
  console.log("  Graphify consistency verdict: WITHHELD (INVALID_RUNTIME_ROOT)");
  console.log(
    JSON.stringify({
      status: "INVALID_RUNTIME_ROOT",
      verdict: null,
      liveRuntime: false,
      rootStatus: "INVALID_RUNTIME_ROOT",
      reason,
      diagnostics: ["INVALID_RUNTIME_ROOT", "NOT_LIVE_RUNTIME"],
    }),
  );
  process.exitCode = 1;
}

async function main() {
  console.log("========== GRAPHIFY MASTER HEALTH REPORT (read-only) ==========\n");

  let context: RuntimeStorageContext;
  try {
    context = resolveRuntimeStorageContext({});
  } catch (error) {
    if (!(error instanceof RuntimeStorageError)) throw error;
    invalidRoot(error.code);
    return;
  }
  const projectsRoot = getProjectsRoot(context);
  const assessment = assessRoot(context);
  const runtimeExternal = assessment.live;

  console.log("--- Storage authority ---");
  line("runtimeRoot", context.runtimeRoot);
  line("projectsRoot", projectsRoot);
  line("authorityRoot", context.authorityRoot);
  line("classification", context.classification);
  line("source", context.source);
  line("external authority", runtimeExternal);
  line("root status", assessment.rootStatus);
  console.log();

  let projectsRootIsDirectory = false;
  try {
    projectsRootIsDirectory = fs.statSync(projectsRoot).isDirectory();
  } catch {
    projectsRootIsDirectory = false;
  }
  // Only a CONFIGURED root is invalid when it has no projects dir. The unset
  // fallback in a fresh checkout / self-heal worktree legitimately has no
  // `data/projects` — that stays NOT_LIVE_RUNTIME (exit 0), as before.
  if (!projectsRootIsDirectory && context.source === "environment") {
    invalidRoot("PROJECTS_ROOT_MISSING");
    return;
  }

  if (!assessment.live) {
    console.log(`!!! ${assessment.diagnostics.join(" / ")} !!!`);
    console.log(
      assessment.rootStatus === "ATOLYE_RUNTIME_ROOT_NOT_SET"
        ? `  ${runtimeStorageEnvironmentVariable} is not set — falling back to the in-repo legacy root.`
        : `  ${runtimeStorageEnvironmentVariable} points at a non-external root.`,
    );
    console.log("  This is NOT the live runtime. Numbers below describe this root only;");
    console.log("  the live consistency verdict is WITHHELD. Export the live root and re-run.");
    console.log();
  }

  clearProjectFolderIndexCache();
  const report = scanGraphifyConsistency({
    projectsRoot,
    runtimeExternal,
    legacyDataProjectsDir: context.legacyProjectsRoot,
    resolveFolder: resolveProjectFolderSegment,
  });

  console.log("--- Runtime projects ---");
  line("folders on disk", report.folderCount);
  line("with project.json", report.withProjectJson);
  line("with manifest.json", report.withManifest);
  line("in-repo data/projects records", report.legacyRecordCount);
  line("in-repo root is quarantine", report.legacyRootIsQuarantine);
  console.log();

  console.log("--- Consistency checks ---");
  line("orphan folders (no project.json)", report.orphanFolders.length);
  for (const f of report.orphanFolders) console.log(`      · ${f}`);
  line("id !== folder mismatches", report.idFolderMismatches.length);
  for (const f of report.idFolderMismatches) console.log(`      · ${f}`);
  line("project.json without manifest", report.missingManifests.length);
  for (const f of report.missingManifests) console.log(`      · ${f}`);
  line("UNRESOLVABLE projects (real break)", report.unresolvableProjects.length);
  for (const r of report.unresolvableProjects) console.log(`      · ${r.folder} — ${r.identifiers.join(", ")}`);
  line("in-repo records not on active runtime", report.legacyUnresolved.length);
  for (const r of report.legacyUnresolved) console.log(`      · ${r}`);
  console.log();

  if (report.notes.length > 0) {
    console.log("--- Notes ---");
    for (const n of report.notes) console.log(`  • ${n}`);
    console.log();
  }

  console.log("--- Per-folder rows ---");
  for (const row of report.rows) {
    const flags = [
      row.hasProjectJson ? "pj" : "NO-pj",
      row.hasManifest ? "mf" : "NO-mf",
      row.idFolderMismatch ? "ID-MISMATCH" : null,
    ]
      .filter(Boolean)
      .join(" ");
    console.log(`  ${row.folder}  [${flags}]  status=${row.status ?? "?"}  slug=${row.slug ?? "?"}`);
  }
  console.log();

  console.log("--- Write-path safety (KNOWN risk, does NOT fire — gate CLOSED) ---");
  console.log(`  ${report.writePathRisk}`);
  console.log();

  console.log("--- Brain ↔ Graphify consistency (loadAyasStudioContext) ---");
  const studio = await loadAyasStudioContext();
  line("studio.available", studio.available);
  line("studio.projects.total", studio.projects.total);
  line("byStatus", JSON.stringify(studio.projects.byStatus));
  if (studio.projects.pipeline) {
    line("pipeline.withFailedStage", studio.projects.pipeline.withFailedStage);
    line("pipeline.blocked", studio.projects.pipeline.blocked);
    line(
      "pipeline.latestFailure",
      studio.projects.pipeline.latestFailure
        ? `${studio.projects.pipeline.latestFailure.slug} → ${studio.projects.pipeline.latestFailure.failedStages.join(",")} (${studio.projects.pipeline.latestFailure.rootCause ?? "?"})`
        : "none",
    );
  }
  for (const n of studio.notes) console.log(`      note: ${n}`);
  const studioMatchesScan = studio.projects.total === report.withProjectJson;
  line("studio total === folders w/ project.json", `${studioMatchesScan} (${studio.projects.total} vs ${report.withProjectJson})`);
  console.log();

  console.log("========== VERDICT ==========");
  if (assessment.live) {
    console.log(`  Graphify consistency verdict: ${report.verdict.toUpperCase()}`);
  } else {
    console.log(`  Graphify consistency verdict: WITHHELD (${assessment.diagnostics.join(", ")})`);
    console.log(`  non-live root scan outcome:   ${report.verdict} — NOT a live runtime result`);
  }
  console.log(
    JSON.stringify({
      status: !assessment.live ? "NOT_LIVE_RUNTIME" : report.verdict === "inconsistent" ? "INCONSISTENT" : "OK",
      verdict: assessment.live ? report.verdict : null,
      nonLiveScanVerdict: assessment.live ? null : report.verdict,
      liveRuntime: assessment.live,
      rootStatus: assessment.rootStatus,
      rootClassification: assessment.rootClassification,
      diagnostics: assessment.diagnostics,
      projectsRoot,
      projectsRootExists: projectsRootIsDirectory,
      folders: report.folderCount,
      withProjectJson: report.withProjectJson,
      withManifest: report.withManifest,
      orphans: report.orphanFolders.length,
      idMismatches: report.idFolderMismatches.length,
      missingManifests: report.missingManifests.length,
      unresolvableProjects: report.unresolvableProjects.length,
      legacyUnresolved: report.legacyUnresolved.length,
      studioTotal: studio.projects.total,
      brainGraphifyConsistent: studioMatchesScan,
    }),
  );
}

void main().catch((error) => {
  console.error("GRAPHIFY HEALTH REPORT ERROR:", error);
  process.exitCode = 1;
});
