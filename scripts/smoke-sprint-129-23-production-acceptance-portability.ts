import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runProductionAcceptanceCommand } from
  "../src/lib/production/ProductionAcceptanceCommand";
import {
  createProductionAcceptanceMarkerV3,
  diagnoseProductionAcceptanceConfiguration,
  productionAcceptanceConfigurationFingerprint,
  productionAcceptanceRequestFingerprint,
} from "../src/lib/production/ProductionAcceptancePolicy";
import { createProductionAcceptancePortableConfigurationSnapshot } from
  "../src/lib/production/ProductionAcceptanceConfigurationFingerprint";
import {
  createProductionAcceptanceProjectSlug,
  productionAcceptanceTopicFingerprint,
} from "../src/lib/production/ProductionAcceptanceTopic";
import { ProjectReader } from "../src/lib/projects/ProjectReader";

let scenarios = 0;

async function test(name: string, action: () => void | Promise<void>) {
  await action();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

async function main() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "atolye-129-23-"));
  const runtimeRoot = path.join(temporaryRoot, "runtime");
  const previousRuntimeRoot = process.env.ATOLYE_RUNTIME_ROOT;
  process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
  await fs.mkdir(path.join(runtimeRoot, "projects"), { recursive: true });
  const firstTools = path.join(temporaryRoot, "tools-a");
  const secondTools = path.join(temporaryRoot, "tools-b");
  await fs.mkdir(firstTools);
  await fs.mkdir(secondTools);
  const firstFFmpeg = path.join(firstTools, "ffmpeg.exe");
  const firstFFprobe = path.join(firstTools, "ffprobe.exe");
  const secondFFmpeg = path.join(secondTools, "renamed-ffmpeg.exe");
  const secondFFprobe = path.join(secondTools, "renamed-ffprobe.exe");
  await fs.writeFile(firstFFmpeg, "stable-ffmpeg-binary-v1");
  await fs.writeFile(firstFFprobe, "stable-ffprobe-binary-v1");
  await fs.copyFile(firstFFmpeg, secondFFmpeg);
  await fs.copyFile(firstFFprobe, secondFFprobe);

  const environment = configurationEnvironment({
    FFMPEG_PATH: firstFFmpeg,
    FFPROBE_PATH: firstFFprobe,
    ATOLYE_RUNTIME_ROOT: runtimeRoot,
  });
  const topic = "Portable production acceptance diagnostics";
  const runId = randomUUID();
  const slug = createProductionAcceptanceProjectSlug(topic, runId);
  const schema2Topic = "Legacy production acceptance diagnostics";
  const schema2RunId = randomUUID();
  const schema2Slug = createProductionAcceptanceProjectSlug(schema2Topic, schema2RunId);
  const fixtureFolders = [
    ProjectReader.getProjectFolder(slug),
    ProjectReader.getProjectFolder(schema2Slug),
  ];

  try {
    const snapshot = await createProductionAcceptancePortableConfigurationSnapshot(environment);
    assert.deepEqual(snapshot.unavailableComponents, []);
    await createProductionAcceptanceMarkerV3(slug, runId, snapshot, topic, environment);
    const markerPath = path.join(fixtureFolders[0], "production-acceptance.json");
    const markerBefore = await fs.readFile(markerPath);
    const inventoryBefore = await inventory(fixtureFolders[0]);

    await test("exact configuration matches", async () => {
      const result = await diagnoseProductionAcceptanceConfiguration(slug, environment);
      assert.equal(result.schemaVersion, "3");
      assert.equal(result.matches, true);
      assert.deepEqual(result.mismatchedComponents, []);
    });

    await test("diagnose command exits zero on match", async () => {
      const result = await command(slug, environment);
      assert.equal(result.exitCode, 0);
      assert.equal(result.report.matches, true);
    });

    await test("configuration mismatch exits non-zero", async () => {
      const result = await command(slug, {
        ...environment,
        OPENAI_MAX_TOKENS: "9999",
      });
      assert.equal(result.exitCode, 1);
      assert.deepEqual(result.report.mismatchedComponents, ["OPENAI_MAX_TOKENS"]);
    });

    await test("new schema reports component diagnostics", async () => {
      const result = await diagnoseProductionAcceptanceConfiguration(slug, {
        ...environment,
        AI_PROVIDER: "changed-provider",
        OPENAI_MODEL: "changed-model",
      });
      assert.equal(result.componentDiagnosticsAvailable, true);
      assert.deepEqual(result.mismatchedComponents, ["AI_PROVIDER", "OPENAI_MODEL"]);
    });

    await test("secret values identities hashes and paths are redacted", async () => {
      const changedSecret = "sk-super-secret-current-value";
      const result = await command(slug, { ...environment, OPENAI_API_KEY: changedSecret });
      const output = JSON.stringify(result.report);
      assert.equal(result.exitCode, 1);
      assert.deepEqual(result.report.mismatchedComponents, ["OPENAI_API_KEY"]);
      assert.equal(output.includes(environment.OPENAI_API_KEY!), false);
      assert.equal(output.includes(changedSecret), false);
      assert.equal(output.includes(firstFFmpeg), false);
      assert.equal(output.includes(firstFFprobe), false);
      assert.equal(/[a-f0-9]{64}/.test(output), false);
    });

    await test("same FFmpeg binaries under different paths match", async () => {
      const result = await diagnoseProductionAcceptanceConfiguration(slug, {
        ...environment,
        FFMPEG_PATH: secondFFmpeg,
        FFPROBE_PATH: secondFFprobe,
      });
      assert.equal(result.matches, true);
      assert.deepEqual(result.mismatchedComponents, []);
    });

    await test("changed FFmpeg binary is blocked", async () => {
      await fs.writeFile(secondFFmpeg, "changed-ffmpeg-binary-v2");
      const result = await diagnoseProductionAcceptanceConfiguration(slug, {
        ...environment,
        FFMPEG_PATH: secondFFmpeg,
        FFPROBE_PATH: secondFFprobe,
      });
      assert.equal(result.matches, false);
      assert.deepEqual(result.mismatchedComponents, ["FFMPEG_EXECUTABLE"]);
    });

    await test("provider change is blocked", async () => {
      const result = await diagnoseProductionAcceptanceConfiguration(slug, {
        ...environment,
        IMAGE_PROVIDER: "different-provider",
      });
      assert.equal(result.matches, false);
      assert.deepEqual(result.mismatchedComponents, ["IMAGE_PROVIDER"]);
    });

    await test("model change is blocked", async () => {
      const result = await diagnoseProductionAcceptanceConfiguration(slug, {
        ...environment,
        OPENAI_MODEL: "different-model",
      });
      assert.equal(result.matches, false);
      assert.deepEqual(result.mismatchedComponents, ["OPENAI_MODEL"]);
    });

    await test("API key identity change is blocked", async () => {
      const result = await diagnoseProductionAcceptanceConfiguration(slug, {
        ...environment,
        OPENAI_API_KEY: "sk-rotated-key",
      });
      assert.equal(result.matches, false);
      assert.deepEqual(result.mismatchedComponents, ["OPENAI_API_KEY"]);
    });

    await test("durable execution and token budget changes are blocked", async () => {
      const result = await diagnoseProductionAcceptanceConfiguration(slug, {
        ...environment,
        ATOLYE_DURABLE_PIPELINE_EXECUTION: "false",
        OPENAI_SCRIPT_MAX_TOKENS: "4800",
      });
      assert.equal(result.matches, false);
      assert.deepEqual(result.mismatchedComponents, [
        "OPENAI_SCRIPT_MAX_TOKENS",
        "ATOLYE_DURABLE_PIPELINE_EXECUTION",
      ]);
    });

    await test("diagnosis is write-free", async () => {
      assert.deepEqual(await fs.readFile(markerPath), markerBefore);
      assert.deepEqual(await inventory(fixtureFolders[0]), inventoryBefore);
    });

    await createSchema2Marker(schema2Slug, schema2RunId, schema2Topic, environment);
    const schema2Path = path.join(fixtureFolders[1], "production-acceptance.json");
    const schema2Before = await fs.readFile(schema2Path);

    await test("schema-2 exact match behavior remains available", async () => {
      const result = await diagnoseProductionAcceptanceConfiguration(schema2Slug, environment);
      assert.equal(result.schemaVersion, "2");
      assert.equal(result.matches, true);
      assert.equal(result.componentDiagnosticsAvailable, false);
      assert.deepEqual(result.mismatchedComponents, []);
    });

    await test("schema-2 mismatch stays aggregate-only", async () => {
      const result = await diagnoseProductionAcceptanceConfiguration(schema2Slug, {
        ...environment,
        OPENAI_MODEL: "legacy-mismatch",
      });
      assert.equal(result.matches, false);
      assert.equal(result.componentDiagnosticsAvailable, false);
      assert.deepEqual(result.mismatchedComponents, []);
      assert.deepEqual(await fs.readFile(schema2Path), schema2Before);
    });

    await test("diagnose rejects confirmation and unknown arguments", async () => {
      const dependencies = commandDependencies(environment);
      const result = await runProductionAcceptanceCommand([
        "diagnose",
        `--project-slug=${slug}`,
        "--confirm-production-acceptance",
      ], dependencies);
      assert.equal(result.exitCode, 2);
    });
  } finally {
    for (const folder of fixtureFolders) {
      if (isDisposableFixture(folder, slug, schema2Slug)) {
        await fs.rm(folder, { recursive: true, force: true });
      }
    }
    if (previousRuntimeRoot === undefined) delete process.env.ATOLYE_RUNTIME_ROOT;
    else process.env.ATOLYE_RUNTIME_ROOT = previousRuntimeRoot;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
  assert.equal(await exists(fixtureFolders[0]), false);
  assert.equal(await exists(fixtureFolders[1]), false);
  process.stdout.write(`Sprint 129.23 production acceptance portability smoke: PASS (${scenarios} scenarios)\n`);
}

