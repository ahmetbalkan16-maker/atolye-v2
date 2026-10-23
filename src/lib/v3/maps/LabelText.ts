/**
 * How a map name is set, shared by the label placers (MapBuilder's state names, CloseLabels' close-map names) so both
 * measure a name the way MapView draws it.
 */

/** The two lines a long state name is written on (the reference's "SIRP / İMPARATORLUĞU"); MapView splits alike. */
export function labelLines(text: string): string[] {
  const t = text.trim();
  if (t.length <= 12 || !t.includes(" ")) return [t];
  const spaces = [...t.matchAll(/ /g)].map((m) => m.index!);
  const cut = spaces.reduce((a, b) => (Math.abs(b - t.length / 2) < Math.abs(a - t.length / 2) ? b : a));
  return [t.slice(0, cut), t.slice(cut + 1)];
}

/** A condensed capital's width against its height (Bahnschrift bold, the relief map's names). */
export const LABEL_CHAR_W = 0.58;
