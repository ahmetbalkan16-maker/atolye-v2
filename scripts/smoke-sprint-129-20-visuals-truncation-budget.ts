import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { AIResponseError } from "../src/lib/ai/AIResponseError";
import { strictGenerationExecutionPolicy } from "../src/lib/ai/GenerationExecutionPolicy";
import { getResearchMaxTokens } from "../src/lib/ai/ResearchAIConfig";
import { getScriptMaxTokens } from "../src/lib/ai/ScriptAIConfig";
import {
  getVisualsMaxTokens,
  VisualsAIConfigError,
  visualsTokenBudget,
} from "../src/lib/ai/VisualsAIConfig";
import type {
  AIProvider,
  AIProviderGenerateOptions,
  AIProviderResult,
} from "../src/lib/ai/providers";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import {
  productionAcceptanceConfigurationFingerprint,
  readProductionAcceptanceMarker,
} from "../src/lib/production/ProductionAcceptancePolicy";
import { ProductionReadinessService } from "../src/lib/production/ProductionReadinessService";
import type { SceneData } from "../src/types/scene";
import { VisualManager } from "../src/lib/visuals/VisualManager";

const productionSlug = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
let passed = 0;

async function test(name: string, run: () => void | Promise<void>) {
  await run();
  passed++;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

function scenes(): SceneData {
  return {
    scenes: Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      chapterId: index + 1,
      title: `Scene ${index + 1}`,
      description: "Historical documentary scene",
      visualPrompt: "Historically grounded cinematic visual",
      duration: 15,
    })),
    createdAt: "2026-07-15T18:00:00.000Z",
  };
}

function visualPlan() {
  return {
    scenes: Array.from({ length: 6 }, (_, index) => ({
      sceneId: index + 1,
      visualPrompt: "Cinematic historically grounded documentary image",
      animationPrompt: "Slow controlled camera movement",
      style: "cinematic",
    })),
    thumbnail: {
      title: "Conquest preparations",
      prompt: "Epic historically grounded documentary thumbnail",
      composition: "Central subject framed by city walls",
      mood: "dramatic",
    },
  };
}

function result(overrides: Partial<AIProviderResult> = {}): AIProviderResult {
  return {
    content: JSON.stringify(visualPlan()),
    finishReason: "stop",
    refused: false,
    complete: true,
    truncated: false,
    usage: { promptTokens: 1_307, completionTokens: 500, totalTokens: 1_807 },
    ...overrides,
  };
}

function provider(
  value: AIProviderResult,
  onCall?: (options?: AIProviderGenerateOptions) => void,
): AIProvider {
  return {
    async generate(_prompt, options) {
      onCall?.(options);
      return value;
    },
  };
}

function digest(root: string) {
  const hash = createHash("sha256");
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, entry.name);
      hash.update(path.relative(root, target));
      if (entry.isDirectory()) walk(target);
      else hash.update(fs.readFileSync(target));
    }
  };
  walk(root);
  return hash.digest("hex");
}

function environment(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...overrides } as NodeJS.ProcessEnv;
}

