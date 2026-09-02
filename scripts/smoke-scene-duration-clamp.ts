/**
 * Non-strict `AIManager.runScenes` clamps every parsed scene duration into the
 * downstream-valid window [1, 300]s. A weaker local model occasionally emits a
 * 0 / negative / absurd `duration`, which the animation stage would otherwise
 * reject closed (`SCENE_DURATION_INVALID`) and sink the whole render.
 *
 * No network — the AI provider is a stub returning a fixed scenes JSON.
 */
import assert from "node:assert/strict";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { AIManager } from "../src/lib/ai/AIManager";
import type { AIProvider } from "../src/lib/ai/providers";
import type { ScriptData } from "../src/types/script";

let scenarios = 0;
function pass(cond: unknown, label: string) {
  assert.ok(cond, label);
  scenarios += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${scenarios}: ${label}`);
}

const script: ScriptData = {
  topic: "T", title: "T", subtitle: "s", hook: "h", introduction: "i",
  chapters: [
    { id: 1, title: "c1", narration: "n".repeat(400), duration: 40, visualGoal: "g", emotion: "e", transition: "t" },
    { id: 2, title: "c2", narration: "n".repeat(400), duration: 40, visualGoal: "g", emotion: "e", transition: "t" },
  ],
  conclusion: "c", callToAction: "s", estimatedDuration: 80, narrationWordCount: 100,
  targetAudience: "g", language: "tr", voiceStyle: "documentary", musicStyle: "cinematic",
  thumbnailIdea: "t", seoKeywords: ["k"], createdAt: new Date().toISOString(),
};

function stubProvider(scenesJson: unknown): AIProvider {
  return {
    async generate() {
      return {
        content: JSON.stringify(scenesJson),
        finishReason: "stop" as const,
        refused: false,
        complete: true,
        truncated: false,
      };
    },
  } as unknown as AIProvider;
}

async function main() {
  await withCanonicalSmokeRuntime({ name: "scene-duration-clamp", projectSlug: "scene-duration-clamp" }, () => run());
}

async function run() {
  const scenes = await AIManager.runScenes(
    script,
    { projectSlug: "scene-duration-clamp", stage: "scenes", operation: "scenes" },
    stubProvider({
      scenes: [
        { id: 1, title: "s1", description: "d", visualPrompt: "v", duration: 0 },
        { id: 2, title: "s2", description: "d", visualPrompt: "v", duration: -12 },
        { id: 3, title: "s3", description: "d", visualPrompt: "v", duration: 9999 },
        { id: 4, title: "s4", description: "d", visualPrompt: "v", duration: 8.5 },
        { id: 5, title: "s5", description: "d", visualPrompt: "v" },
      ],
      createdAt: new Date().toISOString(),
    }),
  );

  assert.equal(scenes.scenes.length, 5, "5 scenes parsed (not the mock fallback)");
  const d = scenes.scenes.map((s) => Number(s.duration));
  // The parsed durations [0, -12, 9999, 8.5, missing] clamp to a set whose total
  // (~311s) is wildly off the script's estimatedDuration (80s), so they are
  // redistributed evenly: round(80 / 5) = 16s each.
  pass(d.every((x) => Number.isFinite(x) && x >= 1 && x <= 300), `every scene duration in [1,300]: ${d.join(", ")}`);
  pass(d.every((x) => x === 16), `garbage durations redistributed evenly to 16s: ${d.join(", ")}`);
  const total = d.reduce((s, x) => s + x, 0);
  pass(Math.abs(total - script.estimatedDuration) <= 5, `total ${total}s ~ script estimatedDuration ${script.estimatedDuration}s`);

  // A sane set of durations is left untouched.
  const sane = await AIManager.runScenes(
    script,
    { projectSlug: "scene-duration-clamp", stage: "scenes", operation: "scenes" },
    stubProvider({
      scenes: [
        { id: 1, title: "s", description: "d", visualPrompt: "v", duration: 20 },
        { id: 2, title: "s", description: "d", visualPrompt: "v", duration: 18 },
        { id: 3, title: "s", description: "d", visualPrompt: "v", duration: 22 },
        { id: 4, title: "s", description: "d", visualPrompt: "v", duration: 20 },
      ],
      createdAt: new Date().toISOString(),
    }),
  );
  pass(
    sane.scenes.map((s) => s.duration).join(",") === "20,18,22,20",
    "a sane duration set (total 80 ~ estimatedDuration 80) is left untouched",
  );

  console.log(`Scene duration clamp smoke: PASS (${scenarios} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "scene-duration-clamp", scenarios }));
}

main().catch((error) => {
  console.error("Scene duration clamp smoke FAILED:", error);
  process.exitCode = 1;
});
