import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  AudioAIConfigError,
  audioTokenBudget,
  getAudioMaxTokens,
} from "../src/lib/ai/AudioAIConfig";
import {
  GenerationFallbackBlockedError,
  strictGenerationExecutionPolicy,
} from "../src/lib/ai/GenerationExecutionPolicy";
import { runObservedAIRequest } from "../src/lib/ai/runObservedAIRequest";
import type {
  AIProvider,
  AIProviderGenerateOptions,
  AIProviderResult,
} from "../src/lib/ai/providers";
import { getVisualsMaxTokens } from "../src/lib/ai/VisualsAIConfig";
import { AudioManager } from "../src/lib/audio/AudioManager";
import { productionAcceptanceConfigurationFingerprint } from "../src/lib/production/ProductionAcceptancePolicy";
import { createProductionAcceptancePortableConfigurationSnapshotV2 } from "../src/lib/production/ProductionAcceptanceConfigurationFingerprint";
import { ProductionReadinessService } from "../src/lib/production/ProductionReadinessService";
import type { ScriptData } from "../src/types/script";

const productionSlug = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
let passed = 0;

async function test(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
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

function environment(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...overrides } as NodeJS.ProcessEnv;
}

function script(): ScriptData {
  return {
    topic: "Production audio budget",
    title: "Production audio budget",
    subtitle: "Regression",
    hook: "Hook",
    introduction: "Introduction",
    chapters: [{
      id: 1,
      title: "Chapter 1",
      narration: "Canonical narration source text.",
      duration: 15,
      visualGoal: "Documentary",
      emotion: "serious",
      transition: "cut",
    }],
    conclusion: "Conclusion",
    callToAction: "Subscribe",
    estimatedDuration: 15,
    narrationWordCount: 4,
    targetAudience: "general",
    language: "tr",
    voiceStyle: "deep documentary",
    musicStyle: "cinematic",
    thumbnailIdea: "Documentary",
    seoKeywords: ["audio"],
    createdAt: "2026-07-17T20:00:00.000Z",
  };
}

function audioResponse() {
  return JSON.stringify({
    narrator: { style: "deep documentary", tone: "serious", language: "tr" },
    sections: [{
      chapterId: 1,
      title: "Chapter 1",
      duration: "00:15",
      emotion: "serious",
      emphasis: ["canonical"],
      narrationNotes: "Clear documentary narration.",
      pacing: "medium",
      sourceText: "Canonical narration source text.",
    }],
    music: { mood: "cinematic", suggestion: "orchestral", intensity: "medium" },
    production: {
      targetFormat: "mp3",
      sampleRate: 44100,
      estimatedTotalDuration: "00:15",
      generationStatus: "planned",
    },
    createdAt: "2026-07-17T20:00:00.000Z",
  });
}

