import type { AyasChatModelHardware } from "../../src/lib/ayas/model/AyasChatModelBenchmark";

/**
 * Operator-side GPU footprint probe for scripts/ayas-model-benchmark.ts (model comparison, 2026-10-15). It loads the
 * model on the loopback Ollama, reads what it occupies (GET /api/ps), then unloads it so the benchmark's first case
 * starts cold like every AYAS chat answer (keep_alive 0). Kept out of src/lib: only the owner-run CLI uses it.
 */
async function postJson(fetcher: typeof fetch, url: string, body: unknown, timeoutMs: number): Promise<Record<string, unknown>> {
  const response = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`ollama-${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

export async function probeAyasModelHardware(input: {
  readonly fetcher: typeof fetch; readonly baseUrl: string; readonly model: string; readonly timeoutMs: number;
}): Promise<AyasChatModelHardware | undefined> {
  const { fetcher, baseUrl, model, timeoutMs } = input;
  const loaded = await postJson(fetcher, `${baseUrl}/api/generate`, { model, prompt: "", keep_alive: "2m", stream: false }, timeoutMs);
  try {
    const ps = await fetcher(`${baseUrl}/api/ps`, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    const running = ((await ps.json()) as { models?: { name?: string; model?: string; size?: number; size_vram?: number }[] }).models ?? [];
    const entry = running.find((item) => item.name === model || item.model === model);
    if (!entry || typeof entry.size !== "number" || entry.size <= 0 || typeof entry.size_vram !== "number") return undefined;
    return { loadedBytes: entry.size, vramBytes: entry.size_vram, gpuShare: Math.round((entry.size_vram / entry.size) * 1000) / 1000, loadMs: Math.round(Number(loaded.load_duration ?? 0) / 1e6) };
  } finally {
    await postJson(fetcher, `${baseUrl}/api/generate`, { model, prompt: "", keep_alive: 0, stream: false }, timeoutMs).catch(() => undefined);
  }
}
