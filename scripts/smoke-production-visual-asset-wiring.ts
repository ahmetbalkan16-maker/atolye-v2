import assert from "node:assert/strict";
import { emitSmokeResult } from "./lib/SmokeResult";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  VisualAssetGenerationError,
  VisualAssetPipeline,
} from "../src/lib/assets/VisualAssetPipeline";
import type {
  ImageGenerationInput,
  ImageProvider, ConfiguredImageProvider,
} from "../src/lib/assets/providers/ImageProvider";
import { createProviderDispatchAdapter } from
  "../src/lib/providers/ProviderDispatchAdapterAuthority";
import {
  IMAGE_PROVIDER_CONFIGURATION_ERROR,
  ImageProviderConfigurationError,
  resolveImageProviderName,
} from "../src/lib/assets/providers/ImageProviderConfig";
import { ImageProviderRouter } from "../src/lib/assets/providers/ImageProviderRouter";
import { MockImageProvider } from "../src/lib/assets/providers/MockImageProvider";
import { OpenAIImageProvider } from "../src/lib/assets/providers/OpenAIImageProvider";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import {
  materializePipelineStageExecutionOptions,
  PipelineStageExecutor,
  type PipelineExecutionState,
} from "../src/lib/pipeline/PipelineStageExecutor";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { createProductionAcceptanceProviderSelection, type ProductionAcceptanceProviderSelection } from
  "../src/lib/production/ProductionAcceptanceExecutionScope";
import type { ProductionAcceptanceStageCapability,
  ProductionAcceptanceStageExecutionIdentity } from
  "../src/lib/production/ProductionAcceptancePolicy";
import { createProductionExecutionReadDescriptor,
  ProductionExecutionDescriptorBoundReadAdapter } from
  "../src/lib/production/ProductionExecutionDescriptorBoundReadAdapter";
import { validateProductionExecutionDurableAttempt } from
  "../src/lib/production/ProductionExecutionDurableAttempt";
import { ProductionPipelineDurableExecutionError } from
  "../src/lib/production/ProductionPipelineExecutionAdapter";
import { runWithProductionPipelineExecutionInstrumentation } from
  "../src/lib/production/ProductionPipelineExecutionInstrumentation";
import { VisualManager } from "../src/lib/visuals/VisualManager";
import { getActiveProductionRuntimeOperationContext,
  requireActiveProductionRuntimeOperationContext,
} from
  "../src/lib/runtime/ProductionRuntimeOperationContext";
import type {
  ImageGenerationResult,
  ProjectAssets,
} from "../src/types/asset";
import type {
  PipelineJobHistory,
  PipelineJobList,
} from "../src/types/pipelineJob";
import type {
  ProductionStepKey,
  Project,
  ProjectManifest,
  ProjectPackageRunType,
} from "../src/types/project";
import type { VisualData } from "../src/types/visual";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";

let fixturePrefix = "";
let temporaryRuntimeRoot = "";
let projectsRoot = "";
let originalAIProvider: string | undefined;
let originalImageProvider: string | undefined;
let originalOpenAIKey: string | undefined;
const now = "2026-07-13T12:00:00.000Z";
const validPngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let scenarioCount = 0;

const visualData: VisualData = {
  projectId: "project-113",
  scenes: [
    {
      sceneId: 1,
      visualPrompt: "First safe scene",
      animationPrompt: "Animate first scene",
      style: "cinematic",
    },
    {
      sceneId: 2,
      visualPrompt: "Second safe scene",
      animationPrompt: "Animate second scene",
      style: "documentary",
    },
  ],
  thumbnail: {
    title: "Sprint 113",
    prompt: "Safe thumbnail",
    composition: "centered",
    mood: "documentary",
  },
  createdAt: now,
};

type PipelineRunnerInternals = {
  runStageLegacy(
    slug: string,
    stage: ProductionStepKey,
    action: () => Promise<boolean>,
    runType: ProjectPackageRunType,
  ): Promise<boolean>;
  runStage(
    slug: string,
    stage: ProductionStepKey,
    action: (capability: ProductionAcceptanceStageCapability | undefined,
      identity: ProductionAcceptanceStageExecutionIdentity) => Promise<boolean>,
    runType: ProjectPackageRunType,
    onClaimConflict?: () => void,
    stageExecution?: Parameters<typeof materializePipelineStageExecutionOptions>[1],
    providerSelection?: ProductionAcceptanceProviderSelection,
  ): Promise<boolean>;
};

const runner = PipelineRunner as unknown as PipelineRunnerInternals;

async function scenario(name: string, test: () => void | Promise<void>) {
  try {
    await test();
  } catch (error) {
    console.error(`Visual asset wiring scenario failed: ${name}`);
    throw error;
  }
  scenarioCount += 1;
}

