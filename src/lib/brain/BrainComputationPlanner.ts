/**
 * Atölye Brain — computation planner (section 3 of the emir).
 *
 * "Mevcut sistemde uzun LLM çağrısını zorlamak istemiyorum. Brain işin
 * büyüklüğünü analiz edip işi gerektiğinde parçalayabilsin." — but **never** by
 * blindly asking for less. A split plan always covers the same material as the
 * single call would have (per-chapter drafts recombine into the whole script,
 * per-subtopic research merges into the full brief, …).
 *
 * This is **pure**. It reads a workload estimate + the machine profile + the
 * Safety Governor verdict and decides single-call vs split-sequential. It does
 * not call any model.
 *
 * Grounding — the failure modes this is designed around (checkpoint Sprint 176):
 *  - Ollama server default `num_ctx` is 4096. A ~1530-token script prompt asking
 *    for ~2200+ tokens of JSON hits that ceiling → the model loops / repeats.
 *  - The assembly-plan prompt (~2900 tokens) with `num_predict` 5200 causes a
 *    context-shift → the JSON structure collapses.
 *  - `scenes` / `seo` weakness on `qwen2.5:3b` is *model capability*, not
 *    context — splitting helps coverage there but grammar-constrained schemas
 *    (already in the codebase) are the real fix.
 */

import { stableBrainId } from "./BrainId";
import {
  brainSchemaVersion,
  type BrainComputationMode,
  type BrainComputationPlan,
  type BrainHardwareProfile,
  type BrainSafetyVerdict,
  type BrainStageWorkload,
  type BrainWorkUnit,
  type BrainWorkUnitKind,
} from "@/types/brain";
import type { ProductionStepKey } from "@/types/project";

/** Rough char→token ratio for mixed Turkish/English documentary prose + JSON. */
export const BRAIN_CHARS_PER_TOKEN = 3.8;

/** Fraction of the context window kept free for the system prompt + slack. */
const CONTEXT_HEADROOM_FRACTION = 0.18;
/** Absolute minimum free tokens regardless of window size. */
const MIN_CONTEXT_HEADROOM_TOKENS = 512;

/** Above this many structured items in one call a small model starts dropping / duplicating. */
const SINGLE_CALL_ITEM_CEILING = 10;

/** Stages whose output is a list of independently-draftable items. */
const SPLITTABLE: Partial<Record<ProductionStepKey, BrainWorkUnitKind>> = {
  research: "research-subtopic",
  script: "chapter-draft",
  scenes: "scene-batch",
};

export interface BrainWorkloadEstimateInput {
  readonly stage: ProductionStepKey;
  readonly promptCharacters: number;
  readonly expectedOutputCharacters: number;
  readonly structuredOutputItems: number;
  readonly modelContextWindow: number;
}

export function estimateStageWorkload(
  input: BrainWorkloadEstimateInput,
): BrainStageWorkload {
  return {
    stage: input.stage,
    estimatedPromptTokens: Math.max(1, Math.ceil(input.promptCharacters / BRAIN_CHARS_PER_TOKEN)),
    estimatedOutputTokens: Math.max(1, Math.ceil(input.expectedOutputCharacters / BRAIN_CHARS_PER_TOKEN)),
    structuredOutputItems: Math.max(0, Math.floor(input.structuredOutputItems)),
    modelContextWindow: Math.max(1, Math.floor(input.modelContextWindow)),
  };
}

function contextHeadroom(window: number): number {
  return Math.max(MIN_CONTEXT_HEADROOM_TOKENS, Math.ceil(window * CONTEXT_HEADROOM_FRACTION));
}

function cooldownForVerdict(verdict: BrainSafetyVerdict): number {
  if (verdict.snapshotSource === "unavailable") return 12_000;
  if (verdict.constraints.includes("cooldown-between-stages")) return 8_000;
  if (verdict.constraints.includes("serialize-stages")) return 3_000;
  return 1_500;
}

function makeUnit(
  stage: ProductionStepKey,
  kind: BrainWorkUnitKind,
  index: number,
  label: string,
  promptTokens: number,
  outputTokens: number,
  recombine: boolean,
): BrainWorkUnit {
  return {
    id: stableBrainId("brain-work-unit", { stage, kind, index, label }),
    label,
    kind,
    estimatedPromptTokens: Math.max(1, Math.round(promptTokens)),
    estimatedOutputTokens: Math.max(1, Math.round(outputTokens)),
    recombine,
  };
}

/**
 * Decide how to run a stage's LLM work.
 *
 * `single-call` when the whole prompt + reply comfortably fits the context
 * window, the item count is modest, and no safety constraint forces smaller
 * units. Otherwise `split-sequential`: N item-sized units (each of which fits
 * the window with headroom) plus one merge unit that reassembles them into the
 * artifact the stage would have produced anyway.
 */
