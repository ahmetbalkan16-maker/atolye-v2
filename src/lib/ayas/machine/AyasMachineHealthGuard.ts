import type { ProductionStepKey } from "@/types/project";
import { collectAyasMachineTelemetry, type AyasMachineTelemetry } from "./AyasMachineTelemetry";

export type AyasMachineHealthAction = "ALLOW" | "THROTTLE" | "PAUSE" | "STOP OWN WORKLOAD" | "BLOCK NEW HEAVY WORK";
export interface AyasMachineHealthDecision { readonly action: AyasMachineHealthAction; readonly reasonCode: string; readonly telemetry: AyasMachineTelemetry; readonly mayStart: boolean; }
export interface AyasMachineWorkload { readonly stage: ProductionStepKey; readonly ownedActive: boolean; }

const GPU_LIKELY = new Set<ProductionStepKey>(["visuals", "animation", "video", "assembly"]);

export function evaluateAyasMachineHealth(telemetry: AyasMachineTelemetry, workload: AyasMachineWorkload): AyasMachineHealthDecision {
  const decide = (action: AyasMachineHealthAction, reasonCode: string): AyasMachineHealthDecision => Object.freeze({ action, reasonCode, telemetry, mayStart: action === "ALLOW" || action === "THROTTLE" });
  if (telemetry.diskFreePercent === undefined || telemetry.ramUsedPercent === undefined) return decide("BLOCK NEW HEAVY WORK", "MACHINE_HEALTH_CORE_TELEMETRY_UNAVAILABLE");
  if (telemetry.diskFreePercent < 3 || telemetry.ramUsedPercent >= 97 || (telemetry.vramUsedPercent ?? 0) >= 99) return decide(workload.ownedActive ? "STOP OWN WORKLOAD" : "BLOCK NEW HEAVY WORK", "MACHINE_HEALTH_CRITICAL_PRESSURE");
  if ((telemetry.cpuPercent ?? 0) >= 99 || telemetry.ramUsedPercent >= 93 || (telemetry.vramUsedPercent ?? 0) >= 95) return decide("PAUSE", "MACHINE_HEALTH_HIGH_PRESSURE");
  if (telemetry.cpuPercent === undefined || (GPU_LIKELY.has(workload.stage) && telemetry.gpuPercent === undefined)) return decide("THROTTLE", "MACHINE_HEALTH_TELEMETRY_PARTIAL");
  if (telemetry.cpuPercent >= 90 || telemetry.ramUsedPercent >= 85 || (telemetry.vramUsedPercent ?? 0) >= 85 || telemetry.diskFreePercent < 8) return decide("THROTTLE", "MACHINE_HEALTH_ELEVATED_PRESSURE");
  return decide("ALLOW", "MACHINE_HEALTH_NOMINAL");
}

export async function guardAyasHeavyWorkload(workload: AyasMachineWorkload): Promise<AyasMachineHealthDecision> {
  return evaluateAyasMachineHealth(await collectAyasMachineTelemetry(), workload);
}

export class AyasMachineHealthBlockedError extends Error {
  readonly code: string;
  constructor(readonly decision: AyasMachineHealthDecision) { super("Machine Health Guard blocked heavy workload admission."); this.name = "AyasMachineHealthBlockedError"; this.code = decision.reasonCode; this.stack = undefined; }
}

export async function assertAyasHeavyWorkloadAllowed(workload: AyasMachineWorkload): Promise<AyasMachineHealthDecision> {
  const decision = await guardAyasHeavyWorkload(workload);
  if (!decision.mayStart) throw new AyasMachineHealthBlockedError(decision);
  return decision;
}
