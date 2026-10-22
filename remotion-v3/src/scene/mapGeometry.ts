/** Polyline helpers shared by the living map's armies, arrows, badges and vehicles (world pixels). */

export function pathLength(points: readonly { x: number; y: number }[]): number {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y), 0);
}

/** The point a fraction of the way along a polyline. */
export function along(points: readonly { x: number; y: number }[], f: number): { x: number; y: number } {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  const seg = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  let rest = Math.max(0, Math.min(1, f)) * seg.reduce((a, b) => a + b, 0);
  for (let i = 0; i < seg.length; i++) {
    if (rest <= seg[i]! || i === seg.length - 1) {
      const u = seg[i]! ? Math.min(1, rest / seg[i]!) : 1;
      return { x: points[i]!.x + (points[i + 1]!.x - points[i]!.x) * u, y: points[i]!.y + (points[i + 1]!.y - points[i]!.y) * u };
    }
    rest -= seg[i]!;
  }
  return points[points.length - 1]!;
}

/** A polyline with its corners rounded (each corner replaced by points on a quadratic curve), for arrow bodies. */
export function smoothPoints(points: readonly { x: number; y: number }[], steps = 8): { x: number; y: number }[] {
  if (points.length < 3) return [...points];
  const out = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const a = { x: (points[i - 1]!.x + points[i]!.x) / 2, y: (points[i - 1]!.y + points[i]!.y) / 2 };
    const b = { x: (points[i]!.x + points[i + 1]!.x) / 2, y: (points[i]!.y + points[i + 1]!.y) / 2 };
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push({ x: u * u * a.x + 2 * u * t * points[i]!.x + t * t * b.x, y: u * u * a.y + 2 * u * t * points[i]!.y + t * t * b.y });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}