function setImageProvider(value: string | undefined) {
  if (value === undefined) {
    delete process.env.IMAGE_PROVIDER;
    return;
  }

  process.env.IMAGE_PROVIDER = value;
}

function createSuccessProvider(onGenerate?: () => void): ConfiguredImageProvider {
  const provider: ConfiguredImageProvider = {
    name: "openai",
    async generateImage(input) {
      onGenerate?.();
      return createSuccessResult(input);
    },
    createImmutableImageDispatchAdapter() {
      return createProviderDispatchAdapter(provider, {
        metadata: { name: provider.name }, requiredMethods: ["generateImage"],
      });
    },
  };
  return provider;
}

function createSuccessResult(
  input: ImageGenerationInput,
): ImageGenerationResult {
  return {
    success: true,
    sceneId: input.sceneId,
    provider: "openai",
    model: "fake-image-model",
    filePath: `data/projects/${input.projectSlug}/assets/images/scene-${input.sceneId}.png`,
    url: `https://images.example.test/scene-${input.sceneId}.png`,
    mimeType: "image/png",
    createdAt: now,
  };
}

function createProvider(
  generateImage: (
    input: ImageGenerationInput,
  ) => ImageGenerationResult | Promise<ImageGenerationResult>,
): ConfiguredImageProvider {
  const provider: ConfiguredImageProvider = {
    name: "openai",
    async generateImage(input) {
      return generateImage(input);
    },
    createImmutableImageDispatchAdapter() {
      return createProviderDispatchAdapter(provider, {
        metadata: { name: provider.name }, requiredMethods: ["generateImage"],
      });
    },
  };
  return provider;
}

function createMockProvider(
  generateImage: (
    input: ImageGenerationInput,
  ) => ImageGenerationResult | Promise<ImageGenerationResult>,
): ConfiguredImageProvider {
  const provider: ConfiguredImageProvider = {
    name: "mock",
    async generateImage(input) {
      return generateImage(input);
    },
    createImmutableImageDispatchAdapter() {
      return createProviderDispatchAdapter(provider, {
        metadata: { name: provider.name }, requiredMethods: ["generateImage"],
      });
    },
  };
  return provider;
}

function assetsPath(slug: string) {
  return path.join(projectsRoot, slug, "assets", "assets.json");
}

async function readAssets(slug: string): Promise<ProjectAssets> {
  return JSON.parse(await fs.readFile(assetsPath(slug), "utf8")) as ProjectAssets;
}

async function generate(
  suffix: string,
  provider: ImageProvider,
  data: VisualData = visualData,
) {
  const slug = `${fixturePrefix}-${suffix}`;
  const assets = await VisualAssetPipeline.generateAssets({
    projectId: visualData.projectId,
    projectSlug: slug,
    visualData: data,
    provider,
  });
  return { slug, assets };
}

async function expectSafeFailure(
  suffix: string,
  provider: ImageProvider,
  data: VisualData = visualData,
) {
  const slug = `${fixturePrefix}-${suffix}`;
  await assert.rejects(
    VisualAssetPipeline.generateAssets({
      projectId: visualData.projectId,
      projectSlug: slug,
      visualData: data,
      provider,
    }),
    isSafeVisualAssetError,
  );
  return { slug, assets: await readAssets(slug) };
}

async function expectWriteFreePreflightFailure(
  suffix: string,
  data: VisualData,
) {
  const slug = `${fixturePrefix}-${suffix}`;
  let providerCalls = 0;
  await assert.rejects(
    VisualAssetPipeline.generateAssets({
      projectId: visualData.projectId,
      projectSlug: slug,
      visualData: data,
      provider: createSuccessProvider(() => providerCalls += 1),
    }),
    isSafeVisualAssetError,
  );
  assert.equal(providerCalls, 0);
  await assert.rejects(fs.access(assetsPath(slug)));
}

function isSafeVisualAssetError(error: unknown) {
  return (
    error instanceof VisualAssetGenerationError &&
    error.message === "Visual asset generation failed." &&
    error.stack === undefined
  );
}

function createExecutionState(project: Project): PipelineExecutionState {
  return {
    project,
    research: null,
    script: null,
    scenes: {
      scenes: visualData.scenes.map((scene) => ({
        id: scene.sceneId,
        title: `Scene ${scene.sceneId}`,
        description: scene.visualPrompt,
      })),
      createdAt: now,
    },
    visuals: null,
    animation: null,
    video: null,
    audio: null,
    assembly: null,
    thumbnail: null,
    seo: null,
    youtube: null,
    exportPackage: null,
  };
}

