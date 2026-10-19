import { runChecked } from "./Proc";

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
