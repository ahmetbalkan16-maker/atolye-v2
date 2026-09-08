/**
 * Atölye Brain — foundation smoke suite (PHASE 6 "Intelligence").
 *
 * Pure, deterministic, GPU-free, $0. Covers:
 *  A. Decision journal — build / validate / render / fail-closed anomalies.
 *  B. Safety Governor — proceed / hold / abort / unavailable-conservative /
 *     "never wait for 80 °C" / unknown-profile fail-closed.
 *  C. Computation planner — single-call vs quality-preserving split.
 *  D. Quality judge — release / repair / reject + minimal repair targets.
 *  E. Experience model — deterministic insights + strategy recommendation.
 *  F. Improvement proposal — approval gate state machine.
 *  G. Self-improvement loop — cannot reach `apply` without `user-approve`.
 *  H. Orchestrator run-planner — phase order, approval + safety blocking.
 */

import assert from "node:assert/strict";
import {
  // decision journal
  BrainDecisionRecorder,
  validateBrainDecisionLog,
  renderBrainDecisionReport,
  buildBrainDecision,
  // safety
  DEFAULT_BRAIN_HARDWARE_PROFILES,
  resolveBrainHardwareProfile,
  BrainHardwareProfileError,
  evaluateBrainSafety,
  brainThermalThresholds,
  // computation
  estimateStageWorkload,
  planStageComputation,
  // quality
  evaluateBrainQuality,
  // experience
  deriveBrainExperienceInsights,
  recommendStrategyFromExperience,
  // improvement
  buildBrainImprovementProposal,
  advanceBrainImprovementProposal,
  isBrainImprovementApproved,
  // loop
  startBrainImprovementLoop,
  advanceBrainImprovementLoop,
  // orchestrator
  planBrainRun,
} from "../src/lib/brain";
import type {
  BrainExperienceRecord,
  BrainFinalRenderReport,
  BrainProductionRequest,
  BrainResourceSnapshot,
} from "../src/lib/brain";

