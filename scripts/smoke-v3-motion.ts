/**
 * V3 smoke: motion fluency. A test performer runs gestures, speech, a walk, a turn and expression changes;
 * every animated channel is sampled per frame and checked for robotic snaps (acceleration spikes), pops
 * (one-frame jumps), instant mirror flips, frame-order dependence and failure to settle.
 * Pure (no Remotion render). Run: npx tsx scripts/smoke-v3-motion.ts
 */
import assert from "node:assert/strict";
import { performerState, type PerformerState } from "../remotion-v3/src/character/motion";
import { cameraAt, filmCamera } from "../remotion-v3/src/scene/camera";
import { placeTokens } from "../remotion-v3/src/scene/MapUnits";
import type { V3CameraKey, V3GeoMap, V3Performer, V3Viseme } from "../src/lib/v3/render/RenderPlanTypes";

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

  console.log(`V3 motion smoke: PASS (${scenarios} scenarios)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
