import assert from "node:assert/strict";
import { evaluateAyasMachineHealth } from "../src/lib/ayas/machine/AyasMachineHealthGuard";
import type { AyasMachineTelemetry } from "../src/lib/ayas/machine/AyasMachineTelemetry";
import type { ProductionStepKey } from "../src/types/project";

/**
 * `evaluateAyasMachineHealth`'s THROTTLE-on-missing-telemetry branch only
 * requires `gpuPercent` when `workload.stage` is GPU-likely
 * (`visuals`/`animation`/`video`/`assembly`) — every existing smoke test
 * exercises this function with `stage: "video"` only, so the other half of
 * that condition (a non-GPU stage with `gpuPercent` missing) has never been
 * asserted. A regression that dropped the `GPU_LIKELY.has(...)` guard
 * (throttling on missing GPU telemetry regardless of stage) would pass
 * every existing test silently.
 */
const base: AyasMachineTelemetry = { observedAt: "2026-09-16T00:00:00.000Z", cpuPercent: 20, gpuPercent: 10, ramUsedPercent: 30, vramUsedPercent: 20, diskFreePercent: 50, processRssMb: 100, unavailable: [] };
const NON_GPU_STAGES: readonly ProductionStepKey[] = ["research", "script", "scenes", "audio", "thumbnail", "seo", "youtube", "export"];
const GPU_STAGES: readonly ProductionStepKey[] = ["visuals", "animation", "video", "assembly"];

for (const stage of NON_GPU_STAGES) {
  const decision = evaluateAyasMachineHealth({ ...base, gpuPercent: undefined }, { stage, ownedActive: false });
  assert.equal(decision.action, "ALLOW", `stage "${stage}" is not GPU-likely — missing gpuPercent must not throttle it`);
  assert.equal(decision.mayStart, true, `stage "${stage}" must be allowed to start without GPU telemetry`);
}

for (const stage of GPU_STAGES) {
  const decision = evaluateAyasMachineHealth({ ...base, gpuPercent: undefined }, { stage, ownedActive: false });
  assert.equal(decision.action, "THROTTLE", `stage "${stage}" is GPU-likely — missing gpuPercent must still throttle it`);
  assert.equal(decision.reasonCode, "MACHINE_HEALTH_TELEMETRY_PARTIAL");
}

// The OTHER half of the same condition — missing cpuPercent — applies
// unconditionally, regardless of stage, and must still throttle a non-GPU
// stage too.
for (const stage of [...NON_GPU_STAGES, ...GPU_STAGES]) {
  const decision = evaluateAyasMachineHealth({ ...base, cpuPercent: undefined }, { stage, ownedActive: false });
  assert.equal(decision.action, "THROTTLE", `stage "${stage}" must still throttle on missing cpuPercent regardless of GPU-likeliness`);
}

console.log(JSON.stringify({ status: "PASS", suite: "ayas-machine-health-non-gpu-stage", scenarios: NON_GPU_STAGES.length * 2 + GPU_STAGES.length * 2 + (NON_GPU_STAGES.length + GPU_STAGES.length) }));
