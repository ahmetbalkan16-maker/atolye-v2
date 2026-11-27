import type { V3LayoutBox, V3LayoutFrame, V3LayoutKind } from "../render/RenderPlanTypes";

/**
 * The quality brain's layout check: the boxes the render itself wrote (LayoutProbe, every half second) judged against the
 * frame. The quality exam of 2 Nov 2026 showed that 4 of its 7 faults were geometry — a badge, a unit's label or a
 * state's name cut by the frame edge, speech printed over an arrow's name — which gemma4:12b found 3 times in 7 at best,
 * while the composition knows where everything is. Pure: no file, no model.
 */

/** The probed frames of one render, as ChunkedRender merges them (`yerlesim.json`). */
export interface LayoutFile {
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  /** Frames between two probes. */
  readonly every: number;
  readonly kareler: readonly V3LayoutFrame[];
}

export interface LayoutFault {
  readonly tur: "kenar" | "ustuste";
  /** Seconds. */
  readonly from: number;
  readonly to: number;
  readonly ayrinti: string;
}

/** A box sticking out of the frame by less than this (a stroke, a shadow, a spring's last wobble) is not cut. */
export const EDGE_TOLERANCE_PX = 6;
/** Two boxes overlapping by this share of the smaller one print one over the other. */
export const OVERLAP_SHARE = 0.12;
/** A fault seen on fewer consecutive probes (half a second apart) is a passing move, not a fault. */
export const MIN_PROBES = 2;

/** Over the whole dimmed picture: while one is on screen, only it is judged. */
const COVERS: ReadonlySet<V3LayoutKind> = new Set(["kart", "kapak"]);

const KIND_TR: Readonly<Record<V3LayoutKind, string>> = {
  rozet: "rozet",
  yazi: "harita yazısı",
  etiket: "ordu etiketi",
  balon: "konuşma yazısı",
  ad: "ad etiketi",
  serit: "başlık şeridi",
  hud: "güç çubuğu/tarih damgası",
  kart: "bilgi kartı başlığı",
  baslik: "yer/bilgi kutusu",
  kapak: "kapak yazısı",
};

const SIDE_TR = { sol: "sol", sag: "sağ", ust: "üst", alt: "alt" } as const;

const named = (b: V3LayoutBox) => `"${b.ad}" ${KIND_TR[b.tur]}`;

/** How far a box sticks out of the frame on each side (px, only the sides past the tolerance). */
export function cutSides(b: V3LayoutBox, width: number, height: number): Partial<Record<keyof typeof SIDE_TR, number>> {
  const out: Partial<Record<keyof typeof SIDE_TR, number>> = {};
  // Wholly outside is not cut, it is not shown.
  if (b.x >= width || b.y >= height || b.x + b.w <= 0 || b.y + b.h <= 0) return out;
  if (-b.x > EDGE_TOLERANCE_PX) out.sol = -b.x;
  if (b.x + b.w - width > EDGE_TOLERANCE_PX) out.sag = b.x + b.w - width;
  if (-b.y > EDGE_TOLERANCE_PX) out.ust = -b.y;
  if (b.y + b.h - height > EDGE_TOLERANCE_PX) out.alt = b.y + b.h - height;
  return out;
}

/** The overlap of two boxes as a share of the smaller one. */
export function overlapShare(a: V3LayoutBox, b: V3LayoutBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1, Math.min(a.w * a.h, b.w * b.h));
}

/**
 * The layout faults of a render: a box cut by the frame edge, two boxes printed over each other, each only when it lasts
 * MIN_PROBES probes in a row. `skip(frame)`: frames not judged (a shot's transition, a period picture over the set).
 */
