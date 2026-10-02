import { AyasExecutionAuthorityLockError, withAyasExecutionAuthorityLock } from "../../brain/autonomy/AyasExecutionAuthorityLock";
import { evaluateAyasResourceAdmission, type AyasResourceContext, type AyasResourceDecision, type AyasResourceRequest } from "./AyasResourceGovernor";
import type { AyasMachineTelemetry } from "./AyasMachineTelemetry";
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
  const run = async (): Promise<AyasResourceCapacityResult<T>> => {
    const decision = await read(); // Fresh policy/pressure/occupancy after winning capacity.
    if (!decision.mayStart && !decision.mayContinue) return { decision, executed: false };
    return { decision, executed: true, result: await operation() };
  };
  if (!["HEAVY_LOCAL_AI", "MEDIA_RENDER", "MAINTENANCE"].includes(request.class)) return run();
  if (typeof deps.hostCapacityRoot !== "string" || !path.isAbsolute(deps.hostCapacityRoot) || deps.hostCapacityRoot.startsWith("\\\\")) return { decision: { ...initial, action: "REQUIRE_OWNER", reasonCode: "RESOURCE_HOST_CAPACITY_ROOT_REQUIRED", mayStart: false, mayContinue: false, cancelPrewarm: true }, executed: false };
  let acquired = false;
  try { return await withAyasExecutionAuthorityLock(deps.hostCapacityRoot, async () => { acquired = true; return run(); }, { acquireRetryLimit: 0 }); }
  catch (error) {
    if (!acquired && error instanceof AyasExecutionAuthorityLockError && error.code === "AYAS_LOCK_BUSY") return { decision: { ...initial, action: "DEFER", reasonCode: "RESOURCE_CAPACITY_BUSY", mayStart: false, mayContinue: false, cancelPrewarm: true }, executed: false };
    throw error;
  }
}
