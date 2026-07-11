import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GET } from "../app/api/production/health/[slug]/route";
import { ProductionHealthPanelView } from "../src/components/studio/ProductionHealthPanel";
import {
  getProductionHealth,
  isProductionHealthApiConsumerError,
} from "../src/lib/production/ProductionHealthApiClient";
import { createProductionHealthErrorResponse } from "../src/lib/production/ProductionHealthApiError";
import { ProductionHealthService } from "../src/lib/production/ProductionHealthService";

const slug = "sprint-96-0-review";
const evaluatedAt = "2026-07-11T22:00:00.000Z";
const projectFolder = path.join(process.cwd(), "data", "projects", slug);

async function main() {
  assert.equal(await exists(projectFolder), false);

  let requestCache: RequestCache | undefined;
  let requestMethod: string | undefined;
  const routeFetch = (async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    requestCache = init?.cache;
    requestMethod = init?.method;
    return GET(new Request("http://localhost/api/production/health"), {
      params: Promise.resolve({ slug }),
    });
  }) as typeof fetch;

  const report = await getProductionHealth(slug, { fetchImpl: routeFetch });
  assert.equal(report.projectSlug, slug);
  assert.equal(report.generatedAt, report.snapshot.generatedAt);
  assert.equal(report.generatedAt, report.health.evaluatedAt);
  assert.equal(requestCache, "no-store");
  assert.equal(requestMethod, "GET");

  const directOne = await ProductionHealthService.getProductionHealth({
    projectSlug: slug,
    evaluatedAt,
  });
  const directTwo = await ProductionHealthService.getProductionHealth({
    projectSlug: slug,
    evaluatedAt,
  });
  assert.deepEqual(directOne, directTwo);
  assert.deepEqual(directOne.health.findings, directTwo.health.findings);

  for (const snapshotFinding of directOne.snapshot.findings) {
    const healthFinding = directOne.health.findings.find(
      (item) =>
        item.code === snapshotFinding.code &&
        item.stage === snapshotFinding.stage &&
        item.sources.join("|") === snapshotFinding.sources.join("|"),
    );
    assert.ok(healthFinding);
    assert.equal(healthFinding.detectedAt, snapshotFinding.detectedAt);
  }

  const routeResponse = await GET(
    new Request("http://localhost/api/production/health"),
    { params: Promise.resolve({ slug }) },
  );
  assert.equal(routeResponse.headers.get("cache-control"), "no-store, max-age=0");

  const ui = renderToStaticMarkup(
    createElement(ProductionHealthPanelView, {
      state: { kind: "success", report },
      onRetry: () => undefined,
    }),
  );
  assert.ok(ui.includes("Production Health"));
  assert.ok(ui.includes("Health findings"));
  assert.ok(ui.includes("Finding evidence"));

  await assert.rejects(
    getProductionHealth("../unsafe", { fetchImpl: routeFetch }),
    (error: unknown) => {
      assert.ok(isProductionHealthApiConsumerError(error));
      assert.equal(error.kind, "invalid_slug");
      assert.equal(error.message, "Invalid project slug.");
      return true;
    },
  );

  await assert.rejects(
    getProductionHealth(slug, {
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: {
              code: "SNAPSHOT_BUILD_FAILED",
              message: `secret ${projectFolder}`,
            },
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        )) as typeof fetch,
    }),
    (error: unknown) => {
      assert.ok(isProductionHealthApiConsumerError(error));
      assert.equal(error.kind, "api_error");
      assert.equal(error.message, "Production health could not be read.");
      assert.ok(!error.message.includes(projectFolder));
      return true;
    },
  );

  const internalResponse = await withMutedConsole(() =>
    Promise.resolve(
      createProductionHealthErrorResponse(
        new Error(`internal ${projectFolder}\nstack secret`),
      ),
    ),
  );
  const internalBody = await internalResponse.text();
  assert.ok(!internalBody.includes(projectFolder));
  assert.ok(!internalBody.includes("stack secret"));
  assert.ok(internalBody.includes("UNKNOWN_PRODUCTION_HEALTH_ERROR"));

  await verifySourceBoundaries();
  assert.equal(await exists(projectFolder), false);

  console.log(
    "Sprint 96.0 production intelligence phase review smoke: PASS (9 scenarios)",
  );
}

async function verifySourceBoundaries() {
  const readOnlyFiles = [
    "src/lib/production/ProductionHealthService.ts",
    "src/lib/production/ProductionSnapshotBuilder.ts",
    "src/lib/production/ProductionSnapshotSourceReader.ts",
    "src/lib/production/ProductionHealthEngine.ts",
    "app/api/production/health/[slug]/route.ts",
    "src/lib/production/ProductionHealthApiClient.ts",
    "src/components/studio/ProductionHealthPanel.tsx",
    "src/components/studio/ProductionHealthFindingsPanel.tsx",
    "src/components/studio/ProductionHealthFindingEvidence.tsx",
  ];
  const sources = await Promise.all(
    readOnlyFiles.map((fileName) => fs.readFile(fileName, "utf-8")),
  );
  const combined = sources.join("\n");
  assert.doesNotMatch(
    combined,
    /\b(writeFile|appendFile|mkdir|rename|unlink|writeJSON|updateStatus|setInterval)\b/,
  );

  const healthPanel = await fs.readFile(
    "src/components/studio/ProductionHealthPanel.tsx",
    "utf-8",
  );
  assert.match(healthPanel, /getProductionHealth/);
  assert.doesNotMatch(healthPanel, /\bfetch\s*\(/);
}

async function exists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function withMutedConsole<T>(action: () => Promise<T>) {
  const original = console.error;
  console.error = () => undefined;
  try {
    return await action();
  } finally {
    console.error = original;
  }
}

void main();
