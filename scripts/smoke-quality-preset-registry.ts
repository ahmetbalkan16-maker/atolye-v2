/**
 * Documentary pipeline revision — P0: quality-preset registry.
 *
 * Pure smoke (no runtime, no network). Verifies:
 *   A. resolveQualityPreset* — default, explicit, case/trim, fail-closed on unknown.
 *   B. registry invariants — 4 presets, monotone cost ceilings, ordered duration
 *      bands, allowAiVideo only for cinematic.
 *   C. drift guard — the `documentary` preset equals today's application
 *      defaults (AIProviderConfig / imageProviderConfig / visualMediaAdmissionPolicy
 *      / AudioProviderConfig), so wiring a consumer to the preset changes nothing.
 *   D. every preset's text / image / tts model is priceable in AI_PRICE_TABLE
 *      (no preset can ever hit the fail-closed `{status:"unknown"}` path).
 *   E. acceptance fingerprint — ATOLYE_QUALITY_PRESET is conditional: the
 *      `documentary` default leaves the V2 configuration fingerprint unchanged;
 *      an explicit value changes only the ENVIRONMENT_POLICY component.
 */
import assert from "node:assert/strict";
import { emitSmokeResult } from "./lib/SmokeResult";
import {
  DEFAULT_QUALITY_PRESET,
  QUALITY_PRESET_NAMES,
  QUALITY_PRESETS,
  QualityPresetError,
  isExplicitQualityPreset,
  isQualityPresetName,
  resolveQualityPreset,
  resolveQualityPresetName,
} from "../src/lib/production/QualityPreset";
import {
  AI_PRICE_TABLE,
  estimateImageCost,
  estimateTokenCost,
  estimateTtsCost,
} from "../src/lib/ai/AiPricing";
import { aiProviderConfig } from "../src/lib/ai/AIProviderConfig";
import { imageProviderConfig } from "../src/lib/assets/providers/ImageProviderConfig";
import { visualMediaAdmissionPolicy } from "../src/lib/assets/VisualMediaAdmissionPolicy";
import { createProductionAcceptancePortableConfigurationSnapshotV2 } from
  "../src/lib/production/ProductionAcceptanceConfigurationFingerprint";

let scenarios = 0;
function pass(condition: unknown, label: string) {
  assert.ok(condition, label);
  scenarios += 1;
}
function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return overrides as unknown as NodeJS.ProcessEnv;
}

// ---------------------------------------------------------------------------
// A. resolution
// ---------------------------------------------------------------------------
function resolution() {
  pass(resolveQualityPresetName(env({})) === "documentary", "no env -> documentary default");
  pass(DEFAULT_QUALITY_PRESET === "documentary", "DEFAULT_QUALITY_PRESET is documentary");
  pass(
    resolveQualityPresetName(env({ ATOLYE_QUALITY_PRESET: "" })) === "documentary",
    "empty string -> documentary default",
  );
  pass(
    resolveQualityPresetName(env({ ATOLYE_QUALITY_PRESET: "  ECONOMY  " })) === "economy",
    "value is trimmed and lower-cased",
  );
  for (const name of QUALITY_PRESET_NAMES) {
    pass(
      resolveQualityPreset(env({ ATOLYE_QUALITY_PRESET: name })).name === name,
      `explicit ${name} resolves to its spec`,
    );
  }
  let threw: unknown;
  try {
    resolveQualityPresetName(env({ ATOLYE_QUALITY_PRESET: "ultra" }));
  } catch (error) {
    threw = error;
  }
  pass(
    threw instanceof QualityPresetError &&
      (threw as QualityPresetError).code === "QUALITY_PRESET_INVALID" &&
      !threw.message.includes("undefined"),
    "unknown preset fails closed with QualityPresetError (never a silent downgrade)",
  );
  pass(isQualityPresetName("documentary") && !isQualityPresetName("nope"), "isQualityPresetName");
  pass(
    !isExplicitQualityPreset(env({})) &&
      !isExplicitQualityPreset(env({ ATOLYE_QUALITY_PRESET: "  " })) &&
      isExplicitQualityPreset(env({ ATOLYE_QUALITY_PRESET: "economy" })),
    "isExplicitQualityPreset only true for a non-empty value",
  );
}

// ---------------------------------------------------------------------------
// B. registry invariants
// ---------------------------------------------------------------------------
function invariants() {
  pass(QUALITY_PRESET_NAMES.length === 4, "exactly 4 presets");
  pass(
    QUALITY_PRESET_NAMES.every((n) => QUALITY_PRESETS[n] && QUALITY_PRESETS[n].name === n),
    "every name has a matching spec",
  );
  const ceilings = QUALITY_PRESET_NAMES.map((n) => QUALITY_PRESETS[n].costCeilingUsd);
  pass(
    ceilings[0] < ceilings[1] && ceilings[1] < ceilings[2] && ceilings[2] <= ceilings[3],
    "cost ceilings are non-decreasing economy<balanced<documentary<=cinematic",
  );
  pass(QUALITY_PRESETS.documentary.costCeilingUsd === 1.0, "documentary cost ceiling is the $1 target");
  for (const n of QUALITY_PRESET_NAMES) {
    const b = QUALITY_PRESETS[n].targetDurationSeconds;
    pass(
      b.minSeconds <= b.idealSeconds && b.idealSeconds <= b.maxSeconds && b.minSeconds > 0,
      `${n} duration band is ordered and positive`,
    );
  }
  const d = QUALITY_PRESETS.documentary.targetDurationSeconds;
  pass(
    d.idealSeconds >= 600 && d.idealSeconds <= 900,
    "documentary targets a 10-15 minute finished video",
  );
  pass(
    QUALITY_PRESET_NAMES.filter((n) => QUALITY_PRESETS[n].allowAiVideo).join(",") === "cinematic",
    "only cinematic permits AI video (no real T2V provider exists yet)",
  );
}

