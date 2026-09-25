/**
 * AYAS Execution Gate — state machine + durable store smoke suite.
 *
 * Deterministic / $0 / no network / no model. Covers spec §6 / §10 / §21:
 *  - the pure SM: CLOSED→ARMED→READY→OPEN→EXECUTING→COMPLETED→READY;
 *    `open` needs an activation id; unknown/disallowed events fault to CLOSED;
 *  - the durable store: absent file → CLOSED; monotonic sequence; append-only
 *    log; CAS sequence conflict; exclusive-log conflict (replay); atomic write;
 *    corrupt → loud on read + fail-closed for a decision; restart reload;
 *    `fault` always lands CLOSED whatever the persisted state.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  nextAyasExecutionGateState,
  isAyasExecutionGateOpenState,
  AYAS_EXECUTION_GATE_DEFAULT,
} from "../src/lib/ayas/execution/AyasExecutionGate";
import {
  AyasExecutionGateStore,
  AyasExecutionGateStoreError,
} from "../src/lib/ayas/execution/AyasExecutionGateStore";

let count = 0;
function scenario(name: string, test: () => void) {
  test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const ACT = "authz-11111111-2222-3333-4444-555555555555";

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-gate-"));
  let clock = Date.parse("2026-09-09T12:00:00.000Z");
  const store = new AyasExecutionGateStore({ rootDir: dir, now: () => new Date((clock += 1000)) });
  return { dir, store };
}

/* -------------------------------- pure SM -------------------------------- */

scenario("SM — default is CLOSED", () => {
  assert.equal(AYAS_EXECUTION_GATE_DEFAULT, "CLOSED", "assert.equal(AYAS_EXECUTION_GATE_DEFAULT, \"CLOSED\")");
});

scenario("SM — the full happy path", () => {
  let s = "CLOSED" as ReturnType<typeof nextAyasExecutionGateState>["to"];
  const path_: [string, string][] = [];
  for (const [event, ctx] of [
    ["arm", {}],
    ["confirm-ready", {}],
    ["open", { activationAuthorizationId: ACT }],
    ["begin-execution", {}],
    ["complete-execution", {}],
    ["settle", {}],
  ] as const) {
    const t = nextAyasExecutionGateState(s, event, ctx);
    assert.equal(t.faulted, false, `${event} faulted`);
    path_.push([s, t.to]);
    s = t.to;
  }
  assert.equal(s, "READY", "assert.equal(s, \"READY\")");
  assert.deepEqual(path_.map(([, to]) => to), ["ARMED", "READY", "OPEN", "EXECUTING", "COMPLETED", "READY"], "assert.deepEqual(path_.map(([, to]) => to), [\"ARMED\", \"READY\", \"OPEN\", \"EXECUTING\", \"COMPLETED\", \"READY\"])");
});

scenario("SM — `open` without an activation id does NOT move the gate", () => {
  const t = nextAyasExecutionGateState("READY", "open", {});
  assert.equal(t.to, "READY", "assert.equal(t.to, \"READY\")");
  assert.equal(t.faulted, false, "assert.equal(t.faulted, false)");
  assert.equal(isAyasExecutionGateOpenState(t.to), false, "assert.equal(isAyasExecutionGateOpenState(t.to), false)");
});

scenario("SM — `open` from any non-READY state is a refused no-op, never a fault", () => {
  for (const state of ["CLOSED", "ARMED", "OPEN", "EXECUTING", "COMPLETED"] as const) {
    const t = nextAyasExecutionGateState(state, "open", { activationAuthorizationId: ACT });
    assert.equal(t.to, state, `${state}+open should stay put`);
    assert.equal(t.faulted, false, `${state}+open must not fault`);
  }
});

scenario("SM — a disallowed (state,event) pair FAULTS to CLOSED", () => {
  for (const [state, event] of [
    ["CLOSED", "begin-execution"],
    ["ARMED", "begin-execution"],
    ["READY", "complete-execution"],
    ["OPEN", "settle"],
    ["EXECUTING", "arm"],
    ["COMPLETED", "begin-execution"],
  ] as const) {
    const t = nextAyasExecutionGateState(state, event, { activationAuthorizationId: ACT });
    assert.equal(t.to, "CLOSED", `${state}+${event}`);
    assert.equal(t.faulted, true, `${state}+${event} should fault`);
  }
});

