import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { POST } from "../app/api/research/route";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { AIManager } from "../src/lib/ai/AIManager";
import { AIResponseError } from "../src/lib/ai/AIResponseError";
import { AIUsageManager } from "../src/lib/ai/AIUsageManager";
import { MockAIProvider } from "../src/lib/ai/providers/MockAIProvider";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { getActiveProductionRuntimeOperationContext } from "../src/lib/runtime/ProductionRuntimeOperationContext";
import ProjectActions from "../src/components/studio/ProjectActions";
import Dashboard from "../src/components/Dashboard";

const request = (topic: unknown) => new Request("http://localhost/api/research", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic }),
});

async function main() {
  let scenarios = 0;
  await withCanonicalSmokeRuntime({ name: "research-api-entry", enterOperationContext: false }, async runtime => {
    const original = AIManager.runResearch;
    let calls = 0;
    AIManager.runResearch = async (topic, context, _provider, policy) => {
      calls++;
      assert(getActiveProductionRuntimeOperationContext(), "API must enter the registered trusted runtime");
      assert(context?.projectSlug && context.projectSlug !== "unknown", "usage must belong to the requested project");
      return original.call(AIManager, topic, context, new MockAIProvider(), policy);
    };
    runtime.deferRestore(() => { AIManager.runResearch = original; });
    for (const value of ["", "   ", 42, null]) {
      const response = await POST(request(value));
      assert.equal(response.status, 400); assert.equal(calls, 0); scenarios++;
    }
    const response = await POST(request("1480 yılında Osmanlı yeniçerilerinin günlük hayatı."));
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.success, true); assert.equal(calls, 1);
    assert.equal(body.projectUrl, `/project/${body.project.slug}`);
    const research = await ProjectManager.getResearch(body.project.slug, runtime.runtimeStorageContext);
    assert.deepEqual(research, body.research);
    const manifest = await ProjectManager.getManifest(body.project.slug, runtime.runtimeStorageContext);
    assert.equal(manifest?.packages.research.status, "completed");
    for (const stage of ["script", "scenes", "visuals", "video", "audio", "assembly", "youtube"] as const) {
      assert.equal(manifest?.packages[stage].status, "pending", "research entry cannot run subsequent stages");
    }
    const usage = await AIUsageManager.getUsageLog(body.project.slug);
    assert.equal(usage.records.length, 1);
    assert(usage.records.every(r => r.projectSlug === body.project.slug && r.stage === "research"));
    assert(!fs.existsSync(path.join(runtime.runtimeStorageContext.projectsRoot, "unknown")), "never write the shared unknown namespace");
    scenarios++;
    AIManager.runResearch = async () => { throw new AIResponseError("AI_RESPONSE_SCHEMA_INVALID"); };
    const failedTopic = "Research entry retained failure 20261013";
    const failed = await POST(request(failedTopic));
    const failure = await failed.json();
    assert.equal(failed.status, 500); assert.equal(failure.success, false);
    assert.equal(failure.projectUrl, `/project/${ProjectManager.createSlug(failedTopic)}`);
    assert.notEqual(failure.error, "Pipeline error");
    const failedManifest = await ProjectManager.getManifest(failure.slug, runtime.runtimeStorageContext);
    assert.equal(failedManifest?.packages.research.status, "failed");
    assert.equal(failedManifest?.packages.script.status, "pending");
    scenarios++;
  });
  const actions = renderToStaticMarkup(createElement(ProjectActions, { slug: "example" }));
  assert(actions.includes('href="/studio#ayas-studio-topic"')); scenarios++;
  const dashboard = renderToStaticMarkup(createElement(Dashboard));
  assert(dashboard.includes('href="/studio#ayas-studio-topic"')); scenarios++;
  console.log(JSON.stringify({ status: "PASS", suite: "research-api-entry", scenarios, paidCalls: 0 }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
