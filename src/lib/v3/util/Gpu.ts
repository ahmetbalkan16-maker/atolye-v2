import type { AIProvider } from "../../ai/providers/AIProvider";
import { A2000_GPU_HARD_STOP_C } from "../../brain/probe/GpuThermalPolicy";
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

/**
 * Unloads every model Ollama keeps, whatever the card's state: on Windows its runner also holds the model in RAM (the
 * vision judge's runner had 19 GB reserved after the visuals step on 21 Oct 2026, leaving 2 GB of RAM while the render
 * started — the likely cause of the render's first-attempt Chrome time-outs). They load again on their next use.
 */
export async function unloadOllama(log: (s: string) => void = () => {}, why = ""): Promise<void> {
  const ps = (await (await fetch("http://127.0.0.1:11434/api/ps")).json().catch(() => ({}))) as { models?: { name: string }[] };
  for (const m of ps.models ?? []) {
    log(`Ollama ${m.name} bellekten indiriliyor${why ? ` (${why})` : ""}`);
    await fetch("http://127.0.0.1:11434/api/generate", { method: "POST", body: JSON.stringify({ model: m.name, keep_alive: 0 }) }).catch(() => undefined);
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
 * Owner rule: no GPU work at the shared A2000 stop (GpuThermalPolicy; 85 °C since 21 Oct 2026, 73 before). The card
 * heats up to 2 °C a second under load and keeps rising a moment after the work stops (21 Oct 2026, stop 73: a VoxCPM
 * line started at 70 °C reached 74, a 4 s vision call started at 65 reached 72), so work starts below GPU_START_C, and
 * work that can rest between its steps (SDXL, MOSS, VoxCPM) rests at GPU_PAUSE_C until the card is below GPU_START_C.
 */
export const GPU_LIMIT_C = A2000_GPU_HARD_STOP_C;
export const GPU_PAUSE_C = GPU_LIMIT_C - 3;
export const GPU_START_C = GPU_LIMIT_C - 7;

/**
 * A model on the local card (Ollama: the vision judge, the free text fallback) that keeps the owner's temperature
 * rule on every call: a production may take longer, the PC is never pushed past the limit. A call cannot rest inside,
 * so it starts only below GPU_START_C.
 */
export function coolGpuProvider(provider: AIProvider, log: (s: string) => void = () => {}): AIProvider {
  return {
    generate: async (prompt, options) => {
      await waitForCoolGpu(log);
      return provider.generate(prompt, options);
    },
  };
}

/** Waits until the card is below `limit` (GPU_START_C) before GPU work, in 15 s steps for up to 10 minutes, then refuses. */
export async function waitForCoolGpu(log: (s: string) => void, limit = GPU_START_C, maxWaitMs = 10 * 60_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const t = await gpuTemperature();
    if (t === undefined || t < limit) return;
    if (Date.now() > deadline) throw new Error(`V3_GPU_TOO_HOT: GPU ${t} °C ≥ ${limit} °C, ${maxWaitMs / 60000} dk beklendi`);
    log(`GPU ${t} °C — soğuması bekleniyor (sınır ${limit} °C)`);
    await new Promise((r) => setTimeout(r, 15_000));
  }
}
