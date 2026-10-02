/**
 * Stage 15D closure audit — "all tools/MCPs/adapters pass one runtime guard".
 *
 * Mostly static: it reads source files and builds the import graph of src/,
 * app/ and scripts/. It then checks three things.
 *
 *  1. The decision vocabulary is closed and complete: every allowlisted tool
 *     classifies and has an executor, every reserved or owner action needs
 *     the owner, everything else is denied.
 *  2. Every dispatch seam admits through the common firewall before it runs
 *     an adapter (source-order invariants; behaviour is in the per-seam smokes).
 *  3. THE ADAPTER MAP. For each AYAS surface below, the set of modules it can
 *     reach that spawn a process or call the network is pinned, and each one
 *     carries the reason it is allowed there. A new effectful module on a
 *     surface fails this suite until it is classified here.
 *
 * One behavioural check runs the product-brain composition in a child
 * process whose working directory and runtime root are TEMP directories.
 * No model, no network, no production storage.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { createAyasActionFirewall } from "../src/lib/ayas/execution/AyasActionFirewall";
import { AYAS_DISCOVERY_RUN_ACTION, AYAS_DISCOVERY_RUN_CAPABILITIES } from "../src/lib/ayas/execution/AyasCapabilityScope";
import { AyasExecutionAuthorizationStore } from "../src/lib/ayas/execution/AyasExecutionAuthorization";
import { AYAS_EXECUTION_ALLOWLIST, AYAS_EXECUTION_RESERVED_ACTIONS, type AyasExecutionActionId } from "../src/lib/ayas/execution/AyasExecutionPolicy";
import { resolveAyasExecutor } from "../src/lib/ayas/execution/AyasSafeExecutors";
import { routeAyasModel } from "../src/lib/ayas/model/AyasModelRouter";
import type { AyasModelProvider } from "../src/lib/ayas/model/AyasModelTypes";
import { AYAS_TOOL_REGISTRY } from "../src/lib/ayas/reasoning/AyasToolRegistry";

const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-firewall-closure-"));
let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) { await test(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

/* ------------------------------------------------------------ import graph --- */
const rel = (file: string): string => path.relative(repo, file).split(path.sep).join("/");
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function walk(dir: string, out: string[] = []): string[] {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === "node_modules" || item.name.startsWith(".")) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, out);
    else if (/\.(?:ts|tsx)$/.test(item.name) && !item.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}
