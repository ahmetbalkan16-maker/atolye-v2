/**
 * Atölye Brain — read-only host resource probe (Sprint 181, PHASE 5).
 *
 * Fills a {@link BrainResourceSnapshot} from what the host will tell us without
 * changing anything:
 *  - GPU: `nvidia-smi --query-gpu=... --format=csv` (a telemetry read — the same
 *    call every monitoring tool makes). NO settings, NO fan/power/clock control,
 *    NO inference, NO model pull, NO stress. Timeout-bounded.
 *  - RAM: `node:os` (`freemem` / `totalmem`).
 *
 * Hard rules (from the emir):
 *  - Read-only. This module never spawns anything but `nvidia-smi` with
 *    `--query-*` / `--format` flags, and never writes a file.
 *  - "Could not read" is NOT "safe". When the GPU cannot be read the snapshot
 *    `source` is `"unavailable"`, which drives the Safety Governor's full
 *    conservative bundle — it must never silently become `"measured"`.
 *  - The A2000's **60 °C hard stop** is preserved here as an explicit,
 *    deterministic check ({@link evaluateBrainResourceHardStop}) that callers
 *    must consult *in addition to* `evaluateBrainSafety`.
 */

import { execFile } from "node:child_process";
import os from "node:os";

import type {
  BrainAbnormalSignal,
  BrainHardwareProfile,
  BrainResourceSnapshot,
} from "@/types/brain";

/**
 * A2000-specific hard ceiling. The general Safety Governor ceiling for this card
 * is 80 °C; this is a *stricter* stop the director asked to keep in force for
 * the A2000 after the earlier WHEA/TDR incidents. Never raise it here.
 */
export const BRAIN_A2000_GPU_HARD_STOP_C = 60;
export const BRAIN_A2000_PROFILE_ID = "rtx-a2000-12gb";

const DEFAULT_TIMEOUT_MS = 4_000;
const NVIDIA_SMI_QUERY = [
  "--query-gpu=temperature.gpu,utilization.gpu,power.draw,memory.used,memory.total",
  "--format=csv,noheader,nounits",
];

export interface BrainResourceProbeOptions {
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly nvidiaSmiPath?: string;
  /**
   * Injectable GPU reader for tests. Receives the exact argv; returns raw
   * stdout, or throws / returns `undefined` when unavailable.
   */
  readonly runNvidiaSmi?: (args: readonly string[]) => Promise<string | undefined>;
  /** Injectable host-memory reader for tests. */
  readonly readHostMemory?: () => { readonly usedGb: number; readonly totalGb: number } | undefined;
}

/* ------------------------------------------------------------------------- *
 * nvidia-smi CSV parsing (pure)
 * ------------------------------------------------------------------------- */

export interface NvidiaSmiGpuReading {
  readonly gpuTempC?: number;
  readonly gpuUtilizationPct?: number;
  readonly gpuPowerW?: number;
  readonly vramUsedGb?: number;
  readonly vramTotalGb?: number;
  readonly abnormalSignals: readonly BrainAbnormalSignal[];
  /** `true` when at least one numeric field parsed — otherwise the read is useless. */
  readonly anyFieldParsed: boolean;
}

const NA_TOKENS = new Set([
  "n/a",
  "[n/a]",
  "not supported",
  "[not supported]",
  "unknown error",
  "[unknown error]",
  "",
]);

const NUMERIC_CELL_RE = /^-?\d+(?:\.\d+)?$/;

/** A cell is valid iff it is a plain number or a recognised "no value" token. */
function isDataCell(token: string): boolean {
  const cleaned = token.trim().toLowerCase();
  return NA_TOKENS.has(cleaned) || NUMERIC_CELL_RE.test(cleaned);
}