export function layoutFaults(file: LayoutFile, skip?: (frame: number) => boolean): LayoutFault[] {
  const seen = new Map<string, { frames: number[]; ayrinti: string; tur: LayoutFault["tur"] }>();
  const note = (key: string, frame: number, tur: LayoutFault["tur"], ayrinti: string) => {
    const s = seen.get(key) ?? { frames: [], ayrinti, tur };
    s.frames.push(frame);
    s.ayrinti = ayrinti;
    seen.set(key, s);
  };
  for (const f of [...file.kareler].sort((a, b) => a.kare - b.kare)) {
    if (skip?.(f.kare)) continue;
    const covered = f.ogeler.some((o) => COVERS.has(o.tur));
    const boxes = covered ? f.ogeler.filter((o) => COVERS.has(o.tur)) : f.ogeler;
    for (const b of boxes) {
      const sides = Object.entries(cutSides(b, file.width, file.height));
      if (sides.length) note(`kenar|${b.tur}|${b.ad}`, f.kare, "kenar", `${named(b)} ${sides.map(([s, px]) => `${SIDE_TR[s as keyof typeof SIDE_TR]} kenarda kesik (${Math.round(px!)} px dışarıda)`).join(", ")}`);
    }
    if (covered) continue;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i]!, boxes[j]!].sort((x, y) => `${x.tur}${x.ad}`.localeCompare(`${y.tur}${y.ad}`)) as [V3LayoutBox, V3LayoutBox];
        const share = overlapShare(a, b);
        if (share >= OVERLAP_SHARE) note(`ustuste|${a.tur}|${a.ad}|${b.tur}|${b.ad}`, f.kare, "ustuste", `${named(a)} ile ${named(b)} üst üste (küçüğünün %${Math.round(share * 100)}'i)`);
      }
    }
  }
  const faults: LayoutFault[] = [];
  for (const s of seen.values()) {
    // Runs of probes in a row (a skipped or clean probe ends a run).
    let run: number[] = [];
    const close = () => {
      if (run.length >= MIN_PROBES) faults.push({ tur: s.tur, from: run[0]! / file.fps, to: (run[run.length - 1]! + file.every) / file.fps, ayrinti: s.ayrinti });
      run = [];
    };
    for (const fr of s.frames) {
      if (run.length && fr - run[run.length - 1]! !== file.every) close();
      run.push(fr);
    }
    close();
  }
  return faults.sort((a, b) => a.from - b.from);
}

/**
 * The parts of a vertical frame YouTube's Shorts player covers (owner, 27 Nov 2026, the quality standard: "Shorts
 * arayüzünün kapatabileceği alanlara önemli yazılar yerleştirilmemeli"): the title, channel and sound row along the
 * bottom, the like/comment/share column on the right, the search bar on top. Shares of the frame.
 */
export const SHORTS_UI = { bottom: 0.2, top: 0.07, right: 0.11, rightFrom: 0.45, rightTo: 0.9 } as const;
/** A box with at least this share of its area under the player's controls is hidden. */
export const SHORTS_UI_COVER_SHARE = 0.5;

/** The share of a box under the Shorts player's controls (0 on a horizontal frame). */
export function shortsUiCover(b: V3LayoutBox, width: number, height: number): number {
  if (height <= width || b.w <= 0 || b.h <= 0) return 0;
  const zones: V3LayoutBox[] = [
    { tur: b.tur, ad: "", x: 0, y: height * (1 - SHORTS_UI.bottom), w: width, h: height * SHORTS_UI.bottom },
    { tur: b.tur, ad: "", x: 0, y: 0, w: width, h: height * SHORTS_UI.top },
    { tur: b.tur, ad: "", x: width * (1 - SHORTS_UI.right), y: height * SHORTS_UI.rightFrom, w: width * SHORTS_UI.right, h: height * (SHORTS_UI.rightTo - SHORTS_UI.rightFrom) },
  ];
  const area = (z: V3LayoutBox) => {
    const w = Math.min(b.x + b.w, z.x + z.w) - Math.max(b.x, z.x);
    const h = Math.min(b.y + b.h, z.y + z.h) - Math.max(b.y, z.y);
    return w > 0 && h > 0 ? w * h : 0;
  };
  // The zones overlap only at the right column's foot, which the bottom band already holds (rightTo < 1 - bottom is not
  // assumed): the larger of the summed and the single areas is never above the box.
  return Math.min(1, zones.reduce((s, z) => s + area(z), 0) / (b.w * b.h));
}

/** Text the Shorts player hides, each only when it lasts MIN_PROBES probes in a row (a passing move is not a fault). */
export function shortsUiFaults(file: LayoutFile, skip?: (frame: number) => boolean): LayoutFault[] {
  if (file.height <= file.width) return [];
  const seen = new Map<string, { frames: number[]; ayrinti: string }>();
  for (const f of [...file.kareler].sort((a, b) => a.kare - b.kare)) {
    if (skip?.(f.kare)) continue;
    for (const b of f.ogeler) {
      const share = shortsUiCover(b, file.width, file.height);
      if (share < SHORTS_UI_COVER_SHARE) continue;
      const key = `${b.tur}|${b.ad}`;
      const s = seen.get(key) ?? { frames: [], ayrinti: `${named(b)} Shorts arayüzünün altında kalıyor (%${Math.round(share * 100)})` };
      s.frames.push(f.kare);
      seen.set(key, s);
    }
  }
  const faults: LayoutFault[] = [];
  for (const s of seen.values()) {
    let run: number[] = [];
    const close = () => {
      if (run.length >= MIN_PROBES) faults.push({ tur: "kenar", from: run[0]! / file.fps, to: (run[run.length - 1]! + file.every) / file.fps, ayrinti: s.ayrinti });
      run = [];
    };
    for (const fr of s.frames) {
      if (run.length && fr - run[run.length - 1]! !== file.every) close();
      run.push(fr);
    }
    close();
  }
  return faults.sort((a, b) => a.from - b.from);
}
