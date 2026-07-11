import assert from "node:assert/strict";
import {
  getProductionHealth,
  isProductionHealthApiConsumerError,
} from "../src/lib/production/ProductionHealthApiClient";
import { ProductionHealthService } from "../src/lib/production/ProductionHealthService";
import type { ProductionHealthReport } from "../src/lib/production/ProductionHealthService";

const slug = "sprint-95-6-consumer";
const evaluatedAt = "2026-07-11T18:00:00.000Z";

async function main() {
  const baseReport = await ProductionHealthService.getProductionHealth({
    projectSlug: slug,
    evaluatedAt,
  });
  const requestOptions = (report: ProductionHealthReport) => ({
    fetchImpl: createJsonFetch({ success: true, data: report }),
  });

  const success = await getProductionHealth(slug, requestOptions(baseReport));
  assert.deepEqual(success, baseReport);

  for (const status of ["warning", "critical", "unknown"] as const) {
    const report = cloneReport(baseReport);
    report.health.status = status;
    const result = await getProductionHealth(slug, requestOptions(report));
    assert.equal(result.health.status, status);
  }

  await assertConsumerError(
    getProductionHealth("..", requestOptions(baseReport)),
    "invalid_slug",
    "Invalid project slug.",
  );

  await assertConsumerError(
    getProductionHealth(slug, {
      fetchImpl: createJsonFetch(
        {
          success: false,
          error: {
            code: "INVALID_PROJECT_SLUG",
            message: "internal server wording must not escape",
          },
        },
        400,
      ),
    }),
    "invalid_slug",
    "Invalid project slug.",
  );

  await assertConsumerError(
    getProductionHealth(slug, {
      fetchImpl: createJsonFetch(
        {
          success: false,
          error: {
            code: "SNAPSHOT_BUILD_FAILED",
            message: "secret path C:\\projects\\private",
          },
        },
        500,
      ),
    }),
    "api_error",
    "Production health could not be read.",
  );

  await assertConsumerError(
    getProductionHealth(slug, {
      fetchImpl: rejectingFetch(new Error("network secret")),
    }),
    "network_error",
    "Production health request failed.",
  );

  await assertConsumerError(
    getProductionHealth(slug, {
      fetchImpl: abortablePendingFetch(),
      timeoutMs: 5,
    }),
    "timeout",
    "Production health request timed out.",
  );

  const externalAbort = new AbortController();
  const abortedRequest = getProductionHealth(slug, {
    fetchImpl: abortablePendingFetch(),
    signal: externalAbort.signal,
    timeoutMs: 1000,
  });
  externalAbort.abort();
  await assertConsumerError(
    abortedRequest,
    "aborted",
    "Production health request was cancelled.",
  );

  await assertConsumerError(
    getProductionHealth(slug, {
      fetchImpl: responseFetch(new Response("not-json", { status: 200 })),
    }),
    "malformed_response",
    "Production health response was invalid.",
  );

  await assertConsumerError(
    getProductionHealth(slug, {
      fetchImpl: createJsonFetch({ success: true, data: { unexpected: true } }),
    }),
    "malformed_response",
    "Production health response was invalid.",
  );

  await assertConsumerError(
    getProductionHealth(slug, {
      fetchImpl: createJsonFetch({ success: true }),
    }),
    "malformed_response",
    "Production health response was invalid.",
  );

  let capturedCache: RequestCache | undefined;
  let capturedMethod: string | undefined;
  const captureFetch = (async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    capturedCache = init?.cache;
    capturedMethod = init?.method;
    return jsonResponse({ success: true, data: baseReport });
  }) as typeof fetch;
  await getProductionHealth(slug, { fetchImpl: captureFetch });
  assert.equal(capturedCache, "no-store");
  assert.equal(capturedMethod, "GET");

  const deterministicOne = await getProductionHealth(
    slug,
    requestOptions(baseReport),
  );
  const deterministicTwo = await getProductionHealth(
    slug,
    requestOptions(baseReport),
  );
  assert.deepEqual(deterministicOne, deterministicTwo);
  assert.deepEqual(deterministicOne.health.findings, baseReport.health.findings);

  console.log(
    "Sprint 95.6 production health API consumer smoke: PASS (15 scenarios)",
  );
}

async function assertConsumerError(
  promise: Promise<unknown>,
  kind: string,
  message: string,
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(isProductionHealthApiConsumerError(error));
    assert.equal(error.kind, kind);
    assert.equal(error.message, message);
    assert.ok(!error.message.includes("secret"));
    assert.ok(!error.message.includes("C:\\"));
    return true;
  });
}

function createJsonFetch(body: unknown, status = 200): typeof fetch {
  return responseFetch(jsonResponse(body, status));
}

function responseFetch(response: Response): typeof fetch {
  return (async () => response.clone()) as typeof fetch;
}

function rejectingFetch(error: Error): typeof fetch {
  return (async () => {
    throw error;
  }) as typeof fetch;
}

function abortablePendingFetch(): typeof fetch {
  return ((
    _input: RequestInfo | URL,
    init?: RequestInit,
  ) =>
    new Promise<Response>((_resolve, reject) => {
      const rejectAbort = () =>
        reject(new DOMException("The operation was aborted.", "AbortError"));
      if (init?.signal?.aborted) {
        rejectAbort();
        return;
      }
      init?.signal?.addEventListener("abort", rejectAbort, { once: true });
    })) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cloneReport(report: ProductionHealthReport) {
  return structuredClone(report);
}

void main();
