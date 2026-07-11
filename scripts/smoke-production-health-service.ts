import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { GET } from "../app/api/production/health/[slug]/route";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { pipelineRecoveryStageOrder } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { createProductionHealthErrorResponse } from "../src/lib/production/ProductionHealthApiError";
import { ProductionHealthError } from "../src/lib/production/ProductionHealthError";
import { ProductionHealthEngine } from "../src/lib/production/ProductionHealthEngine";
import { ProductionHealthService } from "../src/lib/production/ProductionHealthService";
import type { AIUsageLog } from "../src/types/aiUsage";
import type {
  PipelineJob,
  PipelineJobHistory,
  PipelineJobList,
} from "../src/types/pipelineJob";
import type {
  ProductionStepKey,
  Project,
  ProjectManifest,
} from "../src/types/project";

const evaluatedAt = "2026-07-11T17:00:00.000Z";
const sourceDetectedAt = "2026-07-11T16:59:00.000Z";
const slug = `sprint-95-5-health-${process.pid}`;
const projectFolder = path.join(process.cwd(), "data", "projects", slug);

function project(status: Project["status"] = "completed"): Project {
  return {
    id: "project-95-5",
    slug,
    title: "Sprint 95.5 Health",
    status,
    createdAt: sourceDetectedAt,
    updatedAt: sourceDetectedAt,
  };
}

function manifest(projectValue = project()): ProjectManifest {
  return {
    project: projectValue,
    projectId: projectValue.id,
    slug,
    version: 1,
    packages: Object.fromEntries(
      pipelineRecoveryStageOrder.map((stage) => [
        stage,
        {
          key: stage,
          status: "completed",
          fileName: `${stage}.json`,
          startedAt: sourceDetectedAt,
          completedAt: sourceDetectedAt,
          durationMs: 100,
        },
      ]),
    ) as ProjectManifest["packages"],
    createdAt: sourceDetectedAt,
    updatedAt: sourceDetectedAt,
  };
}

function job(
  stage: ProductionStepKey,
  status: PipelineJob["status"] = "completed",
): PipelineJob {
  return {
    id: `${slug}-${stage}`,
    projectSlug: slug,
    stage,
    title: stage,
    status,
    attempts: 0,
    createdAt: sourceDetectedAt,
    updatedAt: sourceDetectedAt,
    startedAt: sourceDetectedAt,
    completedAt:
      status === "queued" || status === "running"
        ? undefined
        : sourceDetectedAt,
  };
}

function jobs(
  items = pipelineRecoveryStageOrder.map((stage) => job(stage)),
): PipelineJobList {
  return {
    projectSlug: slug,
    jobs: items,
    createdAt: sourceDetectedAt,
    updatedAt: sourceDetectedAt,
  };
}

function history(): PipelineJobHistory {
  return {
    projectSlug: slug,
    events: [],
    createdAt: sourceDetectedAt,
    updatedAt: sourceDetectedAt,
  };
}

function usage(): AIUsageLog {
  return {
    projectSlug: slug,
    records: [],
    createdAt: sourceDetectedAt,
    updatedAt: sourceDetectedAt,
  };
}

