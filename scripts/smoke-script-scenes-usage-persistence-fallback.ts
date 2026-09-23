/**
 * Script / scenes usage-persistence fallback smoke (system write-path safety sprint).
 *
 * Deterministic / $0 / no network / TEMP-only (workspace, runtime and authority
 * roots are all sandboxes; no live runtime is read or written).
 *
 * The research fix (previous sprint) established: a usage/accounting
 * persistence failure is not a provider failure. Before this sprint
 *  - lenient `runScript` still turned a successful, possibly paid provider
 *    result whose usage record could not be written into mock output, and hid
 *    an accounting failure behind mock when the provider had also failed;
 *  - `runScenes` ignored `observed.errorCode` altogether: an unpersisted usage
 *    record and a provider-flagged truncated response were accepted on both
 *    paths, and on the strict path a cost-guard block, a provider failure and
 *    a refusal all surfaced as the generic GENERATION_FALLBACK_BLOCKED.
 * Now both stages follow the research rule on every cell below; strict script
 * is unchanged and a budget-blocked call (nothing dispatched) keeps the
 * lenient mock fallback.
 *
 * Every scenario runs even if an earlier one fails; PASS only when none failed.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers";
import type { SceneData } from "../src/types/scene";
import type { ScriptData } from "../src/types/script";

const failures: string[] = [];
let count = 0;
async function scenario(name: string, fn: () => Promise<void>) {
  count += 1;
  try {
    await fn();
    if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
  } catch (error) {
    failures.push(`FAIL ${count}: ${name} — ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ssupf-"));
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

/** Strict-valid 6-chapter script (the scenes input) — same shape as smoke-sprint-129-17. */
function sixChapterScript(): ScriptData {
  return {
    topic: "Fetih", title: "Fetih", subtitle: "S", hook: "H", introduction: "I",
    chapters: Array.from({ length: 6 }, (_, index) => ({
      id: index + 1, title: `Bölüm ${index + 1}`, narration: "Tarihsel anlatım.",
      duration: 15, visualGoal: "g", emotion: "e", transition: "t",
    })),
    conclusion: "C", callToAction: "CTA", estimatedDuration: 90, narrationWordCount: 12,
    targetAudience: "genel", language: "tr", voiceStyle: "v", musicStyle: "m",
    thumbnailIdea: "t", seoKeywords: ["k"], createdAt: "2026-07-15T14:31:53.950Z",
  };
}

const scenesJson = JSON.stringify({
  scenes: Array.from({ length: 6 }, (_, index) => ({
    id: index + 1, chapterId: index + 1, title: `Sahne ${index + 1}`,
    description: "Tarihsel olay sinematik olarak anlatılır.",
    visualPrompt: "Cinematic historically grounded documentary scene", duration: 15,
  })),
});

/** Strict-valid script response — same shape as smoke-script-duration-reconciliation-wiring. */
const scriptJson = JSON.stringify({
  topic: "T", title: "T", subtitle: "provider-subtitle", hook: "H", introduction: "I",
  chapters: [
    { id: 1, title: "C1", narration: "Kısa.", duration: 40, visualGoal: "g", emotion: "e", transition: "t" },
    { id: 2, title: "C2", narration: "x ".repeat(585).trim(), duration: 10, visualGoal: "g", emotion: "e", transition: "t" },
    { id: 3, title: "C3", narration: "Orta uzunlukta bir anlatım metni burada yer alıyor.", duration: 20, visualGoal: "g", emotion: "e", transition: "t" },
    { id: 4, title: "C4", narration: "Başka bir orta uzunlukta anlatım metni burada.", duration: 20, visualGoal: "g", emotion: "e", transition: "t" },
  ],
  conclusion: "C", callToAction: "CTA", estimatedDuration: 88, narrationWordCount: 9,
  targetAudience: "genel", language: "tr", voiceStyle: "documentary", musicStyle: "cinematic",
  thumbnailIdea: "idea", seoKeywords: ["k"],
});

