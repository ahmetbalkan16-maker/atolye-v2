import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createProductionRuntimeHealthResponse, GET } from "../app/api/runtime/health/route";
import type { ProductionRuntimeHealthResponse } from "../src/types/productionRuntimeHealth";
import type { ProductionRuntimeStatus } from "../src/types/productionRuntimeStatus";

const observedAt = "2026-07-13T16:00:00.000Z";

function runtimeStatus(
  lifecycleState: ProductionRuntimeStatus["lifecycleState"],
  overrides: Partial<ProductionRuntimeStatus> = {},
): ProductionRuntimeStatus {
  const ready = lifecycleState === "ready";
  const initialized = ready || lifecycleState === "draining" || lifecycleState === "stopped";
  return Object.freeze({
    schemaVersion: "1",
    writeFree: true,
    lifecycleState,
    activeExecutionCount: 0,
    acceptingExecutions: ready,
    initialized,
    recoveryCompleted: initialized,
    workerReady: ready,
    draining: lifecycleState === "draining",
    startupTimestamp: initialized ? "2026-07-13T15:00:00.000Z" : null,
    lastStateTransitionTimestamp: "2026-07-13T15:30:00.000Z",
    initializationFailure: null,
    ...overrides,
  });
}

async function readResponse(
  status: ProductionRuntimeStatus,
): Promise<{ response: Response; body: ProductionRuntimeHealthResponse }> {
  const response = createProductionRuntimeHealthResponse({
    getRuntimeStatus: () => status,
    now: () => observedAt,
  });
  return { response, body: (await response.json()) as ProductionRuntimeHealthResponse };
}

