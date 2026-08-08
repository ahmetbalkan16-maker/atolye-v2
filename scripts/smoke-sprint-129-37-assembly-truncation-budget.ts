import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  AssemblyAIConfigError,
  getAssemblyMaxTokens,
} from "../src/lib/assembly/AssemblyAIConfig";
import { AssemblyManager } from "../src/lib/assembly/AssemblyManager";
import { AIResponseError } from "../src/lib/ai/AIResponseError";
import { AIUsageManager } from "../src/lib/ai/AIUsageManager";
import {
  GenerationFallbackBlockedError,
  strictGenerationExecutionPolicy,
} from "../src/lib/ai/GenerationExecutionPolicy";
import type {
  AIProvider,
  AIProviderGenerateOptions,
  AIProviderResult,
} from "../src/lib/ai/providers";
import { runObservedAIRequest } from "../src/lib/ai/runObservedAIRequest";
import { createProductionAcceptancePortableConfigurationSnapshotV2 } from "../src/lib/production/ProductionAcceptanceConfigurationFingerprint";
import type { AssemblyPlanData } from "../src/types/assembly";
import type { AudioData } from "../src/types/audio";
import type { SceneData } from "../src/types/scene";
import type { ScriptData } from "../src/types/script";
import type { VisualData } from "../src/types/visual";

const productionSlug = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const existingEnvironmentPolicyFingerprint = "f717b834151a26f985b78cde892d4162e36272b92e61880b4ed52ce6b05e894d";
const timestamp = "2026-08-08T00:00:00.000Z";
let passed = 0;

async function test(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

function environment(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...overrides } as NodeJS.ProcessEnv;
}

function fixtures(): {
  script: ScriptData;
  scenes: SceneData;
  visuals: VisualData;
  audio: AudioData;
  assembly: AssemblyPlanData;
} {
  const script: ScriptData = {
    topic: "Assembly budget",
    title: "Assembly budget",
    subtitle: "Regression",
    hook: "Hook",
    introduction: "Introduction",
    chapters: [{
      id: 1,
      title: "Chapter 1",
      narration: "Canonical narration.",
      duration: 30,
      visualGoal: "Documentary",
      emotion: "serious",
      transition: "fade",
    }],
    conclusion: "Conclusion",
    callToAction: "Subscribe",
    estimatedDuration: 30,
    narrationWordCount: 2,
    targetAudience: "general",
    language: "tr",
    voiceStyle: "documentary",
    musicStyle: "cinematic",
    thumbnailIdea: "Documentary",
    seoKeywords: ["assembly"],
    createdAt: timestamp,
  };
  const scenes: SceneData = {
    scenes: [{
      id: 1,
      chapterId: 1,
      title: "Scene 1",
      description: "Canonical scene.",
      duration: 30,
    }],
    createdAt: timestamp,
  };
  const visuals: VisualData = {
    projectId: "assembly-budget",
    scenes: [{
      sceneId: 1,
      visualPrompt: "Historical documentary scene.",
      animationPrompt: "Slow zoom.",
      style: "documentary",
    }],
    thumbnail: {
      title: "Assembly",
      prompt: "Documentary thumbnail.",
      composition: "Centered",
      mood: "serious",
    },
    createdAt: timestamp,
  };
  const audio: AudioData = {
    narrator: { style: "documentary", tone: "serious", language: "tr" },
    sections: [{
      chapterId: 1,
      title: "Chapter 1",
      duration: "00:30",
      emotion: "serious",
      emphasis: ["canonical"],
      narrationNotes: "Clear narration.",
      pacing: "medium",
      sourceText: "Canonical narration.",
    }],
    music: { mood: "cinematic", suggestion: "orchestral", intensity: "medium" },
    production: {
      targetFormat: "wav",
      sampleRate: 44100,
      estimatedTotalDuration: "00:30",
      generationStatus: "generated",
    },
    createdAt: timestamp,
  };
  const assembly: AssemblyPlanData = {
    scenes: [{
      sceneId: 1,
      chapterId: 1,
      duration: "00:30",
      visualReference: "visual-1",
      audioReference: "section-1",
      transition: "fade",
      cameraMovement: "slow zoom",
      effects: ["cinematic grade"],
      notes: "Canonical scene.",
    }],
    totalDuration: "00:30",
    style: "documentary cinematic",
    render: { status: "planned", format: "mp4" },
    createdAt: timestamp,
  };
  return { script, scenes, visuals, audio, assembly };
}