scenario("SM — `fault` and `close` always land CLOSED from any state", () => {
  for (const state of ["CLOSED", "ARMED", "READY", "OPEN", "EXECUTING", "COMPLETED"] as const) {
    assert.equal(nextAyasExecutionGateState(state, "fault").to, "CLOSED", "assert.equal(nextAyasExecutionGateState(state, \"fault\").to, \"CLOSED\")");
    assert.equal(nextAyasExecutionGateState(state, "close").to, "CLOSED", "assert.equal(nextAyasExecutionGateState(state, \"close\").to, \"CLOSED\")");
  }
});

/* ------------------------------ durable store ---------------------------- */

scenario("store — absent gate.json reads as CLOSED sequence 0", () => {
  const { store } = freshStore();
  const rec = store.read();
  assert.equal(rec.state, "CLOSED", "assert.equal(rec.state, \"CLOSED\")");
  assert.equal(rec.sequence, 0, "assert.equal(rec.sequence, 0)");
  assert.equal(store.readStateFailClosed().state, "CLOSED", "assert.equal(store.readStateFailClosed().state, \"CLOSED\")");
});

scenario("store — transitions bump the sequence by exactly 1 and append a log entry", () => {
  const { store } = freshStore();
  const a = store.transition({ event: "arm" });
  assert.equal(a.sequence, 1, "assert.equal(a.sequence, 1)");
  assert.equal(a.state, "ARMED", "assert.equal(a.state, \"ARMED\")");
  const b = store.transition({ event: "confirm-ready" });
  assert.equal(b.sequence, 2, "assert.equal(b.sequence, 2)");
  const log = store.readLog();
  assert.equal(log.length, 2, "assert.equal(log.length, 2)");
  assert.deepEqual(log.map((e) => e.event), ["arm", "confirm-ready"], "assert.deepEqual(log.map((e) => e.event), [\"arm\", \"confirm-ready\"])");
  assert.deepEqual(log.map((e) => e.state), ["ARMED", "READY"], "assert.deepEqual(log.map((e) => e.state), [\"ARMED\", \"READY\"])");
  assert.deepEqual(log.map((e) => e.from), ["CLOSED", "ARMED"], "assert.deepEqual(log.map((e) => e.from), [\"CLOSED\", \"ARMED\"])");
  assert.deepEqual(log.map((e) => e.sequence), [1, 2], "assert.deepEqual(log.map((e) => e.sequence), [1, 2])");
});

scenario("store — `open` needs an activation id; without one it is a no-op (no sequence bump)", () => {
  const { store } = freshStore();
  store.transition({ event: "arm" });
  store.transition({ event: "confirm-ready" });
  const before = store.read();
  const after = store.transition({ event: "open" });
  assert.equal(after.sequence, before.sequence, "refused open must not bump the sequence");
  assert.equal(after.state, "READY", "assert.equal(after.state, \"READY\")");
  const opened = store.transition({ event: "open", activationAuthorizationId: ACT });
  assert.equal(opened.state, "OPEN", "assert.equal(opened.state, \"OPEN\")");
  assert.equal(opened.activationAuthorizationId, ACT, "assert.equal(opened.activationAuthorizationId, ACT)");
});

scenario("store — CAS: a stale expectedSequence is rejected", () => {
  const { store } = freshStore();
  store.transition({ event: "arm" }); // seq 1
  assert.throws(
    () => store.transition({ event: "confirm-ready", expectedSequence: 0 }),
    (e: unknown) => e instanceof AyasExecutionGateStoreError && e.code === "AYAS_EXECUTION_GATE_SEQUENCE_CONFLICT",
  );
  // the correct expected sequence still works
  const ok = store.transition({ event: "confirm-ready", expectedSequence: 1 });
  assert.equal(ok.sequence, 2, "assert.equal(ok.sequence, 2)");
});

