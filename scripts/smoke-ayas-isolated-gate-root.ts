import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasIsolatedGateRoot, resolveAyasProductionGateRoot, AyasGateRootIsolationError } from "../src/lib/brain/autonomy/AyasIsolatedGateRoot";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-isolated-root-")); }

async function main() {
  await scenario("an isolated temporary root is accepted", () => {
    const isolated = createAyasIsolatedGateRoot(root());
    assert.ok(typeof isolated === "string" && isolated.length > 0, "assert.ok(typeof isolated === \"string\" && isolated.length > 0)");
  });

  await scenario("the exact real production root is rejected", () => {
    assert.throws(
      () => createAyasIsolatedGateRoot(resolveAyasProductionGateRoot()),
      (error: unknown) => error instanceof AyasGateRootIsolationError && error.code === "AYAS_GATE_ROOT_IS_PRODUCTION",
    );
  });

  await scenario("a relative-path spelling of the production root is rejected", () => {
    const relative = path.relative(process.cwd(), resolveAyasProductionGateRoot());
    assert.throws(() => createAyasIsolatedGateRoot(relative), (error: unknown) => error instanceof AyasGateRootIsolationError);
  });

  await scenario("a dot-segment spelling of the production root is rejected", () => {
    const withDotSegments = path.join(resolveAyasProductionGateRoot(), "..", "brain");
    assert.throws(() => createAyasIsolatedGateRoot(withDotSegments), (error: unknown) => error instanceof AyasGateRootIsolationError);
  });

  await scenario("a trailing-slash spelling of the production root is rejected", () => {
    assert.throws(() => createAyasIsolatedGateRoot(`${resolveAyasProductionGateRoot()}${path.sep}`), (error: unknown) => error instanceof AyasGateRootIsolationError);
  });

  if (process.platform === "win32") {
    await scenario("[win32] a case-different spelling of the production root is rejected", () => {
      const upper = resolveAyasProductionGateRoot().toUpperCase();
      assert.throws(() => createAyasIsolatedGateRoot(upper), (error: unknown) => error instanceof AyasGateRootIsolationError);
    });
  }

  await scenario("a symlink/junction pointing at the production root is rejected", () => {
    const dir = root();
    const link = path.join(dir, "alias-to-production");
    try {
      fs.symlinkSync(resolveAyasProductionGateRoot(), link, "junction");
    } catch {
      return; // symlink creation may require elevated privileges on some Windows configs — skip rather than fail the suite
    }
    try {
      assert.throws(() => createAyasIsolatedGateRoot(link), (error: unknown) => error instanceof AyasGateRootIsolationError);
    } finally {
      fs.rmSync(link, { force: true });
    }
  });

  await scenario("two different isolated roots both remain accepted and distinct", () => {
    const a = createAyasIsolatedGateRoot(root());
    const b = createAyasIsolatedGateRoot(root());
    assert.notEqual(a, b);
  });

  await scenario("the module has zero dependency on approval/daemon/gate/lock authority", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brain", "autonomy", "AyasIsolatedGateRoot.ts"), "utf8");
    assert.doesNotMatch(src, /AyasApprovalInboxStore|AyasAutonomyDaemon|AyasExecutionGateStore|AyasExecutionAuthorityLock|consumeApproval|reserveApproval/);
  });

  console.log(`AYAS isolated gate root smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-isolated-gate-root", scenarios: count }));
}
main().catch((error) => { console.error("AYAS isolated gate root smoke FAILED:", error); process.exitCode = 1; });