let count = 0;
function scenario(name: string, test: () => void) {
  test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const T0 = "2026-09-08T02:00:00.000Z";
const T1 = "2026-09-08T02:05:00.000Z";
const T2 = "2026-09-08T02:10:00.000Z";

function run() {
  /* ----------------------------- A. Decision journal ---------------------- */

  scenario("decision recorder assigns contiguous sequences and validates", () => {
    const recorder = new BrainDecisionRecorder();
    recorder.record({
      phase: "plan",
      stage: "research",
      decision: "Qwen 3B seçildi.",
      reason: "GPU thermal profile.",
      alternatives: ["qwen2.5:7b"],
      rejectedBecause: "thermal risk / unnecessary compute.",
      strategy: "split research into smaller units.",
      expectedBenefit: "lower peak thermal load + comparable coverage.",
      occurredAt: T0,
      evidence: ["gpuTempC:71", "profile:gtx-1650-4gb"],
    });
    recorder.record({
      phase: "produce",
      decision: "cooldown between GPU stages",
      reason: "sustained inference heats the card",
      alternatives: [],
      rejectedBecause: "",
      strategy: "8s pause between visuals/animation/video",
      expectedBenefit: "stay under the hold threshold",
      occurredAt: T1,
      evidence: [],
    });
    const validation = recorder.validate();
    assert.equal(validation.valid, true);
    assert.equal(validation.reasonCode, "BRAIN_DECISION_LOG_VALID");
    assert.equal(recorder.snapshot().length, 2);
    assert.equal(recorder.snapshot()[0].sequence, 1);
  });

  scenario("decision journal is deterministic (same inputs → same id)", () => {
    const input = {
      phase: "understand" as const,
      decision: "history documentary, documentary quality floor",
      reason: "topic is a 1453 siege",
      alternatives: ["watchable"],
      rejectedBecause: "user asked for kaliteli",
      strategy: "documentary preset",
      expectedBenefit: "richer narration",
      occurredAt: T0,
      evidence: [],
    };
    assert.equal(buildBrainDecision(input, 1).decisionId, buildBrainDecision(input, 1).decisionId);
    assert.notEqual(buildBrainDecision(input, 1).decisionId, buildBrainDecision(input, 2).decisionId);
  });

  scenario("decision journal fail-closed on timestamp regression", () => {
    const a = buildBrainDecision(
      { phase: "research", decision: "d", reason: "r", alternatives: [], rejectedBecause: "", strategy: "s", expectedBenefit: "b", occurredAt: T1, evidence: [] },
      1,
    );
    const b = buildBrainDecision(
      { phase: "write", decision: "d", reason: "r", alternatives: [], rejectedBecause: "", strategy: "s", expectedBenefit: "b", occurredAt: T0, evidence: [] },
      2,
    );
    const validation = validateBrainDecisionLog([a, b]);
    assert.equal(validation.valid, false);
    assert.equal(validation.reasonCode, "BRAIN_DECISION_LOG_TIMESTAMP_REGRESSION");
  });

  scenario("decision journal fail-closed on phase regression", () => {
    const a = buildBrainDecision(
      { phase: "produce", decision: "d", reason: "r", alternatives: [], rejectedBecause: "", strategy: "s", expectedBenefit: "b", occurredAt: T0, evidence: [] },
      1,
    );
    const b = buildBrainDecision(
      { phase: "research", decision: "d", reason: "r", alternatives: [], rejectedBecause: "", strategy: "s", expectedBenefit: "b", occurredAt: T1, evidence: [] },
      2,
    );
    assert.equal(validateBrainDecisionLog([a, b]).reasonCode, "BRAIN_DECISION_LOG_PHASE_REGRESSION");
  });

  scenario("decision journal fail-closed + blanks output on unsafe evidence", () => {
    const bad = buildBrainDecision(
      { phase: "plan", decision: "d", reason: "r", alternatives: [], rejectedBecause: "", strategy: "s", expectedBenefit: "b", occurredAt: T0, evidence: ["OPENAI_API_KEY=sk-abc123def456ghi789jkl"] },
      1,
    );
    const validation = validateBrainDecisionLog([bad]);
    assert.equal(validation.valid, false);
    assert.equal(validation.reasonCode, "BRAIN_DECISION_LOG_UNSAFE_EVIDENCE");
    assert.equal(validation.canonicalDecisions.length, 0);
  });

  scenario("decision report renders the section-12 block", () => {
    const recorder = new BrainDecisionRecorder();
    recorder.record({
      phase: "plan", decision: "Qwen 3B seçildi.", reason: "GPU thermal profile.",
      alternatives: ["7B"], rejectedBecause: "thermal risk.", strategy: "split research.",
      expectedBenefit: "lower peak thermal load.", occurredAt: T0, evidence: [],
    });
    const report = renderBrainDecisionReport(recorder.snapshot());
    assert.match(report, /\*\*Decision:\*\* Qwen 3B/);
    assert.match(report, /\*\*Rejected because:\*\* thermal risk\./);
  });

  /* ----------------------------- B. Safety Governor --------------------- */

  scenario("unknown hardware profile fails closed", () => {
    assert.throws(() => resolveBrainHardwareProfile("no-such-machine"), BrainHardwareProfileError);
    assert.ok(resolveBrainHardwareProfile("gtx-1650-4gb"));
    assert.ok(resolveBrainHardwareProfile("rtx-a2000-12gb"));
  });

  scenario("safety proceeds when all metrics are cool", () => {
    const profile = DEFAULT_BRAIN_HARDWARE_PROFILES["rtx-a2000-12gb"];
    const snapshot: BrainResourceSnapshot = {
      observedAt: T0, source: "measured", gpuTempC: 44, gpuUtilizationPct: 2,
      vramUsedGb: 1.1, vramTotalGb: 12, activeInference: false, cpuLoadPct: 12,
      ramUsedGb: 8, ramTotalGb: 32, ollamaReachable: true, abnormalSignals: [],
    };
    const verdict = evaluateBrainSafety(profile, snapshot);
    assert.equal(verdict.decision, "proceed");
  });

  scenario("safety NEVER waits for the ceiling — warns/holds well before it", () => {
    const profile = DEFAULT_BRAIN_HARDWARE_PROFILES["gtx-1650-4gb"]; // ceiling 80
    const thr = brainThermalThresholds(profile);
    assert.ok(thr.warnC < thr.holdC && thr.holdC < thr.abortC);
    assert.equal(thr.abortC, 80);
    assert.ok(thr.holdC <= 76, `hold ${thr.holdC} should be <= 76`);
    const hold = evaluateBrainSafety(profile, { observedAt: T0, source: "measured", gpuTempC: thr.holdC + 0.5 });
    assert.equal(hold.decision, "hold");
    const warn = evaluateBrainSafety(profile, { observedAt: T0, source: "measured", gpuTempC: thr.warnC + 0.5 });
    assert.equal(warn.decision, "proceed-with-constraints");
    assert.ok(warn.constraints.includes("cooldown-between-stages"));
  });

  scenario("abnormal signal → immediate abort", () => {
    const profile = DEFAULT_BRAIN_HARDWARE_PROFILES["rtx-a2000-12gb"];
    for (const sig of ["thermal-slowdown", "tdr", "bsod", "fatal-whea", "display-loss", "driver-reset"] as const) {
      const verdict = evaluateBrainSafety(profile, { observedAt: T0, source: "measured", gpuTempC: 40, abnormalSignals: [sig] });
      assert.equal(verdict.decision, "abort", `${sig} should abort`);
    }
  });

  scenario("unavailable snapshot → conservative proceed-with-constraints, not 'all clear'", () => {
    const profile = DEFAULT_BRAIN_HARDWARE_PROFILES["gtx-1650-4gb"];
    const verdict = evaluateBrainSafety(profile, { observedAt: T0, source: "unavailable" });
    assert.equal(verdict.decision, "proceed-with-constraints");
    for (const c of ["serialize-stages", "cooldown-between-stages", "single-inference-at-a-time", "assume-shared-gpu", "forbid-large-model"]) {
      assert.ok(verdict.constraints.includes(c as never), `expected constraint ${c}`);
    }
  });

  scenario("4 GB card always forbids large models; low VRAM headroom too", () => {
    const profile = DEFAULT_BRAIN_HARDWARE_PROFILES["gtx-1650-4gb"];
    const v = evaluateBrainSafety(profile, { observedAt: T0, source: "measured", gpuTempC: 40 });
    assert.ok(v.constraints.includes("forbid-large-model"));
    const a2000 = DEFAULT_BRAIN_HARDWARE_PROFILES["rtx-a2000-12gb"];
    const tight = evaluateBrainSafety(a2000, { observedAt: T0, source: "measured", gpuTempC: 40, vramUsedGb: 11.6, vramTotalGb: 12 });
    assert.ok(tight.constraints.includes("forbid-large-model"));
    assert.ok(tight.constraints.includes("reduce-context-window"));
  });

  /* ----------------------------- C. Computation planner ----------------- */

  scenario("small stage that fits the window → single-call", () => {
    const workload = estimateStageWorkload({
      stage: "seo", promptCharacters: 1_200, expectedOutputCharacters: 900,
      structuredOutputItems: 1, modelContextWindow: 8_192,
    });
    const profile = DEFAULT_BRAIN_HARDWARE_PROFILES["gtx-1650-4gb"];
    const safety = evaluateBrainSafety(profile, { observedAt: T0, source: "measured", gpuTempC: 45 });
    const plan = planStageComputation(workload, profile, safety);
    assert.equal(plan.mode, "single-call");
    assert.equal(plan.units.length, 1);
    assert.equal(plan.qualityPreserving, true);
  });

  scenario("heavy script that would blow a 4096 window → quality-preserving split", () => {
    const workload = estimateStageWorkload({
      stage: "script", promptCharacters: 6_000, expectedOutputCharacters: 9_000,
      structuredOutputItems: 8, modelContextWindow: 4_096,
    });
    const profile = DEFAULT_BRAIN_HARDWARE_PROFILES["gtx-1650-4gb"];
    const safety = evaluateBrainSafety(profile, { observedAt: T0, source: "measured", gpuTempC: 45 });
    const plan = planStageComputation(workload, profile, safety);
    assert.equal(plan.mode, "split-sequential");
    assert.ok(plan.units.length >= 3);
    assert.equal(plan.units.at(-1)?.kind, "summary-merge");
    assert.equal(plan.qualityPreserving, true);
    assert.ok(plan.cooldownBetweenUnitsMs > 0);
    // every non-merge unit fits the window with headroom
    for (const unit of plan.units) {
      assert.ok(unit.estimatedPromptTokens + unit.estimatedOutputTokens < workload.modelContextWindow);
    }
  });

  scenario("safety 'small-work-units' forces a split even when it would fit", () => {
    const workload = estimateStageWorkload({
      stage: "research", promptCharacters: 2_000, expectedOutputCharacters: 2_400,
      structuredOutputItems: 5, modelContextWindow: 8_192,
    });
    const profile = DEFAULT_BRAIN_HARDWARE_PROFILES["gtx-1650-4gb"];
    const safety = evaluateBrainSafety(profile, { observedAt: T0, source: "unavailable" }); // adds small-work-units
    const plan = planStageComputation(workload, profile, safety);
    assert.equal(plan.mode, "split-sequential");
  });

  /* ----------------------------- D. Quality judge ---------------------- */

  const goodReport = (): BrainFinalRenderReport => ({
    projectSlug: "test", observedAt: T0,
    container: { format: "mov,mp4,m4a", durationSeconds: 90, sizeBytes: 7_000_000 },
    video: { codec: "h264", width: 1920, height: 1080, frameRate: 30 },
    audio: { codec: "aac", sampleRate: 48_000, channels: 2 },
    narrationDurationSeconds: 89.5, leadingSilenceSeconds: 0.2, trailingSilenceSeconds: 0.8,
    integratedLoudnessLufs: -14.2,
    targetDurationBand: { minSeconds: 60, maxSeconds: 120 },
    targetResolution: { width: 1920, height: 1080 }, targetFrameRate: 30,
    scenes: [
      { sceneId: 1, plannedDurationSeconds: 30, renderedDurationSeconds: 30, visualAssetId: "a1", visualDigest: "d1", narrationCharacters: 400, meanLuma: 120 },
      { sceneId: 2, plannedDurationSeconds: 30, renderedDurationSeconds: 31, visualAssetId: "a2", visualDigest: "d2", narrationCharacters: 410, meanLuma: 110 },
      { sceneId: 3, plannedDurationSeconds: 30, renderedDurationSeconds: 29, visualAssetId: "a3", visualDigest: "d3", narrationCharacters: 395, meanLuma: 130 },
    ],
    expectedAssetKinds: ["script", "audio", "assembly"], presentAssetKinds: ["script", "audio", "assembly"],
    subtitleCueCount: 3,
  });

  scenario("clean render → release", () => {
    const verdict = evaluateBrainQuality(goodReport());
    assert.equal(verdict.outcome, "release");
    assert.ok(verdict.score > 0.9);
    assert.equal(verdict.repairTargets.length, 0);
  });

  scenario("broken container → reject (not repairable piece-by-piece)", () => {
    const report = goodReport();
    const verdict = evaluateBrainQuality({ ...report, video: undefined });
    assert.equal(verdict.outcome, "reject");
  });

  scenario("repeated visual + dark scene → repair, with scene-scoped minimal actions", () => {
    const base = goodReport();
    const report: BrainFinalRenderReport = {
      ...base,
      scenes: [
        base.scenes[0],
        { ...base.scenes[1], visualDigest: "d1" }, // duplicate of scene 1
        { ...base.scenes[2], meanLuma: 6 }, // near-black
      ],
    };
    const verdict = evaluateBrainQuality(report);
    assert.equal(verdict.outcome, "repair");
    assert.ok(verdict.repairTargets.some((t) => t.scope === "scene" && t.sceneId === 2 && /regenerate a distinct visual/.test(t.minimalAction)));
    assert.ok(verdict.repairTargets.some((t) => t.scope === "scene" && t.sceneId === 3));
    // no repair target says "re-run the whole pipeline"
    assert.ok(verdict.repairTargets.every((t) => !/whole pipeline|from scratch/i.test(t.minimalAction)));
  });

  scenario("scene with narration but no visual → repair that one scene", () => {
    const base = goodReport();
    const report: BrainFinalRenderReport = {
      ...base,
      scenes: [
        { ...base.scenes[0], visualAssetId: undefined, visualDigest: undefined },
        base.scenes[1],
        base.scenes[2],
      ],
    };
    const verdict = evaluateBrainQuality(report);
    assert.equal(verdict.outcome, "repair");
    const target = verdict.repairTargets.find((t) => t.stage === "visuals" && t.sceneId === 1);
    assert.ok(target);
    assert.match(target!.minimalAction, /scene 1 only/);
  });

  /* ----------------------------- E. Experience model ------------------- */

  const record = (over: Partial<BrainExperienceRecord>): BrainExperienceRecord => ({
    schemaVersion: "1", recordId: over.recordId ?? `r-${Math.random()}`,
    topic: "t", topicCategory: "history", hardwareProfileId: "gtx-1650-4gb",
    qualityFloor: "documentary", requestedAt: T0, completedAt: T2,
    finalStatus: "released", strategyLabel: "local-$0",
    stages: [], media: [],
    totals: { wallClockMs: 1000, promptTokens: 100, completionTokens: 100, aiCostUsd: 0, regenerationCount: 0 },
    qualityScore: 0.8, qualityOutcome: "release", errorClasses: [],
    ...over,
  });

  scenario("experience insights are deterministic and support-gated", () => {
    const records = [
      record({ recordId: "a", media: [{ strategy: "archival-photo", sceneCount: 6, acceptedCount: 6, rejectedCount: 0, meanRelevanceScore: 0.9 }], qualityScore: 0.9 }),
      record({ recordId: "b", media: [{ strategy: "archival-photo", sceneCount: 6, acceptedCount: 5, rejectedCount: 1, meanRelevanceScore: 0.85 }], qualityScore: 0.88 }),
      record({ recordId: "c", media: [{ strategy: "ai-image", sceneCount: 6, acceptedCount: 4, rejectedCount: 2 }], qualityScore: 0.66 }),
      record({ recordId: "d", media: [{ strategy: "ai-image", sceneCount: 6, acceptedCount: 3, rejectedCount: 3 }], qualityScore: 0.6 }),
    ];
    const q = { topicCategory: "history" as const, minSupport: 2 };
    const first = deriveBrainExperienceInsights(records, q);
    const second = deriveBrainExperienceInsights(records, q);
    assert.deepEqual(first, second);
    assert.ok(first.some((i) => i.kind === "media-strategy-quality" && /archival-photo/.test(i.statement)));
    // below support threshold → nothing
    assert.equal(deriveBrainExperienceInsights(records.slice(0, 1), { minSupport: 5 }).length, 0);
  });

  scenario("thermal experience → recommendation adds cooldown + serialize", () => {
    const records = [
      record({ recordId: "h1", totals: { wallClockMs: 1, promptTokens: 1, completionTokens: 1, aiCostUsd: 0, regenerationCount: 0, gpuPeakTempC: 79 }, errorClasses: ["thermal"] }),
      record({ recordId: "h2", totals: { wallClockMs: 1, promptTokens: 1, completionTokens: 1, aiCostUsd: 0, regenerationCount: 0, gpuPeakTempC: 78 } }),
      record({ recordId: "h3", totals: { wallClockMs: 1, promptTokens: 1, completionTokens: 1, aiCostUsd: 0, regenerationCount: 0, gpuPeakTempC: 77 } }),
      record({ recordId: "h4", totals: { wallClockMs: 1, promptTokens: 1, completionTokens: 1, aiCostUsd: 0, regenerationCount: 0, gpuPeakTempC: 80 } }),
      record({ recordId: "h5", totals: { wallClockMs: 1, promptTokens: 1, completionTokens: 1, aiCostUsd: 0, regenerationCount: 0, gpuPeakTempC: 79 } }),
      record({ recordId: "h6", totals: { wallClockMs: 1, promptTokens: 1, completionTokens: 1, aiCostUsd: 0, regenerationCount: 0, gpuPeakTempC: 78 } }),
      record({ recordId: "h7", totals: { wallClockMs: 1, promptTokens: 1, completionTokens: 1, aiCostUsd: 0, regenerationCount: 0, gpuPeakTempC: 77 } }),
      record({ recordId: "h8", totals: { wallClockMs: 1, promptTokens: 1, completionTokens: 1, aiCostUsd: 0, regenerationCount: 0, gpuPeakTempC: 76 } }),
    ];
    const insights = deriveBrainExperienceInsights(records, { minSupport: 2 });
    assert.ok(insights.some((i) => i.kind === "thermal-pattern"));
    const request: BrainProductionRequest = {
      schemaVersion: "1", requestId: "req-1", topic: "x", topicCategory: "history",
      qualityFloor: "documentary", costPolicy: "prefer-local", hardwareProfileId: "gtx-1650-4gb", requestedAt: T0,
    };
    const rec = recommendStrategyFromExperience(insights, request);
    assert.ok(rec);
    assert.ok(rec!.suggestedConstraints.includes("cooldown-between-stages"));
    assert.ok(rec!.suggestedConstraints.includes("serialize-stages"));
  });

  /* ----------------------------- F. Improvement proposal --------------- */

  scenario("improvement proposal cannot be approved without an explicit user-approve", () => {
    const proposal = buildBrainImprovementProposal({
      title: "Grammar-constrain OllamaYouTubeProvider",
      problem: "youtube stage flaky JSON on qwen2.5:3b",
      currentBehaviorEvidence: ["Sprint 174/179: YOUTUBE_PACKAGE_GENERATION_FAILED"],
      options: [
        { id: "opt-a", summary: "apply the scenes/seo grammar-schema pattern", approach: "buildYouTubeResponseJsonSchema", risks: ["schema drift"], effort: "small" },
        { id: "opt-b", summary: "retry loop only", approach: "raise OLLAMA_MAX_RETRIES", risks: ["still flaky"], effort: "small" },
      ],
      recommendedOptionId: "opt-a",
      riskAssessment: "low — additive, non-strict path unchanged",
      filesLikelyToChange: ["src/lib/youtube/..."],
      testPlan: ["smoke-local-providers", "smoke-production-youtube-package-pipeline"],
      expectedBenefit: "12/12 local stages",
      createdAt: T0,
    });
    assert.equal(proposal.approvalState, "draft");
    const submitted = advanceBrainImprovementProposal(proposal, "submit-for-approval", T1);
    assert.equal(submitted.ok, true);
    assert.equal(submitted.proposal.approvalState, "awaiting-user-approval");
    // illegal: jump straight to implemented
    const illegal = advanceBrainImprovementProposal(submitted.proposal, "mark-implemented", T2);
    assert.equal(illegal.ok, false);
    assert.equal(illegal.reasonCode, "BRAIN_IMPROVEMENT_TRANSITION_ILLEGAL");
    assert.equal(isBrainImprovementApproved(submitted.proposal), false);
    // only user-approve opens the door
    const approved = advanceBrainImprovementProposal(submitted.proposal, "user-approve", T2);
    assert.equal(approved.proposal.approvalState, "approved");
    assert.equal(isBrainImprovementApproved(approved.proposal), true);
  });

  /* ----------------------------- G. Self-improvement loop -------------- */

  scenario("self-improvement loop cannot reach apply without user approval", () => {
    let state = startBrainImprovementLoop("prop-1", T0);
    // observe→analyze→propose→test→verify→report (all unattended)
    for (let step = 0; step < 5; step += 1) {
      const r = advanceBrainImprovementLoop(state, "advance", T0);
      assert.equal(r.ok, true);
      state = r.state;
    }
    assert.equal(state.stage, "report");
    // advance past report requires approval
    const blocked = advanceBrainImprovementLoop(state, "advance", T1);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reasonCode, "BRAIN_LOOP_ILLEGAL_TRANSITION");
    const approved = advanceBrainImprovementLoop(state, "user-approve", T1);
    assert.equal(approved.ok, true);
    assert.equal(approved.state.stage, "apply");
    assert.equal(approved.state.userApproved, true);
  });

  /* ----------------------------- H. Orchestrator run-planner ----------- */

  const request: BrainProductionRequest = {
    schemaVersion: "1", requestId: "req-9", topic: "İstanbul'un Fethi 1453",
    topicCategory: "history", qualityFloor: "documentary", costPolicy: "local-only",
    hardwareProfileId: "rtx-a2000-12gb", requestedAt: T0,
  };

  scenario("run plan has the full 14-phase loop in order", () => {
    const profile = DEFAULT_BRAIN_HARDWARE_PROFILES["rtx-a2000-12gb"];
    const safety = evaluateBrainSafety(profile, { observedAt: T0, source: "measured", gpuTempC: 45 });
    const plan = planBrainRun(request, safety);
    assert.equal(plan.phases.length, 14);
    assert.equal(plan.phases[0].phase, "understand");
    assert.equal(plan.phases.at(-1)?.phase, "learn");
    // finalize needs approval (may publish); produce does not (local, reversible)
    assert.equal(plan.phases.find((p) => p.phase === "finalize")?.requiresApproval, true);
    assert.equal(plan.phases.find((p) => p.phase === "produce")?.requiresApproval, false);
  });

  scenario("safety hold blocks the run plan from 'produce' onward", () => {
    const profile = DEFAULT_BRAIN_HARDWARE_PROFILES["gtx-1650-4gb"];
    const safety = evaluateBrainSafety(profile, { observedAt: T0, source: "measured", gpuTempC: 78 });
    assert.equal(safety.decision, "hold");
    const plan = planBrainRun(request, safety);
    assert.equal(plan.firstBlockedPhase, "produce");
    assert.match(plan.nextSingleStep, /HOLD/);
  });

  console.log(`Atölye Brain foundation smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "brain-foundation", scenarios: count }));
}

try {
  run();
} catch (error) {
  console.error("Atölye Brain foundation smoke FAILED:", error);
  process.exitCode = 1;
}
