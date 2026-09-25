/**
 * Stage 14 — read-only technology-watch assessment for an explicit JSON file.
 *
 *   npx tsx scripts/ayas-technology-watch.ts --input <watch.json> [--json]
 *
 * The file holds `{ environment, register?, observations?, findings? }`:
 * - `environment`: the operator's stated FACTS (`now`, `domainCoverage`,
 *   `installedPackages`, `hostBinaries`, `externalAccounts`, and the Stage 7
 *   availability lists `availableModelIds`/`availableSkillIds`/`availableAgentIds`).
 *   Anything absent stays UNKNOWN.
 * - `register`: a serialized register (integrity-checked).
 * - `observations`: operator-entered technology observations.
 * - `findings`: Stage 8 research findings to extract.
 * A present but malformed entry or an unknown field is refused (exit 2),
 * never dropped. The CLI reads that one file and prints assessments, the
 * Stage 13 hand-off inputs it WOULD build, and the updated register. It
 * writes nothing, fetches nothing, submits nothing to Stage 13, installs
 * nothing and dispatches no agent.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { inventoryAyasCapabilities } from "../src/lib/ayas/routing/AyasAgenticRouting";
import {
  AyasTechnologyError, createAyasTechnologyRegister, ingestAyasTechnologyObservation, isAyasTechnologyPlainObject, normalizeAyasTechnologyObservation,
  parseAyasTechnologyRegister, serializeAyasTechnologyRegister, type AyasTechnologyRegister,
} from "../src/lib/ayas/technology/AyasTechnologyCandidate";
import { runAyasTechnologyWatchCycle } from "../src/lib/ayas/technology/AyasTechnologyIntegration";
import type { AyasTechnologyWatchEnvironment } from "../src/lib/ayas/technology/AyasTechnologyWatch";

const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const INPUT_FIELDS: readonly string[] = ["environment", "register", "observations", "findings"];
const ID_LISTS = ["availableModelIds", "availableSkillIds", "availableAgentIds"] as const;
const ENVIRONMENT_FIELDS: readonly string[] = ["now", "domainCoverage", "installedPackages", "hostBinaries", "externalAccounts", ...ID_LISTS];

function fail(message: string): never {
  console.error(`ayas-technology-watch: ${message}`);
  process.exit(2);
}

function idList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50 || !value.every((item) => typeof item === "string")) fail(`environment.${field} must be a list of at most 50 strings`);
  return value as string[];
}

const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");
const input = inputIndex >= 0 ? args[inputIndex + 1] : undefined;
if (!input || !input.endsWith(".json")) fail("--input <file.json> is required");
const file = path.resolve(input);
const size = statSync(file, { throwIfNoEntry: false })?.size;
if (size === undefined) fail("input file not found");
if (size > MAX_INPUT_BYTES) fail("input file is larger than 4 MiB");

let raw: unknown;
try { raw = JSON.parse(readFileSync(file, "utf8")); } catch { fail("input is not valid JSON"); }
if (!isAyasTechnologyPlainObject(raw)) fail("input must be a JSON object");
const payload = raw;
// A misspelled field would otherwise vanish: it is refused.
if (Object.keys(payload).some((field) => !INPUT_FIELDS.includes(field))) fail("input holds an unknown field");
const e = payload.environment === undefined ? {} : isAyasTechnologyPlainObject(payload.environment) ? payload.environment : fail("environment must be an object");
if (Object.keys(e).some((field) => !ENVIRONMENT_FIELDS.includes(field))) fail("environment holds an unknown field");
const env = {
  now: e.now === undefined ? new Date().toISOString() : e.now,
  // Stage 7 inventory; availability is only what the operator states — this CLI probes nothing.
  capabilities: inventoryAyasCapabilities({ availableModelIds: idList(e.availableModelIds, "availableModelIds"), availableSkillIds: idList(e.availableSkillIds, "availableSkillIds"), availableAgentIds: idList(e.availableAgentIds, "availableAgentIds") }),
  domainCoverage: e.domainCoverage, installedPackages: e.installedPackages, hostBinaries: e.hostBinaries, externalAccounts: e.externalAccounts,
} as unknown as AyasTechnologyWatchEnvironment;

const run = <T>(step: () => T): T => {
  try { return step(); } catch (error) {
    if (error instanceof AyasTechnologyError) fail(`${error.code}: ${error.message}`);
    throw error;
  }
};

let register: AyasTechnologyRegister = payload.register === undefined ? createAyasTechnologyRegister() : run(() => parseAyasTechnologyRegister(payload.register));
if (payload.observations !== undefined) {
  if (!Array.isArray(payload.observations) || payload.observations.length > 500) fail("observations must be a list of at most 500 entries");
  for (const observation of payload.observations as unknown[]) {
    register = run(() => ingestAyasTechnologyObservation(register, normalizeAyasTechnologyObservation(observation, "OPERATOR_ENTRY")).register);
  }
}
if (payload.findings !== undefined && (!Array.isArray(payload.findings) || payload.findings.length > 200)) fail("findings must be a list of at most 200 entries");
const findings = (payload.findings ?? []) as unknown[];
const cycle = run(() => runAyasTechnologyWatchCycle({ register, findings, env, limit: findings.length }));

if (args.includes("--json")) {
  console.log(JSON.stringify({
    executionAuthority: "NONE",
    assessments: cycle.assessments,
    handoffs: cycle.handoffs.map((handoff) => ({ technologyKey: handoff.technologyKey, opportunityId: handoff.opportunity.opportunityId, input: handoff.input, inputDigest: handoff.inputDigest })),
    refusedFindings: cycle.refused,
    register: serializeAyasTechnologyRegister(cycle.register),
  }, null, 2));
} else {
  console.log(`TECHNOLOGY WATCH — ${cycle.assessments.length} technolog${cycle.assessments.length === 1 ? "y" : "ies"}; execution authority: NONE`);
  for (const a of cycle.assessments) {
    console.log(`\n${a.technologyKey}  ${a.identity.displayName} [${a.identity.category}]  ${a.recommendation}  (${a.primaryReason})`);
    console.log(`  freshness: ${a.freshness.state}; relation: ${a.capability.relation}; cost: ${a.cost.costClass}; licence: ${a.licensing.licenseClass}; provenance: ${a.security.provenance}`);
    for (const blocker of a.blockers.slice(0, 10)) console.log(`  - ${blocker.level}: ${blocker.code}${blocker.reference ? ` [${blocker.reference}]` : ""}`);
  }
  for (const handoff of cycle.handoffs) console.log(`\nStage 13 hand-off input (not submitted): ${handoff.technologyKey} -> ${handoff.opportunity.opportunityId}`);
  for (const refusal of cycle.refused) console.log(`\nrefused finding #${refusal.index}: ${refusal.reasonCode}`);
}
