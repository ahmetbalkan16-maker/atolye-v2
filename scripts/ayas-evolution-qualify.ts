/**
 * Stage 13 — read-only evolution qualification for an explicit JSON file.
 *
 *   npx tsx scripts/ayas-evolution-qualify.ts --input <register.json> [--json]
 *
 * The file holds `{ schemaVersion: "1", opportunities: [...], environment?: {...} }`.
 * Environment entries are the operator's stated FACTS; anything absent stays
 * UNKNOWN. A present but malformed entry — an unknown field, a fact map that is
 * not an object, a fact outside its vocabulary, an over-long list — is refused
 * (exit 2), never dropped: a dropped RETIRED or OFFLINE fact is a lifted
 * restriction. The CLI reads that one file and prints qualification, the
 * PROPOSAL_READY design-review candidates and Stage 10 hand-off arguments.
 * It writes nothing, probes nothing, calls no model or network, creates no
 * proposal and dispatches no agent.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { inventoryAyasCapabilities } from "../src/lib/ayas/routing/AyasAgenticRouting";
import { isAyasEvolutionPlainObject, parseAyasEvolutionRegister } from "../src/lib/ayas/evolution/AyasEvolutionOpportunity";
import { qualifyAyasEvolutionRegister, type AyasEvolutionEnvironment } from "../src/lib/ayas/evolution/AyasEvolutionQualification";
import { buildAyasEvolutionDeveloperHandoff, buildAyasEvolutionProposalCandidate } from "../src/lib/ayas/evolution/AyasEvolutionIntegration";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const FACT_MAPS = ["capabilityKeys", "hostBinaries", "dataSets", "providerCapabilities", "externalServices", "externalAccounts"] as const;
const ID_LISTS = ["availableModelIds", "availableSkillIds", "availableAgentIds"] as const;
const INPUT_FIELDS: readonly string[] = ["schemaVersion", "opportunities", "environment"];
const ENVIRONMENT_FIELDS: readonly string[] = ["now", "currentHead", "operatingMode", ...ID_LISTS, ...FACT_MAPS];

function fail(message: string): never {
  console.error(`ayas-evolution-qualify: ${message}`);
  process.exit(2);
}

function factMap(value: unknown, field: string, allowed: readonly string[]): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isAyasEvolutionPlainObject(value)) fail(`environment.${field} must be an object map`);
  const entries = Object.entries(value);
  if (entries.length > 500) fail(`environment.${field} holds more than 500 facts; facts are never truncated`);
  const out: Record<string, string> = Object.create(null);
  for (const [key, fact] of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/.test(key) || typeof fact !== "string" || !allowed.includes(fact)) fail(`environment.${field} holds a malformed fact`);
    out[key] = fact;
  }
  return out;
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
if (size > MAX_INPUT_BYTES) fail("input file is larger than 2 MiB");

let raw: unknown;
try { raw = JSON.parse(readFileSync(file, "utf8")); } catch { fail("input is not valid JSON"); }
if (!isAyasEvolutionPlainObject(raw)) fail("input must be a JSON object");
const payload = raw;
// A misspelled top-level or environment field would otherwise vanish; it is refused.
if (Object.keys(payload).some((field) => !INPUT_FIELDS.includes(field))) fail("input holds an unknown field");
const register = (() => { try { return parseAyasEvolutionRegister({ schemaVersion: payload.schemaVersion, opportunities: payload.opportunities }); } catch (error) { fail((error as Error).message); } })();
const e = payload.environment === undefined ? {} : isAyasEvolutionPlainObject(payload.environment) ? payload.environment : fail("environment must be an object");
if (Object.keys(e).some((field) => !ENVIRONMENT_FIELDS.includes(field))) fail("environment holds an unknown field");
const env: AyasEvolutionEnvironment = {
  now: e.now === undefined ? new Date().toISOString() : typeof e.now === "string" && Number.isFinite(Date.parse(e.now)) ? e.now : fail("environment.now is not a timestamp"),
  currentHead: e.currentHead === undefined || e.currentHead === null ? null : typeof e.currentHead === "string" && /^[0-9a-f]{40}$/.test(e.currentHead) ? e.currentHead : fail("environment.currentHead is not a full commit hash"),
  // Stage 7 inventory; model/skill/agent availability is only what the operator states — this CLI probes nothing.
  capabilities: inventoryAyasCapabilities({ availableModelIds: idList(e.availableModelIds, "availableModelIds"), availableSkillIds: idList(e.availableSkillIds, "availableSkillIds"), availableAgentIds: idList(e.availableAgentIds, "availableAgentIds") }),
  ...Object.fromEntries(FACT_MAPS.map((name) => [name, factMap(e[name], name, name === "capabilityKeys" ? ["AVAILABLE", "UNAVAILABLE", "RETIRED"] : ["AVAILABLE", "UNAVAILABLE", "UNKNOWN"])])),
  operatingMode: e.operatingMode === undefined ? "UNKNOWN" : e.operatingMode === "OFFLINE" || e.operatingMode === "ONLINE" || e.operatingMode === "UNKNOWN" ? e.operatingMode : fail("environment.operatingMode is not OFFLINE, ONLINE or UNKNOWN"),
};

const qualifications = (() => { try { return qualifyAyasEvolutionRegister(register, env); } catch (error) { fail((error as Error).message); } })();
const rows = qualifications.map((q) => {
  const opportunity = register.opportunities.find((item) => item.opportunityId === q.opportunityId)!;
  return {
    q,
    proposalCandidate: buildAyasEvolutionProposalCandidate(opportunity, q),
    handoff: buildAyasEvolutionDeveloperHandoff(opportunity, q, env.currentHead),
  };
});

if (args.includes("--json")) {
  console.log(JSON.stringify({ executionAuthority: "NONE", opportunities: rows }, null, 2));
} else {
  console.log(`EVOLUTION QUALIFICATION — ${rows.length} opportunit${rows.length === 1 ? "y" : "ies"}; execution authority: NONE`);
  for (const { q, proposalCandidate, handoff } of rows) {
    console.log(`\n${q.opportunityId}  ${q.readiness}  (${q.primaryReason})`);
    for (const blocker of q.blockers.slice(0, 12)) console.log(`  - ${blocker.level}: ${blocker.code}${blocker.reference ? ` [${blocker.reference}]` : ""}`);
    console.log(`  cost: ${q.cost.aggregate}; required authority (not granted): ${q.authority.required.join(", ")}`);
    if (proposalCandidate) console.log(`  design-review candidate: ${proposalCandidate.mutationKind} (unregistered; cannot execute)`);
    if (handoff) console.log(`  stage 10 handoff (${handoff.style}): npx tsx scripts/ayas-developer-handoff.ts ${handoff.handoffCliArgs.map((arg) => JSON.stringify(arg)).join(" ")}`);
  }
}