function num(token: string | undefined): number | undefined {
  if (token === undefined) return undefined;
  const cleaned = token.trim().toLowerCase();
  if (NA_TOKENS.has(cleaned) || !NUMERIC_CELL_RE.test(cleaned)) return undefined;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

/** Parse the first data row of an `nvidia-smi --format=csv,noheader,nounits` dump. */
export function parseNvidiaSmiCsv(raw: string): NvidiaSmiGpuReading {
  const text = String(raw ?? "");
  const signals = new Set<BrainAbnormalSignal>();
  if (/fallen off the bus/i.test(text)) signals.add("gpu-fallen-off-bus");
  if (/(has encountered|xid).*(fatal|uncorrectable)/i.test(text)) signals.add("fatal-whea");

  const firstRow = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => {
      if (line.length === 0 || !line.includes(",")) return false;
      const cells = line.split(",").map((cell) => cell.trim());
      return cells.length >= 2 && cells.every(isDataCell);
    });

  if (!firstRow) {
    return { abnormalSignals: [...signals], anyFieldParsed: false };
  }

  const cells = firstRow.split(",").map((cell) => cell.trim());
  const gpuTempC = num(cells[0]);
  const gpuUtilizationPct = num(cells[1]);
  const gpuPowerW = num(cells[2]);
  const vramUsedMib = num(cells[3]);
  const vramTotalMib = num(cells[4]);
  const vramUsedGb = vramUsedMib === undefined ? undefined : round1(vramUsedMib / 1024);
  const vramTotalGb = vramTotalMib === undefined ? undefined : round1(vramTotalMib / 1024);

  const anyFieldParsed = [gpuTempC, gpuUtilizationPct, gpuPowerW, vramUsedGb, vramTotalGb].some(
    (value) => value !== undefined,
  );

  return {
    ...(gpuTempC !== undefined ? { gpuTempC } : {}),
    ...(gpuUtilizationPct !== undefined ? { gpuUtilizationPct } : {}),
    ...(gpuPowerW !== undefined ? { gpuPowerW } : {}),
    ...(vramUsedGb !== undefined ? { vramUsedGb } : {}),
    ...(vramTotalGb !== undefined ? { vramTotalGb } : {}),
    abnormalSignals: [...signals],
    anyFieldParsed,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/* ------------------------------------------------------------------------- *
 * Probe
 * ------------------------------------------------------------------------- */

function defaultRunNvidiaSmi(binPath: string, timeoutMs: number) {
  return (args: readonly string[]): Promise<string | undefined> =>
    new Promise((resolve) => {
      execFile(
        binPath,
        [...args],
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error && !stdout) {
            // Surface a "fallen off the bus" style message even on a non-zero exit.
            resolve(stderr ? String(stderr) : undefined);
            return;
          }
          resolve(String(stdout ?? "") + (stderr ? `\n${stderr}` : ""));
        },
      );
    });
}

function defaultReadHostMemory(): { usedGb: number; totalGb: number } | undefined {
  try {
    const totalGb = round1(os.totalmem() / 1024 ** 3);
    const usedGb = round1((os.totalmem() - os.freemem()) / 1024 ** 3);
    if (!Number.isFinite(totalGb) || totalGb <= 0) return undefined;
    return { usedGb, totalGb };
  } catch {
    return undefined;
  }
}

/**
 * Read the host. Never throws — any failure yields a `source: "unavailable"`
 * snapshot, which the Safety Governor treats conservatively.
 */
