/**
 * Documentary pipeline V2 (Faz 2): OpenAI image provider landscape default.
 *
 * The production video is 1920x1080 (16:9). A 1024x1024 square source loses
 * ~44% of its height to the scene compositor's aspect fit; a 1536x1024 (3:2)
 * landscape source loses only ~11% of its width. This suite pins the new
 * default and the IMAGE_OPENAI_SIZE / IMAGE_OPENAI_QUALITY env overrides
 * (fail-closed on an unknown value, exactly like the other image config env
 * vars). No API call is made.
 */
import assert from "node:assert/strict";
import {
  ImageProviderConfigurationError,
  OPENAI_IMAGE_QUALITIES,
  OPENAI_IMAGE_SIZES,
  getOpenAIImageProviderConfig,
  imageProviderConfig,
} from "../src/lib/assets/providers/ImageProviderConfig";

let count = 0;
function scenario(name: string, test: () => void) {
  test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

/** Builds a full ProcessEnv with the given overrides layered on a clean base. */
function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base.IMAGE_OPENAI_SIZE;
  delete base.IMAGE_OPENAI_QUALITY;
  delete base.IMAGE_OPENAI_TIMEOUT_MS;
  delete base.IMAGE_OPENAI_MAX_RESPONSE_BYTES;
  return { ...base, ...overrides };
}

function run() {
  scenario("default size is landscape 1536x1024, quality auto", () => {
    assert.equal(imageProviderConfig.openai.size, "1536x1024");
    assert.equal(imageProviderConfig.openai.quality, "auto");
    const config = getOpenAIImageProviderConfig(env({}));
    assert.equal(config.size, "1536x1024");
    assert.equal(config.quality, "auto");
  });

  scenario("IMAGE_OPENAI_SIZE override accepts every gpt-image-1 size", () => {
    for (const size of OPENAI_IMAGE_SIZES) {
      assert.equal(
        getOpenAIImageProviderConfig(env({ IMAGE_OPENAI_SIZE: size })).size,
        size,
      );
    }
  });

  scenario("IMAGE_OPENAI_SIZE can fall back to the legacy square", () => {
    assert.equal(
      getOpenAIImageProviderConfig(env({ IMAGE_OPENAI_SIZE: "1024x1024" })).size,
      "1024x1024",
    );
  });

  scenario("IMAGE_OPENAI_QUALITY override accepts every documented quality", () => {
    for (const quality of OPENAI_IMAGE_QUALITIES) {
      assert.equal(
        getOpenAIImageProviderConfig(env({ IMAGE_OPENAI_QUALITY: quality })).quality,
        quality,
      );
    }
  });

  scenario("unknown size or quality fails closed (no silent fallback)", () => {
    assert.throws(
      () => getOpenAIImageProviderConfig(env({ IMAGE_OPENAI_SIZE: "1920x1080" })),
      ImageProviderConfigurationError,
    );
    assert.throws(
      () => getOpenAIImageProviderConfig(env({ IMAGE_OPENAI_SIZE: "" })),
      ImageProviderConfigurationError,
    );
    assert.throws(
      () => getOpenAIImageProviderConfig(env({ IMAGE_OPENAI_QUALITY: "ultra" })),
      ImageProviderConfigurationError,
    );
  });

  scenario("unrelated image config env vars still parse (regression)", () => {
    const config = getOpenAIImageProviderConfig(
      env({
        IMAGE_OPENAI_TIMEOUT_MS: "45000",
        IMAGE_OPENAI_MAX_RESPONSE_BYTES: "1048576",
      }),
    );
    assert.equal(config.timeoutMs, 45000);
    assert.equal(config.maximumResponseBytes, 1048576);
    assert.equal(config.size, "1536x1024");
  });

  console.log(`Image provider landscape config smoke: PASS (${count} scenarios)`);
  console.log(
    JSON.stringify({ status: "PASS", suite: "image-provider-landscape-config", scenarios: count }),
  );
}

try {
  run();
} catch (error) {
  console.error("Image provider landscape config smoke FAILED:", error);
  process.exitCode = 1;
}
