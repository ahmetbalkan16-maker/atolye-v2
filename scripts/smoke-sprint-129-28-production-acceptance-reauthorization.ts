import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  planProductionAcceptanceLegacyReauthorization,
  reauthorizeProductionAcceptanceLegacyMarker,
} from "../src/lib/production/ProductionAcceptanceLegacyReauthorizationService";
import {
  ProductionAcceptanceLegacyReauthorizationError,
  sha256Bytes,
} from "../src/lib/production/ProductionAcceptanceLegacyReauthorization";
import {
  diagnoseProductionAcceptanceConfiguration,
  prepareProductionAcceptanceMarkerReprepare,
  productionAcceptanceConfigurationFingerprint,
  productionAcceptanceRequestFingerprint,
  resolveEffectiveProductionAcceptanceAuthority,
} from "../src/lib/production/ProductionAcceptancePolicy";
import {
  createProductionAcceptanceProjectSlug,
  productionAcceptanceTopicFingerprint,
} from "../src/lib/production/ProductionAcceptanceTopic";
import { runProductionAcceptanceCommand } from
  "../src/lib/production/ProductionAcceptanceCommand";

let scenarios = 0;
const scenario = async (name: string, run: () => void | Promise<void>) => {
  await run();
  scenarios += 1;
  process.stdout.write(`PASS ${scenarios}: ${name}\n`);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-sprint-129-28-"));
const runtimeRoot = path.join(root, "runtime");
const authorityRoot = path.join(root, "authority");
fs.mkdirSync(path.join(runtimeRoot, "projects"), { recursive: true });
const previousRuntimeRoot = process.env.ATOLYE_RUNTIME_ROOT;
process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
const ffmpeg = path.join(root, "ffmpeg.exe");
const ffprobe = path.join(root, "ffprobe.exe");
fs.writeFileSync(ffmpeg, "ffmpeg-binary-v1");
fs.writeFileSync(ffprobe, "ffprobe-binary-v1");

const environment = {
  ...process.env,
  ATOLYE_RUNTIME_ROOT: runtimeRoot,
  AI_PROVIDER: "openai",
  IMAGE_PROVIDER: "openai",
  AUDIO_PROVIDER: "openai",
  ANIMATION_PROVIDER: "openai",
  VIDEO_PROVIDER: "ffmpeg",
  VIDEO_ASSEMBLY_PROVIDER: "ffmpeg",
  THUMBNAIL_PROVIDER: "openai",
  YOUTUBE_PROVIDER: "openai",
  ATOLYE_DURABLE_PIPELINE_EXECUTION: "enabled",
  OPENAI_API_KEY: "sprint-129-28-secret",
  FFMPEG_PATH: ffmpeg,
  FFPROBE_PATH: ffprobe,
} satisfies NodeJS.ProcessEnv;

const recovery = () => Promise.resolve({
  blocked: false,
  startStage: "audio",
  stagesToRun: ["audio", "assembly"],
  dependencies: [],
});
const jobs = () => Promise.resolve([]);

function fixture(suffix: string) {
  const runId = crypto.randomUUID();
  const topic = `Sprint 129 28 ${suffix}`;
  const slug = createProductionAcceptanceProjectSlug(topic, runId);
  const folder = path.join(runtimeRoot, "projects", slug);
  fs.mkdirSync(folder);
  const legacyEnvironment = { ...environment, OPENAI_MODEL: `legacy-${suffix}` };
  const configurationFingerprint = productionAcceptanceConfigurationFingerprint(legacyEnvironment);
  const marker = {
    schemaVersion: "2",
    runId,
    topic,
    topicFingerprint: productionAcceptanceTopicFingerprint(topic),
    requestFingerprint: productionAcceptanceRequestFingerprint({ topic, runId, configurationFingerprint }),
    strictProductionAcceptance: true,
    publishMode: "package-only",
    configurationFingerprint,
    createdAt: "2026-07-21T00:00:00.000Z",
    acceptanceStatus: "prepared",
    productionReady: false,
    published: false,
  } as const;
  const markerPath = path.join(folder, "production-acceptance.json");
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2));
  fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify({ fixture: suffix }));
  const markerBytes = fs.readFileSync(markerPath);
  return { slug, folder, marker, markerPath, markerBytes, markerSha256: sha256Bytes(markerBytes) };
}

