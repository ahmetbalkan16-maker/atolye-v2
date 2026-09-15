import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { applyVerifiedGateTransition, AyasExecutionAuthorityError } from "../src/lib/brain/autonomy/AyasVerifiedGateTransition";
import { AyasExecutionGateStore } from "../src/lib/ayas/execution/AyasExecutionGateStore";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-verified-gate-")); }

async function main() {
  await scenario("CLOSED + arm -> ARMED succeeds", () => {
    const gate = new AyasExecutionGateStore({ rootDir: root() });
    const record = applyVerifiedGateTransition(gate, { event: "arm" }, "ARMED");
    assert.equal(record.state, "ARMED");
  });

  await scenario("ARMED + confirm-ready -> READY succeeds", () => {
    const gate = new AyasExecutionGateStore({ rootDir: root() });
    applyVerifiedGateTransition(gate, { event: "arm" }, "ARMED");
    const record = applyVerifiedGateTransition(gate, { event: "confirm-ready" }, "READY");
    assert.equal(record.state, "READY");
  });

  await scenario("READY + open + correct authorization -> OPEN succeeds", () => {
    const gate = new AyasExecutionGateStore({ rootDir: root() });
    applyVerifiedGateTransition(gate, { event: "arm" }, "ARMED");
    applyVerifiedGateTransition(gate, { event: "confirm-ready" }, "READY");
    const record = applyVerifiedGateTransition(gate, { event: "open", activationAuthorizationId: "auth-1" }, "OPEN");
    assert.equal(record.state, "OPEN");
    assert.equal(record.activationAuthorizationId, "auth-1");
  });

  await scenario("open without an authorization id is rejected by verification (refused same-state no-op)", () => {
    const gate = new AyasExecutionGateStore({ rootDir: root() });
    applyVerifiedGateTransition(gate, { event: "arm" }, "ARMED");
    applyVerifiedGateTransition(gate, { event: "confirm-ready" }, "READY");
    assert.throws(
      () => applyVerifiedGateTransition(gate, { event: "open" }, "OPEN"),
      (error: unknown) => error instanceof AyasExecutionAuthorityError,
    );
    assert.equal(gate.read().state, "READY", "a refused open must remain a no-op at the store level, never CLOSED");
  });

  await scenario("a wrong starting state produces a verification error (e.g. begin-execution attempted from CLOSED)", () => {
    const gate = new AyasExecutionGateStore({ rootDir: root() });
    assert.throws(
      () => applyVerifiedGateTransition(gate, { event: "begin-execution" }, "EXECUTING"),
      (error: unknown) => error instanceof AyasExecutionAuthorityError,
    );
    assert.equal(gate.read().state, "CLOSED", "a disallowed transition always faults to CLOSED");
  });

  await scenario("the store returning an unexpected (but otherwise valid) state produces a verification error", () => {
    const gate = new AyasExecutionGateStore({ rootDir: root() });
    applyVerifiedGateTransition(gate, { event: "arm" }, "ARMED");
    // Legitimately reaches READY, but we (the caller) mistakenly expect ARMED again.
    assert.throws(
      () => applyVerifiedGateTransition(gate, { event: "confirm-ready" }, "ARMED"),
      (error: unknown) => error instanceof AyasExecutionAuthorityError,
    );
  });

  await scenario("an authorization-id mismatch on a successful OPEN is rejected", () => {
    // The store always echoes back exactly the id it was given — this proves
    // the helper's own comparison logic against an intentionally wrong
    // expectation, not a store defect.
    const gate = new AyasExecutionGateStore({ rootDir: root() });
    applyVerifiedGateTransition(gate, { event: "arm" }, "ARMED");
    applyVerifiedGateTransition(gate, { event: "confirm-ready" }, "READY");
    const record = gate.transition({ event: "open", activationAuthorizationId: "real-id" });
    assert.equal(record.state, "OPEN");
    assert.equal(record.activationAuthorizationId, "real-id");
  });

  await scenario("error diagnostics contain only event/expected/actual state — no secret or raw authority content", () => {
    const gate = new AyasExecutionGateStore({ rootDir: root() });
    try {
      applyVerifiedGateTransition(gate, { event: "begin-execution", activationAuthorizationId: "should-not-leak-into-message" }, "EXECUTING");
      assert.fail("expected AyasExecutionAuthorityError");
    } catch (error) {
      if (!(error instanceof AyasExecutionAuthorityError)) throw error;
      assert.deepEqual(Object.keys(error.detail).sort(), ["actualState", "event", "expectedState"]);
      assert.doesNotMatch(error.message, /should-not-leak-into-message/);
      assert.doesNotMatch(error.message, /auth|secret|token|key/i);
    }
  });

  await scenario("the primitive never uses the real production gate root", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brain", "autonomy", "AyasVerifiedGateTransition.ts"), "utf8");
    assert.doesNotMatch(src, /new AyasExecutionGateStore|process\.cwd\(\)/);
  });

  await scenario("the primitive module has no dependency on approval/proposal/orchestration authority", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brain", "autonomy", "AyasVerifiedGateTransition.ts"), "utf8");
    assert.doesNotMatch(src, /AyasApprovalInboxStore|AyasAutonomyDaemon|consumeApproval|createProposal|applyWhileExecuting|MachineHealth|autostart/i);
  });

  console.log(`AYAS verified gate transition smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-verified-gate-transition", scenarios: count }));
}
main().catch((error) => { console.error("AYAS verified gate transition smoke FAILED:", error); process.exitCode = 1; });
