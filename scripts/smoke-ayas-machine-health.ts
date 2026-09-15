import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluateAyasMachineHealth, type AyasMachineHealthAction } from "../src/lib/ayas/machine/AyasMachineHealthGuard";
import type { AyasMachineTelemetry } from "../src/lib/ayas/machine/AyasMachineTelemetry";

const base: AyasMachineTelemetry = { observedAt: "2026-09-15T00:00:00.000Z", cpuPercent: 20, gpuPercent: 10, ramUsedPercent: 30, vramUsedPercent: 20, diskFreePercent: 50, processRssMb: 100, ffmpegRunning: false, localModelRunning: true, unavailable: [] };
const action = (patch: Partial<AyasMachineTelemetry>, ownedActive = false): AyasMachineHealthAction => evaluateAyasMachineHealth({ ...base, ...patch }, { stage: "video", ownedActive }).action;
assert.equal(action({}), "ALLOW");
assert.equal(action({ cpuPercent: 92 }), "THROTTLE");
assert.equal(action({ cpuPercent: 99 }), "PAUSE");
assert.equal(action({ ramUsedPercent: 93 }), "PAUSE");
assert.equal(action({ vramUsedPercent: 95 }), "PAUSE");
assert.equal(action({ cpuPercent: 90 }), "THROTTLE");
assert.equal(action({ diskFreePercent: 2 }), "BLOCK NEW HEAVY WORK");
assert.equal(action({ diskFreePercent: 2 }, true), "STOP OWN WORKLOAD");
assert.equal(evaluateAyasMachineHealth({ ...base, cpuPercent: 99 }, { stage: "video", ownedActive: false }).mayStart, false);
assert.equal(evaluateAyasMachineHealth({ ...base, diskFreePercent: 2 }, { stage: "video", ownedActive: true }).mayStart, false);
assert.equal(action({ ramUsedPercent: undefined }), "BLOCK NEW HEAVY WORK");
assert.equal(action({ gpuPercent: undefined, unavailable: ["gpu"] }), "THROTTLE");

const canonical = fs.readFileSync("src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts", "utf8");
assert.match(canonical, /assertAyasHeavyWorkloadAllowed\(\{ stage: context\.stage, ownedActive: false \}\)/);
assert.match(canonical, /assertAyasHeavyWorkloadAllowed\(\{ stage: context\.stage, ownedActive: true \}\)/);
const healthRead = fs.readFileSync("src/lib/production/ProductionHealthService.ts", "utf8");
const readiness = fs.readFileSync("src/lib/production/ProductionReadinessService.ts", "utf8");
assert.doesNotMatch(healthRead + readiness, /AyasMachineHealthGuard|collectAyasMachineTelemetry/);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-machine-health", scenarios: 16 }));
