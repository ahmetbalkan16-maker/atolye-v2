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
 * Usage:  npx tsx scripts/graphify-health-readonly.ts
 */

import path from "node:path";

import {
  resolveRuntimeStorageContext,
  getProjectsRoot,
} from "../src/lib/runtime/RuntimeStoragePaths";
import { resolveProjectFolderSegment, clearProjectFolderIndexCache } from "../src/lib/projects/ProjectFolderIndex";
import { scanGraphifyConsistency } from "../src/lib/ayas/GraphifyConsistency";
import { loadAyasStudioContext } from "../src/lib/ayas/AyasStudioContext";

function line(label: string, value: unknown) {
  console.log(`  ${label.padEnd(34)} ${String(value)}`);
}

async function main() {
  console.log("========== GRAPHIFY MASTER HEALTH REPORT (read-only) ==========\n");

  const context = resolveRuntimeStorageContext({});
  const projectsRoot = getProjectsRoot(context);
  const runtimeExternal =
    context.source === "environment" && context.classification === "explicit-external";

  console.log("--- Storage authority ---");
  line("runtimeRoot", context.runtimeRoot);
  line("projectsRoot", projectsRoot);
  line("authorityRoot", context.authorityRoot);
  line("classification", context.classification);
  line("source", context.source);
  line("external authority", runtimeExternal);
  console.log();

  clearProjectFolderIndexCache();
  const report = scanGraphifyConsistency({
    projectsRoot,
    runtimeExternal,
    legacyDataProjectsDir: path.join(process.cwd(), "data", "projects"),
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
  console.log(`  Graphify consistency verdict: ${report.verdict.toUpperCase()}`);
  console.log(
    JSON.stringify({
      status: report.verdict === "inconsistent" ? "INCONSISTENT" : "OK",
      verdict: report.verdict,
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
