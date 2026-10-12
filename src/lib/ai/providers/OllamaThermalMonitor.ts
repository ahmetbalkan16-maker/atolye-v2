import { AYAS_A2000_PROFILE_ID, readAyasGpuThermal, type AyasGpuThermalReading } from "../../ayas/machine/AyasGpuThermalAdmission";

export class OllamaThermalHardStopError extends Error {
  readonly code = "MACHINE_HEALTH_GPU_THERMAL_HARD_STOP";
  constructor() { super("GPU thermal hard stop interrupted this model request."); this.name = "OllamaThermalHardStopError"; this.stack = undefined; }
}

/** Test dependencies are internal; production uses the existing read-only sensor/profile policy. */
export interface OllamaThermalMonitorOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly read?: () => Promise<AyasGpuThermalReading>;
  readonly pollMs?: number;
}

export async function startOllamaThermalMonitor(controller: AbortController, options: OllamaThermalMonitorOptions = {}) {
  const env = options.environment ?? process.env;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failure: OllamaThermalHardStopError | undefined;
  const stop = () => { stopped = true; if (timer) clearTimeout(timer); };
  const monitor = { stop, get failure() { return failure; } };
  if (env.ATOLYE_BRAIN_HARDWARE_PROFILE?.trim() !== AYAS_A2000_PROFILE_ID) return monitor;
  const read = options.read ?? (() => readAyasGpuThermal(env));
  const pollMs = Math.max(1, Math.min(10000, options.pollMs ?? 2000));
  async function check() {
    const reading = await read();
    if (stopped) return;
    if (reading.tripped) {
      failure = new OllamaThermalHardStopError();
      stop(); controller.abort(failure);
      return;
    }
    // Keep the existing unknown-temperature policy; never invent a below-limit reading.
    timer = setTimeout(() => { void check().catch(() => stop()); }, pollMs);
  }
  await check();
  if (failure) throw failure;
  return monitor;
}
