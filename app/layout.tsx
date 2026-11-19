import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/PwaRegister";
import { AyasWorkspaceShell } from "@/components/workspace/AyasWorkspaceShell";
import "@/components/workspace/AyasWorkspace.css";

export const metadata: Metadata = {
  title: "Atölye",
  description: "Atölye — kişisel AI belgesel prodüksiyon stüdyosu.",
  applicationName: "Atölye AYAS",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "AYAS" },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // iOS "Add to Home Screen" uses this (opaque PNG; iOS rounds the corners).
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

/**
 * Every page renders per request (owner approval 2026-11-19, the Content-Security-Policy): Next stamps the
 * middleware's per-request nonce on its scripts only while rendering, so a page prerendered at build time would have
 * scripts the policy blocks. Not a visual change; see `src/lib/auth/contentSecurityPolicy.ts`.
 */
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  themeColor: "#04050a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <PwaRegister />
        <AyasWorkspaceShell>{children}</AyasWorkspaceShell>
      </body>
    </html>
  );
}
