/**
 * Atölye Brain — plan CLI (read-only dry run).  Sprint 181, PHASE 1.
 *
 *   npx tsx scripts/brain-plan.ts "İstanbul'un Fethi 1453" [options]
 *
 * Shows the 14-phase plan the Brain *would* drive for a topic — the phase order,
 * which pipeline stage(s) each phase touches, the service it delegates to, the
 * safety constraints in force, which phases need approval, where the plan is
 * blocked, and the single next step.
 *
 * It runs NOTHING:
 *   - no pipeline stage, no PipelineRunner
 *   - no Ollama / model call, no GPU, no nvidia-smi
 *   - no network
 *   - no file is written or deleted (unless you pass --record-experience, which
 *     appends one clearly-marked `dry-run` record under --experience-dir)
 *
 * Deterministic: the same options always produce the same plan and the same
 * `requestId` / `planId` (requestedAt defaults to a fixed instant; override with
 * --at).
 *
 * Options:
 *   --category  <history|documentary|science|technology|space|education|mystery|culture|art|other>
 *               (default: history)
 *   --quality   <watchable|documentary|cinematic>            (default: documentary)
 *   --cost      <local-only|prefer-local|allow-paid-with-approval>  (default: local-only)
 *   --hardware  <gtx-1650-4gb|rtx-a2000-12gb>                 (default: gtx-1650-4gb)
 *   --assume    <unavailable|cool>   resource-snapshot assumption; NO probe is
 *               ever run. "unavailable" (default) = fully conservative;
 *               "cool" = show the happy-path plan (assumed, not measured).
 *   --at        <iso instant>        override requestedAt (default fixed)
 *   --experience-dir <dir>           read prior experience records (read-only) to
 *                                    derive a strategy hint; with
 *                                    --record-experience also the write target
 *   --record-experience              append a `dry-run` experience record
 *   --json                           machine-readable output
 *   --help
 */

import assert from "node:assert/strict";

import {
  BRAIN_PHASE_ORDER,
  DEFAULT_BRAIN_HARDWARE_PROFILES,
  resolveBrainHardwareProfile,
  evaluateBrainSafety,
  describeBrainSafetyVerdict,
  planBrainRun,
  deriveBrainExperienceInsights,
  recommendStrategyFromExperience,
  renderBrainExperienceInsights,
  stableBrainId,
  createBrainExperienceStore,
  buildBrainDryRunExperienceRecord,
} from "../src/lib/brain";
import type {
  BrainCostPolicy,
  BrainProductionRequest,
  BrainQualityFloor,
  BrainResourceSnapshot,
  BrainTopicCategory,
} from "../src/lib/brain";

const CATEGORIES: readonly BrainTopicCategory[] = [
  "history", "documentary", "science", "technology", "space",
  "education", "mystery", "culture", "art", "other",
];
const QUALITY_FLOORS: readonly BrainQualityFloor[] = ["watchable", "documentary", "cinematic"];
const COST_POLICIES: readonly BrainCostPolicy[] = [
  "local-only", "prefer-local", "allow-paid-with-approval",
];

/** Fixed default so the plan is byte-identical across runs. */
const DEFAULT_REQUESTED_AT = "2026-01-01T00:00:00.000Z";

const PHASE_LABEL: Record<string, string> = {
  understand: "UNDERSTAND",
  research: "RESEARCH",
  verify: "VERIFY",
  plan: "PLAN",
  "find-media": "FIND MEDIA",
  "select-media": "SELECT MEDIA",
  write: "WRITE",
  "scene-plan": "SCENE PLAN",
  produce: "PRODUCE",
  review: "REVIEW",
  repair: "REPAIR",
  "re-review": "RE-REVIEW",
  finalize: "FINALIZE",
  learn: "LEARN",
};

interface CliOptions {
  topic: string;
  category: BrainTopicCategory;
  quality: BrainQualityFloor;
  cost: BrainCostPolicy;
  hardware: string;
  assume: "unavailable" | "cool";
  requestedAt: string;
  experienceDir?: string;
  recordExperience: boolean;
  json: boolean;
}

function fail(message: string): never {
  console.error(`brain-plan: ${message}`);
  process.exit(2);
}

