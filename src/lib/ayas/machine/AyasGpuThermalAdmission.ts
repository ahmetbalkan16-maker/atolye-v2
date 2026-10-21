import { readAyasGpuTemperatureC } from "./AyasMachineTelemetry";
import { A2000_GPU_HARD_STOP_C } from "../../brain/probe/GpuThermalPolicy";

/**
 * The owner's GPU hard stop (GpuThermalPolicy, 85 °C on the RTX A2000 since 2026-10-21) at the door of every Atölye production stage.
 *
 * It is the same rule the Brain worker and speech-to-text already obey (`evaluateBrainResourceHardStop` in
 * `src/lib/brain/probe/BrainResourceProbe.ts`): on the configured A2000 profile a measured temperature at or over the
 * limit holds GPU work. A production stage that would start on a hot card first waits for it to cool, reading the
 * temperature again every `pollMs`, for at most `maxWaitMs`. If it is still hot, the stage is not started. An
 * unreadable temperature does not hold, exactly as for speech-to-text; the RAM/CPU/disk/VRAM rules of the Machine
 * Health Guard still apply on their own.
 *
 * Read-only: one `nvidia-smi --query-gpu` through the machine telemetry module. Nothing is throttled, killed or
 * reconfigured. The profile id and the limit mirror the Brain probe's constants (a smoke asserts they stay equal); they
 * are not imported, so the production path reaches no new process-spawning module.
 */
export const AYAS_A2000_PROFILE_ID = "rtx-a2000-12gb";
export const AYAS_A2000_GPU_HARD_STOP_C = A2000_GPU_HARD_STOP_C;
/** Same variable as the Brain console's hardware profile. */
const HARDWARE_PROFILE_ENV = "ATOLYE_BRAIN_HARDWARE_PROFILE";

export interface AyasGpuThermalReading {
  readonly tripped: boolean;
  readonly reason: string;
}

export interface AyasGpuThermalAdmissionOptions {
  /** Whether to wait for the card to cool. Without it the temperature is read once. */
  readonly wait: boolean;
  readonly maxWaitMs?: number;
  readonly pollMs?: number;
  readonly read?: () => Promise<AyasGpuThermalReading>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

export interface AyasGpuThermalAdmission {
  readonly tripped: boolean;
  readonly reason: string;
  readonly waitedMs: number;
}

const DEFAULT_MAX_WAIT_MS = 10 * 60_000;
const DEFAULT_POLL_MS = 15_000;

/** `ATOLYE_GPU_THERMAL_MAX_WAIT_MS`: 0 to 30 minutes; anything else keeps the default. */
export function resolveAyasGpuThermalMaxWaitMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ATOLYE_GPU_THERMAL_MAX_WAIT_MS?.trim();
  if (!raw || !/^[0-9]+$/.test(raw)) return DEFAULT_MAX_WAIT_MS;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= 30 * 60_000 ? value : DEFAULT_MAX_WAIT_MS;
}

export async function readAyasGpuThermal(
  env: NodeJS.ProcessEnv = process.env,
  readTemperatureC: () => Promise<number | undefined> = () => readAyasGpuTemperatureC(),
): Promise<AyasGpuThermalReading> {
  const profile = env[HARDWARE_PROFILE_ENV]?.trim();
  // Only the A2000 profile has a hard stop; any other profile needs no GPU read at all.
  if (profile !== AYAS_A2000_PROFILE_ID) return { tripped: false, reason: `no GPU hard stop configured for ${profile || "the default profile"}` };
  const temperature = await readTemperatureC();
  if (temperature === undefined) return { tripped: false, reason: `GPU temperature not measured — cannot confirm below the ${AYAS_A2000_GPU_HARD_STOP_C} °C hard stop` };
  return temperature >= AYAS_A2000_GPU_HARD_STOP_C
    ? { tripped: true, reason: `GPU ${temperature} °C ≥ ${AYAS_A2000_GPU_HARD_STOP_C} °C hard stop` }
    : { tripped: false, reason: `GPU ${temperature} °C < ${AYAS_A2000_GPU_HARD_STOP_C} °C hard stop` };
}

export async function awaitAyasGpuThermalHeadroom(options: AyasGpuThermalAdmissionOptions): Promise<AyasGpuThermalAdmission> {
  const read = options.read ?? (() => readAyasGpuThermal());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const maxWaitMs = Math.max(0, options.maxWaitMs ?? resolveAyasGpuThermalMaxWaitMs());
  const pollMs = Math.max(1, options.pollMs ?? DEFAULT_POLL_MS);
  const started = now();
  let reading = await read();
  while (reading.tripped && options.wait && now() - started < maxWaitMs) {
    await sleep(Math.min(pollMs, Math.max(1, maxWaitMs - (now() - started))));
    reading = await read();
  }
  return { tripped: reading.tripped, reason: reading.reason, waitedMs: now() - started };
}