export function planStageComputation(
  workload: BrainStageWorkload,
  profile: BrainHardwareProfile,
  safety: BrainSafetyVerdict,
): BrainComputationPlan {
  const rationale: string[] = [];
  const headroom = contextHeadroom(workload.modelContextWindow);
  const totalTokens = workload.estimatedPromptTokens + workload.estimatedOutputTokens;
  const fitsSingle = totalTokens + headroom <= workload.modelContextWindow;

  const forcedSmall =
    safety.constraints.includes("small-work-units") ||
    safety.constraints.includes("reduce-context-window");
  const itemHeavy =
    workload.structuredOutputItems > SINGLE_CALL_ITEM_CEILING &&
    Boolean(SPLITTABLE[workload.stage]);
  const splittable = Boolean(SPLITTABLE[workload.stage]) && workload.structuredOutputItems >= 2;

  if (fitsSingle && !forcedSmall && !itemHeavy) {
    rationale.push(
      `prompt+reply ≈ ${totalTokens} tok + ${headroom} headroom fits the ${workload.modelContextWindow}-tok window`,
    );
    if (workload.structuredOutputItems > 0) {
      rationale.push(`${workload.structuredOutputItems} structured item(s) — within the single-call ceiling`);
    }
    return finalizePlan(workload.stage, "single-call", [
      makeUnit(
        workload.stage,
        "single",
        1,
        `${workload.stage}: single call`,
        workload.estimatedPromptTokens,
        workload.estimatedOutputTokens,
        false,
      ),
    ], rationale, cooldownForVerdict(safety));
  }

  if (!splittable) {
    // Cannot meaningfully split (e.g. seo, a single-object stage). Keep it one
    // call but record why it is risky so the orchestrator can pick a
    // grammar-constrained schema / lower the output budget instead.
    if (!fitsSingle) {
      rationale.push(
        `prompt+reply ≈ ${totalTokens} tok exceeds the ${workload.modelContextWindow}-tok window (headroom ${headroom}) — NOT splittable; use a grammar-constrained schema and a tighter output budget`,
      );
    }
    if (forcedSmall) {
      rationale.push("safety forces small units but this stage has no per-item structure to split on");
    }
    return finalizePlan(workload.stage, "single-call", [
      makeUnit(
        workload.stage,
        "single",
        1,
        `${workload.stage}: single call (unsplittable)`,
        workload.estimatedPromptTokens,
        workload.estimatedOutputTokens,
        false,
      ),
    ], rationale, cooldownForVerdict(safety));
  }

  // Split by structured item.
  const kind = SPLITTABLE[workload.stage] as BrainWorkUnitKind;
  const items = workload.structuredOutputItems;
  // Batch size: as large as fits the window with headroom, capped so a weak
  // model is not handed too many items at once.
  const perItemOutput = Math.ceil(workload.estimatedOutputTokens / items);
  // A per-unit prompt keeps the shared context (topic + prior brief) but only
  // asks for one item's worth of output.
  const sharedPromptTokens = Math.ceil(workload.estimatedPromptTokens * 0.7);
  const budgetForItems = workload.modelContextWindow - headroom - sharedPromptTokens;
  const maxItemsByContext = Math.max(1, Math.floor(budgetForItems / Math.max(1, perItemOutput)));
  const batchSize = Math.max(1, Math.min(4, maxItemsByContext, itemHeavy ? 3 : 4));
  const batches = Math.ceil(items / batchSize);

  const units: BrainWorkUnit[] = [];
  for (let batch = 0; batch < batches; batch += 1) {
    const from = batch * batchSize + 1;
    const to = Math.min(items, from + batchSize - 1);
    const batchItemCount = to - from + 1;
    units.push(
      makeUnit(
        workload.stage,
        kind,
        batch + 1,
        `${workload.stage}: items ${from}–${to}`,
        sharedPromptTokens + Math.ceil(perItemOutput * 0.3),
        perItemOutput * batchItemCount,
        true,
      ),
    );
  }
  units.push(
    makeUnit(
      workload.stage,
      "summary-merge",
      batches + 1,
      `${workload.stage}: merge ${batches} batch(es) into the final artifact`,
      sharedPromptTokens + Math.ceil(workload.estimatedOutputTokens * 0.2),
      Math.ceil(workload.estimatedOutputTokens * 0.15),
      false,
    ),
  );

  if (!fitsSingle) {
    rationale.push(
      `prompt+reply ≈ ${totalTokens} tok would exceed the ${workload.modelContextWindow}-tok window`,
    );
  }
  if (itemHeavy) {
    rationale.push(
      `${items} items in one call exceeds the ${SINGLE_CALL_ITEM_CEILING}-item small-model ceiling`,
    );
  }
  if (forcedSmall) {
    rationale.push(`safety constraint (${safety.constraints.join(", ")}) forces small work units`);
  }
  rationale.push(
    `split into ${batches} batch(es) of ≤ ${batchSize} item(s) + 1 merge — same coverage, each unit fits the window`,
  );
  if (profile.ollama.viableModels.length === 1) {
    rationale.push(
      `only ${profile.ollama.viableModels[0]} is viable on this machine — small sequential units suit it`,
    );
  }

  return finalizePlan(workload.stage, "split-sequential", units, rationale, cooldownForVerdict(safety));
}

function finalizePlan(
  stage: ProductionStepKey,
  mode: BrainComputationMode,
  units: readonly BrainWorkUnit[],
  rationale: readonly string[],
  cooldownBetweenUnitsMs: number,
): BrainComputationPlan {
  return {
    schemaVersion: brainSchemaVersion,
    stage,
    mode,
    units,
    rationale: [...rationale],
    qualityPreserving: true,
    cooldownBetweenUnitsMs: mode === "single-call" ? 0 : cooldownBetweenUnitsMs,
  };
}

/** Human-readable summary of a plan. */
export function describeBrainComputationPlan(plan: BrainComputationPlan): string {
  const lines = [
    `${plan.stage}: ${plan.mode}` +
      (plan.mode === "split-sequential"
        ? ` (${plan.units.length} units, ${plan.cooldownBetweenUnitsMs} ms cooldown between)`
        : ""),
    ...plan.rationale.map((reason) => `  - ${reason}`),
  ];
  return lines.join("\n");
}