// ---------------------------------------------------------------------------
// C. drift guard — documentary == today's application defaults
// ---------------------------------------------------------------------------
function driftGuard() {
  const doc = QUALITY_PRESETS.documentary;
  pass(
    doc.textModel === (aiProviderConfig.openai.model || "gpt-4.1-mini"),
    `documentary.textModel matches AIProviderConfig default (${doc.textModel})`,
  );
  pass(
    doc.imageModel === imageProviderConfig.openai.model &&
      doc.imageSize === imageProviderConfig.openai.size &&
      doc.imageQuality === imageProviderConfig.openai.quality,
    "documentary image model/size/quality match imageProviderConfig.openai",
  );
  pass(
    doc.maxAiImages === visualMediaAdmissionPolicy.maxAiImages,
    `documentary.maxAiImages matches visualMediaAdmissionPolicy (${doc.maxAiImages})`,
  );
  pass(doc.ttsModel === "tts-1", "documentary.ttsModel matches AudioProviderConfig default tts-1");
  pass(
    doc.videoWidth === 1920 && doc.videoHeight === 1080 && doc.videoFps === 30 &&
      doc.videoCrf === 23 && doc.x264Preset === "veryfast",
    "documentary render params match FFmpegSceneVideoProvider defaults",
  );
}

// ---------------------------------------------------------------------------
// D. every preset model is priceable (fail-closed safety)
// ---------------------------------------------------------------------------
function priceable() {
  for (const n of QUALITY_PRESET_NAMES) {
    const p = QUALITY_PRESETS[n];
    const token = estimateTokenCost({
      provider: "openai", model: p.textModel, promptTokens: 1000, completionTokens: 1000,
    });
    pass(token.status === "known", `${n}: text model ${p.textModel} is priceable`);
    const image = estimateImageCost({
      provider: "openai", model: p.imageModel, size: p.imageSize, quality: p.imageQuality, count: 1,
    });
    pass(
      image.status === "known" && image.costUsd > 0,
      `${n}: image ${p.imageModel} ${p.imageSize}|${p.imageQuality} is priceable`,
    );
    const tts = estimateTtsCost({ provider: "openai", model: p.ttsModel, characters: 10_000 });
    pass(tts.status === "known", `${n}: tts model ${p.ttsModel} is priceable`);
    pass(
      AI_PRICE_TABLE[p.textModel] !== undefined && AI_PRICE_TABLE[p.imageModel] !== undefined &&
        AI_PRICE_TABLE[p.ttsModel] !== undefined,
      `${n}: all three models have explicit AI_PRICE_TABLE rows`,
    );
  }
}

// ---------------------------------------------------------------------------
// E. acceptance fingerprint conditionality (V2 snapshot)
// ---------------------------------------------------------------------------
async function fingerprint() {
  const slug = "quality-preset-fingerprint-fixture";
  const readBinary = async () => Buffer.alloc(0);
  const base: Record<string, string | undefined> = {
    AI_PROVIDER: "openai",
    IMAGE_PROVIDER: "real",
    AUDIO_PROVIDER: "openai",
    VIDEO_ASSEMBLY_PROVIDER: "ffmpeg",
  };
  const snap = (overrides: Record<string, string | undefined>) =>
    createProductionAcceptancePortableConfigurationSnapshotV2(
      slug, env({ ...base, ...overrides }), readBinary,
    );

  const noPreset = await snap({});
  const noPresetAgain = await snap({ ATOLYE_QUALITY_PRESET: undefined });
  const explicitDoc = await snap({ ATOLYE_QUALITY_PRESET: "documentary" });
  const explicitEco = await snap({ ATOLYE_QUALITY_PRESET: "economy" });

  pass(
    noPreset.configurationFingerprint === noPresetAgain.configurationFingerprint,
    "unset ATOLYE_QUALITY_PRESET -> fingerprint unchanged (documentary default does not alter it)",
  );
  pass(
    explicitDoc.configurationFingerprint !== noPreset.configurationFingerprint,
    "explicit ATOLYE_QUALITY_PRESET=documentary folds into the fingerprint",
  );
  pass(
    explicitEco.configurationFingerprint !== explicitDoc.configurationFingerprint,
    "a different explicit preset yields a different fingerprint",
  );
  const changed = Object.keys(noPreset.componentFingerprints).filter(
    (k) => noPreset.componentFingerprints[k as keyof typeof noPreset.componentFingerprints] !==
      explicitEco.componentFingerprints[k as keyof typeof explicitEco.componentFingerprints],
  );
  pass(
    changed.length === 1 && changed[0] === "ENVIRONMENT_POLICY",
    "only the ENVIRONMENT_POLICY component changes when the preset is pinned",
  );
}

async function main() {
  resolution();
  invariants();
  driftGuard();
  priceable();
  await fingerprint();
  console.log(`quality-preset registry smoke: PASS (${scenarios} scenarios)`);
  emitSmokeResult("quality-preset-registry", scenarios);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
