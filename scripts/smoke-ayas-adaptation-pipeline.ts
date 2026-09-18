import assert from "node:assert/strict";

import { planAyasAdaptation } from "../src/lib/brain/autonomy/AyasAdaptationPipeline";
import type { AyasExternalResearchFinding } from "../src/lib/brain/autonomy/AyasExternalResearchStore";

/**
 * M22.8 — the independent adaptation pipeline never generates a diff, never
 * touches a file, never executes anything: every scenario proves it is a
 * pure routing/classification function over the SAME real BrainPatchSafety
 * domain classifier every other AYAS mutation already answers to.
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

function baseFinding(overrides: Partial<AyasExternalResearchFinding> = {}): AyasExternalResearchFinding {
  return {
    schemaVersion: "1", findingId: "ayas-research-fixture", recordedAt: "2026-09-17T00:00:00.000Z",
    provider: "X", capability: "y", problemSolved: "z", sourceUrl: "https://example.com",
    isOfficialSource: true, featureDate: null, lastCheckedAt: "2026-09-17T00:00:00.000Z", confidence: "high",
    licenseCostStatus: "open-source", licenseCostNotes: "", atolyeGapStatus: "missing", atolyeGapNotes: "",
    treatedSourceAsUntrusted: true, ...overrides,
  };
}

scenario("a plan targeting FORBIDDEN_AUTONOMOUS files (e.g. the execution control plane) routes FORBIDDEN_AUTONOMOUS, never anything softer", () => {
  const plan = planAyasAdaptation({ finding: baseFinding(), declaredTargetFiles: ["src/lib/ayas/execution/AyasExecutionGateStore.ts"], independentDesignSummary: "x" });
  assert.equal(plan.routingDecision, "FORBIDDEN_AUTONOMOUS", "assert.equal(plan.routingDecision, \"FORBIDDEN_AUTONOMOUS\")");
});

scenario("a plan targeting a REVIEW_REQUIRED domain (e.g. real audio/assembly production code) routes REVIEW_REQUIRED, not SAFE", () => {
  const plan = planAyasAdaptation({ finding: baseFinding(), declaredTargetFiles: ["src/lib/audio/AudioMixer.ts"], independentDesignSummary: "x" });
  assert.equal(plan.routingDecision, "REVIEW_REQUIRED", "assert.equal(plan.routingDecision, \"REVIEW_REQUIRED\")");
});

scenario("a small SAFE-domain plan (<= 2 files) routes MICRO_SAFE_CANDIDATE", () => {
  const plan = planAyasAdaptation({ finding: baseFinding(), declaredTargetFiles: ["scripts/smoke-fixture.ts"], independentDesignSummary: "x" });
  assert.equal(plan.routingDecision, "MICRO_SAFE_CANDIDATE", "assert.equal(plan.routingDecision, \"MICRO_SAFE_CANDIDATE\")");
});

scenario("a larger SAFE-domain plan (> 2 files) routes PRIORITY_SAFE_CANDIDATE, not MICRO_SAFE", () => {
  const plan = planAyasAdaptation({ finding: baseFinding(), declaredTargetFiles: ["scripts/smoke-a.ts", "scripts/smoke-b.ts", "scripts/smoke-c.ts"], independentDesignSummary: "x" });
  assert.equal(plan.routingDecision, "PRIORITY_SAFE_CANDIDATE", "assert.equal(plan.routingDecision, \"PRIORITY_SAFE_CANDIDATE\")");
});

scenario("a SAFE-domain plan whose finding has unknown license/cost status is downgraded to REVIEW_REQUIRED, even though the domain itself is SAFE", () => {
  const plan = planAyasAdaptation({ finding: baseFinding({ licenseCostStatus: "unknown" }), declaredTargetFiles: ["scripts/smoke-fixture.ts"], independentDesignSummary: "x" });
  assert.equal(plan.routingDecision, "REVIEW_REQUIRED", "assert.equal(plan.routingDecision, \"REVIEW_REQUIRED\")");
  assert.ok(plan.unresolvedConcerns.some((c) => c.includes("license")), "assert.ok(plan.unresolvedConcerns.some((c) => c.includes(\"license\")))");
});

scenario("a real B-roll-style finding (unknown licensing, missing capability) against a SAFE-domain declared target still correctly routes REVIEW_REQUIRED because of the license concern, not the domain", () => {
  const finding = baseFinding({ provider: "CapCut", capability: "AI B-roll", licenseCostStatus: "unknown", atolyeGapStatus: "missing" });
  const plan = planAyasAdaptation({ finding, declaredTargetFiles: ["scripts/smoke-broll-fixture.ts"], independentDesignSummary: "reuse existing visuals pipeline, source only lawfully-licensed media" });
  assert.equal(plan.domainSafety, "SAFE", "assert.equal(plan.domainSafety, \"SAFE\")");
  assert.equal(plan.routingDecision, "REVIEW_REQUIRED", "assert.equal(plan.routingDecision, \"REVIEW_REQUIRED\")");
});

scenario("the plan never contains a generated file diff/content — only declared paths and a human-authored design summary (structural proof: no 'content'/'replacements' field exists on the result)", () => {
  const plan = planAyasAdaptation({ finding: baseFinding(), declaredTargetFiles: ["scripts/smoke-fixture.ts"], independentDesignSummary: "x" });
  assert.ok(!("content" in plan), "assert.ok(!(\"content\" in plan))");
  assert.ok(!("replacements" in plan), "assert.ok(!(\"replacements\" in plan))");
});

console.log(`AYAS adaptation pipeline smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-adaptation-pipeline", scenarios: count }));
