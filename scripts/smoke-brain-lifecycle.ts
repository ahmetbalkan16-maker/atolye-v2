/**
 * Atölye Brain — page-lifecycle / unexpected-reload classification smoke.
 *
 * Deterministic / no browser. Exercises the pure `assessBrainReload` + record
 * parsing that back the reload detector, with the stronger evidence signals:
 * navigation type, bfcache restore, a clean `pagehide`, and the previous
 * instance's last liveness heartbeat (phase + uptime + dropped frames).
 */

import assert from "node:assert/strict";

import {
  assessBrainReload,
  navigationKindFrom,
  parseBrainBootRecord,
  parseBrainHeartbeat,
  EVICTION_WINDOW_MS,
  SW_RELOAD_MARKER_TTL_MS,
  HEARTBEAT_TRUST_MS,
  type BrainBootRecord,
  type BrainHeartbeat,
  type AssessBrainReloadInput,
} from "../src/lib/brain/ui/brainLifecycle";

let count = 0;
function scenario(name: string, fn: () => void) {
  fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const rec = (over: Partial<BrainBootRecord> = {}): BrainBootRecord => ({
  bootId: "abc123",
  bootCount: 1,
  bootAt: 1_000_000,
  voiceWasActive: false,
  voiceCycleCount: 0,
  lastPhase: "idle",
  recoveryCount: 0,
  cleanPagehide: false,
  ...over,
});

const hb = (over: Partial<BrainHeartbeat> = {}): BrainHeartbeat => ({
  bootId: "abc123",
  at: 1_000_000,
  uptimeMs: 34_000,
  phase: "wake",
  voiceActive: true,
  droppedFrames: 180,
  wakeInferences: 40,
  audioContextState: "running",
  visibilityState: "visible",
  wakeLockHeld: true,
  lastError: null,
  ...over,
});

const input = (over: Partial<AssessBrainReloadInput>): AssessBrainReloadInput => ({
  prev: null,
  heartbeat: null,
  nowMs: 5_000_000,
  navigationKind: "navigate",
  bfcacheRestore: false,
  swReloadMarkerAt: null,
  ...over,
});

scenario("first boot — no prior record", () => {
  const a = assessBrainReload(input({ prev: null }));
  assert.equal(a.firstBoot, true);
  assert.equal(a.cause, "first-boot");
  assert.equal(a.unexpectedReload, false);
  assert.equal(a.bootCount, 1);
  assert.equal(a.previousBootId, null);
});

scenario("navigationKindFrom — string + legacy enum + bfcache", () => {
  assert.equal(navigationKindFrom("reload", false), "reload");
  assert.equal(navigationKindFrom(1, false), "reload");
  assert.equal(navigationKindFrom("navigate", false), "navigate");
  assert.equal(navigationKindFrom("back_forward", false), "back-forward");
  assert.equal(navigationKindFrom("navigate", true), "bfcache-restore");
  assert.equal(navigationKindFrom(undefined, false), "unknown");
});

scenario("SW-update reload — recent marker wins over everything", () => {
  const now = 5_000_000;
  const a = assessBrainReload(
    input({
      prev: rec({ voiceWasActive: true, bootAt: now - 30_000, bootCount: 2 }),
      heartbeat: hb({ at: now - 1_000 }),
      nowMs: now,
      navigationKind: "reload",
      swReloadMarkerAt: now - 500,
    }),
  );
  assert.equal(a.cause, "sw-update");
  assert.equal(a.browserReloadLikely, false, "an SW reload is not a browser kill");
  assert.equal(a.unexpectedReload, true, "voice was active → still worth a resume prompt");
  assert.equal(a.bootCount, 3);
});

scenario("bfcache restore — page was NOT destroyed, never 'unexpected'", () => {
  const now = 5_000_000;
  const a = assessBrainReload(
    input({
      prev: rec({ voiceWasActive: true, bootAt: now - 20_000 }),
      heartbeat: hb({ at: now - 2_000 }),
      nowMs: now,
      navigationKind: "back-forward",
      bfcacheRestore: true,
    }),
  );
  assert.equal(a.cause, "bfcache-restore");
  assert.equal(a.unexpectedReload, false);
  assert.equal(a.browserReloadLikely, false);
});

scenario("browser-reload-suspected — reload nav + fresh heartbeat mid-wake + no pagehide → FOREGROUND kill", () => {
  const now = 5_000_000;
  const a = assessBrainReload(
    input({
      prev: rec({ voiceWasActive: true, bootAt: now - 36_000, voiceCycleCount: 1, cleanPagehide: false, lastEvent: "voice:cycle" }),
      heartbeat: hb({ at: now - 2_000, uptimeMs: 34_000, phase: "wake", droppedFrames: 210, visibilityState: "visible" }),
      nowMs: now,
      navigationKind: "reload",
    }),
  );
  assert.equal(a.cause, "browser-reload-suspected");
  assert.equal(a.browserReloadLikely, true);
  assert.equal(a.evictionKind, "foreground-memory-suspected");
  assert.equal(a.unexpectedReload, true);
  assert.ok(a.priorInstance);
  assert.equal(a.priorInstance!.hadFreshHeartbeat, true);
  assert.equal(a.priorInstance!.diedAtPhase, "wake");
  assert.equal(a.priorInstance!.diedAfterMs, 34_000);
  assert.equal(a.priorInstance!.droppedFrames, 210);
  assert.equal(a.priorInstance!.diedHidden, false);
});

scenario("browser-reload-suspected — last event was visibility:hidden → BACKGROUND eviction (screen lock)", () => {
  const now = 5_000_000;
  const a = assessBrainReload(
    input({
      prev: rec({ voiceWasActive: true, bootAt: now - 190_000, voiceCycleCount: 3, lastEvent: "visibility:hidden" }),
      heartbeat: hb({ at: now - 185_000, uptimeMs: 5_000, phase: "wake", visibilityState: "hidden", wakeLockHeld: false }),
      nowMs: now,
      navigationKind: "reload",
    }),
  );
  assert.equal(a.cause, "browser-reload-suspected");
  assert.equal(a.evictionKind, "background-eviction-suspected", "screen Auto-Lock → backgrounded → evicted");
  assert.equal(a.priorLastEvent, "visibility:hidden");
  assert.equal(a.priorInstance!.diedHidden, true);
  assert.equal(a.priorInstance!.wakeLockHeld, false);
});

scenario("browser-reload-suspected — big heartbeat gap alone hints backgrounded", () => {
  const now = 5_000_000;
  const a = assessBrainReload(
    input({
      prev: rec({ voiceWasActive: true, bootAt: now - 40_000, lastEvent: "voice:cycle" }),
      heartbeat: hb({ at: now - 25_000, visibilityState: "visible" }), // 25s gap > BACKGROUND_FREEZE_HINT_MS
      nowMs: now,
      navigationKind: "navigate",
    }),
  );
  assert.equal(a.evictionKind, "background-eviction-suspected");
});

scenario("clean pagehide before the reload → NOT a browser kill (manual reload / nav)", () => {
  const now = 5_000_000;
  const a = assessBrainReload(
    input({
      prev: rec({ voiceWasActive: true, bootAt: now - 20_000, cleanPagehide: true }),
      heartbeat: null,
      nowMs: now,
      navigationKind: "reload",
    }),
  );
  assert.equal(a.cause, "manual-reload-or-nav");
  assert.equal(a.browserReloadLikely, false);
  assert.equal(a.unexpectedReload, true, "voice was active — still offer to resume");
});

scenario("plain reload of an IDLE page → not unexpected, not a browser-kill", () => {
  const now = 5_000_000;
  const a = assessBrainReload(
    input({
      prev: rec({ voiceWasActive: false, bootAt: now - 5_000 }),
      navigationKind: "reload",
      nowMs: now,
    }),
  );
  assert.equal(a.cause, "manual-reload-or-nav");
  assert.equal(a.unexpectedReload, false);
  assert.equal(a.browserReloadLikely, false);
});

scenario("stale heartbeat (older than trust window) → priorInstance.hadFreshHeartbeat false", () => {
  const now = 5_000_000;
  const a = assessBrainReload(
    input({
      prev: rec({ voiceWasActive: true, bootAt: now - 60_000 }),
      heartbeat: hb({ at: now - (HEARTBEAT_TRUST_MS + 5_000) }),
      nowMs: now,
      navigationKind: "navigate",
    }),
  );
  assert.ok(a.priorInstance);
  assert.equal(a.priorInstance!.hadFreshHeartbeat, false);
  // navigate + voice active + no pagehide is still browser-reload-likely
  assert.equal(a.browserReloadLikely, true);
});

scenario("heartbeat from a different bootId is ignored", () => {
  const now = 5_000_000;
  const a = assessBrainReload(
    input({
      prev: rec({ bootId: "aaa111", voiceWasActive: true, bootAt: now - 10_000 }),
      heartbeat: hb({ bootId: "zzz999", at: now - 1_000 }),
      nowMs: now,
    }),
  );
  assert.equal(a.priorInstance, null);
});

scenario("stale SW marker is ignored → falls through to reload logic", () => {
  const now = 5_000_000;
  const a = assessBrainReload(
    input({
      prev: rec({ voiceWasActive: true, bootAt: now - 20_000 }),
      nowMs: now,
      navigationKind: "reload",
      swReloadMarkerAt: now - (SW_RELOAD_MARKER_TTL_MS + 5_000),
    }),
  );
  assert.notEqual(a.cause, "sw-update");
  assert.equal(a.cause, "browser-reload-suspected");
});

scenario("voice active but reload is old (> eviction window) → not a browser kill", () => {
  const now = 10_000_000;
  const a = assessBrainReload(
    input({
      prev: rec({ voiceWasActive: true, bootAt: now - (EVICTION_WINDOW_MS + 60_000) }),
      nowMs: now,
      navigationKind: "reload",
    }),
  );
  assert.equal(a.cause, "manual-reload-or-nav");
  assert.equal(a.browserReloadLikely, false);
  assert.equal(a.unexpectedReload, true);
});

scenario("parseBrainBootRecord — valid / corrupt / partial / previousBootId + cleanPagehide", () => {
  const good = parseBrainBootRecord(
    JSON.stringify(rec({ bootCount: 4, voiceWasActive: true, previousBootId: "p0", cleanPagehide: true })),
  );
  assert.ok(good && good.bootCount === 4 && good.voiceWasActive === true);
  assert.equal(good!.previousBootId, "p0");
  assert.equal(good!.cleanPagehide, true);
  assert.equal(parseBrainBootRecord(null), null);
  assert.equal(parseBrainBootRecord("not json {{{"), null);
  assert.equal(parseBrainBootRecord(JSON.stringify({ voiceWasActive: true })), null);
  const partial = parseBrainBootRecord(JSON.stringify({ bootAt: 1, bootCount: 2 }));
  assert.ok(partial && partial.voiceWasActive === false && partial.lastPhase === "off" && partial.cleanPagehide === false);
});

scenario("parseBrainHeartbeat — valid / corrupt / missing fields default", () => {
  const good = parseBrainHeartbeat(JSON.stringify(hb({ droppedFrames: 12, phase: "capturing", visibilityState: "hidden" })));
  assert.ok(good && good.droppedFrames === 12 && good.phase === "capturing");
  assert.equal(good!.visibilityState, "hidden");
  assert.equal(good!.wakeLockHeld, true);
  assert.equal(parseBrainHeartbeat(null), null);
  assert.equal(parseBrainHeartbeat("}{"), null);
  assert.equal(parseBrainHeartbeat(JSON.stringify({ phase: "wake" })), null, "no at/bootId → null");
  const bare = parseBrainHeartbeat(JSON.stringify({ bootId: "x", at: 1 }));
  assert.ok(bare && bare.droppedFrames === -1 && bare.wakeInferences === -1 && bare.lastError === null);
  assert.equal(bare!.visibilityState, "unknown");
  assert.equal(bare!.wakeLockHeld, null);
});

scenario("bootCount increments monotonically across reloads", () => {
  let prev: BrainBootRecord | null = null;
  let bc = 0;
  for (let i = 0; i < 5; i += 1) {
    const a = assessBrainReload(input({ prev, nowMs: 1_000 + i * 1_000 }));
    bc = a.bootCount;
    prev = rec({ bootCount: bc, bootAt: 1_000 + i * 1_000 });
  }
  assert.equal(bc, 5);
});

console.log(`Brain lifecycle smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "brain-lifecycle", scenarios: count }));
