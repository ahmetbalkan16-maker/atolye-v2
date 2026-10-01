/**
 * Stage 15G — SBOM and release provenance, for the operator.
 *
 *   npx tsx scripts/ayas-release-provenance.ts [options]
 *
 * With no option it prints a summary and writes nothing.
 *
 *   --out <dir>                 write SBOM.cdx.json and RELEASE_PROVENANCE.json into <dir>.
 *                               Existing files are not overwritten.
 *   --baseline-report <file>    a report written by scripts/ayas-eval-baseline.ts.
 *   --advisory-report <file>    an `npm audit --json` report you produced.
 *   --advisory-source <s>       offline-cache | registry. Required with --advisory-report.
 *                               `registry` only for a report the npm registry answered.
 *   --verify-artifacts          compare each pinned model and binary with what is on this machine.
 *   --deep                      with --verify-artifacts: hash large files too (several GB of reading).
 *   --verify <file>             check a stored RELEASE_PROVENANCE.json: its seal, and what has changed since.
 *   --json                      machine-readable output.
 *
 * Read-only apart from --out. It installs nothing, upgrades nothing and contacts no network endpoint. A live advisory
 * query sends the dependency list to the public npm registry: that is the owner's call to make, with `npm audit --json`.
 *
 * Exit code 1 when --verify finds a broken seal or a difference, or when the SBOM has a blocking finding.
 */
import fs from "node:fs";
import path from "node:path";

import { collectAyasReleaseProvenance } from "../src/lib/ayas/provenance/AyasReleaseProvenanceCollector";
import { compareAyasReleaseProvenance, verifyAyasReleaseProvenance } from "../src/lib/ayas/provenance/AyasReleaseProvenance";

