/**
 * V3 smoke: motion fluency. A test performer runs gestures, speech, a walk, a turn and expression changes;
 * every animated channel is sampled per frame and checked for robotic snaps (acceleration spikes), pops
 * (one-frame jumps), instant mirror flips, frame-order dependence and failure to settle.
 * Pure (no Remotion render). Run: npx tsx scripts/smoke-v3-motion.ts
 */
import assert from "node:assert/strict";
import { performerState, type PerformerState } from "../remotion-v3/src/character/motion";
import { cameraAt, filmCamera } from "../remotion-v3/src/scene/camera";
import { COLUMN_S, FLARE_S, flaresAt, isNightMap, landRings, MAP_BUBBLE, mapBubbleSize, onLand, raidOf, searchlights, TORPEDO_RUN_S, torpedoAt, torpedoAttacker, torpedoStart, torpedoTarget, waterColumn } from "../remotion-v3/src/scene/mapEffects";
import type { V3CameraKey, V3GeoMap, V3Performer, V3Viseme } from "../src/lib/v3/render/RenderPlanTypes";

// MapUnits.tsx imports "remotion", which only remotion-v3/node_modules provides. A static import pulls it into the root
// type check, and the live snapshot (root `npm ci` only) then fails `next build` with TS2307 — so it loads at run time.
interface MapUnitsModule {
  placeTokens(map: V3GeoMap, frame: number, fps: number, k: number): ({ x: number; y: number; lostAt?: number } | undefined)[][];
  gunfireAt(map: V3GeoMap, frame: number, fps: number): { ui: number; ti: number; p: number; gun: boolean; shot: number }[];
}
const MAP_UNITS: string = "../remotion-v3/src/scene/MapUnits";

const FPS = 30;
const FRAMES = 420;

let scenarios = 0;
async function scenario(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
  scenarios++;
}

const VISEMES: readonly V3Viseme[] = ["B", "D", "C", "A", "E", "D", "F", "B", "X"];

const performer: V3Performer = {
  castId: "zaganos",
  x: 0.3,
  depth: 0,
  facing: "right",
  moves: [{ start: 280, end: 340, fromX: 0.3, toX: 0.55 }],
  gestures: [
    { gesture: "konus", start: 0, end: 60 },
    { gesture: "isaret_et", start: 75, end: 130, toward: "right" },
    { gesture: "yumruk_kaldir", start: 150, end: 200 },
    { gesture: "sasir", start: 220, end: 262 },
  ],
  faces: [
    { start: 0, emotion: "notr" },
    { start: 100, emotion: "kizgin" },
    { start: 205, emotion: "mutlu" },
  ],
  visemes: Array.from({ length: 20 }, (_, i) => ({ frame: i * 3, viseme: VISEMES[i % VISEMES.length]! })),
  effects: [],
  speaking: [{ start: 0, end: 60 }],
  turns: [{ frame: 365, facing: "left" }],
};

type Channel = { name: string; group: "kol" | "govde" | "bacak" | "ayna"; get: (s: PerformerState) => number };

const mirrorOf = (s: PerformerState) => (s as PerformerState & { mirror?: number }).mirror ?? (s.facing === "left" ? -1 : 1);

const CHANNELS: readonly Channel[] = [
  { name: "onKol.ust", group: "kol", get: (s) => s.pose.armFront[0] },
  { name: "onKol.alt", group: "kol", get: (s) => s.pose.armFront[1] },
  { name: "arkaKol.ust", group: "kol", get: (s) => s.pose.armBack[0] },
  { name: "arkaKol.alt", group: "kol", get: (s) => s.pose.armBack[1] },
  { name: "egim", group: "govde", get: (s) => s.pose.lean },
  { name: "basEgim", group: "govde", get: (s) => s.pose.headTilt },
  { name: "zipla", group: "govde", get: (s) => s.pose.bob },
  { name: "onBacak.ust", group: "bacak", get: (s) => s.pose.legFront[0] },
  { name: "onBacak.diz", group: "bacak", get: (s) => s.pose.legFront[1] },
  { name: "onAyak.kalk", group: "bacak", get: (s) => s.pose.liftFront },
  { name: "ayna", group: "ayna", get: mirrorOf },
];