function parseArgs(argv: readonly string[]): CliOptions {
  const positional: string[] = [];
  const opts: CliOptions = {
    topic: "",
    category: "history",
    quality: "documentary",
    cost: "local-only",
    hardware: "gtx-1650-4gb",
    assume: "unavailable",
    requestedAt: DEFAULT_REQUESTED_AT,
    recordExperience: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) fail(`${arg} needs a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      case "--category": {
        const value = next() as BrainTopicCategory;
        if (!CATEGORIES.includes(value)) fail(`unknown --category "${value}"`);
        opts.category = value;
        break;
      }
      case "--quality": {
        const value = next() as BrainQualityFloor;
        if (!QUALITY_FLOORS.includes(value)) fail(`unknown --quality "${value}"`);
        opts.quality = value;
        break;
      }
      case "--cost": {
        const value = next() as BrainCostPolicy;
        if (!COST_POLICIES.includes(value)) fail(`unknown --cost "${value}"`);
        opts.cost = value;
        break;
      }
      case "--hardware": {
        const value = next();
        if (!DEFAULT_BRAIN_HARDWARE_PROFILES[value]) {
          fail(`unknown --hardware "${value}" (known: ${Object.keys(DEFAULT_BRAIN_HARDWARE_PROFILES).join(", ")})`);
        }
        opts.hardware = value;
        break;
      }
      case "--assume": {
        const value = next();
        if (value !== "unavailable" && value !== "cool") fail(`--assume must be unavailable|cool`);
        opts.assume = value;
        break;
      }
      case "--at":
        opts.requestedAt = next();
        break;
      case "--experience-dir":
        opts.experienceDir = next();
        break;
      case "--record-experience":
        opts.recordExperience = true;
        break;
      case "--json":
        opts.json = true;
        break;
      default:
        if (arg.startsWith("--")) fail(`unknown option "${arg}"`);
        positional.push(arg);
    }
  }

  opts.topic = positional.join(" ").trim();
  if (!opts.topic) fail(`a topic is required — e.g. brain-plan.ts "İstanbul'un Fethi 1453"`);
  if (Number.isNaN(Date.parse(opts.requestedAt))) fail(`--at is not a valid instant: ${opts.requestedAt}`);
  if (opts.recordExperience && !opts.experienceDir) {
    fail(`--record-experience needs --experience-dir <dir>`);
  }
  return opts;
}

function printHelp(): void {
  console.log(String(readHeaderComment()));
}

function readHeaderComment(): string {
  return [
    'brain-plan — read-only dry run of the Atölye Brain 14-phase plan',
    '',
    '  npx tsx scripts/brain-plan.ts "<topic>" [--category ..] [--quality ..]',
    '      [--cost ..] [--hardware ..] [--assume unavailable|cool] [--at <iso>]',
    '      [--experience-dir <dir>] [--record-experience] [--json]',
    '',
    'Runs NOTHING: no pipeline, no model, no GPU, no network, no file writes',
    '(unless --record-experience).',
  ].join("\n");
}

function buildSnapshot(assume: "unavailable" | "cool", observedAt: string): BrainResourceSnapshot {
  if (assume === "cool") {
    // An *assumption*, explicitly not a measurement — the Safety Governor still
    // serialises with cooldowns for an "assumed" snapshot.
    return {
      observedAt,
      source: "assumed",
      gpuTempC: 45,
      gpuUtilizationPct: 2,
      activeInference: false,
      ollamaReachable: true,
      abnormalSignals: [],
    };
  }
  return { observedAt, source: "unavailable" };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const observedAt = opts.requestedAt;

  const profile = resolveBrainHardwareProfile(opts.hardware);
  const snapshot = buildSnapshot(opts.assume, observedAt);
  const safety = evaluateBrainSafety(profile, snapshot);

  const request: BrainProductionRequest = {
    schemaVersion: "1",
    requestId: stableBrainId("brain-request", {
      topic: opts.topic,
      category: opts.category,
      quality: opts.quality,
      cost: opts.cost,
      hardware: opts.hardware,
      requestedAt: opts.requestedAt,
    }),
    topic: opts.topic,
    topicCategory: opts.category,
    qualityFloor: opts.quality,
    costPolicy: opts.cost,
    hardwareProfileId: opts.hardware,
    requestedAt: opts.requestedAt,
  };

  // Optional, read-only: derive a strategy hint from prior experience.
  let recommendation;
  let insightLines = "";
  if (opts.experienceDir) {
    const store = createBrainExperienceStore({ rootDir: opts.experienceDir });
    const records = await store.list({ topicCategory: opts.category, hardwareProfileId: opts.hardware });
    const insights = deriveBrainExperienceInsights([...records], {
      topicCategory: opts.category,
      hardwareProfileId: opts.hardware,
      minSupport: 2,
    });
    insightLines = renderBrainExperienceInsights(insights);
    recommendation = recommendStrategyFromExperience(insights, request) ?? undefined;
  }

  const plan = planBrainRun(request, safety, recommendation);

  // Invariant checks — the plan must always be the full 14-phase loop in order.
  assert.equal(plan.phases.length, 14, "plan must have 14 phases");
  assert.deepEqual(
    plan.phases.map((phase) => phase.phase),
    [...BRAIN_PHASE_ORDER],
    "plan phases must be in canonical order",
  );

  let recordedExperienceId: string | undefined;
  if (opts.recordExperience && opts.experienceDir) {
    const store = createBrainExperienceStore({ rootDir: opts.experienceDir });
    const record = buildBrainDryRunExperienceRecord({
      request,
      plan,
      safety,
      recommendation,
      plannedAt: observedAt,
    });
    await store.append(record);
    recordedExperienceId = record.recordId;
  }

  if (opts.json) {
    console.log(JSON.stringify({
      dryRun: true,
      executed: false,
      request,
      snapshotSource: snapshot.source,
      safety,
      recommendation: recommendation ?? null,
      plan,
      recordedExperienceId: recordedExperienceId ?? null,
    }, null, 2));
    return;
  }

  renderHuman({ opts, profile, snapshot, safety, plan, insightLines, recommendation, recordedExperienceId });
}

function renderHuman(ctx: {
  opts: CliOptions;
  profile: ReturnType<typeof resolveBrainHardwareProfile>;
  snapshot: BrainResourceSnapshot;
  safety: ReturnType<typeof evaluateBrainSafety>;
  plan: ReturnType<typeof planBrainRun>;
  insightLines: string;
  recommendation: ReturnType<typeof recommendStrategyFromExperience> | undefined;
  recordedExperienceId?: string;
}): void {
  const { opts, profile, snapshot, safety, plan } = ctx;
  const out: string[] = [];
  out.push("ATÖLYE BRAIN — PLAN (DRY RUN)");
  out.push("============================");
  out.push("Nothing is executed: no pipeline stage, no model, no GPU, no nvidia-smi, no network.");
  out.push("");
  out.push(`Topic:      "${opts.topic}"`);
  out.push(`Category:   ${opts.category}`);
  out.push(`Quality:    ${opts.quality}`);
  out.push(`Cost:       ${opts.cost}`);
  out.push(`Hardware:   ${profile.label} (${profile.id})`);
  out.push(`Snapshot:   ${snapshot.source}${snapshot.source === "unavailable" ? " (no probe — conservative assumptions)" : " (assumption, not a measurement)"}`);
  out.push(`Request id: ${plan.requestId}`);
  out.push(`Plan id:    ${plan.planId}`);
  out.push("");
  out.push("SAFETY");
  out.push(describeBrainSafetyVerdict(safety).split("\n").map((line) => `  ${line}`).join("\n"));
  out.push("");

  if (opts.experienceDir) {
    out.push("EXPERIENCE (read-only)");
    out.push(`  dir: ${opts.experienceDir}`);
    for (const line of (ctx.insightLines || "No experience insights yet.").split("\n")) {
      out.push(`  ${line}`);
    }
    if (ctx.recommendation) {
      out.push(`  → strategy hint: ${ctx.recommendation.label}`);
      for (const reason of ctx.recommendation.rationale) out.push(`      - ${reason}`);
      if (ctx.recommendation.suggestedConstraints.length) {
        out.push(`      constraints: ${ctx.recommendation.suggestedConstraints.join(", ")}`);
      }
    } else {
      out.push("  → no strategy hint (not enough history)");
    }
    out.push("");
  }

  out.push("14-PHASE PLAN");
  out.push("  " + BRAIN_PHASE_ORDER.map((phase) => PHASE_LABEL[phase]).join(" → "));
  out.push("");
  plan.phases.forEach((phase, index) => {
    const tag = phase.requiresApproval ? "  [APPROVAL REQUIRED]" : "";
    const blocked = plan.firstBlockedPhase === phase.phase ? "  ← first blocked phase" : "";
    out.push(`  ${String(index + 1).padStart(2)}. ${PHASE_LABEL[phase.phase]}${tag}${blocked}`);
    out.push(`      ${phase.summary}`);
    out.push(`      stages:    ${phase.pipelineStages.join(", ") || "—"}`);
    out.push(`      delegate:  ${phase.delegatesTo}`);
    if (phase.constraints.length) out.push(`      constraints: ${phase.constraints.join(", ")}`);
    out.push(`      decisions: ${phase.decisionPoints.join("; ")}`);
    if (phase.requiresApproval) out.push(`      approval:  ${phase.approvalReason}`);
    out.push("");
  });

  out.push("NEXT SINGLE STEP");
  out.push(`  ${plan.nextSingleStep}`);
  if (ctx.recordedExperienceId) {
    out.push("");
    out.push(`Recorded dry-run experience: ${ctx.recordedExperienceId}`);
    out.push(`  (mode=dry-run · not counted as a production outcome · hidden from the learner)`);
  }
  out.push("");
  out.push("— DRY RUN complete. Nothing was executed. —");
  console.log(out.join("\n"));
}

main().catch((error) => {
  console.error("brain-plan failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
