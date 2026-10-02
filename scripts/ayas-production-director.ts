/**
 * Stage 15I — the production director session, for the operator.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/ayas-production-director.ts --project <slug> [options]
 *
 *   --owner-request <file.json>   what the owner asked for: { requestId, topic, format?, targetDurationSeconds?,
 *                                 approvedProjectCapUsd? }. Without it the session says no request is bound and
 *                                 plans nothing.
 *   --json                        machine-readable output.
 *
 * Read-only. It reads one project's record through the pipeline's own readers and prints what is bound, what each
 * stage is doing and what may happen next. It starts no stage, calls no provider and writes nothing. A safe operation
 * it prints is a plan: the line names the existing path that would run it, and that path is not open to AYAS today.
 *
 * Without ATOLYE_RUNTIME_ROOT (tsx does not load .env.local by itself) it reads the repository's legacy data/projects
 * copy; the output names the storage it read.
 */
import fs from "node:fs";
import path from "node:path";

import { collectAyasProductionDirectorSession, parseAyasDirectorOwnerRequest } from "../src/lib/ayas/director/AyasProductionDirectorCollector";
import { resolveRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";

const VALUE_FLAGS = new Set(["--project", "--owner-request"]);
const SWITCHES = new Set(["--json"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (VALUE_FLAGS.has(arg) && args[i + 1] !== undefined && !args[i + 1]!.startsWith("--") && !values.has(arg)) values.set(arg, args[++i]!);
    else if (SWITCHES.has(arg)) switches.add(arg);
    else throw new Error("AYAS_DIRECTOR_ARGUMENTS_INVALID");
  }
  const projectSlug = values.get("--project");
  if (!projectSlug) throw new Error("AYAS_DIRECTOR_ARGUMENTS_INVALID");
  const repoRoot = process.cwd();
  const requestFile = values.get("--owner-request");
  let ownerRequest = null;
  if (requestFile) {
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(path.resolve(repoRoot, requestFile), "utf8")); } catch { throw new Error("AYAS_DIRECTOR_OWNER_REQUEST_INVALID"); }
    ownerRequest = parseAyasDirectorOwnerRequest(raw);
  }

  const storage = resolveRuntimeStorageContext({});
  const { session, readRetries } = await collectAyasProductionDirectorSession({ projectSlug, now: new Date(), repoRoot, ownerRequest, storage });
  if (switches.has("--json")) { console.log(JSON.stringify({ storage: storage.classification, readRetries, session }, null, 2)); return; }

  const facts = (record: Readonly<Record<string, unknown>>) => Object.entries(record).filter(([, value]) => value !== null && value !== "").map(([key, value]) => `${key}=${String(value)}`).join(" ");
  const lines = [
    `session      ${session.sessionId}  project ${session.projectSlug}  storage ${storage.classification}`,
    `stage        ${session.currentStage}`,
    `bindings     ${session.boundCount} of ${session.bindings.length} bound`,
    ...session.bindings.map((binding) => `  ${binding.id.padEnd(22)} ${binding.state.padEnd(16)} ${facts(binding.facts)}`.trimEnd()),
    "stages",
    ...session.watch.map((entry) => `  ${entry.stage.padEnd(10)} ${entry.status.padEnd(10)} file ${entry.artifact.padEnd(9)}${entry.fault ? ` ${entry.fault.faultClass}${entry.fault.code ? ` (${entry.fault.code})` : ""}` : ""}`.trimEnd()),
    `holds        ${session.holds.length ? session.holds.join(", ") : "none"}`,
    "decisions",
    ...session.decisions.map((decision) => {
      const what = decision.kind === "SAFE_OPERATION" ? `${decision.safeOperation} -> ${decision.dispatch!.action} [${decision.dispatch!.state}; not executable by AYAS]`
        : decision.kind === "REQUIRE_OWNER" ? `${decision.ownerQuestion}${decision.ownerFacts ? ` ${facts(decision.ownerFacts)}` : ""}`
        : decision.kind === "ROUTE_CODE_DEFECT" ? `${decision.route!.target}; holds after ${decision.route!.holdAfterStage ?? "the start"}` : "";
      return `  ${(decision.stage ?? "-").padEnd(10)} ${decision.kind.padEnd(17)} ${what}\n             ${decision.reason}`;
    }),
    `authority    ${session.authority}`,
    `read retries ${readRetries}`,
    `digest       ${session.sessionDigest}`,
  ];
  console.log(lines.join("\n"));
}

main().catch((error: unknown) => { console.error(JSON.stringify({ status: "FAILED", message: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });
