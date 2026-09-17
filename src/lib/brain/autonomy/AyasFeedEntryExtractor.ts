/**
 * AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint, Part F — a deliberately
 * small, dependency-free, bounded extractor for Atom/RSS feed entries (the
 * `AyasResearchSourceRegistry`'s `github-releases-atom`/`rss`/`atom` kinds).
 * Not a general XML/HTML parser: it only recognizes the well-known
 * `<entry>...</entry>` (Atom) and `<item>...</item>` (RSS) block shapes and
 * pulls plain text out of a small fixed set of known child tags. A source
 * that doesn't match these shapes simply yields zero entries — fail soft,
 * never a thrown parse error and never a most-permissive "grab anything
 * tag-shaped" fallback that could be misled by adversarial content.
 *
 * Every returned field is later treated as `UNTRUSTED_EXTERNAL_CONTENT` by
 * the deep-analysis step (`AyasDeepResearchEngine.ts`) — this module's only
 * job is turning bytes into bounded plain text, never interpreting it.
 */
export interface AyasFeedEntry {
  readonly title: string;
  readonly link: string;
  readonly summary: string;
  readonly updatedAt?: string;
}

const MAX_ENTRY_BLOCK_SCAN = 400_000; // bounds regex work even against a large feed body
const MAX_FIELD_LENGTH = 4_000;

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripTags(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanField(raw: string | undefined): string {
  if (!raw) return "";
  return decodeXmlEntities(stripTags(raw)).slice(0, MAX_FIELD_LENGTH);
}

function firstMatch(block: string, pattern: RegExp): string | undefined {
  const m = pattern.exec(block);
  return m?.[1];
}

function extractAtomEntries(body: string, maxEntries: number): readonly AyasFeedEntry[] {
  const out: AyasFeedEntry[] = [];
  const blockPattern = /<entry\b[\s\S]*?<\/entry>/g;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(body.slice(0, MAX_ENTRY_BLOCK_SCAN))) && out.length < maxEntries) {
    const block = match[0];
    const title = cleanField(firstMatch(block, /<title\b[^>]*>([\s\S]*?)<\/title>/));
    const linkHref = firstMatch(block, /<link\b[^>]*\bhref="([^"]*)"[^>]*\/?>/);
    const linkBody = firstMatch(block, /<link\b[^>]*>([\s\S]*?)<\/link>/);
    const link = (linkHref ?? linkBody ?? "").trim();
    const summary = cleanField(firstMatch(block, /<summary\b[^>]*>([\s\S]*?)<\/summary>/) ?? firstMatch(block, /<content\b[^>]*>([\s\S]*?)<\/content>/));
    const updatedAt = cleanField(firstMatch(block, /<updated>([\s\S]*?)<\/updated>/) ?? firstMatch(block, /<published>([\s\S]*?)<\/published>/)) || undefined;
    if (!title && !link) continue;
    out.push({ title, link, summary, updatedAt });
  }
  return out;
}

function extractRssEntries(body: string, maxEntries: number): readonly AyasFeedEntry[] {
  const out: AyasFeedEntry[] = [];
  const blockPattern = /<item\b[\s\S]*?<\/item>/g;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(body.slice(0, MAX_ENTRY_BLOCK_SCAN))) && out.length < maxEntries) {
    const block = match[0];
    const title = cleanField(firstMatch(block, /<title\b[^>]*>([\s\S]*?)<\/title>/));
    const link = cleanField(firstMatch(block, /<link\b[^>]*>([\s\S]*?)<\/link>/));
    const summary = cleanField(firstMatch(block, /<description\b[^>]*>([\s\S]*?)<\/description>/));
    const updatedAt = cleanField(firstMatch(block, /<pubDate>([\s\S]*?)<\/pubDate>/)) || undefined;
    if (!title && !link) continue;
    out.push({ title, link, summary, updatedAt });
  }
  return out;
}

/** GitHub `releases.atom` bodies are ordinary Atom XML — no special case needed, `extractAtomEntries` already covers them (verified against a real fetch). */
export function extractAyasFeedEntries(body: string, contentTypeOrKind: string, maxEntries = 5): readonly AyasFeedEntry[] {
  const hint = contentTypeOrKind.toLowerCase();
  if (hint.includes("atom") || hint.includes("github-releases-atom")) {
    const atomEntries = extractAtomEntries(body, maxEntries);
    if (atomEntries.length > 0) return atomEntries;
  }
  if (hint.includes("rss")) return extractRssEntries(body, maxEntries);
  // Unknown/ambiguous content-type — try both shapes rather than guessing wrong and returning nothing.
  const atom = extractAtomEntries(body, maxEntries);
  if (atom.length > 0) return atom;
  return extractRssEntries(body, maxEntries);
}