const VALUE_FLAGS = new Set(["--out", "--baseline-report", "--advisory-report", "--advisory-source", "--verify"]);
const SWITCHES = new Set(["--verify-artifacts", "--deep", "--json"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (VALUE_FLAGS.has(arg) && args[i + 1] !== undefined && !args[i + 1]!.startsWith("--") && !values.has(arg)) values.set(arg, args[++i]!);
    else if (SWITCHES.has(arg)) switches.add(arg);
    else throw new Error("AYAS_PROVENANCE_ARGUMENTS_INVALID");
  }
  const advisoryFile = values.get("--advisory-report");
  const advisorySource = values.get("--advisory-source");
  if ((advisoryFile === undefined) !== (advisorySource === undefined) || (advisorySource !== undefined && !["offline-cache", "registry"].includes(advisorySource))) throw new Error("AYAS_PROVENANCE_ARGUMENTS_INVALID");
  if (switches.has("--deep") && !switches.has("--verify-artifacts")) throw new Error("AYAS_PROVENANCE_ARGUMENTS_INVALID");

  const repoRoot = process.cwd();
  const collected = await collectAyasReleaseProvenance({
    repoRoot, now: new Date(),
    ...(values.has("--baseline-report") ? { baselineReportFile: values.get("--baseline-report")! } : {}),
    ...(advisoryFile ? { advisoryReport: { file: advisoryFile, source: advisorySource === "registry" ? "npm-registry" as const : "npm-offline-cache" as const } } : {}),
    verifyArtifacts: switches.has("--verify-artifacts"), deep: switches.has("--deep"),
  });
  const { manifest } = collected;
  const json = switches.has("--json");

  const verifyFile = values.get("--verify");
  if (verifyFile) {
    const stored = verifyAyasReleaseProvenance(JSON.parse(fs.readFileSync(path.resolve(repoRoot, verifyFile), "utf8")));
    const drift = stored.ok ? compareAyasReleaseProvenance(stored.manifest, manifest) : [];
    const result = { seal: stored.ok ? "INTACT" : "BROKEN", problems: stored.ok ? [] : stored.problems, recordedHead: stored.ok ? stored.manifest.git.head : null, currentHead: manifest.git.head, changedSince: drift };
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`seal ${result.seal}${result.problems.length ? `: ${result.problems.join(", ")}` : ""}`);
      if (stored.ok) console.log(drift.length ? `changed since it was recorded: ${drift.join(", ")}` : "nothing it records has changed");
    }
    if (!stored.ok || drift.length) process.exitCode = 1;
    return;
  }

  const outDir = values.get("--out");
  if (outDir) {
    const target = path.resolve(repoRoot, outDir);
    fs.mkdirSync(target, { recursive: true });
    // New files only: an existing record is evidence and is never replaced in place.
    const writeNew = (name: string, text: string) => fs.writeFileSync(path.join(target, name), text, { flag: "wx" });
    writeNew("SBOM.cdx.json", collected.sbomText);
    writeNew("RELEASE_PROVENANCE.json", `${JSON.stringify(manifest, null, 2)}\n`);
  }

  if (json) console.log(JSON.stringify(manifest, null, 2));
  else {
    const { summary } = manifest.sbom;
    const lines = [
      `subject      ${manifest.subject.name}@${manifest.subject.version}`,
      `git          ${manifest.git.head} ${manifest.git.branch ?? "(detached)"} ${manifest.git.treeState}${manifest.git.dirtyPaths ? ` (${manifest.git.dirtyPaths} paths)` : ""}`,
      `lockfile     sha256 ${manifest.lockfile.sha256}`,
      `sbom         CycloneDX ${manifest.sbom.specVersion}; ${summary.components} components (${summary.byScope.required} shipped, ${summary.byScope.optional} optional, ${summary.byScope.excluded} development); sha256 ${manifest.sbom.sha256}`,
      `findings     ${summary.blockingFindings} blocking, ${summary.reviewFindings} for review`,
      `licenses     ${summary.licenses.length} distinct; ${summary.licensesForOwnerReview.length} components for the owner to look at`,
      `install      ${summary.installScripts.length} packages with install-time scripts: ${summary.installScripts.map((item) => `${item.component} ${item.class}`).join(", ") || "none"}`,
      `advisories   ${manifest.advisories.state === "NOT_CHECKED" ? "NOT_CHECKED" : `${manifest.advisories.source}, ${manifest.advisories.counts.total} reported, ${manifest.advisories.current ? "current" : "not current"}`}`,
      `artifacts    ${manifest.artifacts.lifecycle.length} pinned identities; local verification ${manifest.artifacts.localVerification}; local coding manifest ${manifest.artifacts.localCodingManifest.state}`,
      `graphify     ${manifest.graphify.state === "PRESENT" ? `${manifest.graphify.structural}, built from ${manifest.graphify.builtFromHead ?? "unknown"}, ${manifest.graphify.nodes} nodes / ${manifest.graphify.links} links` : "ABSENT"}`,
      `test matrix  ${manifest.testMatrix.manifestVersion}, ${manifest.testMatrix.suites} suites; baseline ${manifest.testMatrix.baseline.state === "PRESENT" ? `${manifest.testMatrix.baseline.outcome} at ${manifest.testMatrix.baseline.sourceHead}` : "ABSENT"}`,
      `build        ${manifest.build.state === "PRESENT" ? `${manifest.build.files} files, sha256 ${manifest.build.sha256}, ${manifest.build.stampedHead ? `stamped ${manifest.build.stampedHead}` : "not stamped"}` : "ABSENT"}`,
      `signature    ${manifest.signature.state}`,
      `completeness ${manifest.completeness.status}${manifest.completeness.gaps.length ? `: ${manifest.completeness.gaps.join(", ")}` : ""}`,
      `manifest     sha256 ${manifest.manifestDigest}`,
      ...(outDir ? [`written      ${outDir}/SBOM.cdx.json, ${outDir}/RELEASE_PROVENANCE.json`] : []),
    ];
    console.log(lines.join("\n"));
  }
  if (manifest.sbom.summary.blockingFindings > 0) process.exitCode = 1;
}

main().catch((error: unknown) => { console.error(JSON.stringify({ status: "FAILED", message: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });
