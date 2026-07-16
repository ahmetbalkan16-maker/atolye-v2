import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runProductionAcceptanceCommand } from
  "../src/lib/production/ProductionAcceptanceCommand";
import {
  diagnoseProductionAcceptanceConfiguration,
  productionAcceptanceConfigurationFingerprint,
  productionAcceptanceRequestFingerprint,
  productionAcceptanceRequestFingerprintV3Profile2,
} from "../src/lib/production/ProductionAcceptancePolicy";
import {
  productionAcceptancePortableConfigurationFingerprintV2,
  type ProductionAcceptanceComponentFingerprintsV2,
} from "../src/lib/production/ProductionAcceptanceConfigurationFingerprint";
import {
  ProductionAcceptanceReprepareError,
  reprepareProductionAcceptanceMarker,
  type ProductionAcceptanceReprepareFileOperations,
} from "../src/lib/production/ProductionAcceptanceReprepareService";
import {
  createProductionAcceptanceProjectSlug,
  productionAcceptanceTopicFingerprint,
} from "../src/lib/production/ProductionAcceptanceTopic";
import { ProjectReader } from "../src/lib/projects/ProjectReader";

let scenarios = 0;
const fixtureFolders: string[] = [];

async function test(name: string, action: () => void | Promise<void>) {
  await action();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

async function main() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "atolye-129-24-"));
  const toolsA = path.join(temporaryRoot, "tools-a");
  const toolsB = path.join(temporaryRoot, "tools-b");
  const toolsChanged = path.join(temporaryRoot, "tools-changed");
  await Promise.all([toolsA, toolsB, toolsChanged].map((folder) => fs.mkdir(folder)));
  const binaries = await createBinaries(toolsA, toolsB, toolsChanged);
  const environment = configurationEnvironment({
    FFMPEG_PATH: binaries.ffmpegA,
    FFPROBE_PATH: binaries.ffprobeA,
  });

  try {
    const mainFixture = await createSchema2Fixture("main", environment);
    const nonMarkerBefore = await inventory(mainFixture.folder, false);

    await test("schema-2 to schema-3 success", async () => {
      const result = await reprepareProductionAcceptanceMarker(mainFixture.slug, { environment });
      assert.deepEqual(result, {
        projectSlug: mainFixture.slug,
        schemaVersion: "3",
        decision: "reprepared",
        writePerformed: true,
      });
      const marker = await readMarker(mainFixture.folder);
      assert.equal(marker.schemaVersion, "3");
      assert.equal(marker.componentFingerprintProfile, "2");
      assert.equal(marker.createdAt, mainFixture.marker.createdAt);
      assert.equal(marker.acceptanceStatus, mainFixture.marker.acceptanceStatus);
      assert.equal(marker.productionReady, mainFixture.marker.productionReady);
      assert.equal(marker.published, false);
    });

    const portableMarkerBytes = await fs.readFile(mainFixture.markerPath);

    await test("diagnose after success matches with component diagnostics", async () => {
      const result = await diagnoseProductionAcceptanceConfiguration(
        mainFixture.slug,
        environment,
      );
      assert.deepEqual(result, {
        schemaVersion: "3",
        matches: true,
        componentDiagnosticsAvailable: true,
        mismatchedComponents: [],
      });
    });

    await test("FFmpeg path changed with same binary passes", async () => {
      const result = await diagnoseProductionAcceptanceConfiguration(mainFixture.slug, {
        ...environment,
        FFMPEG_PATH: binaries.ffmpegB,
      });
      assert.equal(result.matches, true);
    });

    await test("FFprobe path changed with same binary passes", async () => {
      const result = await diagnoseProductionAcceptanceConfiguration(mainFixture.slug, {
        ...environment,
        FFPROBE_PATH: binaries.ffprobeB,
      });
      assert.equal(result.matches, true);
    });

    await test("repeated reprepare is write-free and idempotent", async () => {
      const before = await fs.readFile(mainFixture.markerPath);
      const result = await reprepareProductionAcceptanceMarker(mainFixture.slug, {
        environment: {
          ...environment,
          FFMPEG_PATH: binaries.ffmpegB,
          FFPROBE_PATH: binaries.ffprobeB,
        },
      });
      assert.equal(result.decision, "replayed");
      assert.equal(result.writePerformed, false);
      assert.deepEqual(await fs.readFile(mainFixture.markerPath), before);
    });

    await mismatchScenario(
      "FFmpeg binary identity mismatch fails",
      mainFixture,
      { ...environment, FFMPEG_PATH: binaries.ffmpegChanged },
      "FFMPEG_EXECUTABLE",
    );
    await mismatchScenario(
      "FFprobe binary identity mismatch fails",
      mainFixture,
      { ...environment, FFPROBE_PATH: binaries.ffprobeChanged },
      "FFPROBE_EXECUTABLE",
    );
    await mismatchScenario(
      "provider mismatch fails",
      mainFixture,
      { ...environment, AI_PROVIDER: "different-provider" },
      "AI_PROVIDER",
    );
    await mismatchScenario(
      "model mismatch fails",
      mainFixture,
      { ...environment, OPENAI_MODEL: "different-model" },
      "OPENAI_MODEL",
    );
    await mismatchScenario(
      "token budget mismatch fails",
      mainFixture,
      { ...environment, OPENAI_SCRIPT_MAX_TOKENS: "4800" },
      "OPENAI_SCRIPT_MAX_TOKENS",
    );
    await mismatchScenario(
      "API key identity mismatch fails",
      mainFixture,
      { ...environment, OPENAI_API_KEY: "sk-rotated-secret" },
      "OPENAI_API_KEY",
    );
    await mismatchScenario(
      "durable mode mismatch fails",
      mainFixture,
      { ...environment, ATOLYE_DURABLE_PIPELINE_EXECUTION: "false" },
      "ATOLYE_DURABLE_PIPELINE_EXECUTION",
    );

    await test("storage identity mismatch fails", async () => {
      await withTamperedComponent(mainFixture, "STORAGE_IDENTITY", async () => {
        const result = await diagnoseProductionAcceptanceConfiguration(
          mainFixture.slug,
          environment,
        );
        assert.equal(result.matches, false);
        assert.deepEqual(result.mismatchedComponents, ["STORAGE_IDENTITY"]);
        await assert.rejects(
          reprepareProductionAcceptanceMarker(mainFixture.slug, { environment }),
          ProductionAcceptanceReprepareError,
        );
      });
    });

    await test("environment policy mismatch fails", async () => {
      await withTamperedComponent(mainFixture, "ENVIRONMENT_POLICY", async () => {
        const result = await diagnoseProductionAcceptanceConfiguration(
          mainFixture.slug,
          environment,
        );
        assert.equal(result.matches, false);
        assert.deepEqual(result.mismatchedComponents, ["ENVIRONMENT_POLICY"]);
        await assert.rejects(
          reprepareProductionAcceptanceMarker(mainFixture.slug, { environment }),
          ProductionAcceptanceReprepareError,
        );
      });
    });

    await test("invalid schema-2 marker performs no write", async () => {
      const fixture = await createSchema2Fixture("invalid", environment, {
        requestFingerprint: "0".repeat(64),
      });
      const before = await fs.readFile(fixture.markerPath);
      await assert.rejects(
        reprepareProductionAcceptanceMarker(fixture.slug, { environment }),
        ProductionAcceptanceReprepareError,
      );
      assert.deepEqual(await fs.readFile(fixture.markerPath), before);
    });

    await test("atomic replace failure preserves old marker", async () => {
      const fixture = await createSchema2Fixture("atomic-failure", environment);
      const before = await fs.readFile(fixture.markerPath);
      const operations = fileOperations({
        rename: async (source, destination) => {
          if (source.endsWith(".reprepare.tmp")) throw new Error("injected replace failure");
          await fs.rename(source, destination);
        },
      });
      await assert.rejects(
        reprepareProductionAcceptanceMarker(fixture.slug, { environment, fileOperations: operations }),
        ProductionAcceptanceReprepareError,
      );
      assert.deepEqual(await fs.readFile(fixture.markerPath), before);
      assert.deepEqual(await temporaryFiles(fixture.folder), []);
    });

    await test("atomic write failure preserves old marker", async () => {
      const fixture = await createSchema2Fixture("write-failure", environment);
      const before = await fs.readFile(fixture.markerPath);
      const operations = fileOperations({
        open: async (filePath, flags) => {
          const handle = await fs.open(filePath, flags);
          if (!filePath.endsWith(".reprepare.tmp")) return handle;
          return {
            writeFile: async () => { throw new Error("injected write failure"); },
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
      });
      await assert.rejects(
        reprepareProductionAcceptanceMarker(fixture.slug, { environment, fileOperations: operations }),
        ProductionAcceptanceReprepareError,
      );
      assert.deepEqual(await fs.readFile(fixture.markerPath), before);
      assert.deepEqual(await temporaryFiles(fixture.folder), []);
    });

    await test("readback failure rolls back old marker", async () => {
      const fixture = await createSchema2Fixture("readback-failure", environment);
      const before = await fs.readFile(fixture.markerPath);
      let committed = false;
      let injected = false;
      const operations = fileOperations({
        rename: async (source, destination) => {
          await fs.rename(source, destination);
          if (source.endsWith(".reprepare.tmp")) committed = true;
        },
        readFile: async (filePath) => {
          if (committed && !injected && filePath === fixture.markerPath) {
            injected = true;
            throw new Error("injected readback failure");
          }
          return fs.readFile(filePath);
        },
      });
      await assert.rejects(
        reprepareProductionAcceptanceMarker(fixture.slug, { environment, fileOperations: operations }),
        ProductionAcceptanceReprepareError,
      );
      assert.equal(injected, true);
      assert.deepEqual(await fs.readFile(fixture.markerPath), before);
      assert.deepEqual(await temporaryFiles(fixture.folder), []);
    });

    await test("command requires explicit reprepare confirmation", async () => {
      let called = 0;
      const result = await runProductionAcceptanceCommand(
        ["reprepare", `--project-slug=${mainFixture.slug}`],
        commandDependencies(async () => {
          called += 1;
          return reprepareProductionAcceptanceMarker(mainFixture.slug, { environment });
        }),
      );
      assert.equal(result.exitCode, 2);
      assert.equal(called, 0);
    });

    await test("command invokes only reprepare and redacts sensitive data", async () => {
      let executeCalls = 0;
      let resumeCalls = 0;
      let reprepareCalls = 0;
      const result = await runProductionAcceptanceCommand([
        "reprepare",
        `--project-slug=${mainFixture.slug}`,
        "--confirm-production-acceptance-reprepare",
      ], {
        readiness: async () => { throw new Error("unexpected readiness"); },
        execute: async () => { executeCalls += 1; throw new Error("unexpected execute"); },
        resume: async () => { resumeCalls += 1; throw new Error("unexpected resume/finalize"); },
        reprepare: async () => {
          reprepareCalls += 1;
          return reprepareProductionAcceptanceMarker(mainFixture.slug, { environment });
        },
      });
      const output = JSON.stringify(result.report);
      assert.equal(result.exitCode, 0);
      assert.equal(result.report.decision, "replayed");
      assert.equal(reprepareCalls, 1);
      assert.equal(executeCalls, 0);
      assert.equal(resumeCalls, 0);
      assert.equal(output.includes(environment.OPENAI_API_KEY!), false);
      assert.equal(output.includes(environment.FFMPEG_PATH!), false);
      assert.equal(/[a-f0-9]{64}/.test(output), false);
    });

    await test("service has no execution finalize retry or stage-dispatch wiring", async () => {
      const source = await fs.readFile(
        "src/lib/production/ProductionAcceptanceReprepareService.ts",
        "utf8",
      );
      assert.equal(
        /PipelineRunner|PipelineStageExecutor|resumeAndFinalize|\.run\(|\.resume\(|retry|dispatch/i.test(source),
        false,
      );
    });

    await test("marker-external project content and runtime inventory remain unchanged", async () => {
      assert.deepEqual(await inventory(mainFixture.folder, false), nonMarkerBefore);
      assert.deepEqual(await fs.readFile(mainFixture.markerPath), portableMarkerBytes);
    });
  } finally {
    for (const folder of fixtureFolders) {
      if (isDisposableFixture(folder)) await fs.rm(folder, { recursive: true, force: true });
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
  assert.equal((await Promise.all(fixtureFolders.map(exists))).some(Boolean), false);
  process.stdout.write(
    `Sprint 129.24 controlled schema-3 reprepare smoke: PASS (${scenarios} scenarios)\n`,
  );
}

async function mismatchScenario(
  name: string,
  fixture: Awaited<ReturnType<typeof createSchema2Fixture>>,
  environment: NodeJS.ProcessEnv,
  component: string,
) {
  await test(name, async () => {
    const before = await fs.readFile(fixture.markerPath);
    const diagnostic = await diagnoseProductionAcceptanceConfiguration(fixture.slug, environment);
    assert.equal(diagnostic.matches, false);
    assert.deepEqual(diagnostic.mismatchedComponents, [component]);
    await assert.rejects(
      reprepareProductionAcceptanceMarker(fixture.slug, { environment }),
      ProductionAcceptanceReprepareError,
    );
    assert.deepEqual(await fs.readFile(fixture.markerPath), before);
  });
}

async function withTamperedComponent(
  fixture: Awaited<ReturnType<typeof createSchema2Fixture>>,
  component: "STORAGE_IDENTITY" | "ENVIRONMENT_POLICY",
  action: () => Promise<void>,
) {
  const original = await fs.readFile(fixture.markerPath);
  const marker = JSON.parse(original.toString("utf8")) as Record<string, unknown> & {
    componentFingerprints: ProductionAcceptanceComponentFingerprintsV2;
    topic: string;
    runId: string;
  };
  const components = { ...marker.componentFingerprints, [component]: "a".repeat(64) };
  const configurationFingerprint = productionAcceptancePortableConfigurationFingerprintV2(
    components as ProductionAcceptanceComponentFingerprintsV2,
  );
  marker.componentFingerprints = components as ProductionAcceptanceComponentFingerprintsV2;
  marker.configurationFingerprint = configurationFingerprint;
  marker.requestFingerprint = productionAcceptanceRequestFingerprintV3Profile2({
    topic: marker.topic,
    runId: marker.runId,
    configurationFingerprint,
  });
  await fs.writeFile(fixture.markerPath, JSON.stringify(marker, null, 2));
  try {
    await action();
  } finally {
    await fs.writeFile(fixture.markerPath, original);
  }
}

async function createSchema2Fixture(
  name: string,
  environment: NodeJS.ProcessEnv,
  markerOverrides: Record<string, unknown> = {},
) {
  const topic = `Controlled marker reprepare fixture ${name}`;
  const runId = randomUUID();
  const slug = createProductionAcceptanceProjectSlug(topic, runId);
  const folder = ProjectReader.getProjectFolder(slug);
  const markerPath = path.join(folder, "production-acceptance.json");
  fixtureFolders.push(folder);
  await fs.mkdir(path.join(folder, "assets", "images"), { recursive: true });
  await fs.mkdir(path.join(folder, "production-execution", "attempts"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(folder, "project.json"), '{"fixture":true}'),
    fs.writeFile(path.join(folder, "manifest.json"), '{"fixture":true}'),
    fs.writeFile(path.join(folder, "pipeline-jobs.json"), '{"jobs":[]}'),
    fs.writeFile(path.join(folder, "pipeline-history.json"), '{"events":[]}'),
    fs.writeFile(path.join(folder, "assets", "images", "fixture.png"), "fixture-image"),
    fs.writeFile(
      path.join(folder, "production-execution", "attempts", "fixture.json"),
      '{"fixture":true}',
    ),
  ]);
  const configurationFingerprint = productionAcceptanceConfigurationFingerprint(environment);
  const marker = {
    schemaVersion: "2",
    runId,
    topic,
    topicFingerprint: productionAcceptanceTopicFingerprint(topic),
    requestFingerprint: productionAcceptanceRequestFingerprint({
      topic,
      runId,
      configurationFingerprint,
    }),
    strictProductionAcceptance: true,
    publishMode: "package-only",
    configurationFingerprint,
    createdAt: "2026-07-16T00:00:00.000Z",
    acceptanceStatus: "prepared",
    productionReady: false,
    published: false,
    ...markerOverrides,
  };
  await fs.writeFile(markerPath, JSON.stringify(marker, null, 2));
  return { slug, folder, markerPath, marker };
}

async function createBinaries(first: string, second: string, changed: string) {
  const ffmpegA = path.join(first, "ffmpeg.exe");
  const ffprobeA = path.join(first, "ffprobe.exe");
  const ffmpegB = path.join(second, "renamed-ffmpeg.exe");
  const ffprobeB = path.join(second, "renamed-ffprobe.exe");
  const ffmpegChanged = path.join(changed, "ffmpeg.exe");
  const ffprobeChanged = path.join(changed, "ffprobe.exe");
  await fs.writeFile(ffmpegA, "stable-ffmpeg-binary-v1");
  await fs.writeFile(ffprobeA, "stable-ffprobe-binary-v1");
  await fs.copyFile(ffmpegA, ffmpegB);
  await fs.copyFile(ffprobeA, ffprobeB);
  await fs.writeFile(ffmpegChanged, "changed-ffmpeg-binary-v2");
  await fs.writeFile(ffprobeChanged, "changed-ffprobe-binary-v2");
  return { ffmpegA, ffprobeA, ffmpegB, ffprobeB, ffmpegChanged, ffprobeChanged };
}

function configurationEnvironment(overrides: Partial<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-reprepare-secret-value",
    OPENAI_MODEL: "gpt-production",
    OPENAI_MAX_TOKENS: "3200",
    OPENAI_TEMPERATURE: "0.4",
    OPENAI_RESEARCH_MAX_TOKENS: "3200",
    OPENAI_SCRIPT_MAX_TOKENS: "3200",
    OPENAI_VISUALS_MAX_TOKENS: "3200",
    IMAGE_PROVIDER: "openai",
    AUDIO_PROVIDER: "openai",
    ANIMATION_PROVIDER: "openai",
    VIDEO_PROVIDER: "ffmpeg",
    VIDEO_ASSEMBLY_PROVIDER: "ffmpeg",
    THUMBNAIL_PROVIDER: "openai",
    YOUTUBE_PROVIDER: "openai",
    ATOLYE_DURABLE_PIPELINE_EXECUTION: "true",
  };
  return Object.assign(environment, overrides);
}

function commandDependencies(
  reprepare: () => ReturnType<typeof reprepareProductionAcceptanceMarker>,
) {
  return {
    readiness: async () => { throw new Error("unexpected readiness"); },
    execute: async () => { throw new Error("unexpected execute"); },
    resume: async () => { throw new Error("unexpected resume"); },
    reprepare,
  };
}

function fileOperations(
  overrides: Partial<ProductionAcceptanceReprepareFileOperations>,
): ProductionAcceptanceReprepareFileOperations {
  return {
    readFile: (filePath) => fs.readFile(filePath),
    open: (filePath, flags) => fs.open(filePath, flags),
    rename: (source, destination) => fs.rename(source, destination),
    rm: (filePath, options) => fs.rm(filePath, options),
    lstat: (filePath) => fs.lstat(filePath),
    realpath: (filePath) => fs.realpath(filePath),
    ...overrides,
  };
}

async function readMarker(folder: string) {
  return JSON.parse(await fs.readFile(path.join(folder, "production-acceptance.json"), "utf8")) as
    Record<string, unknown>;
}

async function inventory(root: string, includeMarker: boolean) {
  const records: string[] = [];
  async function visit(folder: string) {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (includeMarker || absolute !== path.join(root, "production-acceptance.json")) {
        const bytes = await fs.readFile(absolute);
        records.push(
          `${path.relative(root, absolute)}|${bytes.length}|${createHash("sha256").update(bytes).digest("hex")}`,
        );
      }
    }
  }
  await visit(root);
  return records;
}

async function temporaryFiles(folder: string) {
  return (await fs.readdir(folder)).filter((name) => name.endsWith(".tmp"));
}

function isDisposableFixture(folder: string) {
  const projectsRoot = path.resolve("data", "projects");
  const resolved = path.resolve(folder);
  return path.dirname(resolved) === projectsRoot &&
    path.basename(resolved).includes("controlled-marker-reprepare-fixture");
}

async function exists(filePath: string) {
  try { await fs.stat(filePath); return true; } catch { return false; }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