function result(overrides: Partial<AIProviderResult> = {}): AIProviderResult {
  return {
    content: audioResponse(),
    finishReason: "stop",
    refused: false,
    complete: true,
    truncated: false,
    usage: { promptTokens: 100, completionTokens: 500, totalTokens: 600 },
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

async function main() {
  if (!process.env.ATOLYE_12926_WORKSPACE) {
    const repository = process.cwd();
    const production = path.join(repository, "data", "projects", productionSlug);
    const before = digest(production);
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-12926-"));
    try {
      const executable = path.join(repository, "node_modules", "tsx", "dist", "cli.mjs");
      const child = spawnSync(process.execPath, [executable, path.resolve(import.meta.filename)], {
        cwd: workspace,
        env: {
          ...process.env,
          ATOLYE_12926_WORKSPACE: workspace,
          TSX_TSCONFIG_PATH: path.join(repository, "tsconfig.json"),
          OPENAI_AUDIO_MAX_TOKENS: "",
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

  delete process.env.OPENAI_AUDIO_MAX_TOKENS;

  await test("unset audio budget uses the dedicated default", () => {
    assert.equal(getAudioMaxTokens(environment({ OPENAI_MAX_TOKENS: "1200" })), 3200);
  });

  await test("audio budget accepts inclusive bounds", () => {
    assert.equal(getAudioMaxTokens(environment({ OPENAI_AUDIO_MAX_TOKENS: String(audioTokenBudget.minimumTokens) })), audioTokenBudget.minimumTokens);
    assert.equal(getAudioMaxTokens(environment({ OPENAI_AUDIO_MAX_TOKENS: String(audioTokenBudget.maximumTokens) })), audioTokenBudget.maximumTokens);
  });

  for (const value of ["", "0", "-1", "1.5", "not-a-number", String(audioTokenBudget.minimumTokens - 1), String(audioTokenBudget.maximumTokens + 1)]) {
    await test(`audio budget rejects ${JSON.stringify(value)}`, () => {
      assert.throws(() => getAudioMaxTokens(environment({ OPENAI_AUDIO_MAX_TOKENS: value })), AudioAIConfigError);
    });
  }

  let effectiveMaxTokens: number | undefined;
  await test("AudioManager propagates the effective default to the provider", async () => {
    const generated = await AudioManager.generateAudioData(
      script(),
      { projectSlug: "sprint-129-26-default", stage: "audio" },
      {
        aiProvider: provider(result(), (options) => { effectiveMaxTokens = options?.maxTokens; }),
        generationPolicy: strictGenerationExecutionPolicy,
      },
    );
    assert.equal(generated.sections.length, 1);
    assert.equal(effectiveMaxTokens, 3200);
  });

  await test("explicit audio budget reaches the provider", async () => {
    process.env.OPENAI_AUDIO_MAX_TOKENS = "4000";
    let explicitMaxTokens: number | undefined;
    try {
      await AudioManager.generateAudioData(
        script(),
        { projectSlug: "sprint-129-26-explicit", stage: "audio" },
        {
          aiProvider: provider(result(), (options) => { explicitMaxTokens = options?.maxTokens; }),
          generationPolicy: strictGenerationExecutionPolicy,
        },
      );
      assert.equal(explicitMaxTokens, 4000);
      assert.equal(getVisualsMaxTokens(environment({ OPENAI_AUDIO_MAX_TOKENS: "4000" })), 3200);
    } finally {
      delete process.env.OPENAI_AUDIO_MAX_TOKENS;
    }
  });

  await test("finish reason length remains AI_RESPONSE_TRUNCATED", async () => {
    const observed = await runObservedAIRequest({
      prompt: "audio",
      provider: provider(result({ finishReason: "length", complete: false, truncated: true })),
      maxTokens: getAudioMaxTokens(),
      context: { projectSlug: "sprint-129-26-truncation", operation: "audio-plan", stage: "audio" },
    });
    assert.equal(observed.errorCode, "AI_RESPONSE_TRUNCATED");
    assert.equal(observed.truncated, true);
  });

  await test("strict audio truncation remains GENERATION_FALLBACK_BLOCKED", async () => {
    let calls = 0;
    await assert.rejects(
      () => AudioManager.generateAudioData(
        script(),
        { projectSlug: "sprint-129-26-strict", stage: "audio" },
        {
          aiProvider: provider(result({
            finishReason: "length",
            complete: false,
            truncated: true,
          }), () => { calls += 1; }),
          generationPolicy: strictGenerationExecutionPolicy,
        },
      ),
      (error) => error instanceof GenerationFallbackBlockedError && error.code === "GENERATION_FALLBACK_BLOCKED",
    );
    assert.equal(calls, 1);
  });

  await test("invalid explicit audio budget fails before provider admission", async () => {
    process.env.OPENAI_AUDIO_MAX_TOKENS = "1.5";
    let calls = 0;
    try {
      await assert.rejects(
        () => AudioManager.generateAudioData(
          script(),
          { projectSlug: "sprint-129-26-invalid", stage: "audio" },
          {
            aiProvider: provider(result(), () => { calls += 1; }),
            generationPolicy: strictGenerationExecutionPolicy,
          },
        ),
        AudioAIConfigError,
      );
      assert.equal(calls, 0);
    } finally {
      delete process.env.OPENAI_AUDIO_MAX_TOKENS;
    }
  });

  await test("unset audio budget preserves the schema-2 acceptance fingerprint", () => {
    const base = productionAcceptanceConfigurationFingerprint(environment());
    const explicitlyUnset = productionAcceptanceConfigurationFingerprint(environment({ OPENAI_AUDIO_MAX_TOKENS: undefined }));
    assert.equal(base, explicitlyUnset);
  });

  await test("explicit audio budget participates in the acceptance fingerprint", () => {
    const base = productionAcceptanceConfigurationFingerprint(environment());
    const explicit = productionAcceptanceConfigurationFingerprint(environment({ OPENAI_AUDIO_MAX_TOKENS: "4000" }));
    assert.notEqual(base, explicit);
  });

  await test("unset audio budget preserves the schema-3 profile-2 fingerprint", async () => {
    const base = await createProductionAcceptancePortableConfigurationSnapshotV2("audio-budget", environment());
    const explicitlyUnset = await createProductionAcceptancePortableConfigurationSnapshotV2(
      "audio-budget",
      environment({ OPENAI_AUDIO_MAX_TOKENS: undefined }),
    );
    assert.equal(base.configurationFingerprint, explicitlyUnset.configurationFingerprint);
  });

  await test("explicit audio budget participates in schema-3 profile-2 environment policy", async () => {
    const base = await createProductionAcceptancePortableConfigurationSnapshotV2("audio-budget", environment());
    const explicit = await createProductionAcceptancePortableConfigurationSnapshotV2(
      "audio-budget",
      environment({ OPENAI_AUDIO_MAX_TOKENS: "4000" }),
    );
    assert.notEqual(base.configurationFingerprint, explicit.configurationFingerprint);
    assert.notEqual(base.componentFingerprints.ENVIRONMENT_POLICY, explicit.componentFingerprints.ENVIRONMENT_POLICY);
  });

  await test("invalid audio budget fails readiness model configuration", async () => {
    const report = await new ProductionReadinessService({
      cwd: process.cwd(),
      environment: { ...process.env, OPENAI_AUDIO_MAX_TOKENS: "1.5" },
    }).evaluate();
    assert(report.checks.some((item) => item.reasonCode === "AI_AUDIO_MAX_TOKENS_INVALID"));
  });

  assert.equal(passed, 19);
  process.stdout.write(`Sprint 129.26 audio truncation budget smoke PASS: ${passed} scenarios.\n`);
}

void main().catch((error) => {
  process.stderr.write(`Sprint 129.26 smoke FAILED: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
