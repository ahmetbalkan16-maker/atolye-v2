import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gpuTemperature } from "./Gpu";
import { runProcess } from "./Proc";

/**
 * The PC's health beyond the card (owner, 23 Oct 2026: "izlenmeyenleri izleyemez misin" — the GPU was watched, the
 * processor, RAM and disks were not). This i9-13900 under Windows gives no CPU temperature without a kernel driver
 * (no thermal-zone counter, no ACPI zone), so the processor is watched by what heat does to it: under load it slows
 * below its base clock ("% Processor Performance" under 100 while it is busy). RAM and free disk are read directly.
 * Every production step starts, and every render piece, only when the PC is fit for it.
 */
export const DISK_STOP_GB = 10;
export const DISK_WARN_GB = 25;
export const RAM_MIN_GB = 3;
/** Busy (share of time) and slowed (share of base clock): both, and the processor is throttling — heat or power. */
export const CPU_BUSY_PCT = 70;
export const CPU_THROTTLE_PCT = 85;

export interface PcHealth {
  readonly gpuC?: number;
  /** % of base clock the processor runs at (150 = turbo), and how busy it is. */
  readonly cpu?: { readonly performance: number; readonly load: number };
  readonly freeRamGb: number;
  readonly disks: readonly { readonly path: string; readonly freeGb: number }[];
}

/** The processor's speed against its base clock and its load (Windows performance data; English class names). */
export async function cpuState(): Promise<PcHealth["cpu"]> {
  if (process.platform !== "win32") return undefined;
  try {
    const r = await runProcess("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter \"Name='_Total'\" | ForEach-Object { \"$($_.PercentProcessorPerformance);$($_.PercentProcessorTime)\" }"], { timeoutMs: 20_000 });
    const [performance, load] = r.stdout.trim().split(";").map(Number);
    return Number.isFinite(performance) && Number.isFinite(load) ? { performance: performance!, load: load! } : undefined;
  } catch {
    return undefined;
  }
}

/** Free space (GB) where `dir` lives, or undefined when it cannot be read (a missing drive never blocks). */
export async function freeDiskGb(dir: string): Promise<number | undefined> {
  try {
    const s = await fs.statfs(dir);
    return Math.round(((s.bavail * s.bsize) / 1024 ** 3) * 10) / 10;
  } catch {
    return undefined;
  }
}

/** The drives a production writes to: the work root, the ASCII temp, and on Windows the system drive (models, caches). */
export function healthDirs(paths: { readonly workRoot: string; readonly asciiTemp: string }): string[] {
  return [paths.workRoot, paths.asciiTemp, ...(process.platform === "win32" ? ["C:\\"] : [])];
}

export async function pcHealth(dirs: readonly string[]): Promise<PcHealth> {
  const [gpuC, cpu, disks] = await Promise.all([gpuTemperature(), cpuState(), Promise.all([...new Set(dirs.map((d) => path.parse(path.resolve(d)).root))].map(async (d) => ({ path: d.replace(/[\\/]+$/, ""), freeGb: await freeDiskGb(d) })))]);
  return {
    ...(gpuC !== undefined ? { gpuC } : {}),
    ...(cpu ? { cpu } : {}),
    freeRamGb: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    disks: disks.flatMap((d) => (d.freeGb !== undefined ? [{ path: d.path, freeGb: d.freeGb }] : [])),
  };
}

export function cpuThrottled(cpu: PcHealth["cpu"]): boolean {
  return !!cpu && cpu.load >= CPU_BUSY_PCT && cpu.performance < CPU_THROTTLE_PCT;
}

/** What the health asks for: stop (a disk nearly full), wait (RAM short, the processor throttling), or go with warnings. */
export function healthVerdict(h: PcHealth): { readonly stop?: string; readonly wait?: string; readonly warnings: readonly string[] } {
  const full = h.disks.find((d) => d.freeGb < DISK_STOP_GB);
  if (full) return { stop: `${full.path} sürücüsünde ${full.freeGb} GB boş (en az ${DISK_STOP_GB} GB gerekli); yer açılmadan üretim sürmez`, warnings: [] };
  const warnings = h.disks.filter((d) => d.freeGb < DISK_WARN_GB).map((d) => `${d.path} sürücüsünde yalnız ${d.freeGb} GB boş`);
  if (h.freeRamGb < RAM_MIN_GB) return { wait: `RAM ${h.freeRamGb} GB boş (en az ${RAM_MIN_GB} GB)`, warnings };
  if (cpuThrottled(h.cpu)) return { wait: `işlemci yavaşlıyor: yük %${Math.round(h.cpu!.load)}, hız taban saatin %${Math.round(h.cpu!.performance)}'i (ısı ya da güç sınırı)`, warnings };
  return { warnings };
}

/** One line for the production log: what the PC looks like now. */
export function healthLine(h: PcHealth): string {
  return [
    h.gpuC !== undefined ? `GPU ${h.gpuC} °C` : "GPU okunamadı",
    h.cpu ? `işlemci hız %${Math.round(h.cpu.performance)} yük %${Math.round(h.cpu.load)}` : "işlemci okunamadı",
    `RAM ${h.freeRamGb} GB boş`,
    ...h.disks.map((d) => `${d.path} ${Math.round(d.freeGb)} GB boş`),
  ].join(" · ");
}

/**
 * Waits until the PC is fit for work: a nearly full disk stops the production (V3_DISK_LOW, nothing frees space by
 * waiting); short RAM or a throttling processor rests in 20 s steps — RAM for up to 10 minutes, then V3_RAM_LOW; the
 * processor for up to 3 minutes, then the work goes on with a warning (the slowdown is a sign of heat, not a reading of
 * it, and a power limit alone must not stop a production). `free`: what may give RAM back (unloading Ollama).
 */
export async function waitForPcHealth(dirs: readonly string[], log: (s: string) => void, opts: { readonly free?: () => Promise<void>; readonly sleepMs?: number } = {}): Promise<PcHealth> {
  const sleep = opts.sleepMs ?? 20_000;
  const started = Date.now();
  let freed = false;
  let warned = false;
  for (;;) {
    const h = await pcHealth(dirs);
    const v = healthVerdict(h);
    if (v.stop) throw new Error(`V3_DISK_LOW: ${v.stop}`);
    if (!warned) for (const w of v.warnings) log(`⚠ PC sağlığı: ${w}`);
    warned = true;
    if (!v.wait) return h;
    const waited = Date.now() - started;
    const ram = h.freeRamGb < RAM_MIN_GB;
    if (ram && !freed && opts.free) {
      freed = true;
      await opts.free().catch(() => undefined);
      continue;
    }
    if (ram && waited > 10 * 60_000) throw new Error(`V3_RAM_LOW: ${v.wait}, 10 dk beklendi`);
    if (!ram && waited > 3 * 60_000) {
      log(`⚠ PC sağlığı: ${v.wait} — 3 dk dinlendi, iş sürüyor`);
      return h;
    }
    log(`PC sağlığı: ${v.wait} — dinleniyor`);
    await new Promise((r) => setTimeout(r, sleep));
  }
}
