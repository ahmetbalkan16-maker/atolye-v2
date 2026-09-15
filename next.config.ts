import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the local/ephemeral Quick Tunnel development workflow unchanged.
  // The stable named tunnel is served by `next start`, so it never depends
  // on Next dev HMR or a public dev-origin allowlist entry.
  allowedDevOrigins: ["*.trycloudflare.com"],
  turbopack: {
    root: process.cwd(),
  },
  env: {
    // A literal, resolved ONCE when this config module loads (i.e. once per
    // `next build`) and inlined into every client bundle at that build's
    // compile time — deliberately NOT read at `next start` runtime. Real-
    // device evidence (2026-09-11, see `phoneLlmPrecacheDownloader.ts`'s
    // header and `ATOLYE_CHECKPOINT.md`) showed a stale `npm start` process
    // keep serving a pre-fix build for hours after a newer `npm run build`
    // had already completed, with no visible signal anywhere that this had
    // happened — the phone, the operator, and even a `curl` against the
    // page all looked "fine" until someone diffed chunk file hashes by
    // hand. This value exists so that diffing is never needed again: the
    // Phone-LLM lab UI (`PhoneLlmLabClient.tsx`) renders it visibly, so a
    // glance at the phone's screen proves which exact build's JS actually
    // reached it, independent of anything the server claims about itself.
    NEXT_PUBLIC_ATOLYE_BUILD_MARKER: new Date().toISOString(),
  },
  async headers() {
    return [
      {
        // The service worker must always be revalidated so a redeploy's new
        // sw.js is picked up promptly — otherwise a stale worker keeps serving
        // an old build and the app renders as a client-side 404.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
