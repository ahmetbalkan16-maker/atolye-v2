import crypto from "node:crypto";

import type { AyasChatModelBenchmarkResult } from "../../ayas/model/AyasChatModelBenchmark";
import { compareAyasChatModels, createAyasModelWatchStore, currentAyasModelResult, type AyasInstalledModel, type AyasModelWatchState, type AyasModelWatchStore } from "./AyasModelWatch";
import { AYAS_MODEL_TRIAL_MAX_ERRORS, type AyasModelOperationStore, type AyasModelTrialDecisionRecord, type AyasModelTrialRecord } from "./AyasModelOperationStore";

/**
 * Carries out one owner "İndir ve ölç" (AyasModelOperationStore) in bounded steps, one per executor run:
 *
 * 1. Before the first byte, the registry manifest of the tag must still hash to the digest the owner approved, and the
 *    model store must have room for it. Otherwise nothing is downloaded and the trial fails with the reason.
 * 2. The loopback Ollama downloads it (`POST /api/pull`) for at most one slice; Ollama keeps the partial download, so
 *    the next run continues where this one stopped.
 * 3. Once pulled, the digest Ollama reports for the tag must equal the approved one, or the model is not measured.
 * 4. While Ollama runs no other model, the frozen benchmark measures the current model (when its result is not
 *    current) and the candidate, and both results go to the model-watch state the Gelişim Merkezi card reads.
 *
 * It never changes configuration and never touches the live application. Effectful (the loopback Ollama and the
 * public registry manifest): reached only from scripts/ayas-update-executor.ts.
 */
export interface AyasModelTrialDeps {
  readonly store: AyasModelOperationStore;
  readonly watchStore?: AyasModelWatchStore;
  /** The loopback Ollama (OllamaConfig.baseUrl); anything else is refused. */
  readonly baseUrl: string;
  /** The model AYAS chat uses now. */
  readonly incumbentModel: string;
  /** Runs the frozen benchmark on one installed model (the executor binds env and the GPU probe). */
  readonly measure: (model: string) => Promise<AyasChatModelBenchmarkResult>;
  readonly fetcher?: typeof fetch;
  readonly now?: () => string;
  /** How long one executor run may download; the observer starts the next run on its next tick. */
  readonly sliceMs?: number;
  /** Free bytes where Ollama keeps models; undefined when unknown (then not checked). */
  readonly freeBytes?: () => number | undefined;
}

export const AYAS_MODEL_TRIAL_SLICE_MS = 20 * 60_000;
/** Room left for the system and the next model after the download. */
const DISK_MARGIN_BYTES = 10 * 1024 ** 3;
const REGISTRY = "https://registry.ollama.ai/v2/library";
const MAX_MANIFEST_BYTES = 64 * 1024;
const TAG = /^[a-z0-9][a-z0-9._-]{0,80}:[a-z0-9][a-z0-9._-]{0,80}$/;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);
const gb = (bytes: number) => `${(bytes / 1e9).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} GB`;

function loopback(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Ollama is not on loopback");
  return url.origin;
}

