/**
 * Atölye V3 — the map-token motion meter (owner, 9 Nov 2026: "yakın savaş sahnelerinde askerlerin hareketlerinde biraz
 * atlama var gibi geldi … akıcı hareket edecek şekilde getir"). Reads a render plan and, for every map shot with unit
 * tokens, places the tokens frame by frame exactly as the render does (MapUnits.placeTokens) and reports each shot's
 * largest step in one frame and largest change of speed (on screen px). A leap shows as a step far above the shot's
 * usual pace and an equal change of speed; a fast charge peaks near 30 px a frame with a small change.
 *
 *   npx tsx scripts/v3/hareket-olcer.ts <plan.json> [--esik 40]     # exit 1 when a step or speed change passes the bar
 *
 * The renderer's module is loaded by path at run time (the root type check must not see remotion-v3's imports).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Placed = ({ x: number; y: number; alpha: number } | undefined)[][];
interface MapShot {
  readonly start: number;
  readonly duration: number;
  readonly geoMap?: { readonly units?: readonly { readonly name?: string; readonly side?: string }[]; readonly camera?: unknown };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Kullanım: npx tsx scripts/v3/hareket-olcer.ts <plan.json> [--esik 40]");
  const bar = Number(arg("--esik") ?? 40);
  // fileURLToPath, not the URL's pathname: under D:\ÜRETİM that is percent-encoded and opens nothing.
  const scene = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "remotion-v3", "src", "scene");
  const units = (await import(pathToFileURL(path.join(scene, "MapUnits.tsx")).href)) as { placeTokens: (map: unknown, frame: number, fps: number, k: number) => Placed };
  const view = (await import(pathToFileURL(path.join(scene, "MapView.tsx")).href)) as { cameraAt: (keys: unknown, frame: number, fps: number, w: number, h: number) => { zoom: number } };
  const raw = JSON.parse(readFileSync(file, "utf8")) as { plan?: { fps: number; width: number; height: number; shots: MapShot[] } } & { fps: number; width: number; height: number; shots: MapShot[] };
  const plan = raw.plan ?? raw;
  let worst = 0;
  for (const [si, shot] of plan.shots.entries()) {
    const map = shot.geoMap;
    if (!map?.units?.length) continue;
    let prev: Placed | undefined;
    let prevV: ({ x: number; y: number } | undefined)[][] = [];
    let top = { step: 0, at: 0, who: "" };
    let jerk = { d: 0, at: 0, who: "" };
    for (let f = 0; f < shot.duration; f++) {
      const cam = view.cameraAt(map.camera, f, plan.fps, plan.width, plan.height);
      const placed = units.placeTokens(map, f, plan.fps, plan.height / 1080 / cam.zoom);
      const v = placed.map((side, ui) =>
        side.map((t, ti) => {
          const p = prev?.[ui]?.[ti];
          if (!t || !p || t.alpha < 0.5) return undefined;
          const d = { x: (t.x - p.x) * cam.zoom, y: (t.y - p.y) * cam.zoom };
          const who = `${map.units![ui]?.name ?? map.units![ui]?.side ?? ui} #${ti + 1}`;
          const step = Math.hypot(d.x, d.y);
          if (step > top.step) top = { step, at: shot.start + f, who };
          const b = prevV[ui]?.[ti];
          const dv = b ? Math.hypot(d.x - b.x, d.y - b.y) : 0;
          if (dv > jerk.d) jerk = { d: dv, at: shot.start + f, who };
          return d;
        }),
      );
      prev = placed.map((side) => side.map((t) => (t ? { x: t.x, y: t.y, alpha: t.alpha } : undefined)));
      prevV = v;
    }
    worst = Math.max(worst, top.step, jerk.d);
    const sec = (fr: number) => (fr / plan.fps).toFixed(2);
    console.log(`${top.step > bar || jerk.d > bar ? "✗" : "✓"} çekim ${si} (${sec(shot.start)} sn): en büyük adım ${top.step.toFixed(1)} px/kare (${sec(top.at)} sn, ${top.who}); en büyük hız değişimi ${jerk.d.toFixed(1)} px (${sec(jerk.at)} sn, ${jerk.who})`);
  }
  if (worst > bar) {
    console.log(`UYARI: ${bar} px eşiği aşıldı — pul atlıyor`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
