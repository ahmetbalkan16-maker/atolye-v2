import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runProductionAcceptanceCommand } from "../src/lib/production/ProductionAcceptanceCommand";
import type { ProductionAcceptanceResult } from "../src/lib/production/ProductionAcceptanceOrchestrator";
import {
  createProductionAcceptanceMarker,
  markProductionAcceptanceValidated,
  productionAcceptanceConfigurationFingerprint,
  productionAcceptanceRequestFingerprint,
  readProductionAcceptanceMarker,
  readProductionAcceptancePolicy,
} from "../src/lib/production/ProductionAcceptancePolicy";
import {
  createProductionAcceptanceProjectSlug,
  productionAcceptanceTopicFingerprint,
  productionAcceptanceTopicLimits,
} from "../src/lib/production/ProductionAcceptanceTopic";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import type { ProductionReadinessReport } from "../src/types/productionReadiness";

const confirmation = "--confirm-production-acceptance";
const canonicalTopic = "Fatih Sultan Mehmet’in İstanbul’un fethine hazırlanışı";
const now = "2026-07-15T00:00:00.000Z";
const readiness = {
  schemaVersion: "1",
  generatedAt: now,
  ready: true,
  checks: [],
} as unknown as ProductionReadinessReport;
const completion = {
  completion: {
    projectSlug: "acceptance-fixture",
    published: false,
    productionReady: true,
  },
} as unknown as ProductionAcceptanceResult;

let passed = 0;

async function test(name: string, action: () => void | Promise<void>) {
  await action();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

function dependencies(onExecute?: (topic: string) => void) {
  return {
    readiness: async () => readiness,
    execute: async (request: { readonly topic: string }) => {
      onExecute?.(request.topic);
      return completion;
    },
    resume: async () => completion,
  };
}

async function commandError(args: readonly string[], code: string) {
  let executions = 0;
  const result = await runProductionAcceptanceCommand(args, dependencies(() => {
    executions += 1;
  }));
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.errorCode, code);
  assert.equal(executions, 0);
}

async function createMarker(topic = canonicalTopic, runId = crypto.randomUUID()) {
  const configurationFingerprint = productionAcceptanceConfigurationFingerprint();
  const slug = createProductionAcceptanceProjectSlug(topic, runId);
  await createProductionAcceptanceMarker(slug, runId, configurationFingerprint, topic);
  return { slug, runId, topic, configurationFingerprint };
}