async function createRunnerFixture(suffix: string) {
  const topic = `${fixturePrefix}-runner-${suffix}`;
  const project = await ProjectManager.createProject(topic);
  const jobList: PipelineJobList = {
    projectSlug: project.slug,
    jobs: [
      {
        id: `${project.slug}-visuals`,
        projectSlug: project.slug,
        stage: "visuals",
        title: "Visual Production",
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  await fs.writeFile(
    path.join(projectsRoot, project.slug, "pipeline-jobs.json"),
    JSON.stringify(jobList, null, 2),
    "utf8",
  );
  return { project, state: createExecutionState(project) };
}

async function runVisualFailureThroughRunner(
  suffix: string,
  durable: boolean,
  injectedProvider?: ImageProvider,
) {
  const fixture = await createRunnerFixture(suffix);
  const originalGenerateVisualData = VisualManager.generateVisualData;
  const originalConsoleError = console.error;
  const logs: unknown[][] = [];
  const executionEvents: string[] = [];
  let providerCalls = 0;
  let foreignProviderCalls = 0;
  let adapterFactoryCalls = 0;
  let canonicalIdentity: ProductionAcceptanceStageExecutionIdentity | undefined;
  VisualManager.generateVisualData = async () => ({
    ...visualData,
    projectId: fixture.project.id,
  });
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };

  const provider = injectedProvider ?? createProvider(async (input) => ({
      success: false,
      sceneId: input.sceneId,
      provider: "openai",
      createdAt: now,
      error: "raw provider secret C:\\private\\provider.ts API_KEY=secret",
    }));
  const legacyAction = () =>
    PipelineStageExecutor.execute(
      fixture.project.slug,
      "visuals",
      fixture.state,
      { visualAssetProvider: provider },
    );

  try {
    if (durable) {
      process.env.AI_PROVIDER = "mock";
      process.env.IMAGE_PROVIDER = "mock";
      const originalGenerate = MockImageProvider.prototype.generateImage;
      const originalFactory = MockImageProvider.prototype.createImmutableImageDispatchAdapter;
      MockImageProvider.prototype.generateImage = async function (input) {
        providerCalls += 1;
        assert.ok(getActiveProductionRuntimeOperationContext());
        return {
          success: false,
          sceneId: input.sceneId,
          provider: "mock",
          createdAt: now,
          error: "controlled visual provider failure",
        };
      };
      MockImageProvider.prototype.createImmutableImageDispatchAdapter = function () {
        adapterFactoryCalls += 1;
        return originalFactory.call(this);
      };
      const materialized = materializePipelineStageExecutionOptions("visuals");
      const providerSelection = createProductionAcceptanceProviderSelection(
        "visuals", materialized.options, materialized.configuredOptions,
      );
      const imageBinding = providerSelection.providers.find(
        (binding) => binding.slot === "visualAssetProvider",
      );
      assert.equal(imageBinding?.injected, false);
      assert.ok(imageBinding?.reference);
      assert.equal(Object.isFrozen(imageBinding?.reference), true);
      assert.equal(Object.getPrototypeOf(imageBinding?.reference ?? {}), null);
      const secondMaterialized = materializePipelineStageExecutionOptions("visuals");
      const secondSelection = createProductionAcceptanceProviderSelection(
        "visuals", secondMaterialized.options, secondMaterialized.configuredOptions,
      );
      assert.notStrictEqual(
        imageBinding?.reference,
        secondSelection.providers.find((binding) =>
          binding.slot === "visualAssetProvider")?.reference,
      );
      MockImageProvider.prototype.generateImage = async function () {
        foreignProviderCalls += 1;
        throw new Error("foreign visual provider must not run");
      };
      const action = (
        capability: ProductionAcceptanceStageCapability | undefined,
        identity: ProductionAcceptanceStageExecutionIdentity,
      ) => {
        canonicalIdentity = identity;
        return PipelineStageExecutor.execute(
          fixture.project.slug,
          "visuals",
          fixture.state,
          materialized.options,
          capability,
          identity,
          "initial",
          providerSelection,
        );
      };
      try {
        await assert.rejects(
          runWithProductionPipelineExecutionInstrumentation({
            onEvent: (event) => { executionEvents.push(event); },
          }, () => runner.runStage(
            fixture.project.slug,
            "visuals",
            action,
            "initial",
            undefined,
            materialized.options,
            providerSelection,
          )),
          (error) => error instanceof ProductionPipelineDurableExecutionError &&
            error.message === "Pipeline stage execution failed." &&
            error.reasonCode === "WORKER_EXECUTION_FAILED",
        );
      } finally {
        MockImageProvider.prototype.generateImage = originalGenerate;
        MockImageProvider.prototype.createImmutableImageDispatchAdapter = originalFactory;
      }
    } else {
      await assert.rejects(
        runner.runStageLegacy(
          fixture.project.slug,
          "visuals",
          legacyAction,
          "initial",
        ),
        isSafeVisualAssetError,
      );
    }
  } finally {
    VisualManager.generateVisualData = originalGenerateVisualData;
    console.error = originalConsoleError;
  }

  const jobs = JSON.parse(
    await fs.readFile(
      path.join(projectsRoot, fixture.project.slug, "pipeline-jobs.json"),
      "utf8",
    ),
  ) as PipelineJobList;
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(projectsRoot, fixture.project.slug, "manifest.json"),
      "utf8",
    ),
  ) as ProjectManifest;
  const history = JSON.parse(
    await fs.readFile(
      path.join(projectsRoot, fixture.project.slug, "pipeline-history.json"),
      "utf8",
    ),
  ) as PipelineJobHistory;
  const project = JSON.parse(
    await fs.readFile(
      path.join(projectsRoot, fixture.project.slug, "project.json"),
      "utf8",
    ),
  ) as Project;
  const assets = await readAssets(fixture.project.slug);

  let durableAttempt: Record<string, unknown> | null = null;
  if (durable) {
    assert.ok(canonicalIdentity?.attemptId,
      "Canonical visual execution did not expose its persisted attempt identity.");
    const adapter = new ProductionExecutionDescriptorBoundReadAdapter(
      createProductionExecutionReadDescriptor({
        runtimeOperationContext: requireActiveProductionRuntimeOperationContext(),
        projectSlug: fixture.project.slug,
      }),
    );
    const listed = await adapter.listKeys("attempt");
    assert.equal(listed.ok, true);
    if (!listed.ok) throw new Error("Canonical visual attempt store is unavailable.");
    const expectedKeys = listed.keys.filter((key) =>
      key === canonicalIdentity!.attemptId || key.startsWith(`${canonicalIdentity!.attemptId}-v`));
    assert.ok(expectedKeys.length > 0, "Canonical visual attempt key is missing.");
    expectedKeys.sort((left, right) => versionFromKey(left) - versionFromKey(right));
    const exact = await adapter.read("attempt", expectedKeys.at(-1)!);
    assert.equal(exact.status, "found");
    durableAttempt = exact.status === "found"
      ? (exact.value as unknown as Record<string, unknown>) : null;
  }

  return { jobs, manifest, history, project, assets, logs, durableAttempt,
    executionEvents, providerCalls, foreignProviderCalls, adapterFactoryCalls,
    canonicalIdentity };
}

async function run() {
  const originalFetch = globalThis.fetch;

  try {
    await scenario("undefined provider defaults to mock", () => {
      setImageProvider(undefined);
      assert.equal(resolveImageProviderName(), "mock");
      assert.ok(ImageProviderRouter.getProvider() instanceof MockImageProvider);
    });
    await scenario("empty provider defaults to mock", () => {
      setImageProvider("   ");
      assert.equal(resolveImageProviderName(), "mock");
    });
    await scenario("explicit mock routes to mock", () => {
      setImageProvider("mock");
      assert.ok(ImageProviderRouter.getProvider() instanceof MockImageProvider);
    });
    await scenario("explicit openai routes without generation", () => {
      setImageProvider("openai");
      assert.ok(ImageProviderRouter.getProvider() instanceof OpenAIImageProvider);
    });
    await scenario("unknown provider fails closed safely", () => {
      setImageProvider("secret-provider-value");
      assert.throws(
        () => ImageProviderRouter.getProvider(),
        (error) =>
          error instanceof ImageProviderConfigurationError &&
          error.message === IMAGE_PROVIDER_CONFIGURATION_ERROR &&
          error.stack === undefined &&
          !error.message.includes("secret-provider-value"),
      );
    });
    await scenario("case and whitespace normalization is deterministic", () => {
      assert.equal(resolveImageProviderName("  OpEnAi  "), "openai");
      assert.throws(
        () => resolveImageProviderName("  unsupported  "),
        ImageProviderConfigurationError,
      );
    });
    await scenario("provider resolution is network and generation free", () => {
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error("Network must not be used by provider resolution.");
      };
      ImageProviderRouter.getProvider("openai");
      ImageProviderRouter.getProvider("mock");
      assert.equal(fetchCalls, 0);
      globalThis.fetch = originalFetch;
    });

    await scenario("real OpenAI base64 storage success is accepted and cleaned", async () => {
      const slug = `${fixturePrefix}-openai-base64`;
      const fixtureRoot = path.join(projectsRoot, slug);
      const writtenFiles: string[] = [];
      let scenarioError: unknown;
      process.env.OPENAI_API_KEY = "sprint-113-test-key";
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                b64_json: validPngBytes.toString("base64"),
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );

      try {
        const assets = await VisualAssetPipeline.generateAssets({
          projectId: visualData.projectId,
          projectSlug: slug,
          visualData,
          provider: new OpenAIImageProvider(),
        });

        assert.equal(assets.assets.length, visualData.scenes.length);
        for (const asset of assets.assets) {
          assert.equal(asset.status, "generated");
          assert.equal(asset.provider, "openai");
          assert.equal(asset.mimeType, "image/png");
          assert.match(
            asset.filePath ?? "",
            new RegExp(`^data/projects/${slug}/assets/images/[a-zA-Z0-9-_.]+$`),
          );
          assert.match(
            asset.url ?? "",
            new RegExp(`^/api/assets/images/${slug}/[a-zA-Z0-9-_.]+$`),
          );
          const absoluteFilePath = path.join(temporaryRuntimeRoot,
            path.relative("data", asset.filePath ?? ""));
          writtenFiles.push(absoluteFilePath);
          assert.deepEqual(await fs.readFile(absoluteFilePath), validPngBytes);
        }

        const persisted = await readAssets(slug);
        assert.equal(persisted.assets.length, visualData.scenes.length);
        assert.deepEqual(
          persisted.assets.map((asset) => asset.url),
          assets.assets.map((asset) => asset.url),
        );
      } catch (error) {
        scenarioError = error;
      } finally {
        globalThis.fetch = originalFetch;
        if (originalOpenAIKey === undefined) {
          delete process.env.OPENAI_API_KEY;
        } else {
          process.env.OPENAI_API_KEY = originalOpenAIKey;
        }
        await fs.rm(fixtureRoot, { recursive: true, force: true });
      }

      for (const filePath of writtenFiles) {
        await assert.rejects(fs.access(filePath));
      }

      if (scenarioError) {
        throw scenarioError;
      }
    });

    const successful = await generate("success", createSuccessProvider());
    await scenario("one generated asset is stored for every scene", () => {
      assert.equal(successful.assets.assets.length, visualData.scenes.length);
      assert.ok(successful.assets.assets.every((asset) => asset.status === "generated"));
    });
    await scenario("asset registry uses deterministic scene ids", () => {
      assert.deepEqual(
        successful.assets.assets.map((asset) => asset.sceneId),
        visualData.scenes.map((scene) => scene.sceneId),
      );
    });
    await scenario("safe provider metadata is preserved", () => {
      for (const asset of successful.assets.assets) {
        assert.equal(asset.provider, "openai");
        assert.equal(asset.mimeType, "image/png");
        assert.match(asset.filePath ?? "", /^data\/projects\//);
        assert.match(asset.url ?? "", /^https:\/\//);
      }
    });

    await scenario("safe project-relative image path is accepted", async () => {
      const result = await generate("safe-path", createSuccessProvider());
      assert.match(result.assets.assets[0].filePath ?? "", /^data\/projects\//);
    });
    await scenario("safe https image url is accepted", async () => {
      const result = await generate("safe-url", createProvider((input) => ({
        success: true,
        sceneId: input.sceneId,
        provider: "openai",
        filePath: `data/projects/${input.projectSlug}/assets/images/scene-${input.sceneId}.jpg`,
        url: `https://images.example.test/${input.sceneId}.png`,
        mimeType: "image/jpeg",
        createdAt: now,
      })));
      assert.ok(result.assets.assets.every((asset) => asset.url?.startsWith("https://")));
    });
    await scenario("MIME normalization is deterministic", async () => {
      const result = await generate(
        "mime-normalized",
        createProvider((input) => ({
          ...createSuccessResult(input),
          mimeType: " IMAGE/WEBP ",
        }) as unknown as ImageGenerationResult),
      );
      assert.ok(result.assets.assets.every((asset) => asset.mimeType === "image/webp"));
    });

    for (const [name, suffix, mutate] of [
      ["incomplete MIME", "mime-incomplete", { mimeType: "image/" }],
      ["unsupported MIME", "mime-unsupported", { mimeType: "image/gif" }],
      ["malformed URL", "url-malformed", { filePath: undefined, url: "not a url" }],
      ["javascript URL", "url-javascript", { filePath: undefined, url: "javascript:alert(1)" }],
      ["data URL", "url-data", { filePath: undefined, url: "data:image/png;base64,secret" }],
      ["file URL", "url-file", { filePath: undefined, url: "file:///private/image.png" }],
      ["unknown root-relative URL", "url-root-unknown", { url: "/api/private/image.png" }],
      ["absolute Windows path", "path-drive", { filePath: "C:\\private\\secret.png", url: undefined }],
      ["UNC path", "path-unc", { filePath: "\\\\server\\share\\secret.png", url: undefined }],
      ["root-relative path", "path-root", { filePath: "/private/secret.png", url: undefined }],
      ["path traversal", "path-traversal", { filePath: "data/projects/project/../../secret.png", url: undefined }],
    ] as const) {
      await scenario(`${name} fails closed`, async () => {
        const failed = await expectSafeFailure(
          suffix,
          createProvider((input) => ({
            ...createSuccessResult(input),
            ...mutate,
          }) as unknown as ImageGenerationResult),
        );
        assert.equal(failed.assets.assets[0].status, "failed");
        assert.equal(failed.assets.assets[0].filePath, undefined);
        assert.equal(failed.assets.assets[0].url, undefined);
        assert.equal(
          failed.assets.assets[0].error,
          "Image asset generation failed.",
        );
      });
    }

    await scenario("valid injected mock success keeps the exact sentinel contract", async () => {
      const result = await generate("valid-injected-mock", new MockImageProvider());
      assert.ok(result.assets.assets.every((asset) => asset.status === "generated"));
      assert.ok(result.assets.assets.every((asset) => asset.provider === "mock"));
      assert.ok(result.assets.assets.every((asset) => asset.mimeType === "image/mock"));
      assert.ok(result.assets.assets.every((asset) => asset.filePath === ""));
      assert.ok(result.assets.assets.every((asset) => asset.url === ""));
    });

    const validMockResult = (input: ImageGenerationInput) => ({
      success: true,
      sceneId: input.sceneId,
      provider: "mock",
      filePath: "",
      url: "",
      mimeType: "image/mock",
      createdAt: now,
    });
    const invalidMockCases = [
      ["real image MIME", "mock-real-mime", (input: ImageGenerationInput) => ({
        ...validMockResult(input),
        mimeType: "image/png",
      })],
      ["unsupported MIME", "mock-unsupported-mime", (input: ImageGenerationInput) => ({
        ...validMockResult(input),
        mimeType: "image/gif",
      })],
      ["non-empty file path", "mock-file-path", (input: ImageGenerationInput) => ({
        ...validMockResult(input),
        filePath: "C:\\mock-private-locator\\image.png",
      })],
      ["non-empty URL", "mock-url", (input: ImageGenerationInput) => ({
        ...validMockResult(input),
        url: "https://mock-private-locator.example/image.png",
      })],
      ["wrong provider identity", "mock-provider", (input: ImageGenerationInput) => ({
        ...createSuccessResult(input),
        provider: "openai",
      })],
      ["wrong scene id", "mock-scene", (input: ImageGenerationInput) => ({
        ...validMockResult(input),
        sceneId: input.sceneId + 1,
      })],
      ["malformed runtime object", "mock-malformed", () => ({
        success: true,
        provider: "mock",
      })],
      ["throwing runtime field", "mock-throwing-field", (input: ImageGenerationInput) =>
        Object.defineProperty(
          {
            ...validMockResult(input),
          },
          "mimeType",
          {
            get() {
              throw new Error("mock-private-locator getter failure");
            },
          },
        )],
    ] as const;

    for (const [name, suffix, createResult] of invalidMockCases) {
      await scenario(`${name} mock result fails closed`, async () => {
        const failed = await expectSafeFailure(
          suffix,
          createMockProvider((input) =>
            createResult(input) as unknown as ImageGenerationResult),
        );
        assert.equal(failed.assets.assets[0].status, "failed");
        assert.equal(failed.assets.assets[0].provider, "mock");
        assert.equal(failed.assets.assets[0].filePath, undefined);
        assert.equal(failed.assets.assets[0].url, undefined);
        assert.equal(
          failed.assets.assets[0].error,
          "Image asset generation failed.",
        );
        assert.doesNotMatch(
          JSON.stringify(failed.assets),
          /mock-private-locator/i,
        );
      });
    }

    await scenario("missing provider result fails closed", async () => {
      const failed = await expectSafeFailure(
        "missing",
        createProvider(() => undefined as unknown as ImageGenerationResult),
      );
      assert.equal(failed.assets.assets[0].status, "failed");
    });
    await scenario("wrong scene result fails closed", async () => {
      const failed = await expectSafeFailure(
        "wrong-scene",
        createProvider((input) => ({
          ...createSuccessResult(input),
          sceneId: input.sceneId + 100,
        })),
      );
      assert.equal(failed.assets.assets[0].status, "failed");
    });
    await scenario("provider failure result is normalized", async () => {
      const failed = await expectSafeFailure(
        "provider-error",
        createProvider((input) => ({
          success: false,
          sceneId: input.sceneId,
          provider: "openai",
          createdAt: now,
          error: "raw secret stack C:\\private\\provider.ts API_KEY=secret",
        })),
      );
      assert.equal(failed.assets.assets[0].error, "Image asset generation failed.");
      assert.doesNotMatch(JSON.stringify(failed.assets), /raw secret|private|API_KEY|stack/i);
    });
    await scenario("provider exception is normalized", async () => {
      const failed = await expectSafeFailure(
        "provider-throws",
        createProvider(() => {
          throw new Error("raw exception secret C:\\private\\provider.ts");
        }),
      );
      assert.equal(failed.assets.assets[0].error, "Image asset generation failed.");
      assert.doesNotMatch(JSON.stringify(failed.assets), /exception secret|private|stack/i);
    });

    let partialCalls = 0;
    const partial = await expectSafeFailure(
      "partial",
      createProvider((input) => {
        partialCalls += 1;
        return partialCalls === 1
          ? createSuccessResult(input)
          : {
              success: false,
              sceneId: input.sceneId,
              provider: "openai",
              createdAt: now,
              error: "second scene secret failure",
            };
      }),
    );
    await scenario("partial generation remains failed without rollback", () => {
      assert.deepEqual(
        partial.assets.assets.map((asset) => asset.status),
        ["generated", "failed"],
      );
    });

    const duplicateData = {
      ...visualData,
      scenes: [visualData.scenes[0], { ...visualData.scenes[1], sceneId: 1 }],
    };
    await scenario("duplicate scene ids fail before writes", () =>
      expectWriteFreePreflightFailure("duplicate-scenes", duplicateData));
    await scenario("empty scene list fails before writes", () =>
      expectWriteFreePreflightFailure("empty-scenes", { ...visualData, scenes: [] }));
    await scenario("blank scene id fails before writes", () =>
      expectWriteFreePreflightFailure(
        "blank-scene",
        {
          ...visualData,
          scenes: [{ ...visualData.scenes[0], sceneId: " " }],
        } as unknown as VisualData,
      ));
    await scenario("invalid numeric scene id fails before writes", () =>
      expectWriteFreePreflightFailure(
        "invalid-scene",
        { ...visualData, scenes: [{ ...visualData.scenes[0], sceneId: 0 }] },
      ));

    const legacyFailure = await runVisualFailureThroughRunner("legacy", false);
    await scenario("real runner persists visuals job failure", () => {
      assert.equal(legacyFailure.jobs.jobs[0].status, "failed");
      assert.equal(legacyFailure.jobs.jobs[0].error, "VISUAL_ASSET_GENERATION_FAILED");
    });
    await scenario("real runner persists manifest failure", () => {
      assert.equal(legacyFailure.manifest.packages.visuals.status, "failed");
      assert.equal(
        legacyFailure.manifest.packages.visuals.error,
        "VISUAL_ASSET_GENERATION_FAILED",
      );
    });
    await scenario("real runner persists failed history event", () => {
      assert.equal(legacyFailure.history.events.length, 1);
      assert.equal(legacyFailure.history.events[0].stage, "visuals");
      assert.equal(legacyFailure.history.events[0].status, "failed");
    });
    await scenario("failure does not enqueue downstream stage", () => {
      assert.equal(legacyFailure.jobs.jobs.length, 1);
      assert.equal(
        legacyFailure.jobs.jobs.some((job) => job.stage === "animation"),
        false,
      );
    });
    await scenario("failure never persists project or stage completed", () => {
      assert.notEqual(legacyFailure.project.status, "completed");
      assert.notEqual(legacyFailure.manifest.packages.visuals.status, "completed");
    });
    await scenario("runner persistence and logs contain no raw provider data", () => {
      const persisted = JSON.stringify(legacyFailure);
      assert.doesNotMatch(persisted, /raw provider|private|API_KEY|stack/i);
    });

    const durableFailure = await runVisualFailureThroughRunner("durable", true);
    await scenario("canonical durable boundary readback records terminal visual failure", () => {
      assert.equal(durableFailure.providerCalls, 1);
      assert.equal(durableFailure.foreignProviderCalls, 0);
      assert.equal(durableFailure.adapterFactoryCalls, 2);
      assertOrderedSubsequence(durableFailure.executionEvents, [
        "durable-attempt-persisted", "durable-readback-verified",
        "canonical-identity-extracted", "lifecycle-bound", "provider-dispatch-entered",
      ]);
      assert.ok(durableFailure.durableAttempt);
      assert.equal(validateProductionExecutionDurableAttempt(durableFailure.durableAttempt), true);
      assert.equal(durableFailure.durableAttempt?.state, "failed");
      const identity = durableFailure.durableAttempt?.identity as
        | Record<string, unknown> | undefined;
      const canonical = durableFailure.canonicalIdentity;
      assert.ok(canonical);
      for (const field of ["recordId", "reservationId", "claimId", "leaseId", "attemptId",
        "executionFingerprint", "requestId", "idempotencyKey", "operation"] as const) {
        assert.equal(identity?.[field], canonical[field], `visual canonical identity mismatch: ${field}`);
      }
      assert.equal(canonical.projectSlug, durableFailure.project.slug);
      assert.equal(canonical.stage, "visuals");
      const journal = durableFailure.durableAttempt?.journal as
        | Array<{ entryId?: string; payload?: { code?: string } }> | undefined;
      assert.ok(journal && journal.length >= 3);
      assert.equal(journal.at(-1)?.payload?.code, "VISUAL_ASSET_GENERATION_FAILED");
      assert.equal(durableFailure.jobs.jobs[0].status, "failed");
      assert.equal(durableFailure.manifest.packages.visuals.status, "failed");
      assert.equal(durableFailure.assets.assets.filter((asset) =>
        asset.type === "image" && asset.status === "generated").length, 0);
      assert.equal(durableFailure.assets.assets.filter((asset) =>
        asset.type === "image" && asset.status === "failed").length, 1);
    });

    const invalidMockRunnerFailure = await runVisualFailureThroughRunner(
      "invalid-mock",
      false,
      createMockProvider((input) => ({
        ...validMockResult(input),
        filePath: "C:\\mock-private-locator\\image.png",
      }) as unknown as ImageGenerationResult),
    );
    await scenario("invalid mock result fails the stage without downstream or raw data", () => {
      assert.equal(invalidMockRunnerFailure.jobs.jobs[0].status, "failed");
      assert.equal(
        invalidMockRunnerFailure.manifest.packages.visuals.status,
        "failed",
      );
      assert.equal(invalidMockRunnerFailure.history.events[0].status, "failed");
      assert.equal(
        invalidMockRunnerFailure.jobs.jobs.some((job) => job.stage === "animation"),
        false,
      );
      assert.doesNotMatch(
        JSON.stringify(invalidMockRunnerFailure),
        /mock-private-locator/i,
      );
    });

    await scenario("default mock generation remains compatible", async () => {
      setImageProvider(undefined);
      const slug = `${fixturePrefix}-mock-regression`;
      const assets = await VisualAssetPipeline.generateAssets({
        projectId: visualData.projectId,
        projectSlug: slug,
        visualData,
      });
      assert.equal(assets.assets.length, visualData.scenes.length);
      assert.ok(assets.assets.every((asset) => asset.status === "generated"));
      assert.ok(assets.assets.every((asset) => asset.provider === "mock"));
    });
    await scenario("repeated generation is deterministic and network free", async () => {
      let fetchCalls = 0;
      let generationCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error("Unexpected network call.");
      };
      await generate("repeat-a", createSuccessProvider(() => generationCalls += 1));
      await generate("repeat-b", createSuccessProvider(() => generationCalls += 1));
      assert.equal(fetchCalls, 0);
      assert.equal(generationCalls, visualData.scenes.length * 2);
      globalThis.fetch = originalFetch;
    });
    await scenario("wiring creates no runtime graph or lifecycle", async () => {
      const source = await fs.readFile(
        path.join(process.cwd(), "src", "lib", "pipeline", "PipelineStageExecutor.ts"),
        "utf8",
      );
      assert.doesNotMatch(
        source,
        /ProductionRuntimeCompositionRoot|ProductionWorkerLifecycle|ProductionRuntimeInitializer/,
      );
    });

    console.log(
      `Sprint 113 production visual asset wiring smoke: PASS (${scenarioCount} scenarios)`,
    );
    emitSmokeResult("production-visual-asset-wiring", scenarioCount);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAIProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = originalAIProvider;
    if (originalImageProvider === undefined) {
      delete process.env.IMAGE_PROVIDER;
    } else {
      process.env.IMAGE_PROVIDER = originalImageProvider;
    }
    if (originalOpenAIKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    }
  }
}

function versionFromKey(key: string): number {
  const match = /-v([1-9][0-9]*)$/.exec(key);
  return match ? Number(match[1]) : 0;
}

function assertOrderedSubsequence(actual: readonly string[], expected: readonly string[]): void {
  let previous = -1;
  for (const event of expected) {
    const index = actual.indexOf(event, previous + 1);
    assert.ok(index > previous,
      `Missing or out-of-order production event ${event}: ${JSON.stringify(actual)}`);
    previous = index;
  }
}

async function main() {
  await withCanonicalSmokeRuntime({ name: "visual-wiring",
    operationType: "visual-wiring-test", now }, async (runtime) => {
    fixturePrefix = `sprint-113-visual-assets-${runtime.runId.slice(0, 12)}`;
    temporaryRuntimeRoot = runtime.runtimeRoot;
    projectsRoot = runtime.runtimeStorageContext.projectsRoot;
    originalAIProvider = process.env.AI_PROVIDER;
    originalImageProvider = process.env.IMAGE_PROVIDER;
    originalOpenAIKey = process.env.OPENAI_API_KEY;
    await run();
  });
}

void main();
