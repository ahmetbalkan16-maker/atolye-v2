/**
 * Stage directions the script writer puts in a line — "(steps up to the river, dramatic pause) If I cross…" — are for
 * the actor, never for the listener. Kokoro read them aloud in every video until 21 Oct 2026 (11 of the 20 Rubicon
 * lines; Whisper heard "Steps up to the river, dramatic pause if I cross…"). The spoken text drops them; VoxCPM gets
 * them as its acting instruction instead.
 */
export function splitDirections(text: string): { readonly speech: string; readonly directions: string[] } {
  const directions: string[] = [];
  const speech = text
    .replace(/\(([^()]*)\)|\[([^[\]]*)\]/g, (_m, a: string | undefined, b: string | undefined) => {
      const d = (a ?? b ?? "").trim();
      if (d) directions.push(d);
      return " ";
    })
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:—-]+/, "")
    .trim();
  return { speech, directions };
}
