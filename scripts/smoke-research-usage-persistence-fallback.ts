/**
 * Research usage-persistence fallback smoke (write-path safety sprint).
 *
 * Deterministic / $0 / no network / TEMP-only (workspace, runtime and authority
 * roots are all sandboxes; no live runtime is read or written).
 *
 * Before this sprint the lenient (non-strict) `AIManager.runResearch` path
 * turned `AI_USAGE_PERSISTENCE_FAILED` — a successful, possibly paid provider
 * call whose usage record could not be written — into mock research, exactly
 * like a provider failure. The strict path already threw it
 * (smoke-sprint-129-37). Now:
 *  - provider success + persistence failure → AI_USAGE_PERSISTENCE_FAILED on
 *    both paths (never mock);
 *  - true provider failure with accounting intact → lenient mock fallback,
 *    strict throw (both unchanged);
 *  - provider failure + persistence failure → lenient path surfaces the
 *    accounting failure instead of hiding it behind mock research;
 *  - a budget-blocked call (no request dispatched) keeps the mock fallback
 *    even when its usage record cannot be written;
 *  - the pre-project `"unknown"` identity and the cost guard are unchanged;
 *  - `/api/research` returns 500 and creates no project when the unknown usage
 *    ledger cannot be written (real dual-root quarantine, not a stub).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers";

let count = 0;
async function scenario(name: string, fn: () => Promise<void>) {
  await fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const envKeys = [
  "ATOLYE_WORKSPACE_ROOT",
  "ATOLYE_RUNTIME_ROOT",
  "ATOLYE_RUNTIME_AUTHORITY_ROOT",
  "ATOLYE_AI_COST_GUARD",
  "ATOLYE_AI_COST_BUDGET_USD",
  "AI_PROVIDER",
] as const;
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const sandboxes: string[] = [];

type Sandbox = { projectsRoot: string; quarantineRoot: string };

function sandbox(): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rupf-"));
  sandboxes.push(root);
  const workspace = path.join(root, "workspace");
  const runtimeRoot = path.join(root, "runtime");
  const authorityRoot = path.join(root, "authority");
  const projectsRoot = path.join(runtimeRoot, "projects");
  const quarantineRoot = path.join(workspace, "data", "projects");
  fs.mkdirSync(projectsRoot, { recursive: true });
  fs.mkdirSync(quarantineRoot, { recursive: true });
  fs.mkdirSync(authorityRoot, { recursive: true });
  process.env.ATOLYE_WORKSPACE_ROOT = workspace;
  process.env.ATOLYE_RUNTIME_ROOT = runtimeRoot;
  process.env.ATOLYE_RUNTIME_AUTHORITY_ROOT = authorityRoot;
  return { projectsRoot, quarantineRoot };
}

const researchJson = JSON.stringify({
  topic: "Hunlar",
  summary: "real provider summary",
  historicalContext: "real context",
  timeline: ["374"],
});

function result(content: string, overrides: Partial<AIProviderResult> = {}): AIProviderResult {
  return {
    content,
    finishReason: "stop",
    refused: false,
    complete: true,
    truncated: false,
    usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
    ...overrides,
  };
}

function stub(behaviour: () => Promise<AIProviderResult>) {
  const state = { calls: 0 };
  const provider: AIProvider = {
    async generate() {
      state.calls += 1;
      return behaviour();
    },
  };
  return { provider, state };
}

async function run() {
  // Deterministic provider selection for the route scenarios; set before import.
  process.env.AI_PROVIDER = "mock";
  delete process.env.ATOLYE_AI_COST_GUARD;
  delete process.env.ATOLYE_AI_COST_BUDGET_USD;

  const { AIManager } = await import("../src/lib/ai/AIManager");
  const { AIResponseError } = await import("../src/lib/ai/AIResponseError");
  const { AIUsageManager } = await import("../src/lib/ai/AIUsageManager");
  const { strictGenerationExecutionPolicy } = await import("../src/lib/ai/GenerationExecutionPolicy");
  const { ProjectManager } = await import("../src/lib/projects/ProjectManager");
  const { ProjectReader } = await import("../src/lib/projects/ProjectReader");
  const { clearProjectFolderIndexCache } = await import("../src/lib/projects/ProjectFolderIndex");
  const { POST } = await import("../app/api/research/route");

  const realAppend = AIUsageManager.appendRecord.bind(AIUsageManager);
  const failPersistence = () => {
    AIUsageManager.appendRecord = async () => {
      throw new Error("fixture usage persistence failure");
    };
  };
  const restorePersistence = () => {
    AIUsageManager.appendRecord = realAppend;
  };
  const isCode = (code: string) => (error: unknown) =>
    error instanceof AIResponseError && error.code === code;

  const fresh = () => {
    const sb = sandbox();
    clearProjectFolderIndexCache();
    return sb;
  };

  // 1 ---------------------------------------------------------------
  await scenario("lenient: provider success + persistence OK returns the provider research", async () => {
    fresh();
    const { provider, state } = stub(async () => result(researchJson));
    const research = await AIManager.runResearch("Hunlar", undefined, provider);
    assert.equal(state.calls, 1);
    assert.equal(research.summary, "real provider summary");
  });

  // 2 ---------------------------------------------------------------
  await scenario("lenient: provider success + persistence failure throws, never mock", async () => {
    fresh();
    const { provider, state } = stub(async () => result(researchJson));
    failPersistence();
    try {
      await assert.rejects(
        () => AIManager.runResearch("Hunlar", undefined, provider),
        isCode("AI_USAGE_PERSISTENCE_FAILED"),
      );
    } finally {
      restorePersistence();
    }
    assert.equal(state.calls, 1, "the provider call did happen (and may have been paid)");
  });

  // 3 ---------------------------------------------------------------
  await scenario("strict: provider success + persistence failure throws (contract unchanged)", async () => {
    fresh();
    const { provider } = stub(async () => result(researchJson));
    failPersistence();
    try {
      await assert.rejects(
        () => AIManager.runResearch(
          "Hunlar", { projectSlug: "strict-p" }, provider, strictGenerationExecutionPolicy),
        isCode("AI_USAGE_PERSISTENCE_FAILED"),
      );
    } finally {
      restorePersistence();
    }
  });

  // 4 ---------------------------------------------------------------
  await scenario("lenient: true provider failure with accounting intact still falls back to mock", async () => {
    const sb = fresh();
    const { provider, state } = stub(async () => {
      throw new Error("fixture provider outage");
    });
    const research = await AIManager.runResearch("Hunlar", undefined, provider);
    assert.equal(state.calls, 1);
    assert.equal(research.summary, "mock");
    const ledger = JSON.parse(
      fs.readFileSync(path.join(sb.projectsRoot, "unknown", "ai-usage.json"), "utf-8"),
    );
    assert.equal(ledger.records.length, 1);
    assert.equal(ledger.records[0].errorCode, "AI_PROVIDER_REQUEST_FAILED");
    assert.equal(ledger.records[0].status, "failed");
  });

  // 5 ---------------------------------------------------------------
  await scenario("lenient: content-level provider failure (refusal) still falls back to mock", async () => {
    fresh();
    const { provider } = stub(async () => result("", { refused: true, finishReason: "content-filter" }));
    const research = await AIManager.runResearch("Hunlar", undefined, provider);
    assert.equal(research.summary, "mock");
  });

  // 6 ---------------------------------------------------------------
  await scenario("lenient: provider failure + persistence failure surfaces the accounting failure", async () => {
    fresh();
    const { provider } = stub(async () => {
      throw new Error("fixture provider outage");
    });
    failPersistence();
    try {
      await assert.rejects(
        () => AIManager.runResearch("Hunlar", undefined, provider),
        isCode("AI_USAGE_PERSISTENCE_FAILED"),
      );
    } finally {
      restorePersistence();
    }
  });

  // 7 ---------------------------------------------------------------
  await scenario("strict: true provider failure keeps its provider error code", async () => {
    fresh();
    const { provider } = stub(async () => {
      throw new Error("fixture provider outage");
    });
    await assert.rejects(
      () => AIManager.runResearch(
        "Hunlar", { projectSlug: "strict-p" }, provider, strictGenerationExecutionPolicy),
      isCode("AI_PROVIDER_REQUEST_FAILED"),
    );
  });

  // 8 ---------------------------------------------------------------
  await scenario("pre-project research keeps the 'unknown' identity and is not cost-guarded", async () => {
    const sb = fresh();
    process.env.ATOLYE_AI_COST_GUARD = "on";
    process.env.ATOLYE_AI_COST_BUDGET_USD = "0.000001";
    try {
      const { provider, state } = stub(async () => result(researchJson));
      const research = await AIManager.runResearch("Hunlar", { provider: "openai" }, provider);
      assert.equal(state.calls, 1, "the pre-project sentinel bypasses the per-project budget, as before");
      assert.equal(research.summary, "real provider summary");
    } finally {
      delete process.env.ATOLYE_AI_COST_GUARD;
      delete process.env.ATOLYE_AI_COST_BUDGET_USD;
    }
    const log = await AIUsageManager.getUsageLog("unknown");
    assert.equal(log.projectSlug, "unknown");
    assert.equal(log.records.length, 1);
    assert.equal(log.records[0].projectSlug, "unknown");
    assert.deepEqual(fs.readdirSync(path.join(sb.projectsRoot, "unknown")), ["ai-usage.json"],
      "no manifest is created for the unknown identity");
  });

  // 9 ---------------------------------------------------------------
  await scenario("cost guard still blocks a project-scoped paid call before dispatch", async () => {
    fresh();
    const project = await ProjectManager.createProject("Guarded Topic");
    process.env.ATOLYE_AI_COST_GUARD = "on";
    process.env.ATOLYE_AI_COST_BUDGET_USD = "0.000001";
    try {
      const { provider, state } = stub(async () => result(researchJson));
      await assert.rejects(
        () => AIManager.runResearch(
          "Guarded Topic",
          { projectSlug: project.slug, provider: "openai" },
          provider,
          strictGenerationExecutionPolicy,
        ),
        isCode("AI_COST_BUDGET_EXCEEDED"),
      );
      assert.equal(state.calls, 0, "provider must not be dispatched over budget");
    } finally {
      delete process.env.ATOLYE_AI_COST_GUARD;
      delete process.env.ATOLYE_AI_COST_BUDGET_USD;
    }
    const log = await AIUsageManager.getUsageLog(project.slug);
    assert.equal(log.records.at(-1)?.errorCode, "AI_COST_BUDGET_EXCEEDED");
  });

  // 9b --------------------------------------------------------------
  await scenario("lenient: budget-blocked call + persistence failure keeps mock (nothing dispatched)", async () => {
    fresh();
    const project = await ProjectManager.createProject("Blocked Topic");
    process.env.ATOLYE_AI_COST_GUARD = "on";
    process.env.ATOLYE_AI_COST_BUDGET_USD = "0.000001";
    failPersistence();
    try {
      const { provider, state } = stub(async () => result(researchJson));
      const research = await AIManager.runResearch(
        "Blocked Topic", { projectSlug: project.slug, provider: "openai" }, provider);
      assert.equal(state.calls, 0, "provider must not be dispatched over budget");
      assert.equal(research.summary, "mock");
    } finally {
      restorePersistence();
      delete process.env.ATOLYE_AI_COST_GUARD;
      delete process.env.ATOLYE_AI_COST_BUDGET_USD;
    }
  });

  // 10 --------------------------------------------------------------
  await scenario("real unknown-ledger persistence failure (dual-root quarantine) is not masked", async () => {
    const sb = fresh();
    fs.mkdirSync(path.join(sb.quarantineRoot, "unknown"));
    const { provider, state } = stub(async () => result(researchJson));
    await assert.rejects(
      () => AIManager.runResearch("Hunlar", undefined, provider),
      isCode("AI_USAGE_PERSISTENCE_FAILED"),
    );
    assert.equal(state.calls, 1);
    assert.deepEqual(fs.readdirSync(sb.projectsRoot), [], "nothing written to the runtime root");
  });

  // 11 --------------------------------------------------------------
  await scenario("/api/research: unwritable unknown ledger → 500, no project created", async () => {
    const sb = fresh();
    fs.mkdirSync(path.join(sb.quarantineRoot, "unknown"));
    const response = await POST(new Request("http://local/api/research", {
      method: "POST",
      body: JSON.stringify({ topic: "Route Persistence Topic" }),
    }));
    assert.equal(response.status, 500);
    const body = await response.json() as { success: boolean };
    assert.equal(body.success, false);
    assert.deepEqual(fs.readdirSync(sb.projectsRoot), [], "no project, no ledger");
  });

  // 12 --------------------------------------------------------------
  await scenario("/api/research: healthy accounting creates the project and saves research", async () => {
    const sb = fresh();
    const response = await POST(new Request("http://local/api/research", {
      method: "POST",
      body: JSON.stringify({ topic: "Route Healthy Topic" }),
    }));
    assert.equal(response.status, 200);
    const body = await response.json() as { success: boolean; project: { slug: string; id: string } };
    assert.equal(body.success, true);
    assert.equal(body.project.slug, "route-healthy-topic");
    assert.deepEqual(fs.readdirSync(sb.projectsRoot).sort(), ["route-healthy-topic", "unknown"]);
    assert.ok(await ProjectManager.getResearch("route-healthy-topic"));
    const listed = (await ProjectReader.listProjects()) as { id: string }[];
    assert.deepEqual(listed.map((project) => project.id), [body.project.id]);
  });

  console.log(`PASS (${count} scenarios)`);
}

run()
  .catch((error) => {
    console.error("FAIL", error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    for (const root of sandboxes) fs.rmSync(root, { recursive: true, force: true });
  });
