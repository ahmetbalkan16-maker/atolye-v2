/**
 * Documentary pipeline revision — P2: the finished-video duration band + scene
 * ceiling become quality-preset-parametric, WITHOUT changing the default.
 *
 * A. Backward compat — with no explicit ATOLYE_QUALITY_PRESET every resolver is
 *    byte-identical to the frozen legacy 60/90/120 s / 30-scene policy
 *    (referential identity for the acceptance-duration object).
 * B. An explicit preset widens the band, the scene ceiling and the strict
 *    script chapter count, with the tolerance scaled to keep the ~5.6% ratio.
 * C. validateProductionAcceptanceScriptDuration / validateProviderScenes honor
 *    the resolved band: a 13-minute script is rejected by default and accepted
 *    under ATOLYE_QUALITY_PRESET=documentary.
 * D. createScenesPrompt keeps the historical guidance strings by default and
 *    scales them under an explicit preset.
 */
import assert from "node:assert/strict";
import { emitSmokeResult } from "./lib/SmokeResult";
import {
  LEGACY_TARGET_DURATION_BAND,
  resolveMaxSceneCount,
  resolveScriptChapterCount,
  resolveTargetDurationBand,
} from "../src/lib/production/QualityPreset";
import {
  productionAcceptanceDuration,
  resolveProductionAcceptanceDuration,
  validateProductionAcceptanceScriptDuration,
} from "../src/lib/production/ProductionAcceptancePreflight";
import {
  canonicalSceneProviderSchema,
  createScenesPrompt,
  resolveCanonicalSceneProviderSchema,
  validateProviderScenes,
} from "../src/lib/ai/SceneStructuredOutput";
import {
  canonicalScriptProviderSchema,
  resolveCanonicalScriptProviderSchema,
  resolveScriptContentBudget,
  validateProviderScript,
} from "../src/lib/ai/ScriptStructuredOutput";
import { getScriptMaxTokens, scriptTokenBudget } from "../src/lib/ai/ScriptAIConfig";
import type { ScriptData, ScriptChapter } from "../src/types/script";
import type { SceneData } from "../src/types/scene";

let scenarios = 0;
function pass(condition: unknown, label: string) {
  assert.ok(condition, label);
  scenarios += 1;
}
function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return overrides as unknown as NodeJS.ProcessEnv;
}
function withPreset<T>(preset: string | undefined, fn: () => T): T {
  const previous = process.env.ATOLYE_QUALITY_PRESET;
  if (preset === undefined) delete process.env.ATOLYE_QUALITY_PRESET;
  else process.env.ATOLYE_QUALITY_PRESET = preset;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.ATOLYE_QUALITY_PRESET;
    else process.env.ATOLYE_QUALITY_PRESET = previous;
  }
}

const CPS = 14.12;
function buildScript(totalSeconds: number, chapterCount: number): ScriptData {
  const perChapterChars = Math.round((totalSeconds * CPS) / chapterCount);
  const chapters: ScriptChapter[] = Array.from({ length: chapterCount }, (_, i) => ({
    id: i + 1,
    title: `Bölüm ${i + 1}`,
    narration: "a".repeat(perChapterChars),
    duration: Math.round(totalSeconds / chapterCount),
    visualGoal: "g",
    emotion: "kararlı",
    transition: "fade",
  }));
  const chapterTotal = chapters.reduce((s, c) => s + c.duration, 0);
  return {
    topic: "t", title: "T", subtitle: "", hook: "", introduction: "",
    chapters, conclusion: "", callToAction: "",
    estimatedDuration: chapterTotal,
    narrationWordCount: perChapterChars * chapterCount,
    targetAudience: "genel", language: "tr", voiceStyle: "documentary",
    musicStyle: "cinematic", thumbnailIdea: "", seoKeywords: [],
    createdAt: "2026-08-31T00:00:00.000Z",
  };
}
function scenesFor(script: ScriptData, scenesPerChapter: number): SceneData {
  const scenes: SceneData["scenes"] = [];
  let id = 1;
  for (const chapter of script.chapters) {
    const per = chapter.duration / scenesPerChapter;
    for (let k = 0; k < scenesPerChapter; k += 1) {
      scenes.push({
        id: id++,
        chapterId: chapter.id,
        title: `Sahne ${id}`,
        description: "Bir cümlelik açıklama metni burada yer alır ve yeterince uzundur.",
        visualPrompt: "1453 İstanbul surları önünde sinematik bir kare, dönemsel kıyafetler.",
        duration: k === scenesPerChapter - 1
          ? chapter.duration - per * (scenesPerChapter - 1)
          : per,
      });
    }
  }
  return { scenes, createdAt: "2026-08-31T00:00:00.000Z" };
}

