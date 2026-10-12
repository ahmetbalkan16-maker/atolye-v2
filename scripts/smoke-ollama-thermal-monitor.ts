import assert from "node:assert/strict";
import { OllamaProvider } from "../src/lib/ai/providers/OllamaProvider";
import { OllamaThermalHardStopError } from "../src/lib/ai/providers/OllamaThermalMonitor";
import { resolveOllamaConfig } from "../src/lib/ai/OllamaConfig";
import { readAyasGpuTemperatureC } from "../src/lib/ayas/machine/AyasMachineTelemetry";
import { productionAcceptanceConfigurationFingerprint } from "../src/lib/production/ProductionAcceptancePolicy";
import { createProductionAcceptancePortableConfigurationSnapshotV2 } from "../src/lib/production/ProductionAcceptanceConfigurationFingerprint";

const env: NodeJS.ProcessEnv = { NODE_ENV: "test", ATOLYE_BRAIN_HARDWARE_PROFILE: "rtx-a2000-12gb" };
const config = () => resolveOllamaConfig({ NODE_ENV: "test", OLLAMA_TIMEOUT_MS: "1000", OLLAMA_MAX_RETRIES: "3" });
const success: typeof fetch = async () => Response.json({ done: true, done_reason: "stop", message: { content: '{"ok":true}' } });
async function main() {
  let requests = 0;
  const hot = new OllamaProvider(async (...args) => { requests++; return success(...args); }, config,
    { environment: env, read: async () => ({ tripped: true, reason: "GPU 61 C" }), pollMs: 1 });
  await assert.rejects(hot.generate("test"), OllamaThermalHardStopError);
  assert.equal(requests, 0, "A hot start must never dispatch.");
  let reads = 0;
  const blocked: typeof fetch = async (_request, options) => {
    requests++;
    return new Promise<Response>((_resolve, reject) => {
      assert(options?.signal);
      options.signal.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    });
  };
  const rising = new OllamaProvider(blocked, config, { environment: env, pollMs: 1,
    read: async () => ({ tripped: ++reads > 1, reason: "synthetic rising temperature" }) });
  await assert.rejects(rising.generate("test"), OllamaThermalHardStopError);
  assert.equal(requests, 1, "A thermal abort must not re-roll the model.");
  let coolReads = 0;
  const cool = new OllamaProvider(success, config, { environment: env, pollMs: 1,
    read: async () => { coolReads++; return { tripped: false, reason: "GPU 45 C" }; } });
  assert.equal((await cool.generate("test")).complete, true);
  const stoppedAt = coolReads;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(coolReads, stoppedAt, "The request must release its sensor timer.");
  let offReads = 0;
  const off = new OllamaProvider(success, config, { environment: { NODE_ENV: "test" },
    read: async () => { offReads++; throw new Error("sensor must not be called"); } });
  assert.equal((await off.generate("test")).content, '{"ok":true}');
  assert.equal(offReads, 0, "Other profiles retain their original transport.");
  assert.equal(await readAyasGpuTemperatureC({ run: async () => "\n  \n" }), undefined);
  assert.equal(await readAyasGpuTemperatureC({ run: async () => "N/A\n" }), undefined);
  assert.equal(await readAyasGpuTemperatureC({ run: async () => "45\n61\n" }), 61);
  const cpuEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", OLLAMA_NUM_GPU: "0", OLLAMA_NUM_THREADS: "4" };
  let payload: Record<string, unknown> | undefined;
  const capture: typeof fetch = async (_request, options) => { payload = JSON.parse(String(options?.body)); return success(_request, options); };
  await new OllamaProvider(capture, () => resolveOllamaConfig(cpuEnv), { environment: { NODE_ENV: "test" } }).generate("test");
  assert.deepEqual((payload?.options as { num_gpu: number; num_thread: number }).num_gpu, 0);
  assert.equal((payload?.options as { num_thread: number }).num_thread, 4);
  assert.equal("numGpu" in resolveOllamaConfig({ NODE_ENV: "test" }), false);
  assert.throws(() => resolveOllamaConfig({ NODE_ENV: "test", OLLAMA_NUM_GPU: "-1" }));
  assert.throws(() => resolveOllamaConfig({ NODE_ENV: "test", OLLAMA_NUM_THREADS: "0" }));
  const baseline: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  assert.notEqual(productionAcceptanceConfigurationFingerprint(cpuEnv), productionAcceptanceConfigurationFingerprint(baseline));
  const base = await createProductionAcceptancePortableConfigurationSnapshotV2("fixture", baseline);
  const changed = await createProductionAcceptancePortableConfigurationSnapshotV2("fixture", cpuEnv);
  assert.notEqual(base.componentFingerprints.ENVIRONMENT_POLICY, changed.componentFingerprints.ENVIRONMENT_POLICY);
  console.log(JSON.stringify({ status: "PASS", suite: "ollama-thermal-monitor", scenarios: 18, realGpuWork: 0, serviceStops: 0 }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
