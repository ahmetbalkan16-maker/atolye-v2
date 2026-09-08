/**
 * C.2B.6 / C.2B.9 foundation — runtime authority-generation marker primitive.
 *
 * Deterministic / no browser / $0 / no network. Proves the append-once marker
 * that a future, independently-reviewed relocation sprint wires into the
 * production composition root: a process booting against a runtime root whose
 * marker names a DIFFERENT authority generation must fail closed instead of
 * reading/writing durable execution state across an authority boundary.
 *
 * The primitive is NOT wired into any live path yet (see
 * docs/RUNTIME_AUTHORITY_GENERATION_BINDING.md). This smoke exercises it in
 * isolation under an OS temp dir — never the repo.
 *
 * Run: npx tsx scripts/smoke-c2b6-authority-generation-marker.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createRuntimeStorageContext,
  type RuntimeStorageContext,
} from "../src/lib/runtime/RuntimeStoragePaths";
import {
  assertRuntimeAuthorityGenerationMarkerCompatible,
  RuntimeAuthorityGenerationMarkerError,
  runtimeAuthorityGenerationMarkerFileName,
  writeRuntimeAuthorityGenerationMarker,
} from "../src/lib/runtime/security/RuntimeAuthorityGenerationMarker";

const GEN_A = "runtime-authority-generation-v1";
const GEN_B = "runtime-authority-generation-v2";
const NOW = "2026-07-20T12:00:00.000Z";

let count = 0;
const skipped: string[] = [];
async function scenario(name: string, run: () => unknown | Promise<unknown>) {
  await run();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function mismatch(fn: () => unknown) {
  assert.throws(fn, (error: unknown) =>
    error instanceof RuntimeAuthorityGenerationMarkerError &&
    error.code === "RUNTIME_AUTHORITY_GENERATION_MISMATCH");
}

function invalid(fn: () => unknown) {
  assert.throws(fn, (error: unknown) =>
    error instanceof RuntimeAuthorityGenerationMarkerError &&
    error.code === "RUNTIME_AUTHORITY_GENERATION_INVALID");
}

async function main() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "atolye-c2b6-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const runtimeRootA = path.join(tempRoot, "runtime-a");
  const runtimeRootB = path.join(tempRoot, "runtime-b");
  await fsp.mkdir(workspaceRoot, { recursive: true });
  await fsp.mkdir(path.join(runtimeRootA, "projects"), { recursive: true });
  await fsp.mkdir(path.join(runtimeRootB, "projects"), { recursive: true });

  const contextA: RuntimeStorageContext = createRuntimeStorageContext({
    environment: { ATOLYE_RUNTIME_ROOT: runtimeRootA },
    workspaceRoot,
    authorityRoot: path.join(tempRoot, "authority-a"),
  });
  const contextB: RuntimeStorageContext = createRuntimeStorageContext({
    environment: { ATOLYE_RUNTIME_ROOT: runtimeRootB },
    workspaceRoot,
    authorityRoot: path.join(tempRoot, "authority-b"),
  });
  const markerPathA = path.join(
    runtimeRootA,
    "projects",
    runtimeAuthorityGenerationMarkerFileName,
  );

  try {
    await scenario("absent marker → status absent, nothing written", () => {
      const result = assertRuntimeAuthorityGenerationMarkerCompatible({
        context: contextA,
        authorityGeneration: GEN_A,
      });
      assert.equal(result.status, "absent");
      assert.equal(fs.existsSync(markerPathA), false);
    });

    await scenario("write → status written, file exists as a sibling of projects", () => {
      const result = writeRuntimeAuthorityGenerationMarker({
        context: contextA,
        authorityGeneration: GEN_A,
        now: NOW,
      });
      assert.equal(result.status, "written");
      assert.equal(result.markerPath, markerPathA);
      assert.equal(fs.existsSync(markerPathA), true);
      const marker = JSON.parse(fs.readFileSync(markerPathA, "utf8"));
      assert.equal(marker.kind, "runtime-authority-generation-marker-v1");
      assert.equal(marker.authorityGeneration, GEN_A);
      assert.match(marker.authorityIdentity, /^[0-9a-f]{64}$/);
      assert.equal(marker.writtenAt, NOW);
    });

    await scenario("re-write same authority + generation → match, file unchanged", () => {
      const before = fs.readFileSync(markerPathA, "utf8");
      const result = writeRuntimeAuthorityGenerationMarker({
        context: contextA,
        authorityGeneration: GEN_A,
        now: "2027-01-01T00:00:00.000Z",
      });
      assert.equal(result.status, "match");
      assert.equal(fs.readFileSync(markerPathA, "utf8"), before);
    });

    await scenario("assert same authority + generation → match", () => {
      const result = assertRuntimeAuthorityGenerationMarkerCompatible({
        context: contextA,
        authorityGeneration: GEN_A,
      });
      assert.equal(result.status, "match");
      assert.equal(result.marker?.authorityGeneration, GEN_A);
    });

    await scenario("assert a different generation on the same root → MISMATCH", () => {
      mismatch(() =>
        assertRuntimeAuthorityGenerationMarkerCompatible({
          context: contextA,
          authorityGeneration: GEN_B,
        }));
    });

    await scenario("write a different generation on the same root → MISMATCH (never overwrites)", () => {
      const before = fs.readFileSync(markerPathA, "utf8");
      mismatch(() =>
        writeRuntimeAuthorityGenerationMarker({
          context: contextA,
          authorityGeneration: GEN_B,
          now: NOW,
        }));
      assert.equal(fs.readFileSync(markerPathA, "utf8"), before);
    });

    await scenario("a marker copied to a different runtime root → MISMATCH (resolver binding differs)", () => {
      const markerPathB = path.join(
        runtimeRootB,
        "projects",
        runtimeAuthorityGenerationMarkerFileName,
      );
      fs.copyFileSync(markerPathA, markerPathB);
      mismatch(() =>
        assertRuntimeAuthorityGenerationMarkerCompatible({
          context: contextB,
          authorityGeneration: GEN_A,
        }));
      fs.rmSync(markerPathB, { force: true });
    });

    await scenario("tampered authorityIdentity (valid hex, wrong value) → MISMATCH", () => {
      const marker = JSON.parse(fs.readFileSync(markerPathA, "utf8"));
      const tampered = { ...marker, authorityIdentity: "0".repeat(64) };
      const backup = fs.readFileSync(markerPathA, "utf8");
      fs.writeFileSync(markerPathA, `${JSON.stringify(tampered)}\n`);
      mismatch(() =>
        assertRuntimeAuthorityGenerationMarkerCompatible({
          context: contextA,
          authorityGeneration: GEN_A,
        }));
      fs.writeFileSync(markerPathA, backup);
    });

    await scenario("corrupt JSON marker → INVALID", () => {
      const backup = fs.readFileSync(markerPathA, "utf8");
      fs.writeFileSync(markerPathA, "{ not json");
      invalid(() =>
        assertRuntimeAuthorityGenerationMarkerCompatible({
          context: contextA,
          authorityGeneration: GEN_A,
        }));
      fs.writeFileSync(markerPathA, backup);
    });

    await scenario("structurally wrong marker (missing fields) → INVALID", () => {
      const backup = fs.readFileSync(markerPathA, "utf8");
      fs.writeFileSync(markerPathA, `${JSON.stringify({ kind: "x" })}\n`);
      invalid(() =>
        assertRuntimeAuthorityGenerationMarkerCompatible({
          context: contextA,
          authorityGeneration: GEN_A,
        }));
      fs.writeFileSync(markerPathA, backup);
    });

    await scenario("oversize marker → MARKER_UNSAFE", () => {
      const backup = fs.readFileSync(markerPathA, "utf8");
      fs.writeFileSync(markerPathA, "x".repeat(8 * 1024));
      assert.throws(
        () =>
          assertRuntimeAuthorityGenerationMarkerCompatible({
            context: contextA,
            authorityGeneration: GEN_A,
          }),
        (error: unknown) =>
          error instanceof RuntimeAuthorityGenerationMarkerError &&
          error.code === "RUNTIME_AUTHORITY_GENERATION_MARKER_UNSAFE",
      );
      fs.writeFileSync(markerPathA, backup);
    });

    await scenario("symlinked marker → MARKER_UNSAFE (or skipped where unsupported)", () => {
      const backup = fs.readFileSync(markerPathA, "utf8");
      const realTarget = path.join(tempRoot, "outside-marker.json");
      fs.writeFileSync(realTarget, backup);
      fs.rmSync(markerPathA, { force: true });
      try {
        fs.symlinkSync(realTarget, markerPathA, "file");
      } catch {
        skipped.push("symlink rejection (platform cannot create file symlinks)");
        fs.writeFileSync(markerPathA, backup);
        return;
      }
      assert.throws(
        () =>
          assertRuntimeAuthorityGenerationMarkerCompatible({
            context: contextA,
            authorityGeneration: GEN_A,
          }),
        (error: unknown) =>
          error instanceof RuntimeAuthorityGenerationMarkerError &&
          error.code === "RUNTIME_AUTHORITY_GENERATION_MARKER_UNSAFE",
      );
      fs.rmSync(markerPathA, { force: true });
      fs.writeFileSync(markerPathA, backup);
    });

    await scenario("invalid generation string → INVALID", () => {
      for (const bad of ["", "has space", "../x", "a".repeat(200)]) {
        invalid(() =>
          assertRuntimeAuthorityGenerationMarkerCompatible({
            context: contextA,
            authorityGeneration: bad,
          }));
      }
    });

    await scenario("legacy default (env unset) → absent, no marker written under the workspace", () => {
      const legacyContext = createRuntimeStorageContext({
        environment: {},
        workspaceRoot,
        authorityRoot: path.join(tempRoot, "authority-legacy"),
      });
      const result = assertRuntimeAuthorityGenerationMarkerCompatible({
        context: legacyContext,
        authorityGeneration: GEN_A,
      });
      assert.equal(result.status, "absent");
      assert.equal(
        fs.existsSync(
          path.join(
            workspaceRoot,
            "data",
            "projects",
            runtimeAuthorityGenerationMarkerFileName,
          ),
        ),
        false,
      );
    });

    console.log(`C.2B.6 authority-generation marker: PASS (${count} scenarios)`);
    if (skipped.length) console.log(`  skipped: ${skipped.join("; ")}`);
    console.log(
      JSON.stringify({
        status: "PASS",
        suite: "c2b6-authority-generation-marker",
        scenarios: count,
        skipped,
      }),
    );
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error("C.2B.6 authority-generation marker FAILED:", error);
    process.exitCode = 1;
  }
})();
