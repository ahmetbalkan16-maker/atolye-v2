import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AIUsageManager } from "../src/lib/ai/AIUsageManager";
import { AnimationAssetPipeline, AnimationMotionPlanError } from "../src/lib/animation/AnimationAssetPipeline";
import {
  animationSchemaIssueLimit,
  canonicalAnimationProviderSchema,
  createAnimationMotionPlanSystemPrompt,
  validateAnimationProviderPlan,
} from "../src/lib/animation/AnimationStructuredOutput";
import { OpenAIAnimationProvider } from "../src/lib/animation/providers/OpenAIAnimationProvider";
import type { AnimationGenerationInput, AnimationProvider } from "../src/lib/animation/providers/AnimationProvider";
import type { OpenAIAnimationProviderConfig } from "../src/lib/animation/providers/AnimationProviderConfig";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import type { AnimationScene } from "../src/types/animation";
import type { SceneData } from "../src/types/scene";
import type { VisualData } from "../src/types/visual";

const productionSlug = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
const endpoint = "https://api.openai.com/v1/chat/completions";
let passed = 0;

async function test(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

function frame(scale: number) {
  return {
    crop: { x: 0, y: 0, width: 1, height: 1 },
    transform: { scale, translateX: 0, translateY: 0 },
  };
}

function plan() {
  return { motionType: "zoom-in", start: frame(1), end: frame(1.2), transition: "fade" };
}

function input(sceneId = 1): AnimationGenerationInput {
  return {
    sceneId,
    animationPrompt: "Slow cinematic camera movement",
    sourceImageAssetId: `image-${sceneId}`,
    durationSeconds: 15,
  };
}

function config(): OpenAIAnimationProviderConfig {
  return {
    model: "gpt-4.1-mini",
    endpoint,
    timeoutMs: 100,
    retryCount: 0,
    maximumResponseBytes: 256 * 1024,
  };
}

function response(content: string) {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
  }), { status: 200 });
}

function completionResponse(input: {
  content?: unknown;
  finishReason?: string;
  refusal?: string;
}) {
  return new Response(JSON.stringify({
    choices: [{
      finish_reason: input.finishReason ?? "stop",
      message: {
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.refusal !== undefined ? { refusal: input.refusal } : {}),
      },
    }],
    usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
  }), { status: 200 });
}

function hash(filePath: string) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function inventory(root: string, names?: readonly string[]) {
  const files = names ?? walk(root);
  return files.map((name) => {
    const filePath = names ? path.join(root, name) : name;
    return { path: path.relative(root, filePath), bytes: fs.statSync(filePath).size, sha256: hash(filePath) };
  });
}

function walk(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }).sort();
}

