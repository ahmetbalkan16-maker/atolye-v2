import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AyasMachineTelemetry {
  readonly observedAt: string;
  readonly cpuPercent?: number;
  readonly gpuPercent?: number;
  readonly ramUsedPercent?: number;
  readonly vramUsedPercent?: number;
  readonly diskFreePercent?: number;
  readonly processRssMb: number;
  readonly ffmpegRunning?: boolean;
  readonly localModelRunning?: boolean;
  readonly unavailable: readonly ("cpu" | "gpu" | "ram" | "vram" | "disk" | "process-list")[];
}

export interface AyasMachineTelemetryDeps {
  readonly platform?: NodeJS.Platform;
  readonly cwd?: string;
  readonly now?: () => string;
  readonly run?: (file: string, args: readonly string[]) => Promise<string>;
}

/** Read-only, local-only telemetry. No readiness probe and no sentinel/write. */
export async function collectAyasMachineTelemetry(deps: AyasMachineTelemetryDeps = {}): Promise<AyasMachineTelemetry> {
  const unavailable: AyasMachineTelemetry["unavailable"][number][] = [];
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? runLocal;
  const totalRam = os.totalmem();
  const freeRam = os.freemem();
  const ramUsedPercent = totalRam > 0 ? percent(totalRam - freeRam, totalRam) : undefined;
  if (ramUsedPercent === undefined) unavailable.push("ram");

  let diskFreePercent: number | undefined;
  try {
    const stat = await fs.statfs(deps.cwd ?? process.cwd());
    diskFreePercent = Number(stat.blocks) > 0 ? percent(Number(stat.bavail), Number(stat.blocks)) : undefined;
  } catch { /* conservative classification below */ }
  if (diskFreePercent === undefined) unavailable.push("disk");

  let cpuPercent: number | undefined;
  try {
    const output = platform === "win32"
      ? await run("wmic", ["cpu", "get", "loadpercentage", "/value"])
      : await run("sh", ["-c", "LC_ALL=C ps -A -o %cpu="]);
    const values = platform === "win32"
      ? [...output.matchAll(/LoadPercentage=(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]))
      : output.split(/\s+/).map(Number).filter(Number.isFinite);
    if (values.length) cpuPercent = Math.min(100, values.reduce((sum, value) => sum + value, 0) / (platform === "win32" ? values.length : Math.max(1, os.cpus().length)));
  } catch { /* optional OS command */ }
  if (cpuPercent === undefined) unavailable.push("cpu");

  let gpuPercent: number | undefined;
  let vramUsedPercent: number | undefined;
  try {
    const output = await run("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"]);
    const rows = output.trim().split(/\r?\n/).map((line) => line.split(",").map((value) => Number(value.trim()))).filter((row) => row.length === 3 && row.every(Number.isFinite));
    if (rows.length) {
      gpuPercent = Math.max(...rows.map((row) => row[0]));
      vramUsedPercent = Math.max(...rows.map((row) => percent(row[1], row[2])));
    }
  } catch { /* non-NVIDIA or unavailable */ }
  if (gpuPercent === undefined) unavailable.push("gpu");
  if (vramUsedPercent === undefined) unavailable.push("vram");

  let ffmpegRunning: boolean | undefined;
  let localModelRunning: boolean | undefined;
  try {
    const output = (platform === "win32" ? await run("tasklist", ["/fo", "csv", "/nh"]) : await run("ps", ["-A", "-o", "comm="])).toLowerCase();
    ffmpegRunning = /(^|[\\/",\s])ffmpeg(?:\.exe)?(["\s,]|$)/m.test(output);
    localModelRunning = /(^|[\\/",\s])(ollama|llama-server|koboldcpp|lmstudio)(?:\.exe)?(["\s,]|$)/m.test(output);
  } catch { unavailable.push("process-list"); }

  return Object.freeze({
    observedAt: (deps.now ?? (() => new Date().toISOString()))(),
    ...(cpuPercent === undefined ? {} : { cpuPercent }),
    ...(gpuPercent === undefined ? {} : { gpuPercent }),
    ...(ramUsedPercent === undefined ? {} : { ramUsedPercent }),
    ...(vramUsedPercent === undefined ? {} : { vramUsedPercent }),
    ...(diskFreePercent === undefined ? {} : { diskFreePercent }),
    processRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    ...(ffmpegRunning === undefined ? {} : { ffmpegRunning }),
    ...(localModelRunning === undefined ? {} : { localModelRunning }),
    unavailable: Object.freeze(unavailable),
  });
}

async function runLocal(file: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync(file, [...args], { timeout: 2_500, maxBuffer: 256 * 1024, windowsHide: true });
  return result.stdout;
}
function percent(part: number, total: number): number { return Math.max(0, Math.min(100, Number(((part / total) * 100).toFixed(2)))); }
