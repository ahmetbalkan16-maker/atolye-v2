/** Lines a greedy word wrap makes of `text` in `width` at `charW` per letter (a word wider than the line keeps its own). */
export function wrappedLines(text: string, width: number, charW: number): number {
  const room = Math.max(1, Math.floor(width / charW));
  let lines = 1, used = 0;
  for (const word of text.trim().split(/\s+/)) {
    const need = used ? used + 1 + word.length : word.length;
    if (used && need > room) {
      lines++;
      used = word.length;
    } else used = need;
  }
  return lines;
}
