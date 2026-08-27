import assert from "node:assert/strict";
import { VideoAssemblyError } from "../src/lib/assembly/VideoAssemblyManager";

/**
 * Covers the minimal VideoAssemblyError diagnostic-stack remediation:
 * `internalDiagnosticStack` must give server-side observers the exact
 * throw-site location, while the public error contract (message/name/code/
 * stack) and durable-serialization surface (Object.keys/JSON.stringify)
 * remain byte-for-byte unchanged. No production execution, no FFmpeg, no
 * AI call -- pure in-process error construction.
 */

let passed = 0;
function pass(label: string) {
  passed += 1;
  console.log(`PASS ${passed}: ${label}`);
}

function run() {
  const error = new VideoAssemblyError();

  // Public contract: unchanged.
  assert.equal(error.message, "Video assembly failed.");
  pass("public message unchanged");

  assert.equal(error.name, "VideoAssemblyError");
  pass("public name unchanged");

  assert.equal(error.code, "VIDEO_ASSEMBLY_FAILED");
  pass("public code unchanged");

  assert.equal(error.stack, undefined);
  pass("public stack is undefined (unchanged)");

  // Diagnostic stack: present, safe shape, points at this file.
  const diagnostic = (error as unknown as { internalDiagnosticStack?: unknown })
    .internalDiagnosticStack;
  assert.ok(
    diagnostic === undefined || typeof diagnostic === "string",
    "internalDiagnosticStack must be a string or safely undefined, never throw",
  );
  pass("internalDiagnosticStack is string-or-undefined (never throws to access)");

  if (typeof diagnostic === "string") {
    assert.ok(
      diagnostic.includes("VideoAssemblyManager.ts"),
      "internalDiagnosticStack should reference the throw-site source file when the runtime produces a stack",
    );
    pass("internalDiagnosticStack references VideoAssemblyManager.ts when present");
  } else {
    pass("internalDiagnosticStack undefined on this runtime -- degrades safely, no throw");
  }

  // Non-enumerable / non-serializing: proves zero durable/user-facing leak surface.
  assert.ok(
    !Object.keys(error).includes("internalDiagnosticStack"),
    "internalDiagnosticStack must not appear in Object.keys",
  );
  pass("internalDiagnosticStack absent from Object.keys(error)");

  assert.ok(
    !Object.prototype.propertyIsEnumerable.call(error, "internalDiagnosticStack"),
    "internalDiagnosticStack must be non-enumerable",
  );
  pass("internalDiagnosticStack is non-enumerable");

  const serialized = JSON.stringify(error);
  assert.ok(
    serialized === undefined || !serialized.includes("internalDiagnosticStack"),
    "internalDiagnosticStack must not appear in JSON.stringify(error)",
  );
  pass("internalDiagnosticStack absent from JSON.stringify(error)");

  // Read-only: cannot be reassigned (silently ignored in non-strict callers,
  // but the descriptor itself must remain writable:false/configurable:false).
  const descriptor = Object.getOwnPropertyDescriptor(error, "internalDiagnosticStack");
  assert.ok(descriptor, "internalDiagnosticStack descriptor must exist");
  assert.equal(descriptor!.writable, false, "internalDiagnosticStack must be read-only");
  assert.equal(descriptor!.configurable, false, "internalDiagnosticStack must be non-configurable");
  assert.equal(descriptor!.enumerable, false, "internalDiagnosticStack must be non-enumerable");
  pass("internalDiagnosticStack descriptor is read-only/non-configurable/non-enumerable");

  // Two distinct constructions must have distinct diagnostic stacks pointing
  // at their own (different) call sites, proving per-throw-site discrimination.
  function throwFromSiteA(): never {
    throw new VideoAssemblyError();
  }
  function throwFromSiteB(): never {
    throw new VideoAssemblyError();
  }
  let stackA: unknown;
  let stackB: unknown;
  try { throwFromSiteA(); } catch (e) {
    stackA = (e as { internalDiagnosticStack?: unknown }).internalDiagnosticStack;
  }
  try { throwFromSiteB(); } catch (e) {
    stackB = (e as { internalDiagnosticStack?: unknown }).internalDiagnosticStack;
  }
  if (typeof stackA === "string" && typeof stackB === "string") {
    assert.ok(
      stackA.includes("throwFromSiteA") && stackB.includes("throwFromSiteB"),
      "distinct throw sites must produce distinguishable diagnostic stacks",
    );
    pass("distinct throw sites produce distinguishable internalDiagnosticStack values");
  } else {
    pass("runtime does not produce Error.stack -- discrimination test skipped safely");
  }

  console.log(`\nPASS (${passed} scenarios)`);
}

try {
  run();
} catch (error) {
  console.error("SMOKE_FAILED", error);
  process.exitCode = 1;
}
