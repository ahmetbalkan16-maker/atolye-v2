/**
 * F-08: end-to-end wiring smoke test for AIManager.runScript's duration
 * reconciliation (NarrationDurationEstimator.reconcileChapterDurations +
 * the honest narrationWordCount recomputation), exercised through the real
 * strict/production response-parsing path (parseStrictScriptResponse), not
 * just the pure estimator functions in isolation (see
 * smoke-narration-duration-estimator.ts for those).
 *
 * `runScript("T", undefined, ...)` records usage under the context-less
 * `unknown` project. Run without isolation it resolved the legacy default and
 * appended to the repository's `data/projects/unknown/ai-usage.json` (2026-09-23
 * incident), so every storage root here — runtime, authority and the legacy
 * workspace — is run-owned TEMP, verified before the first call.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { AIManager } from "../src/lib/ai/AIManager";
import { strictGenerationExecutionPolicy } from "../src/lib/ai/GenerationExecutionPolicy";
import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";

let count = 0;
function scenario(name: string, test: () => void | Promise<void>) {
  return (async () => {
    await test();
    count += 1;
    if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
  })();
}

function result(content: string): AIProviderResult {
  return {
    content, finishReason: "stop", refused: false, complete: true, truncated: false,
    usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
  };
}

function provider(value: AIProviderResult): AIProvider {
  return { async generate() { return value; } };
}

/**
 * A strict-schema-valid script response where the model's own per-chapter
 * `duration` picks are the OPPOSITE of the chapters' real narration length
 * (chapter 1: tiny narration, huge claimed duration; chapter 2: huge
 * narration, tiny claimed duration) and `narrationWordCount` is wildly
 * wrong (mirrors the real, observed 1200-claimed-vs-284-actual bug) --
 * exactly the disconnect this fix targets.
 */
function mismatchedScriptResponse(): string {
  // ch2 narration is sized so the whole script's real char-rate estimate lands
  // at ~90s (5 + 1169 + 51 + 46 = 1271 chars / 14.12 ~= 90.0), while the model's
  // own per-chapter `duration` picks are the OPPOSITE of the real per-chapter
  // narration lengths and its `estimatedDuration` (88) is a disconnected guess.
  const chapters = [
    { id: 1, title: "C1", narration: "Kısa.", duration: 40, visualGoal: "g", emotion: "e", transition: "t" },
    { id: 2, title: "C2", narration: "x ".repeat(585).trim(), duration: 10, visualGoal: "g", emotion: "e", transition: "t" },
    { id: 3, title: "C3", narration: "Orta uzunlukta bir anlatım metni burada yer alıyor.", duration: 20, visualGoal: "g", emotion: "e", transition: "t" },
    { id: 4, title: "C4", narration: "Başka bir orta uzunlukta anlatım metni burada.", duration: 20, visualGoal: "g", emotion: "e", transition: "t" },
  ];
  return JSON.stringify({
    topic: "T", title: "T", subtitle: "S", hook: "H", introduction: "I",
    chapters,
    conclusion: "C", callToAction: "CTA",
    estimatedDuration: 88, narrationWordCount: 999999, // hallucinated, same bug family as the real 1200-vs-284 case
    targetAudience: "genel", language: "tr", voiceStyle: "documentary", musicStyle: "cinematic",
    thumbnailIdea: "idea", seoKeywords: ["k"],
  });
}

