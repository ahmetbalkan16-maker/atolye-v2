/**
 * V3 smoke: the owner's GPU stop inside a local model call — every V3 OllamaProvider carries AYAS's in-call monitor
 * (V3 processes never load the A2000 hardware profile), and a call it aborts runs once more on a cooled card. No GPU,
 * no Ollama: the model, the sensor and the cooling wait are fakes.
 * Run: npx tsx scripts/smoke-v3-gpu.ts
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AIProvider } from "../src/lib/ai/providers/AIProvider";
import { OllamaProvider } from "../src/lib/ai/providers/OllamaProvider";
import { OllamaThermalHardStopError } from "../src/lib/ai/providers/OllamaThermalMonitor";
import { resolveOllamaConfig } from "../src/lib/ai/OllamaConfig";
import { readAyasGpuThermal } from "../src/lib/ayas/machine/AyasGpuThermalAdmission";
import { A2000_GPU_HARD_STOP_C } from "../src/lib/brain/probe/GpuThermalPolicy";
import { coolGpuProvider, GPU_CALL_START_C, GPU_LIMIT_C, V3_OLLAMA_THERMAL } from "../src/lib/v3/util/Gpu";

let scenarios = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
  scenarios++;
}

const ok = { content: "{}", finishReason: "stop" as const, refused: false, complete: true, truncated: false };

async function main() {
  await scenario("the V3 options open AYAS's monitor and trip at the owner's stop", async () => {
    assert.equal(GPU_LIMIT_C, A2000_GPU_HARD_STOP_C);
    const env = V3_OLLAMA_THERMAL.environment!;
    assert.equal((await readAyasGpuThermal(env, async () => GPU_LIMIT_C)).tripped, true);
    assert.equal((await readAyasGpuThermal(env, async () => GPU_LIMIT_C - 1)).tripped, false);
    assert.equal((await readAyasGpuThermal(env, async () => undefined)).tripped, false, "an unreadable sensor never blocks");
  });

  await scenario("a call that heats past the stop is aborted mid-request", async () => {
    let reads = 0;
    const hanging: typeof fetch = async (_url, init) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
    const provider = new OllamaProvider(hanging, () => resolveOllamaConfig({ NODE_ENV: "test", OLLAMA_TIMEOUT_MS: "60000" }), {
      ...V3_OLLAMA_THERMAL,
      pollMs: 1,
      read: async () => ({ tripped: ++reads > 2, reason: "synthetic" }),
    });
    await assert.rejects(provider.generate("x"), OllamaThermalHardStopError);
  });

  await scenario("an aborted call waits for a cool card and runs once more", async () => {
    const waits: number[] = [];
    let calls = 0;
    const flaky: AIProvider = { generate: async () => (++calls === 1 ? Promise.reject(new OllamaThermalHardStopError()) : ok) };
    const logs: string[] = [];
    const out = await coolGpuProvider(flaky, (s) => logs.push(s), async (limit) => void waits.push(limit)).generate("x");
    assert.deepEqual(out, ok);
    assert.equal(calls, 2);
    assert.deepEqual(waits, [GPU_CALL_START_C, GPU_CALL_START_C]);
    assert.ok(logs.some((l) => l.includes(String(GPU_LIMIT_C))));
  });

  await scenario("a second abort is not retried again, other errors not at all", async () => {
    let calls = 0;
    const hot: AIProvider = { generate: async () => (calls++, Promise.reject(new OllamaThermalHardStopError())) };
    await assert.rejects(coolGpuProvider(hot, () => {}, async () => {}).generate("x"), OllamaThermalHardStopError);
    assert.equal(calls, 2);
    calls = 0;
    const broken: AIProvider = { generate: async () => (calls++, Promise.reject(new Error("boom"))) };
    await assert.rejects(coolGpuProvider(broken, () => {}, async () => {}).generate("x"), /boom/);
    assert.equal(calls, 1);
  });

  await scenario("every V3 local model is built with the in-call stop", async () => {
    // The brains' models are built in src/lib/v3 too since cb3661bc (BrainModels), where the scan never looked.
    const lib = (await fs.readdir("src/lib/v3", { recursive: true })).filter((f) => f.endsWith(".ts")).map((f) => `src/lib/v3/${f.replace(/\\/g, "/")}`);
    const files = ["scripts/atolye-v3.ts", ...(await fs.readdir("scripts/v3")).filter((f) => f.endsWith(".ts")).map((f) => `scripts/v3/${f}`), ...lib];
    let built = 0;
    for (const file of files) {
      const text = await fs.readFile(path.resolve(file), "utf8");
      for (const m of text.matchAll(/new OllamaProvider\(/g)) {
        built++;
        const call = text.slice(m.index, text.indexOf("\n", m.index));
        assert.ok(call.includes("V3_OLLAMA_THERMAL)"), `${file}: OllamaProvider without V3_OLLAMA_THERMAL`);
      }
    }
    assert.ok(built >= 6, `expected the V3 Ollama call sites, found ${built}`);
  });

  console.log(`PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
