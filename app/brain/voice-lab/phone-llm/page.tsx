"use client";

/**
 * AYAS PHONE LOCAL LLM — EXPERIMENTAL. Route entry only.
 *
 * `ssr: false` is the actual SSR/browser-only boundary (spec: "window,
 * navigator.gpu ve Transformers.js importlarını SSR'da çalıştırma") — it
 * guarantees `PhoneLlmLabClient.tsx` (and therefore `@huggingface/transformers`,
 * `phoneLlmRunner.ts`, `phoneLlmCapability.ts`) never runs during prerender /
 * SSR, only after the client mounts. `ssr: false` requires a Client Component
 * boundary (Next.js rejects it from a Server Component) — that is the only
 * reason this thin wrapper is `"use client"`; it still touches no browser API
 * and has no AYAS import of any kind itself.
 */

import dynamic from "next/dynamic";

const PhoneLlmLabClient = dynamic(
  () => import("./PhoneLlmLabClient").then((m) => m.PhoneLlmLabClient),
  {
    ssr: false,
    loading: () => (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, sans-serif" }}>
        <p>AYAS Phone Local LLM lab yükleniyor…</p>
      </main>
    ),
  },
);

export default function PhoneLlmLabPage() {
  return <PhoneLlmLabClient />;
}