function provider(
  value: AIProviderResult | Error,
  onCall?: (options?: AIProviderGenerateOptions) => void,
): AIProvider {
  return {
    async generate(_prompt, options) {
      onCall?.(options);
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

function result(
  content: string,
  overrides: Partial<AIProviderResult> = {},
): AIProviderResult {
  return {
    content,
    finishReason: "stop",
    refused: false,
    complete: true,
    truncated: false,
    usage: { promptTokens: 100, completionTokens: 500, totalTokens: 600 },
    ...overrides,
  };
}

async function generateWith(
  aiProvider: AIProvider,
): Promise<AssemblyPlanData> {
  const value = fixtures();
  return AssemblyManager.generateAssemblyPlan(
    value.script,
    value.scenes,
    value.visuals,
    value.audio,
    {},
    { projectSlug: "assembly-budget", operation: "assembly-plan", stage: "assembly" },
    { aiProvider, generationPolicy: strictGenerationExecutionPolicy },
  );
}

async function main() {
  if (!process.env.ATOLYE_12937_WORKSPACE) {
    const repository = process.cwd();
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-12937-"));
    try {
      const executable = path.join(repository, "node_modules", "tsx", "dist", "cli.mjs");
      const child = spawnSync(process.execPath, [executable, path.resolve(import.meta.filename)], {
        cwd: workspace,
        env: {
          ...process.env,
          ATOLYE_12937_WORKSPACE: workspace,
          TSX_TSCONFIG_PATH: path.join(repository, "tsconfig.json"),
          OPENAI_ASSEMBLY_MAX_TOKENS: "",
        },
        encoding: "utf8",
      });
      process.stdout.write(child.stdout ?? "");
      process.stderr.write(child.stderr ?? "");
      assert.equal(child.status, 0, `isolated smoke exited with ${child.status}`);
      return;
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }

  const originalAppend = AIUsageManager.appendRecord;
  AIUsageManager.appendRecord = async (record) => ({
    projectSlug: record.projectSlug,
    records: [record],
    createdAt: record.createdAt,
    updatedAt: record.createdAt,
  });
  delete process.env.OPENAI_ASSEMBLY_MAX_TOKENS;

  try {
    await test("unset assembly budget uses 3200", () => {
      assert.equal(getAssemblyMaxTokens(environment({ OPENAI_MAX_TOKENS: "1200" })), 3200);
    });
    for (const value of [1600, 3200, 6000]) {
      await test(`assembly budget accepts ${value}`, () => {
        assert.equal(getAssemblyMaxTokens(environment({ OPENAI_ASSEMBLY_MAX_TOKENS: String(value) })), value);
      });
    }
    for (const value of ["1599", "6001", "", "   ", "1.5", "alphabetic", "9007199254740992"]) {
      await test(`assembly budget rejects ${JSON.stringify(value)}`, () => {
        assert.throws(
          () => getAssemblyMaxTokens(environment({ OPENAI_ASSEMBLY_MAX_TOKENS: value })),
          (error) => error instanceof AssemblyAIConfigError &&
            error.code === "AI_ASSEMBLY_MAX_TOKENS_INVALID",
        );
      });
    }

    await test("AssemblyManager propagates the default budget", async () => {
      let actual: number | undefined;
      const value = fixtures();
      await generateWith(provider(result(JSON.stringify(value.assembly)), (options) => {
        actual = options?.maxTokens;
      }));
      assert.equal(actual, 3200);
    });

    await test("AssemblyManager propagates an explicit valid override", async () => {
      process.env.OPENAI_ASSEMBLY_MAX_TOKENS = "4800";
      let actual: number | undefined;
      try {
        const value = fixtures();
        await generateWith(provider(result(JSON.stringify(value.assembly)), (options) => {
          actual = options?.maxTokens;
        }));
        assert.equal(actual, 4800);
      } finally {
        delete process.env.OPENAI_ASSEMBLY_MAX_TOKENS;
      }
    });

    await test("observed length completion is classified as AI_RESPONSE_TRUNCATED", async () => {
      const observed = await runObservedAIRequest({
        prompt: "assembly",
        context: { projectSlug: "assembly-budget", operation: "assembly-plan", stage: "assembly" },
        provider: provider(result("{", {
          finishReason: "length",
          complete: false,
          truncated: true,
          usage: { promptTokens: 100, completionTokens: 3200, totalTokens: 3300 },
        })),
        maxTokens: 3200,
      });
      assert.equal(observed.errorCode, "AI_RESPONSE_TRUNCATED");
    });

    await test("strict assembly truncation preserves the authentic error", async () => {
      let calls = 0;
      await assert.rejects(
        () => generateWith(provider(result("{", {
          finishReason: "length",
          complete: false,
          truncated: true,
          usage: { promptTokens: 100, completionTokens: 3200, totalTokens: 3300 },
        }), () => { calls += 1; })),
        (error) => error instanceof AIResponseError &&
          error.code === "AI_RESPONSE_TRUNCATED" &&
          !(error instanceof GenerationFallbackBlockedError),
      );
      assert.equal(calls, 1);
    });

    const observedFailures: Array<[string, AIProvider]> = [
      ["AI_RESPONSE_INCOMPLETE", provider(result("{}", { complete: false }))],
      ["AI_PROVIDER_REFUSAL", provider(result("", { refused: true }))],
      ["AI_PROVIDER_REQUEST_FAILED", provider(new Error("provider failed"))],
    ];
    for (const [code, aiProvider] of observedFailures) {
      await test(`strict assembly preserves ${code}`, async () => {
        await assert.rejects(
          () => generateWith(aiProvider),
          (error) => error instanceof AIResponseError && error.code === code,
        );
      });
    }

    await test("strict assembly preserves AI_USAGE_PERSISTENCE_FAILED", async () => {
      const value = fixtures();
      AIUsageManager.appendRecord = async () => { throw new Error("fixture persistence failure"); };
      try {
        await assert.rejects(
          () => generateWith(provider(result(JSON.stringify(value.assembly)))),
          (error) => error instanceof AIResponseError &&
            error.code === "AI_USAGE_PERSISTENCE_FAILED",
        );
      } finally {
        AIUsageManager.appendRecord = async (record) => ({
          projectSlug: record.projectSlug,
          records: [record],
          createdAt: record.createdAt,
          updatedAt: record.createdAt,
        });
      }
    });

    await test("invalid explicit config fails before provider admission", async () => {
      process.env.OPENAI_ASSEMBLY_MAX_TOKENS = "1599";
      let calls = 0;
      try {
        await assert.rejects(
          () => generateWith(provider(result("{}"), () => { calls += 1; })),
          AssemblyAIConfigError,
        );
        assert.equal(calls, 0);
      } finally {
        delete process.env.OPENAI_ASSEMBLY_MAX_TOKENS;
      }
    });

    await test("complete malformed assembly shape remains fallback blocked", async () => {
      await assert.rejects(
        () => generateWith(provider(result(JSON.stringify({ scenes: [] })))),
        (error) => error instanceof GenerationFallbackBlockedError &&
          error.code === "GENERATION_FALLBACK_BLOCKED",
      );
    });

    await test("unset assembly budget preserves the existing profile-2 identity", async () => {
      const base = await createProductionAcceptancePortableConfigurationSnapshotV2(
        productionSlug,
        environment(),
      );
      const explicitlyUnset = await createProductionAcceptancePortableConfigurationSnapshotV2(
        productionSlug,
        environment({ OPENAI_ASSEMBLY_MAX_TOKENS: undefined }),
      );
      assert.equal(base.configurationFingerprint, explicitlyUnset.configurationFingerprint);
      assert.equal(base.componentFingerprints.ENVIRONMENT_POLICY, existingEnvironmentPolicyFingerprint);
      assert.equal(explicitlyUnset.componentFingerprints.ENVIRONMENT_POLICY, existingEnvironmentPolicyFingerprint);
    });

    await test("explicit assembly budget changes profile-2 identity deterministically", async () => {
      const base = await createProductionAcceptancePortableConfigurationSnapshotV2(
        productionSlug,
        environment(),
      );
      const explicitA = await createProductionAcceptancePortableConfigurationSnapshotV2(
        productionSlug,
        environment({ OPENAI_ASSEMBLY_MAX_TOKENS: "4800" }),
      );
      const explicitB = await createProductionAcceptancePortableConfigurationSnapshotV2(
        productionSlug,
        environment({ OPENAI_ASSEMBLY_MAX_TOKENS: "4800" }),
      );
      assert.notEqual(base.configurationFingerprint, explicitA.configurationFingerprint);
      assert.notEqual(
        base.componentFingerprints.ENVIRONMENT_POLICY,
        explicitA.componentFingerprints.ENVIRONMENT_POLICY,
      );
      assert.equal(explicitA.configurationFingerprint, explicitB.configurationFingerprint);
      assert.equal(
        explicitA.componentFingerprints.ENVIRONMENT_POLICY,
        explicitB.componentFingerprints.ENVIRONMENT_POLICY,
      );
    });

    assert.equal(passed, 23);
    process.stdout.write(`Sprint 129.37 assembly truncation budget smoke PASS: ${passed} scenarios.\n`);
  } finally {
    AIUsageManager.appendRecord = originalAppend;
    delete process.env.OPENAI_ASSEMBLY_MAX_TOKENS;
  }
}

void main().catch((error) => {
  process.stderr.write(`Sprint 129.37 smoke FAILED: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