async function main() {
  let scenarios = 0;
  const scenario = async (name: string, run: () => unknown | Promise<unknown>) => {
    await run();
    scenarios++;
    void name;
  };

  await scenario("healthy runtime returns 200", async () => {
    const runtime = runtimeStatus("ready");
    const { response, body } = await readResponse(runtime);
    assert.equal(response.status, 200);
    assert.equal(body.status, "healthy");
    assert.equal(body.ready, true);
    assert.equal(body.acceptingExecutions, true);
    assert.deepEqual(body.runtime, runtime);
  });

  await scenario("created runtime returns starting 503", async () => {
    const { response, body } = await readResponse(runtimeStatus("created"));
    assert.equal(response.status, 503);
    assert.equal(body.status, "starting");
    assert.equal(body.ready, false);
    assert.equal(body.acceptingExecutions, false);
  });

  await scenario("starting runtime returns starting 503", async () => {
    const { response, body } = await readResponse(runtimeStatus("starting"));
    assert.equal(response.status, 503);
    assert.equal(body.status, "starting");
  });

  await scenario("draining runtime preserves active execution count", async () => {
    const runtime = runtimeStatus("draining", { activeExecutionCount: 3 });
    const { response, body } = await readResponse(runtime);
    assert.equal(response.status, 503);
    assert.equal(body.status, "draining");
    assert.equal(body.runtime?.activeExecutionCount, 3);
    assert.equal(body.runtime?.draining, true);
    assert.equal(body.acceptingExecutions, false);
  });

  await scenario("stopped runtime returns stopped 503", async () => {
    const { response, body } = await readResponse(runtimeStatus("stopped"));
    assert.equal(response.status, 503);
    assert.equal(body.status, "stopped");
  });

  await scenario("failed runtime exposes only normalized failure", async () => {
    const runtime = runtimeStatus("failed", {
      startupTimestamp: "2026-07-13T15:00:00.000Z",
      initializationFailure: Object.freeze({
        reasonCode: "RUNTIME_BOOTSTRAP_FAILED",
        failedProjectSlug: "safe-project",
      }),
    });
    const { response, body } = await readResponse(runtime);
    assert.equal(response.status, 503);
    assert.equal(body.status, "failed");
    assert.deepEqual(body.runtime?.initializationFailure, {
      reasonCode: "RUNTIME_BOOTSTRAP_FAILED",
      failedProjectSlug: "safe-project",
    });
    const serialized = JSON.stringify(body);
    assert.equal(serialized.toLowerCase().includes("stack"), false);
    assert.equal(serialized.toLowerCase().includes("cause"), false);
    assert.equal(serialized.includes("C:\\private"), false);
    assert.deepEqual(Object.keys(body.runtime?.initializationFailure ?? {}).sort(), [
      "failedProjectSlug",
      "reasonCode",
    ]);
  });

  await scenario("getter exception returns safe unavailable 503", async () => {
    const response = createProductionRuntimeHealthResponse({
      getRuntimeStatus: () => {
        throw new Error("raw secret at C:\\private\\runtime.json", {
          cause: new Error("raw cause"),
        });
      },
      now: () => observedAt,
    });
    const body = (await response.json()) as ProductionRuntimeHealthResponse;
    assert.equal(response.status, 503);
    assert.deepEqual(body, {
      schemaVersion: "1",
      status: "unavailable",
      ready: false,
      acceptingExecutions: false,
      runtime: null,
      observedAt,
    });
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("raw secret"), false);
    assert.equal(serialized.toLowerCase().includes("stack"), false);
    assert.equal(serialized.toLowerCase().includes("cause"), false);
    assert.equal(serialized.includes("C:\\private"), false);
  });

  const inconsistentSnapshots: readonly { name: string; snapshot: ProductionRuntimeStatus }[] = [
    {
      name: "initialized without completed recovery",
      snapshot: runtimeStatus("starting", { initialized: true, recoveryCompleted: false }),
    },
    {
      name: "completed recovery without initialization",
      snapshot: runtimeStatus("starting", { initialized: false, recoveryCompleted: true }),
    },
    {
      name: "worker ready without initialization",
      snapshot: runtimeStatus("starting", { workerReady: true, initialized: false, recoveryCompleted: false }),
    },
    {
      name: "worker ready without completed recovery",
      snapshot: runtimeStatus("starting", { workerReady: true, initialized: true, recoveryCompleted: false }),
    },
    {
      name: "execution acceptance outside ready lifecycle",
      snapshot: runtimeStatus("starting", { acceptingExecutions: true }),
    },
    {
      name: "draining flag outside draining lifecycle",
      snapshot: runtimeStatus("stopped", { draining: true }),
    },
    {
      name: "draining lifecycle without draining flag",
      snapshot: runtimeStatus("draining", { draining: false }),
    },
    {
      name: "failure details outside failed lifecycle",
      snapshot: runtimeStatus("starting", {
        initializationFailure: Object.freeze({ reasonCode: "RUNTIME_BOOTSTRAP_FAILED" }),
      }),
    },
    {
      name: "failed lifecycle without normalized failure",
      snapshot: runtimeStatus("failed"),
    },
    {
      name: "unknown lifecycle",
      snapshot: runtimeStatus("created", {
        lifecycleState: "unknown" as ProductionRuntimeStatus["lifecycleState"],
      }),
    },
    {
      name: "ready lifecycle without execution acceptance",
      snapshot: runtimeStatus("ready", { acceptingExecutions: false }),
    },
    {
      name: "ready lifecycle without worker readiness",
      snapshot: runtimeStatus("ready", { workerReady: false }),
    },
  ];

  for (const inconsistency of inconsistentSnapshots) {
    await scenario(`readiness inconsistency fails closed: ${inconsistency.name}`, async () => {
      const { response, body } = await readResponse(inconsistency.snapshot);
      assert.equal(response.status, 503);
      assert.deepEqual(body, {
        schemaVersion: "1",
        status: "unavailable",
        ready: false,
        acceptingExecutions: false,
        runtime: null,
        observedAt,
      });
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
    });
  }

  await scenario("responses disable caching and use JSON", async () => {
    const { response } = await readResponse(runtimeStatus("ready"));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
  });

  await scenario("schema version and observation timestamp are stable", async () => {
    const { body } = await readResponse(runtimeStatus("created"));
    assert.equal(body.schemaVersion, "1");
    assert.equal(body.observedAt, observedAt);
    assert.equal(body.runtime?.startupTimestamp, null);
  });

  await scenario("repeated calls are write free and do not mutate snapshot", async () => {
    const snapshot = runtimeStatus("draining", { activeExecutionCount: 2 });
    const before = JSON.stringify(snapshot);
    let reads = 0;
    const dependencies = {
      getRuntimeStatus: () => {
        reads++;
        return snapshot;
      },
      now: () => observedAt,
    };
    const first = createProductionRuntimeHealthResponse(dependencies);
    const second = createProductionRuntimeHealthResponse(dependencies);
    assert.deepEqual(await first.json(), await second.json());
    assert.equal(reads, 2);
    assert.equal(JSON.stringify(snapshot), before);
    assert.equal(snapshot.activeExecutionCount, 2);
  });

  await scenario("production GET uses the same read-only handler path", async () => {
    const firstResponse = GET();
    const firstBody = (await firstResponse.json()) as ProductionRuntimeHealthResponse;
    const secondResponse = GET();
    const secondBody = (await secondResponse.json()) as ProductionRuntimeHealthResponse;
    assert.equal(firstResponse.status, 503);
    assert.equal(firstBody.status, "starting");
    assert.equal(firstBody.runtime?.lifecycleState, "created");
    assert.equal(firstBody.runtime?.startupTimestamp, null);
    assert.equal(secondBody.status, "starting");
    assert.deepEqual(secondBody.runtime, firstBody.runtime);
    assert.equal(firstResponse.headers.get("cache-control"), "no-store");
    assert.match(firstResponse.headers.get("content-type") ?? "", /^application\/json\b/);
  });

  await scenario("route is a narrow server-side projection boundary", async () => {
    const source = await fs.readFile("app/api/runtime/health/route.ts", "utf8");
    assert.match(source, /export const runtime = "nodejs"/);
    assert.match(source, /export const dynamic = "force-dynamic"/);
    assert.match(source, /export const revalidate = 0/);
    assert.match(source, /getRuntimeStatus: getProductionRuntimeStatus/);
    const getBody = source.slice(source.indexOf("export function GET"), source.indexOf("function projectHealthStatus"));
    assert.match(getBody, /return createProductionRuntimeHealthResponse\(productionDependencies\)/);
    assert.ok(!/initializeProductionProcessRuntime|\.initialize\(|bootstrapRecovery|\.execute\(|\.write\(|persist|schedule|new Production/.test(source));
  });

  assert.equal(scenarios, 24);
  console.log(`Sprint 112 production runtime health API smoke: PASS (${scenarios}/24 scenarios)`);
}

void main();