function configurationEnvironment(overrides: Partial<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-super-secret-marker-value",
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

async function command(projectSlug: string, environment: NodeJS.ProcessEnv) {
  return runProductionAcceptanceCommand(
    ["diagnose", `--project-slug=${projectSlug}`],
    commandDependencies(environment),
  );
}

function commandDependencies(environment: NodeJS.ProcessEnv) {
  return {
    readiness: async () => { throw new Error("unexpected readiness"); },
    execute: async () => { throw new Error("unexpected execute"); },
    resume: async () => { throw new Error("unexpected resume"); },
    diagnose: (projectSlug: string) =>
      diagnoseProductionAcceptanceConfiguration(projectSlug, environment),
  };
}

async function createSchema2Marker(
  projectSlug: string,
  runId: string,
  topic: string,
  environment: NodeJS.ProcessEnv,
) {
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
  };
  await fs.mkdir(ProjectReader.getProjectFolder(projectSlug), { recursive: true });
  await fs.writeFile(
    path.join(ProjectReader.getProjectFolder(projectSlug), "production-acceptance.json"),
    `${JSON.stringify(marker, null, 2)}\n`,
    "utf8",
  );
}

async function inventory(root: string) {
  const names = await fs.readdir(root);
  const records = await Promise.all(names.sort().map(async (name) => {
    const bytes = await fs.readFile(path.join(root, name));
    return `${name}|${bytes.length}|${createHash("sha256").update(bytes).digest("hex")}`;
  }));
  return records;
}

function isDisposableFixture(folder: string, ...slugs: string[]) {
  const resolved = path.resolve(folder);
  const projectsRoot = path.resolve("data", "projects");
  return slugs.some((slug) => resolved === path.join(projectsRoot, slug)) &&
    path.dirname(resolved) === projectsRoot;
}

async function exists(filePath: string) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
