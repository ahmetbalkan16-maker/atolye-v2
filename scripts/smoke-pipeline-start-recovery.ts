/**
 * Covers the POST /api/pipeline recovery contract: when a run fails part-way,
 * the response must carry a usable `slug` + `projectUrl` (when the project
 * actually exists on disk) so the start screen can send the user to
 * `/project/[slug]` and its resume/retry actions instead of stranding them.
 * Success, `stopReason`, empty-topic, and PipelineStateError responses must be
 * unchanged.
 *
 * Route + provider stubs only — no real pipeline, no runtime operation context,
 * no FFmpeg, no production mutation.
 */
import assert from "node:assert/strict";
import { POST as runPipeline } from "../app/api/pipeline/route";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { PipelineStateError } from "../src/lib/pipeline/PipelineStateError";

const slug = `sprint-150-start-recovery-${process.pid}`;

let passed = 0;
function pass(label: string) {
  passed += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${passed}: ${label}`);
}

type Runner = { run: (topic: string) => Promise<unknown> };
type Manager = {
  createSlug: (t: string) => string;
  getProject: (s: string) => Promise<unknown>;
};

async function post(topic: unknown) {
  const res = await runPipeline(
    new Request("http://local", {
      method: "POST",
      body: JSON.stringify({ topic }),
      headers: { "content-type": "application/json" },
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function main() {
  const runner = PipelineRunner as unknown as Runner;
  const manager = ProjectManager as unknown as Manager;
  const originals = {
    run: runner.run,
    createSlug: manager.createSlug,
    getProject: manager.getProject,
  };
  const originalConsoleError = console.error;
  const errorLogs: unknown[][] = [];
  console.error = (...args: unknown[]) => { errorLogs.push(args); };

  manager.createSlug = () => slug;

  try {
    // 1. Generic mid-pipeline failure, project exists -> recoverable reference,
    //    no leak of the underlying error.
    manager.getProject = async () => ({ id: slug, slug, title: "t", status: "draft", createdAt: "x", updatedAt: "x" });
    runner.run = async () => { throw new Error("stage 6 boom: C:\\private\\key.json at frame"); };
    const failed = await post("İmparatorluklar");
    assert.equal(failed.status, 500);
    assert.deepEqual(Object.keys(failed.body).sort(), ["error", "projectUrl", "slug", "success"]);
    assert.equal(failed.body.success, false);
    assert.equal(failed.body.error, "Uretim akisi tamamlanamadi.");
    assert.equal(failed.body.slug, slug);
    assert.equal(failed.body.projectUrl, `/project/${slug}`);
    const failedSerialized = JSON.stringify(failed.body);
    for (const forbidden of ["boom", "key.json", "C:\\private", " at "]) {
      assert.equal(failedSerialized.includes(forbidden), false, `leaked: ${forbidden}`);
    }
    assert.equal(errorLogs.length, 1); // single "[Pipeline API] Pipeline failed:" log
    pass("generic failure + project exists -> slug/projectUrl, no leak");

    // 2. Same failure, project does NOT exist -> no fabricated reference.
    manager.getProject = async () => null;
    const noProject = await post("İmparatorluklar");
    assert.deepEqual(noProject, {
      status: 500,
      body: { success: false, error: "Uretim akisi tamamlanamadi." },
    });
    pass("generic failure + no project -> safe body preserved (no fabricated slug)");

    // 3. getProject itself throwing must not turn a 500 into a 500-with-fault.
    manager.getProject = async () => { throw new Error("readback exploded"); };
    const getProjectThrows = await post("İmparatorluklar");
    assert.deepEqual(getProjectThrows, {
      status: 500,
      body: { success: false, error: "Uretim akisi tamamlanamadi." },
    });
    pass("getProject throwing during enrichment -> safe body preserved");

    // 4. PipelineStateError path unchanged (shared contract-locked handler).
    manager.getProject = async () => ({ id: slug, slug, title: "t", status: "draft", createdAt: "x", updatedAt: "x" });
    runner.run = async () => { throw new PipelineStateError("jobs", "invalid", "pipeline-jobs.json"); };
    const stateErr = await post("İmparatorluklar");
    assert.equal(stateErr.status, 500);
    assert.deepEqual(Object.keys(stateErr.body).sort(), ["code", "error", "success"]);
    assert.equal(stateErr.body.code, "PIPELINE_JOBS_STATE_INVALID");
    pass("PipelineStateError response shape unchanged (no slug/projectUrl)");

    // 5. stopReason stop -> already carried slug/projectUrl, unchanged.
    runner.run = async () => ({ success: false, slug, stopReason: 'Stage "research" was cancelled.' });
    const stopped = await post("İmparatorluklar");
    assert.equal(stopped.status, 409);
    assert.equal(stopped.body.success, false);
    assert.equal(stopped.body.error, 'Stage "research" was cancelled.');
    assert.equal(stopped.body.slug, slug);
    assert.equal(stopped.body.projectUrl, `/project/${slug}`);
    pass("stopReason 409 unchanged");

    // 6. Success -> shape untouched.
    runner.run = async () => ({ success: true, slug, stopReason: undefined });
    const ok = await post("İmparatorluklar");
    assert.deepEqual(ok, {
      status: 200,
      body: { success: true, slug, projectUrl: `/project/${slug}` },
    });
    pass("success response unchanged");

    // 7. Empty / non-string topic -> 400, no project reference, run() not called.
    let runCalls = 0;
    runner.run = async () => { runCalls += 1; return { success: true, slug }; };
    for (const bad of ["   ", "", null, 42, undefined]) {
      const res = await post(bad);
      assert.deepEqual(res, { status: 400, body: { success: false, error: "Konu bos olamaz." } });
    }
    assert.equal(runCalls, 0);
    pass("empty/invalid topic -> 400, pipeline not started");
  } finally {
    runner.run = originals.run;
    manager.createSlug = originals.createSlug;
    manager.getProject = originals.getProject;
    console.error = originalConsoleError;
  }

  console.log(`Pipeline start recovery smoke: PASS (${passed} cases)`);
}

main().catch((error) => { console.error("SMOKE_FAILED", error); process.exitCode = 1; });
