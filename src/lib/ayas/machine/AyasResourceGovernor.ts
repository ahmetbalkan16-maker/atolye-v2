/** Stage15Q: resource admission only. Task/capability/owner authority is checked by the caller's existing gates. */
import { evaluateAyasMachineHealth } from "./AyasMachineHealthGuard";
import { collectAyasMachineTelemetry, type AyasMachineTelemetry } from "./AyasMachineTelemetry";
import { readAyasOwnerConstitution } from "../governance/AyasOwnerConstitutionReader";

export const AYAS_RESOURCE_CLASSES = ["INTERACTIVE", "LIGHT_BACKGROUND", "HEAVY_LOCAL_AI", "MEDIA_RENDER", "MAINTENANCE"] as const;
export type AyasResourceClass = (typeof AYAS_RESOURCE_CLASSES)[number];
export interface AyasResourceRequest {
  readonly taskId: string; readonly class: AyasResourceClass; readonly ownedActive: boolean;
  readonly priority: "OWNER_INTERACTIVE" | "PRODUCTION" | "BACKGROUND";
  readonly requiresGpu: boolean; readonly peakMemoryMb: number | null;
  readonly prewarm: boolean; readonly measuredPrewarmBenefitMs: number | null;
}
/** Host/controller observations, never model/tool-supplied policy. null means UNKNOWN, including an incomplete inventory. */
export interface AyasResourceContext {
  readonly ownerInteractive: boolean | null; readonly productionActive: boolean | null;
  readonly heavyWorkloads: readonly { readonly taskId: string; readonly class: AyasResourceClass; readonly state: "RUNNING" | "UNCERTAIN" }[] | null;
  readonly queueDepth: number | null; readonly modelFootprintMb: number | null;
  readonly thermalState: "NORMAL" | "CRITICAL" | "UNKNOWN";
  readonly hostProtection: "NORMAL" | "OOM" | "SWAP_THRASHING" | "RESPONSIVENESS_LOSS" | "UNKNOWN";
  readonly hardwareFingerprint: string | null; readonly benchmarkedFingerprint: string | null;
}
export interface AyasResourceDecision {
  readonly action: "ALLOW" | "DEFER" | "RESOURCE_ABORT" | "REQUIRE_OWNER";
  readonly reasonCode: string; readonly class: AyasResourceClass; readonly authority: "NONE";
  readonly mayStart: boolean; readonly mayContinue: boolean; readonly stopOwnWorkload: boolean;
  readonly cancelPrewarm: boolean; readonly throttle: boolean; readonly preserveTask: true;
  readonly modelQualityFailure: false; readonly pressureClass: "HOST_PROTECTION" | "ADMISSION";
  readonly observed: { readonly queueDepth: number | null; readonly modelFootprintMb: number | null; readonly thermalState: AyasResourceContext["thermalState"] };
}
const heavy = (c: AyasResourceClass) => c === "HEAVY_LOCAL_AI" || c === "MEDIA_RENDER" || c === "MAINTENANCE";
const id = (s: unknown): s is string => typeof s === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(s);
const number = (n: unknown, max = Number.MAX_SAFE_INTEGER): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max;
const optional = (n: unknown) => n === null || number(n);
const bool = (b: unknown) => b === null || typeof b === "boolean";
function valid(request: AyasResourceRequest, context: AyasResourceContext) {
  return !!request && !!context && id(request.taskId) && AYAS_RESOURCE_CLASSES.includes(request.class)
    && typeof request.ownedActive === "boolean" && typeof request.requiresGpu === "boolean" && typeof request.prewarm === "boolean"
    && ["OWNER_INTERACTIVE", "PRODUCTION", "BACKGROUND"].includes(request.priority) && optional(request.peakMemoryMb) && optional(request.measuredPrewarmBenefitMs)
    && bool(context.ownerInteractive) && bool(context.productionActive) && (context.queueDepth === null || Number.isSafeInteger(context.queueDepth) && context.queueDepth >= 0) && optional(context.modelFootprintMb)
    && ["NORMAL", "CRITICAL", "UNKNOWN"].includes(context.thermalState)
    && ["NORMAL", "OOM", "SWAP_THRASHING", "RESPONSIVENESS_LOSS", "UNKNOWN"].includes(context.hostProtection)
    && [context.hardwareFingerprint, context.benchmarkedFingerprint].every(v => v === null || (typeof v === "string" && /^[a-f0-9]{64}$/.test(v)))
    && (context.heavyWorkloads === null || (Array.isArray(context.heavyWorkloads) && context.heavyWorkloads.length <= 1000
      && Array.from(context.heavyWorkloads).every(w => w && id(w.taskId) && heavy(w.class) && ["RUNNING", "UNCERTAIN"].includes(w.state))
      && new Set(context.heavyWorkloads.map(w => w.taskId)).size === context.heavyWorkloads.length));
}