async function run() {
  await scenario("runScript (strict/production) sets estimatedDuration + chapter durations from the real narration length, not the model's picks", async () => {
    const script = await AIManager.runScript(
      "T",
      undefined,
      provider(result(mismatchedScriptResponse())),
      strictGenerationExecutionPolicy,
    );
    // Strict path: estimatedDuration is the calibrated char-rate estimate of the
    // narration the model actually wrote (~90s), NOT its disconnected pick (88),
    // and the chapter durations sum to it exactly.
    const total = script.chapters.reduce((sum, c) => sum + c.duration, 0);
    assert.equal(script.estimatedDuration, 90);
    assert.equal(total, 90);

    const byId = new Map(script.chapters.map((c) => [c.id, c.duration]));
    // Chapter 2 (huge real narration, tiny original LLM guess) must now
    // receive MORE duration than chapter 1 (tiny real narration, huge
    // original LLM guess) -- the opposite of what the model claimed.
    assert.ok(
      (byId.get(2) as number) > (byId.get(1) as number),
      `expected chapter 2 to outweigh chapter 1 after reconciliation, got ${JSON.stringify([...byId])}`,
    );
  });

  await scenario("runScript (strict/production) recomputes narrationWordCount honestly instead of trusting the model's claim", async () => {
    const script = await AIManager.runScript(
      "T",
      undefined,
      provider(result(mismatchedScriptResponse())),
      strictGenerationExecutionPolicy,
    );
    assert.notEqual(script.narrationWordCount, 999999);
    const realWordCount = script.chapters.reduce(
      (sum, c) => sum + c.narration.trim().split(/\s+/).length,
      0,
    );
    assert.equal(script.narrationWordCount, realWordCount);
  });

  await scenario("runScript (non-strict/legacy) also reconciles chapter durations (no split behavior between modes)", async () => {
    const legacyResponse = JSON.stringify({
      topic: "T", title: "T", subtitle: "S", hook: "H", introduction: "I",
      chapters: [
        { id: 1, title: "C1", narration: "Kısa.", duration: 40, visualGoal: "g", emotion: "e", transition: "t" },
        { id: 2, title: "C2", narration: "x ".repeat(300).trim(), duration: 10, visualGoal: "g", emotion: "e", transition: "t" },
      ],
      conclusion: "C", callToAction: "CTA",
      estimatedDuration: 50, narrationWordCount: 12345,
      targetAudience: "genel", language: "tr", voiceStyle: "documentary", musicStyle: "cinematic",
      thumbnailIdea: "idea", seoKeywords: ["k"],
    });
    const script = await AIManager.runScript("T", undefined, provider(result(legacyResponse)));
    const total = script.chapters.reduce((sum, c) => sum + c.duration, 0);
    assert.equal(total, 50);
    const byId = new Map(script.chapters.map((c) => [c.id, c.duration]));
    assert.ok((byId.get(2) as number) > (byId.get(1) as number));
  });

  console.log(`Script duration reconciliation wiring smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "script-duration-reconciliation-wiring", scenarios: count }));
}

function insideRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function main() {
  await withCanonicalSmokeRuntime({
    name: "script-duration-reconciliation-wiring",
    // No operation context: storage resolves from the environment, whose legacy
    // workspace (`ATOLYE_WORKSPACE_ROOT`) is set below to a run-owned folder.
    enterOperationContext: false,
    environment: { ATOLYE_WORKSPACE_ROOT: undefined },
  }, async (runtime) => {
    const legacyWorkspace = path.join(runtime.workspaceRoot, "legacy-workspace");
    fs.mkdirSync(path.join(legacyWorkspace, "data", "projects"), { recursive: true });
    process.env.ATOLYE_WORKSPACE_ROOT = legacyWorkspace;
    const storage = createRuntimeStorageContext();
    const roots = { runtimeRoot: storage.runtimeRoot, projectsRoot: storage.projectsRoot,
      legacyProjectsRoot: storage.legacyProjectsRoot, authorityRoot: storage.authorityRoot };
    for (const [name, root] of Object.entries(roots)) {
      assert.ok(insideRoot(runtime.workspaceRoot, root), `${name} escaped the run-owned workspace: ${root}`);
    }
    await run();
    const ledger = JSON.parse(fs.readFileSync(
      path.join(storage.projectsRoot, "unknown", "ai-usage.json"), "utf8")) as { records: unknown[] };
    console.log(JSON.stringify({ suite: "script-duration-reconciliation-wiring", isolation: {
      workspaceRoot: runtime.workspaceRoot, ...roots, unknownLedgerRecords: ledger.records.length } }));
  });
}

main().catch((error) => {
  console.error("Script duration reconciliation wiring smoke FAILED:", error);
  process.exitCode = 1;
});
