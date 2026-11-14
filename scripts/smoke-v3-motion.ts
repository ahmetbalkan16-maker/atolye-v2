/**
 * V3 smoke: motion fluency. A test performer runs gestures, speech, a walk, a turn and expression changes;
 * every animated channel is sampled per frame and checked for robotic snaps (acceleration spikes), pops
 * (one-frame jumps), instant mirror flips, frame-order dependence and failure to settle.
 * Pure (no Remotion render). Run: npx tsx scripts/smoke-v3-motion.ts
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DrawnSetBack, DrawnSetFront, flameBox, lightSpots, type SetCover, torchSpots } from "../remotion-v3/src/scene/DrawnSet";
import { performerState, type PerformerState } from "../remotion-v3/src/character/motion";
import { cameraAt, clampView, coverShake, filmCamera, type Shake, shakeAt, type View } from "../remotion-v3/src/scene/camera";
import { COLUMN_S, FLARE_S, flaresAt, isNightMap, landRings, MAP_BUBBLE, mapBubbleSize, onLand, raidOf, searchlights, TORPEDO_RUN_S, torpedoAt, torpedoAttacker, torpedoStart, torpedoTarget, waterColumn } from "../remotion-v3/src/scene/mapEffects";
import { armyDots, blockDotCount, blockDots, crowdFigures, crowdGrid, DEFAULT_MEN_PER_BLOCK, DOTS_MIN, facingDir, fitInRing, garrisonSteps, menOf, ringDepth, THIN_MAX, thinShare } from "../remotion-v3/src/scene/unitCrowd";
import { cloudShadowsAt, fieldLayout, smoothRiver, woodLayout } from "../remotion-v3/src/scene/mapNature";
import { passShare, type TokenWay, waysSwap } from "../remotion-v3/src/scene/unitLayout";
import { applyMatrix, atlasCornerSeen, MAX_TILT_DEG, TILT_SHOT_PUSH, TILT_WORLD_PAST, tiltAt, tiltFit, tiltFor, tiltItems, tiltMatrix, tiltProject, tiltRoom, tiltSeen, tiltUnproject, uprightScale } from "../remotion-v3/src/scene/tilt";
import { type V3CameraKey, type V3DrawnSet, type V3GeoMap, type V3Performer, type V3Shot, type V3Viseme, wallIsRing } from "../src/lib/v3/render/RenderPlanTypes";

// MapUnits.tsx imports "remotion", which only remotion-v3/node_modules provides. A static import pulls it into the root
// type check, and the live snapshot (root `npm ci` only) then fails `next build` with TS2307 — so it loads at run time.
interface MapUnitsModule {
  placeTokens(map: V3GeoMap, frame: number, fps: number, k: number, end?: number): ({ x: number; y: number; lostAt?: number; alpha: number } | undefined)[][];
  slideFrames(steps: NonNullable<V3GeoMap["units"]>[number]["steps"], fps: number): number[];
  gunfireAt(map: V3GeoMap, frame: number, fps: number): { ui: number; ti: number; p: number; gun: boolean; shot: number }[];
  volleysAt(map: V3GeoMap, frame: number, fps: number): { ui: number; ti: number; p: number; shot: number }[];
  steadyFacingsAt(map: V3GeoMap, placed: ReturnType<MapUnitsModule["placeTokens"]>, frame: number, fps: number, k: number): number[][];
  lostTokens(u: NonNullable<V3GeoMap["units"]>[number], fps: number): { ti: number; at: number; step: number }[];
  fallenRest(map: V3GeoMap, ui: number, l: { ti: number; at: number; step: number }, fps: number, k: number): { x: number; y: number } | undefined;
  menPerBlock(units: NonNullable<V3GeoMap["units"]>, ui: number): number | undefined;
  unitDotsAt(map: V3GeoMap, placed: ReturnType<MapUnitsModule["placeTokens"]>, facings: number[][], frame: number, fps: number, k: number): { dots: (({ dots: { x: number; y: number; r: number; gone: number }[] } | undefined)[] | undefined)[]; guns: ({ x: number; y: number }[] | undefined)[] };
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
  const { gunfireAt, placeTokens, volleysAt, steadyFacingsAt, lostTokens, fallenRest, menPerBlock, slideFrames, unitDotsAt } = (await import(MAP_UNITS)) as MapUnitsModule;
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
    for (let f = 0; f < 300; f++) {
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
    // A 1000 px charge eased in and out over its 7 s (slideFrames: at most SLIDE_MAX_S) peaks near 14 px a frame; a leap
    // is a whole gap and more.
    assert.ok(worstStep < 40, `a token moved ${worstStep.toFixed(1)} px in one frame`);
    assert.ok(worstAcc < 12, `speed changed by ${worstAcc.toFixed(1)} px in one frame`);
    // Every token still ends in its formation, spaced: the line holds its tokens a room apart.
    const end = placeTokens(map, 299, 30, 1);
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

  await scenario("N a gun's shake never shows the empty frame at the set's edge: the set grows and moves just enough (Guadalcanal, 12 Nov 2026: 36 px dark band at the top)", () => {
    const [W, H] = [1920, 1080];
    // The frame's corners through ShotView's transform, back onto the stage: every one must lie on it.
    const exposed = (v: View, s: Shake) => {
      const a = (s.rot * Math.PI) / 180;
      let worst = 0;
      for (const [px, py] of [[0, 0], [W, 0], [0, H], [W, H]] as const) {
        const [qx, qy] = [px - W / 2 - s.dx, py - H / 2 - s.dy];
        const x = v.cx * W + (qx * Math.cos(a) + qy * Math.sin(a)) / v.zoom;
        const y = v.cy * H + (-qx * Math.sin(a) + qy * Math.cos(a)) / v.zoom;
        worst = Math.max(worst, -x, x - W, -y, y - H);
      }
      return worst;
    };
    // Without a shake it is the old clamp exactly: nothing changes for a calm shot.
    for (const v of [{ zoom: 1.03, cx: 0.5, cy: 0.5 }, { zoom: 1.4, cx: 0.2, cy: 0.9 }, { zoom: 0.9, cx: 0.5, cy: 0.5 }]) {
      const [now, was] = [coverShake(v, { dx: 0, dy: 0, rot: 0 }, W, H), clampView(v.zoom, v.cx, v.cy)];
      for (const k of ["zoom", "cx", "cy"] as const) assert.ok(Math.abs(now[k] - was[k]) < 1e-12, `${k}: ${now[k]} vs ${was[k]}`);
    }
    // A cannon shot (26) and a shake cue (18) at once, the view pushed against the top: the old clamp left the band.
    const set = { zoom: (1 + 0.2 * 0.72) * 1.03, cx: 0.5, cy: 0.42 };
    const shot = { shakes: [{ start: 0, end: 21, amplitude: 26 }, { start: 0, end: 18, amplitude: 18 }] } as unknown as V3Shot;
    const old = clampView(set.zoom, set.cx, set.cy);
    let before = 0;
    for (let f = 0; f < 21; f++) {
      const s = shakeAt(shot, f);
      before = Math.max(before, exposed(old, s));
      const v = coverShake(set, s, W, H);
      assert.ok(exposed(v, s) < 1e-6, `frame ${f}: ${exposed(v, s).toFixed(1)} px of empty frame`);
      // Grown only as much as the shake needs (the 44 px shake and its turn: a few per cent).
      assert.ok(v.zoom >= old.zoom - 1e-9 && v.zoom <= old.zoom * 1.06, `zoom ${v.zoom.toFixed(3)}`);
    }
    assert.ok(before > 10, `the old clamp showed the empty frame (${before.toFixed(1)} px)`);
  });

  // Owner, 12 Nov 2026: "yakın çekim haritalandırmada askerlerin hareketleri taktikler harita ortamı daha gerçekçi, ordu
  // sayısı daha fazla gözüksün" — a block is a regiment of soldiers, each block faces its own enemies, archers shoot,
  // the fallen stay on the field.
  const battle = () => {
    const row = (y: number, n: number, x0 = 700) => Array.from({ length: n }, (_, i) => ({ x: x0 + i * 75, y }));
    return {
      units: [
        { side: "A", color: "#f2f2f2", emblem: "kartal", kind: "kilicli" as const, label: "Eight legions – 86,000 men", steps: [{ start: 9, points: row(420, 6), alive: 6 }, { start: 90, points: row(560, 6), alive: 6 }, { start: 140, points: row(600, 6), alive: 4, losses: [1.2, 2.4] }, { start: 260, points: row(200, 6, 500), alive: 3, rout: true, losses: [0.8] }] },
        { side: "B", color: "#3fae3a", emblem: "hilal", kind: "okcu" as const, steps: [{ start: 9, points: row(760, 3, 760), alive: 3 }] },
        // A wing sweeping round the flank: it turns towards its way, then towards the enemy it reaches.
        { side: "B", color: "#3fae3a", emblem: "hilal", kind: "suvari" as const, steps: [{ start: 9, points: row(760, 2, 300), alive: 2 }, { start: 100, points: row(500, 2, 1300), alive: 2 }] },
      ],
      fights: [{ start: 140, durationS: 4 }, { start: 260, durationS: 3.6 }],
    } as unknown as V3GeoMap;
  };

  await scenario("O a block is a regiment: ranks of soldiers inside it, as many as its strength, thinning as its unit loses", () => {
    assert.equal(menOf("11 Legions – 47,000 men"), 47000);
    assert.equal(menOf("86.000 asker"), 86000);
    assert.equal(menOf("Eight legions"), undefined);
    assert.equal(menOf(undefined), undefined);
    // A year is no army (the Baghdad labels: "Janissaries 1638" read as 1,638 men, claimed as written on the legend);
    // a year-sized number of men is ("1500 men", "1200-strong").
    assert.deepEqual([menOf("Janissaries 1638"), menOf("25 December 1638"), menOf("Garrison, 1638 · 20,000 men"), menOf("1500 men"), menOf("1200-strong garrison"), menOf("1638 asker"), menOf("1,638 men")], [undefined, undefined, 20000, 1500, 1200, 1638, 1638]);
    assert.equal(armyDots([{ side: "Ottomans", kind: "piyade", label: "Janissaries 1638", steps: [{ points: [{ x: 0, y: 0 }] }] }]).written[0], false, "an unnumbered unit claims no written number");
    const dense = crowdGrid("kilicli", 10_000);
    const sparse = crowdGrid("kilicli", 120);
    assert.ok(dense.cols * dense.rows > sparse.cols * sparse.rows, "few men, a thinner block");
    assert.deepEqual(crowdGrid("kilicli"), dense, "no number: a full regiment");
    for (const kind of ["kilicli", "mizrakci", "okcu", "tufekci", "suvari", "topcu", "piyade"] as const) {
      const grid = crowdGrid(kind, 5000);
      const figs = crowdFigures(kind, grid, 64, 46, 7);
      assert.ok(figs.length >= 3, `${kind}: ${figs.length} figures`);
      assert.ok(figs.every((f) => Math.abs(f.x) <= 32 && Math.abs(f.y) <= 23), `${kind}: a figure outside its block`);
      assert.deepEqual(crowdFigures(kind, grid, 64, 46, 7), figs, "the same block always gets the same figures");
    }
    assert.ok(crowdFigures("kilicli", dense, 64, 46, 7).length >= 30, "a dense block of foot holds 30+ soldiers");
    let last = 0;
    for (const share of [0, 0.1, 0.3, 0.6, 1]) {
      const t = thinShare(share);
      assert.ok(t >= last && t <= THIN_MAX, `thinning ${t} at ${share}`);
      last = t;
    }
    const map = battle();
    assert.equal(Math.round(menPerBlock(map.units!, 0)!), Math.round(86000 / 6));
    assert.equal(menPerBlock(map.units!, 1), undefined, "a side with no number: none");
  });

  await scenario("P each block faces its own enemies and turns smoothly — never a flip — and a sweeping wing faces its way", () => {
    const map = battle();
    let prev: number[][] | undefined;
    let prevShown: boolean[][] | undefined;
    let worst = 0;
    let sweepTurned = false;
    for (let f = 0; f < 420; f++) {
      const placed = placeTokens(map, f, 30, 1);
      const now = steadyFacingsAt(map, placed, f, 30, 1);
      now.forEach((side, ui) =>
        side.forEach((a, i) => {
          const b = prev?.[ui]?.[i];
          if (!placed[ui]![i] || !prevShown?.[ui]?.[i] || b === undefined) return;
          worst = Math.max(worst, Math.abs(((a - b + 540) % 360) - 180));
        }),
      );
      // Mid-sweep the wing (eastwards, 90°) faces its way rather than the enemy north of it (0°).
      if (f === 130) sweepTurned = Math.abs(((now[2]![0]! - 90 + 540) % 360) - 180) < 50;
      prev = now;
      prevShown = placed.map((side) => side.map((t) => t !== undefined));
    }
    // A wing that rode past the enemy and faces back at it turns ~155° in half a second, ~11° a frame at most (before:
    // 171° in one frame as the side appeared, 32° as the wing arrived).
    assert.ok(worst < 14, `a block turned ${worst.toFixed(1)}° in one frame`);
    assert.ok(sweepTurned, "the sweeping wing faces the way it rides");
    // Enemies on both hands never cancel out to nothing: it faces the way its side faces.
    const d = facingDir({ x: 0, y: 0 }, [{ x: -100, y: 0, w: 1 }, { x: 100, y: 0, w: 1 }], { x: 0, y: -1 }, 23);
    assert.ok(Math.hypot(d.x, d.y) > 0.99 && d.y < -0.9, "encircled: it faces the way its side faces");
  });

  await scenario("Q archers loose volleys together while the fight is on, never outside it; nobody else shoots arrows", () => {
    const map = battle();
    assert.deepEqual(volleysAt(map, 100, 30), [], "no fight, no arrows");
    const frames = Array.from({ length: 120 }, (_, k) => volleysAt(map, 140 + k, 30));
    assert.ok(frames.flat().every((v) => v.ui === 1), "only the archer unit shoots");
    assert.ok(frames.flat().length > 0, "the archers shoot");
    assert.ok(frames.some((f) => f.filter((v) => v.p < 0.25).length === 3), "the whole unit looses together");
    assert.ok(frames.flat().every((v) => v.p >= 0 && v.p < 1));
  });

  await scenario("R a lost block falls where it fought and its fallen stay on the field to the end", () => {
    const map = battle();
    const lost = lostTokens(map.units![0]!, 30);
    assert.deepEqual(lost.map((l) => l.ti), [4, 5, 3], "the blocks tokenAt drops, in order");
    for (const l of lost) {
      const t = placeTokens(map, l.at + 1, 30, 1)[0]![l.ti];
      assert.ok(t && t.lostAt === l.at, `token ${l.ti} falls at ${l.at}`);
      const rest = fallenRest(map, 0, l, 30, 1);
      assert.ok(rest, `token ${l.ti} has a resting place`);
      const off = Math.hypot(rest!.x - t!.x, rest!.y - t!.y);
      assert.ok(off < 60, `its fallen lie where it fell (${off.toFixed(0)} px)`);
      assert.deepEqual(fallenRest(map, 0, l, 30, 1), rest, "the same place whichever frame asks first");
    }
  });

  await scenario("S the close map's ground lives: cloud shadows drift smoothly as a pure function of the frame, woods are dense masses, rivers bend (owner, 12 Nov 2026: \"harita ortamı daha gerçekçi\")", () => {
    const world = { width: 1920, height: 1080 };
    const u = 26.2;
    // Pure: the same frame gives the same shadows whatever was asked before (Remotion renders frames out of order).
    const late = cloudShadowsAt(900, 30, world, u);
    cloudShadowsAt(3, 30, world, u);
    assert.deepEqual(cloudShadowsAt(900, 30, world, u), late, "frame 900 is the same whenever it is rendered");
    const outside = (c: { x: number; y: number; rx: number }) => c.x + c.rx < 0 || c.x - c.rx > world.width || c.y + c.rx < 0 || c.y - c.rx > world.height;
    let prev = cloudShadowsAt(0, 30, world, u);
    let moved = 0;
    for (let f = 1; f <= 30 * 600; f++) {
      const now = cloudShadowsAt(f, 30, world, u);
      assert.equal(now.length, prev.length, "the same clouds every frame");
      assert.ok(now.some((c) => !outside(c)), `frame ${f}: some shadow over the world`);
      now.forEach((c, i) => {
        const p = prev[i]!;
        const step = Math.hypot(c.x - p.x, c.y - p.y);
        // A cloud wraps round only where it cannot be seen: wholly outside the world on both frames.
        if (step > 1) assert.ok(outside(c) && outside(p), `frame ${f}: cloud ${i} jumped ${step.toFixed(1)} px in sight`);
        else moved = Math.max(moved, step);
        assert.ok(c.opacity >= 0.06 && c.opacity <= 0.15, "a shadow, not a dark blot");
      });
      prev = now;
    }
    assert.ok(moved > 0.05 && moved < 0.5, `a few px a second (${(moved * 30).toFixed(1)} px/s)`);
    // A wood is one mass of many overlapping crowns, the same every time, drawn back to front.
    const wood = woodLayout(1000, 400, 128, 12, u);
    assert.deepEqual(woodLayout(1000, 400, 128, 12, u), wood);
    assert.ok(wood.trees.length >= 20, `${wood.trees.length} trees in a 5-house wood`);
    assert.ok(wood.trees.every((t, i) => i === 0 || t.y >= wood.trees[i - 1]!.y), "back to front");
    const field = fieldLayout(147, 3, u);
    assert.ok(field.strips.length >= 3 && field.strips.every((s) => s.furrows.length > 0), "strips with furrows");
    // A river's corners are rounded, its ends kept, and it never leaves its line by more than the reach.
    const river = smoothRiver("M0 0 L100 0 L100 100 L200 100", 20);
    assert.ok(river.startsWith("M0 0") && river.endsWith("L200 100") && river.includes("Q100 0"), river);
    assert.ok(river.includes("L80 0") && river.includes("100 20"), "the bend starts 20 px before the corner");
    assert.equal(smoothRiver("M0 0 C10 10 20 20 30 30", 20), "M0 0 C10 10 20 20 30 30", "a curve is left as it is");
  });

  await scenario("T the tilted close map (owner's trial, 12 Nov 2026): the browser's matrix and the names' projection agree, the framed picture stays whole in the frame, the far side is smaller, no sky", () => {
    const W = 1920;
    const H = 1080;
    const t = tiltFor(30, W, H);
    // The ground's CSS matrix (an element whose (0,0) is the picture's (-ox,-oy)) puts every point where tiltProject does.
    const ox = 400;
    const oy = 260;
    const m = tiltMatrix(t, ox, oy);
    for (let x = -300; x <= W + 300; x += 111)
      for (let y = -200; y <= H + 150; y += 97) {
        const a = applyMatrix(m, x + ox, y + oy);
        const b = tiltProject(t, x, y);
        assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6, `(${x}, ${y}): matrix ${a.x},${a.y} vs ${b.x},${b.y}`);
        const back = tiltUnproject(t, b.x, b.y);
        assert.ok(Math.abs(back.x - x) < 1e-6 && Math.abs(back.y - y) < 1e-6, "unproject undoes project");
      }
    // The picture the director framed stays whole in the frame, its near edge as wide as the frame, centred.
    const corners = [tiltProject(t, 0, 0), tiltProject(t, W, 0), tiltProject(t, 0, H), tiltProject(t, W, H)];
    for (const c of corners) assert.ok(c.x >= -1e-6 && c.x <= W + 1e-6 && c.y >= -1e-6 && c.y <= H + 1e-6, `corner ${c.x},${c.y} in the frame`);
    assert.ok(Math.abs(corners[2]!.x) < 1e-6 && Math.abs(corners[3]!.x - W) < 1e-6, "the near edge spans the frame");
    assert.ok(Math.abs(corners[0]!.y - (H - corners[2]!.y)) < 1e-6, "as much ground above as below");
    // The far side smaller, not tiny (a camera ~30° off straight down).
    const far = tiltProject(t, W / 2, 0).scale;
    const near = tiltProject(t, W / 2, H).scale;
    assert.ok(far / near > 0.7 && far / near < 0.8, `far/near ${far / near}`);
    assert.ok(tiltProject(t, W / 2, H / 2).scale > 0.84, "the middle not shrunk much");
    // scaleY is how much a short step up the ground shortens on the screen (the room kept above a speaking badge).
    for (const y of [0, 300, 540, 900, H]) {
      const p0 = tiltProject(t, 700, y);
      const p1 = tiltProject(t, 700, y + 1e-3);
      assert.ok(Math.abs((p1.y - p0.y) / 1e-3 - p0.scaleY) < 1e-4, `row ${y}: ${p0.scaleY}`);
    }
    // The ground drawn (cover) is everything the frame sees, in front of the horizon; what is surely seen (inside)
    // lands in the frame and holds the framed picture.
    const { cover, inside } = tiltSeen(t, { x0: 0, y0: 0, x1: W, y1: H });
    for (const [X, Y] of [[0, 0], [W, 0], [0, H], [W, H], [W / 2, 0]] as const) {
      const p = tiltUnproject(t, X, Y);
      assert.ok(p.x >= cover.x0 - 1e-6 && p.x <= cover.x1 + 1e-6 && p.y >= cover.y0 - 1e-6 && p.y <= cover.y1 + 1e-6, "cover holds what the frame sees");
    }
    assert.ok(1 - (t.s * Math.sin(Math.PI / 6) * (cover.y0 - H / 2)) / t.P > 0 && tiltProject(t, W / 2, cover.y0).y > -1, "the far ground is in front of the eye");
    for (const [x, y] of [[inside.x0, inside.y0], [inside.x1, inside.y0], [inside.x0, inside.y1], [inside.x1, inside.y1]] as const) {
      const p = tiltProject(t, x, y);
      assert.ok(p.x >= -1e-6 && p.x <= W + 1e-6 && p.y >= -1e-6 && p.y <= H + 1e-6, "inside lands in the frame");
    }
    assert.ok(inside.x0 <= 1e-6 && inside.x1 >= W - 1e-6 && inside.y0 <= 0 && inside.y1 >= H - 1e-6, "the framed picture is surely seen");
    // No tilt: the flat picture unchanged; a steep request is held to the limit.
    const flat = tiltFor(0, W, H);
    const p = tiltProject(flat, 321, 654);
    assert.ok(Math.abs(p.x - 321) < 1e-9 && Math.abs(p.y - 654) < 1e-9 && flat.s === 1);
    assert.equal(tiltFor(70, W, H).deg, MAX_TILT_DEG);
  });

  await scenario("U the tilted close map frames the action (owner, 13 Nov 2026: \"düzeltip aç\", \"ordu sayısı daha fazla gözüksün\"): the armies at least as large as flat, the action, speakers and battle whole in the frame, the ground never past the world, names' room up the foreshortened ground", () => {
    const W = 1920;
    const H = 1080;
    const fps = 30;
    // A one-view close map (MapBuilder: a world 1.5× the view, the camera holding the view at its middle).
    const world = { width: 2976, height: 1674 };
    const cam = { frame: 0, x: world.width / 2, y: world.height / 2, zoom: 1 };
    const wx = (x: number) => cam.x + x - W / 2;
    const wy = (y: number) => cam.y + y - H / 2;
    const units = [
      { side: "A", color: "#c0392b", emblem: "hilal", kind: "piyade" as const, steps: [{ start: 9, points: [700, 760, 820, 880].map((x) => ({ x: wx(x), y: wy(560) })), alive: 4 }, { start: 200, points: [760, 820, 880, 940].map((x) => ({ x: wx(x), y: wy(520) })), alive: 4 }] },
      { side: "B", color: "#2e86c1", emblem: "hac", kind: "suvari" as const, steps: [{ start: 9, points: [1100, 1160, 1220].map((x) => ({ x: wx(x), y: wy(380) })), alive: 3 }] },
    ];
    const badge = { castId: "x", label: "Hannibal", start: 9, path: [{ x: wx(520), y: wy(700) }], talk: { speaking: [{ start: 120, end: 180 }], visemes: [], faces: [] } };
    const map = { land: "", lakes: "", rivers: "", territories: [], cities: [], armies: [], arrows: [], relief: "bg/r.jpg", world, camera: [cam], units, badges: [badge], battles: [{ x: wx(640), y: wy(470), label: "Battle of Somewhere", start: 9, labelSpot: { x: wx(640), y: wy(470), dx: 0, dy: -144 } }], tilt: 30 } as unknown as V3GeoMap;
    const t = tiltAt(map, 150, fps, W, H)!;
    const base = tiltFor(30, W, H);
    assert.ok(t.s > base.s + 0.1, `closer than the whole picture's fit: ${t.s} vs ${base.s}`);
    // The armies at least as large as flat: every block at least as wide, their mean area at least as large.
    const pts = units.flatMap((u) => u.steps.flatMap((st) => st.points)).map((q) => ({ x: W / 2 + q.x - cam.x, y: H / 2 + q.y - cam.y }));
    const pr = pts.map((q) => tiltProject(t, q.x, q.y));
    assert.ok(Math.min(...pr.map((q) => q.scale)) >= 1 - 1e-6, `every block as wide: ${Math.min(...pr.map((q) => q.scale))}`);
    assert.ok(pr.reduce((a, q) => a + q.scale * q.scaleY, 0) / pr.length >= 1 - 1e-6, "their mean area as large");
    // Everything the camera keeps (tiltItems: blocks, the speaking badge, the battle and its name) whole inside the frame
    // the shot's push leaves.
    const [key] = tiltItems(map, fps, W, H);
    assert.ok(key!.items.length === 4 + 4 + 3 + 1 + 2, `items ${key!.items.length}`);
    const inX = (W / 2 - 0.03 * H) / TILT_SHOT_PUSH;
    const inY = (H / 2 - 0.03 * H) / TILT_SHOT_PUSH;
    for (const it of key!.items) {
      const q = tiltProject(t, it.x, it.y);
      const sx = it.ground ? q.scale : uprightScale(q);
      const sy = it.ground ? q.scaleY : uprightScale(q);
      assert.ok(q.x - it.l * sx >= W / 2 - inX - 1e-3 && q.x + it.r * sx <= W / 2 + inX + 1e-3, `across: ${JSON.stringify(it)}`);
      assert.ok(q.y - it.u * sy >= H / 2 - inY - 1e-3 && q.y + it.d * sy <= H / 2 + inY + 1e-3, `up and down: ${JSON.stringify(it)}`);
    }
    // The ground the frame shows lies on the world (a quarter of the picture past it on every side).
    const { cover } = tiltSeen(t, { x0: 0, y0: 0, x1: W, y1: H });
    assert.ok(cover.x0 >= -W * TILT_WORLD_PAST - 1e-3 && cover.x1 <= W * (1 + TILT_WORLD_PAST) + 1e-3 && cover.y0 >= -H * TILT_WORLD_PAST - 1e-3 && cover.y1 <= H * (1 + TILT_WORLD_PAST) + 1e-3, JSON.stringify(cover));
    // A panned tilt: the browser's matrix and the projection still agree, unproject still undoes it.
    const panned = { ...t, cx: W / 2 + 140 };
    const m = tiltMatrix(panned, 300, 200);
    for (const [x, y] of [[-100, -50], [400, 300], [1500, 900], [2000, 1200]] as const) {
      const a = applyMatrix(m, x + 300, y + 200);
      const b = tiltProject(panned, x, y);
      assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6, "matrix = projection with a pan");
      const back = tiltUnproject(panned, b.x, b.y);
      assert.ok(Math.abs(back.x - x) < 1e-6 && Math.abs(back.y - y) < 1e-6, "unproject undoes a panned project");
    }
    // Upright names: never larger than flat; up the foreshortened far ground they take more of the flat picture.
    assert.ok(uprightScale(tiltProject(t, W / 2, H)) === 1 && uprightScale(tiltProject(t, W / 2, 0)) < 1);
    const far = tiltRoom(t, W / 2, 100);
    const near = tiltRoom(t, W / 2, 1000);
    assert.ok(far.fy > 1.2 && far.fy > near.fy && near.fx < 1 && far.fx <= 1 + 1e-9, JSON.stringify({ far, near }));
    // Pure in the frame (asked twice, the same), and glides with the map's camera between keys: no jump.
    assert.deepEqual(tiltAt(map, 150, fps, W, H), t);
    const moving = { ...map, camera: [cam, { frame: 240, x: cam.x + 300, y: cam.y, zoom: 1.4 }] } as V3GeoMap;
    let last = tiltAt(moving, 230, fps, W, H)!;
    for (let f = 231; f < 330; f++) {
      const now = tiltAt(moving, f, fps, W, H)!;
      assert.ok(Math.abs(now.s - last.s) < 0.01 && Math.abs(now.ys - last.ys) < 8 && Math.abs(now.cx - last.cx) < 8, `frame ${f}: ${JSON.stringify({ last, now })}`);
      last = now;
    }
    // Nothing to frame: the whole picture's tilt. An item the flat picture's edge already cuts is cut no more.
    assert.deepEqual(tiltFit(30, W, H, []), base);
    const edge = { x: 5, y: 540, l: 80, r: 80, u: 80, d: 80, ground: true };
    const te = tiltFit(30, W, H, [edge]);
    const qe = tiltProject(te, edge.x, edge.y);
    assert.ok(qe.x - edge.l * qe.scale >= edge.x - edge.l - 1e-3, JSON.stringify(te));
    // A flat map has no tilt.
    assert.equal(tiltAt({ ...map, tilt: undefined } as V3GeoMap, 150, fps, W, H), undefined);
    // A ship group is kept whole, not its flagship alone (Guadalcanal s2, 14 Nov 2026: the tilt kept the US flagship near
    // the right edge and cut the four ships of its wedge behind it): the wedge (MapVehicles: rows 1.5 tokens back and
    // 1.1 aside, 30 px a token) stays in the frame round the group's place.
    const fleetMap = (count: number) => ({ ...map, units: [], badges: [], battles: [], vehicles: [{ kind: "gemi", color: "#888888", count, start: 9, path: [{ x: wx(1650), y: wy(560) }] }] }) as unknown as V3GeoMap;
    const lone = tiltItems(fleetMap(1), fps, W, H)[0]!.items[0]!;
    const group = tiltItems(fleetMap(5), fps, W, H)[0]!.items[0]!;
    const wedge = 2 * 1.5 * 30 + 30;
    assert.ok(group.r >= wedge && group.l >= wedge && group.u >= wedge && group.d >= wedge && lone.r < wedge, JSON.stringify({ lone, group }));
    const tf = tiltAt(fleetMap(5), 150, fps, W, H)!;
    const rear = tiltProject(tf, group.x + wedge, group.y + wedge);
    assert.ok(rear.x <= W && rear.y <= H, `the wedge's last ship in the frame: ${JSON.stringify(rear)}`);
    // The atlas corner's ground on the tilted map (Baghdad s2, 14 Nov 2026: "MEDITERRANEAN SEA" ran over the scale bar
    // once tilted): the flat-picture box MapView moves names up off lands on the screen's corner (50–360 px, the bottom
    // 275 px), and the enlarged near rows make it reach above the flat map's corner.
    const corner = atlasCornerSeen(t, { x0: 0, y0: 0, x1: W, y1: H }, { width: W, height: H });
    const topLeft = tiltProject(t, corner.x0, corner.y0);
    const topRight = tiltProject(t, corner.x1, corner.y0);
    assert.ok(topLeft.y <= H - 275 + 1e-6 && topRight.y <= H - 275 + 1e-6 && topLeft.x <= 50 + 1e-6 && topRight.x >= 360 - 1e-6, JSON.stringify({ corner, topLeft, topRight }));
    const flatEdge = tiltProject(t, 205, H - 275);
    assert.ok(Math.abs(flatEdge.y - (H - 275)) > 1, `a tilt moves the flat corner's edge on the screen: ${flatEdge.y}`);
  });

  /** A map's tokens frame by frame: the largest step, the largest change of speed and the turns back (> 170°, steps over 2 px). */
  const motionOf = (map: V3GeoMap, frames: number, end?: number) => {
    let prev: ({ x: number; y: number } | undefined)[][] | undefined;
    let prevV: ({ x: number; y: number } | undefined)[][] = [];
    let step = 0;
    let acc = 0;
    let flips = 0;
    for (let f = 0; f < frames; f++) {
      const now = placeTokens(map, f, 30, 1, end);
      prevV = now.map((side, ui) =>
        side.map((t, i) => {
          const p = prev?.[ui]?.[i];
          if (!t || !p) return undefined;
          const d = { x: t.x - p.x, y: t.y - p.y };
          const l = Math.hypot(d.x, d.y);
          step = Math.max(step, l);
          const b = prevV[ui]?.[i];
          if (b) {
            acc = Math.max(acc, Math.hypot(d.x - b.x, d.y - b.y));
            const lb = Math.hypot(b.x, b.y);
            if (l > 2 && lb > 2 && (d.x * b.x + d.y * b.y) / (l * lb) < Math.cos((170 * Math.PI) / 180)) flips++;
          }
          return d;
        }),
      );
      prev = now.map((side) => side.map((t) => (t ? { x: t.x, y: t.y } : undefined)));
    }
    return { step, acc, flips };
  };

  await scenario("V a slide lasts as long as its way (owner, 13 Nov 2026: \"askerlerin hareketleri akıcı olması lazım\"): a long march keeps a steady pace, a short one its 2.8 s, a formation marches as one and ends before its shot", () => {
    // Siege of Baghdad Short, measured: every slide took 2.8 s whatever its length — a 600 px way peaked at 15–21 px a frame.
    const one = (dx: number, zoom = 1) =>
      ({
        units: [{ side: "A", color: "#3a5eb3", emblem: "kalkan", kind: "piyade" as const, steps: [{ start: 9, points: [{ x: 200, y: 500 }], alive: 1 }, { start: 30, points: [{ x: 200 + dx, y: 500 }], alive: 1 }] }],
        camera: [{ frame: 0, x: 960, y: 540, zoom }],
      }) as unknown as V3GeoMap;
    // The first frame the token stands on its goal (the eased slide lands on it exactly).
    const arrives = (map: V3GeoMap, end?: number) => {
      const goal = map.units![0]!.steps[1]!.points[0]!.x;
      for (let f = 30; f < 400; f++) if (placeTokens(map, f, 30, 1, end)[0]![0]!.x === goal) return f;
      return Infinity;
    };
    assert.equal(arrives(one(200)), 30 + 84, "a short way keeps its 2.8 s");
    assert.equal(arrives(one(600)), 30 + 150, "600 px at 120 px a second: 5 s");
    const long = motionOf(one(600), 220);
    assert.ok(long.step < 12.5, `600 px peaks at ${long.step.toFixed(1)} px a frame (2.8 s: 21.4)`);
    assert.equal(arrives(one(600, 2)), 30 + 210, "seen twice as close it is twice as long on screen (10 s), at most 7 s");
    assert.equal(arrives(one(2000)), 30 + 210, "at most 7 s");
    assert.equal(arrives(one(600), 30 + 120), 30 + 102, "in a shot ending 4 s on, it arrives 0.6 s before the cut");
    assert.equal(arrives(one(600), 30 + 60), 30 + 84, "never cut below its 2.8 s");
    // A formation marches as one: both tokens take the longest way's time.
    const pair = [{ start: 9, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], alive: 2 }, { start: 30, points: [{ x: 100, y: 0 }, { x: 700, y: 0 }], alive: 2 }];
    assert.deepEqual(slideFrames(pair, 30), [84, 150]);
  });

  await scenario("W the spacing follows a token's real way and holds still (Siege of Baghdad trial, 13 Nov 2026): a column through a breach passes the unit standing at it, and formations fading in on each other ease apart", () => {
    // Janissaries poured through the breach past the assault column standing at it: the pass test saw only the straight
    // start-to-goal line, so the two were pushed apart one way and then the other (72 px in one frame).
    const breach = { x: 1695.6, y: 623.8 };
    const stand: TokenWay = { from: { x: 1678, y: 592 }, goal: { x: 1678, y: 592 }, t: 1 };
    const straight: TokenWay = { from: { x: 1596, y: 468 }, goal: { x: 1701, y: 529 }, t: 0.5 };
    const through: TokenWay = { ...straight, via: breach };
    assert.equal(waysSwap(straight, stand), false, "the straight line misses the standing token");
    assert.equal(waysSwap(through, stand), true, "the way through the breach passes it");
    assert.ok(passShare(through, stand) > 0.99, "and lets it pass mid-way");
    // Straight ways keep the old test: two cavalries swapping flanks head on pass, two marching side by side do not.
    assert.equal(waysSwap({ from: { x: 0, y: 0 }, goal: { x: 1000, y: 0 }, t: 0.5 }, { from: { x: 1000, y: 0 }, goal: { x: 0, y: 0 }, t: 0.5 }), true);
    assert.equal(waysSwap({ from: { x: 0, y: 0 }, goal: { x: 1000, y: 0 }, t: 0.5 }, { from: { x: 0, y: 80 }, goal: { x: 1000, y: 80 }, t: 0.5 }), false);
    const pts = (xy: readonly (readonly [number, number])[]) => xy.map(([x, y]) => ({ x, y }));
    const assault = {
      units: [
        { side: "O", color: "#3fae3a", emblem: "hilal", kind: "piyade" as const, name: "Janissaries", steps: [{ start: 9, points: pts([[1550, 489], [1596, 468], [1643, 446], [1690, 425]]), alive: 4 }, { start: 317, points: pts([[1741, 509], [1701, 529], [1662, 549], [1622, 569]]), alive: 3, losses: [2.4], via: breach, through: [1, 2, 3] }] },
        { side: "O", color: "#3fae3a", emblem: "hilal", kind: "suvari" as const, steps: [{ start: 9, points: pts([[1609, 686], [1600, 666], [1590, 645], [1581, 625]]), alive: 4 }] },
        { side: "S", color: "#b33a3a", emblem: "gunes", kind: "piyade" as const, steps: [{ start: 9, points: pts([[1491, 1093], [1527, 1092], [1562, 1091], [1597, 1091], [1632, 1090]]), alive: 5 }, { start: 317, points: pts([[1686, 736], [1669, 736], [1652, 736], [1636, 736], [1619, 736]]), alive: 5 }] },
        { side: "O", color: "#3fae3a", emblem: "hilal", kind: "piyade" as const, name: "Assault column", steps: [{ start: 9, points: pts([[1678, 592], [1652, 653]]), alive: 2 }] },
      ],
    } as unknown as V3GeoMap;
    const m = motionOf(assault, 520, 1094);
    assert.ok(m.step < 15 && m.flips === 0, `through the breach: ${m.step.toFixed(1)} px a frame, ${m.flips} turns back`);
    // Guns, horse and garrison set down on each other as the map opens: they ease apart as they fade in (they shook 0.3 s,
    // up to 15.6 px a frame, sorted one way and then the other).
    const opening = {
      units: [
        { side: "O", color: "#3fae3a", emblem: "hilal", kind: "piyade" as const, steps: [{ start: 9, points: pts([[1348, 674], [1387, 657], [1425, 639], [1464, 621]]), alive: 4 }] },
        { side: "O", color: "#3fae3a", emblem: "hilal", kind: "suvari" as const, steps: [{ start: 9, points: pts([[1422, 845], [1427, 825], [1433, 804], [1439, 784]]), alive: 4 }] },
        { side: "O", color: "#3fae3a", emblem: "hilal", kind: "topcu" as const, steps: [{ start: 9, points: pts([[1407, 761], [1436, 748], [1465, 734], [1494, 721]]), alive: 4 }] },
        { side: "S", color: "#b33a3a", emblem: "gunes", kind: "piyade" as const, steps: [{ start: 9, points: pts([[1481, 840], [1494, 834], [1506, 828], [1519, 823], [1531, 817]]), alive: 5 }] },
      ],
    } as unknown as V3GeoMap;
    const o = motionOf(opening, 90);
    assert.ok(o.step < 6 && o.acc < 5 && o.flips === 0, `opening: ${o.step.toFixed(1)} px a frame, speed change ${o.acc.toFixed(1)}, ${o.flips} turns back`);
    // Settled, the units still keep their room.
    const settled = placeTokens(opening, 89, 30, 1).flatMap((side, ui) => side.flatMap((t) => (t ? [{ ...t, ui }] : [])));
    const closest = Math.min(...settled.flatMap((a, i) => settled.slice(i + 1).filter((b) => b.ui !== a.ui).map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
    assert.ok(closest > 69 * 0.95, `units kept apart (${closest.toFixed(0)} px)`);
  });

  await scenario("X every torch glow belongs to a drawn, visible torch (Siege of Baghdad Short, 13 Nov 2026: \"1 tane meşale gözüküyor, 2 tane parlıyor ekranda\"): as many glows as flames in every set, where the flames stand, none for a torch hidden behind an actor", () => {
    const W = 1920;
    const H = 1080;
    const FLAME = 'fill="#ff9f1c"';
    const count = (s: string, needle: string) => s.split(needle).length - 1;
    const scapes: V3DrawnSet["manzara"][] = ["nehir_kiyisi", "nehir_gecidi", "ova", "tepeler", "orman", "sahil", "sokak", "meydan", "saray_ici", "meclis", "ordugah", "sur_onu", "cadir_ici"];
    for (const manzara of scapes) {
      for (const isik of ["yok", "mesale", "kamp_atesi"] as const) {
        const spec: V3DrawnSet = { zaman: "gece", manzara, uslup: "osmanli", hava: "acik", isik, tohum: 7 } as V3DrawnSet;
        const back = renderToStaticMarkup(createElement("svg", null, createElement(DrawnSetBack, { spec, W, H, frame: 40 })));
        const flames = count(back, FLAME);
        const fire = back.includes("#ff8c1a") ? 1 : 0;
        const glows = lightSpots(spec, W, H);
        // The palace and the tent drew two torches at their walls but glowed at four outdoor spots: two glows on bare wall.
        assert.equal(glows.length, flames + fire, `${manzara}/${isik}: ${flames} torches and ${fire} fire drawn, ${glows.length} glows`);
        const torchXs = [...back.matchAll(/translate\(([-\d.e]+) ([-\d.e]+)\) scale\(0\.62?\)/g)].map((m) => Number(m[1]));
        assert.equal(torchXs.length, flames, `${manzara}/${isik}: torch poles found`);
        for (const x of torchXs) assert.ok(glows.some((g) => Math.abs(g.x - x) < 1), `${manzara}/${isik}: torch at ${x.toFixed(0)} has its glow`);
        assert.ok(glows.every((g) => g.a === 1), `${manzara}/${isik}: nothing in front, every glow full`);
      }
    }
    // The walls set: two actors stand at the auto slots 0.27/0.73, right in front of the torches at 0.32/0.68.
    const walls = { zaman: "safak", manzara: "sur_onu", uslup: "erken_modern", hava: "sis", isik: "mesale", tohum: 3 } as V3DrawnSet;
    const torches = torchSpots(walls, W, H);
    const before = (t: (typeof torches)[number], share: number): SetCover => {
      const f = flameBox(t);
      return { x0: f.x0 - 200, x1: f.x0 + share * (f.x1 - f.x0), y0: f.y0 - 300, y1: H };
    };
    const hidden = lightSpots(walls, W, H, [before(torches[1]!, 1), before(torches[2]!, 0.5)]);
    assert.equal(hidden[1]!.a, 0, "the torch wholly behind an actor gives no glow");
    assert.ok(hidden[2]!.a > 0.4 && hidden[2]!.a < 0.6, `half a flame seen, half a glow (${hidden[2]!.a})`);
    assert.ok(hidden[0]!.a === 1 && hidden[3]!.a === 1, "the torches in the open glow fully");
    const front = renderToStaticMarkup(createElement("svg", null, createElement(DrawnSetFront, { spec: walls, W, H, frame: 40, covers: [before(torches[1]!, 1), before(torches[2]!, 1)] })));
    assert.equal(count(front, "url(#ds-light)"), 2, "two torches hidden, two glows over the actors");
    // A pure function of what is in front: the same frame gives the same light.
    assert.deepEqual(lightSpots(walls, W, H, [before(torches[2]!, 0.5)]), lightSpots(walls, W, H, [before(torches[2]!, 0.5)]));
  });

  await scenario("Y the army of dots (owner, 13 Nov 2026, Siege of Baghdad Short: \"askerleri küçük yuvarlak halinde … her yuvarlak birlik 1000 askere denk gelsin\"): circles counted from the labels at one scale per map, packed tight in ranks or a disc, a garrison kept inside its walls, falling one by one", () => {
    const four = (y: number) => [0, 1, 2, 3].map((i) => ({ x: 800 + i * 69, y }));
    const five = (y: number) => [0, 1, 2, 3, 4].map((i) => ({ x: 812 + i * 69, y }));
    // Counted from the labels: a unit's own number, else as many men a block as its side's labelled blocks; guns none.
    const baghdad = [
      { side: "Ottomans", kind: "piyade", label: "35,000 infantry", steps: [{ points: four(300) }] },
      { side: "Ottomans", kind: "suvari", steps: [{ points: four(200) }] },
      { side: "Ottomans", kind: "topcu", steps: [{ points: four(380) }] },
      { side: "Safavids", kind: "piyade", label: "40,000 defenders", steps: [{ points: five(500) }] },
      { side: "Ottomans", kind: "piyade", steps: [{ points: four(495).slice(0, 2), label: "Assaulting the breach" }] },
    ];
    const a = armyDots(baghdad);
    assert.equal(a.menPerDot, 1000);
    assert.deepEqual(a.dots, [35, 35, 0, 40, 18]);
    assert.deepEqual(a.written, [true, false, false, true, false]);
    // The strength bar's numbers go to a side's unlabelled units by blocks (its name matched however it is written).
    const bar = armyDots([{ side: "Ottomans", kind: "piyade", steps: [{ points: four(0) }] }, { side: "Ottomans", kind: "suvari", steps: [{ points: four(0).slice(0, 2) }] }, { side: "Safavids", kind: "piyade", steps: [{ points: five(0) }] }], [{ sides: [{ label: "OTTOMANS", value: 60_000 }, { label: "Safavids", value: 40_000 }] }]);
    assert.deepEqual([bar.dots, bar.written], [[40, 20, 40], [true, true, true]]);
    // One scale for the whole map: an army too big for 80 circles moves every unit to the next scale.
    const big = armyDots([{ side: "A", kind: "piyade", label: "200,000 men", steps: [{ points: [...four(0), ...four(60), ...four(120)].slice(0, 10) }] }, { side: "B", kind: "kilicli", label: "3,000 men", steps: [{ points: four(0).slice(0, 2) }] }]);
    assert.deepEqual([big.menPerDot, big.dots], [2500, [80, DOTS_MIN]], "2,500 men a circle; the small unit kept readable");
    assert.deepEqual(armyDots([{ side: "A", kind: "piyade", label: "500 men", steps: [{ points: four(0).slice(0, 2) }] }, { side: "B", kind: "piyade", label: "20,000", steps: [{ points: four(0) }] }]).dots, [DOTS_MIN, 20]);
    // Nothing written anywhere (Cannae's "Eight legions"): blocks × a default, and no number claimed.
    const cannae = armyDots([{ side: "Romans", kind: "kilicli", label: "Eight legions", steps: [{ points: [...four(0), ...four(60)].slice(0, 7) }] }]);
    assert.deepEqual([cannae.dots[0], cannae.written[0]], [Math.ceil((7 * DEFAULT_MEN_PER_BLOCK) / 1000), false]);
    assert.equal(blockDotCount(40, 5, 0) + blockDotCount(40, 5, 4), 16);
    assert.equal([0, 1, 2, 3].reduce((s, b) => s + blockDotCount(35, 4, b), 0), 35);
    // A block's circles: one size, packed tight about its middle — ranks along a front, a disc in a heap, horse looser.
    const R = 23 * 0.3;
    const line = blockDots("piyade", 9, 66.7, 46, R, false, 3);
    assert.equal(line.length, 9);
    assert.ok(line.every((d) => Math.abs(d.r - R) < 1e-9), "full-size circles where they fit");
    assert.ok(line.every((d) => Math.abs(d.x) <= 33.4 && Math.abs(d.y) <= 46 * 0.6), "inside its block");
    const spread = (ds: readonly { x: number; y: number }[], k: "x" | "y") => Math.max(...ds.map((d) => d[k])) - Math.min(...ds.map((d) => d[k]));
    assert.ok(spread(blockDots("piyade", 8, 66.7, 46, R, false, 3), "x") > spread(blockDots("piyade", 8, 66.7, 46, R, false, 3), "y"), "ranks along the front, wider than deep");
    const heap = blockDots("piyade", 9, 66.7, 46, R, true, 3);
    assert.ok(heap.every((d) => Math.hypot(d.x, d.y) <= 46 * 0.62), "a heap is a disc");
    const gap = (ds: readonly { x: number; y: number }[]) => Math.min(...ds.flatMap((p, i) => ds.slice(i + 1).map((q) => Math.hypot(p.x - q.x, p.y - q.y))));
    assert.ok(gap(blockDots("suvari", 6, 66.7, 46, R, false, 3)) > gap(blockDots("piyade", 6, 66.7, 46, R, false, 3)), "horse stand looser");
    const full = blockDots("piyade", 24, 66.7, 46, R, false, 3);
    assert.ok(full[0]!.r < R && full[0]!.r > R * 0.4 && gap(full) > full[0]!.r * 1.9, "a full block packs smaller circles that never overlap");
    assert.deepEqual(blockDots("piyade", 9, 66.7, 46, R, false, 3), line, "the same block always gets the same circles");
    // The garrison: the writer stood its front right on the northern wall, the assault column too; the side decides.
    const ring = [{ x: 800, y: 500 }, { x: 1100, y: 500 }, { x: 1100, y: 800 }, { x: 800, y: 800 }, { x: 800, y: 500 }];
    const siege = {
      unitStyle: "nokta",
      close: { unit: 10, ground: [], roads: [], walls: [{ points: ring, towers: [], gates: [] }], settlements: [], buildings: [] },
      units: [
        { side: "Safavids", color: "#e67e22", emblem: "aslan", kind: "piyade" as const, label: "40,000 defenders", steps: [{ start: 9, points: five(500), alive: 5 }, { start: 120, points: five(505), alive: 3, losses: [0.8, 1.8] }] },
        { side: "Ottomans", color: "#3fae3a", emblem: "hilal", kind: "piyade" as const, label: "35,000 infantry", steps: [{ start: 9, points: four(300), alive: 4 }, { start: 120, points: four(440), alive: 4 }] },
        { side: "Ottomans", color: "#3fae3a", emblem: "hilal", kind: "piyade" as const, steps: [{ start: 9, points: [{ x: 930, y: 495 }, { x: 1000, y: 495 }], alive: 2 }] },
      ],
      fights: [{ start: 120, durationS: 4 }],
    } as unknown as V3GeoMap;
    assert.deepEqual(garrisonSteps(siege.units!, siege.close!.walls), [[0, 0], [-1, -1], [-1]]);
    // The rings the script's siege order sets the besiegers outside of (RenderPlanTypes.wallIsRing; Tactics.siegeOrder took
    // any three points, this asked for first = last within 1 px, and the garrison spilled over the walls): a writer's
    // outline that does not repeat its first corner and an OpenStreetMap wall with a gap hold a garrison; a land wall
    // from shore to shore and an L of two walls do not.
    assert.deepEqual(garrisonSteps(siege.units!, [{ points: ring.slice(0, 4) }]), [[0, 0], [-1, -1], [-1]], "an outline its writer did not close is a ring");
    assert.deepEqual(garrisonSteps(siege.units!, [{ points: [{ x: 800, y: 500 }, { x: 1100, y: 500 }, { x: 1100, y: 800 }, { x: 830, y: 800 }] }]), [[0, 0], [-1, -1], [-1]], "a wall with a gap is a ring");
    assert.deepEqual(garrisonSteps(siege.units!, [{ points: [{ x: 700, y: 520 }, { x: 950, y: 480 }, { x: 1200, y: 520 }] }]), [[-1, -1], [-1, -1], [-1]], "a land wall from shore to shore is no ring");
    assert.ok(wallIsRing(ring) && wallIsRing(ring.slice(0, 4)) && !wallIsRing(ring.slice(0, 3)), "an L of two walls is no ring");
    // The outline's open side is a wall too: a disc set down by it moves inside (its gap was no edge to ringDepth).
    assert.ok(ringDepth(fitInRing({ x: 810, y: 650 }, 60, ring.slice(0, 4)), ring) >= 60 - 1e-6, "kept off the unclosed side");
    assert.deepEqual(garrisonSteps([{ side: "S", steps: [{ points: five(600) }, { points: five(300), rout: true }, { points: five(100) }] }], [{ points: ring }]), [[0, -1, -1]], "a rout and a sortie leave the walls");
    const fit = fitInRing({ x: 950, y: 470 }, 60, ring);
    assert.ok(ringDepth(fit, ring) >= 60 - 1e-6 && fit.R === 60, "a disc set down on the wall moves inside it");
    assert.ok(fitInRing({ x: 950, y: 650 }, 400, ring).R < 150, "a disc wider than the walls packs closer");
    let blockOut = false;
    let worst = 0;
    let prev: { x: number; y: number }[][] | undefined;
    const shown: number[] = [];
    for (let f = 0; f < 300; f++) {
      const placed = placeTokens(siege, f, 30, 1);
      const { dots } = unitDotsAt(siege, placed, steadyFacingsAt(siege, placed, f, 30, 1), f, 30, 1);
      if (placed[0]!.some((t) => t && t.alpha > 0.5 && ringDepth(t, ring) < 0)) blockOut = true;
      const garrison = dots[0]!.map((b) => (b ? b.dots : []));
      for (const d of garrison.flat()) if (d.gone < 1) assert.ok(ringDepth(d, ring) >= d.r * 0.99, `frame ${f}: a circle at ${d.x.toFixed(0)},${d.y.toFixed(0)} outside the walls`);
      garrison.forEach((b, bi) => b.forEach((d, j) => {
        const p = prev?.[bi]?.[j];
        if (p && d.gone < 1) worst = Math.max(worst, Math.hypot(d.x - p.x, d.y - p.y));
      }));
      prev = garrison.map((b) => b.map((d) => ({ x: d.x, y: d.y })));
      shown[f] = garrison.flat().filter((d) => d.gone < 1).length;
      // The besiegers' circles stand with their blocks.
      placed[1]!.forEach((t, i) => t && dots[1]![i]!.dots.forEach((d) => assert.ok(Math.hypot(d.x - t.x, d.y - t.y) < 23 * 2, "a circle strays from its block")));
    }
    assert.ok(blockOut, "the garrison's blocks themselves stand past the wall (the fault the circles fix)");
    assert.ok(worst < 12, `a packed circle moved ${worst.toFixed(1)} px in one frame`);
    assert.deepEqual([shown[60], shown[299]], [40, 40 - blockDotCount(40, 5, 3) - blockDotCount(40, 5, 4)], "40 circles, then the two lost blocks' circles gone");
    // Its circles fall one by one: while a block falls, some of its circles are down and some still stand.
    const falling = Array.from({ length: 300 }, (_, f) => {
      const placed = placeTokens(siege, f, 30, 1);
      const b = unitDotsAt(siege, placed, steadyFacingsAt(siege, placed, f, 30, 1), f, 30, 1).dots[0]![4];
      return b ? b.dots.filter((d) => d.gone > 0 && d.gone < 1).length + b.dots.filter((d) => d.gone >= 1).length * 100 : 0;
    });
    assert.ok(falling.some((v) => v > 0 && v % 100 > 0 && v >= 100), "one block's circles fall in turn, not all at once");
    // Switched back to blocks (ATOLYE_V3_BIRLIK_STILI=blok at plan time): no circles.
    const blocks = { ...siege, unitStyle: "blok" } as V3GeoMap;
    assert.ok(unitDotsAt(blocks, placeTokens(blocks, 60, 30, 1), [], 60, 30, 1).dots.every((u) => u === undefined));
  });

  console.log(`V3 motion smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
