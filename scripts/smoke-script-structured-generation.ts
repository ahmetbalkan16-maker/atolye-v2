import assert from "node:assert/strict";
import Ajv from "ajv";
import { AIManager } from "../src/lib/ai/AIManager";
import { MockAIProvider } from "../src/lib/ai/providers/MockAIProvider";
import type { AIProviderGenerateOptions } from "../src/lib/ai/providers";
import { strictGenerationExecutionPolicy } from "../src/lib/ai/GenerationExecutionPolicy";
import { buildScriptResponseJsonSchema, resolveScriptContentBudget, validateProviderScript } from "../src/lib/ai/ScriptStructuredOutput";
import { withCanonicalSmokeRuntime } from "./lib/CanonicalSmokeRuntime";
import { buildResearchResponseJsonSchema, validateProviderResearch } from "../src/lib/ai/ResearchStructuredOutput";

function fixture() {
  return {
    topic: "Kuşatma", title: "Kuşatma", subtitle: "Hazırlık ve sonuç", hook: "Surların önünde bir ordu bekliyordu.",
    introduction: "Kuşatmanın hazırlıklarını ve sonuçlarını inceliyoruz.",
    chapters: Array.from({ length: 5 }, (_, index) => ({
      id: index + 1, title: `Bölüm ${index + 1}`,
      narration: "Hazırlıklar tamamlandı. Birlikler surların önüne geldi. ".repeat(5),
      duration: 18, visualGoal: "Surlar önünde birlikler", emotion: "merak", transition: "Sonraki bölüm",
    })),
    conclusion: "Şehrin geleceği değişti.", callToAction: "Sonraki bölümde görüşmek üzere.",
    estimatedDuration: 90, narrationWordCount: 250, targetAudience: "Tarih meraklıları", language: "tr",
    voiceStyle: "Sakin", musicStyle: "Yumuşak", thumbnailIdea: "Surlar", seoKeywords: ["kuşatma", "tarih"],
  };
}

class CapturingProvider extends MockAIProvider {
  options?: AIProviderGenerateOptions;
  research = false;
  async generate(prompt: string, options?: AIProviderGenerateOptions): Promise<string> {
    void prompt; this.options = options;
    return JSON.stringify(this.research ? researchFixture() : fixture());
  }
}

function researchFixture() {
  return { topic: "Kuşatma", summary: "Bir kuşatmanın hazırlıkları ve sonucu.", historicalContext: "Dönemin bağlamı.",
    timeline: ["Hazırlık", "Sonuç"], characters: [], locations: [], keyEvents: ["Hazırlık"], strategies: [],
    controversies: [], interestingFacts: [], documentaryFlow: ["Başlangıç"], sceneIdeas: ["Surlar"], imagePrompts: ["Surlar"],
    animationPrompts: [], musicIdeas: [], soundEffects: [], thumbnailIdeas: [], youtubeTitles: [], sources: ["https://example.com/history"] };
}

async function main() {
  const validate = new Ajv().compile(buildScriptResponseJsonSchema({} as NodeJS.ProcessEnv));
  assert.equal(validate(fixture()), true);
  const tooMany = { ...fixture(), seoKeywords: Array.from({ length: 21 }, (_, i) => `key${i}`) };
  assert.equal(validate(tooMany), false);
  assert.equal(validateProviderScript(tooMany, {} as NodeJS.ProcessEnv)?.issues[0].reason, "MAX_ITEMS");
  assert.equal(validate({ ...fixture(), createdAt: "2026-10-12" }), false);
  assert.equal(validate({ ...fixture(), estimatedDuration: "90" }), false);
  assert.equal(validate({ ...fixture(), seoKeywords: ["x".repeat(101)] }), false);
  assert.equal(validate({ ...fixture(), chapters: [] }), false);
  const missing = fixture() as Partial<ReturnType<typeof fixture>>; delete missing.conclusion;
  assert.equal(validate(missing), false);
  const duplicate = fixture(); duplicate.chapters[1].id = duplicate.chapters[0].id;
  assert(validateProviderScript(duplicate, {} as NodeJS.ProcessEnv), "Semantic duplicate-ID validation stays active.");
  const research = new Ajv().compile(buildResearchResponseJsonSchema());
  assert.equal(research(researchFixture()), true);
  const books = { ...researchFixture(), sources: ["A history book"] };
  assert.equal(research(books), false);
  assert.equal(validateProviderResearch(books)?.issues[0].reason, "INVALID_URL");
  assert.equal(research({ ...researchFixture(), sources: ["https://user:pass@example.com"] }), false);
  assert.equal(research({ ...researchFixture(), createdAt: "2026-10-12" }), false);
  for (const preset of ["economy", "balanced", "documentary", "cinematic"]) {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", ATOLYE_QUALITY_PRESET: preset };
    const schema = buildScriptResponseJsonSchema(env), budget = resolveScriptContentBudget(env);
    assert.equal(schema.properties.chapters.maxItems, budget.chapterCount);
    assert(schema.properties.chapters.items.properties.narration.maxLength * budget.chapterCount <= budget.totalHighChars);
    assert(schema.properties.chapters.items.properties.narration.minLength * budget.chapterCount >= budget.totalLowChars);
    new Ajv().compile(schema);
  }
  await withCanonicalSmokeRuntime({ name: "script-structured-generation", environment: { ATOLYE_QUALITY_PRESET: undefined } }, async () => {
    const provider = new CapturingProvider();
    const script = await AIManager.runScript("Kuşatma", { projectSlug: "script-schema", stage: "script", operation: "script" }, provider, strictGenerationExecutionPolicy);
    assert.equal(script.chapters.length, 5);
    assert.deepEqual(provider.options?.jsonSchema, buildScriptResponseJsonSchema());
    await AIManager.runScript("Kuşatma", { projectSlug: "script-legacy", stage: "script", operation: "script" }, provider);
    assert.equal(provider.options?.jsonSchema, undefined, "Legacy unstrict calls preserve their transport.");
    provider.research = true;
    await AIManager.runResearch("Kuşatma", { projectSlug: "research-schema", stage: "research", operation: "research" }, provider, strictGenerationExecutionPolicy);
    assert.deepEqual(provider.options?.jsonSchema, buildResearchResponseJsonSchema());
    await AIManager.runResearch("Kuşatma", { projectSlug: "research-legacy", stage: "research", operation: "research" }, provider);
    assert.equal(provider.options?.jsonSchema, undefined);
  });
  console.log(JSON.stringify({ status: "PASS", suite: "script-structured-generation", scenarios: 22 }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
