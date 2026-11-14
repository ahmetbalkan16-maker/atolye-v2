/**
 * `Cache-Control` for every stored project asset served behind the AYAS session gate
 * (`app/api/assets/{images,videos,audio,thumbnails}/[slug]/[fileName]`).
 *
 * `private` (14 Nov 2026 security audit; was `public`): the phone reaches AYAS through the Cloudflare named tunnel, and
 * Cloudflare's default cache stores responses for extensions such as .mp4/.png/.jpg/.webp when the origin says
 * `public, max-age=…` — keyed by URL alone, without the session cookie. One logged-in view could then be served from
 * the edge to anyone holding the URL, for a year, without the middleware ever running. `private` keeps the owner's own
 * browser cache (assets are immutable: a regeneration writes a new file name) and forbids every shared cache.
 */
export const PRIVATE_ASSET_CACHE_CONTROL = "private, max-age=31536000, immutable";