const files = ["src", "app", "scripts"].flatMap((dir) => walk(path.join(repo, dir)));
const sources = new Map(files.map((file) => [file, fs.readFileSync(file, "utf8")]));
const read = (relative: string): string => { const text = sources.get(path.join(repo, relative)); assert.ok(text !== undefined, `${relative} is missing`); return text; };
const code = (relative: string): string => stripComments(read(relative));
const IMPORT = /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+from\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g;
function resolveImport(from: string, spec: string): string | undefined {
  const base = spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : spec.startsWith("@/") ? path.join(repo, "src", spec.slice(2)) : undefined;
  if (!base) return undefined;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) if (sources.has(candidate)) return candidate;
  return undefined;
}
const imports = new Map<string, Set<string>>();
for (const [file, source] of sources) {
  const targets = new Set<string>();
  for (const match of source.matchAll(IMPORT)) {
    if (/^import\s+type\s/.test(match[0])) continue; // a type-only import carries no runtime reach
    const target = resolveImport(file, match[1] ?? match[2] ?? match[3] ?? "");
    if (target) targets.add(target);
  }
  imports.set(file, targets);
}
function closure(entry: string): Set<string> {
  const seen = new Set<string>(); const queue = [path.join(repo, entry)];
  assert.ok(sources.has(queue[0]!), `${entry} is missing`);
  while (queue.length) { const file = queue.pop()!; if (seen.has(file)) continue; seen.add(file); for (const next of imports.get(file) ?? []) queue.push(next); }
  return seen;
}
const SPAWNS = /from\s+["'](?:node:)?child_process["']|require\(["'](?:node:)?child_process["']\)/;
/** A real call site or a transport import; a name in a comment, a type or a deny-list is not network use. */
const NETWORK = /\bfetcher\s*\(|(?<![.\w])fetch\s*\(|from\s+["'](?:node:)?https?["']|new\s+WebSocket\b/;
const isProduct = (file: string): boolean => !rel(file).startsWith("scripts/");
const effectful = new Set(files.filter((file) => isProduct(file) && (SPAWNS.test(sources.get(file)!) || NETWORK.test(stripComments(sources.get(file)!)))));
const reachEffects = (entry: string): string[] => [...closure(entry)].filter((file) => effectful.has(file)).map(rel).sort();

/* ------------------------------------------------------------- adapter map --- */
/** Why an effectful module may be reachable from a surface. */
type Guard =
  | "TOOL_LEASE"            // runs only as a tool executor, after the common firewall admits an exact-scope lease
  | "OWNER_LEASE"           // mutation or validation work behind an admitted owner lease (existing approval/reservation)
  | "OWNER_PUBLICATION"     // commit/push bound to the owner's exact approval by the existing guarded publication
  | "DISCOVERY_LEASE"       // sandbox or public-read work the leased discovery run performs
  | "DURABLE_LEASE"         // the one approved durable activity, admitted per attempt
  | "OWNER_REQUEST"         // a bounded process run for an authenticated owner request
  | "READ_ONLY_PROBE"       // fixed command or probe, read-only, no request-selected target
  | "LOCAL_MODEL"           // loopback inference, zero cost
  | "CLOUD_MODEL_DENIED"   // constructed but never selected: the router returns no provider instead
  | "IMPORT_ONLY";         // in the import closure through a shared registry; this owner-session surface starts no such work

const PROBES: Readonly<Record<string, Guard>> = {
  "src/lib/ayas/machine/AyasMachineTelemetry.ts": "READ_ONLY_PROBE",
  "src/lib/brain/autonomy/AyasProcessLiveness.ts": "READ_ONLY_PROBE",
  "src/lib/pipeline/PipelineJobMutationLock.ts": "READ_ONLY_PROBE",
};
/** Owner-approved self-development: the daemon admits the owner lease before the mutation callback runs. */
const SELF_DEVELOPMENT: Readonly<Record<string, Guard>> = {
  "src/lib/brain/autonomy/AyasAutonomyDaemon.ts": "OWNER_LEASE",
  "src/lib/brain/autonomy/AyasBatchGraphifyCheck.ts": "OWNER_LEASE",
  "src/lib/brain/autonomy/AyasExactProposalSafety.ts": "READ_ONLY_PROBE",
  "src/lib/brain/autonomy/AyasExecutionRevalidation.ts": "READ_ONLY_PROBE",
  "src/lib/brain/autonomy/AyasMutationScope.ts": "READ_ONLY_PROBE",
  "src/lib/brain/autonomy/AyasMutationValidators.ts": "OWNER_LEASE",
  "src/lib/brain/autonomy/AyasPatchSandbox.ts": "OWNER_LEASE",
};
const PUBLICATION: Readonly<Record<string, Guard>> = {
  "src/lib/brain/autonomy/AyasDeferredPublicationFinalizer.ts": "OWNER_PUBLICATION",
  "src/lib/brain/autonomy/AyasGuardedPublication.ts": "OWNER_PUBLICATION",
  "src/lib/brain/autonomy/AyasPatchArtifactMutation.ts": "OWNER_LEASE",
  "src/lib/brain/autonomy/AyasPostPublicationClosure.ts": "OWNER_PUBLICATION",
  "src/lib/brain/autonomy/AyasProposalApprovalService.ts": "OWNER_PUBLICATION",
  "src/lib/brain/autonomy/AyasProposalExecutionService.ts": "OWNER_LEASE",
  "src/lib/brain/autonomy/AyasRuntimeStabilitySnapshot.ts": "READ_ONLY_PROBE",
};
const LOCAL_MODELS: Readonly<Record<string, Guard>> = {
  "src/lib/ai/providers/OllamaProvider.ts": "LOCAL_MODEL",
  "src/lib/ayas/model/OllamaAyasProvider.ts": "LOCAL_MODEL",
};

interface Surface { readonly what: string; readonly agent: boolean; readonly allowed: readonly Guard[]; readonly modules: Readonly<Record<string, Guard>>; }
const SURFACES: Readonly<Record<string, Surface>> = {
  "app/api/ayas/chat/stream/route.ts": {
    what: "model-driven chat turn (tools, guided repair, local model)", agent: true,
    allowed: ["TOOL_LEASE", "OWNER_LEASE", "READ_ONLY_PROBE", "LOCAL_MODEL", "CLOUD_MODEL_DENIED"],
    modules: {
      ...LOCAL_MODELS,
      "src/lib/ayas/machine/AyasMachineTelemetry.ts": "READ_ONLY_PROBE",
      "src/lib/pipeline/PipelineJobMutationLock.ts": "READ_ONLY_PROBE",
      "src/lib/ayas/developer/AyasGraphifyStateCollector.ts": "TOOL_LEASE",
      "src/lib/ayas/execution/AyasDeveloperEvidence.ts": "TOOL_LEASE",
      "src/lib/ayas/execution/AyasGuidedRepairProduction.ts": "OWNER_LEASE",
      "src/lib/ayas/model/CloudAyasProvider.ts": "CLOUD_MODEL_DENIED",
      "src/lib/brain/autonomy/AyasMutationScope.ts": "READ_ONLY_PROBE",
      "src/lib/brain/autonomy/AyasPublicationActivity.ts": "READ_ONLY_PROBE",
    },
  },
  "scripts/ayas-discovery-daemon.ts": {
    what: "the observer's autonomous discovery child, one lease per run", agent: true,
    allowed: ["DISCOVERY_LEASE", "READ_ONLY_PROBE", "LOCAL_MODEL"],
    modules: {
      "src/lib/ayas/machine/AyasMachineTelemetry.ts": "READ_ONLY_PROBE",
      "src/lib/brain/autonomy/AyasProcessLiveness.ts": "READ_ONLY_PROBE",
      "src/lib/ai/providers/OllamaProvider.ts": "LOCAL_MODEL",
      "src/lib/ayas/evolution/AyasControlledSelfEvolutionArtifact.ts": "DISCOVERY_LEASE",
      "src/lib/ayas/evolution/AyasControlledSelfEvolutionBridge.ts": "DISCOVERY_LEASE",
      "src/lib/ayas/evolution/AyasControlledSelfEvolutionCycle.ts": "DISCOVERY_LEASE",
      // Imported for discover() and sandbox validation only: the script can name no decide/reserve/execute call (asserted below).
      "src/lib/brain/autonomy/AyasAutonomyDaemon.ts": "DISCOVERY_LEASE",
      "src/lib/brain/autonomy/AyasBatchGraphifyCheck.ts": "DISCOVERY_LEASE",
      "src/lib/brain/autonomy/AyasExactProposalSafety.ts": "READ_ONLY_PROBE",
      "src/lib/brain/autonomy/AyasExecutionRevalidation.ts": "READ_ONLY_PROBE",
      "src/lib/brain/autonomy/AyasMicroBatchWorktree.ts": "DISCOVERY_LEASE",
      "src/lib/brain/autonomy/AyasMutationScope.ts": "READ_ONLY_PROBE",
      "src/lib/brain/autonomy/AyasMutationValidators.ts": "DISCOVERY_LEASE",
      "src/lib/brain/autonomy/AyasPatchSandbox.ts": "DISCOVERY_LEASE",
      "src/lib/brain/autonomy/AyasRegisteredImprovementExperiment.ts": "DISCOVERY_LEASE",
      "src/lib/brain/autonomy/AyasResearchExperimentSandbox.ts": "DISCOVERY_LEASE",
      "src/lib/brain/autonomy/AyasResearchImprovementCycle.ts": "DISCOVERY_LEASE",
      "src/lib/brain/autonomy/AyasSafePublicFetch.ts": "DISCOVERY_LEASE",
    },
  },
  "scripts/ayas-durable-task-recovery.ts": {
    what: "the durable task sweep (one approved read-only activity)", agent: true,
    allowed: ["DURABLE_LEASE", "READ_ONLY_PROBE"],
    modules: { "src/lib/ayas/developer/AyasGraphifyStateCollector.ts": "DURABLE_LEASE", "src/lib/brain/autonomy/AyasProcessLiveness.ts": "READ_ONLY_PROBE" },
  },
  "scripts/ayas-autonomy-daemon.ts": {
    what: "the always-on observer; it only observes and spawns the two children above", agent: true,
    allowed: ["READ_ONLY_PROBE"],
    modules: { "src/lib/ayas/machine/AyasMachineTelemetry.ts": "READ_ONLY_PROBE", "src/lib/brain/autonomy/AyasProcessLiveness.ts": "READ_ONLY_PROBE" },
  },
  "scripts/ayas-owner-approval-resume.ts": {
    what: "resume worker for an execution the owner already approved", agent: true,
    allowed: ["OWNER_LEASE", "OWNER_PUBLICATION", "READ_ONLY_PROBE"],
    modules: { "src/lib/ayas/machine/AyasMachineTelemetry.ts": "READ_ONLY_PROBE", "src/lib/brain/autonomy/AyasProcessLiveness.ts": "READ_ONLY_PROBE", ...SELF_DEVELOPMENT, ...PUBLICATION },
  },
  "app/api/ayas/stt/route.ts": {
    what: "speech to text for an authenticated owner request", agent: false,
    allowed: ["OWNER_REQUEST", "READ_ONLY_PROBE"],
    modules: { "src/lib/ayas/stt/AyasSttService.ts": "OWNER_REQUEST", "src/lib/brain/probe/BrainResourceProbe.ts": "READ_ONLY_PROBE" },
  },
  "app/brain/actions.ts": {
    what: "owner-session server actions: chat, approvals, the owner's own execution and research clicks", agent: false,
    allowed: ["TOOL_LEASE", "OWNER_LEASE", "OWNER_PUBLICATION", "READ_ONLY_PROBE", "LOCAL_MODEL", "CLOUD_MODEL_DENIED", "IMPORT_ONLY"],
    modules: {
      ...PROBES, ...LOCAL_MODELS, ...SELF_DEVELOPMENT, ...PUBLICATION,
      "app/brain/actions.ts": "READ_ONLY_PROBE",
      "src/lib/ayas/developer/AyasGraphifyStateCollector.ts": "TOOL_LEASE",
      "src/lib/ayas/execution/AyasDeveloperEvidence.ts": "TOOL_LEASE",
      "src/lib/ayas/model/CloudAyasProvider.ts": "CLOUD_MODEL_DENIED",
      "src/lib/brain/autonomy/AyasMicroBatchApprovalService.ts": "OWNER_PUBLICATION",
      "src/lib/brain/autonomy/AyasMicroBatchExecutionService.ts": "OWNER_LEASE",
      "src/lib/brain/autonomy/AyasPublicationActivity.ts": "READ_ONLY_PROBE",
      // The owner schedules or cancels goal research here; the fetch itself runs in the leased discovery child.
      "src/lib/brain/autonomy/AyasSafePublicFetch.ts": "IMPORT_ONLY",
    },
  },
  "app/brain/observerActions.ts": {
    what: "owner-session read models for the development centre", agent: false,
    allowed: ["READ_ONLY_PROBE", "LOCAL_MODEL", "IMPORT_ONLY"],
    modules: {
      ...PROBES, ...LOCAL_MODELS,
      "src/lib/ayas/developer/AyasGraphifyStateCollector.ts": "READ_ONLY_PROBE",
      "src/lib/ayas/developer/AyasRepositoryStateCollector.ts": "READ_ONLY_PROBE",
      "src/lib/brain/autonomy/AyasBatchGraphifyCheck.ts": "IMPORT_ONLY",
      "src/lib/brain/autonomy/AyasDevelopmentCenterReconciliation.ts": "READ_ONLY_PROBE",
      "src/lib/brain/autonomy/AyasExactProposalSafety.ts": "READ_ONLY_PROBE",
      // Reached through the mutation registry the recommendations view reads; nothing here runs a sandbox or a validator.
      "src/lib/brain/autonomy/AyasMutationValidators.ts": "IMPORT_ONLY",
      "src/lib/brain/autonomy/AyasPatchSandbox.ts": "IMPORT_ONLY",
      "src/lib/brain/autonomy/AyasPublicationActivity.ts": "READ_ONLY_PROBE",
      "src/lib/brain/autonomy/AyasSelfImprovementHealthCollector.ts": "READ_ONLY_PROBE",
      "src/lib/brain/ui/AyasControlCenterCollector.ts": "READ_ONLY_PROBE",
    },
  },
};
/** Entry points other than the surfaces that reach leased or owner-only modules, and who runs each. */
const OTHER_ENTRIES: Readonly<Record<string, string>> = {
  "app/brain/page.tsx": "the Brain page; it imports the two owner-session action modules mapped above",
  "scripts/ayas-crash-injection-worker.ts": "crash-injection worker; spawned only by scripts/smoke-ayas-crash-injection.ts against TEMP roots",
  "scripts/ayas-developer-handoff.ts": "operator CLI; read-only Graphify and repository state",
  "scripts/ayas-graphify-status.ts": "operator CLI; read-only Graphify state",
  "scripts/ayas-propose.ts": "operator CLI (npm run ayas:propose); a person-triggered proposal producer",
  "scripts/ayas-release-provenance.ts": "operator CLI; read-only SBOM and release provenance (lockfile, Graphify state, pinned identities)",
  "scripts/lib/AyasRetrievalEvaluation.ts": "evaluation library; imported only by evaluation smokes",
  "scripts/live-ayas-action-runtime-reliability.ts": "operator-run live acceptance with the real local model; read tools only",
  "scripts/live-ayas-action-runtime.ts": "operator-run live acceptance with the real local model; read tools only",
  "scripts/live-ayas-brain-maturity.ts": "operator-run live acceptance with the real local model; read tools only",
  "scripts/live-ayas-tool-candidate-adversarial.ts": "operator-run live acceptance with the real local model; read tools only",
};
/** Operator scripts a person starts through package.json. */
const PACKAGE_SCRIPTS: readonly string[] = ["scripts/ayas-propose.ts"];
/** Effectful AYAS/Brain modules that none of the surfaces above reaches, with the one way each is run. */
const OFF_SURFACE: Readonly<Record<string, string>> = {
  "src/lib/ayas/provenance/AyasBuildStamp.ts": "read-only Git probe; operator CLIs scripts/ayas-release-provenance.ts and scripts/ayas-independence-certification.ts, and the npm postbuild stamp scripts/ayas-build-stamp.ts",
  "src/lib/brain/autonomy/AyasLocalCodingEngineProbe.ts": "no entry point; the Stage 15A probe is used by its smoke only",
  "src/lib/brain/autonomy/AyasLocalCodingWorkspace.ts": "operator CLI scripts/run-ayas-local-coding-container.ts",
  "src/lib/brain/probe/BrainRenderProbe.ts": "read-only probe; production health route and operator CLIs",
  "src/lib/brain/selfheal/BrainSelfHealSandbox.ts": "operator CLI scripts/selfheal.ts",
};

async function main() {
  await scenario("the decision vocabulary is closed: four decisions, no autonomous financial state", () => {
    const scope = code("src/lib/ayas/execution/AyasCapabilityScope.ts");
    assert.match(scope, /export type AyasActionFirewallDecision = "ALLOW_READ" \| "ALLOW_BOUNDED_LOCAL" \| "REQUIRE_OWNER" \| "DENY";/);
    for (const [file, source] of sources) if (isProduct(file)) assert.doesNotMatch(source, /ALLOW_AUTONOMOUS|ALLOW_FINANCIAL|ALLOW_WRITE|ALLOW_PRODUCTION/, rel(file));
    // The built-in scopes cost nothing: no scope type admits another cost class.
    assert.deepEqual([...scope.matchAll(/costClass: "([A-Z_]+)"/g)].map((match) => match[1]).filter((value, index, all) => all.indexOf(value) === index), ["ZERO_LOCAL"]);
  });

  await scenario("every tool classifies and has one executor; reserved and owner actions need the owner; the rest is denied", () => {
    const firewall = createAyasActionFirewall({ repoRoot: temp, authorizations: new AyasExecutionAuthorizationStore({ rootDir: path.join(temp, "audit") }) });
    const request = (action: string, extra: Record<string, unknown> = {}) => ({ schemaVersion: "1", action, requestedBy: "closure-audit", intent: "classification", plan: {}, ...extra });
    for (const [action, spec] of Object.entries(AYAS_EXECUTION_ALLOWLIST)) {
      assert.deepEqual([spec.write, spec.destructive], [false, false], action);
      assert.equal(firewall.classify(request(action, spec.requiresProject ? { projectSlug: "fixture-project" } : {})), action === "run-developer-validation" ? "ALLOW_BOUNDED_LOCAL" : "ALLOW_READ", action);
      assert.equal(typeof resolveAyasExecutor(action as AyasExecutionActionId), "function", action);
    }
    for (const action of [...AYAS_EXECUTION_RESERVED_ACTIONS, "self-development.apply-approved-proposal", "guided-repair.apply-approved-scope"]) {
      assert.equal(firewall.classify(request(action, { projectSlug: "fixture-project" })), "REQUIRE_OWNER", action);
      assert.equal(resolveAyasExecutor(action as AyasExecutionActionId), undefined, action);
      assert.equal(firewall.issue(request(action, { projectSlug: "fixture-project" })).allowed, false, action);
    }
    for (const action of ["transfer-funds", "pay-invoice", "publish-video", "mcp.call-tool", "shell", "web-research", "owner-policy-edit", ...AYAS_DISCOVERY_RUN_CAPABILITIES, "__proto__", "constructor", ""]) {
      assert.equal(firewall.classify(request(action)), "DENY", action);
      assert.equal(firewall.issue(request(action)).allowed, false, action);
    }
    assert.equal(firewall.issue(request(AYAS_DISCOVERY_RUN_ACTION)).allowed, false);
    assert.equal(fs.existsSync(path.join(temp, "audit", "execution", "authorizations")), false, "a refused request left a record");
    // The descriptive tool registry names nothing beyond the allowlist, the reserved actions and its closed placeholders.
    const known = new Set<string>([...Object.keys(AYAS_EXECUTION_ALLOWLIST), ...AYAS_EXECUTION_RESERVED_ACTIONS]);
    for (const tool of AYAS_TOOL_REGISTRY) {
      if (known.has(tool.id)) { assert.equal(tool.readOnly, Object.hasOwn(AYAS_EXECUTION_ALLOWLIST, tool.id), tool.id); continue; }
      assert.equal(resolveAyasExecutor(tool.id as AyasExecutionActionId), undefined, `${tool.id} is described and must have no executor`);
      assert.equal(firewall.classify(request(tool.id)), "DENY", tool.id);
    }
  });

  await scenario("tool executors are dispatched from two places only, each after the firewall admits", () => {
    const importers = (symbol: string): string[] => files.filter((file) => isProduct(file) && new RegExp(`import[^;]*\\b${symbol}\\b[^;]*from`).test(sources.get(file)!)).map(rel).sort();
    assert.deepEqual(importers("resolveAyasExecutor"), ["src/lib/ayas/execution/AyasActionRuntime.ts", "src/lib/ayas/execution/AyasExecutionBridge.ts"]);
    assert.deepEqual(importers("AYAS_DEVELOPER_EXECUTORS"), ["src/lib/ayas/execution/AyasSafeExecutors.ts"]);
    const runtime = code("src/lib/ayas/execution/AyasActionRuntime.ts");
    const admitAt = runtime.indexOf("context.firewall.admit(");
    assert.ok(admitAt > 0 && runtime.indexOf("executor(admittedRequest)") > admitAt && runtime.split("executor(").length - 1 === 1, "the runtime runs an executor outside its admission");
    assert.match(runtime, /admittedRequest = admission\.request;/);
    const bridge = code("src/lib/ayas/execution/AyasExecutionBridge.ts");
    assert.ok(bridge.includes(".admit(") && bridge.includes("REQUIRE_OWNER"), "the bridge lost its admission or its owner refusal");
  });

  await scenario("owner-approved work admits its lease before it mutates, validates or publishes", () => {
    const daemon = code("src/lib/brain/autonomy/AyasAutonomyDaemon.ts");
    const bindAt = daemon.indexOf("bindOwnerReservation("), admitAt = daemon.indexOf("admitOwnerReservation(");
    assert.ok(bindAt > 0 && admitAt > bindAt, "self-development lost its owner lease");
    const repair = code("src/lib/ayas/execution/AyasGuidedRepair.ts");
    const repairAdmit = repair.indexOf("firewall.admitOwnerReservation(");
    assert.ok(repairAdmit > 0);
    // A registered validator runs a process. It has one call site, after admission, and is not an export or a service method.
    assert.doesNotMatch(repair, /export\s+(?:async\s+)?function\s+runAyasRegisteredValidation/);
    assert.equal(repair.split("runAyasRegisteredValidation(").length - 1, 2, "the validator runner gained a call site");
    assert.ok(repair.lastIndexOf("runAyasRegisteredValidation(") > repairAdmit);
    assert.ok(repair.indexOf("fs.writeFileSync(item.abs, item.patch.content") > repairAdmit, "the patch write precedes admission");
    assert.doesNotMatch(repair, /\bvalidate:\s/);
    for (const file of files) if (isProduct(file) && rel(file) !== "src/lib/ayas/execution/AyasGuidedRepair.ts") assert.doesNotMatch(sources.get(file)!, /runAyasRegisteredValidation/, rel(file));
    // The production validators are constructed in one place and handed only to the repair session runtime.
    assert.deepEqual(files.filter((file) => isProduct(file) && /createAyasProductionRepairDeps\(/.test(stripComments(sources.get(file)!))).map(rel).sort(),
      ["app/api/ayas/chat/stream/route.ts", "src/lib/ayas/execution/AyasGuidedRepairProduction.ts"]);
  });

  await scenario("the durable activity and the discovery run admit before their work", () => {
    const activity = code("src/lib/brain/autonomy/AyasDurableTaskActivities.ts");
    assert.ok(activity.indexOf("firewall.admit(") > 0 && activity.indexOf("await collectFacts(") > activity.indexOf("firewall.admit("));
    assert.equal(activity.split("collectFacts(").length - 1, 1, "the collector gained a call site");
    const discovery = code("scripts/ayas-discovery-daemon.ts");
    assert.ok(discovery.indexOf("admitAyasDiscoveryRun(") > 0);
    assert.doesNotMatch(discovery, /\.decide\(|reserveApproval|finalizeApproval|executeApproved|executeAyasApprovedMicroBatchWith|AyasExecutionGateStore/);
    // Nothing else starts these two children: the observer, by child process only.
    const observer = code("scripts/ayas-autonomy-daemon.ts");
    for (const child of ["ayas-discovery-daemon.ts", "ayas-durable-task-recovery.ts"]) assert.equal(observer.split(child).length - 1, 1, child);
  });

  await scenario("product context reads the catalogue through the guarded tool; no MCP client exists", () => {
    const brain = code("src/lib/ayas/AyasProductBrain.ts");
    assert.doesNotMatch(brain, /AyasProjectCatalog|ProjectReader|ProjectManager|RuntimeStoragePaths/);
    assert.match(brain, /request\("list-production-projects", \{ mode: "summary" \}\)/);
    assert.equal(brain.split("runAyasReadOnlyAction(").length - 1, 1);
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) for (const name of Object.keys(pkg[group] ?? {})) assert.doesNotMatch(name, /modelcontextprotocol|(^|[-/])mcp([-/]|$)/i, name);
    for (const [file, source] of sources) if (isProduct(file)) assert.doesNotMatch(source, /(?:from|require\()\s*["']@modelcontextprotocol/, rel(file));
  });

  await scenario("the adapter map: every effectful module a surface reaches is classified, and nothing else is reachable", () => {
    const problems: string[] = [];
    for (const [entry, surface] of Object.entries(SURFACES)) {
      const actual = reachEffects(entry); const expected = Object.keys(surface.modules).sort();
      for (const file of actual) if (!expected.includes(file)) problems.push(`${entry} now reaches ${file}: classify it in SURFACES, with the guard that admits it`);
      for (const file of expected) if (!actual.includes(file)) problems.push(`${entry} no longer reaches ${file}: remove it from SURFACES`);
      for (const [file, guard] of Object.entries(surface.modules)) if (!surface.allowed.includes(guard)) problems.push(`${entry}: ${guard} is not an allowed guard for this surface (${file})`);
    }
    assert.deepEqual(problems, []);
    // Autonomous and model-driven surfaces never reach publication or an owner-request adapter, and nothing on them is
    // excused as import-only: each effect is a read-only probe, a local model or admitted by a lease.
    for (const [entry, surface] of Object.entries(SURFACES)) {
      if (!surface.agent || entry === "scripts/ayas-owner-approval-resume.ts") continue;
      for (const guard of Object.values(surface.modules)) assert.ok(guard !== "OWNER_PUBLICATION" && guard !== "OWNER_REQUEST" && guard !== "IMPORT_ONLY", `${entry} reaches ${guard}`);
    }
  });

  await scenario("no AYAS surface reaches a production provider, a paid model, the pipeline runner, a publisher or the dormant write bridge", () => {
    const production = new RegExp([
      "^src/lib/(?:assembly|assets|audio|video|thumbnail|animation|visuals|seo|export|youtube)/providers/",
      "^src/lib/youtube/publish/(?:YouTubePublishPipeline|YouTubePublishProviderRouter|providers/)",
      "^src/lib/ai/(?:client\\.ts|router/|providers/(?:OpenAI|Claude|Gemini|Grok|OpenRouter))",
      "^src/lib/pipeline/Pipeline(?:Runner|StageExecutor|QueueScheduler|FailedStageRetry)\\.ts$",
      "^src/lib/ayas/execution/Ayas(?:WriteExecutor|ExecutionBridge)\\.ts$",
    ].join("|"));
    for (const entry of Object.keys(SURFACES)) {
      assert.deepEqual([...closure(entry)].map(rel).filter((file) => production.test(file)), [], `${entry} reaches production code`);
    }
    // The chat surface imports the project manager for reads (studio context, recovery plan). It calls no write method.
    const callers = files.filter((file) => /^(?:src\/lib\/(?:ayas|brain)\/|app\/api\/ayas\/|app\/brain\/)/.test(rel(file)) || rel(file) === "src/lib/pipeline/PipelineRecoveryPlanner.ts");
    for (const file of callers) {
      const source = stripComments(sources.get(file)!);
      for (const match of source.matchAll(/ProjectManager\.([A-Za-z]+)\(/g)) assert.match(match[1]!, /^get[A-Z]/, `${rel(file)} calls ProjectManager.${match[1]}`);
      if (rel(file) !== "src/lib/pipeline/PipelineRecoveryPlanner.ts") assert.doesNotMatch(source, /from\s+["'][^"']*projects\/ProjectWriter["']|ProjectWriter\.[A-Za-z]+\(/, rel(file));
    }
  });

  await scenario("every entry point that reaches leased or owner-only work is a mapped surface or a named operator script", () => {
    const sensitiveGuards: readonly Guard[] = ["TOOL_LEASE", "OWNER_LEASE", "OWNER_PUBLICATION", "DISCOVERY_LEASE", "DURABLE_LEASE", "OWNER_REQUEST"];
    const sensitive = new Set(Object.values(SURFACES).flatMap((surface) => Object.entries(surface.modules).filter(([, guard]) => sensitiveGuards.includes(guard)).map(([file]) => path.join(repo, file))));
    const isEntry = (file: string): boolean => rel(file).startsWith("app/") || (rel(file).startsWith("scripts/") && !/^scripts\/(?:smoke-|fixtures\/|helpers\/)/.test(rel(file)));
    const reaching = files.filter(isEntry).filter((file) => [...closure(rel(file))].some((reached) => sensitive.has(reached))).map(rel).sort();
    const known = [...Object.keys(SURFACES), ...Object.keys(OTHER_ENTRIES)].sort();
    assert.deepEqual(reaching.filter((file) => !known.includes(file)), [], "a new entry point reaches leased or owner-only work: add it to SURFACES with its map, or to OTHER_ENTRIES with who runs it");
    // Surfaces are checked module by module above; the observer, for one, reaches only read-only probes.
    assert.deepEqual(Object.keys(OTHER_ENTRIES).filter((file) => !reaching.includes(file)), [], "remove these from OTHER_ENTRIES");
    // None of the operator scripts is started by the application, the observer or a package script.
    const pkg = fs.readFileSync(path.join(repo, "package.json"), "utf8");
    for (const entry of Object.keys(OTHER_ENTRIES).filter((file) => file.startsWith("scripts/"))) {
      const name = path.basename(entry);
      for (const starter of ["scripts/ayas-autonomy-daemon.ts", "scripts/ayas-discovery-daemon.ts", "scripts/ayas-durable-task-recovery.ts"]) assert.ok(!read(starter).includes(name), `${starter} starts ${name}`);
      for (const [file, source] of sources) if (rel(file).startsWith("app/")) assert.ok(!source.includes(name), `${rel(file)} names ${name}`);
      if (!PACKAGE_SCRIPTS.includes(entry)) assert.ok(!pkg.includes(name), `package.json runs ${name}`);
    }
  });

  await scenario("every effectful AYAS or Brain module is on the map or has a named off-surface owner", () => {
    const mapped = new Set(Object.values(SURFACES).flatMap((surface) => Object.keys(surface.modules)));
    const ayasEffects = [...effectful].map(rel).filter((file) => /^src\/lib\/(?:ayas|brain)\//.test(file)).sort();
    const unmapped = ayasEffects.filter((file) => !mapped.has(file) && !Object.hasOwn(OFF_SURFACE, file));
    assert.deepEqual(unmapped, [], "classify these modules in SURFACES or OFF_SURFACE");
    for (const file of Object.keys(OFF_SURFACE)) {
      assert.ok(ayasEffects.includes(file), `${file} is no longer effectful: remove it from OFF_SURFACE`);
      assert.ok(!mapped.has(file), `${file} is reachable from a surface: classify it there`);
    }
  });

  await scenario("the model router never selects the cloud provider, whatever is configured or down", async () => {
    let cloudCalls = 0;
    const provider = (id: "ollama" | "cloud", configured: boolean, available: boolean): AyasModelProvider => ({
      id, kind: id === "ollama" ? "local" : "cloud", model: `${id}-fixture`, configured,
      health: async () => ({ available, detail: `${id} fixture`, checkedAtMs: 0 }),
      chat: async () => { if (id === "cloud") cloudCalls++; return { text: "fixture" }; },
    } as unknown as AyasModelProvider);
    for (const [ollamaConfigured, ollamaUp] of [[true, false], [false, false], [true, true]] as const) {
      const route = await routeAyasModel({ text: "closure audit", providers: { ollama: provider("ollama", ollamaConfigured, ollamaUp), cloud: provider("cloud", true, true) } });
      assert.equal(route.decision.providerId, ollamaConfigured && ollamaUp ? "ollama" : null);
      assert.notEqual(route.provider?.id, "cloud");
    }
    assert.equal(cloudCalls, 0);
    const router = code("src/lib/ayas/model/AyasModelRouter.ts");
    assert.match(router, /const \{ ollama \} = input\.providers \?\? buildAyasModelProviders\(env, fetcher\);/);
    // The cloud provider is built in one place (the router) and read nowhere.
    const cloudUsers = files.filter((file) => isProduct(file) && /createCloudAyasProvider\(|\.cloud\b/.test(stripComments(sources.get(file)!))).map(rel).sort();
    assert.deepEqual(cloudUsers.filter((file) => /^src\/lib\/ayas\/model\//.test(file)), ["src/lib/ayas/model/AyasModelRouter.ts", "src/lib/ayas/model/CloudAyasProvider.ts"]);
    assert.doesNotMatch(router, /\bcloud\s*[,}][^=]*=\s*input\.providers|providers\.cloud\b|\bcloud\.(?:chat|health|stream)\b/, "the router reads the cloud provider");
  });

  await scenario("behaviour: in a TEMP process the product context takes three leases and reads the TEMP runtime catalogue", () => {
    const cwd = fs.mkdtempSync(path.join(temp, "product-")); const runtimeRoot = path.join(temp, "runtime");
    fs.mkdirSync(path.join(runtimeRoot, "projects"), { recursive: true });
    const script = path.join(cwd, "product-brain.cjs");
    fs.writeFileSync(script, `const {loadAyasProductBrainContext}=require(${JSON.stringify(path.join(repo, "src/lib/ayas/AyasProductBrain.ts"))});
      loadAyasProductBrainContext({safety:{decision:"ALLOW"},lastCycle:null}).then((context)=>console.log(JSON.stringify(context.lines))).catch((error)=>{console.error(error);process.exitCode=1;});`);
    const child = spawnSync(process.execPath, ["--require", path.join(repo, "node_modules", "tsx", "dist", "cjs", "index.cjs"), script], {
      cwd, env: { ...process.env, TSX_TSCONFIG_PATH: path.join(repo, "tsconfig.json"), ATOLYE_RUNTIME_ROOT: runtimeRoot }, encoding: "utf8", windowsHide: true, timeout: 90_000,
    });
    assert.equal(child.status, 0, child.stderr + child.stdout);
    const lines = JSON.parse(child.stdout.trim().split("\n").pop()!) as string[];
    assert.equal(lines.length, 6);
    assert.equal(lines[4], "Project Brain: total=0; completed=0; incomplete=0; resumable=0");
    assert.match(lines[0]!, /^Repo Brain: /); assert.match(lines[3]!, /^Sprint Brain: /);
    const records = new AyasExecutionAuthorizationStore({ rootDir: path.join(cwd, "data", "brain") }).list();
    assert.deepEqual(records.map((record) => record.action).sort(), ["inspect-repository-status", "list-production-projects", "read-project-document"]);
    const catalogue = records.find((record) => record.action === "list-production-projects")!;
    assert.deepEqual([catalogue.state, catalogue.capabilityScope!.classification, catalogue.capabilityScope!.resource.resourceRoot, catalogue.plan.mode], ["completed", "READ", path.join(runtimeRoot, "projects"), "summary"]);
    assert.ok(records.every((record) => record.requestedBy === "ayas-product-brain" && record.capabilityScope!.ownerId === null));
  });

  console.log(`Stage 15D firewall closure audit: PASS (${count} scenarios; ${Object.keys(SURFACES).length} surfaces; ${new Set(Object.values(SURFACES).flatMap((surface) => Object.keys(surface.modules))).size} mapped modules; TEMP only)`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(temp, { recursive: true, force: true }));
