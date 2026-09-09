import type { MetadataRoute } from "next";

/**
 * PWA manifest (spec §12). Served at `/manifest.webmanifest` — the path
 * `accessGate.ts` already lists as open. Makes `/brain` installable on a phone
 * as "Atölye AYAS". Colors match `BrainCore.css` (`--bc-bg`).
 *
 * This is the manifest only. A service worker / offline shell is a scoped
 * follow-up; installability + offline behaviour still need real-device testing.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Atölye AYAS",
    short_name: "AYAS",
    description: "Atölye'nin yapay zekâ çekirdeği — Brain Core.",
    start_url: "/brain",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#04050a",
    theme_color: "#04050a",
    lang: "tr",
    dir: "ltr",
    categories: ["productivity", "utilities"],
    icons: [
      {
        src: "/ayas-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/ayas-icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
