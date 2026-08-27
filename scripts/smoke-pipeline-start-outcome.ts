/**
 * Unit coverage for resolvePipelineStartOutcome — the branching HomeClient uses
 * to decide "navigate to the project page" vs "show an inline error" after
 * POST /api/pipeline. The key behaviour: whenever the route hands back a usable
 * project reference (success, stopReason stop, or a mid-pipeline failure that
 * still created the project), the user is sent to /project/[slug]; only a
 * response with no usable reference stays on the start screen as an error.
 */
import assert from "node:assert/strict";
import { resolvePipelineStartOutcome } from "../src/lib/pipeline/pipelineStartOutcome";

let passed = 0;
function pass(label: string) {
  passed += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${passed}: ${label}`);
}

// Full success.
assert.deepEqual(
  resolvePipelineStartOutcome({ success: true, slug: "roma-tarihi", projectUrl: "/project/roma-tarihi" }),
  { kind: "navigate", to: "/project/roma-tarihi" },
);
pass("success -> navigate");

// Mid-pipeline failure that still created the project.
assert.deepEqual(
  resolvePipelineStartOutcome({ success: false, error: "Uretim akisi tamamlanamadi.", slug: "roma-tarihi", projectUrl: "/project/roma-tarihi" }),
  { kind: "navigate", to: "/project/roma-tarihi" },
);
pass("failure + project exists -> navigate (not stranded)");

// stopReason stop.
assert.deepEqual(
  resolvePipelineStartOutcome({ success: false, error: "Stage cancelled.", slug: "x", projectUrl: "/project/x" }),
  { kind: "navigate", to: "/project/x" },
);
pass("stopReason -> navigate");

// Failure with no project reference at all -> inline error.
assert.deepEqual(
  resolvePipelineStartOutcome({ success: false, error: "Uretim akisi tamamlanamadi." }),
  { kind: "error", message: "Uretim akisi tamamlanamadi." },
);
pass("failure, no projectUrl -> error with server message");

// Empty topic.
assert.deepEqual(
  resolvePipelineStartOutcome({ success: false, error: "Konu bos olamaz." }),
  { kind: "error", message: "Konu bos olamaz." },
);
pass("bad topic -> error");

// No body / no error string -> generic fallback message.
assert.deepEqual(resolvePipelineStartOutcome(undefined), { kind: "error", message: "Üretim akışı tamamlanamadı." });
assert.deepEqual(resolvePipelineStartOutcome(null), { kind: "error", message: "Üretim akışı tamamlanamadı." });
assert.deepEqual(resolvePipelineStartOutcome({}), { kind: "error", message: "Üretim akışı tamamlanamadı." });
pass("missing body -> generic fallback error");

// Malformed / unsafe projectUrl is NOT navigated to (defence in depth).
for (const bad of [
  "https://evil.example/project/x",
  "//evil.example",
  "/project/../admin",
  "/project/x?next=/y",
  "/projects/x",
  "/project/",
  "/project/Ünsafe",
  "javascript:alert(1)",
]) {
  const outcome = resolvePipelineStartOutcome({ success: false, error: "e", projectUrl: bad });
  assert.equal(outcome.kind, "error", `must not navigate to unsafe projectUrl: ${bad}`);
}
pass("unsafe projectUrl values are refused, fall back to error");

// A safe slug with digits and multiple dashes navigates.
assert.deepEqual(
  resolvePipelineStartOutcome({ projectUrl: "/project/fatih-sultan-mehmet-1453" }),
  { kind: "navigate", to: "/project/fatih-sultan-mehmet-1453" },
);
pass("multi-segment slug with digits -> navigate");

console.log(`Pipeline start outcome smoke: PASS (${passed} cases)`);
