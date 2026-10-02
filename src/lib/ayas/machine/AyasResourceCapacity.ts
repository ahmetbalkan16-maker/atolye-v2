import { AyasExecutionAuthorityLockError, withAyasExecutionAuthorityLock } from "../../brain/autonomy/AyasExecutionAuthorityLock";
import { evaluateAyasResourceAdmission, type AyasResourceContext, type AyasResourceDecision, type AyasResourceRequest } from "./AyasResourceGovernor";
import type { AyasMachineTelemetry } from "./AyasMachineTelemetry";
import { publishAyasResourceOccupancy, readAyasResourceOccupancy, type AyasOccupancyHandle } from "./AyasResourceOccupancy";
import path from "node:path";

/** Required host-owned common root; no live default or import-time write. All heavy callers must use the SAME root. */
export interface AyasResourceCapacityDeps {
  readonly hostCapacityRoot: string;
  readonly readCurrent: () => Promise<{ readonly telemetry: AyasMachineTelemetry; readonly context: AyasResourceContext; readonly nowMs: number; readonly maxRamAdmissionPercent: number }>;
}
export interface AyasResourceCapacityResult<T> { readonly decision: AyasResourceDecision; readonly executed: boolean; readonly result?: T; }
/** Holds the existing PID/start-time lock for the whole operation; an admission snapshot alone never reserves capacity. */
export async function withAyasResourceCapacity<T>(request: AyasResourceRequest, deps: AyasResourceCapacityDeps, operation: () => Promise<T>): Promise<AyasResourceCapacityResult<T>> {
  const read = async () => { const v = await deps.readCurrent(); return evaluateAyasResourceAdmission(v.telemetry, v.context, request, v.maxRamAdmissionPercent, v.nowMs); };
  const initial = await read();
  if (!initial.mayStart && !initial.mayContinue) return { decision: initial, executed: false };
  const heavy = ["HEAVY_LOCAL_AI", "MEDIA_RENDER", "MAINTENANCE"].includes(request.class);
  const held = (decision: AyasResourceDecision, reasonCode: string): AyasResourceCapacityResult<T> => ({ decision: { ...decision, action: "DEFER", reasonCode, mayStart: false, mayContinue: false, cancelPrewarm: true }, executed: false });
  const run = async (): Promise<AyasResourceCapacityResult<T>> => {
    const decision = await read(); // Fresh policy/pressure/occupancy after winning capacity.
    if (!decision.mayStart && !decision.mayContinue) return { decision, executed: false };
    if (!heavy) return { decision, executed: true, result: await operation() };
    // Stage 15Q.3: publish to the shared inventory, then look. Production publishes and looks the same way,
    // so a render stage and a heavy workload starting together cannot both miss each other.
    let occupancy: AyasOccupancyHandle;
    try { occupancy = await publishAyasResourceOccupancy(deps.hostCapacityRoot, { taskId: request.taskId, class: request.class, production: request.priority === "PRODUCTION" }); }
    catch { return held(decision, "RESOURCE_OCCUPANCY_UNPUBLISHED"); }
    try {
      const seen = await readAyasResourceOccupancy(deps.hostCapacityRoot);
      if (!seen) return held(decision, "RESOURCE_HEAVY_INVENTORY_UNKNOWN");
      if (seen.productionActive && request.priority !== "PRODUCTION") return held(decision, "RESOURCE_OWNER_OR_PRODUCTION_PRIORITY");
      return { decision, executed: true, result: await operation() };
    } finally { await occupancy.release().catch(() => undefined); }
  };
  if (!heavy) return run();
  if (typeof deps.hostCapacityRoot !== "string" || !path.isAbsolute(deps.hostCapacityRoot) || deps.hostCapacityRoot.startsWith("\\\\")) return { decision: { ...initial, action: "REQUIRE_OWNER", reasonCode: "RESOURCE_HOST_CAPACITY_ROOT_REQUIRED", mayStart: false, mayContinue: false, cancelPrewarm: true }, executed: false };
  let acquired = false;
  try { return await withAyasExecutionAuthorityLock(deps.hostCapacityRoot, async () => { acquired = true; return run(); }, { acquireRetryLimit: 0 }); }
  catch (error) {
    if (!acquired && error instanceof AyasExecutionAuthorityLockError && error.code === "AYAS_LOCK_BUSY") return { decision: { ...initial, action: "DEFER", reasonCode: "RESOURCE_CAPACITY_BUSY", mayStart: false, mayContinue: false, cancelPrewarm: true }, executed: false };
    throw error;
  }
}
