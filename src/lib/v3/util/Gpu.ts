import type { AIProvider } from "../../ai/providers/AIProvider";
import { runChecked, runProcess } from "./Proc";

/**
 * The 12 GB card runs one heavy model at a time. When less than `minFreeMb` is free, models Ollama keeps loaded
 * (e.g. the script writer, or AYAS chat) are unloaded; they load again on their next use.
 */
export async function freeGpuMemory(minFreeMb: number, log: (s: string) => void = () => {}): Promise<void> {
  const smi = await runChecked("nvidia-smi", ["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"]).catch(() => undefined);
  const [used, total] = (smi?.stdout.trim().split(",") ?? []).map((v) => Number(v));
  if (!used || !total || total - used >= minFreeMb) return;
  const ps = (await (await fetch("http://127.0.0.1:11434/api/ps")).json().catch(() => ({}))) as { models?: { name: string }[] };
  for (const m of ps.models ?? []) {
    log(`ekran kartında yer açılıyor: Ollama ${m.name} boşaltılıyor (${used}/${total} MiB dolu)`);
    await fetch("http://127.0.0.1:11434/api/generate", { method: "POST", body: JSON.stringify({ model: m.name, keep_alive: 0 }) });
  }
}

/** GPU temperature in °C, or undefined when it cannot be read (an unreadable sensor never blocks). */
export async function gpuTemperature(): Promise<number | undefined> {
  try {
    const r = await runProcess("nvidia-smi", ["--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"], { timeoutMs: 10_000 });
    const t = Number(r.stdout.trim().split(/\r?\n/)[0]);
    return Number.isFinite(t) ? t : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A model on the local card (Ollama: the vision judge, the free text fallback) that keeps the owner's temperature
 * rule on every call: a production may take longer, the PC is never pushed past the limit.
 */
export function coolGpuProvider(provider: AIProvider, log: (s: string) => void = () => {}): AIProvider {
  return {
    generate: async (prompt, options) => {
      await waitForCoolGpu(log);
      return provider.generate(prompt, options);
    },
  };
}

/** Owner rule: no GPU work at or above 73 °C; wait in 15 s steps for up to 10 minutes, then refuse. */
export async function waitForCoolGpu(log: (s: string) => void, limit = 73, maxWaitMs = 10 * 60_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const t = await gpuTemperature();
    if (t === undefined || t < limit) return;
    if (Date.now() > deadline) throw new Error(`V3_GPU_TOO_HOT: GPU ${t} °C ≥ ${limit} °C, ${maxWaitMs / 60000} dk beklendi`);
    log(`GPU ${t} °C — soğuması bekleniyor (sınır ${limit} °C)`);
    await new Promise((r) => setTimeout(r, 15_000));
  }
}
