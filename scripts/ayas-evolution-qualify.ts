/**
 * Stage 13 — read-only evolution qualification for an explicit JSON file.
 *
 *   npx tsx scripts/ayas-evolution-qualify.ts --input <register.json> [--json]
 *
 * The file holds `{ schemaVersion: "1", opportunities: [...], environment?: {...} }`.
 * Environment entries are the operator's stated FACTS; anything absent stays
 * UNKNOWN. The CLI reads that one file and prints qualification, the
 * PROPOSAL_READY design-review candidates and Stage 10 hand-off arguments.
 * It writes nothing, probes nothing, calls no model or network, creates no
 * proposal and dispatches no agent.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { inventoryAyasCapabilities } from "../src/lib/ayas/routing/AyasAgenticRouting";
import { parseAyasEvolutionRegister } from "../src/lib/ayas/evolution/AyasEvolutionOpportunity";
import { qualifyAyasEvolutionRegister, type AyasEvolutionEnvironment } from "../src/lib/ayas/evolution/AyasEvolutionQualification";
import { buildAyasEvolutionDeveloperHandoff, buildAyasEvolutionProposalCandidate } from "../src/lib/ayas/evolution/AyasEvolutionIntegration";

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const FACT_MAPS = ["capabilityKeys", "hostBinaries", "dataSets", "providerCapabilities", "externalServices", "externalAccounts"] as const;

function fail(message: string): never {
  console.error(`ayas-evolution-qualify: ${message}`);
  process.exit(2);
}

function factMap(value: unknown, allowed: readonly string[]): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = Object.create(null);
  for (const [key, fact] of Object.entries(value as Record<string, unknown>).slice(0, 500)) {
    if (/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/.test(key) && typeof fact === "string" && allowed.includes(fact)) out[key] = fact;
  }
  return out;
}

const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");
const input = inputIndex >= 0 ? args[inputIndex + 1] : undefined;
if (!input || !input.endsWith(".json")) fail("--input <file.json> is required");
const file = path.resolve(input);
const size = statSync(file, { throwIfNoEntry: false })?.size;
if (size === undefined) fail("input file not found");
if (size > MAX_INPUT_BYTES) fail("input file is larger than 2 MiB");

let raw: Record<string, unknown>;
try { raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>; } catch { fail("input is not valid JSON"); }
const register = (() => { try { return parseAyasEvolutionRegister(raw); } catch (error) { fail((error as Error).message); } })();
const e = (raw.environment ?? {}) as Record<string, unknown>;
const stringList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 50) : [];
const env: AyasEvolutionEnvironment = {
  now: typeof e.now === "string" && Number.isFinite(Date.parse(e.now)) ? e.now : new Date().toISOString(),
  currentHead: typeof e.currentHead === "string" && /^[0-9a-f]{40}$/.test(e.currentHead) ? e.currentHead : null,
  // Stage 7 inventory; model/skill/agent availability is only what the operator states — this CLI probes nothing.
  capabilities: inventoryAyasCapabilities({ availableModelIds: stringList(e.availableModelIds), availableSkillIds: stringList(e.availableSkillIds), availableAgentIds: stringList(e.availableAgentIds) }),
  ...Object.fromEntries(FACT_MAPS.map((name) => [name, factMap(e[name], name === "capabilityKeys" ? ["AVAILABLE", "UNAVAILABLE", "RETIRED"] : ["AVAILABLE", "UNAVAILABLE", "UNKNOWN"])])),
  operatingMode: e.operatingMode === "OFFLINE" || e.operatingMode === "ONLINE" ? e.operatingMode : "UNKNOWN",
};

const qualifications = qualifyAyasEvolutionRegister(register, env);
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
