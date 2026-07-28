import assert from "node:assert/strict";
import { CanonicalEvidenceError } from "./lib/CanonicalSmokeEvidence";
import { aggregateEvidence, defaultEvidenceRoot, runEvidenceMatrix } from "./lib/CanonicalSmokeEvidenceV2";

function argument(name: string): string | undefined {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
}

try {
  const command = process.argv[2];
  const matrixRunId = argument("matrix-run-id");
  const evidenceRootArgument = argument("evidence-root");
  if (command === "aggregate") {
    assert(matrixRunId, "--matrix-run-id is required.");
    const result = aggregateEvidence(evidenceRootArgument ?? defaultEvidenceRoot(matrixRunId));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (command === "run" || command === "resume") {
    assert(matrixRunId, "--matrix-run-id is required.");
    const result = runEvidenceMatrix({ matrixRunId,
      evidenceRoot: evidenceRootArgument ?? defaultEvidenceRoot(matrixRunId),
      resume: command === "resume", stopAfterPartition: argument("stop-after-partition") });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else throw new TypeError("Expected command: run | resume | aggregate");
} catch (error) {
  if (error instanceof CanonicalEvidenceError) {
    process.stderr.write(`CANONICAL_EVIDENCE_ERROR ${JSON.stringify({ code: error.code, message: error.message })}\n`);
    process.exitCode = 1;
  } else throw error;
}
