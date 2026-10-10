/**
 * The project slug a topic maps to. Pure, so the start screen in the browser
 * can find the project its own request created when the response is lost on
 * the way back (a proxy cut-off), with exactly the server's derivation.
 *
 * Kept byte-for-byte as it was in `ProjectManager.createSlug`: existing
 * projects and production-acceptance markers re-derive their slug from the
 * topic, so a change here would orphan them. ("İ" lowercases to "i" plus a
 * combining dot and therefore becomes "i-"; that is known and deliberately
 * left alone.)
 */
export function createProjectSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