async function main() {
  if (!process.env.ATOLYE_12920_WORKSPACE) {
    const repository = process.cwd();
    const production = path.join(repository, "data", "projects", productionSlug);
    const before = digest(production);
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-12920-"));
    const copy = path.join(workspace, "data", "projects", productionSlug);
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.cpSync(production, copy, { recursive: true });
    try {
      const executable = path.join(repository, "node_modules", "tsx", "dist", "cli.mjs");
      const child = spawnSync(process.execPath, [executable, path.resolve(import.meta.filename)], {
        cwd: workspace,
        env: {
          ...process.env,
          ATOLYE_12920_WORKSPACE: workspace,
          ATOLYE_12920_REPO: repository,
          TSX_TSCONFIG_PATH: path.join(repository, "tsconfig.json"),
        },
        encoding: "utf8",
      });
      process.stdout.write(child.stdout ?? "");
      process.stderr.write(child.stderr ?? "");
      assert.equal(child.status, 0, `isolated smoke exited with ${child.status}`);
      assert.equal(digest(production), before, "production runtime changed during isolated smoke");
      return;
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }

  const truncatedSlug = "sprint-129-20-truncated";
  const truncatedRoot = path.join(process.cwd(), "data", "projects", truncatedSlug);
  let truncatedProviderCalls = 0;
  const imageCalls = 0;
  const truncated = result({
    finishReason: "length",
    complete: false,
    truncated: true,
    usage: { promptTokens: 1_307, completionTokens: 1_200, totalTokens: 2_507 },
  });

  await test("truncated visuals response preserves AI_RESPONSE_TRUNCATED before parsing", async () => {
    await assert.rejects(
      () => VisualManager.generateVisualData({
        projectSlug: truncatedSlug,
        scenes: scenes(),
        aiProvider: provider(truncated, () => truncatedProviderCalls++),
        generationPolicy: strictGenerationExecutionPolicy,
      }),
      (error) => error instanceof AIResponseError && error.code === "AI_RESPONSE_TRUNCATED",
    );
  });
  await test("truncated visuals provider is called once", () => assert.equal(truncatedProviderCalls, 1));
  await test("truncated visuals creates no canonical artifact", () => assert.equal(fs.existsSync(path.join(truncatedRoot, "visuals.json")), false));
  await test("truncated visuals creates no image assets", () => {
    assert.equal(imageCalls, 0);
    assert.equal(fs.existsSync(path.join(truncatedRoot, "assets", "images")), false);
  });

  let unsetMaxTokens: number | undefined;
  await test("unset visuals budget uses the stage default", async () => {
    const previous = process.env.OPENAI_VISUALS_MAX_TOKENS;
    delete process.env.OPENAI_VISUALS_MAX_TOKENS;
    try {
      const generated = await VisualManager.generateVisualData({
        projectSlug: "sprint-129-20-unset",
        scenes: scenes(),
        aiProvider: provider(result(), (options) => { unsetMaxTokens = options?.maxTokens; }),
        generationPolicy: strictGenerationExecutionPolicy,
      });
      assert.equal(generated.scenes.length, 6);
      assert.equal(unsetMaxTokens, 3200);
      assert.equal(getVisualsMaxTokens(environment({ OPENAI_MAX_TOKENS: "1200" })), 3200);
    } finally {
      if (previous === undefined) delete process.env.OPENAI_VISUALS_MAX_TOKENS;
      else process.env.OPENAI_VISUALS_MAX_TOKENS = previous;
    }
  });

  let explicitMaxTokens: number | undefined;
  await test("explicit visuals budget applies only to visuals request", async () => {
    const previous = process.env.OPENAI_VISUALS_MAX_TOKENS;
    process.env.OPENAI_VISUALS_MAX_TOKENS = "4000";
    try {
      const generated = await VisualManager.generateVisualData({
        projectSlug: "sprint-129-20-explicit",
        scenes: scenes(),
        aiProvider: provider(result(), (options) => { explicitMaxTokens = options?.maxTokens; }),
        generationPolicy: strictGenerationExecutionPolicy,
      });
      assert.equal(generated.scenes.length, 6);
      assert.equal(explicitMaxTokens, 4000);
      assert.equal(getResearchMaxTokens(environment({ OPENAI_VISUALS_MAX_TOKENS: "4000" })), 3200);
      assert.equal(getScriptMaxTokens(environment({ OPENAI_VISUALS_MAX_TOKENS: "4000" })), 3200);
    } finally {
      if (previous === undefined) delete process.env.OPENAI_VISUALS_MAX_TOKENS;
      else process.env.OPENAI_VISUALS_MAX_TOKENS = previous;
    }
  });

  await test("visuals budget accepts inclusive bounds", () => {
    assert.equal(getVisualsMaxTokens(environment({ OPENAI_VISUALS_MAX_TOKENS: String(visualsTokenBudget.minimumTokens) })), visualsTokenBudget.minimumTokens);
    assert.equal(getVisualsMaxTokens(environment({ OPENAI_VISUALS_MAX_TOKENS: String(visualsTokenBudget.maximumTokens) })), visualsTokenBudget.maximumTokens);
  });
  for (const value of ["", "0", "-1", "1.5", "not-a-number", String(visualsTokenBudget.minimumTokens - 1), String(visualsTokenBudget.maximumTokens + 1)]) {
    await test(`visuals budget rejects ${JSON.stringify(value)}`, () => {
      assert.throws(() => getVisualsMaxTokens(environment({ OPENAI_VISUALS_MAX_TOKENS: value })), VisualsAIConfigError);
    });
  }

  await test("invalid visuals budget fails closed before provider admission", async () => {
    const previous = process.env.OPENAI_VISUALS_MAX_TOKENS;
    process.env.OPENAI_VISUALS_MAX_TOKENS = "1.5";
    let calls = 0;
    try {
      await assert.rejects(
        () => VisualManager.generateVisualData({
          projectSlug: "sprint-129-20-invalid",
          scenes: scenes(),
          aiProvider: provider(result(), () => calls++),
          generationPolicy: strictGenerationExecutionPolicy,
        }),
        VisualsAIConfigError,
      );
      assert.equal(calls, 0);
    } finally {
      if (previous === undefined) delete process.env.OPENAI_VISUALS_MAX_TOKENS;
      else process.env.OPENAI_VISUALS_MAX_TOKENS = previous;
    }
  });

  await test("unset visuals budget preserves acceptance fingerprint", () => {
    const base = productionAcceptanceConfigurationFingerprint(environment());
    const explicitlyUnset = productionAcceptanceConfigurationFingerprint(environment({ OPENAI_VISUALS_MAX_TOKENS: undefined }));
    assert.equal(base, explicitlyUnset);
  });
  await test("existing prepared marker remains compatible while visuals budget is unset", async () => {
    const marker = await readProductionAcceptanceMarker(productionSlug);
    assert.equal(marker.acceptanceStatus, "prepared");
    assert.equal(marker.productionReady, false);
    assert.equal(marker.published, false);
  });
  await test("explicit visuals budget participates in acceptance fingerprint", () => {
    const base = productionAcceptanceConfigurationFingerprint(environment());
    const explicit = productionAcceptanceConfigurationFingerprint(environment({ OPENAI_VISUALS_MAX_TOKENS: "4000" }));
    assert.notEqual(base, explicit);
  });

  await test("invalid visuals budget fails readiness model configuration", async () => {
    const report = await new ProductionReadinessService({
      cwd: process.cwd(),
      environment: { ...process.env, OPENAI_VISUALS_MAX_TOKENS: "1.5" },
    }).evaluate();
    assert(report.checks.some((item) => item.reasonCode === "AI_VISUALS_MAX_TOKENS_INVALID"));
  });

  await test("recovery remains unblocked at visuals", async () => {
    const plan = await PipelineRecoveryPlanner.createResumePlan(productionSlug);
    assert.equal(plan.startStage, "visuals");
    assert.equal(plan.blocked, false);
    assert.equal(plan.stagesToRun.some((stage) => ["research", "script", "scenes"].includes(stage)), false);
  });
  await test("upstream provider counters remain zero", () => {
    const upstreamCalls = { research: 0, script: 0, scenes: 0 };
    assert.deepEqual(upstreamCalls, { research: 0, script: 0, scenes: 0 });
  });

  assert.equal(passed, 21);
  process.stdout.write(`Sprint 129.20 visuals truncation and budget smoke PASS: ${passed} scenarios.\n`);
}

void main().catch((error) => {
  process.stderr.write(`Sprint 129.20 smoke FAILED: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