const deps = {
  environment,
  workspaceRoot: root,
  authorityRoot,
  recoverySnapshot: recovery,
  jobSnapshot: jobs,
};

async function main() {
try {
  await scenario("happy path publishes immutable archive and authority", async () => {
    const item = fixture("happy");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    const result = await reauthorizeProductionAcceptanceLegacyMarker({
      projectSlug: item.slug,
      sourceMarkerSha256: item.markerSha256,
      reason: "legacy-environment-unrecoverable",
      reauthorizationId: plan.reauthorizationId,
      confirmation: plan.reauthorizationId,
    }, deps);
    assert.equal(result.decision, "reauthorized");
    assert.equal(result.writePerformed, true);
    assert.deepEqual(fs.readFileSync(item.markerPath), item.markerBytes);
    assert.equal(fs.existsSync(path.join(item.folder, "production-acceptance-reauthorization.json")), true);
    assert.equal(fs.existsSync(path.join(
      item.folder,
      "production-acceptance-authority",
      "legacy",
      `${item.markerSha256}.json`,
    )), true);
  });

  await scenario("exact replay is mutation-free", async () => {
    const item = fixture("replay");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    const input = { projectSlug: item.slug, sourceMarkerSha256: item.markerSha256,
      reason: "legacy-environment-unrecoverable", reauthorizationId: plan.reauthorizationId,
      confirmation: plan.reauthorizationId };
    await reauthorizeProductionAcceptanceLegacyMarker(input, deps);
    const authorityPath = path.join(item.folder, "production-acceptance-reauthorization.json");
    const before = fs.readFileSync(authorityPath);
    const replay = await reauthorizeProductionAcceptanceLegacyMarker(input, deps);
    assert.equal(replay.decision, "replayed");
    assert.equal(replay.writePerformed, false);
    assert.deepEqual(fs.readFileSync(authorityPath), before);
  });

  await scenario("normal legacy reprepare mismatch remains fail closed", async () => {
    const item = fixture("normal-reprepare");
    await assert.rejects(
      prepareProductionAcceptanceMarkerReprepare(item.slug, item.marker, environment),
    );
  });

  await scenario("schema-2 without authority retains legacy diagnose", async () => {
    const item = fixture("legacy-diagnose");
    const diagnostic = await diagnoseProductionAcceptanceConfiguration(item.slug, environment);
    assert.equal(diagnostic.schemaVersion, "2");
    assert.equal(diagnostic.matches, false);
    assert.equal(diagnostic.componentDiagnosticsAvailable, false);
  });

  await scenario("valid sidecar resolves effective profile-2 authority", async () => {
    const item = fixture("effective");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    await reauthorizeProductionAcceptanceLegacyMarker({ projectSlug: item.slug,
      sourceMarkerSha256: item.markerSha256, reason: "legacy-environment-unrecoverable",
      reauthorizationId: plan.reauthorizationId, confirmation: plan.reauthorizationId }, deps);
    const resolved = await resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined, environment);
    assert.equal(resolved.source, "legacy-reauthorization");
    assert.equal(resolved.marker.schemaVersion, "3");
    assert.equal("componentFingerprintProfile" in resolved.marker, true);
  });

  await scenario("exact confirmation is required", async () => {
    const item = fixture("confirmation");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    await assert.rejects(
      reauthorizeProductionAcceptanceLegacyMarker({ projectSlug: item.slug,
        sourceMarkerSha256: item.markerSha256, reason: "legacy-environment-unrecoverable",
        reauthorizationId: plan.reauthorizationId, confirmation: "0".repeat(64) }, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONFIRMATION_REQUIRED",
    );
    assert.equal(fs.existsSync(path.join(item.folder, "production-acceptance-reauthorization.json")), false);
  });

  await scenario("wrong source hash fails before mutation", async () => {
    const item = fixture("source-hash");
    await assert.rejects(
      planProductionAcceptanceLegacyReauthorization(item.slug, "0".repeat(64), deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_SOURCE_HASH_MISMATCH",
    );
  });

  await scenario("binary unavailable fails closed", async () => {
    const item = fixture("binary-unavailable");
    const broken = { ...deps, environment: { ...environment, FFMPEG_PATH: path.join(root, "missing.exe") } };
    await assert.rejects(
      planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, broken),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONFIGURATION_UNAVAILABLE",
    );
  });

  await scenario("recovery stage mismatch fails closed", async () => {
    const item = fixture("recovery-stage");
    await assert.rejects(
      planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, {
        ...deps,
        recoverySnapshot: () => Promise.resolve({ blocked: false, startStage: "assembly", stagesToRun: [], dependencies: [] }),
      }),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_INVALID",
    );
  });

  await scenario("active execution fails closed", async () => {
    const item = fixture("active-job");
    await assert.rejects(
      planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, {
        ...deps,
        jobSnapshot: () => Promise.resolve([{ status: "running" }]),
      }),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_INVALID",
    );
  });

  await scenario("environment drift invalidates confirmation", async () => {
    const item = fixture("environment-drift");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    await assert.rejects(
      reauthorizeProductionAcceptanceLegacyMarker({ projectSlug: item.slug,
        sourceMarkerSha256: item.markerSha256, reason: "legacy-environment-unrecoverable",
        reauthorizationId: plan.reauthorizationId, confirmation: plan.reauthorizationId }, {
          ...deps,
          environment: { ...environment, OPENAI_AUDIO_MAX_TOKENS: "4096" },
        }),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_ENVIRONMENT_DRIFT",
    );
  });

  await scenario("same bytes different inode during operation fails closed", async () => {
    const item = fixture("inode-swap");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    let calls = 0;
    await assert.rejects(
      reauthorizeProductionAcceptanceLegacyMarker({ projectSlug: item.slug,
        sourceMarkerSha256: item.markerSha256, reason: "legacy-environment-unrecoverable",
        reauthorizationId: plan.reauthorizationId, confirmation: plan.reauthorizationId }, {
          ...deps,
          recoverySnapshot: async () => {
            calls += 1;
            if (calls === 2) {
              fs.renameSync(item.markerPath, `${item.markerPath}.owned`);
              fs.writeFileSync(item.markerPath, item.markerBytes);
            }
            return recovery();
          },
        }),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_CONCURRENT_CHANGE",
    );
    assert.deepEqual(fs.readFileSync(item.markerPath), item.markerBytes);
  });

  await scenario("foreign authority blocks overwrite", async () => {
    const item = fixture("foreign-authority");
    fs.writeFileSync(path.join(item.folder, "production-acceptance-reauthorization.json"), "foreign");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    await assert.rejects(
      reauthorizeProductionAcceptanceLegacyMarker({ projectSlug: item.slug,
        sourceMarkerSha256: item.markerSha256, reason: "legacy-environment-unrecoverable",
        reauthorizationId: plan.reauthorizationId, confirmation: plan.reauthorizationId }, deps),
    );
    assert.equal(fs.readFileSync(path.join(item.folder, "production-acceptance-reauthorization.json"), "utf8"), "foreign");
  });

  await scenario("foreign deterministic partial is preserved", async () => {
    const item = fixture("foreign-partial");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    const legacy = path.join(item.folder, "production-acceptance-authority", "legacy");
    fs.mkdirSync(legacy, { recursive: true });
    const partial = path.join(legacy, `.archive-${plan.reauthorizationId}.partial`);
    fs.writeFileSync(partial, "foreign-partial");
    await assert.rejects(
      reauthorizeProductionAcceptanceLegacyMarker({ projectSlug: item.slug,
        sourceMarkerSha256: item.markerSha256, reason: "legacy-environment-unrecoverable",
        reauthorizationId: plan.reauthorizationId, confirmation: plan.reauthorizationId }, deps),
      (error) => error instanceof ProductionAcceptanceLegacyReauthorizationError &&
        error.code === "PRODUCTION_ACCEPTANCE_REAUTHORIZATION_RECOVERY_REQUIRED",
    );
    assert.equal(fs.readFileSync(partial, "utf8"), "foreign-partial");
  });

  await scenario("command rejects malformed duplicate and unknown arguments", async () => {
    const dependencies = {
      readiness: async () => ({ ready: false, checks: [] }) as never,
      execute: async () => { throw new Error("not called"); },
      resume: async () => { throw new Error("not called"); },
    };
    for (const args of [
      ["legacy-reauthorization-plan", "--project-slug=x"],
      ["legacy-reauthorization-plan", "--project-slug=x", `--source-marker-sha256=${"0".repeat(64)}`, "--unknown=x"],
      ["reauthorize-legacy", "--project-slug=x", `--source-marker-sha256=${"0".repeat(64)}`],
    ]) {
      const result = await runProductionAcceptanceCommand(args, dependencies);
      assert.equal(result.exitCode, 2);
    }
  });

  await scenario("command plan path invokes no pipeline or provider dependency", async () => {
    const item = fixture("command-plan");
    let planned = 0;
    const result = await runProductionAcceptanceCommand([
      "legacy-reauthorization-plan",
      `--project-slug=${item.slug}`,
      `--source-marker-sha256=${item.markerSha256}`,
    ], {
      readiness: async () => { throw new Error("not called"); },
      execute: async () => { throw new Error("not called"); },
      resume: async () => { throw new Error("not called"); },
      legacyReauthorizationPlan: async () => {
        planned += 1;
        return { eligible: true, projectSlug: item.slug, sourceMarkerSha256: item.markerSha256,
          reauthorizationId: "1".repeat(64), reason: "legacy-environment-unrecoverable",
          writePerformed: false };
      },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(planned, 1);
  });

  await scenario("native schema-3 authority ignores foreign legacy sidecar", async () => {
    const item = fixture("native-v3");
    const plan = await planProductionAcceptanceLegacyReauthorization(item.slug, item.markerSha256, deps);
    await reauthorizeProductionAcceptanceLegacyMarker({ projectSlug: item.slug,
      sourceMarkerSha256: item.markerSha256, reason: "legacy-environment-unrecoverable",
      reauthorizationId: plan.reauthorizationId, confirmation: plan.reauthorizationId }, deps);
    const legacyResolved = await resolveEffectiveProductionAcceptanceAuthority(item.slug, undefined, environment);
    assert.equal(legacyResolved.marker.schemaVersion, "3");
    fs.writeFileSync(item.markerPath, JSON.stringify(legacyResolved.marker));
    fs.writeFileSync(path.join(item.folder, "production-acceptance-reauthorization.json"), "foreign", { flag: "w" });
    const native = await resolveEffectiveProductionAcceptanceAuthority(item.slug, legacyResolved.marker, environment);
    assert.equal(native.source, "native");
  });

  await scenario("public command errors remain path and secret free", async () => {
    const result = await runProductionAcceptanceCommand([
      "reauthorize-legacy",
      "--project-slug=safe-project",
      `--source-marker-sha256=${"0".repeat(64)}`,
      "--reason=legacy-environment-unrecoverable",
      `--reauthorization-id=${"1".repeat(64)}`,
      `--confirm-production-acceptance-legacy-reauthorization=${"2".repeat(64)}`,
    ]);
    const text = JSON.stringify(result.report);
    assert.equal(text.includes(root), false);
    assert.equal(text.includes(environment.OPENAI_API_KEY), false);
    assert.equal(/stack|AppData|ENOENT/.test(text), false);
  });

  process.stdout.write(`Sprint 129.28 legacy re-authorization smoke: PASS (${scenarios} scenarios)\n`);
} finally {
  if (previousRuntimeRoot === undefined) delete process.env.ATOLYE_RUNTIME_ROOT;
  else process.env.ATOLYE_RUNTIME_ROOT = previousRuntimeRoot;
  fs.rmSync(root, { recursive: true, force: true });
}
}

void main().catch((error) => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* Preserve failure. */ }
  throw error;
});