async function main() {
  await fs.rm(projectFolder, { recursive: true, force: true });
  await fs.mkdir(projectFolder, { recursive: true });

  try {
    await writeCompleteFixture();

    const complete = await getHealth();
    assert.equal(complete.projectSlug, slug);
    assert.equal(complete.generatedAt, evaluatedAt);
    assert.equal(complete.snapshot.generatedAt, evaluatedAt);
    assert.equal(complete.health.evaluatedAt, evaluatedAt);
    assert.equal(complete.health.status, "healthy");

    await writeJson("project.json", project("video"));
    const partial = await getHealth();
    assert.equal(partial.snapshot.project.projectStatus.state, "known");

    await fs.rm(file("project.json"));
    const missingProject = await getHealth();
    assert.equal(missingProject.snapshot.sourceState.project.status, "missing");

    await writeJson("project.json", project());
    await fs.writeFile(file("manifest.json"), "{ malformed", "utf-8");
    const malformedManifest = await getHealth();
    assert.equal(malformedManifest.snapshot.sourceState.manifest.status, "malformed");

    await writeJson("manifest.json", manifest());
    const originalRead = ProjectReader.readJSONState;
    ProjectReader.readJSONState = async function <T>(
      projectSlug: string,
      fileName: string,
    ) {
      if (projectSlug === slug && fileName === "ai-usage.json") {
        throw new Error("synthetic unreadable source");
      }
      return originalRead.call(ProjectReader, projectSlug, fileName) as ReturnType<
        typeof ProjectReader.readJSONState<T>
      >;
    };
    try {
      const unreadable = await getHealth();
      assert.equal(unreadable.snapshot.sourceState.aiUsage.status, "unreadable");
    } finally {
      ProjectReader.readJSONState = originalRead;
    }

    await fs.rm(file("pipeline-jobs.json"));
    assert.equal((await getHealth()).snapshot.sourceState.jobs.status, "missing");
    await writeJson("pipeline-jobs.json", jobs());

    await fs.writeFile(file("pipeline-history.json"), "[] trailing", "utf-8");
    assert.equal((await getHealth()).snapshot.sourceState.history.status, "malformed");
    await writeJson("pipeline-history.json", history());

    await fs.rm(file("ai-usage.json"));
    assert.equal((await getHealth()).snapshot.sourceState.aiUsage.status, "missing");
    await writeJson("ai-usage.json", usage());

    await fs.rm(file("research.json"));
    const missingOutput = await getHealth();
    assert.equal(missingOutput.snapshot.stages[0].outputReady.state, "known");
    assert.ok(hasCode(missingOutput, "completed_stage_missing_output"));
    await writeJson("research.json", { stage: "research" });

    const cancelledJobs = jobs([job("research", "cancelled")]);
    await writeJson("pipeline-jobs.json", cancelledJobs);
    const cancelled = await getHealth();
    assert.equal(cancelled.snapshot.stages[0].effectiveStatus, "cancelled");
    assert.ok(hasCode(cancelled, "cancelled_stage"));
    await writeJson("pipeline-jobs.json", jobs());

    const deterministicOne = await getHealth();
    const deterministicTwo = await getHealth();
    assert.deepEqual(deterministicOne, deterministicTwo);
    assert.equal(deterministicOne.generatedAt, deterministicOne.health.evaluatedAt);
    assert.equal(deterministicOne.snapshot.generatedAt, deterministicOne.generatedAt);

    const directHealth = ProductionHealthEngine.evaluate(
      deterministicOne.snapshot,
      evaluatedAt,
    );
    assert.deepEqual(deterministicOne.health.findings, directHealth.findings);

    await fs.rm(file("export.json"));
    const detectedAtReport = await getHealth();
    const snapshotFinding = detectedAtReport.snapshot.findings.find(
      (finding) => finding.code === "completed_stage_missing_output",
    );
    const healthFinding = detectedAtReport.health.findings.find(
      (finding) => finding.code === "completed_stage_missing_output",
    );
    assert.equal(snapshotFinding?.detectedAt, evaluatedAt);
    assert.equal(healthFinding?.detectedAt, snapshotFinding?.detectedAt);
    await writeJson("export.json", { stage: "export" });

    for (const invalidSlug of [
      "..",
      "../project",
      "project/child",
      "project\\child",
      "",
      "   ",
      "%2e%2e%2fproject",
      "project\0child",
    ]) {
      await assert.rejects(
        ProductionHealthService.getProductionHealth({
          projectSlug: invalidSlug,
          evaluatedAt,
        }),
        (error: unknown) =>
          error instanceof ProductionHealthError &&
          error.code === "INVALID_PROJECT_SLUG",
      );
    }

    const before = await captureFiles();
    await getHealth();
    const after = await captureFiles();
    assert.deepEqual(after, before);

    const successResponse = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ slug }),
    });
    const successBody = await successResponse.json();
    assert.equal(successResponse.status, 200);
    assert.equal(successResponse.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(successBody.success, true);
    assert.equal(successBody.data.projectSlug, slug);

    const domainResponse = await withMutedConsole(() =>
      GET(new Request("http://localhost"), {
        params: Promise.resolve({ slug: ".." }),
      }),
    );
    const domainBody = await domainResponse.json();
    assert.deepEqual(domainBody, {
      success: false,
      error: {
        code: "INVALID_PROJECT_SLUG",
        message: "Invalid project slug.",
      },
    });

    const internalResponse = await withMutedConsole(() =>
      Promise.resolve(
        createProductionHealthErrorResponse(
          new Error(`secret ${projectFolder}\nstack detail`),
        ),
      ),
    );
    const internalText = await internalResponse.text();
    assert.equal(internalResponse.status, 500);
    assert.ok(!internalText.includes(projectFolder));
    assert.ok(!internalText.includes("stack detail"));
    assert.ok(internalText.includes("UNKNOWN_PRODUCTION_HEALTH_ERROR"));

    assert.equal(typeof complete.health.overallSeverity, "string");
    assert.equal(typeof complete.health.status, "string");
    assert.equal(typeof complete.health.counts.total, "number");
    assert.equal(typeof complete.health.sourceConfidence.level, "string");

    console.log(
      "Sprint 95.5 production health service/API smoke: PASS (24 scenarios)",
    );
  } finally {
    await fs.rm(projectFolder, { recursive: true, force: true });
  }
}

async function getHealth() {
  return ProductionHealthService.getProductionHealth({
    projectSlug: slug,
    evaluatedAt,
  });
}

function hasCode(
  report: Awaited<ReturnType<typeof getHealth>>,
  code: string,
) {
  return report.health.findings.some((finding) => finding.code === code);
}

async function writeCompleteFixture() {
  await writeJson("project.json", project());
  await writeJson("manifest.json", manifest());
  await writeJson("pipeline-jobs.json", jobs());
  await writeJson("pipeline-history.json", history());
  await writeJson("ai-usage.json", usage());
  await Promise.all(
    pipelineRecoveryStageOrder.map((stage) =>
      writeJson(`${stage}.json`, { stage }),
    ),
  );
}

async function writeJson(fileName: string, value: unknown) {
  await fs.writeFile(file(fileName), JSON.stringify(value, null, 2), "utf-8");
}

function file(fileName: string) {
  return path.join(projectFolder, fileName);
}

async function captureFiles() {
  const names = (await fs.readdir(projectFolder)).sort(compareText);
  return Promise.all(
    names.map(async (name) => {
      const content = await fs.readFile(file(name), "utf-8");
      const stat = await fs.stat(file(name));
      return { name, content, size: stat.size, mtimeMs: stat.mtimeMs };
    }),
  );
}

async function withMutedConsole<T>(action: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => undefined;
  try {
    return await action();
  } finally {
    console.error = original;
  }
}

function compareText(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1;
}

void main();
