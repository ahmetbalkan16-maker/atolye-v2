import assert from "node:assert/strict";
import { createProductionRuntimeHealthResponse } from "../src/lib/runtime/ProductionRuntimeHealthResponse";
import type { ProductionRuntimeStatus } from "../src/types/productionRuntimeStatus";

const observedAt = "2026-10-05T12:00:00.000Z";
const healthy: ProductionRuntimeStatus = Object.freeze({
  schemaVersion: "1", writeFree: true, lifecycleState: "ready", activeExecutionCount: 0,
  acceptingExecutions: true, initialized: true, recoveryCompleted: true, workerReady: true,
  draining: false, startupTimestamp: observedAt, lastStateTransitionTimestamp: observedAt,
  initializationFailure: null,
});

function responseFor(dependencies: Parameters<typeof createProductionRuntimeHealthResponse>[0]) {
  let response: ReturnType<typeof createProductionRuntimeHealthResponse> | undefined;
  assert.doesNotThrow(() => { response = createProductionRuntimeHealthResponse(dependencies); });
  assert.ok(response);
  return response;
}

async function main() {
  let scenarios = 0;
  const invalid: readonly [string, Readonly<Record<string, unknown>>][] = [
    ["schema", { schemaVersion: "2" }],
    ["write boundary", { writeFree: false }],
    ["negative execution count", { activeExecutionCount: -1 }],
    ["fractional execution count", { activeExecutionCount: 0.5 }],
    ["nonfinite execution count", { activeExecutionCount: Number.NaN }],
    ["acceptance mismatch", { acceptingExecutions: false }],
    ["initialization mismatch", { initialized: false }],
    ["recovery mismatch", { recoveryCompleted: false }],
    ["worker mismatch", { workerReady: false }],
    ["draining mismatch", { draining: true }],
    ["unknown lifecycle", { lifecycleState: "unknown" }],
    ["noncanonical timestamp", { startupTimestamp: "2026-10-05" }],
    ["invalid transition timestamp", { lastStateTransitionTimestamp: "invalid" }],
    ["unexpected failure on ready", { initializationFailure: { reasonCode: "FIXTURE_FAILURE" } }],
    ["extra failure payload", { lifecycleState: "failed", acceptingExecutions: false,
      workerReady: false, initializationFailure: { reasonCode: "FIXTURE_FAILURE", raw: "synthetic-private-payload" } }],
    ["unsafe failure code", { lifecycleState: "failed", acceptingExecutions: false,
      workerReady: false, initializationFailure: { reasonCode: "unsafe fixture text" } }],
    ["unsafe project identity", { lifecycleState: "failed", acceptingExecutions: false,
      workerReady: false, initializationFailure: { reasonCode: "FIXTURE_FAILURE", failedProjectSlug: "../outside" } }],
  ];
  for (const [name, patch] of invalid) {
    const response = responseFor({
      getRuntimeStatus: () => ({ ...healthy, ...patch }) as ProductionRuntimeStatus,
      now: () => observedAt,
    });
    assert.equal(response.status, 503, name);
    assert.equal(response.headers.get("Cache-Control"), "no-store", name);
    assert.deepEqual(await response.json(), { schemaVersion: "1", status: "unavailable",
      ready: false, acceptingExecutions: false, runtime: null, observedAt }, name);
    scenarios++;
  }
  for (const kind of ["reader", "clock"] as const) {
    const response = responseFor({
      getRuntimeStatus: () => { if (kind === "reader") throw Error("synthetic-private-payload"); return healthy; },
      now: () => { if (kind === "clock") throw Error("synthetic-private-payload"); return observedAt; },
    });
    const body = await response.json();
    assert.equal(response.status, kind === "reader" ? 503 : 200);
    assert.ok(!JSON.stringify(body).includes("synthetic-private-payload"));
    assert.equal(new Date(Date.parse(body.observedAt)).toISOString(), body.observedAt);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    scenarios++;
  }
  const response = responseFor({ getRuntimeStatus: () => healthy, now: () => observedAt });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual((await response.json()).runtime, healthy);
  scenarios++;
  assert.equal(scenarios, 20);
  console.log(JSON.stringify({ status: "PASS", suite: "production-runtime-health-response",
    scenarios, fixture: "SYNTHETIC_SNAPSHOT_NO_LIVE_RUNTIME_OR_AUTHORITY" }));
}
void main();