async function main() {
  const originalCwd = process.cwd();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "atolye-sprint-129-5-"));
  fs.mkdirSync(path.join(workspace, "data", "projects"), { recursive: true });
  process.chdir(workspace);
  try {
    await test("valid topic is accepted and trimmed", async () => {
      let received = "";
      const result = await runProductionAcceptanceCommand(
        ["execute", confirmation, `--topic=  ${canonicalTopic}  `],
        dependencies((topic) => { received = topic; }),
      );
      assert.equal(result.exitCode, 0);
      assert.equal(received, canonicalTopic);
    });
    await test("missing topic is rejected", () => commandError(
      ["execute", confirmation],
      "PRODUCTION_ACCEPTANCE_TOPIC_MISSING",
    ));
    await test("empty topic is rejected", () => commandError(
      ["execute", confirmation, "--topic="],
      "PRODUCTION_ACCEPTANCE_TOPIC_EMPTY",
    ));
    await test("whitespace topic is rejected", () => commandError(
      ["execute", confirmation, "--topic=   "],
      "PRODUCTION_ACCEPTANCE_TOPIC_EMPTY",
    ));
    await test("duplicate topic is rejected", () => commandError(
      ["execute", confirmation, "--topic=First topic", "--topic=Second topic"],
      "PRODUCTION_ACCEPTANCE_TOPIC_DUPLICATE",
    ));
    await test("unknown argument is rejected", () => commandError(
      ["execute", confirmation, `--topic=${canonicalTopic}`, "--unexpected"],
      "PRODUCTION_ACCEPTANCE_ARGUMENT_UNKNOWN",
    ));
    await test("control character is rejected", () => commandError(
      ["execute", confirmation, "--topic=Valid\u0007topic"],
      "PRODUCTION_ACCEPTANCE_TOPIC_INVALID",
    ));
    await test("topic below minimum is rejected", () => commandError(
      ["execute", confirmation, "--topic=1234567"],
      "PRODUCTION_ACCEPTANCE_TOPIC_TOO_SHORT",
    ));
    await test("topic above maximum is rejected", () => commandError(
      ["execute", confirmation, `--topic=${"a".repeat(productionAcceptanceTopicLimits.maximumCharacters + 1)}`],
      "PRODUCTION_ACCEPTANCE_TOPIC_TOO_LONG",
    ));
    await test("Turkish topic is accepted", async () => {
      let received = "";
      const result = await runProductionAcceptanceCommand(
        ["execute", confirmation, `--topic=${canonicalTopic}`],
        dependencies((topic) => { received = topic; }),
      );
      assert.equal(result.exitCode, 0);
      assert.equal(received, canonicalTopic);
    });
    await test("safe apostrophe topic is accepted", async () => {
      const topic = "İstanbul'un fethine hazırlık süreci";
      let received = "";
      const result = await runProductionAcceptanceCommand(
        ["execute", `--topic=${topic}`, confirmation],
        dependencies((value) => { received = value; }),
      );
      assert.equal(result.exitCode, 0);
      assert.equal(received, topic);
    });
    await test("confirmation remains mandatory", () => commandError(
      ["execute", `--topic=${canonicalTopic}`],
      "PRODUCTION_ACCEPTANCE_CONFIRMATION_REQUIRED",
    ));

    await test("same topic and runId produce same slug", () => {
      const runId = crypto.randomUUID();
      assert.equal(
        createProductionAcceptanceProjectSlug(canonicalTopic, runId),
        createProductionAcceptanceProjectSlug(canonicalTopic, runId),
      );
    });
    await test("different topic and same runId produce different slug", () => {
      const runId = crypto.randomUUID();
      assert.notEqual(
        createProductionAcceptanceProjectSlug(canonicalTopic, runId),
        createProductionAcceptanceProjectSlug("İstanbul fethinin lojistik hazırlıkları", runId),
      );
    });
    await test("topic participates in request fingerprint", () => {
      const runId = crypto.randomUUID();
      const configurationFingerprint = productionAcceptanceConfigurationFingerprint();
      assert.notEqual(
        productionAcceptanceRequestFingerprint({ topic: canonicalTopic, runId, configurationFingerprint }),
        productionAcceptanceRequestFingerprint({ topic: "İstanbul fethinin lojistik hazırlıkları", runId, configurationFingerprint }),
      );
    });
    await test("topic mutation creates replay conflict", async () => {
      const marker = await createMarker();
      const file = path.join(ProjectReader.getProjectFolder(marker.slug), "production-acceptance.json");
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      value.topic = "İstanbul fethinin lojistik hazırlıkları";
      fs.writeFileSync(file, JSON.stringify(value));
      await assert.rejects(() => readProductionAcceptanceMarker(marker.slug));
    });
    await test("validated marker replay is write-free", async () => {
      const marker = await createMarker();
      await markProductionAcceptanceValidated(marker.slug, marker.configurationFingerprint);
      const file = path.join(ProjectReader.getProjectFolder(marker.slug), "production-acceptance.json");
      const first = fs.readFileSync(file);
      await markProductionAcceptanceValidated(marker.slug, marker.configurationFingerprint);
      assert(fs.readFileSync(file).equals(first));
    });

    await test("marker stores canonical topic and fingerprints", async () => {
      const marker = await createMarker();
      const stored = await readProductionAcceptanceMarker(marker.slug);
      assert.equal(stored.topic, canonicalTopic);
      assert.equal(stored.topicFingerprint, productionAcceptanceTopicFingerprint(canonicalTopic));
      assert.equal(stored.requestFingerprint, productionAcceptanceRequestFingerprint(marker));
    });
    await test("resume identity is derived from marker topic", async () => {
      const marker = await createMarker();
      const stored = await readProductionAcceptanceMarker(marker.slug);
      assert.equal(createProductionAcceptanceProjectSlug(stored.topic, stored.runId), marker.slug);
    });
    await test("resume CLI rejects topic argument", () => commandError(
      ["resume-finalize", "--project-slug=acceptance-fixture", confirmation, `--topic=${canonicalTopic}`],
      "PRODUCTION_ACCEPTANCE_ARGUMENT_UNKNOWN",
    ));
    await test("marker without topic fails closed", async () => {
      const marker = await createMarker();
      const file = path.join(ProjectReader.getProjectFolder(marker.slug), "production-acceptance.json");
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      delete value.topic;
      fs.writeFileSync(file, JSON.stringify(value));
      await assert.rejects(() => readProductionAcceptanceMarker(marker.slug));
    });
    await test("marker with invalid topic fails closed", async () => {
      const marker = await createMarker();
      const file = path.join(ProjectReader.getProjectFolder(marker.slug), "production-acceptance.json");
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      value.topic = "Invalid\u0007topic";
      fs.writeFileSync(file, JSON.stringify(value));
      await assert.rejects(() => readProductionAcceptanceMarker(marker.slug));
    });
    await test("slug topic and runId mismatch fails closed", async () => {
      const marker = await createMarker();
      const wrongSlug = `wrong-${crypto.randomUUID()}`;
      const wrongFolder = ProjectReader.getProjectFolder(wrongSlug);
      fs.mkdirSync(wrongFolder);
      fs.copyFileSync(
        path.join(ProjectReader.getProjectFolder(marker.slug), "production-acceptance.json"),
        path.join(wrongFolder, "production-acceptance.json"),
      );
      await assert.rejects(() => readProductionAcceptanceMarker(wrongSlug));
    });
    await test("marker policy remains strict package-only and unpublished", async () => {
      const marker = await createMarker();
      const policy = await readProductionAcceptancePolicy(marker.slug);
      const stored = await readProductionAcceptanceMarker(marker.slug);
      assert.deepEqual(policy, {
        strictProductionAcceptance: true,
        youtubePublishMode: "package-only",
      });
      assert.equal(stored.published, false);
      assert.equal(stored.productionReady, false);
    });

    process.stdout.write(`Sprint 129.5 production acceptance topic smoke PASS: ${passed} scenarios.\n`);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  process.stderr.write(`Sprint 129.5 production acceptance topic smoke FAILED: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
