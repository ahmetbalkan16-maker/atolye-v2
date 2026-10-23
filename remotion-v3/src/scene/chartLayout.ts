import type { V3InfoCard } from "../../../src/lib/v3/render/RenderPlanTypes";

/** Pure layout of an info card's chart (InfoCard draws it; the smoke test checks it without Remotion). */

type Node = NonNullable<V3InfoCard["nodes"]>[number];

/** Where each chart box goes: levels down the screen, each subtree as wide as its leaves, centred over its children. */
export function chartLayout(nodes: readonly Node[], W: number, top: number, bottom: number): { x: number; y: number; w: number; level: number }[] {
  const level: number[] = nodes.map(() => 0);
  nodes.forEach((n, i) => (level[i] = n.parent !== undefined && n.parent < i ? level[n.parent]! + 1 : 0));
  const children = nodes.map((_, i) => nodes.flatMap((n, j) => (n.parent === i && j > i ? [j] : [])));
  const width: number[] = nodes.map(() => 1);
  for (let i = nodes.length - 1; i >= 0; i--) width[i] = Math.max(1, children[i]!.reduce((a, c) => a + width[c]!, 0), (nodes[i]!.castIds?.length ?? 0) > 2 ? 1.4 : 1);
  const roots = nodes.flatMap((n, i) => (n.parent === undefined || n.parent >= i ? [i] : []));
  const units = roots.reduce((a, r) => a + width[r]!, 0);
  const unit = Math.min(420, (W * 0.84) / Math.max(1, units));
  const levels = Math.max(...level) + 1;
  const step = levels > 1 ? Math.min(260, (bottom - top) / (levels - 1)) : 0;
  const out = nodes.map(() => ({ x: 0, y: 0, w: 0, level: 0 }));
  const place = (i: number, left: number) => {
    out[i] = { x: left + (width[i]! * unit) / 2, y: top + level[i]! * step, w: Math.min(unit - 26, Math.max(230, nodes[i]!.label.length * 21 + 60)), level: level[i]! };
    let l = left;
    for (const c of children[i]!) {
      place(c, l);
      l += width[c]! * unit;
    }
  };
  let left = (W - units * unit) / 2;
  for (const r of roots) {
    place(r, left);
    left += width[r]! * unit;
  }
  return out;
}
