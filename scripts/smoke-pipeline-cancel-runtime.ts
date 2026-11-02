import assert from "node:assert/strict";
import { POST } from "../app/api/projects/[slug]/pipeline/jobs/[jobId]/route";
import { PipelineRunner } from "../src/lib/pipeline/PipelineRunner";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";

async function main() {
  const topic = "pipeline cancel runtime";
  const slug = ProjectManager.createSlug(topic);
  await withCanonicalSmokeRuntime({ name: "pipeline-cancel-runtime", projectSlug: slug, operationType: "pipeline.run" }, async () => {
    await PipelineRunner.run(topic, { stopAfterStage: "research" });
    const research = await ProjectManager.getResearch(slug);
    const response = await POST(new Request("http://localhost/api", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel" }),
    }), { params: Promise.resolve({ slug, jobId: `${slug}-script` }) });
    assert.equal(response.status, 200, "assert.equal(response.status, 200)");
    assert.equal((await response.json()).success, true, "assert.equal((await response.json()).success, true)");
    const jobs = await PipelineJobManager.listJobsReadOnly(slug);
    assert.equal(jobs.jobs.find(j => j.stage === "script")?.status, "cancelled", "assert.equal(jobs.jobs.find(j => j.stage === \"script\")?.status, \"cancelled\")");
    assert.equal(jobs.jobs.find(j => j.stage === "research")?.status, "completed", "assert.equal(jobs.jobs.find(j => j.stage === \"research\")?.status, \"completed\")");
    assert.equal(jobs.jobs.find(j => j.stage === "audio")?.status, "queued", "assert.equal(jobs.jobs.find(j => j.stage === \"audio\")?.status, \"queued\")");
    assert.deepEqual(await ProjectManager.getResearch(slug), research, "assert.deepEqual(await ProjectManager.getResearch(slug), research)");
  });
  console.log(JSON.stringify({ status: "PASS", scenarios: 1, paidCalls: 0 }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