export async function probeBrainResources(
  options: BrainResourceProbeOptions = {},
): Promise<BrainResourceSnapshot> {
  const now = options.now ?? (() => new Date());
  const observedAt = now().toISOString();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const nvidiaSmiPath = options.nvidiaSmiPath ?? "nvidia-smi";
  const runNvidiaSmi =
    options.runNvidiaSmi ?? defaultRunNvidiaSmi(nvidiaSmiPath, timeoutMs);
  const readHostMemory = options.readHostMemory ?? defaultReadHostMemory;

  let gpu: NvidiaSmiGpuReading | undefined;
  try {
    const raw = await runNvidiaSmi(NVIDIA_SMI_QUERY);
    if (typeof raw === "string" && raw.length > 0) {
      gpu = parseNvidiaSmiCsv(raw);
    }
  } catch {
    gpu = undefined;
  }

  const memory = safeReadMemory(readHostMemory);

  // No usable GPU telemetry ⇒ the snapshot is unavailable, full stop. RAM alone
  // is not enough to call the machine "measured" for GPU-scheduling purposes.
  if (!gpu || !gpu.anyFieldParsed) {
    return {
      observedAt,
      source: "unavailable",
      ...(memory ? { ramUsedGb: memory.usedGb, ramTotalGb: memory.totalGb } : {}),
      ...(gpu && gpu.abnormalSignals.length > 0
        ? { abnormalSignals: gpu.abnormalSignals }
        : {}),
    };
  }

  const activeInference =
    typeof gpu.gpuUtilizationPct === "number" ? gpu.gpuUtilizationPct >= 25 : undefined;

  return {
    observedAt,
    source: "measured",
    ...(gpu.gpuTempC !== undefined ? { gpuTempC: gpu.gpuTempC } : {}),
    ...(gpu.gpuUtilizationPct !== undefined ? { gpuUtilizationPct: gpu.gpuUtilizationPct } : {}),
    ...(gpu.gpuPowerW !== undefined ? { gpuPowerW: gpu.gpuPowerW } : {}),
    ...(gpu.vramUsedGb !== undefined ? { vramUsedGb: gpu.vramUsedGb } : {}),
    ...(gpu.vramTotalGb !== undefined ? { vramTotalGb: gpu.vramTotalGb } : {}),
    ...(activeInference !== undefined ? { activeInference } : {}),
    ...(memory ? { ramUsedGb: memory.usedGb, ramTotalGb: memory.totalGb } : {}),
    ...(gpu.abnormalSignals.length > 0 ? { abnormalSignals: gpu.abnormalSignals } : {}),
  };
}

function safeReadMemory(
  reader: () => { readonly usedGb: number; readonly totalGb: number } | undefined,
): { usedGb: number; totalGb: number } | undefined {
  try {
    const value = reader();
    if (!value) return undefined;
    if (!Number.isFinite(value.totalGb) || value.totalGb <= 0) return undefined;
    return { usedGb: value.usedGb, totalGb: value.totalGb };
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------------- *
 * A2000 60 °C hard stop (deterministic, checked alongside evaluateBrainSafety)
 * ------------------------------------------------------------------------- */

export interface BrainResourceHardStop {
  readonly tripped: boolean;
  readonly reason: string;
  readonly limitC: number;
}

/**
 * The A2000 hard stop. Returns `tripped: true` when the profile is the A2000 and
 * the measured GPU temperature is at/above {@link BRAIN_A2000_GPU_HARD_STOP_C}.
 * An unavailable/missing temperature does NOT trip it (the Safety Governor's
 * conservative path handles the unknown case) — but it also does not clear it.
 */
export function evaluateBrainResourceHardStop(
  snapshot: BrainResourceSnapshot,
  profile: Pick<BrainHardwareProfile, "id" | "label">,
): BrainResourceHardStop {
  const limitC = BRAIN_A2000_GPU_HARD_STOP_C;
  if (profile.id !== BRAIN_A2000_PROFILE_ID) {
    return { tripped: false, reason: `no hard stop configured for ${profile.id}`, limitC };
  }
  if (typeof snapshot.gpuTempC !== "number") {
    return {
      tripped: false,
      reason: `${profile.label}: GPU temperature not measured — cannot confirm below the ${limitC} °C hard stop`,
      limitC,
    };
  }
  if (snapshot.gpuTempC >= limitC) {
    return {
      tripped: true,
      reason: `${profile.label}: GPU ${snapshot.gpuTempC} °C ≥ ${limitC} °C hard stop — halt all GPU work`,
      limitC,
    };
  }
  return {
    tripped: false,
    reason: `${profile.label}: GPU ${snapshot.gpuTempC} °C < ${limitC} °C hard stop`,
    limitC,
  };
}