function result(content: string, overrides: Partial<AIProviderResult> = {}): AIProviderResult {
  return {
    content, finishReason: "stop", refused: false, complete: true, truncated: false,
    usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
    ...overrides,
  };
}

type Op = "script" | "scenes";
type Outcome =
  | { kind: "provider" }
  | { kind: "mock" }
  | { kind: "throw"; code: string };

async function run() {
  process.env.AI_PROVIDER = "mock";
  delete process.env.ATOLYE_AI_COST_GUARD;
  delete process.env.ATOLYE_AI_COST_BUDGET_USD;

  const { AIManager } = await import("../src/lib/ai/AIManager");
  const { AIUsageManager } = await import("../src/lib/ai/AIUsageManager");
  const { strictGenerationExecutionPolicy } = await import("../src/lib/ai/GenerationExecutionPolicy");
  const { MockAIProvider } = await import("../src/lib/ai/providers/MockAIProvider");
  const { clearProjectFolderIndexCache } = await import("../src/lib/projects/ProjectFolderIndex");
  const { ProjectManager } = await import("../src/lib/projects/ProjectManager");

  const realAppend = AIUsageManager.appendRecord.bind(AIUsageManager);
  const persistence = { attempts: 0, fail: false };
  AIUsageManager.appendRecord = async (record) => {
    persistence.attempts += 1;
    if (persistence.fail) throw new Error("fixture usage persistence failure");
    return realAppend(record);
  };

  function stub(behaviour: (op: Op) => AIProviderResult | Promise<AIProviderResult>, op: Op) {
    const state = { calls: 0 };
    const provider: AIProvider = {
      async generate() {
        state.calls += 1;
        return behaviour(op);
      },
    };
    return { provider, state };
  }

  const providerContent = (op: Op) => (op === "script" ? scriptJson : scenesJson);

  async function invoke(op: Op, slug: string, provider: AIProvider, strict: boolean, extra: object = {}): Promise<Outcome> {
    const context = { projectSlug: slug, stage: op, operation: op, ...extra };
    const policy = strict ? strictGenerationExecutionPolicy : undefined;
    try {
      if (op === "script") {
        const script = await AIManager.runScript("T", context, provider, policy);
        return isMockScript(script) ? { kind: "mock" } : { kind: "provider" };
      }
      const scenes = await AIManager.runScenes(sixChapterScript(), context, provider, policy);
      return isMockScenes(scenes) ? { kind: "mock" } : { kind: "provider" };
    } catch (error) {
      return { kind: "throw", code: String((error as { code?: unknown }).code ?? (error as Error).name) };
    }
  }

  function isMockScript(script: ScriptData) {
    if (script.subtitle === "provider-subtitle") return false;
    assert.equal(script.subtitle, "mock");
    assert.equal(script.chapters.length, 0);
    return true;
  }

  function isMockScenes(scenes: SceneData) {
    if (scenes.scenes.length === 6 && scenes.scenes[0].title === "Sahne 1") return false;
    assert.equal(scenes.scenes.length, 1);
    assert.equal(scenes.scenes[0].title, "mock scene");
    return true;
  }

  async function freshProject(op: Op, strict: boolean) {
    sandbox();
    clearProjectFolderIndexCache();
    persistence.attempts = 0;
    persistence.fail = false;
    const project = await ProjectManager.createProject(`Acct ${op} ${strict ? "strict" : "lenient"} ${count}`);
    return project.slug;
  }

  async function ledger(slug: string) {
    persistence.fail = false;
    return (await AIUsageManager.getUsageLog(slug)).records;
  }

  const expectThrow = (outcome: Outcome, code: string) =>
    assert.deepEqual(outcome, { kind: "throw", code });

  for (const op of ["script", "scenes"] as const) {
    for (const strict of [false, true]) {
      const mode = strict ? "strict" : "lenient";

      await scenario(`${op} ${mode}: provider success + accounting success → provider result, recorded`, async () => {
        const slug = await freshProject(op, strict);
        const { provider, state } = stub((o) => result(providerContent(o)), op);
        const outcome = await invoke(op, slug, provider, strict);
        assert.deepEqual(outcome, { kind: "provider" }, "not replaced");
        assert.equal(state.calls, 1);
        assert.equal(persistence.attempts, 1);
        const records = await ledger(slug);
        assert.equal(records.length, 1);
        assert.equal(records[0].status, "success");
        assert.equal(records[0].errorCode, undefined);
      });

      await scenario(`${op} ${mode}: provider success + accounting failure → AI_USAGE_PERSISTENCE_FAILED, never mock or silent`, async () => {
        const slug = await freshProject(op, strict);
        const { provider, state } = stub((o) => result(providerContent(o)), op);
        persistence.fail = true;
        const outcome = await invoke(op, slug, provider, strict);
        expectThrow(outcome, "AI_USAGE_PERSISTENCE_FAILED");
        assert.equal(state.calls, 1, "the provider call happened (and may have been paid)");
        assert.equal(persistence.attempts, 1, "usage persistence was attempted");
        assert.equal((await ledger(slug)).length, 0, "nothing recorded");
      });

      await scenario(`${op} ${mode}: provider failure + accounting success → ${strict ? "AI_PROVIDER_REQUEST_FAILED" : "mock fallback"}, recorded`, async () => {
        const slug = await freshProject(op, strict);
        const { provider, state } = stub(() => { throw new Error("fixture provider outage"); }, op);
        const outcome = await invoke(op, slug, provider, strict);
        if (strict) expectThrow(outcome, "AI_PROVIDER_REQUEST_FAILED");
        else assert.deepEqual(outcome, { kind: "mock" });
        assert.equal(state.calls, 1);
        const records = await ledger(slug);
        assert.equal(records.length, 1);
        assert.equal(records[0].status, "failed");
        assert.equal(records[0].errorCode, "AI_PROVIDER_REQUEST_FAILED");
      });

      await scenario(`${op} ${mode}: provider failure + accounting failure → ${strict ? "AI_PROVIDER_REQUEST_FAILED" : "AI_USAGE_PERSISTENCE_FAILED"}`, async () => {
        const slug = await freshProject(op, strict);
        const { provider, state } = stub(() => { throw new Error("fixture provider outage"); }, op);
        persistence.fail = true;
        const outcome = await invoke(op, slug, provider, strict);
        expectThrow(outcome, strict ? "AI_PROVIDER_REQUEST_FAILED" : "AI_USAGE_PERSISTENCE_FAILED");
        assert.equal(state.calls, 1);
        assert.equal(persistence.attempts, 1);
      });

      await scenario(`${op} ${mode}: cost guard blocks before dispatch → ${strict ? "AI_COST_BUDGET_EXCEEDED" : "mock fallback"}, not a provider failure`, async () => {
        const slug = await freshProject(op, strict);
        const { provider, state } = stub((o) => result(providerContent(o)), op);
        process.env.ATOLYE_AI_COST_GUARD = "on";
        process.env.ATOLYE_AI_COST_BUDGET_USD = "0.000001";
        let outcome: Outcome;
        try {
          outcome = await invoke(op, slug, provider, strict, { provider: "openai" });
        } finally {
          delete process.env.ATOLYE_AI_COST_GUARD;
          delete process.env.ATOLYE_AI_COST_BUDGET_USD;
        }
        if (strict) expectThrow(outcome, "AI_COST_BUDGET_EXCEEDED");
        else assert.deepEqual(outcome, { kind: "mock" });
        assert.equal(state.calls, 0, "provider must not be dispatched over budget");
        const records = await ledger(slug);
        assert.equal(records.at(-1)?.errorCode, "AI_COST_BUDGET_EXCEEDED");
        assert.equal(records.at(-1)?.estimatedCost, 0);
      });

      await scenario(`${op} ${mode}: cost guard block + accounting failure → ${strict ? "AI_COST_BUDGET_EXCEEDED" : "mock fallback"} (nothing dispatched)`, async () => {
        const slug = await freshProject(op, strict);
        const { provider, state } = stub((o) => result(providerContent(o)), op);
        process.env.ATOLYE_AI_COST_GUARD = "on";
        process.env.ATOLYE_AI_COST_BUDGET_USD = "0.000001";
        persistence.fail = true;
        let outcome: Outcome;
        try {
          outcome = await invoke(op, slug, provider, strict, { provider: "openai" });
        } finally {
          delete process.env.ATOLYE_AI_COST_GUARD;
          delete process.env.ATOLYE_AI_COST_BUDGET_USD;
        }
        if (strict) expectThrow(outcome, "AI_COST_BUDGET_EXCEEDED");
        else assert.deepEqual(outcome, { kind: "mock" });
        assert.equal(state.calls, 0);
        assert.equal(persistence.attempts, 1);
      });

      await scenario(`${op} ${mode}: provider-flagged truncation is not a usable response`, async () => {
        const slug = await freshProject(op, strict);
        const { provider } = stub(
          (o) => result(providerContent(o), { finishReason: "length", truncated: true, complete: false }), op);
        const outcome = await invoke(op, slug, provider, strict);
        if (strict) expectThrow(outcome, "AI_RESPONSE_TRUNCATED");
        else assert.deepEqual(outcome, { kind: "mock" });
      });

      await scenario(`${op} ${mode}: provider refusal keeps its own code`, async () => {
        const slug = await freshProject(op, strict);
        const { provider } = stub(() => result("", { refused: true, finishReason: "content-filter", complete: false }), op);
        const outcome = await invoke(op, slug, provider, strict);
        if (strict) expectThrow(outcome, "AI_PROVIDER_REFUSAL");
        else assert.deepEqual(outcome, { kind: "mock" });
      });

      await scenario(`${op} ${mode}: explicit mock provider → ${strict ? "GENERATION_FALLBACK_BLOCKED" : "mock data"} (unchanged)`, async () => {
        const slug = await freshProject(op, strict);
        const outcome = await invoke(op, slug, new MockAIProvider(), strict);
        if (strict) expectThrow(outcome, "GENERATION_FALLBACK_BLOCKED");
        else assert.deepEqual(outcome, { kind: "mock" });
        const records = await ledger(slug);
        assert.equal(records.length, 1);
        assert.equal(records[0].provider, "mock");
        assert.equal(records[0].errorCode, undefined);
      });
    }

    await scenario(`${op}: real accounting failure (legacy alias + dual-root quarantine) is not masked`, async () => {
      const sb = sandbox();
      clearProjectFolderIndexCache();
      persistence.attempts = 0;
      persistence.fail = false;
      const uuid = "8e2a1371-0000-4000-8000-00000000abcd";
      const slug = "legacy-hunlar";
      fs.mkdirSync(path.join(sb.projectsRoot, uuid));
      fs.writeFileSync(path.join(sb.projectsRoot, uuid, "project.json"), JSON.stringify({ id: slug, slug }));
      fs.mkdirSync(path.join(sb.quarantineRoot, slug));
      clearProjectFolderIndexCache();
      const { provider, state } = stub((o) => result(providerContent(o)), op);
      const outcome = await invoke(op, slug, provider, false);
      expectThrow(outcome, "AI_USAGE_PERSISTENCE_FAILED");
      assert.equal(state.calls, 1);
      assert.deepEqual(fs.readdirSync(sb.projectsRoot), [uuid], "no partial <slug>/ tree");
      assert.deepEqual(fs.readdirSync(path.join(sb.projectsRoot, uuid)), ["project.json"], "nothing written");
    });
  }

  AIUsageManager.appendRecord = realAppend;

  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    console.error(`FAIL (${failures.length} of ${count} scenarios)`);
    process.exitCode = 1;
    return;
  }
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