async function readJson<T>(fetcher: typeof fetch, url: string): Promise<T> {
  const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function readAyasOllamaInstalledModels(fetcher: typeof fetch, origin: string): Promise<AyasInstalledModel[]> {
  const body = await readJson<{ models?: { name?: string; digest?: string; size?: number }[] }>(fetcher, `${origin}/api/tags`);
  return (body.models ?? []).filter((model) => typeof model.name === "string" && typeof model.digest === "string" && typeof model.size === "number")
    .map((model) => ({ name: model.name!, digest: model.digest!, sizeBytes: model.size! })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The manifest's SHA-256 is the digest Ollama shows for the tag once pulled (same rule as scripts/ayas-model-benchmark.ts). */
export async function readAyasRegistryManifestDigest(fetcher: typeof fetch, tag: string): Promise<{ readonly digest: string; readonly totalBytes: number }> {
  if (!TAG.test(tag)) throw new Error(`refused tag: ${tag}`);
  const [name, version] = tag.split(":");
  const response = await fetcher(`${REGISTRY}/${name}/manifests/${version}`, {
    headers: { Accept: "application/vnd.docker.distribution.manifest.v2+json" }, redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_MANIFEST_BYTES) throw new Error("manifest too large");
  const manifest = JSON.parse(bytes.toString("utf8")) as { layers?: { size?: number }[] };
  const totalBytes = (manifest.layers ?? []).reduce((sum, layer) => sum + (typeof layer.size === "number" ? layer.size : 0), 0);
  if (totalBytes <= 0) throw new Error("manifest without layers");
  return { digest: crypto.createHash("sha256").update(bytes).digest("hex"), totalBytes };
}

type PullSlice =
  | { readonly outcome: "SUCCESS"; readonly totalBytes?: number; readonly completedBytes?: number }
  | { readonly outcome: "PARTIAL"; readonly totalBytes?: number; readonly completedBytes?: number }
  | { readonly outcome: "ERROR"; readonly error: string; readonly totalBytes?: number; readonly completedBytes?: number };

/** One bounded download slice; progress is summed over the layers Ollama reports. */
async function pullSlice(fetcher: typeof fetch, origin: string, tag: string, sliceMs: number): Promise<PullSlice> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), sliceMs);
  const layers = new Map<string, { total: number; completed: number }>();
  const progress = () => {
    const values = [...layers.values()];
    return values.length ? { totalBytes: values.reduce((sum, layer) => sum + layer.total, 0), completedBytes: values.reduce((sum, layer) => sum + layer.completed, 0) } : {};
  };
  try {
    const response = await fetcher(`${origin}/api/pull`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: tag, stream: true }), redirect: "error", signal: controller.signal,
    });
    if (!response.ok || !response.body) return { outcome: "ERROR", error: `HTTP ${response.status}` };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const event = JSON.parse(line) as { status?: string; digest?: string; total?: number; completed?: number; error?: string };
        if (event.error) return { outcome: "ERROR", error: String(event.error).slice(0, 200), ...progress() };
        if (event.digest && typeof event.total === "number") layers.set(event.digest, { total: event.total, completed: typeof event.completed === "number" ? event.completed : 0 });
        if (event.status === "success") return { outcome: "SUCCESS", ...progress() };
      }
    }
    return { outcome: "ERROR", error: "indirme başarı bildirmeden bitti", ...progress() };
  } catch (error) {
    if (controller.signal.aborted) return { outcome: "PARTIAL", ...progress() };
    return { outcome: "ERROR", error: errorText(error), ...progress() };
  } finally { clearTimeout(timer); }
}

const emptyWatch = (now: string): AyasModelWatchState => ({ schemaVersion: 1, updatedAt: now, installed: [], registry: {}, results: {} });