scenario("store — the append-only log rejects a duplicate sequence (replay/concurrent)", () => {
  const { dir, store } = freshStore();
  store.transition({ event: "arm" });
  // forge a second store that thinks the gate is still at sequence 0 and re-fires
  const rogue = new AyasExecutionGateStore({ rootDir: dir });
  // overwrite gate.json to look like seq 0 again, log/1.json still exists
  fs.writeFileSync(
    store.file,
    JSON.stringify({ schemaVersion: "1", sequence: 0, state: "CLOSED", updatedAt: new Date().toISOString() }),
  );
  assert.throws(
    () => rogue.transition({ event: "arm" }),
    (e: unknown) => e instanceof AyasExecutionGateStoreError && e.code === "AYAS_EXECUTION_GATE_LOG_CONFLICT",
  );
});

scenario("store — restart: a fresh instance reloads the persisted state", () => {
  const { dir, store } = freshStore();
  store.transition({ event: "arm" });
  store.transition({ event: "confirm-ready" });
  store.transition({ event: "open", activationAuthorizationId: ACT });
  const reloaded = new AyasExecutionGateStore({ rootDir: dir });
  assert.equal(reloaded.read().state, "OPEN", "assert.equal(reloaded.read().state, \"OPEN\")");
  assert.equal(reloaded.read().sequence, 3, "assert.equal(reloaded.read().sequence, 3)");
});

scenario("store — `fault` lands CLOSED whatever the persisted state, and is logged", () => {
  const { dir, store } = freshStore();
  store.transition({ event: "arm" });
  store.transition({ event: "confirm-ready" });
  store.transition({ event: "open", activationAuthorizationId: ACT });
  store.transition({ event: "begin-execution" });
  const faulted = store.transition({ event: "fault", reason: "executor blew up" });
  assert.equal(faulted.state, "CLOSED", "assert.equal(faulted.state, \"CLOSED\")");
  assert.equal(new AyasExecutionGateStore({ rootDir: dir }).read().state, "CLOSED", "assert.equal(new AyasExecutionGateStore({ rootDir: dir }).read().state, \"CLOSED\")");
  assert.equal(store.readLog().at(-1)?.faulted, true, "assert.equal(store.readLog().at(-1)?.faulted, true)");
});

scenario("store — corrupt gate.json: loud on read(), fail-closed for a decision, never overwritten", () => {
  const { dir, store } = freshStore();
  store.transition({ event: "arm" });
  fs.writeFileSync(store.file, "{ not json");
  const reloaded = new AyasExecutionGateStore({ rootDir: dir });
  assert.throws(
    () => reloaded.read(),
    (e: unknown) => e instanceof AyasExecutionGateStoreError && e.code === "AYAS_EXECUTION_GATE_CORRUPT",
  );
  const decision = reloaded.readStateFailClosed();
  assert.equal(decision.state, "CLOSED", "assert.equal(decision.state, \"CLOSED\")");
  assert.equal(decision.degraded, true, "assert.equal(decision.degraded, true)");
  assert.equal(fs.readFileSync(store.file, "utf8"), "{ not json", "corrupt file must be left untouched");
});

scenario("store — schema mismatch is its own loud error", () => {
  const { dir, store } = freshStore();
  store.transition({ event: "arm" });
  fs.writeFileSync(
    store.file,
    JSON.stringify({ schemaVersion: "999", sequence: 1, state: "ARMED", updatedAt: new Date().toISOString() }),
  );
  assert.throws(
    () => new AyasExecutionGateStore({ rootDir: dir }).read(),
    (e: unknown) => e instanceof AyasExecutionGateStoreError && e.code === "AYAS_EXECUTION_GATE_SCHEMA_MISMATCH",
  );
});

scenario("store — a leftover temp file from a crash is ignored on the next read", () => {
  const { dir, store } = freshStore();
  store.transition({ event: "arm" });
  fs.writeFileSync(path.join(dir, "execution", ".gate.json.999.deadbeef.tmp"), "garbage");
  assert.equal(new AyasExecutionGateStore({ rootDir: dir }).read().state, "ARMED", "assert.equal(new AyasExecutionGateStore({ rootDir: dir }).read().state, \"ARMED\")");
});

console.log(`AYAS execution gate smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-execution-gate", scenarios: count }));
