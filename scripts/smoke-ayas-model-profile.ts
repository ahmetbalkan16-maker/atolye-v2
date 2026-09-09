/**
 * AYAS chat model profile smoke suite (spec §3).
 *
 * Deterministic / $0 / no network. `AYAS_OLLAMA_MODEL` overrides the model for
 * AYAS chat ONLY; unset → the pipeline model; an invalid value is ignored (AYAS
 * chat must not hard-fail on config); host/timeout/format/num_ctx are untouched.
 */

import assert from "node:assert/strict";

import {
  resolveAyasChatModelProfile,
  createAyasChatProvider,
  AYAS_MODEL_ENV,
} from "../src/lib/ayas/AyasModelProfile";
import { resolveOllamaConfig } from "../src/lib/ai/OllamaConfig";

let count = 0;
function scenario(name: string, test: () => void) {
  test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  AYAS_OLLAMA_MODEL: undefined,
  OLLAMA_HOST: "http://127.0.0.1:11434",
  OLLAMA_MODEL: "qwen2.5:3b",
  OLLAMA_NUM_CTX: "8192",
  OLLAMA_TIMEOUT_MS: undefined,
  OLLAMA_MAX_TOKENS: undefined,
  OLLAMA_TEMPERATURE: undefined,
  OLLAMA_FORMAT: undefined,
  OLLAMA_MAX_RETRIES: undefined,
};

scenario("unset AYAS_OLLAMA_MODEL → AYAS uses the pipeline model", () => {
  const p = resolveAyasChatModelProfile(baseEnv);
  assert.equal(p.model, "qwen2.5:3b");
  assert.equal(p.overridden, false);
});

scenario("AYAS_OLLAMA_MODEL=qwen2.5:7b → AYAS chat uses 7b, override flagged", () => {
  const p = resolveAyasChatModelProfile({ ...baseEnv, [AYAS_MODEL_ENV]: "qwen2.5:7b" });
  assert.equal(p.model, "qwen2.5:7b");
  assert.equal(p.overridden, true);
});

scenario("an invalid AYAS_OLLAMA_MODEL is ignored (falls back, never throws)", () => {
  const p = resolveAyasChatModelProfile({ ...baseEnv, [AYAS_MODEL_ENV]: "bad model; rm -rf" });
  assert.equal(p.model, "qwen2.5:3b");
  assert.equal(p.overridden, false);
  assert.equal(p.ignoredInvalidOverride, "bad model; rm -rf");
});

scenario("the override changes ONLY the model — host/format/num_ctx/timeout unchanged", () => {
  const base = resolveOllamaConfig(baseEnv);
  // reproduce what createAyasChatProvider's loader does
  const overEnv = { ...baseEnv, [AYAS_MODEL_ENV]: "qwen2.5:7b" };
  const profile = resolveAyasChatModelProfile(overEnv, resolveOllamaConfig(overEnv));
  const effective = { ...resolveOllamaConfig(overEnv), model: profile.model };
  assert.equal(effective.model, "qwen2.5:7b");
  assert.equal(effective.baseUrl, base.baseUrl);
  assert.equal(effective.format, base.format);
  assert.equal(effective.numCtx, base.numCtx);
  assert.equal(effective.timeoutMs, base.timeoutMs);
});

scenario("createAyasChatProvider returns an OllamaProvider (never OpenAI)", () => {
  const provider = createAyasChatProvider(baseEnv);
  assert.equal(provider.constructor.name, "OllamaProvider");
  assert.equal(typeof provider.generate, "function");
});

scenario("createAyasChatProvider ignores AI_PROVIDER entirely", () => {
  const provider = createAyasChatProvider({ ...baseEnv, AI_PROVIDER: "openai" });
  assert.equal(provider.constructor.name, "OllamaProvider");
});

console.log(`AYAS model profile smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-model-profile", scenarios: count }));