async function main() {
  if (!process.env.ATOLYE_12922_WORKSPACE) {
    const repository = process.cwd();
    const realProject = ProjectReader.getProjectFolder(productionSlug);
    const realBefore = inventory(realProject);
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-12922-"));
    const copiedProject = path.join(workspace, "data", "projects", productionSlug);
    fs.mkdirSync(path.dirname(copiedProject), { recursive: true });
    fs.cpSync(realProject, copiedProject, { recursive: true });
    try {
      const child = spawnSync(process.execPath, [
        path.join(repository, "node_modules", "tsx", "dist", "cli.mjs"),
        path.resolve(import.meta.filename),
      ], {
        cwd: workspace,
        encoding: "utf8",
        env: {
          ...process.env,
          ATOLYE_12922_WORKSPACE: workspace,
          OPENAI_API_KEY: "configured-for-smoke",
          TSX_TSCONFIG_PATH: path.join(repository, "tsconfig.json"),
        },
      });
      process.stdout.write(child.stdout);
      process.stderr.write(child.stderr);
      assert.equal(child.status, 0, `Isolated smoke failed with status ${child.status}.`);
      assert.deepEqual(inventory(realProject), realBefore);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
    return;
  }

  await test("canonical schema is strict and excludes platform-owned fields", () => {
    assert.equal(canonicalAnimationProviderSchema.additionalProperties, false);
    assert.deepEqual(canonicalAnimationProviderSchema.providerOwnedFields, ["motionType", "start", "end", "transition"]);
    assert(canonicalAnimationProviderSchema.applicationOwnedFields.includes("sceneId"));
    assert.equal(canonicalAnimationProviderSchema.jsonSchema.additionalProperties, false);
  });

  await test("valid exact provider response is accepted", () => {
    const literal = JSON.parse('{"motionType":"zoom-in","start":{"crop":{"x":0,"y":0,"width":1,"height":1},"transform":{"scale":1,"translateX":0,"translateY":0}},"end":{"crop":{"x":0,"y":0,"width":1,"height":1},"transform":{"scale":1.2,"translateX":0,"translateY":0}},"transition":"fade"}');
    assert.equal(validateAnimationProviderPlan(literal).success, true);
  });

  const missingTransition: Partial<ReturnType<typeof plan>> = plan();
  delete missingTransition.transition;
  const rejected: Array<[string, unknown, string, string]> = [
    ["missing required field", missingTransition, "$.transition", "MISSING_REQUIRED_FIELD"],
    ["unknown top-level field", { ...plan(), metadata: {} }, "$.metadata", "UNKNOWN_FIELD"],
    ["unknown nested field", { ...plan(), start: { ...frame(1), index: 0 } }, "$.start.index", "UNKNOWN_FIELD"],
    ["wrong enum", { ...plan(), motionType: "spin" }, "$.motionType", "INVALID_ENUM"],
    ["wrong primitive type", { ...plan(), transition: 1 }, "$.transition", "WRONG_TYPE"],
    ["unexpected null", { ...plan(), start: null }, "$.start", "WRONG_TYPE"],
    ["platform-owned fields", { ...plan(), sceneId: 1, sourceImageAssetId: "image-1", durationSeconds: 15 }, "$.sceneId", "UNKNOWN_FIELD"],
  ];
  for (const [name, value, issuePath, issueCode] of rejected) {
    await test(`${name} is rejected with exact issue`, () => {
      const result = validateAnimationProviderPlan(value);
      assert.equal(result.success, false);
      if (result.success) assert.fail("Expected schema failure.");
      assert(result.issues.some((item) => item.path === issuePath && item.code === issueCode));
    });
  }

  await test("duplicate platform identifier JSON remains rejected", () => {
    const duplicated = JSON.parse(`{"sceneId":1,"sceneId":2,${JSON.stringify(plan()).slice(1)}`);
    const result = validateAnimationProviderPlan(duplicated);
    assert.equal(result.success, false);
    if (!result.success) assert(result.issues.some((item) => item.path === "$.sceneId" && item.code === "UNKNOWN_FIELD"));
  });

  await test("issue telemetry is bounded and contains categories, not values", () => {
    const invalid = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`unsafeField${index}`, `secret-value-${index}`]));
    const result = validateAnimationProviderPlan(invalid);
    assert.equal(result.success, false);
    if (result.success) assert.fail("Expected schema failure.");
    assert.equal(result.issueCount, 24);
    assert.equal(result.issues.length, animationSchemaIssueLimit);
    assert.equal(JSON.stringify(result.issues).includes("secret-value"), false);
    assert(result.issues.every((item) => item.path.length <= 120));
  });

  await test("hostile and overlong unknown keys use a bounded canonical path", () => {
    const hostileKey = `api-key-${"secret".repeat(30)}`;
    const result = validateAnimationProviderPlan({ ...plan(), [hostileKey]: "raw-secret-value" });
    assert.equal(result.success, false);
    if (result.success) assert.fail("Expected schema failure.");
    const unknown = result.issues.find((item) => item.code === "UNKNOWN_FIELD");
    assert.equal(unknown?.path, "$.unknownField");
    assert.equal(JSON.stringify(result).includes(hostileKey), false);
    assert.equal(JSON.stringify(result).includes("raw-secret-value"), false);
  });

  await test("request prompt and strict response format match canonical ownership", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const provider = new OpenAIAnimationProvider(async (_url, init) => {
      requestBody = JSON.parse(init?.body as string);
      return response(JSON.stringify(plan()));
    }, config);
    const result = await provider.generateAnimation(input());
    assert.equal(result.success, true);
    const responseFormat = requestBody?.response_format as { type?: string; json_schema?: { strict?: boolean; schema?: unknown } };
    assert.equal(responseFormat.type, "json_schema");
    assert.equal(responseFormat.json_schema?.strict, true);
    assert.deepEqual(responseFormat.json_schema?.schema, canonicalAnimationProviderSchema.jsonSchema);
    const messages = requestBody?.messages as Array<{ content: string }>;
    const providerInput = JSON.parse(messages[1].content);
    assert.equal(providerInput.sceneId, undefined);
    assert.equal(providerInput.sourceImageAssetId, undefined);
    assert.equal(messages[0].content, createAnimationMotionPlanSystemPrompt());
  });

  await test("successful validation adds canonical platform-owned fields", async () => {
    const literal = '{"motionType":"zoom-in","start":{"crop":{"x":0,"y":0,"width":1,"height":1},"transform":{"scale":1,"translateX":0,"translateY":0}},"end":{"crop":{"x":0,"y":0,"width":1,"height":1},"transform":{"scale":1.2,"translateX":0,"translateY":0}},"transition":"fade"}';
    const result = await new OpenAIAnimationProvider(async () => response(literal), config)
      .generateAnimation(input(4));
    assert.equal(result.success, true);
    if (!result.success) assert.fail("Expected success.");
    assert.equal(result.sceneId, 4);
    assert.equal(result.sourceImageAssetId, "image-4");
    assert.equal(result.durationSeconds, 15);
    assert.match(result.requestIdentity ?? "", /^[a-f0-9]{64}$/);
    assert.equal((result as Record<string, unknown>).createdAt, undefined);
  });

  await test("length, refusal and incomplete completions fail before parsing", async () => {
    const cases = [
      [completionResponse({ content: "{", finishReason: "length" }), "ANIMATION_RESPONSE_TRUNCATED"],
      [completionResponse({ refusal: "raw refusal text" }), "ANIMATION_PROVIDER_REFUSAL"],
      [completionResponse({ content: JSON.stringify(plan()), finishReason: "content_filter" }), "ANIMATION_RESPONSE_INCOMPLETE"],
      [completionResponse({ content: { unexpected: true } }), "ANIMATION_RESPONSE_INCOMPLETE"],
    ] as const;
    for (const [providerResponse, code] of cases) {
      const result = await new OpenAIAnimationProvider(async () => providerResponse.clone(), config).generateAnimation(input());
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.error, code);
        assert.equal(JSON.stringify(result.diagnostic).includes("raw refusal text"), false);
      }
    }
  });

  await test("empty, whitespace and invalid JSON retain canonical errors", async () => {
    for (const [content, code] of [["", "ANIMATION_RESPONSE_EMPTY"], ["   ", "ANIMATION_RESPONSE_EMPTY"], ["not-json", "ANIMATION_RESPONSE_INVALID_JSON"]]) {
      const result = await new OpenAIAnimationProvider(async () => response(content), config).generateAnimation(input());
      assert.equal(result.success, false);
      if (!result.success) assert.equal(result.error, code);
    }
  });

  const projectRoot = ProjectReader.getProjectFolder(productionSlug);
  const immutableNames = [
    "research.json", "script.json", "scenes.json", "visuals.json", "assets/assets.json",
    ...fs.readdirSync(path.join(projectRoot, "assets", "images")).sort().map((name) => `assets/images/${name}`),
  ];
  const immutableBefore = inventory(projectRoot, immutableNames);
  const project = await ProjectReader.readJSON<{ id: string }>(productionSlug, "project.json");
  const visuals = await ProjectReader.readJSON<VisualData>(productionSlug, "visuals.json");
  const scenes = await ProjectReader.readJSON<SceneData>(productionSlug, "scenes.json");
  assert(project && visuals && scenes);
  const animationScenes: AnimationScene[] = visuals.scenes.map((visual) => ({
    sceneId: visual.sceneId,
    animationPrompt: visual.animationPrompt,
    durationSeconds: scenes.scenes.find((scene) => scene.id === visual.sceneId)?.duration ?? 15,
    status: "planned",
  }));
  const invalidContent = JSON.stringify({
    ...plan(),
    motionType: "unsafe-secret-motion-value",
    rawResponse: "must-never-persist",
  });
  const invalidProvider = new OpenAIAnimationProvider(async () => response(invalidContent), config);
  let failure: AnimationMotionPlanError | undefined;
  try {
    await AnimationAssetPipeline.generateAnimationAssets({
      projectId: project.id,
      projectSlug: productionSlug,
      scenes: animationScenes,
      provider: invalidProvider,
    });
  } catch (error) {
    assert(error instanceof AnimationMotionPlanError);
    failure = error;
  }
  assert(failure);

  await test("schema-invalid pipeline error carries bounded safe exact evidence", () => {
    assert.equal(failure?.code, "ANIMATION_RESPONSE_SCHEMA_INVALID");
    assert.equal(failure?.evidence.sceneId, 1);
    assert.equal(failure?.evidence.phase, "provider-response");
    assert.equal(failure?.evidence.finishReason, "stop");
    assert.equal(failure?.evidence.responseLength, invalidContent.length);
    assert.equal(failure?.evidence.issueCount, 2);
    assert(failure?.evidence.schemaIssues?.some((item) => item.path === "$.motionType" && item.code === "INVALID_ENUM"));
    const serialized = JSON.stringify(failure?.evidence);
    assert.equal(serialized.includes("unsafe-secret-motion-value"), false);
    assert.equal(serialized.includes("must-never-persist"), false);
  });

  await test("AI usage stores safe issue metadata without raw payload", async () => {
    const usage = await AIUsageManager.getUsageLog(productionSlug);
    const record = usage.records.findLast((item) => item.operation === "animation-motion-plan-scene-1");
    assert.equal(record?.issueCount, 2);
    assert(record?.schemaIssues?.some((item) => item.path === "$.rawResponse" && item.code === "UNKNOWN_FIELD"));
    assert.equal(JSON.stringify(record).includes("must-never-persist"), false);
  });

  await test("AI usage sanitizes hostile custom-provider diagnostics", async () => {
    const hostile: AnimationProvider = {
      name: "openai",
      getRequestIdentity(value) {
        return { assetId: `animation-hostile-${value.sceneId}`, requestIdentity: `hostile-${value.sceneId}`, promptDigest: `digest-${value.sceneId}`, model: "gpt-4.1-mini" };
      },
      async generateAnimation(value) {
        return {
          success: false,
          sceneId: value.sceneId,
          sourceImageAssetId: value.sourceImageAssetId,
          provider: "openai",
          model: "raw model secret",
          generationMode: "production",
          error: "ANIMATION_RESPONSE_SCHEMA_INVALID",
          diagnostic: {
            sceneId: value.sceneId,
            phase: "provider-response",
            provider: "openai",
            reason: "raw reason secret",
            issueCount: 1,
            schemaIssues: [{ path: "$.api-key", code: "UNKNOWN_FIELD", expected: "forbidden", received: "string" }],
          },
        };
      },
    };
    await assert.rejects(() => AnimationAssetPipeline.generateAnimationAssets({
      projectId: project.id,
      projectSlug: productionSlug,
      scenes: animationScenes,
      provider: hostile,
    }));
    const usage = await AIUsageManager.getUsageLog(productionSlug);
    const record = usage.records.findLast((item) => item.operation === "animation-motion-plan-scene-1");
    assert.equal(record?.model, undefined);
    assert.equal(record?.schemaIssues, undefined);
    assert.equal(JSON.stringify(record).includes("raw model secret"), false);
    assert.equal(JSON.stringify(record).includes("raw reason secret"), false);
    assert.equal(JSON.stringify(record).includes("api-key"), false);
  });

  await test("validation failure writes no animation artifact, registry or upstream state", () => {
    assert.equal(fs.existsSync(path.join(projectRoot, "animation.json")), false);
    assert.equal(fs.existsSync(path.join(projectRoot, "assets", "animations")), false);
    assert.deepEqual(inventory(projectRoot, immutableNames), immutableBefore);
  });

  await test("failed production recovery remains animation and unblocked", async () => {
    const recovery = await PipelineRecoveryPlanner.createResumePlan(productionSlug);
    assert.equal(recovery.startStage, "animation");
    assert.equal(recovery.blocked, false);
  });

  process.stdout.write(`Sprint 129.22 animation structured output smoke: PASS (${passed}/${passed})\n`);
}

void main();