export function evaluateAyasResourceAdmission(telemetry: AyasMachineTelemetry, context: AyasResourceContext, request: AyasResourceRequest, maxRamAdmissionPercent = 90, nowMs = Date.now()): AyasResourceDecision {
  const safeContext = context ?? { queueDepth: null, modelFootprintMb: null, thermalState: "UNKNOWN" as const };
  let throttle = false;
  let cancelPrewarm = context?.ownerInteractive === true || context?.productionActive === true;
  const decide = (action: AyasResourceDecision["action"], reasonCode: string): AyasResourceDecision => Object.freeze({
    action, reasonCode, class: AYAS_RESOURCE_CLASSES.includes(request?.class) ? request.class : "HEAVY_LOCAL_AI", authority: "NONE",
    mayStart: action === "ALLOW" && request?.ownedActive === false, mayContinue: action === "ALLOW" && request?.ownedActive === true,
    stopOwnWorkload: action === "RESOURCE_ABORT" && request?.ownedActive === true, cancelPrewarm: cancelPrewarm || action !== "ALLOW", throttle,
    preserveTask: true, modelQualityFailure: false, pressureClass: action === "RESOURCE_ABORT" ? "HOST_PROTECTION" : "ADMISSION",
    observed: Object.freeze({ queueDepth: safeContext.queueDepth, modelFootprintMb: safeContext.modelFootprintMb, thermalState: safeContext.thermalState }),
  });
  if (!valid(request, context) || !telemetry || !Number.isFinite(nowMs) || !Number.isSafeInteger(maxRamAdmissionPercent) || maxRamAdmissionPercent < 1 || maxRamAdmissionPercent > 99) return decide("REQUIRE_OWNER", "RESOURCE_INPUT_OR_POLICY_INVALID");
  if (context.hostProtection !== "NORMAL" && context.hostProtection !== "UNKNOWN" || context.thermalState === "CRITICAL") return decide("RESOURCE_ABORT", "RESOURCE_HOST_PROTECTION");
  for (const value of [telemetry.cpuPercent, telemetry.gpuPercent, telemetry.ramUsedPercent, telemetry.vramUsedPercent, telemetry.diskFreePercent]) {
    if (value !== undefined && !number(value, 100)) return decide("DEFER", "RESOURCE_SENSOR_INVALID");
  }
  const age = nowMs - Date.parse(telemetry.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 30_000) return decide("DEFER", "RESOURCE_SNAPSHOT_NOT_CURRENT");
  if (request.class === "INTERACTIVE" && !request.prewarm) return decide("ALLOW", "RESOURCE_OWNER_INTERACTION_PRIORITY");
  const health = evaluateAyasMachineHealth(telemetry, { stage: request.requiresGpu ? "video" : "script", ownedActive: request.ownedActive }, maxRamAdmissionPercent);
  if (health.reasonCode === "MACHINE_HEALTH_CRITICAL_PRESSURE") return decide("RESOURCE_ABORT", "RESOURCE_HOST_PROTECTION");
  throttle = health.action === "THROTTLE";
  cancelPrewarm ||= health.action !== "ALLOW";
  if (health.action !== "ALLOW" && health.action !== "THROTTLE") return decide("DEFER", health.reasonCode);
  if (!heavy(request.class)) return decide("ALLOW", health.reasonCode);
  // Occupancy checks are advisory snapshots; the common host capacity lock must serialize the actual starts.
  if (context.heavyWorkloads === null) return decide("DEFER", "RESOURCE_HEAVY_INVENTORY_UNKNOWN");
  if (context.heavyWorkloads.some(w => w.state === "UNCERTAIN")) return decide("DEFER", "RESOURCE_UNCERTAIN_DEPENDENCY");
  if (context.heavyWorkloads.some(w => w.taskId !== request.taskId)) return decide("DEFER", "RESOURCE_ONE_HEAVY_AT_A_TIME");
  if (!request.ownedActive && context.heavyWorkloads.some(w => w.taskId === request.taskId)) return decide("DEFER", "RESOURCE_TASK_ALREADY_ACTIVE");
  if (request.ownedActive && !context.heavyWorkloads.some(w => w.taskId === request.taskId && w.class === request.class)) return decide("DEFER", "RESOURCE_ACTIVE_OWNERSHIP_UNPROVEN");
  if (request.prewarm && cancelPrewarm) return decide("DEFER", "RESOURCE_PREWARM_UNPROVEN_OR_CANCELLED");
  if (context.ownerInteractive && request.priority === "BACKGROUND" || context.productionActive && request.priority !== "PRODUCTION") return decide("DEFER", "RESOURCE_OWNER_OR_PRODUCTION_PRIORITY");
  if (request.ownedActive) return decide("ALLOW", health.reasonCode); // 90% is admission, not a kill switch for a safe active task.
  if (telemetry.ffmpegRunning !== false) return decide("DEFER", "RESOURCE_EXTERNAL_RENDER_OR_INVENTORY_UNKNOWN");
  if ((context.modelFootprintMb ?? 0) > 0 || (telemetry.localModelRunning !== false && context.modelFootprintMb === null)) return decide("DEFER", "RESOURCE_EXTERNAL_MODEL_OR_FOOTPRINT_UNKNOWN");
  if (context.hardwareFingerprint && context.benchmarkedFingerprint && context.hardwareFingerprint !== context.benchmarkedFingerprint) return decide("DEFER", "RESOURCE_HARDWARE_RECALIBRATION_REQUIRED");
  if (context.ownerInteractive === null || context.productionActive === null || context.hostProtection === "UNKNOWN") return decide("DEFER", "RESOURCE_PRIORITY_OR_HOST_STATE_UNKNOWN");
  if (telemetry.cpuPercent === undefined || request.requiresGpu && (telemetry.gpuPercent === undefined || telemetry.vramUsedPercent === undefined)) return decide("DEFER", "RESOURCE_REQUIRED_SENSOR_UNKNOWN");
  if (request.peakMemoryMb === null || !number(telemetry.totalRamBytes) || telemetry.totalRamBytes === 0 || !number(telemetry.freeRamBytes) || telemetry.freeRamBytes > telemetry.totalRamBytes) return decide("DEFER", "RESOURCE_PROJECTED_MEMORY_UNKNOWN");
  if (request.peakMemoryMb * 1024 * 1024 >= telemetry.freeRamBytes - Math.ceil(telemetry.totalRamBytes * (100 - maxRamAdmissionPercent) / 100)) return decide("DEFER", "RESOURCE_PROJECTED_RAM_LIMIT");
  if (request.prewarm && (cancelPrewarm || request.measuredPrewarmBenefitMs === null || request.measuredPrewarmBenefitMs <= 0 || context.thermalState === "UNKNOWN")) return decide("DEFER", "RESOURCE_PREWARM_UNPROVEN_OR_CANCELLED");
  return decide("ALLOW", health.reasonCode);
}

/** Read-only host guard through the existing telemetry and owner constitution; no runtime starts here. */
export async function guardAyasResourceWorkload(context: AyasResourceContext, request: AyasResourceRequest): Promise<AyasResourceDecision> {
  const policy = readAyasOwnerConstitution(process.cwd());
  const telemetry = await collectAyasMachineTelemetry();
  return evaluateAyasResourceAdmission(telemetry, context, request, policy.state === "ACTIVE" ? policy.policy.rules.maxRamAdmissionPercent : policy.state === "MISSING" ? 90 : NaN);
}
