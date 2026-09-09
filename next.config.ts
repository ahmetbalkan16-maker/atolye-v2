import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
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
