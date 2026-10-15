/**
 * Model comparison (owner request 2026-10-15): measure local models with the frozen AYAS Turkish chat benchmark
 * and record what the Gelişim Merkezi model section shows.
 *
 *   npm run ayas:model-benchmark                      # current AYAS model + installed, unmeasured watch candidates
 *   npm run ayas:model-benchmark -- --registry        # also read candidate sizes/digests from registry.ollama.ai
 *   npm run ayas:model-benchmark -- --models a,b      # these installed models
 *   npm run ayas:model-benchmark -- --installed       # every installed chat model
 *   ... --force                                       # run even while Ollama has a model loaded
 *
 * It talks to the configured loopback Ollama and, with --registry, reads public manifests from registry.ollama.ai.
 * It never downloads a model, never changes AYAS_OLLAMA_MODEL or any other configuration, and writes only
 * data/brain/self-improvement/model-watch/state.json. Downloading a candidate is the owner's decision
 * (`ollama pull <tag>`), after which this command measures it.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { resolveOllamaConfig } from "../src/lib/ai/OllamaConfig";
import { resolveAyasChatModelProfile } from "../src/lib/ayas/AyasModelProfile";
import { AYAS_CHAT_MODEL_BENCHMARK_CASE_COUNT, runAyasChatModelBenchmark } from "../src/lib/ayas/model/AyasChatModelBenchmark";
import {
  AYAS_CHAT_MODEL_BENCHMARK_ID, AYAS_MODEL_WATCH_CANDIDATES, buildAyasModelWatchView, createAyasModelWatchStore,
  type AyasInstalledModel, type AyasModelRegistryObservation, type AyasModelWatchState,
} from "../src/lib/brain/autonomy/AyasModelWatch";
import { probeAyasModelHardware } from "./lib/AyasModelHardwareProbe";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const TAG = /^[a-z0-9][a-z0-9._-]{0,80}:[a-z0-9][a-z0-9._-]{0,80}$/;
const REGISTRY = "https://registry.ollama.ai/v2/library";
const MAX_MANIFEST_BYTES = 64 * 1024;

async function readJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return (await response.json()) as T;
}

async function installedModels(baseUrl: string): Promise<AyasInstalledModel[]> {
  const body = await readJson<{ models?: { name?: string; digest?: string; size?: number }[] }>(`${baseUrl}/api/tags`);
  return (body.models ?? []).filter((model) => typeof model.name === "string" && typeof model.digest === "string" && typeof model.size === "number")
    .map((model) => ({ name: model.name!, digest: model.digest!, sizeBytes: model.size! })).sort((a, b) => a.name.localeCompare(b.name));
}

function gpu(): { gpuName?: string; gpuTotalBytes?: number } {
  try {
    const line = execFileSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 10_000, windowsHide: true }).split(/\r?\n/)[0] ?? "";
    const [name, mib] = line.split(",").map((part) => part.trim());
    return { ...(name ? { gpuName: name } : {}), ...(Number(mib) > 0 ? { gpuTotalBytes: Number(mib) * 1024 * 1024 } : {}) };
  } catch { return {}; }
}

/** The manifest's SHA-256 is the digest Ollama shows for the tag once pulled, so a later download can be matched to it. */
async function registryObservation(tag: string, checkedAt: string): Promise<AyasModelRegistryObservation> {
  if (!TAG.test(tag)) throw new Error(`refused tag: ${tag}`);
  const [name, version] = tag.split(":");
  const response = await fetch(`${REGISTRY}/${name}/manifests/${version}`, {
    headers: { Accept: "application/vnd.docker.distribution.manifest.v2+json" }, redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${tag}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_MANIFEST_BYTES) throw new Error(`manifest too large for ${tag}`);
  const manifest = JSON.parse(bytes.toString("utf8")) as { layers?: { size?: number }[] };
  const totalBytes = (manifest.layers ?? []).reduce((sum, layer) => sum + (typeof layer.size === "number" ? layer.size : 0), 0);
  if (totalBytes <= 0) throw new Error(`manifest without layers for ${tag}`);
  return { tag, digest: createHash("sha256").update(bytes).digest("hex"), totalBytes, checkedAt };
}

async function main(): Promise<number> {
  const config = resolveOllamaConfig(process.env);
  const incumbent = resolveAyasChatModelProfile(process.env).model;
  const store = createAyasModelWatchStore();
  const now = () => new Date().toISOString();
  let state: AyasModelWatchState = store.read() ?? { schemaVersion: 1, updatedAt: now(), installed: [], registry: {}, results: {} };
  const save = (next: AyasModelWatchState) => { state = { ...next, updatedAt: now() }; store.write(state); };

  const installed = await installedModels(config.baseUrl);
  save({ ...state, installed, installedCheckedAt: now(), host: { ...state.host, ...gpu() } });
  console.log(`AYAS modeli: ${incumbent}. Kurulu: ${installed.map((model) => model.name).join(", ")}`);

  if (flag("--registry")) {
    const registry = { ...state.registry };
    for (const tag of [incumbent, ...AYAS_MODEL_WATCH_CANDIDATES.map((candidate) => candidate.tag)]) {
      try {
        const observation = await registryObservation(tag, now());
        registry[tag] = observation;
        console.log(`depo: ${tag} ${(observation.totalBytes / 1e9).toFixed(2)} GB ${observation.digest.slice(0, 12)}`);
      } catch (error) { console.log(`depo: ${tag} okunamadı (${error instanceof Error ? error.message : String(error)})`); }
    }
    save({ ...state, registry });
  }

  const names = new Set(installed.map((model) => model.name));
  const current = (model: string) => state.results[model]?.benchmarkId === AYAS_CHAT_MODEL_BENCHMARK_ID && state.results[model]?.digest === installed.find((entry) => entry.name === model)?.digest;
  const requested = option("--models")?.split(",").map((model) => model.trim()).filter(Boolean);
  const models = requested ?? (flag("--installed")
    ? installed.map((model) => model.name).filter((model) => !/embed/i.test(model))
    : [incumbent, ...AYAS_MODEL_WATCH_CANDIDATES.map((candidate) => candidate.tag)].filter((model) => names.has(model) && !current(model)));
  const missing = models.filter((model) => !names.has(model));
  if (missing.length) { console.error(`Kurulu değil (indirme owner kararıdır): ${missing.join(", ")}`); return 2; }

  if (models.length) {
    const running = (await readJson<{ models?: { name?: string }[] }>(`${config.baseUrl}/api/ps`)).models ?? [];
    if (running.length && !flag("--force")) {
      console.error(`Ollama şu an ${running.map((model) => model.name).join(", ")} çalıştırıyor; AYAS ya da üretim kullanıyor olabilir. Sonra deneyin ya da --force.`);
      return 3;
    }
  }
  for (const model of models) {
    console.log(`\nÖlçülüyor: ${model} (${AYAS_CHAT_MODEL_BENCHMARK_CASE_COUNT} soru)`);
    const result = await runAyasChatModelBenchmark({
      model, env: process.env,
      probeHardware: (tag) => probeAyasModelHardware({ fetcher: fetch, baseUrl: config.baseUrl, model: tag, timeoutMs: config.timeoutMs }),
      onCase: (entry) => console.log(`  ${entry.pass ? "GEÇTİ" : "KALDI"} ${entry.id} ${(entry.latencyMs / 1000).toFixed(1)} sn${entry.reason ? ` — ${entry.reason} :: ${entry.answer.replace(/\s+/g, " ").slice(0, 140)}` : ""}`),
    });
    save({ ...state, results: { ...state.results, [model]: result } });
    console.log(`  ${model}: ${result.passed}/${result.total}, ortanca ${(result.latencyMedianMs / 1000).toFixed(1)} sn${result.hardware ? `, ekran kartında %${Math.round(result.hardware.gpuShare * 100)}` : ""}`);
  }

  const view = buildAyasModelWatchView({ state, incumbentModel: incumbent });
  console.log(`\nÖneri (${view.recommendation.kind}): ${view.recommendation.text}`);
  console.log(JSON.stringify({ status: "OK", benchmarkId: AYAS_CHAT_MODEL_BENCHMARK_ID, measured: models, recommendation: view.recommendation.kind, model: view.recommendation.model ?? null }));
  return 0;
}

main().then((code) => { process.exitCode = code; }, (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
