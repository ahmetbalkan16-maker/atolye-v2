/**
 * How much two texts share, by their words — the experience memory's plain recall and the proposals' "same want"
 * test. Kept apart from ExperienceMemory (which also talks to the embedding model) so the live server can use it.
 */
const words = (s: string) => new Set(s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/[^a-z0-9]+/).filter((w) => w.length > 2));

/** How much two texts share (0..1, Jaccard of their words). */
export function overlap(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / (x.size + y.size - common);
}