// A -------------------------------------------------------------------------
function backwardCompat() {
  pass(resolveTargetDurationBand(env({})) === LEGACY_TARGET_DURATION_BAND, "no preset -> legacy band (identity)");
  pass(
    resolveProductionAcceptanceDuration(env({})) === productionAcceptanceDuration,
    "no preset -> the frozen legacy acceptance-duration object (identity, byte-identical)",
  );
  pass(resolveMaxSceneCount(env({})) === 30, "no preset -> 30 scene ceiling");
  pass(resolveScriptChapterCount(env({})) === 5, "no preset -> 5-chapter strict script");
  assert.deepEqual(
    resolveCanonicalSceneProviderSchema(env({})),
    canonicalSceneProviderSchema,
    "no preset -> canonical scene schema is deep-equal to the legacy frozen schema",
  );
  scenarios += 1;
  const prompt = withPreset(undefined, () => createScenesPrompt(buildScript(90, 5)));
  for (const needle of [
    "roughly 10 to 18 scenes",
    "Never exceed 30 scenes",
    "Total scene duration must be 60-120 seconds",
    "within 5 seconds",
  ]) {
    pass(prompt.includes(needle), `default scenes prompt keeps historical string: "${needle}"`);
  }
}

// B -------------------------------------------------------------------------
function explicitWidens() {
  const doc = resolveTargetDurationBand(env({ ATOLYE_QUALITY_PRESET: "documentary" }));
  pass(doc.minSeconds === 600 && doc.idealSeconds === 780 && doc.maxSeconds === 900, "documentary band = 600/780/900");
  const d = resolveProductionAcceptanceDuration(env({ ATOLYE_QUALITY_PRESET: "documentary" }));
  pass(
    d.minimumSeconds === 600 && d.targetSeconds === 780 && d.maximumSeconds === 900 &&
      d.toleranceSeconds === Math.round(780 * (5 / 90)),
    "documentary acceptance duration scales, tolerance keeps the 5/90 ratio",
  );
  pass(
    resolveMaxSceneCount(env({ ATOLYE_QUALITY_PRESET: "documentary" })) ===
      Math.max(30, Math.ceil((900 / 60) * 8 * 1.5)),
    "documentary scene ceiling scales from band x density",
  );
  pass(
    resolveScriptChapterCount(env({ ATOLYE_QUALITY_PRESET: "documentary" })) ===
      Math.min(18, Math.max(5, Math.round(780 / 85))),
    "documentary strict chapter count derived from the band",
  );
  const eco = resolveProductionAcceptanceDuration(env({ ATOLYE_QUALITY_PRESET: "economy" }));
  pass(eco.minimumSeconds === 300 && eco.maximumSeconds === 600, "economy band = 300..600");
}

// C -------------------------------------------------------------------------
function validatorsHonorBand() {
  const shortScript = buildScript(90, 5);
  const longScript = buildScript(780, 9);

  // default env
  withPreset(undefined, () => {
    validateProductionAcceptanceScriptDuration(shortScript); // must not throw
    scenarios += 1;
    assert.throws(
      () => validateProductionAcceptanceScriptDuration(longScript),
      /PRODUCTION_DURATION_PREFLIGHT_FAILED|Production duration preflight/,
    );
    scenarios += 1;
  });
  pass(true, "default env: ~90s script accepted, 13-minute script rejected");

  // documentary preset
  withPreset("documentary", () => {
    validateProductionAcceptanceScriptDuration(longScript); // must not throw now
    scenarios += 1;
  });
  pass(true, "ATOLYE_QUALITY_PRESET=documentary: the 13-minute script is accepted");

  // scene-count ceiling
  const longScenes = scenesFor(longScript, 7); // 63 scenes
  withPreset(undefined, () => {
    const evidence = validateProviderScenes(longScenes, longScript, "structure");
    pass(
      !!evidence && evidence.issues.some((i) => i.reason === "MAX_ITEMS"),
      "default env: 63 scenes -> MAX_ITEMS",
    );
  });
  withPreset("documentary", () => {
    const evidence = validateProviderScenes(longScenes, longScript, "structure");
    pass(
      !evidence || !evidence.issues.some((i) => i.reason === "MAX_ITEMS"),
      "documentary preset: 63 scenes is under the ceiling",
    );
  });
}

// D -------------------------------------------------------------------------
function scenePromptScales() {
  const prompt = withPreset("documentary", () => createScenesPrompt(buildScript(780, 9)));
  pass(prompt.includes("600-900 seconds"), "documentary scenes prompt states the 600-900s band");
  pass(!prompt.includes("roughly 10 to 18 scenes"), "documentary scenes prompt drops the legacy 10-18 line");
  pass(/Never exceed \d{2,} scenes/.test(prompt), "documentary scenes prompt raises the hard scene cap");
}