interface Metrics {
  /** Largest one-frame change. */
  step: number;
  /** Largest second difference (acceleration per frame²): robotic snaps show up here. */
  accel: number;
}

function metrics(values: readonly number[]): Metrics {
  let step = 0, accel = 0;
  for (let i = 1; i < values.length; i++) {
    step = Math.max(step, Math.abs(values[i]! - values[i - 1]!));
    if (i >= 2) accel = Math.max(accel, Math.abs(values[i]! - 2 * values[i - 1]! + values[i - 2]!));
  }
  return { step, accel };
}

async function main() {
  const { gunfireAt, placeTokens } = (await import(MAP_UNITS)) as MapUnitsModule;
  const states = Array.from({ length: FRAMES }, (_, f) => performerState(performer, f, FPS));
  const table = CHANNELS.map((c) => ({ c, m: metrics(states.map(c.get)) }));
  for (const { c, m } of table) {
    console.log(`${c.name.padEnd(12)} adim=${m.step.toFixed(2).padStart(6)}  ivme=${m.accel.toFixed(2).padStart(6)}`);
  }
  const worst = (group: Channel["group"], key: keyof Metrics) => Math.max(...table.filter((t) => t.c.group === group).map((t) => t.m[key]));
  console.log(`EN KOTU kol ivmesi=${worst("kol", "accel").toFixed(2)} govde ivmesi=${worst("govde", "accel").toFixed(2)} bacak adimi=${worst("bacak", "step").toFixed(2)} ayna adimi=${worst("ayna", "step").toFixed(2)}`);

  await scenario("A arms never snap: acceleration stays film-smooth (no robotic lock into a pose)", () => {
    assert.ok(worst("kol", "accel") <= 8, `kol ivmesi ${worst("kol", "accel").toFixed(2)} > 8 derece/kare²`);
  });

  await scenario("B body and head move without jolts", () => {
    for (const t of table.filter((x) => x.c.group === "govde" && x.c.name !== "zipla")) {
      assert.ok(t.m.accel <= 3, `${t.c.name} ivmesi ${t.m.accel.toFixed(2)} > 3`);
    }
  });

  await scenario("C a walk starts and stops without the feet popping", () => {
    // A stride at walking pace moves the legs ~8°/frame by itself; pops show up as acceleration and as jumps
    // in the frames where the walk begins and ends.
    assert.ok(worst("bacak", "accel") <= 6.5, `bacak ivmesi ${worst("bacak", "accel").toFixed(2)} > 6.5`);
    const before = performerState(performer, 279, FPS).pose.liftFront;
    const first = performerState(performer, 281, FPS).pose.liftFront;
    assert.ok(Math.abs(first - before) <= 2, `yuruyus baslangicinda ayak ${Math.abs(first - before).toFixed(2)} birim sicradi`);
    for (const c of CHANNELS.filter((x) => x.group === "bacak")) {
      // The walk runs 280–340: the first and last frames are where an unramped cycle pops.
      for (const [a, b] of [[277, 283], [337, 344]] as const) {
        for (let f = a; f < b; f++) {
          const jump = Math.abs(c.get(states[f + 1]!) - c.get(states[f]!));
          assert.ok(jump <= 3, `${c.name} yuruyusun ${a < 300 ? "basinda" : "sonunda"} ${f}. karede ${jump.toFixed(2)} sicradi`);
        }
      }
    }
  });

  await scenario("D turning around is an in-between, not an instant mirror flip", () => {
    assert.ok(worst("ayna", "step") <= 0.5, `ayna tek karede ${worst("ayna", "step").toFixed(2)} degisti`);
    assert.equal(mirrorOf(performerState(performer, 300, FPS)), 1);
    assert.equal(mirrorOf(performerState(performer, 400, FPS)), -1);
  });

  await scenario("E every frame is identical whatever order frames are rendered in (Remotion renders in parallel)", () => {
    for (const f of [399, 7, 222, 150, 0, 341, 101]) {
      assert.deepEqual(performerState(performer, f, FPS), states[f]);
    }
  });

  await scenario("F after the last gesture the body settles back to its idle pose", () => {
    const idle = performerState({ ...performer, moves: [], gestures: [], speaking: [], turns: [] }, 415, FPS).pose;
    const settled = performerState({ ...performer, moves: [], turns: [] }, 415, FPS).pose;
    for (const k of ["armFront", "armBack"] as const) {
      assert.ok(Math.abs(settled[k][0] - idle[k][0]) < 0.5 && Math.abs(settled[k][1] - idle[k][1]) < 0.5, `${k} oturmadi`);
    }
  });

  await scenario("G expressions blink through a change and the brows slide", () => {
    const at = (f: number) => performerState(performer, f, FPS);
    assert.equal(at(99).emotion, "notr");
    assert.equal(at(100).emotion, "kizgin");
    assert.ok(at(99).eyesClosed >= 0.75 && at(100).eyesClosed >= 0.75, "goz degisim aninda kapali degil");
    const mixes = [98, 99, 100, 101, 102, 103].map((f) => at(f).brows.mix);
    for (let i = 1; i < mixes.length; i++) assert.ok(mixes[i]! >= mixes[i - 1]! && mixes[i]! - mixes[i - 1]! < 0.5, `kas gecisi sicradi: ${mixes.join(", ")}`);
  });

  await scenario("H the camera glides through a key, holds without overshoot, and still snaps and cuts", () => {
    const keys: V3CameraKey[] = [
      { frame: 0, zoom: 1, cx: 0.5, cy: 0.5 },
      { frame: 30, zoom: 1.3, cx: 0.6, cy: 0.5 },
      { frame: 60, zoom: 1.6, cx: 0.7, cy: 0.5 },
      { frame: 90, zoom: 1.6, cx: 0.7, cy: 0.5 },
      { frame: 100, zoom: 2, cx: 0.7, cy: 0.5, ease: "snap" },
      { frame: 110, zoom: 1, cx: 0.5, cy: 0.5, ease: "cut" },
    ];
    const z = Array.from({ length: 120 }, (_, f) => cameraAt(keys, f, FPS).zoom);
    // Through the middle key the camera keeps moving (the old per-segment ease stopped dead there).
    assert.ok(z[31]! - z[29]! > 0.015, `kamera 30. karede durdu: ${(z[31]! - z[29]!).toFixed(4)}`);
    assert.ok(metrics(z.slice(0, 61)).accel < 0.003, `kamera ivmesi ${metrics(z.slice(0, 61)).accel.toFixed(4)}`);
    for (let f = 60; f <= 90; f++) assert.ok(Math.abs(z[f]! - 1.6) < 1e-9, `bekleme sirasinda ${f}. karede kayma`);
    assert.ok(Math.max(...z.slice(0, 92)) <= 1.6 + 1e-9, "kamera hedefi asti");
    assert.equal(z[93], 1.6);
    assert.ok(Math.abs(z[99]! - 2) < 0.05);
    assert.equal(z[109], 2);
    assert.equal(z[110], 1);
  });

  await scenario("I the filmed feel stays a feel: push-in ≤ 2.6%, drift a few pixels", () => {
    for (let f = 0; f <= 150; f += 5) {
      const v = filmCamera({ zoom: 1, cx: 0.5, cy: 0.5 }, "sahne-1", f, 150, FPS);
      assert.ok(v.zoom >= 1.006 - 1e-9 && v.zoom <= 1.026 + 1e-9, `zoom ${v.zoom}`);
      assert.ok(Math.abs(v.cx - 0.5) <= 0.0023 && Math.abs(v.cy - 0.5) <= 0.0017, `kayma ${v.cx}, ${v.cy}`);
    }
  });

  await scenario("J map tokens move without a leap: closing in, blows, losses, a line cut short, a rout", () => {
    // Owner, 26 Oct 2026, of the Kosovo close battle: "sanki takılarak hareket var, daha akıcı olması lazım". The old
    // pull switched on when an enemy came within 12 radii: up to 117 px in one frame; blows stopped dead half the time.
    const row = (y: number, n: number, x0 = 700) => Array.from({ length: n }, (_, i) => ({ x: x0 + i * 75, y }));
    const map = {
      units: [
        { side: "A", color: "#3a5eb3", emblem: "kalkan", kind: "suvari" as const, steps: [{ start: 9, points: row(420, 6), alive: 6 }, { start: 90, points: row(560, 6), alive: 6 }, { start: 140, points: row(600, 6), alive: 4, losses: [1.2, 2.4] }, { start: 260, points: row(200, 6, 500), alive: 3, rout: true, losses: [0.8] }] },
        { side: "B", color: "#3fae3a", emblem: "hilal", kind: "piyade" as const, steps: [{ start: 9, points: row(760, 7), alive: 7 }, { start: 140, points: row(740, 7), alive: 5, losses: [1.5, 2.7] }, { start: 260, points: row(700, 7), alive: 5 }] },
      ],
      fights: [{ start: 140, durationS: 4 }, { start: 260, durationS: 3.6 }],
    } as unknown as V3GeoMap;
    let prev: ({ x: number; y: number } | undefined)[][] | undefined;
    let prevV: number[][] = [];
    let worstJump = 0;
    let worstAcc = 0;
    for (let f = 0; f < 420; f++) {
      const now = placeTokens(map, f, 30, 1);
      const v: number[][] = [];
      now.forEach((side, ui) =>
        side.forEach((t, i) => {
          const p = prev?.[ui]?.[i];
          if (!t || !p) return;
          const step = Math.hypot(t.x - p.x, t.y - p.y);
          (v[ui] ??= [])[i] = step;
          const before = prevV[ui]?.[i];
          if (before === undefined) return;
          worstAcc = Math.max(worstAcc, Math.abs(step - before));
          if (step > 6) worstJump = Math.max(worstJump, step / Math.max(0.5, before));
        }),
      );
      prev = now.map((side) => side.map((t) => (t ? { x: t.x, y: t.y } : undefined)));
      prevV = v;
    }
    assert.ok(worstJump < 4, `a token leapt ${worstJump.toFixed(1)}× its last step`);
    assert.ok(worstAcc < 12, `speed changed by ${worstAcc.toFixed(1)} px in one frame`);
    // The fight still happens: in the middle of the first one the fronts have closed in on each other.
    const mid = placeTokens(map, 140 + 2 * 30, 30, 1);
    const calm = placeTokens({ ...map, fights: [] } as V3GeoMap, 140 + 2 * 30, 30, 1);
    const gapOf = (pl: typeof mid) => Math.min(...pl[0]!.flatMap((a) => pl[1]!.map((b) => (a && b && a.lostAt === undefined && b.lostAt === undefined ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity))));
    assert.ok(gapOf(mid) < gapOf(calm) - 20, `fronts close in: ${gapOf(mid).toFixed(0)} vs ${gapOf(calm).toFixed(0)} px`);
  });

  await scenario("J2 formations change without a leap (owner, 9 Nov 2026: \"yakın savaş sahnelerinde askerlerin hareketlerinde biraz atlama var\"): reordered places, two units swapping flanks, a line too tight for its tokens", () => {
    // Cannae and Waterloo, measured frame by frame: token i went to place i whatever the order (paths crossed), the
    // spacing pushed two passing tokens one way and then the other, and a line 30 px apart was folded into a zigzag
    // that turned over in one frame — 277 px and 201 px in one frame.
    const row = (y: number, n: number, x0: number, dx: number) => Array.from({ length: n }, (_, i) => ({ x: x0 + i * dx, y }));
    const map = {
      units: [
        // Its line given in the other order: the old way sent every token across the others.
        { side: "A", color: "#3a5eb3", emblem: "kalkan", kind: "kilicli" as const, steps: [{ start: 9, points: row(250, 5, 400, 90), alive: 5 }, { start: 60, points: row(330, 5, 760, -90), alive: 5 }] },
        // Two cavalries swapping flanks head-on, on one line.
        { side: "A", color: "#3a5eb3", emblem: "kalkan", kind: "suvari" as const, steps: [{ start: 9, points: row(600, 2, 300, 80), alive: 2 }, { start: 60, points: row(600, 2, 1300, 80), alive: 2 }] },
        { side: "B", color: "#3fae3a", emblem: "hilal", kind: "suvari" as const, steps: [{ start: 9, points: row(600, 2, 1300, 80), alive: 2 }, { start: 60, points: row(600, 2, 300, 80), alive: 2 }] },
        // A block that forms a line 30 px apart (room 69 px).
        { side: "B", color: "#3fae3a", emblem: "hilal", kind: "kilicli" as const, steps: [{ start: 9, points: [...row(900, 4, 600, 80), ...row(980, 3, 640, 80)], alive: 7 }, { start: 60, points: row(860, 7, 620, 30), alive: 7 }] },
        // Moves told later now set off later (NarratedMoves): a unit still sliding past a standing enemy is given its next
        // step (a rout) before it arrives — its new way, not yet begun, flipped the spacing (Cannae trial: 153 and 45 px).
        { side: "A", color: "#3a5eb3", emblem: "kalkan", kind: "suvari" as const, steps: [{ start: 9, points: row(1150, 2, 1400, 80), alive: 2 }, { start: 60, points: row(1150, 2, 300, 80), alive: 2 }, { start: 100, points: row(1080, 2, 150, 80), alive: 2, rout: true }] },
        { side: "B", color: "#3fae3a", emblem: "hilal", kind: "kilicli" as const, steps: [{ start: 9, points: [{ x: 880, y: 1150 }], alive: 1 }] },
      ],
    } as unknown as V3GeoMap;
    let prev: ({ x: number; y: number } | undefined)[][] | undefined;
    let prevV: { x: number; y: number }[][] = [];
    let worstStep = 0;
    let worstAcc = 0;
    for (let f = 0; f < 200; f++) {
      const now = placeTokens(map, f, 30, 1);
      const v: { x: number; y: number }[][] = [];
      now.forEach((side, ui) =>
        side.forEach((t, i) => {
          const p = prev?.[ui]?.[i];
          if (!t || !p) return;
          const d = { x: t.x - p.x, y: t.y - p.y };
          (v[ui] ??= [])[i] = d;
          worstStep = Math.max(worstStep, Math.hypot(d.x, d.y));
          const before = prevV[ui]?.[i];
          if (before) worstAcc = Math.max(worstAcc, Math.hypot(d.x - before.x, d.y - before.y));
        }),
      );
      prev = now.map((side) => side.map((t) => (t ? { x: t.x, y: t.y } : undefined)));
      prevV = v;
    }
    // A 1000 px charge in 2.8 s eased in and out peaks near 30 px a frame; a leap is a whole gap and more.
    assert.ok(worstStep < 40, `a token moved ${worstStep.toFixed(1)} px in one frame`);
    assert.ok(worstAcc < 12, `speed changed by ${worstAcc.toFixed(1)} px in one frame`);
    // Every token still ends in its formation, spaced: the line holds its tokens a room apart.
    const end = placeTokens(map, 199, 30, 1);
    const line = end[3]!.filter((t): t is NonNullable<typeof t> => t !== undefined);
    const closest = Math.min(...line.flatMap((a, i) => line.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
    assert.ok(closest > 69 * 0.95, `the tight line is spaced (${closest.toFixed(0)} px)`);
    assert.ok(end[1]!.every((t) => t && t.x > 1200) && end[2]!.every((t) => t && t.x < 450), "the cavalries got past each other");
  });

  await scenario("K guns fire in turn and musket lines in volleys while the fight is on, never outside it", () => {
    // Owner, after the Mohács trial: "topçu ve tüfekçi birlikleri ateş etmiyor".
    const row = (y: number, n: number) => Array.from({ length: n }, (_, i) => ({ x: 700 + i * 80, y }));
    const map = {
      units: [
        { side: "O", color: "#3fae3a", emblem: "hilal", kind: "topcu" as const, steps: [{ start: 0, points: row(700, 3), alive: 3 }] },
        { side: "O", color: "#3fae3a", emblem: "hilal", kind: "tufekci" as const, steps: [{ start: 0, points: row(760, 4), alive: 4 }] },
        { side: "H", color: "#3a5eb3", emblem: "kalkan", kind: "suvari" as const, steps: [{ start: 0, points: row(500, 4), alive: 4 }] },
      ],
      fights: [{ start: 60, durationS: 6 }],
    } as unknown as V3GeoMap;
    assert.deepEqual(gunfireAt(map, 30, 30), [], "no fight, no fire");
    const shots = Array.from({ length: 180 }, (_, k) => gunfireAt(map, 60 + k, 30)).flat();
    assert.ok(shots.every((s) => s.ui !== 2), "cavalry does not fire");
    const guns = new Set(shots.filter((s) => s.gun).map((s) => s.ti));
    assert.equal(guns.size, 3, "every gun of the battery fires");
    // A volley: when the musket line fires, all four tokens fire together; the guns one after another.
    const frames = Array.from({ length: 180 }, (_, k) => gunfireAt(map, 60 + k, 30));
    assert.ok(frames.some((f) => f.filter((s) => s.ui === 1 && s.p < 0.05).length === 4), "a volley of the whole line");
    assert.ok(frames.every((f) => f.filter((s) => s.gun && s.p < 0.03).length <= 1), "guns fire in turn");
  });

  await scenario("L a torpedo runs to the ship it sinks and strikes it there: wake, burst, water column, night flares (Taranto, 11 Nov 2026)", () => {
    // The Taranto Short: six Swordfish over the harbour, three Italian battleships, one lost at frame 189 + 2.4 s — it
    // went down with nothing hitting it, and the planes' target, once set, got a falling bomb instead of a torpedo.
    const ship = { x: 1818, y: 1063 };
    const raidEnd = { x: 1696, y: 1186 };
    const map = {
      era: "modern",
      cities: [],
      vehicles: [
        { kind: "ucak", color: "#3a7e6b", count: 6, start: 9, path: [{ x: 1371, y: 759 }, raidEnd], moveStart: 189 },
        { kind: "ucak", color: "#3a7e6b", count: 6, start: 329, path: [{ x: 2021, y: 1614 }, raidEnd], moveStart: 507 },
        { kind: "gemi", color: "#b3263a", count: 3, start: 9, path: [ship], lossStart: 189, losses: [2.4] },
        { kind: "ucak", color: "#3a7e6b", count: 3, start: 9, path: [{ x: 1371, y: 759 }], target: { x: ship.x + 20, y: ship.y - 10 }, fireStart: 120 },
        { kind: "ucak", color: "#3a7e6b", count: 3, start: 9, path: [{ x: 1371, y: 759 }], target: { x: 400, y: 400 }, fireStart: 120 },
        { kind: "top", color: "#3a7e6b", count: 2, start: 9, path: [{ x: 1500, y: 900 }], target: ship, fireStart: 120 },
      ],
    } as unknown as V3GeoMap;
    const down = 189 + Math.round(2.4 * FPS);
    assert.deepEqual(torpedoAttacker(map, 2, down), raidEnd, "the sunk battleship's torpedo comes from the raid");
    assert.equal(torpedoAttacker(map, 0, down), undefined, "a plane is not torpedoed");
    assert.equal(torpedoAttacker({ ...map, vehicles: map.vehicles!.map((v) => ({ ...v, color: "#b3263a" })) } as V3GeoMap, 2, down), undefined, "no torpedo from its own side");
    assert.equal(torpedoAttacker(map, 2, 5), undefined, "no torpedo before the planes are there");
    assert.ok(torpedoTarget(map, 3, 180), "planes sent at a ship drop torpedoes");
    assert.ok(!torpedoTarget(map, 4, 180) && !torpedoTarget(map, 5, 180), "planes sent at land bomb it; a gun fires shells");
    // It enters the water short of the ship on the raid's side, and never behind an attacker closer than its run.
    const from = torpedoStart(ship, raidEnd, 150);
    assert.ok(Math.abs(Math.hypot(from.x - ship.x, from.y - ship.y) - 150) < 1e-6 && from.x < ship.x && from.y > ship.y, "150 px short, towards the raid");
    assert.deepEqual(torpedoStart(ship, { x: ship.x + 40, y: ship.y }, 150), { x: ship.x + 40, y: ship.y }, "a close attacker drops it beside the ship");
    // The raid's route ended on the town south-west of the harbour: the run turns until it lies on the sea.
    const town = landRings(`M${ship.x - 400} ${ship.y + 30}L${ship.x - 20} ${ship.y + 30}L${ship.x - 20} ${ship.y + 400}L${ship.x - 400} ${ship.y + 400}Z`);
    assert.ok(onLand(town, raidEnd) && !onLand(town, ship), "the raid ends on land, the ship lies on the sea");
    const wet = torpedoStart(ship, raidEnd, 150, town);
    assert.ok([0.25, 0.5, 0.75, 1].every((f) => !onLand(town, { x: ship.x + (wet.x - ship.x) * f, y: ship.y + (wet.y - ship.y) * f })), `the whole run on the sea (${wet.x.toFixed(0)}, ${wet.y.toFixed(0)})`);
    assert.ok(Math.abs(Math.hypot(wet.x - ship.x, wet.y - ship.y) - 150) < 1e-6 && wet.x < ship.x + 75, "still its full run, turned no further than it must");
    // The run: no torpedo before the drop, the head glides in without a leap, then the strike stands where the ship is.
    assert.equal(torpedoAt(-0.01, from, ship), undefined);
    let last = from;
    let struck = -1;
    for (let f = 0; f * (1 / FPS) < TORPEDO_RUN_S + COLUMN_S; f++) {
      const run = torpedoAt(f / FPS, from, ship)!;
      assert.ok(run, `frame ${f} draws the torpedo`);
      assert.ok(Math.hypot(run.head.x - last.x, run.head.y - last.y) < 12, `no leap at frame ${f}`);
      last = run.head;
      if (run.impact !== undefined && struck < 0) struck = f;
    }
    assert.equal(struck, Math.round(TORPEDO_RUN_S * FPS), "it strikes when its run ends");
    assert.ok(Math.hypot(last.x - ship.x, last.y - ship.y) < 1e-6, "the strike is where the ship is drawn");
    assert.equal(torpedoAt(TORPEDO_RUN_S + COLUMN_S, from, ship), undefined, "gone once the column has fallen");
    // The water column shoots up, stands, falls back.
    const column = Array.from({ length: 21 }, (_, i) => waterColumn(i / 20)?.h ?? 0);
    const top = Math.max(...column);
    assert.ok(column[0] === 0 && column[20] === 0 && top > 2 && column.indexOf(top) < 10 && column[16]! < top, `up fast, then down (${column.map((h) => h.toFixed(1)).join(" ")})`);
    // The raid's flares: over the sunk ship from 2 s before it goes down, burning out after FLARE_S; the second wave came
    // after it and the gun is no plane — neither drops any.
    assert.deepEqual(raidOf(map, 0, FPS), { at: ship, frame: down });
    assert.deepEqual(raidOf(map, 3, FPS), { at: { x: ship.x + 20, y: ship.y - 10 }, frame: 120 }, "a raid with a target attacks it from fireStart");
    assert.equal(raidOf(map, 1, FPS), undefined);
    assert.equal(raidOf(map, 5, FPS), undefined);
    assert.deepEqual(flaresAt(down - 2 * FPS - 1, down, FPS, 0), []);
    const lit = flaresAt(down + FPS, down, FPS, 0);
    assert.equal(lit.length, 3, "three flares over the harbour as the torpedo strikes");
    assert.ok(lit.every((f) => f.glow > 0 && f.glow <= 1));
    assert.ok(flaresAt(down + 2 * FPS, down, FPS, 0)[0]!.dy > lit[0]!.dy, "they drift down");
    assert.deepEqual(flaresAt(down + Math.round((FLARE_S + 1) * FPS), down, FPS, 0), [], "and burn out");
  });

  await scenario("M a night map is dark with sweeping searchlights only when the script says so; a badge's words are full size in a Short", () => {
    assert.ok(!isNightMap({}) && !isNightMap({ zaman: "gun" }) && !isNightMap({ zaman: "aksam" }), "a map without `zaman` (or by day) is drawn as before");
    assert.ok(isNightMap({ zaman: "gece" }));
    const view = { x0: 1000, y0: 600, x1: 2600, y1: 1500 };
    const harbour = { era: "modern", zaman: "gece", cities: [{ x: 5000, y: 5000, label: "Far" }], vehicles: [{ kind: "gemi", color: "#b3263a", count: 3, start: 0, path: [{ x: 1818, y: 1063 }] }, { kind: "ucak", color: "#3a7e6b", count: 6, start: 0, path: [{ x: 1371, y: 759 }] }] } as unknown as V3GeoMap;
    const beams = searchlights(harbour, view, 0, FPS);
    assert.deepEqual(beams.map((b) => [b.x, b.y]), [[1818, 1063]], "from the ships in view, not a far city nor a plane");
    const open = searchlights({ ...harbour, vehicles: [] } as V3GeoMap, view, 0, FPS);
    assert.deepEqual(open.map((b) => [b.x, b.y]), [[1320, 1446], [2280, 1446]], "none in view: from just inside the view's lower corners");
    // They sweep slowly to and fro (no jump between frames), always above the horizon of their source.
    let prev = searchlights(harbour, view, 0, FPS);
    let [lo, hi] = [beams[0]!.angle, beams[0]!.angle];
    for (let f = 1; f < 600; f++) {
      const now = searchlights(harbour, view, f, FPS);
      now.forEach((b, i) => {
        assert.ok(Math.abs(b.angle - prev[i]!.angle) < 0.03, `smooth sweep at frame ${f}`);
        assert.ok(b.angle < 0 && b.angle > -Math.PI, "pointing up");
      });
      [lo, hi] = [Math.min(lo, now[0]!.angle), Math.max(hi, now[0]!.angle)];
      prev = now;
    }
    assert.ok(hi - lo > 1.2, `the beam sweeps to and fro (${(hi - lo).toFixed(2)} rad)`);
    // Owner, 11 Nov 2026: the thin white words over the Taranto map could not be read on the phone.
    assert.equal(mapBubbleSize(true), 1);
    assert.equal(mapBubbleSize(false), MAP_BUBBLE);
  });

  console.log(`V3 motion smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
