import type { MetadataRoute } from "next";

/**
 * PWA manifest (spec §12). Served at `/manifest.webmanifest` — the path
 * `accessGate.ts` already lists as open. Makes `/brain` installable on a phone
 * as "Atölye AYAS". Colors match `BrainCore.css` (`--bc-bg`).
 *
 * Icons are real PNGs (`public/icons/`, built by `scripts/build-pwa-icons.ts`):
 * Chrome/Android's install prompt needs a PNG at 192 AND 512 with
 * `purpose: "any"`; the maskable pair improves the adaptive-icon look. The SVGs
 * stay as extra entries for browsers that prefer them.
 *
 * Installability still requires: a trusted-HTTPS origin (see
 * `docs/AYAS_REMOTE_ACCESS.md`), a registered service worker
 * (`NEXT_PUBLIC_ATOLYE_PWA_SW=on`), and — on the phone — trusting Caddy's local
 * CA. Real-device install is verified by the operator.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/brain",
    name: "Atölye AYAS",
    short_name: "AYAS",
    description: "Atölye'nin yapay zekâ çekirdeği — Brain Core.",
    start_url: "/brain?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#04050a",
    theme_color: "#04050a",
    lang: "tr",
    dir: "ltr",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/ayas-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