// E — Sprint 178C: the strict SCRIPT schema/config honor the preset band too, so
// a preset that asks the model for 9 chapters is not then rejected at 7.
function providerScript(chapterCount: number, narrationChars: number): Record<string, unknown> {
  return {
    topic: "t", title: "T", subtitle: "S", hook: "H", introduction: "I",
    chapters: Array.from({ length: chapterCount }, (_, i) => ({
      id: i + 1, title: `B${i + 1}`, narration: "a".repeat(narrationChars),
      duration: 60, visualGoal: "g", emotion: "e", transition: "x",
    })),
    conclusion: "C", callToAction: "K", estimatedDuration: 60 * chapterCount,
    narrationWordCount: chapterCount, targetAudience: "genel", language: "tr",
    voiceStyle: "documentary", musicStyle: "cinematic", thumbnailIdea: "T",
    seoKeywords: ["k"],
  };
}
function scriptContractHonorsBand() {
  const legacyEnv = env({});
  const docEnv = env({ ATOLYE_QUALITY_PRESET: "documentary" });

  // A' — no preset: byte-identical legacy contract.
  const legacyBudget = resolveScriptContentBudget(legacyEnv);
  pass(
    legacyBudget.chapterCount === 5 && legacyBudget.schemaChapterMin === 4 &&
      legacyBudget.schemaChapterMax === 7 && legacyBudget.schemaNarrationMaxLength === 1200 &&
      legacyBudget.perChapterMinChars === 260 && legacyBudget.perChapterMaxChars === 340 &&
      legacyBudget.totalLowChars === 1300 && legacyBudget.totalHighChars === 1450,
    "no preset -> script content budget is the frozen legacy contract",
  );
  assert.deepEqual(
    resolveCanonicalScriptProviderSchema(legacyEnv),
    canonicalScriptProviderSchema,
    "no preset -> canonical script schema is deep-equal to the legacy frozen schema",
  );
  scenarios += 1;
  pass(getScriptMaxTokens(legacyEnv) === 3200, "no preset -> script maxTokens is the legacy 3200 default");
  pass(
    validateProviderScript(providerScript(5, 300), legacyEnv) === undefined,
    "no preset -> a legal 5-chapter script validates",
  );

  // B' — documentary: chapter count + narration ceiling scale with the prompt.
  const docChapters = resolveScriptChapterCount(docEnv); // 9
  const docBudget = resolveScriptContentBudget(docEnv);
  pass(docBudget.chapterCount === docChapters, "documentary -> budget chapter count == resolveScriptChapterCount");
  pass(
    docBudget.schemaChapterMin <= docChapters && docChapters <= docBudget.schemaChapterMax,
    "documentary -> validator chapter band contains the requested chapter count",
  );
  pass(
    docBudget.schemaNarrationMaxLength >= docBudget.perChapterMaxChars,
    "documentary -> validator narration ceiling >= prompt per-chapter max (no prompt/validator conflict)",
  );
  pass(docBudget.schemaNarrationMaxLength >= 1200, "documentary -> narration ceiling never drops below legacy 1200");

  // C' — validateProviderScript honors the band.
  pass(
    validateProviderScript(providerScript(docChapters, docBudget.perChapterMaxChars), docEnv) === undefined,
    `documentary -> a ${docChapters}-chapter script at the prompt's per-chapter max validates`,
  );
  const legacyRejects = validateProviderScript(providerScript(docChapters, 300), legacyEnv);
  pass(
    !!legacyRejects && legacyRejects.issues.some((i) => i.reason === "MAX_ITEMS"),
    `no preset -> the same ${docChapters}-chapter script is rejected (MAX_ITEMS)`,
  );
  const docRejectsHuge = validateProviderScript(
    providerScript(docChapters, docBudget.schemaNarrationMaxLength + 500),
    docEnv,
  );
  pass(
    !!docRejectsHuge && docRejectsHuge.issues.some((i) => i.reason === "MAX_LENGTH"),
    "documentary -> pathological over-length narration is still rejected (validator not loosened to accept-anything)",
  );

  // D' — token budget stays inside a single Ollama num_ctx=8192 window.
  pass(
    getScriptMaxTokens(docEnv) === scriptTokenBudget.presetDefaultTokens,
    "documentary -> script maxTokens uses the preset default",
  );
  const PROMPT_TOKENS_GENEROUS = 2300; // measured ~1555 on the real qwen probe; margin for a fuller research block
  pass(
    scriptTokenBudget.presetMaximumTokens + PROMPT_TOKENS_GENEROUS <= 8192,
    "documentary -> preset script maxTokens ceiling + a generous prompt estimate fits num_ctx=8192",
  );
}

function main() {
  backwardCompat();
  explicitWidens();
  validatorsHonorBand();
  scenePromptScales();
  scriptContractHonorsBand();
  console.log(`longform duration preset smoke: PASS (${scenarios} scenarios)`);
  emitSmokeResult("longform-duration-preset", scenarios);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
