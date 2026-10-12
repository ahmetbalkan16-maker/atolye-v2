import assert from "node:assert/strict";
import { AIManager } from "../src/lib/ai/AIManager";
import { AIResponseError } from "../src/lib/ai/AIResponseError";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import type { ResearchData } from "../src/types/research";

const fixture = (topic: string): ResearchData => ({ topic, summary: "Temporary research fixture", historicalContext: "", timeline: [], characters: [], locations: [], keyEvents: [], strategies: [], controversies: [], interestingFacts: [], documentaryFlow: [], sceneIdeas: [], imagePrompts: [], animationPrompts: [], musicIdeas: [], soundEffects: [], thumbnailIdeas: [], youtubeTitles: [], sources: [], createdAt: new Date().toISOString() });

async function main() {
  const original = AIManager.runResearch, timer = globalThis.setTimeout;
  const delays: number[] = [];
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (callback.name === "automaticLocalRepairBackoff") { delays.push(delay!); return timer(callback, 1, ...args); }
    return timer(callback, delay, ...args);
  }) as typeof setTimeout;
  try {
    await withCanonicalSmokeRuntime({ name: "automatic-local-repair", environment: { AI_PROVIDER: "ollama", ATOLYE_DURABLE_PIPELINE_EXECUTION: "enabled" } }, async () => {
      let calls = 0;
      AIManager.runResearch = async topic => { calls++; if (calls === 1) throw new AIResponseError("AI_RESPONSE_INVALID_JSON"); return fixture(topic); };
      const result = await PipelineRunner.run("Automatic local repair fixture", { automaticLocalRepair: true, stopAfterStage: "research" });
      assert.equal(result.success, true); assert.deepEqual(result.completedStages, ["research"]); assert.equal(calls, 2);
      assert.equal((await PipelineJobManager.getJobForStageReadOnly(result.slug, "research"))?.attempts, 1);
      assert.deepEqual(delays, [60000]);
      calls = 0;
      AIManager.runResearch = async () => { calls++; throw new AIResponseError("AI_RESPONSE_SCHEMA_INVALID"); };
      await assert.rejects(PipelineRunner.run("Bounded failure fixture", { automaticLocalRepair: true, stopAfterStage: "research" }));
      assert.equal(calls, 3); assert.deepEqual(delays.slice(1), [60000, 120000]);
      calls = 0;
      AIManager.runResearch = async () => { calls++; throw new AIResponseError("AI_USAGE_PERSISTENCE_FAILED"); };
      await assert.rejects(PipelineRunner.run("Uncertain usage fixture", { automaticLocalRepair: true, stopAfterStage: "research" }));
      assert.equal(calls, 1);
    });
  } finally { AIManager.runResearch = original; globalThis.setTimeout = timer; }
  console.log("Automatic local repair: PASS (real scoped worker/durable retry, success, three-attempt bound and unknown-cost stop; no network or billable call)");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
