/**
 * Stage 15H — the no-cloud independence certification, for the operator.
 *
 *   npx tsx scripts/ayas-independence-certification.ts [options]
 *
 * With no option it prints a summary and writes nothing.
 *
 *   --baseline-report <file>    a report written by scripts/ayas-eval-baseline.ts for this commit.
 *                               Without one every requirement is NOT_MEASURED.
 *   --out <file.json>           write the sealed record. An existing file is not overwritten.
 *   --verify <file>             check a stored record: its seal, and what has changed since.
 *   --json                      machine-readable output.
 *
 * Read-only apart from --out. It runs no suite, no model and no container and contacts no network endpoint.
 * The record is evidence: it approves nothing, enables nothing and registers no engine.
 *
 * LOCAL_INDEPENDENCE_DEGRADED is a result, not an error: the exit code is 0. Exit code 1 when --verify finds a
 * broken seal or a difference, or when the arguments or an input file cannot be read.
 */
import fs from "node:fs";
import path from "node:path";

import { compareAyasIndependenceCertification, verifyAyasIndependenceCertification } from "../src/lib/ayas/certification/AyasIndependenceCertification";
import { collectAyasIndependenceCertification } from "../src/lib/ayas/certification/AyasIndependenceCertificationCollector";

const VALUE_FLAGS = new Set(["--baseline-report", "--out", "--verify"]);
const SWITCHES = new Set(["--json"]);

function main(): void {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (VALUE_FLAGS.has(arg) && args[i + 1] !== undefined && !args[i + 1]!.startsWith("--") && !values.has(arg)) values.set(arg, args[++i]!);
    else if (SWITCHES.has(arg)) switches.add(arg);
    else throw new Error("AYAS_INDEPENDENCE_ARGUMENTS_INVALID");
  }
  const outFile = values.get("--out");
  if (outFile !== undefined && (!outFile.endsWith(".json") || values.has("--verify"))) throw new Error("AYAS_INDEPENDENCE_ARGUMENTS_INVALID");

  const repoRoot = process.cwd();
  const certification = collectAyasIndependenceCertification({
    repoRoot, now: new Date(),
    ...(values.has("--baseline-report") ? { baselineReportFile: values.get("--baseline-report")! } : {}),
  });
  const json = switches.has("--json");

  const verifyFile = values.get("--verify");
  if (verifyFile) {
    const stored = verifyAyasIndependenceCertification(JSON.parse(fs.readFileSync(path.resolve(repoRoot, verifyFile), "utf8")));
    const drift = stored.ok ? compareAyasIndependenceCertification(stored.certification, certification) : [];
    const result = { seal: stored.ok ? "INTACT" : "BROKEN", problems: stored.ok ? [] : stored.problems, recordedResult: stored.ok ? stored.certification.evaluation.result : null, recordedHead: stored.ok ? stored.certification.git.head : null, currentHead: certification.git.head, changedSince: drift };
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`seal ${result.seal}${result.problems.length ? `: ${result.problems.join(", ")}` : ""}`);
      if (stored.ok) console.log(drift.length ? `changed since it was recorded: ${drift.join(", ")}` : "nothing it records has changed");
    }
    if (!stored.ok || drift.length) process.exitCode = 1;
    return;
  }

  if (outFile) {
    const target = path.resolve(repoRoot, outFile);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // A new file only: an existing record is evidence and is never replaced in place.
    fs.writeFileSync(target, `${JSON.stringify(certification, null, 2)}\n`, { flag: "wx" });
  }

  if (json) { console.log(JSON.stringify(certification, null, 2)); return; }
  const { evaluation, baseline } = certification;
  const status = new Map(evaluation.requirements.map((requirement) => [`${requirement.kind}:${requirement.id}`, requirement]));
  const lines = [
    `result       ${evaluation.result}`,
    `git          ${certification.git.head} ${certification.git.treeState}${certification.git.dirtyPaths ? ` (${certification.git.dirtyPaths} paths)` : ""}`,
    `eval         ${certification.evalManifest.version}, ${certification.evalManifest.suites} suites`,
    `baseline     ${baseline.state === "PRESENT" ? `${baseline.outcome} at ${baseline.sourceHead}, ${baseline.suites} suites x ${baseline.trials} trial(s), ${baseline.failed} failed, ${baseline.complete ? "complete" : "incomplete"}` : "ABSENT"}`,
    `requirements ${evaluation.counts.proven} proven, ${evaluation.counts.notMeasured} not measured, ${evaluation.counts.unproven} unproven; ${evaluation.counts.proofs} proofs`,
    ...certification.requirements.map((requirement) => {
      const judged = status.get(`${requirement.kind}:${requirement.id}`);
      return `  ${requirement.kind.padEnd(9)} ${requirement.id.padEnd(30)} ${judged?.status ?? "UNKNOWN"}${judged && judged.status === "UNPROVEN" ? `  ${judged.problems.join(", ")}` : ""}`;
    }),
    `local coding ${certification.localCodingBackends.length ? certification.localCodingBackends.map((backend) => `${backend.id} ${backend.state}/${backend.admission} ${backend.mayServeAutonomousCoding ? "may serve autonomous coding" : "may not serve autonomous coding"}`).join("; ") : "no coding model registered"}`,
    `gaps         ${evaluation.gaps.length ? evaluation.gaps.join(", ") : "none"}`,
    `authority    ${certification.authority}`,
    `record       sha256 ${certification.certificationDigest}`,
    ...(outFile ? [`written      ${outFile}`] : []),
  ];
  console.log(lines.join("\n"));
}

try { main(); } catch (error: unknown) { console.error(JSON.stringify({ status: "FAILED", message: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; }
