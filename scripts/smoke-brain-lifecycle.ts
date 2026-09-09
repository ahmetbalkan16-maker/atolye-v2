/**
 * Atölye Brain — page-lifecycle / unexpected-reload classification smoke.
 *
 * Deterministic / no browser. Exercises the pure `assessBrainReload` + record
 * parsing that back the reload detector: first boot, a SW-update reload, a
 * suspected iOS eviction (voice was active), a plain reload of an idle page,
 * and corrupt storage.
 */

import assert from "node:assert/strict";

import {
  assessBrainReload,
  parseBrainBootRecord,
  EVICTION_WINDOW_MS,
  SW_RELOAD_MARKER_TTL_MS,
  type BrainBootRecord,
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
  ...over,
});

scenario("first boot — no prior record", () => {
  const a = assessBrainReload({ prev: null, nowMs: 5_000_000, swReloadMarkerAt: null });
  assert.equal(a.firstBoot, true);
  assert.equal(a.cause, "first-boot");
  assert.equal(a.unexpectedReload, false);
  assert.equal(a.bootCount, 1);
});

scenario("SW-update reload — recent marker wins, not eviction", () => {
  const now = 5_000_000;
  const a = assessBrainReload({
    prev: rec({ voiceWasActive: true, bootAt: now - 30_000, bootCount: 2 }),
    nowMs: now,
    swReloadMarkerAt: now - 500, // fresh marker
  });
  assert.equal(a.cause, "sw-update");
  assert.equal(a.unexpectedReload, true, "voice was active → still worth telling the user");
  assert.equal(a.bootCount, 3);
  assert.equal(a.priorVoiceCycles, 0);
});

scenario("stale SW marker is ignored → falls through to eviction/idle logic", () => {
  const now = 5_000_000;
  const a = assessBrainReload({
    prev: rec({ voiceWasActive: true, bootAt: now - 20_000 }),
    nowMs: now,
    swReloadMarkerAt: now - (SW_RELOAD_MARKER_TTL_MS + 5_000),
  });
  assert.equal(a.cause, "eviction-suspected");
});

scenario("suspected iOS eviction — voice active, recent, no SW marker", () => {
  const now = 5_000_000;
  const a = assessBrainReload({
    prev: rec({ voiceWasActive: true, bootAt: now - 90_000, voiceCycleCount: 3, bootCount: 1 }),
    nowMs: now,
    swReloadMarkerAt: null,
  });
  assert.equal(a.cause, "eviction-suspected");
  assert.equal(a.unexpectedReload, true);
  assert.equal(a.priorVoiceActive, true);
  assert.equal(a.priorVoiceCycles, 3);
  assert.equal(a.bootCount, 2);
});

scenario("plain reload of an IDLE page → not unexpected, just navigation", () => {
  const now = 5_000_000;
  const a = assessBrainReload({
    prev: rec({ voiceWasActive: false, bootAt: now - 5_000 }),
    nowMs: now,
    swReloadMarkerAt: null,
  });
  assert.equal(a.cause, "reload-or-navigation");
  assert.equal(a.unexpectedReload, false, "an idle-page reload is noise, don't nag");
});

scenario("voice active but reload is old (> eviction window) → not eviction", () => {
  const now = 10_000_000;
  const a = assessBrainReload({
    prev: rec({ voiceWasActive: true, bootAt: now - (EVICTION_WINDOW_MS + 60_000) }),
    nowMs: now,
    swReloadMarkerAt: null,
  });
  assert.equal(a.cause, "reload-or-navigation");
  // still unexpectedReload=true because a voice session was armed when it vanished
  assert.equal(a.unexpectedReload, true);
});

scenario("parseBrainBootRecord — valid / corrupt / partial", () => {
  const good = parseBrainBootRecord(JSON.stringify(rec({ bootCount: 4, voiceWasActive: true })));
  assert.ok(good && good.bootCount === 4 && good.voiceWasActive === true);
  assert.equal(parseBrainBootRecord(null), null);
  assert.equal(parseBrainBootRecord("not json {{{"), null);
  assert.equal(parseBrainBootRecord(JSON.stringify({ voiceWasActive: true })), null, "no bootAt/bootCount → null");
  const partial = parseBrainBootRecord(JSON.stringify({ bootAt: 1, bootCount: 2 }));
  assert.ok(partial && partial.voiceWasActive === false && partial.voiceCycleCount === 0 && partial.lastPhase === "off");
});

scenario("bootCount increments monotonically across reloads", () => {
  let prev: BrainBootRecord | null = null;
  let bc = 0;
  for (let i = 0; i < 5; i += 1) {
    const a = assessBrainReload({ prev, nowMs: 1_000 + i * 1_000, swReloadMarkerAt: null });
    bc = a.bootCount;
    prev = rec({ bootCount: bc, bootAt: 1_000 + i * 1_000 });
  }
  assert.equal(bc, 5);
});

console.log(`Brain lifecycle smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "brain-lifecycle", scenarios: count }));