/** One executor run of a trial: at most one download slice, then the measurement once the model is in place. */
export async function runAyasModelTrial(decision: AyasModelTrialDecisionRecord, existing: AyasModelTrialRecord | undefined, deps: AyasModelTrialDeps): Promise<AyasModelTrialRecord> {
  const now = deps.now ?? (() => new Date().toISOString());
  const fetcher = deps.fetcher ?? fetch;
  const watchStore = deps.watchStore ?? createAyasModelWatchStore();
  let record: AyasModelTrialRecord = existing ?? {
    schemaVersion: 1, trialId: `ayas-model-trial-${crypto.randomUUID()}`, decisionId: decision.decisionId, tag: decision.tag, registryDigest: decision.registryDigest,
    status: "PULLING", startedAt: now(), updatedAt: now(), slices: 0, consecutiveErrors: 0,
  };
  const save = (patch: Partial<AyasModelTrialRecord>, clearError = false): AyasModelTrialRecord => {
    const next: AyasModelTrialRecord = { ...record, ...patch, updatedAt: now() };
    if (clearError) delete (next as { lastError?: string }).lastError;
    record = next;
    deps.store.upsertTrial(record);
    return record;
  };
  const fail = (reason: string) => save({ status: "FAILED", finishedAt: now(), failureReason: reason });
  const transient = (error: string, patch: Partial<AyasModelTrialRecord> = {}) => {
    const errors = record.consecutiveErrors + 1;
    return errors >= AYAS_MODEL_TRIAL_MAX_ERRORS ? fail(`${errors} kez üst üste başarısız oldu: ${error}`) : save({ ...patch, consecutiveErrors: errors, lastError: error });
  };
  save({});
  let origin: string;
  try { origin = loopback(deps.baseUrl); } catch { return fail("Ollama bu bilgisayarda (loopback) değil; indirme yapılmadı"); }

  if (record.status === "PULLING") {
    let installed: AyasInstalledModel[];
    try { installed = await readAyasOllamaInstalledModels(fetcher, origin); } catch (error) { return transient(`Ollama okunamadı: ${errorText(error)}`); }
    if (installed.find((model) => model.name === decision.tag)?.digest === decision.registryDigest) {
      save({ status: "MEASURING", installedDigest: decision.registryDigest }, true);
    } else {
      if (record.slices === 0) {
        let registry: { readonly digest: string; readonly totalBytes: number };
        try { registry = await readAyasRegistryManifestDigest(fetcher, decision.tag); } catch (error) { return transient(`model deposu okunamadı: ${errorText(error)}`); }
        if (registry.digest !== decision.registryDigest) {
          // The card then shows the new digest, so the owner can approve that one.
          const state = watchStore.read() ?? emptyWatch(now());
          watchStore.write({ ...state, updatedAt: now(), registry: { ...state.registry, [decision.tag]: { tag: decision.tag, digest: registry.digest, totalBytes: registry.totalBytes, checkedAt: now() } } });
          return fail("model deposundaki sürüm onayladığından farklı; hiçbir şey indirilmedi. Kartta yeni sürümü onaylayabilirsin.");
        }
        const free = deps.freeBytes?.();
        if (free !== undefined && free < registry.totalBytes + DISK_MARGIN_BYTES) return fail(`model deposunda yer yetersiz: ${gb(free)} boş, ${gb(registry.totalBytes + DISK_MARGIN_BYTES)} gerekiyor`);
        save({ totalBytes: registry.totalBytes });
      }
      const slice = await pullSlice(fetcher, origin, decision.tag, deps.sliceMs ?? AYAS_MODEL_TRIAL_SLICE_MS);
      const progress = { ...(slice.totalBytes ? { totalBytes: slice.totalBytes } : {}), ...(slice.completedBytes !== undefined ? { completedBytes: slice.completedBytes } : {}), slices: record.slices + 1 };
      if (slice.outcome === "ERROR") return transient(`indirme: ${slice.error}`, progress);
      if (slice.outcome === "PARTIAL") return save({ ...progress, consecutiveErrors: 0 }, true);
      try { installed = await readAyasOllamaInstalledModels(fetcher, origin); } catch (error) { return transient(`Ollama okunamadı: ${errorText(error)}`, progress); }
      const pulled = installed.find((model) => model.name === decision.tag);
      if (!pulled || pulled.digest !== decision.registryDigest) return fail("indirilen model onaylanan sürümle eşleşmiyor; ölçülmedi");
      save({ ...progress, status: "MEASURING", consecutiveErrors: 0, installedDigest: pulled.digest }, true);
    }
  }

  if (record.status !== "MEASURING") return record;
  try {
    // AYAS chat or production may be using the model runtime: measure only when it runs nothing.
    const running = (await readJson<{ models?: unknown[] }>(fetcher, `${origin}/api/ps`)).models ?? [];
    if (running.length) return save({ lastError: "Ollama şu an başka bir modeli çalıştırıyor; sonraki turda ölçülecek" });
    const installed = await readAyasOllamaInstalledModels(fetcher, origin);
    if (installed.find((model) => model.name === decision.tag)?.digest !== decision.registryDigest) return fail("model artık kurulu değil ya da değişmiş; ölçülmedi");
    let state: AyasModelWatchState = { ...(watchStore.read() ?? emptyWatch(now())), installed, installedCheckedAt: now(), updatedAt: now() };
    watchStore.write(state);
    // The comparison needs the current model measured on its installed bytes too.
    if (!currentAyasModelResult(state, deps.incumbentModel) && installed.some((model) => model.name === deps.incumbentModel)) {
      const incumbent = await deps.measure(deps.incumbentModel);
      state = { ...state, updatedAt: now(), results: { ...state.results, [deps.incumbentModel]: incumbent } };
      watchStore.write(state);
    }
    const result = await deps.measure(decision.tag);
    state = { ...state, updatedAt: now(), results: { ...state.results, [decision.tag]: result } };
    watchStore.write(state);
    const incumbent = currentAyasModelResult(state, deps.incumbentModel);
    const verdict = incumbent ? compareAyasChatModels(incumbent, result).verdict : undefined;
    return save({ status: "MEASURED", finishedAt: now(), consecutiveErrors: 0, measured: { passed: result.passed, total: result.total, incumbentModel: deps.incumbentModel, ...(verdict ? { verdict } : {}) } }, true);
  } catch (error) {
    return transient(`ölçüm: ${errorText(error)}`);
  }
}
